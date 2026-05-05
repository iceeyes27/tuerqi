const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/run") {
      return json({
        ok: true,
        usage: "GET /run to scrape and append rows. Add ?dry=1 to scrape without writing to Google Sheets.",
      });
    }

    const dryRun = url.searchParams.get("dry") === "1";
    const result = await runMonitor(env, { dryRun });
    return json(result);
  },
};

async function runMonitor(env, options = {}) {
  const html = await fetchSeagmHtml(env.SEAGM_URL);
  const denoms = parseDenoms(env.DENOMS);
  const prices = extractPrices(html, denoms);
  const rows = buildRows(prices, env.SEAGM_URL);

  if (!options.dryRun) {
    await appendRowsToSheet(env, rows);
  }

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    count: rows.length,
    rows,
  };
}

async function fetchSeagmHtml(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 seagm-price-monitor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`SEAGM request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractPrices(html, denoms) {
  const skuBlocks = html.match(/<label>[\s\S]*?<\/label>/gi) || [];

  return denoms.map((denom) => {
    const block = skuBlocks.find((item) =>
      new RegExp(`iTunes Gift Card ${denom} TL TR`, "i").test(item)
    );

    const match = block?.match(
      /<div class="price">[\s\S]*?<b>¥\s*([0-9.]+)<\/b>\s*<b class="price_origional">¥\s*([0-9.]+)<\/b>/i
    );

    if (!match) {
      throw new Error(`Could not find CNY price for ${denom} TL on SEAGM page`);
    }

    const priceCny = Number(match[1]);
    const originalPriceCny = Number(match[2]);
    const discountPercent = originalPriceCny > 0
      ? round2((1 - priceCny / originalPriceCny) * 100)
      : 0;

    return {
      denomTl: denom,
      priceCny,
      originalPriceCny,
      discountPercent,
      credits: Math.round(priceCny * 58.032155),
      available: true,
    };
  });
}

function buildRows(prices, sourceUrl) {
  const capturedAt = new Date().toISOString();
  return prices.map((price) => [
    capturedAt,
    price.denomTl,
    price.priceCny,
    price.originalPriceCny,
    price.discountPercent,
    price.credits,
    price.available ? "available" : "unavailable",
    sourceUrl,
  ]);
}

async function appendRowsToSheet(env, rows) {
  assertEnv(env, [
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "GOOGLE_SHEET_ID",
    "GOOGLE_SHEET_NAME",
  ]);

  const token = await getGoogleAccessToken(env);
  const range = encodeURIComponent(`${env.GOOGLE_SHEET_NAME}!A:H`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Sheets append failed: ${response.status} ${body}`);
  }
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const unsignedJwt = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
  const signature = await signRs256(unsignedJwt, env.GOOGLE_PRIVATE_KEY);
  const jwt = `${unsignedJwt}.${signature}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google OAuth failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function signRs256(input, privateKeyPem) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input)
  );

  return base64Url(signature);
}

function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/\\n/g, "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseDenoms(value = "500,1000,2000") {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function assertEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
