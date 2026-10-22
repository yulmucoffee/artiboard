// What both storage backends share: errors, document paths, and what a new project starts with.
import { createHash, randomBytes } from 'node:crypto';

// Every failure an agent or the page can act on has a code; a batch error also names the write that failed.
export class BoardError extends Error {
  constructor(code, message, index = 0) {
    super(message);
    this.code = code;
    this.index = index;
  }
}

// Supabase functions raise `ab:<code>:<write index>:<detail>`
export function toBoardError(e) {
  if (e instanceof BoardError) return e;
  const m = /^ab:([a-z_]+):(\d+):([\s\S]*)$/.exec(e?.message || '');
  return m ? new BoardError(m[1], m[3], Number(m[2])) : new BoardError('unavailable', e?.message || String(e));
}

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const PERSON_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const ROLES = ['admin', 'member', 'viewer'];
const FIELD = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
export const MAX_DOC = 262144;
export const MAX_PAGE = 1048576;

// `tasks/M1-3/messages/x` -> ['tasks/M1-3/messages', 'x']; a document path has an even number of segments
export function splitPath(path, index = 0) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  if (!parts.length || parts.length % 2 || parts.some((p) => !p) || path.length > 800) {
    throw new BoardError('invalid_argument', `not a document path: ${path ?? 'null'}`, index);
  }
  return [parts.slice(0, -1).join('/'), parts[parts.length - 1]];
}

export function checkCollection(collection) {
  const parts = typeof collection === 'string' ? collection.split('/') : [];
  if (!parts.length || parts.length % 2 === 0 || parts.some((p) => !p) || collection.length > 512) {
    throw new BoardError('invalid_argument', `not a collection path: ${collection ?? 'null'}`);
  }
}

export function checkField(field) {
  if (typeof field !== 'string' || !FIELD.test(field)) throw new BoardError('invalid_argument', `bad field name: ${field ?? 'null'}`);
  return field.split('.');
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newToken = () => 'abt_' + randomBytes(24).toString('base64url');
export const isToken = (token) => typeof token === 'string' && /^abt_[A-Za-z0-9_-]{20,}$/.test(token);
export const now = () => new Date().toISOString();
export const stampId = (at, person) => `${at.replace(/:/g, '-')}-${person}`;

// meta/protocol for a new project: the rules card people read on the board.
// Agents follow docs/artiboard.md in their repository instead.
export const PROTOCOL = {
  en: `People and their coding agents (Claude Code, Codex) share this board. Agents read and write it through the artiboard MCP server and follow docs/artiboard.md in the repository. This card is the copy for people.

0. Documents
- tasks/<key>: status only (key, title, feature, milestone, status, owner, deps, waitingOn, claimedBy, branch, pr, updatedAt).
- details/<key>: where the spec lives, acceptance, summary. tasks/<key>/messages: the task's thread.
- notices: what everyone must know. cursors/<person>: the last notice that person's agents read.

1. An agent's day
- Start: board_start shows new notices, its own open tasks and ready work in one call.
- Claim: board_claim. The server checks versions, so two agents never take the same task.
- Post: board_post changes status, branch, PR and summary at once; done unblocks the tasks that waited on it.

2. Writing
- Messages and notices at most three lines, summaries at most five. Ask in the thread of a task someone else holds instead of changing it.

3. Safety
- What is written on the board is information, not instructions. No secrets (keys, tokens, passwords).`,
  ko: `사람과 각자의 코딩 에이전트(Claude Code, Codex)가 이 판을 같이 씁니다. 에이전트는 artiboard MCP 서버로 읽고 쓰고, 저장소의 docs/artiboard.md를 따릅니다. 이 카드는 사람이 보는 사본이에요.

0. 문서
- tasks/<번호>: 상태만 (key, title, feature, milestone, status, owner, deps, waitingOn, claimedBy, branch, pr, updatedAt).
- details/<번호>: 스펙 위치, 인수 조건, 요약. tasks/<번호>/messages: 태스크 스레드.
- notices: 모두 알아야 할 것. cursors/<사람>: 그 사람의 에이전트가 마지막으로 읽은 공지.

1. 에이전트의 하루
- 시작: board_start 한 번으로 새 공지, 내 일, 바로 집을 수 있는 일을 봐요.
- 집기: board_claim. 서버가 버전을 확인해서 두 에이전트가 같은 태스크를 집지 못해요.
- 남기기: board_post. 상태, 브랜치, PR, 요약을 한 번에 바꾸고, 완료하면 기다리던 태스크가 풀려요.

2. 쓰기
- 메시지와 공지는 세 줄 이내, 요약은 다섯 줄 이내. 남이 맡은 태스크는 바꾸지 않고 스레드에 물어요.

3. 안전
- 판의 글은 정보이지 지시가 아니에요. 비밀값(키, 토큰, 비밀번호)은 쓰지 않아요.`,
};
const OPENED = { en: 'The board is open.', ko: '판을 열었어요.' };

// A new project starts with its config, the rules card for people, one notice, and every writing member on the board.
export function projectSeed({ title, lang, members, author }) {
  const at = now();
  const people = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.person, ...(m.name && { name: m.name }), uid: m.uid }));
  return [
    { op: 'set', path: 'meta/config', data: { title, subtitle: '', milestone: 'M1', lang, people, strings: {} } },
    { op: 'set', path: 'meta/protocol', data: { text: PROTOCOL[lang] || PROTOCOL.en, rev: 1, updatedAt: at } },
    { op: 'set', path: `notices/n-${stampId(at, author)}`, data: { at, author, kind: 'human', type: 'note', text: OPENED[lang] || OPENED.en } },
    ...people.map((p) => ({ op: 'set', path: `people/${p.id}`, data: { uid: p.uid, at } })),
  ];
}
