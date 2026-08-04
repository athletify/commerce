import { MedusaService } from "@medusajs/framework/utils";
import { MembershipPlan, MembershipSubscription, StripeWebhookEvent } from "./models";

class MembershipModuleService extends MedusaService({
  MembershipPlan,
  MembershipSubscription,
  StripeWebhookEvent,
}) {}

export default MembershipModuleService;
