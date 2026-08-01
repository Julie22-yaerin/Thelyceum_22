# Licensing and code protection — what is achievable, and what is not

You asked how to stop a developer copying the code, republishing it, or sharing
one subscription across many people. This document is the honest answer,
because getting this wrong is expensive in a specific way: you spend months on
protection that does not work, and skip the two things that do.

---

## 1. The uncomfortable part, first

**You cannot stop a determined developer from copying code that runs on their
machine.** Not with obfuscation, not with minification, not with a license
check compiled into the binary. The code has to execute on their CPU, so it has
to be readable by their CPU, so it is readable by them. Every "code protection"
product that claims otherwise is selling a speed bump priced as a wall.

This is not a limitation of our implementation. It is the shape of the problem.
Anyone who tells you they solved it is either lying or has moved the valuable
part to a server — which is option C below.

So the question is not "how do I make copying impossible". It is **"how do I
make copying not worth it"**, and that has real answers.

---

## 2. What is true right now

Both packages are **MIT licensed** and the source is public. Under MIT, anyone
may legally copy, modify, republish and sell this. That is not a loophole — it
is exactly what MIT grants, and it is what you published under.

Two consequences worth being precise about:

- **You cannot retroactively un-license what is already published.** Any commit
  already public under MIT stays MIT forever, for everyone who has it. Changing
  the license affects future versions only.
- **Nothing currently checks a license before running.** `brake scan`,
  `brake engage`, `redteam challenge` all work today with no key. This is why
  the pricing page says what a subscription actually buys — tracked devices,
  guided setup, support — rather than implying it buys the detection.

If you want a closed product, that is a decision to make now, and it applies
going forward.

---

## 3. The three real options

### Option A — Change the license going forward (cheapest, weakest)

Relicense future versions as proprietary. Stop publishing source; publish only
built artifacts to npm.

- **Stops:** honest companies. Most businesses will not knowingly run
  unlicensed software — legal risk outweighs a subscription.
- **Does not stop:** a developer who wants to read the bundle. Built JS is
  readable with `prettier` in about ten seconds.
- **Effort:** an afternoon.

### Option B — Server-side license validation with device binding (moderate)

Already half-built. `devices.ts` enforces connection limits server-side; the
CLI would need to check in periodically and refuse to run without a valid,
non-exhausted license.

- **Stops:** casual sharing. One key across a whole team hits the device
  ceiling and someone has to buy another seat.
- **Does not stop:** someone patching out the check. It is one `if` statement
  in code they control.
- **Effort:** a week.
- **Real cost worth knowing:** it makes the tool require network access to
  start. For a product whose pitch is "no network call on the hot path", that
  is a meaningful concession — do it as a periodic check with a generous
  offline grace period, never a per-call check.

### Option C — Move the valuable part server-side (strongest, and it conflicts with your product)

The only structurally sound protection: keep what is worth stealing on a
machine you control. Ship a thin client that calls your API.

- **Stops:** everything. They cannot copy what they never receive.
- **Effort:** a rewrite.
- **And here is why I am not recommending it as-is:** your entire performance
  claim — 1.37M scans/sec, 0.73µs, *zero network calls on the hot path* — is
  true precisely because the detection runs locally. Move `scanForDanger`
  server-side and you replace a 0.73µs local call with a ~50,000µs network
  round trip, on every single tool call. You would be trading the thing that
  makes the product good for protection against a threat that mostly is not
  materialising.

---

## 4. What I would actually do

**A + B, and not C.**

1. **Relicense going forward.** New versions proprietary, source no longer
   published, npm gets built artifacts only.
2. **Keep detection local and free-to-run.** It is the fast part and the part
   people evaluate you on. Trying to protect it costs more than it is worth.
3. **Put the enforcement where the value actually accrues** — the things that
   genuinely cannot be copied:
   - **Device registration**, already server-side. A pirated copy has no
     tracked connections and no fleet view.
   - **The guided setup**, already gated.
   - **Support and the SLA commitment.** Nobody pirates a support contract.
   - **New danger rules and flaw classes.** A copy is frozen at the moment it
     was taken; a subscription keeps receiving updates. This is the strongest
     lever you have and it costs nothing to build — it is just shipping.
4. **Accept a piracy rate.** Some people will run a copy. Most of them were
   never going to pay, and a company that would sign a $299/month invoice is
   not going to bet the business on unlicensed software to save it.

The uncomfortable truth underneath all of this: at your price point and buyer,
**piracy is not the thing that will kill this product.** Nobody hearing about
it is. Spend the week on distribution, not on DRM.

---

## 5. Where the system is genuinely closed today

Worth naming so it is clear what is already protected, and why those choices
were made:

| Closed | How |
|---|---|
| Admin console | Keys in `LYCEUM_ADMIN_KEYS` (env), never in the database — a leaked DB dump or SQL injection is not an admin takeover. Timing-safe comparison. Actions logged by key fingerprint, never the key. |
| Setup guides | Server-side gate. First step free and genuinely working; the rest needs an active subscription. The client renders what the server sent — it never decides what is unlocked. |
| Device limits | Enforced in `devices.ts` against the subscription's plan, server-side. |
| Waitlist data | Admin-only. The public status endpoint returns a status and nothing else, so nobody can enumerate who applied or from which company. |
| Payment webhook | HMAC-verified with a timing-safe compare. Without it the endpoint would let anyone grant themselves a subscription. |
| License keys | One key, one account — `POST /api/license/activate` refuses a key already claimed elsewhere. |

---

## 6. If you decide to relicense

The mechanical steps, in order:

1. Replace `LICENSE` in both packages with a proprietary license.
2. Add `"private": true` to the packages, or publish only `dist/` via the
   `files` field (already configured).
3. Stop pushing source to a public repository. Keep it private; publish
   releases as built artifacts.
4. Add the license check from Option B to the CLI entry points — a periodic
   check with a generous offline grace period, not per-call.
5. Say the change plainly in the README with a date. Existing MIT versions stay
   MIT; pretending otherwise damages trust with exactly the developers you want
   as customers.

None of this is written yet. It is a decision, not a task — tell me which
option and I will implement it.
