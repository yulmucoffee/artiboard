// Pages and single-file components: the JavaScript in their <script> blocks, read by the JS reader with each block's
// lines moved to where the block sits. jsLang is used only inside functions: the bundle of these modules defines it
// after this file.
import { jsLang } from './js.js';

// a script block, or an HTML comment (skipped, so a commented-out script is not code)
const HTML_BLOCK = /<!--[\s\S]*?(?:-->|$)|<script\b([^>]*)>([\s\S]*?)(?:<\/script\s*>|$)/gi;
// a type that is code; anything else (application/json, importmap, text/template…) is data
const HTML_CODE_TYPE = /^(module|(text|application)\/(javascript|ecmascript|babel|jsx|typescript))$/i;

function htmlAttr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(attrs);
  return m ? m[1] : '';
}

function htmlExtract(text, path) {
  const out = { symbols: [], imports: [], refs: [], extends: [] };
  let line = 1, at = 0;
  for (const m of String(text || '').matchAll(HTML_BLOCK)) {
    if (m[1] === undefined) continue;
    const type = htmlAttr(m[1], 'type'), lang = htmlAttr(m[1], 'lang');
    if (type && !HTML_CODE_TYPE.test(type)) continue;
    const body = m.index + m[0].indexOf('>') + 1;
    for (; at < body; at++) if (text.charCodeAt(at) === 10) line++;
    const x = jsLang.extract(m[2], /^ts$|typescript/i.test(lang || type) ? `${path}.ts` : `${path}.js`);
    const move = (o) => ({ ...o, line: o.line + line - 1, ...(o.end ? { end: o.end + line - 1 } : {}) });
    for (const k of ['symbols', 'imports', 'refs', 'extends']) out[k].push(...x[k].map(move));
  }
  return out;
}

export const htmlLang = {
  id: 'html',
  exts: ['.html', '.htm', '.vue', '.svelte'],
  // a page's names reach other files only through imports, as in JavaScript
  moduleScope: true,
  extract: htmlExtract,
  resolve: (spec, fromPath, files) => jsLang.resolve(spec, fromPath, files),
};
