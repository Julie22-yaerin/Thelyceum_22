import { LegalPageLayout, LegalSection, SUPPORT_EMAIL } from "@/components/LegalPageLayout";

export default function Terms() {
  return (
    <LegalPageLayout title="Terms of Service">
      <LegalSection heading="1. Agreement to Terms">
        <p>
          These Terms of Service ("Terms") govern your access to and use of The Lyceum's website, beta
          program, and Adaptive Audit Engine product (together, the "Service"), operated by The Lyceum
          ("we," "us," "our"). By creating a pre-order, using a license key, or otherwise accessing the
          Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection heading="2. The Service">
        <p>
          The Lyceum is currently offered as a capped beta. Features, availability, pricing, and the scope
          of the Service may change materially as the product develops. We do not guarantee uninterrupted
          availability, specific response times, or that the Service will be free of errors, though we
          design and operate it in good faith to meet the performance targets described on our website.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accounts and License Keys">
        <p>
          Access to the Service is granted via a license key issued after a successful pre-order. You are
          responsible for keeping your license key confidential and for all activity that occurs under it.
          Notify us immediately at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal hover:text-teal-dark underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>{" "}
          if you believe your license key has been compromised.
        </p>
      </LegalSection>

      <LegalSection heading="4. Pre-Orders and Payment">
        <p>
          Pre-order deposits are processed by our payment provider, Lemon Squeezy, acting as our merchant
          of record. By placing a pre-order you authorize the charge shown at checkout. Deposit amounts,
          what they apply toward, and refund eligibility are described in our{" "}
          <a href="/refund-policy" className="text-teal hover:text-teal-dark underline underline-offset-2">
            Refund Policy
          </a>
          , which is part of these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="5. Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Use the Service to violate any applicable law or third party's rights;</li>
          <li>Attempt to access another user's license key, account, or data without authorization;</li>
          <li>Probe, scan, or attempt to bypass the Service's rate limits, quotas, or security controls;</li>
          <li>Resell, sublicense, or share a single license key across unrelated organizations;</li>
          <li>Submit content to the Service that you do not have the right to submit.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. AI-Generated Output">
        <p>
          The Service uses third-party AI models to generate audits, summaries, and other output. AI output
          can be incomplete or incorrect. You are responsible for reviewing and validating any output before
          relying on it for decisions that carry legal, financial, safety, or compliance consequences. The
          Service is a tool to assist human review, not a replacement for professional judgment.
        </p>
      </LegalSection>

      <LegalSection heading="7. Intellectual Property">
        <p>
          We retain all rights, title, and interest in the Service, including its software, design, and
          underlying technology. You retain ownership of the content you submit to the Service. You grant us
          a limited license to process that content solely to provide the Service to you.
        </p>
      </LegalSection>

      <LegalSection heading="8. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER
          EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, AND NON-INFRINGEMENT. GIVEN THE BETA STATUS OF THE SERVICE, WE MAKE NO GUARANTEE OF
          FEATURE COMPLETENESS OR CONTINUOUS AVAILABILITY.
        </p>
      </LegalSection>

      <LegalSection heading="9. Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE LYCEUM WILL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR
          GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE
          SERVICE WILL NOT EXCEED THE AMOUNT YOU PAID US IN THE 3 MONTHS BEFORE THE CLAIM AROSE.
        </p>
      </LegalSection>

      <LegalSection heading="10. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate your access if you
          violate these Terms, misuse the Service, or if we discontinue the beta program, with notice where
          reasonably practicable. Sections of these Terms that by their nature should survive termination
          (including intellectual property, disclaimers, and limitation of liability) will survive.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to These Terms">
        <p>
          We may update these Terms as the Service evolves. If we make material changes, we will update the
          effective date above and, where appropriate, notify you. Continued use of the Service after
          changes take effect constitutes acceptance of the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact">
        <p>
          Questions about these Terms? Reach us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal hover:text-teal-dark underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
