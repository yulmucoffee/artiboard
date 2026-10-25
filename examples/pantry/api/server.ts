import type { Db } from './db/recipes';
import { savePushToken, sessionFor, type Session } from './db/users';
import { sendLink, verifyLink, type Mailer } from './routes/auth';
import { getRecipe, importRecipe, listRecipes } from './routes/recipes';
import { getList, putItems } from './routes/shopping';

type Route = [method: string, path: RegExp, run: (db: Db, s: Session, params: string[], body: any) => Promise<unknown>];

// The routes that need no session: signing in is how a session starts.
const OPEN = new Set(['/auth/link', '/auth/verify']);

// Method, path and handler; the path's groups are the handler's params, and the first match answers.
function routes(mail: Mailer): Route[] {
  return [
    ['POST', /^\/auth\/link$/, (db, _s, _p, body) => sendLink(db, mail, String(body.email || ''))],
    ['POST', /^\/auth\/verify$/, (db, _s, _p, body) => verifyLink(db, String(body.token || ''))],
    ['GET', /^\/recipes$/, (db, s) => listRecipes(db, s)],
    ['POST', /^\/recipes\/import$/, (db, s, _p, body) => importRecipe(db, s, String(body.url || ''))],
    ['GET', /^\/recipes\/([\w-]+)$/, (db, s, [id]) => getRecipe(db, s, id)],
    ['GET', /^\/shopping\/([\w-]+)$/, (db, s, [list]) => getList(db, s, list)],
    ['PUT', /^\/shopping\/([\w-]+)$/, (db, s, [list], body) => putItems(db, s, list, body.items || [])],
    ['PUT', /^\/devices$/, (db, s, _p, body) => savePushToken(db, s.userId, String(body.token || ''))],
  ];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } });

// The API as one fetch handler, for any runtime that speaks Request and Response. A route that fails answers
// { status, error }; anything else it returns is the 200 body.
export function makeHandler(db: Db, mail: Mailer): (request: Request) => Promise<Response> {
  const table = routes(mail);
  return async (request) => {
    const path = new URL(request.url).pathname.replace(/^\/api/, '');
    const route = table.find(([method, pattern]) => method === request.method && pattern.test(path));
    if (!route) return json(404, { error: 'no such route' });
    const session = OPEN.has(path) ? null : await sessionFor(db, request.headers.get('authorization'));
    if (!session && !OPEN.has(path)) return json(401, { error: 'sign in first' });
    const out: any = await route[2](db, session as Session, route[1].exec(path)!.slice(1), request.method === 'GET' ? {} : await request.json());
    return json(typeof out?.status === 'number' ? out.status : 200, out);
  };
}
