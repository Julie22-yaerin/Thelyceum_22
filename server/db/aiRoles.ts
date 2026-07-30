import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firestore.js";

/**
 * Roles that connected AI clients (Claude Desktop/Code, Cursor, …) register
 * for themselves over MCP. This is how an outside AI announces "I am the
 * copywriter for the Marketing department" — the workspace then knows which
 * department it belongs to, and every token it burns is attributed to it.
 */

export interface AiRole {
  id: string;
  licenseKey: string;
  /** Display name the AI chose, e.g. "Newsletter Copywriter". */
  name: string;
  /** Department tag it serves, e.g. "marketing". Free-form on purpose so a
   *  client can serve a custom department the user invented. */
  department: string;
  /** One line on what it's for — shown to humans in the workspace. */
  purpose: string;
  /** Which MCP client registered it, if it told us. */
  client?: string;
  tokensUsed: number;
  /** Cap in tokens; 0 = no cap. Enforced by reportTokens(). */
  tokenBudget: number;
  createdAt: number;
  lastSeenAt: number;
}

const collection = () => getDb().collection("aiRoles");

/** Deterministic id so re-registering the same role updates rather than duplicates. */
function roleId(licenseKey: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${licenseKey.slice(0, 12)}--${slug}`;
}

export async function registerAiRole(params: {
  licenseKey: string;
  name: string;
  department: string;
  purpose: string;
  client?: string;
  tokenBudget?: number;
}): Promise<AiRole> {
  const id = roleId(params.licenseKey, params.name);
  const ref = collection().doc(id);
  const existing = await ref.get();
  const now = Date.now();

  if (existing.exists) {
    // Re-registration: refresh the description, keep usage history intact.
    await ref.set(
      {
        department: params.department,
        purpose: params.purpose,
        client: params.client,
        ...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
        lastSeenAt: now,
      },
      { merge: true }
    );
    return (await ref.get()).data() as AiRole;
  }

  const role: AiRole = {
    id,
    licenseKey: params.licenseKey,
    name: params.name,
    department: params.department,
    purpose: params.purpose,
    client: params.client,
    tokensUsed: 0,
    tokenBudget: params.tokenBudget ?? 0,
    createdAt: now,
    lastSeenAt: now,
  };
  await ref.set(role);
  return role;
}

export async function listAiRoles(licenseKey: string): Promise<AiRole[]> {
  const snap = await collection().where("licenseKey", "==", licenseKey).get();
  return snap.docs
    .map((d) => d.data() as AiRole)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export async function getAiRole(licenseKey: string, name: string): Promise<AiRole | null> {
  const snap = await collection().doc(roleId(licenseKey, name)).get();
  if (!snap.exists) return null;
  const role = snap.data() as AiRole;
  return role.licenseKey === licenseKey ? role : null;
}

export class TokenBudgetExceededError extends Error {
  constructor(
    public roleName: string,
    public used: number,
    public budget: number
  ) {
    super(`Role "${roleName}" is over its token budget (${used}/${budget})`);
  }
}

/**
 * Attribute token spend to a role. Atomic, and refuses the write once the
 * role's own budget is spent so a runaway client can't quietly keep billing.
 */
export async function reportTokens(
  licenseKey: string,
  name: string,
  tokens: number
): Promise<AiRole> {
  const db = getDb();
  const ref = collection().doc(roleId(licenseKey, name));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`No AI role named "${name}" — register it first.`);
    const role = snap.data() as AiRole;
    if (role.licenseKey !== licenseKey) throw new Error(`No AI role named "${name}".`);

    const next = role.tokensUsed + tokens;
    if (role.tokenBudget > 0 && next > role.tokenBudget) {
      throw new TokenBudgetExceededError(name, role.tokensUsed, role.tokenBudget);
    }

    tx.update(ref, { tokensUsed: FieldValue.increment(tokens), lastSeenAt: Date.now() });
    return { ...role, tokensUsed: next };
  });
}

export async function setTokenBudget(
  licenseKey: string,
  name: string,
  budget: number
): Promise<void> {
  const ref = collection().doc(roleId(licenseKey, name));
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as AiRole).licenseKey !== licenseKey) {
    throw new Error(`No AI role named "${name}".`);
  }
  await ref.set({ tokenBudget: budget }, { merge: true });
}
