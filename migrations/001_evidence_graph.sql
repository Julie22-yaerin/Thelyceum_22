-- ============================================================================
-- The Lyceum — Evidence Graph (DIRECTIVE 3)
--
-- Audit records modelled as a graph rather than a flat table, because the thing
-- an enterprise auditor actually asks is a path question, not a row question:
--   "this agent spent $40 and dropped a table — show me every decision, every
--    approval, and every retry that led there, in order."
-- A flat log answers that with a timestamp sort and a prayer. A graph answers
-- it with one recursive query, and the answer is provably complete because the
-- causal edge is a first-class, NOT NULL-constrained object.
--
-- Requires PostgreSQL 12+ (generated columns, recursive CTEs).
-- Apply with:  psql "$DATABASE_URL" -f migrations/001_evidence_graph.sql
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ── Enumerations ────────────────────────────────────────────────────────────
-- Enums rather than free text so a competitor's ETL — or our own future self —
-- cannot quietly introduce a fourth kind of "approval" that no query covers.

CREATE TYPE evidence_node_kind AS ENUM (
  'agent_state',     -- a snapshot of what the agent believed/intended
  'proxy_call',      -- one governed request that reached a provider
  'tool_call',       -- a tool/function execution
  'mcp_call',        -- an MCP server invocation
  'breach',          -- the circuit breaker refused something
  'human_approval',  -- a person approved, rejected, or modified constraints
  'mission',         -- the unit of work being pursued
  'mission_step'     -- one step of that work
);

CREATE TYPE evidence_edge_kind AS ENUM (
  'caused',          -- A led to B (the ordinary decision pathway)
  'blocked_by',      -- A was stopped by breach B
  'approved_by',     -- A was permitted because of human approval B
  'rejected_by',     -- A was refused by human decision B
  'retried_as',      -- A failed and was re-attempted as B
  'escalated_to',    -- A exceeded automatic handling and became B
  'part_of',         -- A is a component of B (step → mission)
  'delegated_to'     -- A handed work to agent/AI B
);

CREATE TYPE actor_kind AS ENUM ('human', 'ai', 'system');

-- ── Nodes ───────────────────────────────────────────────────────────────────

CREATE TABLE evidence_node (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. Every read path filters on this; it is the first column of every
  -- index for that reason.
  license_key     text        NOT NULL,
  session_id      text        NOT NULL,

  kind            evidence_node_kind NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  -- Who acted. Splitting kind from id means "was this decision ever touched by
  -- a human?" is an indexable question, which is the question compliance asks.
  actor_kind      actor_kind  NOT NULL,
  actor_id        text        NOT NULL,
  actor_label     text,

  -- Short human-readable summary, always populated, so the graph is readable
  -- without joining to payloads.
  summary         text        NOT NULL,

  -- Money and tokens are promoted out of the payload because they are
  -- aggregated constantly and must never be trapped inside JSON.
  cost_cents      numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  input_tokens    integer     NOT NULL DEFAULT 0 CHECK (input_tokens  >= 0),
  output_tokens   integer     NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),

  model           text,
  upstream        text,

  -- Deterministic-verdict fields, so an auditor can replay a decision without
  -- trusting our prose.
  breach_code     text,
  evaluated_in_ms numeric(8,2),

  -- Everything provider- or tool-specific. Redacted before write: no API keys,
  -- no private keys, no bearer tokens (enforced in the writer, not here).
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Spatial coordinates.
  --
  -- Being straight about what these are and are not: they exist so a decision
  -- pathway renders identically for every viewer and every replay (a stable
  -- layout is genuinely useful when two people are looking at the same
  -- incident), and so nearby work can be queried geometrically. They are NOT a
  -- security or exclusivity mechanism — see the note at the bottom of this file.
  pos_x           double precision,
  pos_y           double precision,
  pos_z           double precision,

  -- Depth in the causal tree, maintained by the writer. Cheap to read, and it
  -- makes "how deep did this agent recurse before we caught it" a scan-free
  -- question — which is exactly the runaway-agent signal.
  causal_depth    integer     NOT NULL DEFAULT 0 CHECK (causal_depth >= 0),

  CONSTRAINT breach_nodes_carry_a_code
    CHECK (kind <> 'breach' OR breach_code IS NOT NULL),
  CONSTRAINT only_ai_or_system_spends
    CHECK (cost_cents = 0 OR actor_kind <> 'human')
);

