// Sign in with an email link: there is no password to forget. The link opens the app, which trades the link's
// one-time token for a session and keeps it on the phone.
import type { Session } from '../../api/db/users';

const SESSION_KEY = 'pantry.session';

// every call here is a JSON POST to the API, which the app reaches on its own origin
async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// Asks the API to email a sign-in link. It answers the same whether or not the address has an account.
export async function requestLink(email: string): Promise<void> {
  const res = await post('/auth/link', { email: email.trim().toLowerCase() });
  if (!res.ok) throw new Error(`The link could not be sent (${res.status}). Try again in a minute.`);
}

// Called when the app opens from a link: trades its token for a session and keeps it.
export async function finishSignIn(link: string): Promise<Session> {
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error('This link has no sign-in token.');
  const res = await post('/auth/verify', { token });
  if (res.status === 410) throw new Error('This link was used already or is too old. Ask for a new one.');
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}).`);
  const session: Session = await res.json();
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

// The session on this phone, or null before the first sign-in and after signing out.
export function currentSession(): Session | null {
  const saved = localStorage.getItem(SESSION_KEY);
  return saved ? JSON.parse(saved) : null;
}

export function signOut(): void {
  localStorage.removeItem(SESSION_KEY);
}
