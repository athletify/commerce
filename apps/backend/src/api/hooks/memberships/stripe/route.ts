import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import Stripe from "stripe";
import {
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  createPaymentSessionsWorkflow,
  processPaymentWorkflow,
  createFulfillmentWorkflow,
} from "@medusajs/medusa/core-flows";
import { stripe, membershipStatus, stripeAmountToMajor, stripeDate } from "../../../../modules/membership/stripe";
import { StripeConfig } from "../../../../../default.env";
import {
  resolveEventBus,
  resolveLink,
  resolveLocking,
  resolveLogger,
  resolveMembershipService,
  resolveOrderService,
  resolveQuery,
  retrieveMembershipSubscriptionByStripeId,
  retrieveMembershipBillingCycleByInvoiceId,
  type MembershipSubscriptionRecord,
} from "../../../memberships/container";
import { verifyStripeWebhook } from "../../../memberships/stripe-webhook";
import { resolveStockLocationTax } from "../../../../utils/stock-location-tax";

type SubscriptionEvent = Stripe.Event & { data: { object: Stripe.Subscription } };
type InvoiceEvent = Stripe.Event & { data: { object: Stripe.Invoice } };
type RegionResult = { id: string };
type OrderItemResult = { id: string; title: string; variant?: { sku?: string | null; barcode?: string | null } | null };
type OrderResult = { id: string; items: OrderItemResult[] };
type PaymentResult = { id: string };

const isSubscriptionEvent = (event: Stripe.Event): event is SubscriptionEvent => event.data.object.object === "subscription";
const isInvoiceEvent = (event: Stripe.Event): event is InvoiceEvent => event.data.object.object === "invoice";

const subscriptionIdFor = (event: Stripe.Event): string | undefined => {
  if (isSubscriptionEvent(event)) return event.data.object.id;
  if (!isInvoiceEvent(event)) return undefined;
  const subscription = event.data.object.subscription;
  return typeof subscription === "string" ? subscription : subscription?.id;
};

const paidInvoiceFor = (event: Stripe.Event): Stripe.Invoice | undefined =>
  event.type === "invoice.paid" && isInvoiceEvent(event) ? event.data.object : undefined;

const retrievePlan = async (service: ReturnType<typeof resolveMembershipService>, planId: string) => {
  try {
    return await service.retrieveMembershipPlan(planId);
  } catch {
    throw new Error(`Membership plan ${planId} was not found`);
  }
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const verification = verifyStripeWebhook(req, stripe, StripeConfig.membershipWebhookSecret);
  if (!verification.valid) return res.status(400).json({ message: verification.message });
  const event = verification.event;
  const membershipService = resolveMembershipService(req.scope);
  const locking = resolveLocking(req.scope);
  const logger = resolveLogger(req.scope);

  await locking.execute([`membership-webhook-event:${event.id}`], async () => {
    if ((await membershipService.listStripeWebhookEvents({ stripe_event_id: event.id })).length) {
      return;
    }

    const subscriptionId = subscriptionIdFor(event);
    if (!subscriptionId) {
      logger.warn(`Membership Stripe webhook ignored event_id=${event.id} type=${event.type} reason=missing_subscription_id`);
    } else {
      const membership = await retrieveMembershipSubscriptionByStripeId(membershipService, subscriptionId);
      if (!membership) {
        logger.warn(`Membership Stripe webhook ignored event_id=${event.id} type=${event.type} subscription_id=${subscriptionId} reason=membership_not_found`);
      } else if (membership.renewal_type !== "none") {
        await processMembershipEvent(req, event, membership);
      }
    }

    try {
      await membershipService.createStripeWebhookEvents({ stripe_event_id: event.id });
    } catch (error) {
      // A second worker may have completed the same event after a distributed
      // lock lease expired. The persisted unique event record is authoritative.
      if (!(await membershipService.listStripeWebhookEvents({ stripe_event_id: event.id })).length) throw error;
    }
  });
  res.json({ received: true });
};

