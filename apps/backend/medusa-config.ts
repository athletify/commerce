import { QUOTE_MODULE } from "./src/modules/quote";
import { APPROVAL_MODULE } from "./src/modules/approval";
import { COMPANY_MODULE } from "./src/modules/company";
import { MEMBERSHIP_MODULE } from "./src/modules/membership";
import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils";
import { StripeConfig } from "./default.env";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

const parseBoolean = (value?: string) => {
  if (value === undefined) {
    return undefined;
  }

  return value === "true";
};

const cookieSecure = parseBoolean(process.env.COOKIE_SECURE);

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
    ...(cookieSecure === undefined
      ? {}
      : {
          cookieOptions: {
            secure: cookieSecure,
          },
        }),
  },
  modules: {
    [Modules.PAYMENT]: {
      options: {
        providers: [
          {
            resolve: "@medusajs/payment-stripe",
            id: "stripe",
            options: {
              apiKey: StripeConfig.apiKey,
              webhookSecret: StripeConfig.webhookSecret,
              capture: true,
              automaticPaymentMethods: true,
            },
          },
        ],
      },
    },
    [COMPANY_MODULE]: {
      resolve: "./modules/company",
    },
    [QUOTE_MODULE]: {
      resolve: "./modules/quote",
    },
    [APPROVAL_MODULE]: {
      resolve: "./modules/approval",
    },
    [MEMBERSHIP_MODULE]: {
      resolve: "./modules/membership",
    },
  },
});
