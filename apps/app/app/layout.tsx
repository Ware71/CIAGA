import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#042713] text-slate-100`}
      >
        {children}
      </body>
    </html>
  );
}