// Pricing slider — $42 per 2 connections, linear, capped at 15 connections.
// $42 / 2 = $21 per connection exactly, so every step lands on a whole dollar.
//
// The USDC flow: create a checkout (server mints a fresh Solana Pay
// reference), show the QR it returns, then poll status until the server
// confirms the on-chain transfer and hands back a license key. The key is
// verified server-side against the actual chain — this page never decides
// "paid" on its own.

const $ = (s) => document.querySelector(s);
const PRICE_PER_CONNECTION = 21;
const KEY_STORE = "lyceum_license_key";

const slider = $("#connSlider");
const connValue = $("#connValue");
const priceValue = $("#priceValue");

function render() {
  const connections = Number(slider.value);
  connValue.textContent = connections;
  priceValue.textContent = `$${connections * PRICE_PER_CONNECTION}`;
}

slider.addEventListener("input", render);
render();

// ── Solana Pay ─────────────────────────────────────────────────────────────

let pollTimer = null;

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

$("#payUsdcBtn").addEventListener("click", async () => {
  stopPolling();
  const connections = Number(slider.value);
  const btn = $("#payUsdcBtn");
  const panel = $("#solanaPayPanel");
  const statusEl = $("#solanaStatus");

  btn.disabled = true;
  btn.textContent = "Generating QR…";

  try {
    const res = await fetch("/api/checkout/solana/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connections }),
    });
    const checkout = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = checkout.message || "Could not start checkout.";
      panel.classList.remove("hidden");
      return;
    }

    $("#solanaQr").src = `/api/checkout/solana/qr?url=${encodeURIComponent(checkout.url)}`;
    statusEl.textContent = `Waiting for ${checkout.amountUsdc} USDC — scan with a Solana wallet.`;
    panel.classList.remove("hidden");

    pollTimer = setInterval(async () => {
      try {
        const sRes = await fetch(`/api/checkout/solana/status/${checkout.reference}`);
        const status = await sRes.json().catch(() => ({}));
        if (!sRes.ok) {
          statusEl.textContent = status.message || "Checkout error — try again.";
          stopPolling();
          return;
        }
        if (status.status === "confirmed") {
          stopPolling();
          statusEl.textContent = "Payment confirmed. Taking you to setup…";
          localStorage.setItem(KEY_STORE, status.licenseKey);
          setTimeout(() => {
            location.href = "/web/redeem";
          }, 1200);
        }
      } catch {
        // A single failed poll isn't fatal — the interval just tries again.
      }
    }, 4000);
  } catch {
    statusEl.textContent = "Couldn't reach the server. Try again.";
    panel.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Pay with USDC (Solana)";
  }
});
