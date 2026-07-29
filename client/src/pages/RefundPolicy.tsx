import { LegalPageLayout, LegalSection, SUPPORT_EMAIL } from "@/components/LegalPageLayout";

export default function RefundPolicy() {
  return (
    <LegalPageLayout title="Refund Policy">
      <LegalSection heading="1. What You're Paying For">
        <p>
          Pre-order payments ($22 Basic / $122 VIP, or the amount shown at checkout) are deposits that
          reserve your beta slot and are applied toward your plan at launch. They are not a purchase of a
          finished, generally-available product — The Lyceum is in capped beta, and features are actively
          being built.
        </p>
      </LegalSection>

      <LegalSection heading="2. Refund Window">
        <p>
          You can request a full refund of your pre-order deposit within{" "}
          <strong className="text-foreground">14 days</strong> of your payment date, no questions asked,
          provided your license key has not yet been used to run tasks through the API or MCP.
        </p>
        <p>
          After 14 days, or after your license key has been used to run tasks, refunds are considered on a
          case-by-case basis — for example if we're unable to onboard you within a reasonable time, or the
          Service materially fails to work as described. Contact us and we'll work with you in good faith.
        </p>
      </LegalSection>

      <LegalSection heading="3. How to Request a Refund">
        <p>
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal hover:text-teal-dark underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>{" "}
          with the email address you used at checkout and, if you have it, your order reference or license
          key. We'll confirm receipt within 2 business days.
        </p>
      </LegalSection>

      <LegalSection heading="4. Processing Time">
        <p>
          Approved refunds are issued to your original payment method via Lemon Squeezy, our payment
          processor. Refunds typically appear within 5–10 business days, depending on your bank or card
          issuer.
        </p>
      </LegalSection>

      <LegalSection heading="5. Beta Feature Changes">
        <p>
          Because this is a beta product, specific features, timelines, and the exact latency targets
          described on our website may change as we build. This is not, by itself, grounds for a refund
          outside the window in Section 2 — but if a change materially affects your ability to use the
          Service as intended, tell us and we'll look at it individually.
        </p>
      </LegalSection>

      <LegalSection heading="6. Contact">
        <p>
          Questions about a charge or a refund request? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal hover:text-teal-dark underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>{" "}
          — we read every message ourselves.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
