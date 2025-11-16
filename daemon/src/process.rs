use std::fs;
use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use procfs::process::Process;

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub executable: String,
    pub cmdline: String,
    pub uid: u32,
    pub gid: u32,
    pub parent_pid: Option<i32>,
    pub start_time: u64,
}

impl ProcessInfo {
    pub fn from_pid(pid: u32) -> Result<Self> {
        let process = Process::new(pid as i32)
            .context("Failed to open process")?;

        let exe = process.exe()
            .context("Failed to read executable path")?
            .to_string_lossy()
            .to_string();

        let cmdline = process.cmdline()
            .context("Failed to read cmdline")?
            .join(" ");

        let stat = process.stat()
            .context("Failed to read process stat")?;

        let status = process.status()
            .context("Failed to read process status")?;

        let uid = status.ruid;
        let gid = status.rgid;

        Ok(Self {
            pid,
            executable: exe,
            cmdline,
            uid,
            gid,
            parent_pid: Some(stat.ppid),
            start_time: stat.starttime,
        })
    }

    pub fn get_executable_hash(&self) -> Result<String> {
        use std::io::Read;
        let mut file = fs::File::open(&self.executable)?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)?;

        // Calculate SHA256 hash
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(&buffer);
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }
}

pub fn get_process_tree(pid: u32) -> Result<Vec<ProcessInfo>> {
    let mut tree = Vec::new();
    let mut current_pid = Some(pid as i32);

    while let Some(pid) = current_pid {
        if let Ok(info) = ProcessInfo::from_pid(pid as u32) {
            current_pid = info.parent_pid;
            tree.push(info);
        } else {
            break;
        }
    }

    Ok(tree)
}

pub fn find_listening_ports() -> Result<Vec<(u16, u32)>> {
    let tcp = procfs::net::tcp()
        .context("Failed to read TCP connections")?;
    let tcp6 = procfs::net::tcp6()
        .context("Failed to read TCP6 connections")?;

    let mut ports = Vec::new();

    for entry in tcp.into_iter().chain(tcp6.into_iter()) {
        if entry.state == procfs::net::TcpState::Listen {
            let inode = entry.inode;
            if let Ok(pid) = find_pid_by_socket_inode(inode) {
                ports.push((entry.local_address.port(), pid));
            }
        }
    }

    Ok(ports)
}

fn find_pid_by_socket_inode(inode: u64) -> Result<u32> {
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let path = entry.path();

        if let Some(name) = path.file_name() {
            if let Ok(pid) = name.to_string_lossy().parse::<u32>() {
                let fd_path = path.join("fd");
                if let Ok(fds) = fs::read_dir(fd_path) {
                    for fd in fds.filter_map(|e| e.ok()) {
                        if let Ok(link) = fs::read_link(fd.path()) {
                            let link_str = link.to_string_lossy();
                            if link_str.contains(&format!("socket:[{}]", inode)) {
                                return Ok(pid);
                            }
                        }
                    }
                }
            }
        }
    }

    anyhow::bail!("PID not found for socket inode {}", inode)
}
