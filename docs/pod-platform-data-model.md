# POD Platform — Data Model & Order Lifecycle (v1 Spec)

UAE/GCC print-on-demand orchestrator, Printful-model. Buyer designs → platform routes to capable printer → printer blind-ships under the merchant's brand. Platform never produces; routing, design tooling, and money flow are the product.

Stack target: Next.js / Prisma / PostgreSQL (Neon) on Vercel. Bilingual EN/AR with RTL throughout (non-negotiable).

---

## 0. Money model: pure Printful, one flow (Reading B)

The platform never holds buyer funds — not even on its own storefront. There is effectively **one money flow**, and "your own store" is just the first store connected to the platform. This is the lightest licensing path and the actual Printful model.

| Step | Who |
|---|---|
| Buyer pays | The store's payment gateway (your own store's gateway, or a connected merchant's) |
| Platform holds buyer money? | **Never** |
| Platform bills for fulfillment | The store owner (you, or the connected merchant) via wallet / auto-charge |
| Platform pays printer | Wholesale |
| Platform margin | Spread between fulfillment charge and wholesale cost |

`Order.origination` ∈ { `OWN_STORE`, `CONNECTED_STORE` } still exists, but only to distinguish *who owns the customer relationship and brand* — **not** to switch money models. The money flow is identical for both. Own-store = the platform owner is also the store owner.

**Consequence — accept on purpose:** with no held funds, quality is guaranteed *only* by (1) locked mockup approval, (2) print-file spec validation, (3) the 30-day reprint/refund policy. There is no escrow backstop. This makes print-file validation a load-bearing safety layer, not a nice-to-have. The earlier "hold money to guarantee quality" idea is permanently dead.

License note: still need the right UAE entity + gateway to operate a store and bill for fulfillment, but you are NOT a custodian of third-party consumer funds — which is the lighter regulatory position. (You are handling license research.)

---

## 1. Core entities

### Printer (fulfillment provider)
- id, name, status (active/paused), location (emirate/country)
- blind_ship_confirmed (bool — gate: no routing until true)
- return_address
- payout_terms
- **capabilities** → see PrinterCapability
- SLA fields: production_lead_days, capacity signal

### PrinterCapability (the routing matrix)
The join that makes capability-based routing work. One row per printer × product × method.
- printer_id
- product_type_id
- print_method ∈ { DTG, SUBLIMATION, EMBROIDERY, UV, DTF, ... }
- print_area (dimensions in mm/inches)
- print_file_spec → required DPI, format (PNG/JPEG), color profile (sRGB), max file size, bleed
- requires_digitization (bool — true for EMBROIDERY)
- min_qty, max_qty
- unit_wholesale_cost (may be tiered → see PricingTier)

> An order line is routable only to printers whose capability row matches its product + method. Catalog availability = union of all active capabilities.

### ProductType
- id, name_en, name_ar
- category (apparel / drinkware / paper / accessories / ...)
- base_print_areas (front/back/sleeve/wrap — each with its own spec)
- Listable only if ≥1 active PrinterCapability exists for it.

### Product (catalog item buyer sees)
- id, product_type_id, name_en, name_ar, description_en, description_ar
- variants → ProductVariant (size × color, etc.)
- retail_price (or pricing rule)
- Decoupled from printer — buyer never sees which printer fulfills.

### Design (reusable, separate from product — point 7)
- id, owner (merchant or buyer), name
- **mockup_render** (preview artifact — NOT for production)
- **print_file** (production artifact — passes PrintFileSpec validation)
- print_file_validation_status ∈ { PENDING, PASSED, FLAGGED }
- A Design can be applied across multiple Products (apply-logo-to-whole-line).

### ProductTemplate
- Design + Product + placement config, reusable, pushable to a connected store.

### Merchant (connected-store seller)
- id, business info, license/VAT details
- brand_assets (logo, packing-slip message, custom packaging on file, return address) — flow to printer per order for double-blind
- wallet_balance, auto_recharge_config (Printful wallet model)
- connected_stores → StoreConnection

### StoreConnection
- merchant_id, platform ∈ { SHOPIFY, SALLA, ZID, WOOCOMMERCE, ... }, credentials/tokens, webhook config, sync status
- The interchangeable adapter layer. Core never cares which platform.

---

## 2. The two-file pipeline (point 1 — the critical correction)

Mockup ≠ print file. Two distinct artifacts, two distinct roles.

| | Mockup | Print file |
|---|---|---|
| Purpose | On-screen preview the buyer approves | Artwork actually sent to printer |
| Fidelity | Reference only | Production-grade |
| Validation | Visual approval (buyer) | Spec validation (system): DPI, dimensions, format, color profile, transparency |
| Failure mode | Buyer dislikes design → revise (free, unlimited) | Low-res / wrong format → FLAGGED before order can proceed |

