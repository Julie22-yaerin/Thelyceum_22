/**
 * Solana Pay checkout.
 *
 * The chain itself (findReference/validateTransfer) is never really called
 * here — a fake ChainClient stands in, because a unit test hitting mainnet
 * RPC would be slow, flaky, and impossible to put in a "payment confirmed"
 * state on demand. What's actually under test: the state machine around
 * those two calls — pending vs confirmed, idempotent re-polling, an
 * unmatched transfer NOT confirming, and the pool-exhausted case — which is
 * exactly the part a real integration test wouldn't exercise reliably either.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { FindReferenceError, ValidateTransferError } from "@solana/pay";
import { openDb, type DbHandle } from "../src/db.js";
import { seedLicensePool } from "../src/sub-license.js";
import {
  createCheckout,
  checkoutStatus,
  SolanaPayError,
  PRICE_PER_CONNECTION_USD,
  type ChainClient,
} from "../src/solana-pay.js";

const ADMIN = { fingerprint: "fp_solana_pay_admin" };
const RECIPIENT = Keypair.generate().publicKey.toBase58();

let dir: string;
let db: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-solana-pay-test-"));
  db = openDb(join(dir, "test.db"));
  process.env.SOLANA_RECIPIENT_WALLET = RECIPIENT;
  seedLicensePool(db, ADMIN, 2);
});

function fakeChain(overrides: Partial<ChainClient> = {}): ChainClient {
  return {
    findReference: (async () => {
      throw new FindReferenceError("not found");
    }) as ChainClient["findReference"],
    validateTransfer: (async () => {
      throw new Error("should not be called");
    }) as ChainClient["validateTransfer"],
    ...overrides,
  };
}

const CONFIRMED_SIGNATURE = { signature: "fakeSig123", confirmationStatus: "confirmed" };

describe("createCheckout", () => {
  it("computes amount from connections at $21/connection", () => {
    const result = createCheckout(db, 5);
    expect(result.amountUsdc).toBe(5 * PRICE_PER_CONNECTION_USD);
    expect(result.connections).toBe(5);
  });

  it("produces a Solana Pay URL and a fresh reference each time", () => {
    const a = createCheckout(db, 2);
    const b = createCheckout(db, 2);
    expect(a.reference).not.toBe(b.reference);
    expect(a.url).toMatch(/^solana:/);
  });

  it("rejects connections outside 2-15", () => {
    expect(() => createCheckout(db, 1)).toThrow(SolanaPayError);
    expect(() => createCheckout(db, 16)).toThrow(SolanaPayError);
    expect(() => createCheckout(db, 2.5)).toThrow(SolanaPayError);
  });
});

describe("checkoutStatus", () => {
  it("is pending before any matching transaction is found on-chain", async () => {
    const { reference } = createCheckout(db, 2);
    const result = await checkoutStatus(db, reference, fakeChain());
    expect(result.status).toBe("pending");
  });

  it("confirms and assigns a license once the transfer validates", async () => {
    const { reference } = createCheckout(db, 2);
    const chain = fakeChain({
      findReference: (async () => CONFIRMED_SIGNATURE) as ChainClient["findReference"],
      validateTransfer: (async () => CONFIRMED_SIGNATURE) as unknown as ChainClient["validateTransfer"],
    });
    const result = await checkoutStatus(db, reference, chain);
    expect(result.status).toBe("confirmed");
    expect(result.licenseKey).toMatch(/^LYCEUM-SUB-/);
  });

  it("stays pending if a transaction exists but doesn't validate (wrong amount/recipient/token)", async () => {
    const { reference } = createCheckout(db, 2);
    const chain = fakeChain({
      findReference: (async () => CONFIRMED_SIGNATURE) as ChainClient["findReference"],
      validateTransfer: (async () => {
        throw new ValidateTransferError("amount mismatch");
      }) as unknown as ChainClient["validateTransfer"],
    });
    const result = await checkoutStatus(db, reference, chain);
    expect(result.status).toBe("pending");
  });

  it("is idempotent — re-polling after confirmation doesn't re-verify or reassign", async () => {
    const { reference } = createCheckout(db, 2);
    let chainCalls = 0;
    const chain = fakeChain({
      findReference: (async () => {
        chainCalls++;
        return CONFIRMED_SIGNATURE;
      }) as ChainClient["findReference"],
      validateTransfer: (async () => CONFIRMED_SIGNATURE) as unknown as ChainClient["validateTransfer"],
    });

    const first = await checkoutStatus(db, reference, chain);
    const second = await checkoutStatus(db, reference, chain);

    expect(second.status).toBe("confirmed");
    expect(second.licenseKey).toBe(first.licenseKey);
    expect(chainCalls).toBe(1); // second call short-circuited on row.status === 'confirmed'
  });

  it("throws not_found for an unknown reference", async () => {
    await expect(checkoutStatus(db, new PublicKey(Keypair.generate().publicKey).toBase58(), fakeChain())).rejects.toThrow(
      SolanaPayError
    );
  });

  it("surfaces pool exhaustion instead of silently failing when confirmed with no slots left", async () => {
    // Pool was seeded with 2 slots in beforeEach; take both, then confirm a
    // third checkout and expect a clear error, not a crash or a phantom key.
    const rows = db.raw.prepare("SELECT id FROM subscription_licenses").all() as { id: string }[];
    for (const row of rows) {
      db.raw
        .prepare("UPDATE subscription_licenses SET status = 'taken', taken_at = ?, expires_at = ? WHERE id = ?")
        .run(Date.now(), Date.now() + 1000, row.id);
    }

    const { reference } = createCheckout(db, 2);
    const chain = fakeChain({
      findReference: (async () => CONFIRMED_SIGNATURE) as ChainClient["findReference"],
      validateTransfer: (async () => CONFIRMED_SIGNATURE) as unknown as ChainClient["validateTransfer"],
    });

    await expect(checkoutStatus(db, reference, chain)).rejects.toThrow(SolanaPayError);
  });
});