async function processMembershipEvent(req: MedusaRequest, event: Stripe.Event, membership: MembershipSubscriptionRecord) {
  const membershipService = resolveMembershipService(req.scope);
  const subscription = isSubscriptionEvent(event) ? event.data.object : undefined;
  const paidInvoice = paidInvoiceFor(event);
  const status = event.type === "customer.subscription.deleted" ? "canceled"
    : event.type === "invoice.payment_failed" ? "past_due"
      : event.type === "invoice.payment_action_required" ? "incomplete"
      : event.type === "invoice.paid" ? "active"
        : subscription ? membershipStatus(subscription.status) : membership.status;
  const updated = await membershipService.updateMembershipSubscriptions({
    id: membership.id,
    status,
    ...(subscription ? {
      current_period_start: stripeDate(subscription.current_period_start),
      current_period_end: stripeDate(subscription.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end,
    } : {}),
  });
  const plan = await retrievePlan(membershipService, membership.plan_id);
  let orderId = membership.order_id;
  let paymentId = membership.payment_id;
  let fulfillmentId = membership.fulfillment_id;

  if (isInvoiceEvent(event) && event.type !== "invoice.paid") {
    await recordInvoiceStatus(membershipService, membership.id, event.data.object, event.id,
      event.type === "invoice.payment_action_required" ? "action_required" : "failed");
  }

  if (updated.status === "active" && paidInvoice) {
    const locking = resolveLocking(req.scope);
    ({ orderId, paymentId, fulfillmentId } = await locking.execute(
      [`membership-invoice:${paidInvoice.id}`],
      () => createInitialMembershipOrder(req, membership.id, plan, paidInvoice, event.id)
    ));
  }

  await resolveEventBus(req.scope).emit({
    name: "membership.subscription.updated",
    data: {
      subscription_id: updated.id,
      plan_id: membership.plan_id,
      product_id: plan.product_id,
      variant_id: plan.variant_id,
      sales_channel_id: plan.sales_channel_id,
      status: updated.status,
      current_period_start: updated.current_period_start,
      current_period_end: updated.current_period_end,
      cancel_at_period_end: updated.cancel_at_period_end,
      order_id: orderId,
      payment_id: paymentId,
      fulfillment_id: fulfillmentId,
    },
  });
}

async function recordInvoiceStatus(
  service: ReturnType<typeof resolveMembershipService>,
  membershipId: string,
  invoice: Stripe.Invoice,
  eventId: string,
  status: "failed" | "action_required"
) {
  let cycle = await retrieveMembershipBillingCycleByInvoiceId(service, invoice.id);
  if (!cycle) {
    const currencyCode = invoice.currency.toLowerCase();
    try {
      cycle = await service.createMembershipBillingCycles({
        membership_subscription_id: membershipId,
        stripe_invoice_id: invoice.id,
        stripe_event_id: eventId,
        currency_code: currencyCode,
        subtotal: String(stripeAmountToMajor(invoice.subtotal || 0, currencyCode)),
        tax_total: String(stripeAmountToMajor(invoice.tax || 0, currencyCode)),
        total: String(stripeAmountToMajor(invoice.total || 0, currencyCode)),
        status,
      });
    } catch (error) {
      cycle = await retrieveMembershipBillingCycleByInvoiceId(service, invoice.id);
      if (!cycle) throw error;
    }
  }
  if (cycle.status !== "paid") await service.updateMembershipBillingCycles({ id: cycle.id, status });
}

async function createInitialMembershipOrder(
  req: MedusaRequest,
  membershipId: string,
  plan: Awaited<ReturnType<typeof retrievePlan>>,
  invoice: Stripe.Invoice,
  stripeEventId: string
) {
  const membershipService = resolveMembershipService(req.scope);
  const query = resolveQuery(req.scope);
  let current = await membershipService.retrieveMembershipSubscription(membershipId);
  let cycle = await retrieveMembershipBillingCycleByInvoiceId(membershipService, invoice.id);
  if (!cycle) {
    const currencyCode = invoice.currency.toLowerCase();
    try {
      cycle = await membershipService.createMembershipBillingCycles({
        membership_subscription_id: current.id,
        stripe_invoice_id: invoice.id,
        stripe_event_id: stripeEventId,
        currency_code: currencyCode,
        subtotal: String(stripeAmountToMajor(invoice.subtotal || 0, currencyCode)),
        tax_total: String(stripeAmountToMajor(invoice.tax || 0, currencyCode)),
        total: String(stripeAmountToMajor(invoice.total || 0, currencyCode)),
        status: "pending",
      });
    } catch (error) {
      cycle = await retrieveMembershipBillingCycleByInvoiceId(membershipService, invoice.id);
      if (!cycle) throw error;
    }
  }
  let orderId = cycle.order_id;
  let paymentId = cycle.payment_id;
  let fulfillmentId = cycle.fulfillment_id;
  const tax = await resolveStockLocationTax(req.scope, current.stock_location_id || "");
  const invoiceSubtotal = stripeAmountToMajor(invoice.subtotal || 0, invoice.currency);
  const invoiceTotal = stripeAmountToMajor(invoice.total || 0, invoice.currency);

  if (!orderId) {
    const { data: regions } = await query.graph<RegionResult>({ entity: "region", fields: ["id"], filters: { currency_code: plan.currency_code } });
    const region = regions.at(0);
    if (!region) throw new Error(`No region configured for membership currency ${plan.currency_code}`);
    const { result: order } = await createOrderWorkflow(req.scope).run({
      input: {
        region_id: region.id, sales_channel_id: plan.sales_channel_id, email: current.email, currency_code: plan.currency_code,
        status: "pending", no_notification: true, shipping_address: tax.address,
        items: [{ variant_id: plan.variant_id, quantity: 1, title: "Membership", unit_price: invoiceSubtotal, requires_shipping: false, is_discountable: false }],
        metadata: { organization_id: current.organization_id, company_id: current.company_id, stock_location_id: current.stock_location_id, sale_source: "online", athletify_customer_name: current.customer_name, membership_subscription_id: current.id, stripe_subscription_id: current.stripe_subscription_id },
      },
    });
    orderId = order.id;
    const { data: orders } = await query.graph<OrderResult>({ entity: "order", fields: ["id", "items.id"], filters: { id: orderId } });
    const createdOrder = orders.at(0);
    if (createdOrder?.items[0] && tax.rates.length) {
      await resolveOrderService(req.scope).upsertOrderLineItemTaxLines(tax.rates.map((rate) => ({ item_id: createdOrder.items[0].id, tax_rate_id: rate.id, description: rate.name || rate.code || "Sales tax", code: rate.code || rate.id, rate: Number(rate.rate), provider_id: "system" })));
    }
    await membershipService.updateMembershipBillingCycles({ id: cycle.id, order_id: orderId });
    await membershipService.updateMembershipSubscriptions({ id: current.id, order_id: orderId });
  }

  cycle = await membershipService.retrieveMembershipBillingCycle(cycle.id);
  paymentId = cycle.payment_id;
  if (!paymentId) {
    const { result: paymentCollections } = await createOrderPaymentCollectionWorkflow(req.scope).run({ input: { order_id: orderId, amount: invoiceTotal } });
    const { result: paymentSession } = await createPaymentSessionsWorkflow(req.scope).run({ input: { payment_collection_id: paymentCollections[0].id, provider_id: "pp_system_default", data: { stripe_subscription_id: current.stripe_subscription_id, membership_subscription_id: current.id } } });
    await processPaymentWorkflow(req.scope).run({ input: { action: "captured", data: { session_id: paymentSession.id, amount: invoiceTotal } } });
    const { data: payments } = await query.graph<PaymentResult>({ entity: "payment", fields: ["id"], filters: { payment_session_id: paymentSession.id } });
    const payment = payments.at(0);
    if (!payment) throw new Error("Unable to authorize membership payment");
    paymentId = payment.id;
    await membershipService.updateMembershipBillingCycles({ id: cycle.id, payment_id: paymentId });
    await membershipService.updateMembershipSubscriptions({ id: current.id, payment_id: paymentId });
  }

  cycle = await membershipService.retrieveMembershipBillingCycle(cycle.id);
  fulfillmentId = cycle.fulfillment_id;
  if (!fulfillmentId) {
    if (!current.stock_location_id) throw new Error("Membership subscription is missing a stock location for symbolic fulfillment");
    const { data: orders } = await query.graph<OrderResult>({ entity: "order", fields: ["id", "items.id", "items.title", "items.variant.sku", "items.variant.barcode"], filters: { id: orderId } });
    const order = orders.at(0);
    if (!order?.items.length) throw new Error(`Membership order ${orderId} has no items to fulfill`);
    const items = order.items.map((item) => ({ line_item_id: item.id, quantity: 1, title: item.title, sku: item.variant?.sku || "", barcode: item.variant?.barcode || "" }));
    const { result: fulfillment } = await createFulfillmentWorkflow(req.scope).run({ input: { location_id: current.stock_location_id, provider_id: "manual_manual", delivery_address: {}, order: { id: orderId }, packed_at: new Date(), items, metadata: { symbolic: true, membership_subscription_id: current.id, stripe_subscription_id: current.stripe_subscription_id } } });
    await resolveOrderService(req.scope).registerFulfillment({ order_id: orderId, reference: Modules.FULFILLMENT, reference_id: fulfillment.id, items: order.items.map((item) => ({ id: item.id, quantity: 1 })) });
    await resolveLink(req.scope).create({ [Modules.ORDER]: { order_id: orderId }, [Modules.FULFILLMENT]: { fulfillment_id: fulfillment.id } });
    fulfillmentId = fulfillment.id;
    await membershipService.updateMembershipBillingCycles({ id: cycle.id, fulfillment_id: fulfillmentId, status: "paid" });
    await membershipService.updateMembershipSubscriptions({ id: current.id, fulfillment_id: fulfillmentId });
  }
  if (fulfillmentId && cycle.status !== "paid") await membershipService.updateMembershipBillingCycles({ id: cycle.id, status: "paid" });
  return { orderId, paymentId, fulfillmentId };
}
