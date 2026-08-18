jest.mock("@medusajs/medusa/core-flows", () => ({
  refreshPaymentCollectionForCartWorkflow: jest.fn(),
}));

import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows";
import { applyStockLocationTaxes, resolveStockLocationTax, stockLocationTaxLines, stripeTaxRateIds } from "../stock-location-tax";

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

  it("creates exactly one stable tax line per item and tax rate", () => {
    const lines = stockLocationTaxLines([{ id: "item_wa" }], [
      { id: "txr_wa", rate: 6.5, name: "Washington sales tax" },
      { id: "txr_wa", rate: 6.5, name: "Washington sales tax" },
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^calitxl_/),
      item_id: "item_wa",
      tax_rate_id: "txr_wa",
      rate: 6.5,
    }));
  });

  it("refreshes an existing payment collection after taxes change the cart total", async () => {
    const refresh = { run: jest.fn() };
    (refreshPaymentCollectionForCartWorkflow as unknown as jest.Mock).mockReturnValue(refresh);
    const cartService = { updateCarts: jest.fn(), setLineItemTaxLines: jest.fn() };
    const query = { graph: jest.fn(async ({ entity }: any) => {
      if (entity === "stock_location") return { data: [{ id: "sloc_ca", address: { country_code: "US", province: "CA" } }] };
      if (entity === "tax_region") return { data: [{ country_code: "us", province_code: "ca", tax_rates: [stateRate] }] };
      return { data: [{ id: "cart_wa", metadata: { stock_location_id: "sloc_ca" }, items: [{ id: "item_wa" }], payment_collection: { id: "pay_col_wa" } }] };
    }) };
    const scope = { resolve: (key: string) => key === "query" ? query : cartService };

    await applyStockLocationTaxes(scope, "cart_wa");

    expect(refresh.run).toHaveBeenCalledWith({ input: { cart_id: "cart_wa" } });
  });

  it("replaces cart tax lines when its stock location changes", async () => {
    let stockLocationId = "sloc_ca";
    const cartService = { updateCarts: jest.fn(), setLineItemTaxLines: jest.fn() };
    const query = { graph: jest.fn(async ({ entity, filters }: any) => {
      if (entity === "stock_location") {
        const isWashington = filters.id === "sloc_wa";
        return { data: [{ id: filters.id, address: { country_code: "US", province: isWashington ? "WA" : "CA" } }] };
      }
      if (entity === "tax_region") return { data: [
        { country_code: "us", province_code: "ca", tax_rates: [stateRate] },
        { country_code: "us", province_code: "wa", tax_rates: [{ ...stateRate, id: "txr_wa", code: "WA", rate: 6.5 }] },
      ] };
      return { data: [{ id: "cart_1", metadata: { stock_location_id: stockLocationId }, items: [{ id: "item_1" }] }] };
    }) };
    const scope = { resolve: (key: string) => key === "query" ? query : cartService };

    await applyStockLocationTaxes(scope, "cart_1");
    stockLocationId = "sloc_wa";
    await applyStockLocationTaxes(scope, "cart_1");

    expect(cartService.setLineItemTaxLines).toHaveBeenNthCalledWith(1, "cart_1", [expect.objectContaining({ tax_rate_id: "txr_ca" })]);
    expect(cartService.setLineItemTaxLines).toHaveBeenNthCalledWith(2, "cart_1", [expect.objectContaining({ tax_rate_id: "txr_wa", rate: 6.5 })]);
  });
});
