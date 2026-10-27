/* Gives the board page the small `window.claude` runtime it was written for on claude.ai
   (`use('db')` and `use('user')`), backed by this site. Two transports carry it:
   - sqlite: the site's own API (/api/p/<project>/…) and one server-sent event stream
   - supabase: reads through RLS, writes through the ab_batch function, one realtime channel
   Both feed the same listener logic, so the page cannot tell them apart. */
(function () {
  'use strict';

  var STYLE =
    '#ab-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;' +
    'background:var(--bg,#f7f7f5);color:var(--ink,#1d1d1b);font:15px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif}' +
    '@media (prefers-color-scheme:dark){#ab-gate{background:#151514;color:#ecebe8}#ab-gate input{background:#22221f;color:inherit;border-color:#3a3a36}}' +
    '#ab-gate .card{width:100%;max-width:400px}#ab-gate h1{font-size:20px;margin:0 0 8px}#ab-gate p{margin:0 0 12px;opacity:.8}' +
    '#ab-gate form{display:flex;gap:8px}#ab-gate input{flex:1;min-width:0;padding:9px 11px;border:1px solid #d4d3cf;border-radius:8px;font:inherit}' +
    '#ab-gate button{padding:9px 14px;border:0;border-radius:8px;background:#2b6bef;color:#fff;font:inherit;cursor:pointer}' +
    '#ab-gate .err{color:#c2410c;opacity:1;margin-top:10px}#ab-gate code{font-size:13px}';

  var TEXT = {
    en: { intro: 'Paste your board token, or ask your agent for a sign-in link (board_login_link).', button: 'Sign in',
      badToken: 'Unknown or revoked token.', expired: 'This sign-in link was used or has expired. Ask your agent for a new one.',
      failed: 'Sign-in failed.', notMember: 'This account is not a board member.', offline: 'Could not reach the board.' },
    ko: { intro: '보드 토큰(abt_…)을 넣거나, 에이전트에게 "보드 로그인 링크 줘"라고 해서 받은 링크로 들어오세요.', button: '로그인',
      badToken: '토큰이 맞지 않아요.', expired: '이미 썼거나 만료된 링크예요. 에이전트에게 새 링크를 달라고 하세요.',
      failed: '로그인하지 못했어요.', notMember: '이 계정은 보드 멤버가 아니에요.', offline: '보드 서버에 연결하지 못했어요.' },
  };
  var site = { site: 'artiboard', lang: 'en' };
  function t(k) { return (TEXT[site.lang] || TEXT.en)[k]; }

  function gate(message, login) {
    var g = document.getElementById('ab-gate');
    if (!g) {
      var s = document.createElement('style');
      s.textContent = STYLE;
      document.head.appendChild(s);
      g = document.createElement('div');
      g.id = 'ab-gate';
      document.body.appendChild(g);
    }
    g.innerHTML = '<div class="card"><h1></h1><p class="intro"></p>' +
      '<form><input type="password" autocomplete="off" placeholder="abt_…" aria-label="Board token"><button type="submit"></button></form>' +
      '<p class="err" hidden></p></div>';
    g.querySelector('h1').textContent = site.site;
    g.querySelector('.intro').textContent = t('intro');
    g.querySelector('button').textContent = t('button');
    if (message) { g.querySelector('.err').hidden = false; g.querySelector('.err').textContent = message; }
    g.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var token = g.querySelector('input').value.trim();
      if (token) login({ token: token });
    });
  }

  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); });
  }

  function boardError(e) {
    var m = /^ab:([a-z_]+):(\d+):([\s\S]*)$/.exec((e && e.message) || '');
    var code = m ? m[1] : (e && e.code) || 'unavailable';
    // the page reads invalid_argument as "this viewer may not write"
    if (code === 'permission_denied') code = 'invalid_argument';
    var err = new Error(m ? m[3] : (e && e.message) || 'error');
    err.code = code;
    return err;
  }

  function copy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function docSnap(row) {
    return { exists: !!row, id: row ? row.doc_id : undefined, version: row ? row.version : undefined, data: function () { return row ? copy(row.data) : undefined; } };
  }
  function snap(rows) {
    var docs = rows.map(function (row) { return { id: row.doc_id, data: function () { return copy(row.data); } }; });
    return { docs: docs, size: docs.length, empty: !docs.length };
  }

  // every project is its own board at /p/<id>; the project list at / has no board database
  var PROJECT = (/^\/p\/([a-z0-9][a-z0-9-]{0,39})\/?$/.exec(location.pathname) || [])[1] || null;

  // ---------- transports: rows are {collection, doc_id, data, version, updated_at} ----------

  function httpTransport() {
    var base = '/api/p/' + PROJECT + '/';
    function call(action, body) {
      return post(base + action, body).then(function (r) {
        if (!r.ok) { var e = new Error(r.body.message || r.body.error || 'error'); e.code = r.body.code || 'unavailable'; throw e; }
        return r.body;
      });
    }
    return {
      plain: function (whole, docs) { return call('read', { whole: whole, docs: docs }); },
      limited: function (collection, orders, lim) { return call('read', { collection: collection, order: orders, limit: lim }); },
      limitedMany: function (reads) { return call('read', { limited: reads }); },
      changed: function (collections, since) { return call('read', { collections: collections, since: since }); },
      batch: function (writes) { return call('batch', { writes: writes }); },
      subscribe: function (onRow, onLive) {
        var es = new EventSource(base + 'events');
        es.onopen = function () { onLive(true); };
        es.onerror = function () { onLive(false); };
        es.onmessage = function (m) { var row = JSON.parse(m.data); onRow(row, !!row.gone); };
      },
    };
  }

  function supabaseTransport(sb) {
    var COLS = 'collection,doc_id,data,version,updated_at';
    function q(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
    function jsonPath(field) { return 'data->' + field.split('.').join('->'); }
    function rows(r) { if (r.error) throw r.error; return r.data; }
    function base() { return sb.from('ab_docs').select(COLS).eq('project', PROJECT); }
    return {
      plain: function (whole, docs) {
        var parts = whole.map(function (c) { return 'collection.eq.' + q(c); });
        Object.keys(docs).forEach(function (c) {
          if (whole.indexOf(c) < 0) parts.push('and(collection.eq.' + q(c) + ',doc_id.in.(' + docs[c].map(q).join(',') + '))');
        });
        return base().or(parts.join(',')).then(rows);
      },
      limited: function (collection, orders, lim) {
        var x = base().eq('collection', collection);
        orders.forEach(function (o) { x = x.order(jsonPath(o.field), { ascending: o.dir !== 'desc', nullsFirst: false }); });
        return x.order('doc_id', { ascending: true }).limit(lim).then(rows);
      },
      limitedMany: function (reads) { return sb.rpc('ab_read_limited', { p_project: PROJECT, p_reads: reads }).then(rows); },
      changed: function (collections, since) { return base().in('collection', collections).gt('updated_at', since).then(rows); },
      batch: function (writes) { return sb.rpc('ab_batch', { p_project: PROJECT, p_writes: writes }).then(rows); },
      // shows(row): whether anything on the page shows that row
      subscribe: function (onRow, onLive, shows) {
        function onChange(p) {
          if (p.eventType === 'DELETE') { var o = p.old || {}; if (o.project === PROJECT && o.collection) onRow({ collection: o.collection, doc_id: o.doc_id }, true); return; }
          var row = p.new && p.new.collection ? p.new : null;
          if (!row || row.project !== PROJECT) return;
          // realtime may leave out a large value: read just that document, if the page shows it (a rebuilt code map's
          // chunks are large and read only when a search needs them)
          if (row.data === undefined || row.version === undefined) {
            if (!shows(row)) return;
            base().eq('collection', row.collection).eq('doc_id', row.doc_id).maybeSingle().then(function (r) { if (r.data) onRow(r.data, false); });
            return;
          }
          onRow(row, false);
        }
        sb.channel('ab-docs-' + PROJECT)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ab_docs', filter: 'project=eq.' + PROJECT }, onChange)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ab_docs', filter: 'project=eq.' + PROJECT }, onChange)
          // delete events cannot be filtered; the primary key in old tells the project
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ab_docs' }, onChange)
          .subscribe(function (status) {
            if (status === 'SUBSCRIBED') onLive(true);
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onLive(false);
          });
      },
    };
  }

  // Reads are shaped for a live page that should cost little:
  // - listeners registered together are fetched together: every unlimited listener in one request, each limited one apart
  // - after that, pushed rows are applied in place; nothing is re-read on a change
  // - a reconnect or a return to the tab asks only for rows changed since the newest one seen
  // - after a long absence everything is read again once, which also catches deletes that were missed
  function makeDb(tr) {
    var listeners = [], queued = [], mark = '', live = false, hiddenAt = 0, statusCbs = [], catching = false;

    function cmp(orders) {
      return function (a, b) {
        for (var i = 0; i < orders.length; i++) {
          var f = orders[i].field.split('.'), x = a.data, y = b.data;
          f.forEach(function (k) { x = x == null ? x : x[k]; y = y == null ? y : y[k]; });
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          var r = x < y ? -1 : 1;
          return orders[i].dir === 'desc' ? -r : r;
        }
        return a.doc_id < b.doc_id ? -1 : a.doc_id > b.doc_id ? 1 : 0;
      };
    }
    // Supabase realtime may send timestamps without a zone; they are UTC
    function stamp(at) { if (typeof at !== 'string') return; var t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : at + 'Z'); if (!isNaN(t)) { var s = new Date(t).toISOString(); if (s > mark) mark = s; } }
    function emit(l) {
      l.rows.sort(cmp(l.orders));
      if (l.lim && l.rows.length > l.lim) l.rows.length = l.lim;
      var key = l.rows.map(function (r) { return r.doc_id + ':' + r.version; }).join('|');
      if (l.ready && key === l.last) return;
      l.ready = true; l.last = key;
      l.cb(l.docId != null ? docSnap(l.rows[0] || null) : snap(l.rows));
    }
    function matches(l, row) { return l.collection === row.collection && (l.docId == null || l.docId === row.doc_id); }
    function applyRow(row, gone) {
      stamp(row.updated_at);
      listeners.forEach(function (l) {
        if (!matches(l, row)) return;
        // not read yet: keep it for when the first read lands, which may be older
        if (!l.ready) { l.pending.push({ row: row, gone: gone }); return; }
        merge(l, row, gone);
      });
    }
    function merge(l, row, gone) {
      var i = l.rows.findIndex(function (r) { return r.doc_id === row.doc_id; });
      if (gone) { if (i < 0) return; l.rows.splice(i, 1); }
      else if (i >= 0) { if (l.rows[i].version >= row.version) return; l.rows[i] = row; }
      else l.rows.push(row);
      // rows of one batch arrive one by one: hand the listener one snapshot for all of them
      if (!l.soon) l.soon = setTimeout(function () { l.soon = 0; if (listeners.indexOf(l) >= 0) emit(l); }, 30);
    }
    function first(l, rows) {
      if (listeners.indexOf(l) < 0) return;
      l.rows = rows;
      var p = l.pending; l.pending = [];
      p.forEach(function (x) {
        var i = l.rows.findIndex(function (r) { return r.doc_id === x.row.doc_id; });
        if (x.gone) { if (i >= 0) l.rows.splice(i, 1); }
        else if (i < 0) l.rows.push(x.row);
        else if (l.rows[i].version < x.row.version) l.rows[i] = x.row;
      });
      emit(l);
    }

    function fail(ls, e) { ls.forEach(function (l) { l.failed = true; if (l.err) l.err(boardError(e)); }); }
    // a first read that failed is read again when the connection comes back and every minute; what arrived for it
    // meanwhile waits in pending and lands with that read
    function retry() {
      var ls = listeners.filter(function (l) { return l.failed && !l.ready; });
      ls.forEach(function (l) { l.failed = false; });
      if (ls.length) load(ls);
    }
    // one request for the unlimited listeners: whole collections, or single documents of a collection
    function fetchPlain(ls) {
      if (!ls.length) return;
      var whole = [], docs = {};
      ls.forEach(function (l) {
        if (l.docId == null) { if (whole.indexOf(l.collection) < 0) whole.push(l.collection); }
        else { docs[l.collection] = docs[l.collection] || []; if (docs[l.collection].indexOf(l.docId) < 0) docs[l.collection].push(l.docId); }
      });
      tr.plain(whole, docs).then(function (rows) {
        rows.forEach(function (row) { stamp(row.updated_at); });
        ls.forEach(function (l) { first(l, rows.filter(function (row) { return matches(l, row); })); });
      }, function (e) { fail(ls, e); });
    }
    function fetchLimited(l) {
      tr.limited(l.collection, l.orders, l.lim).then(function (rows) {
        rows.forEach(function (row) { stamp(row.updated_at); });
        first(l, rows);
      }, function (e) { fail([l], e); });
    }
    // the limited listeners that start together (recent activity: one per task) share one request
    function fetchLimitedMany(ls) {
      for (var k = 0; k < ls.length; k += 20) (function (part) {
        tr.limitedMany(part.map(function (l) { return { collection: l.collection, order: l.orders, limit: l.lim }; })).then(function (rows) {
          var by = part.map(function () { return []; });
          rows.forEach(function (row) { stamp(row.updated_at); if (by[row.i]) by[row.i].push(row); });
          part.forEach(function (l, i) { first(l, by[i]); });
        }, function (e) { fail(part, e); });
      })(ls.slice(k, k + 20));
    }
    function load(ls) {
      fetchPlain(ls.filter(function (l) { return !l.lim; }));
      var lim = ls.filter(function (l) { return l.lim; });
      if (lim.length > 1 && tr.limitedMany) fetchLimitedMany(lim);
      else lim.forEach(fetchLimited);
    }
    function listen(l) {
      l.rows = []; l.pending = []; l.ready = false; l.last = null;
      listeners.push(l);
      queued.push(l);
      if (queued.length === 1) Promise.resolve().then(function () { var ls = queued; queued = []; load(ls); });
      return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
    }
    // rows of the watched collections changed after the newest one seen
    function catchUp() {
      if (!mark || !listeners.length || catching) return;
      catching = true;
      var cols = listeners.map(function (l) { return l.collection; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
      tr.changed(cols, mark).then(function (rows) { catching = false; rows.forEach(function (row) { applyRow(row); }); }, function () { catching = false; });
    }
    function setLive(on) {
      if (on) { retry(); catchUp(); }
      if (live === on) return;
      live = on;
      statusCbs.forEach(function (cb) { cb(on); });
    }
    tr.subscribe(applyRow, setLive, function (row) { return listeners.some(function (l) { return matches(l, row); }); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 30 * 60000) { listeners.forEach(function (l) { l.ready = false; l.pending = []; }); load(listeners.slice()); }
      else { retry(); catchUp(); }
    });
    // while the live connection is down, look for changes every minute instead
    setInterval(function () {
      if (document.hidden) return;
      retry();
      if (!live) catchUp();
    }, 60000);

    // A write shows at once: listeners get the changed document before the server answers, keeping its old version so
    // the server's own copy (one version up, with anything others wrote meanwhile) replaces it when it arrives.
    // A refused write puts the document back as it was.
    function known(c, id) {
      for (var k = 0; k < listeners.length; k++) {
        var l = listeners[k];
        if (l.ready && l.collection === c) for (var j = 0; j < l.rows.length; j++) if (l.rows[j].doc_id === id) return l.rows[j];
      }
      return null;
    }
    function force(c, id, row) {
      listeners.forEach(function (l) {
        if (!l.ready || l.collection !== c || (l.docId != null && l.docId !== id)) return;
        var i = l.rows.findIndex(function (r) { return r.doc_id === id; });
        if (!row) { if (i < 0) return; l.rows.splice(i, 1); }
        else if (i >= 0) l.rows[i] = row;
        else l.rows.push(row);
        l.last = null; // same versions, new data: still a change
        emit(l);
      });
    }
    // shows one write at once and returns how to take it back
    function local(w) {
      var i = w.path.lastIndexOf('/'), c = w.path.slice(0, i), id = w.path.slice(i + 1), was = known(c, id);
      var mine = w.op === 'delete' ? null : { collection: c, doc_id: id, version: was ? was.version : 0, updated_at: was ? was.updated_at : '',
        data: w.op === 'set' ? copy(w.data) : Object.assign(was ? copy(was.data) : {}, copy(w.data)) };
      if (mine || was) force(c, id, mine);
      // a refused write puts back what was there, unless the server's newer copy arrived meanwhile
      return function () { var cur = known(c, id); if (cur === mine || (!mine && !cur)) force(c, id, was); };
    }
    function write(w) {
      var undo = local(w);
      return tr.batch([w]).then(null, function (e) { undo(); throw boardError(e); });
    }

    function doc(path) {
      var i = path.lastIndexOf('/');
      var collection = path.slice(0, i), id = path.slice(i + 1);
      var one = {}; one[collection] = [id];
      return {
        id: id,
        path: path,
        get: function () { return tr.plain([], one).then(function (rows) { return docSnap(rows[0] || null); }, function (e) { throw boardError(e); }); },
        // { override: true }: a person's deliberate change to a task someone else holds (the database checks the rest)
        set: function (data, o) { return write({ op: 'set', path: path, data: copy(data), override: !!(o && o.override) }); },
        // { ifVersion }: write only if the document is still the version read (a claim two people make at once)
        update: function (patch, o) {
          var w = { op: 'update', path: path, data: copy(patch), override: !!(o && o.override) };
          if (o && typeof o.ifVersion === 'number') w.if_version = o.ifVersion;
          return write(w);
        },
        delete: function () { return write({ op: 'delete', path: path }); },
        // the page leases people/<id> before linking an account, for claude.ai; here the database already lets a
        // member link only their own person, so two viewers cannot race for one
        acquire: function () { return Promise.resolve({ acquired: true }); },
        onSnapshot: function (cb, err) { return listen({ collection: collection, docId: id, orders: [], lim: 0, cb: cb, err: err }); },
      };
    }
    function collection(path, orders, lim) {
      orders = orders || [];
      return {
        path: path,
        orderBy: function (field, dir) { return collection(path, orders.concat([{ field: field, dir: dir }]), lim); },
        limit: function (n) { return collection(path, orders, n); },
        doc: function (id) { return doc(path + '/' + id); },
        get: function () {
          var p = lim || orders.length ? tr.limited(path, orders, lim || 200) : tr.plain([path], {});
          return p.then(function (rows) { rows.sort(cmp(orders)); return snap(rows); }, function (e) { throw boardError(e); });
        },
        onSnapshot: function (cb, err) { return listen({ collection: path, docId: null, orders: orders, lim: lim || 0, cb: cb, err: err }); },
      };
    }

    // live: the push connection is up, so the page is current without reloading
    function onStatus(cb) { statusCbs.push(cb); cb(live); }

    // up to 100 writes in one request, all or none (moving many done tasks to the archive); shown at once like one write
    function batch(writes) {
      var undo = writes.map(local);
      return tr.batch(writes.map(copy)).then(null, function (e) { undo.reverse().forEach(function (f) { f(); }); throw boardError(e); });
    }

    return { doc: doc, collection: collection, onStatus: onStatus, batch: batch };
  }

  // ---------- sign-in: each backend keeps its own session, the rest of the page does not care ----------

  var never = new Promise(function () {});

  function httpSession() {
    function login(body) {
      post('/api/login', body).then(function (r) {
        if (r.ok) { history.replaceState(null, '', location.pathname + location.search); location.reload(); }
        else gate(r.body.error === 'unknown_token' ? t('badToken') : r.body.error === 'expired_link' ? t('expired') : t('failed'), login);
      }, function () { gate(t('failed'), login); });
    }
    function linkCode() { var m = /[#&]ab-code=([A-Za-z0-9_-]+)/.exec(location.hash); return m && m[1]; }
    // a sign-in link opened in a tab already on this page only changes the fragment
    window.addEventListener('hashchange', function () { var c = linkCode(); if (c) login({ code: c }); });
    if (linkCode()) { login({ code: linkCode() }); return never; }
    return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { gate('', login); return never; }
      if (!r.ok) throw new Error('unavailable');
      return r.json().then(function (me) {
        return {
          me: me,
          api: function (method, url, body) {
            return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
          },
          signOut: function () { return post('/api/logout', {}).then(function () { location.reload(); }); },
          db: PROJECT ? makeDb(httpTransport()) : null,
        };
      });
    });
  }

  // the Supabase client loads only on sites that keep their data there
  function loadSupabase() {
    if (window.supabase) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/vendor/supabase-2.117.2.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function supabaseSession(cfg) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
    function login(body) {
      post('/api/login', body).then(function (r) {
        if (r.ok && r.body.url) location.href = r.body.url;
        else gate(r.body.error === 'unknown_token' ? t('badToken') : t('failed'), login);
      }, function () { gate(t('failed'), login); });
    }
    return sb.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) { gate('', login); return never; }
      return sb.rpc('ab_whoami').then(function (w) {
        if (w.error || !w.data) { gate(t('notMember'), login); sb.auth.signOut(); return never; }
        var me = { uid: w.data.user_id, person: w.data.person, name: w.data.name, role: w.data.role };
        return {
          me: me,
          sb: sb,
          api: function (method, url, body) {
            return sb.auth.getSession().then(function (s) {
              var h = { Authorization: 'Bearer ' + (s.data.session ? s.data.session.access_token : '') };
              if (body) h['Content-Type'] = 'application/json';
              return fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
            });
          },
          signOut: function () { return sb.auth.signOut().then(function () { location.reload(); }); },
          db: PROJECT ? makeDb(supabaseTransport(sb)) : null,
        };
      });
    });
  }

  // resolves once a board member is signed in; until then the sign-in screen covers the page
  var ready = fetch('/api/config')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      site = cfg;
      return cfg.backend === 'supabase' ? loadSupabase().then(function () { return supabaseSession(cfg); }) : httpSession();
    })
    .then(function (s) { s.config = site; s.project = PROJECT; window.abSignOut = s.signOut; return s; })
    .catch(function () { gate(t('offline'), function () { location.reload(); }); return never; });

  window.abSession = ready;
  window.AB_PROJECT = PROJECT;
  window.claude = {
    use: function (name) {
      return ready.then(function (s) {
        if (name === 'db') return s.db;
        if (name === 'user') {
          return {
            id: function () { return Promise.resolve(s.me.uid); },
            can: function (what) { return Promise.resolve(what === 'data.write' ? s.me.role !== 'viewer' : true); },
          };
        }
        return null;
      });
    },
  };
})();
