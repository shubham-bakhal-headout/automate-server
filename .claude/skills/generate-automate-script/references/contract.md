# Extension ↔ script contract

This is the exact interface the generated script must satisfy, and **why** it works
the way it does. Read it before writing the booking flow so the events and return
shapes stay correct. The authoritative sources in the extension are
`lib/autofill.js` (injection + invocation) and `lib/messages.js` (status strings).

## How the script is injected and called

The extension never `eval`s the script in the page. It calls
`chrome.userScripts.execute({ target: { tabId }, world: "USER_SCRIPT", js: [{ code }] })`
where `code` is **your whole script followed by a small invocation expression**,
concatenated as one string:

```js
`${script}\n;${invocation}`
```

Two consequences fall directly out of this:

1. **`USER_SCRIPT` is an *isolated* world that shares the page DOM but not the page's
   JS globals.** Your script can read/write `document` and the DOM, but it **cannot**
   see variables, frameworks, or functions the page defined (no `window.angular`, no
   page-level React handles, etc.). Anything you need, you build from the DOM.
   - The skill also promises the script works if injected into the MAIN world or a
     plain content-script world. So: **never depend on page globals**, and **guard
     every `chrome.*` access** in a `try/catch` — `chrome.runtime` throws in some
     worlds. (See the optional triggers in the template.)

2. **Your script body and the invocation run in the same execution, so
   `window.HeadoutAutomation` set by the body is immediately visible to the
   invocation.** But each `userScripts.execute` call is a *fresh* injection.

## The two invocations

`lib/autofill.js` builds these exact expressions:

**run** (drive to payment):

```js
(() => {
  const automation = window.HeadoutAutomation;
  if (automation && typeof automation.run === "function") {
    return Promise.resolve(automation.run(<bookingJson>))
      .catch((e) => ({ status: "ERROR", error: String(e && e.message || e) }));
  }
  const legacy = window.HeadoutOrderFormAutofill; // older mock-server scripts
  if (legacy && typeof legacy.fill === "function") { /* ... */ }
  return { status: "ERROR", error: "AUTOMATION_API_MISSING" };
})();
```

**confirmAfterPayment** (read the order reference, after the agent paid by hand):

```js
(() => {
  const automation = window.HeadoutAutomation;
  if (automation && typeof automation.confirmAfterPayment === "function") {
    return Promise.resolve(automation.confirmAfterPayment())
      .catch((e) => ({ status: "ERROR", error: String(e && e.message || e) }));
  }
  return { status: "ERROR", error: "AUTOMATION_API_MISSING" };
})();
```

So your script **must** register, synchronously on load:

```js
window.HeadoutAutomation = {
  run(bookingJson) { /* → Promise<result> */ },
  confirmAfterPayment() { /* → Promise<result> */ },
};
```

`run` and `confirmAfterPayment` may return a value or a Promise — the extension wraps
both in `Promise.resolve(...)`.

## CRITICAL: no shared in-memory state between run and confirm

`confirmAfterPayment` is a **separate `userScripts.execute` on a re-fetched, re-injected
copy of the script** (see `background.js → confirmAfterPayment()`), and it happens after
the agent has navigated the page through payment. Any variable your `run()` set in JS
memory is **gone** by the time `confirmAfterPayment()` runs.

→ `confirmAfterPayment()` must recover everything it needs **from the live DOM** of the
post-payment / confirmation page. Do not rely on closures, module state, or values
stashed during `run()`. (If you must persist a hint, use `sessionStorage`/`localStorage`
or a DOM marker and read it back defensively — but prefer reading the confirmation
straight off the page.)

## Return shapes (must be structured-cloneable)

`userScripts.execute` surfaces `results[0].result`, which is **structured-cloned** back
to the service worker. Return **plain JSON-safe objects only** — no DOM nodes, no
functions, no `Element`, no circular refs. Status strings come from
`lib/messages.js → BOOKING_STATUS` and must match exactly:

| status            | meaning                                                            |
|-------------------|--------------------------------------------------------------------|
| `PAYMENT_REQUIRED`| Reached the vendor payment page. **Stop here — never pay.**         |
| `CONFIRMED`       | Order placed; a confirmation reference was read (post-payment).     |
| `ERROR`           | A step failed. Include a human-readable `error`.                    |

Recommended `run()` success result:

```js
{
  status: "PAYMENT_REQUIRED",
  expectedTotal: 134.0,        // booking netPrice
  displayedTotal: 134.0,       // total parsed off the payment page
  currency: "EUR",
  priceMismatch: false,        // true if displayed != expected beyond tolerance
  steps: ["language", "product", "date", "time", "pax", "cart", "customer", "payment"],
}
```

Recommended `confirmAfterPayment()` result:

```js
{ status: "CONFIRMED", reference: "ORDER-12345" }
```

On failure, from either:

```js
{ status: "ERROR", error: "Could not find the date picker", step: "date" }
```

Never throw out of `run`/`confirmAfterPayment` for an expected failure — return an
`ERROR` result so the extension can show a clean message. (Unexpected throws are still
caught by the invocation wrapper, but you lose the `step`/context.)

## Optional triggers (best-effort, must never break load)

The extension drives the script by **calling `run()` directly**, not by postMessage.
A `postMessage` trigger and `PROGRESS` events are *optional* niceties (useful for live
debugging during the skill's verify step). Register them inside `try/catch` so a world
that forbids them can't abort script registration:

```js
try {
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "HEADOUT_RUN_BOOKING") return;
    window.HeadoutAutomation.run(e.data.booking);
  });
} catch (_) {}
```

## Re-injection guard

Because the same script may be injected more than once on a tab (e.g. run, then
confirm), guard against duplicate event listeners / re-entrancy, but always (re)assign
`window.HeadoutAutomation` so the freshest copy wins. The template does this with a
`__headoutGenerated` marker.

## Hard rule

The booking funnel is driven **up to — never through — payment**. `run()` stops at the
payment page and returns `PAYMENT_REQUIRED`. It must **never** enter card details or
place the order. Confirmation is read only *after* a human pays, via
`confirmAfterPayment()`.
