// Account page — three views, one card.
//
//   1. No key stored locally           → entry form
//   2. Key stored, never checked in    → paginated quickstart wizard
//   3. Key stored, checked in          → status + cancel/upgrade dashboard
//
// "Checked in" means a real CLI (brake/redteam/thrift's gate.ts) has called
// /api/license-pool/validate at least once — not just that this page
// confirmed the code. That distinction is what /enter vs /validate exists
// for server-side; see index.ts.

const $ = (s) => document.querySelector(s);
const KEY_STORE = "lyceum_license_key";
const card = $("#redeemCard");

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

// ── View 1: entry form ──────────────────────────────────────────────────

const CODE_LENGTH = 8;

function renderEntryForm(errorMessage) {
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => `
    <input class="otp-cell" type="text" inputmode="text" maxlength="1"
      autocomplete="off" spellcheck="false" data-index="${i}" aria-label="Character ${i + 1}" />`
  ).join("");

  card.innerHTML = `
    <h2>Enter your license code</h2>
    <p class="sub">
      Your code was emailed to you from <strong>yris22@thelyceum.site</strong> —
      check your inbox (and spam) for it. One code unlocks brake, redteam,
      and thrift.
    </p>
    <form class="waitlist-form" id="redeemForm" novalidate>
      <div class="otp-input" id="otpInput">${cells}</div>
      <button type="submit" id="redeemSubmit">Unlock</button>
      <p class="field-error" id="redeemError" style="text-align:center;">${esc(errorMessage ?? "")}</p>
    </form>`;

  const otpWrap = $("#otpInput");
  const otpCells = Array.from(otpWrap.querySelectorAll(".otp-cell"));

  function currentCode() {
    return otpCells.map((c) => c.value).join("");
  }

  function focusCell(i) {
    otpCells[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();
  }

  otpCells.forEach((cell, i) => {
    cell.addEventListener("input", () => {
      cell.value = cell.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);
      otpWrap.classList.remove("error");
      if (cell.value && i < CODE_LENGTH - 1) focusCell(i + 1);
    });
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !cell.value && i > 0) focusCell(i - 1);
      else if (e.key === "ArrowLeft") focusCell(i - 1);
      else if (e.key === "ArrowRight") focusCell(i + 1);
    });
    cell.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData("text") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!text) return;
      text.split("").slice(0, CODE_LENGTH - i).forEach((ch, j) => {
        if (otpCells[i + j]) otpCells[i + j].value = ch;
      });
      focusCell(Math.min(i + text.length, CODE_LENGTH - 1));
    });
  });

  if (errorMessage) otpWrap.classList.add("error");
  focusCell(0);

  $("#redeemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const licenseKey = currentCode();
    if (licenseKey.length < CODE_LENGTH) {
      otpWrap.classList.add("error");
      $("#redeemError").textContent = "Enter all 8 characters.";
      focusCell(otpCells.findIndex((c) => !c.value));
      return;
    }
    const btn = $("#redeemSubmit");
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
        otpWrap.classList.remove("error");
        otpWrap.classList.add("success");
        localStorage.setItem(KEY_STORE, licenseKey);
        await boot();
        return;
      }
      renderEntryForm(json.message || "That code isn't valid.");
    } catch {
      renderEntryForm("Couldn't reach the server. Check your connection and try again.");
    }
  });
}

// ── View 2: quickstart wizard (2-3 steps per page) ──────────────────────

