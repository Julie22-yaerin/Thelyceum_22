//! lyceum_core — Rust state machine for context deduplication and token
//! budget tracking, exposed to Python via PyO3.
//!
//! # Zero-copy contract
//!
//! The hot path is `ContextGuard.process()`:
//!
//!   1. INPUT is borrowed, never copied. `content: Bound<'py, PyStr>` is
//!      converted with `.to_str()?`, which returns a `&str` pointing straight
//!      into the Python str's own UTF-8 buffer. The hash and the token
//!      estimate both run over those borrowed bytes. Nothing is marshalled
//!      into a Rust-owned `String`.
//!   2. PASSTHROUGH returns the *same* `Py<PyStr>` object (`content.unbind()`)
//!      — a reference-count bump, not a copy. Python gets back the identical
//!      object it handed us.
//!   3. The only allocation is the dedupe POINTER string, which is tiny and
//!      is the entire point of the call (it replaces megabytes of content).
//!   4. Budget state is two integers; no copying at all.
//!
//! So: zero copies of the payload in both directions. The measured win is the
//! same one thrift documents — dedupe turns N re-reads of the same content
//! into N pointer strings.

mod budget;
mod dedupe;
mod input_gate;
mod output_gate;
mod tokens;

use budget::{BudgetSnapshot, BudgetTracker};
use dedupe::{CheckOutcome, Deduplicator};
use input_gate::{InputGate, InputGateResult};
use output_gate::{
    AnchorFindingView, JsonEnforcer, JsonRepairResult, JsonStatusView, LoopView, OutputGate,
    OutputScanResult, SemanticLoopDetector,
};
use pyo3::prelude::*;
use pyo3::types::PyStr;

/// Combined session guard: one object that both dedupes repeated content and
/// tracks the token budget for the session it belongs to.
#[pyclass(module = "lyceum_core")]
pub struct ContextGuard {
    deduper: Deduplicator,
    budget: BudgetTracker,
}

/// Result of one `process()` call.
#[pyclass(module = "lyceum_core")]
pub struct ProcessResult {
    /// "dedupe" → `payload` is a pointer string; the content is already in
    /// context. "passthrough" → `payload` is the original content object.
    #[pyo3(get)]
    pub action: &'static str,
    /// Either a pointer string (dedupe) or the original content (passthrough).
    #[pyo3(get)]
    pub payload: Py<PyStr>,
    /// Estimated tokens saved by this call (content tokens − pointer tokens).
    #[pyo3(get)]
    pub tokens_saved: u64,
    /// Budget state after this call.
    #[pyo3(get)]
    pub snapshot: BudgetSnapshotView,
}

/// A Python-visible, value-copied budget snapshot (fields are plain numbers).
#[pyclass(module = "lyceum_core")]
#[derive(Clone)]
pub struct BudgetSnapshotView {
    #[pyo3(get)]
    pub budget_tokens: u64,
    #[pyo3(get)]
    pub used_tokens: u64,
    #[pyo3(get)]
    pub remaining_tokens: u64,
    #[pyo3(get)]
    pub calls: u64,
    #[pyo3(get)]
    pub pct: f64,
    #[pyo3(get)]
    pub state: String,
}

impl From<BudgetSnapshot> for BudgetSnapshotView {
    fn from(s: BudgetSnapshot) -> Self {
        Self {
            budget_tokens: s.budget_tokens,
            used_tokens: s.used_tokens,
            remaining_tokens: s.remaining_tokens,
            calls: s.calls,
            pct: s.pct,
            state: s.state.code().to_string(),
        }
    }
}

#[pymethods]
impl ContextGuard {
    /// Create a session guard.
    ///
    /// * `budget_tokens` — session token budget; 0 disables the over gate.
    /// * `warn_pct` — fraction past which status flips to "warn" (default 0.8).
    /// * `max_dedupe_age_calls` — dedupe pointer expiry in intervening calls.
    /// * `max_dedupe_age_tokens` — dedupe pointer expiry in tokens emitted by
    ///   other content since the sighting (context-compaction tripwire).
    #[new]
    #[pyo3(signature = (budget_tokens=0, warn_pct=0.8, max_dedupe_age_calls=20, max_dedupe_age_tokens=40_000))]
    pub fn new(
        budget_tokens: u64,
        warn_pct: f64,
        max_dedupe_age_calls: u64,
        max_dedupe_age_tokens: u64,
    ) -> Self {
        Self {
            deduper: Deduplicator::new(max_dedupe_age_calls, max_dedupe_age_tokens),
            budget: BudgetTracker::new(budget_tokens, warn_pct),
        }
    }

