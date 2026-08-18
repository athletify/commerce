import { validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import { AdminCreateMembershipPlan, AdminGetMembershipPlanParams, AdminUpdateMembershipPlan } from "./validators";

const queryConfig = { defaults: ["*"], isList: false };
export const adminMembershipsMiddlewares: MiddlewareRoute[] = [
  { method: ["POST"], matcher: "/admin/membership-plans", middlewares: [validateAndTransformBody(AdminCreateMembershipPlan), validateAndTransformQuery(AdminGetMembershipPlanParams, queryConfig)] },
  { method: ["POST"], matcher: "/admin/membership-plans/:id", middlewares: [validateAndTransformBody(AdminUpdateMembershipPlan), validateAndTransformQuery(AdminGetMembershipPlanParams, queryConfig)] },
];
