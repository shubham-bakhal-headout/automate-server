// Ported from the original mock server.js — builds the Google-Form autofill script.
// Used by the seed to populate the "Order Request" vendor's first script version.

export const LEGACY_FORM_URL = 'https://forms.gle/bJDQEB61MdhUXCVy7';

export const legacyFieldMap = {
  customerType: {
    label: 'Are you a new or existing customer?',
    entry: '1000057',
    type: 'radio',
    options: ['I am a new customer', 'I am an existing customer'],
    required: true,
  },
  item: {
    label: 'What is the item you would like to order?',
    entry: '1000027',
    type: 'text',
    required: true,
  },
  colors: {
    label: 'What color(s) would you like to order?',
    entry: '967112212',
    type: 'checkbox',
    options: ['color 1', 'color 2', 'color 3', 'color 4'],
    required: false,
  },
  productOptions: {
    label: 'Product options',
    entry: '2055232012',
    type: 'textarea',
    required: false,
  },
  name: { label: 'Your name', entry: '1000020', type: 'text', required: true },
  phone: { label: 'Phone number', entry: '1000022', type: 'text', required: true },
  email: { label: 'E-mail', entry: '1000025', type: 'email', required: false },
  preferredContactMethod: {
    label: 'Preferred contact method',
    entry: '1000026',
    type: 'checkbox',
    options: ['Phone', 'Email'],
    required: true,
  },
  comments: { label: 'Questions and comments', entry: '1000023', type: 'textarea', required: false },
};

const sampleOrder = {
  customerType: 'I am a new customer',
  item: 'SKU-12345',
  colors: ['color 1', 'color 3'],
  productOptions: 'Size M: 2 in color 1\nSize L: 1 in color 3',
  name: 'Ada Lovelace',
  phone: '1234567890',
  email: 'ada@example.com',
  preferredContactMethod: ['Email'],
  comments: 'Please confirm current stock before processing.',
};

export function buildLegacyAutofillScript(defaultData?: Record<string, unknown>): string {
  const FORM_URL = LEGACY_FORM_URL;
  const fieldMap = legacyFieldMap;
  const DEFAULT_DATA = defaultData ?? sampleOrder;

  return `'use strict';

(() => {
  const FORM_URL = ${JSON.stringify(FORM_URL)};
  const FIELD_MAP = ${JSON.stringify(fieldMap, null, 2)};
  const DEFAULT_DATA = ${JSON.stringify(DEFAULT_DATA, null, 2)};

  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\\s+/g, ' ');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fireInputEvents(element) {
    for (const type of ['input', 'change', 'blur']) {
      element.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }

  function setNativeValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) { descriptor.set.call(element, value); } else { element.value = value; }
    fireInputEvents(element);
  }

  function getQuestionContainers() {
    return [...document.querySelectorAll('[role="listitem"], .Qr7Oae')];
  }

  function getQuestionTitle(container) {
    return container.querySelector('.M7eMe')?.textContent?.trim() || '';
  }

  function findQuestionByLabel(label) {
    const wanted = normalize(label);
    return getQuestionContainers().find((c) => normalize(getQuestionTitle(c)) === wanted);
  }

  function findQuestionByEntry(entry) {
    return getQuestionContainers().find((c) => {
      const params = c.querySelector('[data-params]')?.getAttribute('data-params') || '';
      return params.includes(String(entry));
    });
  }

  function findQuestion(field) {
    return findQuestionByEntry(field.entry) || findQuestionByLabel(field.label);
  }

  function fillText(field, value) {
    const container = findQuestion(field);
    if (!container) throw new Error('Could not find question: ' + field.label);
    const input = container.querySelector('input:not([type="hidden"]), textarea');
    if (!input) throw new Error('Could not find input for: ' + field.label);
    if (input.disabled) input.disabled = false;
    input.focus();
    setNativeValue(input, String(value ?? ''));
  }

  function clickOption(field, optionValue) {
    const container = findQuestion(field);
    if (!container) throw new Error('Could not find question: ' + field.label);
    const wanted = normalize(optionValue);
    const option = [...container.querySelectorAll('[data-answer-value], [aria-label]')].find((node) => {
      const v = node.getAttribute('data-answer-value') || node.getAttribute('aria-label') || node.textContent || '';
      return normalize(v) === wanted;
    });
    if (!option) throw new Error('Could not find option "' + optionValue + '" for: ' + field.label);
    if (option.getAttribute('aria-disabled') === 'true') {
      option.setAttribute('aria-disabled', 'false');
      option.classList.remove('RDPZE');
    }
    option.click();
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    option.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillChoice(field, value) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values.filter((e) => e !== undefined && e !== null && e !== '')) {
      clickOption(field, item);
    }
  }

  async function waitForFormReady(timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (document.querySelector('form') && getQuestionContainers().length > 0) return;
      await sleep(100);
    }
    throw new Error('Google Form did not become ready before timeout.');
  }

  async function fill(data = DEFAULT_DATA) {
    await waitForFormReady();
    const payload = { ...DEFAULT_DATA, ...data };
    const results = [];
    for (const [key, field] of Object.entries(FIELD_MAP)) {
      const value = payload[key];
      if (value === undefined || value === null || value === '') continue;
      try {
        if (field.type === 'radio' || field.type === 'checkbox') {
          fillChoice(field, value);
        } else {
          fillText(field, value);
        }
        results.push({ key, ok: true });
      } catch (error) {
        results.push({ key, ok: false, error: error.message });
      }
    }
    return { ok: results.every((r) => r.ok), formUrl: FORM_URL, results };
  }

  window.HeadoutOrderFormAutofill = { formUrl: FORM_URL, fields: FIELD_MAP, sampleData: DEFAULT_DATA, fill };

  // Optional postMessage entry point. Guarded so it can never break setup.
  try {
    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'HEADOUT_ORDER_FORM_AUTOFILL') return;
      const result = await fill(event.data.payload || DEFAULT_DATA);
      window.postMessage({ type: 'HEADOUT_ORDER_FORM_AUTOFILL_RESULT', result }, '*');
    });
  } catch (e) {}

  // Optional chrome.runtime entry point — only valid when this script runs as a
  // bundled content script. In a userScripts/USER_SCRIPT world this throws, so
  // it is guarded to avoid aborting the rest of the script.
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== 'HEADOUT_ORDER_FORM_AUTOFILL') return false;
        fill(message.payload || DEFAULT_DATA)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      });
    }
  } catch (e) {}
})();
`;
}