    /// Process one piece of content.
    ///
    /// `source` is the stable id of the content (file path, tool name, URL).
    /// The content is borrowed, never copied; a passthrough returns the exact
    /// same Python object.
    #[pyo3(signature = (source, content))]
    pub fn process<'py>(
        &mut self,
        py: Python<'py>,
        source: &str,
        content: Bound<'py, PyStr>,
    ) -> PyResult<ProcessResult> {
        // Borrow the Python str's buffer — zero copy.
        let text: &str = content.to_str()?;
        let hash = tokens::content_hash(text.as_bytes());
        let tokens = tokens::estimate_tokens(text.as_bytes());

        match self.deduper.check(source, hash, tokens) {
            CheckOutcome::Pointer { age_calls } => {
                let pointer = format!(
                    "[lyceum: unchanged since call #{} — {} call{} ago ({tokens} tokens). \
                     Content omitted because it is already in context. Say \"re-read {source}\" \
                     to force a full read.]",
                    self.deduper.call_count() - age_calls,
                    age_calls,
                    if age_calls == 1 { "" } else { "s" },
                );
                let ptr_tokens = tokens::estimate_tokens(pointer.as_bytes());
                self.deduper.record_emission(ptr_tokens);
                let pointer_obj = PyStr::new(py, &pointer)?.unbind();
                Ok(ProcessResult {
                    action: "dedupe",
                    payload: pointer_obj,
                    tokens_saved: tokens.saturating_sub(ptr_tokens),
                    snapshot: self.budget.snapshot().into(),
                })
            }
            CheckOutcome::Full { .. } => {
                self.deduper.record_emission(tokens);
                let snapshot = self.budget.record(tokens).into();
                // Return the SAME object the caller passed in — a refcount bump,
                // not a copy.
                Ok(ProcessResult {
                    action: "passthrough",
                    payload: content.unbind(),
                    tokens_saved: 0,
                    snapshot,
                })
            }
        }
    }

    /// Register budget spend without content (e.g. tokens counted by the SDK
    /// after a call returns). Returns the post-spend snapshot.
    #[pyo3(signature = (tokens))]
    pub fn spend(&mut self, tokens: u64) -> BudgetSnapshotView {
        self.budget.record(tokens).into()
    }

    /// Current budget snapshot without spending anything.
    pub fn budget(&self) -> BudgetSnapshotView {
        self.budget.snapshot().into()
    }

    /// How many distinct sources are being tracked.
    pub fn tracked_sources(&self) -> usize {
        self.deduper.len()
    }

    /// Reset the whole session: all sightings and the budget counters.
    pub fn reset(&mut self) {
        self.deduper.reset();
        self.budget.reset();
    }
}

/// Standalone budget state machine (useful without dedupe).
#[pyclass(module = "lyceum_core")]
pub struct BudgetTrackerPy {
    inner: BudgetTracker,
}

#[pymethods]
impl BudgetTrackerPy {
    #[new]
    #[pyo3(signature = (budget_tokens, warn_pct=0.8))]
    fn new(budget_tokens: u64, warn_pct: f64) -> Self {
        Self { inner: BudgetTracker::new(budget_tokens, warn_pct) }
    }

    fn record(&mut self, tokens: u64) -> BudgetSnapshotView {
        self.inner.record(tokens).into()
    }

    fn snapshot(&self) -> BudgetSnapshotView {
        self.inner.snapshot().into()
    }

    fn reset(&mut self) {
        self.inner.reset();
    }
}

/// Standalone dedupe state machine (useful without budget).
#[pyclass(module = "lyceum_core")]
pub struct DeduplicatorPy {
    inner: Deduplicator,
}

#[pymethods]
impl DeduplicatorPy {
    #[new]
    #[pyo3(signature = (max_dedupe_age_calls=20, max_dedupe_age_tokens=40_000))]
    fn new(max_dedupe_age_calls: u64, max_dedupe_age_tokens: u64) -> Self {
        Self { inner: Deduplicator::new(max_dedupe_age_calls, max_dedupe_age_tokens) }
    }

    /// Returns "dedupe" (pointer granted) or "full".
    #[pyo3(signature = (source, content))]
    pub fn check<'py>(
        &mut self,
        py: Python<'py>,
        source: &str,
        content: Bound<'py, PyStr>,
    ) -> PyResult<(String, Py<PyStr>)> {
        let text: &str = content.to_str()?;
        let hash = tokens::content_hash(text.as_bytes());
        let tokens = tokens::estimate_tokens(text.as_bytes());
        match self.inner.check(source, hash, tokens) {
            CheckOutcome::Pointer { .. } => {
                let pointer = format!("[lyceum: already in context — say \"re-read {source}\" to force a full read.]");
                let ptr_tokens = tokens::estimate_tokens(pointer.as_bytes());
                self.inner.record_emission(ptr_tokens);
                Ok(("dedupe".to_string(), PyStr::new(py, &pointer)?.unbind()))
            }
            CheckOutcome::Full { .. } => {
                self.inner.record_emission(tokens);
                Ok(("full".to_string(), content.unbind()))
            }
        }
    }

    fn reset(&mut self) {
        self.inner.reset();
    }

    fn tracked_sources(&self) -> usize {
        self.inner.len()
    }
}

