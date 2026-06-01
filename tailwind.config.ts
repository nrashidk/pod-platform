import type { Config } from "tailwindcss";

// RTL note: Tailwind's built-in `rtl:` / `ltr:` variants and logical-property
// utilities (ms-/me-, ps-/pe-, start-/end-, text-start/text-end) react to the
// `dir` attribute set on <html> by the locale-driven root layout. Prefer those
// over left/right utilities so EN (ltr) and AR (rtl) both lay out correctly.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
