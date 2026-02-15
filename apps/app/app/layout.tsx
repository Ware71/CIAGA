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
  title: "CIAGA Golf",
  description: "League, live scorecards, rangefinder, AI caddy",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-512.png",
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
