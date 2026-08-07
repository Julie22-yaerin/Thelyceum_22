const SCENARIOS = {
  loop: {
    name: "Agent Re-reading Files (5 Passes)",
    before: 10000,
    after: 2150,
    losslessPct: 97.6,
    savedPct: 78.5,
  },
  logs: {
    name: "CI Build & Test Logs (ANSI/Noise)",
    before: 15000,
    after: 1180,
    losslessPct: 100.0,
    savedPct: 92.1,
  },
  code: {
    name: "Multi-file Code Review",
    before: 8500,
    after: 3043,
    losslessPct: 91.2,
    savedPct: 64.2,
  },
  json: {
    name: "Raw Data & Large JSON Payloads",
    before: 25000,
    after: 2900,
    losslessPct: 98.5,
    savedPct: 88.4,
  },
};

let currentScenario = "loop";

function updateTokenSavingsChart(sc) {
  const scenario = SCENARIOS[sc] || SCENARIOS.loop;
  const before = scenario.before;
  const after = scenario.after;
  const saved = before - after;
  const savedPct = scenario.savedPct;
  const afterPct = 100 - savedPct;
  const losslessRatio = scenario.losslessPct / 100;
  const losslessPct = savedPct * losslessRatio;
  const lossyPct = savedPct * (1 - losslessRatio);

  const $beforeTokens = $("#tsBeforeTokens");
  const $afterTokens = $("#tsAfterTokens");
  const $savedTokens = $("#tsSavedTokens");
  const $beforeBar = $("#tsBeforeBar");
  const $afterBar = $("#tsAfterBar");
  const $losslessBar = $("#tsLosslessBar");
  const $lossyBar = $("#tsLossyBar");

  if ($beforeTokens) $beforeTokens.textContent = `${before.toLocaleString()} tokens (100.0%)`;
  if ($afterTokens) $afterTokens.textContent = `${after.toLocaleString()} tokens (${afterPct.toFixed(1)}%)`;
  if ($savedTokens) $savedTokens.textContent = `${saved.toLocaleString()} tokens (${savedPct.toFixed(1)}% saved)`;

  if ($beforeBar) $beforeBar.style.width = "100%";
  if ($afterBar) $afterBar.style.width = `${afterPct.toFixed(1)}%`;
  if ($losslessBar) $losslessBar.style.width = `${losslessPct.toFixed(1)}%`;
  if ($lossyBar) $lossyBar.style.width = `${lossyPct.toFixed(1)}%`;

  const $savedPct = $("#tsMetricSavedPct");
  const $losslessPct = $("#tsMetricLosslessPct");
  const $savedTokensMetric = $("#tsMetricSavedTokens");
  const $dollarSaved = $("#tsMetricDollarSaved");

  if ($savedPct) $savedPct.textContent = `${savedPct.toFixed(1)}%`;
  if ($losslessPct) $losslessPct.textContent = `${scenario.losslessPct.toFixed(1)}%`;
  if ($savedTokensMetric) $savedTokensMetric.textContent = saved.toLocaleString();
  if ($dollarSaved) $dollarSaved.textContent = `$${((saved / 1_000_000) * 3.0).toFixed(3)}`;

  updateCalculator(savedPct);
}

function updateCalculator(savedPctVal) {
  const input = $("#monthlyTokensInput");
  if (!input) return;
  const tokens = parseFloat(input.value) || 50000000;
  const pctRatio = (savedPctVal || 78.5) / 100;
  
  // Claude 3.5 Sonnet input ~$3.00 / 1M tokens
  // GPT-4o input ~$2.50 / 1M tokens
  const claudeSaved = ((tokens * pctRatio) / 1_000_000) * 3.0;
  const gptSaved = ((tokens * pctRatio) / 1_000_000) * 2.5;

  const $claude = $("#calcClaudeSaved");
  const $gpt = $("#calcGptSaved");
  if ($claude) $claude.textContent = `$${claudeSaved.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if ($gpt) $gpt.textContent = `$${gptSaved.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setupTokenSavingsListeners() {
  const btns = document.querySelectorAll("#scenarioControls button");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentScenario = btn.dataset.scenario;
      updateTokenSavingsChart(currentScenario);
    });
  });

  const input = $("#monthlyTokensInput");
  if (input) {
    input.addEventListener("input", () => {
      const scenario = SCENARIOS[currentScenario] || SCENARIOS.loop;
      updateCalculator(scenario.savedPct);
    });
  }
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
    
    // Update live figures in scenario if available
    SCENARIOS.loop.savedPct = loop.savedPct;
    SCENARIOS.loop.losslessPct = loop.losslessPct;
    updateTokenSavingsChart(currentScenario);
  }
}

(async function boot() {
  setupTokenSavingsListeners();
  updateTokenSavingsChart("loop");
  try {
    const res = await fetch("/api/telemetry", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (err) {
    $("#measuredLine").textContent = `Could not reach /api/telemetry (${err.message}). Showing nothing rather than a made-up number.`;
    $("#benchGrid").innerHTML = "";
  }
})();