**Rule:** buyer approval of the mockup locks the *design intent*; print-file spec validation locks the *production quality*. Both must pass before an order leaves for the printer. A pretty mockup built from a bad print file must still be blocked at upload — this is what protects the liability split.

**Embroidery sub-pipeline (point 3):** if `requires_digitization`, the design goes through a digitization step producing a stitch file; the digitization preview (more accurate than the mockup) becomes the approval artifact for that line.

---

## 3. Revised order structure (point 8 — order ≠ single shipment)

One order can split across printers and arrive as multiple parcels.

```
Order
 ├─ origination (OWN_STORE | CONNECTED_STORE) — distinguishes brand/customer ownership only, NOT money model
 ├─ buyer / merchant refs
 ├─ branding_source (store owner's brand — merchant for CONNECTED_STORE, yours for OWN_STORE)
 ├─ money: retail_total, currency, payment_status
 └─ OrderLine[]
       ├─ product + variant + design (mockup + validated print_file)
       ├─ quantity
       └─ required_capability (product_type + method)

Fulfillment   (one per printer the order is split to — the unit of liability, shipping, tracking, and claims)
 ├─ order_id, printer_id
 ├─ OrderLine[] routed to this printer
 ├─ wholesale_cost
 ├─ status (see lifecycle)
 ├─ estimated_delivery (production_lead + shipping_time)
 └─ Shipment[]
       ├─ tracking_number, carrier
       ├─ packing_slip (white-label: merchant brand, no printer/platform branding)
       ├─ proof_of_delivery
       └─ delivered_at
```

**Split orders are contained, not chaotic — the Fulfillment is the boundary of fault.** A split happens only when products need different capabilities (shirt + mug). Consequences, all localized to one Fulfillment:
- A defect or missing item belongs to exactly one Fulfillment → one printer → one responsible party. The other parcels are untouched.
- Each Fulfillment ships, tracks, and is claimed independently (separate tracking, POD, 30-day window).
- **Order status is composite** — an aggregate of its Fulfillments (e.g. "A delivered, B in production"), never a single value.
- **Refunds can be partial** — refund the defective line/Fulfillment, not the whole order.
- Buyer is told upfront the order arrives in multiple parcels.

### Routing algorithm (Printful model + cost dimension)

Printful routes on capability → location → capacity. Because Printful owns all its facilities, it has no cost dimension. You pay independent printers different wholesale rates, so **cost is an added factor Printful doesn't need.** This is your one justified deviation.

Per order:

1. **Group lines by required capability.** Lines needing the same capability (product_type + method) stay together. Lines needing different capabilities (e.g. shirt + mug) are separated — this is the *only* reason an order splits. Quantity is never divided across printers; 10 identical shirts go to one printer, not spread across five.

2. **Filter to eligible printers** (the capability gate). For each capability group, keep only printers whose active PrinterCapability matches product_type + method + can meet quantity. If none → order can't be fulfilled (block at checkout / flag).

3. **Rank the eligible printers.** The store owner does NOT choose the printer and never sees it — routing is automatic and hidden (protects margin, prevents leakage). Confirmed priority for the UAE:

   1. **Capability** — hard gate (must be able to make the item + method + quantity).
   2. **Capacity** — hard gate, not a weight. A printer over its load threshold drops out of eligibility entirely. Rationale: a late order from a backed-up cheap printer damages the brand more than the margin saved.
   3. **Cost** — primary ranking factor among survivors. Cheapest wholesale wins. This is the real margin lever, because unlike Printful you pay independent shops different rates.
   4. **Proximity** — tiebreaker only. Weak differentiator domestically (the whole UAE is next-day regardless of emirate); gains weight only as you expand GCC-wide (Saudi, Oman).

   This deliberately **inverts Printful's location-first weighting** — correct because your geography is small and your costs vary, the opposite of Printful's continent-spanning, uniform-internal-cost situation. Copy Printful's *model*, not its *weights*.

   *Watch:* cost-first concentrates volume on the cheapest printer → deepens single-printer dependency (already a risk with only two printers). As the network grows, add a small load-balancing factor so neglected printers don't drop you. Do not solve in v1; note it.

4. **Assign** each capability group to its top-ranked printer → one Fulfillment per chosen printer. One printer may take multiple groups if it's eligible for all of them (avoids unnecessary splits — fewer parcels, fewer shipping fees, fewer defect surfaces).

> Net rule: **capability gate → rank eligible printers by cost + proximity + capacity → assign.** Same skeleton as Printful, with cost added because your printers are independent.

---

## 4. Order lifecycle (states)

