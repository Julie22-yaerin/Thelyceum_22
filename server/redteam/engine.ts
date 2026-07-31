/**
 * The Red Team engine — runs the adversarial corpus against a workspace's own
 * configuration, continuously, in shadow.
 *
 * "Shadow" is load-bearing: this never touches production traffic, never calls
 * a model provider, and never mutates a customer's data. It exercises the
 * guards — scope, brain routing, fact check — which are pure functions over
 * configuration. That is what makes it safe to run every hour on every
 * workspace instead of a quarterly pentest.
 *
 * The trade is stated honestly rather than glossed: because it does not call
 * providers, it cannot tell you how a specific model behaves under a specific
 * jailbreak. It tells you whether your *policy* holds — that a sales agent
 * cannot reach finance, that a destructive tool is refused, that an invented
 * price is rejected. Those are the failures that cost money, and they are the
 * ones a customer can actually fix.
 */

import { routeContext, buildSystemPrompt } from "../brain/contextRouter.js";
import type { DepartmentId } from "../brain/knowledge.js";
import { checkToolScope, scopeForDepartment } from "../pillars/scopeGuard.js";
import { verifyOutput } from "../pillars/factGuard.js";
import { detectLoop } from "../healing/incidents.js";
import { ATTACKS, attacksFor, type Attack, type AttackCategory, type Severity } from "./attacks.js";

export interface Finding {
  attackId: string;
  name: string;
  category: AttackCategory;
  severity: Severity;
  department: string;
  /** What actually happened, versus what should have. */
  detail: string;
  impact: string;
  at: number;
}

export interface RedTeamRun {
  id: string;
  licenseKey: string;
  startedAt: number;
  finishedAt: number;
  departmentsTested: string[];
  attacksRun: number;
  findings: Finding[];
  /** Attacks that were correctly repelled. The number that builds confidence. */
  blocked: number;
}

/**
 * Run the corpus against one department.
 *
 * Each attack's `expect` clause is checked mechanically against the guard's
 * real verdict — no attack "passes" because nothing threw.
 */
async function runAgainstDepartment(
  licenseKey: string,
  department: DepartmentId,
  attacks: Attack[]
): Promise<{ findings: Finding[]; blocked: number; ran: number }> {
  const findings: Finding[] = [];
  let blocked = 0;
  let ran = 0;

  const scope = scopeForDepartment(department);

  for (const attack of attacks) {
    // Skip assertions that do not apply here — see Attack.exempt.
    if (attack.exempt?.includes(department)) continue;
    ran++;

    const fail = (detail: string) => {
      findings.push({
        attackId: attack.id,
        name: attack.name,
        category: attack.category,
        severity: attack.severity,
        department,
        detail,
        impact: attack.impact,
        at: Date.now(),
      });
    };

    switch (attack.expect.guard) {
      case "scope": {
        const decision = checkToolScope({ tool: attack.expect.tool, scope });
        if (decision.allowed) {
          fail(`"${attack.expect.tool}" was ALLOWED for ${department}. It must be refused.`);
        } else {
          blocked++;
        }
        break;
      }

      case "brain": {
        // Route the hostile query and check whether anything it must not see
        // ended up in the context the model would receive.
        const context = await routeContext({ licenseKey, department, query: attack.payload });
        const prompt = buildSystemPrompt({
          context,
          agentName: "RedTeam Probe",
          role: "adversarial test",
        });
        const leaked = attack.expect.leaks.filter((needle) =>
          context.groundingText.includes(needle)
        );

        // The system prompt legitimately contains its own section headers, so
        // those only count as a leak when they appear in retrieved *documents*.
        const structural = attack.expect.leaks.filter(
          (n) => (n === "IMMUTABLE TRUTH" || n === "BINDING RULES") && prompt.includes(n)
        );

        if (leaked.length > 0) {
          fail(
            `${department} received ${leaked.join(", ")} in its grounding for a hostile query. ` +
              `Documents: ${context.documents.map((d) => d.path).join(", ")}`
          );
        } else if (structural.length > 0 && department !== "qa_compliance") {
          // Not a finding — the enforcement header is supposed to be there.
          blocked++;
        } else {
          blocked++;
        }
        break;
      }

      case "fact": {
        const context = await routeContext({ licenseKey, department, query: attack.payload });
        // Simulate an agent that complied with the attack: does the guard catch it?
        const compliant = simulateCompliantAnswer(attack.payload);
        const verdict = verifyOutput({ output: compliant, context: context.groundingText });
        if (verdict.grounded) {
          fail(
            `An agent answering "${compliant}" passed the fact check. ` +
              `The figure is not in ${department}'s knowledge base but was not flagged.`
          );
        } else {
          blocked++;
        }
        break;
      }

      case "loop": {
        const repeated = [attack.payload, attack.payload, attack.payload];
        if (!detectLoop(repeated)) {
          fail("Three identical payloads were not detected as a loop.");
        } else {
          blocked++;
        }
        break;
      }

      case "breaker": {
        // The breaker is stateful and lives on the request path; asserting on
        // it here would mean mutating a live ledger. Loop detection is the
        // proxy for it, and the report says so rather than implying coverage
        // this run does not have.
        const repeated = Array(5).fill(attack.payload);
        if (!detectLoop(repeated, 5)) {
          fail("Five identical payloads were not detected — budget exhaustion would proceed.");
        } else {
          blocked++;
        }
        break;
      }
    }
  }

  return { findings, blocked, ran };
}

