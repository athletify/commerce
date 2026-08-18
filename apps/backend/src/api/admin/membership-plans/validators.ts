import { z } from "@medusajs/framework/zod";
import { createSelectParams } from "@medusajs/medusa/api/utils/validators";

export const AdminGetMembershipPlanParams = createSelectParams();
export type AdminCreateMembershipPlanType = z.infer<typeof AdminCreateMembershipPlan>;
export const AdminCreateMembershipPlan = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  sales_channel_id: z.string().min(1),
  billing_period: z.enum(["monthly", "yearly"]),
  active: z.boolean().optional(),
}).strict();
export type AdminUpdateMembershipPlanType = z.infer<typeof AdminUpdateMembershipPlan>;
export const AdminUpdateMembershipPlan = AdminCreateMembershipPlan.partial().strict();
