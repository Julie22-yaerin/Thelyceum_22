/**
 * Second Brain routes — the knowledge every agent is grounded on, and the
 * guards that read from it.
 *
 * Grouped by what an operator is doing rather than by which module the handler
 * calls: filing a document, previewing what a department would see, and
 * fact-checking a draft are one job, so they live together.
 */

import type express from "express";
import type { AuthedRequest } from "../lib/auth.js";
import {
  seedBrain,
  listDocuments as listBrainDocuments,
  putDocument as putBrainDocument,
  deleteDocument as deleteBrainDocument,
  DEPARTMENTS,
  IngestBlockedError,
  type DepartmentId,
} from "../brain/knowledge.js";
import { routeContext, scopeFor, buildSystemPrompt } from "../brain/contextRouter.js";
import { fileDocument, classify } from "../brain/librarian.js";
import { scopeForDepartment, GLOBAL_NEVER_ALLOWED } from "../pillars/scopeGuard.js";
import { verifyOutput } from "../pillars/factGuard.js";
import { arbitrate, type AgentPosition } from "../pillars/arbitration.js";
import { DEFAULT_FAILOVER } from "../pillars/failover.js";
import { isEphemeralStore } from "../db/firestore.js";

type Authenticate = express.RequestHandler;

export function registerBrainRoutes(app: express.Express, authenticateLicenseKey: Authenticate): void {
  // ── Second Brain ─────────────────────────────────────────────────────────
  // The knowledge every agent is grounded on. Scoped per workspace and per
  // department: what an agent can read is decided here, not by the agent.

  app.get("/api/v1/brain", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    let docs = await listBrainDocuments(licenseKey);

    // First visit to an empty workspace seeds the template, so the brain is
    // never an empty screen the operator has to populate before anything works.
    if (docs.length === 0) {
      await seedBrain(licenseKey);
      docs = await listBrainDocuments(licenseKey);
    }

    res.json({
      ephemeralStore: isEphemeralStore(),
      departments: DEPARTMENTS.map((d) => ({
        ...d,
        scope: scopeFor(d.id),
        tools: scopeForDepartment(d.id),
        documentCount: docs.filter((doc) => doc.path.startsWith(`departments/${d.id}/`)).length,
      })),
      globalNeverAllowed: GLOBAL_NEVER_ALLOWED,
      failover: DEFAULT_FAILOVER,
      documents: docs.map((d) => ({
        id: d.id,
        path: d.path,
        title: d.title,
        alwaysInclude: d.alwaysInclude,
        origin: d.origin,
        updatedAt: d.updatedAt,
        preview: d.body.slice(0, 240),
      })),
    });
  });

  app.post("/api/v1/brain/documents", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { title, body, department } = req.body ?? {};
    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required" });
    }
    try {
      const result = await fileDocument({
        licenseKey,
        title: String(title),
        body: String(body),
        department: department as DepartmentId | undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      // A refused document is not a server error — it is the guard doing its
      // job, and the operator needs the evidence to judge it themselves.
      if (err instanceof IngestBlockedError) {
        return res.status(422).json({
          error: err.message,
          findings: err.verdict.findings,
          hint: "This document contains instructions aimed at the assistant. If it is genuinely yours, remove those lines and try again.",
        });
      }
      throw err;
    }
  });

  /** Where would this land? Lets the operator see the filing before committing. */
  app.post("/api/v1/brain/classify", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { title, body } = req.body ?? {};
    if (!title && !body) return res.status(400).json({ error: "title or body is required" });
    res.json(await classify(String(title ?? ""), String(body ?? "")));
  });

  app.delete("/api/v1/brain/documents", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const path = String(req.query.path ?? "");
    if (!path) return res.status(400).json({ error: "path is required" });
    const ok = await deleteBrainDocument(licenseKey, path);
    res.json({ deleted: ok });
  });

  /**
   * Show exactly what an agent in this department would be given for a query —
   * scope, documents, and the literal system prompt. The setup screen uses it
   * so an operator can verify isolation themselves rather than trusting a
   * checkbox that says "isolated".
   */
  app.post("/api/v1/brain/preview", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { department, query, agentName, role } = req.body ?? {};
    if (!department || !query) {
      return res.status(400).json({ error: "department and query are required" });
    }
    const context = await routeContext({
      licenseKey,
      department: department as DepartmentId,
      query: String(query),
    });
    res.json({
      scope: context.scope,
      empty: context.empty,
      documents: context.documents.map((d) => ({ path: d.path, title: d.title })),
      systemPrompt: buildSystemPrompt({
        context,
        agentName: String(agentName || "Agent"),
        role: String(role || "assistant"),
      }),
    });
  });

  /** Check a draft against the brain without spending a model call. */
  app.post("/api/v1/pillars/factcheck", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { department, query, output } = req.body ?? {};
    if (!department || !output) {
      return res.status(400).json({ error: "department and output are required" });
    }
    const context = await routeContext({
      licenseKey,
      department: department as DepartmentId,
      query: String(query ?? output),
    });
    res.json(verifyOutput({ output: String(output), context: context.groundingText }));
  });

  /** Resolve a disagreement between agents. Deterministic; no model call. */
  app.post("/api/v1/pillars/arbitrate", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const positions = req.body?.positions;
    if (!Array.isArray(positions)) {
      return res.status(400).json({ error: "positions[] is required" });
    }
    res.json(arbitrate(positions as AgentPosition[]));
  });

}
