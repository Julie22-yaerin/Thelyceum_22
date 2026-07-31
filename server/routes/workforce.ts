/**
 * Workforce routes — the AI roster and the shared task surface.
 *
 * Both the browser and a connected AI act on the same missions through these,
 * which is what stops the dashboard and the agent disagreeing about what is
 * assigned.
 */

import type express from "express";
import type { AuthedRequest } from "../lib/auth.js";
import {
  createWorker, listWorkers, revokeWorker, rotateWorkerToken,
} from "../db/workers.js";
import {
  createMission as createServerMission,
  listMissions as listServerMissions,
  updateStep as updateServerStep,
  progressOf,
} from "../db/missions.js";
import { isEphemeralStore } from "../db/firestore.js";

type Authenticate = express.RequestHandler;

export function registerWorkforceRoutes(app: express.Express, authenticateLicenseKey: Authenticate): void {
  // ── Roster: AI workers and their MCP URLs ───────────────────────────────

  const mcpUrlFor = (req: express.Request, token: string) =>
    `${req.protocol}://${req.get("host")}/api/mcp/w/${token}`;

  app.get("/api/v1/workers", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const workers = await listWorkers(req.lyceumAccount!.licenseKey);
    res.json({
      ephemeralStore: isEphemeralStore(),
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        departmentId: w.departmentId,
        departmentName: w.departmentName,
        model: w.model,
        tokensUsed: w.tokensUsed,
        stepsCompleted: w.stepsCompleted,
        lastSeenAt: w.lastSeenAt,
        // Full URL: this is the thing the customer pastes into their client,
        // and they will need it again every time they set up a new machine.
        mcpUrl: mcpUrlFor(req, w.mcpToken),
      })),
    });
  });

  app.post("/api/v1/workers", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { name, role, departmentId, departmentName, model } = (req.body ?? {}) as Record<string, string>;
    if (!name || !departmentId) {
      return res.status(400).json({ error: "name and departmentId are required" });
    }
    const worker = await createWorker({
      licenseKey: req.lyceumAccount!.licenseKey,
      name,
      role: role || "Assistant",
      departmentId,
      departmentName: departmentName || departmentId,
      model: model || "gpt-4o",
    });
    res.json({ worker: { ...worker, mcpUrl: mcpUrlFor(req, worker.mcpToken) } });
  });

  app.post("/api/v1/workers/:id/rotate", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const token = await rotateWorkerToken(req.lyceumAccount!.licenseKey, req.params.id);
    if (!token) return res.status(404).json({ error: "Worker not found" });
    res.json({ mcpUrl: mcpUrlFor(req, token) });
  });

  app.delete("/api/v1/workers/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const ok = await revokeWorker(req.lyceumAccount!.licenseKey, req.params.id);
    if (!ok) return res.status(404).json({ error: "Worker not found" });
    res.json({ revoked: true });
  });

  // ── Missions: the shared surface the UI and connected AI both act on ────

  app.get("/api/v1/missions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const missions = await listServerMissions(
      req.lyceumAccount!.licenseKey,
      typeof req.query.department === "string" ? req.query.department : undefined
    );
    res.json({ missions: missions.map((m) => ({ ...m, progress: progressOf(m) })) });
  });

  app.post("/api/v1/missions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { department, title, goal, headName, steps } = (req.body ?? {}) as {
      department?: string;
      title?: string;
      goal?: string;
      headName?: string;
      steps?: { title: string; ownerKind: "human" | "ai"; ownerName: string; ownerId?: string }[];
    };
    if (!department || !title) {
      return res.status(400).json({ error: "department and title are required" });
    }
    const mission = await createServerMission({
      licenseKey: req.lyceumAccount!.licenseKey,
      department,
      title,
      goal,
      headName: headName || "You",
      steps,
    });
    res.json({ mission });
  });

  app.patch("/api/v1/missions/:id/steps/:stepId", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { status, note, addTokens } = (req.body ?? {}) as {
      status?: "todo" | "doing" | "done" | "blocked";
      note?: string;
      addTokens?: number;
    };
    const updated = await updateServerStep({
      licenseKey: req.lyceumAccount!.licenseKey,
      missionId: req.params.id,
      stepId: req.params.stepId,
      status,
      note,
      addTokens,
    });
    if (!updated) return res.status(404).json({ error: "Task or step not found" });
    res.json({ mission: { ...updated, progress: progressOf(updated) } });
  });
}
