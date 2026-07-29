/**
 * Read-only monitoring dashboard page.
 * Zero-build: the whole app (styles + sankey layout + renderer) is inlined
 * and served as a single HTML document. No external requests are made, so the
 * page works fully offline behind the gateway's own auth.
 *
 * The centerpiece is a three-column flow diagram (request → model → plan)
 * whose edge widths encode token volume, with per-edge request counts and
 * failure highlighting.
 */

const MARKER_COLORS = [
  '#7dcfff', '#bb9af7', '#9ece6a', '#e0af68', '#ff9e64',
  '#2ac3de', '#f7768e', '#73daca', '#b4f9f8', '#c0caf5',
];

/**
 * The client-side application script. Kept as a plain string so the server
 * needs no bundler; written in ES5-safe syntax to run in any modern browser.
 */
const CLIENT_SCRIPT = String.raw`
(function () {
  'use strict';

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function fmtNum(n) {
    if (n == null || isNaN(n)) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function fmtDur(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return Math.round(ms) + 'ms';
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString(); } catch (e) { return iso; }
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortKey(name) {
    if (!name || name === 'anonymous') return 'anonymous';
    return name.length > 14 ? name.slice(0, 12) + '…' : name;
  }

  var MARKER_COLORS = __MARKER_COLORS__;

  // ---------- state ----------
  var state = {
    apiKey: sessionStorage.getItem('cpg_dash_key') || '',
    minutes: 15,
    autoTimer: null,
    flows: [],
    summary: null,
    errors: [],
    hover: null,
    pinned: null,
    colorBy: new Map(),
    nodeColors: {},
    lastErr: '',
  };

  // ---------- fetch ----------
  function headers() {
    var h = { 'Accept': 'application/json' };
    if (state.apiKey) h['Authorization'] = 'Bearer ' + state.apiKey;
    return h;
  }

  function fetchJson(url) {
    return fetch(url, { headers: headers() }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        showKeyPrompt(true);
        throw new Error('unauthorized');
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function refreshAll() {
    setStatus('刷新中…');
    Promise.all([
      fetchJson('/api/dashboard/flows?minutes=' + state.minutes),
      fetchJson('/api/dashboard/summary'),
      fetchJson('/api/dashboard/errors'),
    ]).then(function (results) {
      state.flows = results[0].flows || [];
      state.summary = results[1];
      state.errors = (results[2] && results[2].errors) || [];
      state.lastErr = '';
      setStatus('更新于 ' + new Date().toLocaleTimeString() + ' · 共 ' + state.flows.length + ' 条记录');
      render();
      scheduleAuto();
    }).catch(function (err) {
      if (String(err.message) !== 'unauthorized') {
        state.lastErr = String(err);
        setStatus('请求失败：' + err.message);
      }
      scheduleAuto();
    });
  }

  function scheduleAuto() {
    if (state.autoTimer) clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(refreshAll, 5000);
  }

  // ---------- aggregation ----------
  function nodeId(kind, name) { return kind + ':' + name; }

  function aggregate(flows) {
    var nodes = new Map();
    var edges = new Map();

    function ensureNode(kind, name) {
      var id = nodeId(kind, name);
      if (!nodes.has(id)) {
        nodes.set(id, { id: id, kind: kind, name: name, inTok: 0, outTok: 0, requests: 0, failed: 0, errors: 0 });
      }
      return nodes.get(id);
    }
    function ensureEdge(source, target) {
      var key = source + '->' + target;
      if (!edges.has(key)) {
        edges.set(key, { source: source, target: target, tokens: 0, requests: 0, errors: 0, maxDur: 0, sumDur: 0 });
      }
      return edges.get(key);
    }

    for (var i = 0; i < flows.length; i++) {
      var f = flows[i];
      var tok = f.totalTokens || 0;
      var failed = f.status >= 400;
      var keyName = f.apiKey || 'anonymous';
      var modelName = f.model || 'unknown';
      var servedName = (f.canonicalModel && f.canonicalModel !== f.model) ? f.canonicalModel : null;
      var planName = f.plan || '—';

      var nKey = ensureNode('request', keyName);
      var nModel = ensureNode('model', modelName);
      var nPlan = ensureNode('plan', planName);

      nKey.outTok += tok; nKey.requests++;
      nModel.inTok += tok; nModel.outTok += tok; nModel.requests++;
      nPlan.inTok += tok; nPlan.requests++;
      if (failed) { nKey.failed++; nModel.failed++; nPlan.failed++; }

      var e1 = ensureEdge(nKey.id, nModel.id);
      var leafModel = nModel;
      if (servedName) {
        var nServed = ensureNode('served', servedName);
        nServed.inTok += tok; nServed.outTok += tok; nServed.requests++;
        if (failed) nServed.failed++;
        var eMid = ensureEdge(nModel.id, nServed.id);
        eMid.tokens += tok; eMid.requests++; if (failed) eMid.errors++;
        eMid.sumDur += f.durationMs; if (f.durationMs > eMid.maxDur) eMid.maxDur = f.durationMs;
        leafModel = nServed;
      }
      var e2 = ensureEdge(leafModel.id, nPlan.id);

      [e1, e2].forEach(function (e) {
        e.tokens += tok; e.requests++;
        if (failed) e.errors++;
        e.sumDur += f.durationMs;
        if (f.durationMs > e.maxDur) e.maxDur = f.durationMs;
      });
    }

    return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
  }

  // ---------- sankey layout (relaxation) ----------
  var NODE_W = 16;

  function layoutSankey(graph, width, height) {
    var columns = [[], [], [], []];
    var kinds = ['request', 'model', 'served', 'plan'];
    graph.nodes.forEach(function (n) {
      var idx = kinds.indexOf(n.kind);
      if (idx === 2 && graph.nodes.every(function (m) { return m.kind !== 'served'; })) {
        return; // no served nodes at all
      }
      columns[idx].push(n);
    });
    var colHasServed = columns[2].length > 0;
    var activeCols = colHasServed ? 4 : 3;
    var planCol = colHasServed ? 3 : 2;

    // x positions
    var xPad = 8;
    var colW = (width - xPad * 2) / (activeCols - 1);
    graph.nodes.forEach(function (n) {
      var idx = kinds.indexOf(n.kind);
      if (n.kind === 'plan') idx = planCol;
      n.x0 = xPad + colW * idx;
      n.x1 = n.x0 + NODE_W;
    });

    // node/edge value: token volume; fall back to request counts so a window
    // with only zero-token records (e.g. pure failures) still renders visibly
    graph.nodes.forEach(function (n) {
      n.value = Math.max(n.inTok, n.outTok);
      if (n.value === 0) n.value = n.requests;
    });
    graph.edges.forEach(function (e) {
      if (e.tokens === 0) e.value = e.requests; else e.value = e.tokens;
    });

    var gap = 14;
    // Use a single global scale across all columns so node heights stay
    // comparable (a 4.8k-token model node is visibly larger than a 1-token one
    // in every column, not scaled independently per column).
    var maxColTotal = 1;
    var maxColCount = 1;
    columns.forEach(function (col) {
      var total = 0;
      col.forEach(function (n) { total += n.value; });
      if (total > maxColTotal) maxColTotal = total;
      if (col.length > maxColCount) maxColCount = col.length;
    });
    var globalAvail = height - gap * (maxColCount - 1) - 16;
    var globalScale = Math.min(1, globalAvail / maxColTotal);
    columns.forEach(function (col) {
      if (col.length === 0) return;
      var y = 8;
      col.forEach(function (n) {
        n._h = Math.max(4, n.value * globalScale);
        n.y0 = y;
        n.y1 = y + n._h;
        y = n.y1 + gap;
      });
    });

    // relaxation: pull nodes toward the barycenter of their neighbors
    var iters = 24;
    var nodeById = new Map();
    graph.nodes.forEach(function (n) { nodeById.set(n.id, n); });
    var realEdges = [];
    graph.edges.forEach(function (e) {
      e.s = nodeById.get(e.source);
      e.t = nodeById.get(e.target);
      if (e.s && e.t) realEdges.push(e);
    });
    graph.edges = realEdges;

    function center(n) { return (n.y0 + n.y1) / 2; }

    for (var it = 0; it < iters; it++) {
      var alpha = 0.6 * (1 - it / iters);
      columns.forEach(function (col) {
        col.forEach(function (n) {
          var sum = 0, wsum = 0;
          graph.edges.forEach(function (e) {
            if (e.t === n) { sum += center(e.s) * e.value; wsum += e.value; }
            if (e.s === n) { sum += center(e.t) * e.value; wsum += e.value; }
          });
          if (wsum > 0) {
            var target = sum / wsum;
            var cur = center(n);
            var delta = (target - cur) * alpha;
            n.y0 += delta; n.y1 += delta;
          }
        });
        // resolve overlaps top-down
        col.sort(function (a, b) { return a.y0 - b.y0; });
        var minY = 8;
        col.forEach(function (n) {
          if (n.y0 < minY) { var d = minY - n.y0; n.y0 += d; n.y1 += d; }
          minY = n.y1 + gap;
        });
        // clamp bottom
        var over = minY - gap - height + 8;
        if (over > 0) {
          for (var k = col.length - 1; k >= 0; k--) {
            col[k].y0 -= over; col[k].y1 -= over;
            if (col[k].y0 < 8) { var dd = 8 - col[k].y0; col[k].y0 += dd; col[k].y1 += dd; }
          }
        }
      });
    }

    // After relaxation, vertically re-fit each column so the content fills the
    // available height instead of clustering at the top (single large node)
    // or the bottom. Node heights are preserved; only their distribution shifts.
    columns.forEach(function (col) {
      if (col.length === 0) return;
      col.sort(function (a, b) { return a.y0 - b.y0; });
      var top = 8;
      if (col.length === 1) {
        // a lone node centers vertically in the canvas
        var n0 = col[0];
        var h0 = n0.y1 - n0.y0;
        var cy = (height - h0) / 2;
        n0.y0 = Math.max(top, cy);
        n0.y1 = n0.y0 + h0;
        return;
      }
      var contentBottom = col[col.length - 1].y1;
      var contentTop = col[0].y0;
      var span = contentBottom - contentTop;
      var avail = height - 16;
      if (span <= 0 || span >= avail) return;
      // stretch gaps so the column spans the full height, keeping node heights
      var extra = avail - span;
      var gaps = col.length - 1; // between nodes only (keep top/bottom padding)
      var per = extra / gaps;
      var acc = top;
      col.forEach(function (n) {
        var h = n.y1 - n.y0;
        n.y0 = acc;
        n.y1 = acc + h;
        acc = n.y1 + gap + per;
      });
    });

    // edge endpoints: distribute along each node's height by value, stable order
    var bySource = new Map();
    var byTarget = new Map();
    graph.edges.forEach(function (e) {
      if (!bySource.has(e.s.id)) bySource.set(e.s.id, []);
      bySource.get(e.s.id).push(e);
      if (!byTarget.has(e.t.id)) byTarget.set(e.t.id, []);
      byTarget.get(e.t.id).push(e);
    });
    bySource.forEach(function (list) {
      list.sort(function (a, b) { return center(a.t) - center(b.t); });
      var n = list[0].s;
      var y = n.y0;
      list.forEach(function (e) {
        e._w = Math.max(1.5, (e.value / Math.max(n.value, 1)) * (n.y1 - n.y0));
        e.sy = y + e._w / 2;
        y += e._w;
      });
    });
    byTarget.forEach(function (list) {
      list.sort(function (a, b) { return center(a.s) - center(b.s); });
      var n = list[0].t;
      var y = n.y0;
      list.forEach(function (e) {
        e.ty = y + e._w / 2;
        y += e._w;
      });
    });

    // minimum visual thickness for failure edges (0-token chains would
    // otherwise collapse to a hairline and be invisible next to token flows)
    graph.edges.forEach(function (e) {
      if (e.errors > 0 && e._w < 3) e._w = 3;
    });

    return graph;
  }

  // ---------- rendering ----------
  var svgNS = 'http://www.w3.org/2000/svg';

  function colorFor(name) {
    if (!state.colorBy.has(name)) {
      state.colorBy.set(name, MARKER_COLORS[state.colorBy.size % MARKER_COLORS.length]);
    }
    return state.colorBy.get(name);
  }

  function edgeColor(e) {
    var srcName = e.s.name;
    return colorFor(srcName);
  }

  function pathFor(e) {
    var x0 = e.s.x1, x1 = e.t.x0;
    var xi = (x0 + x1) / 2;
    var y0 = e.sy, y1 = e.ty;
    return 'M' + x0 + ',' + y0 +
      'C' + xi + ',' + y0 + ' ' + xi + ',' + y1 + ' ' + x1 + ',' + y1;
  }

  function renderGraph() {
    var wrap = $('#flowWrap');
    wrap.innerHTML = '';
    var flows = state.flows;
    var graph = aggregate(flows);
    // A window with no records still shows every configured plan as a zero-traffic
    // node, so the diagram communicates "idle" rather than rendering empty
    var knownPlans = Object.keys((state.summary && state.summary.localQuota) || {})
      .concat(Object.keys((state.summary && state.summary.providerUsage) || {}));
    knownPlans.forEach(function (name) {
      if (!graph.nodes.some(function (n) { return n.kind === 'plan' && n.name === name; })) {
        graph.nodes.push({ id: nodeId('plan', name), kind: 'plan', name: name,
          inTok: 0, outTok: 0, requests: 0, failed: 0 });
      }
    });
    if (graph.edges.length === 0 && graph.nodes.length === 0) {
      wrap.innerHTML = '<div class="empty">该时间窗口内暂无代理请求记录</div>';
      return;
    }
    var width = Math.max(wrap.clientWidth, 640);
    var perCol = { request: 0, model: 0, served: 0, plan: 0 };
    graph.nodes.forEach(function (n) { perCol[n.kind] = (perCol[n.kind] || 0) + 1; });
    var maxCol = Math.max(perCol.request, perCol.model, perCol.served, perCol.plan, 1);
    // ~64px per stacked node gives labels room; failures get a badge line too
    var height = Math.max(340, Math.min(820, maxCol * 64 + 70));
    layoutSankey(graph, width, height);

    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);

    // defs: gradients per edge
    var defs = document.createElementNS(svgNS, 'defs');
    graph.edges.forEach(function (e, i) {
      var g = document.createElementNS(svgNS, 'linearGradient');
      g.setAttribute('id', 'eg' + i);
      g.setAttribute('x1', '0%'); g.setAttribute('y1', '0%');
      g.setAttribute('x2', '100%'); g.setAttribute('y2', '0%');
      var c1 = document.createElementNS(svgNS, 'stop');
      c1.setAttribute('offset', '0%');
      c1.setAttribute('stop-color', edgeColor(e));
      var c2 = document.createElementNS(svgNS, 'stop');
      c2.setAttribute('offset', '100%');
      c2.setAttribute('stop-color', colorFor(e.t.name));
      g.appendChild(c1); g.appendChild(c2);
      defs.appendChild(g);
      e._grad = 'eg' + i;
    });
    svg.appendChild(defs);

    // edges
    var gEdges = document.createElementNS(svgNS, 'g');
    graph.edges.forEach(function (e) {
      var p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', pathFor(e));
      p.setAttribute('fill', 'none');
      var failed = e.errors > 0;
      p.setAttribute('stroke', 'url(#' + e._grad + ')');
      p.setAttribute('stroke-width', Math.max(1.5, e._w));
      p.setAttribute('stroke-opacity', failed ? '0.85' : '0.38');
      if (failed) p.setAttribute('stroke-dasharray', '6 3');
      p.classList.add('flow-edge');
      p.addEventListener('mousemove', function (ev) { showTip(ev, edgeTip(e)); });
      p.addEventListener('mouseleave', hideTip);
      gEdges.appendChild(p);
    });
    svg.appendChild(gEdges);

    // nodes
    var gNodes = document.createElementNS(svgNS, 'g');
    graph.nodes.forEach(function (n) {
      var g = document.createElementNS(svgNS, 'g');
      var rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', n.x0);
      rect.setAttribute('y', n.y0);
      var nodeW = n.kind === 'request' ? NODE_W + 44 : NODE_W;
      rect.setAttribute('width', nodeW);
      rect.setAttribute('height', Math.max(3, n.y1 - n.y0));
      rect.setAttribute('rx', 2);
      rect.setAttribute('fill', n.failed > 0 ? FAIL_COLOR : colorFor(n.name));
      rect.classList.add('flow-node');
      g.appendChild(rect);
      // keep x1 in sync for edges that originate from this node
      if (n.kind === 'request') n.x1 = n.x0 + nodeW;

      var label = document.createElementNS(svgNS, 'text');
      var left = n.kind === 'request';
      var name = n.kind === 'request' ? shortKey(n.name) : n.name;
      if (left) {
        // request-column label inside the widened node, dark text
        label.setAttribute('x', n.x0 + 5);
        label.setAttribute('y', n.y0 + 12);
        label.setAttribute('dy', '0.35em');
        label.setAttribute('text-anchor', 'start');
        label.classList.add('flow-label-in');
        label.textContent = name;
        g.appendChild(label);
        var sub = document.createElementNS(svgNS, 'text');
        sub.setAttribute('x', n.x0 + 5);
        sub.setAttribute('y', n.y0 + 26);
        sub.setAttribute('dy', '0.35em');
        sub.setAttribute('text-anchor', 'start');
        sub.classList.add('flow-label');
        sub.classList.add('flow-label-in');
        sub.textContent = fmtNum(n.value) + ' tok';
        g.appendChild(sub);
      } else {
        label.setAttribute('x', n.x1 + 6);
        label.setAttribute('y', (n.y0 + n.y1) / 2);
        label.setAttribute('dy', '0.35em');
        label.setAttribute('text-anchor', 'start');
        label.textContent = name + '  ·  ' + fmtNum(n.value) + ' tok';
        g.appendChild(label);
      }

      if (n.failed > 0) {
        var badge = document.createElementNS(svgNS, 'text');
        if (left) {
          // request column: badge inside the widened node, under the token line
          badge.setAttribute('x', n.x0 + 5);
          badge.setAttribute('y', n.y0 + 40);
          badge.setAttribute('text-anchor', 'start');
        } else {
          badge.setAttribute('x', n.x1 + 6);
          badge.setAttribute('y', (n.y0 + n.y1) / 2 + 14);
          badge.setAttribute('text-anchor', 'start');
        }
        badge.setAttribute('dy', '0.35em');
        badge.classList.add('flow-badge');
        badge.textContent = n.failed + ' 失败';
        g.appendChild(badge);
      }

      g.addEventListener('mousemove', function (ev) { showTip(ev, nodeTip(n)); });
      g.addEventListener('mouseleave', hideTip);
      gNodes.appendChild(g);
    });
    svg.appendChild(gNodes);

    wrap.appendChild(svg);
  }

  var FAIL_COLOR = '#f7768e';

  function edgeTip(e) {
    var failTxt = e.errors > 0 ? '<div class="tip-row err">失败 ' + e.errors + ' 次</div>' : '';
    var avg = e.requests > 0 ? Math.round(e.sumDur / e.requests) : 0;
    return '<div class="tip-title">' + escHtml(e.s.name) + ' → ' + escHtml(e.t.name) + '</div>' +
      '<div class="tip-row">' + fmtNum(e.tokens) + ' tokens · ' + e.requests + ' 次请求</div>' +
      '<div class="tip-row">平均耗时 ' + fmtDur(avg) + '</div>' + failTxt;
  }

  function nodeTip(n) {
    var failTxt = n.failed > 0 ? '<div class="tip-row err">失败 ' + n.failed + ' 次</div>' : '';
    var kindLabel = { request: '请求来源 (API Key)', model: '请求模型', served: '上游实际模型', plan: 'Plan' }[n.kind] || n.kind;
    return '<div class="tip-title">' + kindLabel + '：' + escHtml(n.name) + '</div>' +
      '<div class="tip-row">' + fmtNum(n.value) + ' tokens · ' + n.requests + ' 次请求</div>' + failTxt;
  }

  var tipEl = null;
  function showTip(ev, html) {
    if (!tipEl) { tipEl = $('#tooltip'); }
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    var x = ev.clientX + 14, y = ev.clientY + 10;
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    if (x + w > window.innerWidth - 10) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 10) y = ev.clientY - h - 10;
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  // ---------- side panels ----------
  function renderSummary() {
    var s = state.summary;
    if (!s) return;
    $('#statRequests').textContent = fmtNum(s.completedRequests || 0);
    $('#statFailed').textContent = fmtNum(s.failedRequests || 0);
    var winTok = 0, winReq = 0;
    state.flows.forEach(function (f) { winTok += f.totalTokens || 0; winReq++; });
    $('#statWindowTokens').textContent = fmtNum(winTok);
    $('#statWindowReq').textContent = fmtNum(winReq);

    // plan quota bars
    var pu = s.providerUsage || {};
    var lq = s.localQuota || {};
    var planRows = [];
    var seen = {};
    Object.keys(pu).forEach(function (name) {
      var maxPct = 0, label = '';
      (pu[name].windows || []).forEach(function (w) {
        if (w.percentage > maxPct) { maxPct = w.percentage; label = w.windowLabel || w.type; }
      });
      planRows.push({ name: name, pct: maxPct, sub: label, kind: 'usage' });
      seen[name] = true;
    });
    Object.keys(lq).forEach(function (name) {
      if (seen[name]) return;
      planRows.push({ name: name, pct: lq[name].percentage, sub: fmtNum(lq[name].used) + '/' + fmtNum(lq[name].limit), kind: 'local' });
    });
    if (planRows.length === 0) {
      $('#quotaList').innerHTML = '<div class="empty-sm">暂无配额数据</div>';
    } else {
      planRows.sort(function (a, b) { return b.pct - a.pct; });
      $('#quotaList').innerHTML = planRows.map(function (r) {
        var cls = r.pct >= 90 ? 'crit' : r.pct >= 70 ? 'warn' : 'ok';
        return '<div class="quota-row">' +
          '<div class="quota-head"><span class="quota-name">' + escHtml(r.name) + '</span>' +
          '<span class="quota-pct ' + cls + '">' + Math.round(r.pct) + '%</span></div>' +
          '<div class="quota-bar"><div class="quota-fill ' + cls + '" style="width:' + Math.min(100, r.pct) + '%"></div></div>' +
          '<div class="quota-sub">' + escHtml(r.sub || '') + '</div></div>';
      }).join('');
    }
  }

  function renderErrors() {
    var errs = state.errors || [];
    if (!errs.length) {
      $('#errorList').innerHTML = '<div class="empty-sm">暂无错误，运行正常</div>';
      return;
    }
    $('#errorList').innerHTML = errs.slice(0, 12).map(function (e) {
      var detail = e.error ? (e.error.message || e.error.name) : (e.message || '');
      var code = e.error && e.error.code ? ' [' + e.error.code + ']' : '';
      return '<div class="err-row">' +
        '<div class="err-time">' + fmtTime(e.timestamp) + '</div>' +
        '<div class="err-body"><span class="err-msg">' + escHtml(e.message || 'error') + code + '</span>' +
        (detail && detail !== e.message ? '<span class="err-detail">' + escHtml(detail) + '</span>' : '') +
        '</div></div>';
    }).join('');
  }

  function render() {
    renderGraph();
    renderSummary();
    renderErrors();
  }

  // ---------- auth prompt ----------
  function showKeyPrompt(show) {
    $('#keyPrompt').style.display = show ? 'flex' : 'none';
  }

  function setStatus(txt) { $('#status').textContent = txt; }

  // ---------- init ----------
  function init() {
    $('#refreshBtn').addEventListener('click', refreshAll);
    document.querySelectorAll('.time-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.time-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.minutes = parseInt(btn.getAttribute('data-minutes'), 10);
        refreshAll();
      });
    });
    $('#keySave').addEventListener('click', function () {
      state.apiKey = $('#keyInput').value.trim();
      sessionStorage.setItem('cpg_dash_key', state.apiKey);
      showKeyPrompt(false);
      refreshAll();
    });
    $('#keyClear').addEventListener('click', function () {
      state.apiKey = '';
      sessionStorage.removeItem('cpg_dash_key');
      $('#keyInput').value = '';
      showKeyPrompt(false);
      refreshAll();
    });
    $('#keyBtn').addEventListener('click', function () { showKeyPrompt(true); });
    window.addEventListener('resize', function () { renderGraph(); });

    refreshAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
`;

