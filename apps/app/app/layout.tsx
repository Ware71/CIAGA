import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OrientationManager } from "@/components/OrientationManager";
import { SandboxDevTools } from "@/components/sandbox/SandboxDevTools";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SplashHost } from "@/components/ui/SplashHost";
import { AppFrame } from "@/components/nav/AppFrame";
import { CookieConsent } from "@/components/CookieConsent";
import { AcceptTermsGate } from "@/components/legal/AcceptTermsGate";
import NextTopLoader from "nextjs-toploader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ---------
// METADATA
// ---------
export const metadata: Metadata = {
  metadataBase: new URL("https://app.ciagagolf.com"), // change to your primary domain
  title: {
    default: "CIAGA Golf",
    template: "%s | CIAGA Golf",
  },
  description: "Golf leagues for friends: live scorecards, GPS rangefinder, stats, and a social feed.",
  applicationName: "CIAGA Golf",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-512.png",
  },
  openGraph: {
    type: "website",
    siteName: "CIAGA Golf",
    title: "CIAGA Golf",
    description:
      "Golf leagues for friends: live scorecards, GPS rangefinder, stats, and a social feed.",
    url: "/",
    images: [
      {
        url: "/og.png", // add this image in /public/og.png
        width: 1200,
        height: 630,
        alt: "CIAGA Golf",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CIAGA Golf",
    description:
      "Golf leagues for friends: live scorecards, GPS rangefinder, stats, and a social feed.",
    images: ["/og.png"],
  },
};

// ---------
// VIEWPORT (iOS + Android UI bar color, disable zoom for native feel)
// ---------
export const viewport: Viewport = {
  themeColor: "#042713",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning: SplashHost's pre-paint script stamps data-splash
  // on <html> before React hydrates, so this element legitimately differs from
  // the server HTML. Same pattern as a theme-flash script; it only suppresses
  // the warning for this element's own attributes.
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        /* No bg utility here: the ground is --ciaga-ground in globals.css,
           which AppFrame repoints per section. A utility would outrank it. */
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-slate-100`}
      >
        <NextTopLoader color="#f5e6b0" height={3} showSpinner={false} shadow="0 0 10px #f5e6b080" />
        <ServiceWorkerRegistrar />
        <OrientationManager />
        {/* Outside {children} on purpose — route Suspense swaps happen in
            there, and the splash must own a single DOM node from first paint
            through to its exit. See components/ui/SplashHost.tsx. */}
        <SplashHost />
        {/* AppFrame owns the bottom nav and the space it reserves. It's a client
            boundary, but children pass through as a prop so pages stay server
            components. */}
        <AppFrame>{children}</AppFrame>
        <AcceptTermsGate />
        <CookieConsent />
        <SandboxDevTools />
      </body>
    </html>
  );
}