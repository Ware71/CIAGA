/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import {
  SITE_NAME,
  OPERATOR_NAME,
  OPERATOR_DESCRIPTOR,
  CONTACT_EMAIL,
  POSTAL_ADDRESS,
  LAST_UPDATED,
} from "@/lib/legal";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "Legal",
  description: `Legal policies and operator information for ${SITE_NAME}.`,
  alternates: { canonical: "/legal" },
};

const docs = [
  { href: "/privacy", title: "Privacy Policy", desc: "How we collect, use and protect your personal data, and your rights." },
  { href: "/terms", title: "Terms of Use", desc: "The agreement governing your use of the Service." },
  { href: "/cookies", title: "Cookie Policy", desc: "The cookies and local storage we use, and your choices." },
  { href: "/acceptable-use", title: "Acceptable Use Policy", desc: "The rules for content and conduct." },
  { href: "/copyright", title: "Copyright & Takedown", desc: "How to report copyright infringement (DMCA / UK)." },
];

export default function LegalIndexPage() {
  return (
    <main id="main" className="min-h-screen bg-[#042713] text-emerald-50">
      <SiteHeader variant="legal" />

      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#f5e6b0] sm:text-4xl">
          Legal
        </h1>
        <p className="mt-2 text-sm text-emerald-200/80">
          Last updated: {LAST_UPDATED}
        </p>
        <p className="mt-4 text-pretty text-lg text-emerald-100/80">
          Our policies and the information you're entitled to about who runs{" "}
          {SITE_NAME}.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {docs.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 transition-colors hover:border-emerald-800/70 hover:bg-[#0b3b21]"
            >
              <p className="text-sm font-extrabold text-[#f5e6b0]">{d.title}</p>
              <p className="mt-2 text-sm text-emerald-100/75">{d.desc}</p>
            </Link>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-emerald-900/60 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 p-6">
          <h2 className="text-lg font-bold text-[#f5e6b0]">
            Who operates {SITE_NAME}
          </h2>
          <p className="mt-3 text-sm text-emerald-100/80">
            {SITE_NAME} is operated by <strong className="font-semibold text-[#f5e6b0]">{OPERATOR_NAME}</strong>,{" "}
            {OPERATOR_DESCRIPTOR}.
          </p>
          <dl className="mt-4 space-y-2 text-sm text-emerald-100/80">
            <div>
              <dt className="inline font-semibold text-emerald-50">Contact: </dt>
              <dd className="inline">
                <a
                  className="text-[#f5e6b0] underline underline-offset-2 transition-colors hover:text-[#e9d79c]"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  {CONTACT_EMAIL}
                </a>
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-emerald-50">Address: </dt>
              <dd className="inline">
                {POSTAL_ADDRESS ? POSTAL_ADDRESS : "Available on written request to the contact email above."}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </main>
  );
}
