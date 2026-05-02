// netlify/functions/mpesa.js
// Serverless function — runs on Netlify's servers, never exposed to the browser.
// Credentials are stored as Netlify Environment Variables (never in your code).

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORT_CODE      = process.env.MPESA_SHORT_CODE   || '174379';
const PASSKEY         = process.env.MPESA_PASSKEY      || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL;
const BASE_URL        = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// ─── Helper: timestamp ────────────────────────────────────────────────────
function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
         `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ─── Step 1: Get access token from Safaricom ──────────────────────────────
async function getAccessToken() {
  const creds = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res   = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    method:  'GET',
    headers: { Authorization: `Basic ${creds}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ─── Step 2: Initiate STK Push ────────────────────────────────────────────
async function stkPush(token, { phone, amount, reference }) {
  const timestamp = getTimestamp();
  const password  = Buffer.from(`${SHORT_CODE}${PASSKEY}${timestamp}`).toString('base64');

  const body = {
    BusinessShortCode: SHORT_CODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            amount,
    PartyA:            phone,
    PartyB:            SHORT_CODE,
    PhoneNumber:       phone,
    CallBackURL:       CALLBACK_URL,
    AccountReference:  reference || 'SleekTech',
    TransactionDesc:   `Payment – ${reference || 'SleekTech'}`
  };

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return await res.json();
}

// ─── Netlify Function Handler ─────────────────────────────────────────────
exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Guard: make sure env vars are set
  if (!CONSUMER_KEY || !CONSUMER_SECRET || !CALLBACK_URL) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server misconfiguration — environment variables missing.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { phone, amount, reference } = payload;

  // Basic validation
  if (!phone || !amount) {
    return { statusCode: 400, body: JSON.stringify({ error: 'phone and amount are required.' }) };
  }
  if (isNaN(amount) || Number(amount) < 1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'amount must be a positive number.' }) };
  }

  try {
    const token  = await getAccessToken();
    const result = await stkPush(token, { phone, amount: Number(amount), reference });

    return {
      statusCode: 200,
      headers:    { 'Content-Type': 'application/json' },
      body:       JSON.stringify(result)
    };
  } catch (err) {
    console.error('M-PESA error:', err);
    return {
      statusCode: 502,
      body:       JSON.stringify({ error: err.message })
    };
  }
};
