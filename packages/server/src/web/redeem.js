// Redeem page — paste a subscription license code, confirm it's valid, and
// hand off to the setup guides. This is a *confirmation* step; the code that
// actually unlocks the local CLI is `node license-activate.mjs <code>`, run
// on the machine that will run brake/redteam/thrift.

const $ = (s) => document.querySelector(s);

$("#redeemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const licenseKey = new FormData(e.target).get("licenseKey").trim();
  const btn = $("#redeemSubmit");
  const errorEl = $("#redeemError");
  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    const res = await fetch("/api/license-pool/enter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseKey }),
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && json.ok) {
      $("#redeemCard").innerHTML = `
        <div class="waitlist-done">
          <h3>Code confirmed</h3>
          <p>Taking you to setup…</p>
        </div>`;
      setTimeout(() => {
        location.href = json.redirectTo || "/web/showroom#guides";
      }, 800);
      return;
    }

    errorEl.textContent = json.message || "That code isn't valid.";
  } catch {
    errorEl.textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock";
  }
});
