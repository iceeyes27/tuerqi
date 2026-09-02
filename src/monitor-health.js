export function dashboardCollectionError(missingItems = [], missingConversions = []) {
  const failures = [];
  if (missingItems.length > 0) {
    failures.push(`App Store Price missing subscriptions: ${missingItems.join(", ")}`);
  }
  if (missingConversions.length > 0) {
    failures.push(`Google Finance missing conversions: ${missingConversions.join(", ")}`);
  }
  return failures.length > 0 ? failures.join("; ") : null;
}
