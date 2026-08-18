import { z } from "@medusajs/framework/zod";

export const StoreCreateMembershipCheckout = z.object({
  plan_id: z.string().min(1),
  email: z.string().email(),
  name: z.string().trim().min(1),
  metadata: z.object({
    organization_id: z.string().min(1),
    company_id: z.string().min(1),
    stock_location_id: z.string().min(1),
    sale_source: z.literal("online").optional(),
  }).strict(),
}).strict();

export const StoreCancelMembership = z.object({
  reason: z.string().trim().min(1).max(500),
  immediately: z.boolean().optional().default(false),
}).strict();
