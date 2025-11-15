mod config;
mod rule;
mod db;
mod process;
mod ipc;

use anyhow::{Context, Result};
use clap::Parser;
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use chrono::Utc;
use std::net::IpAddr;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;
use crate::rule::{Rule, RuleEngine, Action, Duration, RuleCriteria, ConnectionInfo};
use crate::db::Database;
use crate::process::ProcessInfo;
use crate::ipc::{IpcServer, IpcMessage};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Configuration file path
    #[arg(short, long)]
    config: Option<String>,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    log_level: String,

    /// Run in foreground (don't daemonize)
    #[arg(short, long)]
    foreground: bool,
}

struct DaemonState {
    rule_engine: RwLock<RuleEngine>,
    pending_prompts: RwLock<HashMap<String, ConnectionInfo>>,
    db: Database,
    config: Config,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize tracing
    let log_level = args.log_level.to_lowercase();
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&log_level));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Exit Gate daemon starting...");

    // Load configuration
    let config = Config::load_or_default(args.config.as_deref())
        .context("Failed to load configuration")?;

    info!("Configuration loaded");

    // Initialize database
    let db = Database::new(&config.database.db_path).await
        .context("Failed to initialize database")?;

    info!("Database initialized at {}", config.database.db_path);

    // Load rules from database
    let mut rule_engine = RuleEngine::new();
    let rules = db.load_rules().await
        .context("Failed to load rules from database")?;

    info!("Loaded {} rules from database", rules.len());

    for rule in rules {
        rule_engine.add_rule(rule);
    }

    // Create shared state
    let state = Arc::new(DaemonState {
        rule_engine: RwLock::new(rule_engine),
        pending_prompts: RwLock::new(HashMap::new()),
        db,
        config: config.clone(),
    });

    // Create IPC channels
    let (ipc_tx, mut ipc_rx) = mpsc::channel::<IpcMessage>(100);
    let (ipc_resp_tx, ipc_resp_rx) = mpsc::channel::<(String, IpcMessage)>(100);

    // Start IPC server
    let ipc_server = IpcServer::new(config.daemon.socket_path.clone(), ipc_tx.clone());
    let ipc_handle = tokio::spawn({
        async move {
            if let Err(e) = ipc_server.start(ipc_resp_rx).await {
                error!("IPC server error: {}", e);
            }
        }
    });

    // Handle IPC messages
    let state_clone = state.clone();
    let ipc_resp_tx_clone = ipc_resp_tx.clone();
    let ipc_handler = tokio::spawn(async move {
        handle_ipc_messages(state_clone, &mut ipc_rx, ipc_resp_tx_clone).await;
    });

    info!("IPC server started on {}", config.daemon.socket_path);

    // TODO: Load and attach eBPF programs
    // This would use libbpf-rs to load the compiled eBPF object
    // and attach to kprobes. For now we'll simulate events.

    info!("Daemon initialized and ready");

    // Simulate some connection events for demonstration
    // In production, these would come from eBPF ring buffer
    let state_clone = state.clone();
    let ipc_tx_clone = ipc_tx.clone();
    tokio::spawn(async move {
        simulate_connection_events(state_clone, ipc_tx_clone).await;
    });

    // Wait for tasks
    tokio::select! {
        _ = ipc_handle => {
            error!("IPC server terminated");
        }
        _ = ipc_handler => {
            error!("IPC handler terminated");
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Received Ctrl+C, shutting down...");
        }
    }

    // Cleanup
    info!("Performing cleanup...");
    if let Err(e) = tokio::fs::remove_file(&config.daemon.socket_path).await {
        warn!("Failed to remove socket file: {}", e);
    }

    info!("Exit Gate daemon stopped");
    Ok(())
}

