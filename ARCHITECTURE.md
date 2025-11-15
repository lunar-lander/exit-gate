# Exit Gate Architecture

This document provides a technical deep-dive into the architecture and implementation of Exit Gate.

## Overview

Exit Gate is a Linux application firewall that monitors network connections at the kernel level using eBPF (extended Berkeley Packet Filter) and provides a user-friendly Electron-based GUI for managing firewall rules.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Space                               │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Electron GUI (React + TypeScript)            │ │
│  │  - Connection Prompts                                     │ │
│  │  - Rule Management                                        │ │
│  │  - Statistics Dashboard                                   │ │
│  │  - Connection History                                     │ │
│  └─────────────────┬─────────────────────────────────────────┘ │
│                    │ Unix Socket IPC                           │
│  ┌─────────────────▼─────────────────────────────────────────┐ │
│  │              Rust Daemon                                  │ │
│  │  ┌──────────────────┐  ┌──────────────┐  ┌─────────────┐ │ │
│  │  │  Rule Engine     │  │  IPC Server  │  │  Process    │ │ │
│  │  │  - Match rules   │  │  - Unix sock │  │  Info       │ │ │
│  │  │  - Priority      │  │  - Messages  │  │  - /proc    │ │ │
│  │  └──────────────────┘  └──────────────┘  └─────────────┘ │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐  │ │
│  │  │  SQLite DB       │  │  eBPF Manager                │  │ │
│  │  │  - Rules         │  │  - Load programs             │  │ │
│  │  │  - History       │  │  - Read ring buffer          │  │ │
│  │  └──────────────────┘  └──────────────┬───────────────┘  │ │
│  └───────────────────────────────────────┼──────────────────┘ │
│                                           │ libbpf-rs          │
└───────────────────────────────────────────┼────────────────────┘
                                            │
┌───────────────────────────────────────────▼────────────────────┐
│                        Kernel Space                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              eBPF Programs (C)                          │  │
│  │  - kprobe/tcp_connect    - Track TCP connections       │  │
│  │  - kprobe/udp_sendmsg    - Track UDP packets           │  │
│  │  - kprobe/inet_csk_accept - Track incoming connections │  │
│  │                                                         │  │
│  │  Maps:                                                  │  │
│  │  - Ring Buffer: Send events to userspace               │  │
│  │  - Hash Map: Store verdicts                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Linux Kernel                               │  │
│  │  - Network Stack                                        │  │
│  │  - Socket Layer                                         │  │
│  │  - TCP/IP Implementation                                │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Deep-Dive

### 1. eBPF Programs

**File:** `ebpf/network_monitor.bpf.c`

The eBPF component is responsible for monitoring network activity at the kernel level. It consists of several kprobes that attach to kernel functions:

#### Key Functions

1. **tcp_connect** - Monitors outbound TCP connections
   - Captures: PID, UID, source/dest IP, ports
   - Triggered when a process initiates a TCP connection

2. **udp_sendmsg** - Monitors UDP traffic
   - Captures: PID, UID, source/dest IP, ports
   - Triggered when a process sends UDP packets

3. **inet_csk_accept** - Monitors inbound TCP connections
   - Captures: Connection details for server applications
   - Useful for monitoring listening services

#### eBPF Maps

- **Ring Buffer** (`events`): 256KB circular buffer for sending connection events to userspace
- **Hash Map** (`verdicts`): Stores allow/deny decisions keyed by connection tuple
- **Hash Map** (`process_cache`): Caches process information to reduce overhead

#### Event Structure

```c
struct connection_event {
    u32 pid, tid, uid, gid;
    u8 event_type, protocol;
    u16 family, sport, dport;
    union { u32 saddr_v4; u8 saddr_v6[16]; };
    union { u32 daddr_v4; u8 daddr_v6[16]; };
    char comm[16];
    u64 timestamp;
};
```

### 2. Rust Daemon

**Directory:** `daemon/src/`

The daemon is the core of Exit Gate, written in Rust for memory safety and performance.

#### Modules

##### main.rs
- Entry point and orchestration
- Initializes all components
- Handles graceful shutdown
- Coordinates between eBPF, IPC, and rule engine

##### bpf.rs (to be implemented)
- Loads eBPF programs using libbpf-rs
- Attaches kprobes to kernel functions
- Polls ring buffer for events
- Manages eBPF map operations

##### rule.rs
- Implements the rule matching engine
- Supports multiple criteria types:
  - Executable path (exact or regex)
  - Command line arguments
  - Destination IP/network
  - Destination port/range
  - Hostname (exact or regex)
  - Protocol (TCP/UDP)
  - UID/GID
- Priority-based rule evaluation
- Temporal rules (once, process lifetime, forever)

##### db.rs
- SQLite database interface using sqlx
- Stores permanent rules
- Maintains connection history
- Automatic cleanup of old entries
- Async operations with connection pooling

##### ipc.rs
- Unix socket server for GUI communication
- JSON-based message protocol
- Bidirectional communication:
  - Daemon → GUI: Connection prompts, events, stats
  - GUI → Daemon: Rule operations, prompt responses
- Multiple client support

##### process.rs
- Reads process information from /proc
- Extracts executable path, command line, UID/GID
- Resolves process tree
- Calculates executable checksums

#### Rule Matching Algorithm

```
1. Check process-specific rules (Duration::Process)
2. Check temporary rules (Duration::Once, Duration::UntilRestart)
3. Check permanent rules (Duration::Forever)
4. Within each category, sort by priority (higher first)
5. Return first matching rule's action
6. If no match, prompt user
```

#### Database Schema

**Rules Table:**
```sql
CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER,
    action TEXT,  -- "allow" or "deny"
    duration TEXT,  -- "once", "process", "forever", "untilrestart"
    priority INTEGER,
    created_at TEXT,
    updated_at TEXT,
    hit_count INTEGER,
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
);
```

