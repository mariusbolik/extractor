import { ExtractionError } from './errors';

const MAX_INSPECTION_CHARACTERS = 256 * 1024;

function titleFromHtml(html: string): string {
  return html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() ?? '';
}

function visibleTextFromHtml(html: string): string {
  return html
    .replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identify a full-page access-verification interstitial without treating an
 * ordinary page containing a CAPTCHA widget—or an article discussing bot
 * protection—as blocked. Provider markers are intentionally kept internal.
 */
export function isAccessInterstitialHtml(html: string): boolean {
  const inspected = html.slice(0, MAX_INSPECTION_CHARACTERS);
  if (!/<(?:html|head|body|title)\b/i.test(inspected)) return false;

  const title = titleFromHtml(inspected);
  const visibleText = visibleTextFromHtml(inspected);
  const shortPage = visibleText.length < 4_000;
  const challengeTitle = /^(?:just a moment(?:\.{3})?|attention required!?|checking your browser(?:\.{3})?|security check(?: required)?|verify (?:you are|that you are) human|human verification|access denied|request blocked|ddos-guard)$/i.test(title);
  const challengeCopy = /(?:enable javascript and cookies to continue|verify (?:you are|that you are) human|checking (?:your browser|if the site connection is secure)|performing security verification|review the security of your connection|please stand by, while we are checking your browser|your request has been blocked|you (?:do not|don't) have permission to access)/i.test(visibleText);
  const challengeForm = /(?:\bid=["'](?:challenge-form|cf-challenge-running)["']|\bclass=["'][^"']*\bcf-browser-verification\b)/i.test(inspected);
  const platformMarker = /(?:\/cdn-cgi\/challenge-platform\/|\b(?:window\.)?_cf_chl_opt\b|\bcf-chl-|\bcf_chl_|check\.ddos-guard\.net|\b__ddg\d*_)/i.test(inspected);

  return platformMarker && (challengeTitle || challengeCopy || challengeForm)
    || shortPage && challengeTitle && (challengeCopy || challengeForm);
}

export function assertNoAccessInterstitial(html: string): void {
  if (!isAccessInterstitialHtml(html)) return;
  throw new ExtractionError(
    'source_blocked',
    'The source returned an access-verification page instead of public content.',
    502,
  );
}
