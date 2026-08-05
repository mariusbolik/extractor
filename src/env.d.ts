/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Env {
  DB: D1Database;
  ACCOUNT_CREDITS: DurableObjectNamespace;
  ANONYMOUS_QUOTA: DurableObjectNamespace;
  HANKO_AUTH_DOMAIN: string;
  BILLING_ENABLED: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  DODOPAYMENTS_API_KEY: string;
  DODOPAYMENTS_BUSINESS_ID: string;
  DODOPAYMENTS_WEBHOOK_KEY: string;
  DODOPAYMENTS_ONE_TIME_PRODUCT_ID: string;
  DODOPAYMENTS_ON_DEMAND_PRODUCT_ID: string;
  DODOPAYMENTS_ENVIRONMENT: string;
  ACCOUNT_EMAIL: SendEmail;
  ANONYMOUS_QUOTA_HMAC_SECRET: string;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ACCOUNT_CREDITS: DurableObjectNamespace;
    ANONYMOUS_QUOTA: DurableObjectNamespace;
    HANKO_AUTH_DOMAIN: string;
    BILLING_ENABLED: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
    DODOPAYMENTS_API_KEY: string;
    DODOPAYMENTS_BUSINESS_ID: string;
    DODOPAYMENTS_WEBHOOK_KEY: string;
    DODOPAYMENTS_ONE_TIME_PRODUCT_ID: string;
    DODOPAYMENTS_ON_DEMAND_PRODUCT_ID: string;
    DODOPAYMENTS_ENVIRONMENT: string;
    ACCOUNT_EMAIL: SendEmail;
    ANONYMOUS_QUOTA_HMAC_SECRET: string;
  }
}
