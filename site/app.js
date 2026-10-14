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
  function bar(frac, color, cls) {
    var w = Math.max(0, Math.min(100, Math.round(frac * 1000) / 10));
    return h('span', { class: cls || 'track' }, h('span', { class: 'fill ' + color, style: 'width:' + w + '%' }));
  }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ---------- term marks ----------
  // A term's official logo where it has one (files in logos/, sources in logos/SOURCES.md), otherwise
  // a drawn tile: a short name tinted by kind, with a folded corner for file formats.
  // The mark always sits next to the term's name, so it is decorative and hidden from screen readers.
  // Term id -> extension of its logo file, logos/<id>.<ext>.
  var LOGOS = {
    bacnet: 'svg', brick: 'png', canbus: 'svg', cim: 'svg', citygml: 'png', dlms: 'png', dnp3: 'png',
    earth_obs: 'svg', eia: 'svg', energyplus: 'png', entsoe: 'svg', era5: 'svg', fmi: 'svg',
    frictionless: 'svg', gridlabd: 'png', grpc: 'svg', gym: 'svg', haystack: 'svg', hdf5: 'svg',
    home_assistant: 'svg', hoymiles: 'png', iamc: 'png', iec104: 'svg', iec61850: 'svg', ieee2030_5: 'svg',
    inverter_deye: 'png', inverter_foxess: 'png', inverter_goodwe: 'svg', inverter_huawei: 'svg',
    inverter_lux: 'png', inverter_solis: 'svg', inverter_sunsynk: 'png', json: 'svg', knx: 'svg',
    linked_data: 'svg', lorawan: 'svg', matpower: 'png', mcp: 'svg', messageix: 'svg', modbus: 'svg',
    modelica: 'svg', mqtt: 'svg', nasapower: 'svg', netcdf: 'png', ninja: 'png', ocpi: 'png', ocpp: 'png',
    oemof: 'svg', oeo: 'svg', openadr: 'png', opendss: 'png', openmdao: 'png', openmeteo: 'png',
    openpaygo: 'svg', openvsp: 'png', osemosys: 'png', osm: 'svg', pandapower: 'svg', parquet: 'svg',
    plexos: 'png', powermodels: 'svg', psse: 'svg', pvlib: 'png', pybamm: 'svg', pypsa: 'svg',
    sensorthings: 'svg', sienna: 'png', solax: 'png', sts: 'png', sunspec: 'png', timeseries_db: 'svg',
    yaml: 'svg', zarr: 'svg', zigbee: 'svg'
  };
  var ON_DARK = {};  // logos with white ink, shown on a dark tile
  // Wordmarks and other logos wider than about 2:1, shown on a wide tile.
  var WIDE = {
    bacnet: 1, citygml: 1, dnp3: 1, era5: 1, gridlabd: 1, grpc: 1, haystack: 1, hdf5: 1, hoymiles: 1,
    ieee2030_5: 1, inverter_deye: 1, inverter_goodwe: 1, inverter_lux: 1, knx: 1, lorawan: 1, modbus: 1,
    nasapower: 1, openadr: 1, opendss: 1, openmdao: 1, openpaygo: 1, pandapower: 1, plexos: 1, psse: 1,
    solax: 1
  };
  var SHORT = { csv: 'CSV', excel: 'XLS', geojson: 'GEO', raster_gis: 'TIF', vector_gis: 'SHP', rest_api: 'API', sql: 'SQL',
    weather_files: 'EPW', rts_gmlc: 'RTS', openfast_files: 'FST', rs485: '485', i2c: 'I²C', avrswap: 'SWAP', gbxml: 'gbXML',
    psu_wopwop: 'WOP', openfast: 'FAST', openfoam: 'FOAM', hawc2: 'HAWC2', thermosteam: 'TMS', pvgis: 'PVGIS', opcua: 'OPC' };
  var DOC_KINDS = { format: true, generic: true };
  // Like an element symbol: "MQTT" -> "MQTT", "US EIA" -> "UE", "oemof" -> "Oe", "Renewables.ninja" -> "Re"
  function monogram(label) {
    var words = label.replace(/\(.*?\)/g, '').split(/[\s\/·-]+/).filter(Boolean);
    if (/^[A-Z0-9]{2,4}$/.test(words[0] || '')) { return words[0]; }
    if (words.length > 1) { return (words[0][0] + words[1][0]).toUpperCase(); }
    var w = words[0] || '?';
    return w[0].toUpperCase() + (w[1] || '').toLowerCase();
  }
  function fallbackMark(k, cls) {
    var term = D.V[k] || { l: k, k: 'generic' }, text = SHORT[k] || monogram(term.l);
    return h('span', { class: cls + ' mark--fb mark--' + term.k + (DOC_KINDS[term.k] ? ' mark--doc' : ''), 'aria-hidden': 'true',
      'data-len': String(Math.min(text.length, 5)) }, text);
  }
  function mark(k, size) {
    var cls = 'mark' + (size ? ' mark--' + size : '');
    if (!LOGOS[k]) { return fallbackMark(k, cls); }
    var tile = h('span', { class: cls + (WIDE[k] ? ' mark--wide' : '') + (ON_DARK[k] ? ' mark--on-dark' : ''), 'aria-hidden': 'true' });
    add(tile, h('img', { src: 'logos/' + k + '.' + LOGOS[k], alt: '', loading: 'lazy', decoding: 'async',
      onerror: function () { tile.replaceWith(fallbackMark(k, cls)); } }));
    return tile;
  }
  // In rows, a mark sits in a slot as wide as a wide tile, so the names after it line up.
  function slot(k, size) { return h('span', { class: 'mark-slot' + (size ? ' mark-slot--' + size : '') }, mark(k, size)); }
  // A term's name with its mark in front, for rows and lists.
  function termName(k, size, nameAttrs) {
    return h('span', { class: 'term-name' }, slot(k, size), h('span', nameAttrs || null, D.V[k].l));
  }

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
    return { raw: index, V: V, spec: spec, sem: function (k) { return !!(V[k] && V[k].sem); }, tools: tools, N: N, df: df, anyCount: anyCount, idf: idf,
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
  // Labels for a link between two tools, strongest first (see neighbours() and linkStrength()).
  var tierName = ['Same variable names', 'Domain format', 'Container format only'];
  var tierNote = [
    'They use the same variable names or conventions in the files that read and write this format.',
    'The format fixes what the data means, not only how it is stored.',
    'They share a file format, but nothing found shows the contents line up.'];
  // Strongest evidence first, in the data colours: green for a name match, blue for a domain format, grey for a container.
  var tierTone = ['green', 'blue', 'grey'];
  // Every directed link in the mapped data (one tool writes a format in its own code, another reads
  // it in its own code), labelled the same way as on tool pages. Counted once per pair of tools.
  function linkStrength() {
    var pairs = {};
    Object.keys(D.writersOf).forEach(function (k) {
      (D.readersOf[k] || []).forEach(function (r) {
        D.writersOf[k].forEach(function (w) {
          if (w === r) { return; }
          var key = toolKey(w) + '>' + toolKey(r);
          var p = pairs[key] = pairs[key] || { named: false, sem: false, via: [], namedVia: {}, profiles: {} };
          p.via.push(k);
          if (D.sem(k)) { p.sem = true; }
          var a = w.pf.writes[k], b = r.pf.reads[k];
          if (a && b) { a.forEach(function (x) { if (b.has(x)) { p.named = true; p.namedVia[k] = true; p.profiles[x.split(':')[0]] = true; } }); }
        });
      });
    });
    var out = { total: 0, n: [0, 0, 0], terms: [{}, {}, {}], profiles: {} };
    Object.keys(pairs).forEach(function (key) {
      var p = pairs[key], tier = p.named ? 0 : p.sem ? 1 : 2;
      out.total++; out.n[tier]++;
      Object.keys(p.profiles).forEach(function (id) { out.profiles[id] = (out.profiles[id] || 0) + 1; });
      p.via.forEach(function (k) {
        // Name the format that earned the label, not a container the same two tools also share.
        if ((tier === 0 && !p.namedVia[k]) || (tier === 1 && !D.sem(k))) { return; }
        out.terms[tier][k] = (out.terms[tier][k] || 0) + 1;
      });
    });
    return out;
  }
  function layerName(k) { return D.layerTitle[D.V[k].layer] || D.V[k].layer; }

  // ---------- overview ----------
  function renderOverview() {
    var idx = D.raw, m = idx.methods || {};
    var claims = (m.code || 0) + (m.dependency || 0) + (m.readme || 0);
    var common = Object.keys(D.df).sort(function (a, b) { return D.df[b] - D.df[a]; }).slice(0, 10);
    add(main, h('section', { class: 'hero' },
      h('h1', null, 'Which open-source sustainability tools share data formats?'),
      h('p', { class: 'lede' }, 'Plug Map reads each tool’s code and shows the formats it reads and writes, with evidence. Shared formats, not verified compatibility.'),
      common.length ? h('p', { class: 'hero-marks', 'aria-label': 'Found most often: ' + common.map(function (k) { return D.V[k].l; }).join(', ') },
        common.map(function (k) { var el = mark(k); el.title = D.V[k].l; return el; })) : null,
      h('p', { class: 'hero-meta' }, plural(D.tools.length, 'tool') + ' · ' + plural(claims, 'claim'),
        idx.snapshot ? [' · ', h('a', { href: '#/about' }, 'snapshot ' + snapshotText(idx.snapshot))] : null)));

    // Mapped categories are the way in; the rest are named once, in rollout order.
    var waiting = idx.cats.filter(function (c) { return c.s !== 'mapped'; });
    var next = waiting.filter(function (c) { return c.s === 'next'; });
    add(main, h('section', { class: 'stack' },
      h('h2', null, 'Categories'),
      h('div', { class: 'cat-list' }, D.mapped.map(function (c) {
        return h('a', { class: 'cat-row', href: catHref(c.slug) },
          h('span', { class: 'cat-name' }, c.n),
          h('span', { class: 'cat-count' }, plural((D.byCat[c.n] || []).length, 'tool')));
      })),
      waiting.length ? h('p', { class: 'small muted' }, next.length
        ? 'Next: ' + next.map(function (c) { return c.n; }).join(', ') + (waiting.length > next.length ? ' · ' + (waiting.length - next.length) + ' more queued' : '')
        : waiting.length + ' more categories queued') : null));
  }

  // The method and the overall picture, shown on the About page.
  function dataSections() {
    var idx = D.raw, m = idx.methods || {};
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
      multi.length ? h('div', { class: 'matrix', role: 'table', 'aria-label': 'Tools using each format, by category', style: '--cols:' + D.mapped.length },
        h('div', { class: 'matrix-row matrix-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Shared by'),
          D.mapped.map(function (c) { return h('span', { role: 'columnheader' }, c.n); })),
        multi.map(function (k) {
          return h('div', { class: 'matrix-row', role: 'row' }, h('span', { role: 'rowheader' }, termName(k, null, { style: 'font-weight:500' })),
            D.mapped.map(function (c) {
              var n = counts[k][c.n] || 0;
              return h('span', { class: 'matrix-cell' + (n ? '' : ' zero'), role: 'cell' },
                bar(n / maxCell, 'green'), h('span', { class: 'num' }, n));
            }));
        })) : h('p', { class: 'small muted' }, 'Bridges appear once two or more categories are mapped.'));

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
    return [strengthPanel(), h('div', { class: 'row-wrap' }, bridges, how)];
  }

  // How much the evidence shows for the links between tools, across everything mapped so far.
  function strengthPanel() {
    var s = linkStrength();
    var share = function (n) {
      if (!s.total) { return '–'; }
      var p = 100 * n / s.total;
      return (p > 0 && p < 1 ? p.toFixed(1) : Math.round(p)) + '%';
    };
    var top = function (terms, max) {
      return Object.keys(terms).sort(function (a, b) { return terms[b] - terms[a]; }).slice(0, max);
    };
    var names = function (keys) { return keys.map(function (k) { return D.V[k].l; }).join(', '); };
    var via = [top(s.terms[0], 3), top(s.terms[1], 4), top(s.terms[2], 4)];
    var detail = [
      'Through ' + names(via[0]) + ' files with the same ' +
        Object.keys(s.profiles).map(function (id) { return (D.raw.profiles || {})[id] || id; }).join(' or '),
      'Through ' + names(via[1]),
      'Mostly through ' + names(via[2])];
    var cats = D.mapped.map(function (c) { return c.n; });
    var label = s.total ? tierName.map(function (t, i) { return t + ': ' + share(s.n[i]); }).join(', ') : '';
    return h('section', { class: 'panel strength' },
      h('h2', null, 'How strong are the links between tools?'),
      h('p', { class: 'small muted' }, s.total
        ? fmt(s.total) + ' links: one tool writes a format in its own code and another reads it in theirs. A shared format shows two tools could fit together, not that they do, so each link is labelled by how much the evidence shows.'
        : 'No links yet: they appear once tools in the mapped categories write and read the same format in their code.'),
      s.total ? [
        h('div', { class: 'spectrum', role: 'img', 'aria-label': label }, s.n.map(function (n, i) {
          return n ? h('span', { class: 'spectrum-seg fill ' + tierTone[i], style: 'flex-grow:' + n }) : null;
        })),
        h('div', { class: 'tiers' }, tierName.map(function (t, i) {
          return h('div', { class: 'tier', title: tierNote[i] },
            h('span', { class: 'tier-name' }, h('span', { class: 'swatch fill ' + tierTone[i], 'aria-hidden': 'true' }), t),
            h('span', { class: 'tier-share' }, share(s.n[i])),
            h('span', { class: 'tier-count' }, plural(s.n[i], 'link')),
            h('span', { class: 'small muted' }, tierNote[i]),
            s.n[i] ? h('span', { class: 'tier-via' }, h('span', { class: 'marks', 'aria-hidden': 'true' }, via[i].map(function (k) { return mark(k, 'sm'); })),
              h('span', { class: 'tiny muted' }, detail[i])) : null);
        }))] : null,
      h('p', { class: 'tiny muted' }, 'Counted across the ' + plural(cats.length, 'mapped category', 'mapped categories') + ' (' + cats.join(', ') +
        '), and recounted whenever a category is added.'));
  }

  // ---------- category ----------
  function renderCategory(meta) {
    var ts = D.byCat[meta.n] || [];
    var st = catState[meta.slug] = catState[meta.slug] || { sub: 'all', q: '', limit: PAGE };
    var V = D.V;
    add(main, crumbs([{ label: meta.n }]));
    add(main, h('section', { class: 'page-head' },
      h('h1', null, meta.n),
      h('p', { title: 'The rest could not be cloned (moved, private or not a git host).' },
        ts.length + ' of ' + meta.total + ' catalog tools read' + (meta.mapped ? ' · mapped ' + fmtDay(meta.mapped) : ''))));

    var rd = {}, wr = {};
    ts.forEach(function (t) {
      t.reads.forEach(function (k) { rd[k] = (rd[k] || 0) + 1; });
      t.writes.forEach(function (k) { wr[k] = (wr[k] || 0) + 1; });
    });
    var tot = function (k) { return (rd[k] || 0) + (wr[k] || 0); };
    var fkeys = Object.keys(Object.assign({}, rd, wr)).sort(function (a, b) { return tot(b) - tot(a); }).slice(0, 8);
    var fmax = 1;
    fkeys.forEach(function (k) { fmax = Math.max(fmax, rd[k] || 0, wr[k] || 0); });
    // A bar that grows out from the centre line, leaving room for its count at the outer end.
    var dvBar = function (frac, color) {
      return h('span', { class: 'fill dv-fill ' + color, style: 'width:calc((100% - 3rem) * ' + Math.round(frac * 1000) / 1000 + ')' });
    };
    add(main, h('section', { class: 'section' },
      h('h2', null, 'Who reads and who writes'),
      h('p', { class: 'small muted' }, 'Number of tools, from calls in each tool’s own code.'),
      fkeys.length ? [h('div', { class: 'dv-head', 'aria-hidden': 'true' }, h('span', null, ''), h('span', null, 'reads'), h('span', null, 'writes'))].concat(fkeys.map(function (k) {
        return h('div', { class: 'dv' },
          h('span', { class: 'dv-name' }, slot(k), h('span', null, V[k].l)),
          h('span', { class: 'dv-left' }, h('span', { class: 'num small' }, rd[k] || 0), dvBar((rd[k] || 0) / fmax, 'blue')),
          h('span', { class: 'dv-right' }, dvBar((wr[k] || 0) / fmax, 'green'), h('span', { class: 'num small' }, wr[k] || 0)));
      })) : h('p', { class: 'small muted' }, 'No read or write calls found yet.')));

    // Tool list with a sub-category filter and search. Only the list re-renders on input, so focus stays put.
    var subCounts = {};
    ts.forEach(function (t) { subCounts[t.sc] = (subCounts[t.sc] || 0) + 1; });
    var listBox = h('div', { class: 'stack' });
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
          var keys = Array.from(t.plugs).sort(function (a, b) { return (D.df[a] || 0) - (D.df[b] || 0); });
          return h('a', { class: 'list-row', href: toolHref(t) },
            h('span', { class: 'stack', style: 'gap:0;min-width:0' }, h('span', { class: 'name' }, t.n),
              h('span', { class: 'small muted' }, t.sc)),
            h('span', { class: 'marks', title: keys.slice(0, 5).map(function (k) { return V[k].l; }).join(', ') },
              keys.slice(0, 5).map(function (k) { return mark(k, 'sm'); }),
              keys.length > 5 ? h('span', { class: 'marks-more' }, '+' + (keys.length - 5)) : null));
        })));
      }
      if (rows.length > st.limit) {
        add(listBox, h('button', { type: 'button', class: 'btn ghost', onclick: function () { st.limit += PAGE; drawList(); } }, 'Show more tools'));
      }
    }
    drawList();
    var search = h('input', { id: 'toolSearch', class: 'search', type: 'search', value: st.q, placeholder: 'Search name, format or description',
      'aria-label': 'Search tools in this category', oninput: function (e) { st.q = e.target.value; st.limit = PAGE; drawList(); } });
    var subs = Object.keys(subCounts).sort(function (a, b) { return subCounts[b] - subCounts[a]; });
    var filter = h('select', { class: 'search select', 'aria-label': 'Filter by sub-category',
      onchange: function (e) { st.sub = e.target.value; st.limit = PAGE; drawList(); } },
      h('option', { value: 'all', selected: st.sub === 'all' }, 'All sub-categories'),
      subs.map(function (sc) { return h('option', { value: sc, selected: st.sub === sc }, sc + ' (' + subCounts[sc] + ')'); }));
    add(main, h('section', { class: 'section' },
      h('h2', null, 'Tools'), h('div', { class: 'toolbar' }, search, filter), listBox));
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
      h('h1', null, t.n),
      t.d ? h('p', null, t.d) : null,
      h('div', { class: 'facts' },
        h('a', { href: t.u, target: '_blank', rel: 'noopener' }, 'Repository'),
        h('span', null, plural(t.st, 'star')),
        t.a ? h('span', null, 'last commit ' + t.a) : null,
        t.p ? h('span', { class: 'mono tiny', title: 'Package-URL' + (t.pb ? ' (' + t.pb + ')' : '') + (t.k ? ', read at ' + t.k.slice(0, 10) : '') }, t.p) : null)));

    var methodLabel = { code: 'code', dependency: 'dependency', readme: 'README' };
    var byItem = {};
    t.cl.forEach(function (c) {
      if (!V[c.i]) { return; }
      var e = byItem[c.i] = byItem[c.i] || { roles: {}, methods: {}, other: null };
      e.methods[methodLabel[c.m] || c.m] = true;
      if (c.m === 'code') { if (!e.roles[c.r] || (e.roles[c.r].x && !c.x)) { e.roles[c.r] = c; } } else if (!e.other) { e.other = c; }
    });
    var order = [['reads', 'Reads'], ['writes', 'Writes'], ['speaks', 'Speaks'], ['pulls', 'Pulls data from'], ['uses', 'Also uses']];
    var rank = function (k) { return D.spec(k) ? 0 : 1; };
    var groups = order.map(function (o) {
      var role = o[0];
      var keys = Object.keys(byItem).filter(function (k) {
        return role === 'uses' ? Object.keys(byItem[k].roles).length === 0 : !!byItem[k].roles[role];
      }).sort(function (a, b) { return (rank(a) - rank(b)) || ((D.df[a] || 0) - (D.df[b] || 0)); });
      if (!keys.length) { return null; }
      return h('div', { class: 'section', style: 'gap:0' },
        h('h2', null, o[1]),
        keys.map(function (k) {
          var c = role === 'uses' ? byItem[k].other : byItem[k].roles[role];
          return h('div', { class: 'claim', title: 'Found in ' + Object.keys(byItem[k].methods).join(', ') }, mark(k),
            h('div', { class: 'claim-body' },
              h('span', { class: 'claim-head' }, h('span', { class: 'label' }, V[k].l),
                c.x ? h('span', { class: 'tag aux', title: 'Not counted as a direction: the call is not in the tool’s own code' }, 'only in ' + c.x) : null),
              evidence(t, c),
              c.pf ? h('span', { class: 'ev', title: 'Variable names and conventions in the code of the files that make this call' },
                'In files with this call: ' + profileText(c.pf)) : null));
        }));
    }).filter(Boolean);
    var left = h('section', { class: 'grow stack', style: 'gap:40px' },
      groups.length ? groups : h('p', { class: 'muted' }, 'No formats, protocols or data sources detected yet for this tool. That usually means the vocabulary doesn’t cover what it uses yet; see Vocabulary.'));

    // Every link is a shared format with the direction found in code, but the evidence differs.
    // Tier 0: same variable names or conventions inside the file (a profile match).
    // Tier 1: a domain format, which fixes what the data means (vocabulary `semantic: true`).
    // Tier 2: only a container such as NetCDF or HDF5; nothing shows the contents line up.
    // Rarer formats rank higher within a tier.
    function neighbours(mine, other, myRole, theirRole) {
      var score = {};
      mine.forEach(function (k) {
        var my = t.pf[myRole][k];
        (other[k] || []).forEach(function (u) {
          if (u === t) { return; }
          var key = toolKey(u);
          var e = score[key] = score[key] || { u: u, w: 0, via: [], shared: [], sem: false, named: {} };
          e.w += D.idf[k] || 0; e.via.push(k);
          if (D.sem(k)) { e.sem = true; }
          var theirs = u.pf[theirRole][k];
          if (my && theirs) { my.forEach(function (x) { if (theirs.has(x)) { e.shared.push(x); e.named[k] = true; } }); }
        });
      });
      return Object.keys(score).map(function (k) {
        var e = score[k]; e.tier = e.shared.length ? 0 : e.sem ? 1 : 2;
        // Name the formats that earned the label first, then rarer ones.
        var key = function (x) { return e.named[x] ? 0 : D.sem(x) ? 1 : 2; };
        e.via.sort(function (a, b) { return (key(a) - key(b)) || ((D.idf[b] || 0) - (D.idf[a] || 0)); });
        e.keys = e.via;
        e.via = e.keys.map(function (x) { return V[x].l; });
        return e;
      }).sort(function (a, b) { return (a.tier - b.tier) || (b.w - a.w) || (b.u.st - a.u.st); });
    }
    function side(title, note, verb, list, none) {
      var counts = [0, 0, 0], rows = [], last = -1;
      list.forEach(function (e) { counts[e.tier]++; });
      // Grouped under the label each link earned, so the label is said once per group, not on every row.
      list.slice(0, 5).forEach(function (e) {
        if (e.tier !== last) {
          last = e.tier;
          rows.push(h('h3', { class: 'nb-tier', title: tierNote[e.tier] },
            h('span', { class: 'swatch fill ' + tierTone[e.tier], 'aria-hidden': 'true' }), tierName[e.tier], h('span', { class: 'chip-count' }, counts[e.tier])));
        }
        rows.push(h('a', { class: 'nb', href: toolHref(e.u) }, h('span', { class: 'name' }, e.u.n),
          h('span', { class: 'nb-via' }, h('span', { class: 'marks', 'aria-hidden': 'true' }, e.keys.slice(0, 3).map(function (k) { return mark(k, 'sm'); })),
            h('span', { class: 'tiny muted' }, verb + ' ' + e.via.slice(0, 3).join(', ') + ' · ' + e.u.c)),
          e.shared.length ? h('span', { class: 'tiny' }, 'Same ' + profileText(e.shared, 3)) : null));
      });
      return h('section', { class: 'section', style: 'gap:4px' },
        h('h2', null, title),
        h('p', { class: 'small muted' }, note),
        list.length ? rows : h('span', { class: 'small muted' }, none),
        list.length > 5 ? h('span', { class: 'tiny muted', style: 'padding-top:6px' }, (list.length - 5) + ' more') : null);
    }
    var right = h('aside', { class: 'side stack', style: 'gap:40px' },
      side('Upstream', 'Tools that write what this one reads.', 'writes', neighbours(t.reads, D.writersOf, 'reads', 'writes'), 'None found yet.'),
      side('Downstream', 'Tools that read what this one writes.', 'reads', neighbours(t.writes, D.readersOf, 'writes', 'reads'), 'None found yet.'));
    add(main, h('div', { class: 'row-wrap', style: 'gap:56px' }, left, right));
  }

  // ---------- vocabulary ----------
  function renderVocab() {
    var V = D.V, idx = D.raw, props = idx.proposed || [];
    add(main, crumbs([{ label: 'Vocabulary' }]));
    add(main, h('section', { class: 'page-head' },
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
            return h('span', { class: 'term' + (n ? '' : ' unseen') }, termName(k, 'sm', { class: n ? null : 'zero' }),
              h('span', { class: 'tiny muted' }, kindName[V[k].k] || V[k].k),
              h('span', { class: 'num' }, plural(n, 'tool')));
          }));
      })));
  }

  // ---------- about ----------
  // Domain formats by layer, from the vocabulary (`semantic: true`), e.g. "PyPSA network format (energy pack)".
  function semList() {
    var byLayer = {};
    Object.keys(D.V).forEach(function (k) { if (D.sem(k)) { (byLayer[layerName(k)] = byLayer[layerName(k)] || []).push(D.V[k].l); } });
    var out = Object.keys(byLayer).map(function (l) { return byLayer[l].sort().join(', ') + ' (' + l + ')'; });
    return out.length ? out.join('; ') : 'none yet';
  }
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
        h('li', null, h('b', null, 'Upstream / downstream'), ': tools that write what this one reads, or read what it writes, from calls in their own code (not tests or examples). A shared format shows the tools could fit together, not that they do, so each link is labelled by how much the evidence shows:',
          h('ul', null,
            h('li', null, h('b', null, 'Same variable names'), ': the files that read and write the format also use the same variable names or conventions (see below). The strongest sign.'),
            h('li', null, h('b', null, 'Domain format'), ': a format that fixes what the data means, not only how it is stored. Each vocabulary pack marks its own. Marked so far: ' + semList() + '.'),
            h('li', null, h('b', null, 'Container format only'), ': a shared container such as NetCDF, HDF5, Parquet or GeoPackage. Two tools can both use one and still name, scale or grid the data differently. Most links are of this kind today.')),
          'Within each label, matches on rarer formats rank higher.'),
        h('li', null, h('b', null, 'Data snapshot'), ': the day a category’s repositories were read. Each claim links to the commit read that day, so it stays checkable after the tool changes. Categories are re-mapped from time to time, so the date can differ between categories.'),
        h('li', null, h('b', null, 'Same variable names'), ': for NetCDF, Zarr and HDF5, Plug Map also records the CF standard names, ERA5 variable names and CF conventions in the code of the file that reads or writes. Two tools that share them are more likely to really fit together than two that only share a format, so they are listed first. Names elsewhere in a tool’s code are not seen, so a missing match doesn’t mean the tools don’t fit.'),
        h('li', null, 'Claims are machine-made. A spot check of code claims found them accurate, but a README mention can be loose. Each claim shows its evidence so you can judge.')),
      h('h2', null, 'Licence and citation'),
      h('p', null, 'The data is published under ', h('a', { href: 'https://creativecommons.org/licenses/by/4.0/' }, 'CC BY 4.0'),
        ' and the code under the MIT licence. Star counts and last-commit dates come from ', h('a', { href: 'https://ecosyste.ms' }, 'ecosyste.ms'),
        ' (CC BY-SA 4.0); evidence quotes come from each tool’s own repository. To cite Plug Map, use its CITATION.cff and give the data build date.'),
      h('p', { class: 'small' }, 'Plug Map by AbdulSalam416, CC BY 4.0. Data snapshot ' + snapshotText(D.raw.snapshot) + '.')));
    add(main, h('section', { class: 'stack', style: 'gap:48px' },
      h('h2', { class: 'section-title', id: 'data' }, 'The data so far'), dataSections()));
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
    main.removeAttribute('aria-busy');
    add(main, h('section', { class: 'panel' }, h('h2', null, 'Could not load the data'),
      h('p', { class: 'error' }, msg),
      h('button', { type: 'button', class: 'btn', onclick: function () { location.reload(); } }, 'Try again'),
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
      main.removeAttribute('aria-busy');
      route();
    });
  }).catch(function (e) { fail(e.message); });
  window.addEventListener('hashchange', route);
})();
