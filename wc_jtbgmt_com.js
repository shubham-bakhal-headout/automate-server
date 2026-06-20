/**
 * Headout vendor-portal booking automation — JTB Global Marketing & Travel
 * "Web Connect" agent portal (wc.jtbgmt.com).
 *
 * Generated for the deep link:
 *   https://wc.jtbgmt.com/Webconnect/OptionInfo.aspx?key=130SUETJ001JA007S&...
 *   (product: "Self-guided Ghibli Park Tour: Standard 1-Day Pass & Non-reserved
 *    Seat Shinkansen (One Way from Tokyo)") — but written generically for any
 *   OptionInfo deep link on this host.
 *
 * CONTRACT (see references/contract.md — do not change the shape):
 *   - Injected by the extension into an ISOLATED world that shares the page DOM
 *     but NOT the page's JS globals. No imports. No page globals. Guard chrome.*.
 *   - Registers `window.HeadoutAutomation` synchronously on load:
 *       run(bookingJson)        -> Promise<{ status, ... }>   drives up to payment
 *       confirmAfterPayment()   -> Promise<{ status, reference, ... }>
 *   - Statuses (exact): "PAYMENT_REQUIRED" | "CONFIRMED" | "ERROR".
 *   - run() STOPS at the payment/commit page and returns PAYMENT_REQUIRED. It
 *     NEVER places the order. For this B2B agent portal the commit step is the
 *     Shopping-Cart "Checkout" (billed to the agent account, no card form), so
 *     run() stops ON the Shopping-Cart page with the item in it; the agent then
 *     reviews "Amount To Pay" and clicks Checkout by hand.
 *
 * IMPORTANT — why this script is STAGE-AWARE / RESUMABLE.
 *   Web Connect is a classic ASP.NET WebForms funnel: every step is a FULL page
 *   postback (no SPA, no UpdatePanel). Each full navigation tears down the
 *   USER_SCRIPT context, so the extension (lib/autofill.js → executeWithNavigationRetry)
 *   re-injects this whole script and re-calls run() on the new page. Therefore
 *   run() must NOT assume it starts at the beginning — it inspects the current
 *   page (detectStage) and resumes. A tiny bit of cross-reload state lives in
 *   sessionStorage (search already applied?), never in JS memory.
 *
 *   The funnel is: OptionInfo (set date+pax → Update reload) → OptionInfo (rate
 *   shown → Book now) → AddService (passengers + tour questions → Book service)
 *   → Shopping-Cart (PAYMENT_REQUIRED). That is up to four injected contexts.
 *   NOTE the first hop, OptionInfo "Update", is a `__doPostBack` that reloads the
 *   SAME URL — so the extension must re-inject on a same-URL document teardown,
 *   not only on a URL change, and its MAX_INJECTION_ATTEMPTS must cover all four
 *   hops (+ any language redirect). Both are handled in extension/lib/autofill.js
 *   (executeWithNavigationRetry retries on any context teardown; cap raised to 6).
 */
"use strict";

