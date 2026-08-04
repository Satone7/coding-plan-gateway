/**
 * Read-only monitoring dashboard page.
 * Zero-build: the whole app (styles + client script) is inlined and served as
 * a single HTML document. No external requests are made, so the page works
 * fully offline behind the gateway's own auth.
 *
 * The page is organized around four accurate, table-first views:
 *   1. in-flight requests (key / model / plan / elapsed, ticking every second)
 *   2. per-API-key token usage (current run + persisted history)
 *   3. per-model token usage (current run + persisted history)
 *   4. per-plan remaining quota/balance (plans without an authoritative
 *      remaining-quota signal are omitted, never guessed)
 * plus a recent-requests table and a recent-errors panel.
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
  function fmtFull(n) {
    if (n == null || isNaN(n)) return '0';
    return Number(n).toLocaleString('en-US');
  }
  function fmtDur(ms) {
    if (ms >= 60000) return Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's';
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

  // ---------- state ----------
  var state = {
    apiKey: sessionStorage.getItem('cpg_dash_key') || '',
    autoTimer: null,
    tickTimer: null,
    summary: null,
    errors: [],
    stats: null,
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
      fetchJson('/api/dashboard/summary'),
      fetchJson('/api/dashboard/errors'),
      fetchJson('/api/dashboard/stats'),
    ]).then(function (results) {
      state.summary = results[0];
      state.errors = (results[1] && results[1].errors) || [];
      state.stats = results[2] && results[2].days ? results[2] : null;
      setStatus('更新于 ' + new Date().toLocaleTimeString());
      render();
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
      wrap.innerHTML = '<div class="empty-sm">当前无进行中的请求</div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>API Key</th><th>入口</th><th>格式</th><th>开始时间</th><th>已进行</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>' +
        '<td class="cell-key">' + escHtml(r.apiKey) + '</td>' +
        '<td class="cell-url">' + escHtml(r.method + ' ' + r.url) + '</td>' +
        '<td>' + escHtml(r.format) + '</td>' +
        '<td class="cell-num">' + fmtTime(r.startedAt) + '</td>' +
        '<td class="cell-num elapsed" data-started="' + escHtml(r.startedAt) + '">' +
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

  // ---------- usage leaderboards (keys / models) ----------
  function mergeHistory(byName) {
    // persisted history across restarts (UsageStatsStore query window)
    return byName || {};
  }

  function renderBoard(wrapSel, live, histNames) {
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
      wrap.innerHTML = '<div class="empty-sm">暂无用量数据</div>';
      return;
    }
    rows.sort(function (a, b) { return (b.tokens + b.histTokens) - (a.tokens + a.histTokens); });
    var maxTok = 0;
    rows.forEach(function (r) { var t = r.tokens + r.histTokens; if (t > maxTok) maxTok = t; });
    var html = '<table><thead><tr>' +
      '<th>名称</th><th class="cell-num">本次运行 Tokens</th><th class="cell-num">历史 Tokens</th>' +
      '<th class="cell-num">本次请求</th><th class="cell-num">历史请求</th><th class="cell-bar"></th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var total = r.tokens + r.histTokens;
      var pct = maxTok > 0 ? Math.round((total / maxTok) * 100) : 0;
      html += '<tr>' +
        '<td class="cell-key" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</td>' +
        '<td class="cell-num">' + fmtNum(r.tokens) + '</td>' +
        '<td class="cell-num muted">' + fmtNum(r.histTokens) + '</td>' +
        '<td class="cell-num">' + fmtNum(r.requests) + '</td>' +
        '<td class="cell-num muted">' + fmtNum(r.histRequests) + '</td>' +
        '<td class="cell-bar"><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function renderBoards() {
    var s = state.summary || {};
    var byModel = state.stats ? mergeHistory(state.stats.byModel) : {};
    var byPlan = state.stats ? mergeHistory(state.stats.byPlan) : {};
    renderBoard('#keysWrap', s.apiKeyUsages, null);
    renderBoard('#modelsWrap', s.modelUsages, byModel);
    renderBoard('#plansUsageWrap', s.planUsages, byPlan);
  }

  // ---------- plan quota / balance ----------
  function renderQuotas() {
    var s = state.summary || {};
    var rows = s.planQuotas || [];
    var wrap = $('#quotaWrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty-sm">暂无可准确查询余量的 Plan（无配额 API 且未配置有限本地配额的 Plan 不会显示）</div>';
      return;
    }
    rows.sort(function (a, b) {
      // most-consumed first for percentage kinds; balances last (not comparable)
      var pa = a.percentage != null ? a.percentage : -1;
      var pb = b.percentage != null ? b.percentage : -1;
      return pb - pa;
    });
    var html = '';
    rows.forEach(function (r) {
      html += quotaCard(r);
    });
    wrap.innerHTML = html;
  }

  function quotaCard(r) {
    var head = '<div class="quota-head"><span class="quota-name">' + escHtml(r.planName) + '</span>' +
      '<span class="quota-kind">' + kindLabel(r.kind) + '</span></div>';
    var body = '';
    if (r.kind === 'balance') {
      body = '<div class="quota-balance">' + escHtml(r.balance || '—') + '</div>' +
        '<div class="quota-sub">账户余额 · 更新于 ' + fmtTime(r.lastUpdated) + '</div>';
    } else if (r.kind === 'usage-api') {
      var pct = Math.round(r.percentage || 0);
      var cls = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
      body = '<div class="quota-head"><span class="quota-pct ' + cls + '">已用 ' + pct + '%</span>' +
        '<span class="quota-pct ' + cls + '">剩余 ' + (100 - pct) + '%</span></div>' +
        '<div class="quota-bar"><div class="quota-fill ' + cls + '" style="width:' + Math.min(100, pct) + '%"></div></div>';
      if (r.windows && r.windows.length > 1) {
        body += '<div class="quota-sub">' + r.windows.map(function (w) {
          return escHtml(w.windowLabel || w.type) + ' ' + Math.round(w.percentage) + '%';
        }).join(' · ') + '</div>';
      }
      body += '<div class="quota-sub">更新于 ' + fmtTime(r.lastUpdated) + '</div>';
    } else { // local-quota
      var pct2 = Math.round(r.percentage || 0);
      var cls2 = pct2 >= 90 ? 'crit' : pct2 >= 70 ? 'warn' : 'ok';
      var resetTxt = r.resetAt ? ' · 重置 ' + fmtTime(r.resetAt) : '';
      body = '<div class="quota-head"><span class="quota-pct ' + cls2 + '">剩余 ' +
        fmtFull(r.remaining) + ' / ' + fmtFull(r.limit) + '</span></div>' +
        '<div class="quota-bar"><div class="quota-fill ' + cls2 + '" style="width:' + Math.min(100, pct2) + '%"></div></div>' +
        '<div class="quota-sub">本地配额已用 ' + pct2 + '%' + escHtml(resetTxt) + '</div>';
    }
    return '<div class="quota-row">' + head + body + '</div>';
  }

  function kindLabel(kind) {
    return { 'usage-api': '配额 API', 'balance': '余额', 'local-quota': '本地配额' }[kind] || kind;
  }

  // ---------- recent requests ----------
  function renderRecent() {
    var s = state.summary || {};
    var rows = (s.recentRequests || []).slice(0, 50);
    var wrap = $('#recentWrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty-sm">本次运行暂无已完成的代理请求</div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>时间</th><th>API Key</th><th>模型</th><th>Plan</th><th>格式</th>' +
      '<th class="cell-num">输入</th><th class="cell-num">输出</th>' +
      '<th class="cell-num">耗时</th><th class="cell-num">状态</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var failed = r.status >= 400;
      var model = r.canonicalModel && r.canonicalModel !== r.model
        ? r.model + ' → ' + r.canonicalModel
        : r.model;
      html += '<tr class="' + (failed ? 'row-failed' : '') + '">' +
        '<td class="cell-num">' + fmtTime(r.at) + '</td>' +
        '<td class="cell-key">' + escHtml(r.apiKey) + '</td>' +
        '<td class="cell-key" title="' + escHtml(model) + '">' + escHtml(model) + '</td>' +
        '<td class="cell-key">' + escHtml(r.plan) + '</td>' +
        '<td>' + escHtml(r.format) + '</td>' +
        '<td class="cell-num">' + fmtNum(r.inputTokens) + '</td>' +
        '<td class="cell-num">' + fmtNum(r.outputTokens) + '</td>' +
        '<td class="cell-num">' + fmtDur(r.durationMs) + '</td>' +
        '<td class="cell-num ' + (failed ? 'st-fail' : 'st-ok') + '">' + r.status + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  // ---------- errors ----------
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

  // ---------- historical daily chart ----------
  function renderHistory() {
    var wrap = $('#historyWrap');
    var s = state.stats;
    if (!s || !s.days) {
      wrap.innerHTML = '<div class="empty-sm">暂无历史统计数据（usage-stats 持久化未启用或无记录）</div>';
      return;
    }
    var days = s.days;
    var totalTok = 0, totalReq = 0;
    days.forEach(function (d) { totalTok += d.totalTokens; totalReq += d.requests; });
    var N = 30;
    var shown = days.slice(-N);
    var html = '<div class="hist-summary"><span>近 ' + days.length + ' 天累计</span>' +
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
    renderRecent();
    renderErrors();
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
.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border); }
.topbar h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: .5px; }
.topbar .sub { color: var(--muted); font-size: 12px; }
.topbar .spacer { flex: 1; }
.btn { background: var(--panel); border: 1px solid var(--border); color: var(--text);
  padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.btn:hover { border-color: var(--brand); }
#status { color: var(--muted); font-size: 12px; padding: 6px 20px 0; }
.stats { display: flex; gap: 14px; padding: 12px 20px 0; flex-wrap: wrap; }
.stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 16px; min-width: 130px; }
.stat-card .label { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.stat-card .value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-card .value.live { color: var(--brand); }
.stat-card .value.err { color: var(--error); }
.main { display: grid; grid-template-columns: 1fr 360px; gap: 14px; padding: 12px 20px 20px; }
@media (max-width: 1100px) { .main { grid-template-columns: 1fr; } }
.col > .panel { margin-bottom: 14px; }
.col > .panel:last-child { margin-bottom: 0; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.panel h2 { font-size: 12px; color: var(--muted); font-weight: 600; margin: 0;
  padding: 10px 14px; border-bottom: 1px solid var(--border); letter-spacing: .5px; }
.panel h2 .badge { display: inline-block; min-width: 18px; text-align: center; background: var(--brand);
  color: var(--bg); border-radius: 9px; font-size: 11px; padding: 0 5px; margin-left: 6px; }
.table-wrap { overflow-x: auto; padding: 4px 6px 8px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px;
  padding: 8px 8px 6px; border-bottom: 1px solid var(--border); white-space: nowrap; }
td { padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
tr:last-child td { border-bottom: none; }
.cell-num { text-align: right; font-variant-numeric: tabular-nums; }
th.cell-num { text-align: right; }
.cell-key { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.cell-url { color: var(--muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.muted { color: var(--muted); }
.row-failed td { background: rgba(247, 118, 142, .06); }
.st-ok { color: var(--success); }
.st-fail { color: var(--error); font-weight: 600; }
.cell-bar { width: 90px; }
.bar { height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--brand); border-radius: 4px; opacity: .8; }
.empty-sm { color: var(--muted); padding: 14px; text-align: center; font-size: 12px; }
.elapsed { color: var(--brand); font-weight: 600; }
/* quota cards */
.quota-row { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.quota-row:last-child { border-bottom: none; }
.quota-head { display: flex; justify-content: space-between; margin-bottom: 4px; gap: 8px; }
.quota-name { font-size: 12px; font-weight: 600; }
.quota-kind { color: var(--muted); font-size: 10px; border: 1px solid var(--border);
  border-radius: 3px; padding: 0 5px; align-self: center; white-space: nowrap; }
.quota-balance { font-size: 18px; font-weight: 600; color: var(--success);
  font-variant-numeric: tabular-nums; margin: 4px 0 2px; }
.quota-pct { font-size: 12px; font-variant-numeric: tabular-nums; }
.quota-pct.ok { color: var(--success); } .quota-pct.warn { color: var(--warning); }
.quota-pct.crit { color: var(--error); }
.quota-bar { height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; margin: 4px 0; }
.quota-fill { height: 100%; border-radius: 3px; transition: width .4s; }
.quota-fill.ok { background: var(--success); } .quota-fill.warn { background: var(--warning); }
.quota-fill.crit { background: var(--error); }
.quota-sub { color: var(--muted); font-size: 11px; margin-top: 3px; }
/* errors */
.err-row { display: flex; gap: 8px; padding: 7px 14px; border-bottom: 1px solid var(--border);
  font-size: 12px; align-items: baseline; }
.err-row:last-child { border-bottom: none; }
.err-time { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.err-body { min-width: 0; }
.err-msg { color: var(--error); display: block; }
.err-detail { color: var(--muted); display: block; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
/* key prompt */
#keyPrompt { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: none;
  align-items: center; justify-content: center; z-index: 200; }
#keyPrompt .dialog { background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 20px; width: 360px; }
#keyPrompt h3 { margin: 0 0 8px; font-size: 14px; }
#keyPrompt p { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
#keyInput { width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 4px; padding: 8px; font-size: 13px; margin-bottom: 12px; }
#keyPrompt .row { display: flex; gap: 8px; justify-content: flex-end; }
/* historical daily chart */
.hist-summary { padding: 10px 14px 0; color: var(--muted); font-size: 12px; }
.hist-summary b { color: var(--text); font-variant-numeric: tabular-nums; }
.hist-chart { display: flex; align-items: flex-end; gap: 2px; height: 110px;
  padding: 12px 14px 4px; }
.hist-col { flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: flex-end; height: 100%; min-width: 0; cursor: default; }
.hist-bar-wrap { width: 100%; flex: 1; display: flex; align-items: flex-end; }
.hist-bar { width: 100%; background: var(--brand); border-radius: 2px 2px 0 0;
  opacity: .75; min-height: 0; }
.hist-col:hover .hist-bar { opacity: 1; }
.hist-x { font-size: 9px; color: var(--muted); margin-top: 4px; white-space: nowrap;
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
      <div id="activeWrap" class="table-wrap"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>按 API Key 的 Token 用量（本次运行）</h2>
      <div id="keysWrap" class="table-wrap"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>按模型的 Token 用量（本次运行 + 历史）</h2>
      <div id="modelsWrap" class="table-wrap"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>按 Plan 的 Token 用量（本次运行 + 历史）</h2>
      <div id="plansUsageWrap" class="table-wrap"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>近期完成的请求</h2>
      <div id="recentWrap" class="table-wrap"><div class="empty-sm">加载中…</div></div>
    </div>
  </div>
  <div class="col">
    <div class="panel">
      <h2>Plan 余量 / 余额（仅显示可准确查询的 Plan）</h2>
      <div id="quotaWrap"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>历史每日 Token 统计 · 跨重启持久化</h2>
      <div id="historyWrap"><div class="empty-sm">加载中…</div></div>
    </div>
    <div class="panel">
      <h2>近期错误（上游 / 网关）</h2>
      <div id="errorList"><div class="empty-sm">加载中…</div></div>
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
