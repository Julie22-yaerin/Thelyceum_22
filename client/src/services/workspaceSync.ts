/**
 * Keeps the browser and the server looking at the same work.
 *
 * The point of the roster is that an AI outside this browser — Claude
 * Desktop, Cursor — picks up a step and reports back. That only means
 * anything if the tab reflects it, so tasks and workers live on the server
 * and this module pulls them in.
 *
 * Two modes, chosen by whether a license key is present:
 *   server-backed — the server is the source of truth; local state is a cache
 *   local-only    — no key, so nothing to sync; the store works standalone and
 *                   the app is still usable (an AI just can't join in)
 * The distinction is surfaced in the UI rather than hidden, because "my AI
 * connected but nothing shows up" is the worst possible failure here.
 */

import { useMissionStore, type Mission, type MissionStep, type StepStatus } from "@/store/useMissionStore";
import { useSessionStore } from "@/store/useSessionStore";

export interface ServerWorker {
  id: string;
  name: string;
  role: string;
  departmentId: string;
  departmentName: string;
  model: string;
  tokensUsed: number;
  stepsCompleted: number;
  lastSeenAt: number | null;
  mcpUrl: string;
}

interface ServerStep {
  id: string;
  title: string;
  ownerKind: "human" | "ai";
  ownerId?: string;
  ownerName: string;
  status: StepStatus;
  tokensUsed: number;
  note?: string;
}

interface ServerMission {
  id: string;
  department: string;
  title: string;
  goal: string;
  status: Mission["status"];
  headName: string;
  steps: ServerStep[];
  createdAt: number;
  updatedAt: number;
}

function authHeaders(): Record<string, string> | null {
  const key = useSessionStore.getState().licenseKey;
  return key ? { Authorization: `Bearer ${key}` } : null;
}

export function isServerBacked(): boolean {
  return authHeaders() !== null;
}

/**
 * The server keys a mission by department *name*; the client keys by role id.
 * Missions created here carry the role id as the department so the mapping is
 * lossless in both directions.
 */
function toClientMission(m: ServerMission): Mission {
  return {
    id: m.id,
    roleId: m.department,
    title: m.title,
    goal: m.goal,
    status: m.status,
    headMemberId: "member-owner",
    headName: m.headName,
    dependsOn: [],
    steps: m.steps.map(
      (s): MissionStep => ({
        id: s.id,
        title: s.title,
        owner: {
          kind: s.ownerKind,
          id: s.ownerId ?? s.ownerName,
          name: s.ownerName,
        },
        status: s.status,
        tokensUsed: s.tokensUsed,
        note: s.note,
        updatedAt: m.updatedAt,
      })
    ),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * Pull tasks and roster from the server into the store.
 *
 * Dependencies are a client-side concept the server doesn't model, so they're
 * preserved from whatever the store already knows rather than being wiped on
 * every sync — losing the task graph's shape on a background refresh would be
 * a nasty surprise.
 */
export async function pullFromServer(): Promise<{ ok: boolean; reason?: string }> {
  const headers = authHeaders();
  if (!headers) return { ok: false, reason: "local-only" };

  try {
    const [mRes, wRes] = await Promise.all([
      fetch("/api/v1/missions", { headers }),
      fetch("/api/v1/workers", { headers }),
    ]);
    if (!mRes.ok || !wRes.ok) return { ok: false, reason: `HTTP ${mRes.status}/${wRes.status}` };

    const { missions } = (await mRes.json()) as { missions: ServerMission[] };
    const { workers } = (await wRes.json()) as { workers: ServerWorker[] };

    const store = useMissionStore.getState();
    const existingDeps = new Map(store.missions.map((m) => [m.id, m.dependsOn]));

    useMissionStore.setState({
      missions: missions.map((m) => ({
        ...toClientMission(m),
        dependsOn: existingDeps.get(m.id) ?? [],
      })),
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        roleId: w.departmentId,
        model: w.model,
        source: "mcp" as const,
        tokensUsed: w.tokensUsed,
        lastActiveAt: w.lastSeenAt,
        addedAt: 0,
        mcpUrl: w.mcpUrl,
      })),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network" };
  }
}

/** Create an AI on the roster and get back the URL its client will connect with. */
export async function createWorkerRemote(params: {
  name: string;
  role: string;
  departmentId: string;
  departmentName: string;
  model: string;
}): Promise<{ mcpUrl: string } | { error: string }> {
  const headers = authHeaders();
  if (!headers) {
    return {
      error:
        "Connecting an AI needs your license key — enter it from the homepage first, otherwise there's nothing for the AI to connect to.",
    };
  }
  try {
    const res = await fetch("/api/v1/workers", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) return { error: `Couldn't create the AI (HTTP ${res.status})` };
    const { worker } = await res.json();
    await pullFromServer();
    return { mcpUrl: worker.mcpUrl as string };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export async function deleteWorkerRemote(workerId: string): Promise<void> {
  const headers = authHeaders();
  if (!headers) return;
  await fetch(`/api/v1/workers/${workerId}`, { method: "DELETE", headers }).catch(() => {});
  await pullFromServer();
}

/** Create a task server-side so assigned AI can see it. */
export async function createMissionRemote(params: {
  department: string;
  title: string;
  goal: string;
  headName: string;
  steps: { title: string; ownerKind: "human" | "ai"; ownerName: string; ownerId?: string }[];
}): Promise<string | null> {
  const headers = authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch("/api/v1/missions", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const { mission } = await res.json();
    return mission.id as string;
  } catch {
    return null;
  }
}

/** Push a step change so a connected AI sees the same state the human does. */
export async function updateStepRemote(
  missionId: string,
  stepId: string,
  patch: { status?: StepStatus; note?: string; addTokens?: number }
): Promise<void> {
  const headers = authHeaders();
  if (!headers) return;
  await fetch(`/api/v1/missions/${missionId}/steps/${stepId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}
