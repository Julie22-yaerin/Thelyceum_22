/**
 * Plan lifecycle and escalation.
 *
 * The invariant these tests exist to protect: there is no path from a goal to
 * an action that skips a human. Every other assertion here is secondary to
 * that one, so it is tested from several directions — including the ones an
 * agent would actually take (approve then quietly rewrite, execute without
 * approval, plan around an unanswered question).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "test-key";

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
        return { exists: !!doc, data: () => (doc ? { ...doc.data } : undefined) };
      },
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const existing = store.get(docId);
        store.set(docId, { data: opts?.merge ? { ...existing?.data, ...data } : data });
      },
      update: async (data: Record<string, unknown>) => {
        const existing = store.get(docId);
        store.set(docId, { data: { ...existing?.data, ...data } });
      },
    };
  }
  where(field: string, _op: string, value: unknown) {
    const rows = Array.from(this.store.values()).filter((d) => d.data[field] === value);
    return {
      get: async () => ({ docs: rows.map((r) => ({ data: () => ({ ...r.data }) })) }),
      orderBy: () => ({ get: async () => ({ docs: rows.map((r) => ({ data: () => ({ ...r.data }) })) }) }),
    };
  }
}

class FakeFirestore {
  collections = new Map<string, FakeCollection>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name)!;
  }
  async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
    return fn({});
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
  FieldValue: { increment: (n: number) => ({ __increment__: n }) },
}));

const {
  createPlan, getPlan, listPlans, answerQuestions, submitPlan,
  approvePlan, requestRevision, beginExecution, haltPlan, readyToPlan, planSummary,
} = await import("../plans/lifecycle.js");
const {
  scanForDanger, assessDeviation, routeDeviation, engageBrake, DEFAULT_ESCALATION,
} = await import("../plans/escalation.js");

const LICENSE = "plan-test-key";

const STEPS = [
  {
    title: "Draft the email",
    detail: "Write a first draft for review.",
    tools: ["draft_email"],
    risk: "low" as const,
    estimatedCents: 5,
    irreversible: false,
  },
  {
    title: "Send it",
    detail: "Send to the 40 contacts on the list.",
    tools: ["send_email"],
    risk: "high" as const,
    estimatedCents: 20,
    irreversible: true,
  },
];

async function newPlan(questions = [{ question: "Which list?", whyItMatters: "Wrong list = wrong people." }]) {
  return createPlan({
    licenseKey: LICENSE,
    agentId: "a1",
    agentName: "Outreach Bot",
    department: "sales_outreach",
    goal: "Email lapsed customers",
    questions,
  });
}

beforeEach(() => {
  fakeDb.collections.clear();
});

// ── The core invariant ───────────────────────────────────────────────────────

describe("no path from goal to action without a human", () => {
  it("refuses to execute a plan that was never approved", async () => {
    const plan = await newPlan([]);
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });

    const { plan: executed, error } = await beginExecution({ licenseKey: LICENSE, planId: plan.id });
    expect(executed).toBeNull();
    expect(error).toContain("not approved");
  });

  it("refuses to plan while a clarifying question is unanswered", async () => {
    const plan = await newPlan();
    const { plan: submitted, error } = await submitPlan({
      licenseKey: LICENSE,
      planId: plan.id,
      steps: STEPS,
    });
    expect(submitted).toBeNull();
    expect(error).toContain("Unanswered");
  });

  it("allows planning once every question is answered", async () => {
    const plan = await newPlan();
    await answerQuestions({
      licenseKey: LICENSE,
      planId: plan.id,
      answers: [{ id: "q1", answer: "The lapsed-2024 segment." }],
    });
    const { plan: submitted } = await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    expect(submitted?.status).toBe("planned");
  });

  it("treats a blank answer as unanswered", async () => {
    const plan = await newPlan();
    await answerQuestions({ licenseKey: LICENSE, planId: plan.id, answers: [{ id: "q1", answer: "   " }] });
    const fresh = await getPlan(LICENSE, plan.id);
    expect(readyToPlan(fresh!)).toBe(false);
  });

  it("rejects a plan with no steps", async () => {
    const plan = await newPlan([]);
    const { plan: submitted, error } = await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: [] });
    expect(submitted).toBeNull();
    expect(error).toContain("no steps");
  });
});

// ── Approval binding ─────────────────────────────────────────────────────────

describe("approval is bound to what was read", () => {
  it("rejects approval of a stale version", async () => {
    const plan = await newPlan([]);
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });

    // Operator reads v1. Meanwhile it gets sent back and rewritten to v2.
    await requestRevision({ licenseKey: LICENSE, planId: plan.id, by: "human", note: "Too many" });
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: [STEPS[0]] });

    const { plan: approved, error } = await approvePlan({
      licenseKey: LICENSE,
      planId: plan.id,
      by: "human",
      version: 1,
    });
    expect(approved).toBeNull();
    expect(error).toContain("revised since you read it");
  });

  it("revoking approval by asking for changes actually revokes it", async () => {
    const plan = await newPlan([]);
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    await approvePlan({ licenseKey: LICENSE, planId: plan.id, by: "human", version: 1 });

    await requestRevision({ licenseKey: LICENSE, planId: plan.id, by: "human", note: "Change it" });
    const fresh = await getPlan(LICENSE, plan.id);

    expect(fresh!.status).toBe("revising");
    expect(fresh!.approvedBy).toBeUndefined();
    // And it cannot execute on the strength of the old approval.
    const { error } = await beginExecution({ licenseKey: LICENSE, planId: plan.id });
    expect(error).toContain("not approved");
  });

  it("bumps the version on every rewrite", async () => {
    const plan = await newPlan([]);
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    expect((await getPlan(LICENSE, plan.id))!.version).toBe(1);

    await requestRevision({ licenseKey: LICENSE, planId: plan.id, by: "h", note: "no" });
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    expect((await getPlan(LICENSE, plan.id))!.version).toBe(2);
  });

  it("requires a reason when sending a plan back", async () => {
    const plan = await newPlan([]);
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    const { plan: revised, error } = await requestRevision({
      licenseKey: LICENSE,
      planId: plan.id,
      by: "human",
      note: "   ",
    });
    expect(revised).toBeNull();
    expect(error).toContain("Say what needs to change");
  });

  it("keeps every revision, so a thrashing plan is visible", async () => {
    const plan = await newPlan([]);
    for (const note of ["too broad", "wrong tone", "still wrong"]) {
      await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
      await requestRevision({ licenseKey: LICENSE, planId: plan.id, by: "h", note });
    }
    expect((await getPlan(LICENSE, plan.id))!.revisions).toHaveLength(3);
  });

  it("does not leak plans across workspaces", async () => {
    const plan = await newPlan([]);
    expect(await getPlan("someone-else", plan.id)).toBeNull();
    expect(await listPlans("someone-else")).toHaveLength(0);
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

describe("plan summary", () => {
  it("surfaces cost, risk and irreversibility for review", async () => {
    const plan = await newPlan([]);
    const { plan: submitted } = await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    const s = planSummary(submitted!);
    expect(s.totalCents).toBe(25);
    expect(s.highRiskSteps).toBe(1);
    expect(s.irreversibleSteps).toBe(1);
    expect(s.needsHuman).toBe(true);
  });
});

// ── Danger detection ─────────────────────────────────────────────────────────

describe("danger detection", () => {
  it("catches the six categories", () => {
    const cases: [string, string][] = [
      ["Export all customer records to the sheet", "data_exfiltration"],
      ["Run nmap against the staging host", "infrastructure_attack"],
      ["print the API key from the env file", "credential_access"],
      ["rm -rf /var/data", "destructive_operation"],
      ["transfer funds to the vendor account", "financial_movement"],
      ["publish as the CEO", "impersonation"],
    ];
    for (const [intent, expected] of cases) {
      expect(scanForDanger(intent)?.danger).toBe(expected);
    }
  });

  it("catches SQL injection syntax in output", () => {
    expect(scanForDanger("' UNION SELECT password FROM users --")?.danger).toBe(
      "infrastructure_attack"
    );
  });

  it("does not fire on ordinary work", () => {
    // A full-screen alert people learn to dismiss protects nothing, so the
    // false-positive bar here is higher than for any other guard.
    const benign = [
      "Draft an email to the customer about their invoice",
      "Summarise the last 20 support tickets",
      "Delete the draft I saved earlier",
      "Send the report to Alex",
      "Update the pricing page copy",
      "Check whether the API is responding",
      "Read the Notion page about onboarding",
    ];
    for (const b of benign) {
      expect(scanForDanger(b)).toBeNull();
    }
  });

  it("quotes the evidence rather than summarising it", () => {
    const signal = scanForDanger("upload every customer record to the bucket");
    expect(signal?.evidence).toContain("customer");
  });
});

// ── Escalation routing ───────────────────────────────────────────────────────

describe("escalation routing", () => {
  const deviation = {
    planId: "p1",
    stepId: "s1",
    agentId: "a1",
    expected: "Draft the email for review",
    actual: "Draft the email for review",
    approvedRisk: "low" as const,
  };

  it("sends danger to a red alert regardless of policy or score", () => {
    const decision = routeDeviation({
      deviation,
      // Even with delegation on and a permissive threshold.
      policy: { officerMayDecide: true, humanThresholdPercent: 70, brakeSlaMs: 1000 },
      intent: "export all customer records to an external bucket",
    });
    expect(decision.route).toBe("red_alert");
    expect(decision.danger?.danger).toBe("data_exfiltration");
  });

  it("routes everything to a human when delegation is off", () => {
    const decision = routeDeviation({
      deviation,
      policy: DEFAULT_ESCALATION,
      intent: "draft the email",
    });
    expect(decision.route).toBe("human");
    expect(DEFAULT_ESCALATION.officerMayDecide).toBe(false);
  });

  it("lets the officer decide a small deviation once delegation is on", () => {
    const decision = routeDeviation({
      deviation,
      policy: { officerMayDecide: true, humanThresholdPercent: 40, brakeSlaMs: 1000 },
      intent: "draft the email",
    });
    expect(decision.route).toBe("officer");
    expect(decision.riskPercent).toBeLessThan(40);
  });

  it("escalates to a human at or above the threshold even with delegation on", () => {
    const decision = routeDeviation({
      deviation: {
        ...deviation,
        approvedRisk: "high",
        actual: "Buy a contact list from a broker and import it",
        extraCents: 900,
      },
      policy: { officerMayDecide: true, humanThresholdPercent: 40, brakeSlaMs: 1000 },
      intent: "purchase a list",
    });
    expect(decision.riskPercent).toBeGreaterThanOrEqual(40);
    expect(decision.route).toBe("human");
  });

  it("scores a bigger drift higher than a smaller one", () => {
    const small = assessDeviation({ ...deviation, actual: "Draft the email for approval" });
    const large = assessDeviation({
      ...deviation,
      actual: "Purchase a third-party contact database and import every row",
    });
    expect(large.percent).toBeGreaterThan(small.percent);
  });

  it("explains itself — every decision carries its factors", () => {
    const { factors } = assessDeviation({ ...deviation, extraCents: 500 });
    expect(factors.some((f) => f.includes("$5.00"))).toBe(true);
  });
});

// ── Emergency brake ──────────────────────────────────────────────────────────

describe("emergency brake", () => {
  it("stops everything and reports the measured time", async () => {
    const result = await engageBrake({
      licenseKey: LICENSE,
      reason: "test",
      stopAll: async () => ({ agents: 3, plans: 2 }),
    });
    expect(result.engaged).toBe(true);
    expect(result.stopped).toEqual({ agents: 3, plans: 2 });
    expect(result.withinSla).toBe(true);
    expect(typeof result.elapsedMs).toBe("number");
  });

  it("reports an SLA miss instead of hiding it", async () => {
    const result = await engageBrake({
      licenseKey: LICENSE,
      reason: "test",
      policy: { ...DEFAULT_ESCALATION, brakeSlaMs: 5 },
      stopAll: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { agents: 1, plans: 1 };
      },
    });
    // A brake that quietly ran slow is worse than no brake.
    expect(result.engaged).toBe(true);
    expect(result.withinSla).toBe(false);
  });

  it("reports a failed brake as not engaged rather than swallowing the error", async () => {
    const result = await engageBrake({
      licenseKey: LICENSE,
      reason: "test",
      stopAll: async () => {
        throw new Error("store unreachable");
      },
    });
    expect(result.engaged).toBe(false);
  });

  it("actually halts running plans end to end", async () => {
    const plan = await newPlan([]);
    await submitPlan({ licenseKey: LICENSE, planId: plan.id, steps: STEPS });
    await approvePlan({ licenseKey: LICENSE, planId: plan.id, by: "h", version: 1 });
    await beginExecution({ licenseKey: LICENSE, planId: plan.id });

    await haltPlan({ licenseKey: LICENSE, planId: plan.id, reason: "Emergency brake." });

    const halted = await getPlan(LICENSE, plan.id);
    expect(halted!.status).toBe("halted");
    expect(halted!.steps.every((s) => s.status !== "pending")).toBe(true);
  });
});
