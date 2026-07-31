/**
 * Multi-agent setup — the one screen that answers "what is actually running?"
 *
 * Every AI connection (MCP or API) can behave as a multi-agent system, so the
 * operator needs to see, in one place: which departments exist, which models
 * back them, what each one is allowed to read, and what each one is allowed to
 * do. Those four facts live in four different subsystems; scattering them
 * across four screens is how a company ends up not knowing what its agents can
 * touch.
 *
 * The design rule here: show the enforcement, not a claim about it. The scope
 * preview runs the real router and prints the real system prompt, so "sales
 * can't see finance" is something the operator verifies rather than believes.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Eye,
  FileText,
  Loader2,
  Lock,
  Plus,
  Shield,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/useSessionStore";

// ── Types mirroring the API ──────────────────────────────────────────────────

interface ToolScope {
  allowedTools: string[];
  neverAllowed?: string[];
}

interface Department {
  id: string;
  name: string;
  blurb: string;
  scope: string[];
  tools: ToolScope;
  documentCount: number;
}

interface BrainDoc {
  id: string;
  path: string;
  title: string;
  alwaysInclude: boolean;
  origin: "template" | "upload" | "librarian";
  updatedAt: number;
  preview: string;
}

interface FailoverTarget {
  provider: string;
  model: string;
  priority: number;
}

interface BrainResponse {
  ephemeralStore: boolean;
  departments: Department[];
  globalNeverAllowed: string[];
  failover: { chain: FailoverTarget[]; latencyCeilingMs: number; switchBudgetMs: number };
  documents: BrainDoc[];
}

interface PreviewResponse {
  scope: string[];
  empty: boolean;
  documents: { path: string; title: string }[];
  systemPrompt: string;
}

const PILLARS = [
  { n: 1, name: "Scope Guard", detail: "Blocks a tool the agent may not call", icon: Shield },
  { n: 2, name: "Failover Router", detail: "Switches provider when one goes down", icon: Zap },
  { n: 3, name: "Hallucination Guard", detail: "Rejects a fact not in the brain", icon: Eye },
  { n: 4, name: "Arbitration", detail: "Settles two agents disagreeing", icon: Ban },
  { n: 5, name: "Unit Economics", detail: "Logs cost, latency, token burn", icon: FileText },
];

export default function MultiAgent() {
  const licenseKey = useSessionStore((s) => s.licenseKey);
  const [data, setData] = useState<BrainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDept, setOpenDept] = useState<string | null>(null);

  useEffect(() => {
    if (!licenseKey) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/v1/brain", {
          headers: { Authorization: `Bearer ${licenseKey}` },
        });
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [licenseKey]);

  if (!licenseKey) {
    return (
      <Shell>
        <EmptyNotice
          title="Enter your license key first"
          body="The multi-agent setup is scoped to your workspace, so it needs your key before it can show you anything."
        />
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-ws-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your agent setup…
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <EmptyNotice
          title="Couldn't load the setup"
          body="The server didn't return your workspace configuration. If this persists, the license key may not be provisioned yet."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {data.ephemeralStore && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-900 leading-relaxed">
            This workspace is running on the in-memory store — everything here is lost when the
            server restarts. Set the <code className="font-mono">FIREBASE_*</code> variables to make
            it durable.
          </p>
        </div>
      )}

      {/* ── The pipeline ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-ws-text mb-1">What every request passes through</h2>
        <p className="text-[12px] text-ws-text-muted mb-4">
          In this order, on every call, whether the agent connected over MCP or the API. A stage
          that blocks stops the request there — nothing downstream runs.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.n} className="rounded-xl border border-ws-border bg-ws-bg p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-5 h-5 rounded-md bg-teal/10 text-teal text-[11px] font-semibold grid place-items-center shrink-0">
                    {p.n}
                  </span>
                  <Icon className="w-3.5 h-3.5 text-ws-text-soft" />
                </div>
                <p className="text-[13px] font-medium text-ws-text leading-tight mb-1">{p.name}</p>
                <p className="text-[11px] text-ws-text-muted leading-snug">{p.detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Failover chain ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-ws-text mb-1">Models, in the order they're tried</h2>
        <p className="text-[12px] text-ws-text-muted mb-3">
          If one returns a 5xx, rate-limits, or takes longer than{" "}
          {data.failover.latencyCeilingMs}ms, the next one picks it up. A bad request (4xx) is not
          retried — it would fail the same way everywhere.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {[...data.failover.chain]
            .sort((a, b) => a.priority - b.priority)
            .map((t, i) => (
              <div key={`${t.provider}-${t.model}`} className="flex items-center gap-2">
                {i > 0 && <span className="text-ws-text-muted text-xs">→</span>}
                <div className="rounded-lg border border-ws-border bg-ws-bg px-3 py-1.5">
                  <p className="text-[11px] text-ws-text-muted uppercase tracking-wide">
                    {i === 0 ? "Primary" : i === 1 ? "Secondary" : "Tertiary"}
                  </p>
                  <p className="text-[13px] font-medium text-ws-text">{t.provider}</p>
                  <p className="text-[11px] text-ws-text-soft font-mono">{t.model}</p>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* ── Departments ──────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-ws-text mb-1">Departments and what they can reach</h2>
        <p className="text-[12px] text-ws-text-muted mb-3">
          An agent's scope comes from its department, never from its request. Open one to see the
          exact context it would be given — and confirm what it cannot see.
        </p>
        <div className="space-y-2">
          {data.departments.map((d) => (
            <DepartmentCard
              key={d.id}
              dept={d}
              open={openDept === d.id}
              onToggle={() => setOpenDept(openDept === d.id ? null : d.id)}
              licenseKey={licenseKey}
            />
          ))}
        </div>
      </section>

      {/* ── Global floor ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-ws-text mb-1 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-red-700" />
          Blocked for every agent, always
        </h2>
        <p className="text-[12px] text-ws-text-muted mb-3">
          These cannot be granted by any department configuration. Listing one in an allowlist has
          no effect — the floor is checked first.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {data.globalNeverAllowed.map((t) => (
            <span
              key={t}
              className="font-mono text-[11px] px-2 py-1 rounded-md bg-red-50 text-red-700 border border-red-200"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      <AddDocument licenseKey={licenseKey} departments={data.departments} />
    </Shell>
  );
}

// ── Department card ──────────────────────────────────────────────────────────

function DepartmentCard({
  dept,
  open,
  onToggle,
  licenseKey,
}: {
  dept: Department;
  open: boolean;
  onToggle: () => void;
  licenseKey: string;
}) {
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const runPreview = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/brain/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          department: dept.id,
          query: query.trim(),
          agentName: `${dept.name} Agent`,
          role: dept.blurb,
        }),
      });
      if (res.ok) setPreview(await res.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-ws-border bg-ws-bg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-ws-hover transition-colors"
      >
        <Brain className="w-4 h-4 text-purple-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ws-text">{dept.name}</p>
          <p className="text-[11px] text-ws-text-muted truncate">{dept.blurb}</p>
        </div>
        <span className="text-[11px] text-ws-text-muted shrink-0">
          {dept.documentCount} doc{dept.documentCount !== 1 ? "s" : ""}
        </span>
        <ChevronDown
          className={cn("w-4 h-4 text-ws-text-muted transition-transform shrink-0", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-ws-border px-3.5 py-3 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ws-text-muted mb-1.5">Can read</p>
            <div className="flex flex-wrap gap-1.5">
              {dept.scope.map((s) => (
                <span
                  key={s}
                  className="font-mono text-[11px] px-2 py-0.5 rounded bg-green-50 text-green-800 border border-green-200"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ws-text-muted mb-1.5">
                Allowed tools
              </p>
              <div className="flex flex-wrap gap-1">
                {dept.tools.allowedTools.map((t) => (
                  <span key={t} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ws-subtle text-ws-text-soft">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {dept.tools.neverAllowed && dept.tools.neverAllowed.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ws-text-muted mb-1.5">
                  Denied here
                </p>
                <div className="flex flex-wrap gap-1">
                  {dept.tools.neverAllowed.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Verify isolation yourself */}
          <div className="rounded-lg border border-ws-border bg-ws-subtle p-3">
            <p className="text-[12px] font-medium text-ws-text mb-1">Check what it would see</p>
            <p className="text-[11px] text-ws-text-muted mb-2.5">
              Ask something this department shouldn't know. If isolation works, the documents list
              comes back without it.
            </p>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runPreview()}
                placeholder="e.g. what is our pricing and margin?"
                className="flex-1 h-8 px-2.5 rounded-lg border border-ws-border bg-ws-bg text-[13px] text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
              />
              <button
                onClick={runPreview}
                disabled={!query.trim() || busy}
                className="h-8 px-3 rounded-lg text-[12px] font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors shrink-0"
              >
                {busy ? "…" : "Check"}
              </button>
            </div>

            {preview && (
              <div className="mt-3">
                {preview.empty ? (
                  <p className="text-[12px] text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Nothing matched. This agent would have to say it doesn't have the answer —
                    which is the correct behaviour, not a bug.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-ws-text-muted mb-1.5">
                      Would be grounded on {preview.documents.length} document(s):
                    </p>
                    <ul className="space-y-0.5 mb-2">
                      {preview.documents.map((d) => (
                        <li key={d.path} className="text-[11px] font-mono text-ws-text-soft flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-green-600 shrink-0" />
                          {d.path}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="text-[11px] text-teal hover:underline"
                >
                  {showPrompt ? "Hide" : "Show"} the exact system prompt
                </button>
                {showPrompt && (
                  <pre className="mt-2 rounded-lg border border-ws-border bg-[#0f0f13] text-[10px] leading-relaxed text-white/85 px-3 py-2.5 overflow-x-auto max-h-64">
                    <code>{preview.systemPrompt}</code>
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add a document ───────────────────────────────────────────────────────────

function AddDocument({
  licenseKey,
  departments,
}: {
  licenseKey: string;
  departments: Department[];
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dept, setDept] = useState("");
  const [result, setResult] = useState<{ path: string; needsReview: boolean; reasoning: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/brain/documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          department: dept || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult({
          path: data.path,
          needsReview: data.needsReview,
          reasoning: data.classification.reasoning,
        });
        setTitle("");
        setBody("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-ws-text mb-1">Add to the knowledge base</h2>
      <p className="text-[12px] text-ws-text-muted mb-3">
        Leave the department on "File it for me" and the librarian picks one. It tells you which and
        why, and flags the filing when it isn't confident — you're never guessing where something went.
      </p>

      <div className="rounded-xl border border-ws-border bg-ws-bg p-3.5 space-y-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title, e.g. Q3 pricing update"
          className="w-full h-9 px-3 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Paste the content. This becomes fact for the agents that can read it — so only put in what is true."
          className="w-full px-3 py-2 rounded-lg border border-ws-border bg-ws-bg text-sm text-ws-text placeholder:text-ws-text-muted focus:outline-none focus:border-teal resize-y"
        />
        <div className="flex gap-2">
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="h-9 px-2 rounded-lg border border-ws-border bg-ws-bg text-[13px] text-ws-text focus:outline-none focus:border-teal"
          >
            <option value="">File it for me</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            onClick={submit}
            disabled={!title.trim() || !body.trim() || busy}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {busy ? "Filing…" : "Add"}
          </button>
        </div>

        {result && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2",
              result.needsReview ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"
            )}
          >
            <p className="text-[12px] text-ws-text">
              Filed to <code className="font-mono text-[11px]">{result.path}</code>
            </p>
            <p className="text-[11px] text-ws-text-muted mt-0.5">{result.reasoning}</p>
            {result.needsReview && (
              <p className="text-[11px] text-amber-800 mt-1">
                Low confidence — worth checking this landed in the right department.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Layout bits ──────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ws-canvas">
      <div className="border-b border-ws-border bg-ws-bg">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-2">
          <Bot className="w-4 h-4 text-teal" />
          <h1 className="text-sm font-semibold text-ws-text">Multi-agent setup</h1>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-5 py-6">{children}</div>
    </div>
  );
}

function EmptyNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ws-border p-8 text-center">
      <p className="text-sm text-ws-text mb-1">{title}</p>
      <p className="text-[12px] text-ws-text-muted max-w-md mx-auto">{body}</p>
    </div>
  );
}
