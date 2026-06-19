'use strict';

const http = require('node:http');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const FORM_URL = 'https://forms.gle/bJDQEB61MdhUXCVy7';
const FORM_ID = 'order-request';

const sampleOrder = {
  customerType: 'I am a new customer',
  item: 'SKU-12345',
  colors: ['color 1', 'color 3'],
  productOptions: 'Size M: 2 in color 1\nSize L: 1 in color 3',
  name: 'Ada Lovelace',
  phone: '1234567890',
  email: 'ada@example.com',
  preferredContactMethod: ['Email'],
  comments: 'Please confirm current stock before processing.'
};

const fieldMap = {
  customerType: {
    label: 'Are you a new or existing customer?',
    entry: '1000057',
    type: 'radio',
    options: ['I am a new customer', 'I am an existing customer'],
    required: true
  },
  item: {
    label: 'What is the item you would like to order?',
    entry: '1000027',
    type: 'text',
    required: true
  },
  colors: {
    label: 'What color(s) would you like to order?',
    entry: '967112212',
    type: 'checkbox',
    options: ['color 1', 'color 2', 'color 3', 'color 4'],
    required: false
  },
  productOptions: {
    label: 'Product options',
    entry: '2055232012',
    type: 'textarea',
    required: false
  },
  name: {
    label: 'Your name',
    entry: '1000020',
    type: 'text',
    required: true
  },
  phone: {
    label: 'Phone number',
    entry: '1000022',
    type: 'text',
    required: true
  },
  email: {
    label: 'E-mail',
    entry: '1000025',
    type: 'email',
    required: false
  },
  preferredContactMethod: {
    label: 'Preferred contact method',
    entry: '1000026',
    type: 'checkbox',
    options: ['Phone', 'Email'],
    required: true
  },
  comments: {
    label: 'Questions and comments',
    entry: '1000023',
    type: 'textarea',
    required: false
  }
};

function sendJson(res, status, body, includeBody = true) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(includeBody ? payload : undefined);
}

function sendScript(res, status, script, includeBody = true) {
  res.writeHead(status, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(script)
  });
  res.end(includeBody ? script : undefined);
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end();
}

function getBaseUrl(req) {
  return `http://${req.headers.host}`;
}

function getFormResource(req) {
  const baseUrl = getBaseUrl(req);

  return {
    id: FORM_ID,
    title: 'Order Request',
    formUrl: FORM_URL,
    links: {
      self: `${baseUrl}/api/forms/${FORM_ID}`,
      fields: `${baseUrl}/api/forms/${FORM_ID}/fields`,
      sampleSubmission: `${baseUrl}/api/forms/${FORM_ID}/sample-submission`,
      autofillScript: `${baseUrl}/api/forms/${FORM_ID}/autofill-script`,
      autofillScripts: `${baseUrl}/api/forms/${FORM_ID}/autofill-scripts`
    }
  };
}

function buildAutofillScript(defaultData) {
  return `'use strict';

(() => {
  const FORM_URL = ${JSON.stringify(FORM_URL)};
  const FIELD_MAP = ${JSON.stringify(fieldMap, null, 2)};
  const DEFAULT_DATA = ${JSON.stringify(defaultData || sampleOrder, null, 2)};

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

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

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
    return getQuestionContainers().find((container) => normalize(getQuestionTitle(container)) === wanted);
  }

  function findQuestionByEntry(entry) {
    return getQuestionContainers().find((container) => {
      const params = container.querySelector('[data-params]')?.getAttribute('data-params') || '';
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
      const value = node.getAttribute('data-answer-value') || node.getAttribute('aria-label') || node.textContent || '';
      return normalize(value) === wanted;
    });

    if (!option) {
      throw new Error('Could not find option "' + optionValue + '" for: ' + field.label);
    }

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
    for (const item of values.filter((entry) => entry !== undefined && entry !== null && entry !== '')) {
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

    return {
      ok: results.every((result) => result.ok),
      formUrl: FORM_URL,
      results
    };
  }

  window.HeadoutOrderFormAutofill = {
    formUrl: FORM_URL,
    fields: FIELD_MAP,
    sampleData: DEFAULT_DATA,
    fill
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'HEADOUT_ORDER_FORM_AUTOFILL') return;

    const result = await fill(event.data.payload || DEFAULT_DATA);
    window.postMessage({ type: 'HEADOUT_ORDER_FORM_AUTOFILL_RESULT', result }, '*');
  });

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'HEADOUT_ORDER_FORM_AUTOFILL') return false;

      fill(message.payload || DEFAULT_DATA)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    });
  }
})();
`;
}

function parseDataParam(url) {
  const raw = url.searchParams.get('data');
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const includeBody = req.method !== 'HEAD';

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  if (url.pathname === '/' || url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      links: {
        forms: `${getBaseUrl(req)}/api/forms`,
        orderRequest: `${getBaseUrl(req)}/api/forms/${FORM_ID}`,
        health: `${getBaseUrl(req)}/health`
      }
    }, includeBody);
    return;
  }

  if (url.pathname === '/api/forms' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, {
      data: [getFormResource(req)]
    }, includeBody);
    return;
  }

  if (url.pathname === `/api/forms/${FORM_ID}` && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, { data: getFormResource(req) }, includeBody);
    return;
  }

  if (url.pathname === `/api/forms/${FORM_ID}/fields` && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, { data: fieldMap }, includeBody);
    return;
  }

  if (url.pathname === `/api/forms/${FORM_ID}/sample-submission` && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, { data: sampleOrder }, includeBody);
    return;
  }

  if (url.pathname === `/api/forms/${FORM_ID}/autofill-script` && (req.method === 'GET' || req.method === 'HEAD')) {
    sendScript(res, 200, buildAutofillScript(parseDataParam(url)), includeBody);
    return;
  }

  if (url.pathname === `/api/forms/${FORM_ID}/autofill-scripts` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const data = body.data || body;
      const script = buildAutofillScript(data);

      if (url.searchParams.get('format') === 'js') {
        sendScript(res, 201, script);
        return;
      }

      sendJson(res, 201, {
        data: {
          formId: FORM_ID,
          formUrl: FORM_URL,
          script,
          input: data
        }
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // Compatibility aliases for the first mock-server version.
  if (url.pathname === '/fields' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, fieldMap, includeBody);
    return;
  }

  if (url.pathname === '/sample-order' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, sampleOrder, includeBody);
    return;
  }

  if (url.pathname === '/autofill-google-form.js' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendScript(res, 200, buildAutofillScript(parseDataParam(url)), includeBody);
    return;
  }

  if (!['GET', 'POST', 'HEAD'].includes(req.method)) {
    sendJson(res, 405, { error: 'Only GET, POST, HEAD, and OPTIONS are supported.' }, includeBody);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' }, includeBody);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || 'Internal server error.' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Mock server listening on http://${HOST}:${PORT}`);
  console.log(`REST API: http://${HOST}:${PORT}/api/forms/${FORM_ID}`);
  console.log(`Autofill script: http://${HOST}:${PORT}/api/forms/${FORM_ID}/autofill-script`);
});
