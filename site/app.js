/* Plug Map site. Plain JavaScript, no dependencies, no build step.
 *
 * Data (written by `python -m plugmap site`):
 *   data/index.json        categories, vocabulary, layers, proposals, method counts
 *   data/<slug>.json       one per mapped category: { category, tools: [...] }
 *
 * Tool keys:  n name, u repo URL, c category, sc sub-category, st stars, a last commit date,
 *             d description, k commit hash read, p Package-URL, pb how the PURL was derived,
 *             cl claims: [{ i term id, r role, m method, e evidence, f file, l line, n count,
 *                           x where a code call was found when not in main code: tests | examples }]
 *
 * Routes:  #/  ·  #/category/<slug>  ·  #/tool/<host/owner/repo>  ·  #/vocabulary  ·  #/about
 *
 * All text from the data (descriptions, README quotes, code lines) is inserted as text nodes,
 * never as HTML, because it comes from third-party repositories.
 */
(function () {
  'use strict';

  var main = document.getElementById('main');
  var D = null;          // prepared data
  var catState = {};     // per-category UI state: { sub, q, limit }
  var PAGE = 30;

  // ---------- tiny DOM helper ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) { return; }
        if (k === 'class') { el.className = v; }
        else if (k === 'style') { el.setAttribute('style', v); }
        else if (k.slice(0, 2) === 'on') { el.addEventListener(k.slice(2), v); }
        else { el.setAttribute(k, v === true ? '' : v); }
      });
    }
    for (var i = 2; i < arguments.length; i++) { add(el, arguments[i]); }
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) { return; }
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en'); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
  function bar(frac, color, cls) {
    var w = Math.max(0, Math.min(100, Math.round(frac * 1000) / 10));
    return h('span', { class: cls || 'track' }, h('span', { class: 'fill ' + color, style: 'width:' + w + '%' }));
  }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ---------- routing ----------
  function toolKey(t) { return t.u.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
  function toolHref(t) { return '#/tool/' + encodeURIComponent(toolKey(t)); }
  function catHref(slug) { return '#/category/' + slug; }

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/');
    var view = parts[0] || '';
    setNav(view);
    if (!D) { return; }
    main.textContent = '';
    if (view === 'category' && D.catBySlug[parts[1]] && D.catBySlug[parts[1]].s === 'mapped') {
      renderCategory(D.catBySlug[parts[1]]);
    } else if (view === 'tool' && D.byKey[decodeURIComponent(parts.slice(1).join('/'))]) {
      renderTool(D.byKey[decodeURIComponent(parts.slice(1).join('/'))]);
    } else if (view === 'vocabulary') {
      renderVocab();
    } else if (view === 'about') {
      renderAbout();
    } else {
      renderOverview();
    }
    window.scrollTo(0, 0);
  }
  function setNav(view) {
    var current = view === 'vocabulary' || view === 'about' ? view : 'catalog';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
      if (a.getAttribute('data-nav') === current) { a.setAttribute('aria-current', 'page'); } else { a.removeAttribute('aria-current'); }
    });
  }
  function crumbs(items) {
    var nav = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Catalog'));
    items.forEach(function (it, i) {
      add(nav, h('span', { 'aria-hidden': 'true' }, '›'));
      add(nav, i === items.length - 1 ? h('span', { class: 'here' }, it.label) : h('a', { href: it.href }, it.label));
    });
    return nav;
  }
  function stats(list) {
    return h('section', { class: 'stats', 'aria-label': 'Headline numbers' }, list.map(function (s) {
      return h('div', { class: 'stat' }, h('div', { class: 'stat-l' }, s.l), h('div', { class: 'stat-v' }, s.v));
    }));
  }

  // ---------- data preparation ----------
  function prep(index, catFiles) {
    var V = index.vocab;
    var spec = function (k) { return V[k] && V[k].k !== 'generic'; };
    var tools = [];
    catFiles.forEach(function (f) { f.tools.forEach(function (t) { tools.push(t); }); });
    tools.forEach(function (t) {
      t.plugs = new Set(); t.reads = new Set(); t.writes = new Set(); t.any = new Set();
      t.pf = { reads: {}, writes: {} };  // term -> Set of profile entries ("cf:air_temperature")
      t.cl.forEach(function (c) {
        if (!V[c.i]) { return; }
        t.any.add(c.i);
        if (spec(c.i)) {
          t.plugs.add(c.i);
          // Direction comes from the tool's own code. A test that writes a fixture file doesn't
          // mean the tool exports that format, so calls found only in tests or examples don't count.
          if (c.m === 'code' && !c.x && c.r === 'reads') { t.reads.add(c.i); }
          if (c.m === 'code' && !c.x && c.r === 'writes') { t.writes.add(c.i); }
          if (c.m === 'code' && !c.x && c.pf && t.pf[c.r]) { t.pf[c.r][c.i] = new Set(c.pf); }
        }
      });
    });
    var N = tools.length, df = {}, anyCount = {}, writersOf = {}, readersOf = {};
    tools.forEach(function (t) {
      t.plugs.forEach(function (k) { df[k] = (df[k] || 0) + 1; });
      t.any.forEach(function (k) { anyCount[k] = (anyCount[k] || 0) + 1; });
      t.writes.forEach(function (k) { (writersOf[k] = writersOf[k] || []).push(t); });
      t.reads.forEach(function (k) { (readersOf[k] = readersOf[k] || []).push(t); });
    });
    // Rarer shared formats say more about a real connection than CSV does: weight by inverse frequency.
    var idf = {};
    Object.keys(df).forEach(function (k) { idf[k] = Math.log(N / df[k]); });
    var byCat = {}, catBySlug = {}, byKey = {};
    index.cats.forEach(function (c) { byCat[c.n] = []; catBySlug[c.slug] = c; });
    tools.forEach(function (t) { (byCat[t.c] = byCat[t.c] || []).push(t); byKey[toolKey(t)] = t; });
    var layerTitle = {};
    (index.layers || []).forEach(function (l) { layerTitle[l.id] = l.id === 'core' ? 'core' : l.title.toLowerCase(); });
    return { raw: index, V: V, spec: spec, tools: tools, N: N, df: df, anyCount: anyCount, idf: idf,
      writersOf: writersOf, readersOf: readersOf, byCat: byCat, catBySlug: catBySlug, byKey: byKey,
      layerTitle: layerTitle,
      mapped: index.cats.filter(function (c) { return c.s === 'mapped'; }) };
  }
  // "2026-10-11" -> "11 Oct 2026", without Date(), which can shift the day across time zones.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) {
    var p = (iso || '').split('-');
    return p.length === 3 ? +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0] : '';
  }
  // When the mapped categories were read: one day, or a range once categories are mapped on different days.
  function snapshotText(snap) {
    if (!snap) { return ''; }
    return snap.first === snap.last ? fmtDay(snap.last) : fmtDay(snap.first) + ' – ' + fmtDay(snap.last);
  }
  function snapshotTag(text, href) {
    return h(href ? 'a' : 'span', { class: 'snapshot', href: href || null,
      title: 'When the repositories were read. Every claim is pinned to the commit read then.' },
      h('span', { class: 'snapshot-dot', 'aria-hidden': 'true' }), text);
  }
  function layerName(k) { return D.layerTitle[D.V[k].layer] || D.V[k].layer; }
  function coverage(ts) {
    return {
      read: ts.length,
      plug: ts.filter(function (t) { return t.plugs.size > 0; }).length,
      dir: ts.filter(function (t) { return t.reads.size + t.writes.size > 0; }).length,
      claims: ts.reduce(function (a, t) { return a + t.cl.length; }, 0)
    };
  }

  // ---------- overview ----------
  function renderOverview() {
    var idx = D.raw, m = idx.methods || {};
    var claims = (m.code || 0) + (m.dependency || 0) + (m.readme || 0);
    add(main, h('section', { class: 'hero' },
      idx.snapshot ? snapshotTag('Data snapshot · ' + snapshotText(idx.snapshot) + ' · ' + fmt(D.tools.length) + ' tools', '#/about') : null,
      h('h1', null, 'Which open-source sustainability tools share data formats?'),
      h('p', { class: 'lede' }, 'Plug Map scans the public code, dependency files and README of each tool in the OpenSustain.tech catalog for known data formats, protocols, standards and data sources, and links every match to where it was found. It shows shared formats, not verified compatibility.')));
    add(main, stats([
      { v: idx.catalog_total ? fmt(idx.catalog_total) : '–', l: 'projects in the catalog' },
      { v: D.mapped.length + ' of ' + idx.cats.length, l: 'categories mapped so far' },
      { v: fmt(D.tools.length), l: 'tools read in mapped categories' },
      { v: fmt(claims), l: 'claims, each with evidence' }
    ]));

    var cards = idx.cats.map(function (c) {
      if (c.s !== 'mapped') {
        return h('div', { class: 'card off' },
          h('span', { class: 'card-title' }, h('span', null, c.n), h('span', { class: 'badge ' + c.s }, c.s === 'next' ? 'NEXT' : 'QUEUED')),
          h('span', { class: 'small muted' }, fmt(c.total) + ' projects · ' + c.pack + ' pack'));
      }
      var cv = coverage(D.byCat[c.n] || []);
      return h('a', { class: 'card', href: catHref(c.slug) },
        h('span', { class: 'card-title' }, h('span', null, c.n), h('span', { class: 'badge mapped' }, 'MAPPED')),
        h('span', { class: 'small muted' }, cv.read + ' of ' + c.total + ' tools read · ' + c.pack + ' pack'),
        h('span', { class: 'meter' },
          h('span', { class: 'meter-label' }, h('span', null, 'Shows what data it uses'), h('span', { class: 'num' }, pct(cv.plug, cv.read))),
          bar(cv.read ? cv.plug / cv.read : 0, 'green'),
          h('span', { class: 'meter-label' }, h('span', null, 'Read/write direction known'), h('span', { class: 'num' }, pct(cv.dir, cv.read))),
          bar(cv.read ? cv.dir / cv.read : 0, 'blue')),
        h('span', { class: 'cta' }, 'Open category'));
    });
    add(main, h('section', { class: 'stack' },
      h('div', { class: 'head-row' }, h('h2', null, 'Catalog categories'),
        h('span', { class: 'small muted' }, 'Mapped in rollout order. Each group shares a vocabulary pack.')),
      h('div', { class: 'cards' }, cards)));

    // Bridges: specific terms used in two or more mapped categories.
    var counts = {};
    D.mapped.forEach(function (c) {
      (D.byCat[c.n] || []).forEach(function (t) {
        t.plugs.forEach(function (k) { counts[k] = counts[k] || {}; counts[k][c.n] = (counts[k][c.n] || 0) + 1; });
      });
    });
    var multi = Object.keys(counts).filter(function (k) { return Object.keys(counts[k]).length >= 2; })
      .sort(function (a, b) { return D.df[b] - D.df[a]; }).slice(0, 8);
    var maxCell = 1;
    multi.forEach(function (k) { D.mapped.forEach(function (c) { maxCell = Math.max(maxCell, counts[k][c.n] || 0); }); });
    var bridges = h('section', { class: 'panel grow' },
      h('h2', null, 'Bridges between categories'),
      h('p', { class: 'small muted' }, 'Formats, standards and sources used in more than one mapped category, with the number of tools in each.'),
      multi.length ? multi.map(function (k) {
        return h('div', { class: 'bridge' }, h('span', { style: 'font-weight:500' }, D.V[k].l),
          h('span', { class: 'bridge-cells' }, D.mapped.map(function (c) {
            var n = counts[k][c.n] || 0;
            return h('span', { class: 'cell' }, h('span', { class: 'muted' }, c.n), bar(n / maxCell, 'green'), h('span', { class: 'num' }, n));
          })));
      }) : h('p', { class: 'small muted' }, 'Bridges appear once two or more categories are mapped.'));

    var mmax = Math.max(m.code || 0, m.dependency || 0, m.readme || 0, 1);
    var methodRow = function (label, n) {
      return h('div', { class: 'stack', style: 'gap:4px' },
        h('span', { class: 'meter-label', style: 'font-size:14px' }, h('span', null, label), h('span', { class: 'num' }, fmt(n))),
        bar(n / mmax, 'ink'));
    };
    var V = D.V, layers = {};
    Object.keys(V).forEach(function (k) { layers[V[k].layer] = (layers[V[k].layer] || 0) + 1; });
    var open = (idx.proposed || []).filter(function (p) { return p.status === 'open'; }).length;
    var how = h('section', { class: 'panel side' },
      h('h2', null, 'How the facts were found'),
      methodRow('Calls in the code', m.code || 0),
      methodRow('Dependency files', m.dependency || 0),
      methodRow('README text', m.readme || 0),
      h('div', { class: 'rule stack small', style: 'padding-top:12px;gap:6px' },
        h('span', null, 'Vocabulary: ', (idx.layers || []).map(function (l, i) {
          return [i ? ', ' : '', h('b', null, String(layers[l.id] || 0)), ' ', l.id === 'core' ? 'core terms' : 'in the ' + l.title.toLowerCase()];
        })),
        h('span', null, h('b', null, String(open)), ' AI-proposed terms awaiting review'),
        h('a', { class: 'btn', href: '#/vocabulary' }, 'Review the vocabulary')));
    add(main, h('div', { class: 'row-wrap' }, bridges, how));
  }

  // ---------- category ----------
  function renderCategory(meta) {
    var ts = D.byCat[meta.n] || [];
    var st = catState[meta.slug] = catState[meta.slug] || { sub: 'all', q: '', limit: PAGE };
    var cv = coverage(ts), V = D.V;
    add(main, crumbs([{ label: meta.n }]));
    add(main, h('section', { class: 'page-head' },
      h('span', { class: 'eyebrow' }, 'Category · ' + meta.pack + ' pack'),
      h('h1', null, meta.n),
      meta.mapped ? snapshotTag('Mapped ' + fmtDay(meta.mapped)) : null,
      h('p', null, cv.read + ' of ' + meta.total + ' catalog projects read. The rest could not be cloned (moved, private or not a git host).')));
    add(main, stats([
      { v: pct(cv.plug, cv.read), l: 'show what data they use' },
      { v: pct(cv.dir, cv.read), l: 'have a known read/write direction' },
      { v: fmt(cv.claims), l: 'claims with evidence' },
      { v: fmt(cv.read), l: 'tools read' }
    ]));

    var rd = {}, wr = {}, use = {};
    ts.forEach(function (t) {
      t.reads.forEach(function (k) { rd[k] = (rd[k] || 0) + 1; });
      t.writes.forEach(function (k) { wr[k] = (wr[k] || 0) + 1; });
      t.plugs.forEach(function (k) { use[k] = (use[k] || 0) + 1; });
    });
    var tot = function (k) { return (rd[k] || 0) + (wr[k] || 0); };
    var fkeys = Object.keys(Object.assign({}, rd, wr)).sort(function (a, b) { return tot(b) - tot(a); }).slice(0, 12);
    var fmax = 1;
    fkeys.forEach(function (k) { fmax = Math.max(fmax, rd[k] || 0, wr[k] || 0); });
    add(main, h('section', { class: 'panel' },
      h('div', { class: 'head-row' }, h('h2', null, 'Who reads and who writes'),
        h('span', { class: 'legend' },
          h('span', null, h('span', { class: 'swatch blue' }), 'Tools that read it'),
          h('span', null, h('span', { class: 'swatch green' }), 'Tools that write it'))),
      h('p', { class: 'small muted' }, 'Found from calls in each tool’s own code, such as to_netcdf or read_parquet; calls only in tests or examples are left out. So are general formats like CSV and JSON, which say little about compatibility.'),
      fkeys.length ? [h('div', { class: 'dv-head', 'aria-hidden': 'true' }, h('span', null, ''), h('span', null, 'reads'), h('span', null, 'writes'))].concat(fkeys.map(function (k) {
        return h('div', { class: 'dv' },
          h('span', { class: 'dv-name' }, h('span', { style: 'font-weight:500' }, V[k].l), h('span', { class: 'tiny muted' }, layerName(k))),
          h('span', { class: 'dv-left' }, h('span', { class: 'num small' }, rd[k] || 0), bar((rd[k] || 0) / fmax, 'blue', 'dv-bar')),
          h('span', { class: 'dv-right' }, bar((wr[k] || 0) / fmax, 'green', 'dv-bar'), h('span', { class: 'num small' }, wr[k] || 0)));
      })) : h('p', { class: 'small muted' }, 'No read or write calls found yet.')));

    var panel = function (title, kinds) {
      var keys = Object.keys(use).filter(function (k) { return kinds.indexOf(V[k].k) >= 0; })
        .sort(function (a, b) { return use[b] - use[a]; }).slice(0, 6);
      var mx = keys.length ? use[keys[0]] : 1;
      return h('section', { class: 'panel', style: 'gap:10px' }, h('h3', null, title),
        keys.length ? keys.map(function (k) {
          return h('span', { class: 'rank' }, h('span', { class: 'stack', style: 'gap:0' }, h('span', null, V[k].l), bar(use[k] / mx, 'grey')),
            h('span', { class: 'num' }, use[k]));
        }) : h('span', { class: 'small muted' }, 'None found in this category yet.'));
    };
    add(main, h('div', { class: 'trio' },
      panel('Data sources pulled', ['source']),
      panel('Code ecosystems built on', ['ecosystem']),
      panel('Protocols and standards', ['protocol', 'standard'])));

    // Tool list with sub-category chips and search. Only the list re-renders on input, so focus stays put.
    var subCounts = {};
    ts.forEach(function (t) { subCounts[t.sc] = (subCounts[t.sc] || 0) + 1; });
    var listBox = h('div', { class: 'stack' });
    var chipsBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by sub-category' });
    function drawChips() {
      chipsBox.textContent = '';
      var subs = [['all', 'All', ts.length]].concat(Object.keys(subCounts)
        .sort(function (a, b) { return subCounts[b] - subCounts[a]; }).map(function (s) { return [s, s, subCounts[s]]; }));
      subs.forEach(function (s) {
        add(chipsBox, h('button', { type: 'button', class: 'chip', 'aria-pressed': st.sub === s[0] ? 'true' : 'false',
          onclick: function () { st.sub = s[0]; st.limit = PAGE; drawChips(); drawList(); } },
          s[1], h('span', { class: 'chip-count' }, s[2])));
      });
    }
    function drawList() {
      listBox.textContent = '';
      var q = st.q.trim().toLowerCase();
      var rows = ts.filter(function (t) { return st.sub === 'all' || t.sc === st.sub; })
        .filter(function (t) {
          if (!q) { return true; }
          var hay = (t.n + ' ' + t.d + ' ' + Array.from(t.plugs).map(function (k) { return V[k].l; }).join(' ')).toLowerCase();
          return hay.indexOf(q) >= 0;
        })
        .sort(function (a, b) { return (b.plugs.size - a.plugs.size) || (b.st - a.st); });
      add(listBox, h('span', { class: 'small muted', role: 'status' }, plural(rows.length, 'tool') + (rows.length > st.limit ? ', showing ' + st.limit : '')));
      if (rows.length) {
        add(listBox, h('div', { class: 'list' }, rows.slice(0, st.limit).map(function (t) {
          var labels = Array.from(t.plugs).sort(function (a, b) { return (D.df[a] || 0) - (D.df[b] || 0); })
            .slice(0, 4).map(function (k) { return V[k].l; });
          return h('a', { class: 'list-row', href: toolHref(t) },
            h('span', { class: 'stack', style: 'gap:0;min-width:0' }, h('span', { class: 'name' }, t.n),
              h('span', { class: 'small muted' }, t.sc + (labels.length ? ' · ' + labels.join(', ') : ''))),
            h('span', { class: 'meta' }, h('span', null, plural(t.plugs.size, 'plug')),
              h('span', null, 'reads ' + t.reads.size + ' · writes ' + t.writes.size)));
        })));
      }
      if (rows.length > st.limit) {
        add(listBox, h('button', { type: 'button', class: 'btn ghost', onclick: function () { st.limit += PAGE; drawList(); } }, 'Show more tools'));
      }
    }
    drawChips();
    drawList();
    var search = h('input', { id: 'toolSearch', class: 'search', type: 'search', value: st.q, placeholder: 'Name, format or description',
      oninput: function (e) { st.q = e.target.value; st.limit = PAGE; drawList(); } });
    add(main, h('section', { class: 'panel', style: 'gap:12px' },
      h('h2', null, 'Tools'), chipsBox,
      h('label', { for: 'toolSearch', class: 'field-label' }, 'Search tools in this category'), search, listBox));
  }

  // ---------- tool ----------
  function evidenceLink(t, c) {
    if (!c.f || !t.k) { return null; }
    var path = c.f.split('/').map(encodeURIComponent).join('/');
    var line = c.l ? '#L' + c.l : '';
    if (/^https:\/\/github\.com\//.test(t.u)) { return t.u.replace(/\/$/, '') + '/blob/' + t.k + '/' + path + line; }
    if (/gitlab/.test(t.u)) { return t.u.replace(/\/$/, '') + '/-/blob/' + t.k + '/' + path + line; }
    return null;
  }
  // "cf:air_temperature", "cf_conventions" -> "CF standard names: air_temperature · CF conventions"
  function profileText(entries, max) {
    var groups = {}, order = [];
    entries.forEach(function (e) {
      var i = e.indexOf(':'), id = i < 0 ? e : e.slice(0, i);
      if (!groups[id]) { groups[id] = []; order.push(id); }
      if (i >= 0) { groups[id].push(e.slice(i + 1)); }
    });
    var labels = D.raw.profiles || {};
    return order.map(function (id) {
      var names = groups[id], label = labels[id] || id;
      if (!names.length) { return label; }
      var shown = names.slice(0, max || 6).join(', ');
      return label + ': ' + shown + (names.length > (max || 6) ? ' +' + (names.length - (max || 6)) : '');
    }).join(' · ');
  }
  function evidence(t, c) {
    var where = c.f ? c.f + (c.l ? ':' + c.l : '') : '';
    var href = evidenceLink(t, c);
    var more = c.n > 1 ? '  (' + c.n + ' places)' : '';
    return h('span', { class: 'ev' },
      where ? [href ? h('a', { href: href, target: '_blank', rel: 'noopener' }, where) : where, '  '] : null,
      c.e, more);
  }
  function renderTool(t) {
    var V = D.V, meta = D.raw.cats.find(function (c) { return c.n === t.c; });
    add(main, crumbs([{ label: t.c, href: meta ? catHref(meta.slug) : '#/' }, { label: t.n }]));
    add(main, h('section', { class: 'page-head' },
      h('span', { class: 'eyebrow' }, t.c + ' · ' + t.sc),
      h('h1', null, t.n),
      t.d ? h('p', null, t.d) : null,
      h('div', { class: 'facts' },
        h('a', { href: t.u, target: '_blank', rel: 'noopener' }, 'Repository'),
        h('span', null, '★ ' + fmt(t.st)),
        t.a ? h('span', null, 'last commit ' + t.a) : null,
        t.k ? h('span', { class: 'mono tiny' }, 'read at ' + t.k.slice(0, 10)) : null),
      h('div', { class: 'purl' }, h('span', { class: 'tiny muted' }, 'Package-URL'),
        h('span', { class: 'mono' }, t.p || 'none yet'), t.pb ? h('span', { class: 'tiny muted' }, '(' + t.pb + ')') : null)));

    var methodLabel = { code: 'code', dependency: 'dependency', readme: 'README' };
    var byItem = {};
    t.cl.forEach(function (c) {
      if (!V[c.i]) { return; }
      var e = byItem[c.i] = byItem[c.i] || { roles: {}, methods: {}, other: null };
      e.methods[methodLabel[c.m] || c.m] = true;
      if (c.m === 'code') { if (!e.roles[c.r] || (e.roles[c.r].x && !c.x)) { e.roles[c.r] = c; } } else if (!e.other) { e.other = c; }
    });
    var order = [['reads', 'Reads'], ['writes', 'Writes'], ['speaks', 'Speaks'], ['pulls', 'Pulls data from'], ['uses', 'Uses · direction not yet known']];
    var rank = function (k) { return D.spec(k) ? 0 : 1; };
    var groups = order.map(function (o) {
      var role = o[0];
      var keys = Object.keys(byItem).filter(function (k) {
        return role === 'uses' ? Object.keys(byItem[k].roles).length === 0 : !!byItem[k].roles[role];
      }).sort(function (a, b) { return (rank(a) - rank(b)) || ((D.df[a] || 0) - (D.df[b] || 0)); });
      if (!keys.length) { return null; }
      return h('div', { class: 'panel', style: 'gap:4px' },
        h('h2', { style: 'margin-bottom:8px' }, o[1]),
        keys.map(function (k) {
          var c = role === 'uses' ? byItem[k].other : byItem[k].roles[role];
          return h('div', { class: 'claim' },
            h('span', { class: 'claim-head' }, h('span', { class: 'label' }, V[k].l),
              h('span', { class: 'tag' }, D.spec(k) ? layerName(k) : 'general format'),
              h('span', { class: 'tag outline' }, Object.keys(byItem[k].methods).join(' · ')),
              c.x ? h('span', { class: 'tag aux', title: 'Not counted as a direction: the call is not in the tool’s own code' }, 'only in ' + c.x) : null),
            evidence(t, c),
            c.pf ? h('span', { class: 'ev', title: 'Variable names and conventions in the code of the files that make this call' },
              'In files with this call: ' + profileText(c.pf)) : null);
        }));
    }).filter(Boolean);
    var left = h('section', { class: 'grow stack', style: 'gap:16px' },
      groups.length ? groups : h('p', { class: 'muted' }, 'No formats, protocols or data sources detected yet for this tool. That usually means the vocabulary doesn’t cover what it uses yet; see Vocabulary.'));

    // Same format is a weak link for general formats; sharing variable names or conventions inside
    // the file (a profile match) is stronger, so those neighbours come first.
    function neighbours(mine, other, myRole, theirRole) {
      var score = {};
      mine.forEach(function (k) {
        var my = t.pf[myRole][k];
        (other[k] || []).forEach(function (u) {
          if (u === t) { return; }
          var key = toolKey(u);
          var e = score[key] = score[key] || { u: u, w: 0, via: [], shared: [] };
          e.w += D.idf[k] || 0; e.via.push(V[k].l);
          var theirs = u.pf[theirRole][k];
          if (my && theirs) { my.forEach(function (x) { if (theirs.has(x)) { e.shared.push(x); } }); }
        });
      });
      return Object.keys(score).map(function (k) { return score[k]; })
        .sort(function (a, b) { return (b.shared.length > 0) - (a.shared.length > 0) || (b.w - a.w) || (b.u.st - a.u.st); });
    }
    function side(title, note, verb, list, none) {
      return h('section', { class: 'panel', style: 'gap:6px' },
        h('h2', null, title),
        h('p', { class: 'small muted', style: 'margin-bottom:4px' }, note),
        list.length ? list.slice(0, 8).map(function (e) {
          return h('a', { class: 'nb', href: toolHref(e.u) }, h('span', { class: 'name' }, e.u.n),
            h('span', { class: 'tiny muted' }, verb + ' ' + e.via.slice(0, 3).join(', ') + ' · ' + e.u.c),
            e.shared.length ? h('span', { class: 'tiny' }, 'Same ' + profileText(e.shared, 3)) : null);
        }) : h('span', { class: 'small muted' }, none),
        list.length > 8 ? h('span', { class: 'tiny muted' }, (list.length - 8) + ' more') : null);
    }
    var right = h('aside', { class: 'side stack', style: 'gap:16px' },
      side('Upstream', 'Tools that write what this one reads. Tools that also use the same variable names or conventions in that file come first, then rarer shared formats.', 'writes', neighbours(t.reads, D.writersOf, 'reads', 'writes'), 'No upstream tools found yet.'),
      side('Downstream', 'Tools that read what this one writes, ranked the same way.', 'reads', neighbours(t.writes, D.readersOf, 'writes', 'reads'), 'No downstream tools found yet.'));
    add(main, h('div', { class: 'row-wrap' }, left, right));
  }

  // ---------- vocabulary ----------
  function renderVocab() {
    var V = D.V, idx = D.raw, props = idx.proposed || [];
    add(main, crumbs([{ label: 'Vocabulary' }]));
    add(main, h('section', { class: 'page-head' },
      h('span', { class: 'eyebrow' }, 'Reference'),
      h('h1', null, 'Vocabulary'),
      h('p', null, 'What Plug Map can recognise, kept as data files instead of code. The core layer applies to every category; packs add terms for one group of categories. New terms arrive as proposals and are added after a person reviews them.')));

    var counts = { open: 0, accepted: 0, rejected: 0 };
    props.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
    var sorted = props.slice().sort(function (a, b) {
      var o = { open: 0, accepted: 1, rejected: 2 };
      return (o[a.status] - o[b.status]) || a.n.localeCompare(b.n);
    });
    add(main, h('section', { class: 'panel', style: 'gap:6px' },
      h('div', { class: 'head-row' }, h('h2', null, 'Proposed by AI · awaiting review'),
        h('span', { class: 'small muted' }, counts.open + ' open · ' + counts.accepted + ' accepted · ' + counts.rejected + ' rejected')),
      h('p', { class: 'small muted' }, 'Terms an AI reader found in READMEs that the vocabulary doesn’t cover. Each carries a quote that was checked word for word against the README.'),
      h('div', { class: 'howto' }, 'To review: edit ', h('code', null, 'vocab/proposals.yml'),
        '. To accept a term, add it with its patterns to ', h('code', null, 'vocab/core.yml'), ' or a pack and set ',
        h('code', null, 'status: accepted'), '; otherwise set ', h('code', null, 'status: rejected'),
        '. Then run ', h('code', null, 'python -m plugmap validate'), ' and ', h('code', null, 'python -m plugmap site'), '.'),
      sorted.length ? sorted.map(function (p) {
        var found = [p.from].concat(p.also || []).filter(Boolean);
        return h('div', { class: 'prop' },
          h('span', { class: 'prop-head' }, h('span', { class: 'label' }, p.n),
            h('span', { class: 'badge ' + p.status }, p.status.toUpperCase()),
            p.k ? h('span', { class: 'tag' }, p.k) : null,
            h('span', { class: 'small muted' }, (p.r === 'builds-on' ? 'builds on it' : p.r) + ' · found in ' + found.join(', '))),
          p.q ? h('span', { class: 'quote' }, '“' + p.q + '”') : null,
          p.by ? h('span', { class: 'tiny muted mono' }, p.by) : null);
      }) : h('p', { class: 'small muted' }, 'No proposals yet. Run python -m plugmap propose --category "…".')));

    var kindName = { format: 'format', protocol: 'protocol', standard: 'standard', source: 'data source', ecosystem: 'ecosystem', generic: 'general' };
    add(main, h('div', { class: 'trio', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' },
      (idx.layers || []).map(function (l) {
        var keys = Object.keys(V).filter(function (k) { return V[k].layer === l.id; })
          .sort(function (a, b) { return ((D.anyCount[b] || 0) - (D.anyCount[a] || 0)) || V[a].l.localeCompare(V[b].l); });
        var unused = keys.filter(function (k) { return !D.anyCount[k]; }).length;
        return h('section', { class: 'panel', style: 'gap:4px' },
          h('h2', null, l.title),
          h('span', { class: 'mono tiny muted', style: 'margin-top:-4px' }, l.file),
          l.used_by ? h('span', { class: 'tiny muted', style: 'margin-bottom:6px' }, 'Applied to: ' + (l.used_by.join(', ') || 'no category yet')) : null,
          h('span', { class: 'tiny muted', style: 'margin-bottom:6px' }, keys.length + ' terms · ' + unused + ' not seen in any mapped tool yet'),
          keys.map(function (k) {
            var n = D.anyCount[k] || 0;
            return h('span', { class: 'term' }, h('span', { class: n ? '' : 'zero' }, V[k].l),
              h('span', { class: 'tiny muted' }, kindName[V[k].k] || V[k].k),
              h('span', { class: 'num' }, plural(n, 'tool')));
          }));
      })));
  }

  // ---------- about ----------
  function renderAbout() {
    add(main, crumbs([{ label: 'About' }]));
    add(main, h('section', { class: 'prose' },
      h('h1', null, 'About Plug Map'),
      h('p', { class: 'lede' }, 'Tools in climate, energy and environmental science rarely say, in a way you can search, which data they can take in and hand on. Plug Map works it out from the source and shows its evidence, so you can see which tools can be chained together and where the gaps are.'),
      h('h2', null, 'How a category is mapped'),
      h('ul', null,
        h('li', null, 'The project list comes from the OpenSustain.tech catalog, one category at a time.'),
        h('li', null, 'Each repository is shallow-cloned: only top-level docs and manifests, plus source code in Python, Julia, R, C, C++, Fortran, Java, MATLAB, Modelica, Rust, JavaScript and TypeScript. Nothing is executed.'),
        h('li', null, 'Three readers record claims. ', h('b', null, 'Code calls'), ' such as to_netcdf or read_parquet give a direction (reads, writes, speaks, pulls) with file and line. ',
          h('b', null, 'Dependency files'), ' show that a tool uses a library tied to a format or ecosystem. ', h('b', null, 'README text'), ' catches standards and data sources the other two miss.'),
        h('li', null, 'Code in tests, examples, docs, notebooks and benchmarks is read too, but a call found only there is marked and does not count as a direction. A test that writes a NetCDF fixture doesn’t mean the tool exports NetCDF.'),
        h('li', null, 'What counts as a format, protocol or data source lives in the vocabulary files, not in code. Adding a term is a pull request.'),
        h('li', null, 'An optional AI step reads READMEs of tools the rules found little in and proposes new terms. Proposals are only kept if their supporting quote is really in the README, and a person decides.')),
      h('h2', null, 'Reading the numbers'),
      h('ul', null,
        h('li', null, h('b', null, 'Plug'), ': a specific format, protocol, standard, data source or ecosystem. General formats (CSV, JSON, YAML, Excel and similar) are shown on tool pages but not counted.'),
        h('li', null, h('b', null, 'Upstream / downstream'), ': tools that write what this one reads, or read what it writes, from calls in their own code (not tests or examples). Matches on rarer formats rank higher.'),
        h('li', null, h('b', null, 'Data snapshot'), ': the day a category’s repositories were read. Each claim links to the commit read that day, so it stays checkable after the tool changes. Categories are re-mapped from time to time, so the date can differ between categories.'),
        h('li', null, h('b', null, 'Same variable names'), ': for NetCDF, Zarr and HDF5, Plug Map also records the CF standard names, ERA5 variable names and CF conventions in the code of the file that reads or writes. Two tools that share them are more likely to really fit together than two that only share a format, so they are listed first. Names elsewhere in a tool’s code are not seen, so a missing match doesn’t mean the tools don’t fit.'),
        h('li', null, 'Claims are machine-made. A spot check of code claims found them accurate, but a README mention can be loose. Each claim shows its evidence so you can judge.')),
      h('h2', null, 'Licence and citation'),
      h('p', null, 'The data is published under ', h('a', { href: 'https://creativecommons.org/licenses/by/4.0/' }, 'CC BY 4.0'),
        ' and the code under the MIT licence. Star counts and last-commit dates come from ', h('a', { href: 'https://ecosyste.ms' }, 'ecosyste.ms'),
        ' (CC BY-SA 4.0); evidence quotes come from each tool’s own repository. To cite Plug Map, use its CITATION.cff and give the data build date.'),
      h('p', { class: 'small' }, 'Plug Map by AbdulSalam416, CC BY 4.0. Data snapshot ' + snapshotText(D.raw.snapshot) + '.')));
  }

  // ---------- shell: theme toggle and mobile menu ----------
  var themeBtn = document.getElementById('themeToggle');
  function themeLabel() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
  }
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* applies for this visit only */ }
    themeLabel();
  });
  themeLabel();

  var navBtn = document.getElementById('navToggle'), mobileNav = document.getElementById('mobile-nav');
  function setMenu(open) {
    navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    navBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mobileNav.hidden = !open;
  }
  navBtn.addEventListener('click', function () { setMenu(mobileNav.hidden); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mobileNav.hidden) { setMenu(false); navBtn.focus(); } });
  window.addEventListener('hashchange', function () { setMenu(false); });

  // ---------- load ----------
  function fail(msg) {
    main.textContent = '';
    add(main, h('section', { class: 'panel' }, h('h2', null, 'Could not load the data'),
      h('p', { class: 'error' }, msg),
      h('p', { class: 'small' }, 'If you opened this file directly, serve it instead: run ', h('code', { class: 'mono' }, 'python -m plugmap serve'),
        ' and open http://localhost:8080. If the data is missing, run ', h('code', { class: 'mono' }, 'python -m plugmap site'), '.')));
  }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) { throw new Error(url + ': HTTP ' + r.status); } return r.json(); });
  }
  getJSON('data/index.json').then(function (index) {
    var built = document.getElementById('built');
    if (index.snapshot) { built.textContent = ' · data snapshot ' + snapshotText(index.snapshot); }
    var mapped = index.cats.filter(function (c) { return c.s === 'mapped'; });
    return Promise.all(mapped.map(function (c) { return getJSON('data/' + c.slug + '.json'); })).then(function (files) {
      D = prep(index, files);
      route();
    });
  }).catch(function (e) { fail(e.message); });
  window.addEventListener('hashchange', route);
})();
