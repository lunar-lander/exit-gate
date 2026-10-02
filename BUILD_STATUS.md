# Build Status

## All components build and package cleanly (v0.2.0)

| Component | Status | Artifact |
|-----------|--------|----------|
| eBPF monitor | ✅ | `ebpf/network_monitor.bpf.o` |
| Rust daemon | ✅ | `daemon/target/release/exit-gate-daemon` |
| Electron GUI | ✅ | `electron/dist/` |
| AppImage | ✅ | `electron/dist/exit-gate-0.2.0-x86_64.AppImage` |
| Debian package | ✅ | `electron/dist/exit-gate-0.2.0-amd64.deb` |

Static check: `cd electron && npm run typecheck` (TypeScript, renderer + main).

## Packaging model (v0.2.0)

Both packages bundle the daemon, eBPF objects, default config and the
systemd unit under `resources/daemon/`, together with an idempotent
`install-daemon.sh`:

- **deb**: `postinst` runs `install-daemon.sh` automatically — installing the
  package is a complete setup (daemon installed to `/usr/local/bin`, eBPF to
  `/usr/local/lib/exit-gate/bpf`, service enabled and started).
- **AppImage**: portable. On first run, if the daemon is unreachable, the GUI
  offers to run `install-daemon.sh` via `pkexec` and connects automatically
  once the service is up.

The daemon keeps running (IPC up, eBPF error logged) even when the eBPF
monitor cannot load, so a bad kernel/permission combo never crash-loops the
service.

## Verified

- asar contains `dist/**` including `logo.png` (toolbar logo renders in packaged apps)
- deb control archive contains `postinst` / `prerm` / `postrm`
- deb payload: `/opt/Exit Gate/…` + desktop entry + hicolor icon
- packaged GUI launches and reconnects cleanly when the daemon is absent
- `install-daemon.sh` and maintainer scripts pass `bash -n`
