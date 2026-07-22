/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import {
  SITE_NAME,
  OPERATOR_NAME,
  OPERATOR_DESCRIPTOR,
  CONTACT_EMAIL,
  POSTAL_ADDRESS,
  MINIMUM_AGE,
  SUBPROCESSORS,
  ICO,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How CIAGA collects, uses and protects your personal data, and your rights under UK data protection law.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`This policy explains how ${SITE_NAME} collects, uses and protects your personal data, and the rights you have under UK data protection law.`}
    >
      <h2>1. Who we are</h2>
      <p>
        {SITE_NAME} is operated by {OPERATOR_NAME}, {OPERATOR_DESCRIPTOR} (“we”,
        “us”, “our”). We are the <strong>data controller</strong> for the
        personal data described in this policy.
      </p>
      <p>
        You can contact us about privacy or this policy at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {POSTAL_ADDRESS ? <>, or by post at {POSTAL_ADDRESS}</> : <> (a postal address for service is available on request)</>}
        .
      </p>

      <h2>2. Scope</h2>
      <p>
        This policy covers the {SITE_NAME} web app and marketing website. We
        process personal data in accordance with the{" "}
        <strong>UK GDPR</strong> and the{" "}
        <strong>Data Protection Act 2018</strong>.
      </p>

      <h2>3. The personal data we collect</h2>
      <h3>Account &amp; profile</h3>
      <ul>
        <li>Your email address and a password (managed by our authentication provider — we never see your password in plain text).</li>
        <li>Your display name and, optionally, a profile photo (avatar).</li>
        <li>Your gender, where you provide it — used only to apply the correct World Handicap System allowance.</li>
      </ul>
      <h3>Golf &amp; competition data</h3>
      <ul>
        <li>Your rounds, hole-by-hole scores and statistics.</li>
        <li>Your handicap index and its history over time.</li>
        <li>Your membership of groups/societies, competition entries, standings and results.</li>
        <li>
          Society bookkeeping entries — amounts you are recorded as owing or being owed within a group (for example green fees or prize money). {SITE_NAME} is a{" "}
          <strong>record-keeping tool only</strong>: it does not take payments, hold funds or move money. See our{" "}
          <Link href="/terms">Terms of Use</Link>.
        </li>
        <li>
          Fantasy predictions and the associated <strong>virtual points</strong> ledger. These points have no monetary value and cannot be exchanged for money or prizes.
        </li>
      </ul>
      <h3>Social &amp; user-generated content</h3>
      <ul>
        <li>Posts, comments, reactions, mentions and any images you upload to the feed.</li>
        <li>Who you follow and who follows you.</li>
        <li>Reports you submit about content.</li>
      </ul>
      <h3>Calendar &amp; availability</h3>
      <ul>
        <li>Availability and unavailability you record, including any recurring patterns and the "circles" you organise with.</li>
      </ul>
      <h3>Device &amp; technical data</h3>
      <ul>
        <li>If you enable push notifications, a push subscription for your device (a browser-issued endpoint and keys) and your browser's user-agent string.</li>
        <li>
          Approximate device location — <strong>only</strong> at the moment you use the "nearby courses" search, to find courses near you. We do not store your personal location.
        </li>
        <li>Essential cookies and local storage needed to keep you signed in and run the app. See our <Link href="/cookies">Cookie Policy</Link>.</li>
      </ul>

      <h2>4. Where your data comes from</h2>
      <p>
        Most data comes directly from you or is generated as you use {SITE_NAME}.
        In some cases another member may add you to the app before you join — for
        example by adding you to a round or inviting you — creating a{" "}
        <strong>"managed profile"</strong> that holds your name and, if provided,
        your email address so we can invite you and attribute your golf results.
      </p>
      <div className="note">
        <strong>If a member created a profile for you:</strong> we rely on our
        and the society's legitimate interests in running the group. You can ask
        us to correct or remove that profile at any time by emailing{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If you accept an
        invite and claim the profile, it becomes your account and this policy
        applies in full.
      </div>

      <h2>5. How and why we use your data (and our lawful bases)</h2>
      <table>
        <thead>
          <tr>
            <th>Purpose</th>
            <th>Lawful basis (UK GDPR Art. 6)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Creating and running your account, rounds, handicaps, groups, competitions and the fantasy game</td>
            <td>Performance of a contract</td>
          </tr>
          <tr>
            <td>Social features — feed, following, comments, reactions and mentions</td>
            <td>Legitimate interests (providing a social golf experience)</td>
          </tr>
          <tr>
            <td>Sending service emails (sign-up confirmation, password reset, invitations)</td>
            <td>Performance of a contract</td>
          </tr>
          <tr>
            <td>Sending push notifications</td>
            <td>Consent (you opt in through your browser; you can withdraw at any time)</td>
          </tr>
          <tr>
            <td>Creating and inviting managed profiles for people a member adds</td>
            <td>Legitimate interests (running a golf society)</td>
          </tr>
          <tr>
            <td>Keeping the service secure and preventing abuse</td>
            <td>Legitimate interests (security and integrity)</td>
          </tr>
          <tr>
            <td>Meeting our legal obligations</td>
            <td>Legal obligation</td>
          </tr>
        </tbody>
      </table>
      <p>
        Where we rely on <strong>legitimate interests</strong>, you have the
        right to object (see section 10). Where we rely on{" "}
        <strong>consent</strong>, you can withdraw it at any time without
        affecting earlier processing.
      </p>

      <h2>6. Who we share it with</h2>
      <p>
        Your golf and social activity is, by design, visible to other members of
        the groups you join (for example on leaderboards, the feed and the
        points-based standings). We do not sell your personal data or use it for
        advertising.
      </p>
      <p>
        We use the following trusted third parties ("sub-processors") to run the
        service. They process personal data only on our instructions:
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>What they do</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.purpose}</td>
              <td>{s.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        We may also disclose data where required by law, or to establish,
        exercise or defend legal claims.
      </p>

      <h2>7. International transfers</h2>
      <p>
        Some of our providers are based in, or transfer data to, countries
        outside the UK (including the United States). Where that happens we rely
        on appropriate safeguards recognised under UK law — such as the UK
        International Data Transfer Agreement or Addendum, or a UK adequacy
        decision — to protect your data.
      </p>

      <h2>8. How long we keep it</h2>
      <p>
        We keep your personal data for as long as you have an account, and
        afterwards only as long as needed for the purposes described here or to
        meet legal obligations. Because {SITE_NAME} records shared competitions,
        some data is retained after you leave — see the next section.
      </p>

      <h2>9. What happens when you delete your account</h2>
      <p>
        You can delete your account at any time from your profile screen, or by
        emailing us. Our approach is to store the{" "}
        <strong>minimum information possible</strong> while keeping shared records
        intact for the other members who rely on them. When you delete your
        account:
      </p>
      <ul>
        <li>
          We <strong>permanently delete</strong> your sign-in account and email
          address, your profile photo, your device push subscriptions, your
          calendar/availability data, your follows, invitations you sent, your
          notifications, and any reports you filed.
        </li>
        <li>
          We <strong>keep</strong> the records that are shared with other members
          — your scores, handicap history, group standings, society bookkeeping
          entries, fantasy predictions, and the posts, comments and reactions you
          shared in a group — because deleting them would damage other people's
          rounds, leaderboards and shared history.
        </li>
        <li>
          On those retained records we <strong>shorten your name</strong> to an
          abbreviated form (for example, "James Ware" becomes "J.Ware") and
          detach the records from your account. Deleting whole rounds, removing
          you from other members' scorecards, or erasing shared feed cards would
          break those shared records, so we do not do that automatically.
        </li>
      </ul>
      <p>
        Because a shortened form of your name is retained, this is data
        minimisation rather than complete anonymisation. We retain these records
        on the basis of our and other members' legitimate interests in the
        integrity of shared rounds, leaderboards, seasons and who-owed-what
        records. If you would like us to go further in a particular case, contact
        us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will
        consider your request.
      </p>

      <h2>10. Your rights</h2>
      <p>Under UK data protection law you have the right to:</p>
      <ul>
        <li>be informed about how we use your data (this policy);</li>
        <li><strong>access</strong> a copy of your data;</li>
        <li><strong>rectify</strong> inaccurate or incomplete data;</li>
        <li><strong>erase</strong> your data (subject to section 9);</li>
        <li><strong>restrict</strong> or <strong>object</strong> to certain processing;</li>
        <li><strong>data portability</strong> — receive your data in a machine-readable format.</li>
      </ul>
      <p>
        You can exercise the main rights yourself in the app: use{" "}
        <strong>Download my data</strong> and <strong>Delete account</strong> on
        your profile screen. For anything else, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond
        within one month. There is normally no charge.
      </p>

      <h2>11. Cookies</h2>
      <p>
        We use only strictly-necessary cookies and local storage. Full details
        are in our <Link href="/cookies">Cookie Policy</Link>.
      </p>

      <h2>12. Children</h2>
      <p>
        {SITE_NAME} is not intended for children. You must be at least{" "}
        {MINIMUM_AGE} years old to hold an account. If you believe a child has
        provided us with personal data, contact us and we will remove it.
      </p>

      <h2>13. Security</h2>
      <p>
        We use appropriate technical and organisational measures to protect your
        data, including encrypted transport, access controls and a managed
        authentication provider. No online service can be completely secure, but
        we work to protect your data and will notify you and the ICO of a
        serious breach where the law requires.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We will update the "last
        updated" date above and, for significant changes, let you know in the
        app.
      </p>

      <h2>15. Complaints</h2>
      <p>
        If you have a concern, please contact us first at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. You also have the
        right to complain to the {ICO.name}, the UK supervisory authority, at{" "}
        <a href={ICO.url} target="_blank" rel="noopener noreferrer">
          {ICO.url}
        </a>{" "}
        or on {ICO.helpline}.
      </p>
    </LegalPage>
  );
}
