/**
 * Mission Store — The Lyceum
 *
 * One workspace per department ("mission workspace"): Marketing, Coding,
 * Sales, … Each one is scoped:
 *   - a #tag and a pastel colour, so it's recognisable at a glance
 *   - a human head (the person whose role claim was approved — see
 *     useWorkforceStore.responsibilities)
 *   - only the AI agents serving that department can be in it
 *   - its own documents and its own progress report
 *
 * Deliberately plain-language: a "mission" is a piece of work with steps,
 * each step owned by either a person or an AI. Progress is just
 * done-steps / total-steps, so a non-technical CEO can read it without
 * being taught anything.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Domain } from "@/lib/modelConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = "todo" | "doing" | "done" | "blocked";
export type MissionStatus = "planning" | "active" | "review" | "done" | "blocked";

export interface StepOwner {
  kind: "human" | "ai";
  id: string;
  name: string;
}

export interface MissionStep {
  id: string;
  title: string;
  owner: StepOwner;
  status: StepStatus;
  /** Tokens the AI owner has consumed on this step (0 for humans). */
  tokensUsed: number;
  /** Plain-language note shown under the step — what actually happened. */
  note?: string;
  updatedAt: number;
}

export interface Mission {
  id: string;
  /** Which department workspace this belongs to (a WorkRole id). */
  roleId: string;
  title: string;
  goal: string;
  status: MissionStatus;
  /** The person accountable for the decision — top of the pyramid. */
  headMemberId: string;
  headName: string;
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
}

export interface MissionDoc {
  id: string;
  roleId: string;
  name: string;
  kind: "note" | "link" | "file";
  /** Note body, or the URL for a link. */
  body: string;
  addedBy: string;
  addedAt: number;
}

/** A pastel identity per department, so each workspace is visually distinct. */
export interface DepartmentTheme {
  tag: string;
  bg: string;
  ink: string;
  border: string;
}

const PASTELS: Omit<DepartmentTheme, "tag">[] = [
  { bg: "bg-blue-50", ink: "text-blue-700", border: "border-blue-200" },
  { bg: "bg-green-50", ink: "text-green-700", border: "border-green-200" },
  { bg: "bg-amber-50", ink: "text-amber-700", border: "border-amber-200" },
  { bg: "bg-purple-50", ink: "text-purple-700", border: "border-purple-200" },
  { bg: "bg-pink-50", ink: "text-pink-700", border: "border-pink-200" },
  { bg: "bg-teal-50", ink: "text-teal-700", border: "border-teal-200" },
  { bg: "bg-orange-50", ink: "text-orange-700", border: "border-orange-200" },
  { bg: "bg-indigo-50", ink: "text-indigo-700", border: "border-indigo-200" },
];

/** Stable pastel per role id — same department always gets the same colour. */
export function departmentTheme(roleId: string, roleName: string): DepartmentTheme {
  let hash = 0;
  for (let i = 0; i < roleId.length; i++) hash = (hash * 31 + roleId.charCodeAt(i)) | 0;
  const pastel = PASTELS[Math.abs(hash) % PASTELS.length];
  return { ...pastel, tag: `#${roleName.toLowerCase().replace(/\s+/g, "-")}` };
}

/** done-steps / total-steps, 0–100. Blocked steps count as not done. */
export function missionProgress(mission: Mission): number {
  if (mission.steps.length === 0) return 0;
  const done = mission.steps.filter((s) => s.status === "done").length;
  return Math.round((done / mission.steps.length) * 100);
}

/** Plain-language status label — no jargon. */
export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  planning: "Being planned",
  active: "In progress",
  review: "Waiting on your review",
  done: "Finished",
  blocked: "Stuck — needs help",
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  todo: "Not started",
  doing: "Working on it",
  done: "Done",
  blocked: "Stuck",
};

// ── Store ────────────────────────────────────────────────────────────────────

interface MissionStore {
  missions: Mission[];
  docs: MissionDoc[];
  /** Which department workspace is open, or null for the overview grid. */
  openRoleId: string | null;
  /** Which mission's pyramid is expanded, or null. */
  openMissionId: string | null;

  setOpenRole: (roleId: string | null) => void;
  setOpenMission: (missionId: string | null) => void;

  createMission: (params: {
    roleId: string;
    title: string;
    goal: string;
    headMemberId: string;
    headName: string;
    steps?: { title: string; owner: StepOwner }[];
  }) => string;
  setMissionStatus: (missionId: string, status: MissionStatus) => void;
  setStepStatus: (missionId: string, stepId: string, status: StepStatus, note?: string) => void;
  addStep: (missionId: string, title: string, owner: StepOwner) => void;
  addTokens: (missionId: string, stepId: string, tokens: number) => void;

