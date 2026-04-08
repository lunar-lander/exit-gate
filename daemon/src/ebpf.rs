use anyhow::{Context, Result};
use libbpf_rs::{Link, ObjectBuilder, RingBufferBuilder};
use std::path::Path;
use tokio::sync::mpsc;
use tracing::{debug, info, trace, warn};

// Event types from eBPF program
const EVENT_TCP_CONNECT: u8 = 1;
const EVENT_UDP_SEND: u8 = 2;
const EVENT_TCP_ACCEPT: u8 = 3;

// Address families
const AF_INET: u16 = 2;

// Protocols
pub const IPPROTO_TCP: u8 = 6;
pub const IPPROTO_UDP: u8 = 17;

/// Connection event structure matching the eBPF program's structure
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ConnectionEvent {
    pub pid: u32,
    pub tid: u32,
    pub uid: u32,
    pub gid: u32,
    pub event_type: u8,
    pub protocol: u8,
    pub family: u16,
    pub sport: u16,
    pub dport: u16,
    pub saddr: [u8; 16], // Can hold both IPv4 (first 4 bytes) and IPv6
    pub daddr: [u8; 16],
    pub comm: [u8; 16],
    pub timestamp: u64,
}

// Ensure the struct has the same layout as the C struct
unsafe impl plain::Plain for ConnectionEvent {}

impl ConnectionEvent {
    /// Get the destination IP address as a string
    pub fn dest_ip_string(&self) -> String {
        if self.family == AF_INET {
            format!(
                "{}.{}.{}.{}",
                self.daddr[0], self.daddr[1], self.daddr[2], self.daddr[3]
            )
        } else {
            format_ipv6(&self.daddr)
        }
    }

    /// Get the process name
    pub fn comm_string(&self) -> String {
        let end = self.comm.iter().position(|&c| c == 0).unwrap_or(16);
        String::from_utf8_lossy(&self.comm[..end]).to_string()
    }

    /// Get the protocol name
    pub fn protocol_string(&self) -> String {
        match self.protocol {
            IPPROTO_TCP => "TCP".to_string(),
            IPPROTO_UDP => "UDP".to_string(),
            _ => format!("Unknown({})", self.protocol),
        }
    }

    /// Get the event type name
    pub fn event_type_string(&self) -> String {
        match self.event_type {
            EVENT_TCP_CONNECT => "TCP Connect".to_string(),
            EVENT_UDP_SEND => "UDP Send".to_string(),
            EVENT_TCP_ACCEPT => "TCP Accept".to_string(),
            _ => format!("Unknown({})", self.event_type),
        }
    }
}

fn format_ipv6(addr: &[u8; 16]) -> String {
    let groups: Vec<String> = addr
        .chunks(2)
        .map(|chunk| format!("{:02x}{:02x}", chunk[0], chunk[1]))
        .collect();
    groups.join(":")
}

/// Parse raw bytes into a ConnectionEvent
pub fn parse_event(data: &[u8]) -> Option<ConnectionEvent> {
    if data.len() < std::mem::size_of::<ConnectionEvent>() {
        warn!("Event data too small: {} bytes", data.len());
        return None;
    }

    let mut event = ConnectionEvent {
        pid: 0,
        tid: 0,
        uid: 0,
        gid: 0,
        event_type: 0,
        protocol: 0,
        family: 0,
        sport: 0,
        dport: 0,
        saddr: [0; 16],
        daddr: [0; 16],
        comm: [0; 16],
        timestamp: 0,
    };

    // Use plain crate for safe casting
    if let Err(e) = plain::copy_from_bytes(&mut event, data) {
        warn!("Failed to parse event: {:?}", e);
        return None;
    }

    Some(event)
}

