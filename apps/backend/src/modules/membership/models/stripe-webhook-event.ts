import { model } from "@medusajs/framework/utils";

export const StripeWebhookEvent = model.define("stripe_webhook_event", {
  id: model.id({ prefix: "mwe" }).primaryKey(),
  stripe_event_id: model.text().unique(),
});
