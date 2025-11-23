mod config;
mod rule;
mod db;
mod process;
mod ipc;
mod ebpf;

use anyhow::{Context, Result};
use clap::Parser;
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug, trace};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use chrono::Utc;
use std::net::IpAddr;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;
use crate::rule::{Rule, RuleEngine, Action, Duration, RuleCriteria, ConnectionInfo};
use crate::db::Database;
use crate::ipc::{IpcServer, IpcMessage};
use crate::ebpf::ConnectionEvent;

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

struct Stats {
    total_connections: u64,
    allowed: u64,
    denied: u64,
}

struct DaemonState {
    rule_engine: RwLock<RuleEngine>,
    pending_prompts: RwLock<HashMap<String, ConnectionInfo>>,
    stats: RwLock<Stats>,
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

    info!("Configuration loaded. Database path: {}", config.database.db_path);

    // Initialize database
    let db = Database::new(&config.database.db_path).await
        .context("Failed to initialize database")?;

    info!("Database initialized");

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
        stats: RwLock::new(Stats {
            total_connections: 0,
            allowed: 0,
            denied: 0,
        }),
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

    // Start eBPF monitor
    let (ebpf_tx, mut ebpf_rx) = mpsc::channel::<ConnectionEvent>(10000);
    let bpf_path = config.daemon.bpf_path.clone();

    let ebpf_handle = tokio::spawn(async move {
        // Run eBPF monitor in a blocking task since libbpf-rs isn't async
        let result = tokio::task::spawn_blocking(move || {
            // Create a runtime for the blocking context
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                if let Err(e) = ebpf::start_ebpf_monitor(
                    format!("{}/network_monitor.bpf.o", bpf_path),
                    ebpf_tx,
                ).await {
                    error!("eBPF monitor error: {}", e);
                }
            });
        }).await;

        if let Err(e) = result {
            error!("eBPF task panicked: {}", e);
        }
    });

    // Handle eBPF events
    let state_for_ebpf = state.clone();
    let ipc_resp_tx_for_ebpf = ipc_resp_tx.clone();
    let ebpf_event_handler = tokio::spawn(async move {
        while let Some(event) = ebpf_rx.recv().await {
            handle_ebpf_event(
                state_for_ebpf.clone(),
                ipc_resp_tx_for_ebpf.clone(),
                event,
            ).await;
        }
    });

    info!("Daemon initialized and ready");

    // Wait for tasks
    tokio::select! {
        _ = ipc_handle => {
            error!("IPC server terminated");
        }
        _ = ipc_handler => {
            error!("IPC handler terminated");
        }
        _ = ebpf_handle => {
            error!("eBPF monitor terminated");
        }
        _ = ebpf_event_handler => {
            error!("eBPF event handler terminated");
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

            IpcMessage::GetHistorySince { timestamp } => {
                match timestamp.parse::<chrono::DateTime<Utc>>() {
                    Ok(since) => {
                        match state.db.get_connection_history_since(since).await {
                            Ok(entries) => {
                                let _ = resp_tx.send((
                                    "broadcast".to_string(),
                                    IpcMessage::HistoryData { entries },
                                )).await;
                            }
                            Err(e) => {
                                error!("Failed to get history since {}: {}", timestamp, e);
                                let _ = resp_tx.send((
                                    "broadcast".to_string(),
                                    IpcMessage::Error {
                                        message: format!("Failed to get history: {}", e),
                                    },
                                )).await;
                            }
                        }
                    }
                    Err(e) => {
                         error!("Invalid timestamp format: {}", e);
                         let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::Error {
                                message: format!("Invalid timestamp: {}", e),
                            },
                        )).await;
                    }
                }
            }

            IpcMessage::GetStats => {
                let stats_lock = state.stats.read().await;
                let stats = serde_json::json!({
                    "total_connections": stats_lock.total_connections,
                    "allowed": stats_lock.allowed,
                    "denied": stats_lock.denied,
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

                    // Update stats
                    let mut stats = state.stats.write().await;
                    stats.total_connections += 1;
                    if matches!(action, Action::Allow) {
                        stats.allowed += 1;
                    } else {
                        stats.denied += 1;
                    }
                    drop(stats);

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
                            format!("Auto: {}", conn_info.executable),
                            action.clone(),
                            duration.clone(),
                            RuleCriteria {
                                executable: Some(conn_info.executable.clone()),
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

                    // Send updated stats to all clients
                    let stats_lock = state.stats.read().await;
                    let stats_json = serde_json::json!({
                        "total_connections": stats_lock.total_connections,
                        "allowed": stats_lock.allowed,
                        "denied": stats_lock.denied,
                        "active_rules": state.rule_engine.read().await.get_rules().len(),
                    });
                    drop(stats_lock);

                    let _ = resp_tx.send((
                        "broadcast".to_string(),
                        IpcMessage::StatsData { stats: stats_json },
                    )).await;

                    // Send updated history
                    if let Ok(entries) = state.db.get_connection_history(100).await {
                        let _ = resp_tx.send((
                            "broadcast".to_string(),
                            IpcMessage::HistoryData { entries },
                        )).await;
                    }
                }
            }

            _ => {
                debug!("Unhandled IPC message: {:?}", msg);
            }
        }
    }
}

