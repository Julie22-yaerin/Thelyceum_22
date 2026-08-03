//! TRẠM GÁC 2 — Output Sanitizer (the bottleneck on the way back to the user).
//!
//! Three laws, per the Red Team spec:
//!
//!   Luật 3 — Fact-Anchor Validation. The gate never reads the whole answer.
//!     It token-pattern-matches anchors — URLs, file paths, currency amounts,
//!     identifiers (UUIDs) — and compares them against the context seeded at
//!     ingress (`seed_context`). An anchor that was never in the context is
//!     flagged; unknown URLs are masked to `[Unverified Link]` before the
//!     user sees them.
//!
//!   Luật 4 — Deterministic Structural Enforcement. A byte-level JSON scan on
//!     the stream. When the model stops mid-object, the gate appends the
//!     missing closers instead of letting the pipeline crash or paying for a
//!     re-run. It refuses to fabricate values: an unterminated string or a
//!     missing value is reported, never guessed.
//!
//!   Luật 5 — Semantic Loop Detection. Shingle-Jaccard similarity + Shannon
//!     entropy over recent stream chunks. When the model starts repeating
//!     itself, the gate says STOP; the caller keeps the best text so far.

use std::collections::{HashSet, VecDeque};

use pyo3::prelude::*;
use pyo3::types::PyStr;

use crate::tokens;

const MAX_CHUNK_SAMPLE: usize = 2000;
const MIN_WINDOW: usize = 3;
const ENTROPY_SAMPLE_MIN: usize = 40;

/// URL scanning stops at these bytes.
fn is_url_end(b: u8) -> bool {
    b.is_ascii_whitespace() || matches!(b, b'"' | b'\'' | b'(' | b')' | b'[' | b']' | b'{' | b'}' | b'<' | b'>' | b',' | b';' | b'`')
}

