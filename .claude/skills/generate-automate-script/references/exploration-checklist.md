# Live exploration checklist

Follow this during step 2 of the skill. The goal: map the **entire** booking funnel
for **every variant the booking JSON can express**, and capture a live-validated
selector for each control. Use the browser tools (`navigate`, `screenshot`,
`read_page`/`get_page_text`, `find`, `javascript_tool`). If a tool isn't loaded, fetch
it via `ToolSearch` (e.g. `select:mcp__Claude_in_Chrome__navigate,...`).

**Validate every selector live with `javascript_tool` before you put it in the script.**
A selector you didn't run against the real DOM is a guess — mark it `// TODO(verify):`.

## 0 — Get an English (selector-stable) view first

Before mapping anything, settle the language (see SKILL.md "Language policy"):

- [ ] Find a **native** English switch: language dropdown / flag, a URL locale
      (`?lang=en`, `?locale=en`, `hl=en`, `/en/` path), or a locale cookie. Record the
      exact mechanism — it becomes `ensureLanguage()`.
- [ ] If there is no native English locale, plan for **language-independent selectors**
      (`data-*`, `id`, `name`, `type`, `aria-*`, roles, structure, price/number
      patterns). `ensureLanguage()` becomes a no-op `// TODO(verify):`.
- [ ] **Always book in English**, even if the booking instructions demand another
      locale (e.g. "book in Hungarian for the lower price"). Note the instruction in the
      summary but keep `CONFIG.language = 'en'`. **Never derive a selector from
      Chrome/Google-translated text** — turn translation off before validating selectors.

## 0.5 — Probe dynamic behaviour & what actually submits

See SKILL.md "Dynamic fields, hidden state & multi-step funnels". For every control:

- [ ] After setting it, trigger the submit/recalc and **confirm the page reflects the
      change** (price, summary, next-page URL params). If not, you set the wrong thing.
- [ ] Find the **real submitted state**: `input[type=hidden][name]`, JSON-encoded config
      fields (e.g. `hf*Config`), `data-*` mirrors. A control with **no `name`** is not
      submitted — set the backing field instead.
- [ ] **Toggle every option** and record conditional fields that appear and the exact
      shape they need (e.g. per-guest **age** inputs / arrays when children/infants > 0).
- [ ] Is the funnel a **full-page postback** per step (no SPA)? If so plan a stage-aware,
      resumable `run()` and count page hops vs the extension's re-injection budget.

## 1 — Entry & interstitials

- [ ] Landing URL behavior: redirects, region/city picker, cookie/consent banner,
      newsletter modal, "choose your country" gate.
- [ ] Capture a selector to **dismiss each interstitial** (`dismissInterstitials`).
- [ ] Note anything that blocks automation: captcha, login wall, bot detection.
- [ ] **Consent banners often load ASYNC and can break the funnel, not just overlay it.**
      A one-shot check at pipeline start usually runs *before* the banner injects, so it
      misses it. **Wait** for the banner (poll its known ids, e.g. CookieScript's
      `cookiescript_reject/accept/close`) then decline. Verified live: an undismissed
      consent overlay made an add-to-cart **drop the item** on navigation (the cart page
      showed "empty" despite the badge showing a count) — the unconsented session didn't
      persist the cart. Dismissing it first fixed the whole funnel. Confirm the cart
      survives the navigation to /cart end-to-end.

## 2 — Product selection

The JSON gives you `productName` (and a `productCode` that may embed a `productId`,
`optionId`, `daysOfWeek`, `startingTime`, `paxTypeMap`). Map how a product is chosen:

- [ ] How products are listed (cards, tabs, dropdown). Selector to pick one by its
      **stable** identity (data-id, href, or visible name as a last resort).
- [ ] **Weekday / Weekend / Holiday split**, if the portal has separate products or tabs
      for these (the Budapest Spas instructions call this out). Capture each.
- [ ] Morning / Afternoon / session-type products, if split by time.
- [ ] Whether choosing a product navigates to a new page/URL (note the URL).

## 3 — Date selection