async fn handle_ebpf_event(
    state: Arc<DaemonState>,
    ipc_resp_tx: mpsc::Sender<(String, IpcMessage)>,
    event: ConnectionEvent,
) {
    // Perform blocking /proc reads in a separate thread
    let pid = event.pid;
    let event_comm = event.comm_string(); // Clone string before moving
    
    let proc_info = tokio::task::spawn_blocking(move || {
        let executable = match std::fs::read_link(format!("/proc/{}/exe", pid)) {
            Ok(path) => path.to_string_lossy().to_string(),
            Err(_) => event_comm,
        };

        let cmdline = match std::fs::read_to_string(format!("/proc/{}/cmdline", pid)) {
            Ok(cmd) => cmd.replace('\0', " ").trim().to_string(),
            Err(_) => executable.clone(),
        };
        
        (executable, cmdline)
    }).await;

    let (executable, cmdline) = match proc_info {
        Ok(info) => info,
        Err(e) => {
            error!("Failed to join blocking task: {}", e);
            return;
        }
    };

    // Parse destination IP
    let dest_ip = event.dest_ip_string();
    let dest_ip_parsed: std::net::IpAddr = match dest_ip.parse() {
        Ok(ip) => ip,
        Err(_) => {
            debug!("Failed to parse IP: {}", dest_ip);
            return;
        }
    };

    let conn_info = ConnectionInfo {
        pid: event.pid,
        uid: event.uid,
        gid: event.gid,
        executable: executable.clone(),
        cmdline,
        dest_ip: dest_ip_parsed,
        dest_port: event.dport,
        dest_host: None, // DNS resolution would be async
        protocol: event.protocol_string(),
        process_start_time: 0,
    };

    trace!(
        "Connection: {} ({}) -> {}:{} [{}]",
        executable, event.pid, dest_ip, event.dport, event.protocol_string()
    );

    // Check rules using READ lock first for better concurrency
    let engine = state.rule_engine.read().await;
    let action = engine.evaluate(&conn_info);
    drop(engine); // Release read lock immediately

    if let Some(action) = action {
        debug!("Connection matched rule: {:?}", action);

        // Update stats (requires write lock, but short duration)
        let mut stats = state.stats.write().await;
        stats.total_connections += 1;
        if matches!(action, Action::Allow) {
            stats.allowed += 1;
        } else {
            stats.denied += 1;
        }
        drop(stats);

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

        // Send connection event to GUI
        let _ = ipc_resp_tx.send((
            "broadcast".to_string(),
            IpcMessage::ConnectionEvent {
                timestamp: Utc::now().to_rfc3339(),
                pid: conn_info.pid,
                executable: conn_info.executable.clone(),
                dest_ip: conn_info.dest_ip.to_string(),
                dest_port: conn_info.dest_port,
                dest_host: conn_info.dest_host.clone(),
                protocol: conn_info.protocol.clone(),
                action: format!("{:?}", action).to_lowercase(),
            },
        )).await;

        // Send updated stats
        // To reduce IPC traffic, maybe don't send stats on every single packet?
        // But for now, let's keep it to maintain behavior.
        // Optimization: clone stats inside the lock to minimize hold time
        let stats_lock = state.stats.read().await;
        let stats_json = serde_json::json!({
            "total_connections": stats_lock.total_connections,
            "allowed": stats_lock.allowed,
            "denied": stats_lock.denied,
            "active_rules": state.rule_engine.read().await.get_rules().len(),
        });
        drop(stats_lock);

        let _ = ipc_resp_tx.send((
            "broadcast".to_string(),
            IpcMessage::StatsData { stats: stats_json },
        )).await;
    } else {
        // No rule matched, send prompt to GUI
        let prompt_id = uuid::Uuid::new_v4().to_string();

        state.pending_prompts.write().await.insert(prompt_id.clone(), conn_info.clone());

        let _ = ipc_resp_tx.send((
            "broadcast".to_string(),
            IpcMessage::ConnectionPrompt {
                prompt_id,
                pid: conn_info.pid,
                uid: conn_info.uid,
                executable: conn_info.executable,
                cmdline: conn_info.cmdline,
                dest_ip: conn_info.dest_ip.to_string(),
                dest_port: conn_info.dest_port,
                dest_host: conn_info.dest_host,
                protocol: conn_info.protocol,
            },
        )).await;

        debug!("Connection prompt sent to GUI");
    }
}

