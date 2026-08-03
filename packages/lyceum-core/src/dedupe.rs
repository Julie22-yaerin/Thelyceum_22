//! The context-deduplication state machine.
//!
//! Mirrors the thrift `SeenLedger` semantics exactly, because those semantics
//! are the product: a pointer is only handed out while BOTH a call-count
//! window AND an emitted-token window are open. The host (OpenAI SDK user,
//! agent runtime) can compact context at any moment; a pointer that says "you
//! already have this" when the content has since left the window is the one
//! unrecoverable failure this state machine exists to prevent.
//!
//! State:
//!   * a per-source sighting { hash, at_call, emitted_at, tokens }
//!   * a session call counter and cumulative emitted-token counter
//!
//! Transitions:
//!   miss            → insert sighting, return full content
//!   hit, in window  → return pointer (lossless: content is already in context)
//!   hit, expired    → re-baseline the sighting, return full content (the
//!                     earlier copy may have been compacted away)

use std::collections::HashMap;

/// One sighting of a source's content.
#[derive(Clone, Copy)]
struct Sighting {
    hash: u64,
    /// Session call number when this content was first shown.
    at_call: u64,
    /// Cumulative emitted tokens at the moment this content was shown.
    emitted_at: u64,
    tokens: u64,
}

/// The outcome of checking one piece of content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckOutcome {
    /// Content identical to a sighting still inside its window — return a pointer.
    Pointer { age_calls: u64 },
    /// Not seen, or seen but expired/changed — return the full content.
    /// `rebaselined` is true when a stale sighting was refreshed.
    Full { rebaselined: bool },
}

/// Per-session, per-source dedupe state. Reset when the conversation does.
pub struct Deduplicator {
    seen: HashMap<String, Sighting>,
    calls: u64,
    emitted: u64,
    /// Max intervening calls before a pointer expires.
    max_age_calls: u64,
    /// Max tokens emitted by OTHER content since the sighting before expiry.
    max_age_tokens: u64,
}

impl Deduplicator {
    pub fn new(max_age_calls: u64, max_age_tokens: u64) -> Self {
        Self {
            seen: HashMap::new(),
            calls: 0,
            emitted: 0,
            max_age_calls,
            max_age_tokens,
        }
    }

    pub fn reset(&mut self) {
        self.seen.clear();
        self.calls = 0;
        self.emitted = 0;
    }

    /// Call after a result is returned to the model, so age-in-tokens stays honest.
    pub fn record_emission(&mut self, tokens: u64) {
        self.emitted += tokens;
    }

    pub fn emitted_tokens(&self) -> u64 {
        self.emitted
    }

    pub fn call_count(&self) -> u64 {
        self.calls
    }

    /// Check content against prior sightings. `source` is the stable id (file
    /// path, tool name, URL); `bytes` is borrowed from Python, never copied.
    pub fn check(&mut self, source: &str, hash: u64, tokens: u64) -> CheckOutcome {
        self.calls += 1;
        match self.seen.get(source) {
            None => {
                self.seen.insert(
                    source.to_string(),
                    Sighting { hash, at_call: self.calls, emitted_at: self.emitted, tokens },
                );
                CheckOutcome::Full { rebaselined: false }
            }
            Some(s) if s.hash == hash => {
                let age_calls = self.calls - s.at_call;
                // Tokens of OTHER content emitted since the sighting: the
                // sighting's own first emission is subtracted, so a file read
                // twice in a row (nothing else in between) still dedupes.
                let age_tokens = self
                    .emitted
                    .saturating_sub(s.emitted_at)
                    .saturating_sub(s.tokens);
                if age_calls <= self.max_age_calls && age_tokens <= self.max_age_tokens {
                    CheckOutcome::Pointer { age_calls }
                } else {
                    // Expired: the host may have compacted the earlier copy.
                    // Re-baseline so the NEXT read within the window dedupes again.
                    self.seen.insert(
                        source.to_string(),
                        Sighting { hash, at_call: self.calls, emitted_at: self.emitted, tokens },
                    );
                    CheckOutcome::Full { rebaselined: true }
                }
            }
            Some(_) => {
                // Content changed: never a pointer. Re-baseline on the new hash.
                self.seen.insert(
                    source.to_string(),
                    Sighting { hash, at_call: self.calls, emitted_at: self.emitted, tokens },
                );
                CheckOutcome::Full { rebaselined: false }
            }
        }
    }

    pub fn len(&self) -> usize {
        self.seen.len()
    }

    pub fn is_empty(&self) -> bool {
        self.seen.is_empty()
    }
}
