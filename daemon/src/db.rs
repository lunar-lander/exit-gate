use sqlx::{SqlitePool, sqlite::SqlitePoolOptions, Row};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use crate::rule::{Rule, Action, Duration, RuleCriteria};

pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
        // Create database directory if it doesn't exist
        if let Some(parent) = std::path::Path::new(database_url).parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create database directory")?;
        }

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&format!("sqlite:{}", database_url))
            .await
            .context("Failed to connect to database")?;

        let db = Self { pool };
        db.migrate().await?;
        Ok(db)
    }

    async fn migrate(&self) -> Result<()> {
        // Create rules table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                action TEXT NOT NULL,
                duration TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                hit_count INTEGER NOT NULL DEFAULT 0,
                last_hit TEXT,

                -- Criteria fields
                executable TEXT,
                executable_regex TEXT,
                cmdline TEXT,
                dest_ip TEXT,
                dest_network TEXT,
                dest_port INTEGER,
                dest_port_min INTEGER,
                dest_port_max INTEGER,
                dest_host TEXT,
                dest_host_regex TEXT,
                protocol TEXT,
                uid INTEGER,
                gid INTEGER
            )
            "#
        )
        .execute(&self.pool)
        .await
        .context("Failed to create rules table")?;

        // Create connection history table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS connection_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                pid INTEGER NOT NULL,
                uid INTEGER NOT NULL,
                gid INTEGER NOT NULL,
                executable TEXT NOT NULL,
                cmdline TEXT NOT NULL,
                dest_ip TEXT NOT NULL,
                dest_port INTEGER NOT NULL,
                dest_host TEXT,
                protocol TEXT NOT NULL,
                action TEXT NOT NULL,
                rule_id INTEGER,
                FOREIGN KEY (rule_id) REFERENCES rules(id)
            )
            "#
        )
        .execute(&self.pool)
        .await
        .context("Failed to create connection_history table")?;

        // Create indices
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_history_timestamp ON connection_history(timestamp)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_history_executable ON connection_history(executable)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled)")
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn save_rule(&self, rule: &Rule) -> Result<i64> {
        let action_str = serde_json::to_string(&rule.action)?;
        let duration_str = serde_json::to_string(&rule.duration)?;

        let result = sqlx::query(
            r#"
            INSERT INTO rules (
                name, enabled, action, duration, priority,
                created_at, updated_at, hit_count, last_hit,
                executable, executable_regex, cmdline,
                dest_ip, dest_network, dest_port,
                dest_port_min, dest_port_max,
                dest_host, dest_host_regex, protocol, uid, gid
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            "#
        )
        .bind(&rule.name)
        .bind(rule.enabled as i32)
        .bind(&action_str)
        .bind(&duration_str)
        .bind(rule.priority)
        .bind(rule.created_at.to_rfc3339())
        .bind(rule.updated_at.to_rfc3339())
        .bind(rule.hit_count)
        .bind(rule.last_hit.map(|dt| dt.to_rfc3339()))
        .bind(&rule.criteria.executable)
        .bind(&rule.criteria.executable_regex)
        .bind(&rule.criteria.cmdline)
        .bind(&rule.criteria.dest_ip)
        .bind(&rule.criteria.dest_network)
        .bind(rule.criteria.dest_port.map(|p| p as i32))
        .bind(rule.criteria.dest_port_range.map(|(min, _)| min as i32))
        .bind(rule.criteria.dest_port_range.map(|(_, max)| max as i32))
        .bind(&rule.criteria.dest_host)
        .bind(&rule.criteria.dest_host_regex)
        .bind(&rule.criteria.protocol)
        .bind(rule.criteria.uid.map(|u| u as i32))
        .bind(rule.criteria.gid.map(|g| g as i32))
        .execute(&self.pool)
        .await
        .context("Failed to insert rule")?;

        Ok(result.last_insert_rowid())
    }

    pub async fn update_rule(&self, rule: &Rule) -> Result<()> {
        let action_str = serde_json::to_string(&rule.action)?;
        let duration_str = serde_json::to_string(&rule.duration)?;

        sqlx::query(
            r#"
            UPDATE rules SET
                name = ?, enabled = ?, action = ?, duration = ?, priority = ?,
                updated_at = ?, hit_count = ?, last_hit = ?,
                executable = ?, executable_regex = ?, cmdline = ?,
                dest_ip = ?, dest_network = ?, dest_port = ?,
                dest_port_min = ?, dest_port_max = ?,
                dest_host = ?, dest_host_regex = ?, protocol = ?, uid = ?, gid = ?
            WHERE id = ?
            "#
        )
        .bind(&rule.name)
        .bind(rule.enabled as i32)
        .bind(&action_str)
        .bind(&duration_str)
        .bind(rule.priority)
        .bind(rule.updated_at.to_rfc3339())
        .bind(rule.hit_count)
        .bind(rule.last_hit.map(|dt| dt.to_rfc3339()))
        .bind(&rule.criteria.executable)
        .bind(&rule.criteria.executable_regex)
        .bind(&rule.criteria.cmdline)
        .bind(&rule.criteria.dest_ip)
        .bind(&rule.criteria.dest_network)
        .bind(rule.criteria.dest_port.map(|p| p as i32))
        .bind(rule.criteria.dest_port_range.map(|(min, _)| min as i32))
        .bind(rule.criteria.dest_port_range.map(|(_, max)| max as i32))
        .bind(&rule.criteria.dest_host)
        .bind(&rule.criteria.dest_host_regex)
        .bind(&rule.criteria.protocol)
        .bind(rule.criteria.uid.map(|u| u as i32))
        .bind(rule.criteria.gid.map(|g| g as i32))
        .bind(rule.id.unwrap())
        .execute(&self.pool)
        .await
        .context("Failed to update rule")?;

        Ok(())
    }

    pub async fn delete_rule(&self, rule_id: i64) -> Result<()> {
        sqlx::query("DELETE FROM rules WHERE id = ?")
            .bind(rule_id)
            .execute(&self.pool)
            .await
            .context("Failed to delete rule")?;
        Ok(())
    }

    pub async fn load_rules(&self) -> Result<Vec<Rule>> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, enabled, action, duration, priority,
                   created_at, updated_at, hit_count, last_hit,
                   executable, executable_regex, cmdline,
                   dest_ip, dest_network, dest_port,
                   dest_port_min, dest_port_max,
                   dest_host, dest_host_regex, protocol, uid, gid
            FROM rules
            ORDER BY priority DESC, id ASC
            "#
        )
        .fetch_all(&self.pool)
        .await
        .context("Failed to load rules")?;

        let mut rules = Vec::new();
        for row in rows {
            let action_str: String = row.get("action");
            let duration_str: String = row.get("duration");

            let action: Action = serde_json::from_str(&action_str)?;
            let duration: Duration = serde_json::from_str(&duration_str)?;

            let dest_port_min: Option<i32> = row.get("dest_port_min");
            let dest_port_max: Option<i32> = row.get("dest_port_max");
            let dest_port_range = match (dest_port_min, dest_port_max) {
                (Some(min), Some(max)) => Some((min as u16, max as u16)),
                _ => None,
            };

            let rule = Rule {
                id: Some(row.get::<i64, _>("id")),
                name: row.get("name"),
                enabled: row.get::<i32, _>("enabled") != 0,
                action,
                duration,
                priority: row.get("priority"),
                created_at: row.get::<String, _>("created_at").parse::<DateTime<Utc>>()?,
                updated_at: row.get::<String, _>("updated_at").parse::<DateTime<Utc>>()?,
                hit_count: row.get("hit_count"),
                last_hit: row.get::<Option<String>, _>("last_hit")
                    .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
                criteria: RuleCriteria {
                    executable: row.get("executable"),
                    executable_regex: row.get("executable_regex"),
                    cmdline: row.get("cmdline"),
                    dest_ip: row.get("dest_ip"),
                    dest_network: row.get("dest_network"),
                    dest_port: row.get::<Option<i32>, _>("dest_port").map(|p| p as u16),
                    dest_port_range,
                    dest_host: row.get("dest_host"),
                    dest_host_regex: row.get("dest_host_regex"),
                    protocol: row.get("protocol"),
                    uid: row.get::<Option<i32>, _>("uid").map(|u| u as u32),
                    gid: row.get::<Option<i32>, _>("gid").map(|g| g as u32),
                },
            };
            rules.push(rule);
        }

        Ok(rules)
    }

    pub async fn save_connection_history(
        &self,
        timestamp: DateTime<Utc>,
        pid: u32,
        uid: u32,
        gid: u32,
        executable: &str,
        cmdline: &str,
        dest_ip: &str,
        dest_port: u16,
        dest_host: Option<&str>,
        protocol: &str,
        action: &Action,
        rule_id: Option<i64>,
    ) -> Result<()> {
        let action_str = serde_json::to_string(action)?;

        sqlx::query(
            r#"
            INSERT INTO connection_history (
                timestamp, pid, uid, gid, executable, cmdline,
                dest_ip, dest_port, dest_host, protocol, action, rule_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(timestamp.to_rfc3339())
        .bind(pid as i32)
        .bind(uid as i32)
        .bind(gid as i32)
        .bind(executable)
        .bind(cmdline)
        .bind(dest_ip)
        .bind(dest_port as i32)
        .bind(dest_host)
        .bind(protocol)
        .bind(&action_str)
        .bind(rule_id)
        .execute(&self.pool)
        .await
        .context("Failed to save connection history")?;

        Ok(())
    }

    pub async fn get_connection_history(&self, limit: i64) -> Result<Vec<serde_json::Value>> {
        let rows = sqlx::query(
            r#"
            SELECT * FROM connection_history
            ORDER BY timestamp DESC
            LIMIT ?
            "#
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .context("Failed to fetch connection history")?;

        let mut history = Vec::new();
        for row in rows {
            let mut entry = serde_json::Map::new();
            entry.insert("id".to_string(), serde_json::json!(row.get::<i64, _>("id")));
            entry.insert("timestamp".to_string(), serde_json::json!(row.get::<String, _>("timestamp")));
            entry.insert("pid".to_string(), serde_json::json!(row.get::<i32, _>("pid")));
            entry.insert("uid".to_string(), serde_json::json!(row.get::<i32, _>("uid")));
            entry.insert("gid".to_string(), serde_json::json!(row.get::<i32, _>("gid")));
            entry.insert("executable".to_string(), serde_json::json!(row.get::<String, _>("executable")));
            entry.insert("cmdline".to_string(), serde_json::json!(row.get::<String, _>("cmdline")));
            entry.insert("dest_ip".to_string(), serde_json::json!(row.get::<String, _>("dest_ip")));
            entry.insert("dest_port".to_string(), serde_json::json!(row.get::<i32, _>("dest_port")));
            entry.insert("dest_host".to_string(), serde_json::json!(row.get::<Option<String>, _>("dest_host")));
            entry.insert("protocol".to_string(), serde_json::json!(row.get::<String, _>("protocol")));
            entry.insert("action".to_string(), serde_json::json!(row.get::<String, _>("action")));
            entry.insert("rule_id".to_string(), serde_json::json!(row.get::<Option<i64>, _>("rule_id")));

            history.push(serde_json::Value::Object(entry));
        }

        Ok(history)
    }

    pub async fn cleanup_old_history(&self, max_entries: i64) -> Result<()> {
        sqlx::query(
            r#"
            DELETE FROM connection_history
            WHERE id NOT IN (
                SELECT id FROM connection_history
                ORDER BY timestamp DESC
                LIMIT ?
            )
            "#
        )
        .bind(max_entries)
        .execute(&self.pool)
        .await
        .context("Failed to cleanup old history")?;

        Ok(())
    }
}
