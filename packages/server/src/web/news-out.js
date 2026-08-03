// The Lyceum — waiting room feed. Reads /api/news, which is public; nothing
// on this page writes anything, so there's no auth here at all — posting is
// a dev-token-gated server endpoint, deliberately with no UI.

const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderEntry(entry) {
  const title = escapeHtml(entry.title);
  const body = escapeHtml(entry.body);
  // Benchmark entries read as a measurement, not a note — the terminal
  // treatment (same component the telemetry page could use) says that at a
  // glance, before anyone reads a number.
  const bodyHtml =
    entry.category === "benchmark"
      ? `<div class="terminal"><div class="terminal-head"><span class="t-dot red"></span><span class="t-dot amber"></span><span class="t-dot green"></span><span class="t-title">benchmark</span></div><div class="terminal-body"><pre>${body}</pre></div></div>`
      : `<p class="news-body">${body}</p>`;

  return `
    <article class="news-card">
      <div class="news-card-head">
        <span class="news-badge ${entry.category}">${entry.category}</span>
        <span class="news-date">${formatDate(entry.created_at)}</span>
      </div>
      <h3 class="news-title">${title}</h3>
      ${bodyHtml}
    </article>`;
}

(async function boot() {
  const feed = $("#newsFeed");
  try {
    const res = await fetch("/api/news");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { entries } = await res.json();

    if (!entries || entries.length === 0) {
      feed.innerHTML = `<p class="news-empty">Nothing posted yet. Check back — this fills in as work lands, not on a schedule.</p>`;
      return;
    }
    feed.innerHTML = entries.map(renderEntry).join("");
  } catch {
    feed.innerHTML = `<p class="news-error">Couldn't load the feed. Refresh, or check back shortly.</p>`;
  }
})();