- [ ] The date control type: calendar widget, `<input type=date>`, dropdown.
- [ ] How a specific day is selected and what format it expects.
- [ ] **A "custom"-looking calendar is often a library underneath** (e.g. flatpickr —
      check for `.flatpickr-day`, a month `<select>.flatpickr-monthDropdown-months`,
      a year `<input>.numInput.cur-year`, `.flatpickr-next/prev-month`). To reach a
      NON-current month, prefer driving the underlying numeric controls directly
      (set the month `<select>` option value + year input, fire `change`) — it jumps
      straight there, is language-independent (numeric, not "June"/"Június"), and
      works DOM-only in the isolated world (do NOT rely on the page's `_flatpickr`
      expando — it's invisible across worlds). Keep the next/prev arrow as a fallback,
      and **poll for the displayed month to actually change** rather than a fixed sleep
      (the widget re-renders async). A month the picker does not offer = slot not open.
- [ ] How **disabled / sold-out / not-yet-open** days look (so the script can detect
      "slot not open" and report it rather than silently picking the wrong day).
- [ ] Whether weekend/holiday dates change the product or just the price.

## 4 — Time / session selection

- [ ] Time-slot control (buttons, dropdown). Format expected (the JSON gives
      `inventoryTime` as `HH:MM:SS`).
- [ ] Morning vs Afternoon session mapping, if the portal groups slots.
- [ ] Behavior when the exact time is unavailable.

## 5 — Pax / quantity

Iterate **every** type in `guestNumbers` (`type` → `persons`; e.g. `GENERAL`, `ADULT`,
`CHILD`, `SENIOR`). The script drives `b.paxMap`.

- [ ] The quantity control per pax type: stepper (+/−), dropdown, or input.
- [ ] How each pax type's row is identified (label, data attr). Map **type → row**.
- [ ] Min/max limits, and how the running total updates.
- [ ] Any pax type in the portal that has **no** match in the JSON (leave at 0).
- [ ] **Where the count actually submits** — a visible dropdown may be `name`-less and
      backed by a hidden config; set that and verify the total recomputes.
- [ ] **Conditional per-guest fields** when children/infants > 0 (e.g. an age input per
      child/infant, often required as a list). Capture the structure; default missing
      ages to the middle of the supplier's stated band and make them overridable.

## 6 — Cart / proceed to checkout

- [ ] "Add to basket" / "Buy items" control and selector.
- [ ] The transition to checkout (new page? URL? overlay?).
- [ ] Any "are you sure / upsell" step in between.

## 7 — Customer details

The booking JSON for these portals often has **no customer name/phone**. Capture the
fields anyway and note which are required:

- [ ] Name, phone, email inputs — selectors and which are mandatory.
- [ ] **Instruction-driven identity rules** — e.g. the "use volitand ID
      (NON-PARTNERED)" rule from the instructions. Note exactly which field it goes in.
- [ ] Marketing/terms checkboxes that block "continue".

## 8 — Payment page (STOP here)

- [ ] The marker that you've **reached** the payment page (URL pattern, a heading, a
      card-number field's presence). This is what `reachPayment()` waits for and what
      makes `run()` return `PAYMENT_REQUIRED`.
- [ ] **Payment method selection** if required before card entry (e.g. "Pay with Bank
      Card (SimplePay)" per the instructions) — selecting the method is allowed; entering
      card details is **not**.
- [ ] The **displayed total** and its selector + currency, for price validation against
      `netPrice`. Note the number format (decimal/thousands separators, currency symbol
      placement) so `parsePrice` is correct.
- [ ] **Do not enter card details. Do not submit.** Screenshot and stop.

## 9 — Confirmation (read-only, for confirmAfterPayment)

Without paying, inspect the page structure so you can predict where the order reference
will appear after a real payment:

- [ ] Where the **Order Reference Number** is shown (selector, label text, URL param).
- [ ] Any "search by ID" hint from the instructions (e.g. search Zendesk by volitand ID).
- [ ] Remember `confirmAfterPayment()` runs in a **fresh injection** and must read this
      purely from the DOM (see references/contract.md).

## Output of exploration

A selector map you can drop straight into the script and the summary:

| Step | Headout field | Selector (validated?) | Notes / variants |
|------|---------------|------------------------|------------------|
| product | productName / productCode | … | weekday vs weekend vs holiday |
| date | inventoryDate | … | format, disabled-day marker |
| time | inventoryTime | … | morning/afternoon mapping |
| pax: GENERAL | guestNumbers[].persons | … | stepper, max N |
| customer | (instruction: volitand ID) | … | required fields |
| payment marker | — | … | URL / heading / card field |
| total | netPrice / tourCurrency | … | number format |
| confirmation | — | … | order ref location |
