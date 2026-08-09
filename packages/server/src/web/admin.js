// The Lyceum — admin console.
//
// The key lives in sessionStorage, not localStorage: it clears when the tab
// closes, which is the right lifetime for a credential that also happens to be
// a license key. Nothing here caches waitlist data — every render is a fresh
// read, because a stale approval state on this screen is exactly the kind of
// thing that leads to approving someone twice.

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const KEY_STORE = "lyceum_admin_key";
const state = { key: null, filter: "" };

function authHeaders() {
  return { Authorization: `Bearer ${state.key}`, "Content-Type": "application/json" };
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || json.error || res.statusText), { status: res.status });
  return json;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

const STATUS_LABEL = {
  pending: "Awaiting deposit",
  paid: "Ready to review",
  approved: "Approved",
  rejected: "Rejected",
};

// ── Gate ───────────────────────────────────────────────────────────────────

$("#adminForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = new FormData(e.target).get("key").trim();
  $("#adminError").textContent = "";
  state.key = key;
  try {
    await api("/api/admin/waitlist?limit=1");
    sessionStorage.setItem(KEY_STORE, key);
    showConsole();
  } catch (err) {
    state.key = null;
    $("#adminError").textContent =
      err.status === 401 ? "That key doesn't have admin access." : err.message || "Something went wrong.";
  }
});

$("#adminSignOut").addEventListener("click", (e) => {
  e.preventDefault();
  sessionStorage.removeItem(KEY_STORE);
  location.reload();
});

function showConsole() {
  $("#adminGate").classList.add("hidden");
  $("#adminConsole").classList.remove("hidden");
  $("#adminSignOut").classList.remove("hidden");
  void refresh();
}

// ── Render ─────────────────────────────────────────────────────────────────

async function refresh() {
  const q = state.filter ? `?status=${encodeURIComponent(state.filter)}` : "";
  const [list, audit] = await Promise.all([
    api(`/api/admin/waitlist${q}`),
    api("/api/admin/audit?limit=30"),
  ]);
  renderCounts(list.counts);
  renderTable(list.entries);
  renderAudit(audit.entries);
  void refreshSubLicenses();
  void refreshFirebaseSignups();
  void refreshSignupsHistory();
  void refreshFeedback();
}

// ── Signups over time ────────────────────────────────────────────────────

async function refreshSignupsHistory() {
  const { days } = await api("/api/admin/signups-history?days=30");
  renderSignupsHistory(days);
}

function renderSignupsHistory(days) {
  const wrap = $("#signupsHistoryWrap");
  const max = Math.max(1, ...days.map((d) => d.count));
  wrap.innerHTML = `
    <div style="display:flex; align-items:flex-end; gap:3px; height:80px; padding:8px 0;">
      ${days
        .map((d) => {
          const h = Math.max(2, Math.round((d.count / max) * 72));
          const hot = d.count > 0 ? "var(--accent)" : "var(--border-strong)";
          return `<div title="${esc(d.date)}: ${d.count} signup(s)" style="flex:1; height:${h}px; background:${hot}; border-radius:2px 2px 0 0;"></div>`;
        })
        .join("")}
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-dim);">
      <span>${esc(days[0]?.date ?? "")}</span>
      <span>${days.reduce((s, d) => s + d.count, 0)} total</span>
      <span>${esc(days[days.length - 1]?.date ?? "")}</span>
    </div>`;
}

// ── Feedback ──────────────────────────────────────────────────────────────

async function refreshFeedback() {
  const { feedback } = await api("/api/admin/feedback");
  renderFeedback(feedback);
}

function renderFeedback(entries) {
  const wrap = $("#feedbackWrap");
  if (entries.length === 0) {
    wrap.innerHTML = `<p class="muted" style="padding:24px 0;">No feedback yet.</p>`;
    return;
  }
  wrap.innerHTML = entries
    .map(
      (f) => `
    <div class="stake-card" style="margin-bottom:10px; padding:16px;">
      <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:8px;">
        <span class="dim" style="font-size:12px;">${new Date(f.created_at).toLocaleString()}${f.context ? ` · ${esc(f.context)}` : ""}</span>
        ${f.email ? `<a href="mailto:${esc(f.email)}" style="font-size:12px;">${esc(f.email)}</a>` : `<span class="dim" style="font-size:12px;">no reply address</span>`}
      </div>
      <p style="white-space:pre-wrap; font-size:14px;">${esc(f.message)}</p>
    </div>`
    )
    .join("");
}