/// Start the eBPF event loop in a background task
pub async fn start_ebpf_monitor(
    bpf_path: String,
    event_tx: mpsc::Sender<ConnectionEvent>,
) -> Result<()> {
    info!("Starting eBPF monitor with BPF path: {}", bpf_path);

    let path = Path::new(&bpf_path);
    if !path.exists() {
        anyhow::bail!("eBPF program not found at {:?}", path);
    }

    // Load eBPF program
    let mut builder = ObjectBuilder::default();
    let open_obj = builder
        .open_file(path)
        .context("Failed to open eBPF object file")?;

    let mut obj = open_obj.load().context("Failed to load eBPF program")?;

    info!("eBPF program loaded");

    // Attach kprobes
    let mut links: Vec<Link> = Vec::new();

    // Primary TCP probe: fires after destination address is written into sk.
    if let Some(prog) = obj.prog_mut("kprobe_tcp_connect") {
        match prog.attach() {
            Ok(link) => {
                info!("Attached kprobe: tcp_connect");
                links.push(link);
            }
            Err(e) => warn!("Failed to attach tcp_connect: {}", e),
        }
    }

    // Fallback IPv4 TCP probe: reads destination directly from userspace sockaddr,
    // independent of sock_common layout. Guards against the primary probe silently
    // failing to capture the destination on unexpected kernel variants.
    if let Some(prog) = obj.prog_mut("kprobe_tcp_v4_connect") {
        match prog.attach() {
            Ok(link) => {
                info!("Attached kprobe: tcp_v4_connect (IPv4 TCP fallback)");
                links.push(link);
            }
            Err(e) => warn!("Failed to attach tcp_v4_connect: {}", e),
        }
    }

    // Fallback IPv6 TCP probe: same rationale as tcp_v4_connect above.
    if let Some(prog) = obj.prog_mut("kprobe_tcp_v6_connect") {
        match prog.attach() {
            Ok(link) => {
                info!("Attached kprobe: tcp_v6_connect (IPv6 TCP fallback)");
                links.push(link);
            }
            Err(e) => warn!("Failed to attach tcp_v6_connect: {}", e),
        }
    }

    if let Some(prog) = obj.prog_mut("kprobe_udp_sendmsg") {
        match prog.attach() {
            Ok(link) => {
                info!("Attached kprobe: udp_sendmsg");
                links.push(link);
            }
            Err(e) => warn!("Failed to attach udp_sendmsg: {}", e),
        }
    }

    if let Some(prog) = obj.prog_mut("kprobe_tcp_accept") {
        match prog.attach() {
            Ok(link) => {
                info!("Attached kretprobe: inet_csk_accept");
                links.push(link);
            }
            Err(e) => warn!("Failed to attach tcp_accept: {}", e),
        }
    }

    if links.is_empty() {
        anyhow::bail!("No eBPF programs could be attached. Ensure you are running as root.");
    }

    info!("Attached {} eBPF probes", links.len());

    // Get the events ring buffer map
    let map = obj.map("events").context("Failed to find 'events' map")?;

    // Create ring buffer with callback
    let tx = event_tx.clone();
    let mut rb_builder = RingBufferBuilder::new();

    rb_builder
        .add(&map, move |data: &[u8]| {
            if let Some(event) = parse_event(data) {
                trace!(
                    "eBPF event: {} {} -> {}:{} (PID: {}, {})",
                    event.comm_string(),
                    event.event_type_string(),
                    event.dest_ip_string(),
                    event.dport,
                    event.pid,
                    event.protocol_string()
                );

                // Use try_send to avoid blocking (non-blocking send)
                let tx_clone = tx.clone();
                if let Err(e) = tx_clone.try_send(event) {
                    warn!("Failed to send event (channel full or closed): {}", e);
                }
            }
            0
        })
        .context("Failed to add ring buffer callback")?;

    let rb = rb_builder.build().context("Failed to build ring buffer")?;

    info!("eBPF ring buffer ready, polling for events...");

    // Poll the ring buffer for events
    // Keep links alive
    let _links = links;

    loop {
        // Poll with 100ms timeout
        if let Err(e) = rb.poll(std::time::Duration::from_millis(100)) {
            // Log errors but continue
            debug!("Ring buffer poll error: {}", e);
        }

        // Yield to allow other tasks to run
        tokio::task::yield_now().await;
    }
}
