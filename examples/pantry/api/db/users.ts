import type { Db } from './recipes';

// Who a request is from: the signed-in person and the household whose recipes and lists they share.
export type Session = { token: string; userId: string; householdId: string; email: string };

const SESSION = `SELECT s.token, u.id AS user_id, u.household_id, u.email FROM sign_ins s JOIN users u ON u.id = s.user_id
  WHERE s.token = $1 AND s.kind = 'session' AND s.expires_at > now()`;

// The person with this email, made on first sign-in with a household of their own.
export async function findOrCreateUser(db: Db, email: string): Promise<{ id: string; householdId: string }> {
  const [user] = await db.query<{ id: string; householdId: string }>(
    'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING id, household_id',
    [email],
  );
  return user;
}

// Stores a sign-in link's token; it works once, for 15 minutes.
export async function saveLoginToken(db: Db, userId: string, token: string): Promise<void> {
  await db.query("INSERT INTO sign_ins (token, user_id, kind, expires_at) VALUES ($1, $2, 'link', now() + interval '15 minutes')", [token, userId]);
}

// Uses a link's token: the statement that reads it deletes it, so a second tap finds nothing. Null when the token is
// unknown, used or too old; else a new session that lasts a year.
export async function useLoginToken(db: Db, token: string): Promise<Session | null> {
  const [link] = await db.query<{ userId: string }>("DELETE FROM sign_ins WHERE token = $1 AND kind = 'link' AND expires_at > now() RETURNING user_id", [token]);
  if (!link) return null;
  const session = crypto.randomUUID();
  await db.query("INSERT INTO sign_ins (token, user_id, kind, expires_at) VALUES ($1, $2, 'session', now() + interval '1 year')", [session, link.userId]);
  const [found] = await db.query<Session>(SESSION, [session]);
  return found;
}

// The session a request's "Bearer <token>" header names, or null.
export async function sessionFor(db: Db, header: string | null): Promise<Session | null> {
  const token = /^Bearer (\S+)$/.exec(header || '')?.[1];
  if (!token) return null;
  const [found] = await db.query<Session>(SESSION, [token]);
  return found || null;
}

// Keeps the push token of the phone this person signed in on last.
export async function savePushToken(db: Db, userId: string, token: string): Promise<void> {
  await db.query('UPDATE users SET push_token = $2 WHERE id = $1', [userId, token]);
}
