/**
 * Email styling. Mail clients ignore CSS variables and most web fonts, so values are inlined.
 * Brand fonts load where the client allows; otherwise the stack falls back (OQ-24). Colours
 * are the light palette; every text pairing below meets WCAG AA contrast.
 */
export const EMAIL_FONTS_CSS =
  'https://api.fontshare.com/v2/css?f[]=clash-display@600&f[]=satoshi@400,700&display=swap';

export const emailTheme = {
  ground: '#FAFAF7',
  surface: '#FFFFFF',
  ink: '#18181B', // 17.7:1 on surface
  muted: '#71717A', // 4.8:1 on surface
  accent: '#E4572E', // decorative only, never text
  border: '#E4E4E7',
  headingFont: "'Clash Display', Satoshi, 'Helvetica Neue', Helvetica, sans-serif",
  bodyFont: "Satoshi, 'Helvetica Neue', Helvetica, sans-serif",
  monoFont: "'JetBrains Mono', Menlo, Consolas, monospace",
} as const;
