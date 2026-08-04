import { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MEMBERSHIP_MODULE } from "../../../modules/membership";
import { publicPlan } from "../../memberships/utils";

export const enrichProductMemberships = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
  const send = res.json.bind(res);
  (res as any).json = (body: any) => {
    void (async () => {
      const products = body?.products || (body?.product ? [body.product] : []);
      if (!products.length) return send(body);
      const membershipService: any = req.scope.resolve(MEMBERSHIP_MODULE);
      const plans = await membershipService.listMembershipPlans({ active: true, product_id: products.map((product: any) => product.id) });
      const byProduct = new Map(plans.map((plan: any) => [plan.product_id, plan]));
      for (const product of products) {
        const plan = byProduct.get(product.id);
        if (plan) product.membership = publicPlan(plan);
      }
      send(body);
    })().catch(next);
    return res;
  };
  next();
};
