jest.mock("../../../../../modules/membership/stripe", () => ({ stripe: { taxRates: { create: jest.fn() } } }));

import { POST } from "../route";
import { stripe } from "../../../../../modules/membership/stripe";

describe("organization sales tax admin endpoint", () => {
  beforeEach(() => jest.clearAllMocks());

  it("updates the stock location and creates a mapped state tax rate", async () => {
    const query = { graph: jest.fn()
      .mockResolvedValueOnce({ data: [{ id: "sloc_1", address: { city: "Salt Lake City", address_1: "1 Main", country_code: "mx", province: "cmx" } }] })
      .mockResolvedValueOnce({ data: [{ id: "txreg_ut", tax_rates: [] }] }) };
    const stockLocations = { updateStockLocations: jest.fn() };
    const tax = { createTaxRates: jest.fn().mockResolvedValue({ id: "txr_ut" }) };
    (stripe as any).taxRates.create.mockResolvedValue({ id: "txr_stripe_ut" });
    const req: any = { validatedBody: { stock_location_id: "sloc_1", province_code: "ut", rate: "7.25" }, scope: { resolve: (key: string) => key === "query" ? query : key === "stock_location" ? stockLocations : tax } };
    const res: any = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);

    await POST(req, res);

    expect(stockLocations.updateStockLocations).toHaveBeenCalledWith("sloc_1", { address: expect.objectContaining({ city: "Salt Lake City", country_code: "us", province: "ut" }) });
    expect((stripe as any).taxRates.create).toHaveBeenCalledWith(expect.objectContaining({ percentage: 7.25, inclusive: false, jurisdiction: "UT" }));
    expect(tax.createTaxRates).toHaveBeenCalledWith(expect.objectContaining({ tax_region_id: "txreg_ut", rate: 7.25, metadata: { stripe_tax_rate_id: "txr_stripe_ut" } }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ tax_configuration: { stock_location_id: "sloc_1", province_code: "ut", rate: "7.25", tax_rate_id: "txr_ut", stripe_tax_rate_id: "txr_stripe_ut" } });
  });

  it("reuses the mapped Stripe rate when the Medusa rate is unchanged", async () => {
    const existing = { id: "txr_ut", rate: 7.25, is_default: true, metadata: { stripe_tax_rate_id: "txr_stripe_ut" } };
    const query = { graph: jest.fn()
      .mockResolvedValueOnce({ data: [{ id: "sloc_1", address: { country_code: "us" } }] })
      .mockResolvedValueOnce({ data: [{ id: "txreg_ut", tax_rates: [existing] }] }) };
    const stockLocations = { updateStockLocations: jest.fn() };
    const tax = { updateTaxRates: jest.fn().mockResolvedValue(existing) };
    const req: any = { validatedBody: { stock_location_id: "sloc_1", province_code: "ut", rate: "7.25" }, scope: { resolve: (key: string) => key === "query" ? query : key === "stock_location" ? stockLocations : tax } };
    const res: any = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);

    await POST(req, res);

    expect((stripe as any).taxRates.create).not.toHaveBeenCalled();
    expect(tax.updateTaxRates).toHaveBeenCalledWith("txr_ut", expect.objectContaining({ metadata: { stripe_tax_rate_id: "txr_stripe_ut" } }));
  });
});
