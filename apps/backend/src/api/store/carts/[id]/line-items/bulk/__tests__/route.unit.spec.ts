jest.mock("@medusajs/medusa/core-flows", () => ({ addToCartWorkflow: jest.fn() }));
jest.mock("../../../../../../../utils/stock-location-tax", () => ({ applyStockLocationTaxes: jest.fn() }));

import { POST } from "../route";
import { addToCartWorkflow } from "@medusajs/medusa/core-flows";
import { applyStockLocationTaxes } from "../../../../../../../utils/stock-location-tax";

describe("bulk cart line items", () => {
  it("applies the exclusive stock-location tax after adding an item to an initially empty cart", async () => {
    const addedCart = { id: "cart_1", items: [{ id: "item_1", tax_lines: [{ tax_rate_id: "txr_ca", rate: 7.25 }] }] };
    const query = { graph: jest.fn()
      .mockResolvedValueOnce({ data: [{ id: "cart_1", metadata: { stock_location_id: "sloc_ca" }, items: [] }] })
      .mockResolvedValueOnce({ data: [addedCart] }) };
    const workflow = { run: jest.fn().mockResolvedValue({}) };
    (addToCartWorkflow as unknown as jest.Mock).mockReturnValue(workflow);
    const res: any = { json: jest.fn() };
    const req: any = {
      params: { id: "cart_1" }, validatedBody: { line_items: [{ variant_id: "variant_1", quantity: 1 }] },
      queryConfig: { fields: ["id", "items.tax_lines"] }, scope: { resolve: () => query },
    };

    await POST(req, res);

    expect(workflow.run).toHaveBeenCalledWith({ input: { cart_id: "cart_1", items: [{ variant_id: "variant_1", quantity: 1 }] } });
    expect(applyStockLocationTaxes).toHaveBeenCalledWith(req.scope, "cart_1");
    expect(query.graph.mock.invocationCallOrder[1]).toBeGreaterThan((applyStockLocationTaxes as unknown as jest.Mock).mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith({ cart: addedCart });
  });
});
