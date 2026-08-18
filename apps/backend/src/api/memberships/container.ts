import type { MedusaRequest } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { MEMBERSHIP_MODULE } from "../../modules/membership";

export type MembershipStatus = "incomplete" | "active" | "past_due" | "canceled" | "trialing" | "unpaid" | "paused" | "incomplete_expired";

export interface MembershipPlanRecord {
  id: string;
  product_id: string;
  variant_id: string;
  sales_channel_id: string;
  stripe_price_id: string;
  currency_code: string;
  active: boolean;
}

export interface MembershipSubscriptionRecord {
  id: string;
  plan_id: string;
  renewal_type: "recurring" | "none";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  fulfillment_id: string | null;
  organization_id: string | null;
  company_id: string | null;
  stock_location_id: string | null;
  sale_source: string | null;
  customer_name: string | null;
  email: string;
  status: MembershipStatus;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

export interface MembershipBillingCycleRecord {
  id: string;
  membership_subscription_id: string;
  stripe_invoice_id: string;
  stripe_event_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  fulfillment_id: string | null;
  currency_code: string;
  subtotal: string;
  tax_total: string;
  total: string;
  status: "pending" | "paid" | "failed" | "action_required";
}

export interface MembershipService {
  retrieveMembershipPlan(id: string): Promise<MembershipPlanRecord>;
  retrieveMembershipSubscription(id: string): Promise<MembershipSubscriptionRecord>;
  listMembershipSubscriptions(filters: { stripe_subscription_id?: string }): Promise<MembershipSubscriptionRecord[]>;
  createMembershipSubscriptions(input: Omit<MembershipSubscriptionRecord, "id" | "order_id" | "payment_id" | "fulfillment_id">): Promise<MembershipSubscriptionRecord>;
  updateMembershipSubscriptions(input: Partial<MembershipSubscriptionRecord> & Pick<MembershipSubscriptionRecord, "id">): Promise<MembershipSubscriptionRecord>;
  listStripeWebhookEvents(filters: { stripe_event_id: string }): Promise<{ id: string }[]>;
  createStripeWebhookEvents(input: { stripe_event_id: string }): Promise<{ id: string }>;
  listMembershipBillingCycles(filters: { stripe_invoice_id?: string }): Promise<MembershipBillingCycleRecord[]>;
  retrieveMembershipBillingCycle(id: string): Promise<MembershipBillingCycleRecord>;
  createMembershipBillingCycles(input: Omit<MembershipBillingCycleRecord, "id" | "order_id" | "payment_id" | "fulfillment_id">): Promise<MembershipBillingCycleRecord>;
  updateMembershipBillingCycles(input: Partial<MembershipBillingCycleRecord> & Pick<MembershipBillingCycleRecord, "id">): Promise<MembershipBillingCycleRecord>;
}

export async function retrieveMembershipBillingCycleByInvoiceId(
  service: MembershipService,
  stripeInvoiceId: string
): Promise<MembershipBillingCycleRecord | undefined> {
  const match = (await service.listMembershipBillingCycles({ stripe_invoice_id: stripeInvoiceId })).at(0);
  return match ? service.retrieveMembershipBillingCycle(match.id) : undefined;
}

export interface GraphQueryInput {
  entity: string;
  fields: string[];
  filters: Record<string, unknown>;
}

export interface GraphQuery {
  graph<T>(input: GraphQueryInput): Promise<{ data: T[] }>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface Locking {
  execute<T>(keys: string[], action: () => Promise<T>): Promise<T>;
}

export interface EventBus {
  emit(event: { name: string; data: Record<string, unknown> }): Promise<void>;
}

export interface OrderService {
  upsertOrderLineItemTaxLines(input: Array<{ item_id: string; tax_rate_id: string; description: string; code: string; rate: number; provider_id: string }>): Promise<unknown>;
  registerFulfillment(input: { order_id: string; reference: string; reference_id: string; items: Array<{ id: string; quantity: number }> }): Promise<unknown>;
}

export interface Link {
  create(input: Record<string, Record<string, string>>): Promise<unknown>;
}

type Scope = MedusaRequest["scope"];

const resolve = <T>(scope: Scope, key: string): T => scope.resolve(key) as T;

export const resolveMembershipService = (scope: Scope) => resolve<MembershipService>(scope, MEMBERSHIP_MODULE);
export const resolveQuery = (scope: Scope) => resolve<GraphQuery>(scope, ContainerRegistrationKeys.QUERY);
export const resolveLogger = (scope: Scope) => resolve<Logger>(scope, ContainerRegistrationKeys.LOGGER);
export const resolveLocking = (scope: Scope) => resolve<Locking>(scope, Modules.LOCKING);
export const resolveEventBus = (scope: Scope) => resolve<EventBus>(scope, Modules.EVENT_BUS);
export const resolveOrderService = (scope: Scope) => resolve<OrderService>(scope, Modules.ORDER);
export const resolveLink = (scope: Scope) => resolve<Link>(scope, ContainerRegistrationKeys.LINK);

export async function retrieveMembershipSubscriptionByStripeId(
  service: MembershipService,
  stripeSubscriptionId: string
): Promise<MembershipSubscriptionRecord | undefined> {
  const matches = await service.listMembershipSubscriptions({ stripe_subscription_id: stripeSubscriptionId });
  const match = matches.at(0);
  return match ? service.retrieveMembershipSubscription(match.id) : undefined;
}
