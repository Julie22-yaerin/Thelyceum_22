// The Lyceum — waitlist application form.
//
// Validation is server-authoritative: this file mirrors the field errors the
// server returns rather than re-implementing the rules. Two copies of a
// validation rule drift, and the copy that drifts is always the one users see.

const $ = (s) => document.querySelector(s);

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

function renderApplied({ depositUrl, depositCents }) {
  const dollars = (depositCents / 100).toFixed(0);
  $("#waitlistCard").innerHTML = `
    <div class="waitlist-done">
      <h3>Application received</h3>
      ${
        depositUrl
          ? `<p>
               One step left. The refundable $${dollars} deposit confirms your place —
               it credits against your first invoice, and we refund it on request.
               Until it clears, your application sits as <em>awaiting deposit</em>.
             </p>
             <a class="deposit-cta" href="${depositUrl}">Pay the $${dollars} deposit</a>`
          : `<p>
               We'll be in touch at the address you gave. If you'd like to confirm
               your place with the refundable deposit, reply to our email and we'll
               send a link.
             </p>`
      }
    </div>`;
  $("#waitlistCard").scrollIntoView({ behavior: "smooth", block: "center" });
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
      renderApplied(json);
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

// Launch mode drives the banner and the nav CTA. Read from the server rather
// than hardcoded, so flipping LYCEUM_LAUNCH_MODE=open needs no redeploy of
// the static files.
(async function boot() {
  try {
    const { launchMode } = await (await fetch("/api/plans")).json();
    if (launchMode === "waitlist") {
      $("#launchBanner")?.removeAttribute("hidden");
    } else {
      const cta = $("#navCta");
      if (cta) {
        cta.textContent = "Get started";
        cta.setAttribute("href", "/web/showroom#plans");
      }
    }
  } catch {
    // If this fails the page is still complete and the form still works —
    // the banner is presentation, not a gate. The real gate is server-side.
  }
})();
