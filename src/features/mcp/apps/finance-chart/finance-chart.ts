import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import './style.css';

type UnknownRecord = Record<string, unknown>;

interface ChartPoint {
  timestamp: string;
  value: number;
  x: number;
  y: number;
}

const WIDTH = 720;
const TOP = 18;
const BOTTOM = 243;
const LEFT = 18;
const RIGHT = 702;

const root = required<HTMLElement>('.market-card');
const instrument = required<HTMLElement>('#instrument');
const marketMeta = required<HTMLElement>('#market-meta');
const price = required<HTMLElement>('#price');
const change = required<HTMLElement>('#change');
const chartSection = required<HTMLElement>('#chart-section');
const chartWrap = required<HTMLElement>('#chart-wrap');
const chart = required<SVGSVGElement>('#chart');
const chartTitle = required<SVGTitleElement>('#chart-title');
const chartDescription = required<SVGDescElement>('#chart-description');
const line = required<SVGPathElement>('#line');
const area = required<SVGPathElement>('#area');
const crosshair = required<SVGLineElement>('#crosshair');
const activePoint = required<SVGCircleElement>('#active-point');
const hitbox = required<SVGRectElement>('#chart-hitbox');
const tooltip = required<HTMLElement>('#tooltip');
const tooltipPrice = required<HTMLElement>('#tooltip-price');
const tooltipTime = required<HTMLElement>('#tooltip-time');
const rangeLabel = required<HTMLElement>('#range-label');
const startLabel = required<HTMLElement>('#start-label');
const endLabel = required<HTMLElement>('#end-label');
const emptyState = required<HTMLElement>('#empty-state');
const errorState = required<HTMLElement>('#error-state');
const stats = required<HTMLElement>('#stats');
const previousClose = required<HTMLElement>('#previous-close');
const dayRange = required<HTMLElement>('#day-range');
const yearRange = required<HTMLElement>('#year-range');
const volume = required<HTMLElement>('#volume');

