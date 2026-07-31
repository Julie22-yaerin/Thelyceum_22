/**
 * The Second Brain store.
 *
 * The tree in /knowledge at the repo root is the template. Each workspace gets
 * its own copy, keyed by license key, because one customer's pricing floor must
 * never be reachable from another customer's agent — a single shared corpus
 * would make that a one-typo mistake instead of an impossible one.
 *
 * Documents are stored flat with a `path` field rather than as nested
 * collections. The path IS the scope (see contextRouter.ts), so keeping it a
 * plain string means scope checks are string comparisons with no traversal
 * semantics to get wrong.
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db/firestore.js";
import { guardIngest, type IngestVerdict } from "../security/ingestGuard.js";

export type DepartmentId = "dev_ops" | "finance" | "sales_outreach" | "qa_compliance";

export const DEPARTMENTS: { id: DepartmentId; name: string; blurb: string }[] = [
  { id: "dev_ops", name: "DevOps", blurb: "API docs, SLAs, failover and breaker config" },
  { id: "finance", name: "Finance", blurb: "Pricing, cost calculators, margin targets" },
  { id: "sales_outreach", name: "Sales & Outreach", blurb: "Pitch scripts, targeting, templates" },
  { id: "qa_compliance", name: "QA & Compliance", blurb: "Output schemas, grounding benchmarks" },
];

export interface BrainDocument {
  id: string;
  licenseKey: string;
  /** Tree position, e.g. "departments/finance/pricing.md". Also the scope key. */
  path: string;
  title: string;
  body: string;
  /**
   * Injected into every request in scope regardless of keyword match. Reserved
   * for rules and safety policy — a document that is always on stops being
   * evidence and starts being overhead.
   */
  alwaysInclude: boolean;
  /** Where it came from: seeded template, human upload, or librarian filing. */
  origin: "template" | "upload" | "librarian";
  /**
   * What the ingest guard did to this document. Present whenever it was
   * changed or flagged — an operator must be able to see why what is stored
   * differs from what they pasted.
   */
  ingest?: {
    action: IngestVerdict["action"];
    findings: IngestVerdict["findings"];
    removed: IngestVerdict["removed"];
    at: number;
  };
  createdAt: number;
  updatedAt: number;
}

/** Thrown when a document is refused because it carries an injection payload. */
export class IngestBlockedError extends Error {
  readonly code = "INGEST_BLOCKED";
  constructor(readonly verdict: IngestVerdict) {
    super(
      `Refused to store this document: ${verdict.findings[0]?.explanation ?? "it contains instructions aimed at the assistant."}`
    );
    this.name = "IngestBlockedError";
  }
}

const collection = () => getDb().collection("brainDocuments");

// ── Template loading ─────────────────────────────────────────────────────────

/**
 * Find the template tree by walking up from both the running module and the
 * working directory.
 *
 * A fixed relative path does not survive the build: in source this file is
 * server/brain/knowledge.ts, but the server ships as a single bundled
 * dist/index.js, so "../../knowledge" means different places in dev and prod.
 * Searching for the directory instead of computing its offset is the only
 * version that works in both without a build step to keep in sync.
 */
function findTemplateRoot(): string | null {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 6; depth++) {
      const candidate = path.join(dir, "knowledge");
      // Probe for a known child, not just the folder: a stray "knowledge"
      // directory that isn't ours should not be mistaken for the template.
      if (existsSync(path.join(candidate, "global"))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const TEMPLATE_ROOT = findTemplateRoot();

/** Documents that carry the rules, and so ride along on every request in scope. */
const ALWAYS_INCLUDE = new Set(["global/company.md"]);

async function walk(dir: string, base = ""): Promise<{ rel: string; abs: string }[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // template absent (e.g. a trimmed deploy) — seeding is a no-op
  }
  const out: { rel: string; abs: string }[] = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(abs, rel)));
    else if (/\.(md|json|txt)$/i.test(e.name)) out.push({ rel, abs });
  }
  return out;
}

/** Strip YAML frontmatter — it is metadata for humans, not grounding text. */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  return end === -1 ? raw : raw.slice(end + 4).trimStart();
}

function titleFor(rel: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(rel);
}

let warnedNoTemplate = false;

export async function readTemplate(): Promise<
  { path: string; title: string; body: string; alwaysInclude: boolean }[]
