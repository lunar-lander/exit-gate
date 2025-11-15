# Troubleshooting Guide

Common issues and solutions for Exit Gate.

## Installation Issues

### eBPF Programs Fail to Compile

**Error:** `fatal error: 'bpf/bpf_helpers.h' file not found`

**Solution:**
```bash
# Ubuntu/Debian
sudo apt install libbpf-dev linux-headers-$(uname -r)

# Fedora
sudo dnf install libbpf-devel kernel-devel
```

### Daemon Build Fails

**Error:** `could not find libbpf`

**Solution:**
```bash
# Install libbpf development files
sudo apt install libbpf-dev  # Ubuntu/Debian
sudo dnf install libbpf-devel  # Fedora

# Or build from source
git clone https://github.com/libbpf/libbpf
cd libbpf/src
make
sudo make install
```

### Electron Build Fails

**Error:** `MODULE_NOT_FOUND`

**Solution:**
```bash
cd electron
rm -rf node_modules package-lock.json
npm install
```

## Runtime Issues

### Daemon Won't Start

**Error:** `Permission denied`

**Solution:**
The daemon must run as root:
```bash
sudo systemctl start exit-gate
# or
sudo exit-gate-daemon
```

**Error:** `Failed to load BPF program`

**Check kernel version:**
```bash
uname -r  # Should be 5.8 or higher
```

**Verify BPF is enabled:**
```bash
zgrep CONFIG_BPF /proc/config.gz
# Should show: CONFIG_BPF=y
```

**Check BTF support:**
```bash
ls /sys/kernel/btf/vmlinux
# File should exist
```

### Socket Connection Failed

**Error:** `No such file or directory: /var/run/exit-gate/exit-gate.sock`

**Solutions:**
1. Check daemon is running:
   ```bash
   sudo systemctl status exit-gate
   ```

2. Check socket directory permissions:
   ```bash
   sudo ls -la /var/run/exit-gate/
   ```

3. Manually create directory:
   ```bash
   sudo mkdir -p /var/run/exit-gate
   sudo chmod 755 /var/run/exit-gate
   ```

### GUI Shows "Disconnected from Daemon"

**Solutions:**
1. Verify daemon is running:
   ```bash
   sudo systemctl status exit-gate
   sudo journalctl -u exit-gate -n 50
   ```

2. Check socket permissions:
   ```bash
   ls -l /var/run/exit-gate/exit-gate.sock
   # Should be readable by your user
   ```

3. Restart daemon:
   ```bash
   sudo systemctl restart exit-gate
   ```

### Database Errors

**Error:** `database is locked`

**Solution:**
```bash
# Stop daemon
sudo systemctl stop exit-gate

# Check for stale lock
sudo rm /var/lib/exit-gate/rules.db-shm
sudo rm /var/lib/exit-gate/rules.db-wal

# Restart daemon
sudo systemctl start exit-gate
```

**Error:** `unable to open database file`

**Solution:**
```bash
# Create database directory
sudo mkdir -p /var/lib/exit-gate
sudo chown root:root /var/lib/exit-gate
sudo chmod 755 /var/lib/exit-gate
```

## Performance Issues

### High CPU Usage

**Symptoms:** Daemon using >50% CPU

**Diagnosis:**
```bash
# Check number of events
sudo journalctl -u exit-gate | grep -c "Connection"

# Check active processes making connections
sudo ss -tnp | wc -l
```

**Solutions:**
1. Create broader rules to reduce prompts
2. Use "Allow" rules for trusted applications
3. Disable monitoring for specific processes

### High Memory Usage

**Symptoms:** Daemon using >500MB RAM

**Diagnosis:**
```bash
# Check connection history size
sudo sqlite3 /var/lib/exit-gate/rules.db "SELECT COUNT(*) FROM connection_history;"
```

**Solutions:**
1. Reduce `max_history_entries` in config
2. Run cleanup:
   ```bash
   sudo sqlite3 /var/lib/exit-gate/rules.db "DELETE FROM connection_history WHERE id NOT IN (SELECT id FROM connection_history ORDER BY timestamp DESC LIMIT 1000);"
   ```

### Slow GUI Response

**Solutions:**
1. Reduce history limit in GUI
2. Clear old connection history
3. Optimize database:
   ```bash
   sudo sqlite3 /var/lib/exit-gate/rules.db "VACUUM;"
   ```

