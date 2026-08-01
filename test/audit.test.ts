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
});
