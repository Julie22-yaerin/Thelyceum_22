# INTEGRATION EXAMPLES (PYTHON / NODE.JS / RUST)

This manual provides production integration snippets for embedding **Brake**, **Thrift (Savier)**, and **Session Guard** into AI Agent pipelines.

---

## 1. Python Integration (Subprocess)

```python
import subprocess
import json

def scan_action_safety(intent_text: str) -> dict:
    """Pre-scan AI Agent intent using Brake before execution."""
    result = subprocess.run(
        ["brake", "scan", intent_text],
        capture_output=True,
        text=True,
        check=False
    )
    if result.returncode == 0 and result.stdout.strip():
        return json.loads(result.stdout)
    return {"danger": False}

def compress_context_stream(raw_log: str) -> str:
    """Pipe raw log data into Thrift stream compressor."""
    proc = subprocess.run(
        ["thrift", "compress", "-"],
        input=raw_log,
        capture_output=True,
        text=True
    )
    return proc.stdout

# Example Usage:
res = scan_action_safety("rm -rf /")
if res.get("danger"):
    print(f"BLOCKED: {res.get('explanation')}")
```

---

## 2. Node.js / TypeScript Integration (ES Module Import)

```typescript
import { scanForDanger } from "@lyceum/brake/danger";
import { compress, SeenLedger } from "@lyceum/thrift/compress";
import { validateActiveSession } from "@lyceum/session-guard";

// 1. Verify Active Session
if (!validateActiveSession()) {
  throw new Error("Session locked! Please run session-guard login.");
}

// 2. Scan Proposed Action
const action = "cat secret.env";
const dangerSignal = scanForDanger(action);

if (dangerSignal) {
  console.error(`[BLOCK] ${dangerSignal.explanation}`);
} else {
  // 3. Compress Context
  const ledger = new SeenLedger();
  const compressed = compress("large source text...", ledger, { budgetTokens: 2000 });
  console.log(compressed.text);
}
```

---

## 3. Rust Integration (Crate / Command Subprocess)

```rust
use std::process::{Command, Stdio};
use std::io::Write;

fn compress_context_rust(input_data: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut child = Command::new("thrift")
        .arg("compress")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input_data.as_bytes())?;
    }

    let output = child.wait_with_output()?;
    Ok(String::from_utf8(output.stdout)?)
}
```
