/**
 * The waitlist.
 *
 * This is an application, not a signup. Three things make it one:
 *
 *   1. It asks for a name, an organisation, a work email and a phone number,
 *      and refuses free-mail domains. Someone who will not give a company
 *      address is not the buyer this is for.
 *   2. It carries a refundable deposit. A free list fills with people who will
 *      never buy and tells you nothing about demand; a small amount of friction
 *      filters to people who actually intend to.
 *   3. Nothing is approved automatically. `status` moves pending → paid →
 *      approved only when a human decides, in the admin console.
 *
 * ── On the free-mail block ──────────────────────────────────────────────────
 * It is a filter, not a security control. A determined person can register a
 * domain in ten minutes, and a real prospect at a small company might
 * legitimately use Gmail. So the message says what to do about it rather than
 * just refusing, and the admin console shows every application including the
 * ones that argued their way in — the block exists to keep the list signal
 * high, not to be unbeatable.
 */

import { randomUUID } from "node:crypto";
import type { DbHandle, WaitlistRow, WaitlistStatus } from "./db.js";

/**
 * Consumer mail providers. Deliberately short: this is the head of the
 * distribution, and a longer list mostly adds false positives at small
 * companies that use a provider's business tier on a custom domain.
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mail.com", "gmx.com", "gmx.net", "yandex.com", "yandex.ru", "zoho.com",
  "protonmail.com", "proton.me", "tutanota.com", "fastmail.com",
  // Disposable — these are always a reject, no judgement call needed.
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwawaymail.com", "trashmail.com", "yopmail.com", "sharklasers.com",
]);

export interface ApplicationInput {
  name: string;
  organisation: string;
  workEmail: string;
  phone: string;
  fleetSize?: string;
  note?: string;
}

export type ValidationError = { field: string; message: string };

/**
 * Validate an application.
 *
 * Returns every problem at once rather than the first one. A form that
 * surfaces one error per submit makes a four-field application feel like an
 * interrogation, and the people it annoys most are the serious ones.
 */
export function validateApplication(input: Partial<ApplicationInput>): ValidationError[] {
  const errors: ValidationError[] = [];

  const name = (input.name ?? "").trim();
  if (name.length < 2) {
    errors.push({ field: "name", message: "Please give your full name." });
  }

  const org = (input.organisation ?? "").trim();
  if (org.length < 2) {
    errors.push({ field: "organisation", message: "Which company or team is this for?" });
  }

  const email = (input.workEmail ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.push({ field: "workEmail", message: "That doesn't look like an email address." });
  } else {
    const domain = email.split("@")[1];
    if (FREE_MAIL_DOMAINS.has(domain)) {
      errors.push({
        field: "workEmail",
        message:
          "Please use your work address. If your team genuinely runs on a personal domain, email us directly and we'll add you by hand.",
      });
    }
  }

  // Deliberately loose: phone formats vary by country far more than any regex
  // handles well, and rejecting a valid number is worse than accepting a
  // malformed one we can ask about later.
  const phone = (input.phone ?? "").replace(/[\s()\-.]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) {
    errors.push({ field: "phone", message: "Please give a phone number we can reach you on, with country code." });
  }

  return errors;
}

export class WaitlistError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WaitlistError";
  }
}

export function apply(db: DbHandle, input: ApplicationInput): WaitlistRow {
  const errors = validateApplication(input);
  if (errors.length > 0) {
    throw new WaitlistError("invalid_input", errors.map((e) => e.message).join(" "));
  }

  const email = input.workEmail.trim().toLowerCase();
  const existing = db.raw
    .prepare("SELECT * FROM waitlist WHERE work_email = ?")
    .get(email) as unknown as WaitlistRow | undefined;
  if (existing) {
    // Not an error the applicant needs to solve — tell them where they stand
    // instead of making them think the form is broken.
    throw new WaitlistError(
      "already_applied",
      existing.status === "approved"
        ? "You're already approved — check your email for the invite."
        : "You're already on the list. We'll be in touch."
    );
  }

  const id = randomUUID();
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO waitlist
         (id, name, organisation, work_email, phone, fleet_size, note, status, deposit_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`
    )
    .run(
      id,
      input.name.trim(),
      input.organisation.trim(),
      email,
      input.phone.trim(),
      input.fleetSize?.trim() ?? null,
      input.note?.trim() ?? null,
      now
    );

  return getById(db, id)!;
}

export function getById(db: DbHandle, id: string): WaitlistRow | null {
  return (
    (db.raw.prepare("SELECT * FROM waitlist WHERE id = ?").get(id) as unknown as WaitlistRow | undefined) ?? null
  );
}

export function getByEmail(db: DbHandle, email: string): WaitlistRow | null {
  return (
    (db.raw
      .prepare("SELECT * FROM waitlist WHERE work_email = ?")
      .get(email.trim().toLowerCase()) as unknown as WaitlistRow | undefined) ?? null
  );
}

/** Called by the Lemon Squeezy webhook when the deposit clears. */
export function markDepositPaid(
  db: DbHandle,
  email: string,
  depositCents: number,
  lsOrderId: string | null
): WaitlistRow | null {
  const row = getByEmail(db, email);
  if (!row) return null;
  // Only advance from pending. A repeat webhook delivery must not push an
  // already-approved application back to "paid".
  if (row.status !== "pending") return row;
  db.raw
    .prepare("UPDATE waitlist SET status = 'paid', deposit_cents = ?, ls_order_id = ? WHERE id = ?")
    .run(depositCents, lsOrderId, row.id);
  return getById(db, row.id);
}

export function setStatus(
  db: DbHandle,
  id: string,
  status: WaitlistStatus,
  reviewedBy: string
): WaitlistRow | null {
  const row = getById(db, id);
  if (!row) return null;
  db.raw
    .prepare("UPDATE waitlist SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
    .run(status, reviewedBy, Date.now(), id);
  return getById(db, id);
}

export interface ListOptions {
  status?: WaitlistStatus;
  limit?: number;
}

export function list(db: DbHandle, opts: ListOptions = {}): WaitlistRow[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000);
  if (opts.status) {
    return db.raw
      .prepare("SELECT * FROM waitlist WHERE status = ? ORDER BY created_at DESC LIMIT ?")
      .all(opts.status, limit) as unknown as WaitlistRow[];
  }
  return db.raw
    .prepare("SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as WaitlistRow[];
}

export function counts(db: DbHandle): Record<WaitlistStatus | "total", number> {
  const rows = db.raw
    .prepare("SELECT status, COUNT(*) as n FROM waitlist GROUP BY status")
    .all() as unknown as { status: WaitlistStatus; n: number }[];
  const out = { pending: 0, paid: 0, approved: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    out[r.status] = Number(r.n);
    out.total += Number(r.n);
  }
  return out;
}
