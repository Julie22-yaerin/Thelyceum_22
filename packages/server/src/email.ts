/**
 * Transactional email — license-key delivery, via Resend's HTTP API.
 *
 * No SDK: Resend's API is a single POST, and Node 22 has fetch built in —
 * a dependency isn't worth it for one call site. Sending is best-effort:
 * a license is already committed to the pool by the time this is called,
 * so a mail-provider hiccup should never unwind that or fail the signup
 * request the user is waiting on. Callers fire-and-forget or await and
 * ignore the result; the source of truth for "do I have a license" is
 * always the API response / redeem page, never the inbox.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "The Lyceum <yris22@thelyceum.site>";

export interface EmailSender {
  sendLicenseEmail(to: string, name: string, licenseKey: string, expiresAt: number): Promise<void>;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export const resendEmailSender: EmailSender = {
  async sendLicenseEmail(to, name, licenseKey, expiresAt) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[lyceum] RESEND_API_KEY is not set — skipping license email to", to);
      return;
    }

    const firstName = name.trim().split(/\s+/)[0] || "there";
    const html = `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Your Lyceum license is ready. This one code unlocks brake, redteam, and thrift.</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;font-family:monospace;margin:20px 0;">${escapeHtml(licenseKey)}</p>
      <p>Active until ${escapeHtml(fmtDate(expiresAt))}. Enter it at
        <a href="https://thelyceum.site/web/redeem">thelyceum.site/web/redeem</a> to get set up.</p>
      <p>— The Lyceum</p>`;

    try {
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: FROM,
          to: [to],
          subject: "Your Lyceum license key",
          html,
        }),
      });
      if (!res.ok) {
        console.error("[lyceum] license email failed:", res.status, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.error("[lyceum] license email failed:", err);
    }
  },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
