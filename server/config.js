// Site settings come from the environment, so the same code runs on a laptop, in a container or on Vercel.
import { homedir } from 'node:os';
import { join } from 'node:path';

export function loadConfig(env = process.env) {
  const port = Number(env.PORT) || 4100;
  const host = env.HOST || '127.0.0.1';
  const backend = env.ARTIBOARD_BACKEND || (env.SUPABASE_URL ? 'supabase' : 'sqlite');
  if (!['sqlite', 'supabase'].includes(backend)) throw new Error(`ARTIBOARD_BACKEND must be sqlite or supabase, not ${backend}`);
  const local = ['127.0.0.1', '0.0.0.0', '::', '::1'].includes(host) ? 'localhost' : host;
  return {
    port,
    host,
    backend,
    boardUrl: (env.BOARD_URL || `http://${local}:${port}`).replace(/\/$/, ''),
    // shown on the sign-in screen, the project list and in the MCP server's instructions
    site: env.ARTIBOARD_SITE || 'artiboard',
    // the language of new projects and of the site's own screens
    lang: env.ARTIBOARD_LANG || 'en',
    dbFile: env.ARTIBOARD_DB || join(homedir(), '.artiboard', 'board.db'),
    supabase: { url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY, publishableKey: env.SUPABASE_PUBLISHABLE_KEY },
  };
}

export async function openStore(cfg) {
  if (cfg.backend === 'supabase') {
    const { url, secretKey, publishableKey } = cfg.supabase;
    if (!url || !secretKey || !publishableKey) throw new Error('the supabase backend needs SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY');
    const { openSupabase } = await import('./store/supabase.js');
    return openSupabase({ url, secretKey, publishableKey, boardUrl: cfg.boardUrl });
  }
  const { openSqlite } = await import('./store/sqlite.js');
  return openSqlite({ file: cfg.dbFile, boardUrl: cfg.boardUrl });
}
