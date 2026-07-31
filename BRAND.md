# The Lyceum — Brand DNA

The reference for anyone writing, designing or selling this product. It exists
so a landing page, a sales email and an error message sound like the same
company.

---

## 1. What we are

**The Lyceum is the operations layer for companies running AI agents as staff.**

It sits between the agents and every model provider. Nothing an agent does
reaches the outside world without passing through it.

Say it in one line, in this order of preference:

- *"The control layer between your AI agents and everything they can touch."*
- *"Your AI agents already run. This is the part that governs them."*
- *"Everything your agents do, on the record, with a brake."*

### What we are not

Naming these matters more than the positives, because each is a category a
buyer will otherwise file us into and price accordingly.

| Not this | Because |
|---|---|
| An agent framework | We do not help you *build* agents. We govern the ones you have. |
| A model router | Routing is one of five things we do, and the least interesting. |
| An observability tool | Observability tells you what happened. We stop it happening. |
| A chatbot | There is no chat interface anywhere in the product. |
| An AI that does your work | The AI is the customer's. We are the layer it answers to. |

---

## 2. The one idea

> **An AI agent with no operations layer is an employee with no manager, no
> budget, no job description and no way to be fired.**

Everything the product does is downstream of that sentence. When a feature
cannot be explained as "this is what a functioning company does about that
problem", it is the wrong feature.

The five things a real company has that an AI workforce does not:

1. **A brief you approve before work starts** — plan approval
2. **Facts you are expected to know, and no others** — the Second Brain
3. **A job description that limits what you can touch** — scope guard
4. **A budget you cannot silently exceed** — the circuit breaker
5. **Someone who decides when two people disagree** — arbitration

---

## 3. Voice

### The rule

**Say the true thing plainly, including when it is inconvenient.**

This is not a stylistic preference. The product's entire claim is that its
status displays are accurate — that "blocked" means blocked and "connected"
means connected. Marketing that overstates makes the product's own claims
unbelievable. Every exaggeration we write costs us the thing we sell.

### How we sound

- **Specific over impressive.** "Blocked 1,240 calls at the budget ceiling,
  $4,200 of provider spend we can account for exactly" — not "dramatically
  reduces AI costs."
- **The smaller number.** Where we can prove $2,000 and estimate $9,000, we
  lead with $2,000. The conservative figure survives the CFO; the exciting one
  gets the whole report dismissed.
- **Limits stated in the same breath as capabilities.** "The adversarial suite
  proves your policy holds. It does not tell you how a given model behaves
  under a given jailbreak." A limit we name ourselves reads as confidence. The
  same limit found by a prospect reads as a lie.
- **No hedging on refusal.** When something is not built, "that is not built"
  — never "coming soon", never "on the roadmap" unless it genuinely is.

### Words we use

`blocked` · `refused` · `on the record` · `proven` · `measured` · `the brake` ·
`what it may read` · `what it may do` · `who approved it` · `deterministic`

### Words we do not

| Banned | Why |
|---|---|
| revolutionary, game-changing, unleash, supercharge | Says nothing, and signals we have nothing specific. |
| effortless, magic, just works | The product's value is that it is *deliberate*. Magic is the opposite of auditable. |
| 10x, unlimited, guaranteed | Numbers we cannot defend. |
| AI-powered | Everything is. It is not a differentiator, it is a category. |
| enterprise-grade | Show the audit trail, do not claim the adjective. |

### Sentence shapes that work

- *Noun. Consequence.* — "The plan is approved. Nothing runs before that."
- *What it does. What it does not.* — "It stops the loop. It cannot tell you why the agent looped."
- *Number, then source.* — "$4,200 prevented — every cent traceable to a blocked call in the log."

---

## 4. Colour

```css
--bg-base:          #F8FAFC;   /* page */
--surface-card:     #FFFFFF;   /* raised */
--border-line:      #E2E8F0;   /* division */

--primary-emerald:  #0F392B;   /* authority — deep, still */
--accent-emerald:   #10B981;   /* life — bright, active */
--mint-highlight:   #D1FAE5;   /* soft ground */

--text-main:        #0F172A;
--text-muted:       #64748B;
```

### The two greens do different jobs

They are not shades of one colour. Using them interchangeably is the fastest
way to make the interface meaningless.

**`--primary-emerald` #0F392B — authority.**
Deep and still. It is the colour of the thing that does not move: the wordmark,
headings, dark surfaces, the brand itself. It never indicates state.

**`--accent-emerald` #10B981 — life.**
Only where something is *alive or correct right now*: a live indicator, a
healthy check, a passing test, the single most important action on a screen.

> **The discipline:** if everything is emerald, "this is running" stops meaning
> anything. On a governance product that is not an aesthetic problem — the
> customer stops being able to see at a glance whether they are protected.
> Roughly one accent element per screen region. If you want a second, one of
> them is decoration and should be grey.

### Semantic colours

These are not brand colours and must not be prettified toward emerald. An
operator needs to recognise them instantly, and familiarity beats harmony.

| State | Colour | Used for |
|---|---|---|
| Blocked / danger | `#DC2626` | Refusals, breaches, the red alert |
| Needs a human | `#D97706` | Awaiting approval, low confidence, estimates |
| Healthy / done | `--accent-emerald` | Passed, connected, completed |
| Neutral | `--text-muted` | Everything else |

### Dark

Dark is a first-class mode, not an inversion. The deep emerald becomes a
*surface* (it is unreadable as foreground on dark), and the accent lifts to
`#34D399` so it still reads as alive rather than sinking in.