let points: ChartPoint[] = [];
let activeCurrency = '';
let activeTimeframe = '';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing finance chart element: ${selector}`);
  return element;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatNumber(value: number | null, maximumFractionDigits = 6): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: Math.abs(value) < 1 ? 2 : 0,
  }).format(value);
}

function formatPrice(value: number | null): string {
  const formatted = formatNumber(value);
  return activeCurrency ? `${formatted} ${activeCurrency}` : formatted;
}

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function formatTime(timestamp: string, detailed = false): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const intraday = activeTimeframe === '1d' || activeTimeframe === '5d';
  return new Intl.DateTimeFormat(undefined, detailed && intraday
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: detailed ? 'medium' : 'short' }).format(date);
}

function historyPoints(attributes: UnknownRecord): ChartPoint[] {
  const history = Array.isArray(attributes.history) ? attributes.history : [];
  const values = history.flatMap((entry) => {
    const point = record(entry);
    const timestamp = text(point?.timestamp);
    const value = finite(point?.close) ?? finite(point?.adjustedClose);
    return timestamp && value !== null ? [{ timestamp, value }] : [];
  });
  if (!values.length) return [];

  let minimum = Math.min(...values.map((point) => point.value));
  let maximum = Math.max(...values.map((point) => point.value));
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.01, 1);
    minimum -= padding;
    maximum += padding;
  } else {
    const padding = (maximum - minimum) * 0.08;
    minimum -= padding;
    maximum += padding;
  }

  return values.map((point, index) => ({
    ...point,
    x: values.length === 1 ? WIDTH / 2 : LEFT + (index / (values.length - 1)) * (RIGHT - LEFT),
    y: TOP + ((maximum - point.value) / (maximum - minimum)) * (BOTTOM - TOP),
  }));
}

function range(low: number | null, high: number | null): string {
  return low === null || high === null ? '—' : `${formatNumber(low)}–${formatNumber(high)}${activeCurrency ? ` ${activeCurrency}` : ''}`;
}

function setText(element: HTMLElement, value: string): void {
  element.textContent = value;
}

function renderResult(result: UnknownRecord): void {
  errorState.hidden = true;
  const structured = record(result.structuredContent);
  let data = structured;
  if (!data) {
    const content = Array.isArray(result.content) ? result.content : [];
    const block = content.map(record).find((item) => item?.type === 'text');
    if (block && typeof block.text === 'string') {
      try {
        data = record(JSON.parse(block.text));
      } catch {
        data = null;
      }
    }
  }
  if (!data || data.type !== 'document') {
    renderError(result.isError === true ? 'The market request failed.' : 'This client returned no structured market data.');
    return;
  }

  const attributes = record(data.attributes) ?? {};
  activeCurrency = text(attributes.currency);
  activeTimeframe = text(attributes.historyTimeframe);
  const symbol = text(attributes.tickerSymbol) || text(data.id);
  const exchange = text(attributes.exchange);
  const marketState = text(attributes.marketState);
  const title = text(data.title) || symbol || 'Market data';
  const currentPrice = finite(attributes.marketPrice);
  const currentChange = finite(attributes.change);
  const currentChangePercent = finite(attributes.changePercent);

  setText(instrument, title);
  setText(marketMeta, [exchange, marketState].filter(Boolean).join(' · '));
  setText(price, formatPrice(currentPrice));
  const hasChange = currentChange !== null || currentChangePercent !== null;
  const sign = (currentChange ?? currentChangePercent ?? 0) > 0 ? '+' : '';
  setText(change, hasChange
    ? `${currentChange === null ? '' : `${sign}${formatNumber(currentChange)}`} ${currentChangePercent === null ? '' : `(${currentChangePercent > 0 ? '+' : ''}${formatNumber(currentChangePercent)}%)`}`.trim()
    : 'Change unavailable');
  change.classList.toggle('positive', (currentChange ?? currentChangePercent ?? 0) > 0);
  change.classList.toggle('negative', (currentChange ?? currentChangePercent ?? 0) < 0);

  activeTimeframe = text(attributes.historyTimeframe);
  setText(rangeLabel, [activeTimeframe, text(attributes.historyInterval)].filter(Boolean).join(' · '));
  setText(previousClose, formatPrice(finite(attributes.previousClose)));
  setText(dayRange, range(finite(attributes.dayLow), finite(attributes.dayHigh)));
  setText(yearRange, range(finite(attributes.fiftyTwoWeekLow), finite(attributes.fiftyTwoWeekHigh)));
  setText(volume, formatCompact(finite(attributes.volume)));
  stats.hidden = false;

  points = historyPoints(attributes);
  if (!points.length) {
    chartSection.hidden = true;
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    chartSection.hidden = false;
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    line.setAttribute('d', path);
    const fillPath = `${path} L ${points.at(-1)!.x.toFixed(2)} ${BOTTOM} L ${points[0]!.x.toFixed(2)} ${BOTTOM} Z`;
    area.setAttribute('d', fillPath);
    const negative = (currentChange ?? points.at(-1)!.value - points[0]!.value) < 0;
    chart.classList.toggle('negative', negative);
    area.setAttribute('fill', negative ? 'url(#area-negative)' : 'url(#area-positive)');
    setText(startLabel, formatTime(points[0]!.timestamp));
    setText(endLabel, formatTime(points.at(-1)!.timestamp));
    chartTitle.textContent = `${title} ${activeTimeframe || 'price'} trend`;
    chartDescription.textContent = `${points.length} closing-price points from ${formatTime(points[0]!.timestamp, true)} to ${formatTime(points.at(-1)!.timestamp, true)}, in ${activeCurrency || 'the selected currency'}.`;
    hideTooltip();
  }

  root.setAttribute('aria-busy', 'false');
}

function renderError(message: string): void {
  root.setAttribute('aria-busy', 'false');
  chartSection.hidden = true;
  emptyState.hidden = true;
  stats.hidden = true;
  errorState.hidden = false;
  errorState.textContent = message;
}

function showPoint(index: number): void {
  const point = points[Math.max(0, Math.min(points.length - 1, index))];
  if (!point) return;
  crosshair.setAttribute('x1', String(point.x));
  crosshair.setAttribute('x2', String(point.x));
  activePoint.setAttribute('cx', String(point.x));
  activePoint.setAttribute('cy', String(point.y));
  crosshair.classList.add('visible');
  activePoint.classList.add('visible');
  tooltip.hidden = false;
  setText(tooltipPrice, formatPrice(point.value));
  setText(tooltipTime, formatTime(point.timestamp, true));
  const percent = (point.x / WIDTH) * 100;
  tooltip.style.left = `${Math.max(12, Math.min(88, percent))}%`;
}

function hideTooltip(): void {
  crosshair.classList.remove('visible');
  activePoint.classList.remove('visible');
  tooltip.hidden = true;
}

function pointFromClientX(clientX: number): number {
  const bounds = chartWrap.getBoundingClientRect();
  const relative = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  return Math.round(relative * Math.max(0, points.length - 1));
}

hitbox.addEventListener('pointermove', (event) => showPoint(pointFromClientX(event.clientX)));
hitbox.addEventListener('pointerleave', hideTooltip);
hitbox.addEventListener('focus', () => showPoint(points.length - 1));
hitbox.addEventListener('blur', hideTooltip);
hitbox.addEventListener('keydown', (event) => {
  if (!points.length || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const current = Number(hitbox.dataset.index ?? points.length - 1);
  const next = Math.max(0, Math.min(points.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
  hitbox.dataset.index = String(next);
  showPoint(next);
});

const app = new App({ name: 'extractor.sh market chart', version: '1.0.0' });
app.addEventListener('toolresult', (result) => renderResult(result as UnknownRecord));
function applyHostContext(context: Partial<McpUiHostContext> | undefined): void {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

app.addEventListener('hostcontextchanged', applyHostContext);
app.connect()
  .then(() => applyHostContext(app.getHostContext()))
  .catch(() => renderError('This chat client could not start the interactive chart. The market data is still available in the conversation.'));
