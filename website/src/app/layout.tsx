import type { Metadata } from "next";
import { Geist, Geist_Mono, Roboto, Merriweather } from "next/font/google";
import "./globals.css";

// Public article template keeps Geist (see magazine.css --sans). Do not remove.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Admin dashboard typography: Roboto headings / Merriweather body.
const roboto = Roboto({
  variable: "--font-roboto",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const merriweather = Merriweather({
  variable: "--font-merriweather",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TERRYTORY",
  description: "Independent, AI-assisted journalism across technology, AI, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${roboto.variable} ${merriweather.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
