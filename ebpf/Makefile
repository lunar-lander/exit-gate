CLANG := clang
LLVM_STRIP := llvm-strip
BPFTOOL := bpftool
MACHINE := $(shell uname -m)
ARCH := $(shell uname -m | sed 's/x86_64/x86/' | sed 's/aarch64/arm64/')

LIBBPF_TOP := /usr/include
INCLUDES := -I$(LIBBPF_TOP) -I/usr/include/$(MACHINE)-linux-gnu

# Architecture-specific defines
ifeq ($(MACHINE),x86_64)
	ARCH_DEF := -D__x86_64__
else ifeq ($(MACHINE),aarch64)
	ARCH_DEF := -D__aarch64__
endif

BPF_CFLAGS := -g -O2 -target bpf -D__TARGET_ARCH_$(ARCH) $(ARCH_DEF)
COMMON_FLAGS := $(INCLUDES) -Wall

BPF_SOURCES := network_monitor.bpf.c
BPF_OBJECTS := $(BPF_SOURCES:.c=.o)
SKELETONS := $(BPF_SOURCES:.bpf.c=.skel.h)

.PHONY: all clean skeleton

all: $(BPF_OBJECTS)
	@echo "eBPF programs built successfully"
	@if command -v $(BPFTOOL) >/dev/null 2>&1; then \
		$(MAKE) skeleton; \
	else \
		echo "Note: bpftool not found, skipping skeleton generation (optional)"; \
	fi

skeleton: $(SKELETONS)

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