function quickstartPages(licenseKey) {
  return [
    {
      title: "1. Install & Activate",
      steps: [
        {
          heading: "Step 1: Install from any blank terminal",
          body: `<p style="margin-bottom:6px;">Run in a blank terminal (no repository clone or cd needed):</p>
                 <pre><code>npm install -g the-lyceum</code></pre>
                 <p style="margin-top:6px;">Verify installation: <code>brake --version</code>, <code>redteam --version</code>, <code>thrift --version</code>.</p>`,
        },
        {
          heading: "Step 2: Activate your license key",
          body: `<pre><code>brake activate ${esc(licenseKey)}</code></pre>
                 <p style="margin-top:6px;">Your license key: <code style="color:var(--green); font-weight:600;">${esc(licenseKey)}</code>. Writes <code>~/.lyceum/license.json</code> — one activation unlocks <strong>brake</strong>, <strong>redteam</strong>, and <strong>thrift</strong>, since all three read the same file.</p>`,
        },
      ],
    },
    {
      title: "2. Wire Hosts & Verify",
      steps: [
        {
          heading: "Step 3: Wire into your AI Hosts",
          body: `<pre><code>brake install all
redteam install all
thrift install all</code></pre>
                 <p style="margin-top:6px;">Configures Claude Desktop, Claude Code, and ChatGPT. The models execute the guards on the hot path automatically.</p>`,
        },
        {
          heading: "Step 4: Verify protection & measure token savings",
          body: `<pre><code>brake scan "rm -rf /var/db/production"
thrift measure . --passes 5</code></pre>
                 <p style="margin-top:6px;"><code>brake scan</code> blocks dangerous actions. <code>thrift measure</code> reports token savings and renders the Before & After visual chart.</p>`,
        },
      ],
    },
  ];
}

let quickstartPage = 0;

