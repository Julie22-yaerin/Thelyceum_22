//! The token-budget state machine.
//!
//! Mirrors the server's `budgetStatus` semantics: a per-session token budget
//! with three states — `ok`, `warn` (past BUDGET_WARN_PCT) and `over` (past
//! 100%). The state is derived, not stored: `record()` advances counters and
//! `status()` classifies them, so the machine can never drift from the math.
//!
//! In the cloud this is the gate that answers "is this fleet burning 10× what
//! it planned?" — the tripwire that makes a runaway loop visible before it
//! becomes a bill.

/// Budget states, ordered so comparisons make sense.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BudgetState {
    Ok,
    Warn,
    Over,
}

impl BudgetState {
    pub fn code(self) -> &'static str {
        match self {
            BudgetState::Ok => "ok",
            BudgetState::Warn => "warn",
            BudgetState::Over => "over",
        }
    }
}

/// A point-in-time snapshot of budget usage.
#[derive(Debug, Clone, Copy)]
pub struct BudgetSnapshot {
    pub budget_tokens: u64,
    pub used_tokens: u64,
    /// Floored at zero — never negative, even past the budget.
    pub remaining_tokens: u64,
    pub calls: u64,
    /// 0.0–1.0+ (can exceed 1.0 past the budget).
    pub pct: f64,
    pub state: BudgetState,
}

pub struct BudgetTracker {
    budget_tokens: u64,
    warn_pct: f64,
    used_tokens: u64,
    calls: u64,
}

impl BudgetTracker {
    pub fn new(budget_tokens: u64, warn_pct: f64) -> Self {
        Self {
            budget_tokens,
            warn_pct: warn_pct.clamp(0.0, 1.0),
            used_tokens: 0,
            calls: 0,
        }
    }

    pub fn reset(&mut self) {
        self.used_tokens = 0;
        self.calls = 0;
    }

    /// Record tokens spent, advance the counters, return the new snapshot.
    pub fn record(&mut self, tokens: u64) -> BudgetSnapshot {
        self.used_tokens += tokens;
        self.calls += 1;
        self.snapshot()
    }

    pub fn snapshot(&self) -> BudgetSnapshot {
        let pct = if self.budget_tokens > 0 {
            self.used_tokens as f64 / self.budget_tokens as f64
        } else {
            // A zero budget means "no budget configured": never report over.
            0.0
        };
        let state = if pct >= 1.0 {
            BudgetState::Over
        } else if pct >= self.warn_pct {
            BudgetState::Warn
        } else {
            BudgetState::Ok
        };
        BudgetSnapshot {
            budget_tokens: self.budget_tokens,
            used_tokens: self.used_tokens,
            remaining_tokens: self.budget_tokens.saturating_sub(self.used_tokens),
            calls: self.calls,
            pct,
            state,
        }
    }
}