async fn handle_ipc_messages(
    state: Arc<DaemonState>,
    rx: &mut mpsc::Receiver<IpcMessage>,
    resp_tx: mpsc::Sender<(String, IpcMessage)>,
) {
    while let Some(msg) = rx.recv().await {
        match msg {
            IpcMessage::GetRules => {
                let engine = state.rule_engine.read().await;
                let rules: Vec<serde_json::Value> = engine
                    .get_rules()
                    .iter()
                    .map(|r| serde_json::to_value(r).unwrap())
                    .collect();

                let _ = resp_tx.send((
                    "broadcast".to_string(),
                    IpcMessage::RulesList { rules },
                )).await;
            }

            IpcMessage::AddRule { rule } => {
                match serde_json::from_value::<Rule>(rule) {
                    Ok(mut new_rule) => {
                        match state.db.save_rule(&new_rule).await {
                            Ok(id) => {
                                new_rule.id = Some(id);
                                state.rule_engine.write().await.add_rule(new_rule);
                                let _ = resp_tx.send((
                                    "broadcast".to_string(),
                                    IpcMessage::Success {
                                        message: format!("Rule added with ID {}", id),
                                    },
                                )).await;
                            }
                            Err(e) => {
                                error!("Failed to save rule: {}", e);
                                let _ = resp_tx.send((
                                    "broadcast".to_string(),
                                    IpcMessage::Error {
                                        message: format!("Failed to save rule: {}", e),
                                    },
                                )).await;
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to deserialize rule: {}", e);
                        let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::Error {
                                message: format!("Invalid rule format: {}", e),
                            },
                        )).await;
                    }
                }
            }

            IpcMessage::UpdateRule { rule } => {
                match serde_json::from_value::<Rule>(rule) {
                    Ok(updated_rule) => {
                        match state.db.update_rule(&updated_rule).await {
                            Ok(_) => {
                                state.rule_engine.write().await.update_rule(updated_rule);
                                let _ = resp_tx.send((
                                    "broadcast".to_string(),
                                    IpcMessage::Success {
                                        message: "Rule updated".to_string(),
                                    },
                                )).await;
                            }
                            Err(e) => {
                                error!("Failed to update rule: {}", e);
                                let _ = resp_tx.send((
                                    "broadcast".to_string(),
                                    IpcMessage::Error {
                                        message: format!("Failed to update rule: {}", e),
                                    },
                                )).await;
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to deserialize rule: {}", e);
                    }
                }
            }

            IpcMessage::DeleteRule { rule_id } => {
                match state.db.delete_rule(rule_id).await {
                    Ok(_) => {
                        state.rule_engine.write().await.remove_rule(rule_id);
                        let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::Success {
                                message: "Rule deleted".to_string(),
                            },
                        )).await;
                    }
                    Err(e) => {
                        error!("Failed to delete rule: {}", e);
                        let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::Error {
                                message: format!("Failed to delete rule: {}", e),
                            },
                        )).await;
                    }
                }
            }

            IpcMessage::GetHistory { limit } => {
                match state.db.get_connection_history(limit).await {
                    Ok(entries) => {
                        let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::HistoryData { entries },
                        )).await;
                    }
                    Err(e) => {
                        error!("Failed to get history: {}", e);
                        let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::Error {
                                message: format!("Failed to get history: {}", e),
                            },
                        )).await;
                    }
                }
            }

            IpcMessage::GetStats => {
                // TODO: Implement statistics gathering
                let stats = serde_json::json!({
                    "total_connections": 0,
                    "allowed": 0,
                    "denied": 0,
                    "active_rules": state.rule_engine.read().await.get_rules().len(),
                });

                let _ = resp_tx.send((
                    "broadcast".to_string(),
                    IpcMessage::StatsData { stats },
                )).await;
            }

            IpcMessage::RespondToPrompt { prompt_id, action, remember, duration } => {
                let mut prompts = state.pending_prompts.write().await;
                if let Some(conn_info) = prompts.remove(&prompt_id) {
                    let action = if action == "allow" {
                        Action::Allow
                    } else {
                        Action::Deny
                    };

                    // Save to history
                    let _ = state.db.save_connection_history(
                        Utc::now(),
                        conn_info.pid,
                        conn_info.uid,
                        conn_info.gid,
                        &conn_info.executable,
                        &conn_info.cmdline,
                        &conn_info.dest_ip.to_string(),
                        conn_info.dest_port,
                        conn_info.dest_host.as_deref(),
                        &conn_info.protocol,
                        &action,
                        None,
                    ).await;

                    // Create rule if remember is true
                    if remember {
                        let duration = match duration.as_str() {
                            "once" => Duration::Once,
                            "process" => Duration::Process,
                            "restart" => Duration::UntilRestart,
                            _ => Duration::Forever,
                        };

                        let rule = Rule::new(
                            format!("Auto: {} to {}:{}", conn_info.executable, conn_info.dest_ip, conn_info.dest_port),
                            action.clone(),
                            duration.clone(),
                            RuleCriteria {
                                executable: Some(conn_info.executable.clone()),
                                dest_ip: Some(conn_info.dest_ip.to_string()),
                                dest_port: Some(conn_info.dest_port),
                                ..Default::default()
                            },
                        );

                        if duration == Duration::Forever {
                            if let Ok(id) = state.db.save_rule(&rule).await {
                                let mut new_rule = rule;
                                new_rule.id = Some(id);
                                state.rule_engine.write().await.add_rule(new_rule);
                            }
                        } else if duration == Duration::Process {
                            state.rule_engine.write().await.add_process_rule(conn_info.pid, rule);
                        } else {
                            state.rule_engine.write().await.add_rule(rule);
                        }
                    }

                    info!("Prompt {} resolved: {:?}", prompt_id, action);
                }
            }

            _ => {
                debug!("Unhandled IPC message: {:?}", msg);
            }
        }
    }
}

