// The board page a hosted site serves: the same page the claude.ai artifact publishes
// (skills/artiboard/assets/board.html), or a project's own copy, plus the runtime that stands in for claude.ai.
import { readFileSync } from 'node:fs';

const BUNDLED = new URL('../skills/artiboard/assets/board.html', import.meta.url);
let cached;
export const defaultPage = () => (cached ??= readFileSync(BUNDLED, 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The artifact page is a fragment (claude.ai wraps it on publish); a project's own page may be a whole document.
export function renderPage(html, cfg) {
  const runtime = '<script src="/shim.js"></script>\n';
  // <head> itself, not the page's <header>
  const head = /<head(?=[\s>])[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + '\n' + runtime + html.slice(head.index + head[0].length);
  return `<!doctype html>
<html lang="${esc(cfg.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${runtime}</head>
<body>
${html}
</body>
</html>
`;
}

// Pages may run code an admin wrote, so they may only talk to this site (and Supabase, when it holds the data).
export function pageHeaders(cfg) {
  const sb = cfg.backend === 'supabase' && cfg.supabase.url ? ` ${cfg.supabase.url} ${cfg.supabase.url.replace(/^http/, 'ws')}` : '';
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", `connect-src 'self'${sb}`,
      "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ].join('; '),
  };
}
