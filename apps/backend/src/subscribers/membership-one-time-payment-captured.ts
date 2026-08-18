import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { createFulfillmentWorkflow } from "@medusajs/medusa/core-flows";
import { MEMBERSHIP_MODULE } from "../modules/membership";

const periodEnd = (start: Date, billingPeriod: "monthly" | "yearly") => {
  const end = new Date(start);
  if (billingPeriod === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end;
};

export default async function membershipOneTimePaymentCaptured({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY);
  const membershipService: any = container.resolve(MEMBERSHIP_MODULE);
  const locking: any = container.resolve(Modules.LOCKING);
  const { data: [payment] } = await query.graph({
    entity: "payment",
    fields: [
      "id",
      "payment_collection.order.id",
      "payment_collection.order.email",
      "payment_collection.order.metadata",
      "payment_collection.order.items.id",
      "payment_collection.order.items.title",
      "payment_collection.order.items.variant_id",
      "payment_collection.order.items.variant.sku",
      "payment_collection.order.items.variant.barcode",
    ],
    filters: { id: data.id },
  });
  const order = payment?.payment_collection?.order;
  if (!order?.id || !order.items?.length) return;

  const plans = await membershipService.listMembershipPlans({
    active: true,
    variant_id: [...new Set(order.items.map((item: any) => item.variant_id).filter(Boolean))],
  });
  const plansByVariant = new Map(plans.map((plan: any) => [plan.variant_id, plan]));
  const membershipItems = order.items.filter((item: any) => plansByVariant.has(item.variant_id));

  for (const item of membershipItems) {
    const plan: any = plansByVariant.get(item.variant_id);
    await locking.execute([`membership-one-time:${order.id}:${item.variant_id}`], async () => {
      let [membership] = await membershipService.listMembershipSubscriptions({ order_id: order.id, plan_id: plan.id });
      if (!membership) {
        const capturedAt = new Date();
        membership = await membershipService.createMembershipSubscriptions({
          renewal_type: "none",
          plan_id: plan.id,
          order_id: order.id,
          email: order.email,
          status: "active",
          current_period_start: capturedAt,
          current_period_end: periodEnd(capturedAt, plan.billing_period),
          organization_id: order.metadata?.organization_id,
          company_id: order.metadata?.company_id,
          stock_location_id: order.metadata?.stock_location_id,
          sale_source: order.metadata?.sale_source,
          customer_name: order.metadata?.athletify_customer_name,
        });
      }
      if (membership.fulfillment_id) return;
      const locationId = membership.stock_location_id || order.metadata?.stock_location_id;
      if (!locationId) throw new Error(`Membership order ${order.id} is missing stock_location_id`);
      const { result: fulfillment } = await createFulfillmentWorkflow(container).run({
        input: {
          location_id: locationId,
          provider_id: "manual_manual",
          delivery_address: {},
          order: { id: order.id },
          packed_at: new Date(),
          items: [{ line_item_id: item.id, quantity: 1, title: item.title, sku: item.variant?.sku || "", barcode: item.variant?.barcode || "" }],
          metadata: { symbolic: true, membership_subscription_id: membership.id },
        },
      });
      const orderService: any = container.resolve(Modules.ORDER);
      await orderService.registerFulfillment({
        order_id: order.id,
        reference: Modules.FULFILLMENT,
        reference_id: fulfillment.id,
        items: [{ id: item.id, quantity: 1 }],
      });
      const link: any = container.resolve(ContainerRegistrationKeys.LINK);
      await link.create({ [Modules.ORDER]: { order_id: order.id }, [Modules.FULFILLMENT]: { fulfillment_id: fulfillment.id } });
      await membershipService.updateMembershipSubscriptions({ id: membership.id, fulfillment_id: fulfillment.id });
    });
  }
}

export const config: SubscriberConfig = { event: "payment.captured" };
