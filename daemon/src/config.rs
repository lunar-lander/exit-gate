use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub daemon: DaemonConfig,
    pub notifications: NotificationConfig,
    pub database: DatabaseConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default = "default_socket_path")]
    pub socket_path: String,
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default = "default_bpf_path")]
    pub bpf_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfig {
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default = "default_action")]
    pub default_action: String,
    #[serde(default = "default_monitor_outbound")]
    pub monitor_outbound: bool,
    #[serde(default = "default_monitor_inbound")]
    pub monitor_inbound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub db_path: String,
    #[serde(default = "default_max_history")]
    pub max_history_entries: i64,
}

fn default_socket_path() -> String {
    "/var/run/exit-gate/exit-gate.sock".to_string()
}

fn default_log_level() -> String {
    "warn".to_string()
}

fn default_bpf_path() -> String {
    "/usr/local/lib/exit-gate/bpf".to_string()
}

fn default_timeout() -> u64 {
    30
}

fn default_action() -> String {
    "deny".to_string()
}

fn default_monitor_outbound() -> bool {
    true
}

fn default_monitor_inbound() -> bool {
    false
}

fn default_db_path() -> String {
    "/var/lib/exit-gate/rules.db".to_string()
}

fn default_max_history() -> i64 {
    10000
}

impl Default for Config {
    fn default() -> Self {
        Self {
            daemon: DaemonConfig {
                socket_path: default_socket_path(),
                log_level: default_log_level(),
                bpf_path: default_bpf_path(),
            },
            notifications: NotificationConfig {
                timeout_seconds: default_timeout(),
                default_action: default_action(),
                monitor_outbound: default_monitor_outbound(),
                monitor_inbound: default_monitor_inbound(),
            },
            database: DatabaseConfig {
                db_path: default_db_path(),
                max_history_entries: default_max_history(),
            },
        }
    }
}

impl Config {
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let contents = fs::read_to_string(path).context("Failed to read configuration file")?;
        let config: Config =
            toml::from_str(&contents).context("Failed to parse configuration file")?;
        Ok(config)
    }

    pub fn load_or_default(path: Option<&str>) -> Result<Self> {
        if let Some(path) = path {
            if Path::new(path).exists() {
                return Self::load_from_file(path);
            }
        }

        // Try default paths
        for default_path in ["/etc/exit-gate/config.toml", "./config.toml"] {
            if Path::new(default_path).exists() {
                return Self::load_from_file(default_path);
            }
        }

        // Return default config
        Ok(Config::default())
    }

    #[allow(dead_code)]
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let contents = toml::to_string_pretty(self).context("Failed to serialize configuration")?;
        fs::write(path, contents).context("Failed to write configuration file")?;
        Ok(())
    }
}
