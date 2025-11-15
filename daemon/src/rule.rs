use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use ipnetwork::IpNetwork;
use regex::Regex;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Duration {
    Once,
    Process,
    Forever,
    UntilRestart,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: Option<i64>,
    pub name: String,
    pub enabled: bool,
    pub action: Action,
    pub duration: Duration,
    pub priority: i32,
    pub criteria: RuleCriteria,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub hit_count: i64,
    pub last_hit: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleCriteria {
    pub executable: Option<String>,
    pub executable_regex: Option<String>,
    pub cmdline: Option<String>,
    pub dest_ip: Option<String>,
    pub dest_network: Option<String>,
    pub dest_port: Option<u16>,
    pub dest_port_range: Option<(u16, u16)>,
    pub dest_host: Option<String>,
    pub dest_host_regex: Option<String>,
    pub protocol: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
    pub executable: String,
    pub cmdline: String,
    pub dest_ip: IpAddr,
    pub dest_port: u16,
    pub dest_host: Option<String>,
    pub protocol: String,
    pub process_start_time: u64,
}

impl Rule {
    pub fn new(name: String, action: Action, duration: Duration, criteria: RuleCriteria) -> Self {
        let now = Utc::now();
        Self {
            id: None,
            name,
            enabled: true,
            action,
            duration,
            priority: 0,
            criteria,
            created_at: now,
            updated_at: now,
            hit_count: 0,
            last_hit: None,
        }
    }

    pub fn matches(&self, conn: &ConnectionInfo) -> bool {
        if !self.enabled {
            return false;
        }

        // Check executable path
        if let Some(ref exe) = self.criteria.executable {
            if &conn.executable != exe {
                return false;
            }
        }

        // Check executable regex
        if let Some(ref exe_regex) = self.criteria.executable_regex {
            if let Ok(regex) = Regex::new(exe_regex) {
                if !regex.is_match(&conn.executable) {
                    return false;
                }
            }
        }

        // Check cmdline
        if let Some(ref cmdline) = self.criteria.cmdline {
            if !conn.cmdline.contains(cmdline) {
                return false;
            }
        }

        // Check destination IP
        if let Some(ref dest_ip) = self.criteria.dest_ip {
            if let Ok(ip) = dest_ip.parse::<IpAddr>() {
                if conn.dest_ip != ip {
                    return false;
                }
            }
        }

        // Check destination network
        if let Some(ref dest_network) = self.criteria.dest_network {
            if let Ok(network) = dest_network.parse::<IpNetwork>() {
                if !network.contains(conn.dest_ip) {
                    return false;
                }
            }
        }

        // Check destination port
        if let Some(port) = self.criteria.dest_port {
            if conn.dest_port != port {
                return false;
            }
        }

        // Check destination port range
        if let Some((min_port, max_port)) = self.criteria.dest_port_range {
            if conn.dest_port < min_port || conn.dest_port > max_port {
                return false;
            }
        }

        // Check destination host
        if let Some(ref dest_host) = self.criteria.dest_host {
            if let Some(ref conn_host) = conn.dest_host {
                if conn_host != dest_host {
                    return false;
                }
            } else {
                return false;
            }
        }

        // Check destination host regex
        if let Some(ref host_regex) = self.criteria.dest_host_regex {
            if let Some(ref conn_host) = conn.dest_host {
                if let Ok(regex) = Regex::new(host_regex) {
                    if !regex.is_match(conn_host) {
                        return false;
                    }
                }
            } else {
                return false;
            }
        }

        // Check protocol
        if let Some(ref protocol) = self.criteria.protocol {
            if &conn.protocol != protocol {
                return false;
            }
        }

        // Check UID
        if let Some(uid) = self.criteria.uid {
            if conn.uid != uid {
                return false;
            }
        }

        // Check GID
        if let Some(gid) = self.criteria.gid {
            if conn.gid != gid {
                return false;
            }
        }

        true
    }
}

pub struct RuleEngine {
    rules: Vec<Rule>,
    process_rules: std::collections::HashMap<u32, Vec<Rule>>,
}

impl RuleEngine {
    pub fn new() -> Self {
        Self {
            rules: Vec::new(),
            process_rules: std::collections::HashMap::new(),
        }
    }

    pub fn add_rule(&mut self, rule: Rule) {
        self.rules.push(rule);
        self.sort_rules();
    }

    pub fn remove_rule(&mut self, rule_id: i64) {
        self.rules.retain(|r| r.id != Some(rule_id));
    }

    pub fn update_rule(&mut self, rule: Rule) {
        if let Some(pos) = self.rules.iter().position(|r| r.id == rule.id) {
            self.rules[pos] = rule;
            self.sort_rules();
        }
    }

    pub fn get_rules(&self) -> &[Rule] {
        &self.rules
    }

    fn sort_rules(&mut self) {
        self.rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    pub fn evaluate(&mut self, conn: &ConnectionInfo) -> Option<Action> {
        // First check process-specific rules
        if let Some(proc_rules) = self.process_rules.get(&conn.pid) {
            for rule in proc_rules {
                if rule.matches(conn) {
                    return Some(rule.action.clone());
                }
            }
        }

        // Then check global rules
        for rule in &mut self.rules {
            if rule.matches(conn) {
                // Update hit count
                rule.hit_count += 1;
                rule.last_hit = Some(Utc::now());

                // If it's a "once" rule, disable it after first match
                if rule.duration == Duration::Once {
                    rule.enabled = false;
                }

                return Some(rule.action.clone());
            }
        }

        None
    }

    pub fn add_process_rule(&mut self, pid: u32, rule: Rule) {
        self.process_rules.entry(pid).or_insert_with(Vec::new).push(rule);
    }

    pub fn remove_process_rules(&mut self, pid: u32) {
        self.process_rules.remove(&pid);
    }

    pub fn clear_temp_rules(&mut self) {
        self.process_rules.clear();
        self.rules.retain(|r| r.duration == Duration::Forever);
    }
}

impl Default for RuleEngine {
    fn default() -> Self {
        Self::new()
    }
}
