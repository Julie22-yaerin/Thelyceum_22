# SYSTEM ARCHITECTURE & DATAFLOW SPECIFICATION

## Overview

The Lyceum security and context optimisation suite consists of four tightly integrated, modular components designed for AI Agent systems:

1. **`@lyceum/session-guard`**: Session authentication and master key management.
2. **`brake`**: Emergency safety brake, threat scanner, and SLA enforcement guardrail.
3. **`thrift` (Savier)**: Token economy engine, context deduplication (`SeenLedger`), and semantic compressor.
4. **`redteam`**: Automated security audit log recorder and usage telemetry tracker.

---

## Dataflow Architecture

```mermaid
flowchart TD
    subgraph Client System / AI Agent Host
        A[User / AI Agent Action] --> B[Session Guard Auth Check]
    end

    subgraph Auth & Security Layer
        B -->|Session Valid| C[Brake Danger Scan]
        B -->|Session Invalid| X[Block: Authentication Required]
    end

    subgraph Guardrail & Token Engine
        C -->|Danger Detected| D[Brake Engage: BLOCK Action]
        C -->|Safe Action| E[Thrift Context Compressor]
        D --> R[Audit & Telemetry Log]
    end

    subgraph Context Engine
        E --> F{SeenLedger Cache Check}
        F -->|Identical Hash Found| G[Return Dedupe Pointer]
        F -->|New/Mutated File| H[Classify Hard vs Soft Data]
        H --> I[Slice / Strip Prose & Compress]
        G --> J[Execution Engine / Model Prompt]
        I --> J
    end

    subgraph Audit & Telemetry
        J --> R[Red Team Audit Log]
    end
```

---

## Component Responsibilities

| Component | Responsibility | Latency Budget | Fail-Safe Behavior |
| :--- | :--- | :--- | :--- |
| **Session Guard** | Master password authentication, token issuance, session TTL. | $< 0.1\text{ms}$ | Lock session on invalid/expired token. |
| **Brake** | Regex & pattern scanning for RCE, data exfiltration, SQLi, PII leaks, destructive ops. | $< 1.0\text{ms}$ | Block dangerous operations immediately. |
| **Thrift (Savier)** | Deduplication (`SeenLedger`), CRLF normalization, token budget slicing. | $< 10.0\text{ms}$ | Fall back to uncompressed input if growth occurs. |
| **Red Team** | Persistent audit logging to `~/.brake/audit.log` & `~/.thrift/ledger.log`. | Async | Non-blocking append. |
