# Google Form Mock Server

Dependency-free Node.js mock server that returns a JavaScript autofill helper for this form:

https://forms.gle/bJDQEB61MdhUXCVy7

## Run

```sh
npm start
```

The server listens on `http://127.0.0.1:3000` by default.

## REST API

- `GET /health` returns server status and API links.
- `GET /api/forms` lists mock forms.
- `GET /api/forms/order-request` returns the Order Request form resource.
- `GET /api/forms/order-request/fields` returns the form field map discovered from the Google Form metadata.
- `GET /api/forms/order-request/sample-submission` returns sample input data.
- `GET /api/forms/order-request/autofill-script` returns the default JavaScript autofill helper.
- `POST /api/forms/order-request/autofill-scripts` returns a generated JavaScript autofill helper using your request body as default input data.

Compatibility aliases are also available:

- `GET /autofill-google-form.js`
- `GET /sample-order`
- `GET /fields`

## Create an Autofill Script

```sh
curl -X POST http://127.0.0.1:3000/api/forms/order-request/autofill-scripts \
  -H 'Content-Type: application/json' \
  -d '{
    "customerType": "I am an existing customer",
    "item": "SKU-999",
    "colors": ["color 2"],
    "productOptions": "Size S: 1",
    "name": "Grace Hopper",
    "phone": "1234567890",
    "email": "grace@example.com",
    "preferredContactMethod": ["Phone"],
    "comments": "Call during business hours."
  }'
```

The response is JSON:

```json
{
  "data": {
    "formId": "order-request",
    "formUrl": "https://forms.gle/bJDQEB61MdhUXCVy7",
    "script": "'use strict';\n...",
    "input": {
      "customerType": "I am an existing customer"
    }
  }
}
```

To receive raw JavaScript instead of JSON, add `?format=js`:

```sh
curl -X POST 'http://127.0.0.1:3000/api/forms/order-request/autofill-scripts?format=js' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Grace Hopper","phone":"1234567890","item":"SKU-999"}'
```

## Script API

After the script runs on the Google Form page, call:

```js
await window.HeadoutOrderFormAutofill.fill({
  customerType: 'I am a new customer',
  item: 'SKU-12345',
  colors: ['color 1', 'color 3'],
  productOptions: 'Size M: 2 in color 1\nSize L: 1 in color 3',
  name: 'Ada Lovelace',
  phone: '1234567890',
  email: 'ada@example.com',
  preferredContactMethod: ['Email'],
  comments: 'Please confirm current stock before processing.'
});
```

Supported field keys:

- `customerType`: `I am a new customer` or `I am an existing customer`
- `item`
- `colors`: any of `color 1`, `color 2`, `color 3`, `color 4`
- `productOptions`
- `name`
- `phone`
- `email`
- `preferredContactMethod`: `Phone`, `Email`, or both
- `comments`

## Chrome Extension Content Script Example

```js
async function injectAutofillScript() {
  const scriptText = await fetch('http://127.0.0.1:3000/api/forms/order-request/autofill-script').then((res) => res.text());
  const script = document.createElement('script');
  script.textContent = scriptText;
  document.documentElement.appendChild(script);
  script.remove();
}

await injectAutofillScript();

window.postMessage({
  type: 'HEADOUT_ORDER_FORM_AUTOFILL',
  payload: {
    customerType: 'I am an existing customer',
    item: 'SKU-999',
    colors: ['color 2'],
    productOptions: 'Size S: 1',
    name: 'Grace Hopper',
    phone: '1234567890',
    email: 'grace@example.com',
    preferredContactMethod: ['Phone'],
    comments: 'Call during business hours.'
  }
}, '*');
```

For a production Chrome extension, bundle the autofill script inside the extension instead of loading remote code at runtime. Chrome Manifest V3 generally disallows remotely hosted executable code.
