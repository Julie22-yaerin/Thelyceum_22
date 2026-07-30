/**
 * Department workspace — where work actually happens.
 *
 * Reached by picking a department on the dashboard, which is deliberate: a
 * task, a document or an AI with no department is a thing nobody owns, so the
 * product refuses to create one.
 *
 * Inside a department:
 *   - the task graph: every task, ordered by what blocks what
 *   - a selected task: its pyramid (who decides, who does each step) and the
 *     documents filed against that task
 *   - the AI allowed in, and nothing else
 */

import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Crown,
  FileText,
  Link2,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import {
  useMissionStore,
  departmentTheme,
  missionProgress,
  MISSION_STATUS_LABEL,
  type Mission,
  type StepOwner,
} from "@/store/useMissionStore";
import { ROLE_ICONS, ROLE_DESCRIPTIONS } from "@/lib/workCollaborationTypes";
import MissionPyramid from "@/components/MissionPyramid";
import DepartmentTaskGraph from "@/components/DepartmentTaskGraph";

// ── Create a department ─────────────────────────────────────────────────────

function CreateDepartment({ onDone }: { onDone: (roleId: string) => void }) {
  const { workRoles, responsibilities, initWorkRoles, setResponsibility, addCustomRole } =
    useWorkforceStore();
  const { members } = useWorkspaceStore();
  const me = members[0];

  const [customName, setCustomName] = useState("");
  if (workRoles.length === 0) initWorkRoles();

  const claimed = new Set(responsibilities.map((r) => r.roleId));
  const available = workRoles.filter((r) => !claimed.has(r.id));

  const claim = (roleId: string, roleName: string) => {
    if (!me) return;
    setResponsibility(me.id, me.name, "", roleId, roleName, true);
    onDone(roleId);
  };

  const createCustom = () => {
    const name = customName.trim();
    if (!name || !me) return;
    const id = `role-custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (!workRoles.some((r) => r.id === id)) {
      addCustomRole({
        id,
        name,
        builtIn: false,
        icon: "briefcase",
        description: "Custom department",
        managesDomain: null,
        managedAgentIds: [],
      });
    }
    claim(id, name);
  };

  return (
    <div>
      <h1 className="text-xl font-semibold text-ws-text mb-1">Open a department</h1>
      <p className="text-sm text-ws-text-muted mb-6">
        Pick the area of work you want to run. You'll be its head, and everything you create
        inside it belongs to you.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        {available.map((role) => (
          <button
            key={role.id}
            onClick={() => claim(role.id, role.name)}
            className="text-left rounded-xl border border-ws-border bg-ws-bg p-3.5 hover:shadow-sm hover:border-teal/40 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{ROLE_ICONS[role.icon] ?? "💼"}</span>
              <span className="text-sm font-medium text-ws-text">{role.name}</span>
            </div>
            <p className="text-[11px] text-ws-text-muted leading-snug line-clamp-2">
              {role.description || ROLE_DESCRIPTIONS[role.icon] || "Custom department"}
            </p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-ws-border bg-ws-bg p-4">
        <p className="text-[12px] font-medium text-ws-text mb-2">Something else?</p>
        <div className="flex gap-2">
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createCustom()}
            placeholder="e.g. Customer Success"
            className="flex-1 h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
          />
          <button
            onClick={createCustom}
            disabled={!customName.trim()}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Connect an AI ───────────────────────────────────────────────────────────

function ConnectAiForm({ roleId, onClose }: { roleId: string; onClose: () => void }) {
  const addWorker = useMissionStore((s) => s.addWorker);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("gpt-4o");

  const submit = () => {
    if (!name.trim()) return;
    addWorker({
      name: name.trim(),
      role: role.trim() || "Assistant",
      roleId,
      model,
      source: "manual",
    });
    onClose();
  };

  return (
    <div className="mt-3 rounded-xl border border-ws-border bg-ws-subtle p-3.5">
      <p className="text-[12px] text-ws-text-muted mb-3">
        Give the AI a name your team will recognise. An AI connected over MCP registers itself and
        shows up here automatically.
      </p>
      <div className="grid gap-2 sm:grid-cols-3 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, e.g. Copywriter"
          autoFocus
          className="h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="What it does"
          className="h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-9 px-2 rounded-lg border border-ws-border bg-ws-bg text-[13px] text-ws-text focus:outline-none focus:border-teal"
        >
          {["gpt-4o", "gpt-4o-mini", "claude-sonnet-5", "claude-haiku", "gemini-2.5-flash"].map(
            (m) => (
              <option key={m} value={m}>
                {m}
              </option>
            )
          )}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="h-8 px-3 rounded-lg text-[13px] font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors"
        >
          Add AI
        </button>
        <button
          onClick={onClose}
          className="h-8 px-3 rounded-lg text-[13px] text-ws-text-soft hover:bg-ws-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Create a task ───────────────────────────────────────────────────────────

function NewTaskForm({
  roleId,
  headMemberId,
  headName,
  aiOptions,
  existingTasks,
  onClose,
}: {
  roleId: string;
  headMemberId: string;
  headName: string;
  aiOptions: { id: string; name: string }[];
  existingTasks: Mission[];
  onClose: () => void;
}) {
  const createMission = useMissionStore((s) => s.createMission);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [steps, setSteps] = useState<{ title: string; ownerId: string }[]>([
    { title: "", ownerId: "me" },
  ]);

  const ownerFor = (ownerId: string): StepOwner =>
    ownerId === "me"
      ? { kind: "human", id: headMemberId, name: headName }
      : { kind: "ai", id: ownerId, name: aiOptions.find((a) => a.id === ownerId)?.name ?? "AI" };

  const submit = () => {
    if (!title.trim()) return;
    createMission({
      roleId,
      title: title.trim(),
      goal: goal.trim(),
      headMemberId,
      headName,
      dependsOn,
      steps: steps
        .filter((s) => s.title.trim())
        .map((s) => ({ title: s.title.trim(), owner: ownerFor(s.ownerId) })),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/25 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-lg bg-ws-bg rounded-2xl border border-ws-border shadow-xl p-6 my-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-ws-text">New task</h3>
          <button onClick={onClose} className="text-ws-text-muted hover:text-ws-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block text-[11px] font-medium text-ws-text-soft mb-1.5">
          What needs to happen?
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Launch the September newsletter"
          autoFocus
          className="w-full h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal mb-4"
        />

        <label className="block text-[11px] font-medium text-ws-text-soft mb-1.5">
          Why it matters <span className="text-ws-text-muted font-normal">(optional)</span>
        </label>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Bring back lapsed subscribers"
          className="w-full h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal mb-4"
        />

        {existingTasks.length > 0 && (
          <>
            <label className="block text-[11px] font-medium text-ws-text-soft mb-1.5">
              Does it have to wait for anything?{" "}
              <span className="text-ws-text-muted font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {existingTasks.map((t) => {
                const on = dependsOn.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() =>
                      setDependsOn((prev) =>
                        prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                      )
                    }
                    className={cn(
                      "px-2 py-1 rounded-md text-[11px] border transition-colors",
                      on
                        ? "bg-teal-50 text-teal-700 border-teal-200"
                        : "border-ws-border text-ws-text-soft hover:border-ws-border"
                    )}
                  >
                    {on && <Check className="w-2.5 h-2.5 inline mr-1" />}
                    {t.title.length > 28 ? `${t.title.slice(0, 28)}…` : t.title}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <label className="block text-[11px] font-medium text-ws-text-soft mb-1.5">
          Steps — who does what
        </label>
        <div className="space-y-2 mb-3">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={s.title}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = { ...next[i], title: e.target.value };
                  setSteps(next);
                }}
                placeholder={`Step ${i + 1}`}
                className="flex-1 h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
              />
              <select
                value={s.ownerId}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = { ...next[i], ownerId: e.target.value };
                  setSteps(next);
                }}
                className="h-9 px-2 rounded-lg border border-ws-border bg-ws-bg text-[12px] text-ws-text focus:outline-none focus:border-teal max-w-[140px]"
              >
                <option value="me">{headName} (me)</option>
                {aiOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (AI)
                  </option>
                ))}
              </select>
              {steps.length > 1 && (
                <button
                  onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                  className="text-ws-text-muted hover:text-red-700 px-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setSteps([...steps, { title: "", ownerId: "me" }])}
          className="text-[12px] text-teal hover:text-teal-dark inline-flex items-center gap-1 mb-6"
        >
          <Plus className="w-3.5 h-3.5" />
          Add another step
        </button>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-lg text-sm text-ws-text-soft hover:bg-ws-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="flex-1 h-9 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors"
          >
            Create task
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Documents filed against one task ────────────────────────────────────────

function TaskDocuments({
  mission,
  authorName,
}: {
  mission: Mission;
  authorName: string;
}) {
  const { docsForMission, addDoc, removeDoc } = useMissionStore();
  const [text, setText] = useState("");
  const docs = docsForMission(mission.id);

  const save = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const isLink = /^https?:\/\//i.test(trimmed);
    addDoc({
      scope: "task",
      roleId: mission.roleId,
      missionId: mission.id,
      name: isLink ? trimmed.replace(/^https?:\/\//, "").slice(0, 60) : trimmed.slice(0, 60),
      kind: isLink ? "link" : "note",
      body: trimmed,
      addedBy: authorName,
    });
    setText("");
  };

  return (
    <div className="mt-6 pt-5 border-t border-ws-border">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ws-text-muted mb-2.5">
        Documents for this task
      </p>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Paste a link or type a note, then press Enter"
        className="w-full h-9 px-3 mb-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
      />

      {docs.length === 0 ? (
        <p className="text-[12px] text-ws-text-muted">
          Nothing filed here yet. Anything you save stays attached to this task, so it's findable
          by the work it belongs to rather than a folder someone has to remember.
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => {
            const Icon = d.kind === "link" ? Link2 : d.kind === "file" ? FileText : StickyNote;
            return (
              <div
                key={d.id}
                className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-ws-border bg-ws-bg"
              >
                <Icon className="w-3.5 h-3.5 text-ws-text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  {d.kind === "link" ? (
                    <a
                      href={d.body}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-teal hover:underline truncate block"
                    >
                      {d.name}
                    </a>
                  ) : (
                    <p className="text-[13px] text-ws-text truncate">{d.name}</p>
                  )}
                  <p className="text-[10px] text-ws-text-muted">
                    {d.addedBy} · {new Date(d.addedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => removeDoc(d.id)}
                  className="opacity-0 group-hover:opacity-100 text-ws-text-muted hover:text-red-700 transition-opacity shrink-0"
                  aria-label={`Remove ${d.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Department workspace ────────────────────────────────────────────────────

function DepartmentWorkspace({ roleId }: { roleId: string }) {
  const { workRoles, responsibilities } = useWorkforceStore();
  const { members } = useWorkspaceStore();
  const {
    missions,
    workers,
    openMissionId,
    setOpenMission,
    setStepStatus,
    removeWorker,
    roleTokens,
  } = useMissionStore();

  const [showNew, setShowNew] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const role = workRoles.find((r) => r.id === roleId);
  const head =
    responsibilities.find((r) => r.roleId === roleId && r.isPrimary) ??
    responsibilities.find((r) => r.roleId === roleId);

  if (!role || !head) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-ws-text-muted mb-3">This department no longer exists.</p>
        <Link href="/app" className="text-sm text-teal hover:text-teal-dark">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const theme = departmentTheme(role.id, role.name);
  const deptMissions = missions.filter((m) => m.roleId === roleId);
  const deptWorkers = workers.filter((w) => w.roleId === roleId);
  const openMission = deptMissions.find((m) => m.id === openMissionId);
  const tokens = roleTokens(roleId);
  const me = members[0];

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-3xl shrink-0">{ROLE_ICONS[role.icon] ?? "💼"}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-ws-text">{role.name}</h1>
              <span
                className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium", theme.bg, theme.ink)}
              >
                {theme.tag}
              </span>
            </div>
            <p className="text-[13px] text-ws-text-muted mt-1">
              <span className="text-ws-text-soft font-medium">{head.memberName}</span> runs this
              {tokens > 0 && <> · {tokens.toLocaleString()} tokens used</>}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New task
        </button>
      </div>

      {/* Team */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ws-text-muted">
            Who's in this department
          </h2>
          <button
            onClick={() => setShowConnect((v) => !v)}
            className="text-[12px] text-teal hover:text-teal-dark"
          >
            {showConnect ? "Close" : "Connect an AI"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ws-border bg-ws-bg text-[12px]">
            <Crown className="w-3 h-3 text-amber-600" />
            <span className="font-medium text-ws-text">{head.memberName}</span>
            <span className="text-ws-text-muted">head</span>
          </span>

          {deptWorkers.length === 0 ? (
            <span className="text-[12px] text-ws-text-muted py-1.5">
              No AI connected yet — tasks can still be run by people.
            </span>
          ) : (
            deptWorkers.map((w) => (
              <span
                key={w.id}
                className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-[12px]"
              >
                <Bot className="w-3 h-3 text-purple-700" />
                <span className="font-medium text-purple-700">{w.name}</span>
                <span className="text-purple-700/70">{w.role}</span>
                {w.tokensUsed > 0 && (
                  <span className="text-purple-700/60 tabular-nums">
                    {w.tokensUsed.toLocaleString()}
                  </span>
                )}
                <button
                  onClick={() => removeWorker(w.id)}
                  className="opacity-0 group-hover:opacity-100 text-purple-700/60 hover:text-red-700 transition-opacity"
                  aria-label={`Remove ${w.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))
          )}
        </div>

        {showConnect && <ConnectAiForm roleId={roleId} onClose={() => setShowConnect(false)} />}
      </section>

      {/* Task graph */}
      <section className="mb-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ws-text-muted mb-2.5">
          Task graph
        </h2>
        <DepartmentTaskGraph
          missions={deptMissions}
          openTaskId={openMissionId}
          onOpenTask={(id) => setOpenMission(id === openMissionId ? null : id)}
        />
      </section>

      {/* Selected task */}
      {openMission && (
        <section className="rounded-xl border border-ws-border bg-ws-bg p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ws-text">{openMission.title}</h2>
              {openMission.goal && (
                <p className="text-[12px] text-ws-text-muted mt-0.5">{openMission.goal}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-ws-text-muted tabular-nums">
                {missionProgress(openMission)}%
              </span>
              <button
                onClick={() => setOpenMission(null)}
                className="text-ws-text-muted hover:text-ws-text"
                aria-label="Close task"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          <MissionPyramid
            mission={openMission}
            onStepStatus={(stepId, status) => setStepStatus(openMission.id, stepId, status)}
          />

          <TaskDocuments mission={openMission} authorName={me?.name ?? "You"} />
        </section>
      )}

      {!openMission && deptMissions.length > 0 && (
        <p className="text-[12px] text-ws-text-muted text-center py-4">
          Pick a task above to see its steps and documents.
        </p>
      )}

      {showNew && (
        <NewTaskForm
          roleId={roleId}
          headMemberId={head.memberId}
          headName={head.memberName}
          aiOptions={deptWorkers.map((w) => ({ id: w.id, name: w.name }))}
          existingTasks={deptMissions}
          onClose={() => setShowNew(false)}
        />
      )}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Missions() {
  const [, navigate] = useLocation();
  const { openRoleId, setOpenRole } = useMissionStore();
  const { workRoles, responsibilities } = useWorkforceStore();

  const myDepartments = useMemo(
    () =>
      workRoles.filter((r) => responsibilities.some((resp) => resp.roleId === r.id)),
    [workRoles, responsibilities]
  );

  return (
    <div className="min-h-screen bg-ws-subtle">
      <header className="border-b border-ws-border bg-ws-bg sticky top-0 z-10">
        <div className="container max-w-5xl h-14 flex items-center justify-between gap-4">
          <button
            onClick={() => {
              setOpenRole(null);
              navigate("/app");
            }}
            className="inline-flex items-center gap-1.5 text-sm text-ws-text-soft hover:text-ws-text transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </button>

          {/* Switching departments without going back to the dashboard */}
          {myDepartments.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto">
              {myDepartments.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOpenRole(r.id)}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                    r.id === openRoleId
                      ? "bg-ws-hover text-ws-text"
                      : "text-ws-text-muted hover:text-ws-text"
                  )}
                >
                  {ROLE_ICONS[r.icon] ?? "💼"} {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="container max-w-5xl py-8">
        {openRoleId ? (
          <DepartmentWorkspace roleId={openRoleId} />
        ) : (
          <CreateDepartment onDone={(roleId) => setOpenRole(roleId)} />
        )}
      </main>
    </div>
  );
}
