import { API_BASE, API_TIMEOUT_MS, MAX_CONCURRENT_REQUESTS } from './config.js';
import { abortError } from './core.js';
export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}
/** FIFO concurrency bound; aborted queue entries do not consume a connection. */
export class RequestPool {
  constructor(limit = MAX_CONCURRENT_REQUESTS) { this.limit = limit; this.active = 0; this.queue = []; }
  run(task, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const job = { task, resolve, reject, signal, started: false };
      const cancel = () => {
        if (!job.started) { this.queue = this.queue.filter(j => j !== job); reject(abortError()); }
      };
      job.cleanup = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(job); this.drain();
    });
  }
  drain() {
    while (this.active < this.limit && this.queue.length) {
      const job = this.queue.shift(); job.cleanup();
      if (job.signal?.aborted) { job.reject(abortError()); continue; }
      job.started = true; this.active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { this.active--; this.drain(); });
    }
  }
}
export class ApiClient {
  constructor({ base = API_BASE, fetcher = globalThis.fetch.bind(globalThis), timeout = API_TIMEOUT_MS, concurrency = MAX_CONCURRENT_REQUESTS } = {}) {
    this.base = base.replace(/\/$/, ''); this.fetcher = fetcher; this.timeout = timeout;
    this.pool = new RequestPool(concurrency); this.cache = new Map(); this.pending = new Map();
    this.signals = new WeakMap(); this.sequence = 0;
  }
  async get(path, params = {}, { signal, ttl = 300000 } = {}) {
    if (signal?.aborted) throw abortError();
    if (!/^\/[a-z0-9_/-]+$/i.test(path)) throw new ApiError('Invalid API path.');
    const url = new URL(this.base + path);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    url.searchParams.sort(); const key = url.href, cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.data;
    if (signal && !this.signals.has(signal)) this.signals.set(signal, ++this.sequence);
    // In-flight sharing is scoped to one view's cancellation lifetime.
    const pendingKey = `${key}::${signal ? this.signals.get(signal) : 0}`;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const task = this.pool.run(async () => {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController(); let timedOut = false;
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeout);
      try {
        const response = await this.fetcher(url.href, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
        if (!response.ok) {
          const messages = { 401: 'The movie service needs a valid API credential on its proxy.', 403: 'The movie service denied this request.', 404: 'This title was not found.', 429: 'The movie service is busy. Please retry shortly.' };
          throw new ApiError(messages[response.status] || `Movie service error (${response.status}).`, response.status);
        }
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.success === false) throw new ApiError('The movie service returned an invalid response.');
        this.cache.delete(key); this.cache.set(key, { data, expires: Date.now() + ttl });
        while (this.cache.size > 250) this.cache.delete(this.cache.keys().next().value);
        return data;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw new ApiError('The movie service timed out. Your saved library is still available.');
        if (error instanceof ApiError) throw error;
        throw new ApiError('Cannot reach the movie service. Check your connection or the configured proxy.');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }, signal);
    this.pending.set(pendingKey, task);
    try { return await task; } finally { this.pending.delete(pendingKey); }
  }
}
