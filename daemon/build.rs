fn main() {
    // eBPF programs are built separately via ebpf/Makefile
    // This build script just ensures we rebuild if BPF sources change
    println!("cargo:rerun-if-changed=../ebpf/network_monitor.bpf.c");
    println!("cargo:rerun-if-changed=../ebpf/network_monitor.bpf.o");
    println!("cargo:rerun-if-changed=build.rs");
}
