// The site's HTTP handler: board pages, the project list, sign-in, the MCP endpoint and, on SQLite,
// the document API the page's runtime (public/shim.js) reads and writes. Vercel calls it with a route name.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BoardError, isToken, PERSON_ID, PROJECT_ID, toBoardError } from './core.js';
import { makeFlow } from './flow.js';
import { buildServer } from './mcp.js';
import { addMember, connectLines, removeMember, setProfile, titleOf } from './members.js';
import { defaultPage, pageHeaders, renderPage } from './page.js';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const STATUS = { invalid_argument: 400, permission_denied: 403, not_yours: 403, not_found: 404, version_conflict: 409, already_exists: 409 };
const MAX_BODY = 2 * 1048576;
const MAP_CHUNKS = /^map\/[^/]+\/chunks$/;
// a code map upload: up to 60 chunks of 200,000 bytes and the index
const MAX_MAP_BODY = 16 * 1048576;

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ ...SECURITY, 'Cache-Control': 'no-store', ...headers })) res.setHeader(k, v);
  let out = body;
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) { res.setHeader('Content-Type', 'application/json'); out = JSON.stringify(body); }
  // a board's whole task list is large and compresses about tenfold; a host that compresses itself leaves an encoded body alone
  if (out.length > 8192 && /\bgzip\b/.test(res.req?.headers?.['accept-encoding'] || '')) {
    out = gzipSync(out);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
  }
  res.end(out);
}
function fail(res, e) {
  const err = toBoardError(e);
  if (err.cause) console.error(err.cause);
  send(res, STATUS[err.code] || 503, { code: err.code, index: err.index, message: err.message });
}

