// Vercel runs one function per route; they share one store per instance. Vercel has no disk to keep,
// so a site there keeps its data in Supabase.
import { makeApp } from '../server/app.js';
import { loadConfig, openStore } from '../server/config.js';

let app;
async function load() {
  const cfg = loadConfig();
  if (cfg.backend !== 'supabase') throw new Error('on Vercel, set SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY');
  return makeApp({ store: await openStore(cfg), cfg });
}
export const route = (name) => async (req, res) => (await (app ??= load()))(req, res, name);
