import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "@medusajs/framework/zod";
import { MEMBERSHIP_MODULE } from "../../../../../modules/membership";
import { membershipStatus, stripe, stripeDate } from "../../../../../modules/membership/stripe";
import { storeSalesChannelIds } from "../../../../memberships/utils";
import { StoreCancelMembership } from "../../validators";

export const POST = async (
  req: MedusaRequest<z.infer<typeof StoreCancelMembership>>,
  res: MedusaResponse
) => {
  const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
  const [membership] = await membershipService.listMembershipSubscriptions(
    { id: req.params.id },
    { relations: ["plan"] }
  );
  if (!membership || !storeSalesChannelIds(req).includes(membership.plan.sales_channel_id)) {
    return res.status(404).json({ message: "Membership subscription not found" });
  }
  if (membership.status === "canceled") {
    return res.status(409).json({ message: "Membership subscription is already canceled" });
  }
  if (membership.renewal_type === "none") {
    return res.status(409).json({ message: "One-time memberships cannot be canceled" });
  }

  const reason = req.validatedBody.reason;
  const metadata = { cancellation_reason: reason };
  let stripeSubscription: any;
  if (req.validatedBody.immediately) {
    await stripe.subscriptions.update(membership.stripe_subscription_id, { metadata });
    stripeSubscription = await stripe.subscriptions.cancel(membership.stripe_subscription_id);
  } else {
    stripeSubscription = await stripe.subscriptions.update(membership.stripe_subscription_id, {
      cancel_at_period_end: true,
      metadata,
    });
  }

  const updated = await membershipService.updateMembershipSubscriptions({
    id: membership.id,
    status: membershipStatus(stripeSubscription.status),
    cancel_at_period_end: stripeSubscription.cancel_at_period_end,
    current_period_start: stripeDate(stripeSubscription.current_period_start),
    current_period_end: stripeDate(stripeSubscription.current_period_end),
    cancellation_reason: reason,
    cancellation_requested_at: new Date(),
  });
  res.json({ membership_subscription: {
    id: updated.id,
    status: updated.status,
    cancel_at_period_end: updated.cancel_at_period_end,
    cancellation_reason: updated.cancellation_reason,
    current_period_end: updated.current_period_end,
  } });
};
