// The languages the code map reads, and which one a file is in.
import { cLang } from './c.js';
import { csharpLang } from './csharp.js';
import { goLang } from './go.js';
import { htmlLang } from './html.js';
import { javaLang } from './java.js';
import { jsLang } from './js.js';
import { kotlinLang } from './kotlin.js';
import { markdownLang } from './markdown.js';
import { phpLang } from './php.js';
import { pythonLang } from './python.js';
import { rubyLang } from './ruby.js';
import { rustLang } from './rust.js';
import { sqlLang } from './sql.js';
import { swiftLang } from './swift.js';

const LANGS = [jsLang, markdownLang, htmlLang, pythonLang, goLang, rustLang, javaLang, kotlinLang, csharpLang, swiftLang, rubyLang, phpLang, cLang, sqlLang];

// by extension, then by a special file name (a Makefile has no extension)
export function langFor(path) {
  const base = path.slice(path.lastIndexOf('/') + 1), dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  return (ext && LANGS.find((l) => l.exts.includes(ext))) || LANGS.find((l) => l.names && l.names.includes(base)) || null;
}
