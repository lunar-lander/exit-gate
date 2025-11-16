#include <linux/bpf.h>
#include <linux/types.h>
#include <linux/ptrace.h>

/* BPF helper function declarations */
static void *(*bpf_map_lookup_elem)(void *map, const void *key) = (void *) 1;
static long (*bpf_map_update_elem)(void *map, const void *key, const void *value, __u64 flags) = (void *) 2;
static long (*bpf_probe_read_kernel)(void *dst, __u32 size, const void *unsafe_ptr) = (void *) 113;
static __u64 (*bpf_ktime_get_ns)(void) = (void *) 5;
static long (*bpf_get_current_comm)(void *buf, __u32 size_of_buf) = (void *) 16;
static __u64 (*bpf_get_current_pid_tgid)(void) = (void *) 14;
static __u64 (*bpf_get_current_uid_gid)(void) = (void *) 15;
static void *(*bpf_ringbuf_reserve)(void *ringbuf, __u64 size, __u64 flags) = (void *) 131;
static void (*bpf_ringbuf_submit)(void *data, __u64 flags) = (void *) 132;

/* License */
char _license[] __attribute__((section("license"), used)) = "GPL";

/* Helper macros */
#define SEC(name) __attribute__((section(name), used))
#define __uint(name, val) int(*name)[val]
#define __type(name, val) typeof(val) *name

/* Architecture-specific register access */
#if defined(__x86_64__)
#define PT_REGS_PARM1(x) ((x)->rdi)
#define PT_REGS_PARM2(x) ((x)->rsi)
#define PT_REGS_PARM3(x) ((x)->rdx)
#define PT_REGS_RC(x) ((x)->rax)
#elif defined(__aarch64__)
#define PT_REGS_PARM1(x) ((x)->regs[0])
#define PT_REGS_PARM2(x) ((x)->regs[1])
#define PT_REGS_PARM3(x) ((x)->regs[2])
#define PT_REGS_RC(x) ((x)->regs[0])
#endif

/* Byte order helpers */
#define bpf_ntohs(x) __builtin_bswap16(x)
#define bpf_ntohl(x) __builtin_bswap32(x)

/* Type definitions */
typedef __u16 __be16;
typedef __u32 __be32;

struct in_addr {
    __be32 s_addr;
};

struct in6_addr {
    union {
        __u8 u6_addr8[16];
        __be32 u6_addr32[4];
    } in6_u;
};

/* Minimal sock structure for eBPF */
struct sock_common {
    union {
        struct {
            __be32 skc_daddr;
            __be32 skc_rcv_saddr;
        };
    };
    union {
        struct {
            __be16 skc_dport;
            __u16 skc_num;
        };
    };
    short unsigned int skc_family;
    struct in6_addr skc_v6_daddr;
    struct in6_addr skc_v6_rcv_saddr;
};

struct sock {
    struct sock_common __sk_common;
};

struct msghdr {
    void *msg_name;
    int msg_namelen;
};

struct sockaddr_in {
    __be16 sin_port;
    struct in_addr sin_addr;
};

struct sockaddr_in6 {
    __be16 sin6_port;
    struct in6_addr sin6_addr;
};

/* Constants */
#define AF_INET 2
#define AF_INET6 10
#define IPPROTO_TCP 6
#define IPPROTO_UDP 17
#define MAX_ENTRIES 10240

/* Event types */
#define EVENT_TCP_CONNECT 1
#define EVENT_UDP_SEND 2
#define EVENT_TCP_ACCEPT 3

/* Connection verdict */
#define VERDICT_PENDING 0
#define VERDICT_ALLOW 1
#define VERDICT_DENY 2

/* Connection event structure */
struct connection_event {
    __u32 pid;
    __u32 tid;
    __u32 uid;
    __u32 gid;
    __u8 event_type;
    __u8 protocol;
    __u16 family;
    __u16 sport;
    __u16 dport;
    union {
        __u32 saddr_v4;
        __u8 saddr_v6[16];
    };
    union {
        __u32 daddr_v4;
        __u8 daddr_v6[16];
    };
    char comm[16];
    __u64 timestamp;
};

/* Connection key for tracking */
struct conn_key {
    __u32 pid;
    __u32 saddr;
    __u32 daddr;
    __u16 sport;
    __u16 dport;
    __u8 protocol;
};

/* Connection verdict entry */
struct conn_verdict {
    __u8 verdict;
    __u64 timestamp;
};

/* BPF Maps */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, MAX_ENTRIES);
    __type(key, struct conn_key);
    __type(value, struct conn_verdict);
} verdicts SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);
    __type(value, __u64);
} process_cache SEC(".maps");