// The request's JSON. The bytes are decoded once, whole: a character split across two chunks would otherwise be
// stored as U+FFFD. A body that is not JSON is refused rather than read as nothing. A host may read the body before the
// site does and hand it over parsed, as text or as bytes. Gzipped bytes are inflated, at most to max: a map upload
// sends them as they are (octet-stream, so no host tries to parse them first), and other clients may say gzip.
async function body(req, max = MAX_BODY) {
  const parse = (raw) => {
    try { return raw ? JSON.parse(raw) : undefined; } catch { throw new BoardError('invalid_argument', 'the request body is not JSON'); }
  };
  let given;
  // a host's own parse of a body that is not JSON throws here
  try { given = req.body; } catch { throw new BoardError('invalid_argument', 'the request body is not JSON'); }
  let raw;
  if (given !== undefined) {
    if (typeof given !== 'string' && !Buffer.isBuffer(given)) return given;
    raw = Buffer.from(given);
    if (raw.length > max) throw new BoardError('invalid_argument', 'request too large');
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw new BoardError('invalid_argument', 'request too large');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks);
  }
  // JSON never starts with these two bytes; gzip always does
  if ((raw[0] === 0x1f && raw[1] === 0x8b) || /\bgzip\b/.test(req.headers['content-encoding'] || '')) {
    try { raw = gunzipSync(raw, { maxOutputLength: max }); } catch { throw new BoardError('invalid_argument', 'request too large or not gzip'); }
  }
  return parse(raw.toString('utf8'));
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
  const { mapsMeta, setMap } = makeFlow(store);
  // each member's open live-update streams, so revoking, demoting or removing them ends what they already hold open
  const streams = new Map();
  const endStreams = (uid) => { for (const res of streams.get(uid) || []) res.end(); };
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
      const open = streams.get(member.uid) || new Set();
      if (open.size >= 20) return send(res, 429, { error: 'too_many_streams' });
      streams.set(member.uid, open.add(res));
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(': live\n\n');
      // a rebuilt code map's chunks are large and pages read them when a search needs them: they are not pushed
      // a stream ended by a revoke stays open until its close event: nothing more is written to it in between
      const write = (text) => { if (!res.writableEnded) res.write(text); };
      const off = store.subscribe(project, (row) => { if (!MAP_CHUNKS.test(row.collection)) write(`data: ${JSON.stringify(row)}\n\n`); });
      // sign-in is checked again on every ping, so a stream outlives a revoke from the command line by one ping at most;
      // a store that cannot answer this once keeps the stream
      const ping = setInterval(async () => {
        const still = await memberFor(req).then((m) => m?.uid === member.uid, () => true);
        if (still) write(': ping\n\n'); else res.end();
      }, 25000);
      req.on('close', () => {
        off(); clearInterval(ping);
        open.delete(res);
        if (!open.size && streams.get(member.uid) === open) streams.delete(member.uid);
      });
      return;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    const b = (await body(req)) || {};
    if (action === 'read') return send(res, 200, await store.readRows(project, b));
    if (action === 'batch') return send(res, 200, await store.apply(member.uid, project, b.writes));
    send(res, 404, { error: 'not_found' });
  }

  // Admins manage who is on the site from the projects page: the same steps as `artiboard member …`.
  // A token or a sign-in link is in the response once and nowhere else.
  async function members(req, res, me, rest) {
    if (me.role !== 'admin') return send(res, 403, { error: 'admins_only' });
    if (!rest) {
      if (req.method !== 'POST') {
        const list = await store.listMembers();
        for (const m of list) m.title = await titleOf(store, m);
        return send(res, 200, list);
      }
      const b = (await body(req)) || {};
      const { member, projects, token } = await addMember(store, { person: b.person, name: b.name, email: b.email, role: b.access || 'member' });
      return send(res, 200, { member, projects, token, connect: connectLines(cfg.boardUrl, token) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    const m = /^([^/]+)\/(token|link|revoke|access|remove)$/.exec(rest);
    if (!m || !PERSON_ID.test(m[1])) return send(res, 404, { error: 'not_found' });
    const target = await store.memberByPerson(m[1]);
    if (!target) return send(res, 404, { error: 'no_member' });
    const b = (await body(req)) || {};
    switch (m[2]) {
      case 'token': { const token = await store.issueToken(target.uid, 'agent'); return send(res, 200, { token, connect: connectLines(cfg.boardUrl, token) }); }
      case 'link': return send(res, 200, { url: await store.loginLink(target) });
      case 'revoke': { const revoked = await store.revokeTokens(target.uid); endStreams(target.uid); return send(res, 200, { revoked }); }
      case 'access':
        if (target.uid === me.uid) throw new BoardError('invalid_argument', 'ask another admin to change your own access');
        await store.setRole(target.uid, b.access);
        endStreams(target.uid);
        return send(res, 200, { ok: true });
      case 'remove':
        if (target.uid === me.uid) throw new BoardError('invalid_argument', 'ask another admin to remove you');
        await removeMember(store, target);
        endStreams(target.uid);
        return send(res, 200, { ok: true });
    }
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
      let name = api[1];
      // Vercel runs one function per route, so /api/members/<person>/<action> and /api/p/<project>/map arrive rewritten
      // as a query
      if (name === 'members' && url.searchParams.get('person')) name = `members/${url.searchParams.get('person')}/${url.searchParams.get('action') || ''}`;
      if (name === 'map') name = `p/${url.searchParams.get('project')}/map`;
      if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'cross_origin' });

      if (name === 'config') {
        return send(res, 200, { backend: store.kind, site: cfg.site, lang: cfg.lang, ...(store.browser || {}) }, { 'Cache-Control': 'no-cache' });
      }
      if (name === 'login') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
        return await login(req, res);
      }
      if (name === 'logout') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
        if (store.endSession) await store.endSession(cookie(req, 'ab_session'));
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
      }

      const member = await memberFor(req);
      if (!member) return send(res, 401, { error: 'signed_out' });
      if (name === 'me') {
        if (req.method === 'POST') {
          const b = (await body(req)) || {};
          return send(res, 200, { ...member, ...(await setProfile(store, member, { name: b.name, title: b.title })) });
        }
        return send(res, 200, { ...member, title: await titleOf(store, member) });
      }
      if (name === 'members' || name.startsWith('members/')) return await members(req, res, member, name.slice('members/'.length));
      if (name === 'projects') {
        if (req.method === 'POST') {
          const b = (await body(req)) || {};
          return send(res, 200, await store.createProject(member.uid, { id: b.id, title: b.title, lang: b.lang || cfg.lang }));
        }
        return send(res, 200, await store.overview());
      }
      // a code map from the build script, written as the member who sent it, so the store's rules apply (a viewer cannot);
      // anyone signed in reads which code each map describes, which the script asks before it builds
      const up = /^p\/([a-z0-9][a-z0-9-]{0,39})\/map$/.exec(name);
      if (up) {
        if (req.method === 'GET') return send(res, 200, await mapsMeta(up[1]));
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });
        return send(res, 200, await setMap(member, up[1], (await body(req, MAX_MAP_BODY)) || {}));
      }
      const m = /^p\/([a-z0-9][a-z0-9-]{0,39})\/(read|batch|events)$/.exec(name);
      if (m && store.readRows) return await docs(req, res, member, m[1], m[2]);
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      fail(res, e);
    }
  };
}
