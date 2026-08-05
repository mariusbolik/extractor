export const CENTS_PER_THOUSAND_CREDITS = 49;
export const MIN_PURCHASE_CENTS = 1_000;
export const MAX_PURCHASE_CENTS = 490_000;
export const MAX_AUTO_TOP_UP_MONTHLY_CENTS = 490_000;
export const PURCHASE_PRESETS_CENTS = [1_000, 2_000, 5_000, 10_000, 20_000] as const;
export const ANONYMOUS_DAILY_LIMIT = 10;
export const WELCOME_CREDIT_GRANT = 1_000;
export const MAX_ACTIVE_API_KEYS = 2;
export const RESERVATION_TTL_MS = 15 * 60 * 1_000;

export function creditsForAmount(amountCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < MIN_PURCHASE_CENTS || amountCents > MAX_PURCHASE_CENTS) {
    throw new RangeError(`Amount must be an integer from ${MIN_PURCHASE_CENTS} to ${MAX_PURCHASE_CENTS} cents.`);
  }
  return Math.floor((amountCents * 1_000) / CENTS_PER_THOUSAND_CREDITS);
}

export function isValidPurchaseAmount(amountCents: unknown): amountCents is number {
  return Number.isSafeInteger(amountCents)
    && Number(amountCents) >= MIN_PURCHASE_CENTS
    && Number(amountCents) <= MAX_PURCHASE_CENTS;
}

export function isValidAutoTopUp(input: {
  triggerCredits?: unknown;
  amountCents?: unknown;
  monthlyLimitCents?: unknown;
}): input is { triggerCredits: number; amountCents: number; monthlyLimitCents: number } {
  return Number.isSafeInteger(input.triggerCredits)
    && Number(input.triggerCredits) >= 0
    && Number(input.triggerCredits) <= creditsForAmount(MAX_PURCHASE_CENTS)
    && isValidPurchaseAmount(input.amountCents)
    && Number.isSafeInteger(input.monthlyLimitCents)
    && Number(input.monthlyLimitCents) >= Number(input.amountCents)
    && Number(input.monthlyLimitCents) <= MAX_AUTO_TOP_UP_MONTHLY_CENTS;
}
