import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { stripe } from "../../../../modules/membership/stripe";
import { AdminOrganizationSalesTaxType } from "./validators";

export const POST = async (req: MedusaRequest<AdminOrganizationSalesTaxType>, res: MedusaResponse) => {
  const { stock_location_id, province_code, rate } = req.validatedBody;
  const numericRate = Number(rate);
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: [location] } = await query.graph({
    entity: "stock_location",
    fields: ["id", "address.country_code", "address.province", "address.address_1", "address.address_2", "address.city", "address.postal_code", "address.company", "address.first_name", "address.last_name", "address.phone", "address.metadata"],
    filters: { id: stock_location_id },
  });
  if (!location) return res.status(404).json({ message: "Stock location not found" });
  const { data: [taxRegion] } = await query.graph({
    entity: "tax_region",
    fields: ["id", "tax_rates.id", "tax_rates.rate", "tax_rates.code", "tax_rates.name", "tax_rates.metadata", "tax_rates.is_default"],
    filters: { country_code: "us", province_code },
  });
  if (!taxRegion) return res.status(422).json({ message: "US state tax region not configured" });

  const stockLocationService: any = req.scope.resolve(Modules.STOCK_LOCATION);
  await stockLocationService.updateStockLocations(stock_location_id, {
    address: { ...(location.address || {}), country_code: "us", province: province_code },
  });

  const taxService: any = req.scope.resolve(Modules.TAX);
  let taxRate = (taxRegion.tax_rates || []).find((candidate: any) => candidate.is_default !== false);
  const unchanged = taxRate && Number(taxRate.rate) === numericRate && typeof taxRate.metadata?.stripe_tax_rate_id === "string";
  let stripeTaxRateId = unchanged ? taxRate.metadata.stripe_tax_rate_id : undefined;
  if (!stripeTaxRateId) {
    const stripeTaxRate = await stripe.taxRates.create({
      display_name: "Sales tax",
      jurisdiction: province_code.toUpperCase(),
      percentage: numericRate,
      inclusive: false,
      metadata: { medusa_tax_region_id: taxRegion.id, province_code },
    });
    stripeTaxRateId = stripeTaxRate.id;
  }
  const metadata = { ...(taxRate?.metadata || {}), stripe_tax_rate_id: stripeTaxRateId };
  if (taxRate) {
    taxRate = await taxService.updateTaxRates(taxRate.id, { rate: numericRate, metadata, code: province_code.toUpperCase(), name: `${province_code.toUpperCase()} sales tax`, is_default: true });
  } else {
    taxRate = await taxService.createTaxRates({ tax_region_id: taxRegion.id, rate: numericRate, metadata, code: province_code.toUpperCase(), name: `${province_code.toUpperCase()} sales tax`, is_default: true });
  }

  res.status(200).json({ tax_configuration: { stock_location_id, province_code, rate, tax_rate_id: taxRate.id, stripe_tax_rate_id: stripeTaxRateId } });
};
