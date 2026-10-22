// Supabase store: Postgres holds the documents (supabase/migrations), Supabase Auth signs people in,
// and Realtime keeps open pages current. The server talks to it with the service key, so every
// function here is called only after the caller's token or session was checked.
import { createClient } from '@supabase/supabase-js';
import { BoardError, hashToken, isToken, newToken, now, PERSON_ID, PROJECT_ID, projectSeed, ROLES, toBoardError } from '../core.js';

const memberOut = (r) => r && { uid: r.user_id, person: r.person, name: r.name, email: r.email, role: r.role };

export function openSupabase({ url, secretKey, publishableKey, boardUrl }) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = ({ data, error }) => { if (error) throw toBoardError(error); return data; };
  const rpc = async (name, args) => check(await sb.rpc(name, args));

  const get = (project, path) => rpc('ab_get', { p_project: project, p_path: path });
  const query = (project, collection, { where = [], order = [], limit = 20, after = null } = {}) =>
    rpc('ab_query', { p_project: project, p_collection: collection, p_where: where || [], p_order: order || [], p_limit: limit, p_after: after });
  const apply = (actor, project, writes) => rpc('ab_apply', { p_actor: actor ?? null, p_project: project, p_writes: writes });

  async function overview() { return rpc('ab_overview', {}); }
  async function projectIds() { return check(await sb.from('ab_projects').select('id').order('id')).map((p) => p.id); }

  async function createProject(actor, { id, title, lang = 'en', repos = [] }) {
    if (typeof id !== 'string' || !PROJECT_ID.test(id)) throw new BoardError('invalid_argument', 'project id must be 1 to 40 lowercase letters, digits or hyphens');
    title = String(title || '').trim();
    if (!title || title.length > 120) throw new BoardError('invalid_argument', 'title must be 1 to 120 characters');
    let author = 'admin';
    if (actor != null) {
      const me = check(await sb.from('ab_members').select('person, role').eq('user_id', actor).maybeSingle());
      if (!me || me.role === 'viewer') throw new BoardError('permission_denied', 'this account cannot create projects');
      author = me.person;
    }
    const { error } = await sb.from('ab_projects').insert({ id, title, created_by: actor ?? null });
    if (error) throw error.code === '23505' ? new BoardError('already_exists', `project ${id} already exists`) : toBoardError(error);
    try {
      await apply(null, id, projectSeed({ title, lang, members: await listMembers(), author, repos }));
    } catch (e) {
      await sb.from('ab_projects').delete().eq('id', id);
      throw e;
    }
    return { id, title };
  }
  async function dropProject(id) { return check(await sb.from('ab_projects').delete().eq('id', id).select('id')).length > 0; }

  async function getPage(project) {
    const p = check(await sb.from('ab_projects').select('id').eq('id', project).maybeSingle());
    if (!p) throw new BoardError('not_found', `no project ${project}`);
    return check(await sb.from('ab_pages').select('html, version, updated_at').eq('project', project).maybeSingle());
  }
  const setPage = (actor, project, html, ifVersion) => {
    if (typeof html !== 'string' || !html.trim() || html.length > 1048576) throw new BoardError('invalid_argument', 'page must be HTML under 1 MiB');
    return rpc('ab_set_page', { p_actor: actor ?? null, p_project: project, p_html: html, p_if_version: ifVersion ?? null });
  };
  async function resetPage(actor, project) {
    if (actor != null && (await memberByUid(actor))?.role !== 'admin') throw new BoardError('permission_denied', 'only admins change a board page');
    await getPage(project);
    return check(await sb.from('ab_pages').delete().eq('project', project).select('project')).length > 0;
  }

  async function memberForToken(token) {
    if (!isToken(token)) return null;
    const r = check(await sb.from('ab_tokens').select('id, revoked_at, member:ab_members(user_id, email, person, name, role)')
      .eq('token_hash', hashToken(token)).maybeSingle());
    if (!r || r.revoked_at || !r.member) return null;
    await sb.from('ab_tokens').update({ last_used_at: now() }).eq('id', r.id);
    return memberOut(r.member);
  }
  // the page's Supabase session, sent along when it calls the server
  async function memberForJwt(jwt) {
    if (typeof jwt !== 'string' || jwt.split('.').length !== 3) return null;
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data?.user) return null;
    return memberByUid(data.user.id);
  }
  const memberByUid = async (uid) => memberOut(check(await sb.from('ab_members').select('*').eq('user_id', uid).maybeSingle()));
  const memberByPerson = async (person) => memberOut(check(await sb.from('ab_members').select('*').eq('person', person).maybeSingle()));
  async function listMembers() {
    const rows = check(await sb.from('ab_members').select('*, ab_tokens(revoked_at, last_used_at)').order('created_at'));
    return rows.map((r) => {
      const live = r.ab_tokens.filter((t) => !t.revoked_at);
      return { ...memberOut(r), tokens: live.length, lastUsed: live.map((t) => t.last_used_at).filter(Boolean).sort().pop() || null };
    });
  }
  // Supabase Auth keys accounts by email; nothing is ever sent to it, so a member without one gets a placeholder
  async function addMember({ person, name, email, role = 'member' }) {
    if (!PERSON_ID.test(person || '')) throw new BoardError('invalid_argument', 'person id must be short lowercase letters, digits, - or _');
    if (!ROLES.includes(role)) throw new BoardError('invalid_argument', 'access must be admin, member or viewer');
    email = email || `${person}@members.artiboard.local`;
    const { user } = check(await sb.auth.admin.createUser({ email, email_confirm: true }));
    const { error } = await sb.from('ab_members').insert({ user_id: user.id, email, person, name: name || null, role });
    if (error) { await sb.auth.admin.deleteUser(user.id); throw toBoardError(error); }
    return { uid: user.id, person, name: name || null, email, role };
  }
  async function setRole(uid, role) {
    if (!ROLES.includes(role)) throw new BoardError('invalid_argument', 'access must be admin, member or viewer');
    check(await sb.from('ab_members').update({ role }).eq('user_id', uid));
  }
  async function removeMember(uid) { check(await sb.auth.admin.deleteUser(uid)); }
  async function issueToken(uid, label = 'agent') {
    const token = newToken();
    check(await sb.from('ab_tokens').insert({ user_id: uid, label, token_hash: hashToken(token) }));
    return token;
  }
  // revoking signs the member out everywhere: Auth sessions (and with them refresh tokens) go too
  async function revokeTokens(uid) {
    await rpc('ab_end_sessions', { p_user: uid });
    return check(await sb.from('ab_tokens').update({ revoked_at: now() }).eq('user_id', uid).is('revoked_at', null).select('id')).length;
  }
  // a one-time sign-in link for the board page; nothing is emailed
  async function loginLink(member) {
    const data = check(await sb.auth.admin.generateLink({ type: 'magiclink', email: member.email, options: { redirectTo: boardUrl + '/' } }));
    return data.properties.action_link;
  }

  return {
    kind: 'supabase', browser: { supabaseUrl: url, supabaseKey: publishableKey }, get, query, apply, overview, projectIds,
    createProject, dropProject, getPage, setPage, resetPage, memberForToken, memberForJwt, memberByPerson, listMembers,
    addMember, setRole, removeMember, issueToken, revokeTokens, loginLink, close() {},
  };
}