/* kprobe for tcp_connect */
SEC("kprobe/tcp_connect")
int kprobe_tcp_connect(struct pt_regs *ctx)
{
    struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 uid_gid = bpf_get_current_uid_gid();

    /* Reserve space in ring buffer */
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    /* Fill in process information */
    event->pid = pid;
    event->tid = (__u32)pid_tgid;
    event->uid = (__u32)uid_gid;
    event->gid = uid_gid >> 32;
    event->event_type = EVENT_TCP_CONNECT;
    event->protocol = IPPROTO_TCP;
    event->timestamp = bpf_ktime_get_ns();

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    /* Read socket information */
    __u16 family;
    bpf_probe_read_kernel(&family, sizeof(family), &sk->__sk_common.skc_family);
    event->family = family;

    if (family == AF_INET) {
        bpf_probe_read_kernel(&event->saddr_v4, sizeof(event->saddr_v4),
                             &sk->__sk_common.skc_rcv_saddr);
        bpf_probe_read_kernel(&event->daddr_v4, sizeof(event->daddr_v4),
                             &sk->__sk_common.skc_daddr);
        bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                             &sk->__sk_common.skc_num);
        bpf_probe_read_kernel(&event->dport, sizeof(event->dport),
                             &sk->__sk_common.skc_dport);
        event->dport = bpf_ntohs(event->dport);
    } else if (family == AF_INET6) {
        bpf_probe_read_kernel(&event->saddr_v6, sizeof(event->saddr_v6),
                             &sk->__sk_common.skc_v6_rcv_saddr);
        bpf_probe_read_kernel(&event->daddr_v6, sizeof(event->daddr_v6),
                             &sk->__sk_common.skc_v6_daddr);
        bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                             &sk->__sk_common.skc_num);
        bpf_probe_read_kernel(&event->dport, sizeof(event->dport),
                             &sk->__sk_common.skc_dport);
        event->dport = bpf_ntohs(event->dport);
    }

    /* Submit event to user space */
    bpf_ringbuf_submit(event, 0);

    return 0;
}

/* kprobe for udp_sendmsg */
SEC("kprobe/udp_sendmsg")
int kprobe_udp_sendmsg(struct pt_regs *ctx)
{
    struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
    struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 uid_gid = bpf_get_current_uid_gid();

    /* Reserve space in ring buffer */
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    /* Fill in process information */
    event->pid = pid;
    event->tid = (__u32)pid_tgid;
    event->uid = (__u32)uid_gid;
    event->gid = uid_gid >> 32;
    event->event_type = EVENT_UDP_SEND;
    event->protocol = IPPROTO_UDP;
    event->timestamp = bpf_ktime_get_ns();

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    /* Read socket information */
    __u16 family;
    bpf_probe_read_kernel(&family, sizeof(family), &sk->__sk_common.skc_family);
    event->family = family;

    if (family == AF_INET) {
        bpf_probe_read_kernel(&event->saddr_v4, sizeof(event->saddr_v4),
                             &sk->__sk_common.skc_rcv_saddr);

        /* For UDP, read destination from msghdr */
        struct sockaddr_in *addr;
        bpf_probe_read_kernel(&addr, sizeof(addr), &msg->msg_name);
        if (addr) {
            __u32 daddr;
            __u16 dport;
            bpf_probe_read_kernel(&daddr, sizeof(daddr), &addr->sin_addr.s_addr);
            bpf_probe_read_kernel(&dport, sizeof(dport), &addr->sin_port);
            event->daddr_v4 = daddr;
            event->dport = bpf_ntohs(dport);
        }

        bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                             &sk->__sk_common.skc_num);
    } else if (family == AF_INET6) {
        bpf_probe_read_kernel(&event->saddr_v6, sizeof(event->saddr_v6),
                             &sk->__sk_common.skc_v6_rcv_saddr);

        struct sockaddr_in6 *addr6;
        bpf_probe_read_kernel(&addr6, sizeof(addr6), &msg->msg_name);
        if (addr6) {
            __u16 dport;
            bpf_probe_read_kernel(&event->daddr_v6, sizeof(event->daddr_v6),
                                &addr6->sin6_addr);
            bpf_probe_read_kernel(&dport, sizeof(dport), &addr6->sin6_port);
            event->dport = bpf_ntohs(dport);
        }

        bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                             &sk->__sk_common.skc_num);
    }

    /* Submit event to user space */
    bpf_ringbuf_submit(event, 0);

    return 0;
}

/* kretprobe for inet_csk_accept (TCP accept) */
SEC("kretprobe/inet_csk_accept")
int kprobe_tcp_accept(struct pt_regs *ctx)
{
    struct sock *sk = (struct sock *)PT_REGS_RC(ctx);
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 uid_gid = bpf_get_current_uid_gid();

    if (!sk)
        return 0;

    /* Reserve space in ring buffer */
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    /* Fill in process information */
    event->pid = pid;
    event->tid = (__u32)pid_tgid;
    event->uid = (__u32)uid_gid;
    event->gid = uid_gid >> 32;
    event->event_type = EVENT_TCP_ACCEPT;
    event->protocol = IPPROTO_TCP;
    event->timestamp = bpf_ktime_get_ns();

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    /* Read socket information */
    __u16 family;
    bpf_probe_read_kernel(&family, sizeof(family), &sk->__sk_common.skc_family);
    event->family = family;

    if (family == AF_INET) {
        bpf_probe_read_kernel(&event->saddr_v4, sizeof(event->saddr_v4),
                             &sk->__sk_common.skc_rcv_saddr);
        bpf_probe_read_kernel(&event->daddr_v4, sizeof(event->daddr_v4),
                             &sk->__sk_common.skc_daddr);
        bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                             &sk->__sk_common.skc_num);
        bpf_probe_read_kernel(&event->dport, sizeof(event->dport),
                             &sk->__sk_common.skc_dport);
        event->dport = bpf_ntohs(event->dport);
    } else if (family == AF_INET6) {
        bpf_probe_read_kernel(&event->saddr_v6, sizeof(event->saddr_v6),
                             &sk->__sk_common.skc_v6_rcv_saddr);
        bpf_probe_read_kernel(&event->daddr_v6, sizeof(event->daddr_v6),
                             &sk->__sk_common.skc_v6_daddr);
        bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                             &sk->__sk_common.skc_num);
        bpf_probe_read_kernel(&event->dport, sizeof(event->dport),
                             &sk->__sk_common.skc_dport);
        event->dport = bpf_ntohs(event->dport);
    }

    /* Submit event to user space */
    bpf_ringbuf_submit(event, 0);

    return 0;
}
