#!/usr/bin/env node
/**
 * 确定性复现：coding-plan-gateway 非流式/流式旁路逐 chunk UTF-8 解码导致 U+FFFD。
 * 直接驱动仓库编译产物 dist/services/request-proxy.js（与生产容器同构），
 * mock upstream 强制把 TCP chunk 边界切在多字节字符内部。不发任何真实上游请求。
 */
'use strict';
const http = require('http');
const PROXY = require(require('path').resolve(__dirname, '..', 'dist', 'services', 'request-proxy.js'));

const countFFFD = (s) => (s.match(/\uFFFD/g) || []).length;

function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/** 把 body 按给定字节偏移列表切开、带间隔地写出，确保到达客户端是多个 data 事件 */
function writeSplit(res, body, offsets, delayMs = 30) {
  res.socket.setNoDelay(true);
  const parts = [];
  let prev = 0;
  for (const off of offsets) { parts.push(body.slice(prev, off)); prev = off; }
  parts.push(body.slice(prev));
  let i = 0;
  const writeNext = () => {
    if (i < parts.length) {
      res.write(parts[i++]);
      setTimeout(writeNext, delayMs);
    } else {
      res.end();
    }
  };
  writeNext();
}

// ---------- 1) 非流式 Anthropic /v1/messages ----------
async function reproNonStream(text, offsets) {
  const fullText = `坚持使用同一${text}指标`;
  const payload = JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
    content: [{ type: 'text', text: fullText }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  const body = Buffer.from(payload, 'utf8');
  const charBytes = Buffer.from(text, 'utf8');
  const rel = body.indexOf(charBytes);
  if (rel < 0) throw new Error('target not found');
  const abs = offsets.map((k) => rel + k);

  const { server, url } = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    writeSplit(res, body, abs);
  });
  const proxy = new PROXY.RequestProxy();
  try {
    const resp = await proxy.forwardAnthropicRequest(
      { model: 'test', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
      { baseUrl: url, apiKey: 'k', timeout: 10 }
    );
    const t = resp.data.content[0].text;
    return { text: t, fffd: countFFFD(t) };
  } finally {
    server.close();
  }
}

// ---------- 2) 流式 SSE：旁路 accumulatedText vs 用户可见 raw body ----------
async function reproStream(deltaText, offsets) {
  const ev = (obj) => Buffer.from(`event: x\ndata: ${JSON.stringify(obj)}\n\n`, 'utf8');
  const deltaPayload = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `坚持使用同一${deltaText}指标` } };
  const evBuf = ev(deltaPayload);
  const charBytes = Buffer.from(deltaText, 'utf8');
  const rel = evBuf.indexOf(charBytes);
  const abs = offsets.map((k) => rel + k);

  const head = ev({ type: 'message_start', message: { usage: { input_tokens: 7 } } });
  const tail = ev({ type: 'message_delta', delta: {}, usage: { output_tokens: 9 } });

  const { server, url } = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.socket.setNoDelay(true);
    const cuts = [abs[0], ...abs.slice(1)];
    const parts = [head];
    let prev = 0;
    for (const c of cuts) { parts.push(evBuf.slice(prev, c)); prev = c; }
    parts.push(evBuf.slice(prev));
    parts.push(tail);
    let i = 0;
    const next = () => {
      if (i < parts.length) { res.write(parts[i++]); setTimeout(next, 30); } else { res.end(); }
    };
    next();
  });

  const clientChunks = [];
  const fakeRaw = {
    setHeader() {}, get headersSent() { return true; },
    write(d) { clientChunks.push(Buffer.from(d)); return true; },
    end() {}, on() {}, removeListener() {},
  };
  const fakeReply = { raw: fakeRaw, hijack() {} };

  let accumulated;
  const proxy = new PROXY.RequestProxy();
  await proxy.forwardAnthropicStream(
    { model: 'test', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hi' }] },
    { baseUrl: url, apiKey: 'k', timeout: 10 },
    () => {},
    fakeReply,
    (usage, acc) => { accumulated = acc; }
  );
  server.close();
  const clientBody = Buffer.concat(clientChunks).toString('utf8');
  return { accumulated, accFFFD: countFFFD(accumulated), clientFFFD: countFFFD(clientBody) };
}

// ---------- 3) 流式错误响应收集路径（4xx） ----------
async function reproError(offsets) {
  const payload = Buffer.from(JSON.stringify({ error: { message: '同一套指标无效' } }), 'utf8');
  const charBytes = Buffer.from('套', 'utf8');
  const rel = payload.indexOf(charBytes);
  const abs = offsets.map((k) => rel + k);
  const { server, url } = await startUpstream((req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' });
    writeSplit(res, payload, abs);
  });
  const proxy = new PROXY.RequestProxy();
  let errMsg;
  try {
    await proxy.forwardAnthropicStream(
      { model: 'test', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      { baseUrl: url, apiKey: 'k', timeout: 10 },
      () => {},
      { raw: { setHeader() {}, get headersSent() { return false; }, write() { return true; }, end() {}, on() {}, removeListener() {} }, hijack() {} }
    );
  } catch (e) {
    errMsg = e.message;
  }
  server.close();
  return { errMsg, fffd: countFFFD(errMsg || '') };
}

(async () => {
  console.log('node', process.version);
  console.log('== 基线语义 ==');
  console.log("Buffer.from('套') =", Buffer.from('套').toString('hex'), '(3 字节)');
  console.log("'' + Buffer.from([0xe5]) =", JSON.stringify('' + Buffer.from([0xe5])), '(Node 逐 chunk 解码演示)');

  console.log('\n== 1) 非流式 JSON 聚合 (handleResponse) ==');
  const cases = [
    ['不拆包(对照)', '套', []],
    ['1+2 拆分', '套', [1]],
    ['2+1 拆分', '套', [2]],
    ['1+1+1 拆分', '套', [1, 2]],
    ['emoji 4字节拆3处', '😀', [1, 2, 3]],
  ];
  for (const [name, text, offsets] of cases) {
    if (offsets.length === 0) {
      // 对照：一次性写整个 body
      const payload = Buffer.from(JSON.stringify({ content: [{ type: 'text', text: '坚持使用同一套指标' }] }), 'utf8');
      const { server, url } = await startUpstream((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(payload); });
      const proxy = new PROXY.RequestProxy();
      const resp = await proxy.forwardAnthropicRequest({ model: 't', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }, { baseUrl: url, apiKey: 'k', timeout: 10 });
      server.close();
      const t = resp.data.content[0].text;
      console.log(`${name.padEnd(24)} -> U+FFFD x${countFFFD(t)}  text="${t}"`);
    } else {
      const r = await reproNonStream(text, offsets);
      console.log(`${name.padEnd(24)} -> U+FFFD x${r.fffd}  text="${r.text}"`);
    }
  }

  console.log('\n== 2) 流式 SSE：旁路解析 vs 用户可见 body ==');
  const s = await reproStream('套', [1]);
  console.log(`accumulatedText U+FFFD x${s.accFFFD}  acc="${s.accumulated}"`);
  console.log(`客户端 raw body U+FFFD  x${s.clientFFFD}  (原样 Buffer 转发，未损坏)`);

  console.log('\n== 3) 流式错误响应收集 (429) ==');
  const e = await reproError([1]);
  console.log(`errorMessage U+FFFD x${e.fffd}  msg="${e.errMsg}"`);
  process.exit(0);
})().catch((err) => { console.error('FATAL', err); process.exit(1); });
