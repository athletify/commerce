import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MEMBERSHIP_MODULE } from "../../../../modules/membership";
import { stripe } from "../../../../modules/membership/stripe";
import { getVariantForMembership } from "../../../memberships/utils";
import { AdminUpdateMembershipPlanType } from "../validators";
import { stripeRecurringForBillingPeriod, stripeUnitAmount } from "../stripe-price";

export const POST = async (req: MedusaRequest<AdminUpdateMembershipPlanType>, res: MedusaResponse) => {
  const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
  const [current] = await membershipService.listMembershipPlans({ id: req.params.id });
  if (!current) throw new Error("Membership plan not found");
  const input = { ...current, ...req.validatedBody };
  const { title, price } = await getVariantForMembership(req.scope, input.product_id, input.variant_id, input.sales_channel_id);
  const priceChanged = Number(current.amount) !== price.amount || current.currency_code !== price.currency_code || current.billing_period !== input.billing_period;
  const variantChanged = current.product_id !== input.product_id || current.variant_id !== input.variant_id;
  const stripeIds = priceChanged || variantChanged
    ? await (async () => {
        const product = variantChanged ? undefined : current.stripe_product_id;
        const stripeProduct = product ? await stripe.products.retrieve(product) : await stripe.products.create({ name: title, metadata: { medusa_product_id: input.product_id, medusa_variant_id: input.variant_id } });
        const stripePrice = await stripe.prices.create({ product: stripeProduct.id, currency: price.currency_code, unit_amount: stripeUnitAmount(price.amount, price.currency_code), recurring: stripeRecurringForBillingPeriod(input.billing_period) });
        return { stripe_product_id: stripeProduct.id, stripe_price_id: stripePrice.id };
      })()
    : {};
  const plan = await membershipService.updateMembershipPlans({ id: current.id, ...req.validatedBody, ...stripeIds, ...(priceChanged || variantChanged ? price : {}) });
  res.json({ membership_plan: plan });
};
