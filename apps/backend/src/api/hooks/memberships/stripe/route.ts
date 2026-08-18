import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import Stripe from "stripe";
import { MEMBERSHIP_MODULE } from "../../../../modules/membership";
import { stripe, membershipStatus, stripeDate } from "../../../../modules/membership/stripe";
import { StripeConfig } from "../../../../../default.env";
import {
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  createPaymentSessionsWorkflow,
  processPaymentWorkflow,
  createFulfillmentWorkflow,
} from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

const subscriptionIdFor = (event: Stripe.Event) => {
  const object: any = event.data.object;
  return object.object === "subscription" ? object.id : object.subscription;
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || !StripeConfig.membershipWebhookSecret) return res.status(400).json({ message: "Missing Stripe signature" });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody, signature, StripeConfig.membershipWebhookSecret);
  } catch {
    return res.status(400).json({ message: "Invalid Stripe signature" });
  }
  const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
  if ((await membershipService.listStripeWebhookEvents({ stripe_event_id: event.id })).length) {
    return res.json({ received: true });
  }
  const subscriptionId = subscriptionIdFor(event);
  if (subscriptionId) {
    const [membership] = await membershipService.listMembershipSubscriptions({ stripe_subscription_id: subscriptionId });
    if (membership?.renewal_type !== "none") {
      const object: any = event.data.object;
      let status = membership.status;
      if (event.type === "customer.subscription.deleted") status = "canceled";
      else if (event.type === "invoice.payment_failed") status = "past_due";
      else if (event.type === "invoice.paid") status = "active";
      else if (object.object === "subscription") status = membershipStatus(object.status);
      const subscription = object.object === "subscription" ? object : undefined;
      const updated = await membershipService.updateMembershipSubscriptions({
        id: membership.id, status,
        ...(subscription ? { current_period_start: stripeDate(subscription.current_period_start), current_period_end: stripeDate(subscription.current_period_end), cancel_at_period_end: subscription.cancel_at_period_end } : {}),
      });
      const [plan] = await membershipService.listMembershipPlans({ id: membership.plan_id });
      const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
      let orderId = membership.order_id;
      let paymentId = membership.payment_id;
      let fulfillmentId = membership.fulfillment_id;
      if (updated.status === "active" && plan) {
        const locking: any = req.scope.resolve(Modules.LOCKING);
        ({ orderId, paymentId, fulfillmentId } = await locking.execute(
          [`membership-subscription:${membership.id}`],
          async () => {
            // Stripe can deliver subscription and invoice events concurrently.
            // Re-read before every side effect while holding this membership lock.
            let [current] = await membershipService.listMembershipSubscriptions({ id: membership.id });
            let currentOrderId = current?.order_id;
            if (!currentOrderId) {
              const { data: [region] } = await query.graph({
                entity: "region",
                fields: ["id"],
                filters: { currency_code: plan.currency_code },
              });
              if (!region) throw new Error(`No region configured for membership currency ${plan.currency_code}`);
              const { result: order } = await createOrderWorkflow(req.scope).run({
                input: {
                  region_id: region.id,
                  sales_channel_id: plan.sales_channel_id,
                  email: current.email,
                  currency_code: plan.currency_code,
                  status: "pending",
                  no_notification: true,
                  items: [{ variant_id: plan.variant_id, quantity: 1, title: "Membership", unit_price: Number(plan.amount), requires_shipping: false, is_discountable: false }],
                  metadata: {
                    organization_id: current.organization_id,
                    company_id: current.company_id,
                    stock_location_id: current.stock_location_id,
                    sale_source: "online",
                    athletify_customer_name: current.customer_name,
                    membership_subscription_id: current.id,
                    stripe_subscription_id: current.stripe_subscription_id,
                  },
                },
              });
              currentOrderId = order.id;
              await membershipService.updateMembershipSubscriptions({ id: current.id, order_id: currentOrderId });
            }

            [current] = await membershipService.listMembershipSubscriptions({ id: membership.id });
            let currentPaymentId = current.payment_id;
            if (!currentPaymentId) {
              const { result: paymentCollections } = await createOrderPaymentCollectionWorkflow(req.scope).run({
                input: { order_id: currentOrderId, amount: Number(plan.amount) },
              });
              const { result: paymentSession } = await createPaymentSessionsWorkflow(req.scope).run({
                input: {
                  payment_collection_id: paymentCollections[0].id,
                  provider_id: "pp_system_default",
                  data: { stripe_subscription_id: current.stripe_subscription_id, membership_subscription_id: current.id },
                },
              });
              await processPaymentWorkflow(req.scope).run({
                input: { action: "captured", data: { session_id: paymentSession.id, amount: Number(plan.amount) } },
              });
              const { data: [payment] } = await query.graph({
                entity: "payment",
                fields: ["id"],
                filters: { payment_session_id: paymentSession.id },
              });
              if (!payment) throw new Error("Unable to authorize membership payment");
              currentPaymentId = payment.id;
              await membershipService.updateMembershipSubscriptions({ id: current.id, payment_id: currentPaymentId });
            }

            [current] = await membershipService.listMembershipSubscriptions({ id: membership.id });
            let currentFulfillmentId = current.fulfillment_id;
            if (!currentFulfillmentId) {
              if (!current.stock_location_id) throw new Error("Membership subscription is missing a stock location for symbolic fulfillment");
              const { data: [order] } = await query.graph({
                entity: "order",
                fields: ["id", "items.id", "items.title", "items.variant.sku", "items.variant.barcode"],
                filters: { id: currentOrderId },
              });
              if (!order?.items?.length) throw new Error(`Membership order ${currentOrderId} has no items to fulfill`);
              const { result: fulfillment } = await createFulfillmentWorkflow(req.scope).run({
                input: {
                  location_id: current.stock_location_id,
                  provider_id: "manual_manual",
                  delivery_address: {},
                  order: { id: currentOrderId },
                  packed_at: new Date(),
                  items: order.items.map((item: any) => ({ line_item_id: item.id, quantity: 1, title: item.title, sku: item.variant?.sku || "", barcode: item.variant?.barcode || "" })),
                  metadata: { symbolic: true, membership_subscription_id: current.id, stripe_subscription_id: current.stripe_subscription_id },
                },
              });
              const orderService: any = req.scope.resolve(Modules.ORDER);
              await orderService.registerFulfillment({
                order_id: currentOrderId,
                reference: Modules.FULFILLMENT,
                reference_id: fulfillment.id,
                items: order.items.map((item: any) => ({ id: item.id, quantity: 1 })),
              });
              const link: any = req.scope.resolve(ContainerRegistrationKeys.LINK);
              await link.create({ [Modules.ORDER]: { order_id: currentOrderId }, [Modules.FULFILLMENT]: { fulfillment_id: fulfillment.id } });
              currentFulfillmentId = fulfillment.id;
              await membershipService.updateMembershipSubscriptions({ id: current.id, fulfillment_id: currentFulfillmentId });
            }
            return { orderId: currentOrderId, paymentId: currentPaymentId, fulfillmentId: currentFulfillmentId };
          }
        ));
      }
      // Available to Athletify through Medusa's event bus; consumers should use
      // this event, not the browser confirmation, as their access source.
      const eventBus: any = req.scope.resolve("event_bus");
      await eventBus.emit({ name: "membership.subscription.updated", data: {
        subscription_id: updated.id,
        plan_id: membership.plan_id,
        product_id: plan?.product_id,
        variant_id: plan?.variant_id,
        sales_channel_id: plan?.sales_channel_id,
        status: updated.status,
        current_period_start: updated.current_period_start,
        current_period_end: updated.current_period_end,
        cancel_at_period_end: updated.cancel_at_period_end,
        order_id: orderId,
        payment_id: paymentId,
        fulfillment_id: fulfillmentId,
      } });
    }
  }
  await membershipService.createStripeWebhookEvents({ stripe_event_id: event.id });
  res.json({ received: true });
};
