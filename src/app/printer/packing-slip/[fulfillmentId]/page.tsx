// Printable white-label packing slip (queue 9, data model §6). PRINTER-only and
// ownership-scoped: the printer id comes from the session, never the URL. The
// slip carries the merchant's brand only — no platform or printer branding and
// no prices. Bilingual EN/AR with RTL, like every other page.

import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth-context";
import { getPackingSlipForPrinter } from "@/lib/packing-slip";
import { getDirection, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/locale";
import { localizedBrandText } from "@/lib/merchant-brand";
import { PrintButton } from "@/components/print-button";
import { slipT } from "../../labels";

export const dynamic = "force-dynamic";

// The root layout titles every page "POD Platform", and browsers print the page
// title on paper — override it so the slip carries no platform name.
export const metadata = { title: " " };

export default async function PackingSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ fulfillmentId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const ctx = await requireRole("PRINTER");
  const { fulfillmentId } = await params;
  const sp = await searchParams;
  const locale: Locale = await getRequestLocale(sp.lang);
  const dir = getDirection(locale);

  const slip = await getPackingSlipForPrinter(ctx.printerId ?? "", fulfillmentId);
  if (!slip) notFound();

  const { order } = slip;
  const slipMessage = localizedBrandText(
    order.merchant.packing_slip_message,
    order.merchant.packing_slip_message_ar,
    locale
  );
  const returnAddress = localizedBrandText(
    order.merchant.return_address,
    order.merchant.return_address_ar,
    locale
  );
  const sep = locale === "ar" ? "، " : ", ";
  const cityLine = [order.shipping_city, order.shipping_emirate, order.shipping_country]
    .filter(Boolean)
    .join(sep);

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex justify-end print:hidden">
          <PrintButton label={slipT("print", locale)} />
        </div>

        <header className="border-b border-gray-300 pb-4">
          {order.merchant.brand_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/printer/brand-logo?fulfillmentId=${encodeURIComponent(slip.id)}`}
              alt={order.merchant.name}
              className="mb-3 max-h-20 max-w-48 object-contain"
            />
          )}
          <h1 className="text-2xl font-bold">{order.merchant.name}</h1>
          <p className="mt-1 text-sm text-gray-600">{slipT("title", locale)}</p>
        </header>

        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-500">
              {slipT("shipTo", locale)}
            </h2>
            <address className="mt-1 not-italic">
              <div>{order.recipient_name}</div>
              <div>{order.shipping_line1}</div>
              {order.shipping_line2 && <div>{order.shipping_line2}</div>}
              {cityLine && <div>{cityLine}</div>}
              {order.recipient_phone && (
                <div dir="ltr" className="text-start">
                  {order.recipient_phone}
                </div>
              )}
            </address>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-500">
              {slipT("orderRef", locale)}
            </h2>
            <p className="mt-1 font-mono" dir="ltr">
              {order.external_order_ref ?? order.id.slice(-8)}
            </p>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-500">
            {slipT("items", locale)}
          </h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-start">
                <th className="py-1 pe-2 text-start font-semibold">
                  {slipT("item", locale)}
                </th>
                <th className="py-1 pe-2 text-start font-semibold">
                  {slipT("options", locale)}
                </th>
                <th className="py-1 text-end font-semibold">
                  {slipT("qty", locale)}
                </th>
              </tr>
            </thead>
            <tbody>
              {slip.lines.map((l) => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="py-1 pe-2">
                    {locale === "ar" ? l.product.name_ar : l.product.name_en}
                  </td>
                  <td className="py-1 pe-2">
                    {[l.variant.size, l.variant.color].filter(Boolean).join(" / ")}
                  </td>
                  <td className="py-1 text-end" dir="ltr">
                    {l.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {slipMessage && (
          <section className="mt-8 whitespace-pre-line rounded-md border border-gray-200 p-4">
            {slipMessage}
          </section>
        )}

        {returnAddress && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-gray-500">
              {slipT("returnAddress", locale)}
            </h2>
            <p className="mt-1 whitespace-pre-line">
              {returnAddress}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
