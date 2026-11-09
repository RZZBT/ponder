/** Color handling: theme tokens + hex parsing + interpolation. Colors are interpolated in sRGB space. */

export interface Rgba { r: number; g: number; b: number; a: number }

export type Palette = Readonly<Record<string, string>>;

// ANSI-like colors; each has at least 4.5:1 contrast against the player background.
export const DARK_PALETTE: Palette = {
  text: '#E4E4E4',
  muted: '#9E9E9E',
  accent: '#5FD7FF',
  accent2: '#D787D7',
  success: '#87D75F',
  warning: '#FFD75F',
  danger: '#FF5F5F',
  surface: '#1C1C1C',
};

export const LIGHT_PALETTE: Palette = {
  text: '#1C1C1C',
  muted: '#5C5C5C',
  accent: '#005F87',
  accent2: '#870087',
  success: '#005F00',
  warning: '#875F00',
  danger: '#AF0000',
  surface: '#ECECEC',
};

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export function parseHex(hex: string): Rgba | null {
  const m = /^#([0-9a-fA-F]+)$/.exec(hex);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

/** Resolves a token or hex string to RGBA. `none` -> fully transparent. Unknown values -> transparent. */
export function resolveColor(value: string, palette: Palette): Rgba {
  if (value === 'none') return TRANSPARENT;
  const hex = value.startsWith('#') ? value : palette[value];
  return (hex ? parseHex(hex) : null) ?? TRANSPARENT;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function toCss(c: Rgba): string {
  const a = Math.max(0, Math.min(1, c.a));
  if (a <= 0) return 'none';
  return a >= 1
    ? `rgb(${clamp255(c.r)},${clamp255(c.g)},${clamp255(c.b)})`
    : `rgba(${clamp255(c.r)},${clamp255(c.g)},${clamp255(c.b)},${+a.toFixed(3)})`;
}

/**
 * Interpolates two colors. When one side is `none`, the other color is faded in/out instead of
 * blending through black (a transparent end takes the RGB of the opaque end).
 */
export function lerpColor(from: string, to: string, t: number, palette: Palette): string {
  if (t <= 0) return toCss(resolveColor(from, palette));
  if (t >= 1) return toCss(resolveColor(to, palette));
  let a = resolveColor(from, palette);
  let b = resolveColor(to, palette);
  if (a.a === 0 && b.a > 0) a = { ...b, a: 0 };
  else if (b.a === 0 && a.a > 0) b = { ...a, a: 0 };
  return toCss({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  });
}