const STYLES = `
:root {
  --bg: #1a1b26;
  --bg-alt: #1f2335;
  --panel: #24283b;
  --border: #2f344d;
  --text: #c0caf5;
  --muted: #565f89;
  --brand: #7dcfff;
  --success: #9ece6a;
  --warning: #e0af68;
  --error: #f7768e;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
a { color: var(--brand); text-decoration: none; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border); }
.topbar h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: .5px; }
.topbar .sub { color: var(--muted); font-size: 12px; }
.topbar .spacer { flex: 1; }
.time-btn { background: transparent; border: 1px solid var(--border); color: var(--muted);
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.time-btn.active { color: var(--brand); border-color: var(--brand); }
.btn { background: var(--panel); border: 1px solid var(--border); color: var(--text);
  padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.btn:hover { border-color: var(--brand); }
#status { color: var(--muted); font-size: 12px; padding: 6px 20px 0; }
.stats { display: flex; gap: 14px; padding: 12px 20px 0; flex-wrap: wrap; }
.stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 16px; min-width: 130px; }
.stat-card .label { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.stat-card .value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-card .value.err { color: var(--error); }
.main { display: grid; grid-template-columns: 1fr 300px; gap: 14px; padding: 12px 20px 20px; }
@media (max-width: 980px) { .main { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.panel h2 { font-size: 12px; color: var(--muted); font-weight: 600; margin: 0;
  padding: 10px 14px; border-bottom: 1px solid var(--border); letter-spacing: .5px; }
#flowWrap { overflow-x: auto; padding: 8px 4px; min-height: 200px; }
.empty { color: var(--muted); text-align: center; padding: 60px 0; }
.empty-sm { color: var(--muted); padding: 14px; text-align: center; font-size: 12px; }
.flow-label { fill: var(--text); font-size: 11px; font-family: inherit; }
.flow-label-in { fill: #1a1b26; font-weight: 600; }
.flow-badge { fill: var(--error); font-size: 10px; font-family: inherit; }
.flow-node { cursor: default; }
.flow-edge { cursor: default; transition: stroke-opacity .12s; }
.flow-edge:hover { stroke-opacity: .7 !important; }
#tooltip { position: fixed; display: none; background: #16161e; border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 10px; pointer-events: none; z-index: 100;
  box-shadow: 0 4px 16px rgba(0,0,0,.5); max-width: 320px; }
.tip-title { font-weight: 600; margin-bottom: 4px; }
.tip-row { color: var(--text); font-size: 12px; }
.tip-row.err { color: var(--error); }
.quota-row { padding: 8px 14px; border-bottom: 1px solid var(--border); }
.quota-row:last-child { border-bottom: none; }
.quota-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
.quota-name { font-size: 12px; }
.quota-pct { font-size: 12px; font-variant-numeric: tabular-nums; }
.quota-pct.ok { color: var(--success); } .quota-pct.warn { color: var(--warning); }
.quota-pct.crit { color: var(--error); }
.quota-bar { height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.quota-fill { height: 100%; border-radius: 3px; transition: width .4s; }
.quota-fill.ok { background: var(--success); } .quota-fill.warn { background: var(--warning); }
.quota-fill.crit { background: var(--error); }
.quota-sub { color: var(--muted); font-size: 11px; margin-top: 3px; }
.err-row { display: flex; gap: 8px; padding: 7px 14px; border-bottom: 1px solid var(--border);
  font-size: 12px; align-items: baseline; }
.err-row:last-child { border-bottom: none; }
.err-time { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.err-body { min-width: 0; }
.err-msg { color: var(--error); display: block; }
.err-detail { color: var(--muted); display: block; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
#keyPrompt { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: none;
  align-items: center; justify-content: center; z-index: 200; }
#keyPrompt .dialog { background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 20px; width: 360px; }
#keyPrompt h3 { margin: 0 0 8px; font-size: 14px; }
#keyPrompt p { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
#keyInput { width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 4px; padding: 8px; font-size: 13px; margin-bottom: 12px; }
#keyPrompt .row { display: flex; gap: 8px; justify-content: flex-end; }
.legend { display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 11px; flex-wrap: wrap; }
.legend .sw { display: inline-block; width: 18px; height: 4px; border-radius: 2px;
  vertical-align: middle; margin-right: 5px; }
`;

