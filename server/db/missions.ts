import { getDb } from "./firestore.js";

/**
 * Missions as seen by the server, so a connected AI can read and update the
 * same progress the team sees in the workspace. Mirrors the shape of
 * client/src/store/useMissionStore.ts.
 */

export type StepStatus = "todo" | "doing" | "done" | "blocked";
export type MissionStatus = "planning" | "active" | "review" | "done" | "blocked";

export interface MissionStepData {
  id: string;
  title: string;
  ownerKind: "human" | "ai";
  ownerName: string;
  status: StepStatus;
  tokensUsed: number;
  note?: string;
}

export interface MissionData {
  id: string;
  licenseKey: string;
  /** Department tag, e.g. "marketing". */
  department: string;
  title: string;
  goal: string;
  status: MissionStatus;
  headName: string;
  steps: MissionStepData[];
  createdAt: number;
  updatedAt: number;
}

const collection = () => getDb().collection("missions");

export function progressOf(mission: MissionData): number {
  if (mission.steps.length === 0) return 0;
  const done = mission.steps.filter((s) => s.status === "done").length;
  return Math.round((done / mission.steps.length) * 100);
}

export async function createMission(params: {
  licenseKey: string;
  department: string;
  title: string;
  goal?: string;
  headName: string;
  steps?: { title: string; ownerKind: "human" | "ai"; ownerName: string }[];
}): Promise<MissionData> {
  const ref = collection().doc();
  const now = Date.now();
  const mission: MissionData = {
    id: ref.id,
    licenseKey: params.licenseKey,
    department: params.department,
    title: params.title,
    goal: params.goal ?? "",
    status: (params.steps?.length ?? 0) > 0 ? "active" : "planning",
    headName: params.headName,
    steps: (params.steps ?? []).map((s, i) => ({
      id: `step-${i + 1}`,
      title: s.title,
      ownerKind: s.ownerKind,
      ownerName: s.ownerName,
      status: "todo" as StepStatus,
      tokensUsed: 0,
    })),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(mission);
  return mission;
}

export async function listMissions(
  licenseKey: string,
  department?: string
): Promise<MissionData[]> {
  // Filtered by department in memory rather than a second `where`, which
  // would need a composite Firestore index for no real benefit at this size.
  const snap = await collection().where("licenseKey", "==", licenseKey).get();
  return snap.docs
    .map((d) => d.data() as MissionData)
    .filter((m) => !department || m.department === department)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMission(
  licenseKey: string,
  missionId: string
): Promise<MissionData | null> {
  const snap = await collection().doc(missionId).get();
  if (!snap.exists) return null;
  const mission = snap.data() as MissionData;
  return mission.licenseKey === licenseKey ? mission : null;
}

/** Recompute mission status from its steps so it can't drift out of sync. */
function derivedStatus(steps: MissionStepData[], current: MissionStatus): MissionStatus {
  if (steps.length === 0) return current;
  if (steps.every((s) => s.status === "done")) return "review";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  return current === "planning" ? "active" : current;
}

export async function updateStep(params: {
  licenseKey: string;
  missionId: string;
  stepId: string;
  status?: StepStatus;
  note?: string;
  addTokens?: number;
}): Promise<MissionData | null> {
  const db = getDb();
  const ref = collection().doc(params.missionId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const mission = snap.data() as MissionData;
    if (mission.licenseKey !== params.licenseKey) return null;

    const steps = mission.steps.map((s) =>
      s.id === params.stepId
        ? {
            ...s,
            status: params.status ?? s.status,
            note: params.note ?? s.note,
            tokensUsed: s.tokensUsed + (params.addTokens ?? 0),
          }
        : s
    );

    const updated: MissionData = {
      ...mission,
      steps,
      status: derivedStatus(steps, mission.status),
      updatedAt: Date.now(),
    };
    tx.set(ref, updated);
    return updated;
  });
}
