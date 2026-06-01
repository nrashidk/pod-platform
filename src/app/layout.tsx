import type { Metadata } from "next";
import { defaultLocale, getDirection } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "POD Platform",
  description: "UAE/GCC print-on-demand orchestrator",
};

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
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