COMMENT ON TABLE evidence_node IS
  'One vertex of the evidence graph: an agent state, a governed call, a breach, or a human decision.';

CREATE INDEX evidence_node_tenant_time_idx
  ON evidence_node (license_key, occurred_at DESC);
CREATE INDEX evidence_node_session_idx
  ON evidence_node (license_key, session_id, occurred_at);
CREATE INDEX evidence_node_kind_idx
  ON evidence_node (license_key, kind, occurred_at DESC);
-- Partial index: breaches are rare and queried constantly (the incident feed).
CREATE INDEX evidence_node_breach_idx
  ON evidence_node (license_key, occurred_at DESC)
  WHERE kind = 'breach';
-- Partial index for the compliance question "what did humans actually approve".
CREATE INDEX evidence_node_human_idx
  ON evidence_node (license_key, occurred_at DESC)
  WHERE actor_kind = 'human';
CREATE INDEX evidence_node_payload_idx
  ON evidence_node USING gin (payload jsonb_path_ops);

-- ── Edges ───────────────────────────────────────────────────────────────────

CREATE TABLE evidence_edge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key   text        NOT NULL,

  from_node     uuid        NOT NULL REFERENCES evidence_node(id) ON DELETE CASCADE,
  to_node       uuid        NOT NULL REFERENCES evidence_node(id) ON DELETE CASCADE,
  kind          evidence_edge_kind NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Ordering among siblings, so a fan-out of parallel tool calls still has a
  -- deterministic, replayable sequence.
  sequence      integer     NOT NULL DEFAULT 0,

  -- Why this edge exists, when it isn't self-evident from the two nodes.
  rationale     text,

  meta          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT no_self_edges CHECK (from_node <> to_node),
  -- The same relationship must not be recorded twice; an audit trail that can
  -- double-count its own causality is not an audit trail.
  CONSTRAINT edge_is_unique UNIQUE (from_node, to_node, kind)
);

COMMENT ON TABLE evidence_edge IS
  'A directed, typed relationship between two evidence nodes — the decision pathway itself.';

CREATE INDEX evidence_edge_from_idx ON evidence_edge (from_node, kind);
CREATE INDEX evidence_edge_to_idx   ON evidence_edge (to_node, kind);
CREATE INDEX evidence_edge_tenant_idx ON evidence_edge (license_key, created_at DESC);

-- ── Tenant isolation ────────────────────────────────────────────────────────
-- Row-level security so a query that forgets its WHERE clause returns nothing
-- rather than another customer's audit trail. The application connects as a
-- non-superuser role and sets app.license_key per transaction.

ALTER TABLE evidence_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_edge ENABLE ROW LEVEL SECURITY;

CREATE POLICY node_tenant_isolation ON evidence_node
  USING (license_key = current_setting('app.license_key', true));
CREATE POLICY edge_tenant_isolation ON evidence_edge
  USING (license_key = current_setting('app.license_key', true));

-- An edge must not be able to join two different tenants' nodes together.
CREATE OR REPLACE FUNCTION assert_edge_tenant_matches() RETURNS trigger AS $$
DECLARE
  from_tenant text;
  to_tenant   text;
BEGIN
  SELECT license_key INTO from_tenant FROM evidence_node WHERE id = NEW.from_node;
  SELECT license_key INTO to_tenant   FROM evidence_node WHERE id = NEW.to_node;
  IF from_tenant IS DISTINCT FROM NEW.license_key
     OR to_tenant IS DISTINCT FROM NEW.license_key THEN
    RAISE EXCEPTION 'evidence_edge would cross tenants (% -> %)', from_tenant, to_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_edge_tenant_guard
  BEFORE INSERT OR UPDATE ON evidence_edge
  FOR EACH ROW EXECUTE FUNCTION assert_edge_tenant_matches();

-- ── Append-only enforcement ─────────────────────────────────────────────────
-- An audit record that can be edited after the fact is worth nothing in a
-- dispute. Updates and deletes are refused at the database, not just in code.

CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'evidence graph is append-only (attempted % on %)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_node_append_only
  BEFORE UPDATE OR DELETE ON evidence_node
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER evidence_edge_append_only
  BEFORE UPDATE OR DELETE ON evidence_edge
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

-- ── Lineage: the query the whole schema exists to serve ─────────────────────
-- "Show me everything that led to this node, in causal order."

