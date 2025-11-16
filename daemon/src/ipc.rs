use tokio::net::{UnixListener, UnixStream};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use serde::{Deserialize, Serialize};
use anyhow::{Context, Result};
use std::path::Path;
use tracing::{info, warn, error};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcMessage {
    // Client -> Daemon
    GetRules,
    AddRule { rule: serde_json::Value },
    UpdateRule { rule: serde_json::Value },
    DeleteRule { rule_id: i64 },
    GetHistory { limit: i64 },
    GetStats,
    RespondToPrompt { prompt_id: String, action: String, remember: bool, duration: String },

    // Daemon -> Client
    ConnectionPrompt {
        prompt_id: String,
        pid: u32,
        uid: u32,
        executable: String,
        cmdline: String,
        dest_ip: String,
        dest_port: u16,
        dest_host: Option<String>,
        protocol: String,
    },
    RulesList { rules: Vec<serde_json::Value> },
    HistoryData { entries: Vec<serde_json::Value> },
    StatsData { stats: serde_json::Value },
    Success { message: String },
    Error { message: String },
    ConnectionEvent {
        timestamp: String,
        pid: u32,
        executable: String,
        dest_ip: String,
        dest_port: u16,
        dest_host: Option<String>,
        protocol: String,
        action: String,
    },
}

pub struct IpcServer {
    socket_path: String,
    tx: mpsc::Sender<IpcMessage>,
}

impl IpcServer {
    pub fn new(socket_path: String, tx: mpsc::Sender<IpcMessage>) -> Self {
        Self { socket_path, tx }
    }

    pub async fn start(&self, mut rx: mpsc::Receiver<(String, IpcMessage)>) -> Result<()> {
        // Remove old socket if it exists
        let path = Path::new(&self.socket_path);
        if path.exists() {
            tokio::fs::remove_file(path).await
                .context("Failed to remove old socket")?;
        }

        // Create parent directory
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create socket directory")?;
        }

        let listener = UnixListener::bind(&self.socket_path)
            .context("Failed to bind Unix socket")?;

        info!("IPC server listening on {}", self.socket_path);

        // Set socket permissions
        #[cfg(unix)]
        {
            use std::fs::Permissions;
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&self.socket_path, Permissions::from_mode(0o666)).await
                .context("Failed to set socket permissions")?;
        }

        let tx = self.tx.clone();
        let _socket_path = self.socket_path.clone();

        // Spawn task to handle outgoing messages
        tokio::spawn(async move {
            let mut clients: Vec<UnixStream> = Vec::new();

            while let Some((_client_id, msg)) = rx.recv().await {
                // Broadcast to all connected clients
                let json = match serde_json::to_string(&msg) {
                    Ok(j) => j,
                    Err(e) => {
                        error!("Failed to serialize message: {}", e);
                        continue;
                    }
                };

                // Send to all clients
                for client in &mut clients {
                    if let Err(e) = client.write_all(json.as_bytes()).await {
                        warn!("Failed to send message to client: {}", e);
                    }
                    if let Err(e) = client.write_all(b"\n").await {
                        warn!("Failed to send newline to client: {}", e);
                    }
                }
            }
        });

        // Accept connections
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    let tx = tx.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_client(stream, tx).await {
                            warn!("Client handler error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Failed to accept connection: {}", e);
                }
            }
        }
    }
}

async fn handle_client(stream: UnixStream, tx: mpsc::Sender<IpcMessage>) -> Result<()> {
    info!("New client connected");

    let (reader, _writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await
            .context("Failed to read from client")?;

        if n == 0 {
            info!("Client disconnected");
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<IpcMessage>(trimmed) {
            Ok(msg) => {
                if let Err(e) = tx.send(msg).await {
                    error!("Failed to send message to handler: {}", e);
                    break;
                }
            }
            Err(e) => {
                warn!("Failed to parse message: {}", e);
            }
        }
    }

    Ok(())
}

pub struct IpcClient {
    stream: UnixStream,
}

impl IpcClient {
    pub async fn connect(socket_path: &str) -> Result<Self> {
        let stream = UnixStream::connect(socket_path).await
            .context("Failed to connect to daemon socket")?;
        Ok(Self { stream })
    }

    pub async fn send(&mut self, msg: &IpcMessage) -> Result<()> {
        let json = serde_json::to_string(msg)?;
        self.stream.write_all(json.as_bytes()).await?;
        self.stream.write_all(b"\n").await?;
        Ok(())
    }

    pub async fn recv(&mut self) -> Result<IpcMessage> {
        let mut reader = BufReader::new(&mut self.stream);
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        let msg = serde_json::from_str(&line)?;
        Ok(msg)
    }
}
