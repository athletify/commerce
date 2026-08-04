import { applyStockLocationTaxes, resolveStockLocationTax, stripeTaxRateIds } from "../stock-location-tax";

const stateRate = { id: "txr_ca", rate: 7.25, code: "CA", name: "California sales tax", is_default: true, metadata: { stripe_tax_rate_id: "txr_stripe_ca" } };
const nationalRate = { id: "txr_us", rate: 5, code: "US", name: "US sales tax", is_default: true, metadata: { stripe_tax_rate_id: "txr_stripe_us" } };

describe("stock location tax resolver", () => {
  const scopeFor = (regions: any[]) => {
    const cartService = { updateCarts: jest.fn(), setLineItemTaxLines: jest.fn() };
    const query = { graph: jest.fn(async ({ entity }: any) => {
      if (entity === "stock_location") return { data: [{ id: "sloc_ca", address: { country_code: "US", province: "CA", city: "Los Angeles" } }] };
      if (entity === "tax_region") return { data: regions };
      return { data: [{ id: "cart_1", metadata: { stock_location_id: "sloc_ca" }, items: [{ id: "item_1" }] }] };
    }) };
    return { scope: { resolve: (key: string) => key === "query" ? query : cartService }, cartService };
  };

  it("uses only the configured state rate when the stock location is in that state", async () => {
    const { scope } = scopeFor([
      { id: "txreg_us", country_code: "us", province_code: null, tax_rates: [nationalRate] },
      { id: "txreg_ca", country_code: "us", province_code: "ca", tax_rates: [stateRate] },
    ]);
    const tax = await resolveStockLocationTax(scope, "sloc_ca");
    expect(tax.address).toEqual(expect.objectContaining({ country_code: "us", province: "ca" }));
    expect(tax.rates).toEqual([stateRate]);
    expect(stripeTaxRateIds(tax)).toEqual(["txr_stripe_ca"]);
  });

  it("falls back exclusively to the national rate when no state rate exists", async () => {
    const { scope, cartService } = scopeFor([{ id: "txreg_us", country_code: "us", province_code: null, tax_rates: [nationalRate] }]);
    const tax = await resolveStockLocationTax(scope, "sloc_ca");
    expect(tax.rates).toEqual([nationalRate]);

    await applyStockLocationTaxes(scope, "cart_1");
    expect(cartService.setLineItemTaxLines).toHaveBeenCalledWith("cart_1", [expect.objectContaining({ item_id: "item_1", tax_rate_id: "txr_us", rate: 5 })]);
  });
});
