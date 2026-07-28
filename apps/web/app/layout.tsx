import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { CookieConsent } from "@/components/site/CookieConsent";
import { SITE_NAME, WEB_URL } from "@/lib/legal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "CIAGA — the golf society app";
const DESCRIPTION =
  "Golf society software: live scoring in twelve formats, handicaps, majors and seasons, stats, a group feed and a free virtual-points prediction game.";

// ---------
// METADATA
// ---------
export const metadata: Metadata = {
  // The marketing site, NOT app.ciagagolf.com — this used to point at the app
  // subdomain, which made every canonical and OG URL on the site wrong.
  metadataBase: new URL(WEB_URL),
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  // No `manifest` here on purpose: app.ciagagolf.com is the installable PWA.
  // A manifest on the marketing domain would prompt people to install the
  // brochure as a second home-screen icon. Icons come from the app/icon.png
  // and app/apple-icon.png file conventions.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_GB",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// ---------
// VIEWPORT (iOS + Android UI bar color)
// ---------
export const viewport: Viewport = {
  themeColor: "#042713", // Green status bar
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The next/font variable classes MUST be on <html>, not <body>: Tailwind's
    // preflight sets font-family on `html` from --font-sans, which resolves to
    // var(--font-geist-sans). next/font scopes that variable to whichever
    // element carries the class, so with it on <body> the variable is undefined
    // where preflight reads it and Geist never applies.
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="antialiased bg-[#042713] text-emerald-50">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 ciaga-cta"
        >
          Skip to content
        </a>
        {children}
        <Footer />
        <CookieConsent />
      </body>
    </html>
  );
}
