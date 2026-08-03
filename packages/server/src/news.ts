/**
 * The waiting-room feed.
 *
 * Applicants who've paid the deposit land in a room with nothing to do but
 * wait — this is what gives them something true to look at while they do:
 * progress notes, new tests, new benchmark runs, posted by whoever is
 * running the dev-token-gated publish script. There is no editing or
 * deleting from here on purpose — a public log that can be quietly
 * rewritten isn't a log an applicant should trust, so a correction is a new
 * entry, not an edit of the old one.
 */

import { randomUUID } from "node:crypto";
import type { DbHandle, NewsRow, NewsCategory } from "./db.js";

const CATEGORIES: NewsCategory[] = ["progress", "test", "benchmark"];

export function isNewsCategory(value: unknown): value is NewsCategory {
  return typeof value === "string" && (CATEGORIES as string[]).includes(value);
}

export interface NewsInput {
  category: NewsCategory;
  title: string;
  body: string;
}

export function publish(db: DbHandle, input: NewsInput): NewsRow {
  const id = randomUUID();
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO news (id, category, title, body, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, input.category, input.title.trim(), input.body.trim(), now);
  return getById(db, id)!;
}

export function getById(db: DbHandle, id: string): NewsRow | null {
  return (db.raw.prepare("SELECT * FROM news WHERE id = ?").get(id) as unknown as NewsRow | undefined) ?? null;
}

export function list(db: DbHandle, limit = 50): NewsRow[] {
  const capped = Math.min(Math.max(1, limit), 200);
  return db.raw
    .prepare("SELECT * FROM news ORDER BY created_at DESC LIMIT ?")
    .all(capped) as unknown as NewsRow[];
}