  addDoc: (doc: Omit<MissionDoc, "id" | "addedAt">) => void;
  removeDoc: (docId: string) => void;

  missionsForRole: (roleId: string) => Mission[];
  docsForRole: (roleId: string) => MissionDoc[];
  /** Average progress across a department's missions, 0–100. */
  roleProgress: (roleId: string) => number;
  /** Total tokens burned by AI steps in a department. */
  roleTokens: (roleId: string) => number;
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const useMissionStore = create<MissionStore>()(
  persist(
    (set, get) => ({
  missions: [],
  docs: [],
  openRoleId: null,
  openMissionId: null,

  setOpenRole: (roleId) => set({ openRoleId: roleId, openMissionId: null }),
  setOpenMission: (missionId) => set({ openMissionId: missionId }),

  createMission: ({ roleId, title, goal, headMemberId, headName, steps = [] }) => {
    const id = uid("mission");
    const now = Date.now();
    const mission: Mission = {
      id,
      roleId,
      title,
      goal,
      status: steps.length > 0 ? "active" : "planning",
      headMemberId,
      headName,
      steps: steps.map((s) => ({
        id: uid("step"),
        title: s.title,
        owner: s.owner,
        status: "todo" as StepStatus,
        tokensUsed: 0,
        updatedAt: now,
      })),
      createdAt: now,
      updatedAt: now,
    };
    set({ missions: [mission, ...get().missions] });
    return id;
  },

  setMissionStatus: (missionId, status) =>
    set({
      missions: get().missions.map((m) =>
        m.id === missionId ? { ...m, status, updatedAt: Date.now() } : m
      ),
    }),

  setStepStatus: (missionId, stepId, status, note) =>
    set({
      missions: get().missions.map((m) => {
        if (m.id !== missionId) return m;
        const steps = m.steps.map((s) =>
          s.id === stepId ? { ...s, status, note: note ?? s.note, updatedAt: Date.now() } : s
        );
        // Keep the mission's own status honest with its steps, so the CEO
        // never sees "In progress" on something that's actually finished.
        const allDone = steps.every((s) => s.status === "done");
        const anyBlocked = steps.some((s) => s.status === "blocked");
        const nextStatus: MissionStatus = allDone
          ? "review"
          : anyBlocked
            ? "blocked"
            : m.status === "planning"
              ? "active"
              : m.status;
        return { ...m, steps, status: nextStatus, updatedAt: Date.now() };
      }),
    }),

  addStep: (missionId, title, owner) =>
    set({
      missions: get().missions.map((m) =>
        m.id === missionId
          ? {
              ...m,
              steps: [
                ...m.steps,
                { id: uid("step"), title, owner, status: "todo" as StepStatus, tokensUsed: 0, updatedAt: Date.now() },
              ],
              updatedAt: Date.now(),
            }
          : m
      ),
    }),

  addTokens: (missionId, stepId, tokens) =>
    set({
      missions: get().missions.map((m) =>
        m.id === missionId
          ? {
              ...m,
              steps: m.steps.map((s) =>
                s.id === stepId ? { ...s, tokensUsed: s.tokensUsed + tokens } : s
              ),
            }
          : m
      ),
    }),

  addDoc: (doc) => set({ docs: [{ ...doc, id: uid("doc"), addedAt: Date.now() }, ...get().docs] }),
  removeDoc: (docId) => set({ docs: get().docs.filter((d) => d.id !== docId) }),

  missionsForRole: (roleId) => get().missions.filter((m) => m.roleId === roleId),
  docsForRole: (roleId) => get().docs.filter((d) => d.roleId === roleId),

  roleProgress: (roleId) => {
    const list = get().missions.filter((m) => m.roleId === roleId);
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, m) => sum + missionProgress(m), 0) / list.length);
  },

  roleTokens: (roleId) =>
    get()
      .missions.filter((m) => m.roleId === roleId)
      .reduce((sum, m) => sum + m.steps.reduce((s2, s) => s2 + s.tokensUsed, 0), 0),
    }),
    {
      name: "lyceum-missions",
      // Only the data — which department/mission happens to be open is
      // ephemeral UI state and shouldn't survive a reload.
      partialize: (s) => ({ missions: s.missions, docs: s.docs }),
    }
  )
);

/** Domain → which department roles that AI domain is allowed to serve. */
export function agentServesRole(agentDomain: Domain | undefined, roleManagesDomain: Domain | null): boolean {
  if (!roleManagesDomain) return false;
  return agentDomain === roleManagesDomain;
}
