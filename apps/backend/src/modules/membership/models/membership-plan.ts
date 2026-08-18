import { model } from "@medusajs/framework/utils";

export const MembershipPlan = model.define("membership_plan", {
  id: model.id({ prefix: "mplan" }).primaryKey(),
  product_id: model.text(),
  variant_id: model.text(),
  sales_channel_id: model.text(),
  billing_period: model.enum(["weekly", "biweekly", "monthly", "yearly"]),
  stripe_product_id: model.text(),
  stripe_price_id: model.text(),
  // A snapshot of the variant price used to create the immutable Stripe Price.
  amount: model.bigNumber(),
  currency_code: model.text(),
  active: model.boolean().default(true),
});
