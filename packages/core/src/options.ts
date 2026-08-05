import { ExtractionError } from './errors';

/** Normalize a public language input to its canonical BCP 47 representation. */
export function normalizeLanguageTag(value: string | undefined, fallback: string): string {
  const candidate = value === undefined ? fallback : value.trim();
  if (!candidate) {
    throw new ExtractionError('invalid_request', 'Language must be a valid BCP 47 language tag.', 400);
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(candidate);
    if (!canonical) throw new RangeError('Missing language tag');
    return canonical;
  } catch {
    throw new ExtractionError('invalid_request', 'Language must be a valid BCP 47 language tag.', 400);
  }
}

/** Normalize an ISO 3166-1 alpha-2 country input. */
export function normalizeCountryCode(value: string | undefined, fallback?: string): string | undefined {
  const candidate = value === undefined ? fallback : value.trim();
  if (candidate === undefined) return undefined;
  if (!/^[A-Za-z]{2}$/.test(candidate)) {
    throw new ExtractionError('invalid_request', 'Country must be a two-letter ISO country code.', 400);
  }
  return candidate.toUpperCase();
}

export function normalizeChoice<const T extends readonly string[]>(
  value: string | undefined,
  choices: T,
  fallback: T[number],
  label: string,
): T[number] {
  const candidate = value === undefined ? fallback : value.trim();
  if (!(choices as readonly string[]).includes(candidate)) {
    throw new ExtractionError(
      'invalid_request',
      `${label} must be one of: ${choices.join(', ')}.`,
      400,
    );
  }
  return candidate as T[number];
}

export function normalizeCoordinate(
  value: number | undefined,
  minimum: number,
  maximum: number,
  label: 'Latitude' | 'Longitude',
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ExtractionError(
      'invalid_request',
      `${label} must be a number from ${minimum} to ${maximum}.`,
      400,
    );
  }
  return value;
}
