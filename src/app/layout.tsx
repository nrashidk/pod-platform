import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from "next/font/google";
import { defaultLocale, getDirection } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "POD Platform",
  description: "UAE/GCC print-on-demand orchestrator",
};

// One bilingual superfamily for the whole UI: IBM Plex Sans Arabic carries BOTH
// Latin and Arabic in a single cohesive voice, so EN (ltr) and AR (rtl) read as
// the same design — not a script bolted on. IBM Plex Mono is reserved for
// numerals (wallet balance, order totals, order ids). Exposed as CSS variables
// that tailwind.config maps onto `font-sans` / `font-mono`.
const sans = IBM_Plex_Sans_Arabic({
  subsets: ["latin", "arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Locale-driven lang/dir. For now we fall back to the default locale; once
  // locale resolution exists (middleware / [locale] segment), pass the resolved
  // locale here and `lang` + `dir` follow automatically — RTL included.
  const locale = defaultLocale;
  const dir = getDirection(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${sans.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
