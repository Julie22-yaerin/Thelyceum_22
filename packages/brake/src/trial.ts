import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const TRIAL_STATE_PATH = join(homedir(), ".lyceum_trial_state.json");
export const TRIAL_LIMIT_MS = 2 * 24 * 60 * 60 * 1000;
export const TRIAL_LIMIT_CALLS = 10;

export function checkTrialLimits(): void {
  let state = { firstUseAt: 0, calls: 0 };
  if (existsSync(TRIAL_STATE_PATH)) {
    try {
      state = JSON.parse(readFileSync(TRIAL_STATE_PATH, "utf-8"));
    } catch {
      // Ignore parse error, start fresh
    }
  }

  const now = Date.now();
  if (state.firstUseAt === 0) {
    state.firstUseAt = now;
  }

  if (now - state.firstUseAt > TRIAL_LIMIT_MS) {
    throw new Error("Trial expired: 2 days have passed since first use.");
  }

  if (state.calls >= TRIAL_LIMIT_CALLS) {
    throw new Error("Trial expired: 10 uses maximum reached.");
  }

  state.calls += 1;
  writeFileSync(TRIAL_STATE_PATH, JSON.stringify(state));
}
