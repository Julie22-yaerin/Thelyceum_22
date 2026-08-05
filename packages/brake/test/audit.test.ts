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

  it("reads the correct tail from a log spanning many internal chunks", async () => {
    const total = 5000;
    for (let i = 0; i < total; i++) {
      await appendAudit({ event: `e${i}`, timestamp: i, pad: "x".repeat(i % 137) }, path);
    }
    const events = await readAudit(25, path);
    expect(events).toHaveLength(25);
    expect(events.map((e) => e.event)).toEqual(
      Array.from({ length: 25 }, (_, i) => `e${total - 1 - i}`)
    );
  }, 20000);

  it("touches a bounded number of bytes regardless of log size", async () => {
    const total = 20_000;
    const lines: string[] = [];
    for (let i = 0; i < total; i++) {
      lines.push(JSON.stringify({ event: `e${i}`, timestamp: i }));
    }
    await writeFile(path, lines.join("\n") + "\n", "utf-8");

    const fileSize = (await import("node:fs/promises").then((m) => m.stat(path))).size;
    expect(fileSize).toBeGreaterThan(500_000);

    const t0 = performance.now();
    const events = await readAudit(100, path);
    const elapsedMs = performance.now() - t0;
    expect(events).toHaveLength(100);
    expect(elapsedMs).toBeLessThan(100);
  }, 30000);

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
    expect(events[2].event).toBe("e0");
  });
});
