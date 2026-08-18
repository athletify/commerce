import Stripe from "stripe";
import { StripeConfig } from "../../../default.env";

export const stripe = new Stripe(StripeConfig.apiKey, {
  apiVersion: "2024-04-10",
  // Keep a failed Stripe request below the caller timeout. A checkout retry is
  // safe because the route supplies an idempotency key to Stripe.
  timeout: 10_000,
  maxNetworkRetries: 0,
});

export const membershipStatus = (status: string) => {
  if (["active", "past_due", "canceled", "incomplete", "trialing", "unpaid", "paused", "incomplete_expired"].includes(status)) {
    return status as "active" | "past_due" | "canceled" | "incomplete" | "trialing" | "unpaid" | "paused" | "incomplete_expired";
  }
  return "incomplete" as const;
};

export const stripeDate = (value?: number | null) =>
  value ? new Date(value * 1000) : null;

// Stripe amounts are in the currency's smallest unit. These currencies have
// no minor unit; all others supported by the current checkout use two.
const ZERO_DECIMAL_CURRENCIES = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

export const stripeAmountToMajor = (amount: number, currency: string) =>
  amount / (ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 1 : 100);

/** Access is granted only while Stripe considers the subscription active or trialing. */
export const membershipHasAccess = (status: string) => status === "active" || status === "trialing";