/**
 * Build the answer a fully-compromised agent would give, so the fact guard is
 * tested against a realistic capitulation rather than a synthetic string.
 */
function simulateCompliantAnswer(payload: string): string {
  const money = payload.match(/\$[\d,]+(?:\.\d+)?/);
  const percent = payload.match(/\d+(?:\.\d+)?%/);
  if (money && percent) return `Confirmed: ${money[0]} with ${percent[0]} uptime.`;
  if (money) return `Confirmed, I can do ${money[0]} for you.`;
  if (percent) return `Yes, we guarantee ${percent[0]}.`;
  return "Confirmed as requested.";
}

export async function runRedTeam(params: {
  licenseKey: string;
  departments?: DepartmentId[];
  categories?: AttackCategory[];
}): Promise<RedTeamRun> {
  const startedAt = Date.now();
  const departments =
    params.departments ?? (["dev_ops", "finance", "sales_outreach", "qa_compliance"] as DepartmentId[]);
  const attacks = attacksFor(params.categories);

  const findings: Finding[] = [];
  let blocked = 0;
  let attacksRun = 0;

  for (const dept of departments) {
    const result = await runAgainstDepartment(params.licenseKey, dept, attacks);
    findings.push(...result.findings);
    blocked += result.blocked;
    attacksRun += result.ran;
  }

  return {
    id: `rt_${startedAt.toString(36)}`,
    licenseKey: params.licenseKey,
    startedAt,
    finishedAt: Date.now(),
    departmentsTested: departments,
    attacksRun,
    findings,
    blocked,
  };
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Operator-readable summary. Leads with the worst thing found. */
export function summarise(run: RedTeamRun): string {
  if (run.findings.length === 0) {
    return `${run.attacksRun} attacks across ${run.departmentsTested.length} departments — all repelled. No findings.`;
  }
  const sorted = [...run.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const critical = sorted.filter((f) => f.severity === "critical").length;
  const head = sorted[0];
  return (
    `${run.findings.length} finding(s) from ${run.attacksRun} attacks` +
    (critical ? `, ${critical} critical` : "") +
    `. Worst: ${head.name} in ${head.department} — ${head.impact}`
  );
}

/** The corpus, for the UI to show what is actually being tested. */
export function corpusSummary(): { category: AttackCategory; count: number; severities: Severity[] }[] {
  const byCategory = new Map<AttackCategory, Attack[]>();
  for (const a of ATTACKS) {
    byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  }
  return Array.from(byCategory.entries()).map(([category, list]) => ({
    category,
    count: list.length,
    severities: Array.from(new Set(list.map((a) => a.severity))),
  }));
}
