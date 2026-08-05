import type { APIRoute } from 'astro';
import { ALL as placesAll, GET as placesGet } from './places';

export const prerender = false;

/**
 * Deprecated compatibility alias for the canonical place-search contract.
 * The shared handler deliberately represents /api/places so both URLs produce
 * identical response bodies and share one versioned Worker cache entry.
 */
export const GET: APIRoute = placesGet;
export const ALL: APIRoute = placesAll;
