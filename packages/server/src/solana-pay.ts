/**
 * Solana Pay checkout — USDC, on-chain verified, auto-assigns a pool slot.
 *
 * Same manual-sale pool as sub-license.ts, but this path never needs a human
 * to click "taken": a confirmed on-chain transfer to the configured wallet,
 * for the right amount, in USDC, tied to this checkout's `reference`, is
 * itself the authorization. `findReference` + `validateTransfer` are the
 * official Solana Pay merchant-side verification calls — reference alone
 * only proves *a* transaction happened; validateTransfer is what confirms
 * it paid the right recipient the right amount in the right token, which is
 * why both run, not just the first.
 *
 * The chain client (findReference/validateTransfer/getRecipient) is
 * injectable so tests never need a real RPC call — see solana-pay.test.ts.
 */

import { randomUUID } from "node:crypto";
import { Keypair, PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import { encodeURL, findReference, validateTransfer, FindReferenceError, ValidateTransferError } from "@solana/pay";
import BigNumber from "bignumber.js";
import QRCode from "qrcode";
import type { DbHandle } from "./db.js";
import { autoAssignLicense, SubLicenseError } from "./sub-license.js";

/** USDC's official SPL mint on Solana mainnet — same for everyone, not configurable. */
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
/** Matches pricing.js: $42 / 2 connections. */
export const PRICE_PER_CONNECTION_USD = 21;
const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;

export class SolanaPayError extends Error {
  constructor(
    public code: "invalid_input" | "not_configured" | "not_found" | "pool_exhausted",
    message: string
  ) {
    super(message);
    this.name = "SolanaPayError";
  }
}

export function getRecipient(): PublicKey {
  const addr = process.env.SOLANA_RECIPIENT_WALLET;
  if (!addr) throw new SolanaPayError("not_configured", "SOLANA_RECIPIENT_WALLET is not set.");
  return new PublicKey(addr);
}

export function getConnection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("mainnet-beta"), "confirmed");
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateCheckoutResult {
  reference: string;
  url: string;
  amountUsdc: number;
  connections: number;
}

export function createCheckout(db: DbHandle, connections: number): CreateCheckoutResult {
  if (!Number.isInteger(connections) || connections < 2 || connections > 15) {
    throw new SolanaPayError("invalid_input", "connections must be an integer between 2 and 15.");
  }
  const amountUsdc = connections * PRICE_PER_CONNECTION_USD;
  const referenceKeypair = Keypair.generate();
  const reference = referenceKeypair.publicKey;

  const url = encodeURL({
    recipient: getRecipient(),
    amount: new BigNumber(amountUsdc),
    splToken: USDC_MINT,
    reference,
    label: "The Lyceum",
    message: `${connections} connection${connections === 1 ? "" : "s"}, 1 month`,
  });

  db.raw
    .prepare(
      "INSERT INTO solana_checkouts (reference, amount_usdc, connections, status, license_id, created_at, confirmed_at) VALUES (?, ?, ?, 'pending', NULL, ?, NULL)"
    )
    .run(reference.toBase58(), amountUsdc.toString(), connections, Date.now());

  return { reference: reference.toBase58(), url: url.toString(), amountUsdc, connections };
}

export async function checkoutQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", width: 320, margin: 1 });
}

// ── Status / verify ──────────────────────────────────────────────────────

interface CheckoutRow {
  reference: string;
  amount_usdc: string;
  connections: number;
  status: "pending" | "confirmed";
  license_id: string | null;
  created_at: number;
  confirmed_at: number | null;
}

export interface StatusResult {
  status: "pending" | "confirmed";
  licenseKey?: string;
}

/** The real Solana calls, factored out so tests can substitute fakes. */
export interface ChainClient {
  findReference: typeof findReference;
  validateTransfer: typeof validateTransfer;
}

export const liveChainClient: ChainClient = { findReference, validateTransfer };

export async function checkoutStatus(
  db: DbHandle,
  reference: string,
  chain: ChainClient = liveChainClient
): Promise<StatusResult> {
  const row = db.raw.prepare("SELECT * FROM solana_checkouts WHERE reference = ?").get(reference) as
    | CheckoutRow
    | undefined;
  if (!row) throw new SolanaPayError("not_found", "No such checkout.");

  if (row.status === "confirmed") {
    const license = row.license_id
      ? (db.raw.prepare("SELECT license_key FROM subscription_licenses WHERE id = ?").get(row.license_id) as
          | { license_key: string }
          | undefined)
      : undefined;
    return { status: "confirmed", licenseKey: license?.license_key };
  }

  const referencePubkey = new PublicKey(reference);
  const connection = getConnection();

  let signatureInfo;
  try {
    signatureInfo = await chain.findReference(connection, referencePubkey, { finality: "confirmed" });
  } catch (err) {
    if (err instanceof FindReferenceError) return { status: "pending" };
    throw err;
  }

  try {
    await chain.validateTransfer(connection, signatureInfo.signature, {
      recipient: getRecipient(),
      amount: new BigNumber(row.amount_usdc),
      splToken: USDC_MINT,
      reference: referencePubkey,
    });
  } catch (err) {
    // A transaction referencing this checkout exists but doesn't satisfy
    // the required recipient/amount/token — not a match, keep waiting
    // rather than confirming on an unverified transfer.
    if (err instanceof ValidateTransferError) return { status: "pending" };
    throw err;
  }

  // Confirmed. Assign the slot and record it — this whole block runs inside
  // a transaction so a crash between the two writes can't leave a license
  // handed out with no checkout row pointing at it, or vice versa.
  const label = `solana-pay:${row.connections}c:${reference.slice(0, 8)}`;
  let licenseKey = "";
  try {
    db.tx(() => {
      const license = autoAssignLicense(db, label, SUBSCRIPTION_MS);
      licenseKey = license.license_key;
      db.raw
        .prepare("UPDATE solana_checkouts SET status = 'confirmed', license_id = ?, confirmed_at = ? WHERE reference = ?")
        .run(license.id, Date.now(), reference);
    });
  } catch (err) {
    // Money has already changed hands at this point — this is a real
    // operational problem (pool sold out), not a "not yet paid" state, so
    // it must not collapse into the same "pending" response a not-yet-found
    // transaction gets. The checkout row stays 'pending'; the next poll
    // retries the assignment once the operator adds more slots.
    if (err instanceof SubLicenseError) {
      throw new SolanaPayError("pool_exhausted", err.message);
    }
    throw err;
  }

  return { status: "confirmed", licenseKey };
}
