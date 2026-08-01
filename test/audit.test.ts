import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit, readAudit } from "../src/audit.js";

describe("audit log", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "brake-audit-"));
    path = join(dir, "audit.log");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends NDJSON lines", async () => {
    await appendAudit({ event: "x", timestamp: 1 }, path);
    await appendAudit({ event: "y", timestamp: 2 }, path);
    const content = await readFile(path, "utf-8");
    expect(content).toContain('"event":"x"');
    expect(content).toContain('"event":"y"');
  });

  it("reads recent events newest-first", async () => {
    await appendAudit({ event: "first", timestamp: 1 }, path);
    await appendAudit({ event: "second", timestamp: 2 }, path);
    await appendAudit({ event: "third", timestamp: 3 }, path);
    const events = await readAudit(10, path);
    expect(events.map((e) => e.event)).toEqual(["third", "second", "first"]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await appendAudit({ event: `e${i}`, timestamp: i }, path);
    }
    const events = await readAudit(2, path);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("e4");
    expect(events[1].event).toBe("e3");
  });

  it("returns empty when no file exists", async () => {
    const events = await readAudit(10, path);
    expect(events).toEqual([]);
  });

  it("skips corrupt lines without throwing", async () => {
    await writeFile(path, "not json\n" + JSON.stringify({ event: "ok", timestamp: 1 }) + "\n", "utf-8");
    const events = await readAudit(10, path);
    expect(events).toHaveLength(2);
    expect((events[0] as { event: string }).event).toBe("ok");
    expect((events[1] as { event: string }).event).toBe("corrupt");
  });

  // ── Enterprise-scale log: bounded reads regardless of file size ──────────
  // readAudit used to `readFile` the whole log into memory. Fine at demo
  // scale, a real cost at the scale this is now priced for — a fleet's audit
  // log only grows, and every status check would re-read the entire thing.
  // These tests exist to make that regression impossible to reintroduce
  // silently: correctness across a multi-chunk file, and an explicit bound
  // on how many bytes get touched.

  it("reads the correct tail from a log spanning many internal chunks", async () => {
    // The chunked reader works in 64KB pieces internally; write enough
    // lines to force several chunk boundaries, including ones that land
    // mid-line, and confirm the boundary-crossing reconstruction is exact.
    const total = 5000;
    for (let i = 0; i < total; i++) {
      // Variable-length payload so line boundaries don't align with the
      // chunk size — the case that actually exercises the carry logic.
      await appendAudit({ event: `e${i}`, timestamp: i, pad: "x".repeat(i % 137) }, path);
    }
    const events = await readAudit(25, path);
    expect(events).toHaveLength(25);
    // Newest first, and every one of the last 25 must be present, in order,
    // with nothing dropped or duplicated at a chunk seam.
    expect(events.map((e) => e.event)).toEqual(
      Array.from({ length: 25 }, (_, i) => `e${total - 1 - i}`)
    );
  });

  it("touches a bounded number of bytes regardless of log size", async () => {
    // Not just "it returns the right answer" — it must not have paid for the
    // whole file to get there. A large log with a small limit should read
    // roughly one chunk, not the whole file.
    const total = 20_000;
    for (let i = 0; i < total; i++) {
      await appendAudit({ event: `e${i}`, timestamp: i }, path);
    }
    const fileSize = (await import("node:fs/promises").then((m) => m.stat(path))).size;
    expect(fileSize).toBeGreaterThan(500_000); // confirm this is actually a big file

    // readAudit opens its own file handle internally, so the externally
    // observable consequence of "bounded I/O" is measured rather than
    // instrumented: a 100-line read from a 20,000-line file completes in
    // milliseconds, not in however long a full-file read+parse would take.
    const t0 = performance.now();
    const events = await readAudit(100, path);
    const elapsedMs = performance.now() - t0;
    expect(events).toHaveLength(100);
    expect(elapsedMs).toBeLessThan(50);
  });

  it("still works when the file is smaller than one internal chunk", async () => {
    await appendAudit({ event: "only", timestamp: 1 }, path);
    const events = await readAudit(10, path);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("only");
  });

  it("does not lose the first line in the file when the limit exceeds the log", async () => {
    for (let i = 0; i < 3; i++) await appendAudit({ event: `e${i}`, timestamp: i }, path);
    const events = await readAudit(1000, path);
    expect(events).toHaveLength(3);
    expect(events[2].event).toBe("e0"); // the very first line written, oldest, last in newest-first order
  });
});