// Legacy function - kept for reference
#[allow(dead_code)]
async fn handle_connection_event(
    state: Arc<DaemonState>,
    ipc_resp_tx: mpsc::Sender<(String, IpcMessage)>,
    conn_info: ConnectionInfo,
) {
    // Check rules
    let mut engine = state.rule_engine.write().await;
    if let Some(action) = engine.evaluate(&conn_info) {
        drop(engine);
        info!("Connection matched rule: {:?}", action);

        // Update stats
        let mut stats = state.stats.write().await;
        stats.total_connections += 1;
        if matches!(action, Action::Allow) {
            stats.allowed += 1;
        } else {
            stats.denied += 1;
        }
        drop(stats);

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

        // Send connection event to GUI
        let _ = ipc_resp_tx.send((
            "broadcast".to_string(),
            IpcMessage::ConnectionEvent {
                timestamp: Utc::now().to_rfc3339(),
                pid: conn_info.pid,
                executable: conn_info.executable.clone(),
                dest_ip: conn_info.dest_ip.to_string(),
                dest_port: conn_info.dest_port,
                dest_host: conn_info.dest_host.clone(),
                protocol: conn_info.protocol.clone(),
                action: format!("{:?}", action).to_lowercase(),
            },
        )).await;

        // Send updated stats
        let stats_lock = state.stats.read().await;
        let stats_json = serde_json::json!({
            "total_connections": stats_lock.total_connections,
            "allowed": stats_lock.allowed,
            "denied": stats_lock.denied,
            "active_rules": state.rule_engine.read().await.get_rules().len(),
        });

        let _ = ipc_resp_tx.send((
            "broadcast".to_string(),
            IpcMessage::StatsData { stats: stats_json },
        )).await;
    } else {
        // No rule matched, send prompt to GUI
        let prompt_id = uuid::Uuid::new_v4().to_string();

        state.pending_prompts.write().await.insert(prompt_id.clone(), conn_info.clone());

        let _ = ipc_resp_tx.send((
            "broadcast".to_string(),
            IpcMessage::ConnectionPrompt {
                prompt_id,
                pid: conn_info.pid,
                uid: conn_info.uid,
                executable: conn_info.executable,
                cmdline: conn_info.cmdline,
                dest_ip: conn_info.dest_ip.to_string(),
                dest_port: conn_info.dest_port,
                dest_host: conn_info.dest_host,
                protocol: conn_info.protocol,
            },
        )).await;

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
