import { stripeRecurringForBillingPeriod, stripeUnitAmount } from "../stripe-price";

describe("stripeUnitAmount", () => {
  it("converts a USD major-unit amount to Stripe's minor units", () => {
    expect(stripeUnitAmount(10.99, "usd")).toBe(1099);
  });

  it("respects currencies without fractional units", () => {
    expect(stripeUnitAmount(1099, "jpy")).toBe(1099);
  });

  it.each([
    ["weekly", { interval: "week", interval_count: 1 }],
    ["biweekly", { interval: "week", interval_count: 2 }],
    ["monthly", { interval: "month" }],
    ["yearly", { interval: "year" }],
  ] as const)("maps %s to Stripe's recurring price configuration", (billingPeriod, recurring) => {
    expect(stripeRecurringForBillingPeriod(billingPeriod)).toEqual(recurring);
  });
});
