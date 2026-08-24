/**
 * Read-only monitoring dashboard page.
 * Zero-build: the whole app (styles + client script) is inlined and served as
 * a single HTML document. No external requests are made, so the page works
 * fully offline behind the gateway's own auth.
 *
 * Visual language follows the Operate-mode dashboard guidance distilled from
 * the Taste Skill / Impeccable design frameworks (see knowledge base):
 * tinted-neutral dark palette, restrained single accent, 8px spacing grid,
 * typographic hierarchy over boxes, tabular-nums for all figures, and
 * transitions kept under 300ms with ease-out entrances.
 *
 * Layout (reworked 2026-08, heatmap edition):
 *   Row 1 — headline stat cards (active / completed / failed / run tokens)
 *   Row 2 — 进行中请求 (compact; long-running stragglers auto-fold into a
 *           collapsed "异常长请求" row so they can't hog the screen) beside
 *           Plan 余量 / 余额
 *   Row 3 — 历史 Token 日历热力图 (full width, GitHub-contributions style:
 *           weeks as columns, weekday rows, 5-level green scale, hover
 *           inspector bar showing the exact day numbers)
 *   Row 4 — Token 消耗 leaderboards (per API Key / per Plan) beside 近期错误
 *   Row 5 — 按模型 Token 用量 (full width, collapsed when empty)
 *   Row 6 — 近期完成的请求 (full width, paginated + filterable)
 *
 * Balance history lives as a mini candlestick sparkline inside each balance
 * card of「Plan 余量 / 余额」(area fill + latest-close guide + granularity
 * caption); clicking it opens the full「余额历史 · K线」modal with a
 * granularity switch (1h / 12h / 1d, aggregated client-side from the hourly
 * candles and persisted via localStorage), range switch and hover inspector.
 */

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
  // Full-precision grouped number for the heatmap inspector ("1,234,567")
  function fmtFull(n) {
    try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); }
  }
  function fmtDur(ms) {
    if (ms >= 3600000) {
      return Math.floor(ms / 3600000) + 'h' + Math.round((ms % 3600000) / 60000) + 'm';
    }
    if (ms >= 60000) return Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's';
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return Math.round(ms) + 'ms';
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString(); } catch (e) { return iso; }
  }
  function fmtDateTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } catch (e) { return iso; }
  }
  // unix-ms timestamp variant of fmtDateTime
  function fmtDateTimeMs(ms) {
    try {
      var d = new Date(ms);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } catch (e) { return String(ms); }
  }
  // "3d 4h" / "5h 12m" / "42m" style remaining-time text
  function fmtRemain(ms) {
    if (ms <= 0) return '即将重置';
    var m = Math.floor(ms / 60000);
    var d = Math.floor(m / 1440); m -= d * 1440;
    var h = Math.floor(m / 60); m -= h * 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return Math.max(1, m) + 'm';
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Local-timezone YYYY-MM-DD (toISOString would shift the day by the offset)
  function ymdLocal(d) {
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' +
      (day.length < 2 ? '0' + day : day);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  var CUR_SYMBOLS = { CNY: '¥', USD: '$' };
  // "¥123.45" — currency-aware balance formatting
  function fmtBal(v, cur) {
    if (v == null || isNaN(v)) return '—';
    var sym = CUR_SYMBOLS[cur] || (cur ? cur + ' ' : '');
    return sym + Number(v).toFixed(2);
  }
  // axis label variant: drop decimals once values get wide
  function fmtBalAxis(v) {
    if (v == null || isNaN(v)) return '—';
    return Math.abs(v) >= 1000 ? String(Math.round(v)) : Number(v).toFixed(2);
  }
  // signed delta "+¥1.20" / "-¥0.80"
  function fmtBalDelta(d, cur) {
    if (d == null || isNaN(d)) return '—';
    return (d >= 0 ? '+' : '-') + fmtBal(Math.abs(d), cur);
  }
  // K-line granularity (hours per candle) persists across browser sessions
  function balGranInit() {
    var g = 1;
    try { g = parseInt(localStorage.getItem('cpg_dash_bal_gran') || '1', 10); } catch (e) { /* noop */ }
    return g === 12 || g === 24 ? g : 1;
  }

  // ---------- state ----------
  var state = {
    apiKey: sessionStorage.getItem('cpg_dash_key') || '',
    autoTimer: null,
    tickTimer: null,
    summary: null,
    errors: [],
    stats: null,
    // balance-history panel: range + granularity + last payload; renderedKey
    // suppresses identical SVG rebuilds on the 5s poll (data changes slowly)
    balance: { hours: 168, gran: balGranInit(), data: null, renderedKey: '' },
    // recent-requests panel: filters + pagination
    recentFilter: { status: 'all', key: 'all', plan: 'all', model: '' },
    recentPage: 0,
    // recent-errors panel: filters + pagination
    errorFilter: { level: 'all', q: '' },
    errorPage: 0,
    // active panel: show folded long-running stragglers?
    showLong: false,
  };
  var PAGE_SIZE = 20;
  // In-flight requests older than this are folded out of the compact table
  var LONG_REQ_MS = 10 * 60 * 1000;
  // Heatmap shows the trailing N weeks, today included
  var HEAT_WEEKS = 26;

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
      fetchJson('/api/dashboard/summary'),
      fetchJson('/api/dashboard/errors'),
      fetchJson('/api/dashboard/stats'),
      // Balance history is optional (503 when the store is not wired, e.g.
      // in stripped-down test setups) — a failure must not sink the poll.
      fetchJson('/api/dashboard/balance-history?hours=' + state.balance.hours)
        .catch(function () { return null; }),
    ]).then(function (results) {
      state.summary = results[0];
      state.errors = (results[1] && results[1].errors) || [];
      state.stats = results[2] && results[2].days ? results[2] : null;
      state.balance.data = results[3] || null;
      setStatus('更新于 ' + new Date().toLocaleTimeString());
      render();
      // First paint (and recoveries after errors) need the interactive panels
      // too; afterwards they only re-render on user interaction so filter
      // controls are never clobbered by the poll.
      if (!state.panelsPrimed) {
        state.panelsPrimed = true;
        renderRecent();
        renderErrors();
      }
      scheduleAuto();
    }).catch(function (err) {
      if (String(err.message) !== 'unauthorized') {
        setStatus('请求失败：' + err.message);
      }
      scheduleAuto();
    });
  }

  function scheduleAuto() {
    if (state.autoTimer) clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(refreshAll, 5000);
  }

  // ---------- summary cards ----------
  function renderCards() {
    var s = state.summary;
    if (!s) return;
    $('#statActive').textContent = fmtNum((s.activeRequests || []).length);
    $('#statRequests').textContent = fmtNum(s.completedRequests || 0);
    $('#statFailed').textContent = fmtNum(s.failedRequests || 0);
    var tok = 0;
    Object.keys(s.modelUsages || {}).forEach(function (k) { tok += s.modelUsages[k].tokens || 0; });
    $('#statTokens').textContent = fmtNum(tok);
  }

  // ---------- active requests (compact; stragglers auto-fold) ----------
  function renderActive() {
    var s = state.summary;
    var rows = (s && s.activeRequests) || [];
    var now = Date.now();
    var normal = [], long = [];
    rows.forEach(function (r) {
      var started = new Date(r.startedAt).getTime();
      if (!isNaN(started) && now - started > LONG_REQ_MS) long.push(r); else normal.push(r);
    });
    normal.sort(function (a, b) { return (b.elapsedMs || 0) - (a.elapsedMs || 0); });
    long.sort(function (a, b) { return (b.elapsedMs || 0) - (a.elapsedMs || 0); });

    $('#activeBadge').textContent = rows.length ? String(rows.length) : '';
    var wrap = $('#activeWrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">当前无进行中的请求</div>';
      return;
    }
    var html = '';
    if (normal.length) {
      html += '<table><thead><tr>' +
        '<th>API Key</th><th>模型</th><th>格式</th><th>开始时间</th><th class="num">已进行</th>' +
        '</tr></thead><tbody>';
      normal.slice(0, 12).forEach(function (r) { html += activeRow(r); });
      html += '</tbody></table>';
      if (normal.length > 12) {
        html += '<div class="long-note">另有 ' + (normal.length - 12) + ' 个进行中请求未列出</div>';
      }
    } else {
      html += '<div class="empty">当前无进行中的请求</div>';
    }
    if (long.length) {
      html += '<button class="long-toggle" id="longToggle">' +
        (state.showLong ? '▾' : '▸') + ' ' + long.length +
        ' 个请求已进行超过 10 分钟（可能为异常长请求，点击' +
        (state.showLong ? '折叠' : '展开') + '）</button>';
      if (state.showLong) {
        html += '<table class="long-table"><thead><tr>' +
          '<th>API Key</th><th>模型</th><th>入口</th><th>格式</th>' +
          '<th>开始时间</th><th class="num">已进行</th>' +
          '</tr></thead><tbody>';
        long.forEach(function (r) { html += activeRow(r, true); });
        html += '</tbody></table>';
      }
    }
    wrap.innerHTML = html;
  }

  function activeRow(r, withUrl) {
    return '<tr>' +
      '<td class="key">' + escHtml(r.apiKey) + '</td>' +
      '<td class="key">' + escHtml(r.model || '…') + '</td>' +
      (withUrl ? '<td class="url">' + escHtml(r.method + ' ' + r.url) + '</td>' : '') +
      '<td><span class="chip">' + escHtml(r.format) + '</span></td>' +
      '<td class="num muted">' + fmtTime(r.startedAt) + '</td>' +
      '<td class="num elapsed" data-started="' + escHtml(r.startedAt) + '">' +
        fmtDur(r.elapsedMs) + '</td>' +
      '</tr>';
  }

  // Tick the "已进行" column every second between data refreshes.
  function tickElapsed() {
    document.querySelectorAll('#activeWrap .elapsed').forEach(function (el) {
      var started = new Date(el.getAttribute('data-started')).getTime();
      if (isNaN(started)) return;
      el.textContent = fmtDur(Math.max(0, Date.now() - started));
    });
  }

  // ---------- usage leaderboards (keys / models / plans) ----------
  function renderBoard(wrapSel, live, histNames, nameHeader) {
    var wrap = $(wrapSel);
    var rows = [];
    Object.keys(live || {}).forEach(function (name) {
      rows.push({
        name: name,
        tokens: live[name].tokens || 0,
        requests: live[name].requests || 0,
        histTokens: 0,
        histRequests: 0,
      });
    });
    Object.keys(histNames || {}).forEach(function (name) {
      var h = histNames[name];
      var row = rows.filter(function (r) { return r.name === name; })[0];
      if (row) {
        row.histTokens = h.totalTokens || 0;
        row.histRequests = h.requests || 0;
      } else {
        rows.push({
          name: name,
          tokens: 0,
          requests: 0,
          histTokens: h.totalTokens || 0,
          histRequests: h.requests || 0,
        });
      }
    });
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">暂无用量数据</div>';
      return;
    }
    rows.sort(function (a, b) { return (b.tokens + b.histTokens) - (a.tokens + a.histTokens); });
    var maxTok = 0;
    rows.forEach(function (r) { var t = r.tokens + r.histTokens; if (t > maxTok) maxTok = t; });
    var hasHist = rows.some(function (r) { return r.histTokens > 0 || r.histRequests > 0; });
    var html = '<table><thead><tr>' +
      '<th>' + nameHeader + '</th><th class="num">本次运行</th>' +
      (hasHist ? '<th class="num">历史</th>' : '') +
      '<th class="num">请求</th>' +
      (hasHist ? '<th class="num">历史请求</th>' : '') +
      '<th class="bar-col"></th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var total = r.tokens + r.histTokens;
      var pct = maxTok > 0 ? Math.round((total / maxTok) * 100) : 0;
      html += '<tr>' +
        '<td class="key" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</td>' +
        '<td class="num">' + fmtNum(r.tokens) + '</td>' +
        (hasHist ? '<td class="num muted">' + fmtNum(r.histTokens) + '</td>' : '') +
        '<td class="num muted">' + fmtNum(r.requests) + '</td>' +
        (hasHist ? '<td class="num muted">' + fmtNum(r.histRequests) + '</td>' : '') +
        '<td class="bar-col"><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function renderBoards() {
    var s = state.summary || {};
    var byModel = state.stats ? state.stats.byModel : null;
    var byPlan = state.stats ? state.stats.byPlan : null;
    renderBoard('#keysWrap', s.apiKeyUsages, null, 'API Key');
    renderBoard('#plansUsageWrap', s.planUsages, byPlan, 'Plan');
    renderBoard('#modelsWrap', s.modelUsages, byModel, '模型');
    // The model board is third-order information; hide it entirely while the
    // gateway has served nothing yet instead of showing an empty panel.
    var hasModelRows = Object.keys(s.modelUsages || {}).length > 0 ||
      (byModel && Object.keys(byModel).length > 0);
    $('#modelsPanel').style.display = hasModelRows ? '' : 'none';
  }

  // ---------- plan quota / balance ----------
  function renderQuotas() {
    var s = state.summary || {};
    var rows = s.planQuotas || [];
    var wrap = $('#quotaWrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">暂无可准确查询余量的 Plan<br>' +
        '<span class="empty-sub">无配额 API 且未配置有限本地配额的 Plan 不会显示</span></div>';
      return;
    }
    var html = '';
    rows.forEach(function (r) {
      html += quotaCard(r);
    });
    wrap.innerHTML = html;
  }

  function quotaCard(r) {
    var kind = kindLabel(r.kind);
    var body = '';
    if (r.kind === 'balance') {
      var mini = balMiniHtml(r.planName);
      body = '<div class="q-bal-row"><div class="q-balance">' +
        escHtml(r.balance || '—') + '</div>' + mini + '</div>' +
        '<div class="q-sub">账户余额 · 更新于 ' + fmtDateTime(r.lastUpdated) + '</div>';
    } else if (r.kind === 'usage-api') {
      var pct = Math.round(r.percentage || 0);
      var cls = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
      body = '<div class="q-row"><span class="q-pct ' + cls + '">已用 ' + pct + '%</span>' +
        '<span class="q-pct ' + cls + '">剩余 ' + (100 - pct) + '%</span></div>' +
        '<div class="q-bar"><div class="q-fill ' + cls + '" style="width:' + Math.min(100, pct) + '%"></div></div>';
      (r.windows || []).forEach(function (w) {
        body += windowRow(w);
      });
      body += '<div class="q-sub">更新于 ' + fmtDateTime(r.lastUpdated) + '</div>';
    } else { // local-quota: no remaining figure — the local counter is a
             // self-imposed cap, not the provider's balance. Only the reset
             // schedule is authoritative, shown with a cycle time axis.
      var periodMs = localPeriodMs(r);
      var resetMs = r.resetAt ? new Date(r.resetAt).getTime() : NaN;
      if (r.resetAt && !isNaN(resetMs)) {
        body = '<div class="q-sub">本地配额 · 周期重置</div>' + timeAxis(resetMs, periodMs);
      } else {
        body = '<div class="q-sub">本地配额 · 周期重置：未安排</div>';
      }
    }
    return '<div class="q-card">' +
      '<div class="q-head"><span class="q-name">' + escHtml(r.planName) + '</span>' +
      '<span class="q-kind">' + kind + '</span></div>' + body + '</div>';
  }

  // One usage-API window: label + consumption + reset time axis
  function windowRow(w) {
    var label = escHtml(w.windowLabel || w.type);
    var head = '<div class="q-sub q-whead"><span>' + label + ' 窗口 · 已用 ' +
      Math.round(w.percentage) + '%</span></div>';
    if (w.nextResetTime) {
      return head + timeAxis(w.nextResetTime, w.durationMs);
    }
    return head + '<div class="q-sub q-reset">重置时间未知</div>';
  }

  // Time axis from cycle start to reset: fill grows to 100% as reset nears.
  function timeAxis(resetMs, durationMs) {
    var remain = resetMs - Date.now();
    var pct = null;
    if (durationMs && durationMs > 0) {
      pct = Math.max(0, Math.min(100, Math.round((1 - remain / durationMs) * 100)));
    }
    var bar = pct === null
      ? ''
      : '<div class="q-bar q-time"><div class="q-fill time" style="width:' + pct + '%"></div></div>';
    return bar + '<div class="q-sub q-reset">重置：' + fmtDateTimeMs(resetMs) +
      '（剩余 ' + fmtRemain(remain) + '）</div>';
  }

  // Cycle length for a local-quota plan, derived from its configured period
  function localPeriodMs(r) {
    var DAY = 86400000;
    if (r.periodType === '5h' && r.windowHours) return r.windowHours * 3600000;
    if (r.periodType === 'weekly') return 7 * DAY;
    if (r.periodType === 'monthly') return 30 * DAY; // approx; axis only
    return undefined;
  }

  function kindLabel(kind) {
    return { 'usage-api': '配额 API', 'balance': '余额', 'local-quota': '本地配额' }[kind] || kind;
  }

  // ---------- calendar heatmap (GitHub-contributions style) ----------
  // Weeks as columns (oldest → newest left → right), weekday rows Mon..Sun.
  // Intensity uses a 5-level scale over sqrt-normalized tokens so everyday
  // variance stays visible even when one day spikes; hovering a cell pins the
  // exact numbers into the inspector bar (native title= stays as fallback).
  function renderHistory() {
    var wrap = $('#historyWrap');
    var s = state.stats;
    if (!s || !s.days) {
      wrap.innerHTML = '<div class="empty">暂无历史统计数据' +
        '<span class="empty-sub">usage-stats 持久化未启用或无记录</span></div>';
      return;
    }
    var byDate = {};
    var totalTok = 0, totalReq = 0;
    s.days.forEach(function (d) {
      byDate[d.date] = d;
      totalTok += d.totalTokens;
      totalReq += d.requests;
    });

    // Grid span: trailing HEAT_WEEKS weeks ending on today's (partial) week.
    // The data itself may cover a shorter retention window; the left columns
    // simply stay at level 0 before the first recorded day.
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var dow = (today.getDay() + 6) % 7; // Mon = 0 … Sun = 6
    var start = new Date(today);
    start.setDate(start.getDate() - dow - (HEAT_WEEKS - 1) * 7);
    var todayStr = ymdLocal(today);

    var cells = [];
    var maxTok = 0;
    var cursor = new Date(start);
    while (cursor.getTime() <= today.getTime()) {
      var ds = ymdLocal(cursor);
      var rec = byDate[ds] || null;
      var tok = rec ? rec.totalTokens : 0;
      if (tok > maxTok) maxTok = tok;
      var col = Math.floor((cursor.getTime() - start.getTime()) / 604800000);
      var row = (cursor.getDay() + 6) % 7;
      cells.push({
        date: ds, col: col, row: row,
        month: cursor.getMonth(), firstOfMonth: cursor.getDate() === 1,
        tokens: tok,
        requests: rec ? rec.requests : 0,
        future: false,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    // Pad the rest of today's week so the grid keeps a rectangular shape
    var pad = new Date(today);
    for (var i = dow + 1; i < 7; i++) {
      pad.setDate(pad.getDate() + 1);
      cells.push({
        date: ymdLocal(pad), col: HEAT_WEEKS - 1, row: i,
        month: pad.getMonth(), firstOfMonth: false,
        tokens: 0, requests: 0, future: true,
      });
    }

    function level(tok) {
      if (tok <= 0 || maxTok <= 0) return 0;
      var r = Math.sqrt(tok / maxTok);
      return Math.max(1, Math.min(4, Math.ceil(r * 4)));
    }

    var dayNames = ['一', '三', '五', '日'];
    var dayRows = [0, 2, 4, 6];
    var html = '<div class="hm-body">' +
      '<div class="hm-months">' + monthLabels(cells) + '</div>' +
      '<div class="hm-main">' +
        '<div class="hm-days">' +
          dayNames.map(function (n, i) {
            return '<span style="top:' + (dayRows[i] * 16) + 'px">' + n + '</span>';
          }).join('') +
        '</div>' +
        '<div class="hm-grid" id="hmGrid">' +
          cells.map(function (c) {
            if (c.future) {
              return '<i class="hm-cell future" style="grid-column:' + (c.col + 1) +
                ';grid-row:' + (c.row + 1) + '"></i>';
            }
            var tip = c.date + '：' + fmtFull(c.tokens) + ' tokens · ' + c.requests + ' 次请求';
            return '<i class="hm-cell lv' + level(c.tokens) +
              (c.date === todayStr ? ' today' : '') +
              '" data-date="' + c.date + '" data-tok="' + c.tokens +
              '" data-req="' + c.requests + '"' +
              ' style="grid-column:' + (c.col + 1) + ';grid-row:' + (c.row + 1) + '"' +
              ' title="' + escHtml(tip) + '"></i>';
          }).join('') +
        '</div>' +
      '</div></div>' +
      '<div class="hm-foot">' +
        '<div class="hm-tip" id="hmTip">悬停查看每日详情（颜色按当日峰值的平方根比例分档）</div>' +
        '<div class="hm-legend"><span>少</span>' +
          '<i class="hm-cell lv0"></i><i class="hm-cell lv1"></i><i class="hm-cell lv2"></i>' +
          '<i class="hm-cell lv3"></i><i class="hm-cell lv4"></i><span>多</span>' +
        '</div>' +
      '</div>' +
      '<div class="hm-summary">近 ' + s.days.length + ' 天累计 <b>' + fmtNum(totalTok) +
        '</b> tokens · <b>' + fmtNum(totalReq) + '</b> 请求 · 单日峰值 <b>' +
        fmtNum(maxTok) + '</b>（统计窗口 ' + escHtml(s.from) + ' ~ ' + escHtml(s.to) + '）</div>';
    wrap.innerHTML = html;

    var tip = $('#hmTip');
    var defTip = '悬停查看每日详情（颜色按当日峰值的平方根比例分档）';
    $('#hmGrid').addEventListener('mouseover', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute || !t.getAttribute('data-date')) return;
      tip.innerHTML = '<b>' + escHtml(t.getAttribute('data-date')) + '</b> · <b>' +
        fmtFull(Number(t.getAttribute('data-tok'))) + '</b> tokens · <b>' +
        escHtml(t.getAttribute('data-req')) + '</b> 次请求';
    });
    $('#hmGrid').addEventListener('mouseleave', function () { tip.textContent = defTip; });
  }

  // Month labels aligned to the first column containing a day of that month
  function monthLabels(cells) {
    var labels = [];
    var seen = {};
    cells.forEach(function (c) {
      if (c.future) return;
      if (!seen[c.month]) {
        seen[c.month] = true;
        labels.push({ col: c.col, name: (c.month + 1) + '月' });
      }
    });
    return labels.filter(function (l, i) {
      // drop labels that would overlap the previous one or the right edge
      if (i > 0 && l.col - labels[i - 1].col < 3) return false;
      return l.col < HEAT_WEEKS - 1;
    }).map(function (l) {
      return '<span style="left:' + (l.col * 16) + 'px">' + l.name + '</span>';
    }).join('');
  }

  // ---------- balance history (mini sparkline + full modal) ----------
  // Each balance-type quota card carries a mini candlestick sparkline (last
  // 48 active candles, index-packed); clicking it opens the full K线 modal:
  // red candles when the balance rose within the period (top-up), green when
  // it dropped (spending); a faint close-price polyline + area emphasizes
  // the trend. The raw store granularity is 1h; 12h / 1d K线 are aggregated
  // client-side into local-time buckets, so no re-fetch is needed to switch.
  // Hover targets fold the exact OHLC of one period into the inspector bar.
  var BAL_RANGES = [[24, '24h'], [72, '3天'], [168, '7天'], [720, '30天'], [2160, '90天']];
  var BAL_GRANS = [[1, '1h'], [12, '12h'], [24, '1d']];

  function granLabel(g) {
    for (var i = 0; i < BAL_GRANS.length; i++) {
      if (BAL_GRANS[i][0] === g) return BAL_GRANS[i][1];
    }
    return '1h';
  }

  function rangeLabel(hours) {
    for (var i = 0; i < BAL_RANGES.length; i++) {
      if (BAL_RANGES[i][0] === hours) return BAL_RANGES[i][1];
    }
    return hours + 'h';
  }

  // Fold 1h candles into coarser local-time buckets (12h half-days aligned
  // to 00:00/12:00, or calendar days): open = first candle's open, close =
  // last candle's close, high/low = extremes, n = total samples. Input must
  // be time-ascending, so buckets merge consecutively in one pass.
  function aggregateCandles(candles, gran) {
    if (gran <= 1) return candles;
    var out = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var d = new Date(c.t);
      if (gran >= 24) d.setHours(0, 0, 0, 0);
      else d.setHours(d.getHours() < 12 ? 0 : 12, 0, 0, 0);
      var bt = d.getTime();
      var last = out[out.length - 1];
      if (last && last.t === bt) {
        if (c.h > last.h) last.h = c.h;
        if (c.l < last.l) last.l = c.l;
        last.c = c.c;
        last.n += c.n;
      } else {
        out.push({ t: bt, o: c.o, h: c.h, l: c.l, c: c.c, n: c.n });
      }
    }
    return out;
  }

  function balanceModalOpen() {
    return $('#balanceModal').style.display === 'flex';
  }

  function openBalanceModal() {
    $('#balanceModal').style.display = 'flex';
    state.balance.renderedKey = ''; // body may be empty or stale-width
    renderBalance();
  }

  function closeBalanceModal() {
    $('#balanceModal').style.display = 'none';
  }

  function renderBalance() {
    var body = $('#bmBody');
    var data = state.balance.data;
    var plans = (data && data.plans) || [];
    var gran = state.balance.gran;
    $('#bmTitle').textContent = '余额历史 · ' + granLabel(gran) + ' K线';
    if (!plans.length) {
      body.innerHTML = '<div class="empty">暂无余额历史记录<br>' +
        '<span class="empty-sub">余额型 Plan 的采样每小时累积一根 K线</span></div>';
      return;
    }
    // hidden containers report clientWidth 0 — only build SVG while visible
    if (!balanceModalOpen()) return;
    var innerW = Math.max(320, (body.clientWidth || 1044) - 36);
    var key = gran + '|' + state.balance.hours + '|' + innerW + '|' + JSON.stringify(data);
    if (key === state.balance.renderedKey) return;
    state.balance.renderedKey = key;

    var charts = []; // hover registry: plan display data by sub-chart index
    var html = '<div class="bal-range">' + BAL_GRANS.map(function (g) {
      return '<button class="bal-btn bal-gbtn' + (g[0] === gran ? ' active' : '') +
        '" data-gran="' + g[0] + '"' + (g[0] === gran ? ' disabled' : '') +
        ' title="K线颗粒度：每根 ' + g[1] + '">' + g[1] + '</button>';
    }).join('') + '<span class="bal-sep"></span>' + BAL_RANGES.map(function (r) {
      return '<button class="bal-btn' + (r[0] === state.balance.hours ? ' active' : '') +
        '" data-hours="' + r[0] + '"' + (r[0] === state.balance.hours ? ' disabled' : '') +
        '>' + r[1] + '</button>';
    }).join('') + '<span class="bal-range-note">' + granLabel(gran) +
      ' K线 · 涨 <i class="bal-swatch up"></i> 跌 <i class="bal-swatch down"></i>' +
      ' · 折线为收盘余额</span></div>';

    plans.forEach(function (p, pi) {
      if (!p.candles.length) return;
      var agg = aggregateCandles(p.candles, gran);
      var kept = filterActiveCandles(agg);
      // kept[0]/kept[last] are the window anchors: kept[0].o is the first
      // raw candle's open, kept[last].c the last raw candle's close.
      var delta = kept[kept.length - 1].c - kept[0].o;
      charts.push({ plan: p, candles: kept, delta: delta });
      html += '<div class="bal-plan">' +
        '<div class="bal-head">' +
          '<span class="bal-name">' + escHtml(p.planName) + '</span>' +
          (p.providerId ? '<span class="chip">' + escHtml(p.providerId) + '</span>' : '') +
          '<span class="bal-cur' + (delta < 0 ? ' down' : delta > 0 ? ' up' : '') + '">' +
            fmtBal(kept[kept.length - 1].c, p.currency) + '</span>' +
          '<span class="bal-delta ' + (delta < 0 ? 'down' : 'up') + '">' +
            fmtBalDelta(delta, p.currency) + '（' + rangeLabel(state.balance.hours) + '）</span>' +
          '<span class="bal-sub">采样 ' + p.candles.reduce(function (a, c) {
            return a + c.n;
          }, 0) + ' 次 · ' + kept.length + ' 根K线（已折叠 ' +
            (agg.length - kept.length) + ' 根无变化）</span>' +
        '</div>' +
        '<div class="bal-scroll">' + balChart(kept, innerW, pi, gran) + '</div>' +
      '</div>';
    });
    html += '<div class="bal-tip" id="balTip">悬停 K线查看该时段的开高低收与变动</div>';
    state.balance.charts = charts;
    body.innerHTML = html;
  }

  // Mini sparkline for one balance quota card: last 48 active candles at
  // the currently selected granularity, packed by index (gaps collapse).
  // On top of the candles: a soft area fill under the close-price line, a
  // dashed guide at the latest close with a direction-colored marker dot,
  // and a tiny granularity caption. Returns '' when the plan has no
  // history yet, leaving the card unchanged.
  function balMiniHtml(planName) {
    var data = state.balance.data;
    var plans = (data && data.plans) || [];
    var p = null;
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].planName === planName) { p = plans[i]; break; }
    }
    if (!p || !p.candles.length) return '';
    var gran = state.balance.gran;
    var W = 140, H = 36, PAD = 3;
    var cds = filterActiveCandles(aggregateCandles(p.candles, gran)).slice(-48);
    var slot = W / Math.max(cds.length, 24);
    var vmin = Infinity, vmax = -Infinity;
    cds.forEach(function (c) {
      if (c.l < vmin) vmin = c.l;
      if (c.h > vmax) vmax = c.h;
    });
    if (vmin === vmax) {
      var pd = Math.max(1, Math.abs(vmin) * 0.02);
      vmin -= pd; vmax += pd;
    } else {
      var rg = vmax - vmin;
      vmin -= rg * 0.08; vmax += rg * 0.08;
    }
    function y(v) { return PAD + (H - 2 * PAD) * (1 - (v - vmin) / (vmax - vmin)); }
    function xc(i) { return PAD + (i + 0.5) * slot; }
    var pts = cds.map(function (c, i) { return xc(i).toFixed(1) + ',' + y(c.c).toFixed(1); });
    var lastC = cds[cds.length - 1];
    var ly = y(lastC.c).toFixed(1);
    var s = [];
    // soft area fill under the close-price line — the trend reads at a glance
    s.push('<polygon points="' + PAD + ',' + (H - PAD) + ' ' + pts.join(' ') + ' ' +
      xc(cds.length - 1).toFixed(1) + ',' + (H - PAD) +
      '" style="fill: var(--accent); opacity: .08"/>');
    // dashed guide at the latest close level
    s.push('<line x1="' + PAD + '" x2="' + (W - PAD) + '" y1="' + ly + '" y2="' + ly +
      '" style="stroke: var(--faint); opacity: .35; stroke-width: .5; stroke-dasharray: 2 2"/>');
    cds.forEach(function (c, i) {
      var up = c.c >= c.o;
      var col = up ? 'var(--err)' : 'var(--ok)';
      var cx = xc(i).toFixed(1);
      var bw = Math.max(1, slot * 0.7);
      var yTop = y(Math.max(c.o, c.c));
      var yBot = y(Math.min(c.o, c.c));
      s.push('<line x1="' + cx + '" x2="' + cx + '" y1="' + y(c.h).toFixed(1) +
        '" y2="' + y(c.l).toFixed(1) + '" style="stroke: ' + col + '; opacity: .6; stroke-width: .75"/>');
      s.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + yTop.toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, yBot - yTop).toFixed(1) +
        '" style="fill: ' + col + '"/>');
    });
    s.push('<polyline points="' + pts.join(' ') +
      '" fill="none" style="stroke: var(--accent); opacity: .5; stroke-width: 1"/>');
    // latest-close marker dot, colored by the last candle's direction
    s.push('<circle cx="' + xc(cds.length - 1).toFixed(1) + '" cy="' + ly + '" r="1.8"' +
      ' style="fill: ' + (lastC.c >= lastC.o ? 'var(--err)' : 'var(--ok)') + '"/>');
    // granularity caption (top-left corner)
    s.push('<text x="' + PAD + '" y="' + (PAD + 6) + '" class="q-mini-label">' +
      granLabel(gran) + '</text>');
    return '<button class="q-bal-mini" data-plan="' + escHtml(planName) +
      '" title="余额历史 ' + granLabel(gran) + ' K线（近 ' + cds.length +
      ' 根有效K线）· 点击查看大图，弹层内可切换 1h/12h/1d">' +
      '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      s.join('') + '</svg></button>';
  }

  // Drop candles from periods where the balance sat unchanged: a candle is
  // redundant when it is flat (h === l, which implies o === c) and sits at
  // the previous kept close. First/last candles always stay as window
  // anchors, and a flat candle at a NEW level stays to mark the step.
  function filterActiveCandles(candles) {
    var out = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var last = out[out.length - 1];
      if (i === 0 || i === candles.length - 1 || c.h !== c.l || !last || c.c !== last.c) {
        out.push(c);
      }
    }
    return out;
  }

  // Build one plan's SVG chart string from the kept (activity) candles,
  // packed by index — flat periods are compressed away instead of occupying
  // dead space, so every x position carries an explicit time label. gran
  // (hours per candle) only affects label formatting: 1d candles get bare
  // dates, finer granularities get date + hour.
  function balChart(kept, innerW, planIndex, gran) {
    var H = 150, PAD_T = 8, PAD_B = 20, PAD_L = 56, PAD_R = 12;
    var plotW = Math.max(innerW - PAD_L - PAD_R, kept.length * 3);
    var slot = plotW / kept.length;
    var svgW = PAD_L + plotW + PAD_R, svgH = PAD_T + H + PAD_B;

    var vmin = Infinity, vmax = -Infinity;
    kept.forEach(function (c) {
      if (c.l < vmin) vmin = c.l;
      if (c.h > vmax) vmax = c.h;
    });
    if (vmin === vmax) {
      var pad = Math.max(1, Math.abs(vmin) * 0.02);
      vmin -= pad; vmax += pad;
    } else {
      var range = vmax - vmin;
      vmin -= range * 0.05; vmax += range * 0.05;
    }
    function y(v) { return PAD_T + H - ((v - vmin) / (vmax - vmin)) * H; }
    function x(i) { return PAD_L + (i + 0.5) * slot; }

    var s = [];
    // horizontal grid + y labels
    for (var i = 0; i <= 3; i++) {
      var v = vmin + ((vmax - vmin) * i) / 3;
      var gy = y(v).toFixed(1);
      s.push('<line x1="' + PAD_L + '" x2="' + (PAD_L + plotW) + '" y1="' + gy +
        '" y2="' + gy + '" style="stroke: var(--border-soft)"/>');
      s.push('<text x="' + (PAD_L - 6) + '" y="' + (+gy + 3).toFixed(1) +
        '" text-anchor="end">' + escHtml(fmtBalAxis(v)) + '</text>');
    }
    // bottom time axis line
    s.push('<line x1="' + PAD_L + '" x2="' + (PAD_L + plotW) + '" y1="' + (PAD_T + H) +
      '" y2="' + (PAD_T + H) + '" style="stroke: var(--border)"/>');

    // x labels — must always render. Sparse chart (wide slots): label every
    // candle with date+hour. Dense chart: label day boundaries with the
    // date; if the whole span sits inside one day, fall back to 6h hour
    // ticks, and finally to first+last candles.
    var axisY = PAD_T + H + 14;
    function txt(d, withTime) {
      return (d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        (withTime ? ' ' + pad2(d.getHours()) + ':00' : '');
    }
    var labels = [];
    if (slot >= 44) {
      kept.forEach(function (c, i) {
        labels.push([x(i), txt(new Date(c.t), gran < 24)]);
      });
    } else {
      var lastX = -1e9;
      kept.forEach(function (c, i) {
        var d = new Date(c.t);
        if (d.getHours() !== 0) return;
        var xx = x(i);
        if (lastX > -1e8 && xx - lastX < 44) return;
        lastX = xx;
        labels.push([xx, txt(d, false)]);
      });
      if (!labels.length) {
        var lastX2 = -1e9;
        kept.forEach(function (c, i) {
          var d = new Date(c.t);
          if (d.getHours() % 6 !== 0) return;
          var xx = x(i);
          if (lastX2 > -1e8 && xx - lastX2 < 44) return;
          lastX2 = xx;
          labels.push([xx, txt(d, gran < 24)]);
        });
        if (!labels.length) {
          labels.push([x(0), txt(new Date(kept[0].t), gran < 24)]);
          if (kept.length > 1) {
            labels.push([x(kept.length - 1), txt(new Date(kept[kept.length - 1].t), gran < 24)]);
          }
        }
      }
    }
    labels.forEach(function (l) {
      s.push('<text x="' + l[0].toFixed(1) + '" y="' + axisY +
        '" text-anchor="middle">' + escHtml(l[1]) + '</text>');
    });

    // close-price polyline (the 折线 in 折线图)
    s.push('<polyline points="' + kept.map(function (c, i) {
      return x(i).toFixed(1) + ',' + y(c.c).toFixed(1);
    }).join(' ') + '" fill="none" style="stroke: var(--accent); opacity: .4; stroke-width: 1"/>');
    // candles — 中国市场惯例：红涨绿跌
    var bw = Math.max(1.5, slot * 0.6);
    kept.forEach(function (c, ci) {
      var up = c.c >= c.o;
      var col = up ? 'var(--err)' : 'var(--ok)';
      var cx = x(ci).toFixed(1);
      var yTop = y(Math.max(c.o, c.c));
      var yBot = y(Math.min(c.o, c.c));
      s.push('<line x1="' + cx + '" x2="' + cx + '" y1="' + y(c.h).toFixed(1) +
        '" y2="' + y(c.l).toFixed(1) + '" style="stroke: ' + col + '; opacity: .6"/>');
      s.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + yTop.toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, yBot - yTop).toFixed(1) +
        '" style="fill: ' + col + '"/>');
      s.push('<rect class="bal-hover" data-p="' + planIndex + '" data-i="' + ci +
        '" x="' + (cx - slot / 2).toFixed(1) + '" y="' + PAD_T +
        '" width="' + Math.max(slot, 5).toFixed(1) + '" height="' + H + '" fill="transparent"/>');
    });
    return '<svg class="bal-svg" width="' + svgW.toFixed(0) + '" height="' + svgH +
      '" viewBox="0 0 ' + svgW.toFixed(0) + ' ' + svgH + '">' + s.join('') + '</svg>';
  }

  // Re-fetch just the balance panel (range switch); full refresh keeps its
  // own cadence.
  function reloadBalance() {
    setStatus('刷新中…');
    fetchJson('/api/dashboard/balance-history?hours=' + state.balance.hours)
      .catch(function () { return null; })
      .then(function (data) {
        state.balance.data = data;
        state.balance.renderedKey = ''; // force rebuild, range buttons changed
        renderBalance();
        setStatus('更新于 ' + new Date().toLocaleTimeString());
      });
  }

  function bindBalanceEvents() {
    var wrap = $('#bmBody');
    wrap.addEventListener('click', function (ev) {
      // granularity switch: pure client-side re-aggregation, no re-fetch;
      // the card minis follow the same granularity
      var gbtn = ev.target.closest ? ev.target.closest('.bal-gbtn') : null;
      if (gbtn && !gbtn.disabled) {
        state.balance.gran = parseInt(gbtn.getAttribute('data-gran'), 10);
        try {
          localStorage.setItem('cpg_dash_bal_gran', String(state.balance.gran));
        } catch (e) { /* noop */ }
        state.balance.renderedKey = '';
        renderBalance();
        renderQuotas();
        return;
      }
      var btn = ev.target.closest ? ev.target.closest('.bal-btn') : null;
      if (!btn || btn.disabled) return;
      state.balance.hours = parseInt(btn.getAttribute('data-hours'), 10);
      reloadBalance();
    });
    wrap.addEventListener('mouseover', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute || !t.getAttribute('data-p')) return;
      var chart = state.balance.charts[+t.getAttribute('data-p')];
      if (!chart) return;
      var c = chart.candles[+t.getAttribute('data-i')];
      if (!c) return;
      var gran = state.balance.gran;
      var d = new Date(c.t);
      var span;
      if (gran >= 24) {
        span = (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' 全天';
      } else {
        var end = new Date(c.t + gran * 3600000);
        span = (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) +
          ':00 ~ ' + pad2(end.getHours()) + ':00';
      }
      var delta = c.c - c.o;
      var tip = $('#balTip');
      tip.innerHTML = '<b>' + escHtml(chart.plan.planName) + '</b> · ' + span +
        ' · 开 <b>' + fmtBal(c.o, chart.plan.currency) + '</b>' +
        ' 高 <b>' + fmtBal(c.h, chart.plan.currency) + '</b>' +
        ' 低 <b>' + fmtBal(c.l, chart.plan.currency) + '</b>' +
        ' 收 <b>' + fmtBal(c.c, chart.plan.currency) + '</b>' +
        ' 变动 <b style="color: ' + (delta > 0 ? 'var(--err)' : delta < 0 ? 'var(--ok)' : 'var(--muted)') + '">' +
        fmtBalDelta(delta, chart.plan.currency) + '</b> · ' + c.n + ' 次采样';
    });
    wrap.addEventListener('mouseleave', function () {
      var tip = $('#balTip');
      if (tip) tip.textContent = '悬停 K线查看该时段的开高低收与变动';
    });
  }

  // ---------- recent requests (paginated + filterable) ----------
  function renderRecent() {
    var s = state.summary || {};
    var all = s.recentRequests || [];
    var wrap = $('#recentWrap');
    if (!all.length) {
      wrap.innerHTML = '<div class="empty">本次运行暂无已完成的代理请求</div>';
      return;
    }

    var f = state.recentFilter;
    var rows = all.filter(function (r) {
      if (f.status === 'ok' && r.status >= 400) return false;
      if (f.status === 'fail' && r.status < 400) return false;
      if (f.key !== 'all' && r.apiKey !== f.key) return false;
      if (f.plan !== 'all' && r.plan !== f.plan) return false;
      if (f.model) {
        var q = f.model.toLowerCase();
        var name = (r.model + ' ' + (r.canonicalModel || '')).toLowerCase();
        if (name.indexOf(q) < 0) return false;
      }
      return true;
    });

    var html = filterBar('recent', [
      selectFilter('recentStatus', '状态', [['all', '全部状态'], ['ok', '成功'], ['fail', '失败']], f.status),
      selectFilter('recentKey', 'API Key', [['all', '全部 Key']].concat(
        uniq(all.map(function (r) { return r.apiKey; })).map(function (k) { return [k, k]; })), f.key),
      selectFilter('recentPlan', 'Plan', [['all', '全部 Plan']].concat(
        uniq(all.map(function (r) { return r.plan; })).map(function (p) { return [p, p]; })), f.plan),
      '<input class="flt-input" id="fltRecentModel" placeholder="模型搜索…" value="' +
        escHtml(f.model) + '">',
    ].join(''));

    var page = clampPage(state.recentPage, rows.length);
    state.recentPage = page;
    var slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    html += '<table><thead><tr>' +
      '<th>时间</th><th>API Key</th><th>模型</th><th>Plan</th>' +
      '<th class="num">输入</th><th class="num">输出</th>' +
      '<th class="num">耗时</th><th class="num">状态</th>' +
      '</tr></thead><tbody>';
    if (!slice.length) {
      html += '<tr><td colspan="8" class="empty">无符合筛选条件的请求</td></tr>';
    }
    slice.forEach(function (r) {
      var failed = r.status >= 400;
      var model = r.canonicalModel && r.canonicalModel !== r.model
        ? r.model + ' → ' + r.canonicalModel
        : r.model;
      html += '<tr class="' + (failed ? 'row-failed' : '') + '">' +
        '<td class="muted">' + fmtTime(r.at) + '</td>' +
        '<td class="key">' + escHtml(r.apiKey) + '</td>' +
        '<td class="key" title="' + escHtml(model) + '">' + escHtml(model) + '</td>' +
        '<td class="key">' + escHtml(r.plan) + '</td>' +
        '<td class="num">' + fmtNum(r.inputTokens) + '</td>' +
        '<td class="num">' + fmtNum(r.outputTokens) + '</td>' +
        '<td class="num muted">' + fmtDur(r.durationMs) + '</td>' +
        '<td class="num"><span class="st ' + (failed ? 'st-fail' : 'st-ok') + '">' + r.status + '</span></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    html += pager('recent', page, rows.length);
    wrap.innerHTML = html;
  }

  // ---------- errors (paginated + filterable) ----------
  function renderErrors() {
    var all = state.errors || [];
    var wrap = $('#errorList');
    if (!all.length) {
      wrap.innerHTML = '<div class="empty">暂无错误，运行正常</div>';
      return;
    }

    var f = state.errorFilter;
    var rows = all.filter(function (e) {
      if (f.level !== 'all' && e.level !== f.level) return false;
      if (f.q) {
        var hay = ((e.message || '') + ' ' +
          (e.error ? (e.error.message || '') + ' ' + (e.error.name || '') : '')).toLowerCase();
        if (hay.indexOf(f.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var levels = uniq(all.map(function (e) { return e.level; }));
    var html = filterBar('error', [
      selectFilter('errorLevel', '级别', [['all', '全部级别']].concat(
        levels.map(function (l) { return [l, l]; })), f.level),
      '<input class="flt-input" id="fltErrorQ" placeholder="关键词搜索…" value="' +
        escHtml(f.q) + '">',
    ].join(''));

    var page = clampPage(state.errorPage, rows.length);
    state.errorPage = page;
    var slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (!slice.length) {
      html += '<div class="empty">无符合筛选条件的错误</div>';
    }
    html += slice.map(function (e) {
      var detail = e.error ? (e.error.message || e.error.name) : (e.message || '');
      var code = e.error && e.error.code ? ' [' + e.error.code + ']' : '';
      return '<div class="err-row">' +
        '<div class="err-time">' + fmtTime(e.timestamp) + '</div>' +
        '<div class="err-body"><span class="err-msg">' + escHtml(e.message || 'error') + code + '</span>' +
        (detail && detail !== e.message ? '<span class="err-detail">' + escHtml(detail) + '</span>' : '') +
        '</div></div>';
    }).join('');
    html += pager('error', page, rows.length);
    wrap.innerHTML = html;
  }

  // ---------- filter / pager building blocks ----------
  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) {
      if (x != null && !seen[x]) { seen[x] = 1; out.push(x); }
    });
    return out.sort();
  }

  function filterBar(id, inner) {
    return '<div class="flt-bar" id="fltBar-' + id + '">' + inner + '</div>';
  }

  function selectFilter(id, label, options, value) {
    var opts = options.map(function (o) {
      return '<option value="' + escHtml(o[0]) + '"' +
        (o[0] === value ? ' selected' : '') + '>' + escHtml(o[1]) + '</option>';
    }).join('');
    return '<select class="flt-select" id="flt' + id + '" title="' + escHtml(label) + '">' +
      opts + '</select>';
  }

  function clampPage(page, total) {
    var maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    return Math.min(Math.max(0, page), maxPage);
  }

  function pager(id, page, total) {
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return '<div class="pager">' +
      '<button class="pager-btn" data-panel="' + id + '" data-dir="-1"' +
        (page <= 0 ? ' disabled' : '') + '>‹ 上一页</button>' +
      '<span class="pager-info">第 ' + (page + 1) + ' / ' + pages + ' 页 · 共 ' + total + ' 条</span>' +
      '<button class="pager-btn" data-panel="' + id + '" data-dir="1"' +
        (page >= pages - 1 ? ' disabled' : '') + '>下一页 ›</button>' +
      '</div>';
  }

  // Event delegation: pager clicks + filter changes both re-render only their
  // own panel; changing any filter resets that panel to page 1.
  function bindPanelEvents() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.pager-btn') : null;
      if (btn && !btn.disabled) {
        var panel = btn.getAttribute('data-panel');
        var dir = parseInt(btn.getAttribute('data-dir'), 10);
        if (panel === 'recent') { state.recentPage += dir; renderRecent(); }
        if (panel === 'error') { state.errorPage += dir; renderErrors(); }
        return;
      }
      var toggle = ev.target.closest ? ev.target.closest('#longToggle') : null;
      if (toggle) { state.showLong = !state.showLong; renderActive(); }
    });
    document.addEventListener('change', function (ev) {
      var id = ev.target.id;
      if (id === 'fltrecentStatus') { state.recentFilter.status = ev.target.value; state.recentPage = 0; renderRecent(); }
      if (id === 'fltrecentKey') { state.recentFilter.key = ev.target.value; state.recentPage = 0; renderRecent(); }
      if (id === 'fltrecentPlan') { state.recentFilter.plan = ev.target.value; state.recentPage = 0; renderRecent(); }
      if (id === 'flterrorLevel') { state.errorFilter.level = ev.target.value; state.errorPage = 0; renderErrors(); }
    });
    document.addEventListener('input', function (ev) {
      var id = ev.target.id;
      if (id === 'fltRecentModel') { state.recentFilter.model = ev.target.value; state.recentPage = 0; renderRecent(); refocus(ev.target); }
      if (id === 'fltErrorQ') { state.errorFilter.q = ev.target.value; state.errorPage = 0; renderErrors(); refocus(ev.target); }
    });
  }

  // innerHTML re-render drops focus; restore it (caret to end) after typing
  function refocus(el) {
    var id = el.id, pos = el.selectionStart;
    var again = document.getElementById(id);
    if (again) {
      again.focus();
      try { again.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
  }

  function render() {
    renderCards();
    renderActive();
    renderBoards();
    renderQuotas();
    // Recent + errors panels are user-interactive (filters/pagination hold
    // local state); re-rendering them on the 5s poll would clobber an open
    // dropdown or a search box mid-typing, so they render only on their own
    // events. Data freshness there is bounded by the next user interaction.
    renderHistory();
    // The full candle chart lives in a modal; only refresh it while it is
    // open (hidden containers report clientWidth 0 → wrong chart widths)
    if (balanceModalOpen()) renderBalance();
  }

  // ---------- auth prompt ----------
  function showKeyPrompt(show) {
    $('#keyPrompt').style.display = show ? 'flex' : 'none';
  }

  function setStatus(txt) { $('#status').textContent = txt; }

  // ---------- init ----------
  function init() {
    $('#refreshBtn').addEventListener('click', refreshAll);
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
    state.tickTimer = setInterval(tickElapsed, 1000);
    bindPanelEvents();
    bindBalanceEvents();
    // mini sparkline in a balance card opens the full-history modal
    $('#quotaWrap').addEventListener('click', function (ev) {
      var mini = ev.target.closest ? ev.target.closest('.q-bal-mini') : null;
      if (mini) openBalanceModal();
    });
    $('#bmClose').addEventListener('click', closeBalanceModal);
    $('#balanceModal').addEventListener('click', function (ev) {
      if (ev.target === $('#balanceModal')) closeBalanceModal();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeBalanceModal();
    });

    refreshAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
`;

/**
 * Design tokens: tinted-neutral dark palette (no pure black/greys), a single
 * restrained accent, status hues reserved for semantics, 8px spacing grid,
 * and motion kept under 300ms with ease-out entrances.
 */
const STYLES = `
:root {
  --bg: #131620;
  --bg-soft: #171b28;
  --panel: #1c2133;
  --panel-hi: #222842;
  --border: #2a3152;
  --border-soft: #232a45;
  --text: #c9d1f2;
  --text-hi: #eef1ff;
  --muted: #7c86b3;
  --faint: #5a6390;
  --accent: #6ea8fe;
  --accent-dim: rgba(110, 168, 254, .14);
  --ok: #7ee0a3;
  --warn: #f2c97d;
  --err: #ff8fa3;
  --hm0: #20263e;
  --hm1: #1e553f;
  --hm2: #2f9260;
  --hm3: #53d38b;
  --hm4: #a9f0bd;
  --radius: 8px;
  --shadow: 0 1px 2px rgba(5, 8, 20, .4);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased; }

/* ---------- top bar ---------- */
.topbar { display: flex; align-items: baseline; gap: 12px; padding: 16px 24px 14px;
  border-bottom: 1px solid var(--border-soft); }
.topbar h1 { font-size: 15px; margin: 0; font-weight: 650; color: var(--text-hi);
  letter-spacing: .02em; }
.topbar .sub { color: var(--faint); font-size: 12px; }
.topbar .spacer { flex: 1; }
.btn { background: transparent; border: 1px solid var(--border); color: var(--muted);
  padding: 5px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
  transition: color .15s ease, border-color .15s ease, background .15s ease; }
.btn:hover { color: var(--text-hi); border-color: var(--accent); background: var(--accent-dim); }
#status { color: var(--faint); font-size: 11px; padding: 8px 24px 0; letter-spacing: .02em; }

/* ---------- stat cards ---------- */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px; padding: 12px 24px 0; }
.stat-card { background: var(--panel); border: 1px solid var(--border-soft);
  border-radius: var(--radius); padding: 12px 16px; box-shadow: var(--shadow); }
.stat-card .label { color: var(--muted); font-size: 11px; letter-spacing: .04em;
  text-transform: uppercase; margin-bottom: 6px; }
.stat-card .value { font-size: 24px; font-weight: 650; color: var(--text-hi);
  font-variant-numeric: tabular-nums; line-height: 1.2; }
.stat-card .value.live { color: var(--accent); }
.stat-card .value.err { color: var(--err); }

/* ---------- layout ---------- */
.main { display: flex; flex-direction: column; gap: 16px; padding: 16px 24px 24px; }
.duo { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 1100px) { .duo { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--border-soft);
  border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.panel h2 { font-size: 11px; color: var(--muted); font-weight: 650; margin: 0;
  padding: 12px 16px 10px; border-bottom: 1px solid var(--border-soft);
  letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: center; }
.panel h2 .badge { display: inline-block; min-width: 18px; text-align: center;
  background: var(--accent); color: var(--bg); border-radius: 9px; font-size: 11px;
  font-weight: 700; padding: 1px 5px; margin-left: 8px; }
.panel h2 .badge:empty { display: none; }

/* ---------- tables ---------- */
.table-wrap { overflow-x: auto; padding: 4px 8px 10px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; color: var(--faint); font-weight: 600; font-size: 11px;
  letter-spacing: .04em; padding: 10px 10px 8px; border-bottom: 1px solid var(--border-soft);
  white-space: nowrap; }
td { padding: 7px 10px; border-bottom: 1px solid var(--border-soft);
  white-space: nowrap; color: var(--text); }
tbody tr { transition: background .12s ease; }
tbody tr:hover { background: var(--panel-hi); }
tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.key { max-width: 200px; overflow: hidden; text-overflow: ellipsis; font-weight: 550; }
.url { color: var(--muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
.muted { color: var(--muted); }
.chip { display: inline-block; border: 1px solid var(--border); border-radius: 4px;
  color: var(--muted); font-size: 11px; padding: 0 6px; line-height: 1.7; }
.elapsed { color: var(--accent); font-weight: 650; font-variant-numeric: tabular-nums; }
.row-failed td { background: rgba(255, 143, 163, .05); }
.st { display: inline-block; min-width: 34px; text-align: center; border-radius: 4px;
  font-size: 11px; font-weight: 650; padding: 0 6px; line-height: 1.8;
  font-variant-numeric: tabular-nums; }
.st-ok { color: var(--ok); background: rgba(126, 224, 163, .1); }
.st-fail { color: var(--err); background: rgba(255, 143, 163, .12); }
.bar-col { width: 90px; }
.bar { height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 3px; opacity: .75;
  transition: width .25s ease-out; }
.empty { color: var(--faint); padding: 22px 16px; text-align: center; font-size: 12px; }
.empty-sub { display: block; color: var(--faint); font-size: 11px; margin-top: 4px; opacity: .8; }

/* ---------- active requests: straggler fold ---------- */
.long-toggle { display: block; width: calc(100% - 16px); margin: 4px 8px 10px;
  background: rgba(242, 201, 125, .06); border: 1px dashed rgba(242, 201, 125, .35);
  color: var(--warn); border-radius: 6px; font-size: 11px; padding: 6px 10px;
  cursor: pointer; text-align: left;
  transition: background .15s ease, border-color .15s ease; }
.long-toggle:hover { background: rgba(242, 201, 125, .12); border-color: var(--warn); }
.long-table { margin-top: 4px; }
.long-table .elapsed { color: var(--warn); }
.long-note { color: var(--faint); font-size: 11px; padding: 4px 16px 8px; }

/* ---------- filter bars + pagers ---------- */
.flt-bar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 16px 6px; }
.flt-select, .flt-input { background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 6px; font-size: 12px; padding: 4px 8px;
  outline: none; transition: border-color .15s ease; }
.flt-select { max-width: 160px; cursor: pointer; }
.flt-input { flex: 1; min-width: 120px; }
.flt-select:focus, .flt-input:focus { border-color: var(--accent); }
.flt-select:hover, .flt-input:hover { border-color: var(--muted); }
.pager { display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 8px 16px 12px; }
.pager-info { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.pager-btn { background: transparent; border: 1px solid var(--border); color: var(--muted);
  border-radius: 6px; font-size: 11px; padding: 3px 10px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background .15s ease; }
.pager-btn:hover:not(:disabled) { color: var(--text-hi); border-color: var(--accent);
  background: var(--accent-dim); }
.pager-btn:disabled { opacity: .35; cursor: default; }

/* ---------- quota cards ---------- */
#quotaWrap { display: flex; flex-direction: column; }
.q-card { padding: 14px 16px; border-bottom: 1px solid var(--border-soft); }
.q-card:last-child { border-bottom: none; }
.q-head { display: flex; justify-content: space-between; align-items: center;
  gap: 8px; margin-bottom: 8px; }
.q-name { font-size: 13px; font-weight: 600; color: var(--text-hi); }
.q-kind { color: var(--faint); font-size: 10px; letter-spacing: .06em; border: 1px solid var(--border);
  border-radius: 4px; padding: 1px 6px; white-space: nowrap; text-transform: uppercase; }
.q-balance { font-size: 22px; font-weight: 650; color: var(--ok); letter-spacing: .01em;
  font-variant-numeric: tabular-nums; margin: 2px 0 6px; }
.q-row { display: flex; justify-content: space-between; margin-bottom: 6px; gap: 8px; }
.q-pct { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.q-pct.ok { color: var(--ok); } .q-pct.warn { color: var(--warn); }
.q-pct.crit { color: var(--err); }
.q-bar { height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; margin: 6px 0; }
.q-fill { height: 100%; border-radius: 3px; transition: width .3s ease-out; }
.q-fill.ok { background: var(--ok); } .q-fill.warn { background: var(--warn); }
.q-fill.crit { background: var(--err); }
.q-sub { color: var(--muted); font-size: 11px; margin-top: 5px; }
.q-whead { margin-top: 8px; }
.q-reset { font-variant-numeric: tabular-nums; }
.q-bar.q-time { height: 4px; margin: 4px 0 2px; }
.q-fill.time { background: var(--accent); opacity: .8; }

/* ---------- balance history: card mini sparkline + detail modal ---------- */
/* 中国市场惯例：红涨绿跌 */
.q-bal-row { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin: 2px 0 6px; }
.q-bal-row .q-balance { margin: 0; }
.q-bal-mini { flex: none; background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px 7px 2px; cursor: pointer;
  transition: border-color .15s ease, background .15s ease; }
.q-bal-mini:hover { border-color: var(--accent); background: var(--accent-dim); }
.q-bal-mini svg { display: block; }
.q-bal-mini svg line, .q-bal-mini svg rect, .q-bal-mini svg polyline,
.q-bal-mini svg polygon, .q-bal-mini svg circle, .q-bal-mini svg text { pointer-events: none; }
.q-bal-mini svg .q-mini-label { fill: var(--faint); font-size: 7px; opacity: .85; }

#balanceModal { position: fixed; inset: 0; background: rgba(7, 9, 16, .6);
  backdrop-filter: blur(2px); display: none; align-items: center;
  justify-content: center; z-index: 150; }
.bm-dialog { background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; width: min(1080px, 94vw); max-height: 88vh;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 32px rgba(5, 8, 20, .5); }
.bm-head { display: flex; align-items: baseline; gap: 12px;
  padding: 14px 18px 10px; border-bottom: 1px solid var(--border-soft); }
.bm-head h3 { margin: 0; font-size: 13px; font-weight: 650; color: var(--text-hi);
  letter-spacing: .02em; white-space: nowrap; }
.bm-sub { color: var(--faint); font-size: 11px; }
.bm-close { margin-left: auto; flex: none; background: transparent;
  border: 1px solid var(--border); color: var(--muted); border-radius: 6px;
  font-size: 12px; width: 26px; height: 26px; line-height: 1; cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background .15s ease; }
.bm-close:hover { color: var(--text-hi); border-color: var(--accent);
  background: var(--accent-dim); }
#bmBody { padding: 14px 18px 16px; overflow-y: auto; }

.bal-range { display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
  flex-wrap: wrap; }
.bal-sep { width: 1px; align-self: stretch; background: var(--border); margin: 3px 4px; }
.bal-btn { background: transparent; border: 1px solid var(--border); color: var(--muted);
  border-radius: 6px; font-size: 11px; padding: 3px 10px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background .15s ease; }
.bal-btn:hover:not(.active) { color: var(--text-hi); border-color: var(--accent);
  background: var(--accent-dim); }
.bal-btn.active { color: var(--text-hi); border-color: var(--accent);
  background: var(--accent-dim); cursor: default; }
.bal-range-note { color: var(--faint); font-size: 11px; margin-left: auto;
  display: flex; align-items: center; gap: 4px; }
.bal-swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.bal-swatch.up { background: var(--err); }
.bal-swatch.down { background: var(--ok); }
.bal-plan { margin-bottom: 14px; }
.bal-plan:last-of-type { margin-bottom: 0; }
.bal-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px;
  flex-wrap: wrap; }
.bal-name { font-size: 13px; font-weight: 600; color: var(--text-hi); }
.bal-cur { font-size: 16px; font-weight: 650; color: var(--text-hi);
  font-variant-numeric: tabular-nums; }
.bal-cur.up { color: var(--err); } .bal-cur.down { color: var(--ok); }
.bal-delta { font-size: 11px; font-variant-numeric: tabular-nums; }
.bal-delta.up { color: var(--err); } .bal-delta.down { color: var(--ok); }
.bal-sub { color: var(--faint); font-size: 11px; margin-left: auto;
  font-variant-numeric: tabular-nums; }
.bal-scroll { overflow-x: auto; }
svg.bal-svg { display: block; }
svg.bal-svg text { fill: var(--faint); font-size: 10px;
  font-variant-numeric: tabular-nums; }
svg.bal-svg .bal-hover:hover { fill: rgba(110, 168, 254, .07); }
.bal-tip { color: var(--muted); font-size: 11px; min-height: 16px; margin-top: 8px;
  font-variant-numeric: tabular-nums; }
.bal-tip b { color: var(--text-hi); font-weight: 600; }

/* ---------- errors ---------- */
.err-row { display: flex; gap: 10px; padding: 8px 16px; border-bottom: 1px solid var(--border-soft);
  font-size: 12px; align-items: baseline; }
.err-row:last-child { border-bottom: none; }
.err-time { color: var(--faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
.err-body { min-width: 0; }
.err-msg { color: var(--err); display: block; font-weight: 550; }
.err-detail { color: var(--muted); display: block; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }

/* ---------- key prompt ---------- */
#keyPrompt { position: fixed; inset: 0; background: rgba(7, 9, 16, .6);
  backdrop-filter: blur(2px); display: none; align-items: center;
  justify-content: center; z-index: 200; }
#keyPrompt .dialog { background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 22px; width: 380px; box-shadow: 0 8px 32px rgba(5, 8, 20, .5); }
#keyPrompt h3 { margin: 0 0 8px; font-size: 14px; color: var(--text-hi); }
#keyPrompt p { color: var(--muted); font-size: 12px; margin: 0 0 14px; }
#keyPrompt code { background: var(--bg); border-radius: 3px; padding: 0 4px; }
#keyInput { width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text-hi); border-radius: 6px; padding: 8px 10px; font-size: 13px;
  margin-bottom: 14px; outline: none; transition: border-color .15s ease; }
#keyInput:focus { border-color: var(--accent); }
#keyPrompt .row { display: flex; gap: 8px; justify-content: flex-end; }

/* ---------- calendar heatmap ---------- */
/* 13px cell + 3px gap = 16px pitch; every offset below is a multiple of it */
#historyWrap { padding: 16px 18px 12px; }
.hm-body { overflow-x: auto; padding-bottom: 4px; }
.hm-months { position: relative; height: 15px; margin-left: 28px;
  min-width: 780px; /* 26 cols * 16px + trailing labels */ }
.hm-months span { position: absolute; top: 0; font-size: 10px; color: var(--faint);
  white-space: nowrap; }
.hm-main { display: flex; }
.hm-days { position: relative; width: 24px; flex: none; margin-right: 4px; }
.hm-days span { position: absolute; font-size: 10px; color: var(--faint); line-height: 13px; }
.hm-grid { display: grid; grid-template-rows: repeat(7, 13px);
  grid-auto-columns: 13px; grid-auto-flow: column; gap: 3px; }
.hm-cell { width: 13px; height: 13px; border-radius: 2px; background: var(--hm0); }
.hm-cell.future { background: transparent; }
.hm-cell.lv0 { background: var(--hm0); }
.hm-cell.lv1 { background: var(--hm1); }
.hm-cell.lv2 { background: var(--hm2); }
.hm-cell.lv3 { background: var(--hm3); }
.hm-cell.lv4 { background: var(--hm4); }
.hm-cell.today { outline: 1px solid var(--accent); outline-offset: 1px; }
.hm-cell[data-date]:hover { outline: 1px solid var(--text-hi); outline-offset: 0; }
.hm-foot { display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; margin-top: 10px; }
.hm-tip { color: var(--muted); font-size: 11px; min-height: 16px;
  font-variant-numeric: tabular-nums; }
.hm-tip b { color: var(--text-hi); font-weight: 600; }
.hm-legend { display: flex; align-items: center; gap: 3px; color: var(--faint);
  font-size: 10px; flex: none; }
.hm-legend .hm-cell { width: 10px; height: 10px; }
.hm-legend span { margin: 0 4px; }
.hm-summary { color: var(--muted); font-size: 12px; margin-top: 8px;
  padding-top: 8px; border-top: 1px solid var(--border-soft); }
.hm-summary b { color: var(--text-hi); font-variant-numeric: tabular-nums; }
`;

/**
 * Render the dashboard HTML document.
 */
export function renderDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coding Plan Gateway · 监控仪表盘</title>
<style>${STYLES}</style>
</head>
<body>
${renderBody()}
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

/** Page body markup, kept separate to stay within function length limits */
// eslint-disable-next-line max-lines-per-function
function renderBody(): string {
  return `<header class="topbar">
  <h1>Coding Plan Gateway</h1>
  <span class="sub">只读监控</span>
  <div class="spacer"></div>
  <button class="btn" id="refreshBtn">刷新</button>
  <button class="btn" id="keyBtn">访问设置</button>
</header>
<div id="status">加载中…</div>
<section class="stats">
  <div class="stat-card"><div class="label">进行中请求</div><div class="value live" id="statActive">–</div></div>
  <div class="stat-card"><div class="label">累计完成请求</div><div class="value" id="statRequests">–</div></div>
  <div class="stat-card"><div class="label">累计失败请求</div><div class="value err" id="statFailed">–</div></div>
  <div class="stat-card"><div class="label">本次运行 Tokens</div><div class="value" id="statTokens">–</div></div>
</section>
<main class="main">
  <div class="duo">
    <div class="panel">
      <h2>进行中请求<span class="badge" id="activeBadge"></span></h2>
      <div id="activeWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>Plan 余量 / 余额</h2>
      <div id="quotaWrap"><div class="empty">加载中…</div></div>
    </div>
  </div>
  <div class="panel">
    <h2>历史 Token 日历</h2>
    <div id="historyWrap"><div class="empty">加载中…</div></div>
  </div>
  <div class="duo">
    <div class="panel">
      <h2>Token 消耗 · 按 API Key（本次运行）</h2>
      <div id="keysWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>Token 消耗 · 按 Plan（本次运行 + 历史）</h2>
      <div id="plansUsageWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
  </div>
  <div class="panel" id="modelsPanel">
    <h2>按模型的 Token 用量（本次运行 + 历史）</h2>
    <div id="modelsWrap" class="table-wrap"><div class="empty">加载中…</div></div>
  </div>
  <div class="panel">
    <h2>近期完成的请求</h2>
    <div id="recentWrap" class="table-wrap"><div class="empty">加载中…</div></div>
  </div>
  <div class="panel">
    <h2>近期错误</h2>
    <div id="errorList"><div class="empty">加载中…</div></div>
  </div>
</main>
<div id="balanceModal">
  <div class="bm-dialog">
    <div class="bm-head">
      <h3 id="bmTitle">余额历史 · K线</h3>
      <span class="bm-sub">红涨绿跌 · 1h/12h/1d 颗粒度可切换 · 余额无变化的时段已折叠 · 折线为收盘余额</span>
      <button class="bm-close" id="bmClose" title="关闭 (Esc)">✕</button>
    </div>
    <div id="bmBody"></div>
  </div>
</div>
<div id="keyPrompt">
  <div class="dialog">
    <h3>访问设置</h3>
    <p>本仪表盘为只读监控，默认无需鉴权。若你的网关通过 <code>AUTH_EXEMPT_PATHS</code> 锁定了数据接口，请在此填入一个有效 API Key（仅保存在当前浏览器会话）。</p>
    <input id="keyInput" type="password" placeholder="cpg-…（通常留空即可）" autocomplete="off">
    <div class="row">
      <button class="btn" id="keyClear">清除</button>
      <button class="btn" id="keySave">保存并刷新</button>
    </div>
  </div>
</div>`;
}
