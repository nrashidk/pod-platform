import type { Config } from "tailwindcss";

// RTL note: Tailwind's built-in `rtl:` / `ltr:` variants and logical-property
// utilities (ms-/me-, ps-/pe-, start-/end-, text-start/text-end) react to the
// `dir` attribute set on <html> by the locale-driven root layout. Prefer those
// over left/right utilities so EN (ltr) and AR (rtl) both lay out correctly.
//
// DESIGN TOKENS — the merchant experience design system ("trusted operations
// desk"): warm sand neutrals, a deep ledger-teal brand, restrained gold accent,
// and warmer-than-default semantic status colors. Internal surfaces (/ops,
// /printer) don't consume these — they keep Tailwind's plain defaults.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm neutrals (replace the cold gray scale on merchant surfaces).
        canvas: "#FAF7F2", // page background — warm off-white sand
        surface: "#FFFFFF", // cards
        inset: "#F4EFE8", // nested / expanded panels
        hairline: "#E7E0D6", // borders
        "hairline-strong": "#D8CFC1",
        ink: "#1C1B18", // primary text — warm near-black
        muted: "#6B6459", // secondary text
        faint: "#9A9183", // tertiary text

        // Brand — deep ledger-teal (trust, money, GCC).
        brand: {
          50: "#E8F2EF",
          600: "#14705F",
          700: "#0E5A4E",
          800: "#0A4A40",
        },

        // Restrained gold accent.
        gold: {
          50: "#FBEFD8",
          600: "#A87C30",
        },

        // Semantic status surfaces — { bg, fg } pairs map to
        // `bg-<name>-bg` / `text-<name>-fg`.
        ok: { bg: "#E3F0E8", fg: "#14633F" }, // orderable / passed / delivered
        warn: { bg: "#FBEFD8", fg: "#8A5A12" }, // flagged / low balance
        info: { bg: "#E4EEF5", fg: "#1F567E" }, // processing / shipped
        prod: { bg: "#E7E9F3", fg: "#3A3F77" }, // in production
        danger: { bg: "#F8E6E3", fg: "#9B3A2C" }, // cancelled
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,27,24,0.04), 0 1px 3px rgba(28,27,24,0.06)",
        "card-hover": "0 6px 16px rgba(28,27,24,0.08)",
        bar: "0 1px 0 rgba(28,27,24,0.06)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        rise: "rise 0.45s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
