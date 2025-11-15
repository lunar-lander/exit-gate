use std::env;
use std::path::PathBuf;

fn main() {
    let bpf_source = "../ebpf/network_monitor.bpf.c";

    // Tell cargo to rerun if the BPF source changes
    println!("cargo:rerun-if-changed={}", bpf_source);

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    // Use libbpf-cargo to build the BPF object
    let builder = libbpf_cargo::SkeletonBuilder::new();
    builder
        .source(bpf_source)
        .clang_args("-I/usr/include")
        .build_and_generate(&out_dir.join("network_monitor.skel.rs"))
        .expect("Failed to build BPF skeleton");

    println!("cargo:rerun-if-changed=build.rs");
}
