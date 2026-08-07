import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows";
import { createHash } from "node:crypto";

type TaxRate = {
  id: string;
  rate: number;
  code?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  is_default?: boolean;
};

export type StockLocationTax = {
  address: { country_code: string; province?: string; address_1?: string; address_2?: string; city?: string; postal_code?: string };
  rates: TaxRate[];
};

/**
 * Uses the gym's stock location as the tax nexus. State rates deliberately
 * replace, rather than supplement, the US country rate.
 */
export async function resolveStockLocationTax(scope: any, stockLocationId: string): Promise<StockLocationTax> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: [location] } = await query.graph({
    entity: "stock_location",
    fields: ["id", "address.country_code", "address.province", "address.address_1", "address.address_2", "address.city", "address.postal_code"],
    filters: { id: stockLocationId },
  });
  const address = location?.address;
  if (!address?.country_code) throw new Error(`Stock location ${stockLocationId} is missing a tax address`);
  const taxAddress = { ...address, country_code: String(address.country_code).toLowerCase(), province: address.province?.toLowerCase() };
  if (taxAddress.country_code !== "us") return { address: taxAddress, rates: [] };

  const { data: regions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code", "province_code", "tax_rates.id", "tax_rates.rate", "tax_rates.code", "tax_rates.name", "tax_rates.metadata", "tax_rates.is_default"],
    filters: { country_code: "us" },
  });
  const activeRates = (region: any) => (region?.tax_rates || []).filter((rate: TaxRate) => rate.is_default !== false);
  const state = regions.find((region: any) => region.province_code && String(region.province_code).toLowerCase() === taxAddress.province);
  const stateRates = activeRates(state);
  if (stateRates.length) return { address: taxAddress, rates: stateRates };
  const national = regions.find((region: any) => !region.province_code);
  return { address: taxAddress, rates: activeRates(national) };
}

export function stripeTaxRateIds(tax: StockLocationTax): string[] {
  const missing = tax.rates.filter((rate) => typeof rate.metadata?.stripe_tax_rate_id !== "string" || !rate.metadata.stripe_tax_rate_id);
  if (missing.length) throw new Error("A selected Medusa tax rate is missing metadata.stripe_tax_rate_id");
  return tax.rates.map((rate) => rate.metadata!.stripe_tax_rate_id as string);
}

type TaxableCartItem = { id: string };

/**
 * `setLineItemTaxLines` upserts by its input ID. A stable ID for the pair
 * makes repeating tax resolution replace the same tax line rather than create
 * another one for the same item and rate.
 */
export function stockLocationTaxLines(items: TaxableCartItem[], rates: TaxRate[]) {
  const seen = new Set<string>();
  return items.flatMap((item) => rates.flatMap((rate) => {
    const pair = `${item.id}:${rate.id}`;
    if (seen.has(pair)) return [];
    seen.add(pair);
    const id = `calitxl_${createHash("sha256").update(pair).digest("hex").slice(0, 26)}`;
    return [{
      id,
      item_id: item.id,
      tax_rate_id: rate.id,
      description: rate.name || rate.code || "Sales tax",
      code: rate.code || rate.id,
      rate: Number(rate.rate),
      provider_id: "system",
    }];
  }));
}

export async function applyStockLocationTaxes(scope: any, cartId: string) {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: [cart] } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata", "items.id", "payment_collection.id", "payment_collection.payment_sessions.provider_id"],
    filters: { id: cartId },
  });
  const stockLocationId = cart?.metadata?.stock_location_id;
  if (typeof stockLocationId !== "string" || !stockLocationId) return;
  const tax = await resolveStockLocationTax(scope, stockLocationId);
  const cartService: any = scope.resolve(Modules.CART);
  await cartService.updateCarts({ id: cart.id, shipping_address: tax.address });
  await cartService.setLineItemTaxLines(cart.id, stockLocationTaxLines(cart.items || [], tax.rates));

  // Tax lines change cart.raw_total. Keep a collection with no payment session,
  // or one using the manual provider, synchronized before manual authorization.
  // Existing Stripe sessions retain their established lifecycle untouched.
  const paymentSessions = cart.payment_collection?.payment_sessions || [];
  const canRefreshPaymentCollection = !paymentSessions.length || paymentSessions.every(
    (session: { provider_id?: string }) => session.provider_id === "pp_system_default"
  );
  if (cart.payment_collection?.id && canRefreshPaymentCollection) {
    await refreshPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cart.id } });
  }
}
