import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "@medusajs/framework/zod";
import { stripe, membershipStatus, stripeDate } from "../../../../modules/membership/stripe";
import { retrieveMembershipSubscriptionByStripeId, resolveLogger, resolveMembershipService, type MembershipPlanRecord } from "../../../memberships/container";
import { storeSalesChannelIds } from "../../../memberships/utils";
import { StripeConnectConfigurationError, maskConnectedAccount, resolveStripeConnectedAccount } from "../../../../utils/stripe-connect";
import { resolveStockLocationTax, stripeTaxRateIds } from "../../../../utils/stock-location-tax";
import { StoreCreateMembershipCheckout } from "../validators";

type MembershipCheckoutMetadata = {
  organization_id: string;
  company_id: string;
  stock_location_id: string;
  sale_source?: "online";
};

type MembershipStripeMetadata = Record<
  | "membership_plan_id"
  | "product_id"
  | "variant_id"
  | "sales_channel_id"
  | "athletify_organization_id"
  | "athletify_company_id"
  | "athletify_stock_location_id"
  | "athletify_sale_source"
  | "athletify_membership_plan_id"
  | "athletify_product_id"
  | "athletify_variant_id"
  | "athletify_sales_channel_id",
  string
>;

const stripeMetadataFor = (plan: MembershipPlanRecord, metadata: MembershipCheckoutMetadata): MembershipStripeMetadata => ({
  // Existing keys are kept because they identify a reusable Stripe customer.
  membership_plan_id: plan.id,
  product_id: plan.product_id,
  variant_id: plan.variant_id,
  sales_channel_id: plan.sales_channel_id,
  athletify_organization_id: metadata.organization_id,
  athletify_company_id: metadata.company_id,
  athletify_stock_location_id: metadata.stock_location_id,
  athletify_sale_source: metadata.sale_source ?? "online",
  athletify_membership_plan_id: plan.id,
  athletify_product_id: plan.product_id,
  athletify_variant_id: plan.variant_id,
  athletify_sales_channel_id: plan.sales_channel_id,
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "";

export const POST = async (req: MedusaRequest<z.infer<typeof StoreCreateMembershipCheckout>>, res: MedusaResponse) => {
  const idempotencyKeyHeader = req.headers["idempotency-key"];
  if (typeof idempotencyKeyHeader !== "string" || !idempotencyKeyHeader.trim() || idempotencyKeyHeader.length > 220) {
    return res.status(400).json({ message: "An Idempotency-Key header is required for membership checkout" });
  }

  const membershipService = resolveMembershipService(req.scope);
  let plan: MembershipPlanRecord;
  try {
    plan = await membershipService.retrieveMembershipPlan(req.validatedBody.plan_id);
  } catch {
    return res.status(404).json({ message: "Membership plan not found" });
  }
  if (!plan.active || !storeSalesChannelIds(req).includes(plan.sales_channel_id)) {
    return res.status(404).json({ message: "Membership plan not found" });
  }

  const idempotencyKey = `membership-checkout:${idempotencyKeyHeader.trim()}`;
  const logger = resolveLogger(req.scope);
  try {
    const destination = await resolveStripeConnectedAccount(req.scope, plan.sales_channel_id);
    const tax = await resolveStockLocationTax(req.scope, req.validatedBody.metadata.stock_location_id);
    const defaultTaxRates = stripeTaxRateIds(tax);
    const metadata = stripeMetadataFor(plan, req.validatedBody.metadata);
    const customers = await stripe.customers.list({ email: req.validatedBody.email, limit: 100 });
    let customer = customers.data.find((item) => item.metadata.sales_channel_id === plan.sales_channel_id);
    if (!customer) {
      customer = await stripe.customers.create({
        email: req.validatedBody.email,
        name: req.validatedBody.name,
        metadata,
      }, { idempotencyKey: `${idempotencyKey}:customer` });
    }
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: plan.stripe_price_id }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      ...(defaultTaxRates.length ? { default_tax_rates: defaultTaxRates } : {}),
      ...(destination ? { transfer_data: { destination } } : {}),
      expand: ["latest_invoice.payment_intent"],
      metadata,
    }, { idempotencyKey: `${idempotencyKey}:subscription` });
    let membershipSubscription = await retrieveMembershipSubscriptionByStripeId(membershipService, subscription.id);
    logger.info(destination
      ? `Stripe destination subscription initialized sales_channel_id=${plan.sales_channel_id} destination=${maskConnectedAccount(destination)} subscription_id=${subscription.id}`
      : `Stripe platform subscription initialized sales_channel_id=${plan.sales_channel_id} subscription_id=${subscription.id}`);
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
        membershipSubscription = await retrieveMembershipSubscriptionByStripeId(membershipService, subscription.id);
        if (!membershipSubscription) throw error;
      }
    }
    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice && typeof invoice !== "string" ? invoice.payment_intent : undefined;
    const clientSecret = paymentIntent && typeof paymentIntent !== "string" ? paymentIntent.client_secret : undefined;
    if (!clientSecret) throw new Error("Stripe did not return a PaymentIntent client secret");
    res.status(201).json({ membership_subscription_id: membershipSubscription.id, client_secret: clientSecret, status: membershipSubscription.status });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (error instanceof StripeConnectConfigurationError) {
      logger.warn(`Stripe destination subscription rejected sales_channel_id=${plan.sales_channel_id} reason=${message}`);
      return res.status(422).json({ message });
    }
    if (message === "A selected Medusa tax rate is missing metadata.stripe_tax_rate_id") {
      return res.status(422).json({ message });
    }
    const isStripeTimeout = /(timeout|timed out)/i.test(message);
    return res.status(isStripeTimeout ? 504 : 502).json({
      message: isStripeTimeout
        ? "Stripe did not respond before the membership checkout timeout. Retry with the same Idempotency-Key."
        : "Unable to initialize membership checkout with Stripe. Retry with the same Idempotency-Key.",
    });
  }
};
