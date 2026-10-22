// The site's HTTP handler: board pages, the project list, sign-in, the MCP endpoint and, on SQLite,
// the document API the page's runtime (public/shim.js) reads and writes. Vercel calls it with a route name.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BoardError, isToken, PROJECT_ID, toBoardError } from './core.js';
import { buildServer } from './mcp.js';
import { defaultPage, pageHeaders, renderPage } from './page.js';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const STATUS = { invalid_argument: 400, permission_denied: 403, not_found: 404, version_conflict: 409, already_exists: 409 };
const MAX_BODY = 2 * 1048576;

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ ...SECURITY, 'Cache-Control': 'no-store', ...headers })) res.setHeader(k, v);
  if (typeof body === 'string' || Buffer.isBuffer(body)) res.end(body);
  else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
}
function fail(res, e) {
  const err = toBoardError(e);
  if (err.cause) console.error(err.cause);
  send(res, STATUS[err.code] || 503, { code: err.code, index: err.index, message: err.message });
}

async function body(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || 'null') : req.body;
  let raw = '', size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BoardError('invalid_argument', 'request too large');
    raw += chunk;
  }
  try { return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
}

const bearer = (req) => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1] || null;
const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1] || null;
// cookies ride along on cross-site requests; JSON bodies and a matching Origin keep other sites from writing
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export function makeApp({ store, cfg }) {
  const secure = cfg.boardUrl.startsWith('https:');
  const sessionCookie = (sid, maxAge) => `ab_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  async function memberFor(req) {
    const auth = bearer(req);
    if (auth && isToken(auth)) return store.memberForToken(auth);
    if (auth && store.memberForJwt) return store.memberForJwt(auth);
    if (store.memberForSession) return store.memberForSession(cookie(req, 'ab_session'));
    return null;
  }

  async function mcp(req, res) {
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, { Allow: 'POST' });
    const token = bearer(req);
    const member = isToken(token) ? await store.memberForToken(token) : null;
    if (!member) return send(res, 401, { jsonrpc: '2.0', error: { code: -32000, message: 'Missing, unknown or revoked board token' }, id: null });
    const server = buildServer({ store, cfg, member });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, await body(req));
  }

  async function page(res, project) {
    if (!PROJECT_ID.test(project || '')) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    // an unknown project gets the bundled page too, so nobody can find project ids by trying addresses;
    // its data stays behind sign-in either way
    let own = null;
    try { own = await store.getPage(project); } catch (e) {
      if (toBoardError(e).code !== 'not_found') throw e;
    }
    send(res, 200, renderPage(own?.html ?? defaultPage(), cfg), pageHeaders(cfg));
  }

  async function login(req, res) {
    const b = (await body(req)) || {};
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    if (store.startSession) {
      const sid = await store.startSession({ token, code: b.code });
      if (!sid) return send(res, 401, { error: token ? 'unknown_token' : 'expired_link' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(sid, 30 * 86400) });
    }
    const member = await store.memberForToken(token);
    if (!member) return send(res, 401, { error: 'unknown_token' });
    send(res, 200, { url: await store.loginLink(member) });
  }

  // the document API behind the page's runtime on SQLite (Supabase pages read and write Supabase directly)
  async function docs(req, res, member, project, action) {
    if (action === 'events') {
      await store.readRows(project, {});
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(': live\n\n');
      const off = store.subscribe(project, (row) => res.write(`data: ${JSON.stringify(row)}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { off(); clearInterval(ping); });
      return;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    const b = (await body(req)) || {};
    if (action === 'read') return send(res, 200, await store.readRows(project, b));
    if (action === 'batch') return send(res, 200, await store.apply(member.uid, project, b.writes));
    if (action === 'acquire') return send(res, 200, { acquired: await store.acquire(member.uid, `${project}:${b.path}`, b.holder, b.ttlMs) });
    send(res, 404, { error: 'not_found' });
  }

  async function serveStatic(res, path) {
    const file = normalize(join(PUBLIC, path === '/' ? 'index.html' : path));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain' });
    try {
      const data = await readFile(file);
      send(res, 200, data, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch {
      send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    }
  }

  // route: a name when Vercel calls one function per route, otherwise found from the URL
  return async function handle(req, res, route) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (route === 'mcp' || p === '/mcp') return await mcp(req, res);
      if (route === 'page') return await page(res, url.searchParams.get('project'));
      const board = /^\/p\/([^/]+)\/?$/.exec(p);
      if (board) return await page(res, board[1]);
      const api = route ? [null, route] : /^\/api\/(.+)$/.exec(p);
      if (!api) return await serveStatic(res, p);
      const name = api[1];
      if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'cross_origin' });

      if (name === 'config') {
        return send(res, 200, { backend: store.kind, site: cfg.site, lang: cfg.lang, ...(store.browser || {}) }, { 'Cache-Control': 'no-cache' });
      }
      if (name === 'login') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
        return await login(req, res);
      }
      if (name === 'logout') {
        if (store.endSession) await store.endSession(cookie(req, 'ab_session'));
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
      }

      const member = await memberFor(req);
      if (!member) return send(res, 401, { error: 'signed_out' });
      if (name === 'me') return send(res, 200, member);
      if (name === 'projects') {
        if (req.method === 'POST') {
          const b = (await body(req)) || {};
          return send(res, 200, await store.createProject(member.uid, { id: b.id, title: b.title, lang: b.lang || cfg.lang }));
        }
        return send(res, 200, await store.overview());
      }
      const m = /^p\/([a-z0-9][a-z0-9-]{0,39})\/(read|batch|acquire|events)$/.exec(name);
      if (m && store.readRows) return await docs(req, res, member, m[1], m[2]);
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      fail(res, e);
    }
  };
}
