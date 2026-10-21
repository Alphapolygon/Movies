/** Pure validation / identity / filtering helpers. No DOM or browser storage. */
const TITLE_ALIASES = new Map([['a silent voice the movie', 'a silent voice']]);
export function normalizeTitle(value) {
  const title = String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return TITLE_ALIASES.get(title) || title;
}
export function titleOf(item) { return String(item?.title || item?.name || 'Untitled'); }
export function yearOf(item) {
  const y = String(item?.year || item?.release_date || item?.first_air_date || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? y : '';
}
export function titleYearKey(item) { return `${normalizeTitle(titleOf(item))}|${yearOf(item)}`; }
export function mediaType(item) { return ['movie', 'tv'].includes(item?.media_type) ? item.media_type : 'unknown'; }
export function itemKey(item) {
  if (item?.key && /^(lb:|movie:|tv:)/.test(item.key)) return item.key;
  if (['movie', 'tv'].includes(item?.media_type) && Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0)
    return `${item.media_type}:${Number(item.id)}`;
  return `lb:${titleYearKey(item)}`;
}
export function safeURL(value, hosts = []) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    if (hosts.length && !hosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) return '';
    return u.href;
  } catch { return ''; }
}
export function imageURL(path, size = 'w500') {
  return typeof path === 'string' && /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid title record.');
  const title = titleOf(raw).trim();
  if (!title || title === 'Untitled' || title.length > 500) throw new Error('Invalid title name.');
  const type = mediaType(raw), id = Number(raw.id);
  const item = { title, year: yearOf(raw), media_type: type };
  if (type !== 'unknown') {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid TMDB identifier.');
    item.id = id;
  }
  item.key = itemKey(item);
  item.poster_path = imageURL(raw.poster_path) ? raw.poster_path : null;
  item.backdrop_path = imageURL(raw.backdrop_path) ? raw.backdrop_path : null;
  item.genre_ids = [...new Set((Array.isArray(raw.genre_ids) ? raw.genre_ids : raw.genres?.map(g => g.id) || [])
    .filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 30);
  item.overview = typeof raw.overview === 'string' ? raw.overview.slice(0, 10000) : '';
  item.vote_average = Number.isFinite(raw.vote_average) && raw.vote_average >= 0 && raw.vote_average <= 10 ? raw.vote_average : null;
  item.vote_count = Number.isFinite(raw.vote_count) && raw.vote_count >= 0 ? raw.vote_count : 0;
  item.popularity = Number.isFinite(raw.popularity) ? raw.popularity : 0;
  item.release_date = String(raw.release_date || raw.first_air_date || item.year).slice(0, 10);
  item.runtime = Number.isInteger(raw.runtime) && raw.runtime > 0 ? raw.runtime : null;
  item.url = safeURL(raw.url, ['letterboxd.com', 'boxd.it']);
  return item;
}
export function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => { const key = itemKey(item); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function decadeMatches(item, decades = []) {
  return !decades.length || decades.map(String).includes(String(Math.floor(Number(yearOf(item)) / 10) * 10));
}
export function discoverParams(filters, page, region, today = new Date().toISOString().slice(0, 10)) {
  const tv = filters.type === 'tv';
  const date = tv ? 'first_air_date' : 'primary_release_date';
  const sort = { popular: 'popularity.desc', rating: 'vote_average.desc', newest: `${date}.desc` }[filters.sort] || 'popularity.desc';
  const params = { page, sort_by: sort, include_adult: false, 'vote_count.gte': filters.sort === 'rating' ? 200 : 50,
    [`${date}.lte`]: today };
  if (filters.genres?.length) params.with_genres = filters.genres.join('|');
  if (filters.decades?.length) {
    const years = filters.decades.map(Number).filter(y => Number.isInteger(y) && y >= 1900 && y <= 2100);
    if (years.length) {
      params[`${date}.gte`] = `${Math.min(...years)}-01-01`;
      params[`${date}.lte`] = [`${Math.max(...years) + 9}-12-31`, today].sort()[0];
    }
  }
  if (filters.providers?.length) params.with_watch_providers = filters.providers.join('|');
  if (filters.available || filters.providers?.length) {
    params.watch_region = validRegion(region) ? region : 'FI';
    params.with_watch_monetization_types = filters.access === 'all' ? 'flatrate|free|ads|rent|buy' : 'flatrate|free|ads';
  }
  return params;
}
export function validRegion(value) { return typeof value === 'string' && /^[A-Z]{2}$/.test(value); }
export function availabilityFrom(data, region) {
  if (!data || !data.results || typeof data.results !== 'object') throw new Error('Availability data is missing.');
  const local = data.results[region] || {};
  const result = { status: 'ok', region, link: safeURL(local.link, ['themoviedb.org']), checkedAt: Date.now() };
  for (const mode of ['flatrate', 'free', 'ads', 'rent', 'buy']) {
    result[mode] = (Array.isArray(local[mode]) ? local[mode] : []).filter(p => p && Number.isSafeInteger(p.provider_id))
      .map(p => ({ id: p.provider_id, name: String(p.provider_name || 'Service'), logo: imageURL(p.logo_path, 'w92') }));
  }
  return result;
}
export function streamProviders(watch, access = 'stream') {
  const types = access === 'all' ? ['flatrate', 'free', 'ads', 'rent', 'buy'] : ['flatrate', 'free', 'ads'];
  const seen = new Set();
  return types.flatMap(t => watch?.[t] || []).filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
}
export function sortItems(items, sort, status = () => ({})) {
  return [...items].sort((a, b) => {
    const sa = status(a), sb = status(b);
    if (sort === 'priority') return (sb.priority || 0) - (sa.priority || 0) || titleOf(a).localeCompare(titleOf(b));
    if (sort === 'recent') return (sb.savedAt || 0) - (sa.savedAt || 0) || titleOf(a).localeCompare(titleOf(b));
    if (sort === 'newest') return Number(yearOf(b)) - Number(yearOf(a)) || titleOf(a).localeCompare(titleOf(b));
    if (sort === 'oldest') return Number(yearOf(a) || 9999) - Number(yearOf(b) || 9999) || titleOf(a).localeCompare(titleOf(b));
    if (sort === 'rating') return (sb.rating ?? -1) - (sa.rating ?? -1) || titleOf(a).localeCompare(titleOf(b));
    return titleOf(a).localeCompare(titleOf(b));
  });
}
/** Exact title + year only. Never silently select the first/fuzzy search result. */
export function exactCandidates(source, candidates) {
  const year = yearOf(source);
  if (!year) return [];
  return dedupeItems(candidates.filter(c => ['movie', 'tv'].includes(c.media_type) && yearOf(c) === year &&
    (normalizeTitle(titleOf(c)) === normalizeTitle(titleOf(source)) ||
      normalizeTitle(c.original_title || c.original_name || '') === normalizeTitle(titleOf(source)))));
}
export function abortError() { return new DOMException('Request cancelled.', 'AbortError'); }
export function parseRoute(hash) {
  const [path, query = ''] = (hash || '#discover').replace(/^#/, '').split('?');
  const p = new URLSearchParams(query), segments = path.split('/');
  const validModes = ['discover', 'search', 'person', 'movie', 'tv', 'title', 'watchlist', 'for-you', 'seen'];
  const mode = validModes.includes(segments[0]) ? segments[0] : 'discover';
  const type = p.get('type') === 'tv' ? 'tv' : 'movie';
  const list = name => (p.get(name) || '').split(',').filter(x => /^\d{1,8}$/.test(x)).slice(0, 30);
  let key = '';
  try { key = decodeURIComponent(segments.slice(1).join('/')); } catch { /* malformed hash -> empty state */ }
  return { mode, key, id: /^\d{1,10}$/.test(key) ? Number(key) : null, type,
    kind: ['movie', 'tv', 'actor', 'director'].includes(p.get('kind')) ? p.get('kind') : 'movie',
    role: p.get('role') === 'director' ? 'director' : 'actor', q: (p.get('q') || '').slice(0, 250),
    sort: ['popular', 'rating', 'newest', 'oldest', 'alpha', 'priority', 'recent'].includes(p.get('sort')) ? p.get('sort') : (mode === 'discover' ? 'popular' : 'alpha'),
    genres: list('genres'), decades: list('decades'), providers: list('providers'),
    available: p.get('available') === '1', access: p.get('access') === 'all' ? 'all' : 'stream',
    mood: (p.get('mood') || '').slice(0, 50), source: ['watchlist', 'discovery'].includes(p.get('source')) ? p.get('source') : '',
    status: ['all', 'watched', 'unwatched', 'priority'].includes(p.get('status')) ? p.get('status') : 'all' };
}
export function routeHash(route) {
  const p = new URLSearchParams();
  const mode = route.mode || 'discover';
  for (const key of ['type', 'kind', 'role', 'q', 'sort', 'mood', 'source', 'status', 'access']) {
    if (route[key]) p.set(key, route[key]);
  }
  for (const key of ['genres', 'decades', 'providers']) if (route[key]?.length) p.set(key, route[key].join(','));
  if (route.available) p.set('available', '1');
  const id = ['movie', 'tv', 'person', 'title'].includes(mode) ? `/${encodeURIComponent(route.key || route.id || '')}` : '';
  return `#${mode}${id}${p.size ? `?${p}` : ''}`;
}
export function titleRoute(item) {
  return mediaType(item) !== 'unknown' ? `#${item.media_type}/${item.id}` : `#title/${encodeURIComponent(itemKey(item))}`;
}
