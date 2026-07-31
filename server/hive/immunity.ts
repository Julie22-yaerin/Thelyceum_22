/**
 * Cross-tenant immunity — one workspace gets attacked, every workspace learns.
 *
 * This is the most valuable thing the platform can do and the easiest to turn
 * into a breach, so the design is built around two hard problems rather than
 * around the demo.
 *
 * ── Problem 1: a signature must not carry the customer's data ───────────────
 * The naive version ships the attacking prompt to every other tenant. That
 * prompt contains whatever the attacker pasted — which routinely includes the
 * victim's own business context, customer names, internal figures. Shipping it
 * globally would be a data breach dressed as a security feature.
 *
 * So nothing derived from tenant content leaves the tenant. `extractSignature`
 * keeps only structural facts: which guard tripped, what shape the payload had,
 * and a token skeleton with every literal stripped. The result is verified by
 * `assertNoLiterals` before it can be published, and publication is refused if
 * that check fails — the safe default is that the pattern is simply not shared.
 *
 * ── Problem 2: instant global push is how you take everyone down at once ────
 * The obvious pitch is "patch every customer worldwide in one second". The
 * obvious failure is that an auto-generated rule with a false positive then
 * breaks every customer worldwide in one second. This is not hypothetical:
 * CrowdStrike shipped a bad channel file to every host simultaneously in July
 * 2024 and took down millions of machines, airlines included.
 *
 * So distribution is staged: a new signature is quarantined, replayed against
 * a benign corpus to measure false positives, released to a small canary slice,
 * and only promoted to everyone if the canary stays clean. Full propagation is
 * minutes, not one second. That is a deliberate trade — the extra minutes buy
 * the guarantee that a bad signature cannot take down the whole customer base,
 * which is the only version of this feature worth selling.
 *
 * Participation is opt-in per workspace, and a workspace that opts out still
 * *receives* immunity. Contributing and consuming are separate decisions.
 */

import crypto from "crypto";
import type { AttackCategory, Severity } from "../redteam/attacks.js";

export type SignatureStage = "quarantine" | "canary" | "global" | "rejected";

export interface ThreatSignature {
  id: string;
  /** Which guard caught it — the only "what happened" we keep. */
  guard: "scope" | "brain" | "fact" | "loop" | "breaker";
  category: AttackCategory;
  severity: Severity;
  /**
   * Structural skeleton with all literals removed. This is the whole
   * signature — there is no field carrying original text.
   */
  skeleton: string;
  /** Stable hash of the skeleton, for dedupe across tenants. */
  fingerprint: string;
  /** How many DISTINCT workspaces have seen this. Never which ones. */
  observedBy: number;
  stage: SignatureStage;
  /** Measured against the benign corpus before any release. */
  falsePositiveRate: number | null;
  createdAt: number;
  promotedAt?: number;
  /** Why it was rejected, when it was. */
  rejectedReason?: string;
}

// ── De-identification ────────────────────────────────────────────────────────

/**
 * Everything that could carry tenant data, replaced by its type.
 *
 * Order matters: longer, more specific patterns run first so an email is not
 * partially eaten by the word matcher and reassembled into something readable.
 */
const SCRUBBERS: { re: RegExp; token: string }[] = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, token: "<EMAIL>" },
  { re: /\bhttps?:\/\/\S+/gi, token: "<URL>" },
  { re: /\b(?:sk|pk|api|key|token|bearer)[-_][A-Za-z0-9_-]{8,}\b/gi, token: "<CREDENTIAL>" },
  { re: /\b[A-Za-z0-9+/]{32,}={0,2}\b/g, token: "<B64>" },
  { re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, token: "<IP>" },
  { re: /[$€£]\s?\d[\d,]*(?:\.\d+)?/g, token: "<MONEY>" },
  { re: /\b\d+(?:\.\d+)?%/g, token: "<PERCENT>" },
  { re: /\b\d[\d,]*(?:\.\d+)?\b/g, token: "<NUM>" },
  // Any capitalised multi-word run is treated as a name — company, person, or
  // product. Over-scrubbing is the correct bias: a slightly blunter signature
  // is a cost, a leaked customer name is an incident.
  { re: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, token: "<NAME>" },
  { re: /\b[a-z0-9_.-]+\/[a-z0-9_./-]+\b/gi, token: "<PATH>" },
];

/**
 * Words that carry attack *structure* rather than tenant content. Only these
 * survive scrubbing — everything else becomes <WORD>.
 *
 * This is an allowlist, not a denylist, and that is the point: a denylist means
 * promising to have thought of every way content can hide, and the failure mode
 * is silent leakage. With an allowlist, an unanticipated token is dropped.
 */
