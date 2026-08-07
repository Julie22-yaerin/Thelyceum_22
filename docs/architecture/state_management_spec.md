# STATE MANAGEMENT & SEENLEDGER MEMORY MODEL SPECIFICATION

## 1. Overview & Memory Model

The context engine (`thrift` / Savier) relies on an in-memory, zero-copy state ledger named **`SeenLedger`**. It eliminates redundant file transmissions by tracking content hashes per source path.

```
       [Source Path ID] ──> [SeenLedger Map]
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      │  hash: SHA256(normalize_crlf(text)).slice(0, 16)      │
      │  atCall: CallSequenceCounter                          │
      │  emittedAt: TotalEmittedTokensCounter                  │
      │  tokens: TokenCountEstimate                           │
      └───────────────────────────────────────────────────────┘
```

---

## 2. Cross-Platform Hash Normalization

To ensure 100% deduplication consistency across Windows (`\r\n`) and Linux/macOS (`\n`), `SeenLedger` normalizes line endings before computing SHA-256 signatures:

$$\text{NormalizedText} = \text{replace}(\text{RawText}, \text{CRLF} \to \text{LF})$$
$$\text{Hash} = \text{SHA256}(\text{NormalizedText})[0..16]$$

---

## 3. Cache & Pointer Lifecycle

1. **Check Phase (`ledger.check(sourceId, text)`)**:
   - Increments call counter (`this.calls++`).
   - Computes 16-character hex hash.
   - Looks up `sourceId` in map.
   - If prior entry exists **and** hashes match: returns pointer `SeenEntry`.
   - If missing or hash differs: updates entry with new hash and returns `null`.

2. **Deduplication Pointer Emission**:
   - When a match occurs within the sliding window (`maxDedupeAgeCalls <= 20` and `maxDedupeAgeTokens <= 40000`), Thrift replaces the full content with a token-light reference pointer:
   ```text
   [thrift: unchanged since you read it earlier this session (1,250 tokens, call #4, 2 calls ago). Content omitted because you already have it.]
   ```

3. **Atomic Purge & Re-baselining**:
   - When a file undergoes mutation, its content hash changes. On the very next `check()` call, the old hash entry is purged, and `rebaseline()` re-indexes the new content state atomically without stale pointer leaks.
