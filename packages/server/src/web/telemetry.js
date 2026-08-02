// The Lyceum — telemetry report page.
//
// Same endpoint as the landing page terminal (/api/telemetry), rendered as
// cards plus the thrift agent-loop figure. No hardcoded numbers: if the
// server is unreachable the page says so, in the same spirit as every other
// honest number on this site.

const $ = (s) => document.querySelector(s);

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

const COLORS = { brake: "brake", redteam: "redteam", thrift: "neutral" };
const UNITS = { brake: "danger scans / sec", redteam: "reasoning challenges / sec", thrift: "compressions / sec" };

function card(m) {
  return `
    <div class="bench">
      <div class="figure ${COLORS[m.tool] || "neutral"}">${fmt(m.callsPerSec)}</div>
      <div class="unit">${UNITS[m.tool] || m.label}</div>
      <div class="caption">avg ${m.avgUs.toFixed(2)}µs per call. Single process, single core.</div>
    </div>`;
}

function render(t) {
  const grid = $("#benchGrid");
  if (!grid) return;
  grid.innerHTML = t.measurements.map(card).join("");

  const line = $("#measuredLine");
  const time = t.measuredAt ? new Date(t.measuredAt).toLocaleTimeString() : "unknown";
  line.textContent = t.source === "live"
    ? `Measured live on this server at ${time}. Refresh to re-run.`
    : `Live measurement unavailable (${t.note}). Showing CI-verified reference figures.`;

  // thrift's workload-dependent saving, from the same response
  const note = $("#telemetryNote");
  const loop = t.thriftAgentLoop;
  if (loop) {
    note.innerHTML = `
      <strong>How these were measured.</strong> Same corpora and best-of-N
      methodology as the CI throughput tests in each package
      (<code>test/throughput.test.ts</code>): warm-up, then the best of
      three timed runs over a mixed corpus of dangerous/benign inputs, on a
      single core. The floor assertions in those tests fail the build if
      throughput ever drops — so a claim on this page that quietly rots is
      a claim CI catches.
      <br /><br />
      <strong>thrift, on this server's own source:</strong>
      ${loop.files} files × ${loop.passes} passes →
      <strong>${loop.savedPct.toFixed(1)}% saved</strong>,
      ${loop.losslessPct.toFixed(1)}% of it lossless.
      <br /><br />
      <strong>What we are not claiming.</strong> These are the guard
      functions, which is where the cost would be if there were one. Actually
      engaging the brake does real work — killing tracked processes, running
      your stop script, posting your webhook — and is bounded by a measured
      1000ms SLA instead, reported honestly when it is missed. And thrift's
      saving depends entirely on your workload: read the table above before
      you budget against the headline.
    `;
  }
}

(async function boot() {
  try {
    const res = await fetch("/api/telemetry", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (err) {
    $("#measuredLine").textContent = `Could not reach /api/telemetry (${err.message}). Showing nothing rather than a made-up number.`;
    $("#benchGrid").innerHTML = "";
  }
})();