**Connection History Table:**
```sql
CREATE TABLE connection_history (
    id INTEGER PRIMARY KEY,
    timestamp TEXT,
    pid INTEGER,
    uid INTEGER,
    gid INTEGER,
    executable TEXT,
    cmdline TEXT,
    dest_ip TEXT,
    dest_port INTEGER,
    dest_host TEXT,
    protocol TEXT,
    action TEXT,
    rule_id INTEGER REFERENCES rules(id)
);
```

### 3. Electron GUI

**Directory:** `electron/src/`

Modern Electron application with React and Material-UI.

#### Architecture

```
main.ts (Main Process)
  ├─ Creates BrowserWindow
  ├─ Connects to daemon via Unix socket
  ├─ Forwards messages between renderer and daemon
  └─ Shows native notifications

preload.ts (Preload Script)
  ├─ Exposes safe IPC APIs to renderer
  └─ Implements security boundary

App.tsx (Renderer Process)
  ├─ Dashboard: Statistics and recent activity
  ├─ RulesManager: CRUD operations for rules
  ├─ ConnectionHistory: Searchable history table
  └─ ConnectionPrompt: Modal dialogs for decisions
```

#### IPC Message Protocol

All messages are JSON objects with a `type` field:

**Client → Daemon:**
```json
{"type": "GetRules"}
{"type": "AddRule", "rule": {...}}
{"type": "UpdateRule", "rule": {...}}
{"type": "DeleteRule", "rule_id": 123}
{"type": "GetHistory", "limit": 100}
{"type": "GetStats"}
{"type": "RespondToPrompt", "prompt_id": "uuid", "action": "allow", "remember": true, "duration": "forever"}
```

**Daemon → Client:**
```json
{"type": "RulesList", "rules": [...]}
{"type": "HistoryData", "entries": [...]}
{"type": "StatsData", "stats": {...}}
{"type": "ConnectionPrompt", "prompt_id": "uuid", "pid": 1234, "executable": "/usr/bin/curl", ...}
{"type": "ConnectionEvent", "timestamp": "...", "pid": 1234, "action": "allow", ...}
{"type": "Success", "message": "..."}
{"type": "Error", "message": "..."}
```

### 4. Communication Flow

#### Connection Prompt Flow

```
1. Application makes network connection
   ↓
2. Kernel calls tcp_connect() or udp_sendmsg()
   ↓
3. eBPF program captures event
   ↓
4. Event sent to userspace via ring buffer
   ↓
5. Daemon reads event from ring buffer
   ↓
6. Daemon checks rule engine
   ↓
7a. Match found → Apply action, log to DB
7b. No match → Send ConnectionPrompt to GUI
   ↓
8. User makes decision in GUI
   ↓
9. GUI sends RespondToPrompt to daemon
   ↓
10. Daemon applies action, optionally creates rule
   ↓
11. Daemon logs to connection history
```

## Security Model

### Privilege Separation

- **Daemon**: Runs as root (required for eBPF)
- **GUI**: Runs as regular user
- **Communication**: Unix socket with file permissions

### eBPF Safety

- Programs verified by kernel verifier
- No direct memory access outside eBPF context
- Bounded loops and stack usage
- Cannot crash the kernel

### Capabilities

The daemon requires:
- `CAP_BPF`: Load eBPF programs
- `CAP_PERFMON`: Access performance monitoring
- `CAP_NET_ADMIN`: Network administration
- `CAP_SYS_ADMIN`: System administration (for older kernels)

## Performance Considerations

### eBPF Overhead

- Minimal per-connection overhead (~1-2 µs)
- Ring buffer reduces context switches
- Map lookups are O(1)
- No packet inspection, only metadata

### Daemon Efficiency

- Async I/O with Tokio
- Connection pooling for database
- Lazy evaluation of rules
- Caching of process information

### GUI Performance

- Virtual scrolling for large lists
- Debounced search
- Pagination for history
- React memoization for expensive renders

## Future Enhancements

### Planned Features

1. **Complete eBPF Integration**: Full libbpf-rs implementation
2. **IPv6 Support**: Extend monitoring to IPv6 connections
3. **DNS Resolution**: Resolve IPs to hostnames
4. **Application Groups**: Group rules by application type
5. **GeoIP Filtering**: Block/allow by country
6. **Import/Export**: Backup and restore rules
7. **Rule Templates**: Pre-defined rule sets
8. **Network Timeline**: Visual connection timeline

### Performance Optimizations

1. **BPF CO-RE**: Portable eBPF programs
2. **Ring Buffer Batching**: Process multiple events at once
3. **Rule Compilation**: Compile rules to eBPF for kernel-side filtering
4. **Bloom Filters**: Fast negative lookups for rules

## Troubleshooting

### Common Issues

1. **eBPF program fails to load**
   - Check kernel version (5.8+)
   - Verify CONFIG_BPF=y in kernel config
   - Check for BTF support

2. **Permission denied on socket**
   - Verify socket permissions
   - Check daemon is running as root

3. **High CPU usage**
   - May indicate too many connection attempts
   - Consider creating broader rules
   - Check for connection loops

### Debug Mode

```bash
# Enable debug logging
sudo RUST_LOG=debug /usr/local/bin/exit-gate-daemon

# View eBPF program logs
sudo bpftool prog tracelog
```

## References

- [eBPF Documentation](https://ebpf.io/)
- [libbpf-rs](https://github.com/libbpf/libbpf-rs)
- [BPF CO-RE](https://nakryiko.com/posts/bpf-portability-and-co-re/)
- [Linux Kernel Networking](https://www.kernel.org/doc/html/latest/networking/)