/// One-shot estimate: tokens in a string, using the same heuristic as the
/// process path. Exactness is the server's job.
#[pyfunction]
#[pyo3(signature = (text))]
pub fn estimate_tokens_py<'py>(py: Python<'py>, text: Bound<'py, PyStr>) -> PyResult<u64> {
    let s: &str = text.to_str()?;
    Ok(tokens::estimate_tokens(s.as_bytes()))
}

/// The Dual-Gate architecture from the Red Team spec, one object:
///
///   Trạm Gác 1 (INGRESS) — `ingress()` strips context noise, dedupes
///     repeats, blocks prompt injection and flags false premises.
///   Trạm Gác 2 (EGRESS) — `egress()` validates fact anchors (masking
///     unverified URLs), `feed_json`/`finish_json` auto-repair broken JSON
///     on the stream, `feed_loop` kills semantic loops.
///
/// Plus the session budget (ok → warn → over) shared by both gates.
#[pyclass(module = "lyceum_core")]
pub struct DualGate {
    input: InputGate,
    output: OutputGate,
    budget: BudgetTracker,
}

#[pymethods]
impl DualGate {
    #[new]
    #[pyo3(signature = (budget_tokens=0, warn_pct=0.8, strict=true, window_size=8, max_jaccard=0.75, min_entropy=2.0))]
    pub fn new(
        budget_tokens: u64,
        warn_pct: f64,
        strict: bool,
        window_size: usize,
        max_jaccard: f64,
        min_entropy: f64,
    ) -> Self {
        Self {
            input: InputGate::new_internal(strict, 20, 40_000),
            output: OutputGate::new_internal(window_size, max_jaccard, min_entropy),
            budget: BudgetTracker::new(budget_tokens, warn_pct),
        }
    }

    /// Trạm Gác 1 — process one incoming prompt/tool payload.
    pub fn ingress<'py>(
        &mut self,
        py: Python<'py>,
        source: &str,
        content: Bound<'py, PyStr>,
    ) -> PyResult<InputGateResult> {
        self.input.process(py, source, content)
    }

    /// Trạm Gác 2, seed half — register context anchors before scanning.
    pub fn seed_context(&mut self, input: &str) -> usize {
        self.output.seed_context(input)
    }

    /// Trạm Gác 2, scan half — validate anchors in the model's output.
    pub fn egress<'py>(
        &self,
        py: Python<'py>,
        output: Bound<'py, PyStr>,
    ) -> PyResult<OutputScanResult> {
        self.output.egress(py, output)
    }

    /// Trạm Gác 2, Luật 4 — feed a JSON stream chunk.
    pub fn feed_json(&mut self, chunk: &str) -> JsonStatusView {
        self.output.feed_json(chunk)
    }

    /// Trạm Gác 2, Luật 4 — end of stream, auto-repair or report.
    pub fn finish_json<'py>(&mut self, py: Python<'py>) -> PyResult<JsonRepairResult> {
        self.output.finish_json(py)
    }

    /// Trạm Gác 2, Luật 5 — feed one output chunk; true means stop the stream.
    pub fn feed_loop(&mut self, chunk: &str) -> LoopView {
        self.output.feed_loop(chunk)
    }

    /// Count SDK-reported spend (shared session budget).
    pub fn spend(&mut self, tokens: u64) -> BudgetSnapshotView {
        self.budget.record(tokens).into()
    }

    /// Current budget state without spending.
    pub fn budget(&self) -> BudgetSnapshotView {
        self.budget.snapshot().into()
    }

    /// New session: clear all gate state and budget counters.
    pub fn reset(&mut self) {
        self.input.reset();
        self.output.reset();
        self.budget.reset();
    }
}

/// Register the module.
#[pymodule]
fn lyceum_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<ContextGuard>()?;
    m.add_class::<BudgetTrackerPy>()?;
    m.add_class::<DeduplicatorPy>()?;
    m.add_class::<ProcessResult>()?;
    m.add_class::<BudgetSnapshotView>()?;
    m.add_class::<InputGate>()?;
    m.add_class::<InputGateResult>()?;
    m.add_class::<OutputGate>()?;
    m.add_class::<OutputScanResult>()?;
    m.add_class::<AnchorFindingView>()?;
    m.add_class::<JsonEnforcer>()?;
    m.add_class::<JsonStatusView>()?;
    m.add_class::<JsonRepairResult>()?;
    m.add_class::<SemanticLoopDetector>()?;
    m.add_class::<LoopView>()?;
    m.add_class::<DualGate>()?;
    m.add_function(wrap_pyfunction!(estimate_tokens_py, m)?)?;
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    Ok(())
}
