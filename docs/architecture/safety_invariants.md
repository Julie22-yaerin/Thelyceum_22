# INVARIANT & SAFETY RULES SPECIFICATION

> **CRITICAL NOTICE FOR DEVELOPERS & RE-COMPILERS:**
> The safety rules detailed in this document are non-negotiable invariants. Removing or bypassing any of these rules when re-compiling the binary will break security compliance.

---

## 1. Safety Invariants Matrix

| Invariant ID | Name | Core Rule | Enforced By |
| :--- | :--- | :--- | :--- |
| **INV-01** | **Zero-Panic Buffer Safety** | Parsers MUST NOT panic, throw uncaught exceptions, or trigger stack overflows on Zalgo text, control chars, or deep JSON (10,000+ depth). | `brake/src/danger.ts` |
| **INV-02** | **Immutable Hard Data Protection** | Source code, JSON/YAML schemas, credentials, financial numbers, and API tokens MUST NEVER be truncated or lossily compressed. | `thrift/src/classify.ts` |
| **INV-03** | **Atomic Cache Consistency** | When a file mutates, stale deduplication pointers MUST NOT be served. The ledger must re-baseline immediately. | `thrift/src/compress.ts` |
| **INV-04** | **Mandatory Threat Pre-Scan** | High-risk operations (RCE, file deletion `rm -rf`, SQL injection, credential read) MUST evaluate to `BLOCK` before execution. | `brake scan` |
| **INV-05** | **No Hidden Backdoors** | All administrative, maintenance, and authentication paths MUST be explicit, role-based, and recorded in audit logs. | `session-guard` |

---

## 2. Hard Data Protection Classification Rules

Lines matching any of the following patterns are tagged as `HARD` data and protected from lossy compression:

- **Code Signals:** `function`, `const`, `let`, `import`, `export`, `class`, `struct`, `impl`, `fn`, `def`, `return`
- **Configuration & Schemas:** JSON keys (`"key":`), YAML keys (`key:`), env vars (`KEY=VALUE`)
- **Secrets & Credentials:** `api_key`, `secret`, `password`, `token`, `bearer`, `private_key`
- **Financial & Limits:** Currency symbols (`$`, `€`, `VND`), `budget`, `limit`, `amount`
