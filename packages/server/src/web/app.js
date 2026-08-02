// brake — single-page dashboard
// Vanilla JS. Talks to /api/* on the same origin. Stores the session token
// in localStorage. No build step, no framework.

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const SESSION_KEY = "brake_session";
// A license key entered before the visitor is signed in. Held in
// sessionStorage (not localStorage) so a closed tab forgets it.
const PENDING_KEY = "lyceum_pending_key";
const state = {
  cycle: "monthly",
  user: null,
  sub: null,
  installs: [],
  mode: "signup", // "signup" | "login"
};

// ── API helper ─────────────────────────────────────────────────────────────

function authHeader() {
  const s = localStorage.getItem(SESSION_KEY);
  return s ? { Authorization: `Bearer ${s}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...authHeader(), ...(opts.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || json.error || res.statusText), { status: res.status, body: json });
  return json;
}

// ── Plans render ───────────────────────────────────────────────────────────

function renderPlans() {
  const plansEl = $("#plansGrid");
  if (!plansEl) return; // landing page has no plans grid
  plansEl.innerHTML = "";

  for (const plan of window.__plans) {
    const price = plan.pricesCentsPerMonth[state.cycle];
    const featured = plan.id === "team" ? "featured" : "";
    const ai = plan.aiConnections;
    const cycle = state.cycle === "monthly" ? "/mo" : "/mo";
    const annualNote = state.cycle === "annual"
      ? `Billed annually as $${(plan.pricesCentsPerMonth.annual * 12 / 100).toLocaleString()}`
      : "";
    const el = document.createElement("div");
    el.className = `plan ${featured}`;
    el.innerHTML = `
      <h3>${plan.name}</h3>
      <div class="conn">${ai} AI host connections</div>
      <div class="desc">${plan.description}</div>
      <div class="price">$${(price / 100).toLocaleString()}<small>${cycle}</small></div>
      <div class="annual">${annualNote}</div>
      <ul>${plan.features.map((f) => `<li>${f}</li>`).join("")}</ul>
      <button class="cta" data-plan="${plan.id}">Choose ${plan.name}</button>
    `;
    const btn = el.querySelector("button");
    if (window.__launchMode === "waitlist") {
      // The server refuses checkout before launch, so sending someone there
      // would be a dead end. Point at the thing that does work instead.
      btn.textContent = "Join the waitlist";
      btn.addEventListener("click", () => { window.location.href = "/web/#waitlist"; });
    } else {
      btn.addEventListener("click", () => choosePlan(plan.id));
    }
    plansEl.appendChild(el);
  }

  // Enterprise is a contact card, never a checkout button — a fleet that size
  // needs a conversation about scale and procurement, and putting a number on
  // a button for them is either a lowball or a wrong guess. The server never
  // exposes it as a billable plan; see plans.ts ENTERPRISE_TIER.
  const ent = window.__enterprise;
  if (ent) {
    const el = document.createElement("div");
    el.className = "plan enterprise";
    el.innerHTML = `
      <h3>${ent.name}</h3>
      <div class="conn">Unlimited connections</div>
      <div class="desc">${ent.description}</div>
      <div class="price">Let's talk</div>
      <div class="annual"></div>
      <ul>${ent.features.map((f) => `<li>${f}</li>`).join("")}</ul>
      <button class="cta">Contact us</button>
    `;
    el.querySelector("button").addEventListener("click", () => {
      window.location.href = `mailto:${ent.contactEmail}?subject=${encodeURIComponent("Lyceum Enterprise enquiry")}`;
    });
    plansEl.appendChild(el);
  }
}

async function choosePlan(planId) {
  const session = localStorage.getItem(SESSION_KEY);
  if (!session) {
    state.mode = "signup";
    showAuth();
    $("#authTitle").textContent = "Create an account to subscribe";
    $("#authSubmit").textContent = "Create account & continue";
    return;
  }
  const { url, devMode } = await api("/api/subscription/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: planId, billing: state.cycle }),
  });
  if (devMode) {
    // In dev mode, the URL is a local activation endpoint — follow it.
    window.location.href = url;
  } else {
    window.location.href = url;
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────

function showAuth() {
  const auth = $("#auth");
  auth.classList.remove("hidden");
  auth.setAttribute("aria-hidden", "false");
  auth.scrollIntoView({ behavior: "smooth" });
}
function hideAuth() {
  const auth = $("#auth");
  auth.classList.add("hidden");
  auth.setAttribute("aria-hidden", "true");
}

$("#authSwitch").addEventListener("click", (e) => {
  e.preventDefault();
  state.mode = state.mode === "signup" ? "login" : "signup";
  $("#authTitle").textContent = state.mode === "signup" ? "Create your account" : "Sign in";
  $("#authSubmit").textContent = state.mode === "signup" ? "Create account" : "Sign in";
  $("#authSwitch").textContent = state.mode === "signup" ? "I already have an account" : "Create an account";
  $("#authError").textContent = "";
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const body = { email: form.get("email"), password: form.get("password") };
  $("#authError").textContent = "";
  try {
    const path = state.mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const res = await api(path, { method: "POST", body: JSON.stringify(body) });
    localStorage.setItem(SESSION_KEY, res.sessionToken);
    hideAuth();
    // enterLicense's needsAccount branch checks state.user to decide whether
    // to show a message or the auth card — so the session must be recorded
    // before the pending-key re-run below, or a different-account key would
    // bounce back to the login form the user just left.
    state.user = res.user;
    // If they entered a license key before signing in, re-enter it now that
    // a session exists — the server's session branch attaches it to the
    // account that actually owns the payment (which may not be the account
    // they just created). The key is what they came to use.
    const pending = sessionStorage.getItem(PENDING_KEY);
    if (pending) {
      sessionStorage.removeItem(PENDING_KEY);
      await enterLicense(pending, $("#licenseMsg"));
      return;
    }
    await loadDashboard();
  } catch (err) {
    $("#authError").textContent = err.message || "something went wrong";
  }
});

$("#navLogin").addEventListener("click", (e) => {
  e.preventDefault();
  if (state.user) {
    $("#dashboard").scrollIntoView({ behavior: "smooth" });
  } else {
    state.mode = "login";
    $("#authTitle").textContent = "Sign in";
    $("#authSubmit").textContent = "Sign in";
    $("#authSwitch").textContent = "Create an account";
    showAuth();
  }
});

// ── Dashboard ──────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.sub = me.subscription;
    state.installs = me.installs;
    state.usage = me.usage;
    renderDashboard();
  } catch (err) {
    if (err.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      showAuth();
    } else {
      console.error(err);
    }
  }
}

function renderDashboard() {
  $("#auth").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#locked").classList.add("hidden");
  $("#navLogin").textContent = state.user.email;

  $("#dashEmail").textContent = state.user.email;

  // The trial-redeem box is for accounts with no commercial relationship yet:
  // the server refuses a trial once ANY subscription row exists (has_subscription
  // 409 — including a locked/expired trial, so it must not be offered again).
  const trialBox = $("#trialRedeem");
  if (trialBox) {
    trialBox.classList.toggle("hidden", !!state.sub);
  }

  // The paid-key box is the mirror image: an active subscription whose key
  // hasn't been attached yet (payment landed, email went out, paste pending).
  const licenseRedeem = $("#licenseRedeem");
  if (licenseRedeem) {
    licenseRedeem.classList.toggle(
      "hidden",
      !(state.sub && state.sub.status === "active" && !state.sub.license_key)
    );
  }

  // Licensed but nothing installed → the next step is the setup guide, not
  // the dashboard. Toggled here so it also appears for a plain login on a
  // fresh account, not only for a just-entered key.
  const setupBanner = $("#setupBanner");
  if (setupBanner) {
    const licensed = !!(state.sub && state.sub.status === "active");
    setupBanner.classList.toggle("hidden", !(licensed && state.installs.length === 0));
  }

  if (!state.sub) {
    $("#locked").classList.remove("hidden");
    $("#lockedReason").textContent = "You don't have a subscription yet. Pick a plan above, or redeem a trial key below.";
    $("#btnRenew").textContent = "Pick a plan";
    $("#btnRenew").onclick = () => $("#plans").scrollIntoView({ behavior: "smooth" });
    $("#subBox").innerHTML = "<p class='muted'>No subscription yet.</p>";
    return;
  }

  const plan = window.__plans.find((p) => p.id === state.sub.plan);
  $("#subPlan").textContent = plan.name;
  $("#subBilling").textContent = state.sub.billing;
  const status = state.sub.status;
  const badge = $("#subStatus");
  badge.textContent = status;
  badge.className = "badge " + status;
  $("#subExpires").textContent = new Date(state.sub.expires_at).toLocaleString();

  const ar = $("#autoRenew");
  ar.checked = state.sub.auto_renew === 1;
  ar.disabled = false;
  ar.onchange = async () => {
    await api("/api/subscription/auto-renew", { method: "POST", body: JSON.stringify({ enabled: ar.checked }) });
    await loadDashboard();
  };

  if (status === "locked") {
    $("#subWarning").textContent = "Auto-renew is off and the subscription has expired. Click Renew to restart.";
    $("#btnRenew").textContent = "Renew subscription";
    $("#btnRenew").onclick = () => $("#plans").scrollIntoView({ behavior: "smooth" });
  } else if (state.sub.auto_renew === 0) {
    $("#subWarning").textContent = "Auto-renew is off. The subscription will lock when it expires.";
  } else {
    $("#subWarning").textContent = "";
  }

  $("#connCount").textContent = `${state.installs.length}/${plan.aiConnections}`;
  const list = $("#installsList");
  list.innerHTML = "";
  for (const i of state.installs) {
    const li = document.createElement("li");
    const last = new Date(i.last_seen_at).toLocaleString();
    li.innerHTML = `
      <div>
        <div class="host">${i.host_type}</div>
        <div class="device">${i.device_id.slice(0, 16)}${i.device_id.length > 16 ? "…" : ""}</div>
      </div>
      <div>
        <div class="seen">${last}</div>
        <button data-id="${i.id}" title="Remove">×</button>
      </div>
    `;
    li.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`Remove ${i.host_type} install?`)) return;
      await api(`/api/installs/${i.id}`, { method: "DELETE" });
      await loadDashboard();
    });
    list.appendChild(li);
  }
  if (state.installs.length === 0) {
    list.innerHTML = "<li class='muted' style='background:transparent;border:1px dashed var(--border);'>No installs yet. Run <code>brake install &lt;host&gt;</code> in your terminal.</li>";
  }

  // Monthly token budget — what the CLIs reported this month vs the plan's
  // budget. Rendered from /api/me → usage.budget. Null budget = no plan yet.
  renderBudget();

  // Download CLI
  const dlBtn = $("#btnDownload");
  dlBtn.disabled = status !== "active";
  dlBtn.textContent = status === "active" ? "Download brake CLI" : "Subscription required";
  dlBtn.onclick = async () => {
    const res = await fetch("/download/cli", { headers: { Authorization: `Bearer ${localStorage.getItem(SESSION_KEY)}` } });
    if (!res.ok) { alert("Download failed: " + (await res.text())); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "brake-cli.tar.gz";
    a.click();
  };
  $("#installCmd").textContent = "# After download:\ntar -xzf brake-cli.tar.gz\ncd brake\nnpm install -g .";
}

$("#btnLogout").addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  location.reload();
});

// ── License key entry ──────────────────────────────────────────────────────
// The front door for a customer who just paid: the key Lemon Squeezy emailed
// them is the credential. The server answers with where they should go — the
// setup guide if nothing is installed yet, the dashboard if the CLI is wired
// up. The client never decides what's unlocked; it just follows the route.

// The license form can be submitted before boot's /api/plans fetch resolves.
// renderDashboard reads window.__plans, so make sure it exists first.
async function ensurePlans() {
  if (window.__plans) return;
  const { plans, enterprise, launchMode } = await api("/api/plans");
  window.__plans = plans;
  window.__enterprise = enterprise;
  window.__launchMode = launchMode;
  renderPlans();
}

function routeAfterEnter(route) {
  if (route === "setup") {
    const banner = $("#setupBanner");
    if (banner) banner.removeAttribute("hidden");
    document.querySelector("#guides")?.scrollIntoView({ behavior: "smooth" });
  } else {
    document.querySelector("#dashboard")?.scrollIntoView({ behavior: "smooth" });
  }
}

async function enterLicense(key, msgEl) {
  if (msgEl) msgEl.textContent = "";
  if (!key) {
    if (msgEl) msgEl.textContent = "Paste the license key you received by email.";
    return;
  }
  try {
    const r = await api("/api/license/enter", { method: "POST", body: JSON.stringify({ licenseKey: key }) });
    if (r.needsAccount) {
      // Valid payment, but the server can't attach it to an account on this
      // browser — the subscription lives on the account that checked out,
      // which may not be the one signed in here.
      sessionStorage.setItem(PENDING_KEY, key);
      if (state.user) {
        // Already signed in and the key still won't attach to THIS account.
        if (msgEl) msgEl.textContent = r.message || "We couldn't attach that key to this account.";
        return;
      }
      // Not signed in: prefill the email the payment was made under and ask
      // them to sign in with the account that paid.
      const emailField = document.querySelector('#authForm input[name="email"]');
      if (emailField && r.email) emailField.value = r.email;
      state.mode = "login";
      $("#authTitle").textContent = "Sign in to attach your license";
      $("#authSubmit").textContent = "Sign in";
      $("#authSwitch").textContent = "Create an account";
      if (msgEl) msgEl.textContent = r.message || "Sign in with the account that paid to continue.";
      showAuth();
      return;
    }
    localStorage.setItem(SESSION_KEY, r.sessionToken);
    state.user = r.user;
    state.sub = r.subscription;
    state.installs = r.installs;
    state.usage = r.usage;
    const input = $("#licenseKeyInput");
    if (input) input.value = "";
    await ensurePlans();
    renderDashboard();
    routeAfterEnter(r.route);
  } catch (err) {
    if (msgEl) msgEl.textContent = err.message || "Could not validate that key.";
  }
}

$("#licenseForm").addEventListener("submit", (e) => {
  e.preventDefault();
  enterLicense($("#licenseKeyInput").value.trim(), $("#licenseMsg"));
});

$("#btnLicenseRedeem").addEventListener("click", async () => {
  const key = $("#licenseRedeemInput").value.trim();
  const msg = $("#licenseRedeemMsg");
  msg.textContent = "";
  if (!key) {
    msg.textContent = "Paste the license key you received by email.";
    return;
  }
  try {
    const r = await api("/api/license/activate", { method: "POST", body: JSON.stringify({ licenseKey: key }) });
    msg.textContent = `License attached — ${r.licenseKey.slice(0, 8)}…`;
    await loadDashboard();
  } catch (err) {
    msg.textContent = err.message || "Could not attach that key.";
  }
});

// ── Budget ──────────────────────────────────────────────────────────────────
// The dashboard's budget box: used tokens vs this month's plan budget, with a
// warn/over threshold from the server (BUDGET_WARN_PCT). All numbers come
// from /api/me → usage; the client renders, never decides.

function fmtTokens(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function renderBudget() {
  const box = $("#budgetBox");
  if (!box) return;
  const usage = state.usage;
  if (!usage || !usage.budget) {
    // No plan to budget against — hide the card entirely rather than show
    // an empty bar that reads as "zero used" when there is no budget.
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");

  const b = usage.budget;
  const pct = Math.min(b.pct * 100, 999);
  const badge = $("#budgetBadge");
  badge.textContent = b.status === "over" ? "over budget" : b.status === "warn" ? "approaching limit" : "on track";
  badge.className = "badge " + b.status;

  const fill = $("#budgetFill");
  fill.style.width = `${Math.min(pct, 100)}%`;
  fill.className = "budget-fill " + b.status;

  $("#budgetLine").textContent =
    `${fmtTokens(b.usedTokens)} of ${fmtTokens(b.budgetTokens)} tokens used this month (${pct.toFixed(1)}%)`;

  const warning = $("#budgetWarning");
  if (b.status === "over") {
    warning.hidden = false;
    warning.textContent = `You've exceeded this month's token budget by ${fmtTokens(b.usedTokens - b.budgetTokens)}. ` +
      "The tools keep working — this is a flag, not a brake. Check what changed, or move up a tier.";
  } else if (b.status === "warn") {
    warning.hidden = false;
    warning.textContent = `You're at ${pct.toFixed(1)}% of this month's budget with ${fmtTokens(b.remainingTokens)} tokens left. ` +
      "Past 100% the dashboard flags over budget, so plan ahead if this pace continues.";
  } else {
    warning.hidden = true;
  }

  // Per-tool breakdown — which tool is driving the number.
  const tools = $("#budgetTools");
  tools.innerHTML = "";
  const rows = [
    ["brake", "danger scans", usage.byTool.brake],
    ["redteam", "reasoning checks", usage.byTool.redteam],
    ["thrift", "token compression", usage.byTool.thrift],
  ];
  for (const [tool, label, t] of rows) {
    const el = document.createElement("div");
    el.className = "budget-tool";
    el.innerHTML = `
      <span class="budget-tool-name"><span class="dot ${tool === "thrift" ? "amber" : tool}"></span> ${label}</span>
      <span class="budget-tool-nums">${fmtTokens(t.tokens)} tokens · ${t.calls.toLocaleString()} calls</span>
    `;
    tools.appendChild(el);
  }
}

// ── Trial redemption ────────────────────────────────────────────────────────

$("#btnTrialRedeem").addEventListener("click", async () => {
  const token = $("#trialKeyInput").value.trim();
  const msg = $("#trialMsg");
  msg.textContent = "";
  if (!token) {
    msg.textContent = "Paste the trial key you received by email.";
    return;
  }
  try {
    const r = await api("/api/trial/activate", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    $("#trialKeyInput").value = "";
    msg.textContent = `Trial active — ${r.plan} plan, ${r.connectionLimit} connections, until ${new Date(r.expiresAt).toLocaleDateString()}.`;
    await loadDashboard();
  } catch (err) {
    msg.textContent = err.message || "Could not activate the trial.";
  }
});

// ── Billing toggle ─────────────────────────────────────────────────────────

$$(".billing-toggle .bt").forEach((b) => {
  b.addEventListener("click", () => {
    $$(".billing-toggle .bt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.cycle = b.dataset.cycle;
    renderPlans();
  });
});

// ── Guides ─────────────────────────────────────────────────────────────────
// /api/guides/:product is public-reachable (see index.ts's auth-bypass list)
// and does its own gating server-side: redteam always returns the full guide,
// brake returns the first step only unless the Bearer token belongs to an
// active subscription. The client never decides what's unlocked — it just
// renders what the server was willing to send.

async function loadGuide(product) {
  const body = $("#guideBody");
  body.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const headers = authHeader();
    const res = await fetch(`/api/guides/${product}`, { headers });
    const data = await res.json();
    renderGuide(data);
  } catch (err) {
    body.innerHTML = "<p class='muted'>Could not load the guide. Is the server running?</p>";
  }
}

function renderGuide(data) {
  const body = $("#guideBody");
  const { guide, unlocked, reason } = data;
  body.innerHTML = "";

  const intro = document.createElement("p");
  intro.className = "guide-intro";
  intro.textContent = guide.intro;
  body.appendChild(intro);

  const list = document.createElement("ol");
  list.className = "guide-steps";
  for (const step of guide.steps) {
    const li = document.createElement("li");
    li.innerHTML = `
      <h4>${step.title}</h4>
      ${step.command ? `<pre class="cmd-block"><code>${escapeHtml(step.command)}</code></pre>` : ""}
      ${step.expect ? `<p class="expect"><strong>Expect:</strong> ${escapeHtml(step.expect)}</p>` : ""}
      <p class="detail">${escapeHtml(step.detail)}</p>
    `;
    list.appendChild(li);
  }
  body.appendChild(list);

  if (!unlocked) {
    const gate = document.createElement("div");
    gate.className = "guide-locked";
    const msg = reason === "subscription_required"
      ? "That's the free step. The rest of brake's setup unlocks with an active subscription."
      : "That's the free step. Sign in (or create an account) to unlock the rest after subscribing.";
    gate.innerHTML = `
      <p>${msg}</p>
      <button id="guideUnlockBtn">${reason === "subscription_required" ? "See pricing" : "Sign in"}</button>
    `;
    gate.querySelector("button").addEventListener("click", () => {
      if (reason === "subscription_required") {
        $("#plans").scrollIntoView({ behavior: "smooth" });
      } else {
        state.mode = "signup";
        showAuth();
      }
    });
    body.appendChild(gate);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

$$(".guide-tabs .gt").forEach((b) => {
  b.addEventListener("click", () => {
    $$(".guide-tabs .gt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    loadGuide(b.dataset.product);
  });
});

// ── Boot ───────────────────────────────────────────────────────────────────

(async function boot() {
  try {
    const { plans, enterprise, launchMode } = await api("/api/plans");
    window.__plans = plans;
    window.__enterprise = enterprise;
    window.__launchMode = launchMode;
    renderPlans();
    if (launchMode === "waitlist") {
      document.querySelector("#launchBanner")?.removeAttribute("hidden");
    }
  } catch (err) {
    const grid = document.querySelector("#plansGrid");
    if (grid) grid.innerHTML = "<p class='muted'>Could not load plans. Is the server running?</p>";
  }
  if (localStorage.getItem(SESSION_KEY)) {
    await loadDashboard();
  }

  // Deep links:
  //   ?license=KEY       key pasted on the landing page; enter it here
  //   ?checkout=success  Lemon Squeezy redirected back after payment
  const params = new URLSearchParams(location.search);
  const licenseParam = params.get("license");
  // The landing page hands the key over in sessionStorage (not the URL — it
  // is a credential; see the admin console's stance on never writing keys).
  // ?license= remains for direct deep links, and wins over a stale stored
  // key when both exist.
  const storedKey = sessionStorage.getItem("lyceum_entered_key");
  const handoffKey = licenseParam ?? storedKey;
  if (handoffKey) {
    sessionStorage.removeItem("lyceum_entered_key");
    // Don't leave a credential in the address bar after a deep-link entry.
    if (licenseParam) history.replaceState({}, "", location.pathname);
    const input = $("#licenseKeyInput");
    if (input) input.value = handoffKey;
    await enterLicense(handoffKey, $("#licenseMsg"));
  }
  const checkout = params.get("checkout");
  if (checkout === "success") {
    const notice = $("#checkoutNotice");
    if (notice) {
      notice.removeAttribute("hidden");
      notice.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // Matches the showroom's default active tab.
  await loadGuide("brake");
})();
