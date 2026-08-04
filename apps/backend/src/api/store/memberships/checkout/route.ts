import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MEMBERSHIP_MODULE } from "../../../../modules/membership";
import { stripe, membershipStatus, stripeDate } from "../../../../modules/membership/stripe";
import { storeSalesChannelIds } from "../../../memberships/utils";
import { z } from "@medusajs/framework/zod";
import { StoreCreateMembershipCheckout } from "../validators";

export const POST = async (req: MedusaRequest<z.infer<typeof StoreCreateMembershipCheckout>>, res: MedusaResponse) => {
  const idempotencyKeyHeader = req.headers["idempotency-key"];
  if (typeof idempotencyKeyHeader !== "string" || !idempotencyKeyHeader.trim() || idempotencyKeyHeader.length > 220) {
    return res.status(400).json({ message: "An Idempotency-Key header is required for membership checkout" });
  }
  const idempotencyKey = `membership-checkout:${idempotencyKeyHeader.trim()}`;
  const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
  const [plan] = await membershipService.listMembershipPlans({ id: req.validatedBody.plan_id, active: true });
  if (!plan || !storeSalesChannelIds(req).includes(plan.sales_channel_id)) {
    return res.status(404).json({ message: "Membership plan not found" });
  }
  try {
    const customers = await stripe.customers.list({ email: req.validatedBody.email, limit: 100 });
    let customer = customers.data.find((item) => item.metadata.sales_channel_id === plan.sales_channel_id);
    if (!customer) {
      customer = await stripe.customers.create({
        email: req.validatedBody.email,
        name: req.validatedBody.name,
        metadata: { sales_channel_id: plan.sales_channel_id },
      }, { idempotencyKey: `${idempotencyKey}:customer` });
    }
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: plan.stripe_price_id }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: { membership_plan_id: plan.id, product_id: plan.product_id, variant_id: plan.variant_id, sales_channel_id: plan.sales_channel_id },
    }, { idempotencyKey: `${idempotencyKey}:subscription` });
    let [membershipSubscription] = await membershipService.listMembershipSubscriptions({ stripe_subscription_id: subscription.id });
    if (!membershipSubscription) {
      try {
        membershipSubscription = await membershipService.createMembershipSubscriptions({
          plan_id: plan.id,
          renewal_type: "recurring",
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          customer_name: req.validatedBody.name,
          email: req.validatedBody.email,
          status: membershipStatus(subscription.status),
          current_period_start: stripeDate(subscription.current_period_start),
          current_period_end: stripeDate(subscription.current_period_end),
          cancel_at_period_end: subscription.cancel_at_period_end,
          organization_id: req.validatedBody.metadata.organization_id,
          company_id: req.validatedBody.metadata.company_id,
          stock_location_id: req.validatedBody.metadata.stock_location_id,
          sale_source: "online",
        });
      } catch (error) {
        [membershipSubscription] = await membershipService.listMembershipSubscriptions({ stripe_subscription_id: subscription.id });
        if (!membershipSubscription) throw error;
      }
    }
    const invoice = subscription.latest_invoice as any;
    const clientSecret = invoice?.payment_intent?.client_secret;
    if (!clientSecret) throw new Error("Stripe did not return a PaymentIntent client secret");
    res.status(201).json({ membership_subscription_id: membershipSubscription.id, client_secret: clientSecret, status: membershipSubscription.status });
  } catch (error: any) {
    const isStripeTimeout = /(timeout|timed out)/i.test(error?.message || "");
    const status = isStripeTimeout ? 504 : 502;
    return res.status(status).json({
      message: isStripeTimeout
        ? "Stripe did not respond before the membership checkout timeout. Retry with the same Idempotency-Key."
        : "Unable to initialize membership checkout with Stripe. Retry with the same Idempotency-Key.",
    });
  }
};
