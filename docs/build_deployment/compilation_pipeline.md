# OPTIMIZED COMPILATION PIPELINE GUIDE

## 1. Production TypeScript Build Pipeline

To compile all `@lyceum` packages with strict type checks and clean ES Module output:

```bash
# Build session-guard
cd packages/session-guard
npm run build

# Build brake
cd packages/brake
npm run build

# Build thrift
cd packages/thrift
npm run build
```

---

## 2. Optimized Rust Binary Compilation Flags

When compiling native Rust binaries for release, apply Link-Time Optimization (LTO), symbol stripping, and codegen optimizations in `Cargo.toml`:

```toml
[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true
```

### Build Commands:
```bash
# Release build with LTO and stripped symbols
cargo build --release --locked
```
