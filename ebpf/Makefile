CLANG := clang
LLVM_STRIP := llvm-strip
BPFTOOL := bpftool
ARCH := $(shell uname -m | sed 's/x86_64/x86/' | sed 's/aarch64/arm64/')

LIBBPF_TOP := /usr/include
INCLUDES := -I$(LIBBPF_TOP) -I/usr/include/$(shell uname -m)-linux-gnu

BPF_CFLAGS := -g -O2 -target bpf -D__TARGET_ARCH_$(ARCH)
COMMON_FLAGS := $(INCLUDES) -Wall

BPF_SOURCES := network_monitor.bpf.c
BPF_OBJECTS := $(BPF_SOURCES:.c=.o)
SKELETONS := $(BPF_SOURCES:.bpf.c=.skel.h)

.PHONY: all clean

all: $(BPF_OBJECTS) $(SKELETONS)

%.bpf.o: %.bpf.c
	$(CLANG) $(BPF_CFLAGS) $(COMMON_FLAGS) -c $< -o $@
	$(LLVM_STRIP) -g $@

%.skel.h: %.bpf.o
	$(BPFTOOL) gen skeleton $< > $@

clean:
	rm -f *.o *.skel.h

install: $(BPF_OBJECTS)
	mkdir -p /usr/local/lib/exit-gate/bpf
	cp $(BPF_OBJECTS) /usr/local/lib/exit-gate/bpf/
