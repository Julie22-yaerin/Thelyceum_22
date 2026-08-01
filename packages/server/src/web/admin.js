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
