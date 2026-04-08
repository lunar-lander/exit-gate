use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcMessage {
    // Client -> Daemon
    GetRules,
    AddRule {
        rule: serde_json::Value,
    },
    UpdateRule {
        rule: serde_json::Value,
    },
    DeleteRule {
        rule_id: i64,
    },
    GetHistory {
        limit: i64,
    },
    GetHistorySince {
        timestamp: String,
    },
    GetStats,
    RespondToPrompt {
        prompt_id: String,
        action: String,
        remember: bool,
        duration: String,
    },

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
    RulesList {
        rules: Vec<serde_json::Value>,
    },
    HistoryData {
        entries: Vec<serde_json::Value>,
    },
    StatsData {
        stats: serde_json::Value,
    },
    Success {
        message: String,
    },
    Error {
        message: String,
    },
    ConnectionEvent {
        timestamp: String,
        pid: u32,
        uid: u32,
        gid: u32,
        executable: String,
        cmdline: String,
        dest_ip: String,
        dest_port: u16,
        dest_host: Option<String>,
        protocol: String,
        action: String,
        rule_id: Option<i64>,
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
            tokio::fs::remove_file(path)
                .await
                .context("Failed to remove old socket")?;
        }

        // Create parent directory
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .context("Failed to create socket directory")?;
        }

        let listener =
            UnixListener::bind(&self.socket_path).context("Failed to bind Unix socket")?;

        info!("IPC server listening on {}", self.socket_path);

        // Set socket permissions
        #[cfg(unix)]
        {
            use std::fs::Permissions;
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&self.socket_path, Permissions::from_mode(0o666))
                .await
                .context("Failed to set socket permissions")?;
        }

        let tx = self.tx.clone();
        let _socket_path = self.socket_path.clone();

        // Shared list of connected clients (writers)
        let clients: Arc<RwLock<Vec<WriteHalf<UnixStream>>>> = Arc::new(RwLock::new(Vec::new()));
        let clients_for_broadcast = clients.clone();

        // Spawn task to handle outgoing messages
        tokio::spawn(async move {
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
                let mut clients_lock = clients_for_broadcast.write().await;
                let mut to_remove = Vec::new();

                for (idx, client) in clients_lock.iter_mut().enumerate() {
                    if let Err(e) = client.write_all(json.as_bytes()).await {
                        warn!("Failed to send message to client: {}", e);
                        to_remove.push(idx);
                        continue;
                    }
                    if let Err(e) = client.write_all(b"\n").await {
                        warn!("Failed to send newline to client: {}", e);
                        to_remove.push(idx);
                    }
                }

                // Remove disconnected clients (in reverse order to preserve indices)
                for idx in to_remove.iter().rev() {
                    clients_lock.remove(*idx);
                }
            }
        });

        // Accept connections
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    info!("New client connected");
                    let tx = tx.clone();
                    let clients_clone = clients.clone();

                    tokio::spawn(async move {
                        let (reader, writer) = tokio::io::split(stream);

                        // Add writer to clients list
                        clients_clone.write().await.push(writer);

                        if let Err(e) = handle_client(reader, tx).await {
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

async fn handle_client(
    reader: tokio::io::ReadHalf<UnixStream>,
    tx: mpsc::Sender<IpcMessage>,
) -> Result<()> {
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .await
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

#[allow(dead_code)]
pub struct IpcClient {
    stream: UnixStream,
}

#[allow(dead_code)]
impl IpcClient {
    pub async fn connect(socket_path: &str) -> Result<Self> {
        let stream = UnixStream::connect(socket_path)
            .await
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
