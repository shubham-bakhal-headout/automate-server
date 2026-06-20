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

**Probe behaviour, not just selectors** — toggle every option, watch for conditional
fields, and confirm what actually submits. This is where most scripts break; follow
"Dynamic fields, hidden state & multi-step funnels — PROBE before you write" below.

If a browser tool isn't loaded, fetch it via ToolSearch (e.g.
`select:mcp__Claude_in_Chrome__navigate,...`). If the site needs login or is
unreachable, say so and proceed best-effort, marking unverified selectors.

### 3 — Map booking JSON → portal

Produce a concrete mapping table (Headout field → selector → notes) covering product,
date, time/session, every pax type, customer fields, payment-page marker, total, and
confirmation reference.

### 4 — Generate the script

Copy `assets/booking-template.js` and fill in:

- `CONFIG` — portal hostname, `language` (**always `'en'`** — the script always books
  in English; see "Language policy"), timeouts.
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

## Dynamic fields, hidden state & multi-step funnels — PROBE before you write

A selector that exists is not a field that works. Vendor portals (ASP.NET WebForms,
Vue/React widgets, jQuery dialogs) routinely hide their real behaviour. The funnel you
see on first load is rarely the whole story, and the booking data is dynamic — so map
*behaviour*, not just static selectors. Treat the following as exploration steps, not
optional polish; most were learned the hard way from real portals.

### A. The visible control is often NOT what gets submitted

Set a control, submit, then **re-read the result** — never assume the value "took".
On one JTB portal the visible Adults/Children dropdowns had **no `name` attribute**
(so the form never submitted them); the authoritative pax lived in hidden JSON fields
(`hfPaxConfig` / `hfRoomConfig` = `[{adults,children,infants,childAgeList,…}]`). A
synthetic `change` on the visible dropdown did **not** sync them, so the booking kept
stale pax until the hidden field was written directly. Always:

- After setting a value, trigger the real submit/recalc and **verify the page reflects
  it** (price, summary, next-page params). If it doesn't, the value isn't wired the way
  you think.