/**
 * Render the dashboard HTML document.
 */
export function renderDashboardPage(): string {
  const script = CLIENT_SCRIPT.replace('__MARKER_COLORS__', JSON.stringify(MARKER_COLORS));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coding Plan Gateway · 监控仪表盘</title>
<style>${STYLES}</style>
</head>
<body>
${renderBody(script)}
</body>
</html>`;
}

/** Page body markup, kept separate to stay within function length limits */
// eslint-disable-next-line max-lines-per-function
function renderBody(script: string): string {
  return `<header class="topbar">
  <h1>Coding Plan Gateway</h1>
  <span class="sub">只读监控 · 请求流向</span>
  <div class="spacer"></div>
  <button class="time-btn active" data-minutes="15">15分钟</button>
  <button class="time-btn" data-minutes="60">1小时</button>
  <button class="time-btn" data-minutes="360">6小时</button>
  <button class="time-btn" data-minutes="1440">24小时</button>
  <button class="btn" id="refreshBtn">刷新</button>
  <button class="btn" id="keyBtn">API Key</button>
</header>
<div id="status">加载中…</div>
<section class="stats">
  <div class="stat-card"><div class="label">累计完成请求</div><div class="value" id="statRequests">–</div></div>
  <div class="stat-card"><div class="label">累计失败请求</div><div class="value err" id="statFailed">–</div></div>
  <div class="stat-card"><div class="label">窗口内 Tokens</div><div class="value" id="statWindowTokens">–</div></div>
  <div class="stat-card"><div class="label">窗口内请求数</div><div class="value" id="statWindowReq">–</div></div>
</section>
<main class="main">
  <div class="panel">
    <h2>请求流向 · 边宽 = Token 量</h2>
    <div id="flowWrap"></div>
    <div class="legend">
      <span><span class="sw" style="background:var(--brand)"></span>正常流量</span>
      <span><span class="sw" style="background:var(--error)"></span>含失败请求（虚线）</span>
      <span>列：API Key → 请求模型 →（改写后）上游模型 → Plan</span>
    </div>
  </div>
  <div>
    <div class="panel" style="margin-bottom:14px">
      <h2>Plan 配额用量</h2>
      <div id="quotaList"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>近期错误（上游 / 网关）</h2>
      <div id="errorList"><div class="empty-sm">加载中…</div></div>
    </div>
  </div>
</main>
<div id="tooltip"></div>
<div id="keyPrompt">
  <div class="dialog">
    <h3>访问令牌</h3>
    <p>仪表盘为只读接口，但默认受网关鉴权保护。请输入任意有效 API Key（仅保存在当前浏览器会话）。</p>
    <input id="keyInput" type="password" placeholder="cpg-…" autocomplete="off">
    <div class="row">
      <button class="btn" id="keyClear">清除</button>
      <button class="btn" id="keySave">保存并刷新</button>
    </div>
  </div>
</div>
<script>${script}</script>`;
}
