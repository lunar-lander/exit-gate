#include <linux/bpf.h>
#include <linux/pkt_cls.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/ipv6.h>
#include <linux/tcp.h>
#include <linux/udp.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>
#include <bpf/bpf_tracing.h>

#define AF_INET 2
#define AF_INET6 10
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
    char comm[16]; /* Process name */
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
    __u8 verdict;  /* VERDICT_ALLOW or VERDICT_DENY */
    __u64 timestamp;
};

/* Maps */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024); /* 256 KB ring buffer */
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
    __type(key, __u32); /* PID */
    __type(value, __u64); /* Timestamp of last update */
} process_cache SEC(".maps");

/* Helper to get connection verdict */
static __always_inline int get_verdict(struct conn_key *key)
{
    struct conn_verdict *verdict = bpf_map_lookup_elem(&verdicts, key);
    if (verdict) {
        return verdict->verdict;
    }
    return VERDICT_PENDING;
}

/* kprobe for tcp_connect */
SEC("kprobe/tcp_connect")
int BPF_KPROBE(kprobe_tcp_connect, struct sock *sk)
{
    struct connection_event *event;
    struct conn_key key = {};
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tid = (__u32)pid_tgid;
    __u64 uid_gid = bpf_get_current_uid_gid();

    /* Reserve space in ring buffer */
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    /* Fill in process information */
    event->pid = pid;
    event->tid = tid;
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

        /* Prepare key for verdict lookup */
        key.pid = pid;
        key.saddr = event->saddr_v4;
        key.daddr = event->daddr_v4;
        key.sport = event->sport;
        key.dport = event->dport;
        key.protocol = IPPROTO_TCP;
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
int BPF_KPROBE(kprobe_udp_sendmsg, struct sock *sk, struct msghdr *msg, size_t len)
{
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tid = (__u32)pid_tgid;
    __u64 uid_gid = bpf_get_current_uid_gid();

    /* Reserve space in ring buffer */
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    /* Fill in process information */
    event->pid = pid;
    event->tid = tid;
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

        /* For UDP, we need to read destination from msghdr */
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

/* kprobe for inet_csk_accept (TCP accept) */
SEC("kprobe/inet_csk_accept")
int BPF_KPROBE(kprobe_tcp_accept, struct sock *sk)
{
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tid = (__u32)pid_tgid;
    __u64 uid_gid = bpf_get_current_uid_gid();

    /* Reserve space in ring buffer */
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    /* Fill in process information */
    event->pid = pid;
    event->tid = tid;
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

char LICENSE[] SEC("license") = "GPL";
