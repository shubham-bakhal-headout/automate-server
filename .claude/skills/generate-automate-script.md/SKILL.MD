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
(navigate, screenshot, read_page/get_page_text, find, javascript_tool).

**First, get an English view of the site** — see "Language policy" below. Do this
before mapping anything, so the funnel you capture is already in English.

Then map the full
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

- `CONFIG` — portal hostname, `language` (target locale — **`'en'` by default**, or
  the locale the instructions explicitly require), timeouts.
- `ensureLanguage` — force the site into `CONFIG.language` before any other step
  (apply the URL param / cookie / switcher discovered during exploration; see
  "Language policy"). If the vendor has no English locale, leave it a no-op with a
  `// TODO(verify):` note and build the rest of the script on language-independent
  selectors.
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

## Language policy (non-English vendor sites)

The site may render in Spanish, French, etc. **Explore it in English and emit an
English-only script** — but never let a translated string become a selector. Why:
Chrome/Google Translate rewrites text nodes *in your view only* (wrapping runs in
`<font>` tags); the DOM the script reads at runtime stays in the original language, so
`findByText('Buy tickets')` would match nothing live. Use this order:

1. **Prefer the site's native English locale (best).** During exploration, look for a
   real language switch and use it:
   - language dropdown / flag selector in the header or footer;
   - URL locale — `?lang=en`, `?locale=en`, `hl=en`, or an `/en/` path segment;
   - a locale cookie or `Accept-Language`.
   Navigate to the English version and map the funnel there. Its DOM text is genuinely
   English — readable *and* selector-stable. Record the exact switch and reproduce it
   in `ensureLanguage()` so the script always runs in English.

2. **No native English → don't translate selectors.** Build selectors from
   language-independent anchors: `data-*`, `id`, `name`, `type`, `aria-*`, roles,
   structural position, numeric/price patterns. Where text matching is unavoidable,
   match the site's **real native text** and annotate it in English, e.g.
   `findByText('Comprar') // "Buy"`. `ensureLanguage()` becomes a no-op with a
   `// TODO(verify):` note.

3. **Chrome translate is a comprehension aid only.** It's fine to switch it on to
   understand what a control does, but **turn it off before validating any selector
   with `javascript_tool`**, and never copy translated text into the script.

**Always, regardless of site language:** everything you author is English — function
and variable names, `paxMap`/field-mapping keys, `PROGRESS` messages, comments, and the
integration summary. The only permitted non-English strings are native-language
selector literals, each carrying an English translation comment.

## Hard rules

- **Never complete a real booking / never enter card details.** Stop at payment.
- Prefer stable selectors (data-\*, aria, visible text) over brittle CSS classes.
- Handle every pax type and date/session variant — not just the sample.
- Honour instruction-driven specifics (identity ID, payment method).
- **Explore and write in English** (see "Language policy"): prefer the site's native
  English locale; otherwise use language-independent selectors. Never derive a selector
  from Chrome/Google-translated text. The script — names, keys, messages, comments — is
  English-only; native selector literals get an English translation comment.
- Keep the contract intact so the extension integration in `references/contract.md` holds.
