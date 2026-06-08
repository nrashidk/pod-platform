// Shared status pills for the merchant surfaces (dashboard + orders + designs).
// Presentation only — each takes an enum value + locale, resolves the bilingual
// label via the existing label helpers, and maps the value to a semantic tone
// from the design tokens. Tones mirror the lifecycle groupings the ops view uses
// (delivered/closed = ok, shipped = info, in production = prod, cancelled =
// danger, flagged = warn), just with the warmer merchant palette.

import type { FulfillmentStatus, OrderStatus } from "@prisma/client";
import type { Locale } from "@/lib/i18n";
import {
  orderStatusLabel,
  fulfillmentStatusLabel,
  statusLabelFor,
  t,
} from "./labels";

type Tone = "ok" | "info" | "prod" | "warn" | "danger" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  info: "bg-info-bg text-info-fg",
  prod: "bg-prod-bg text-prod-fg",
  warn: "bg-warn-bg text-warn-fg",
  danger: "bg-danger-bg text-danger-fg",
  neutral: "bg-inset text-muted ring-1 ring-inset ring-hairline",
};

export function Badge({
  tone,
  children,
  dot = true,
}: {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[tone]}`}
    >
      {dot && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
        />
      )}
      {children}
    </span>
  );
}

function orderTone(status: OrderStatus): Tone {
  if (status === "CLOSED" || status === "DELIVERED") return "ok";
  if (status === "CANCELLED") return "danger";
  if (
    status === "SHIPPED" ||
    status === "PARTIALLY_SHIPPED" ||
    status === "PARTIALLY_DELIVERED"
  )
    return "info";
  if (status === "IN_PRODUCTION") return "prod";
  return "neutral";
}

export function OrderStatusBadge({
  status,
  locale,
}: {
  status: OrderStatus;
  locale: Locale;
}) {
  return <Badge tone={orderTone(status)}>{orderStatusLabel(status, locale)}</Badge>;
}

function fulfillmentTone(status: FulfillmentStatus): Tone {
  if (status === "CLOSED" || status === "DELIVERED") return "ok";
  if (status === "CANCELLED") return "danger";
  if (status === "SHIPPED") return "info";
  if (status === "IN_PRODUCTION" || status === "DIGITIZING") return "prod";
  return "neutral";
}

export function FulfillmentStatusBadge({
  status,
  locale,
}: {
  status: FulfillmentStatus;
  locale: Locale;
}) {
  return (
    <Badge tone={fulfillmentTone(status)}>
      {fulfillmentStatusLabel(status, locale)}
    </Badge>
  );
}

type DesignPlacementStatus = "PASSED" | "FLAGGED" | "PENDING" | "NONE";

function designStatusTone(status: DesignPlacementStatus): Tone {
  if (status === "PASSED") return "ok";
  if (status === "FLAGGED") return "warn";
  if (status === "PENDING") return "info";
  return "neutral";
}

export function DesignStatusBadge({
  status,
  locale,
}: {
  status: DesignPlacementStatus;
  locale: Locale;
}) {
  return (
    <Badge tone={designStatusTone(status)}>{statusLabelFor(status, locale)}</Badge>
  );
}

export function OrderableBadge({
  orderable,
  locale,
}: {
  orderable: boolean;
  locale: Locale;
}) {
  return (
    <Badge tone={orderable ? "ok" : "neutral"}>
      {orderable ? t("orderable", locale) : t("notOrderable", locale)}
    </Badge>
  );
}
