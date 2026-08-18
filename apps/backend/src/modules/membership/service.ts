import { MedusaService } from "@medusajs/framework/utils";
import { MembershipBillingCycle, MembershipPlan, MembershipSubscription, StripeWebhookEvent } from "./models";

class MembershipModuleService extends MedusaService({
  MembershipPlan,
  MembershipSubscription,
  MembershipBillingCycle,
  StripeWebhookEvent,
}) {}

export default MembershipModuleService;