function renderQuickstart() {
  const licenseKey = localStorage.getItem(KEY_STORE) ?? "ABCD2345";
  const pages = quickstartPages(licenseKey);
  const page = pages[quickstartPage];
  const isLast = quickstartPage === pages.length - 1;

  card.innerHTML = `
    <h2>Quickstart — ${esc(page.title)}</h2>
    <p class="sub">Step ${quickstartPage + 1} of ${pages.length}. Two or three steps per page, on purpose.</p>
    ${page.steps
      .map(
        (s, i) => `
      <div class="stake-card money" style="margin-bottom:16px;">
        <span class="stake-tag">Step ${quickstartPage * 2 + i + 1}</span>
        <h3>${esc(s.heading)}</h3>
        <div class="stake-line" style="white-space:normal;">${s.body}</div>
      </div>`
      )
      .join("")}
    <div style="display:flex;gap:10px;margin-top:8px;">
      ${quickstartPage > 0 ? `<button type="button" id="qsBack" class="mini">Back</button>` : ""}
      ${
        !isLast
          ? `<button type="button" id="qsNext" style="flex:1;">Next</button>`
          : `<button type="button" id="qsCheck" style="flex:1;">I've done this — check status</button>`
      }
    </div>
    <p class="field-error" id="qsError" style="text-align:center;"></p>`;

  $("#qsBack")?.addEventListener("click", () => {
    quickstartPage--;
    renderQuickstart();
  });
  $("#qsNext")?.addEventListener("click", () => {
    quickstartPage++;
    renderQuickstart();
  });
  $("#qsCheck")?.addEventListener("click", async () => {
    const btn = $("#qsCheck");
    btn.disabled = true;
    btn.textContent = "Checking…";
    const status = await fetchStatus();
    if (status?.firstCheckinAt) {
      renderDashboard(status);
    } else {
      $("#qsError").textContent =
        "No check-in from the CLI yet — run one of the commands above (e.g. brake scan) and try again.";
      btn.disabled = false;
      btn.textContent = "I've done this — check status";
    }
  });
}

// ── View 3: dashboard ────────────────────────────────────────────────────

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function renderDashboard(status) {
  const daysLeft = Math.max(0, Math.ceil(status.daysRemaining));
  const isTrial = status.tier === "trial";
  card.innerHTML = `
    <h2>Your license</h2>
    <div class="admin-counts" style="margin-bottom:20px;">
      <div class="admin-count highlight">
        <div class="n">${daysLeft}</div>
        <div class="l">days left</div>
      </div>
    </div>
    <p class="sub">
      ${isTrial ? "Free trial. " : "Active. "}Renews or expires ${esc(fmtDate(status.expiresAt))}.
    </p>

    <div style="display:flex; flex-direction:column; gap:12px; margin-top:16px;">
      ${
        isTrial
          ? `<a href="/web/pricing" style="display:block;"><button type="button" style="width:100%;">View pricing &amp; upgrade</button></a>
             <p class="sub" style="font-size:12.5px; text-align:center; margin:0;">
               Trial keys don't self-extend — upgrading to a paid plan is what unlocks that.
             </p>`
          : `<div>
               <label style="display:block; font-size:13px; color:var(--text-dim); font-weight:500; margin-bottom:6px;">
                 Extend by (months)
               </label>
               <div style="display:flex; gap:8px;">
                 <input type="number" id="upgradeMonths" min="1" value="1" style="width:80px; padding:10px 12px; border:1px solid var(--border-strong); border-radius:8px; background:var(--bg); color:var(--text); font-family:inherit;" />
                 <button type="button" id="upgradeBtn" style="flex:1;">Upgrade</button>
               </div>
             </div>
             <button type="button" id="yearlyBtn" class="mini">Switch to yearly (12 months)</button>`
      }
      <button type="button" id="cancelBtn" class="mini reject">Cancel ${isTrial ? "trial" : "subscription"}</button>
    </div>
    <p class="field-error" id="dashError" style="text-align:center;"></p>`;

  $("#upgradeBtn")?.addEventListener("click", () => doUpgrade(Number($("#upgradeMonths").value)));
  $("#yearlyBtn")?.addEventListener("click", () => doUpgrade(12));
  $("#cancelBtn").addEventListener("click", async () => {
    if (!confirm("Cancel your subscription? Your code stops working immediately.")) return;
    const licenseKey = localStorage.getItem(KEY_STORE);
    try {
      await fetch("/api/license-pool/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licenseKey }),
      });
    } catch {
      // Fall through regardless — the code is treated as done with locally either way.
    }
    localStorage.removeItem(KEY_STORE);
    renderEntryForm("Subscription cancelled. Enter a new code any time.");
  });
}

async function doUpgrade(months) {
  const errorEl = $("#dashError");
  errorEl.textContent = "";
  if (!(months > 0)) {
    errorEl.textContent = "Enter a positive number of months.";
    return;
  }
  const licenseKey = localStorage.getItem(KEY_STORE);
  try {
    const res = await fetch("/api/license-pool/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseKey, months }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      errorEl.textContent = json.message || "Could not upgrade.";
      return;
    }
    const status = await fetchStatus();
    renderDashboard(status);
  } catch {
    errorEl.textContent = "Couldn't reach the server. Try again.";
  }
}

// ── Boot: decide which view ──────────────────────────────────────────────

async function fetchStatus() {
  const licenseKey = localStorage.getItem(KEY_STORE);
  if (!licenseKey) return null;
  try {
    const res = await fetch("/api/license-pool/enter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseKey }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const wasExpired = json.error === "expired";
      // An expired code stops working, but the pool row (and its history)
      // survives until an admin/cancel clears it — losing the local key
      // here would strand a returning user with no way to say "yes, this
      // one, I want to upgrade it" without re-pasting the code by hand.
      if (!wasExpired) localStorage.removeItem(KEY_STORE);
      return { invalid: true, expired: wasExpired, message: json.message };
    }
    return json;
  } catch {
    return { networkError: true };
  }
}

// ── View: expired ─────────────────────────────────────────────────────────

function renderExpired(message) {
  card.innerHTML = `
    <h2>Your license expired</h2>
    <p class="sub">${esc(message ?? "This code is no longer active.")}</p>
    <a href="/web/pricing" style="display:block;">
      <button type="button" style="width:100%;">View pricing &amp; upgrade</button>
    </a>
    <button type="button" id="expiredNewCode" class="mini" style="width:100%; margin-top:10px;">
      Use a different code instead
    </button>`;

  $("#expiredNewCode").addEventListener("click", () => {
    localStorage.removeItem(KEY_STORE);
    renderEntryForm();
  });
}

async function boot() {
  const status = await fetchStatus();
  if (!status) {
    renderEntryForm();
  } else if (status.networkError) {
    card.innerHTML = `<p class="field-error" style="text-align:center;">Couldn't reach the server. Refresh to try again.</p>`;
  } else if (status.invalid && status.expired) {
    renderExpired(status.message);
  } else if (status.invalid) {
    renderEntryForm(status.message || "Your code is no longer valid. Enter a new one.");
  } else if (status.firstCheckinAt) {
    renderDashboard(status);
  } else {
    quickstartPage = 0;
    renderQuickstart();
  }
}

void boot();
