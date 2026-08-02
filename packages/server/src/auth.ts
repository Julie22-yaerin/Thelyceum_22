/**
 * Password auth + session JWT.
 *
 * One session token per login; short TTL (7 days). The license JWT is a
 * separate token (30 days) — see `license.ts`. The session proves who the
 * caller is; the license proves what they are entitled to.
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { DbHandle, UserRow } from "./db.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SignupInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthError extends Error {
  constructor(public code: "email_taken" | "invalid_credentials" | "weak_password" | "not_found", message: string) {
    super(message);
  }
}

export interface AuthResult {
  user: UserRow;
  sessionToken: string;
}

export function signup(db: DbHandle, secret: string, input: SignupInput): AuthResult {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) throw new AuthError("not_found", "invalid email");
  if (input.password.length < 8) throw new AuthError("weak_password", "password must be at least 8 characters");

  const existing = db.raw.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (existing) throw new AuthError("email_taken", "email already registered");

  const id = randomUUID();
  const password_hash = bcrypt.hashSync(input.password, 10);
  const created_at = Date.now();
  db.raw.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    id, email, password_hash, created_at
  );

  const user = db.raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow;
  return { user, sessionToken: signSession(secret, user) };
}

export function login(db: DbHandle, secret: string, input: LoginInput): AuthResult {
  const email = input.email.trim().toLowerCase();
  const user = db.raw.prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as UserRow | undefined;
  if (!user) throw new AuthError("invalid_credentials", "email or password incorrect");
  if (!bcrypt.compareSync(input.password, user.password_hash)) {
    throw new AuthError("invalid_credentials", "email or password incorrect");
  }
  return { user, sessionToken: signSession(secret, user) };
}

export function getUserById(db: DbHandle, id: string): UserRow | null {
  return (db.raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined) ?? null;
}

/** Look a user up by email. Used by license-key entry to find the account a key belongs to. */
export function getUserByEmail(db: DbHandle, email: string): UserRow | null {
  const normalized = email.trim().toLowerCase();
  return (
    (db.raw.prepare("SELECT * FROM users WHERE email = ?").get(normalized) as unknown as UserRow | undefined) ?? null
  );
}

/** Issue a session token for a user. Exported so license-key entry (which is
 * the credential itself, like the admin console) can sign someone in. */
export function signSession(secret: string, user: UserRow): string {
  return jwt.sign({ sub: user.id, email: user.email }, secret, { expiresIn: SESSION_TTL_SECONDS });
}

export interface SessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export function verifySession(secret: string, token: string): SessionPayload {
  return jwt.verify(token, secret) as SessionPayload;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s) && s.length <= 254;
}
