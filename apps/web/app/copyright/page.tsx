/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SITE_NAME, OPERATOR_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Copyright & Takedown Policy",
  description: `How to report copyright infringement on ${SITE_NAME} (DMCA and UK notice-and-takedown).`,
};

export default function CopyrightPage() {
  return (
    <LegalPage
      title="Copyright & Takedown Policy"
      intro={`We respect intellectual property rights and expect our members to do the same. If you believe content on ${SITE_NAME} infringes your copyright, you can ask us to remove it using the process below.`}
    >
      <h2>1. Our approach</h2>
      <p>
        {SITE_NAME} hosts content uploaded by its members. We operate a
        notice-and-takedown process consistent with the UK Electronic Commerce
        (EC Directive) Regulations 2002 and, because parts of our infrastructure
        are based in the United States, the US Digital Millennium Copyright Act
        (DMCA), 17 U.S.C. § 512.
      </p>

      <h2>2. How to send a takedown notice</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the
        subject line "Copyright Notice". Your notice must include:
      </p>
      <ol>
        <li>your name, address and contact details;</li>
        <li>identification of the copyrighted work you say has been infringed;</li>
        <li>identification of the material you say is infringing, and enough detail for us to locate it (for example a link or screenshot);</li>
        <li>a statement that you have a good-faith belief the use is not authorised by the copyright owner, its agent, or the law;</li>
        <li>a statement that the information in your notice is accurate and, under penalty of perjury, that you are the copyright owner or authorised to act on their behalf;</li>
        <li>your physical or electronic signature.</li>
      </ol>
      <div className="note">
        Please only submit a notice if you are the rights holder or authorised to
        act for them. Knowingly making a false claim of infringement may expose
        you to liability.
      </div>

      <h2>3. What we do</h2>
      <p>
        When we receive a valid notice, we will remove or disable access to the
        material promptly and take reasonable steps to notify the member who
        posted it.
      </p>

      <h2>4. Counter-notice</h2>
      <p>
        If you believe your content was removed by mistake or misidentification,
        you may send a counter-notice to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> including: your
        contact details; identification of the removed material and where it
        appeared; a statement under penalty of perjury that you have a good-faith
        belief it was removed by mistake or misidentification; and your
        signature. We may restore the content unless the original complainant
        pursues a legal remedy.
      </p>

      <h2>5. Repeat infringers</h2>
      <p>
        We may suspend or terminate the accounts of members who repeatedly
        infringe intellectual property rights.
      </p>

      <h2>6. Designated contact</h2>
      <p>
        Copyright notices should be addressed to {OPERATOR_NAME} at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See our{" "}
        <Link href="/legal">Legal</Link> page for full contact details, and our{" "}
        <Link href="/acceptable-use">Acceptable Use Policy</Link> for other types
        of report.
      </p>
    </LegalPage>
  );
}
