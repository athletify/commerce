export const stripeUnitAmount = (amount: unknown, currencyCode: string): number => {
  const majorAmount = typeof amount === "number" ? amount : Number(amount);
  const currency = currencyCode.trim().toUpperCase();
  if (!Number.isFinite(majorAmount) || majorAmount < 0 || !currency) {
    throw new Error("Membership price must be a non-negative amount with a currency");
  }

  const decimals = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const unitAmount = Math.round((majorAmount + Number.EPSILON) * 10 ** decimals);
  if (!Number.isSafeInteger(unitAmount)) {
    throw new Error("Membership price is outside Stripe's supported range");
  }

  return unitAmount;
};
