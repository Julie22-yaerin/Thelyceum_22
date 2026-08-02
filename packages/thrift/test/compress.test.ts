/**
 * Compressor invariants.
 *
 * The dangerous failure here is not "saved less than hoped" — it is a
 * compression that silently loses the one line the agent needed, causing a
 * retry that costs more than the saving. So these tests are weighted toward
 * two properties:
 *
 *   1. Nothing is ever removed without a marker saying so.
 *   2. Compressing never makes the payload larger.
 *
 * Everything else is secondary.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { compress, SeenLedger } from "../src/compress.js";
import { estimateTokens } from "../src/tokens.js";
import { isLossless } from "../src/ledger.js";

let ledger: SeenLedger;
beforeEach(() => {
  ledger = new SeenLedger();
});

const bigFile = (lines = 400) =>
  Array.from({ length: lines }, (_, i) => `export function fn${i}() { return ${i}; }`).join("\n");

describe("the two invariants", () => {
  it("never returns more tokens than it received", () => {
    // Every mechanism adds a marker, and on small input a marker can cost more
    // than it saves. A tool that charges MORE tokens while claiming a saving is
    // worse than one that does nothing.
    const inputs = [
      "",
      "x",
      "short line",
      "a\nb\nc",
      JSON.stringify({ a: 1 }),
      bigFile(500),
      "\n".repeat(50),
    ];
    for (const input of inputs) {
      const r = compress(input, ledger, { sourceId: `s-${input.length}-${Math.random()}` });
      expect(r.after.tokens, JSON.stringify(input.slice(0, 20))).toBeLessThanOrEqual(r.before.tokens);
      expect(r.saved).toBeGreaterThanOrEqual(0);
    }
  });

  it("announces every removal in the returned text", () => {
    const r = compress(bigFile(3000), ledger, { sourceId: "big.ts", budgetTokens: 500 });
    expect(r.applied).toContain("cap");
    // The model must be able to tell it is holding a fragment.
    expect(r.text).toMatch(/\[thrift:/);
    expect(r.text).toMatch(/omitted/i);
  });

  it("reports a no-op honestly rather than claiming a saving", () => {
    const r = compress("already tiny", ledger, { sourceId: "tiny.txt" });
    expect(r.saved).toBe(0);
    expect(r.note).toMatch(/lean/i);
  });
});

describe("dedupe", () => {
  it("returns a pointer on the second read of unchanged content", () => {
    const text = bigFile(300);
    const first = compress(text, ledger, { sourceId: "/a.ts" });
    const second = compress(text, ledger, { sourceId: "/a.ts" });

    expect(first.applied).not.toContain("dedupe");
    expect(second.applied).toEqual(["dedupe"]);
    expect(second.after.tokens).toBeLessThan(first.after.tokens / 10);
  });

  it("is lossless — the pointer says how to get the content back", () => {
    const text = bigFile(300);
    compress(text, ledger, { sourceId: "/a.ts" });
    const second = compress(text, ledger, { sourceId: "/a.ts" });

    expect(isLossless(second.applied)).toBe(true);
    expect(second.text).toMatch(/re-read/i);
    expect(second.text).toContain("/a.ts");
  });

  it("does NOT dedupe when the content changed", () => {
    // The whole value of a re-read is seeing the change. Returning "same as
    // before" for modified content would hide the edit the agent just made.
    compress(bigFile(300), ledger, { sourceId: "/a.ts" });
    const changed = compress(bigFile(300) + "\n// edited", ledger, { sourceId: "/a.ts" });
    expect(changed.applied).not.toContain("dedupe");
  });

  it("does not dedupe across different sources with identical content", () => {
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    const other = compress(text, ledger, { sourceId: "/b.ts" });
    // Two different files that happen to match are two different facts.
    expect(other.applied).not.toContain("dedupe");
  });

  it("does nothing without a sourceId", () => {
    const text = bigFile(200);
    compress(text, ledger, {});
    const second = compress(text, ledger, {});
    expect(second.applied).not.toContain("dedupe");
  });

  it("resets, so a new session never claims the model already has something", () => {
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    ledger.reset();
    const afterReset = compress(text, ledger, { sourceId: "/a.ts" });
    // Telling a fresh conversation "you already have this" is unrecoverable —
    // the model cannot fetch what it was never given.
    expect(afterReset.applied).not.toContain("dedupe");
  });
});

describe("strip", () => {
  it("removes ANSI escapes without touching the words", () => {
    const esc = String.fromCharCode(27);
    const noisy = Array.from({ length: 200 }, () => `${esc}[32mPASS${esc}[0m auth.test.ts`).join("\n");
    const r = compress(noisy, ledger, { sourceId: "test-out" });
    expect(r.text).not.toContain(esc);
    expect(r.text).toContain("PASS");
    expect(r.text).toContain("auth.test.ts");
  });

  it("collapses long runs of identical lines and says how many", () => {
    const repeated = Array.from({ length: 50 }, () => "npm warn deprecated foo@1.0.0").join("\n");
    const r = compress(repeated, ledger, { sourceId: "npm-out" });
    expect(r.text).toMatch(/repeated \d+ more times/);
    expect(r.after.tokens).toBeLessThan(r.before.tokens);
  });

  it("keeps two consecutive identical lines — a marker would cost more", () => {
    const twice = "line\nline\nother";
    const r = compress(twice, ledger, { sourceId: "x" });
    expect(r.text).not.toMatch(/repeated/);
  });

  it("replaces a base64 blob with its length rather than dropping it silently", () => {
    const blob = "A".repeat(3000);
    const r = compress(`data: ${blob}`, ledger, { sourceId: "blob" });
    expect(r.text).toMatch(/base64 omitted/);
    expect(r.text).toMatch(/3000/);
  });

  it("is lossless by classification", () => {
    const esc = String.fromCharCode(27);
    const r = compress(`${esc}[32mok${esc}[0m\n`.repeat(100), ledger, { sourceId: "s" });
    expect(isLossless(r.applied)).toBe(true);
  });
});

describe("slice", () => {
  it("keeps windows around query hits and marks the gaps with line ranges", () => {
    const lines = Array.from({ length: 400 }, (_, i) =>
      i === 200 ? "function validateLicenseKey(key: string) {" : `const filler${i} = ${i};`
    );
    const r = compress(lines.join("\n"), ledger, {
      sourceId: "/big.ts",
      query: "validateLicenseKey",
    });
    expect(r.applied).toContain("slice");
    expect(r.text).toContain("validateLicenseKey");
    // The gap marker must name the range so the model can ask for it.
    expect(r.text).toMatch(/lines \d+-\d+ omitted/);
  });

  it("declines to slice when the query matches nothing", () => {
    // Slicing on zero evidence would hand back an arbitrary fragment and call
    // it relevant. Returning everything is the honest outcome.
    const text = bigFile(400);
    const r = compress(text, ledger, { sourceId: "/big.ts", query: "nonexistentsymbolxyz" });
    expect(r.applied).not.toContain("slice");
  });

  it("declines to slice something already small", () => {
    const small = Array.from({ length: 20 }, (_, i) => `line ${i} target`).join("\n");
    const r = compress(small, ledger, { sourceId: "/small.ts", query: "target" });
    expect(r.applied).not.toContain("slice");
  });

  it("is classified lossy — gaps mean the model saw less", () => {
    const lines = Array.from({ length: 400 }, (_, i) =>
      i === 200 ? "function target() {}" : `const x${i} = ${i};`
    );
    const r = compress(lines.join("\n"), ledger, { sourceId: "/b.ts", query: "target" });
    expect(isLossless(r.applied)).toBe(false);
  });
});

describe("cap", () => {
  it("keeps the head and the tail, not just the head", () => {
    // The tail usually holds the error or the conclusion. Cutting only the end
    // loses the answer.
    const text = `HEAD_MARKER\n${bigFile(4000)}\nTAIL_MARKER`;
    const r = compress(text, ledger, { sourceId: "/x.log", budgetTokens: 400 });
    expect(r.text).toContain("HEAD_MARKER");
    expect(r.text).toContain("TAIL_MARKER");
  });

  it("respects the budget approximately", () => {
    const r = compress(bigFile(5000), ledger, { sourceId: "/x.ts", budgetTokens: 1000 });
    // The marker itself costs tokens, so allow headroom — but it must be in
    // the right order of magnitude, not 10x over.
    expect(r.after.tokens).toBeLessThan(1400);
  });

  it("says the payload is a fragment", () => {
    const r = compress(bigFile(4000), ledger, { sourceId: "/x.ts", budgetTokens: 300 });
    expect(r.text).toMatch(/FRAGMENT/i);
  });
});

describe("mechanism gating", () => {
  it("respects a disabled mechanism", () => {
    const text = bigFile(3000);
    const r = compress(text, ledger, {
      sourceId: "/x.ts",
      budgetTokens: 200,
      enable: { cap: false },
    });
    expect(r.applied).not.toContain("cap");
  });

  it("dedupe can be turned off for a byte-exact read", () => {
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    const second = compress(text, ledger, { sourceId: "/a.ts", enable: { dedupe: false } });
    expect(second.applied).not.toContain("dedupe");
    expect(second.text).toContain("export function fn0");
  });
});

describe("token estimation", () => {
  it("charges dense JSON more per character than prose", () => {
    const prose = "the quick brown fox jumps over the lazy dog and keeps running along";
    const json = JSON.stringify({ aaaaaaa: 1, bbbbbbb: [2, 3], ccccccc: { d: "e" } });
    const proseRate = estimateTokens(prose).tokens / prose.length;
    const jsonRate = estimateTokens(json).tokens / json.length;
    expect(jsonRate).toBeGreaterThan(proseRate);
  });

  it("labels itself as an estimate so nobody quotes it as measured", () => {
    const c = estimateTokens("some text");
    expect(c.method).toBe("heuristic");
    expect(c.note).toMatch(/estimate/i);
  });

  it("returns zero for empty input", () => {
    expect(estimateTokens("").tokens).toBe(0);
  });
});
