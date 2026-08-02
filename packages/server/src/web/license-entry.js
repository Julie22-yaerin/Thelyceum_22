// Landing page — "Have a license key?" box.
//
// The key is a credential, so it must not travel in the URL (browser
// history, server access logs, referrers). We hold it in sessionStorage —
// which survives the same-tab navigation to the showroom, but dies with the
// tab — and the showroom's app.js picks it up and runs the enter flow. The
// server is the only thing that ever sees the key's value.
const form = document.querySelector("#licenseForm");
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector('input[name="license"]');
    const key = (input && input.value || "").trim();
    if (!key) return;
    sessionStorage.setItem("lyceum_entered_key", key);
    window.location.href = "/web/showroom";
  });
}
