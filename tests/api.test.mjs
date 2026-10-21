import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, RequestPool, ApiError } from '../js/api.js';
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('request concurrency is bounded', async () => {
  const pool = new RequestPool(4); let active = 0, max = 0;
  await Promise.all(Array.from({ length: 25 }, () => pool.run(async () => { active++; max = Math.max(max, active); await delay(3); active--; })));
  assert.equal(max, 4); assert.equal(active, 0);
});
test('queued aborted work does not start', async () => {
  const pool = new RequestPool(1), ac = new AbortController(); let ran = false;
  const first = pool.run(() => delay(10)); const queued = pool.run(() => { ran = true; }, ac.signal);
  ac.abort(); await assert.rejects(queued, { name: 'AbortError' }); await first; assert.equal(ran, false);
});
test('same-view duplicate requests share one network response and then cache', async () => {
  let requests = 0; const api = new ApiClient({ fetcher: async () => { requests++; await delay(5); return response({ results: [] }); } });
  const ac = new AbortController(); await Promise.all([api.get('/search/movie', { query: 'x' }, { signal: ac.signal }), api.get('/search/movie', { query: 'x' }, { signal: ac.signal })]);
  await api.get('/search/movie', { query: 'x' }); assert.equal(requests, 1);
});
test('HTTP errors surface and failures are never cached', async () => {
  let count = 0; const api = new ApiClient({ fetcher: async () => { count++; return new Response('', { status: 429 }); } });
  await assert.rejects(api.get('/discover/movie'), error => error instanceof ApiError && error.status === 429);
  await assert.rejects(api.get('/discover/movie')); assert.equal(count, 2);
});
test('malformed successful bodies are rejected', async () => {
  for (const value of [null, [], { success: false }]) {
    const api = new ApiClient({ fetcher: async () => response(value) }); await assert.rejects(api.get('/movie/1'), ApiError);
  }
});
test('timeouts abort transport and yield an actionable error', async () => {
  const api = new ApiClient({ timeout: 10, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  await assert.rejects(api.get('/movie/1'), /timed out/);
});
test('abort signals are isolated between views', async () => {
  let calls = 0; const api = new ApiClient({ fetcher: (_url, { signal }) => new Promise((resolve, reject) => {
    calls++; const timer = setTimeout(() => resolve(response({ id: 1 })), 25);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
  }) });
  const a = new AbortController(), b = new AbortController();
  const first = api.get('/movie/1', {}, { signal: a.signal }); const second = api.get('/movie/1', {}, { signal: b.signal });
  await delay(2); a.abort(); await assert.rejects(first, { name: 'AbortError' }); assert.equal((await second).id, 1); assert.equal(calls, 2);
});
test('cache has a hard entry bound and does not swallow forbidden requests', async () => {
  const api = new ApiClient({ fetcher: async () => response({ id: 1 }) });
  for (let i = 1; i <= 270; i++) await api.get(`/movie/${i}`);
  assert.equal(api.cache.size, 250); await assert.rejects(api.get('https://evil.test'), /Invalid API path/);
});
test('expired responses are fetched again', async () => {
  let calls = 0; const api = new ApiClient({ fetcher: async () => { calls++; return response({ id: 1 }); } });
  await api.get('/movie/1', {}, { ttl: 1 }); await delay(5); await api.get('/movie/1'); assert.equal(calls, 2);
});