```
DRAFT
  → design created, mockup generated, buyer iterates (unlimited free revisions)

MOCKUP_APPROVED            ← buyer locks design intent (timestamped)
PRINT_FILE_VALIDATED       ← system confirms file passes spec (PASSED)
  (both required to proceed)
  estimated_delivery shown at checkout = production_lead_days + shipping_time,
  computed per order from the assigned printer + carrier.

PAYMENT
  Buyer pays the store's gateway (own store or connected merchant) — platform never holds it.
  Store owner is billed for fulfillment (wallet / auto-charge), Printful-style.
  No escrow / payment-release hold — production starts on payment.

ROUTED                     ← split into Fulfillments, assigned to printers
IN_PRODUCTION              ← per Fulfillment (embroidery: + digitization step)
SHIPPED                    ← per Shipment, tracking issued, blind/white-label
DELIVERED                  ← proof of delivery recorded  (starts defect-claim window)

  ─ Defect-claim window: 30 days from receipt (Printful standard).
      Manufacturing error/damage → free reprint or refund per §5. Photo proof required.

CLOSED                     ← claim window passed
```

No payment-release timer. Printful does not escrow buyer funds or gate printer payment behind buyer validation — production starts on payment, defects handled after the fact via the 30-day claim window. Printer payment follows your wholesale agreement terms, not a buyer-validation gate.

---

## 5. Exception branches (points 5 & 6 — copy Printful)

| Event | Liability | Action |
|---|---|---|
| Manufacturing error / damaged / misprint | Provider (printer) | Free reprint or refund; no product return required; photo proof; claim ≤30 days from receipt |
| Buyer remorse (wrong size chosen, changed mind) | Buyer | Not covered; replacement at buyer's/merchant's expense |
| Print ≠ approved mockup | Printer | Free reprint (failed to execute approved design) |
| Design wrong *as approved* | Buyer | Not covered (mockup approval was the contract) |
| Printer can't fulfill after assignment | Platform ops | Reroute to alternate capable printer, else refund |
| Lost in transit (confirmed) | Carrier → platform covers | Replacement reship |
| Undeliverable (bad address / unclaimed) | Buyer/merchant | Returns to printer, held 30 days; contact customer; reship is paid |

Defect claims always require photo upload (reuse existing Vercel Blob pipeline).

---

## 5b. Printer payment & defect protection (the mediator's exposure)

You are a reseller, not Printful — when a printer is at fault, you owe the buyer a reprint/refund but must recover the cost from an independent shop. Printful never had this problem (it owns its facilities). This is the structural cost of the asset-light model: weak post-defect leverage over suppliers. Strategy = prevent defects, retain on high-value orders, net the rest, drop bad printers.

**Prevention (primary — cheaper than recovery):**
- Locked print file + spec validation removes "whose fault" ambiguity.
- **First-article approval mandatory on bulk:** printer produces 1 unit, approved against the locked print file, before the full run. The "order 1 then bulk" flow doubles as this. A full run deviating from the approved first article is the printer's cost.

**Retention — 70/30 hold (bulk only):**
- **Bulk = Fulfillment production cost ≥ AED 1,000** (value-only; no piece count; threshold adjustable as real defect costs are learned). Below threshold → pay printer in full (defect cheap to absorb; avoids doubled transfer fees).
- Pay printer **70% on dispatch, hold 30%**.
- **30% releases on an EVENT, not a timer:** proof of delivery confirmed **+** 30-day defect-claim window closed with no claim. Never release on elapsed-time-from-order or from-dispatch — a slow delivery would otherwise release payment before the buyer can inspect, recreating the leak.
- If a valid defect claim lands in the window → defect cost deducted from the held 30% before any release.
- Per-order (not batched) — batching by calendar could release before a slow order's window closes.

**Running-account netting (fallback):** if a defect cost exceeds the held 30%, the remainder is credited against the printer's *next* order invoice. Recovery from future volume. Works only with repeat printers.

**Removal-from-network discipline:** a printer refusing to honor a defect per contract is dropped from future routing. This disciplines printers who value your volume — but it's a *future deterrent*, not recovery for the current order (the 30% hold does recovery). Argues for a printer quality-score feeding routing once data exists.

**Residual self-insurance (optional):** a small margin buffer (~2–4%) into a reserve you hold absorbs printer-fault costs that can't be recovered (sub-threshold orders, exits where 30% < reprint cost).

> **Enforcement scales with printer count.** Both the 30% hold's credibility and the removal threat only have teeth when a printer is *replaceable*. With two printers per category, dropping one leaves zero redundancy → the removal threat is hollow and you're dependent. Growing past two printers **per product category** is the priority that makes the entire quality-enforcement model credible. Two is the weakest position.

