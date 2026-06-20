/**
 * Headout vendor-portal booking automation — Széchenyi Thermal Bath.
 *
 * Portal:  https://jegyek.szechenyifurdo.hu/product/<uuid>   (Hungarian host)
 *          https://tickets.szechenyibath.hu/product/<uuid>   (English host)
 * Product: "Daily ticket [cabin usage]" / "Felnőtt belépőjegy [kabinos]"
 *
 * The Hungarian (jegyek.szechenyifurdo.hu) and English (tickets.szechenyibath.hu)
 * storefronts are SEPARATE HOSTS serving the same SPA + product UUIDs. Switching the
 * in-page language flag navigates between the two hosts. Per the operator's directive
 * this script books in ENGLISH, so it targets the English host (see ensureLanguage).
 *
 * CONTRACT (see references/contract.md — do not change the shape):
 *   - Injected into an ISOLATED world that shares the page DOM but NOT page JS globals.
 *     No imports. No page globals. chrome.* is guarded.
 *   - Registers window.HeadoutAutomation synchronously:
 *       run(bookingJson)      -> Promise<{ status, ... }>  drives up to payment
 *       confirmAfterPayment() -> Promise<{ status, reference, ... }>
 *   - Statuses (exact): "PAYMENT_REQUIRED" | "CONFIRMED" | "ERROR".
 *   - run() STOPS at the payment page (PAYMENT_REQUIRED). It NEVER selects card details
 *     and NEVER places the order. Selecting the SimplePay method is allowed.
 *   - confirmAfterPayment() is a SEPARATE injection with no in-memory state from run():
 *     it reads the order reference straight from the post-payment DOM.
 *   - Return values are plain JSON.
 */
"use strict";

