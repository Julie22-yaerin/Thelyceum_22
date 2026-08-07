# ENVIRONMENT & TOOLCHAIN DEPENDENCIES

## Required Runtimes & Compilers

### Node.js Toolchain (TypeScript Core)
- **Node.js**: `v20.10.0` or higher (LTS recommended)
- **npm**: `v10.2.0` or higher
- **TypeScript**: `v5.3.0` or higher
- **Module Format**: ES Modules (`"type": "module"`)

### Rust Toolchain (Native Engine Extensions)
- **Rust Edition**: `2021`
- **Cargo**: `1.75.0` or higher
- **LLVM**: `v17` toolchain

---

## Supported Target Triples

| Target Triple | Operating System | Architecture | Build Type |
| :--- | :--- | :--- | :--- |
| `x86_64-apple-darwin` | macOS (Intel) | x86_64 | Native / Universal |
| `aarch64-apple-darwin` | macOS (Apple Silicon) | ARM64 | Native / Universal |
| `x86_64-unknown-linux-gnu` | Linux (Ubuntu/Debian) | x86_64 | GNU C Library |
| `x86_64-unknown-linux-musl` | Linux (Alpine/Docker) | x86_64 | Static MUSL |
| `x86_64-pc-windows-msvc` | Windows | x86_64 | Native MSVC |
