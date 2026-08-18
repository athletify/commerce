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
  if (["active", "past_due", "canceled", "incomplete"].includes(status)) {
    return status as "active" | "past_due" | "canceled" | "incomplete";
  }
  return "incomplete" as const;
};

export const stripeDate = (value?: number | null) =>
  value ? new Date(value * 1000) : null;
