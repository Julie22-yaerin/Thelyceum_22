#!/usr/bin/env node
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  isPasswordSet,
  setupMasterPassword,
  authenticateSession,
  validateActiveSession,
  logoutSession,
  issueTrialLicense,
  consumeTrialUsage,
  getTrialStatus,
} from "./index.js";

const args = process.argv.slice(2);
const command = args[0] || "status";

async function promptHidden(query: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const pwd = await rl.question(query);
  rl.close();
  return pwd.trim();
}

async function main() {
  try {
    switch (command) {
      case "init": {
        if (isPasswordSet()) {
          console.log("[session-guard] Master password is already initialized.");
          break;
        }
        const pwd1 = await promptHidden("Create Master Password: ");
        const pwd2 = await promptHidden("Confirm Master Password: ");
        if (pwd1 !== pwd2) {
          console.error("[error] Passwords do not match!");
          process.exit(1);
        }
        setupMasterPassword(pwd1);
        console.log("[success] Master password initialized successfully.");
        break;
      }

      case "login": {
        if (!isPasswordSet()) {
          console.log("[notice] Password not initialized. Running setup...");
          const pwd1 = await promptHidden("Create Master Password: ");
          const pwd2 = await promptHidden("Confirm Master Password: ");
          if (pwd1 !== pwd2) {
            console.error("[error] Passwords do not match!");
            process.exit(1);
          }
          setupMasterPassword(pwd1);
        }
        const pwd = await promptHidden("Enter Session Password: ");
        authenticateSession(pwd);
        console.log("[success] Session authenticated successfully.");
        break;
      }

      case "status": {
        const initialized = isPasswordSet();
        const active = validateActiveSession();
        const trialStatus = getTrialStatus();

        console.log(`[session-guard] Status:`);
        console.log(`  - Master Password Set: ${initialized ? "YES" : "NO"}`);
        console.log(`  - Active Session: ${active ? "VALID (Authenticated)" : "LOCKED / EXPIRED"}`);
        if (trialStatus.valid) {
          console.log(`  - Trial License: ACTIVE (${trialStatus.usesRemaining} uses left, ${trialStatus.daysRemaining} days remaining)`);
        } else {
          console.log(`  - Trial License: ${trialStatus.reason}`);
        }
        break;
      }

      case "trial-issue": {
        const maxUses = parseInt(args[1] || "20", 10);
        const validDays = parseInt(args[2] || "3", 10);
        const state = issueTrialLicense(maxUses, validDays);
        console.log(`[session-guard] Trial License Issued:`);
        console.log(`  - License ID: ${state.id}`);
        console.log(`  - Quota: ${state.maxUses} uses`);
        console.log(`  - Expiration: ${validDays} days (${new Date(state.expiresAt).toISOString()})`);
        break;
      }

      case "trial-check": {
        const res = consumeTrialUsage();
        if (res.valid) {
          console.log(`[trial] License valid. ${res.usesRemaining} uses remaining, ${res.daysRemaining} days left.`);
        } else {
          console.error(`[trial-error] ${res.reason}`);
          process.exit(1);
        }
        break;
      }

      case "lock":
      case "logout": {
        logoutSession();
        console.log("[session-guard] Current session locked.");
        break;
      }

      default:
        console.log(`Usage: session-guard <init | login | status | lock | trial-issue | trial-check>`);
        break;
    }
  } catch (err: any) {
    console.error(`[error] ${err.message}`);
    process.exit(1);
  }
}

main();