(() => {
  // Re-injection guard: register one-time side effects (listeners) only once,
  // but always (re)assign window.HeadoutAutomation so the freshest copy wins.
  const ALREADY = window.HeadoutAutomation && window.HeadoutAutomation.__headoutGenerated;

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG
  // ──────────────────────────────────────────────────────────────────────────
  const CONFIG = {
    hostname: "wc.jtbgmt.com",
    // Always 'en'. The portal renders English for the Headout agent account and
    // the OptionInfo deep link has no language switcher; on the logged-in pages a
    // switcher exists and ensureLanguage() forces English if needed.
    language: "en",
    timeouts: {
      element: 15000,
      navigation: 30000,
      short: 5000,
      // Delay after typing into the Vue-bound passenger dialog before clicking
      // Save — saving in the same tick persists an empty passenger (verified live).
      paxSettle: 500,
    },
    // The portal prices in JPY; Headout netPrice is usually EUR. We only flag a
    // price mismatch when the currencies actually match (see run()).
    priceToleranceAbsolute: 0.5,
    // When the portal shows children/infants it requires an age per guest
    // (childAgeList / infantAgeList). The Aries booking carries no ages, so we
    // default to the middle of the supplier's bands — Child (6-11) → 8,
    // Infant (4-5) → 4 — which yields the correct band price (verified live:
    // child age 8 → child price, infant age 4 → infant price). Override per
    // booking via b.raw.childAges[] / b.raw.infantAges[]. The agent confirms the
    // real ages with the passport details on the AddService step.
    defaultChildAge: 8,
    defaultInfantAge: 4,
    // sessionStorage key: remembers that we already ran the OptionInfo "Update"
    // postback for a given date+pax, so the re-injection after the reload clicks
    // "Book now" instead of looping back into another Update.
    searchAppliedKey: "__headout_jtb_search_applied",
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

    // paxMap: { GENERAL: 3 } / { ADULT: 2, CHILD: 1 }.
    const paxMap = {};
    for (const g of Array.isArray(o.guestNumbers) ? o.guestNumbers : []) {
      if (!g || g.type == null) continue;
      paxMap[g.type] = (paxMap[g.type] || 0) + (Number(g.persons) || 0);
    }

    const date = String(o.inventoryDate || ""); // 'YYYY-MM-DD'
    const time = String(o.inventoryTime || "").slice(0, 5); // 'HH:MM'
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
      productDef,
      vendorName: product.vendorName || "",
      vendorId: o.vendorId,
      tourId: o.tourId,
      netPrice: Number(o.netPrice),
      currency: o.tourCurrency || "",
      meetingPointAddress: o.meetingPointAddress || "",
      // Guest names come from the SEPARATE guest-details API, which the extension
      // attaches as booking.guestDetails (extension/background.js:
      //   const booking = { ...bookingDetails, guestDetails }).
      // Shape: { primaryGuest:{firstName,lastName,email}, guests:[{firstName,
      //   lastName, bookingUserFields:[{ name:"Full Name", value }]}] }.
      // passengers[i] maps positionally to AddService slot i (adults then infants).
      passengers: extractPassengers(o),
      primaryGuestName: primaryGuestFullName(o),
      // Optional per-index override of the tour questions, if ever supplied:
      //   o.portalAnswers : string[] aligned to the on-page question order
    };
  }

  /** Best full name for one guest: the "Full Name" field, else firstName+lastName. */
  function guestFullName(g) {
    if (!g) return "";
    const fields = Array.isArray(g.bookingUserFields) ? g.bookingUserFields : [];
    const nameField = fields.find(
      (f) =>
        f &&
        f.value &&
        (f.name === "Full Name" || (f.tourUserFieldType && f.tourUserFieldType.name === "NAME"))
    );
    if (nameField && String(nameField.value).trim()) return String(nameField.value).trim();
    return [g.firstName, g.lastName].filter(Boolean).join(" ").trim();
  }

  /** Unified passenger list from booking.guestDetails.guests[] (or a passengers[] fallback). */
  function extractPassengers(raw) {
    const gd = raw && raw.guestDetails;
    if (gd && Array.isArray(gd.guests) && gd.guests.length) {
      return gd.guests.map((g) => ({
        title: g.title || g.salutation || "",
        firstName: g.firstName || "",
        lastName: g.lastName || "",
        fullName: guestFullName(g),
        email: g.email || "",
      }));
    }
    return Array.isArray(raw && raw.passengers) ? raw.passengers : [];
  }

  /** The primary guest's full name (the pick-up representative for question 4). */
  function primaryGuestFullName(raw) {
    const gd = raw && raw.guestDetails;
    if (gd && gd.primaryGuest) return guestFullName(gd.primaryGuest);
    return "";
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

  /** Choose an <option> in a <select> by value or visible label. Returns the option. */
  function selectOptionSync(sel, match) {
    if (!sel) throw new Error("Select element not found");
    const wanted = normalizeText(match);
    const option = [...sel.options].find(
      (o) => normalizeText(o.value) === wanted || normalizeText(o.textContent) === wanted
    );
    if (!option) throw new Error('Option not found: "' + match + '"');
    setNativeValue(sel, option.value);
    return option;
  }

  /** "26,400" / "JPY 26,400" / "1.234,50" / "$1,234.50" → Number. */
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
  // Portal-specific: stage detection + navigation handling
  // ──────────────────────────────────────────────────────────────────────────

  /** Which page of the funnel are we on? Drives the resumable run(). */
  function detectStage() {
    const p = location.pathname.toLowerCase();
    if (p.includes("optioninfo.aspx")) return "search";
    if (p.includes("addservice.aspx")) return "addservice";
    if (p.includes("shoppingcart.aspx")) return "cart";
    if (p.includes("checkout") || p.includes("bookingconfirm") || p.includes("confirmation"))
      return "confirm";
    return "unknown";
  }

  /**
   * Click something that triggers a FULL page postback/navigation, then hang.
   * The reload tears down this USER_SCRIPT context; the extension detects the
   * navigation and re-injects + re-runs run() on the new page. We must NOT
   * resolve here (resolving would hand the extension a non-navigation result).
   */
  function clickAndHangForNavigation(el, label) {
    if (!el) throw new Error("Cannot navigate: missing control (" + (label || "?") + ")");
    emitProgress("navigate", label || "");
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return new Promise(() => {}); // never resolves — context dies on reload
  }

  /**
   * Map Aries pax types → the portal's three buckets.
   * Portal age policy: Adult (12+), Child (6-11), Infant (4-5).
   */
  function mapPaxToBuckets(b) {
    const buckets = { adults: 0, children: 0, infants: 0 };
    for (const [type, count] of Object.entries(b.paxMap)) {
      const n = Number(count) || 0;
      const t = String(type).toUpperCase();
      if (/INFANT|BABY|LAP/.test(t)) buckets.infants += n;
      else if (/CHILD|KID/.test(t)) buckets.children += n;
      // ADULT / GENERAL / SENIOR / STUDENT / YOUTH / everything else → Adults (12+).
      else buckets.adults += n;
    }
    // Web Connect requires at least one adult to produce a rate.
    if (buckets.adults === 0 && buckets.children === 0 && buckets.infants === 0) buckets.adults = 1;
    return buckets;
  }

  function paxSignature(buckets) {
    return `${buckets.adults}-${buckets.children}-${buckets.infants}`;
  }

  // ── Language ────────────────────────────────────────────────────────────────
  /**
   * Force English. The OptionInfo deep link has no switcher (no-op there). On the
   * logged-in pages there is a language <select> (id contains "switchLanguage");
   * switching it is a postback, so we click+hang and let the extension re-inject.
   */
  async function ensureLanguage() {
    const sel = document.querySelector('select[id*="switchLanguage" i]');
    if (!sel) return; // deep link / page without a switcher — already English.
    const current = (sel.options[sel.selectedIndex] || {}).text || "";
    if (/eng/i.test(current)) return;
    const en = [...sel.options].find((o) => /eng/i.test(o.textContent));
    if (!en) return; // no English option — proceed on language-independent selectors.
    setNativeValue(sel, en.value);
    // onchange triggers a postback; if it navigates, hang for re-injection.
    await sleep(400);
  }

  // ── Stage 1: OptionInfo (date + pax + rate) ──────────────────────────────────

  /** Make the RATES tab/panel active so its controls are interactable. */
  async function revealRatesPanel() {
    if (location.hash.toLowerCase() !== "#rates") {
      const tab =
        document.querySelector('a[href$="#rates"]') ||
        findByText("Rates", { selector: "a", exact: true });
      if (tab) tab.click();
      else location.hash = "rates";
    }
    // Date selects are the reliable marker that the rates form exists.
    await waitFor(() => document.getElementById("ucRateDate_day"), {
      label: "rates search form",
    });
  }

  function hasNoRateMessage() {
    return [...document.querySelectorAll("*")].some(
      (e) => e.children.length === 0 && /no rate information found/i.test(e.textContent || "")
    );
  }

  function findBookNow() {
    return (
      [...document.querySelectorAll("a")].find(
        (a) => /book\s*now/i.test(a.textContent || "") && isVisible(a)
      ) || null
    );
  }

  const dateWithin = (date, min, max) => (!min || date >= min) && (!max || date <= max);

  /** Set day/month/year + pax selects for booking `b`. Throws if out of window. */
  function applySearch(b, buckets) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error("Booking has no valid inventoryDate");
    const minEl = document.getElementById("ucRateDate_min");
    const maxEl = document.getElementById("ucRateDate_max");
    const min = minEl && minEl.value;
    const max = maxEl && maxEl.value;
    if (!dateWithin(b.date, min, max)) {
      throw new Error(
        `Date ${b.date} is outside the portal's bookable window (${min || "?"}..${max || "?"}). ` +
          `If the portal is not yet open for this date, move the booking to Future and book once open.`
      );
    }

    const [yyyy, mm, dd] = b.date.split("-");
    const setSel = (id, val) => {
      const s = document.getElementById(id);
      if (!s) throw new Error("Missing date control: " + id);
      selectOptionSync(s, val);
    };
    // Order matters: the dateSelect widget regenerates month/day options when the
    // year (then month) changes. Set year → month → day.
    setSel("ucRateDate_year", yyyy);
    setSel("ucRateDate_month", mm);
    setSel("ucRateDate_day", dd);
    // Back-stop the hidden ISO field the widget submits (name="ucRateDate").
    const hidden = document.getElementById("ucRateDate_date");
    if (hidden) setNativeValue(hidden, b.date);

    // PAX — the authoritative submitted value lives in the hidden JSON fields
    // hfPaxConfig / hfRoomConfig (an array of one room object). The visible
    // <select class="roomQuantity"> controls have NO `name`, so they are NOT
    // submitted; they only mirror the hidden config via a widget handler that a
    // synthetic change event does not reliably trigger. Verified live: writing
    // these hidden fields drives the server-side rate correctly. We set both the
    // hidden config (authoritative) and the visible selects (for the UI).
    // childAgeList / infantAgeList must each carry exactly one age per guest, or
    // the supplier rejects the search (verified live). Use booking-provided ages
    // if present, else the band-default (see CONFIG).
    const ageList = (count, provided, fallback) => {
      const src = Array.isArray(provided) ? provided : [];
      return Array.from({ length: count }, (_, i) => Number(src[i] != null ? src[i] : fallback));
    };
    const childAgeList = ageList(buckets.children, b.raw.childAges, CONFIG.defaultChildAge);
    const infantAgeList = ageList(buckets.infants, b.raw.infantAges, CONFIG.defaultInfantAge);

    // The pax counts are submitted via the hidden JSON config — NOT the visible
    // dropdowns (which have no `name`). hfPaxConfig is the pax-mode source the
    // server reads for ticket products; we keep hfRoomConfig in sync too.
    const roomConfig = JSON.stringify([
      {
        adults: buckets.adults,
        children: buckets.children,
        infants: buckets.infants,
        roomType: "",
        childAgeList,
        infantAgeList,
      },
    ]);
    for (const name of ["hfRoomConfig", "hfPaxConfig"]) {
      const h = document.querySelector('input[name="' + name + '"]');
      if (h) setNativeValue(h, roomConfig);
    }

    const paxSelects = [...document.querySelectorAll("#optionInfo_paxSection select.roomQuantity")];
    const byLabel = (re) =>
      paxSelects.find((s) => {
        const lbl = s.closest("span") && s.closest("span").querySelector("label");
        return lbl && re.test(lbl.textContent || "");
      });
    const adultsSel = byLabel(/adult/i) || paxSelects[0];
    const childrenSel = byLabel(/child/i) || paxSelects[1];
    const infantsSel = byLabel(/infant/i) || paxSelects[2];
    if (adultsSel) selectOptionSync(adultsSel, String(buckets.adults));
    if (childrenSel) selectOptionSync(childrenSel, String(buckets.children));
    if (infantsSel) selectOptionSync(infantsSel, String(buckets.infants));
  }

  /**
   * OptionInfo handler — resumable.
   *  - First visit (no "applied" flag): set date+pax, click Update (full reload).
   *  - After the reload (flag set): a rate row + "Book now" is shown → click it
   *    (→ AddService); or "No rate information found" → clear ERROR (slot not open).
   */
  async function handleSearchPage(b) {
    await revealRatesPanel();
    const buckets = mapPaxToBuckets(b);
    const desiredSig = b.date + "|" + paxSignature(buckets);

    let applied = false;
    try {
      applied = sessionStorage.getItem(CONFIG.searchAppliedKey) === desiredSig;
    } catch (_) {}

    if (applied) {
      // We already submitted Update for exactly this date+pax; the reload landed
      // us back here. Resolve the result of that search.
      const ready = await waitFor(
        () => (hasNoRateMessage() ? "norate" : findBookNow() ? "book" : null),
        { timeout: CONFIG.timeouts.element, label: "rate result" }
      ).catch(() => null);

      if (ready === "norate") {
        try {
          sessionStorage.removeItem(CONFIG.searchAppliedKey);
        } catch (_) {}
        return {
          status: "ERROR",
          step: "rate",
          error:
            `No rate available for ${b.date} (${paxSignature(buckets)} pax). ` +
            `Per SOP this means the portal slot is not open yet — move the booking to Future ` +
            `and book manually once it opens. (Portal availability ≠ API availability.)`,
        };
      }
      if (ready === "book") {
        try {
          sessionStorage.removeItem(CONFIG.searchAppliedKey);
        } catch (_) {}
        // The rate row (and its "Book now" link) re-renders/flickers, so re-querying
        // at click time can hit a null. clickWhenReady polls + clicks atomically.
        emitProgress("navigate", "Book now → AddService");
        await clickWhenReady(findBookNow, { label: "Book now" });
        return new Promise(() => {}); // navigated; hang for the extension's re-injection
      }
      // Neither appeared — fall through and re-apply once.
    }

    applySearch(b, buckets); // throws on out-of-window date
    try {
      sessionStorage.setItem(CONFIG.searchAppliedKey, desiredSig);
    } catch (_) {}
    const update = document.getElementById("ctl00_UseCasePane_btnSubmit");
    return clickAndHangForNavigation(update, "Update (recompute rate)");
  }

  // ── Stage 2: AddService (passengers + tour questions) ─────────────────────────

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** 'YYYY-MM-DD' → 'DD-Mon-YYYY' (matches how the portal prints dates, e.g. 29-Jul-2026). */
  function formatDayMonthYear(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
    const [y, m, d] = iso.split("-");
    return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
  }

  /**
   * The lead guest's full name — the single source shared by the Passenger Details
   * dialog AND Sunrise question 4 ("pick-up representative … as on passports").
   * Aries does not put a customer name in this payload, so we look broadly:
   *   1. structured b.raw.passengers[0]  (the extension's enriched shape)
   *   2. any common scalar name field on the booking
   *   3. a name the agent already typed into a Passenger Details slot on the page
   * Returns "" when no name is available anywhere (then it is the one field the
   * agent must type — and once typed, a re-run mirrors it into question 4).
   */
  function leadGuestName(b) {
    if (b.primaryGuestName) return b.primaryGuestName;
    const ps = Array.isArray(b.passengers) ? b.passengers : [];
    if (ps[0]) {
      const p = ps[0];
      const n =
        p.fullName ||
        [p.firstName || p.forename, p.lastName || p.surname].filter(Boolean).join(" ").trim();
      if (n) return n;
    }
    for (const key of [
      "customerName",
      "leadGuestName",
      "leadPaxName",
      "primaryGuestName",
      "guestName",
      "contactName",
      "bookingName",
      "travellerName",
    ]) {
      const v = b.raw[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return readEnteredPassengerName();
  }

  /**
   * Read a name the agent has already entered in a Passenger Details slot. Before a
   * name is saved a ".paxName" reads "Enter Passenger"; after, it shows the name.
   */
  function readEnteredPassengerName() {
    const raw =
      [...document.querySelectorAll(".paxName")]
        .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t && !/enter passenger/i.test(t))[0] || "";
    if (!raw) return "";
    // The portal shows a saved name as "Surname, Forename / Title". Normalise to
    // "Forename Surname" for the passport-name question.
    const noTitle = raw.split("/")[0].trim();
    if (noTitle.includes(",")) {
      const [surname, forename] = noTitle.split(",").map((s) => s.trim());
      return [forename, surname].filter(Boolean).join(" ");
    }
    return noTitle;
  }

  /**
   * Answer one "Sunrise Tours Question" from the booking, matching on the question
   * TEXT (robust to ordering / product variation). Returns a string, or null when
   * the answer genuinely isn't derivable from the booking (agent must type it).
   *
   * The questions encode two ticket-delivery modes — pick-up at "Tokyo City i" vs
   * hotel delivery. b.meetingPointAddress tells us which: when it names Tokyo
   * City i, the hotel-delivery questions are "N/A" and pick-up is at Tokyo City i.
   * Verified live against this product: it auto-answers 7 of 8 (only the pick-up
   * representative's passport name, Q4, is left for the agent).
   */
  function answerTourQuestion(qText, ctx) {
    const s = String(qText).toLowerCase();
    // 1 — alphanumeric-only consent.
    if (/alphanumeric characters|enter\s*["']?\s*yes/.test(s)) return "Yes";
    // 2 — ticket pick-up location (hotel name OR Tokyo City i).
    if (/pick-?up location/.test(s)) return ctx.cityI ? "Tokyo City i" : ctx.hotelName || null;
    // 3 — pick-up date at Tokyo City i (N/A for hotel delivery).
    if (/date of pick-?up at tokyo city/.test(s)) return ctx.cityI ? ctx.pickupDate : "N/A";
    // 4 — pick-up representative's full passport name (lead guest).
    if (/pick-?up representative|full names? as they appear|passport/.test(s))
      return ctx.leadName || null;
    // 5 — hotel/ryokan name & address (N/A when using Tokyo City i).
    if (/name and address of the hotel|hotel\/ryokan/.test(s))
      return ctx.cityI ? "N/A" : ctx.hotelAddress || null;
    // 6 — ticket-delivery phone (N/A when using Tokyo City i).
    if (/phone number of the ticket delivery/.test(s))
      return ctx.cityI ? "N/A" : ctx.hotelPhone || null;
    // 7 — hotel check-in/out dates (N/A when using Tokyo City i).
    if (/check-?in and check-?out/.test(s)) return ctx.cityI ? "N/A" : ctx.hotelStay || null;
    // 8 — boarding station for the Shinkansen.
    if (/boarding station/.test(s)) return ctx.boarding || null;
    return null;
  }

  /**
   * Fill passenger name(s) from optional b.raw.passengers (each guest's full
   * passport name — NOT in the Aries payload). Each slot is a ".paxButton" (with a
   * ".paxName" reading "Enter Passenger") that opens the name dialog. Fills as many
   * slots as it has names for; returns how many slots still need a name. Does NOT
   * throw / submit.
   */
  async function fillPassengers(b) {
    let triggers = [...document.querySelectorAll(".paxButton")].filter(isVisible);
    if (triggers.length === 0) {
      triggers = [...document.querySelectorAll(".paxName")].filter(
        (el) => isVisible(el) && /enter passenger/i.test(el.textContent || "")
      );
    }
    if (triggers.length === 0) return { total: 0, missing: 0 };

    const provided = Array.isArray(b.passengers) ? b.passengers : [];
    let filled = 0;
    for (let i = 0; i < triggers.length; i++) {
      // A slot the agent (or a previous run) already named is satisfied.
      const label = (triggers[i].querySelector(".paxName") || triggers[i]).textContent || "";
      if (!/enter passenger/i.test(label)) {
        filled++;
        continue;
      }
      const pax = provided[i];
      if (!pax) continue; // no name for this slot — leave it for the agent
      triggers[i].click();
      await fillField("#paxForename", pax.firstName || pax.forename || "", {
        label: "passenger first name",
      });
      const sur = document.getElementById("paxSurname");
      if (sur) setNativeValue(sur, pax.lastName || pax.surname || "");
      const title = document.getElementById("paxTitle");
      if (title && (pax.title || pax.salutation))
        setNativeValue(title, pax.title || pax.salutation);
      // The dialog is Vue-bound: it commits the typed values on its own tick.
      // Clicking Save in the same beat saves an EMPTY passenger (verified live —
      // the slot stays "Enter Passenger"). Let Vue settle before saving.
      await sleep(CONFIG.timeouts.paxSettle);
      await clickWhenReady("#btnPaxDialogSave", {
        timeout: CONFIG.timeouts.short,
        label: "passenger save",
      });
      await sleep(400); // let the slot re-render with the saved name
      filled++;
    }
    return { total: triggers.length, missing: triggers.length - filled };
  }

  /**
   * Fill the supplier's mandatory "Sunrise Tours Questions". Each question's text
   * lives in the input's preceding table row (input.closest('tr').previousElementSibling).
   * Fills every answer derivable from the booking (see answerTourQuestion); a
   * per-index b.raw.portalAnswers[] overrides everything. Returns the question
   * numbers it could NOT fill, so the agent finishes them. Does NOT throw / submit.
   */
  function fillTourQuestions(b) {
    const inputs = [...document.querySelectorAll("input.vertical-middle.long-input")].filter(
      isVisible
    );
    if (inputs.length === 0) return { total: 0, missing: [] };

    const overrides = Array.isArray(b.raw.portalAnswers) ? b.raw.portalAnswers : [];
    const ctx = {
      cityI: /tokyo city i/i.test(b.meetingPointAddress || ""),
      pickupDate: formatDayMonthYear(b.date),
      leadName: leadGuestName(b),
      // Assumption: the product departs from Tokyo and pick-up is at Tokyo City i
      // (Tokyo Station / KITTE), so default the boarding station to Tokyo Station.
      // Overridable via b.raw.boardingStation. Agent confirms at cart review.
      boarding: b.raw.boardingStation || "Tokyo Station",
      hotelName: b.raw.hotelName || "",
      hotelAddress: b.raw.hotelAddress || "",
      hotelPhone: b.raw.hotelPhone || "",
      hotelStay: b.raw.hotelStay || "",
    };

    const missing = [];
    inputs.forEach((input, i) => {
      const tr = input.closest("tr");
      const qText = tr && tr.previousElementSibling ? tr.previousElementSibling.textContent : "";
      let val = overrides[i];
      if (val == null || val === "") val = answerTourQuestion(qText, ctx);
      if (val == null || val === "") {
        missing.push(i + 1);
        return;
      }
      setNativeValue(input, String(val));
    });
    emitProgress("questions", `filled ${inputs.length - missing.length}/${inputs.length}`);
    return { total: inputs.length, missing };
  }

  /** Optional free-text remark. */
  function fillRemarks(b) {
    const remark =
      document.querySelector('input[name$="remarks"]') ||
      document.querySelector('textarea[name$="remarks"]');
    if (remark && b.raw && b.raw.remarks) setNativeValue(remark, String(b.raw.remarks));
  }

  async function handleAddService(b) {
    await waitFor(() => document.getElementById("ctl00_UseCasePane_btnSave"), {
      label: "Add Service form",
    });
    fillRemarks(b);
    // Passengers FIRST: question 4 ("pick-up representative") mirrors the Passenger
    // Details name, so any name we just entered (or the agent pre-entered) feeds it.
    const pax = await fillPassengers(b);
    const q = fillTourQuestions(b);

    // All Sunrise questions and every passenger name are mandatory. Whatever we
    // could not derive from the booking — typically the passport name(s), and for
    // hotel-delivery bookings the hotel fields — must be typed by the agent. We
    // leave the form PRE-FILLED and stop WITHOUT clicking "Book service".
    if (q.missing.length || pax.missing) {
      const parts = [];
      if (q.missing.length) parts.push(`tour question(s) ${q.missing.join(", ")}`);
      if (pax.missing) parts.push(`${pax.missing} passenger passport name(s)`);
      return {
        status: "ERROR",
        step: "addservice",
        error:
          `Pre-filled ${q.total - q.missing.length}/${q.total} tour questions. ` +
          `Agent must complete ${parts.join(" and ")} (not present in the booking), ` +
          `then click "Book service". (NEEDS_AGENT_INPUT)`,
      };
    }

    const book = document.getElementById("ctl00_UseCasePane_btnSave"); // value "Book service"
    return clickAndHangForNavigation(book, "Book service → Shopping-Cart");
  }

  // ── Stage 3: Shopping-Cart (the commit/"payment" step) ───────────────────────

  function cartIsEmpty() {
    return /your shopping-?cart is empty/i.test(document.body.textContent || "");
  }

  /** True once we are on the agent commit page with an item to pay for. */
  function isPaymentPage() {
    const stage = detectStage();
    if (stage === "cart") return !cartIsEmpty();
    return stage === "confirm";
  }

  /** Read the "Amount To Pay" total off the Shopping-Cart (Number, JPY). */
  function readDisplayedTotal() {
    const label = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && /amount to pay/i.test(e.textContent || "")
    );
    if (!label) return NaN;
    // The value sits in a sibling cell/element on the same row.
    const row = label.closest("tr, div, p, li") || label.parentElement;
    const scope = (row && row.textContent) || "";
    const after = scope.split(/amount to pay\s*:?/i)[1] || scope;
    return parsePrice(after);
  }

  function handleCart(b) {
    if (cartIsEmpty()) {
      return {
        status: "ERROR",
        step: "cart",
        error: "Shopping cart is empty — the item was not added (Book service did not complete).",
      };
    }
    const displayedTotal = readDisplayedTotal();
    const expectedTotal = b.netPrice;
    const currency = "JPY"; // portal always prices in JPY
    // Only meaningful to compare when the booking is also priced in JPY.
    const priceMismatch =
      b.currency === currency &&
      Number.isFinite(displayedTotal) &&
      Number.isFinite(expectedTotal) &&
      Math.abs(displayedTotal - expectedTotal) > CONFIG.priceToleranceAbsolute;

    emitProgress("payment", "PAYMENT_REQUIRED");
    return {
      status: "PAYMENT_REQUIRED",
      bookingId: b.bookingId,
      expectedTotal,
      displayedTotal,
      currency,
      bookingCurrency: b.currency,
      priceMismatch,
      note:
        "Stopped on the Shopping-Cart. Agent reviews 'Amount To Pay' and clicks Checkout " +
        "to commit (billed to the Headout agent account — no card form).",
      steps: ["language", "search", "addservice", "cart"],
    };
  }

  // ── Confirmation (read-only, for confirmAfterPayment) ─────────────────────────

  /**
   * Read the booking/order reference after the agent has clicked Checkout and the
   * portal shows a confirmation. Runs in a FRESH injection — read straight off the
   * DOM. The exact confirmation layout could not be exercised live (doing so would
   * create a real agent reservation), so the selectors are best-effort.
   */
  function extractConfirmation() {
    // 1) A labelled reference ("Booking reference / number / no", "Reservation no").
    const labelRe = /(booking|reservation|order|confirmation)\s*(reference|number|no\.?|ref)/i;
    const labelled = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && labelRe.test(e.textContent || "")
    );
    if (labelled) {
      const row = labelled.closest("tr, li, div, p") || labelled.parentElement;
      const text = (row && row.textContent) || "";
      const m = text.match(/[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})\s*$/i) || text.match(/\b([A-Z]{2,}\d{4,}[A-Z0-9\-]*)\b/);
      if (m) return m[1];
    }
    // 2) A reference carried in the URL after checkout.
    const fromUrl = (location.search.match(/(?:bookingref|reference|resno|bookingno)=([^&]+)/i) || [])[1];
    if (fromUrl) return decodeURIComponent(fromUrl);
    return null; // TODO(verify): confirm against the real post-Checkout page.
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Orchestration — stage-aware run()
  // ──────────────────────────────────────────────────────────────────────────
  async function run(bookingJson) {
    const b = normalizeBooking(bookingJson);
    const stage = detectStage();
    emitProgress("run", "stage=" + stage + " host=" + location.hostname);

    try {
      // Wrong host (e.g. opened somewhere unexpected): bail clearly.
      if (location.hostname && !location.hostname.includes("jtbgmt.com")) {
        return {
          status: "ERROR",
          error: "Not on the JTB Web Connect portal (host=" + location.hostname + ").",
        };
      }

      await ensureLanguage();

      switch (stage) {
        case "search":
          return await handleSearchPage(b);
        case "addservice":
          return await handleAddService(b);
        case "cart":
          return handleCart(b);
        case "confirm":
          // run() landed on a confirmation page — treat as already-committed.
          return {
            status: "ERROR",
            step: "run",
            error: "Reached a confirmation page during run(); use confirmAfterPayment() instead.",
          };
        default:
          return {
            status: "ERROR",
            error: "Unrecognised Web Connect page: " + location.pathname,
          };
      }
    } catch (e) {
      const error = e && e.message ? e.message : String(e);
      emitProgress(stage, "error: " + error);
      return { status: "ERROR", step: stage, error };
    }
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
      return {
        status: "ERROR",
        step: "confirm",
        error: e && e.message ? e.message : String(e),
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Register the API (always) + one-time optional triggers (guarded).
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