## Connection Issues

### Connections Not Being Detected

**Check:**
1. eBPF programs loaded:
   ```bash
   sudo bpftool prog list | grep exit-gate
   ```

2. Kprobes attached:
   ```bash
   sudo bpftool perf list
   ```

3. Daemon logs:
   ```bash
   sudo journalctl -u exit-gate -f
   ```

### False Positives

**Symptoms:** Connection prompts for internal/loopback traffic

**Solution:**
Create rules to allow loopback:
```
Name: Allow Loopback
Action: Allow
Destination Network: 127.0.0.0/8
```

### Missing Prompts

**Symptoms:** Connections happening without prompts

**Check:**
1. Rule is matching automatically:
   ```bash
   # Check rules
   sudo sqlite3 /var/lib/exit-gate/rules.db "SELECT * FROM rules WHERE enabled=1;"
   ```

2. Default action in config:
   ```bash
   grep default_action /etc/exit-gate/config.toml
   ```

## Logging and Debugging

### Enable Debug Logging

**Temporary:**
```bash
sudo RUST_LOG=debug /usr/local/bin/exit-gate-daemon
```

**Permanent:**
Edit `/etc/exit-gate/config.toml`:
```toml
[daemon]
log_level = "debug"
```

Then restart:
```bash
sudo systemctl restart exit-gate
```

### View Logs

**Systemd journal:**
```bash
# Follow logs
sudo journalctl -u exit-gate -f

# Last 100 lines
sudo journalctl -u exit-gate -n 100

# Since boot
sudo journalctl -u exit-gate -b

# Filter by priority
sudo journalctl -u exit-gate -p err
```

### Check eBPF Programs

**List loaded programs:**
```bash
sudo bpftool prog list
sudo bpftool prog show
```

**View program details:**
```bash
sudo bpftool prog show id <ID> --pretty
```

**View maps:**
```bash
sudo bpftool map list
sudo bpftool map dump id <ID>
```

### Debug eBPF Programs

**Trace log output:**
```bash
sudo cat /sys/kernel/debug/tracing/trace_pipe
```

**Monitor events:**
```bash
sudo bpftool prog tracelog
```

## Configuration Issues

### Invalid Configuration

**Error:** `Failed to parse configuration file`

**Solution:**
Validate TOML syntax:
```bash
# Check for syntax errors
python3 -c "import toml; toml.load('/etc/exit-gate/config.toml')"
```

### Reset to Defaults

```bash
# Backup current config
sudo cp /etc/exit-gate/config.toml /etc/exit-gate/config.toml.backup

# Copy default config
sudo cp config/config.toml /etc/exit-gate/

# Restart daemon
sudo systemctl restart exit-gate
```

## Uninstall Issues

### Clean Removal

If uninstall script fails:
```bash
# Stop service
sudo systemctl stop exit-gate
sudo systemctl disable exit-gate

# Remove files manually
sudo rm /usr/local/bin/exit-gate-daemon
sudo rm -rf /usr/local/lib/exit-gate
sudo rm /etc/systemd/system/exit-gate.service
sudo systemctl daemon-reload

# Optional: Remove data
sudo rm -rf /etc/exit-gate
sudo rm -rf /var/lib/exit-gate
sudo rm -rf /var/run/exit-gate
```

## Getting Help

If you're still experiencing issues:

1. **Check GitHub Issues:** https://github.com/exit-gate/exit-gate/issues
2. **Gather diagnostic information:**
   ```bash
   # System info
   uname -a

   # Kernel config
   zgrep CONFIG_BPF /proc/config.gz

   # Daemon logs
   sudo journalctl -u exit-gate -n 100 > daemon-logs.txt

   # Loaded eBPF programs
   sudo bpftool prog list > bpf-progs.txt
   ```

3. **Create a new issue** with:
   - Your system information
   - Complete error messages
   - Steps to reproduce
   - Diagnostic information

## Common Questions

**Q: Do I need to disable other firewalls?**
A: No, Exit Gate works alongside iptables/nftables.

**Q: Will it work on older kernels?**
A: Minimum kernel version is 5.8. Some features may require newer kernels.

**Q: Can I run it without root?**
A: No, root is required for eBPF programs.

**Q: Does it work in containers?**
A: Not currently. It monitors the host system.

**Q: Will it slow down my network?**
A: Minimal overhead (~1-2µs per connection). No packet inspection.
