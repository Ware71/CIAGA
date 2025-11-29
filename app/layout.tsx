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
  themeColor: "#d4af37", // 🌟 CIAGA GOLD
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

// ---------
// VIEWPORT (iOS + Android UI bar color)
// ---------
export const viewport: Viewport = {
  themeColor: "#d4af37",               // GOLD status bar
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
