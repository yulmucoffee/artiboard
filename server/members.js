// Members of a site: their seat on each board (meta/config.people, pinned to their account), how a new one
// joins (an account, seats, one token) and what they may change about themselves. The CLI and the site's
// member API share this, so an admin at a terminal and an admin on the projects page do the same thing.
import { BoardError, now, toBoardError } from './core.js';

// Put a person on a project's board or take them off. An existing entry keeps its name and role unless new ones are given.
export async function setPerson(store, project, m, entry) {
  // a board may be saved on its page between the read and the write: read again once
  for (let attempt = 0; ; attempt++) {
    const cfg = await store.get(project, 'meta/config');
    const people = Array.isArray(cfg?.data.people) ? cfg.data.people : [];
    const old = people.find((p) => p && p.id === m.person);
    const next = people.filter((p) => !p || p.id !== m.person);
    if (entry) next.push({ ...old, ...entry });
    try {
      return await store.apply(null, project, [
        cfg ? { op: 'update', path: 'meta/config', data: { people: next }, if_version: cfg.version } : { op: 'set', path: 'meta/config', data: { people: next } },
        entry ? { op: 'set', path: `people/${m.person}`, data: { uid: m.uid, at: now() } } : { op: 'delete', path: `people/${m.person}` },
      ]);
    } catch (e) { if (attempt || toBoardError(e).code !== 'version_conflict') throw e; }
  }
}
export const entryFor = (m, name) => ({ id: m.person, uid: m.uid, ...(name && { name }) });

// A new member: the account, a seat on every board (or the ones named; viewers sit on none) and one token, shown once.
export async function addMember(store, { person, name, email, role = 'member', projects }) {
  const member = await store.addMember({ person, name, email, role });
  const on = role === 'viewer' ? [] : (projects ?? await store.projectIds());
  for (const p of on) await setPerson(store, p, member, entryFor(member, member.name));
  const token = await store.issueToken(member.uid, 'agent');
  return { member, projects: on, token };
}

// Take a member off every board they sit on, then delete the account; their tasks and messages stay.
export async function removeMember(store, m) {
  for (const p of await store.projectIds()) {
    const c = await store.get(p, 'meta/config');
    if (c?.data.people?.some((x) => x && x.id === m.person)) await setPerson(store, p, m, null);
  }
  await store.removeMember(m.uid);
}

// How an agent connects with a token: the lines the CLI prints and the projects page shows
export function connectLines(boardUrl, token) {
  const url = `${boardUrl}/mcp`;
  return {
    claude: `claude mcp add --scope user --transport http artiboard ${url} --header "Authorization: Bearer ${token}"`,
    codex: [`export ARTIBOARD_TOKEN=${token}`, `codex mcp add artiboard --url ${url} --bearer-token-env-var ARTIBOARD_TOKEN`],
  };
}

const text = (v, max) => {
  if (v == null) return null;
  if (typeof v !== 'string') throw new BoardError('invalid_argument', 'profile fields are text');
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};

// What a member changes about themselves: the display name on the site and, on every board they sit on, their
// name and what they do (meta/config.people[].name and .role). The person id and the access level are the admin's.
export async function setProfile(store, member, { name, title }) {
  name = text(name, 60);
  title = text(title, 80);
  await store.setMemberName(member.uid, name);
  let seated = false;
  for (const p of await store.projectIds()) {
    // a board may be written between the read and the write: read again once
    for (let attempt = 0; attempt < 2; attempt++) {
      const cfg = await store.get(p, 'meta/config');
      const people = Array.isArray(cfg?.data.people) ? cfg.data.people : [];
      const i = people.findIndex((x) => x && x.id === member.person);
      if (i < 0) break;
      const next = people.slice();
      const { name: _n, role: _r, ...rest } = next[i];
      next[i] = { ...rest, ...(name && { name }), ...(title && { role: title }) };
      try { await store.apply(null, p, [{ op: 'update', path: 'meta/config', data: { people: next }, if_version: cfg.version }]); seated = true; break; }
      catch (e) { if (attempt || toBoardError(e).code !== 'version_conflict') throw e; }
    }
  }
  // the role lives on the boards: a member who sits on none has nowhere to keep one
  return { name, title: seated ? title : null };
}

// what a member says they do, from the first board that has it
export async function titleOf(store, member) {
  for (const p of await store.projectIds()) {
    const cfg = await store.get(p, 'meta/config');
    const me = (Array.isArray(cfg?.data.people) ? cfg.data.people : []).find((x) => x && x.id === member.person);
    if (typeof me?.role === 'string' && me.role.trim()) return me.role.trim();
  }
  return null;
}
