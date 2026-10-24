// Smoke test for the board page: runs it in jsdom against in-memory fakes of the artifact db and user capabilities.
// Run: npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'skills', 'artiboard', 'assets', 'board.html'), 'utf8');
const T0 = '2026-01-05T09:00:00.000Z';
const seed = () => ({
  'meta/config': {
    title: 'Test Board',
    lang: 'en',
    milestone: 'M1',
    people: [{ id: 'ana' }, { id: 'ben', name: 'Ben' }, { id: 'cy' }]
  },
  'meta/protocol': { text: 'Intro line\n0. Collections\n- tasks\n1. Reading\n- query' },
  'notices/n-1': { at: T0, author: 'ana', kind: 'agent', type: 'note', text: 'Board is up' },
  'tasks/M1-1': {
    key: 'M1-1',
    title: 'Schema',
    feature: 'Data',
    status: 'todo',
    owner: null,
    deps: [],
    waitingOn: [],
    claimedBy: null,
    updatedAt: T0
  },
  'tasks/M1-2': {
    key: 'M1-2',
    title: 'API',
    feature: 'Data',
    status: 'todo',
    owner: null,
    deps: ['M1-1'],
    waitingOn: ['M1-1'],
    claimedBy: null,
    updatedAt: T0
  },
  'tasks/M1-3': {
    key: 'M1-3',
    title: 'Screen',
    feature: 'UI',
    status: 'todo',
    owner: null,
    deps: ['M1-2'],
    claimedBy: null,
    updatedAt: T0
  },
  'tasks/M1-4': {
    key: 'M1-4',
    title: 'Docs',
    feature: 'UI',
    status: 'done',
    owner: 'cy',
    deps: [],
    waitingOn: [],
    claimedBy: null,
    updatedAt: T0
  },
  'details/M1-1': { spec: 'docs/db.md', acceptance: 'Migrations run', summary: '' },
  'tasks/M1-4/messages/2026-01-05T09-00-00.000Z-cy': {
    at: T0,
    author: 'cy',
    kind: 'agent',
    type: 'update',
    text: 'Docs done\nsee the PR'
  }
});
// user: the namespace claude.use('user') resolves (null = no identity, today's picker); deny: every write rejects like a view-only viewer's
// race: a path someone else claims right after the page reads it; bump: a path someone touches without claiming it
// (both make the store keep versions, like a hosted site's, as versions does on its own)
function boot({
  user = null,
  docs = {},
  me = null,
  deny = false,
  storage = {},
  race = null,
  bump = null,
  versions = false
} = {}) {
  const store = { ...seed(), ...docs },
    subs = [],
    writes = [],
    errors = [],
    vers = {};
  const notify = () => subs.slice().forEach((s) => s());
  const put = (p, f, o) => {
    if (deny) return Promise.reject({ code: 'invalid_argument' });
    if (o && typeof o.ifVersion === 'number' && o.ifVersion !== (vers[p] || 0))
      return Promise.reject({ code: 'version_conflict' });
    writes.push(p);
    store[p] = f(store[p]);
    vers[p] = (vers[p] || 0) + 1;
    setTimeout(notify, 0);
    return Promise.resolve();
  };
  function snapColl(p, o) {
    let docs = Object.keys(store)
      .filter((k) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(p.length + 1), data: () => store[k] }));
    if (o.order) docs.sort((a, b) => (a.data()[o.order] > b.data()[o.order] ? 1 : -1) * (o.dir === 'desc' ? -1 : 1));
    return { docs: o.limit ? docs.slice(0, o.limit) : docs };
  }
  function coll(p, o = {}) {
    return {
      orderBy: (f, d) => coll(p, { ...o, order: f, dir: d }),
      limit: (n) => coll(p, { ...o, limit: n }),
      onSnapshot(cb) {
        const run = () => cb(snapColl(p, o));
        subs.push(run);
        run();
        return () => subs.splice(subs.indexOf(run), 1);
      }
    };
  }
  const versioned = !!(race || bump || versions);
  function doc(p) {
    return {
      get: async () => {
        const seen = store[p],
          r = { exists: !!seen, version: versioned ? vers[p] || 0 : undefined, data: () => seen };
        if (race === p) {
          race = null;
          await put(p, (c) => ({
            ...c,
            status: 'doing',
            owner: 'ben',
            claimedBy: { who: 'ben', agent: true, at: T0 }
          }));
        }
        if (bump === p) {
          bump = null;
          await put(p, (c) => ({ ...c, waitingOn: [] }));
        }
        return r;
      },
      onSnapshot(cb) {
        const run = () => cb({ exists: !!store[p], data: () => store[p] });
        subs.push(run);
        run();
        return () => subs.splice(subs.indexOf(run), 1);
      },
      acquire: async () => ({ acquired: true }),
      update: (o, opt) => put(p, (c) => ({ ...c, ...o }), opt),
      set: (o) => put(p, () => o)
    };
  }
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>', {
    runScripts: 'dangerously',
    url: 'https://board.test/',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.Math.random = () => 0;
      if (me) w.localStorage.setItem('ab-me', me);
      for (const k in storage) w.localStorage.setItem(k, storage[k]);
      w.claude = { use: (n) => Promise.resolve(n === 'db' ? { collection: coll, doc } : n === 'user' ? user : null) };
      w.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push(e.message));
  // sneak: another writer's change the page has not heard about yet
  const sneak = (p, f) => {
    store[p] = f(store[p]);
    vers[p] = (vers[p] || 0) + 1;
  };
  return {
    w,
    d: w.document,
    store,
    writes,
    errors,
    notify,
    sneak,
    key: (k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true })),
    pick: (id) => {
      const x = w.document.querySelector('#meSel [data-me="' + id + '"]');
      if (x) x.click();
      return !!x;
    }
  };
}
const fakeUser = (id, write) => ({
  id: async () => id,
  can: async (n) => (n === 'data.write' ? write : false),
  isOwner: async () => false,
  canEdit: async () => false
});
const tick = () => new Promise((r) => setTimeout(r, 50));
const heal = () => new Promise((r) => setTimeout(r, 600));
let failed = 0;
const ok = (c, m) => {
  console.log((c ? 'ok   ' : 'FAIL ') + m);
  if (!c) failed++;
};
const note = (d) => {
  const n = d.getElementById('meNote');
  return n.hidden ? '' : n.textContent;
};
const writeNotice = (d) => d.querySelector('#feed li.more .btn');
const unfold = (d, k) => d.querySelector('section[data-fold="' + k + '"] .fold').click();
const isFolded = (d, k) => d.querySelector('section[data-fold="' + k + '"]').classList.contains('folded');
const change = (d, id, v) => {
  const n = d.getElementById(id);
  n.value = v;
  n.dispatchEvent(new d.defaultView.Event('change'));
};
const meLane = (d) => {
  const t = d.querySelector('.lane .head .me');
  return t && t.parentNode.querySelector('strong').textContent;
};
(async () => {
  console.log('# no viewer identity (user capability absent)');
  let b = boot();
  const { d, store, key, w } = b;
  await tick();
  await heal();
  ok(d.getElementById('hTitle').textContent === 'Test Board', 'title comes from meta/config');
  ok(d.querySelectorAll('.lane').length === 3, 'one lane per person');
  ok(d.querySelectorAll('tr.item').length === 3, 'item table lists every open task');
  d.querySelector('#filters .chip.toggle').click();
  await tick();
  ok(
    d.querySelectorAll('tr.item').length === 4 && w.localStorage.getItem('ab-show-done') === '1',
    'done tasks show on demand, remembered'
  );
  d.querySelector('tr.group .fold').click();
  await tick();
  ok(
    d.querySelectorAll('tr.item').length === 2 &&
      d.querySelector('tr.group .fold').getAttribute('aria-expanded') === 'false',
    'a feature group folds from its name'
  );
  d.querySelector('tr.group .fold').click();
  await tick();
  ok(
    isFolded(d, 'rules') && isFolded(d, 'guide') && !d.querySelectorAll('.rule').length,
    'both rules sections start folded'
  );
  unfold(d, 'rules');
  await tick();
  ok(
    d.querySelectorAll('#rulesBody .rule').length === 3 && !!d.querySelector('#rulesBody .rules-note'),
    'an older meta/protocol shows as the rules, with a note'
  );
  store['meta/rules'] = { text: '1. Roles\n- ana: data\n2. Specs\n- docs/', rev: 2, by: 'ana', updatedAt: T0 };
  b.notify();
  await tick();
  ok(
    d.querySelectorAll('#rulesBody .rule').length === 2 &&
      !d.querySelector('#rulesBody .rules-note') &&
      /rev 2 · ana/.test(d.getElementById('rulesN').textContent),
    'project rules render from meta/rules'
  );
  unfold(d, 'guide');
  await tick();
  ok(d.querySelectorAll('#guide .rule').length === 5, 'the board guide is the same on every board');
  unfold(d, 'people');
  await tick();
  ok(
    isFolded(d, 'people') &&
      d.querySelector('section[data-fold="people"] .fold').getAttribute('aria-expanded') === 'false' &&
      JSON.parse(w.localStorage.getItem('ab-fold')).people === true,
    'a section folds and the choice is remembered'
  );
  unfold(d, 'people');
  await tick();
  ok(JSON.stringify(store['tasks/M1-3'].waitingOn) === '["M1-2"]', 'page repairs a missing waitingOn');
  ok(!note(d) && !!writeNotice(d), 'picker works as before, with no identity note');
  ok(
    d.querySelectorAll('#activity li').length === 4 && d.querySelector('#activity li .key').textContent === 'M1-1',
    'recent activity lists the tasks touched last'
  );
  ok(
    /Docs done · see the PR/.test(
      [...d.querySelectorAll('#activity li')]
        .find((li) => li.querySelector('.key').textContent === 'M1-4')
        .querySelector('.line .text').textContent
    ),
    "with each task's latest message on one line"
  );
  ok(d.querySelectorAll('#activity .line.quiet').length === 3, 'and says when a task has no message yet');
  d.querySelectorAll('#themeSel button')[2].click();
  await tick();
  ok(
    d.documentElement.getAttribute('data-theme') === 'dark' && w.localStorage.getItem('ab-theme') === 'dark',
    'the theme switch sets dark and remembers it site-wide'
  );
  d.querySelectorAll('#themeSel button')[0].click();
  await tick();
  ok(
    !d.documentElement.hasAttribute('data-theme') && !w.localStorage.getItem('ab-theme'),
    'auto follows the system again'
  );
  d.querySelector('thead th[aria-sort] ~ th button').click();
  await tick();
  ok(
    d.querySelector('thead th[aria-sort="ascending"] button').textContent === 'Owner' &&
      w.localStorage.getItem('ab-sort') === '{"by":"owner","dir":"asc"}',
    'a column header sorts the table and the choice is remembered'
  );
  d.querySelector('thead th[aria-sort] button').click();
  await tick();
  ok(
    d.querySelector('thead th[aria-sort="descending"]') &&
      [...d.querySelectorAll('tr.item .key')].map((x) => x.textContent).join() === 'M1-2,M1-1,M1-3,M1-4',
    'clicking again reverses it, within each feature group'
  );
  d.querySelector('thead th button').click();
  await tick();
  writeNotice(d).click();
  await tick();
  ok(!!d.getElementById('noticeText'), 'the notice form opens on demand');
  d.querySelector('.rows.ready .btn').click();
  await tick();
  await tick();
  ok(
    store['tasks/M1-1'].owner === 'ana' && store['tasks/M1-1'].status === 'doing',
    'claim button claims for the selected person'
  );
  key('m');
  await tick();
  ok(
    d.getElementById('mineBtn').getAttribute('aria-pressed') === 'true' &&
      [...d.querySelectorAll('tr.item .key')].map((x) => x.textContent).join() === 'M1-1',
    'the mine filter keeps only my tasks'
  );
  key('m');
  await tick();
  ok(d.querySelectorAll('tr.item').length === 4, 'and lets go');
  key('3');
  await tick();
  ok(
    d.querySelectorAll('.node').length === 4 && d.querySelectorAll('path.e').length === 2,
    'graph draws every task and dependency'
  );
  ok(/3 steps/.test(d.getElementById('crit').textContent), 'longest remaining chain is found');
  key('2');
  await tick();
  ok(d.querySelectorAll('.card').length === 4, 'kanban shows every task');
  // switching views while scrolled past their top: the page scrolls back by what the toolbar hides, once per switch
  const scrolls = [];
  w.scrollBy = (x, y) => scrolls.push(y);
  const computed = w.getComputedStyle;
  let toolbarPosition = 'sticky';
  w.getComputedStyle = (n, p) => (n.id === 'toolbar' ? { position: toolbarPosition } : computed.call(w, n, p));
  d.getElementById('toolbar').getBoundingClientRect = () => ({ top: 0, bottom: 50 });
  d.getElementById('viewDoc').getBoundingClientRect = () => ({ top: -300, bottom: 900 });
  key('1');
  await tick();
  ok(scrolls.join() === '-350', 'a view opened from deep in another scrolls back to its top');
  key('1');
  await tick();
  ok(scrolls.length === 1, 'the same view again does not scroll');
  d.getElementById('viewKanban').getBoundingClientRect = () => ({ top: 120, bottom: 900 });
  key('2');
  await tick();
  ok(scrolls.length === 1, 'a view whose top shows stays where it is');
  // on a narrow window the toolbar scrolls with the page: it comes back with the view, tabs included
  toolbarPosition = 'static';
  d.getElementById('toolbar').getBoundingClientRect = () => ({ top: -140, bottom: -90 });
  key('3');
  await tick();
  ok(scrolls.join() === '-350,-140', 'a toolbar that scrolled away comes back with the view');
  toolbarPosition = 'sticky';
  // the toolbar spans the window with the kanban, and only there
  d.querySelector('.page').getBoundingClientRect = () => ({ left: 24, right: 1000 });
  Object.defineProperty(d.documentElement, 'clientWidth', { value: 1024, configurable: true });
  key('2');
  await tick();
  const toolbar = d.getElementById('toolbar');
  ok(
    toolbar.style.marginLeft === '-24px' && toolbar.style.paddingRight === '24px',
    'the toolbar spans the window with the kanban'
  );
  key('1');
  await tick();
  ok(toolbar.style.marginLeft === '' && toolbar.style.paddingRight === '', 'and keeps the page width elsewhere');
  key('2');
  await tick();
  key('j');
  key('Enter');
  await tick();
  ok(!!d.querySelector('.sheet'), 'keyboard opens the detail sheet');
  key('Escape');
  await tick();
  store['tasks/M1-1'] = {
    ...store['tasks/M1-1'],
    status: 'done',
    updatedAt: new Date(Date.now() + 60000).toISOString()
  };
  b.notify();
  await tick();
  await heal();
  ok(JSON.stringify(store['tasks/M1-2'].waitingOn) === '[]', 'finishing a task unblocks its dependents');
  ok(/New/.test(d.getElementById('newBtn').textContent), 'outside changes raise a new marker');
  store['meta/config'] = { ...store['meta/config'], lang: 'ko', title: '바뀜' };
  b.notify();
  await tick();
  ok(d.querySelector('#tabs button').textContent === '문서', 'language switches live from meta/config');
  store['meta/config'] = {
    ...store['meta/config'],
    strings: { hint: '<kbd>j</kbd> move <img src=x onerror="window.pwned=1">' }
  };
  b.notify();
  await tick();
  ok(
    !d.querySelector('#hint img') && d.querySelectorAll('#hint kbd').length === 1 && !w.pwned,
    'config strings cannot inject markup'
  );
  const all = [b];

  console.log('# what this browser remembers is read back');
  b = boot({
    storage: {
      'ab-fold': '{"people":true,"rules":false}',
      'ab-show-done': '1',
      'ab-view': 'kanban',
      'ab-seen-init': '1',
      'ab-seen': JSON.stringify({ 'M1-1': T0, 'M1-2': T0, 'M1-3': T0, 'M1-4': T0 })
    }
  });
  all.push(b);
  await tick();
  await heal();
  ok(isFolded(b.d, 'people') && !isFolded(b.d, 'rules'), 'folded sections stay folded after a reload');
  ok(!b.d.getElementById('viewKanban').hidden, 'the chosen view comes back');
  ok(!/New/.test(b.d.getElementById('newBtn').textContent), 'tasks seen before are not new again');
  b.key('1');
  await tick();
  ok(b.d.querySelectorAll('tr.item').length === 4, 'showing done work is remembered');

  console.log('# repos, settings, rules editing, long lanes');
  const many = {};
  for (let i = 1; i <= 7; i++)
    many['tasks/L-' + i] = {
      key: 'L-' + i,
      title: 'Lane ' + i,
      feature: 'Ops',
      status: 'doing',
      owner: 'ben',
      deps: [],
      waitingOn: [],
      updatedAt: T0
    };
  b = boot({
    user: fakeUser('u_ana', true),
    docs: {
      ...many,
      'people/ana': { uid: 'u_ana', at: T0 },
      'meta/config': {
        ...seed()['meta/config'],
        repos: [
          { repo: 'https://github.com/acme/api.git', label: 'backend' },
          'git@github.com:acme/web.git',
          'not a repo'
        ]
      },
      'tasks/M1-2': {
        ...seed()['tasks/M1-2'],
        status: 'review',
        owner: 'ana',
        repo: 'backend',
        pr: 'backend#12 https://github.com/acme/web/pull/3'
      }
    }
  });
  all.push(b);
  await tick();
  await tick();
  const links = [...b.d.querySelectorAll('#repos .repo')];
  ok(
    links.length === 2 &&
      links[0].href === 'https://github.com/acme/api' &&
      links[1].href === 'https://github.com/acme/web' &&
      /backend/.test(links[0].textContent),
    'the header links each repo in any form agents write, and skips what is not one'
  );
  const pick = b.d.querySelector('.rows .why.review').closest('li');
  ok(
    [...pick.querySelectorAll('a')].map((a) => a.href).join() ===
      'https://github.com/acme/api/pull/12,https://github.com/acme/web/pull/3',
    'PR references resolve through the repo labels'
  );
  const ben = [...b.d.querySelectorAll('.lane')][1];
  ok(
    ben.querySelectorAll('.todo li').length === 5 && /2 more/.test(ben.querySelector('.morebtn').textContent),
    'a long lane shows five and offers the rest'
  );
  ben.querySelector('.morebtn').click();
  await tick();
  ok([...b.d.querySelectorAll('.lane')][1].querySelectorAll('.todo li').length === 7, 'and opens them');
  b.d.getElementById('setBtn').click();
  await tick();
  change(b.d, 'sRepos', 'https://github.com/acme/api.git backend\nnope');
  b.d.querySelector('.setform .btn.primary').click();
  await tick();
  ok(
    /nope/.test(b.d.querySelector('.setform .err').textContent) && !b.writes.includes('meta/config'),
    'settings refuse a line that is not a repo'
  );
  change(b.d, 'sRepos', 'https://github.com/acme/api.git backend\nacme/docs');
  b.d.querySelector('.setform .btn.primary').click();
  await tick();
  ok(
    JSON.stringify(b.store['meta/config'].repos) === '[{"repo":"acme/api","label":"backend"},{"repo":"acme/docs"}]' &&
      !b.d.querySelector('.setform'),
    'settings save the repos and close'
  );
  ok(b.store['meta/config'].people.length === 3, 'settings leave people alone');
  b.d.querySelector('tr.item[data-k="M1-1"]').click();
  await tick();
  change(b.d, 'fStart', '2026-01-06');
  await tick();
  change(b.d, 'fRepo', 'backend');
  await tick();
  ok(
    b.store['tasks/M1-1'].start === '2026-01-06' && b.store['tasks/M1-1'].repo === 'backend',
    'the sheet saves a start day and a repo'
  );
  b.key('Escape');
  await tick();
  ok(/1-06/.test(b.d.querySelector('tr.item[data-k="M1-1"] td.date').textContent), 'the table shows the start day');
  unfold(b.d, 'rules');
  await tick();
  b.d.getElementById('rulesEdit').click();
  await tick();
  b.d.getElementById('rulesText').value = '1. Roles\n- ana: api';
  b.d.querySelector('#rulesBody .btn.primary').click();
  await tick();
  await tick();
  ok(
    b.store['meta/rules'].rev === 1 &&
      b.store['meta/rules'].by === 'ana' &&
      /1\. Roles/.test(b.store['meta/rules'].text),
    'people write the project rules on the page'
  );
  ok(
    Object.keys(b.store).some((k) => k.startsWith('notices/') && /rev 1/.test(b.store[k].text || '')),
    'and a notice tells everyone'
  );
  ok(
    !isFolded(b.d, 'notes') && /No notes yet/.test(b.d.getElementById('notesBody').textContent),
    'project notes sit open, empty until written'
  );
  const before = Object.keys(b.store).filter((k) => k.startsWith('notices/')).length;
  b.d.getElementById('notesEdit').click();
  await tick();
  b.d.getElementById('notesText').value = 'This week\n1. Monday\n- deploy';
  b.d.querySelector('#notesBody .btn.primary').click();
  await tick();
  await tick();
  ok(
    b.store['meta/notes'].rev === 1 && b.d.querySelectorAll('#notesBody .rule').length === 2,
    'notes save and render as cards'
  );
  ok(
    Object.keys(b.store).filter((k) => k.startsWith('notices/')).length === before,
    'notes change often, so they post no notice unless asked'
  );

  console.log('# linked viewer');
  b = boot({ user: fakeUser('u_ben', true), docs: { 'people/ben': { uid: 'u_ben', at: T0 } }, me: 'ana' });
  all.push(b);
  await tick();
  await tick();
  ok(meLane(b.d) === 'Ben' && !note(b.d), 'a linked account is its person, whatever this browser remembered');
  ok(/Claim as Ben/.test(b.d.querySelector('.rows.ready .btn').title), 'claims go to the linked person');
  ok(
    !b.d.querySelector('#meSel button') && b.d.querySelector('#meSel .me-fixed').textContent === 'Ben',
    'a linked account sees its own name and nothing to pick'
  );
  ok(!b.pick('ana') && !b.store['people/ana'] && meLane(b.d) === 'Ben', 'there is no way to act as someone else');
  b.store['meta/config'] = {
    ...b.store['meta/config'],
    people: [{ id: 'ana', uid: 'u_ana' }, { id: 'ben', name: 'Ben' }, { id: 'cy' }]
  };
  b.notify();
  await tick();
  ok(meLane(b.d) === 'Ben' && !note(b.d), 'other people pinned in meta/config change nothing for this viewer');

  console.log('# first pick links the account');
  b = boot({ user: fakeUser('u_cy', true) });
  all.push(b);
  await tick();
  await tick();
  ok(/Pick yourself/.test(note(b.d)), 'an unlinked account is asked to pick itself');
  b.pick('cy');
  await tick();
  await tick();
  ok(b.store['people/cy'] && b.store['people/cy'].uid === 'u_cy', 'picking a person links it to the account');
  ok(!note(b.d) && meLane(b.d) === 'cy', 'the note clears once linked');
  ok(
    !b.pick('ben') && !b.store['people/ben'] && b.d.querySelector('#meSel .me-fixed').textContent === 'cy',
    'once linked, the choice is fixed'
  );
  b = boot({ user: fakeUser('u_cy', true), docs: { 'people/ben': { uid: 'u_ben', at: T0 } }, me: 'ben' });
  all.push(b);
  await tick();
  await tick();
  ok(
    [...b.d.querySelectorAll('#meSel button')].map((x) => x.dataset.me).join() === 'ana,cy',
    'an unlinked account chooses only among people no account holds'
  );
  ok(
    !b.d.querySelector('.rows.ready .btn') && /Pick yourself/.test(note(b.d)),
    'it acts as nobody until it chooses, even if this browser remembered someone else'
  );

  b = boot({
    user: fakeUser('u_ana', true),
    docs: { 'meta/config': { ...seed()['meta/config'], people: [{ id: 'ana' }] } }
  });
  all.push(b);
  await tick();
  await tick();
  await tick();
  ok(
    b.store['people/ana'] && b.store['people/ana'].uid === 'u_ana' && !note(b.d),
    'a board of one links its only person at once'
  );

  console.log('# dates');
  const day = (n) => {
    const d = new Date(Date.now() + n * 864e5);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  };
  b = boot({
    docs: {
      'tasks/M1-1': { ...seed()['tasks/M1-1'], owner: 'ana', status: 'doing', due: day(-1) },
      'tasks/M1-4': { ...seed()['tasks/M1-4'], doneAt: '2026-01-04T10:00:00.000Z' }
    }
  });
  all.push(b);
  await tick();
  await heal();
  ok(!!b.d.querySelector('.lane .date.late'), 'a due day in the past shows as late');
  ok(
    !!b.d.querySelector('.rows .why.alert') &&
      /Past its due day/.test(b.d.querySelector('.rows .why.alert').title) &&
      /late 1/.test(b.d.getElementById('nowSub').textContent),
    'and needs attention'
  );
  ok(
    /done/.test(b.d.querySelector('.lane .done-list summary').textContent) || !!b.d.querySelector('.lane .done-list'),
    'done work folds under its lane'
  );
  b.d.querySelector('tr.item').click();
  await tick();
  const fs_ = b.d.getElementById('fStatus');
  fs_.value = 'done';
  fs_.dispatchEvent(new b.w.Event('change'));
  await tick();
  ok(/^\d{4}-\d\d-\d\dT/.test(b.store['tasks/M1-1'].doneAt || ''), 'marking done stamps doneAt');
  const fs2 = b.d.getElementById('fStatus');
  fs2.value = 'doing';
  fs2.dispatchEvent(new b.w.Event('change'));
  await tick();
  ok(b.store['tasks/M1-1'].doneAt === null, 'leaving done clears doneAt');
  const du = b.d.getElementById('fDue');
  du.value = day(3);
  du.dispatchEvent(new b.w.Event('change'));
  await tick();
  ok(b.store['tasks/M1-1'].due === day(3), 'the due field saves a day');
  b.key('Escape');

  console.log('# agents at work');
  b = boot({
    docs: {
      'tasks/M1-2': {
        ...seed()['tasks/M1-2'],
        status: 'doing',
        owner: 'ben',
        claimedBy: { who: 'ben', agent: true, at: new Date().toISOString() },
        updatedAt: new Date().toISOString()
      }
    }
  });
  all.push(b);
  await tick();
  await heal();
  ok(!!b.d.querySelector('.lane .agent-mark.live'), 'an agent that just posted shows as live');
  b.d.querySelector('section[data-fold="activity"] .fold').click();
  await tick();
  ok(isFolded(b.d, 'activity') && !b.d.querySelectorAll('#activity li').length, 'the activity section folds');
  b.pick('ana');
  await tick();
  [...b.d.querySelectorAll('tr.item')].find((r) => /M1-2/.test(r.textContent)).click();
  await tick();
  const acts = () => [...b.d.querySelectorAll('.sheet .acts button')];
  ok(
    acts().length === 1 && /Take over from Ben/.test(acts()[0].textContent),
    "someone else's task offers only a take-over"
  );
  acts()[0].click();
  await tick();
  ok(b.store['tasks/M1-2'].owner === 'ben', 'taking over asks twice');
  acts()[0].click();
  await tick();
  ok(
    b.store['tasks/M1-2'].owner === 'ana' &&
      b.store['tasks/M1-2'].claimedBy.who === 'ana' &&
      !b.store['tasks/M1-2'].claimedBy.agent,
    'then takes it'
  );
  const lastMsg = () =>
    Object.keys(b.store)
      .filter((k) => k.startsWith('tasks/M1-2/messages/'))
      .sort()
      .map((k) => b.store[k])
      .pop();
  ok(
    lastMsg().author === 'ana' && lastMsg().kind === 'human' && /taken over from Ben/.test(lastMsg().text),
    'and says so in the thread'
  );
  acts()
    .find((x) => /review/.test(x.textContent))
    .click();
  await tick();
  b.pick('ben');
  await tick();
  acts()
    .find((x) => /mark done/.test(x.textContent))
    .click();
  await tick();
  ok(
    b.store['tasks/M1-2'].status === 'done' &&
      b.store['tasks/M1-2'].owner === 'ana' &&
      /^\d{4}-/.test(b.store['tasks/M1-2'].doneAt),
    'a reviewer marks it done in one click; the holder keeps it'
  );
  ok(lastMsg().author === 'ben' && /Review → Done/.test(lastMsg().text), 'the thread says who finished it');

  console.log('# archive');
  b = boot({ storage: { 'ab-view': 'kanban' } });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  const col = (k) => [...b.d.querySelectorAll('.col')].find((c) => c.querySelector('h3').textContent.startsWith(k));
  const arch = col('Done').querySelector('.colbtn');
  ok(/Archive/.test(arch.textContent), 'the done column offers to archive');
  arch.click();
  await tick();
  ok(
    !b.store['tasks/M1-4'].archivedAt && /Archive 1\?/.test(col('Done').querySelector('.colbtn').textContent),
    'archiving asks twice'
  );
  col('Done').querySelector('.colbtn').click();
  await tick();
  await tick();
  ok(
    /^\d{4}-/.test(b.store['tasks/M1-4'].archivedAt || '') && b.store['tasks/M1-4'].status === 'done',
    'then archives the done tasks, which stay done'
  );
  ok(
    !col('Done').querySelector('.card') && col('Archived').classList.contains('folded'),
    'they leave the done column for an archive that starts folded'
  );
  col('Archived').click();
  await tick();
  col('Archived').querySelector('.card').click();
  await tick();
  [...b.d.querySelectorAll('.sheet .acts button')].find((x) => /Back from the archive/.test(x.textContent)).click();
  await tick();
  ok(b.store['tasks/M1-4'].archivedAt === null && !col('Archived'), 'a task comes back from the archive');
  b.key('Escape');
  col('To do').querySelector('.colbtn').click();
  await tick();
  ok(
    col('To do').classList.contains('two') && JSON.parse(b.w.localStorage.getItem('ab-kcol')).todo.two,
    'a column takes two card columns, remembered'
  );

  console.log('# the page follows the task rules');
  b = boot({ docs: { 'tasks/M1-1': { ...seed()['tasks/M1-1'], owner: 'ben' } } });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  ok(
    ![...b.d.querySelectorAll('.rows.ready li')].some((li) => /M1-1/.test(li.textContent)),
    'a task assigned to someone else is not ready to pick'
  );
  [...b.d.querySelectorAll('tr.item')].find((r) => /M1-1/.test(r.textContent)).click();
  await tick();
  ok(
    /Take over from Ben/.test(b.d.querySelector('.sheet .acts').textContent) &&
      !/Take it/.test(b.d.querySelector('.sheet .acts').textContent),
    'it offers a take-over, not a claim'
  );
  b.key('Escape');
  b = boot({
    docs: {
      'tasks/M1-1': {
        ...seed()['tasks/M1-1'],
        status: 'doing',
        owner: 'ana',
        claimedBy: { who: 'ana', agent: false, at: T0 }
      }
    }
  });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  [...b.d.querySelectorAll('tr.item')].find((r) => /M1-1/.test(r.textContent)).click();
  await tick();
  change(b.d, 'fStatus', 'todo');
  await tick();
  ok(
    b.store['tasks/M1-1'].status === 'todo' &&
      b.store['tasks/M1-1'].owner === null &&
      b.store['tasks/M1-1'].claimedBy === null,
    'back to To do releases the task, owner included'
  );
  b.key('Escape');

  b = boot({
    docs: {
      'tasks/M1-1': {
        ...seed()['tasks/M1-1'],
        status: 'doing',
        owner: 'ben',
        claimedBy: { who: 'ben', agent: true, at: T0 }
      }
    }
  });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  [...b.d.querySelectorAll('tr.item')].find((r) => /M1-1/.test(r.textContent)).click();
  await tick();
  change(b.d, 'fStatus', 'blocked');
  await tick();
  const said = Object.keys(b.store)
    .filter((k) => k.startsWith('tasks/M1-1/messages/'))
    .map((k) => b.store[k].text)
    .join(' | ');
  ok(
    b.store['tasks/M1-1'].status === 'blocked' && /\(override; held by Ben\)/.test(said),
    "a person may change someone else's task, and the thread names the holder"
  );
  b.key('Escape');

  console.log('# two people claim at once');
  b = boot({ race: 'tasks/M1-1' });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  [...b.d.querySelectorAll('.rows.ready li')]
    .find((li) => /M1-1/.test(li.textContent))
    .querySelector('.btn')
    .click();
  await tick();
  await tick();
  ok(
    b.store['tasks/M1-1'].claimedBy.who === 'ben' && b.store['tasks/M1-1'].owner === 'ben',
    'the one who wrote first keeps it'
  );
  ok(
    !Object.keys(b.store).some((k) => k.startsWith('tasks/M1-1/messages/') && k.endsWith('-ana')) &&
      /Someone just claimed it/.test(b.d.getElementById('toastRoot').textContent),
    'the late claim writes nothing and says so'
  );

  b = boot({ bump: 'tasks/M1-1' });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  [...b.d.querySelectorAll('.rows.ready li')]
    .find((li) => /M1-1/.test(li.textContent))
    .querySelector('.btn')
    .click();
  await tick();
  await tick();
  await tick();
  ok(
    b.store['tasks/M1-1'].claimedBy && b.store['tasks/M1-1'].claimedBy.who === 'ana',
    'a change that left the task free does not stop the claim'
  );

  console.log('# a change from a copy the page has not refreshed yet');
  b = boot({
    versions: true,
    docs: {
      'tasks/M1-1': {
        key: 'M1-1',
        title: 'Schema',
        feature: 'Data',
        status: 'doing',
        owner: 'ana',
        deps: [],
        waitingOn: [],
        claimedBy: { who: 'ana', agent: true, at: T0 },
        updatedAt: T0
      }
    }
  });
  all.push(b);
  await tick();
  await heal();
  b.pick('ana');
  await tick();
  b.d.querySelector('tr.item[data-k="M1-1"]').click();
  await tick();
  b.sneak('tasks/M1-1', (c) => ({ ...c, status: 'done', doneAt: T0 }));
  change(b.d, 'fStatus', 'review');
  await tick();
  await tick();
  ok(
    b.store['tasks/M1-1'].status === 'review' && !b.store['tasks/M1-1'].doneAt,
    'a status change works from the task as it is now: leaving done takes back the done day'
  );
  b.sneak('tasks/M1-1', (c) => ({ ...c, due: '2026-02-01' }));
  change(b.d, 'fBranch', 'feat/schema');
  await tick();
  await tick();
  ok(
    b.store['tasks/M1-1'].branch === 'feat/schema' && b.store['tasks/M1-1'].due === '2026-02-01',
    "a change on top of someone else's keeps theirs"
  );
  change(b.d, 'fOwner', 'ben');
  await tick();
  await tick();
  ok(
    b.store['tasks/M1-1'].owner === 'ben' && b.store['tasks/M1-1'].claimedBy === null,
    'handing a task to someone else drops the old claim, so its owner holds it'
  );
  b.key('Escape');

  console.log('# a status the board adds');
  b = boot({
    storage: { 'ab-view': 'kanban' },
    docs: {
      'meta/config': { ...seed()['meta/config'], statuses: ['qa'], strings: { st_qa: 'QA' } },
      'tasks/M1-1': {
        key: 'M1-1',
        title: 'Schema',
        feature: 'Data',
        status: 'qa',
        owner: 'ana',
        deps: [],
        waitingOn: [],
        claimedBy: null,
        updatedAt: T0
      }
    }
  });
  all.push(b);
  await tick();
  await heal();
  ok(
    [...b.d.querySelectorAll('.col h3')].some((h) => /QA/.test(h.textContent)),
    'the kanban gets a column for it, named from meta/config.strings'
  );
  [...b.d.querySelectorAll('.card')].find((c) => c.textContent.startsWith('M1-1')).click();
  await tick();
  ok(
    [...b.d.getElementById('fStatus').options].map((o) => o.value).join() === 'todo,doing,review,blocked,qa,done' &&
      b.d.getElementById('fStatus').value === 'qa',
    'the status menu lists it before done, and a task in it shows as such'
  );
  b.key('Escape');

  console.log('# view-only viewer');
  b = boot({ user: fakeUser('u_ana', false) });
  all.push(b);
  await tick();
  await heal();
  ok(/View only/.test(note(b.d)), 'header says the board is view only');
  ok(
    !b.d.querySelector('.rows.ready .btn') && !writeNotice(b.d) && !b.d.getElementById('noticeText'),
    'no claim buttons and no notice form'
  );
  b.pick('ben');
  b.d.querySelector('tr.item').click();
  await tick();
  ok(
    !b.d.querySelector('.composer') && b.d.getElementById('fStatus').disabled && b.d.getElementById('fOwner').disabled,
    'detail sheet has no composer and locked fields'
  );
  ok(
    ![...b.d.querySelectorAll('.sheet .linkbtn')].some((x) => /Write|Edit/.test(x.textContent)),
    'summary cannot be edited'
  );
  ok(b.writes.length === 0, 'the page writes nothing, not even waitingOn repairs or a link');

  console.log('# viewer the platform said nothing about');
  b = boot({ user: fakeUser(null, null), deny: true });
  all.push(b);
  await tick();
  await heal();
  ok(!note(b.d) && !!b.d.querySelector('.rows.ready .btn'), 'controls stay while write access is unknown');
  b.d.querySelector('.rows.ready .btn').click();
  await tick();
  await tick();
  ok(!b.d.querySelector('.rows.ready .btn') && /View only/.test(note(b.d)), 'a refused write turns the page read-only');

  const errs = all.flatMap((x) => x.errors);
  ok(errs.length === 0, 'no script errors ' + (errs.join('; ') || ''));
  process.exit(failed ? 1 : 0);
})();
