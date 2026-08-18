import type { MedusaRequest } from "@medusajs/framework";
import Stripe from "stripe";

export type StripeWebhookVerification =
  | { valid: true; event: Stripe.Event }
  | { valid: false; message: "Membership Stripe webhook secret is not configured" | "Missing Stripe signature" | "Invalid Stripe signature" };

/** `preserveRawBody: true` is configured for this route in api/middlewares.ts. */
export function verifyStripeWebhook(
  request: MedusaRequest,
  stripe: Stripe,
  signingSecret: string | undefined
): StripeWebhookVerification {
  if (!signingSecret) {
    return { valid: false, message: "Membership Stripe webhook secret is not configured" };
  }
  const signature = request.headers["stripe-signature"];
  const rawBody = request.rawBody;
  if (typeof signature !== "string" || !Buffer.isBuffer(rawBody)) {
    return { valid: false, message: "Missing Stripe signature" };
  }
  try {
    return { valid: true, event: stripe.webhooks.constructEvent(rawBody, signature, signingSecret) };
  } catch {
    return { valid: false, message: "Invalid Stripe signature" };
  }
}
