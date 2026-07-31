/**
 * Dashboard — where a signed-in customer lands.
 *
 * Three things, nothing else:
 *   1. How the work is going (performance over the last two weeks)
 *   2. Who is working right now — people and AI, from real in-flight steps
 *   3. Company-wide documents, i.e. material that belongs to no department
 *
 * Work itself does not happen here. To do anything you pick a department,
 * which is the one deliberate funnel in the product: it forces every task,
 * every document and every AI to belong somewhere accountable.
 *
 * There is no onboarding wizard. Identity comes from the checkout record via
 * /api/v1/account, and anything still unknown is editable inline.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  FileText,
  Link2,
  Pencil,
  Plus,
  ShieldCheck,
  StickyNote,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ThemeToggle";
import { useSessionStore } from "@/store/useSessionStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import { useMissionStore, departmentTheme, missionProgress } from "@/store/useMissionStore";
import { ROLE_ICONS } from "@/lib/workCollaborationTypes";
import SystemGraph from "@/components/SystemGraph";
import { pullFromServer, isServerBacked } from "@/services/workspaceSync";

// ── Performance chart ───────────────────────────────────────────────────────

function PerformanceChart({ series }: { series: { day: string; done: number }[] }) {
  const max = Math.max(1, ...series.map((d) => d.done));
  const total = series.reduce((s, d) => s + d.done, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ws-text-muted mb-1">
            Steps completed
          </p>
          <p className="text-2xl font-semibold text-ws-text tabular-nums">{total}</p>
          <p className="text-[12px] text-ws-text-muted">in the last {series.length} days</p>
        </div>
      </div>

      {total === 0 ? (
        <div className="h-24 rounded-lg border border-dashed border-ws-border flex items-center justify-center">
          <p className="text-[12px] text-ws-text-muted">
            Nothing finished yet — this fills in as work gets done.
          </p>
        </div>
      ) : (
        <div className="flex items-end gap-1 h-24" role="img" aria-label="Steps completed per day">
          {series.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="w-full flex items-end justify-center h-20">
                <div
                  className="w-full rounded-t bg-teal/70 group-hover:bg-teal transition-colors min-h-[2px]"
                  style={{ height: `${(d.done / max) * 100}%` }}
                  title={`${d.day}: ${d.done}`}
                />
              </div>
              <span className="text-[8px] text-ws-text-muted whitespace-nowrap">
                {d.day.split(" ")[1]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Company documents ───────────────────────────────────────────────────────

function CompanyDocuments({ authorName }: { authorName: string }) {
  const { companyDocs, addDoc, removeDoc } = useMissionStore();
  const [text, setText] = useState("");
  const docs = companyDocs();

  const save = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const isLink = /^https?:\/\//i.test(trimmed);
    addDoc({
      scope: "company",
      name: isLink ? trimmed.replace(/^https?:\/\//, "").slice(0, 60) : trimmed.slice(0, 60),
      kind: isLink ? "link" : "note",
      body: trimmed,
      addedBy: authorName,
    });
    setText("");
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-ws-text">Company documents</h2>
        <span className="text-[11px] text-ws-text-muted">Shared across every department</span>
      </div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Paste a link or type a note, then press Enter"
        className="w-full h-9 px-3 mb-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
      />

      {docs.length === 0 ? (
        <p className="text-[12px] text-ws-text-muted">
          Nothing here yet. This is for things that belong to the whole company — a handbook,
          brand guidelines, policies. Anything tied to actual work belongs on its task instead.
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

// ── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, navigate] = useLocation();
  const licenseKey = useSessionStore((s) => s.licenseKey);

  const { companies, members, createCompany, getCurrentCompany } = useWorkspaceStore();
  const { workRoles, responsibilities, initWorkRoles } = useWorkforceStore();
  const { missions, workers, completionSeries, totals, activeWorkers, roleProgress, setOpenRole } =
    useMissionStore();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  // No wizard: the company is created from the checkout record the first time
  // someone opens the app. If the account lookup isn't available (local dev,
  // Firestore unset) it falls back to neutral names the user can edit inline —
  // which is still better than blocking them behind a form.
  useEffect(() => {
    if (companies.length > 0) return;
    let cancelled = false;

    (async () => {
      let org = "My company";
      let person = "You";
      if (licenseKey) {
        try {
          const res = await fetch("/api/v1/account", {
            headers: { Authorization: `Bearer ${licenseKey}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.organization) org = data.organization;
            if (data.name) person = data.name;
          }
        } catch {
          // Offline or unconfigured — the fallbacks above are fine.
        }
      }
      if (!cancelled) {
        createCompany(org, person);
        useWorkspaceStore.getState().setShowCompanySetup(false);
        if (useWorkforceStore.getState().workRoles.length === 0) initWorkRoles();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companies.length, licenseKey, createCompany, initWorkRoles]);

  // Connected AI work outside this browser, so poll for what they've done.
  useEffect(() => {
    if (!isServerBacked()) return;
    void pullFromServer();
    const t = setInterval(() => void pullFromServer(), 8000);
    return () => clearInterval(t);
  }, []);

  const company = getCurrentCompany();
  const me = members[0];
  const t = totals();
  const series = completionSeries(14);
  const active = activeWorkers();

  // A department is real once someone heads it. Everything else is a role that
  // exists but nobody owns, and owning it is a deliberate act.
  const departments = useMemo(
    () =>
      workRoles
        .map((role) => ({
          role,
          head:
            responsibilities.find((r) => r.roleId === role.id && r.isPrimary) ??
            responsibilities.find((r) => r.roleId === role.id),
        }))
        .filter((d) => !!d.head),
    [workRoles, responsibilities]
  );

  const openDepartment = (roleId: string) => {
    setOpenRole(roleId);
    navigate("/missions");
  };

  return (
    <div className="min-h-screen bg-ws-subtle">
      {/* ── Top bar ── */}
      <header className="border-b border-ws-border bg-ws-bg sticky top-0 z-10">
        <div className="container max-w-5xl h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-ws-text-muted shrink-0" />
            {renaming ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  const trimmed = draftName.trim();
                  if (trimmed && company) {
                    useWorkspaceStore.setState({
                      companies: companies.map((c) =>
                        c.id === company.id ? { ...c, name: trimmed } : c
                      ),
                    });
                  }
                  setRenaming(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="h-7 px-2 rounded border border-ws-border bg-ws-bg text-sm font-semibold text-ws-text focus:outline-none focus:border-teal"
              />
            ) : (
              <button
                onClick={() => {
                  setDraftName(company?.name ?? "");
                  setRenaming(true);
                }}
                className="group inline-flex items-center gap-1.5 text-sm font-semibold text-ws-text"
                title="Rename"
              >
                {company?.name ?? "Loading…"}
                <Pencil className="w-3 h-3 text-ws-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/governance"
              className="inline-flex items-center gap-1.5 text-sm text-ws-text-soft hover:text-ws-text transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Governance
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="container max-w-5xl py-8 space-y-10">
        {/* ── Performance + counters ── */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-ws-border bg-ws-bg p-5">
            <PerformanceChart series={series} />
          </div>

          <div className="rounded-xl border border-ws-border bg-ws-bg p-5 grid grid-cols-2 gap-4 content-start">
            {[
              { label: "Tasks", value: t.tasks },
              { label: "Finished", value: t.done },
              { label: "Stuck", value: t.blocked, warn: t.blocked > 0 },
              { label: "Tokens", value: t.tokens.toLocaleString() },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-[11px] uppercase tracking-wider text-ws-text-muted mb-0.5">
                  {s.label}
                </p>
                <p
                  className={cn(
                    "text-xl font-semibold tabular-nums",
                    s.warn ? "text-red-700" : "text-ws-text"
                  )}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Who's working ── */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-ws-text">Working right now</h2>
            <span className="text-[11px] text-ws-text-muted">
              {workers.length} AI connected · {members.length}{" "}
              {members.length === 1 ? "person" : "people"}
            </span>
          </div>

          {active.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ws-border p-6 text-center">
              <p className="text-[13px] text-ws-text mb-1">Nobody is mid-task</p>
              <p className="text-[12px] text-ws-text-muted">
                People and AI appear here while they have a step in progress.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {active.map((w, i) => {
                const dept = workRoles.find((r) => r.id === w.roleId);
                return (
                  <div
                    key={`${w.id}-${i}`}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-ws-border bg-ws-bg"
                  >
                    <span
                      className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                        w.kind === "ai" ? "bg-purple-50" : "bg-ws-hover"
                      )}
                    >
                      {w.kind === "ai" ? (
                        <Bot className="w-3.5 h-3.5 text-purple-700" />
                      ) : (
                        <User className="w-3.5 h-3.5 text-ws-text-soft" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ws-text truncate">{w.name}</p>
                      <p className="text-[11px] text-ws-text-muted truncate">{w.on}</p>
                    </div>
                    {dept && (
                      <span className="text-[10px] text-ws-text-muted shrink-0">
                        {ROLE_ICONS[dept.icon] ?? "💼"} {dept.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── The funnel: pick a department to work ── */}
        <section>
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-sm font-semibold text-ws-text">How the company is wired</h2>
          </div>
          <p className="text-[12px] text-ws-text-muted mb-4">
            Every department, who runs it, the AI connected to it, and how its work is going.
            Click one to go in — all work happens inside a department.
          </p>

          {departments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ws-border p-8 text-center">
              <p className="text-sm text-ws-text mb-1">No departments yet</p>
              <p className="text-[12px] text-ws-text-muted mb-4 max-w-md mx-auto">
                A department is an area of work someone owns — Marketing, Engineering, Sales.
                Create the first one and you can start adding tasks and connecting AI to it.
              </p>
              <Link
                href="/missions"
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Create a department
              </Link>
            </div>
          ) : (
            <SystemGraph
              companyName={company?.name ?? "Your company"}
              departments={departments.map(({ role, head }) => ({
                role,
                headName: head!.memberName,
                missions: missions.filter((m) => m.roleId === role.id),
                workers: workers.filter((w) => w.roleId === role.id),
              }))}
              onOpenDepartment={openDepartment}
            />
          )}
        </section>

        {/* ── Company-wide documents ── */}
        <section className="rounded-xl border border-ws-border bg-ws-bg p-5">
          <CompanyDocuments authorName={me?.name ?? "You"} />
        </section>
      </main>
    </div>
  );
}
