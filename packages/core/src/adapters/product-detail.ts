import { parseHTML } from 'linkedom';
import { escapeMarkdown, extractMarkdownFromHtml, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedMedia, ExtractionResult, ProductVariant } from '../types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const { document } = parseHTML(`<html><body>${String(value)}</body></html>`);
  return (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function jsonLdValues(value: unknown, output: UnknownRecord[], depth = 0): void {
  if (depth > 6 || output.length >= 100 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => jsonLdValues(item, output, depth + 1));
    return;
  }
  const object = record(value);
  if (!object) return;
  output.push(object);
  Object.values(object).forEach((item) => jsonLdValues(item, output, depth + 1));
}

function productJsonLd(document: Document): UnknownRecord | null {
  const values: UnknownRecord[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const source = script.textContent?.trim() ?? '';
    if (!source || source.length > 500_000) continue;
    try {
      jsonLdValues(JSON.parse(source), values);
    } catch {
      // Malformed optional metadata must not prevent ordinary page extraction.
    }
  }
  return values.find((value) => {
    const type = value['@type'];
    return Array.isArray(type)
      ? type.some((entry) => text(entry).toLowerCase() === 'product')
      : text(type).toLowerCase() === 'product';
  }) ?? null;
}

function publicMediaUrl(value: unknown, pageUrl: URL): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function imagesFrom(value: unknown, pageUrl: URL, title: string): ExtractedMedia[] {
  const candidates: unknown[] = [];
  if (Array.isArray(value)) candidates.push(...value);
  else candidates.push(value);
  const seen = new Set<string>();
  const images: ExtractedMedia[] = [];
  for (const candidate of candidates) {
    const object = record(candidate);
    const url = publicMediaUrl(object?.contentUrl ?? object?.url ?? candidate, pageUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const width = Number(object?.width);
    const height = Number(object?.height);
    images.push({
      type: 'image',
      url,
      alt: text(object?.caption) || title,
      ...(Number.isSafeInteger(width) && width > 0 ? { width } : {}),
      ...(Number.isSafeInteger(height) && height > 0 ? { height } : {}),
    });
    if (images.length === 12) break;
  }
  return images;
}

function nameFrom(value: unknown): string {
  if (Array.isArray(value)) return value.map(nameFrom).filter(Boolean).join(', ');
  return text(record(value)?.name ?? value);
}

function currencyDigits(currency: string): number {
  return ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'].includes(currency)
    ? 0
    : 2;
}

function money(value: unknown, currencyValue: unknown): { price: number; currency: string; priceDisplay: string } | null {
  const amount = Number(value);
  const currency = text(currencyValue).toUpperCase();
  if (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  const digits = currencyDigits(currency);
  const price = Math.round(amount * (10 ** digits));
  if (!Number.isSafeInteger(price)) return null;
  return { price, currency, priceDisplay: `${amount.toFixed(digits)} ${currency}` };
}

function availability(value: unknown): string | null {
  const raw = text(value).split('/').at(-1) ?? '';
  return raw && raw.length <= 80 ? raw : null;
}

function offersFrom(value: unknown): UnknownRecord[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(record).filter((offer): offer is UnknownRecord => offer !== null).slice(0, 100);
}

function variantsFrom(offers: UnknownRecord[]): ProductVariant[] {
  return offers.flatMap((offer) => {
    const item = record(offer.itemOffered);
    const sku = text(item?.sku ?? offer.sku);
    const gtin = text(item?.gtin ?? item?.gtin8 ?? item?.gtin12 ?? item?.gtin13 ?? item?.gtin14);
    const variantTitle = [text(item?.color ?? offer.color), text(item?.size ?? offer.size)].filter(Boolean).join(' / ')
      || text(item?.name)
      || sku;
    if (!variantTitle) return [];
    const price = money(offer.price ?? record(offer.priceSpecification)?.price, offer.priceCurrency ?? record(offer.priceSpecification)?.priceCurrency);
    const state = availability(offer.availability);
    return [{
      title: variantTitle,
      ...(sku ? { id: sku, sku } : {}),
      ...(gtin ? { gtin } : {}),
      ...(price ?? {}),
      ...(state ? { available: state.toLowerCase() === 'instock' } : {}),
    }];
  });
}

function specificationFeatures(document: Document): string[] {
  const output: string[] = [];
  const add = (labelValue: unknown, detailValue: unknown) => {
    const label = text(labelValue);
    const detail = text(detailValue);
    if (!label || !detail || label === detail || label.length > 120 || detail.length > 600) return;
    output.push(`${label}: ${detail}`);
  };

  for (const row of document.querySelectorAll('table tr')) {
    const cells = [...row.querySelectorAll('th, td')];
    if (cells.length >= 2) add(cells[0]?.textContent, cells.slice(1).map((cell) => cell.textContent).join(' / '));
  }
  for (const list of document.querySelectorAll('dl')) {
    const terms = [...list.querySelectorAll('dt')];
    for (const term of terms) add(term.textContent, term.nextElementSibling?.matches('dd') ? term.nextElementSibling.textContent : '');
  }
  for (const row of document.querySelectorAll('.datarow, .specification, .spec-row, [data-specification]')) {
    add(
      row.querySelector('.label, .name, dt, th')?.textContent,
      row.querySelector('.value, dd, td')?.textContent,
    );
  }
  return [...new Set(output)].slice(0, 100);
}

/** Normalize an advertised schema.org Product while reusing the fetched HTML. */
export function extractProductDetailFromHtml(html: string, pageUrl: URL): ExtractionResult | null {
  const { document } = parseHTML(html);
  const product = productJsonLd(document as unknown as Document);
  if (!product) return null;
  const title = text(product.name);
  if (!title) return null;

  const brand = nameFrom(product.brand);
  const sellerOffers = offersFrom(product.offers);
  const seller = sellerOffers.map((offer) => nameFrom(offer.seller)).find(Boolean) ?? '';
  const variants = variantsFrom(sellerOffers);
  const productPrice = variants.map((variant) => variant.price).filter((price): price is number => price !== undefined).sort((a, b) => a - b)[0];
  const pricedVariant = productPrice === undefined ? undefined : variants.find((variant) => variant.price === productPrice);
  const states = sellerOffers.map((offer) => availability(offer.availability)).filter(Boolean) as string[];
  const productAvailability = states.some((state) => state.toLowerCase() === 'instock')
    ? 'InStock'
    : states[0] ?? null;
  const aggregate = record(product.aggregateRating);
  const rating = Number(aggregate?.ratingValue);
  const reviewCount = Number(aggregate?.reviewCount ?? aggregate?.ratingCount);
  const description = htmlFragmentToMarkdown(text(product.description), pageUrl.toString());
  const features = specificationFeatures(document as unknown as Document);
  const sku = text(product.sku);
  const gtin = text(product.gtin ?? product.gtin8 ?? product.gtin12 ?? product.gtin13 ?? product.gtin14);
  const category = text(product.category);
  const images = imagesFrom(product.image, pageUrl, title);
  const readable = extractMarkdownFromHtml(html, pageUrl.toString());
  const readableDetails = readable.content.replace(/^#\s+.*?(?:\r?\n){2}/, '').trim();
  const variantLines = variants.map((variant) => [
    `- ${escapeMarkdown(variant.title)}`,
    variant.sku ? `SKU ${escapeMarkdown(variant.sku)}` : '',
    variant.priceDisplay ? variant.priceDisplay : '',
    variant.available === true ? 'In stock' : variant.available === false ? 'Out of stock' : '',
  ].filter(Boolean).join(' — '));
  const content = [
    `# ${escapeMarkdown(title)}`,
    brand ? `Brand: ${escapeMarkdown(brand)}` : '',
    pricedVariant ? `Price: ${escapeMarkdown(pricedVariant.priceDisplay ?? '')}` : '',
    productAvailability ? `Availability: ${escapeMarkdown(productAvailability)}` : '',
    seller ? `Seller: ${escapeMarkdown(seller)}` : '',
    description,
    readableDetails ? `## Details\n\n${readableDetails}` : '',
    features.length ? `## Specifications\n\n${features.map((feature) => `- ${escapeMarkdown(feature)}`).join('\n')}` : '',
    variantLines.length ? `## Variants\n\n${variantLines.join('\n')}` : '',
    images[0] ? `![${escapeMarkdown(title)}](${images[0].url})` : '',
    `[View product](${pageUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'product',
    source: 'web',
    id: sku || pageUrl.pathname.split('/').filter(Boolean).at(-1) || null,
    url: pageUrl.toString(),
    title,
    author: brand || null,
    publishedAt: null,
    content,
    media: images,
    attributes: {
      productType: 'physical',
      ...(brand ? { brand } : {}),
      ...(seller ? { seller } : {}),
      ...(category ? { category } : {}),
      ...(sku ? { sku } : {}),
      ...(gtin ? { gtin } : {}),
      ...(pricedVariant?.price !== undefined ? {
        price: pricedVariant.price,
        ...(pricedVariant.currency ? { currency: pricedVariant.currency } : {}),
        ...(pricedVariant.priceDisplay ? { priceDisplay: pricedVariant.priceDisplay } : {}),
      } : {}),
      ...(productAvailability ? { availability: productAvailability } : {}),
      ...(Number.isFinite(rating) && rating >= 0 ? { rating, ratingScale: 5 } : {}),
      ...(Number.isSafeInteger(reviewCount) && reviewCount >= 0 ? { reviewCount } : {}),
      ...(features.length ? { features } : {}),
      ...(variants.length ? { variants } : {}),
    },
    method: 'product-jsonld',
  };
}