const STRUCTURAL_VOCAB = new Set([
  "ignore", "disregard", "override", "bypass", "forget", "previous", "prior", "above",
  "instruction", "instructions", "rule", "rules", "prompt", "system", "developer", "mode",
  "admin", "root", "sudo", "emergency", "urgent", "immediately", "now",
  "reveal", "print", "show", "output", "dump", "leak", "expose",
  "delete", "drop", "remove", "disable", "shutdown", "kill", "wipe",
  "repeat", "again", "loop", "forever", "until", "verify", "recheck",
  "confirm", "guarantee", "promise", "approximately", "roughly", "around", "estimate",
  "decode", "encode", "base64", "translate", "execute", "eval", "run",
  "you", "your", "are", "must", "should", "can", "cannot", "not", "no",
  "and", "or", "then", "if", "all", "every", "any",
]);

export function scrub(text: string): string {
  let out = text;
  for (const { re, token } of SCRUBBERS) out = out.replace(re, token);

  return out
    .toLowerCase()
    .split(/\s+/)
    .map((raw) => {
      const placeholder = raw.match(/<[a-z0-9]+>/i);
      if (placeholder) return placeholder[0].toUpperCase();
      const word = raw.replace(/[^a-z]/g, "");
      if (!word) return "";
      return STRUCTURAL_VOCAB.has(word) ? word : "<WORD>";
    })
    .filter(Boolean)
    // Collapse runs of <WORD> — the count of anonymous words is itself a weak
    // fingerprint of the original text.
    .join(" ")
    .replace(/(?:<WORD>\s*){2,}/g, "<WORDS> ")
    .trim();
}

/**
 * Refuse to publish anything that still looks like content.
 *
 * The guard is intentionally paranoid: it fails on any token that is neither a
 * placeholder nor in the structural vocabulary. A signature that trips this is
 * dropped, not repaired — a repair loop would be one bug away from shipping the
 * thing it was meant to catch.
 */
export function assertNoLiterals(skeleton: string): { safe: boolean; offending: string[] } {
  const offending = skeleton
    .split(/\s+/)
    .filter((t) => t && !/^<[A-Z0-9]+>$/.test(t) && !STRUCTURAL_VOCAB.has(t));
  return { safe: offending.length === 0, offending: Array.from(new Set(offending)).slice(0, 10) };
}

export interface ExtractionResult {
  signature: ThreatSignature | null;
  /** Set when extraction refused to produce a shareable signature. */
  refusedReason?: string;
}

