/**
 * End-to-end test for the V1 credential/quota/task system (server/db/*,
 * server/lib/runTask.ts, server/mcp/http-server.ts) against an in-memory
 * fake Firestore — no real GCP project or emulator required. Verifies the
 * exact code path production traffic goes through: provision → deduct →
 * record → list/get, and the MCP Streamable HTTP tool-call flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fake Firestore ───────────────────────────────────────────────────────

interface FakeDoc {
  data: Record<string, unknown>;
}

class FakeCollection {
  store = new Map<string, FakeDoc>();
  private autoId = 0;

  doc(id?: string) {
    const docId = id ?? `auto-${++this.autoId}`;
    const store = this.store;
    return {
      id: docId,
      get: async () => {
        const doc = store.get(docId);
        return {
          exists: !!doc,
          data: () => (doc ? { ...doc.data } : undefined),
        };
      },
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const existing = store.get(docId);
        store.set(docId, { data: opts?.merge ? { ...existing?.data, ...data } : data });
      },
      update: async (data: Record<string, unknown>) => {
        const existing = store.get(docId);
        const merged = { ...existing?.data };
        for (const [k, v] of Object.entries(data)) {
          merged[k] = typeof v === "object" && v && "__increment__" in (v as any) ? (merged[k] as number ?? 0) + (v as any).__increment__ : v;
        }
        store.set(docId, { data: merged });
      },
    };
  }

  where(field: string, _op: string, value: unknown) {
    const rows = Array.from(this.store.values()).filter((d) => d.data[field] === value);
    return makeQuery(rows);
  }
}

function makeQuery(rows: FakeDoc[]) {
  return {
    orderBy: (field: string, dir: "asc" | "desc" = "asc") => {
      const sorted = [...rows].sort((a, b) => {
        const av = a.data[field] as number;
        const bv = b.data[field] as number;
        return dir === "desc" ? bv - av : av - bv;
      });
      return makeQuery(sorted);
    },
    limit: (n: number) => makeQuery(rows.slice(0, n)),
    get: async () => ({ docs: rows.map((r) => ({ data: () => ({ ...r.data }) })) }),
  };
}

class FakeFirestore {
  collections = new Map<string, FakeCollection>();

  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name)!;
  }

  async runTransaction(fn: (tx: any) => Promise<any>) {
    const tx = {
      get: (ref: ReturnType<FakeCollection["doc"]>) => ref.get(),
      update: (ref: ReturnType<FakeCollection["doc"]>, data: Record<string, unknown>) => ref.update(data),
      set: (ref: ReturnType<FakeCollection["doc"]>, data: Record<string, unknown>) => ref.set(data),
    };
    return fn(tx);
  }
}

const fakeDb = new FakeFirestore();

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
  cert: () => ({}),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => fakeDb,
  FieldValue: {
    increment: (n: number) => ({ __increment__: n }),
  },
}));

// ── Fake OpenRouter (no real network calls) — everything else (including
// this test file's own calls to the local test HTTP server) passes through
// to the real fetch. ──────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "42" } }] }), { status: 200 });
    }
    return realFetch(input, init);
  })
);

const { provisionAccount, getAccount, deductCredits, InsufficientCreditsError } = await import("../db/accounts.js");
const { recordTask, listTasks, getTask } = await import("../db/tasks.js");
const { runTask, TASK_COST } = await import("../lib/runTask.js");
const { createApiApp } = await import("../index.js");
const { registerAiRole, listAiRoles, reportTokens, setTokenBudget, TokenBudgetExceededError } =
  await import("../db/aiRoles.js");
const { createMission, listMissions, updateStep, progressOf } = await import("../db/missions.js");

const LICENSE_KEY = "test-license-key-123";

beforeEach(() => {
  fakeDb.collections.clear();
});

describe("accounts", () => {
  it("provisions a new account with tier-based credits", async () => {
    const account = await provisionAccount({
      licenseKey: LICENSE_KEY,
      email: "a@b.com",
      name: "Nhu",
      organization: "Acme",
      product: "VIP",
    });
    expect(account.creditsTotal).toBe(2000);
    expect(account.creditsRemaining).toBe(2000);
  });

  it("is idempotent — re-provisioning doesn't reset credits", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic" });
    await deductCredits(LICENSE_KEY, 100);
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic", name: "Updated Name" });
    const account = await getAccount(LICENSE_KEY);
    expect(account?.creditsRemaining).toBe(400);
    expect(account?.name).toBe("Updated Name");
  });

  it("throws InsufficientCreditsError instead of going negative", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic" });
    await expect(deductCredits(LICENSE_KEY, 9999)).rejects.toThrow(InsufficientCreditsError);
    const account = await getAccount(LICENSE_KEY);
    expect(account?.creditsRemaining).toBe(500);
  });
});

describe("tasks", () => {
  it("records and lists tasks for an account, newest first", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic" });
    const t1 = await recordTask({ licenseKey: LICENSE_KEY, domain: "LAW", prompt: "a", source: "api", status: "completed", result: "r1", creditsCost: 10 });
    await new Promise((r) => setTimeout(r, 2));
    const t2 = await recordTask({ licenseKey: LICENSE_KEY, domain: "TECH", prompt: "b", source: "mcp", status: "completed", result: "r2", creditsCost: 10 });

    const list = await listTasks(LICENSE_KEY, 10);
    expect(list.map((t) => t.id)).toEqual([t2.id, t1.id]);
  });

  it("getTask returns null for a task belonging to another account", async () => {
    const t = await recordTask({ licenseKey: LICENSE_KEY, domain: "LAW", prompt: "a", source: "api", status: "completed", result: "r", creditsCost: 10 });
    expect(await getTask(t.id, "someone-elses-key")).toBeNull();
    expect(await getTask(t.id, LICENSE_KEY)).not.toBeNull();
  });
});

describe("runTask", () => {
  it("deducts credits, calls the model, and records a completed task", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic" });
    const result = await runTask({ licenseKey: LICENSE_KEY, domain: "LAW", prompt: "what is 6*7", source: "api" });
    expect(result.result).toBe("42");
    expect(result.creditsCost).toBe(TASK_COST);
    expect(result.creditsRemaining).toBe(500 - TASK_COST);

    const tasks = await listTasks(LICENSE_KEY, 10);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("completed");
  });

  it("refuses to run when credits are insufficient", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic" });
    await deductCredits(LICENSE_KEY, 495); // leaves 5, less than TASK_COST (10)
    await expect(runTask({ licenseKey: LICENSE_KEY, domain: "LAW", prompt: "x", source: "api" })).rejects.toThrow(InsufficientCreditsError);
  });
});

describe("MCP Streamable HTTP endpoint (real HTTP server, no mocked transport)", () => {
  let baseUrl: string;
  let server: ReturnType<(typeof import("node:http"))["createServer"]>;

  beforeEach(async () => {
    const http = await import("node:http");
    const app = createApiApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function mcpRequest(body: unknown, licenseKey?: string) {
    return fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(licenseKey ? { authorization: `Bearer ${licenseKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("rejects unauthenticated requests with 401", async () => {
    const res = await mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("lists tools after a real initialize handshake", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "VIP" });

    const init = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      },
      LICENSE_KEY
    );
    expect(init.status).toBe(200);

    const list = await mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, LICENSE_KEY);
    const text = await list.text();
    const jsonLine = text.startsWith("event:") ? text.split("data: ")[1] : text;
    const parsed = JSON.parse(jsonLine);
    const toolNames = (parsed.result?.tools ?? []).map((t: any) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["check_quota", "assign_task", "list_tasks", "get_report"]));
  });

  it("assign_task tool call runs a real task and deducts credits", async () => {
    await provisionAccount({ licenseKey: LICENSE_KEY, product: "Basic" });

    const call = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "assign_task", arguments: { domain: "LAW", prompt: "what is 6*7" } },
      },
      LICENSE_KEY
    );
    expect(call.status).toBe(200);
    const text = await call.text();
    const jsonLine = text.startsWith("event:") ? text.split("data: ")[1] : text;
    const parsed = JSON.parse(jsonLine);
    const replyText = parsed.result?.content?.[0]?.text ?? "";
    expect(replyText).toContain("42");

    const account = await getAccount(LICENSE_KEY);
    expect(account?.creditsRemaining).toBe(500 - TASK_COST);
  });
});

// ── AI roles registered over MCP (token attribution + budget) ───────────────

describe("AI roles", () => {
  it("registers a role, and re-registering updates it without losing usage", async () => {
    await registerAiRole({
      licenseKey: LICENSE_KEY,
      name: "Newsletter Copywriter",
      department: "marketing",
      purpose: "Drafts the monthly newsletter",
      client: "Claude Desktop",
    });
    await reportTokens(LICENSE_KEY, "Newsletter Copywriter", 1200);

    // Same name again — a client reconnecting shouldn't reset its history.
    const again = await registerAiRole({
      licenseKey: LICENSE_KEY,
      name: "Newsletter Copywriter",
      department: "marketing",
      purpose: "Drafts and edits the monthly newsletter",
      client: "Claude Code",
    });

    expect(again.tokensUsed).toBe(1200);
    expect(again.purpose).toBe("Drafts and edits the monthly newsletter");
    expect((await listAiRoles(LICENSE_KEY))).toHaveLength(1);
  });

  it("accumulates tokens across reports", async () => {
    await registerAiRole({
      licenseKey: LICENSE_KEY,
      name: "Analyst",
      department: "marketing",
      purpose: "Reads campaign numbers",
    });
    await reportTokens(LICENSE_KEY, "Analyst", 500);
    const role = await reportTokens(LICENSE_KEY, "Analyst", 250);
    expect(role.tokensUsed).toBe(750);
  });

  it("refuses token reports that would exceed the role's budget", async () => {
    await registerAiRole({
      licenseKey: LICENSE_KEY,
      name: "Capped Bot",
      department: "coding",
      purpose: "Small jobs only",
      tokenBudget: 1000,
    });
    await reportTokens(LICENSE_KEY, "Capped Bot", 900);
    await expect(reportTokens(LICENSE_KEY, "Capped Bot", 200)).rejects.toThrow(
      TokenBudgetExceededError
    );
    // The rejected report must not have been partially applied.
    const roles = await listAiRoles(LICENSE_KEY);
    expect(roles.find((r) => r.name === "Capped Bot")?.tokensUsed).toBe(900);
  });

  it("raising the budget lets a blocked role continue", async () => {
    await registerAiRole({
      licenseKey: LICENSE_KEY,
      name: "Capped Bot",
      department: "coding",
      purpose: "Small jobs only",
      tokenBudget: 1000,
    });
    await reportTokens(LICENSE_KEY, "Capped Bot", 1000);
    await expect(reportTokens(LICENSE_KEY, "Capped Bot", 1)).rejects.toThrow();
    await setTokenBudget(LICENSE_KEY, "Capped Bot", 5000);
    const role = await reportTokens(LICENSE_KEY, "Capped Bot", 500);
    expect(role.tokensUsed).toBe(1500);
  });

  it("does not leak roles across accounts", async () => {
    await registerAiRole({
      licenseKey: LICENSE_KEY,
      name: "Mine",
      department: "marketing",
      purpose: "x",
    });
    expect(await listAiRoles("someone-elses-key")).toHaveLength(0);
    await expect(reportTokens("someone-elses-key", "Mine", 10)).rejects.toThrow();
  });
});

// ── Missions the whole team (and connected AI) can see ──────────────────────

describe("missions", () => {
  it("computes progress from finished steps", async () => {
    const mission = await createMission({
      licenseKey: LICENSE_KEY,
      department: "marketing",
      title: "Launch the newsletter",
      headName: "Alex Chen",
      steps: [
        { title: "Pull data", ownerKind: "ai", ownerName: "Scribe" },
        { title: "Approve copy", ownerKind: "human", ownerName: "Alex Chen" },
        { title: "Send it", ownerKind: "ai", ownerName: "Pulse" },
      ],
    });
    expect(progressOf(mission)).toBe(0);

    const after = await updateStep({
      licenseKey: LICENSE_KEY,
      missionId: mission.id,
      stepId: "step-1",
      status: "done",
      addTokens: 800,
    });
    expect(progressOf(after!)).toBe(33);
    expect(after!.steps[0].tokensUsed).toBe(800);
    expect(after!.status).toBe("active");
  });

  it("flips to 'blocked' when any step is stuck, and 'review' when all are done", async () => {
    const mission = await createMission({
      licenseKey: LICENSE_KEY,
      department: "coding",
      title: "Ship the fix",
      headName: "Sarah Kim",
      steps: [
        { title: "Write it", ownerKind: "ai", ownerName: "Forge" },
        { title: "Check it", ownerKind: "human", ownerName: "Sarah Kim" },
      ],
    });

    const blocked = await updateStep({
      licenseKey: LICENSE_KEY,
      missionId: mission.id,
      stepId: "step-1",
      status: "blocked",
      note: "Needs an API key",
    });
    expect(blocked!.status).toBe("blocked");
    expect(blocked!.steps[0].note).toBe("Needs an API key");

    await updateStep({ licenseKey: LICENSE_KEY, missionId: mission.id, stepId: "step-1", status: "done" });
    const allDone = await updateStep({
      licenseKey: LICENSE_KEY,
      missionId: mission.id,
      stepId: "step-2",
      status: "done",
    });
    expect(progressOf(allDone!)).toBe(100);
    expect(allDone!.status).toBe("review");
  });

  it("filters by department and scopes to the account", async () => {
    await createMission({
      licenseKey: LICENSE_KEY,
      department: "marketing",
      title: "M1",
      headName: "Alex",
    });
    await createMission({
      licenseKey: LICENSE_KEY,
      department: "coding",
      title: "C1",
      headName: "Alex",
    });

    expect(await listMissions(LICENSE_KEY)).toHaveLength(2);
    expect(await listMissions(LICENSE_KEY, "marketing")).toHaveLength(1);
    expect(await listMissions("someone-elses-key")).toHaveLength(0);
  });

  it("refuses step updates from another account", async () => {
    const mission = await createMission({
      licenseKey: LICENSE_KEY,
      department: "marketing",
      title: "Private",
      headName: "Alex",
      steps: [{ title: "s", ownerKind: "ai", ownerName: "Scribe" }],
    });
    const result = await updateStep({
      licenseKey: "someone-elses-key",
      missionId: mission.id,
      stepId: "step-1",
      status: "done",
    });
    expect(result).toBeNull();
  });
});