```css
--bg-base: #0B1120;  --surface-card: #111827;  --border-line: #1F2937;
--primary-emerald: #064E3B;  --accent-emerald: #34D399;
--text-main: #F1F5F9;  --text-muted: #94A3B8;
```

---

## 5. Type

```css
--font-display: 'Inter', -apple-system, sans-serif;
--font-mono:    'JetBrains Mono', monospace;
```

**Inter** for everything a person reads. **JetBrains Mono** for anything the
machine produced or the machine will parse: tool names, scopes, skeletons,
license keys, log lines, code.

That split is doing real work. Mono is how the interface says *this is the
literal thing, not our description of it* — the evidence in a red alert, the
signature crossing a tenant boundary, the exact system prompt. When a customer
needs to verify rather than trust, it is set in mono.

**Numbers are always tabular.** Figures that shift width as they update are
unreadable in a live panel, and this product is mostly live panels.

Scale — small and dense. This is an operations surface, not a marketing page:

| Use | Size | Weight |
|---|---|---|
| Page title | 20px | 600 |
| Section heading | 14px | 600 |
| Body | 13px | 400 |
| Supporting | 12px | 400 |
| Label / caption | 11px, +0.04em, uppercase | 400 |
| Metric | 18–28px | 600, tabular |

---

## 6. Interface principles

These come from decisions already made in the product. They are descriptions,
not aspirations.

**1. Show the enforcement, not a claim about it.**
The scope preview runs the real router and prints the real system prompt. The
immunity panel prints the actual skeleton that crosses the tenant boundary. A
customer's security team reads the strings themselves. Anything less is asking
them to take our word for it — which is exactly what they are buying us to
stop doing with their agents.

**2. An empty state and a failure state must never look alike.**
"No integrations" and "you are rate limited" rendered identically once, and the
operator concluded the product was broken. Every failure says what happened and
what to do.

**3. Separate what we proved from what we estimated.**
Two figures side by side, the assumption written next to the estimate. Blending
them into one confident number is why vendor ROI dashboards get dismissed.

**4. Dangerous things are slow on purpose.**
The red alert takes the whole screen, blocks Escape, and makes you wait two
seconds before Continue enables. An alert you can reflexively dismiss is
decoration.

**5. Every automatic action is reversible and says so.**
"It fixed itself overnight" is only reassuring if you can also undo it.

---

## 7. Pricing as a message

Priced on **inference spend governed**, not seats. Seats have nothing to do
with the value; the exposure does.

| | Price | Governs |
|---|---|---|
| Team | $2,000/mo, annual | up to $25k/mo inference |
| Company | $5,000/mo, annual | up to $100k/mo |
| Enterprise | from $120k/yr | unmetered, self-host |

Two things the price is saying:

- **$24k/yr sits deliberately below the procurement threshold.** One person can
  sign it. Above roughly $25k a security review starts, and that is a
  three-month conversation.
- **The number is a claim about seriousness.** A governance layer priced like a
  Notion template gets evaluated like one. Underpricing does not win the deal
  cheaply — it loses it before the demo.

The arithmetic we lead with: *a team burning $30k/month on inference typically
wastes 5–10% on loops, retries and calls that should never have been made. Team
pays for itself at the low end of that.*

---

## 8. Proof points

Use these instead of adjectives. Every one is measured, not claimed.

- Emergency brake engages in **single-digit milliseconds** against a 1000ms
  commitment — and an SLA miss is reported, not hidden.
- **17 adversarial attacks, 58 assertions** across four departments, replayed
  against your own policy in **well under a second**, with no model calls and
  no production traffic touched.

  *(Say it that way. "58 attacks" is the assertion count, not the corpus size,
  and a prospect who checks will find 17 — which costs more than the bigger
  number gains.)*
- A threat signature crossing between customers carries **no customer text** —
  only a structural skeleton, and publication is refused outright if anything
  unrecognised survives scrubbing.
- Full global distribution of a new signature takes **minutes, not one second** —
  quarantine, false-positive measurement, canary, then release. CrowdStrike
  pushed a bad rule everywhere at once in July 2024 and grounded airlines.
- **329 automated tests**, weighted toward the isolation properties rather than
  the happy path.

> Before quoting any figure here, re-measure it. A proof point that has drifted
> is worse than no proof point, and this document is the first place drift will
> hide.

---

## 9. Naming

**The Lyceum** — Aristotle's school. Where practitioners were trained and
governed, not where machines were built. Always "The Lyceum" in prose, capital
T. Never "Lyceum AI", never an acronym.

Internal names, used consistently in product and writing:

| Name | Is |
|---|---|
| The Second Brain | The knowledge base agents are grounded on |
| The War Room | The operator's live screen |
| The Roster | Connected AI agents |
| The Brake | The emergency stop |
| A Plan | Work an agent proposes and a human approves |
| The Immunity Network | Cross-workspace threat sharing |

Departments are **departments**, agents are **agents**, and the person using
the product is **the operator**. Not "user".

---

## 10. The elevator versions

**Five seconds**
> "The control layer between your AI agents and everything they can touch."

**Thirty seconds**
> "Companies are putting AI agents into production with no budget ceiling, no
> audit trail, and no way to stop one at 3am. The Lyceum sits between the
> agents and the model providers. Every request passes five checks — what the
> agent may do, which provider serves it, whether the answer is grounded in
> your own documents, who decides when two agents disagree, and what it cost.
> Nothing runs on a goal until a human approves the plan, and there is a brake
> that stops everything in under a second."

**The line that closes**
> "You are not buying a tool that makes your agents faster. You are buying the
> reason your board lets you run them at all."