// ── Firebase signups ─────────────────────────────────────────────────────

async function refreshFirebaseSignups() {
  const { signups } = await api("/api/admin/firebase-signups");
  renderFirebaseSignups(signups);
}

function renderFirebaseSignups(signups) {
  const wrap = $("#firebaseSignupsWrap");
  if (signups.length === 0) {
    wrap.innerHTML = `<p class="muted" style="padding:24px 0;">No signups yet.</p>`;
    return;
  }
  wrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Signed up</th><th>Name</th><th>Email</th><th>Provider</th><th>License</th></tr></thead>
      <tbody>
        ${signups
          .map(
            (s) => `
          <tr>
            <td class="dim">${new Date(s.created_at).toLocaleDateString()}</td>
            <td>${esc(s.name)}</td>
            <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
            <td class="dim">${esc(s.provider)}</td>
            <td class="mono dim">${s.license_id ? "issued" : "—"}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

// ── Subscription license pool ───────────────────────────────────────────────

async function refreshSubLicenses() {
  let { licenses } = await api("/api/admin/sub-licenses");
  if (licenses.length === 0) {
    ({ licenses } = await api("/api/admin/sub-licenses/seed", { method: "POST", body: JSON.stringify({}) }));
  }
  renderSubLicenses(licenses);
}

$("#addLicensesBtn").addEventListener("click", async () => {
  const count = parseInt(prompt("How many codes to add?", "10") ?? "", 10);
  if (!count || count <= 0) return;
  try {
    await api("/api/admin/sub-licenses/add", { method: "POST", body: JSON.stringify({ count }) });
    await refreshSubLicenses();
  } catch (err) {
    alert(err.message || "Could not add codes.");
  }
});

function daysLeft(expiresAt) {
  if (!expiresAt) return "—";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  return `${Math.ceil(ms / (24 * 60 * 60 * 1000))}d left`;
}

function renderSubLicenses(licenses) {
  const wrap = $("#subLicenseWrap");
  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Code</th><th>Status</th><th>Tier</th><th>Label</th><th>Expires</th><th></th></tr>
      </thead>
      <tbody>
        ${licenses
          .map(
            (l) => `
          <tr data-id="${esc(l.id)}">
            <td class="mono">${esc(l.license_key)}</td>
            <td><span class="pill ${l.status === "taken" ? "approved" : "pending"}">${l.status === "taken" ? "Taken" : "Not taken"}</span></td>
            <td>${l.tier ? `<span class="pill approved">Free</span>` : `<span class="dim">—</span>`}</td>
            <td>${esc(l.label ?? "—")}</td>
            <td class="dim">${daysLeft(l.expires_at)}</td>
            <td class="actions-cell">
              <button class="mini copy" data-id="${esc(l.id)}">Copy</button>
              ${
                l.status === "taken"
                  ? `<button class="mini reject" data-id="${esc(l.id)}">Mark not taken</button>`
                  : `<button class="mini approve" data-id="${esc(l.id)}">Mark taken</button>`
              }
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;

  for (const btn of wrap.querySelectorAll("button.copy")) {
    btn.addEventListener("click", () => {
      const row = licenses.find((x) => x.id === btn.dataset.id);
      navigator.clipboard?.writeText(row.license_key);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  }

  for (const btn of wrap.querySelectorAll("button.mini.approve, button.mini.reject")) {
    btn.addEventListener("click", async () => {
      const row = licenses.find((x) => x.id === btn.dataset.id);
      const toTaken = btn.classList.contains("approve");
      let label = row.label;
      if (toTaken) {
        label = prompt("Label this code (e.g. customer/company name):", row.label || "") ?? row.label;
      } else if (!confirm(`Mark ${row.license_key} as not taken? This clears its expiry.`)) {
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/admin/sub-licenses/${encodeURIComponent(row.id)}/status`, {
          method: "POST",
          body: JSON.stringify({ status: toTaken ? "taken" : "not_taken", label: label || undefined }),
        });
        await refreshSubLicenses();
      } catch (err) {
        alert(err.message || "Could not update.");
        btn.disabled = false;
      }
    });
  }
}

function renderCounts(counts) {
  const el = $("#adminCounts");
  const cells = [
    { label: "Total", value: counts.total },
    { label: "Awaiting deposit", value: counts.pending },
    { label: "Ready to review", value: counts.paid, highlight: counts.paid > 0 },
    { label: "Approved", value: counts.approved },
    { label: "Rejected", value: counts.rejected },
  ];
  el.innerHTML = cells
    .map(
      (c) => `
      <div class="admin-count${c.highlight ? " highlight" : ""}">
        <div class="n">${c.value}</div>
        <div class="l">${c.label}</div>
      </div>`
    )
    .join("");
}

function renderTable(entries) {
  const wrap = $("#adminTableWrap");
  if (entries.length === 0) {
    wrap.innerHTML = `<p class="muted" style="padding:24px 0;">No applications${
      state.filter ? ` with status "${esc(STATUS_LABEL[state.filter] ?? state.filter)}"` : ""
    } yet.</p>`;
    return;
  }

  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Applied</th><th>Name</th><th>Organisation</th>
          <th>Work email</th><th>Phone</th><th>Deposit</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${entries
          .map(
            (e) => `
          <tr data-id="${esc(e.id)}">
            <td class="dim">${new Date(e.created_at).toLocaleDateString()}</td>
            <td>${esc(e.name)}</td>
            <td>${esc(e.organisation)}</td>
            <td><a href="mailto:${esc(e.work_email)}">${esc(e.work_email)}</a></td>
            <td class="mono">${esc(e.phone)}</td>
            <td class="dim">${e.deposit_cents ? "$" + (e.deposit_cents / 100).toFixed(2) : "—"}</td>
            <td><span class="pill ${esc(e.status)}">${esc(STATUS_LABEL[e.status] ?? e.status)}</span></td>
            <td class="actions-cell">
              ${
                e.status === "approved"
                  ? ""
                  : `<button class="mini approve" data-id="${esc(e.id)}">Approve</button>`
              }
              ${
                e.status === "rejected"
                  ? ""
                  : `<button class="mini reject" data-id="${esc(e.id)}">Reject</button>`
              }
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;

  for (const btn of wrap.querySelectorAll("button.mini")) {
    btn.addEventListener("click", async () => {
      const status = btn.classList.contains("approve") ? "approved" : "rejected";
      const row = entries.find((x) => x.id === btn.dataset.id);
      // Approval is what lets someone in — worth one confirmation, with the
      // organisation named so it's clear which row is being acted on.
      if (!confirm(`${status === "approved" ? "Approve" : "Reject"} ${row.name} (${row.organisation})?`)) return;
      btn.disabled = true;
      try {
        await api(`/api/admin/waitlist/${encodeURIComponent(btn.dataset.id)}/status`, {
          method: "POST",
          body: JSON.stringify({ status }),
        });
        await refresh();
      } catch (err) {
        alert(err.message || "Could not update.");
        btn.disabled = false;
      }
    });
  }
}

function renderAudit(entries) {
  const el = $("#adminAudit");
  if (entries.length === 0) {
    el.innerHTML = `<p class="muted">Nothing yet.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>
        ${entries
          .map((e) => {
            let detail = "";
            try {
              const d = JSON.parse(e.data ?? "{}");
              detail = [d.organisation, d.to].filter(Boolean).join(" → ");
            } catch {
              detail = "";
            }
            return `<tr>
              <td class="dim">${new Date(e.created_at).toLocaleString()}</td>
              <td class="mono">${esc((e.user_id ?? "").replace(/^admin:/, ""))}</td>
              <td>${esc(e.event)}</td>
              <td class="dim">${esc(detail)}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

$$(".admin-filters .af").forEach((b) => {
  b.addEventListener("click", () => {
    $$(".admin-filters .af").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.filter = b.dataset.status;
    void refresh();
  });
});

// ── Boot ───────────────────────────────────────────────────────────────────

(function boot() {
  const stored = sessionStorage.getItem(KEY_STORE);
  if (stored) {
    state.key = stored;
    // Verify rather than trust: the key may have been rotated since the tab
    // was opened, and showing a console that then 401s on every action is
    // worse than asking for the key again.
    api("/api/admin/waitlist?limit=1")
      .then(showConsole)
      .catch(() => {
        sessionStorage.removeItem(KEY_STORE);
        state.key = null;
      });
  }
})();
