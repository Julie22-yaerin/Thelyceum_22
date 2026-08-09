/**
 * Feedback — the properties worth protecting: an empty message is rejected,
 * a runaway-length one is rejected, email/context are optional and trimmed,
 * and listing comes back newest-first.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../src/db.js";
import { submitFeedback, listFeedback, FeedbackError } from "../src/feedback.js";

let dir: string;
let db: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-feedback-test-"));
  db = openDb(join(dir, "test.db"));
});

describe("submitFeedback", () => {
  it("stores a message with optional email and context", () => {
    const row = submitFeedback(db, { message: "  This broke for me  ", email: " a@b.com ", context: "redeem_dashboard" });
    expect(row.message).toBe("This broke for me");
    expect(row.email).toBe("a@b.com");
    expect(row.context).toBe("redeem_dashboard");
    expect(row.created_at).toBeGreaterThan(0);
  });

  it("works with no email or context at all", () => {
    const row = submitFeedback(db, { message: "just a note" });
    expect(row.email).toBeNull();
    expect(row.context).toBeNull();
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(() => submitFeedback(db, { message: "" })).toThrow(FeedbackError);
    expect(() => submitFeedback(db, { message: "   " })).toThrow(FeedbackError);
  });

  it("rejects a message over the length cap", () => {
    expect(() => submitFeedback(db, { message: "x".repeat(4001) })).toThrow(FeedbackError);
  });
});

describe("listFeedback", () => {
  it("returns newest first", () => {
    submitFeedback(db, { message: "first" });
    submitFeedback(db, { message: "second" });
    const rows = listFeedback(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].message).toBe("second");
    expect(rows[1].message).toBe("first");
  });

  it("returns an empty list when nothing has been submitted", () => {
    expect(listFeedback(db)).toHaveLength(0);
  });
});
