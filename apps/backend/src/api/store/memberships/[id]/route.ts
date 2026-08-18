import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MEMBERSHIP_MODULE } from "../../../../modules/membership";
import { publicPlan, storeSalesChannelIds } from "../../../memberships/utils";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
  const [subscription] = await membershipService.listMembershipSubscriptions({ id: req.params.id }, { relations: ["plan"] });
  if (!subscription || !storeSalesChannelIds(req).includes(subscription.plan.sales_channel_id)) {
    return res.status(404).json({ message: "Membership subscription not found" });
  }
  res.json({ membership_subscription: {
    id: subscription.id,
    order_id: subscription.order_id,
    status: subscription.status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    next_billing_at: subscription.current_period_end,
    plan: publicPlan(subscription.plan),
    product_id: subscription.plan.product_id,
    variant_id: subscription.plan.variant_id,
  } });
};
