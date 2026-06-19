---
name: generate-automate-script
description: |
  Generate a browser content script that automates ticket booking on a vendor portal.
  Takes a URL (required) plus optional booking instructions, visits the site live to map the full booking funnel for every variant, then writes a robust, self-contained plain-JS script named after the URL.
  The script accepts the Headout booking JSON, automates every step up to payment, pauses for manual payment, then extracts the confirmation/order number. It works whether the extension injects into the page MAIN world or an isolated content-script world.
  Use when someone says: "generate automation script", "create/write a booking script", "automate booking for <url>", or gives a vendor portal URL and asks to automate booking on it.
---

# generate-automate-script

Generate a production-grade browser automation script for a vendor ticket-booking
portal. Output: one self-contained `.js` file named after the URL, plus a short
integration summary.

## Inputs

- **URL** (required) — the vendor portal to automate.
- **Booking instructions** (optional) — text or HTML from the booking's
  `bookingInstructions`. If HTML, read the rendered text and extract actionable rules
  (language to use, product/session selection logic, identity rules like a
  non-partnered "volitand" ID, payment method, do/don't warnings). Ignore styling.
- **Booking JSON** (optional sample) — the Headout payload the extension will pass.
  Drives field mapping; see the schema example the user provides.

## Files in this skill

- `assets/booking-template.js` — the robust starting template. **Read it, fill in
  every `{{...}}` placeholder and site-specific step, then save.** Do not hand-write
  a script from scratch; the template carries the contract, helpers, error handling,
  re-injection guard, price validation, and date/pax logic.
- `references/contract.md` — the exact extension↔script contract and **why** it works
  across browser worlds. Read before writing the flow so emitted events/return shapes
  stay correct.
- `references/exploration-checklist.md` — what to capture during the live visit.

## Workflow

### 1 — Parse inputs

Extract the URL. Parse instructions (strip HTML → actionable rules). From the booking
JSON, note: `inventoryDate`, `inventoryTime`, `guestNumbers[]` (pax types + counts),
the `vendorsInfo` entry matching `vendorId` (`productCode`, `productName`),
`netPrice`, `tourCurrency`.

### 2 — Explore the site live

Read `references/exploration-checklist.md` and follow it with the browser tools
(navigate, screenshot, read_page/get_page_text, find, javascript_tool). Map the full
funnel **for every variant the JSON can express** — all products, weekday/weekend/
holiday splits, every pax type, all session times. **Validate each selector live with
`javascript_tool` before using it.** Stop before card entry — never buy.

If a browser tool isn't loaded, fetch it via ToolSearch (e.g.
`select:mcp__Claude_in_Chrome__navigate,...`). If the site needs login or is
unreachable, say so and proceed best-effort, marking unverified selectors.

### 3 — Map booking JSON → portal

Produce a concrete mapping table (Headout field → selector → notes) covering product,
date, time/session, every pax type, customer fields, payment-page marker, total, and
confirmation reference.

### 4 — Generate the script

Copy `assets/booking-template.js` and fill in:

- `CONFIG` — portal hostname, `language` (if instructions require one), timeouts.
- Each site-specific function (`dismissInterstitials`, `ensureLanguage`,
  `selectProduct`, `selectDate`, `selectTime`, `setPax`, `addToCartAndProceed`,
  `fillCustomerDetails`, `reachPayment`, `readDisplayedTotal`, `extractConfirmation`).
- Use the provided helpers (`waitFor`, `findByText`, `clickWhenReady`, `fillField`,
  `selectOption`, `setStepper`, `formatDate`, `formatTime`, `parsePrice`).
- Drive pax by iterating `b.paxMap` so **every** type present is handled; branch on
  `b.isWeekend` / `b.time` where the portal needs it.

**The final script must have zero `{{...}}` placeholders and no unresolved `TODO`
except clearly-labelled `// TODO(verify):` lines for things the live site genuinely
blocked. It must be self-contained — no imports, no external deps.**

### 5 — Verify the generated script (do not skip)

Inject the finished script on the live page via `javascript_tool` and run a dry pass:

```js
await window.HeadoutAutomation.run(SAMPLE_BOOKING_JSON);
```

Watch the console / postMessage `PROGRESS` events. It should walk to the payment page
and return `{ status: 'PAYMENT_REQUIRED', ... }` **without entering card details**.
Fix any selector/step that fails and re-run until it reaches payment cleanly. Then
confirm `confirmAfterPayment()`'s confirmation selector against the payment page
structure (without paying). Report what passed and what couldn't be verified.

### 6 — Save + summarize

Filename: lower-case the URL hostname, strip a leading `www.`, replace every
non-alphanumeric char with `_`, append `.js`
(e.g. `https://tickets.spasbudapest.com/` → `tickets_spasbudapest_com.js`). If two
products on the same host need different scripts, suffix with the variant.
Save to the **current working directory**. Then output:

```
## Script generated: <filename>
**Portal:** <url>   **Verified to:** payment page ✓ / partial
**Variants handled:** products / weekday-weekend / pax types …
**Payment:** pauses at checkout → PAYMENT_REQUIRED → confirmAfterPayment()
**Unverified:** <list, or "none">

### Integration (see references/contract.md)
- Inject script; call `window.HeadoutAutomation.run(bookingJson)` (or postMessage RUN_BOOKING).
- On PAYMENT_REQUIRED → complete payment → `confirmAfterPayment()` for the order ref.

### Selector map
<table of every selector used, for maintenance>
```

## Hard rules

- **Never complete a real booking / never enter card details.** Stop at payment.
- Prefer stable selectors (data-\*, aria, visible text) over brittle CSS classes.
- Handle every pax type and date/session variant — not just the sample.
- Honour instruction-driven specifics (language, identity ID, payment method).
- Keep the contract intact so the extension integration in `references/contract.md` holds.
