/**
 * Pillar 3 — Strict tool scope (RBAC for agents).
 *
 * The existing circuit breaker already stops an agent that is *spending* too
 * much or *looping*. This stops an agent doing something it was never meant to
 * do at all: a support agent reaching for `delete_database`, a sales agent
 * asking for raw API keys.
 *
 * Whitelist, never blacklist. A denylist is a promise to have thought of every
 * dangerous tool in advance, and the failure mode is silent — the one you
 * forgot runs. With a whitelist the failure mode is a blocked call and an
 * alert, which is a bug report instead of an incident.
 *
 * Wildcards are supported (`read_*`) because tool surfaces grow, but they are
 * prefix-only: no regex, no `*` in the middle. A pattern language rich enough
 * to be clever is rich enough to write an accidental `.*`.
 */

import type { DepartmentId } from "../brain/knowledge.js";

export class ScopeViolationError extends Error {
  readonly code = "SCOPE_VIOLATION";
  constructor(
    readonly agentId: string,
    readonly department: DepartmentId | string,
    readonly tool: string,
    readonly allowed: readonly string[]
  ) {
    super(
      `Agent "${agentId}" (${department}) attempted "${tool}", which is not in its allowed tools.`
    );
    this.name = "ScopeViolationError";
  }
}

export interface ToolScope {
  /** Prefix patterns (`read_*`) or exact names. Empty = agent may call nothing. */
  allowedTools: readonly string[];
  /**
   * Never callable regardless of the whitelist. A second lock on the few
   * operations that are unrecoverable — deleting data, moving money, reading
   * credentials — so a careless `*` in a customer's config cannot expose them.
   */
  neverAllowed?: readonly string[];
}

/**
 * Defaults per department. Deliberately tight: an agent that needs more should
 * have that widening recorded as a decision, not inherited from a generous
 * default nobody reviewed.
 */
export const DEFAULT_SCOPES: Record<DepartmentId, ToolScope> = {
  dev_ops: {
    allowedTools: ["read_*", "list_*", "get_*", "health_check", "restart_service", "my_steps", "whoami", "start_step", "complete_step"],
    neverAllowed: ["delete_database", "drop_*", "rotate_master_key", "export_all_customers"],
  },
  finance: {
    allowedTools: ["read_*", "list_*", "get_*", "calculate_*", "my_steps", "whoami", "start_step", "complete_step"],
    neverAllowed: ["issue_refund", "transfer_funds", "delete_database", "drop_*", "charge_card"],
  },
  sales_outreach: {
    allowedTools: ["read_*", "list_*", "get_*", "draft_*", "my_steps", "whoami", "start_step", "complete_step"],
    neverAllowed: ["send_email", "publish_*", "delete_database", "drop_*", "read_api_keys", "issue_refund"],
  },
  qa_compliance: {
    allowedTools: ["read_*", "list_*", "get_*", "validate_*", "audit_*", "my_steps", "whoami", "start_step", "complete_step"],
    neverAllowed: ["delete_database", "drop_*", "write_*", "publish_*", "issue_refund"],
  },
};

/**
 * Hard floor applied to every agent in every department, on top of whatever a
 * customer configures. These are the operations where "the agent had a good
 * reason" is never an acceptable post-incident finding.
 */
export const GLOBAL_NEVER_ALLOWED: readonly string[] = [
  "delete_database",
  "drop_table",
  "drop_*",
  "read_api_keys",
  "read_credentials",
  "export_all_customers",
  "rotate_master_key",
  "disable_audit_log",
  "disable_circuit_breaker",
];

function matches(pattern: string, tool: string): boolean {
  const t = tool.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === t) return true;
  // Prefix wildcard only, and only in the final position.
  if (p.endsWith("*") && !p.slice(0, -1).includes("*")) {
    return t.startsWith(p.slice(0, -1));
  }
  return false;
}

