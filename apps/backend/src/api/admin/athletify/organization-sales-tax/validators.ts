import { z } from "@medusajs/framework/zod";

const US_STATES_AND_DC = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
]);

export const AdminOrganizationSalesTax = z.object({
  stock_location_id: z.string().min(1),
  province_code: z.string().length(2).transform((value) => value.toLowerCase()).refine((value) => US_STATES_AND_DC.has(value), "province_code must be a US state or DC"),
  rate: z.string().regex(/^\d+(\.\d+)?$/, "rate must be a decimal string").refine((value) => Number(value) >= 0 && Number(value) <= 100, "rate must be between 0 and 100"),
}).strict();

export type AdminOrganizationSalesTaxType = z.infer<typeof AdminOrganizationSalesTax>;
