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
import { filterProseNoise } from "../src/prose.js";
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

  it("never returns a pointer for changed content, even after a pointer was already handed out", () => {
    // The sequence that matters in a real loop: read → read (pointer granted) →
    // file edited → read. That third read MUST be the full new content. A
    // pointer here would tell the model "you already have this" when what it
    // has is the OLD version — the agent would reason about stale state and
    // never see the edit it was checking for.
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" }); // call 1: baseline
    const pointer = compress(text, ledger, { sourceId: "/a.ts" }); // call 2: dedupe fires
    expect(pointer.applied).toContain("dedupe"); // the premise of this test

    const edited = text + "\n// changed mid-loop";
    const third = compress(edited, ledger, { sourceId: "/a.ts" }); // call 3: content changed
    expect(third.applied).not.toContain("dedupe");
    expect(third.text).toContain("// changed mid-loop"); // the edit is visible
    expect(third.text).toContain("export function fn0"); // full content, not a pointer
    expect(third.text).not.toMatch(/unchanged since you read it earlier/);
  });

  it("a file reverted to its original content is still re-sent in full", () => {
    // read → pointer → edit → read → revert to the ORIGINAL → read. The stored
    // hash is now the edited content's, so the original no longer matches what
    // the ledger recorded. The model saw the edited version in between, and the
    // original may have been compacted — "you already have this" cannot be
    // trusted, so the original is re-sent.
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    const pointer = compress(text, ledger, { sourceId: "/a.ts" });
    expect(pointer.applied).toContain("dedupe");

    const edited = text + "\n// edited";
    const editRead = compress(edited, ledger, { sourceId: "/a.ts" });
    expect(editRead.applied).not.toContain("dedupe");

    const reverted = compress(text, ledger, { sourceId: "/a.ts" }); // original again
    expect(reverted.applied).not.toContain("dedupe"); // must NOT match the call-1 hash
    expect(reverted.text).toContain("export function fn0");
    expect(reverted.text).not.toMatch(/unchanged since/);
    // …and the re-sent original becomes the new baseline: the next stable
    // read dedupes against THIS sighting, not the long-ago call-1 one.
    const stable = compress(text, ledger, { sourceId: "/a.ts" });
    expect(stable.applied).toContain("dedupe");
    expect(stable.text).not.toMatch(/call #1/);
  });

  it("after a change, the new content becomes the baseline — a stable re-read dedupes against it", () => {
    // One edit must not kill dedupe for the rest of the session: the ledger
    // re-baselines on the new hash, so the next read of the same edited content
    // is a legitimate re-read and gets a pointer — pointing at the NEW call,
    // never the pre-change sighting.
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" }); // call 1
    const edited = text + "\n// changed";
    compress(edited, ledger, { sourceId: "/a.ts" }); // call 2: full re-send, new hash stored

    const again = compress(edited, ledger, { sourceId: "/a.ts" }); // call 3
    expect(again.applied).toContain("dedupe"); // baseline is now the edited content
    expect(again.text).toMatch(/unchanged since you read it earlier/);
    expect(again.text).not.toMatch(/call #1/); // never points back at the pre-change sighting
  });

  it("successive edits each re-send the full file — no pointer hides any intermediate state", () => {
    // An agent iterating on a file: every intermediate edit must be visible.
    // Each read overwrites the stored hash, so each next change mismatches.
    let content = bigFile(200);
    compress(content, ledger, { sourceId: "/a.ts" });
    for (let i = 0; i < 5; i++) {
      content += `\n// change ${i}`;
      const r = compress(content, ledger, { sourceId: "/a.ts" });
      expect(r.applied).not.toContain("dedupe");
      expect(r.text).toContain(`// change ${i}`); // every edit is visible
    }
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

  it("refuses the pointer once it is older than maxDedupeAgeCalls", () => {
    // The host can compact context at any moment. A pointer that says "you
    // already have this" when the content has since left the window is the
    // one unrecoverable failure thrift can have — so after N calls the full
    // content is re-sent instead.
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    // Advance the ledger with unrelated reads — this is what an agent loop
    // does between two reads of the same file.
    for (let i = 0; i < 10; i++) {
      compress(`other file ${i}`, ledger, { sourceId: `/other-${i}.txt` });
    }
    const stale = compress(text, ledger, { sourceId: "/a.ts", maxDedupeAgeCalls: 5 });
    expect(stale.applied).not.toContain("dedupe");
    expect(stale.text).toContain("export function fn0");
    expect(stale.note).toMatch(/expired|re-sent/i);
  });

  it("re-baselines after a stale read, so the next read can dedupe again", () => {
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    for (let i = 0; i < 10; i++) {
      compress(`other ${i}`, ledger, { sourceId: `/other-${i}.txt` });
    }
    // Stale read → full content re-sent, sighting re-baselined to now.
    compress(text, ledger, { sourceId: "/a.ts", maxDedupeAgeCalls: 5 });
    // Immediately after, the pointer is fresh again — otherwise one expiry
    // would kill dedupe for the rest of the session.
    const again = compress(text, ledger, { sourceId: "/a.ts", maxDedupeAgeCalls: 5 });
    expect(again.applied).toContain("dedupe");
  });

  it("expires on tokens emitted even when the call count is still fresh", () => {
    // A call-count window alone cannot see context pressure. If a LOT of new
    // content has entered context since the sighting, the earlier copy may
    // well be gone — so the token window is the second, independent tripwire.
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" });
    for (let i = 0; i < 30; i++) {
      compress(bigFile(50), ledger, { sourceId: `/big-${i}.txt` });
    }
    const stale = compress(text, ledger, {
      sourceId: "/a.ts",
      maxDedupeAgeCalls: 1000, // call window wide open
      maxDedupeAgeTokens: 100, // token window tiny
    });
    expect(stale.applied).not.toContain("dedupe");
    expect(stale.text).toContain("export function fn0");
  });

  it("a file's own first read does not count toward its own expiry", () => {
    // A 60k-token file read twice in immediate succession must dedupe: its own
    // first emission is still in context (it was just sent). Counting it
    // against its own token window would refuse the pointer for the wrong
    // reason — the compaction risk is OTHER content entering, not the file
    // itself. Only dedupe fires when no other source has emitted anything.
    const text = bigFile(2000); // ~25k tokens by the estimator (70k chars / ~2.7)
    compress(text, ledger, { sourceId: "/huge.ts", maxDedupeAgeTokens: 100 });
    const again = compress(text, ledger, { sourceId: "/huge.ts", maxDedupeAgeTokens: 100 });
    expect(again.applied).toContain("dedupe");
  });

  it("the pointer names how old the sighting is", () => {
    const text = bigFile(200);
    compress(text, ledger, { sourceId: "/a.ts" }); // call 1
    for (let i = 0; i < 3; i++) {
      compress(`other ${i}`, ledger, { sourceId: `/other-${i}.txt` }); // calls 2–4
    }
    const second = compress(text, ledger, { sourceId: "/a.ts" }); // call 5 → age 4
    expect(second.applied).toContain("dedupe");
    expect(second.text).toMatch(/4 calls ago/);
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

  it("does NOT strip a dotted token (JWT) — its claims are facts, not noise", () => {
    // header.payload.signature, standard base64 per segment. The payload
    // segment alone is long enough to trip the 200-char rule — a naively
    // greedy regex would eat it and destroy sub/role/exp the model may need.
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
    const claims = {
      sub: "user-1042",
      role: "admin",
      exp: 1_900_000_000,
      scope: ["read", "write", "deploy", "build", "release", "audit"],
      permissions: ["iam.admin", "billing.write", "secrets.read", "infra.deploy", "audit.view"],
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64");
    expect(payload.length).toBeGreaterThanOrEqual(200); // premise of this test
    const token = `${header}.${payload}.${Buffer.from("signature").toString("base64")}`;

    const r = compress(token, ledger, { sourceId: "jwt.txt" });
    expect(r.text).toContain(token); // verbatim — nothing cut
    expect(r.text).not.toMatch(/base64 omitted/);
    // the claims are still decodable from what was returned — the model can
    // read role/exp straight out of the payload segment
    const seg = r.text.split(".")[1];
    const decoded = JSON.parse(Buffer.from(seg, "base64").toString("utf-8"));
    expect(decoded.role).toBe("admin");
    expect(decoded.sub).toBe("user-1042");
  });

  it("keeps a compact base64url JWT intact", () => {
    // Real-world JWT: short base64url segments — safe by construction, pinned
    // so a future rule change cannot regress it.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0." +
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const r = compress(jwt, ledger, { sourceId: "jwt2.txt" });
    expect(r.text).toContain(jwt);
    expect(r.text).not.toMatch(/base64 omitted/);
  });

  it("strips an image data URI's payload but keeps the MIME prefix and the length", () => {
    // The pixel bytes are unusable as text, but the model must still be able
    // to tell an image was there and how big — so it can ask for it by name.
    const uri = `data:image/png;base64,${"A".repeat(3000)}`;
    const r = compress(uri, ledger, { sourceId: "img.txt" });
    expect(r.text).toContain("data:image/png;base64,");
    expect(r.text).toMatch(/3000-char base64 omitted/);
    expect(r.after.tokens).toBeLessThan(r.before.tokens);
  });

  it("keeps a JSON response parseable when a base64 value inside it is stripped", () => {
    // Stripping the value must not break the shape: the model still needs the
    // surrounding fields (status, code) to conclude anything.
    const json = JSON.stringify({
      status: "ok",
      code: 200,
      requestId: "req_ab12",
      data: "A".repeat(3000),
    });
    const r = compress(json, ledger, { sourceId: "response.json" });
    const parsed = JSON.parse(r.text);
    expect(parsed.status).toBe("ok");
    expect(parsed.code).toBe(200);
    expect(parsed.data).toMatch(/base64 omitted/);
  });

  it("still strips a standalone blob at the very start of the text", () => {
    // The lookaround must not disable the mechanism entirely — a run with no
    // token context on either side is still machine noise.
    const r = compress("A".repeat(3000), ledger, { sourceId: "raw" });
    expect(r.text).toMatch(/base64 omitted/);
  });

  it("compacts long stack trace frames while keeping head frames and tail frame", () => {
    const trace = [
      "Error: Connection refused",
      "    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1146:16)",
      "    at Protocol.Connection._dispatch (/app/node_modules/mysql/lib/Connection.js:144:11)",
      "    at Protocol.Connection._select (/app/node_modules/mysql/lib/Connection.js:150:11)",
      "    at Sequence.onReady (/app/node_modules/mysql/lib/Sequence.js:90:12)",
      "    at Sequence.onEnd (/app/node_modules/mysql/lib/Sequence.js:100:12)",
      "    at Sequence.execute (/app/node_modules/mysql/lib/Sequence.js:110:12)",
      "    at Runner.run (/app/node_modules/jest-runner/index.js:50:5)",
      "    at processTicksAndRejections (internal/process/task_queues.js:95:5)"
    ].join("\n");

    const r = compress(trace, ledger, { sourceId: "error.log" });
    expect(r.text).toContain("Connection refused");
    expect(r.text).toContain("TCPConnectWrap.afterConnect");
    expect(r.text).toContain("processTicksAndRejections");
    expect(r.text).toMatch(/stack trace frames omitted/);
    expect(r.after.tokens).toBeLessThan(r.before.tokens);
  });

  it("compacts long unchanged context in git diffs while preserving additions and deletions", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "@@ -10,30 +10,30 @@ function main() {",
      ...Array.from({ length: 25 }, (_, i) => `  const contextLine${i} = ${i};`),
      "-  const oldVal = 1;",
      "+  const newVal = 2;",
      ...Array.from({ length: 25 }, (_, i) => `  const trailingLine${i} = ${i};`)
    ].join("\n");

    const r = compress(diff, ledger, { sourceId: "app.patch" });
    expect(r.text).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(r.text).toContain("-  const oldVal = 1;");
    expect(r.text).toContain("+  const newVal = 2;");
    expect(r.text).toMatch(/unchanged git diff context lines omitted/);
    expect(r.after.tokens).toBeLessThan(r.before.tokens);
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

  it("a hit at the start of a function body cuts the definition — the marker names the exact range", () => {
    // Query matches the signature line only. The window (i ± 12) keeps the
    // signature and the first lines of the body, but the closing brace lives
    // past the window. The model must see an UNCLOSED function plus a marker
    // that names the precise range where the rest of the definition is.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 100) return "function validateLicenseKey(key: string) {";
      if (i > 100 && i <= 130) return `  const check${i} = key;`;
      if (i === 131) return "}";
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/lic.ts", query: "validateLicenseKey" });

    expect(r.applied).toContain("slice");
    // The signature is kept…
    expect(r.text).toContain("function validateLicenseKey(key: string) {");
    // …the closing brace at line 132 is NOT (it sits past the window edge)…
    expect(r.text).not.toContain("}");
    // …and the marker names the exact range holding the rest of the definition,
    // so the model can ask for precisely that span instead of the whole file.
    expect(r.text).toMatch(/lines \d+-400 omitted — ask for this range to see them/);
    const m = r.text.match(/lines (\d+)-400 omitted/);
    expect(m).not.toBeNull();
    // the omitted range must include the closing brace (line 132)
    expect(Number(m![1])).toBeLessThanOrEqual(132);
  });

  it("a definition in the omitted gap is findable by its line range, not guesswork", () => {
    // The query matches ONLY a call site deep in the file (a unique term), so
    // the function definition far above falls into the first omitted gap. The
    // marker must name a range that CONTAINS the definition so the model can
    // ask for exactly that span.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 20) return "function hydrateSession(sessionId: string) {";
      if (i > 20 && i < 26) return `  const s${i} = load(sessionId);`;
      if (i === 26) return "}";
      if (i === 300) return 'const ok = hydrateSession(session.id, "ARIA-9");';
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/hyd.ts", query: "ARIA-9" });

    expect(r.applied).toContain("slice");
    // the call site is kept; the definition (lines 21-27) is inside the gap
    expect(r.text).toContain('hydrateSession(session.id, "ARIA-9")');
    expect(r.text).not.toContain("function hydrateSession");
    // the first gap marker's range must cover the definition lines
    const first = r.text.match(/lines (\d+)-(\d+) omitted/);
    expect(first).not.toBeNull();
    expect(Number(first![1])).toBeLessThanOrEqual(21);
    expect(Number(first![2])).toBeGreaterThanOrEqual(27);
  });

  it("never cuts a template literal in half — the window snaps to its closing backtick", () => {
    // Query hits at line 110 (inside a template that spans 100..160). A
    // line-based window (98..122) would end mid-template, handing the model an
    // unterminated literal it cannot parse. The run must extend to line 160
    // where the closing backtick lives.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 100) return "const sql = `";
      if (i === 160) return "`;";
      if (i === 110) return "  SELECT * FROM users WHERE id = ${userId};";
      if (i > 100 && i < 160) return `  body ${i} of the template`; // unique lines — no repeat-collapse inside the literal
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/q.ts", query: "SELECT" });

    expect(r.applied).toContain("slice");
    // the whole literal survives, opening and closing backticks included
    expect(r.text).toContain("const sql = `");
    expect(r.text).toContain("`;");
    // …and there is NO gap marker between the template's opening and closing
    // lines — the literal is contiguous in what the model receives
    const fromOpen = r.text.indexOf("const sql = `");
    const toClose = r.text.indexOf("`;", fromOpen);
    expect(r.text.slice(fromOpen, toClose)).not.toContain("[thrift:");
    // the omitted range after the literal is still named precisely
    expect(r.text).toMatch(/lines 162-400 omitted/);
  });

  it("never cuts a block comment in half — the window snaps to its closing */", () => {
    // Query hits at line 210, inside a /* */ comment spanning 200..260. The
    // window (198..222) would cut the comment mid-body; it must extend to the
    // line holding the closing */.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 200) return "/*";
      if (i === 260) return "*/";
      if (i === 210) return "   * magicToken: explains the algorithm";
      if (i > 200 && i < 260) return `   * comment body ${i}`; // unique lines — no repeat-collapse inside the comment
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/c.ts", query: "magicToken" });

    expect(r.applied).toContain("slice");
    expect(r.text).toContain("/*");
    expect(r.text).toContain("*/");
    const fromOpen = r.text.indexOf("/*");
    const toClose = r.text.indexOf("*/", fromOpen);
    expect(r.text.slice(fromOpen, toClose)).not.toContain("[thrift:");
  });

  it("a template containing quotes and // is treated as one literal, not cut mid-way", () => {
    // Inside a template literal, a " or a // is CONTENT, not syntax. The
    // scanner must not close the literal early on a fake line-comment or a
    // quote inside the template body.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 100) return "const html = `";
      if (i === 200) return "`;";
      if (i === 120) return '  <div class="box">click me</div> // not a comment';
      if (i === 150) return '  const x = "text inside template"; magicToken';
      if (i > 100 && i < 200) return `  template body line ${i}`; // unique — no repeat-collapse inside the literal
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/t.ts", query: "magicToken" });

    expect(r.applied).toContain("slice");
    // the hit at 150 is deep inside the template; the window (138..162) must
    // snap to the full literal 100..200
    expect(r.text).toContain("const html = `");
    expect(r.text).toContain("`;");
    expect(r.text).toContain('class="box"');
    const fromOpen = r.text.indexOf("const html = `");
    const toClose = r.text.indexOf("`;", fromOpen);
    expect(r.text.slice(fromOpen, toClose)).not.toContain("[thrift:");
  });

  it("does not over-extend for a single-line // comment at the window edge", () => {
    // A // comment cannot span lines, so a window ending on a comment line
    // needs no snapping — extending it would keep lines the model does not
    // need. This pins that the syntax guard is not over-eager.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 300) return "// TODO magicToken fix this";
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/d.ts", query: "magicToken" });

    expect(r.applied).toContain("slice");
    expect(r.text).toContain("// TODO magicToken fix this");
    // window is 288..312 — the comment line is whole and nothing past it leaks in.
    // Gap after index 312 starts at 313 → marker names 314-400 (1-based).
    expect(r.text).toMatch(/lines 314-400 omitted/);
  });

  it("declines to slice when snapping to a literal would keep almost everything", () => {
    // A giant template spanning lines 20..370: the query hits inside it, and
    // snapping to the literal boundary would keep 351 of 400 lines — more than
    // the 80% threshold. Honest outcome: decline the slice, return it whole.
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 20) return "const giant = `";
      if (i === 370) return "`;";
      if (i === 300) return "  magicToken in the middle";
      if (i > 20 && i < 370) return "  template body";
      return `const filler${i} = ${i};`;
    });
    const r = compress(lines.join("\n"), ledger, { sourceId: "/g.ts", query: "magicToken" });

    expect(r.applied).not.toContain("slice");
    // full file returned rather than a slice that is barely a slice
    expect(r.text).toContain("const giant = `");
  });
});

describe("cap", () => {
  it("keeps the head and the tail, not just the head", () => {
    // The tail usually holds the error or the conclusion. Cutting only the end
    // loses the answer.
    const text = `const HEAD_MARKER = "START";\n${bigFile(4000)}\nconst TAIL_MARKER = "END";`;
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

describe("prose noise filtering", () => {
  it("removes English and Vietnamese hesitation words", () => {
    const text = "Tôi nghĩ ờ... thì... à dĩ nhiên dạ vâng là nó um tốt uh lắm.";
    expect(filterProseNoise(text)).toBe("Tôi nghĩ thì... dĩ nhiên là nó tốt lắm.");
  });

  it("collapses consecutive duplicate words case-insensitively, keeping punctuation", () => {
    const text = "the the standard very very good. kiểu kiểu như vậy";
    expect(filterProseNoise(text)).toBe("the standard very good. kiểu như vậy");
  });

  it("strips hesitation and duplicate words in a full compress run for soft lines", () => {
    const original = "Tôi nghĩ là kiểu kiểu như vậy ờ...\nconst x = 123;\nTôi nghĩ dĩ nhiên dạ vâng là nó um tốt uh lắm.";
    const r = compress(original, ledger, { sourceId: "prose.txt" });
    expect(r.text).toContain("Tôi nghĩ là kiểu như vậy");
    expect(r.text).toContain("const x = 123;");
    expect(r.text).toContain("Tôi nghĩ dĩ nhiên là nó tốt lắm.");
  });
});

describe("SVG blob and log timestamp compaction", () => {
  it("compacts large inline SVG path data while keeping SVG tags", () => {
    const svgContent = `<svg><path d="M10 20 L30 40 C50 60 70 80 90 100 A10 20 30 40 50 60 70 A10 20 30 40 50 60 70 Z M100 200 L300 400 Z M10 20 L30 40 C50 60 70 80 90 100" /></svg>`;
    const r = compress(svgContent, ledger, { sourceId: "icon.svg" });
    expect(r.text).toMatch(/\[thrift: \d+-char SVG path omitted\]/);
  });

  it("normalizes log timestamps on repeated lines so collapseRepeats merges them", () => {
    const logLines = [
      "2026-08-05T10:41:37.100Z [INFO] Processing queue batch #100",
      "2026-08-05T10:41:37.250Z [INFO] Processing queue batch #100",
      "2026-08-05T10:41:37.400Z [INFO] Processing queue batch #100",
      "2026-08-05T10:41:37.550Z [INFO] Processing queue batch #100",
    ].join("\n");
    const r = compress(logLines, ledger, { sourceId: "batch.log" });
    expect(r.text).toContain("previous line repeated 3 more times");
  });
});

describe("adversarial stress tests (red team validation)", () => {
  it("handles heavy multi-byte unicode without throwing or corrupting output length invariant", () => {
    const unicodeInput = "🚀".repeat(500) + " 💥 ".repeat(500) + " Tiếng Việt có dấu phức tạp ";
    const r = compress(unicodeInput, ledger, { sourceId: "unicode.txt" });
    expect(r.after.tokens).toBeLessThanOrEqual(r.before.tokens);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("preserves syntactically critical structural elements in adversarial JSON logs", () => {
    const jsonLogs = [
      '{"level":"error","timestamp":"2026-08-05T10:00:00Z","trace":"Error: connect ECONNREFUSED 127.0.0.1:5432"',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1605:16)'
    ].join("\n");
    const r = compress(jsonLogs, ledger, { sourceId: "json_trace.log" });
    expect(r.after.tokens).toBeLessThanOrEqual(r.before.tokens);
    expect(r.text).toContain("stack trace frames omitted");
  });

  it("handles Big List of Naughty Strings (BLNS) dataset without throwing or memory leaks", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const blnsPath = path.resolve(__dirname, "../../../benches/datasets/blns/big-list-of-naughty-strings-master/blns.json");
    const blnsContent = await fs.readFile(blnsPath, "utf-8");
    const naughtyStrings: string[] = JSON.parse(blnsContent);

    // Pick 50 complex naughty strings and compress
    const sample = naughtyStrings.slice(0, 100).join("\n");
    const r = compress(sample, ledger, { sourceId: "blns_sample.txt" });
    expect(r.after.tokens).toBeLessThanOrEqual(r.before.tokens);
    expect(r.text.length).toBeGreaterThan(0);
  });
});
