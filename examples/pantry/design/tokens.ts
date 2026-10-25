// Every color, space and type size the app uses, by name. The one stylesheet (shared/ui.ts) is written from these and
// screens only name its classes, so dark mode and a later change of palette touch this file only.

// The two palettes, color by color under the same names; dark mode swaps one for the other.
export const light = {
  background: '#fffaf3', surface: '#ffffff', text: '#2b2118', muted: '#7a6a5c', accent: '#d9622b', done: '#3f8f5a',
};

export const dark: Palette = {
  background: '#1c1713', surface: '#26201b', text: '#f3ebe2', muted: '#a8998b', accent: '#f08a52', done: '#6cc28a',
};

export type Palette = typeof light;

// Spacing steps in points; layouts use these and nothing between them.
export const space = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32 };

// Type sizes in points. Body text is 17, the platform's default, so it follows the phone's text size setting.
export const font = { small: 13, body: 17, title: 22, hero: 28 };

// The palette to draw with: the person's choice, else the phone's appearance.
export function palette(choice: 'light' | 'dark' | 'system', systemDark: boolean): Palette {
  return choice === 'dark' || (choice === 'system' && systemDark) ? dark : light;
}

// The palette as CSS variables on the page root, so the stylesheet writes var(--accent) and dark mode is one swap.
export function themeVars(colors: Palette): string {
  return ':root{' + Object.entries(colors).map(([name, value]) => '--' + name + ':' + value).join(';') + '}';
}

// One CSS rule's body from token values: camelCase names become CSS names, and numbers are points, written as px.
export function css(rules: Record<string, string | number>): string {
  return Object.entries(rules)
    .map(([name, value]) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + ':' + (typeof value === 'number' ? value + 'px' : value))
    .join(';');
}
