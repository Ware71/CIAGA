/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  SITE_NAME,
  OPERATOR_NAME,
  OPERATOR_DESCRIPTOR,
  CONTACT_EMAIL,
  POSTAL_ADDRESS,
  LAST_UPDATED,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Legal",
  description: `Legal policies and operator information for ${SITE_NAME}.`,
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
    <main className="min-h-screen bg-white text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/ciaga-logo.png" alt="CIAGA" width={30} height={30} className="rounded" />
            <span className="text-sm font-semibold tracking-wide">CIAGA</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Legal</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>
        <p className="mt-4 text-pretty text-lg text-zinc-700">
          Our policies and the information you're entitled to about who runs {SITE_NAME}.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {docs.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              <p className="text-sm font-semibold">{d.title}</p>
              <p className="mt-2 text-sm text-zinc-700">{d.desc}</p>
            </Link>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
          <h2 className="text-lg font-bold">Who operates {SITE_NAME}</h2>
          <p className="mt-3 text-sm text-zinc-700">
            {SITE_NAME} is operated by <strong>{OPERATOR_NAME}</strong>,{" "}
            {OPERATOR_DESCRIPTOR}.
          </p>
          <dl className="mt-4 space-y-2 text-sm text-zinc-700">
            <div>
              <dt className="inline font-semibold">Contact: </dt>
              <dd className="inline">
                <a className="text-emerald-700 underline" href={`mailto:${CONTACT_EMAIL}`}>
                  {CONTACT_EMAIL}
                </a>
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Address: </dt>
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