> {
  if (!TEMPLATE_ROOT) {
    // Seeding nothing would leave every agent ungrounded and refusing, which
    // looks like a scope bug rather than a missing deploy artifact. Say so.
    if (!warnedNoTemplate) {
      warnedNoTemplate = true;
      console.warn(
        "[Lyceum] Second Brain template not found — /knowledge is missing from this deploy. " +
          "Workspaces will start empty and every agent will refuse for lack of grounding."
      );
    }
    return [];
  }
  const files = await walk(TEMPLATE_ROOT);
  const out = [];
  for (const { rel, abs } of files) {
    if (rel === "README.md") continue; // explains the tree to humans, not agents
    const raw = await readFile(abs, "utf8");
    const body = stripFrontmatter(raw);
    out.push({
      path: rel,
      title: titleFor(rel, body),
      body,
      alwaysInclude: ALWAYS_INCLUDE.has(rel),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Per-tenant store ─────────────────────────────────────────────────────────

export async function listDocuments(licenseKey: string): Promise<BrainDocument[]> {
  const snap = await collection().where("licenseKey", "==", licenseKey).get();
  return (snap.docs ?? [])
    .map((d) => d.data() as BrainDocument)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function getDocument(
  licenseKey: string,
  docPath: string
): Promise<BrainDocument | null> {
  const all = await listDocuments(licenseKey);
  return all.find((d) => d.path === docPath) ?? null;
}

export async function putDocument(params: {
  licenseKey: string;
  path: string;
  title: string;
  body: string;
  alwaysInclude?: boolean;
  origin?: BrainDocument["origin"];
}): Promise<BrainDocument> {
  const origin = params.origin ?? "upload";

  /**
   * Screen the body before it can become grounding.
   *
   * This lives in putDocument rather than in the API route on purpose: it is
   * the single chokepoint every write goes through — the route, the librarian,
   * the seeder, and anything added later. A guard placed on one caller is a
   * guard that the next caller forgets.
   *
   * The template is exempt: it ships in the repo, is reviewed like code, and
   * legitimately contains sentences about rules that would trip the detector.
   */
  const guarded =
    origin === "template"
      ? null
      : guardIngest(params.body, {
          // A person pasting their own document gets it flagged and stored;
          // automated filing gets it refused. An operator who cannot file
          // their own material will paste it somewhere we cannot see at all.
          source: origin === "librarian" ? "automated" : "human",
        });

  if (guarded?.action === "block") throw new IngestBlockedError(guarded);

  const body = guarded ? guarded.cleanText : params.body;
  const ingest =
    guarded && guarded.action !== "allow"
      ? {
          action: guarded.action,
          findings: guarded.findings,
          removed: guarded.removed,
          at: Date.now(),
        }
      : undefined;

  const existing = await getDocument(params.licenseKey, params.path);
  const now = Date.now();

  if (existing) {
    const updated: BrainDocument = {
      ...existing,
      title: params.title,
      body,
      alwaysInclude: params.alwaysInclude ?? existing.alwaysInclude,
      origin: params.origin ?? existing.origin,
      ingest: ingest ?? existing.ingest,
      updatedAt: now,
    };
    await collection().doc(existing.id).set(updated, { merge: true });
    return updated;
  }

  const ref = collection().doc();
  const doc: BrainDocument = {
    id: ref.id,
    licenseKey: params.licenseKey,
    path: params.path,
    title: params.title,
    body,
    alwaysInclude: params.alwaysInclude ?? false,
    origin,
    ingest,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
}

export async function deleteDocument(licenseKey: string, docPath: string): Promise<boolean> {
  const doc = await getDocument(licenseKey, docPath);
  if (!doc) return false;
  const ref = collection().doc(doc.id);
  // Tombstone rather than hard-delete: an agent's answer cites the documents it
  // was grounded on, and a citation that resolves to nothing is unauditable.
  await ref.set({ ...doc, body: "", title: `${doc.title} (deleted)`, updatedAt: Date.now() }, { merge: true });
  return true;
}

/**
 * Seed a workspace from the template. Idempotent: existing documents at the
 * same path are left alone, so re-seeding never overwrites a customer's edits.
 */
export async function seedBrain(licenseKey: string): Promise<{ created: number; skipped: number }> {
  const template = await readTemplate();
  const existing = new Set((await listDocuments(licenseKey)).map((d) => d.path));
  let created = 0;
  let skipped = 0;

  for (const t of template) {
    if (existing.has(t.path)) {
      skipped++;
      continue;
    }
    await putDocument({
      licenseKey,
      path: t.path,
      title: t.title,
      body: t.body,
      alwaysInclude: t.alwaysInclude,
      origin: "template",
    });
    created++;
  }
  return { created, skipped };
}
