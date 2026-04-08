#include <linux/bpf.h>
#include <linux/types.h>
#include <linux/ptrace.h>

/* BPF helper function declarations */
static long (*bpf_probe_read_kernel)(void *dst, __u32 size, const void *unsafe_ptr) = (void *) 113;
static long (*bpf_probe_read_user)(void *dst, __u32 size, const void *unsafe_ptr) = (void *) 112;
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

/*
 * Minimal sock_common mirror matching the actual kernel layout.
 *
 * Offsets verified against running kernel via pahole:
 *   0  : skc_daddr / skc_rcv_saddr
 *   8  : skc_hash            <-- previously missing, caused all TCP reads to be wrong
 *   12 : skc_dport / skc_num
 *   16 : skc_family
 *   18 : skc_state + reuse flags (2 bytes)
 *   20 : skc_bound_dev_if    (4 bytes)
 *   24 : skc_bind_node       (16 bytes, two pointers)
 *   40 : skc_prot*           (8 bytes)
 *   48 : skc_net             (8 bytes)
 *   56 : skc_v6_daddr        (16 bytes)
 *   72 : skc_v6_rcv_saddr    (16 bytes)
 */
struct sock_common {
    union {
        struct {
            __be32 skc_daddr;
            __be32 skc_rcv_saddr;
        };
    };                              /* offset  0, size 8 */
    __u32 skc_hash;                 /* offset  8, size 4 -- was missing! */
    union {
        struct {
            __be16 skc_dport;
            __u16  skc_num;
        };
    };                              /* offset 12, size 4 */
    short unsigned int skc_family;  /* offset 16, size 2 */
    __u8  __pad0[2];                /* offset 18: skc_state + reuse flags */
    __u32 skc_bound_dev_if;         /* offset 20, size 4 */
    __u8  __pad1[16];               /* offset 24: skc_bind_node (2 x pointer) */
    __u8  __pad2[8];                /* offset 40: skc_prot* */
    __u8  __pad3[8];                /* offset 48: skc_net */
    struct in6_addr skc_v6_daddr;   /* offset 56, size 16 */
    struct in6_addr skc_v6_rcv_saddr; /* offset 72, size 16 */
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

/* Event types */
#define EVENT_TCP_CONNECT 1
#define EVENT_UDP_SEND 2
#define EVENT_TCP_ACCEPT 3

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



/* BPF Maps */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");



/*
 * kprobe/tcp_connect
 *
 * Fires when the kernel calls tcp_connect(sk) internally — at this point the
 * socket's destination (skc_daddr / skc_v6_daddr) has already been populated
 * by tcp_v4_connect / tcp_v6_connect, so we can read it directly from sk.
 */
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

    /* Read socket family — now at the correct offset (16) in the fixed struct */
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

/*
 * kprobe/tcp_v4_connect  (fallback / defence-in-depth for IPv4)
 *
 * Fires at the syscall boundary: tcp_v4_connect(sk, uaddr, addr_len).
 * At entry, the destination address is in `uaddr` (sockaddr_in*), NOT yet
 * written into sk. We read directly from the userspace sockaddr so we are
 * completely independent of the sock_common layout.
 */
SEC("kprobe/tcp_v4_connect")
int kprobe_tcp_v4_connect(struct pt_regs *ctx)
{
    struct sock *sk         = (struct sock *)PT_REGS_PARM1(ctx);
    struct sockaddr_in *uaddr = (struct sockaddr_in *)PT_REGS_PARM2(ctx);
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 uid_gid = bpf_get_current_uid_gid();

    if (!uaddr)
        return 0;

    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    event->pid        = pid;
    event->tid        = (__u32)pid_tgid;
    event->uid        = (__u32)uid_gid;
    event->gid        = uid_gid >> 32;
    event->event_type = EVENT_TCP_CONNECT;
    event->protocol   = IPPROTO_TCP;
    event->family     = AF_INET;
    event->timestamp  = bpf_ktime_get_ns();

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    /* Destination from uaddr (already in network byte order) */
    __u32 daddr; __u16 dport;
    bpf_probe_read_user(&daddr, sizeof(daddr), &uaddr->sin_addr.s_addr);
    bpf_probe_read_user(&dport, sizeof(dport), &uaddr->sin_port);
    event->daddr_v4 = daddr;
    event->dport    = bpf_ntohs(dport);

    /* Source address from sk (populated during bind or auto-assigned) */
    bpf_probe_read_kernel(&event->saddr_v4, sizeof(event->saddr_v4),
                         &sk->__sk_common.skc_rcv_saddr);
    bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                         &sk->__sk_common.skc_num);

    bpf_ringbuf_submit(event, 0);
    return 0;
}

/*
 * kprobe/tcp_v6_connect  (fallback / defence-in-depth for IPv6)
 *
 * Fires at: tcp_v6_connect(sk, uaddr, addr_len).
 * Reads destination directly from uaddr (sockaddr_in6*).
 */
SEC("kprobe/tcp_v6_connect")
int kprobe_tcp_v6_connect(struct pt_regs *ctx)
{
    struct sock *sk           = (struct sock *)PT_REGS_PARM1(ctx);
    struct sockaddr_in6 *uaddr = (struct sockaddr_in6 *)PT_REGS_PARM2(ctx);
    struct connection_event *event;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 uid_gid = bpf_get_current_uid_gid();

    if (!uaddr)
        return 0;

    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return 0;

    event->pid        = pid;
    event->tid        = (__u32)pid_tgid;
    event->uid        = (__u32)uid_gid;
    event->gid        = uid_gid >> 32;
    event->event_type = EVENT_TCP_CONNECT;
    event->protocol   = IPPROTO_TCP;
    event->family     = AF_INET6;
    event->timestamp  = bpf_ktime_get_ns();

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    __u16 dport;
    bpf_probe_read_user(&event->daddr_v6, sizeof(event->daddr_v6),
                       &uaddr->sin6_addr);
    bpf_probe_read_user(&dport, sizeof(dport), &uaddr->sin6_port);
    event->dport = bpf_ntohs(dport);

    bpf_probe_read_kernel(&event->saddr_v6, sizeof(event->saddr_v6),
                         &sk->__sk_common.skc_v6_rcv_saddr);
    bpf_probe_read_kernel(&event->sport, sizeof(event->sport),
                         &sk->__sk_common.skc_num);

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
