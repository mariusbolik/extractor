const allowAllRateLimiter = {
  async limit(_options: { key: string }): Promise<{ success: boolean }> {
    return { success: true };
  },
};

const unavailableEmail = {
  async send(_message: unknown): Promise<void> {
    throw new Error('Email sending is unavailable in the native Astro preview.');
  },
};

/** Development-only substitute for Cloudflare's virtual bindings module. */
export const env = {
  EXTRACT_RATE_LIMITER: allowAllRateLimiter,
  BROWSER_RATE_LIMITER: allowAllRateLimiter,
  CONTACT_RATE_LIMITER: allowAllRateLimiter,
  CONTACT_EMAIL: unavailableEmail,
  ACCOUNT_EMAIL: unavailableEmail,
  // Cloudflare's documented always-pass keys keep the local visual preview
  // deterministic without loading production credentials into client code.
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
};