async fn simulate_connection_events(state: Arc<DaemonState>, ipc_tx: mpsc::Sender<IpcMessage>) {
    // This is a placeholder for demonstration
    // In production, this would read from eBPF ring buffer
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

    info!("Simulating connection event...");

    let conn_info = ConnectionInfo {
        pid: std::process::id(),
        uid: unsafe { libc::getuid() },
        gid: unsafe { libc::getgid() },
        executable: "/usr/bin/curl".to_string(),
        cmdline: "curl https://example.com".to_string(),
        dest_ip: "93.184.216.34".parse::<IpAddr>().unwrap(),
        dest_port: 443,
        dest_host: Some("example.com".to_string()),
        protocol: "TCP".to_string(),
        process_start_time: 0,
    };

    // Check rules
    let mut engine = state.rule_engine.write().await;
    if let Some(action) = engine.evaluate(&conn_info) {
        info!("Connection matched rule: {:?}", action);

        // Log to database
        let _ = state.db.save_connection_history(
            Utc::now(),
            conn_info.pid,
            conn_info.uid,
            conn_info.gid,
            &conn_info.executable,
            &conn_info.cmdline,
            &conn_info.dest_ip.to_string(),
            conn_info.dest_port,
            conn_info.dest_host.as_deref(),
            &conn_info.protocol,
            &action,
            None,
        ).await;
    } else {
        // No rule matched, send prompt to GUI
        let prompt_id = uuid::Uuid::new_v4().to_string();

        state.pending_prompts.write().await.insert(prompt_id.clone(), conn_info.clone());

        let _ = ipc_tx.send(IpcMessage::ConnectionPrompt {
            prompt_id,
            pid: conn_info.pid,
            uid: conn_info.uid,
            executable: conn_info.executable,
            cmdline: conn_info.cmdline,
            dest_ip: conn_info.dest_ip.to_string(),
            dest_port: conn_info.dest_port,
            dest_host: conn_info.dest_host,
            protocol: conn_info.protocol,
        }).await;

        info!("Connection prompt sent to GUI");
    }
}

impl Default for RuleCriteria {
    fn default() -> Self {
        Self {
            executable: None,
            executable_regex: None,
            cmdline: None,
            dest_ip: None,
            dest_network: None,
            dest_port: None,
            dest_port_range: None,
            dest_host: None,
            dest_host_regex: None,
            protocol: None,
            uid: None,
            gid: None,
        }
    }
}
