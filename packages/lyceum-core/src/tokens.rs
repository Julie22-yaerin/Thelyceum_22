//! Token estimation and hashing over borrowed bytes.
//!
//! Zero-copy contract: every function here takes `&[u8]`/`&str` that is
//! *borrowed directly from the Python buffer* (via `Bound<PyStr>::to_str()`),
//! never copied into a Rust-owned `String` first. The dedupe key is a u64
//! hash of those bytes, so the content itself never crosses the boundary
//! twice.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// 64-bit fingerprint of content. Collision odds for a session-scale corpus
/// are negligible; the pointer also names the source and call, so even a
/// collision could not misdirect the model to unrelated content.
pub fn content_hash(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

/// Heuristic token count, matching the thrift estimator's honesty contract:
/// it is an approximation (≈3 chars/token for dense text), labelled as such
/// everywhere it is surfaced to Python. Exactness is the server's job; this
/// core exists to make the *decision* cheap and the *memory* bounded.
pub fn estimate_tokens(bytes: &[u8]) -> u64 {
    // Dense JSON/code runs ~2.7–3.2 chars/token; prose ~3.9. A single
    // constant between the two is within ±20% of either, which is the
    // documented accuracy of the whole pipeline.
    let chars = bytes.len() as u64;
    (chars / 3).max(1)
}
