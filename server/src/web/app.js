// brake — single-page dashboard
// Vanilla JS. Talks to /api/* on the same origin. Stores the session token
// in localStorage. No build step, no framework.

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const SESSION_KEY = "brake_session";
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
    el.querySelector("button").addEventListener("click", () => choosePlan(plan.id));
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
  $("#auth").classList.remove("hidden");
  $("#auth").scrollIntoView({ behavior: "smooth" });
}
function hideAuth() { $("#auth").classList.add("hidden"); }

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

  if (!state.sub) {
    $("#locked").classList.remove("hidden");
    $("#lockedReason").textContent = "You don't have a subscription yet. Pick a plan above.";
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
    const { plans, enterprise } = await api("/api/plans");
    window.__plans = plans;
    window.__enterprise = enterprise;
    renderPlans();
  } catch (err) {
    const grid = document.querySelector("#plansGrid");
    if (grid) grid.innerHTML = "<p class='muted'>Could not load plans. Is the server running?</p>";
  }
  if (localStorage.getItem(SESSION_KEY)) {
    await loadDashboard();
  }
  // Matches the showroom's default active tab.
  await loadGuide("brake");
})();
