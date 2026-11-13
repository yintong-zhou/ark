import type { TokenCount } from './types';

/**
 * Public API list prices in USD per million tokens, standard tier, global routing, short context.
 * Sources, checked on PRICES_CHECKED:
 * - https://platform.claude.com/docs/en/about-claude/pricing (cached = cache hits and refreshes)
 * - https://developers.openai.com/api/docs/pricing (cached = cached input)
 * Left out on purpose, so they read "API estimate unavailable" like unknown models: Claude Haiku 5.5 (priced by each
 * request's prompt length, which a summed count cannot tell) and gpt-5.6-sol (promotional price ending 2026-11-30,
 * the regular one is unpublished).
 */
export const PRICES_CHECKED = '2026-11-13';

type Price = { input: number; cached: number; output: number };

const PRICES: Record<string, Price> = {
  'claude-fable-5-2': { input: 8, cached: 0.2, output: 40 },
  'claude-mythos-5-2': { input: 8, cached: 0.2, output: 40 },
  'claude-fable-5-1': { input: 10, cached: 0.25, output: 50 },
  'claude-mythos-5-1': { input: 10, cached: 0.25, output: 50 },
  'claude-fable-5': { input: 10, cached: 1, output: 50 },
  'claude-mythos-5': { input: 10, cached: 1, output: 50 },
  'claude-opus-5-5': { input: 4, cached: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cached: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cached: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cached: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cached: 0.5, output: 25 },
  'claude-opus-4-5': { input: 5, cached: 0.5, output: 25 },
  'claude-sonnet-5-5': { input: 2, cached: 0.1, output: 10 },
  'claude-sonnet-5': { input: 2, cached: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cached: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cached: 0.1, output: 5 },
  'gpt-6-astra': { input: 10, cached: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, output: 10 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, output: 5 },
  'gpt-6-sol': { input: 2, cached: 0.2, output: 10 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-5.6-terra': { input: 2, cached: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
  'gpt-5.3-codex': { input: 1.75, cached: 0.175, output: 14 },
};

/** "claude-haiku-4-5-20251001" and "claude-opus-4-6[1m]" price as their base model; anything unknown has no price. */
const priceOf = (model: string): Price | undefined =>
  PRICES[model.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '')];

/**
 * An estimate of a token count at standard public API list prices, not a bill.
 * Both engines report input with cache reads inside it, so the rest (input - cached) is priced as plain input.
 * That rest holds cache writes too (Claude's cache_creation tokens, and any OpenAI cache writes, which Ark does
 * not record), which list at 1.25-2.5x input; long-context, regional and fast-mode prices and discounts such as
 * batch are not applied either.
 * Undefined when the price cannot be worked out from these counts (unknown model, or one left out above).
 */
export function estimateUsd(model: string, t: TokenCount): number | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  const cached = Math.min(Math.max(t.cached, 0), Math.max(t.input, 0));
  const plain = Math.max(t.input, 0) - cached;
  return (plain * p.input + cached * p.cached + Math.max(t.output, 0) * p.output) / 1e6;
}

const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const tiny = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 });

/** "$1,234.57"; amounts under a cent keep two significant digits ("$0.0042") instead of reading "$0.00". */
export const formatUsd = (usd: number): string => (usd > 0 && usd < 0.01 ? tiny : cents).format(usd);