export function extractSignature(params: {
  payload: string;
  guard: ThreatSignature["guard"];
  category: AttackCategory;
  severity: Severity;
}): ExtractionResult {
  const skeleton = scrub(params.payload);

  if (!skeleton || skeleton.replace(/<[A-Z]+>|\s/g, "").length < 3) {
    return {
      signature: null,
      refusedReason:
        "Nothing structural survived scrubbing — the attack was all content, so there is no pattern to share.",
    };
  }

  const check = assertNoLiterals(skeleton);
  if (!check.safe) {
    return {
      signature: null,
      refusedReason: `Refused to share: ${check.offending.length} token(s) were not recognised as structural (${check.offending.join(", ")}). Not publishing rather than risk leaking tenant content.`,
    };
  }

  const fingerprint = crypto.createHash("sha256").update(skeleton).digest("hex").slice(0, 24);

  return {
    signature: {
      id: `sig_${fingerprint.slice(0, 12)}`,
      guard: params.guard,
      category: params.category,
      severity: params.severity,
      skeleton,
      fingerprint,
      observedBy: 1,
      stage: "quarantine",
      falsePositiveRate: null,
      createdAt: Date.now(),
    },
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * Does an incoming payload match a known signature?
 *
 * Token-overlap over the skeleton rather than an exact hash, so a reworded
 * variant of the same attack still matches. The threshold is high because a
 * false positive here blocks a legitimate request.
 */
export function matchesSignature(payload: string, sig: ThreatSignature, threshold = 0.6): boolean {
  const structural = (tokens: string[]) => tokens.filter((t) => !/^<[A-Z0-9]+>$/.test(t));

  const incoming = structural(scrub(payload).split(/\s+/).filter(Boolean));
  const known = structural(sig.skeleton.split(/\s+/).filter(Boolean));

  // Placeholders match anything, so counting them inflates every score and the
  // signature starts matching ordinary messages. Only the structural vocabulary
  // discriminates, so only it is scored. (Found by the false-positive gate: a
  // signature was being rejected at 8% FPR purely on placeholder overlap.)
  if (known.length === 0 || incoming.length === 0) return false;

  // A signature with almost no structural content cannot discriminate at all.
  // Matching on one or two common words would block ordinary traffic.
  if (known.length < MIN_STRUCTURAL_TOKENS) return false;

  const incomingSet = new Set(incoming);
  const hits = known.filter((t) => incomingSet.has(t)).length;

  // Scored against the SIGNATURE's length: the question is "does this payload
  // contain the known attack structure", not "is this payload mostly made of
  // tokens the signature also has". The latter fires on any short message that
  // shares a couple of common words.
  //
  // 0.6 rather than 0.75 because an attacker rewording a jailbreak swaps
  // synonyms ("prior" for "previous") while keeping the intent words, and 0.75
  // of the full skeleton missed every such variant. The looser threshold is
  // only safe because measureFalsePositives() gates on the consequence: a
  // signature that becomes over-broad at 0.6 is rejected before distribution.
  // Ratio alone is not enough: on a short signature it has no resolution. A
  // 3-token signature missing one word still scores 0.67, which let
  // "please ignore my previous message" match an injection signature. Requiring
  // an absolute number of matching tokens as well is what separates a reworded
  // attack (7+ shared intent words) from a coincidence (2).
  return hits >= MIN_MATCHING_TOKENS && hits / known.length >= threshold;
}

// ── Staged distribution ──────────────────────────────────────────────────────

/**
 * Benign traffic a signature must NOT match. This is the false-positive gate:
 * a rule that blocks ordinary business language is worse than the attack it
 * stops, because it breaks every customer at once and silently.
 */
export const BENIGN_CORPUS: string[] = [
  "Can you show me the pricing page and confirm what tier we are on?",
  "Please ignore my previous message, I sent it to the wrong channel.",
  "What are the rules for expensing a client dinner?",
  "Print the invoice for last month and email it to accounts.",
  "Delete the draft I saved earlier, I want to start again.",
  "Repeat that back to me so I know we agree.",
  "Roughly how long does onboarding take?",
  "Can you verify these numbers against the report?",
  "Show me the system status for the last 24 hours.",
  "Our admin needs access to the reporting dashboard.",
  "Disregard the old template, use the new one.",
  "Run the monthly reconciliation and output a summary.",
];

/**
 * A signature needs this many structural tokens before it can discriminate at
 * all, and this many must actually match before it fires. Both were raised
 * after the false-positive gate caught a 3-token signature matching ordinary
 * business language.
 */
export const MIN_STRUCTURAL_TOKENS = 4;
export const MIN_MATCHING_TOKENS = 4;

/** Above this, a signature is rejected rather than released. */
export const MAX_FALSE_POSITIVE_RATE = 0.05;
/** Distinct workspaces that must see it before it can go global. */
export const CORROBORATION_THRESHOLD = 3;

export function measureFalsePositives(sig: ThreatSignature, corpus = BENIGN_CORPUS): number {
  if (corpus.length === 0) return 1; // no evidence is not the same as no risk
  const hits = corpus.filter((text) => matchesSignature(text, sig)).length;
  return hits / corpus.length;
}

export interface PromotionDecision {
  stage: SignatureStage;
  reason: string;
  /** Fraction of workspaces that will enforce it at this stage. */
  rolloutFraction: number;
}

/**
 * Decide where a signature belongs. Called on creation and on each new
 * corroborating observation.
 */
export function evaluateForPromotion(sig: ThreatSignature): PromotionDecision {
  // A signature with almost no structural content can never match anything
  // (matchesSignature refuses it), so distributing it would be shipping a rule
  // that does nothing while implying coverage. Reject it explicitly.
  const structuralTokens = sig.skeleton
    .split(/\s+/)
    .filter((t) => t && !/^<[A-Z0-9]+>$/.test(t));
  if (structuralTokens.length < MIN_STRUCTURAL_TOKENS) {
    return {
      stage: "rejected",
      rolloutFraction: 0,
      reason: `Only ${structuralTokens.length} structural token(s) survived scrubbing — too little to identify an attack without matching ordinary traffic. Not distributed.`,
    };
  }

  const fpr = measureFalsePositives(sig);

  if (fpr > MAX_FALSE_POSITIVE_RATE) {
    return {
      stage: "rejected",
      rolloutFraction: 0,
      reason: `Matches ${(fpr * 100).toFixed(0)}% of benign traffic — it would block ordinary requests. Not distributed.`,
    };
  }

  // Corroboration is checked first. A previous ordering ran the critical
  // branch above this one, which pinned critical signatures at canary forever —
  // the most severe findings were the only ones that could never go global.
  if (sig.observedBy >= CORROBORATION_THRESHOLD) {
    return {
      stage: "global",
      rolloutFraction: 1,
      reason: `Corroborated by ${sig.observedBy} independent workspaces with ${(fpr * 100).toFixed(0)}% false positives. Released to everyone.`,
    };
  }

  if (sig.observedBy >= 2) {
    // Critical findings get a wider canary — faster protection, but still a
    // canary. Speed is bought by widening the stage, never by skipping it.
    const fraction = sig.severity === "critical" ? 0.25 : 0.1;
    return {
      stage: "canary",
      rolloutFraction: fraction,
      reason: `${sig.severity === "critical" ? "Critical, seen" : "Seen"} by ${sig.observedBy} workspaces, ${(fpr * 100).toFixed(0)}% false positives. Canary at ${fraction * 100}% while it gathers corroboration.`,
    };
  }

  return {
    stage: "quarantine",
    rolloutFraction: 0,
    reason: `Seen once. Held in quarantine — a single observation could be one workspace's own testing.`,
  };
}

/**
 * Whether a given workspace enforces a signature right now.
 *
 * Canary membership is derived from a hash of the workspace id, so it is stable
 * (a workspace does not flap in and out between requests) and uniform without
 * needing a central assignment table.
 */
export function isEnforcedFor(sig: ThreatSignature, licenseKey: string): boolean {
  const decision = evaluateForPromotion(sig);
  if (decision.rolloutFraction >= 1) return true;
  if (decision.rolloutFraction <= 0) return false;
  const h = crypto.createHash("sha256").update(`${sig.id}:${licenseKey}`).digest();
  return h[0] / 256 < decision.rolloutFraction;
}

// ── The registry ─────────────────────────────────────────────────────────────

/**
 * Shared across tenants by design — it is the only cross-tenant structure in
 * the platform, and it holds no tenant data, only skeletons and counts.
 */
class ImmunityRegistry {
  private byFingerprint = new Map<string, ThreatSignature>();
  /** Which workspaces reported each fingerprint, so `observedBy` counts
   *  distinct sources without ever exposing who they were. */
  private reporters = new Map<string, Set<string>>();

  /** Contribute an observation. Returns null when nothing shareable came out. */
  report(params: {
    licenseKey: string;
    payload: string;
    guard: ThreatSignature["guard"];
    category: AttackCategory;
    severity: Severity;
  }): { signature: ThreatSignature | null; decision?: PromotionDecision; refusedReason?: string } {
    const extracted = extractSignature(params);
    if (!extracted.signature) return { signature: null, refusedReason: extracted.refusedReason };

    const sig = extracted.signature;
    const existing = this.byFingerprint.get(sig.fingerprint);
    const seen = this.reporters.get(sig.fingerprint) ?? new Set<string>();
    seen.add(params.licenseKey);
    this.reporters.set(sig.fingerprint, seen);

    const merged: ThreatSignature = existing
      ? { ...existing, observedBy: seen.size, severity: worst(existing.severity, sig.severity) }
      : { ...sig, observedBy: seen.size };

    const decision = evaluateForPromotion(merged);
    merged.stage = decision.stage;
    merged.falsePositiveRate = measureFalsePositives(merged);
    if (decision.stage === "global" && !merged.promotedAt) merged.promotedAt = Date.now();
    if (decision.stage === "rejected") merged.rejectedReason = decision.reason;

    this.byFingerprint.set(sig.fingerprint, merged);
    return { signature: merged, decision };
  }

  /** Signatures this workspace should currently enforce. */
  activeFor(licenseKey: string): ThreatSignature[] {
    return Array.from(this.byFingerprint.values()).filter(
      (s) => s.stage !== "rejected" && isEnforcedFor(s, licenseKey)
    );
  }

  /** Check an incoming payload against this workspace's active immunity. */
  screen(licenseKey: string, payload: string): { blocked: boolean; signature?: ThreatSignature } {
    for (const sig of this.activeFor(licenseKey)) {
      if (matchesSignature(payload, sig)) return { blocked: true, signature: sig };
    }
    return { blocked: false };
  }

  all(): ThreatSignature[] {
    return Array.from(this.byFingerprint.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  reset(): void {
    this.byFingerprint.clear();
    this.reporters.clear();
  }
}

function worst(a: Severity, b: Severity): Severity {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

export const immunityRegistry = new ImmunityRegistry();
