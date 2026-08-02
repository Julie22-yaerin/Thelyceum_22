// Download page renderer.
// Fetches /api/downloads (public, same MIT commands as the READMEs) and
// renders OS tabs (auto-detected), product tabs and environment cards with
// copy-to-clipboard command blocks. No framework, no build step.

const $ = (s) => document.querySelector(s);

const state = {
  data: null,
  os: null, // "macos" | "windows" | "linux"
  product: "brake",
};

// ── OS detection ────────────────────────────────────────────────────────────
// Best-effort from the browser; the user can override with the tabs. This is
// only a convenience — every command works on every OS, PATH notes differ.

function detectOs() {
  const p = navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/mac|darwin/i.test(p) || /Mac/i.test(ua)) return "macos";
  if (/win/i.test(p) || /Windows/i.test(ua)) return "windows";
  if (/linux/i.test(p) || /Linux/i.test(ua)) return "linux";
  return "macos";
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderOses() {
  const tabs = $("#osTabs");
  tabs.innerHTML = "";
  for (const os of state.data.oses) {
    const b = document.createElement("button");
    b.className = "ot" + (os.id === state.os ? " active" : "");
    b.dataset.os = os.id;
    b.textContent = os.label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(os.id === state.os));
    b.addEventListener("click", () => {
      state.os = os.id;
      try {
        localStorage.setItem("lyceum_os", os.id);
      } catch {
        // storage blocked — the choice just won't survive a reload
      }
      render();
    });
    tabs.appendChild(b);
  }
  const detected = state.data.oses.find((o) => o.id === state.os);
  $("#detectNote").textContent = detected
    ? `We detected ${detected.label}. Wrong? Pick another tab — only the PATH and config notes change, not the commands.`
    : "";
}

function renderProducts() {
  const tabs = $("#productTabs");
  tabs.innerHTML = "";
  for (const p of state.data.products) {
    const b = document.createElement("button");
    b.className = "gt" + (p.id === state.product ? " active" : "");
    b.dataset.product = p.id;
    const dot = document.createElement("span");
    dot.className = "dot " + (p.id === "brake" ? "red" : p.id === "redteam" ? "violet" : "amber");
    b.appendChild(dot);
    b.appendChild(document.createTextNode(" " + p.name));
    b.addEventListener("click", () => {
      state.product = p.id;
      render();
    });
    tabs.appendChild(b);
  }
}

/** Resolve {placeholder} tokens in a string against the current OS. */
function resolveTokens(s) {
  const os = state.data.oses.find((o) => o.id === state.os);
  return s.replace(/\{([a-zA-Z]+)\}/g, (_, key) => {
    const v = os ? os[key] : undefined;
    return v !== undefined ? v : `{${key}}`;
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderEnvCard(env) {
  const card = document.createElement("article");
  card.className = "env-card";

  const head = document.createElement("div");
  head.className = "env-head";
  const h3 = document.createElement("h3");
  h3.textContent = env.label;
  const tag = document.createElement("p");
  tag.className = "env-tagline";
  tag.textContent = env.tagline;
  head.appendChild(h3);
  head.appendChild(tag);
  card.appendChild(head);

  const list = document.createElement("ol");
  list.className = "env-steps";
  for (const step of env.steps) {
    const li = document.createElement("li");
    const title = document.createElement("h4");
    title.textContent = step.title;
    li.appendChild(title);

    const wrap = document.createElement("div");
    wrap.className = "cmd-wrap";
    const pre = document.createElement("pre");
    pre.className = "cmd-block";
    pre.innerHTML = `<code>${escapeHtml(resolveTokens(step.command))}</code>`;
    const copy = document.createElement("button");
    copy.className = "copy-btn";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", `Copy ${step.title}`);
    copy.addEventListener("click", () => copyCommand(copy, resolveTokens(step.command)));
    wrap.appendChild(pre);
    wrap.appendChild(copy);
    li.appendChild(wrap);

    if (step.expect) {
      const ex = document.createElement("p");
      ex.className = "expect";
      ex.innerHTML = `<strong>Expect:</strong> ${escapeHtml(resolveTokens(step.expect))}`;
      li.appendChild(ex);
    }
    if (step.note) {
      const nt = document.createElement("p");
      nt.className = "detail";
      nt.innerHTML = escapeHtml(resolveTokens(step.note));
      li.appendChild(nt);
    }
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

function renderPathNote() {
  const os = state.data.oses.find((o) => o.id === state.os);
  const el = $("#pathNote");
  if (!os || !os.pathNote) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `<strong>PATH / config notes for ${escapeHtml(os.label)} (${escapeHtml(os.shell)}):</strong> ${escapeHtml(os.pathNote)}`;
}

function render() {
  renderOses();
  renderProducts();
  renderPathNote();

  const product = state.data.products.find((p) => p.id === state.product);
  const grid = $("#envGrid");
  grid.innerHTML = "";
  if (!product) return;
  for (const env of product.envs) {
    grid.appendChild(renderEnvCard(env));
  }
}

// ── Copy to clipboard ───────────────────────────────────────────────────────

async function copyCommand(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API blocked (non-secure context or permission) — fall back
    // to a selection-based copy so the button still works on plain HTTP.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const original = btn.textContent;
  btn.textContent = "Copied ✓";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("copied");
  }, 1500);
}

// ── Boot ────────────────────────────────────────────────────────────────────

(async function boot() {
  try {
    const res = await fetch("/api/downloads");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $("#envGrid").innerHTML =
      "<p class='muted'>Could not load install commands. Is the server running?</p>";
    return;
  }
  // Persist a manual OS choice across visits; auto-detect only the first time.
  // Guarded: in sandboxed/private contexts storage access can throw, and that
  // must not take the whole page down — it is only a convenience default.
  let saved = null;
  try {
    saved = localStorage.getItem("lyceum_os");
  } catch {
    saved = null;
  }
  state.os = saved || detectOs();

  const requested = new URLSearchParams(location.search).get("product");
  state.product = state.data.products.some((p) => p.id === requested) ? requested : "brake";
  render();

  // Pre-launch messaging, same as the other pages: show the banner only when
  // the server is in waitlist mode. Optional — the page works without it.
  try {
    const res = await fetch("/api/plans");
    if (res.ok) {
      const { launchMode } = await res.json();
      if (launchMode === "waitlist") {
        document.querySelector("#launchBanner")?.removeAttribute("hidden");
      }
    }
  } catch {
    // banner is a nicety; ignore failures
  }
})();
