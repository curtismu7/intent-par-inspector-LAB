// Stories as data. verticals.json carries the cast and the base intent; scenarios.json carries the steps. {{tokens}} are
// filled from the chosen vertical, so one story reads right for travel, banking and retail.
import fs from 'node:fs';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
export const VERTICALS = load('verticals.json');
export const SCENARIOS = load('scenarios.json');

export const getVertical = (id) => VERTICALS.find((v) => v.id === id);
export const getScenario = (idOrSlug) => SCENARIOS.find((s) => s.id === idOrSlug || s.slug === idOrSlug);

// Token values for a vertical. Numbers stay numbers when a value is exactly one token.
export function castTokens(v) {
  return {
    ...v.cast,
    amount: v.intent.amount,
    amount_tampered: v.intent.amount * 10,
    currency: v.intent.currency,
    action: v.intent.action,
    action_other: v.alt.action,
    resource: v.intent.resource,
    resource_swapped: v.alt.resource,
  };
}

export function render(value, tokens) {
  if (typeof value === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(value);
    if (whole && whole[1] in tokens) return tokens[whole[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tokens ? String(tokens[k]) : m));
  }
  if (Array.isArray(value)) return value.map((x) => render(x, tokens));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, render(x, tokens)]));
  return value;
}

// The vertical's base intent with its description tokens filled in.
export function baseIntent(v) {
  return render(v.intent, castTokens(v));
}

export function renderScenario(scenario, vertical) {
  return render(scenario, castTokens(vertical));
}

// Every string a pack can put on screen, for the host scan.
export function storyCorpus() {
  return [
    ...VERTICALS.map((v) => ({ where: `vertical ${v.id}`, text: JSON.stringify(v) })),
    ...SCENARIOS.map((s) => ({ where: `scenario ${s.id}`, text: JSON.stringify(s) })),
  ];
}