CREATE OR REPLACE FUNCTION evidence_lineage(root uuid, max_depth integer DEFAULT 50)
RETURNS TABLE (
  depth        integer,
  node_id      uuid,
  kind         evidence_node_kind,
  actor_kind   actor_kind,
  actor_label  text,
  summary      text,
  cost_cents   numeric,
  breach_code  text,
  occurred_at  timestamptz,
  via_edge     evidence_edge_kind
) AS $$
  WITH RECURSIVE walk AS (
    SELECT 0 AS depth, n.id, NULL::evidence_edge_kind AS via
    FROM evidence_node n WHERE n.id = root
    UNION
    SELECT w.depth + 1, e.from_node, e.kind
    FROM walk w
    JOIN evidence_edge e ON e.to_node = w.id
    WHERE w.depth < max_depth
  )
  SELECT w.depth, n.id, n.kind, n.actor_kind, n.actor_label, n.summary,
         n.cost_cents, n.breach_code, n.occurred_at, w.via
  FROM walk w
  JOIN evidence_node n ON n.id = w.id
  ORDER BY w.depth, n.occurred_at;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION evidence_lineage IS
  'Every ancestor of a node with the edge type that connected it — the auditable "how did we get here".';

-- Rolled-up spend per session, including whether a human ever intervened.
CREATE OR REPLACE VIEW evidence_session_summary AS
SELECT
  license_key,
  session_id,
  min(occurred_at)                                        AS started_at,
  max(occurred_at)                                        AS last_activity_at,
  count(*)                                                AS node_count,
  sum(cost_cents)                                         AS total_cost_cents,
  sum(input_tokens + output_tokens)                        AS total_tokens,
  count(*) FILTER (WHERE kind = 'breach')                 AS breach_count,
  count(*) FILTER (WHERE kind = 'human_approval')         AS human_decision_count,
  max(causal_depth)                                       AS deepest_causal_chain
FROM evidence_node
GROUP BY license_key, session_id;

-- ── Customer data export ────────────────────────────────────────────────────
-- Deliberately provided. This is an audit and compliance product: enterprise
-- buyers and their auditors require that they can get their own records out,
-- and a product that traps audit data fails procurement. See the note below.

CREATE OR REPLACE VIEW evidence_flat_export AS
SELECT
  n.license_key,
  n.session_id,
  n.occurred_at,
  n.kind::text            AS node_kind,
  n.actor_kind::text      AS actor_kind,
  n.actor_label,
  n.summary,
  n.model,
  n.upstream,
  n.cost_cents,
  n.input_tokens,
  n.output_tokens,
  n.breach_code,
  n.causal_depth,
  n.payload,
  -- Parent ids flattened so a CSV consumer keeps the causal structure.
  ( SELECT string_agg(e.from_node::text, ',' ORDER BY e.sequence)
    FROM evidence_edge e WHERE e.to_node = n.id )        AS caused_by_node_ids,
  ( SELECT string_agg(e.kind::text, ',' ORDER BY e.sequence)
    FROM evidence_edge e WHERE e.to_node = n.id )        AS caused_by_edge_kinds
FROM evidence_node n;

COMMENT ON VIEW evidence_flat_export IS
  'Complete, portable export of a tenant''s evidence graph including causal parents.';

COMMIT;

-- ============================================================================
-- A NOTE ON THE "GEOMETRIC MOAT"
--
-- This schema is worth building. Typed nodes, typed causal edges, append-only
-- triggers, tenant-crossing guards and one-query lineage give real, defensible
-- product value: fast incident reconstruction, and an audit trail that stands
-- up when a customer's auditor pushes on it.
--
-- What it does not do is make the data hard for a competitor to copy. Any
-- schema — graph, spatial, or otherwise — is a `COPY ... TO` away from being a
-- flat file, and coordinates are just six more float columns to carry along.
-- Structure is not encryption, and shape is not a lock.
--
-- Pursuing extraction-resistance here would also cost us the deals we want:
-- audit and compliance buyers demand data portability, exit clauses, and their
-- auditors' ability to read the record independently. A schema designed to
-- frustrate export frustrates the customer first and the competitor never —
-- which is why evidence_flat_export above exists on purpose.
--
-- The durable moat is elsewhere: the accumulated corpus of real breach
-- patterns, the tuned deny rules that produce few false positives, the
-- integrations, and the switching cost of being the system of record. Those
-- compound. A column layout does not.
-- ============================================================================
