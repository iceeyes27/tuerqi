const GOOGLE_FINANCE_ORIGIN = "https://www.google.com/finance";

export function googleFinanceQuoteUrls(baseCurrency, quoteCurrency) {
  const pair = `${normalizeCurrency(baseCurrency)}-${normalizeCurrency(quoteCurrency)}`;
  return [
    `${GOOGLE_FINANCE_ORIGIN}/quote/${pair}`,
    `${GOOGLE_FINANCE_ORIGIN}/beta/quote/${pair}`,
  ];
}

export function extractGoogleFinanceRate(pageHtml, baseCurrency, quoteCurrency) {
  const serializedPair = extractSerializedRate(pageHtml, baseCurrency, quoteCurrency);
  if (Number.isFinite(serializedPair) && serializedPair > 0) {
    return serializedPair;
  }

  const dataLastPrice = pageHtml.match(/data-last-price="([0-9.]+)"/);
  if (dataLastPrice) {
    const rate = Number(dataLastPrice[1]);
    return Number.isFinite(rate) && rate > 0 ? rate : NaN;
  }

  const financePrice = pageHtml.match(/<div[^>]+class="[^"]*\bYMlKec\b[^"]*"[^>]*>\s*([0-9.,]+)\s*<\/div>/);
  if (financePrice) {
    const rate = Number(financePrice[1].replace(/,/g, ""));
    return Number.isFinite(rate) && rate > 0 ? rate : NaN;
  }

  return NaN;
}

export function buildGoogleConversionSnapshot(definition, rate, sourceUrl) {
  const normalizedRate = Number(rate);
  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) {
    throw new TypeError("Google Finance rate must be a positive number");
  }

  return {
    baseCurrency: definition.baseCurrency,
    quoteCurrency: definition.quoteCurrency,
    amount: definition.amount,
    rate: round(normalizedRate, 8),
    convertedAmount: round(definition.amount * normalizedRate, 2),
    source: "Google Finance",
    sourceUrl,
  };
}

function extractSerializedRate(pageHtml, baseCurrency, quoteCurrency) {
  const base = escapeRegExp(normalizeCurrency(baseCurrency));
  const quote = escapeRegExp(normalizeCurrency(quoteCurrency));
  const numberPattern = "([0-9]+(?:\\.[0-9]+)?(?:E[+-]?\\d+)?)";
  const pairAfterRate = new RegExp(
    `,\\s*${numberPattern}\\s*,\\s*"${base}\\s*\\/\\s*${quote}"\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\[\\s*"${base}"\\s*,\\s*"${quote}"`,
    "i",
  );
  const pairBeforeRate = new RegExp(
    `"${base}\\s*\\/\\s*${quote}"\\s*,\\s*\\d+\\s*,\\s*null\\s*,\\s*\\[\\s*${numberPattern}`,
    "i",
  );

  const match = pageHtml.match(pairAfterRate) || pageHtml.match(pairBeforeRate);
  return match ? Number(match[1]) : NaN;
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError(`Invalid currency code: ${value}`);
  }
  return currency;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