/// Extract (start, end, value) for every URL in `text`. Byte offsets are
/// always at char boundaries because every URL starts/ends at an ASCII byte.
fn extract_urls(text: &str) -> Vec<(usize, usize, String)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        let rest = &b[i..];
        let start = if rest.starts_with(b"https://") {
            Some(i)
        } else if rest.starts_with(b"http://") {
            Some(i)
        } else {
            None
        };
        if let Some(s) = start {
            let mut j = i;
            while j < b.len() && !is_url_end(b[j]) {
                j += 1;
            }
            let mut e = j;
            while e > s && matches!(b[e - 1], b'.' | b',' | b';' | b':' | b'!' | b'?' | b')' | b']' | b'}' | b'"' | b'\'' | b'<' | b'>') {
                e -= 1;
            }
            if e - s >= 9 {
                out.push((s, e, text[s..e].to_string()));
                i = e;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn is_hex(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

/// Extract canonical 8-4-4-4-12 UUIDs.
fn extract_uuids(text: &str) -> Vec<String> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 36 <= b.len() {
        let seg = |k: usize, n: usize| {
            (k..k + n).all(|j| is_hex(b[i + j]))
        };
        let ok = seg(0, 8) && b[i + 8] == b'-' && seg(9, 4) && b[i + 13] == b'-' && seg(14, 4)
            && b[i + 18] == b'-' && seg(19, 4) && b[i + 23] == b'-' && seg(24, 12);
        if ok {
            out.push(text[i..i + 36].to_string());
            i += 36;
        } else {
            i += 1;
        }
    }
    out
}

/// Extract `$`-prefixed amounts, e.g. `$1,200.50`, `$5`.
fn extract_currency(text: &str) -> Vec<String> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'$' {
            let mut j = i + 1;
            let mut last_digit = false;
            while j < b.len() {
                if b[j].is_ascii_digit() {
                    last_digit = true;
                    j += 1;
                } else if (b[j] == b',' || b[j] == b'.') && j + 1 < b.len() && b[j + 1].is_ascii_digit() {
                    j += 1;
                } else {
                    break;
                }
            }
            if last_digit {
                out.push(text[i..j].to_string());
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Replace byte ranges (sorted descending) with the mask text.
fn mask_ranges(text: &str, ranges: &[(usize, usize)]) -> String {
    let mut sorted = ranges.to_vec();
    sorted.sort_unstable_by(|a, b| b.0.cmp(&a.0));
    let mut out = text.to_string();
    for (s, e) in sorted {
        out.replace_range(s..e, "[Unverified Link]");
    }
    out
}

/// Luật 4 — streaming JSON state machine. Pure std, byte-level, no regex.
#[pyclass(module = "lyceum_core")]
pub struct JsonEnforcer {
    buf: String,
    stack: Vec<u8>,
    in_string: bool,
    escaped: bool,
    mismatched: bool,
    last_significant: u8,
}

#[pyclass(module = "lyceum_core")]
#[derive(Clone)]
pub struct JsonStatusView {
    #[pyo3(get)]
    pub buffered_chars: u64,
    #[pyo3(get)]
    pub depth: i64,
    #[pyo3(get)]
    pub in_string: bool,
    #[pyo3(get)]
    pub balanced: bool,
}

#[pyclass(module = "lyceum_core")]
pub struct JsonRepairResult {
    #[pyo3(get)]
    pub json: Py<PyStr>,
    #[pyo3(get)]
    pub repaired: bool,
    #[pyo3(get)]
    pub repairs: Vec<String>,
    #[pyo3(get)]
    pub error: String,
}

impl JsonEnforcer {
    pub(crate) fn new_internal() -> Self {
        Self {
            buf: String::new(),
            stack: Vec::new(),
            in_string: false,
            escaped: false,
            mismatched: false,
            last_significant: 0,
        }
    }

    fn status(&self) -> JsonStatusView {
        JsonStatusView {
            buffered_chars: self.buf.len() as u64,
            depth: self.stack.len() as i64,
            in_string: self.in_string,
            balanced: self.stack.is_empty() && !self.in_string && !self.mismatched,
        }
    }

    /// Returns (json, repaired, repairs, error).
    pub(crate) fn finish_internal(&mut self) -> (String, bool, Vec<String>, String) {
        if self.in_string {
            return (
                self.buf.clone(),
                false,
                vec![],
                "unterminated string at end of stream — refusing to fabricate".to_string(),
            );
        }
        if self.mismatched {
            return (
                self.buf.clone(),
                false,
                vec![],
                "mismatched closing bracket — structure is not valid JSON".to_string(),
            );
        }
        if !self.stack.is_empty() {
            if matches!(self.last_significant, b':' | b',' | b'{' | b'[' | 0) {
                return (
                    self.buf.clone(),
                    false,
                    vec![],
                    "stream ended in the middle of a value — refusing to fabricate".to_string(),
                );
            }
            let closers: String = self
                .stack
                .iter()
                .rev()
                .map(|&b| if b == b'{' { '}' } else { ']' })
                .collect();
            self.buf.push_str(&closers);
            let desc = format!("appended '{closers}'");
            return (self.buf.clone(), true, vec![desc], String::new());
        }
        (self.buf.clone(), false, vec![], String::new())
    }
}

#[pymethods]
impl JsonEnforcer {
    #[new]
    pub fn new() -> Self {
        Self::new_internal()
    }

    /// Feed one stream chunk; returns the running status.
    pub fn feed(&mut self, chunk: &str) -> JsonStatusView {
        for &ch in chunk.as_bytes() {
            if self.in_string {
                if self.escaped {
                    self.escaped = false;
                } else if ch == b'\\' {
                    self.escaped = true;
                } else if ch == b'"' {
                    self.in_string = false;
                }
            } else {
                match ch {
                    b'"' => self.in_string = true,
                    b'{' | b'[' => self.stack.push(ch),
                    b'}' => {
                        if self.stack.last() == Some(&b'{') {
                            self.stack.pop();
                        } else {
                            self.mismatched = true;
                        }
                    }
                    b']' => {
                        if self.stack.last() == Some(&b'[') {
                            self.stack.pop();
                        } else {
                            self.mismatched = true;
                        }
                    }
                    _ => {}
                }
            }
            if !ch.is_ascii_whitespace() {
                self.last_significant = ch;
            }
        }
        self.buf.push_str(chunk);
        self.status()
    }

    /// End of stream: auto-repair unclosed brackets, refuse to fabricate.
    pub fn finish<'py>(&mut self, py: Python<'py>) -> PyResult<JsonRepairResult> {
        let (json, repaired, repairs, error) = self.finish_internal();
        Ok(JsonRepairResult {
            json: PyStr::new(py, &json)?.unbind(),
            repaired,
            repairs,
            error,
        })
    }

    pub fn reset(&mut self) {
        *self = Self::new_internal();
    }
}

/// Luật 5 — semantic loop detection state machine.
#[pyclass(module = "lyceum_core")]
pub struct SemanticLoopDetector {
    window: VecDeque<String>,
    window_size: usize,
    max_jaccard: f64,
    min_entropy: f64,
    total_chunks: u64,
}

#[pyclass(module = "lyceum_core")]
#[derive(Clone)]
pub struct LoopView {
    #[pyo3(get)]
    pub loop_detected: bool,
    #[pyo3(get)]
    pub jaccard: f64,
    #[pyo3(get)]
    pub entropy: f64,
    #[pyo3(get)]
    pub chunks: u64,
    #[pyo3(get)]
    pub note: String,
}

fn shingles(s: &str) -> HashSet<u64> {
    let b = s.as_bytes();
    let mut set = HashSet::new();
    if b.len() < 4 {
        set.insert(tokens::content_hash(b));
        return set;
    }
    for w in b.windows(4) {
        let mut h = 0xcbf29ce484222325u64;
        for &x in w {
            h ^= x as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        set.insert(h);
    }
    set
}

fn shingle_jaccard(a: &str, b: &str) -> f64 {
    let sa = shingles(a);
    let sb = shingles(b);
    if sa.is_empty() && sb.is_empty() {
        return 1.0;
    }
    let inter = sa.intersection(&sb).count();
    let union = sa.union(&sb).count();
    if union == 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

fn shannon_entropy(bytes: &[u8]) -> f64 {
    if bytes.is_empty() {
        return 0.0;
    }
    let mut hist = [0u64; 256];
    for &b in bytes {
        hist[b as usize] += 1;
    }
    let len = bytes.len() as f64;
    let mut h = 0.0;
    for &c in hist.iter() {
        if c > 0 {
            let p = c as f64 / len;
            h -= p * p.log2();
        }
    }
    h
}

impl SemanticLoopDetector {
    pub(crate) fn new_internal(window_size: usize, max_jaccard: f64, min_entropy: f64) -> Self {
        Self {
            window: VecDeque::new(),
            window_size: window_size.max(2),
            max_jaccard,
            min_entropy,
            total_chunks: 0,
        }
    }

    pub(crate) fn feed_internal(&mut self, chunk: &str) -> LoopView {
        self.total_chunks += 1;
        let sample: String = chunk.chars().take(MAX_CHUNK_SAMPLE).collect();
        self.window.push_back(sample);
        while self.window.len() > self.window_size {
            self.window.pop_front();
        }
        let n = self.window.len();
        if n < MIN_WINDOW || self.total_chunks < MIN_WINDOW as u64 {
            return LoopView {
                loop_detected: false,
                jaccard: 0.0,
                entropy: 0.0,
                chunks: self.total_chunks,
                note: "warming up".to_string(),
            };
        }
        let jaccard = if n >= 2 {
            shingle_jaccard(&self.window[n - 2], &self.window[n - 1])
        } else {
            0.0
        };
        let joined: String = self.window.iter().rev().take(4).cloned().collect::<Vec<_>>().join("\n");
        let entropy = shannon_entropy(joined.as_bytes());
        let enough = joined.len() >= ENTROPY_SAMPLE_MIN;
        let loop_detected = jaccard >= self.max_jaccard || (enough && entropy < self.min_entropy);
        let note = if loop_detected {
            if jaccard >= self.max_jaccard {
                format!("semantic loop: shingle Jaccard {jaccard:.2} ≥ {:.2}", self.max_jaccard)
            } else {
                format!("semantic loop: entropy {entropy:.2} < {:.2}", self.min_entropy)
            }
        } else {
            String::new()
        };
        LoopView {
            loop_detected,
            jaccard,
            entropy,
            chunks: self.total_chunks,
            note,
        }
    }
}

#[pymethods]
impl SemanticLoopDetector {
    #[new]
    #[pyo3(signature = (window_size=8, max_jaccard=0.75, min_entropy=2.0))]
    pub fn new(window_size: usize, max_jaccard: f64, min_entropy: f64) -> Self {
        Self::new_internal(window_size, max_jaccard, min_entropy)
    }

    /// Feed one stream chunk; `loop_detected=true` means: stop, keep the
    /// best text so far.
    pub fn feed(&mut self, chunk: &str) -> LoopView {
        self.feed_internal(chunk)
    }

    pub fn reset(&mut self) {
        self.window.clear();
        self.total_chunks = 0;
    }
}

/// Luật 3 + 4 + 5 combined output gate.
#[pyclass(module = "lyceum_core")]
pub struct OutputGate {
    known_urls: HashSet<String>,
    known_uuids: HashSet<String>,
    known_currency: HashSet<String>,
    json: JsonEnforcer,
    loops: SemanticLoopDetector,
    mask_unknown_urls: bool,
    track_currency: bool,
    track_uuids: bool,
}

/// One validated anchor. `known=false` means it was never in the seeded
/// context (candidate hallucination).
///
/// Clone is required so `#[pyo3(get)]` on `Vec<AnchorFindingView>` (inside
/// `OutputScanResult`) can hand a copy to Python.
#[pyclass(module = "lyceum_core")]
#[derive(Clone)]
pub struct AnchorFindingView {
    #[pyo3(get)]
    pub kind: &'static str, // "url" | "uuid" | "currency"
    #[pyo3(get)]
    pub value: String,
    #[pyo3(get)]
    pub known: bool,
}

#[pyclass(module = "lyceum_core")]
pub struct OutputScanResult {
    /// Output with unknown URLs replaced by "[Unverified Link]".
    #[pyo3(get)]
    pub masked: Py<PyStr>,
    #[pyo3(get)]
    pub findings: Vec<AnchorFindingView>,
}

impl OutputGate {
    pub(crate) fn new_internal(window_size: usize, max_jaccard: f64, min_entropy: f64) -> Self {
        Self {
            known_urls: HashSet::new(),
            known_uuids: HashSet::new(),
            known_currency: HashSet::new(),
            json: JsonEnforcer::new_internal(),
            loops: SemanticLoopDetector::new_internal(window_size, max_jaccard, min_entropy),
            mask_unknown_urls: true,
            track_currency: true,
            track_uuids: true,
        }
    }

    pub(crate) fn reset_internal(&mut self) {
        self.known_urls.clear();
        self.known_uuids.clear();
        self.known_currency.clear();
        self.json = JsonEnforcer::new_internal();
        self.loops.reset();
    }
}

#[pymethods]
impl OutputGate {
    #[new]
    #[pyo3(signature = (window_size=8, max_jaccard=0.75, min_entropy=2.0, mask_unknown_urls=true, track_currency=true, track_uuids=true))]
    pub fn new(
        window_size: usize,
        max_jaccard: f64,
        min_entropy: f64,
        mask_unknown_urls: bool,
        track_currency: bool,
        track_uuids: bool,
    ) -> Self {
        let mut g = Self::new_internal(window_size, max_jaccard, min_entropy);
        g.mask_unknown_urls = mask_unknown_urls;
        g.track_currency = track_currency;
        g.track_uuids = track_uuids;
        g
    }

    /// Luật 3, seed half: register the anchors that exist in the input
    /// context so they are not later flagged as hallucinated. Returns how
    /// many new anchors were added.
    pub fn seed_context(&mut self, input: &str) -> usize {
        let mut n = 0usize;
        for (_, _, u) in extract_urls(input) {
            if self.known_urls.insert(u) {
                n += 1;
            }
        }
        if self.track_uuids {
            for u in extract_uuids(input) {
                if self.known_uuids.insert(u) {
                    n += 1;
                }
            }
        }
        if self.track_currency {
            for c in extract_currency(input) {
                if self.known_currency.insert(c) {
                    n += 1;
                }
            }
        }
        n
    }

    /// Luật 3, scan half: validate anchors in the output. Unknown URLs are
    /// masked in `masked`; every anchor is listed in `findings`.
    pub fn egress<'py>(&self, py: Python<'py>, output: Bound<'py, PyStr>) -> PyResult<OutputScanResult> {
        let text: &str = output.to_str()?;
        let mut findings: Vec<AnchorFindingView> = Vec::new();
        let mut unknown_ranges: Vec<(usize, usize)> = Vec::new();

        for (s, e, val) in extract_urls(text) {
            let known = self.known_urls.contains(&val);
            if !known {
                unknown_ranges.push((s, e));
            }
            findings.push(AnchorFindingView { kind: "url", value: val, known });
        }
        if self.track_uuids {
            let mut seen = HashSet::new();
            for u in extract_uuids(text) {
                if seen.insert(u.clone()) {
                    let known = self.known_uuids.contains(&u);
                    findings.push(AnchorFindingView { kind: "uuid", value: u, known });
                }
            }
        }
        if self.track_currency {
            let mut seen = HashSet::new();
            for c in extract_currency(text) {
                if seen.insert(c.clone()) {
                    let known = self.known_currency.contains(&c);
                    findings.push(AnchorFindingView { kind: "currency", value: c, known });
                }
            }
        }

        let masked = if self.mask_unknown_urls && !unknown_ranges.is_empty() {
            mask_ranges(text, &unknown_ranges)
        } else {
            text.to_string()
        };
        Ok(OutputScanResult {
            masked: PyStr::new(py, &masked)?.unbind(),
            findings,
        })
    }

    /// Luật 4, streaming: feed a JSON stream chunk.
    pub fn feed_json(&mut self, chunk: &str) -> JsonStatusView {
        self.json.feed(chunk)
    }

    /// Luật 4, end of stream: auto-repair or report honestly.
    pub fn finish_json<'py>(&mut self, py: Python<'py>) -> PyResult<JsonRepairResult> {
        self.json.finish(py)
    }

    pub fn reset_json(&mut self) {
        self.json.reset();
    }

    /// Luật 5, streaming: feed one output chunk.
    pub fn feed_loop(&mut self, chunk: &str) -> LoopView {
        self.loops.feed_internal(chunk)
    }

    pub fn reset_loops(&mut self) {
        self.loops.reset();
    }

    pub fn known_urls(&self) -> usize {
        self.known_urls.len()
    }

    pub fn known_uuids(&self) -> usize {
        self.known_uuids.len()
    }

    pub fn known_currency(&self) -> usize {
        self.known_currency.len()
    }

    pub fn reset(&mut self) {
        self.reset_internal();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_extraction_trims_punctuation() {
        let t = "See https://docs.lyceum.dev/guide?q=1, and http://a.io!";
        let urls = extract_urls(t);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0].2, "https://docs.lyceum.dev/guide?q=1");
        assert_eq!(urls[1].2, "http://a.io");
    }

    #[test]
    fn uuid_extraction() {
        let t = "ref 3f2a8c1e-9b4d-4e6f-8a0b-1c2d3e4f5a6b end";
        assert_eq!(extract_uuids(t), vec!["3f2a8c1e-9b4d-4e6f-8a0b-1c2d3e4f5a6b"]);
    }

    #[test]
    fn currency_extraction() {
        assert_eq!(extract_currency("Price $1,200.50 and $5 done"), vec!["$1,200.50", "$5"]);
    }

    #[test]
    fn json_repairs_unclosed_brackets() {
        let mut j = JsonEnforcer::new_internal();
        j.feed("{\"a\": 1, \"b\": [2, 3");
        let (out, repaired, repairs, err) = j.finish_internal();
        assert!(repaired);
        assert_eq!(out, "{\"a\": 1, \"b\": [2, 3]}");
        assert_eq!(repairs.len(), 1);
        assert!(err.is_empty());
    }

    #[test]
    fn json_refuses_to_fabricate() {
        let mut j = JsonEnforcer::new_internal();
        j.feed("{\"a\": ");
        let (_, repaired, _, err) = j.finish_internal();
        assert!(!repaired);
        assert!(err.contains("refusing"));
    }

    #[test]
    fn json_balanced_is_not_repaired() {
        let mut j = JsonEnforcer::new_internal();
        j.feed("{\"a\": 1}");
        let (out, repaired, _, err) = j.finish_internal();
        assert!(!repaired);
        assert!(err.is_empty());
        assert_eq!(out, "{\"a\": 1}");
    }

    #[test]
    fn jaccard_identical_is_one() {
        assert_eq!(shingle_jaccard("same text here", "same text here"), 1.0);
        assert!(shingle_jaccard("the quick brown fox", "the slow green bear") < 0.6);
    }

    #[test]
    fn entropy_penalizes_repetition() {
        let repetitive = "yes yes yes yes yes yes yes yes yes yes yes yes yes";
        let varied = "the quick brown fox jumps over the lazy dog and keeps walking";
        assert!(shannon_entropy(repetitive.as_bytes()) < shannon_entropy(varied.as_bytes()));
    }

    #[test]
    fn loop_detector_fires_on_repeats() {
        let mut l = SemanticLoopDetector::new_internal(8, 0.75, 2.0);
        let mut fired = false;
        for _ in 0..12 {
            let v = l.feed_internal("Yes, absolutely. That is definitely correct. Yes, absolutely correct.");
            if v.loop_detected {
                fired = true;
                break;
            }
        }
        assert!(fired);
    }
}