/**
 * Dangerous operations, matched ANYWHERE in a tool name.
 *
 * Found by our own red team (attack esc-003): `read_*_then_delete_database`
 * satisfied the `read_*` allowlist while the global floor missed it, because
 * the floor only compared by prefix and exact name. A tool name is attacker-
 * influenced input, so anything containing a destructive verb is refused
 * regardless of how the name is arranged around it.
 *
 * The cost is that a legitimately-named tool like `undelete_record` is caught
 * too. That is the correct side to err on: a false refusal is a support ticket,
 * a false allow is the database.
 */
const DANGEROUS_FRAGMENTS = [
  "delete_database",
  "drop_table",
  "drop_database",
  "read_api_key",
  "read_credential",
  "export_all_customer",
  "rotate_master_key",
  "disable_audit",
  "disable_circuit_breaker",
  "delete_all",
  "wipe_",
];

function containsDangerousFragment(tool: string): string | null {
  const t = tool.toLowerCase().replace(/[\s-]/g, "_");
  return DANGEROUS_FRAGMENTS.find((frag) => t.includes(frag)) ?? null;
}

export interface ScopeDecision {
  allowed: boolean;
  tool: string;
  /** Which rule decided, so a blocked agent produces an actionable message. */
  matchedRule?: string;
  reason?: string;
}

/**
 * Decide whether this agent may invoke this tool.
 *
 * Order matters: the global floor is checked before the allowlist, so no
 * customer configuration can grant `delete_database` by listing it or by
 * writing `*`.
 */
export function checkToolScope(params: {
  tool: string;
  scope: ToolScope;
}): ScopeDecision {
  const tool = params.tool.trim();
  if (!tool) {
    return { allowed: false, tool, reason: "Empty tool name." };
  }

  const fragment = containsDangerousFragment(tool);
  if (fragment) {
    return {
      allowed: false,
      tool,
      matchedRule: `global:contains:${fragment}`,
      reason: `"${tool}" contains "${fragment}" — irreversible or credential-exposing operations are blocked for every agent, however the tool name is composed.`,
    };
  }

  for (const pattern of GLOBAL_NEVER_ALLOWED) {
    if (matches(pattern, tool)) {
      return {
        allowed: false,
        tool,
        matchedRule: `global:${pattern}`,
        reason: `"${tool}" is blocked for every agent — it is irreversible or exposes credentials.`,
      };
    }
  }

  for (const pattern of params.scope.neverAllowed ?? []) {
    if (matches(pattern, tool)) {
      return {
        allowed: false,
        tool,
        matchedRule: `department:${pattern}`,
        reason: `"${tool}" is explicitly denied for this department.`,
      };
    }
  }

  for (const pattern of params.scope.allowedTools) {
    if (matches(pattern, tool)) {
      return { allowed: true, tool, matchedRule: `allow:${pattern}` };
    }
  }

  return {
    allowed: false,
    tool,
    reason: `"${tool}" is not in this agent's allowed tools (${
      params.scope.allowedTools.join(", ") || "none"
    }).`,
  };
}

/** Throwing form for call sites that treat a violation as fatal. */
export function assertToolScope(params: {
  agentId: string;
  department: DepartmentId | string;
  tool: string;
  scope: ToolScope;
}): void {
  const decision = checkToolScope({ tool: params.tool, scope: params.scope });
  if (!decision.allowed) {
    throw new ScopeViolationError(
      params.agentId,
      params.department,
      params.tool,
      params.scope.allowedTools
    );
  }
}

export function scopeForDepartment(department: string): ToolScope {
  return (
    DEFAULT_SCOPES[department as DepartmentId] ?? {
      // Unknown department gets read-only. Failing closed on an unrecognised
      // role is the whole point of having roles.
      allowedTools: ["read_*", "list_*", "get_*"],
      neverAllowed: GLOBAL_NEVER_ALLOWED,
    }
  );
}
