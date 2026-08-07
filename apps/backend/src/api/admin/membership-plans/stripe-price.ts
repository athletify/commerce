export type MembershipBillingPeriod = "weekly" | "biweekly" | "monthly" | "yearly";

export const stripeRecurringForBillingPeriod = (billingPeriod: MembershipBillingPeriod) => {
  switch (billingPeriod) {
    case "weekly":
      return { interval: "week" as const, interval_count: 1 };
    case "biweekly":
      return { interval: "week" as const, interval_count: 2 };
    case "monthly":
      return { interval: "month" as const };
    case "yearly":
      return { interval: "year" as const };
  }
};

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
