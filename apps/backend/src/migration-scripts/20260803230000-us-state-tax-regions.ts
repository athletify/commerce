import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows";

// ISO 3166-2 subdivision codes. Rates deliberately stay out of this migration:
// they are configured by Admin/DevOps and may change independently.
const US_STATE_CODES = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
];

export default async function us_state_tax_regions({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: regions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "province_code", "provider_id"],
    filters: { country_code: "us" },
  });
  const national = regions.find((region: any) => !region.province_code);
  if (!national) throw new Error("The US national tax region must exist before state tax regions are created");

  const existing = new Set(regions.map((region: any) => region.province_code).filter(Boolean).map((code: string) => code.toLowerCase()));
  const missing = US_STATE_CODES.filter((code) => !existing.has(code));
  if (!missing.length) {
    logger.info("US state tax regions are already present");
    return;
  }

  await createTaxRegionsWorkflow(container).run({
    input: missing.map((province_code) => ({
      country_code: "us",
      province_code,
      parent_id: national.id,
    })),
  });
  logger.info(`Created ${missing.length} US state tax regions without tax rates`);
}
