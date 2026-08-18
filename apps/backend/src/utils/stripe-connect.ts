import type { MedusaRequest } from "@medusajs/framework";
import Stripe from "stripe";
import { stripe } from "../modules/membership/stripe";
import { resolveQuery } from "../api/memberships/container";

export const STRIPE_CONNECTED_ACCOUNT_METADATA_KEY = "athletify_stripe_connected_account_id";

type SalesChannelMetadata = Record<string, unknown>;
type SalesChannelQueryResult = { id: string; metadata?: SalesChannelMetadata | null };

export class StripeConnectConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConnectConfigurationError";
  }
}

export const maskConnectedAccount = (accountId: string) => `…${accountId.slice(-6)}`;

const isTransferCapableAccount = (account: Stripe.Account | Stripe.DeletedAccount): account is Stripe.Account =>
  !account.deleted && account.payouts_enabled && account.capabilities?.transfers === "active";

/**
 * Resolves the destination exclusively from Sales Channel metadata. A platform
 * account intentionally yields undefined because Stripe forbids transferring to
 * the account that created the PaymentIntent or Subscription.
 */
export async function resolveStripeConnectedAccount(
  scope: MedusaRequest["scope"],
  salesChannelId: string
): Promise<string | undefined> {
  const query = resolveQuery(scope);
  const { data } = await query.graph<SalesChannelQueryResult>({
    entity: "sales_channel",
    fields: ["id", "metadata"],
    filters: { id: salesChannelId },
  });
  const accountId = data.at(0)?.metadata?.[STRIPE_CONNECTED_ACCOUNT_METADATA_KEY];
  if (typeof accountId !== "string" || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new StripeConnectConfigurationError("Connected Account ID missing or invalid");
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const platformAccount = await stripe.accounts.retrieve();
    if (!account.deleted && !platformAccount.deleted && account.id === platformAccount.id) return undefined;
    if (!isTransferCapableAccount(account)) {
      throw new StripeConnectConfigurationError("Stripe account cannot receive transfers");
    }
  } catch (error: unknown) {
    if (error instanceof StripeConnectConfigurationError) throw error;
    throw new StripeConnectConfigurationError("Stripe account cannot receive transfers");
  }
  return accountId;
}
