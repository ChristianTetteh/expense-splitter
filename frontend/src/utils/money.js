// Formats integer cents (as returned by the API) as a dollar string for
// display — "$12.50", "-$3.00". All money math happens on the server in
// cents; this file only ever formats, never calculates.
export function formatCents(cents, { showSign = false } = {}) {
  const value = cents / 100;
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (showSign) {
    if (cents > 0) return `+$${formatted}`;
    if (cents < 0) return `-$${formatted}`;
    return `$${formatted}`;
  }
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}
