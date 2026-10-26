import type { Db } from '../db/recipes';
import { findOrCreateUser, saveLoginToken, useLoginToken, type Session } from '../db/users';

// How the API sends mail; the server passes the real one, tests a list to read.
export type Mailer = (to: string, subject: string, body: string) => Promise<void>;

// the app's own link scheme: tapped on the phone, it opens the app rather than a browser
const APP_LINK = 'pocketpantry://sign-in?token=';

// POST /auth/link: emails a one-time link. It answers the same for every address, so it never tells who has an account.
export async function sendLink(db: Db, mail: Mailer, email: string): Promise<{ sent: true } | { status: 400; error: string }> {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { status: 400, error: 'that is not an email address' };
  const user = await findOrCreateUser(db, address);
  const token = crypto.randomUUID();
  await saveLoginToken(db, user.id, token);
  await mail(address, 'Your Pocket Pantry sign-in link', `Tap to sign in: ${APP_LINK}${token}\nIt works once, for 15 minutes.`);
  return { sent: true };
}

// POST /auth/verify: trades a link's token for a session; 410 when the link was used or is too old.
export async function verifyLink(db: Db, token: string): Promise<Session | { status: 410; error: string }> {
  return (await useLoginToken(db, token)) || { status: 410, error: 'this link was used or is too old' };
}
