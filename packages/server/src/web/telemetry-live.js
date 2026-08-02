// The Lyceum — landing page live terminal.
//
// The three numbers are measured on the server, at request time, by the same
// corpora/methodology as the CI throughput tests. This script renders them —
// it never fabricates a fallback. If the endpoint is unreachable it says so,
// because a fake number on a safety product's own page is exactly the failure
// the product exists to catch.

const $ = (s) => document.querySelector(s);

function fmt(n) {
  // 1,370,000 -> "1.37M" · 376,000 -> "376k" · 26,000 -> "26.0k"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function render(t) {
  const pre = $("#terminalPre");
  if (!pre) return;
  const [brake, redteam, thrift] = t.measurements;
  const time = new Date(t.measuredAt).toLocaleTimeString();
  const loop = t.thriftAgentLoop;

  const lines = [
    `$ lyceum bench --live  (measured ${t.source === "live" ? time : "n/a"})`,
    ``,
    `  brake   danger_scan      ${fmt(brake.callsPerSec).padStart(7)} calls/sec   avg ${brake.avgUs.toFixed(2)}µs`,
    `  redteam challenge        ${fmt(redteam.callsPerSec).padStart(7)} calls/sec   avg ${redteam.avgUs.toFixed(2)}µs`,
    `  thrift  compress         ${fmt(thrift.callsPerSec).padStart(7)} calls/sec   avg ${thrift.avgUs.toFixed(2)}µs`,
    ``,
    `  thrift  agent loop       ${loop.savedPct.toFixed(1)}% saved  (${loop.losslessPct.toFixed(1)}% lossless, ${loop.files} files × ${loop.passes} passes)`,
    t.source === "reference" ? `  NOTE: ${t.note}` : "",
    `$`,
  ].filter((l) => l !== "");

  pre.textContent = lines.join("\n");
}

(async function boot() {
  const pre = $("#terminalPre");
  try {
    const res = await fetch("/api/telemetry", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const t = await res.json();
    render(t);
  } catch (err) {
    if (pre) {
      pre.textContent = `$ lyceum bench --live\n\n  ! could not reach /api/telemetry (${err.message})\n  ! showing nothing rather than a made-up number.\n\n$`;
    }
  }
})();
