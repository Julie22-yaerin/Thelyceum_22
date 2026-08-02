// The Lyceum — waitlist application form.
//
// Validation is server-authoritative: this file mirrors the field errors the
// server returns rather than re-implementing the rules. Two copies of a
// validation rule drift, and the copy that drifts is always the one users see.

const $ = (s) => document.querySelector(s);

// The fixed Lemon Squeezy checkout for the waitlist deposit. A literal
// constant, not server-computed: the operator gave us this exact link to
// use, and the corresponding LS_VARIANT_WAITLIST_DEPOSIT env var needs to
// point at the same store/variant so the webhook recognises the payment and
// moves the application from pending to paid — that pairing lives in
// deployment config, not in this file.
const LEMONSQUEEZY_CHECKOUT_URL =
  "https://lyceum.lemonsqueezy.com/checkout/buy/1af94135-de0b-4aab-be65-cd460325624b?embed=1";

function clearErrors() {
  for (const el of document.querySelectorAll(".field-error")) el.textContent = "";
}

function showFieldErrors(errors) {
  clearErrors();
  for (const e of errors) {
    const el = document.querySelector(`.field-error[data-for="${e.field}"]`);
    if (el) el.textContent = e.message;
    else $("#waitlistError").textContent = e.message;
  }
  // Put the first problem on screen. A form that reports an error above the
  // fold while the user is looking below it reads as "nothing happened".
  const first = document.querySelector(".field-error:not(:empty)");
  first?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Append `redirect_url` so Lemon Squeezy sends the customer to our own
 * thank-you page after payment instead of its default receipt screen. This
 * is the documented query-param mechanism for a hosted checkout link; if the
 * store's own checkout builder has a Redirect URL configured, that setting
 * wins — confirm the two agree rather than assuming this param is enough.
 */
function checkoutUrlWithRedirect() {
  const thankYou = new URL("/web/thank-you", window.location.origin).toString();
  const url = new URL(LEMONSQUEEZY_CHECKOUT_URL);
  url.searchParams.set("redirect_url", thankYou);
  return url.toString();
}

function renderApplied() {
  $("#waitlistCard").innerHTML = `
    <div class="waitlist-done">
      <h3>Application received</h3>
      <p>
        One step left. The <strong>non-refundable $50 fee</strong> confirms your
        place in the batch — it credits in full against your first invoice.
        Until it clears, your application sits as <em>awaiting payment</em>.
      </p>
      <a href="${checkoutUrlWithRedirect()}" class="lemonsqueezy-button deposit-cta">Buy Pre-order for early access</a>
    </div>`;
  $("#waitlistCard").scrollIntoView({ behavior: "smooth", block: "center" });
  // lemon.js binds its overlay click handler to `.lemonsqueezy-button`
  // elements present at load. This button is inserted after that, so it has
  // to be re-scanned — `createLemonSqueezy()` is the function lemon.js
  // exposes for exactly this (dynamically-rendered buttons). Guarded because
  // the script loads with `defer` and, on a very slow connection, could
  // theoretically still be pending when a fast typist submits the form.
  if (typeof window.createLemonSqueezy === "function") {
    window.createLemonSqueezy();
  } else {
    window.addEventListener("load", () => window.createLemonSqueezy?.(), { once: true });
  }
}

function renderFull() {
  $("#waitlistCard").innerHTML = `
    <div class="waitlist-full">
      <h3>The waitlist is full</h3>
      <p>
        50 is the batch size we can actually onboard by hand. Email us directly
        if you want to be first in line the next time a spot opens.
      </p>
    </div>`;
}

$("#waitlistForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();
  $("#waitlistError").textContent = "";

  const form = new FormData(e.target);
  const body = {
    name: form.get("name"),
    organisation: form.get("organisation"),
    workEmail: form.get("workEmail"),
    phone: form.get("phone"),
    fleetSize: form.get("fleetSize") || undefined,
    note: form.get("note") || undefined,
  };

  const btn = $("#waitlistSubmit");
  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      renderApplied();
      return;
    }
    // The list can fill between page load and submit — a second person's
    // click can land in the gap. Treat it the same as arriving already full.
    if (res.status === 403 && json.error === "waitlist_full") {
      renderFull();
      return;
    }
    if (json.errors) {
      showFieldErrors(json.errors);
    } else {
      $("#waitlistError").textContent = json.message || "Something went wrong. Please try again.";
    }
  } catch {
    $("#waitlistError").textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Apply";
  }
});

// Launch mode drives the banner and the nav CTA; waitlist availability drives
// the spots-left line and, once full, replaces the form outright rather than
// letting someone fill it out only to be refused on submit.
(async function boot() {
  try {
    const { launchMode, waitlistAvailability } = await (await fetch("/api/plans")).json();
    if (launchMode === "waitlist") {
      $("#launchBanner")?.removeAttribute("hidden");
    } else {
      const cta = $("#navCta");
      if (cta) {
        cta.textContent = "Get started";
        cta.setAttribute("href", "/web/showroom#plans");
      }
    }

    if (waitlistAvailability) {
      const { taken, max, full } = waitlistAvailability;
      if (full) {
        renderFull();
      } else {
        const spots = document.createElement("p");
        spots.className = "waitlist-spots";
        spots.innerHTML = `<strong>${max - taken}</strong> of ${max} spots left`;
        $("#waitlistForm")?.insertAdjacentElement("beforebegin", spots);
      }
    }
  } catch {
    // If this fails the page is still complete and the form still works —
    // the banner and spot count are presentation, not the gate. The real
    // gate is server-side, in /api/waitlist itself.
  }
})();
