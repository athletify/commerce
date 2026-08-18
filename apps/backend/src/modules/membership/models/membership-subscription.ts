import { model } from "@medusajs/framework/utils";
import { MembershipPlan } from "./membership-plan";

export const MembershipSubscription = model.define("membership_subscription", {
  id: model.id({ prefix: "msub" }).primaryKey(),
  plan: model.belongsTo(() => MembershipPlan),
  renewal_type: model.enum(["recurring", "none"]).default("recurring"),
  stripe_customer_id: model.text().nullable(),
  stripe_subscription_id: model.text().nullable(),
  order_id: model.text().nullable(),
  payment_id: model.text().nullable(),
  fulfillment_id: model.text().nullable(),
  organization_id: model.text().nullable(),
  company_id: model.text().nullable(),
  stock_location_id: model.text().nullable(),
  sale_source: model.text().nullable(),
  cancellation_reason: model.text().nullable(),
  cancellation_requested_at: model.dateTime().nullable(),
  customer_name: model.text().nullable(),
  email: model.text(),
  status: model.enum(["incomplete", "active", "past_due", "canceled", "trialing", "unpaid", "paused", "incomplete_expired"]),
  current_period_start: model.dateTime().nullable(),
  current_period_end: model.dateTime().nullable(),
  cancel_at_period_end: model.boolean().default(false),
});
