# The Lyceum Second Brain — canonical template

This tree is the **template**, not a customer's data. Every workspace gets its
own copy seeded from here into Firestore, keyed by license key, because one
customer's pricing floor must never be readable from another's agent.

What lives where, and why the split is enforced rather than advisory:

    global/            every agent reads this — company rules, tone, safety
    departments/       one folder per agent role, mutually invisible
      dev_ops/         API docs, latency SLAs, breaker + failover config
      finance/         pricing tiers, cost calculators, margin targets
      sales_outreach/  pitch scripts, audit templates, target criteria
      qa_compliance/   output schemas, grounding benchmarks
    shared_context/    read-only cross-department facts (error codes, logs)

The rule that makes this a security boundary and not a filing convention:
**an agent's scope is computed from its department, never from its request.**
A sales agent asking for `finance/pricing.md` does not get a 403 it can retry —
the path is not in its resolved scope, so it does not exist as far as that
agent is concerned. See `server/brain/contextRouter.ts`.
