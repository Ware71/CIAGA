/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SITE_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: `The rules for content and conduct on ${SITE_NAME}.`,
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable Use Policy"
      intro={`${SITE_NAME} is a space for golf groups to share rounds, results and friendly banter. This policy sets the rules for content and conduct. It forms part of our Terms of Use.`}
    >
      <h2>1. Be respectful</h2>
      <p>
        Keep it friendly. Banter is welcome; harassment is not. Treat other
        members as you would on the course.
      </p>

      <h2>2. Content you must not post</h2>
      <p>You must not upload, post or share content that:</p>
      <ul>
        <li>is unlawful, or promotes or facilitates illegal activity;</li>
        <li>is harassing, bullying, threatening, or incites violence or hatred against people based on a protected characteristic;</li>
        <li>is defamatory, obscene, pornographic or grossly offensive;</li>
        <li>sexualises or endangers children in any way;</li>
        <li>infringes someone else's intellectual property or privacy;</li>
        <li>contains someone else's personal information without a lawful reason;</li>
        <li>contains malware, spam, or attempts to phish or defraud;</li>
        <li>impersonates another person or misrepresents your identity or affiliation.</li>
      </ul>

      <h2>3. Conduct you must not engage in</h2>
      <ul>
        <li>attempting to gain unauthorised access to accounts, data or systems;</li>
        <li>disrupting, overloading or interfering with the Service or its security features;</li>
        <li>scraping or harvesting other members' data;</li>
        <li>using the Service to send unsolicited marketing;</li>
        <li>manipulating scores, competitions, handicaps or the fantasy game dishonestly.</li>
      </ul>

      <h2>4. Reporting content</h2>
      <p>
        If you see something that breaks these rules, please <strong>report
        it</strong> using the report option on the post or comment in the app.
        Reports reach the group's administrators and us. You can also email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If content may be
        illegal, we will act promptly once we are aware of it, in line with our
        duties under the Online Safety Act 2023.
      </p>

      <h2>5. What we may do</h2>
      <p>We may, at our discretion:</p>
      <ul>
        <li>hide or remove content that breaches this policy;</li>
        <li>warn, suspend or terminate accounts;</li>
        <li>preserve information and cooperate with law enforcement where required.</li>
      </ul>
      <p>
        We aim to be fair and proportionate, and to act quickly on anything
        illegal or seriously harmful.
      </p>

      <h2>6. Copyright</h2>
      <p>
        To report content that infringes your copyright, follow our{" "}
        <Link href="/copyright">Copyright &amp; Takedown Policy</Link>.
      </p>

      <h2>7. Questions</h2>
      <p>
        Contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        This policy works alongside our <Link href="/terms">Terms of Use</Link>{" "}
        and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
