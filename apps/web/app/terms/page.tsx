/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import {
  SITE_NAME,
  OPERATOR_NAME,
  OPERATOR_DESCRIPTOR,
  CONTACT_EMAIL,
  GOVERNING_LAW,
  MINIMUM_AGE,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: `The terms governing your use of ${SITE_NAME}.`,
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={`These terms are a legal agreement between you and ${OPERATOR_NAME} governing your use of ${SITE_NAME}. Please read them carefully.`}
    >
      <h2>1. Who we are and these terms</h2>
      <p>
        {SITE_NAME} ("the Service") is operated by {OPERATOR_NAME},{" "}
        {OPERATOR_DESCRIPTOR} ("we", "us", "our"). By creating an account or
        using the Service you agree to these Terms of Use, our{" "}
        <Link href="/privacy">Privacy Policy</Link>,{" "}
        <Link href="/cookies">Cookie Policy</Link> and{" "}
        <Link href="/acceptable-use">Acceptable Use Policy</Link>. If you do not
        agree, do not use the Service.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least {MINIMUM_AGE} years old to hold an account and you
        must provide accurate registration details. By registering you confirm
        that you meet this requirement.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>You are responsible for keeping your login details secure and for activity under your account.</li>
        <li>Tell us promptly at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you suspect unauthorised use.</li>
        <li>You may add other people to the Service (for example inviting a friend or adding a player to a round). If you do, you confirm you have a legitimate reason to provide their details, and you must remove them on request. See the "managed profiles" section of our <Link href="/privacy">Privacy Policy</Link>.</li>
      </ul>

      <h2>4. What the Service is</h2>
      <p>
        {SITE_NAME} helps golf groups and societies track rounds, handicaps,
        statistics, competitions and a social feed, and run a light-hearted
        prediction game. It is provided for recreational and social use.
      </p>

      <h2>5. Fantasy points have no monetary value</h2>
      <div className="note">
        <p>
          The fantasy prediction game uses <strong>virtual points only</strong>.
          Points are not money, are not currency, and have{" "}
          <strong>no monetary value</strong>. They cannot be bought, sold,
          transferred for value, withdrawn, or exchanged for money, goods or
          prizes. "Top-ups", "stakes", "cash-out" and "winnings" in the game
          refer solely to virtual points within the Service.
        </p>
      </div>
      <p>
        The prediction game is a free social feature and is not a betting,
        gaming or gambling service.
      </p>

      <h2>6. Money between members — we do not handle it</h2>
      <div className="note">
        <p>
          {SITE_NAME} may record real-world amounts within a group (such as green
          fees, entry fees, expenses or prize money) as a{" "}
          <strong>bookkeeping convenience</strong>. These figures are a shared
          ledger only.
        </p>
      </div>
      <ul>
        <li>We <strong>do not</strong> take, hold, transfer or process any payments, and we are not a payment service, e-money provider or escrow.</li>
        <li>All real-world money, debts, collections and prize distribution are arranged <strong>directly between members and their society/organiser</strong>, entirely off the Service.</li>
        <li>The society or organiser who records the figures is solely responsible for their accuracy and for any settlement. We are not a party to, and accept no responsibility for, any financial arrangement between members.</li>
        <li>Any prize competitions organised by a society are run by that society. You are responsible for ensuring your group's activities comply with any laws that apply to them.</li>
      </ul>

      <h2>7. Your content</h2>
      <p>
        You keep ownership of the content you post (such as photos, posts and
        comments). You grant us a non-exclusive, worldwide, royalty-free licence
        to host, store, display and share that content within the Service for the
        purpose of operating it. You are responsible for your content and must
        follow our <Link href="/acceptable-use">Acceptable Use Policy</Link>. We
        may remove content or restrict accounts that breach these terms.
      </p>

      <h2>8. Acceptable use</h2>
      <p>
        You must not misuse the Service. Prohibited conduct is set out in our{" "}
        <Link href="/acceptable-use">Acceptable Use Policy</Link>, which forms
        part of these terms. If you believe content infringes your copyright, see
        our <Link href="/copyright">Copyright &amp; Takedown Policy</Link>.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        The Service is provided "as is" and "as available". We may change,
        suspend or withdraw features, and we do not guarantee it will be
        uninterrupted or error-free. Handicap, scoring and statistics are
        provided for convenience and are not guaranteed to be free of errors; you
        should not rely on them for official handicapping without checking.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        To the extent permitted by law, we exclude all implied warranties. We do
        not warrant that the Service will meet your requirements or that content
        provided by other members is accurate.
      </p>

      <h2>11. Our liability</h2>
      <p>
        Nothing in these terms limits liability that cannot be limited by law
        (including for death or personal injury caused by negligence, or for
        fraud). Subject to that, we are not liable for: loss arising from money
        or arrangements between members; loss of profit, data or goodwill; or any
        indirect or consequential loss. Because the Service is provided free of
        charge for recreational use, our total liability to you for any claim is
        limited to £100.
      </p>
      <p>
        If you are a consumer, you have legal rights that these terms do not
        affect.
      </p>

      <h2>12. Suspension and termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We
        may suspend or terminate your access if you breach these terms or the
        Acceptable Use Policy.
      </p>
      <p>
        When you delete your account, we remove your login, email address, photo
        and private data, but we <strong>keep the records you share with other
        members</strong> — such as rounds, scores, standings and the posts you
        made in a group — with your name shortened to an abbreviated form (for
        example "J.Ware"). We do this so that shared cards, scorecards and
        competition history remain intact for everyone else. Full details are in
        our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms. We will update the "last updated" date above
        and, for significant changes, ask you to review and accept the updated
        terms in the app. Continuing to use the Service after changes take effect
        means you accept them.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These terms and any dispute arising from them are governed by the law of{" "}
        {GOVERNING_LAW}, and the courts of {GOVERNING_LAW} have exclusive
        jurisdiction (this does not remove any mandatory protections you have as a
        consumer in your country of residence).
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Our full contact
        details are on our <Link href="/legal">Legal</Link> page.
      </p>
    </LegalPage>
  );
}
