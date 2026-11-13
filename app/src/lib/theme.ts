// Brand colours are CSS variables (space-separated RGB) so Tailwind classes like
// bg-brand-500/20 keep working while Leaders change the colours at runtime.
import type { AppSettings } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  company_name: 'Access & Site Services',
  primary_color: '#2047c6',
  accent_color: '#f5b81a',
  dark_color: '#13213f',
  logo_url: null,
};

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
const mix = (hex: string, target: 0 | 255, t: number) => rgb(hex).map((c) => Math.round(c + (target - c) * t)).join(' ');

// [shade, toward white (+) or black (-)]
const BRAND: [number, number][] = [[50, 0.92], [100, 0.85], [200, 0.7], [300, 0.5], [400, 0.25], [500, 0], [600, -0.15], [700, -0.3], [800, -0.42], [900, -0.52]];
const STEEL: [number, number][] = [[50, 0.965], [100, 0.93], [200, 0.86], [300, 0.72], [400, 0.55], [500, 0.42], [600, 0.3], [700, 0.18], [800, 0.08], [900, 0], [950, -0.35]];
const ACCENT: [number, number][] = [[50, 0.92], [100, 0.8], [300, 0.4], [400, 0.2], [500, 0], [600, -0.12], [700, -0.3]];

export function themeVars(s: Pick<AppSettings, 'primary_color' | 'accent_color' | 'dark_color'>) {
  const out: Record<string, string> = {};
  const scale = (name: string, hex: string, steps: [number, number][]) => {
    for (const [shade, t] of steps) out[`--${name}-${shade}`] = t >= 0 ? mix(hex, 255, t) : mix(hex, 0, -t);
  };
  scale('brand', s.primary_color, BRAND);
  scale('steel', s.dark_color, STEEL);
  scale('hivis', s.accent_color, ACCENT);
  return out;
}

export function applyTheme(s: AppSettings) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(s))) root.style.setProperty(k, v);
  document.title = s.company_name || DEFAULT_SETTINGS.company_name;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', s.dark_color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="14" fill="${s.primary_color}"/><rect x="47" y="25" width="34" height="13" fill="${s.accent_color}"/><rect x="33" y="44" width="48" height="13" fill="#fff"/><rect x="19" y="63" width="62" height="13" fill="#fff"/></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = s.logo_url || `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
