# CROSS-COMPILATION & CI/CD GUIDE (DOCKER / CROSS-RS / ACT)

## 1. Local CI/CD Simulation using `act`

You can run GitHub Actions workflows locally using `act` from the `enviroment for testing` directory:

```bash
# Run local test matrix workflow
act -j test-windows

# Run Linux release build simulation
act -j test-linux
```

---

## 2. Cross-Compiling Native Binaries using `cross-rs`

Use `cross` (installed in `enviroment for testing/cross`) to compile target binaries inside isolated Docker containers:

### Windows Target (`x86_64-pc-windows-msvc` / `gnu`):
```bash
cross build --target x86_64-pc-windows-gnu --release
```

### Static Linux Target (`x86_64-unknown-linux-musl`):
```bash
cross build --target x86_64-unknown-linux-musl --release
```

### macOS Target (`aarch64-apple-darwin`):
```bash
cargo build --target aarch64-apple-darwin --release
```
