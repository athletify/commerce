import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MEMBERSHIP_MODULE } from "../../../modules/membership";
import { stripe } from "../../../modules/membership/stripe";
import { getVariantForMembership } from "../../memberships/utils";
import { AdminCreateMembershipPlanType } from "./validators";
import { stripeUnitAmount } from "./stripe-price";

const createStripePrice = async (input: any, title: string, price: any, productId?: string) => {
  const stripeProduct = productId
    ? await stripe.products.retrieve(productId)
    : await stripe.products.create({ name: title, metadata: { medusa_product_id: input.product_id, medusa_variant_id: input.variant_id } });
  const stripePrice = await stripe.prices.create({
    product: stripeProduct.id,
    currency: price.currency_code,
    unit_amount: stripeUnitAmount(price.amount, price.currency_code),
    recurring: { interval: input.billing_period === "monthly" ? "month" : "year" },
    metadata: { medusa_product_id: input.product_id, medusa_variant_id: input.variant_id, sales_channel_id: input.sales_channel_id },
  });
  return { stripe_product_id: stripeProduct.id, stripe_price_id: stripePrice.id };
};

export const POST = async (req: MedusaRequest<AdminCreateMembershipPlanType>, res: MedusaResponse) => {
  const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
  const input = req.validatedBody;
  const { title, price } = await getVariantForMembership(req.scope, input.product_id, input.variant_id, input.sales_channel_id);
  const existing = await membershipService.listMembershipPlans({ variant_id: input.variant_id });
  if (existing.length) throw new Error("A membership plan already exists for this variant");
  const stripeIds = await createStripePrice(input, title, price);
  const plan = await membershipService.createMembershipPlans({ ...input, ...stripeIds, ...price, active: input.active ?? true });
  res.status(201).json({ membership_plan: plan });
};
