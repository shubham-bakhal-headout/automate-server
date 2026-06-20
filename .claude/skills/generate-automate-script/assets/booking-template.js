/**
 * Headout vendor-portal booking automation — GENERATED SCRIPT TEMPLATE.
 *
 * HOW TO USE THIS FILE (for the generate-automate-script skill):
 *   1. Read references/contract.md so the contract below stays correct.
 *   2. Fill in CONFIG and every site-specific function body marked `{{...}}`.
 *   3. Validate each selector live (javascript_tool) before committing it.
 *   4. Remove this how-to block and every `{{...}}` placeholder. The shipped
 *      script must have ZERO `{{...}}` and no unresolved TODO except clearly
 *      labelled `// TODO(verify):` lines for things the live site truly blocked.
 *
 * CONTRACT (see references/contract.md — do not change the shape):
 *   - Injected by the extension into an ISOLATED world that shares the page DOM
 *     but NOT the page's JS globals. No imports. No page globals. Guard chrome.*.
 *   - Registers `window.HeadoutAutomation` synchronously on load:
 *       run(bookingJson)        -> Promise<{ status, ... }>   drives up to payment
 *       confirmAfterPayment()   -> Promise<{ status, reference, ... }>
 *   - Statuses (exact): "PAYMENT_REQUIRED" | "CONFIRMED" | "ERROR".
 *   - run() STOPS at the payment page and returns PAYMENT_REQUIRED. It NEVER
 *     enters card details and NEVER places the order.
 *   - confirmAfterPayment() is a SEPARATE injection: it shares NO in-memory
 *     state with run(). It must read the order reference straight from the DOM.
 *   - Return values must be plain JSON (no DOM nodes / functions / cycles).
 */
"use strict";

