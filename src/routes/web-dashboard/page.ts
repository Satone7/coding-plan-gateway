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
 * Content panels:
 *   1. in-flight requests (key / entry / format / elapsed, ticking every second)
 *   2. per-API-key token usage (current run)
 *   3. per-model & per-plan token usage (current run merged with history)
 *   4. plan quota / balance cards (balances first, usage-API windows second,
 *      local-quota plans last without any guessed remaining figure)
 *   5. recent requests table (paginated, filterable by status/key/plan/model)
 *      + recent errors (paginated, filterable by level/keyword)
 *      + persisted daily history
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
  function fmtDur(ms) {
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

  // ---------- state ----------
  var state = {
    apiKey: sessionStorage.getItem('cpg_dash_key') || '',
    autoTimer: null,
    tickTimer: null,
    summary: null,
    errors: [],
    stats: null,
    // recent-requests panel: filters + pagination
    recentFilter: { status: 'all', key: 'all', plan: 'all', model: '' },
    recentPage: 0,
    // recent-errors panel: filters + pagination
    errorFilter: { level: 'all', q: '' },
    errorPage: 0,
  };
  var PAGE_SIZE = 20;

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
    ]).then(function (results) {
      state.summary = results[0];
      state.errors = (results[1] && results[1].errors) || [];
      state.stats = results[2] && results[2].days ? results[2] : null;
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

  // ---------- active requests ----------
  function renderActive() {
    var s = state.summary;
    var rows = (s && s.activeRequests) || [];
    $('#activeBadge').textContent = rows.length ? String(rows.length) : '';
    var wrap = $('#activeWrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">当前无进行中的请求</div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>API Key</th><th>模型</th><th>入口</th><th>格式</th><th>开始时间</th><th class="num">已进行</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>' +
        '<td class="key">' + escHtml(r.apiKey) + '</td>' +
        '<td class="key">' + escHtml(r.model || '…') + '</td>' +
        '<td class="url">' + escHtml(r.method + ' ' + r.url) + '</td>' +
        '<td><span class="chip">' + escHtml(r.format) + '</span></td>' +
        '<td class="num muted">' + fmtTime(r.startedAt) + '</td>' +
        '<td class="num elapsed" data-started="' + escHtml(r.startedAt) + '">' +
          fmtDur(r.elapsedMs) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
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
    renderBoard('#modelsWrap', s.modelUsages, byModel, '模型');
    renderBoard('#plansUsageWrap', s.planUsages, byPlan, 'Plan');
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
      body = '<div class="q-balance">' + escHtml(r.balance || '—') + '</div>' +
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
      if (!btn || btn.disabled) return;
      var panel = btn.getAttribute('data-panel');
      var dir = parseInt(btn.getAttribute('data-dir'), 10);
      if (panel === 'recent') { state.recentPage += dir; renderRecent(); }
      if (panel === 'error') { state.errorPage += dir; renderErrors(); }
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

  // ---------- historical daily chart ----------
  function renderHistory() {
    var wrap = $('#historyWrap');
    var s = state.stats;
    if (!s || !s.days) {
      wrap.innerHTML = '<div class="empty">暂无历史统计数据<span class="empty-sub">usage-stats 持久化未启用或无记录</span></div>';
      return;
    }
    var days = s.days;
    var totalTok = 0, totalReq = 0;
    days.forEach(function (d) { totalTok += d.totalTokens; totalReq += d.requests; });
    var shown = days.slice(-30);
    var html = '<div class="hist-summary">近 ' + days.length + ' 天累计 ' +
      '<b>' + fmtNum(totalTok) + '</b> tokens · <b>' + fmtNum(totalReq) + '</b> 请求</div>';
    var maxTok = 1;
    shown.forEach(function (d) { if (d.totalTokens > maxTok) maxTok = d.totalTokens; });
    html += '<div class="hist-chart">';
    shown.forEach(function (d) {
      var pct = Math.round((d.totalTokens / maxTok) * 100);
      html += '<div class="hist-col" title="' + d.date + '：' + fmtNum(d.totalTokens) + ' tok · ' + d.requests + ' 次">' +
        '<div class="hist-bar-wrap"><div class="hist-bar" style="height:' + Math.max(pct, d.totalTokens > 0 ? 3 : 0) + '%"></div></div>' +
        '<div class="hist-x">' + d.date.slice(5) + '</div></div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
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
.main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px;
  padding: 16px 24px 24px; }
@media (max-width: 1100px) { .main { grid-template-columns: 1fr; } }
.col > .panel { margin-bottom: 16px; }
.col > .panel:last-child { margin-bottom: 0; }
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

/* ---------- historical daily chart ---------- */
.hist-summary { padding: 12px 16px 0; color: var(--muted); font-size: 12px; }
.hist-summary b { color: var(--text-hi); font-variant-numeric: tabular-nums; }
.hist-chart { display: flex; align-items: flex-end; gap: 2px; height: 110px;
  padding: 12px 16px 6px; }
.hist-col { flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: flex-end; height: 100%; min-width: 0; cursor: default; }
.hist-bar-wrap { width: 100%; flex: 1; display: flex; align-items: flex-end; }
.hist-bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0;
  opacity: .65; min-height: 0; transition: opacity .12s ease; }
.hist-col:hover .hist-bar { opacity: 1; }
.hist-x { font-size: 9px; color: var(--faint); margin-top: 4px; white-space: nowrap;
  transform: rotate(-45deg); transform-origin: center; }
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
  <div class="col">
    <div class="panel">
      <h2>进行中请求<span class="badge" id="activeBadge"></span></h2>
      <div id="activeWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>按 API Key 的 Token 用量（本次运行）</h2>
      <div id="keysWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>按模型的 Token 用量（本次运行 + 历史）</h2>
      <div id="modelsWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>按 Plan 的 Token 用量（本次运行 + 历史）</h2>
      <div id="plansUsageWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>近期完成的请求</h2>
      <div id="recentWrap" class="table-wrap"><div class="empty">加载中…</div></div>
    </div>
  </div>
  <div class="col">
    <div class="panel">
      <h2>Plan 余量 / 余额</h2>
      <div id="quotaWrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>历史每日 Token 统计</h2>
      <div id="historyWrap"><div class="empty">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>近期错误</h2>
      <div id="errorList"><div class="empty">加载中…</div></div>
    </div>
  </div>
</main>
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
