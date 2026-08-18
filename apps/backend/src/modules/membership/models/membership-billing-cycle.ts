import { model } from "@medusajs/framework/utils";
import { MembershipSubscription } from "./membership-subscription";

/** One immutable operational projection for each Stripe invoice. */
export const MembershipBillingCycle = model.define("membership_billing_cycle", {
  id: model.id({ prefix: "mcycle" }).primaryKey(),
  membership_subscription: model.belongsTo(() => MembershipSubscription),
  stripe_invoice_id: model.text(),
  stripe_event_id: model.text().nullable(),
  order_id: model.text().nullable(),
  payment_id: model.text().nullable(),
  fulfillment_id: model.text().nullable(),
  currency_code: model.text(),
  subtotal: model.text(),
  tax_total: model.text(),
  total: model.text(),
  status: model.enum(["pending", "paid", "failed", "action_required"]),
});