(() => {
  // Re-injection guard: the extension may inject this script more than once on a
  // tab (e.g. run, then confirmAfterPayment). Always (re)assign the API so the
  // freshest copy wins, but register one-time side effects (listeners) only once.
  const ALREADY = window.HeadoutAutomation && window.HeadoutAutomation.__headoutGenerated;

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG  — fill from exploration.
  // ──────────────────────────────────────────────────────────────────────────
  const CONFIG = {
    hostname: "{{PORTAL_HOSTNAME}}",  // e.g. "tickets.spasbudapest.com"
    // Target locale to force before any step. ALWAYS 'en' — the script always books in
    // English, even if the booking instructions demand another locale (note such an
    // instruction in the summary, but still book in English). See ensureLanguage().
    language: "en",
    timeouts: {
      element: 15000,  // default waitFor timeout (ms)
      navigation: 30000,
      short: 5000,
    },
    // Tolerance when comparing the portal's displayed total to booking.netPrice.
    priceToleranceAbsolute: 0.5,
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Booking normalizer — maps the raw Aries payload to a stable shape `b`.
  // Built against GET /apis/v2/order-fulfillment/booking/{id}. Concrete; do not
  // turn these into placeholders. Extend if a portal needs more fields.
  // ──────────────────────────────────────────────────────────────────────────
  function normalizeBooking(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const vendorsInfo = Array.isArray(o.vendorsInfo) ? o.vendorsInfo : [];
    // The product to book is the vendorsInfo entry matching the booking's vendorId.
    const product =
      vendorsInfo.find((v) => v && v.vendorId === o.vendorId) || vendorsInfo[0] || {};

    let productDef = {};
    try {
      productDef = JSON.parse(product.productCode || "{}");
    } catch (_) {
      productDef = {};
    }

    // paxMap: { GENERAL: 3 } / { ADULT: 2, CHILD: 1 } — drive setPax() off this so
    // EVERY pax type present is handled, not just the sample.
    const paxMap = {};
    for (const g of Array.isArray(o.guestNumbers) ? o.guestNumbers : []) {
      if (!g || g.type == null) continue;
      paxMap[g.type] = (paxMap[g.type] || 0) + (Number(g.persons) || 0);
    }

    const date = String(o.inventoryDate || ""); // 'YYYY-MM-DD'
    const time = String(o.inventoryTime || "").slice(0, 5); // 'HH:MM:SS' -> 'HH:MM'
    // Day-of-week from the date (local midnight avoids TZ rollovers). 0=Sun..6=Sat.
    const dow = date ? new Date(date + "T00:00:00").getDay() : null;

    return {
      raw: o,
      bookingId: o.bookingId,
      date,
      time,
      dayOfWeek: dow,
      isWeekend: dow === 0 || dow === 6,
      paxMap,
      totalPax: Object.values(paxMap).reduce((a, c) => a + c, 0),
      productName: product.productName || "",
      productCode: product.productCode || "",
      productDef, // parsed productCode (productId/optionId/daysOfWeek/startingTime/...)
      vendorName: product.vendorName || "",
      vendorId: o.vendorId,
      tourId: o.tourId,
      netPrice: Number(o.netPrice),
      currency: o.tourCurrency || "",
      meetingPointAddress: o.meetingPointAddress || "",
      // Customer identity is frequently NOT in the payload for these portals — it
      // is instruction-driven (e.g. the "volitand ID, NON-PARTNERED" rule). Pull
      // it from CONFIG/instructions inside fillCustomerDetails(), not from here.
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Generic helpers — complete, reusable. Prefer these over ad-hoc DOM code.
  // ──────────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Broadcast progress for live debugging. The extension does not require these. */
  function emitProgress(step, detail) {
    try {
      console.log("[HeadoutAutomation]", step, detail ?? "");
    } catch (_) {}
    try {
      window.postMessage({ type: "HEADOUT_PROGRESS", step, detail }, "*");
    } catch (_) {}
  }

  /** Resolve when predicate() is truthy, polling the DOM; reject on timeout. */
  async function waitFor(predicate, { timeout = CONFIG.timeouts.element, label = "" } = {}) {
    const started = Date.now();
    for (;;) {
      let value;
      try {
        value = predicate();
      } catch (_) {
        value = null;
      }
      if (value) return value;
      if (Date.now() - started >= timeout) {
        throw new Error("Timed out waiting for " + (label || "condition"));
      }
      await sleep(120);
    }
  }

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  const normalizeText = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

  /**
   * Find the first VISIBLE element whose trimmed text matches `text`.
   * `text` may be a string (substring, case-insensitive) or a RegExp.
   * Prefer language-independent selectors; use this only where text is unavoidable.
   */
  function findByText(text, { selector = "*", exact = false, root = document } = {}) {
    const wanted = text instanceof RegExp ? text : normalizeText(text);
    const nodes = [...root.querySelectorAll(selector)].filter(isVisible);
    return (
      nodes.find((el) => {
        const t = normalizeText(el.textContent);
        if (text instanceof RegExp) return text.test(el.textContent || "");
        return exact ? t === wanted : t.includes(wanted);
      }) || null
    );
  }

  /** Wait for `selector` (or the result of a function) to be clickable, then click it. */
  async function clickWhenReady(selectorOrFn, opts = {}) {
    const get = () =>
      typeof selectorOrFn === "function"
        ? selectorOrFn()
        : document.querySelector(selectorOrFn);
    const el = await waitFor(() => {
      const e = get();
      return e && isVisible(e) && !e.disabled && e.getAttribute("aria-disabled") !== "true"
        ? e
        : null;
    }, { ...opts, label: opts.label || "clickable element" });
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return el;
  }

  /** Set a value on an input/textarea/select via the native setter + fire events
   *  so React/Vue/Angular controlled inputs register the change. */
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    for (const type of ["input", "change", "blur"]) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }

  /** Fill a text-like field found by selector (or function). */
  async function fillField(selectorOrFn, value, opts = {}) {
    const el = await waitFor(
      () => {
        const e =
          typeof selectorOrFn === "function"
            ? selectorOrFn()
            : document.querySelector(selectorOrFn);
        return e && isVisible(e) ? e : null;
      },
      { ...opts, label: opts.label || "input field" }
    );
    if (el.disabled) el.disabled = false;
    el.focus();
    setNativeValue(el, String(value ?? ""));
    return el;
  }

  /** Choose an <option> in a <select> by value or visible label. */
  async function selectOption(selectEl, match) {
    const sel =
      typeof selectEl === "string" ? document.querySelector(selectEl) : selectEl;
    if (!sel) throw new Error("Select element not found");
    const wanted = normalizeText(match);
    const option = [...sel.options].find(
      (o) => normalizeText(o.value) === wanted || normalizeText(o.textContent) === wanted
    );
    if (!option) throw new Error('Option not found: "' + match + '"');
    setNativeValue(sel, option.value);
    return option;
  }

  /**
   * Drive a +/- stepper to a target count. `getCount` reads the current value;
   * `inc`/`dec` return the buttons. Clicks one step at a time with a guard.
   */
  async function setStepper({ getCount, inc, dec, target, label = "stepper" }) {
    let guard = 0;
    while (guard++ < 50) {
      const current = Number(getCount());
      if (Number.isNaN(current)) throw new Error("Could not read count for " + label);
      if (current === target) return;
      const btn = current < target ? inc() : dec();
      if (!btn) throw new Error("Missing +/- button for " + label);
      btn.click();
      await sleep(150);
    }
    throw new Error("Stepper did not reach target for " + label);
  }

  /** Format `b.date` ('YYYY-MM-DD') into common portal formats. */
  function formatDate(isoDate, style = "iso") {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split("-");
    switch (style) {
      case "iso":
        return isoDate; // YYYY-MM-DD
      case "dmy":
        return `${d}/${m}/${y}`;
      case "mdy":
        return `${m}/${d}/${y}`;
      case "day":
        return String(Number(d)); // bare day number, for calendar cells
      default:
        return isoDate;
    }
  }

  /** Format `b.time` ('HH:MM') — 24h passthrough or 12h. */
  function formatTime(hhmm, style = "24h") {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    if (style === "12h") {
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = ((h + 11) % 12) + 1;
      return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** Parse a price string ("€ 134,00", "1.234,50", "$1,234.50") to a Number. */
  function parsePrice(text) {
    if (text == null) return NaN;
    let s = String(text).replace(/[^\d.,]/g, "");
    if (s.includes(".") && s.includes(",")) {
      // Last separator is the decimal one.
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
      // Comma as decimal (EU) when it looks like ",dd"; else thousands.
      s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
    }
    return parseFloat(s);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Site-specific steps — FILL THESE IN from live exploration.
  // Each receives the normalized booking `b`. Throw a descriptive Error on a
  // hard failure (run() converts it to a clean ERROR result with the step name).
  // ──────────────────────────────────────────────────────────────────────────

  /** Close cookie/consent banners, region pickers, and modals that block the flow. */
  async function dismissInterstitials(b) {
    // {{ e.g. await clickWhenReady('#onetrust-accept-btn-handler', { timeout: CONFIG.timeouts.short }).catch(() => {}); }}
  }

  /**
   * Force the site into CONFIG.language BEFORE any other step, using the exact
   * mechanism found during exploration (URL locale param, cookie, or switcher).
   * If the vendor has no matching locale, leave a no-op with a // TODO(verify):
   * note and rely on language-independent selectors everywhere else.
   * NEVER select on Chrome/Google-translated text.
   */
  async function ensureLanguage(b) {
    // {{ e.g. if (!location.search.includes('lang=en')) { location.search = '?lang=en'; await waitFor(() => document.readyState === 'complete'); } }}
  }

  /** Select the product matching b.productName / b.productDef, honoring the
   *  weekday/weekend/holiday split where the portal needs it. */
  async function selectProduct(b) {
    // {{ branch on b.isWeekend / holiday; pick by stable id/href, name as last resort }}
    throw new Error("selectProduct not implemented");
  }

  /** Select b.date in the portal's date control. Detect not-yet-open / sold-out
   *  days and throw a clear error rather than picking the wrong day. */
  async function selectDate(b) {
    // {{ use formatDate(b.date, ...) appropriate to the control }}
    throw new Error("selectDate not implemented");
  }

  /** Select b.time / the right session (e.g. Morning vs Afternoon). */
  async function selectTime(b) {
    // {{ map b.time via formatTime(...) ; branch morning/afternoon if grouped }}
    throw new Error("selectTime not implemented");
  }

  /** Set quantities by iterating EVERY entry in b.paxMap (type -> count). */
  async function setPax(b) {
    for (const [type, count] of Object.entries(b.paxMap)) {
      // {{ locate the row for `type`, then drive its stepper/dropdown to `count`
      //    using setStepper({...}) or selectOption(...). Map Aries pax types
      //    (GENERAL/ADULT/CHILD/...) to the portal's labels here. }}
      throw new Error("setPax not implemented for pax type: " + type);
    }
  }

  /** Add to basket / cart and proceed toward checkout. */
  async function addToCartAndProceed(b) {
    // {{ e.g. click "Buy items", then "Checkout" }}
    throw new Error("addToCartAndProceed not implemented");
  }

  /** Fill required customer fields. Honor instruction-driven identity rules
   *  (e.g. put the volitand ID in the right field for NON-PARTNERED bookings). */
  async function fillCustomerDetails(b) {
    // {{ fillField('#name', ...), fillField('#phone', ...); accept terms checkbox.
    //    Source identity from the booking instructions, not the JSON, when absent. }}
  }

  /** Drive to the payment page. Selecting a payment METHOD is allowed; entering
   *  card details is NOT. Resolve once the payment page is reached. */
  async function reachPayment(b) {
    // {{ e.g. select "Pay with Bank Card (SimplePay)" if required, click Continue }}
    // Then wait for the payment-page marker:
    await waitFor(() => isPaymentPage(), {
      timeout: CONFIG.timeouts.navigation,
      label: "payment page",
    });
  }

  /** True once the page is the payment page. Used by reachPayment() and run(). */
  function isPaymentPage() {
    // {{ a robust marker: URL pattern, a heading, or presence of a card field }}
    return false;
  }

  /** Read the total shown on the payment page (Number) for price validation. */
  function readDisplayedTotal(b) {
    // {{ const el = document.querySelector('{{TOTAL_SELECTOR}}'); return parsePrice(el && el.textContent); }}
    return NaN;
  }

  /** Read the order/confirmation reference from the post-payment DOM. Runs in a
   *  FRESH injection with no memory of run() — read it straight off the page. */
  function extractConfirmation() {
    // {{ const el = document.querySelector('{{ORDER_REF_SELECTOR}}'); return el && el.textContent.trim(); }}
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Orchestration — generic; usually no edits needed.
  // ──────────────────────────────────────────────────────────────────────────
  async function run(bookingJson) {
    const b = normalizeBooking(bookingJson);
    const steps = [];
    const stepRunner = async (name, fn) => {
      emitProgress(name, "start");
      try {
        await fn(b);
      } catch (e) {
        const error = e && e.message ? e.message : String(e);
        emitProgress(name, "error: " + error);
        return { status: "ERROR", step: name, error };
      }
      steps.push(name);
      emitProgress(name, "done");
      return null;
    };

    const pipeline = [
      ["interstitials", dismissInterstitials],
      ["language", ensureLanguage],
      ["product", selectProduct],
      ["date", selectDate],
      ["time", selectTime],
      ["pax", setPax],
      ["cart", addToCartAndProceed],
      ["customer", fillCustomerDetails],
      ["payment", reachPayment],
    ];

    for (const [name, fn] of pipeline) {
      const failure = await stepRunner(name, fn);
      if (failure) return failure;
    }

    // Reached payment. Validate the displayed total against the booking — but do
    // NOT block: the agent decides. Never pay; never enter card details.
    const displayedTotal = readDisplayedTotal(b);
    const expectedTotal = b.netPrice;
    const priceMismatch =
      Number.isFinite(displayedTotal) &&
      Number.isFinite(expectedTotal) &&
      Math.abs(displayedTotal - expectedTotal) > CONFIG.priceToleranceAbsolute;

    emitProgress("payment", "PAYMENT_REQUIRED");
    return {
      status: "PAYMENT_REQUIRED",
      bookingId: b.bookingId,
      expectedTotal,
      displayedTotal,
      currency: b.currency,
      priceMismatch,
      steps,
    };
  }

  async function confirmAfterPayment() {
    // Separate injection: read the reference from the live confirmation DOM.
    try {
      const reference = await waitFor(
        () => {
          const ref = extractConfirmation();
          return ref ? ref : null;
        },
        { timeout: CONFIG.timeouts.element, label: "order reference" }
      );
      emitProgress("confirm", "CONFIRMED " + reference);
      return { status: "CONFIRMED", reference: String(reference).trim() };
    } catch (e) {
      return { status: "ERROR", step: "confirm", error: e && e.message ? e.message : String(e) };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Register the API (always) + one-time optional triggers (guarded).
  // ──────────────────────────────────────────────────────────────────────────
  window.HeadoutAutomation = { __headoutGenerated: true, run, confirmAfterPayment };

  if (!ALREADY) {
    // Optional postMessage trigger — handy for the skill's live verify step.
    // The extension itself calls run() directly and does not need this.
    try {
      window.addEventListener("message", (e) => {
        if (e.source !== window || !e.data || e.data.type !== "HEADOUT_RUN_BOOKING") return;
        Promise.resolve(run(e.data.booking)).then((result) =>
          window.postMessage({ type: "HEADOUT_RUN_RESULT", result }, "*")
        );
      });
    } catch (_) {}
  }
})();