- Hunt for the actual submitted state: `input[type=hidden][name]`, JSON-encoded config
  fields, `data-*` mirrors. Set **those**, and keep the visible control in sync for the
  UI. Fire `input`+`change` via the native setter (the template's `setNativeValue`).
- Check `<form>` field `name`s; a control with no `name` is decorative.

### B. Conditional fields appear only when you toggle options — exercise every path

Required fields materialise based on other choices. Drive **each** option and record
what appears and the exact shape it expects:

- Pax: setting Children/Infants > 0 revealed a **per-guest age field**, and the hidden
  config required `childAgeList`/`infantAgeList` with **one entry per guest** or the
  search was rejected. Booking JSON rarely carries ages → default to the middle of the
  supplier's stated band (e.g. Child 6-11 → 8) and make it overridable.
- Delivery/fulfilment mode, product variant, payment method, "date of birth vs age"
  toggles, "add another room/passenger" — each can spawn new required inputs.
- Re-run exploration for the weekday/weekend/holiday and morning/afternoon splits.
- **Framework-bound dialogs (Vue/React/Knockout) commit on their own tick.** A
  passenger modal that you fill and Save in the *same* beat saves EMPTY values — the
  framework hasn't synced your programmatic input to its model yet. Add a short settle
  delay (~500ms) after filling and before clicking Save (verified: immediate save left
  the slot blank; a delayed save persisted). The native value-setter + `input`/`change`
  events are necessary but not sufficient — the delay is what makes it stick.

### C. Map booking → form by MEANING, matched on text — not by position

Forms have free-text "questions" whose answers are *derivable* from booking semantics:

- Read each question's text at runtime (e.g. `input.closest('tr').previousElementSibling`)
  and branch with regexes on that text — robust to re-ordering and product variation.
  Do **not** hardcode answers to fixed indices.
- One booking field can drive many answers. Example: `meetingPointAddress` containing
  "Tokyo City i" meant the pickup-location question = "Tokyo City i", the pickup-date
  question = `inventoryDate`, and every hotel-delivery question = "N/A" — 7 of 8
  mandatory questions auto-filled from that single signal.
- **Link fields that share a source.** A "name of the pick-up representative (as on
  passport)" question is the same person as Passenger Details → fill it from the
  passenger name (or read the name already entered on the page and normalise the
  portal's display format, e.g. "Surname, Forename / Title" → "Forename Surname").
- **Identity/guest data may live in a SEPARATE payload, not the booking JSON.** Guest
  names, emails and per-pax fields often come from a different API the extension fetches
  and merges — e.g. `background.js` does `const booking = { ...bookingDetails,
  guestDetails }`, so the script reads them from `b.raw.guestDetails`
  (`primaryGuest` + `guests[]`, each with `firstName`/`lastName` and a "Full Name"
  booking-user-field). **Check the extension's data assembly for what is actually passed
  to `run()`** before concluding a field "isn't in the booking". Map `guests[i]`
  positionally to passenger slot `i` (adults then infants).

### D. Full-page-postback funnels: make `run()` STAGE-AWARE / resumable

Classic server-rendered sites (no SPA/UpdatePanel) do a **full reload on every step**
(date→Update, →Book now, →Book service, →Cart). Each reload tears down the injected
USER_SCRIPT context. The extension re-injects + re-calls `run()` **only on a URL
change** (see `lib/autofill.js`, capped attempts). So:

- Don't write `run()` as one linear walk. Detect the current page
  (`location.pathname`) and **resume** the right step.
- Persist the tiny bit of cross-reload state in `sessionStorage` (e.g. "already
  submitted the search for date+pax X") so the post-reload injection clicks *Book now*
  instead of re-searching forever.
- Trigger a navigation as the **last** action of a step, then `await new Promise(()=>{})`
  so the dying context doesn't resolve a misleading result.
- Count the page hops vs the extension's re-injection budget; if the funnel needs more,
  collapse steps where possible and **call it out in the summary**.

### E. Pre-fill everything derivable; STOP without submitting when data is missing

Never submit garbage and never hard-block. Fill every field you can, leave the rest,
and return a clear `ERROR` whose message names exactly what's outstanding
(`NEEDS_AGENT_INPUT: tour question 4 + 1 passenger name`). The agent completes the
pre-filled form and the next click/`run()` continues. Detect supplier "not available"
states (e.g. "No rate information found") and return an actionable error rather than
proceeding with the wrong slot.

### F. Verify by exercising VARIANTS, not just selector existence

In step 5, drive multiple pax/age/date combinations and **check the computed total**
matches expectations (e.g. 2 adults + 1 infant = 2×adult + infant price), confirm the
no-availability branch, and confirm conditional fields fill. A script that only proved
its selectors *exist* has not proven it *works*.

## Language policy (non-English vendor sites)

**Always book in English (`CONFIG.language = 'en'`).** This is a hard rule with no
exceptions — even if the booking instructions say to use another language (e.g. a SOP
claiming a lower price in the vendor's local language), still use English. Note any
such instruction in the script/summary, but build and run the funnel in English.

The site may render in Spanish, French, Hungarian, etc. **Explore it in English and emit
an English-only script** — but never let a translated string become a selector. Why:
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
- **Set the field that actually submits, then verify the result changed** — not just
  the visible control (which may be `name`-less or backed by a hidden JSON config).
- **Exercise every conditional/dynamic field** (e.g. per-guest age lists that appear
  when children/infants > 0) and supply what they require; default missing data
  sensibly and make it overridable.
- **Make `run()` stage-aware/resumable** on full-postback funnels (detect the page,
  keep cross-reload state in `sessionStorage`); respect the re-injection budget.
- **Match free-text questions by their text and derive answers from booking meaning**
  (one field can answer many); link fields that share a source. Pre-fill all you can
  and stop with a clear `NEEDS_AGENT_INPUT` rather than submitting incomplete data.
- **Explore and write in English** (see "Language policy"): prefer the site's native
  English locale; otherwise use language-independent selectors. Never derive a selector
  from Chrome/Google-translated text. The script — names, keys, messages, comments — is
  English-only; native selector literals get an English translation comment.
- Keep the contract intact so the extension integration in `references/contract.md` holds.
