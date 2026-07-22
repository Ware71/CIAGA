/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SITE_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: `The cookies and local storage ${SITE_NAME} uses, and how to manage them.`,
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      intro={`This policy explains the cookies and similar storage technologies ${SITE_NAME} uses. In short: we use only what is strictly necessary to run the app and keep you signed in — no advertising, analytics or tracking cookies.`}
    >
      <h2>1. What we use, and why</h2>
      <p>
        Under the Privacy and Electronic Communications Regulations (PECR), a
        service may set <strong>strictly-necessary</strong> cookies without
        consent, but must still tell you about them. That is the category
        everything below falls into today.
      </p>

      <h2>2. Cookies</h2>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Purpose</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>sb-*</code> (authentication)</td>
            <td>Keeps you securely signed in between visits. Set by our authentication provider (Supabase).</td>
            <td>Strictly necessary</td>
          </tr>
        </tbody>
      </table>

      <h2>3. Other local storage</h2>
      <p>
        The app also stores a small amount of information{" "}
        <strong>on your device</strong> (not sent to us as cookies) to make it
        work well and feel like a native app:
      </p>
      <table>
        <thead>
          <tr>
            <th>Technology</th>
            <th>What it stores</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Local storage</td>
            <td>Your interface preferences (e.g. odds display format), your in-progress bet slip, "seen" markers for the feed, and whether you have dismissed prompts.</td>
          </tr>
          <tr>
            <td>Service worker &amp; Cache Storage / IndexedDB</td>
            <td>Offline caching of the app so it loads quickly and works as an installed app (Progressive Web App).</td>
          </tr>
          <tr>
            <td>Push subscription</td>
            <td>If you enable notifications, your browser creates a push subscription so we can send them. You can turn this off in your browser or device settings at any time.</td>
          </tr>
        </tbody>
      </table>

      <h2>4. Your choices</h2>
      <p>
        Because we currently use only strictly-necessary cookies, a consent
        banner is not legally required — but we show one so you always know
        what's happening and are ready if we ever add optional cookies. You can:
      </p>
      <ul>
        <li>review your choices at any time from <strong>Cookie preferences</strong> on your profile screen in the app;</li>
        <li>block or delete cookies in your browser settings (note that blocking the essential sign-in cookie will stop you being able to log in);</li>
        <li>manage notifications and clear cached data from your browser or device settings.</li>
      </ul>

      <h2>5. If this changes</h2>
      <p>
        We do not currently use any analytics, advertising or third-party
        tracking cookies. If we ever introduce optional cookies, we will ask for
        your consent through the banner before setting them and update this
        policy.
      </p>

      <h2>6. More information</h2>
      <p>
        See our <Link href="/privacy">Privacy Policy</Link> for how we handle
        personal data, or contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
