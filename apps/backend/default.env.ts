export const StripeConfig = {
  // Local defaults belong in the ignored apps/backend/.env file. Keeping a
  // Stripe key here would expose it to every clone and block GitHub pushes.
  apiKey: process.env.STRIPE_API_KEY || "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "replace_when_we_have_webhooks",
  // Memberships deliberately never fall back to the standard payment webhook
  // secret. They are separate Stripe endpoints and must remain independently
  // configurable in every environment.
  membershipWebhookSecret: process.env.STRIPE_MEMBERSHIP_WEBHOOK_SECRET || "",
};
