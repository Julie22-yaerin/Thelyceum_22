/**
 * Feedback — free-text, public, no auth.
 *
 * Deliberately minimal: a message and an optional reply email, nothing to
 * configure, nowhere it can silently fail. The only validation is a length
 * floor/ceiling — reject empty submissions, cap runaway ones — everything
 * else is a judgment call for whoever reads it in the admin console, not
 * something this layer should try to classify.
 */

import { randomUUID } from "node:crypto";
import type { DbHandle } from "./db.js";

const MAX_MESSAGE_LEN = 4000;
const MAX_EMAIL_LEN = 320;
const MAX_CONTEXT_LEN = 100;

export class FeedbackError extends Error {
  constructor(
    public code: "invalid_input",
    message: string
  ) {
    super(message);
    this.name = "FeedbackError";
  }
}

export interface FeedbackRow {
  id: string;
  message: string;
  email: string | null;
  context: string | null;
  created_at: number;
}

export interface SubmitFeedbackInput {
  message: string;
  email?: string;
  context?: string;
}

export function submitFeedback(db: DbHandle, input: SubmitFeedbackInput): FeedbackRow {
  const message = input.message?.trim() ?? "";
  if (!message) throw new FeedbackError("invalid_input", "Feedback message is required.");
  if (message.length > MAX_MESSAGE_LEN) {
    throw new FeedbackError("invalid_input", `Feedback is too long (max ${MAX_MESSAGE_LEN} characters).`);
  }
  const email = input.email?.trim().slice(0, MAX_EMAIL_LEN) || null;
  const context = input.context?.trim().slice(0, MAX_CONTEXT_LEN) || null;

  const row: FeedbackRow = { id: randomUUID(), message, email, context, created_at: Date.now() };
  db.raw
    .prepare("INSERT INTO feedback (id, message, email, context, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, row.message, row.email, row.context, row.created_at);
  return row;
}

export function listFeedback(db: DbHandle, limit = 200): FeedbackRow[] {
  return db.raw
    .prepare("SELECT * FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(limit) as unknown as FeedbackRow[];
}
