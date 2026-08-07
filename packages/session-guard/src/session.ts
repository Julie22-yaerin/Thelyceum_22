import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { hashPassword, verifyPassword, type PasswordHash } from "./hash.js";

const GUARD_DIR = path.join(os.homedir(), ".session-guard");
const AUTH_FILE = path.join(GUARD_DIR, "auth.json");
const SESSION_FILE = path.join(GUARD_DIR, "session.json");

export interface SessionState {
  token: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthConfig {
  isInitialized: boolean;
  passwordData?: PasswordHash;
  createdAt: number;
}

function ensureDir(): void {
  if (!fs.existsSync(GUARD_DIR)) {
    fs.mkdirSync(GUARD_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Check if the master password has been configured.
 */
export function isPasswordSet(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const config: AuthConfig = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    return !!config.isInitialized && !!config.passwordData;
  } catch {
    return false;
  }
}

/**
 * Set up the master password on first run.
 */
export function setupMasterPassword(password: string): AuthConfig {
  if (isPasswordSet()) {
    throw new Error("Master password is already set up.");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }

  ensureDir();
  const passwordData = hashPassword(password);
  const config: AuthConfig = {
    isInitialized: true,
    passwordData,
    createdAt: Date.now(),
  };

  fs.writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

/**
 * Verify session password and issue a valid session token (default TTL: 8 hours).
 */
export function authenticateSession(password: string, ttlMs: number = 8 * 3600 * 1000): SessionState {
  if (!isPasswordSet()) {
    throw new Error("System is not initialized. Please set up a master password first.");
  }

  const config: AuthConfig = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  const isValid = verifyPassword(password, config.passwordData!);

  if (!isValid) {
    throw new Error("Invalid password.");
  }

  ensureDir();
  const token = crypto.randomBytes(32).toString("hex");
  const session: SessionState = {
    token,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };

  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  return session;
}

/**
 * Check if an active session is valid and unexpired.
 */
export function validateActiveSession(): boolean {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const session: SessionState = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    return Date.now() < session.expiresAt;
  } catch {
    return false;
  }
}

/**
 * Terminate the current active session.
 */
export function logoutSession(): void {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}
