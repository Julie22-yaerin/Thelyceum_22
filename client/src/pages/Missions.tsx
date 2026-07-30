/**
 * Missions — The Lyceum
 *
 * The non-technical entry point to the product. Two views:
 *
 *   1. Department grid — every department that has a head, with its #tag,
 *      who runs it, how far along its work is, and how many AI are in it.
 *   2. One department's workspace — the AI allowed in (and only those), its
 *      missions with a plain-language progress pyramid, and its own docs.
 *
 * Everything is written in words rather than encoded in colour or icons, so
 * someone who has never seen the product can read it top to bottom.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Bot,
  Plus,
  Users,
  FileText,
  Link2,
  StickyNote,
  Trash2,
  Crown,
  ChevronRight,
  X,
  Coins,
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
  type MissionStatus,
  type StepOwner,
} from "@/store/useMissionStore";
import { ROLE_ICONS } from "@/lib/workCollaborationTypes";
import MissionPyramid from "@/components/MissionPyramid";

const STATUS_STYLE: Record<MissionStatus, string> = {
  planning: "bg-ws-hover text-ws-text-soft border-ws-border",
  active: "bg-blue-50 text-blue-700 border-blue-200",
  review: "bg-amber-50 text-amber-700 border-amber-200",
  done: "bg-green-50 text-green-700 border-green-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
};

// ── Department grid ──────────────────────────────────────────────────────────

function DepartmentGrid({ onOpen }: { onOpen: (roleId: string) => void }) {
  const { workRoles, responsibilities, nodes, initWorkRoles } = useWorkforceStore();
  const { missions, roleProgress, roleTokens } = useMissionStore();

  if (workRoles.length === 0) initWorkRoles();

  // Only departments someone actually heads — an unclaimed department has no
  // workspace to enter yet.
  const departments = useMemo(
    () =>
      workRoles
        .map((role) => {
          const head = responsibilities.find((r) => r.roleId === role.id && r.isPrimary)
            ?? responsibilities.find((r) => r.roleId === role.id);
          return { role, head };
        })
        .filter((d) => !!d.head),
    [workRoles, responsibilities]
  );

  const agentCount = (roleId: string, managesDomain: string | null) => {
    const role = workRoles.find((r) => r.id === roleId);
    const explicit = role?.managedAgentIds.length ?? 0;
    const byDomain = managesDomain
      ? nodes.filter((n) => n.data.config.domain === managesDomain).length
      : 0;
    return explicit + byDomain;
  };

  if (departments.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-12 h-12 rounded-xl bg-ws-hover flex items-center justify-center mx-auto mb-4">
          <Crown className="w-6 h-6 text-ws-text-muted" />
        </div>
        <h2 className="text-base font-semibold text-ws-text mb-1.5">No departments yet</h2>
        <p className="text-sm text-ws-text-muted max-w-sm mx-auto leading-relaxed">
          A department gets its own workspace once someone is approved as its head. Open the
          workspace and claim a responsibility to create the first one.
        </p>
        <Link
          href="/canvas"
          className="inline-flex items-center gap-1.5 mt-5 h-9 px-4 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark transition-colors"
        >
          Go to the workspace
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {departments.map(({ role, head }) => {
        const theme = departmentTheme(role.id, role.name);
        const progress = roleProgress(role.id);
        const count = missions.filter((m) => m.roleId === role.id).length;
        const tokens = roleTokens(role.id);
        const ai = agentCount(role.id, role.managesDomain);

        return (
          <button
            key={role.id}
            onClick={() => onOpen(role.id)}
            className="text-left rounded-xl border border-ws-border bg-ws-bg p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl shrink-0">{ROLE_ICONS[role.icon] || "💼"}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ws-text truncate">{role.name}</p>
                  <span
                    className={cn(
                      "inline-block px-1.5 py-0.5 rounded-md text-[10px] font-medium mt-0.5",
                      theme.bg,
                      theme.ink
                    )}
                  >
                    {theme.tag}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[12px] text-ws-text-soft mb-3">
              <div className="w-5 h-5 rounded-full bg-ws-hover flex items-center justify-center text-[9px] font-semibold shrink-0">
                {head!.memberName.charAt(0).toUpperCase()}
              </div>
              <span className="truncate">{head!.memberName}</span>
              <span className="text-ws-text-muted">runs this</span>
            </div>

            {/* Progress — the headline number */}
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-ws-text-muted">
                {count === 0 ? "No missions yet" : `${count} mission${count !== 1 ? "s" : ""}`}
              </span>
              {count > 0 && <span className="font-medium text-ws-text tabular-nums">{progress}%</span>}
            </div>
            <div className="h-1.5 rounded-full bg-ws-hover overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-ws-border text-[11px] text-ws-text-muted">
              <span className="inline-flex items-center gap-1">
                <Bot className="w-3 h-3" />
                {ai} AI
              </span>
              {tokens > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  {tokens.toLocaleString()} tokens
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── New mission form ─────────────────────────────────────────────────────────

function NewMissionForm({
  roleId,
  headMemberId,
  headName,
  aiNames,
  onClose,
}: {
  roleId: string;
  headMemberId: string;
  headName: string;
  aiNames: { id: string; name: string }[];
  onClose: () => void;
}) {
  const createMission = useMissionStore((s) => s.createMission);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<{ title: string; ownerId: string }[]>([
    { title: "", ownerId: "me" },
  ]);

  const ownerFor = (ownerId: string): StepOwner =>
    ownerId === "me"
      ? { kind: "human", id: headMemberId, name: headName }
      : {
          kind: "ai",
          id: ownerId,
          name: aiNames.find((a) => a.id === ownerId)?.name ?? "AI",
        };

  const submit = () => {
    if (!title.trim()) return;
    createMission({
      roleId,
      title: title.trim(),
      goal: goal.trim(),
      headMemberId,
      headName,
      steps: steps
        .filter((s) => s.title.trim())
        .map((s) => ({ title: s.title.trim(), owner: ownerFor(s.ownerId) })),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/25 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg bg-ws-bg rounded-2xl border border-ws-border shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-ws-text">New mission</h3>
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
          className="w-full h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal mb-5"
        />

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
                className="h-9 px-2 rounded-lg border border-ws-border bg-ws-bg text-[12px] text-ws-text focus:outline-none focus:border-teal"
              >
                <option value="me">{headName} (me)</option>
                {aiNames.map((a) => (
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
            className="flex-1 h-9 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create mission
          </button>
        </div>
      </div>
    </div>
  );
}

// ── One department's workspace ───────────────────────────────────────────────

function DepartmentWorkspace({ roleId, onBack }: { roleId: string; onBack: () => void }) {
  const { workRoles, responsibilities, nodes, toggleRoleAgent } = useWorkforceStore();
  const {
    missions,
    docs,
    openMissionId,
    setOpenMission,
    setStepStatus,
    addDoc,
    removeDoc,
    roleTokens,
  } = useMissionStore();

  const [showNew, setShowNew] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [noteText, setNoteText] = useState("");

  const role = workRoles.find((r) => r.id === roleId);
  const head =
    responsibilities.find((r) => r.roleId === roleId && r.isPrimary) ??
    responsibilities.find((r) => r.roleId === roleId);

  if (!role || !head) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-ws-text-muted">This department no longer exists.</p>
        <button onClick={onBack} className="text-sm text-teal hover:text-teal-dark mt-3">
          Back to departments
        </button>
      </div>
    );
  }

  const theme = departmentTheme(role.id, role.name);

  // Only AI serving this department may be in this workspace: either
  // explicitly granted access, or matching the department's AI domain.
  const allowedAgents = nodes.filter(
    (n) =>
      role.managedAgentIds.includes(n.id) ||
      (!!role.managesDomain && n.data.config.domain === role.managesDomain)
  );
  const outsideAgents = nodes.filter((n) => !allowedAgents.some((a) => a.id === n.id));

  const deptMissions = missions.filter((m) => m.roleId === roleId);
  const deptDocs = docs.filter((d) => d.roleId === roleId);
  const tokens = roleTokens(roleId);
  const openMission: Mission | undefined = deptMissions.find((m) => m.id === openMissionId);

  const aiNames = allowedAgents.map((a) => ({ id: a.id, name: a.data.label }));

  return (
    <>
      {/* ── Department header ── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-3xl shrink-0">{ROLE_ICONS[role.icon] || "💼"}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-ws-text">{role.name}</h1>
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-md text-[11px] font-medium",
                  theme.bg,
                  theme.ink
                )}
              >
                {theme.tag}
              </span>
            </div>
            <p className="text-[13px] text-ws-text-muted mt-1">
              <span className="text-ws-text-soft font-medium">{head.memberName}</span> runs this
              workspace
              {tokens > 0 && <> · {tokens.toLocaleString()} tokens used by AI so far</>}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New mission
        </button>
      </div>

      {/* ── Who's in here ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ws-text-muted">
            Who's in this workspace
          </h2>
          <button
            onClick={() => setShowAgentPicker((v) => !v)}
            className="text-[12px] text-teal hover:text-teal-dark"
          >
            {showAgentPicker ? "Done" : "Manage AI access"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* The head */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ws-border bg-ws-bg text-[12px]">
            <Crown className="w-3 h-3 text-amber-600" />
            <span className="font-medium text-ws-text">{head.memberName}</span>
            <span className="text-ws-text-muted">head</span>
          </span>

          {allowedAgents.length === 0 ? (
            <span className="text-[12px] text-ws-text-muted py-1.5">
              No AI has access yet — use "Manage AI access" to let one in.
            </span>
          ) : (
            allowedAgents.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-[12px]"
              >
                <Bot className="w-3 h-3 text-purple-700" />
                <span className="font-medium text-purple-700">{a.data.label}</span>
                <span className="text-purple-700/70">{a.data.role}</span>
              </span>
            ))
          )}
        </div>

        {showAgentPicker && (
          <div className="mt-3 rounded-xl border border-ws-border bg-ws-subtle p-3">
            <p className="text-[11px] text-ws-text-muted mb-2.5">
              Tick an AI to let it work in {role.name}. Untick to remove its access.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {[...allowedAgents, ...outsideAgents].map((a) => {
                const isIn = allowedAgents.some((x) => x.id === a.id);
                const byDomain =
                  !!role.managesDomain && a.data.config.domain === role.managesDomain;
                return (
                  <label
                    key={a.id}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-2 rounded-lg border bg-ws-bg cursor-pointer text-[12px]",
                      isIn ? "border-purple-200" : "border-ws-border"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isIn}
                      disabled={byDomain}
                      onChange={() => toggleRoleAgent(role.id, a.id)}
                      className="w-3.5 h-3.5 accent-teal"
                    />
                    <span className="font-medium text-ws-text truncate">{a.data.label}</span>
                    <span className="text-ws-text-muted truncate">{a.data.role}</span>
                    {byDomain && (
                      <span className="ml-auto text-[10px] text-ws-text-muted shrink-0">
                        always in
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Missions + progress ── */}
      <section className="mb-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ws-text-muted mb-2.5">
          Missions
        </h2>

        {deptMissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ws-border p-8 text-center">
            <p className="text-sm text-ws-text mb-1">Nothing in flight yet</p>
            <p className="text-[12px] text-ws-text-muted mb-4">
              A mission is one piece of work broken into steps, each owned by a person or an AI.
            </p>
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium border border-ws-border text-ws-text hover:bg-ws-hover transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create the first mission
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {deptMissions.map((m) => {
              const progress = missionProgress(m);
              const isOpen = m.id === openMissionId;
              return (
                <div key={m.id} className="rounded-xl border border-ws-border bg-ws-bg">
                  <button
                    onClick={() => setOpenMission(isOpen ? null : m.id)}
                    className="w-full text-left p-4 hover:bg-ws-subtle/60 transition-colors rounded-xl"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ws-text">{m.title}</p>
                        {m.goal && (
                          <p className="text-[12px] text-ws-text-muted mt-0.5">{m.goal}</p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium border",
                          STATUS_STYLE[m.status]
                        )}
                      >
                        {MISSION_STATUS_LABEL[m.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-ws-hover overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-ws-text-muted tabular-nums shrink-0">
                        {progress}%
                      </span>
                      <ChevronRight
                        className={cn(
                          "w-3.5 h-3.5 text-ws-text-muted shrink-0 transition-transform",
                          isOpen && "rotate-90"
                        )}
                      />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-5 pt-2 border-t border-ws-border">
                      <MissionPyramid
                        mission={m}
                        onStepStatus={(stepId, status) => setStepStatus(m.id, stepId, status)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Department documents ── */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ws-text-muted mb-2.5">
          Documents in {role.name}
        </h2>

        <div className="flex gap-2 mb-3">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && noteText.trim()) {
                const isLink = /^https?:\/\//i.test(noteText.trim());
                addDoc({
                  roleId,
                  name: isLink ? noteText.trim().replace(/^https?:\/\//, "").slice(0, 60) : noteText.trim().slice(0, 60),
                  kind: isLink ? "link" : "note",
                  body: noteText.trim(),
                  addedBy: head.memberName,
                });
                setNoteText("");
              }
            }}
            placeholder="Paste a link or type a note, then press Enter"
            className="flex-1 h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
          />
        </div>

        {deptDocs.length === 0 ? (
          <p className="text-[12px] text-ws-text-muted">
            Nothing saved here yet. Anything you add stays inside {role.name}.
          </p>
        ) : (
          <div className="space-y-1.5">
            {deptDocs.map((d) => {
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
                      added by {d.addedBy} · {new Date(d.addedAt).toLocaleDateString()}
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
      </section>

      {showNew && (
        <NewMissionForm
          roleId={roleId}
          headMemberId={head.memberId}
          headName={head.memberName}
          aiNames={aiNames}
          onClose={() => setShowNew(false)}
        />
      )}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Missions() {
  const { openRoleId, setOpenRole } = useMissionStore();
  const { getCurrentCompany } = useWorkspaceStore();
  const company = getCurrentCompany();

  return (
    <div className="min-h-screen bg-ws-subtle">
      {/* Top bar */}
      <header className="border-b border-ws-border bg-ws-bg">
        <div className="container max-w-5xl h-14 flex items-center justify-between">
          {openRoleId ? (
            <button
              onClick={() => setOpenRole(null)}
              className="inline-flex items-center gap-1.5 text-sm text-ws-text-soft hover:text-ws-text transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All departments
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-ws-text-muted" />
              <span className="text-sm font-semibold text-ws-text">
                {company?.name ?? "Your company"}
              </span>
            </div>
          )}
          <Link
            href="/canvas"
            className="text-sm text-ws-text-soft hover:text-ws-text transition-colors"
          >
            Open full workspace
          </Link>
        </div>
      </header>

      <main className="container max-w-5xl py-8">
        {openRoleId ? (
          <DepartmentWorkspace roleId={openRoleId} onBack={() => setOpenRole(null)} />
        ) : (
          <>
            <h1 className="text-xl font-semibold text-ws-text mb-1">Departments</h1>
            <p className="text-sm text-ws-text-muted mb-6">
              Each department has its own workspace, its own AI team, and its own progress. Click one
              to go in.
            </p>
            <DepartmentGrid onOpen={setOpenRole} />
          </>
        )}
      </main>
    </div>
  );
}