(() => {
  const ALREADY = window.HeadoutAutomation && window.HeadoutAutomation.__headoutGenerated;

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG
  // ──────────────────────────────────────────────────────────────────────────
  const CONFIG = {
    // English storefront host. The Hungarian host is jegyek.szechenyifurdo.hu.
    hostname: "tickets.szechenyibath.hu",
    huHostname: "jegyek.szechenyifurdo.hu",
    // Book in English per operator directive. (Note: the vendor SOP claims the Hungarian
    // storefront books at a lower price; English is used deliberately by request.)
    language: "en",
    // The portal shows EUR on the English host, so its total IS comparable to netPrice.
    portalCurrency: "EUR",
    timeouts: { element: 15000, navigation: 30000, short: 5000 },
    priceToleranceAbsolute: 0.5,
    // Customer / billing identity. The Aries payload carries no customer fields, so these
    // are instruction-driven. The vendor SOP: "use volitand ID in customer details
    // (NON-PARTNERED)" and search Zendesk by that ID — so the volitand ID goes in the
    // Billing Name (#name), the field that surfaces on the order for Zendesk lookup.
    // TODO(verify): supply the real volitand ID + billing address from the booking/agent.
    customer: {
      // volitandId is read from the booking first (see resolveVolitandId); this is a fallback.
      email: "tickets@headout.com",
      countryName: "Magyarország", // "Hungary" — listed under its NATIVE name on the EN site
      zipCode: "1146",
      city: "Budapest",
      streetName: "Állatkerti", // public_space_name
      streetType: "körút", // public_space_type ("körút" = boulevard)
    },
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Booking normalizer — maps the raw Aries payload to a stable shape `b`.
  // ──────────────────────────────────────────────────────────────────────────
  function normalizeBooking(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const vendorsInfo = Array.isArray(o.vendorsInfo) ? o.vendorsInfo : [];
    const product =
      vendorsInfo.find((v) => v && v.vendorId === o.vendorId) || vendorsInfo[0] || {};

    let productDef = {};
    try {
      productDef = JSON.parse(product.productCode || "{}");
    } catch (_) {
      productDef = {};
    }

    const paxMap = {};
    for (const g of Array.isArray(o.guestNumbers) ? o.guestNumbers : []) {
      if (!g || g.type == null) continue;
      paxMap[g.type] = (paxMap[g.type] || 0) + (Number(g.persons) || 0);
    }

    const date = String(o.inventoryDate || ""); // 'YYYY-MM-DD'
    const time = String(o.inventoryTime || "").slice(0, 5); // 'HH:MM:SS' -> 'HH:MM'
    const dow = date ? new Date(date + "T00:00:00").getDay() : null;

    return {
      raw: o,
      bookingId: o.bookingId,
      date,
      time,
      dayOfWeek: dow,
      isWeekend: dow === 0 || dow === 6,
      paxMap,
      // This product is a single ticket type (adult, cabin) with one quantity control,
      // so all pax across every type collapse into one count.
      totalPax: Object.values(paxMap).reduce((a, c) => a + c, 0),
      productName: product.productName || "",
      productCode: product.productCode || "",
      productDef,
      vendorName: product.vendorName || "",
      vendorId: o.vendorId,
      tourId: o.tourId,
      netPrice: Number(o.netPrice),
      currency: o.tourCurrency || "",
      meetingPointAddress: o.meetingPointAddress || "",
    };
  }

  /** The volitand/customer identifier to put in Billing Name. Instruction-driven; pull
   *  from the payload if present, else fall back to the booking id so the order is still
   *  traceable in Zendesk. TODO(verify): confirm the exact field the SOP means by "volitand ID". */
  function resolveVolitandId(b) {
    const o = b.raw || {};
    return String(
      o.volitandId || o.volitandID || o.volitand || o.itineraryId || b.bookingId || ""
    ).trim();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Generic helpers
  // ──────────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function emitProgress(step, detail) {
    try {
      console.log("[HeadoutAutomation]", step, detail ?? "");
    } catch (_) {}
    try {
      window.postMessage({ type: "HEADOUT_PROGRESS", step, detail }, "*");
    } catch (_) {}
  }

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

  /** Find the smallest visible element whose OWN text (no child elements) matches. */
  function findLeafByText(text, { root = document } = {}) {
    const re = text instanceof RegExp ? text : null;
    const wanted = re ? null : normalizeText(text);
    return (
      [...root.querySelectorAll("*")].find((el) => {
        if (!isVisible(el) || el.children.length !== 0) return false;
        const t = el.textContent;
        return re ? re.test(t || "") : normalizeText(t).includes(wanted);
      }) || null
    );
  }

  async function clickWhenReady(selectorOrFn, opts = {}) {
    const get = () =>
      typeof selectorOrFn === "function" ? selectorOrFn() : document.querySelector(selectorOrFn);
    const el = await waitFor(
      () => {
        const e = get();
        return e && isVisible(e) && !e.disabled && e.getAttribute("aria-disabled") !== "true"
          ? e
          : null;
      },
      { ...opts, label: opts.label || "clickable element" }
    );
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return el;
  }

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

  async function fillField(selectorOrFn, value, opts = {}) {
    const el = await waitFor(
      () => {
        const e =
          typeof selectorOrFn === "function" ? selectorOrFn() : document.querySelector(selectorOrFn);
        return e && isVisible(e) ? e : null;
      },
      { ...opts, label: opts.label || "input field" }
    );
    if (el.disabled) el.disabled = false;
    el.focus();
    setNativeValue(el, String(value ?? ""));
    return el;
  }

  /** First scrollable ancestor of `el` (used to page through a virtualized option list). */
  function scrollableParent(el) {
    let p = el && el.parentElement;
    while (p) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return null;
  }

  /**
   * Pick an option from a Vuetify autocomplete (role=combobox). The option list is
   * VIRTUALIZED and the synthetic-input filter does NOT drive it reliably from an isolated
   * world (only real keystrokes do — validated live), so instead of typing we open the
   * dropdown and scroll the list until the matching option renders, then click it.
   * `optionMatch` is a string (substring, case-insensitive) or RegExp.
   * Use `optionMatch` against the option's REAL text (e.g. "Magyarország", not "Hungary").
   */
  async function selectAutocomplete(inputEl, optionMatch, { timeout = CONFIG.timeouts.element } = {}) {
    inputEl.scrollIntoView({ block: "center", behavior: "instant" });
    inputEl.focus();
    inputEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    inputEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    inputEl.click();

    const matcher = (el) => {
      const t = el.textContent || "";
      return optionMatch instanceof RegExp ? optionMatch.test(t) : normalizeText(t).includes(normalizeText(optionMatch));
    };
    const visibleOptions = () => [...document.querySelectorAll("[role=option]")].filter((o) => o.offsetParent !== null);

    await waitFor(() => visibleOptions().length > 0, { timeout: CONFIG.timeouts.short, label: "dropdown options" });

    let found = visibleOptions().find(matcher);
    if (!found) {
      const sc = scrollableParent(visibleOptions()[0]);
      const started = Date.now();
      for (let i = 0; i <= 60 && !found; i++) {
        if (sc) sc.scrollTop = sc.scrollHeight * (i / 60);
        await sleep(80);
        found = visibleOptions().find(matcher);
        if (Date.now() - started > timeout) break;
      }
    }
    if (!found) throw new Error("Option not found in dropdown: " + optionMatch);
    found.scrollIntoView({ block: "center" });
    await sleep(150);
    found.click();
    await sleep(300);
    return found;
  }

  async function setStepper({ getCount, inc, dec, target, label = "stepper" }) {
    let guard = 0;
    while (guard++ < 60) {
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

  function parsePrice(text) {
    if (text == null) return NaN;
    let s = String(text).replace(/[^\d.,]/g, "");
    if (s.includes(".") && s.includes(",")) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
      s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
    }
    return parseFloat(s);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Site-specific steps
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Force the English storefront. The English and Hungarian sites are separate hosts;
   * the in-page flag switch navigates between them. If we are not already on the English
   * host, redirect to it (same product path). This reloads the tab and ends the current
   * run — the booking funnel then proceeds when run() is invoked again on the English
   * page (where this becomes a no-op). Best practice: open the vendor tab on the English
   * host (tickets.szechenyibath.hu) so this is a pure no-op. Runs FIRST in the pipeline.
   */
  async function ensureLanguage(b) {
    if (location.hostname === CONFIG.hostname) return; // already English — nothing to do
    const target = "https://" + CONFIG.hostname + location.pathname + location.search;
    emitProgress("language", "redirecting to English host: " + target);
    location.replace(target);
    // The page is navigating away; halt so run() does not act on the dying Hungarian page.
    await new Promise(() => {});
  }

  /**
   * Close the CookieScript consent banner (privacy-preserving: decline non-essential).
   *
   * CRITICAL: CookieScript is injected ASYNCHRONOUSLY, so it is usually NOT in the DOM
   * yet when this runs at the start of the pipeline. Its overlay blocks the funnel, and
   * — verified live — leaving it up makes the cart DROP the added ticket on the
   * navigation to /cart (the cart page renders "Your cart is empty!" despite the badge
   * showing a count). So we WAIT briefly for the banner to appear, then decline. If no
   * banner shows within the window, there is nothing to dismiss and we proceed.
   */
  async function dismissInterstitials(b) {
    const consentButton = () => {
      // Prefer reject (decline non-essential); fall back to accept/close so the overlay
      // never blocks the funnel. These ids are CookieScript's; verified on the live site.
      for (const id of ["cookiescript_reject", "cookiescript_accept", "cookiescript_close"]) {
        const el = document.getElementById(id);
        if (el && isVisible(el)) return el;
      }
      return null;
    };
    try {
      const btn = await waitFor(consentButton, {
        timeout: 8000,
        label: "cookie consent banner",
      });
      btn.click();
      await sleep(500);
      // Wait for the overlay to actually tear down so later clicks aren't intercepted.
      await waitFor(() => !consentButton(), { timeout: CONFIG.timeouts.short, label: "cookie banner dismissed" }).catch(
        () => {}
      );
    } catch (_) {
      // No consent banner appeared within the window — nothing to dismiss.
    }
  }

  /**
   * The extension opens the product URL directly (the UUID is in the path), so there is
   * no product to pick here. This product is a single "Daily ticket [cabin usage]" with
   * no weekday/weekend/holiday or morning/afternoon split — just date + quantity. We only
   * verify the booking widget (calendar + quantity stepper) has rendered.
   */
  async function selectProduct(b) {
    await waitFor(() => document.querySelector(".flatpickr-day") && document.querySelector(".ticket-increaser"), {
      timeout: CONFIG.timeouts.navigation,
      label: "product booking widget (calendar + quantity)",
    });
  }

  /**
   * Read flatpickr's currently displayed {year, month} (month 1-12) from its header
   * controls — a month <select> (.flatpickr-monthDropdown-months, whose <option>
   * `value` is the 0-indexed month) plus the year <input> (.numInput.cur-year).
   * Both are NUMERIC, so this is language-independent (works the same on the
   * Hungarian and English hosts). Returns null until the controls are present.
   */
  function readVisibleMonth() {
    const sel = document.querySelector(".flatpickr-monthDropdown-months");
    const yearEl = document.querySelector(".numInput.cur-year");
    if (!sel || !yearEl) return null;
    const month = Number(sel.value) + 1;
    const year = Number(yearEl.value);
    if (!Number.isFinite(month) || !Number.isFinite(year)) return null;
    return { year, month };
  }

  /**
   * Select b.date in the flatpickr calendar.
   *
   * The widget is styled as a custom month grid, but underneath it is flatpickr: a
   * month <select> that lists ONLY the bookable months + a year <input>, prev/next
   * arrows, and `.flatpickr-day` cells. To reach a month other than the one shown,
   * we change those controls DIRECTLY (set the year input, then pick the month
   * <option>) — this jumps straight to any bookable month, works in the isolated
   * USER_SCRIPT world (DOM-only, no page-JS / no `_flatpickr` instance), and is
   * language-independent because the controls are numeric. The next-month arrow is
   * kept as a fallback. If the target month is not offered (option missing, or the
   * arrow is disabled) the slot is not open yet → throw so the agent moves the
   * booking to Future (per SOP) rather than booking the wrong day.
   */
  async function selectDate(b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error("Invalid booking date: " + b.date);
    const [ty, tm, td] = b.date.split("-").map(Number); // target year / month(1-12) / day

    await waitFor(() => readVisibleMonth(), { label: "calendar month controls" });
    const onTarget = () => {
      const v = readVisibleMonth();
      return !!(v && v.year === ty && v.month === tm);
    };

    // (1) Direct jump via the year input + month dropdown (best-effort; any failure
    //     falls through to the arrow navigation below).
    if (!onTarget()) {
      try {
        const yearEl = document.querySelector(".numInput.cur-year");
        if (yearEl && Number(yearEl.value) !== ty) {
          setNativeValue(yearEl, String(ty));
          await sleep(300);
        }
        const sel = document.querySelector(".flatpickr-monthDropdown-months");
        const opt = sel && [...sel.options].find((o) => Number(o.value) + 1 === tm);
        if (opt && sel.value !== opt.value) {
          setNativeValue(sel, opt.value);
          await waitFor(onTarget, { timeout: CONFIG.timeouts.short, label: "month " + ty + "-" + tm }).catch(() => {});
        }
      } catch (_) {
        /* fall through to arrow navigation */
      }
    }

    // (2) Fallback: advance month-by-month with the next-month arrow, polling until
    //     the displayed month actually changes (no brittle fixed delays).
    let guard = 0;
    while (!onTarget() && guard++ < 24) {
      const vis = readVisibleMonth();
      if (!vis) throw new Error("Could not read calendar month");
      if (ty * 12 + tm < vis.year * 12 + vis.month) {
        // Earlier than the earliest bookable month → not open / in the past.
        throw new Error("Date " + b.date + " is before the earliest bookable month — slot not open (move to Future).");
      }
      const next = document.querySelector(".flatpickr-next-month");
      if (!next || next.classList.contains("flatpickr-disabled") || !isVisible(next)) {
        throw new Error("Date " + b.date + " is beyond the bookable window — slot not open (move to Future).");
      }
      const fromKey = vis.year * 12 + vis.month;
      next.click();
      await waitFor(
        () => {
          const v = readVisibleMonth();
          return v && v.year * 12 + v.month > fromKey ? v : null;
        },
        { timeout: CONFIG.timeouts.short, label: "calendar to advance past " + vis.year + "-" + vis.month }
      );
    }

    if (!onTarget()) {
      throw new Error("Could not navigate the calendar to " + b.date + " — slot not open (move to Future).");
    }

    // Pick the day cell whose aria-label resolves to the EXACT target date. Matching
    // the full date — not just the day number — waits out flatpickr's ASYNC grid
    // re-render after a month change: the month <select> value flips synchronously
    // (so the nav loop above already thinks we're on the target month) while the day
    // grid repaints a beat later. Clicking by number in that gap selects the
    // still-rendered PREVIOUS month's same-numbered day and commits the wrong date
    // (e.g. 2026-06-20 instead of 2026-07-20) — the "can't change to next month" bug.
    // The script always runs in English (ensureLanguage), so the aria-label
    // ("July 20, 2026") parses with the native Date constructor.
    const dayCell = await waitFor(
      () => {
        const notPadding = (d) =>
          !d.classList.contains("prevMonthDay") && !d.classList.contains("nextMonthDay");
        const cells = [...document.querySelectorAll(".flatpickr-day")].filter(notPadding);
        const byAria = cells.find((d) => {
          const dt = new Date(d.getAttribute("aria-label") || "");
          return (
            !Number.isNaN(dt.getTime()) &&
            dt.getFullYear() === ty &&
            dt.getMonth() + 1 === tm &&
            dt.getDate() === td
          );
        });
        if (byAria) return byAria;
        // Fallback if aria-label is absent/unparseable: match by number, but ONLY once
        // the displayed month equals the target so we never click the stale grid.
        return onTarget()
          ? cells.find((d) => Number(d.textContent.trim()) === td) || null
          : null;
      },
      { label: "day cell for " + b.date, timeout: CONFIG.timeouts.short }
    ).catch(() => {
      throw new Error("Could not find the day cell for " + b.date + " — calendar did not render it.");
    });
    if (dayCell.classList.contains("flatpickr-disabled")) {
      throw new Error("Date " + b.date + " is disabled (past, not yet open, or sold out).");
    }
    dayCell.click();
    await sleep(300);

    // Confirm flatpickr's hidden ISO input committed to the target date.
    await waitFor(
      () => {
        const inp = document.querySelector("#date, input.flatpickr-input");
        return inp && inp.value === b.date ? inp : null;
      },
      { label: "selected date = " + b.date, timeout: CONFIG.timeouts.short }
    );
  }

  /**
   * No time/session selection for this product — the "Daily ticket [cabin usage]" is an
   * all-day ticket with no time slot on the portal. (The booking's inventoryTime is not
   * used here.) No-op by design.
   */
  async function selectTime(b) {
    return;
  }

  /**
   * Set the ticket quantity. This product has a SINGLE quantity control (one ticket type),
   * so the counts of every pax type in the booking collapse into one total.
   */
  async function setPax(b) {
    const target = b.totalPax;
    if (!target || target < 1) throw new Error("Booking has no guests (totalPax=" + target + ")");
    const buttons = () => [...document.querySelectorAll(".ticket-increaser .ticket-increment")];
    await waitFor(() => buttons().length >= 2 && document.querySelector(".ticket-increaser .ticket-count"), {
      label: "quantity stepper",
    });
    await setStepper({
      getCount: () => document.querySelector(".ticket-increaser .ticket-count").textContent.trim(),
      // The stepper renders [ - ] [count] [ + ]: minus is first, plus is last.
      dec: () => buttons()[0],
      inc: () => buttons()[buttons().length - 1],
      target,
      label: "ticket quantity",
    });
  }

  /** Accept the product-page terms, add to cart, open the cart, and proceed to Billing Data. */
  async function addToCartAndProceed(b) {
    // Accept the product terms checkbox (exclude the CookieScript category checkboxes).
    // Vuetify renders the real <input> with opacity:0, so use layout presence
    // (offsetParent) rather than isVisible() — which would reject a 0-opacity input.
    const terms = [...document.querySelectorAll('input[type=checkbox]')].find(
      (c) => c.offsetParent !== null && !(c.id || "").startsWith("cookiescript")
    );
    if (terms && !terms.checked) {
      terms.click();
      await sleep(200);
    }

    // Add to cart ("Cart" / "Kosárba"). The button toggles a `disabled`/`enabled` CSS
    // class (not the disabled property) based on quantity + terms, so wait for `enabled`.
    await clickWhenReady(
      () =>
        [...document.querySelectorAll("button.custom-button")].find(
          (x) => isVisible(x) && x.className.includes("enabled") && !x.className.includes("disabled")
        ),
      { label: "Add to cart button (enabled)" }
    );

    // Wait until the cart actually reflects the addition (header badge shows a count)
    // before navigating — clicking add and routing away too quickly drops the item.
    await waitFor(
      () => {
        const link = document.querySelector('a[href="/cart"]');
        return link && /\d/.test(link.textContent) ? link : null;
      },
      { label: "cart to register the added ticket", timeout: CONFIG.timeouts.short }
    );

    // Go to the cart page.
    await clickWhenReady('a[href="/cart"]', { label: "Cart link" });
    await waitFor(
      () => location.pathname === "/cart" && !findByText("your cart is empty"),
      { label: "cart page with items", timeout: CONFIG.timeouts.navigation }
    );

    // Cart → Billing Data: the enabled "Pay" button on the cart advances to billing.
    await clickWhenReady(
      () => [...document.querySelectorAll("button")].find((x) => isVisible(x) && /^pay$/i.test(x.textContent.trim()) && !x.disabled && !x.className.includes("disabled")),
      { label: "cart Pay (proceed to billing) button" }
    );
    // Billing Data step is reached when the email field is present.
    await waitFor(() => document.querySelector("#email") && isVisible(document.querySelector("#email")), {
      label: "billing data form",
      timeout: CONFIG.timeouts.navigation,
    });
  }

  /**
   * Fill the required billing fields. The Aries payload carries no customer data, so values
   * come from CONFIG.customer; the volitand ID (SOP: NON-PARTNERED) goes in Billing Name so
   * the order is searchable in Zendesk. NOTE: Hungary appears under its native name
   * "Magyarország" in the (otherwise English) country list.
   * Required: #email, #name, #country_id, #zip_code, #city, #public_space_name, #public_space_type.
   */
  async function fillCustomerDetails(b) {
    const c = CONFIG.customer;
    const volitandId = resolveVolitandId(b);

    await fillField("#email", c.email, { label: "email" });
    await fillField("#name", volitandId || c.email, { label: "billing name (volitand ID)" });
    await fillField("#zip_code", c.zipCode, { label: "postal code" });
    await fillField("#city", c.city, { label: "city" });
    await fillField("#public_space_name", c.streetName, { label: "street" });
    await fillField("#public_space_type", c.streetType, { label: "street type" });

    // Country is a Vuetify autocomplete — open and pick "Magyarország" (Hungary's native
    // name, how it appears in the list).
    const countryInput = await waitFor(() => document.querySelector("#country_id"), { label: "country field" });
    await selectAutocomplete(countryInput, c.countryName);
  }

  /** True once the SimplePay payment step is reached (the marker run() stops at). */
  function isPaymentPage() {
    // The SimplePay radio's real <input> is opacity:0 (Vuetify), so test layout presence
    // (offsetParent), not isVisible().
    const simple = document.querySelector('input[type=radio][value="simple_eur"]');
    if (simple && simple.offsetParent !== null) return true;
    // Fallback markers, in case radio values change.
    return !!findByText("Payment Type", { selector: "h1,h2,h3" }) && !!findByText("Total Amount");
  }

  /**
   * From Billing Data, advance to the SimplePay payment page and select the SimplePay
   * method (the SOP's "Pay with Bank Card (SimplePay)"; it is the default). STOP here —
   * never check the final terms boxes, never click the final Pay, never enter card data.
   */
  async function reachPayment(b) {
    await clickWhenReady(
      () => [...document.querySelectorAll("button")].find((x) => isVisible(x) && /^next$/i.test(x.textContent.trim()) && !x.disabled),
      { label: "Next (billing -> summary) button" }
    );

    await waitFor(() => isPaymentPage(), { timeout: CONFIG.timeouts.navigation, label: "payment page" });

    // Ensure the SimplePay method is selected (default, but make it explicit).
    const simple = document.querySelector('input[type=radio][value="simple_eur"]');
    if (simple && !simple.checked) {
      simple.click();
      await sleep(300);
    }
  }

  /** Read the displayed grand total (EUR) on the payment page for price validation. */
  function readDisplayedTotal(b) {
    // "Total Amount: €147" — read the price out of the line holding that label.
    const label = findLeafByText(/total amount/i);
    if (label) {
      const container = label.parentElement || label;
      const m = (container.textContent || "").match(/[€\d.,\s]+\d/);
      const fromLabel = parsePrice(container.textContent);
      if (Number.isFinite(fromLabel)) return fromLabel;
      if (m) return parsePrice(m[0]);
    }
    // Fallback: any visible euro amount on the page.
    const euro = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && isVisible(e) && /€\s*\d/.test(e.textContent)
    );
    return euro ? parsePrice(euro.textContent) : NaN;
  }

  /**
   * Read the order/confirmation reference from the post-payment DOM. Runs in a FRESH
   * injection with no memory of run(). The confirmation page could not be reached during
   * authoring (it requires completing a real payment), so this is best-effort: it scans
   * for an "Order Reference" / "Reference Number" label and returns the adjacent value.
   * TODO(verify): confirm the exact label and selector on the real success page.
   */
  function extractConfirmation() {
    const labelRe = /(order\s*reference(\s*number)?|reference\s*number|rendelési\s*azonosító|megrendelés\s*szám)/i;
    const label = [...document.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && isVisible(el) && labelRe.test(el.textContent || "")
    );
    if (label) {
      // Prefer an alphanumeric ref inside the same line/container.
      const container = label.parentElement || label;
      const text = (container.textContent || "").replace(/\s+/g, " ").trim();
      const after = text.replace(labelRe, "").replace(/^[:\s#-]+/, "").trim();
      const token = (after.match(/[A-Za-z0-9][A-Za-z0-9._/-]{3,}/) || [])[0];
      if (token) return token;
      // Otherwise the next sibling's text.
      const sib = label.nextElementSibling;
      if (sib && sib.textContent.trim()) return sib.textContent.trim();
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Orchestration
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

    // Language FIRST (it may redirect the tab to the English host before anything else).
    const pipeline = [
      ["language", ensureLanguage],
      ["interstitials", dismissInterstitials],
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

    // Reached the payment page. Validate the displayed total against the booking netPrice.
    // Both are EUR on the English host. (Displayed is retail; netPrice is Headout's net —
    // they legitimately differ, so priceMismatch is informational and never blocks.)
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
      currency: CONFIG.portalCurrency,
      priceMismatch,
      steps,
    };
  }

  async function confirmAfterPayment() {
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
  // Register API + optional triggers.
  // ──────────────────────────────────────────────────────────────────────────
  window.HeadoutAutomation = { __headoutGenerated: true, run, confirmAfterPayment };

  if (!ALREADY) {
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
