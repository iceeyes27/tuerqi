const EMBEDDING_VARIANTS = [
  {
    subscriptionMarker: String.raw`\"subscriptionId\":`,
    stringPrefix: (key) => String.raw`\"${key}\":\"`,
    numberPrefix: (key) => String.raw`\"${key}\":`,
    stringEnd: String.raw`\"`,
  },
  {
    subscriptionMarker: '"subscriptionId":',
    stringPrefix: (key) => `"${key}":"`,
    numberPrefix: (key) => `"${key}":`,
    stringEnd: '"',
  },
];

function readStringField(fragment, key, variant) {
  const prefix = variant.stringPrefix(key);
  const valueStart = fragment.indexOf(prefix);
  if (valueStart < 0) {
    return null;
  }

  const start = valueStart + prefix.length;
  const end = fragment.indexOf(variant.stringEnd, start);
  return end < 0 ? null : fragment.slice(start, end);
}

function readNumberField(fragment, key, variant) {
  const prefix = variant.numberPrefix(key);
  const valueStart = fragment.indexOf(prefix);
  if (valueStart < 0) {
    return Number.NaN;
  }

  const value = fragment.slice(valueStart + prefix.length).match(/^-?[0-9]+(?:\.[0-9]+)?/);
  return value ? Number(value[0]) : Number.NaN;
}

function nigeriaPriceObject(planBlock, variant) {
  const regionToken = `${variant.stringPrefix("region")}NG${variant.stringEnd}`;
  const start = planBlock.indexOf(regionToken);
  if (start < 0) {
    return null;
  }

  // Prices are embedded as JSON objects. Limit field reads to the NG object so
  // a later region cannot accidentally supply a missing field.
  const end = planBlock.indexOf("}", start);
  return planBlock.slice(start, end < 0 ? planBlock.length : end + 1);
}

// Pulls the Nigeria (NG/NGN) price for one subscription plan from either the
// Next.js RSC-escaped payload or plain JSON. Fields are read by name inside a
// bounded plan/price object, so harmless upstream insertions or reordering do
// not break the monitor.
export function extractNigeriaPlanPrice(pageHtml, planName, duration = "monthly") {
  const target = planName.toLowerCase();

  for (const variant of EMBEDDING_VARIANTS) {
    const planBlocks = pageHtml.split(variant.subscriptionMarker).slice(1);
    for (const planBlock of planBlocks) {
      const name = readStringField(planBlock, "name", variant);
      if (!name || name.toLowerCase() !== target) {
        continue;
      }

      const planDuration = readStringField(planBlock, "duration", variant);
      if (duration && planDuration && planDuration !== duration) {
        continue;
      }

      const priceObject = nigeriaPriceObject(planBlock, variant);
      if (!priceObject || readStringField(priceObject, "currency", variant) !== "NGN") {
        continue;
      }

      const priceNgn = readNumberField(priceObject, "price", variant);
      const priceUsd = readNumberField(priceObject, "priceUsd", variant);
      const priceCny = readNumberField(priceObject, "priceCny", variant);
      if ([priceNgn, priceUsd, priceCny].every(Number.isFinite) && priceNgn > 0 && priceCny > 0) {
        return { priceNgn, priceUsd, priceCny };
      }
    }
  }

  return null;
}
