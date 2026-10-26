// Views are HTML strings: the same functions draw the app's web views and the shared-recipe page on the server.
// A small stand-in for a view library, so a screen is a plain function that is easy to test.
import { css, font, space, themeVars, type Palette } from '../design/tokens';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// elements that have no closing tag
const VOID = new Set(['input', 'img', 'br', 'hr']);

// Text as markup that shows it as written: a recipe title can never become a tag.
export function text(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// One element. Children are markup already (text goes through text() first); arrays are flattened and empty values
// skipped, so a list or an optional block can sit among them.
export function h(tag: string, props: Record<string, string>, ...children: unknown[]): string {
  const attrs = Object.entries(props).map(([name, value]) => ` ${name}="${text(value)}"`).join('');
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  const inner = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).join('');
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

// A list that says what to do when it is empty, instead of leaving a blank screen.
export function listOr<T>(items: T[], render: (item: T) => string, empty: string): string {
  return items.length ? h('ul', { class: 'list' }, items.map(render)) : h('p', { class: 'empty' }, text(empty));
}

// The app's one stylesheet, written from the design tokens: screens name a class, never a size or a color.
export function stylesheet(colors: Palette): string {
  const rules: Record<string, Record<string, string | number>> = {
    main: { padding: space.lg, background: 'var(--background)', color: 'var(--text)', fontSize: font.body },
    h1: { fontSize: font.hero, marginBottom: space.md },
    '.card': { padding: space.md, marginBottom: space.sm, background: 'var(--surface)' },
    '.card h2': { fontSize: font.title },
    '.muted, .empty': { color: 'var(--muted)', fontSize: font.small },
    '.amount': { fontVariantNumeric: 'tabular-nums', marginRight: space.xs },
    '.checked': { color: 'var(--done)', textDecoration: 'line-through' },
  };
  return themeVars(colors) + Object.entries(rules).map(([selector, rule]) => `${selector}{${css(rule)}}`).join('');
}
