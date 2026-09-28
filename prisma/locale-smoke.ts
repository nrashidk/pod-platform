// Smoke test for locale resolution (src/lib/i18n.ts + src/middleware.ts).
// No database needed. Order: ?lang= → cookie → default; junk is ignored; the
// middleware forwards the resolved locale, remembers an explicit ?lang= in a
// cookie, and keeps the language through the /ops → /login bounce.
// Run: npm run test:locale
import { NextRequest } from "next/server";
import { LOCALE_COOKIE, LOCALE_HEADER, getDirection, resolveLocale } from "../src/lib/i18n";
import { middleware } from "../src/middleware";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// pure resolution
check("query beats cookie", resolveLocale("ar", "en") === "ar");
check("cookie used when no query", resolveLocale(null, "ar") === "ar");
check("default en", resolveLocale(undefined, undefined) === "en");
check("junk query falls through to cookie", resolveLocale("fr", "ar") === "ar");
check("junk everything → default", resolveLocale("xx", "yy") === "en");
check("ar is rtl, en is ltr", getDirection("ar") === "rtl" && getDirection("en") === "ltr");

const mk = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
const fwd = (res: Response) => res.headers.get(`x-middleware-request-${LOCALE_HEADER}`);
const setCookie = (res: Response) => res.headers.get("set-cookie") ?? "";

// middleware: page request
let res = middleware(mk("/merchant?lang=ar"));
check("forwards ?lang=ar", fwd(res) === "ar", fwd(res));
check("remembers ?lang=ar in cookie", setCookie(res).includes(`${LOCALE_COOKIE}=ar`), setCookie(res));

res = middleware(mk("/merchant", `${LOCALE_COOKIE}=ar`));
check("cookie drives locale without query", fwd(res) === "ar", fwd(res));
check("no cookie re-set when unchanged", !setCookie(res).includes(LOCALE_COOKIE), setCookie(res));

res = middleware(mk("/merchant"));
check("default en with nothing", fwd(res) === "en", fwd(res));

res = middleware(mk("/merchant?lang=zz", `${LOCALE_COOKIE}=ar`));
check("junk query ignored, cookie kept", fwd(res) === "ar" && !setCookie(res).includes("zz"), [fwd(res), setCookie(res)]);

// middleware: /ops auth bounce keeps the language
res = middleware(mk("/ops?lang=ar"));
const loc = res.headers.get("location") ?? "";
check("/ops anonymous → /login", new URL(loc, "http://x").pathname === "/login", loc);
check("login redirect keeps lang=ar (query)", new URL(loc, "http://x").searchParams.get("lang") === "ar", loc);

res = middleware(mk("/ops/billing", `${LOCALE_COOKIE}=ar`));
check("login redirect keeps lang from cookie", new URL(res.headers.get("location") ?? "", "http://x").searchParams.get("lang") === "ar");

// non-/ops pages are never bounced
res = middleware(mk("/merchant?lang=en"));
check("/merchant not auth-bounced by middleware", !res.headers.get("location"));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nlocale smoke OK");