**Contract must state (with each printer, before launch):**
1. Manufacturing defect or print ≠ approved file = printer's cost (reprint at their expense).
2. 70/30 retention on bulk; release conditions as above; deduction rights against the held 30%.
3. Netting of unrecovered defect cost against future invoices.
4. First-article approval required before bulk runs.
5. Refusal to honor → removal from network.

> Note: the retention requires printers to accept a 30% holdback on bulk. Confirmed acceptable in principle; confirm in writing per printer. Below-threshold orders are paid in full, which is what upfront-payment printers want anyway.

---

## 6. White-label / double-blind (point 4)

- Connected-store parcels carry the **merchant's** brand, not the platform's, not the printer's.
- Packing slip: merchant brand + optional logo + message; configurable return address.
- Optional: merchant-supplied custom packaging held at printer.
- `branding_source` on the order resolves which brand assets the printer applies.

---

## 7. Pricing (stacked model — Printful)

Pricing is a stack of components, not a single price. Buyer/merchant pays the sum; you set the spread.

| Component | Notes |
|---|---|
| **Product base cost** | Wholesale price of the blank + one standard print. Per product. |
| **Fulfillment add-ons** | Extra print areas, embroidery digitization setup, etc. — billed separately, not in base. |
| **Shipping** | Per order. Same-category bundling: first item full rate, each additional same-category item adds a lower fee (Printful: 1st tee $3.99, +$2.00 each additional tee). Grouped by product category. |
| **Branding add-ons** | Custom labels, packing-slip logo, pack-ins. |
| **Tax / VAT** | By buyer location. (InvoLinks territory — reuse.) |
| **Platform spread** | retail − (base + add-ons + shipping). Your margin. Typical POD retail ≈ 2–2.2× base. |

- **PricingTier (optional v1):** volume breaks (e.g. 25+ units) — fits the order-1-then-bulk pattern.
- **Possible later:** merchant subscription tier lowering wholesale (Printful's Growth plan = $24.99/mo, free at $12K/yr sales, up to 33% off).

### Split-shipping rule (the margin leak to close)
If one order splits across two printers, you have **two parcels and potentially two shipping costs**, but Printful's same-category bundling assumes same-facility consolidation. Cross-printer splits can cost more shipping than a single quote implies. Decision:
- **Recommended:** compute shipping per Fulfillment and show it at checkout ("ships in 2 parcels"). Buyer sees real cost; no leak.
- Alternative: quote one blended rate and absorb the difference (simpler UX, eats margin on splits).
Pick before checkout is built.

---

## 8. Integration layer (API-first)

- All orders hit one internal `createOrder` API regardless of source.
- StoreConnection adapters translate platform webhooks → internal order. Adapters are interchangeable.
- Sequence: v1 = OWN_STORE only (your own storefront on the platform) · v1.1 = Shopify adapter · v1.2+ = Salla, Zid · ExpandCart on demand.

---

## 9. Open decisions still gating build

**Resolved this session:** money model = pure Printful, single flow, **platform never holds buyer funds even on own store (Reading B)**. Clock A / escrow removed permanently. Pricing = stacked model. Split orders contained via Fulfillment. Routing = capability gate → capacity gate → cost (primary) → proximity (tiebreaker). **Printer protection:** prevention (print-file validation + mandatory first-article on bulk) + 70/30 retention on bulk (Fulfillment ≥ AED 1,000), 30% released on delivery+claim-window-closed event, per-order; running-account netting fallback; removal-from-network discipline; enforcement scales with printer count.

Still open:
1. **License + gateway for operating a store and billing fulfillment** — you are NOT a custodian of consumer funds (lighter position), but you still need the right UAE entity and a payment gateway to run a store and charge for fulfillment. Architectural answer needed before checkout. Gates build step 4. (You're handling license research.)
2. **Split-shipping rule** — per-Fulfillment shipping shown at checkout (recommended) vs blended-and-absorb. Gates checkout.
3. **Routing weights** — starting weights for cost vs proximity vs capacity.
4. **Printer count** — two is pilot-only; the reroute branch (§5) is hollow until a 3rd/4th capable printer exists *per product category*.
5. **Design ownership** (flagged, not v1-blocking) — when a buyer's design on your OWN_STORE becomes a merchant's sellable product on a connected store, whose design is it and who may reuse it. Resolve before v1.1.

---

## 10. Build order (mirrors the lifecycle, dependency-first)

1. Catalog + ProductType + PrinterCapability matrix (routing foundation)
2. Design tool: mockup generator **+ print-file spec validation** (the two-file pipeline)
3. Order model (order → lines → fulfillments → shipments) + routing engine
4. Money flow: gateway + fulfillment billing (gated by decision #1)
5. Printer-facing fulfillment dashboard + status updates
6. Delivery, dual-clock confirmation, defect/exception handling
7. Admin + ops
8. v1.1: first StoreConnection adapter (Shopify)
