import { ApiClient, ApiError } from './api.js';
import { LibraryStore } from './store.js';
import { PAGE_SIZE, STORAGE_KEY } from './config.js';
import { titleOf, yearOf, itemKey, mediaType, normalizeTitle, normalizeItem, dedupeItems, safeURL, imageURL,
  discoverParams, decadeMatches, availabilityFrom, streamProviders, sortItems, exactCandidates,
  parseRoute, routeHash, titleRoute, validRegion } from './core.js';

const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = !!value;
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(text, handler, className = 'button secondary', attrs = {}) { return el('button', { type: 'button', class: className, onclick: handler, ...attrs }, text); }
function link(text, href, className = '') { return el('a', { href, class: className }, text); }
function externalLink(text, href, className = 'button secondary') {
  const url = safeURL(href); return url ? el('a', { href: url, class: className, target: '_blank', rel: 'noopener noreferrer' }, text) : null;
}
function notice(message, warning = false) { const n = $('viewNotice'); n.textContent = message; n.classList.toggle('warning', warning); n.hidden = !message; }
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer); $('toast-container').replaceChildren(el('div', { class: 'toast' }, message));
  toastTimer = setTimeout(() => $('toast-container').replaceChildren(), 5000);
}
function storageWarning(message) { $('storageWarning').textContent = message; $('storageWarning').hidden = false; }
const api = new ApiClient();
let store, seed, seedError = '', view, currentHash = '', epoch = 0, pageController;
const views = new Map(), catalogs = { genres: new Map(), providers: new Map() }, watches = new Map();
let observer, suggestionsController, suggestionTimer, suggestionVersion = 0, activeSuggestion = -1, suggestions = [];
let actionController, videoController, regionCatalog = [];
const localModes = ['watchlist', 'for-you', 'seen'];

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('dialog-open');
}
function closeDialog(dialog) { dialog.close(); }
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close-dialog]')?.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(dialog);
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
      .filter(node => !node.disabled && node.getClientRects().length && !node.closest('[hidden]'));
    if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog === $('actionModal')) actionController?.abort();
    if (dialog === $('videoModal')) { videoController?.abort(); $('videoContainer').replaceChildren(); }
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
  });
}
function actionDialog(title, content) {
  actionController?.abort(); actionController = new AbortController();
  $('actionTitle').textContent = title; $('actionBody').replaceChildren(content); showDialog($('actionModal'));
  return actionController.signal;
}
function busyNode(text = 'Loading...') { return el('div', { class: 'loading', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), text); }
function setLoading(loading) {
  $('loader').hidden = !loading; $('resultsContainer').setAttribute('aria-busy', String(loading));
  $('loadMoreButton').disabled = loading; $('loadMoreButton').textContent = loading ? 'Loading...' : 'Load more';
}
function alive(id) { return epoch === id && !pageController?.signal.aborted; }
function rememberView() {
  if (!view) return;
  view.scrollY = window.scrollY;
  views.delete(currentHash); views.set(currentHash, view);
  while (views.size > 20) views.delete(views.keys().next().value);
}
function navigate(hash, { replace = false, force = false } = {}) {
  hideSuggestions();
  if (hash === location.hash && !force) return;
  rememberView();
  for (const dialog of document.querySelectorAll('dialog[open]')) closeDialog(dialog);
  const state = { app: true, position: replace ? history.state?.position || 0 : (history.state?.position || 0) + 1 };
  history[replace ? 'replaceState' : 'pushState'](state, '', hash);
  renderRoute({ useCache: !force });
}
function handleBack() {
  if (history.state?.app && history.state.position > 0) history.back();
  else navigate('#discover');
}
document.addEventListener('click', event => {
  const a = event.target.closest('a[href^="#"]');
  if (!a || a.getAttribute('href') === '#mainContent' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => { rememberView(); renderRoute({ useCache: true }); });
window.addEventListener('hashchange', () => { if (location.hash !== currentHash) { rememberView(); renderRoute({ useCache: true }); } });

function updateCounts() {
  if (!store) return;
  const saved = store.count('saved'), watched = store.count('watched');
  for (const n of document.querySelectorAll('[data-count="saved"]')) n.textContent = saved.toLocaleString();
  $('regionDisplay').textContent = store.state.settings.region;
  const count = seed.items.filter(x => x.recommended).length;
  $('librarySummary').replaceChildren(
    el('span', {}, el('strong', {}, count.toLocaleString()), 'personal picks'),
    el('span', {}, el('strong', {}, saved.toLocaleString()), 'on your watchlist'),
    el('span', {}, el('strong', {}, watched.toLocaleString()), 'seen / rated titles'),
    link('Your collection, all in one place \u2192', '#for-you', 'seed-link')
  );
  for (const control of document.querySelectorAll('[data-save-key]')) {
    const key = control.dataset.saveKey, item = store.get(key), state = store.status(key);
    control.setAttribute('aria-pressed', String(state.saved));
    control.setAttribute('aria-label', `${state.saved ? 'Remove' : 'Add'} ${titleOf(item || { title: control.dataset.title })} ${state.saved ? 'from' : 'to'} watchlist`);
    control.textContent = state.saved ? '\u2665' : '\u2661';
  }
  for (const control of document.querySelectorAll('[data-seen-key]')) {
    const key = control.dataset.seenKey, item = store.get(key), state = store.status(key);
    control.setAttribute('aria-pressed', String(state.watched));
    control.setAttribute('aria-label', `Mark ${titleOf(item || { title: control.dataset.title })} as ${state.watched ? 'unwatched' : 'watched'}`);
  }
}
function toggleSaved(item) {
  const saved = !store.status(item).saved;
  store.update(item, { saved }); toast(saved ? `Added ${titleOf(item)} to your watchlist.` : `Removed ${titleOf(item)} from your watchlist.`);
  if (localModes.includes(view?.route.mode)) paintLocal();
}
function toggleSeen(item) {
  const watched = !store.status(item).watched;
  store.update(item, { watched }); toast(`${titleOf(item)} marked ${watched ? 'watched' : 'unwatched'}.`);
  if (localModes.includes(view?.route.mode)) paintLocal();
  else if (view?.route.mode === 'person') paintFilmography();
  else if (['discover', 'search'].includes(view?.route.mode)) paintList();
}
function poster(item, { linked = true, className = 'poster-wrap', eager = false } = {}) {
  const wrap = el('div', { class: className });
  const fallback = el('div', { class: 'poster-fallback' },
    el('span', { class: 'fallback-kicker' }, item.moods?.[0]?.toUpperCase() || (mediaType(item) === 'tv' ? 'A SERIES TO DISCOVER' : 'A TITLE TO DISCOVER')),
    el('span', { class: 'fallback-title' }, titleOf(item)),
    el('span', { class: 'fallback-year' }, yearOf(item) || 'UNDATED'),
    el('span', { class: 'fallback-caption' }, 'WHAT TO WATCH NEXT'));
  const image = imageURL(item.poster_path);
  let visual = fallback;
  if (image) {
    const img = el('img', { src: image, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', width: '500', height: '750' });
    img.addEventListener('error', () => img.replaceWith(fallback), { once: true }); visual = img;
  }
  if (linked) wrap.append(el('a', { href: titleRoute(item), class: 'poster-link', 'aria-label': `Details for ${titleOf(item)}` }, visual));
  else wrap.append(visual);
  return wrap;
}
function movieCard(input) {
  const item = store.get(input) || input, status = store.status(item), key = store.canonical(item);
  const card = el('article', { class: 'movie-card', 'data-key': key });
  const image = poster(item);
  const saved = button(status.saved ? '\u2665' : '\u2661', () => toggleSaved(item), 'card-save', {
    'aria-label': `${status.saved ? 'Remove' : 'Add'} ${titleOf(item)} ${status.saved ? 'from' : 'to'} watchlist`, 'aria-pressed': String(status.saved), 'data-save-key': key, 'data-title': titleOf(item) });
  image.append(saved);
  if (item.vote_average != null) image.append(el('span', { class: 'score', title: 'TMDB community rating, out of 10' }, `\u2605 ${item.vote_average.toFixed(1)}`));
  const body = el('div', { class: 'card-body' }, el('h3', {}, link(titleOf(item), titleRoute(item))));
  const type = mediaType(item) === 'unknown' ? 'Imported title' : item.media_type === 'tv' ? 'TV show' : 'Movie';
  const genres = (item.genre_ids || []).map(id => catalogs.genres.get(item.media_type)?.find(g => g.id === id)?.name).filter(Boolean);
  body.append(el('div', { class: 'card-meta' }, el('span', {}, yearOf(item) || 'Year unknown'), el('span', { 'aria-hidden': 'true' }, '\u00b7'), el('span', {}, genres[0] || type)));
  const tags = el('div', { class: 'card-tags' });
  if (status.watched) tags.append(el('span', { class: 'tag seen' }, status.rating != null ? `Your ${status.rating} / 5 \u2605` : 'Watched'));
  else if (store.historyMatch(item)) tags.append(el('span', { class: 'tag seen' }, 'Matches rated history'));
  if (status.priority) tags.append(el('span', { class: 'tag priority' }, status.priority === 2 ? 'Up next' : 'Watch soon'));
  if (item.moods?.length) tags.append(el('span', { class: 'tag' }, item.moods[0]));
  if (item.sources?.includes('watchlist') && !status.watched) tags.append(el('span', { class: 'tag' }, 'Letterboxd list'));
  if (tags.childNodes.length) body.append(tags);
  if (item.reasons?.length) body.append(el('p', { class: 'card-reason' }, item.reasons.find(r => !r.startsWith('Already saved')) || item.reasons[0]));
  const providerRow = el('div', { class: 'provider-row' });
  if (mediaType(item) === 'unknown') providerRow.append(el('span', {}, 'Open to find live details'));
  else {
    providerRow.textContent = `Checking ${store.state.settings.region} availability...`;
    observeAvailability(providerRow, item);
  }
  body.append(providerRow);
  body.append(el('div', { class: 'card-actions' },
    button(mediaType(item) === 'unknown' ? 'Details \u2197' : '\u25b7 Trailer', () => mediaType(item) === 'unknown' ? navigate(titleRoute(item)) : playTrailer(item), 'trailer-button', { 'aria-label': `${mediaType(item) === 'unknown' ? 'Open details for' : 'Watch trailer for'} ${titleOf(item)}` }),
    button('\u2713', () => toggleSeen(item), 'quick-seen', { 'aria-label': `Mark ${titleOf(item)} as ${status.watched ? 'unwatched' : 'watched'}`, 'aria-pressed': String(status.watched), 'data-seen-key': key, 'data-title': titleOf(item) })
  ));
  card.append(image, body); return card;
}
function watchKey(item) { return `${item.media_type}:${item.id}:${store.state.settings.region}`; }
async function watchFor(item, signal) {
  const key = watchKey(item), cached = watches.get(key);
  if (cached && Date.now() - cached.checkedAt < 300000) return cached;
  const data = await api.get(`/${item.media_type}/${item.id}/watch/providers`, {}, { signal });
  const watch = availabilityFrom(data, store.state.settings.region); watches.set(key, watch);
  while (watches.size > 250) watches.delete(watches.keys().next().value);
  return watch;
}
function observeAvailability(node, item) {
  const version = epoch, signal = pageController.signal;
  const update = async () => {
    if (!alive(version) || !node.isConnected) return;
    try {
      const watch = await watchFor(item, signal);
      if (alive(version) && node.isConnected) paintProviderRow(node, watch);
    } catch (error) {
      if (alive(version) && node.isConnected && error.name !== 'AbortError') node.textContent = 'Availability not checked';
    }
  };
  node._load = update;
  if (observer) observer.observe(node); else queueMicrotask(update);
}
function paintProviderRow(node, watch) {
  node.replaceChildren();
  const providers = streamProviders(watch);
  const options = providers.length ? providers : streamProviders(watch, 'all');
  if (!options.length) { node.textContent = `No providers listed in ${watch.region}`; return; }
  const a = watch.link ? el('a', { href: watch.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Check ${titleOf({ title: options.map(x => x.name).join(', ') })} availability in ${watch.region}` }) : el('span');
  for (const provider of options.slice(0, 3)) {
    if (provider.logo) {
      const img = el('img', { src: provider.logo, alt: provider.name, loading: 'lazy', width: '22', height: '22', title: provider.name });
      img.addEventListener('error', () => img.replaceWith(el('span', { class: 'provider-text' }, provider.name)), { once: true }); a.append(img);
    } else a.append(el('span', { class: 'provider-text' }, provider.name));
  }
  a.append(el('span', { class: 'provider-text' }, providers.length ? watch.region : 'Rent / buy')); node.append(a);
}

function setupObserver() {
  observer?.disconnect();
  observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); entry.target._load?.(); }
  }, { rootMargin: '160px' }) : null;
}
function listEmpty(title, message, actions = []) {
  return el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '\u2727'), el('h3', {}, title), el('p', {}, message), el('div', { class: 'button-row empty-actions' }, actions));
}
function errorState(error) {
  setLoading(false); view.loading = false;
  $('resultsContainer').replaceChildren(el('div', { class: 'error-state', role: 'alert' },
    el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '\u21bb'), el('h3', {}, 'A little interruption'),
    el('p', {}, error.message || 'Something went wrong while loading this view.'),
    el('div', { class: 'button-row empty-actions' }, button('Try again', () => renderRoute({ useCache: false }), 'button primary'), link('Browse your imported picks', '#for-you', 'button secondary'))));
  $('resultCount').textContent = ''; $('loadMoreContainer').hidden = true;
}
async function renderRoute({ useCache = false, initial = false } = {}) {
  if (!store) return;
  pageController?.abort(); pageController = new AbortController(); epoch++;
  const version = epoch; currentHash = location.hash || '#discover'; hideSuggestions(); setupObserver();
  let route = parseRoute(currentHash);
  if (route.mode === 'discover' && !currentHash.includes('?')) route.available = store.state.settings.hideUnavailable;
  const cached = useCache ? views.get(currentHash) : null;
  view = cached || { route, items: [], page: 0, totalPages: 0, localLimit: PAGE_SIZE, scrollY: 0, loading: false };
  view.route = route; view.loading = false;
  $('hero').hidden = route.mode !== 'discover';
  $('resultsContainer').replaceChildren(); $('resultCount').textContent = ''; $('filterBar').replaceChildren(); notice('');
  $('loadMoreContainer').hidden = true; setLoading(false); updateHeading(route); buildFilters(); buildViewActions();
  for (const a of document.querySelectorAll('[data-nav]')) {
    const active = a.dataset.nav === route.mode;
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (route.mode === 'search') { $('movieInput').value = route.q; $('searchTypeSelect').value = route.kind; }
  if (!initial) {
    window.scrollTo({ top: cached?.scrollY || 0, behavior: 'instant' });
    $('viewTitle').focus({ preventScroll: true });
  }
  try {
    if (localModes.includes(route.mode)) paintLocal();
    else if (['movie', 'tv', 'title'].includes(route.mode)) await loadDetails(version);
    else if (route.mode === 'person') {
      if (!route.id) throw new ApiError('Invalid person link.');
      if (cached?.filmography) paintFilmography(); else await loadFilmography(version);
    } else {
      if (cached?.page) paintList(); else await loadNextPage(version);
      if (route.mode === 'discover') void loadCatalogs(route.type, version);
    }
    if (alive(version) && cached && !initial) requestAnimationFrame(() => { if (alive(version)) window.scrollTo({ top: cached.scrollY || 0, behavior: 'instant' }); });
  } catch (error) { if (alive(version) && error.name !== 'AbortError') errorState(error); }
}
function updateHeading(route) {
  const titles = { discover: ['EXPLORE THE POSSIBILITIES', 'Find your next favorite', 'Browse movies and TV shows, with streaming options for your region.'],
    'for-you': ['LESS GUESSWORK, MORE GOOD FILMS', 'Picked for you', 'A collection built around your taste. Find a mood, revisit your list, or let tonight surprise you.'],
    watchlist: ['SAVE IT NOW. WATCH IT LATER.', 'Your watchlist', 'Your Letterboxd list and everything you save here. Prioritize a title, add a note, or pick one for tonight.'],
    seen: ['YOUR PERSONAL SCREEN HISTORY', 'Seen & rated', 'All imported ratings plus titles you mark watched here. Your original export has ratings, not reliable viewing dates.'],
    search: ['FOLLOW YOUR CURIOSITY', `Results for \u201c${route.q}\u201d`, `Searching ${['actor', 'director'].includes(route.kind) ? (route.kind === 'director' ? 'directors' : 'actors') : route.kind === 'tv' ? 'TV shows' : 'movies'}. Discovery filters do not alter text-search results.`],
    person: ['THE PEOPLE BEHIND THE STORIES', 'Filmography', 'Movie and TV credits, with duplicates removed by media type and ID.'],
    movie: ['MAKE A NIGHT OF IT', 'A closer look', ''], tv: ['MAKE A NIGHT OF IT', 'A closer look', ''], title: ['FROM YOUR PERSONAL COLLECTION', 'A closer look', ''] };
  const [eyebrow, title, subtitle] = titles[route.mode] || titles.discover;
  $('viewEyebrow').textContent = eyebrow; $('viewTitle').textContent = title; $('viewSubtitle').textContent = subtitle;
  document.title = `${['movie', 'tv', 'title'].includes(route.mode) ? 'Title details' : title} | WhatToWatchNext`;
}
function selectControl(label, options, value, onChange, id = '') {
  const control = el('select', { 'aria-label': label, ...(id ? { id } : {}), onchange: event => onChange(event.target.value) },
    options.map(([key, text]) => el('option', { value: key }, text)));
  control.value = value; return control;
}
function updateRoute(patch, replace = false) { navigate(routeHash({ ...view.route, ...patch }), { replace, force: true }); }
function multiFilter(name, field, options) {
  const selected = view.route[field] || [];
  const menu = el('details', { class: 'filter-menu', 'data-filter': field });
  const summary = el('summary', {}, `${name}${selected.length ? ` (${selected.length})` : ''}`);
  const opts = el('div', { class: 'filter-options' });
  if (!options?.length) opts.append(el('p', {}, field === 'decades' ? 'No options.' : 'Options load when the movie service is available.'));
  for (const option of options || []) {
    const input = el('input', { type: 'checkbox', value: option.id, checked: selected.includes(String(option.id)), onchange: () => {
      const next = new Set(view.route[field]); input.checked ? next.add(String(option.id)) : next.delete(String(option.id));
      updateRoute({ [field]: [...next] });
    } });
    opts.append(el('label', {}, input, option.name));
  }
  menu.append(summary, opts);
  menu.addEventListener('toggle', () => { if (menu.open) for (const other of $('filterBar').querySelectorAll('details')) if (other !== menu) other.open = false; });
  return menu;
}
function buildFilters() {
  const bar = $('filterBar'), route = view.route; bar.replaceChildren();
  if (route.mode === 'discover') {
    const typeButtons = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Browse media type' },
      ['movie', 'tv'].map(type => button(type === 'movie' ? 'MOVIES' : 'TV SHOWS', () => updateRoute({ type, genres: [], providers: [] }), '', { 'aria-pressed': String(route.type === type) })));
    const decades = [];
    for (let year = Math.floor(new Date().getFullYear() / 10) * 10; year >= 1900; year -= 10) decades.push({ id: year, name: `${year}s` });
    const providers = catalogs.providers.get(`${route.type}/${store.state.settings.region}`) || [];
    bar.append(typeButtons, multiFilter('Genres', 'genres', catalogs.genres.get(route.type)), multiFilter('Decades', 'decades', decades),
      multiFilter('Services', 'providers', providers.map(p => ({ id: p.provider_id, name: p.provider_name }))),
      selectControl('Sort discoveries', [['popular', 'Popular'], ['rating', 'Top rated'], ['newest', 'Newest']], route.sort, sort => updateRoute({ sort }), 'sortSelect'),
      selectControl('Availability type', [['stream', 'Stream / free'], ['all', 'Also rent & buy']], route.access, access => updateRoute({ access })),
      el('label', {}, el('input', { type: 'checkbox', checked: route.available, onchange: e => updateRoute({ available: e.target.checked }) }), 'Available here'),
      button('Reset filters', () => navigate('#discover', { force: true }), 'clear-filters'));
  } else if (localModes.includes(route.mode)) {
    let timer;
    const input = el('input', { type: 'search', class: 'local-search', placeholder: route.mode === 'seen' ? 'Search your watched titles...' : 'Filter by title, year, reason, or note...', 'aria-label': 'Filter personal collection', value: route.q, maxlength: '250' });
    input.addEventListener('input', () => {
      clearTimeout(timer); const targetView = view;
      timer = setTimeout(() => {
        if (view !== targetView) return;
        view.route.q = input.value.slice(0, 250); view.localLimit = PAGE_SIZE;
        const hash = routeHash(view.route); history.replaceState(history.state, '', hash); currentHash = hash; paintLocal();
      }, 150);
    });
    const moods = [...new Set(seed.items.filter(x => x.recommended).flatMap(x => x.moods || []))].sort();
    bar.append(input);
    if (route.mode !== 'seen') bar.append(
      selectControl('Filter by mood', [['', 'Any mood'], ...moods.map(m => [m, m])], route.mood, mood => updateRoute({ mood })),
      selectControl('Filter by source', [['', 'All sources'], ['watchlist', 'Letterboxd list'], ['discovery', 'New discoveries']], route.source, source => updateRoute({ source })),
      selectControl('Watchlist status', [['all', 'All statuses'], ['unwatched', 'Unwatched'], ['watched', 'Watched'], ['priority', 'Up next / soon']], route.status, status => updateRoute({ status }))
    );
    const sorts = [['alpha', 'Title A\u2013Z'], ['newest', 'Newest release'], ['oldest', 'Oldest release']];
    if (route.mode === 'seen') sorts.push(['rating', 'Your highest rated']);
    else sorts.push(['priority', 'Priority first'], ['recent', 'Recently saved']);
    bar.append(selectControl('Sort personal collection', sorts, route.sort, sort => updateRoute({ sort })));
  } else if (route.mode === 'person') {
    bar.append(el('div', { class: 'segmented', role: 'group', 'aria-label': 'Filmography role' }, ['actor', 'director'].map(role => button(role === 'actor' ? 'Acting' : 'Directing', () => updateRoute({ role }), '', { 'aria-pressed': String(route.role === role) }))));
  }
}
function buildViewActions() {
  const actions = $('viewActions'); actions.replaceChildren(); const mode = view.route.mode;
  if (['movie', 'tv', 'title', 'person', 'search'].includes(mode)) actions.append(button('\u2190 Back', handleBack, 'button subtle'));
  if (localModes.includes(mode)) actions.append(button('Load posters', enrichVisible, 'button subtle', { id: 'enrichButton', title: 'Match just the currently displayed titles, not your entire library' }));
  if (['discover', 'for-you', 'watchlist', 'search'].includes(mode) && !['actor', 'director'].includes(view.route.kind)) actions.append(button('\u2727 Pick one', () => pickTonight(false), 'button secondary', { title: 'Choose from the current filtered results' }));
  if (['discover', ...localModes].includes(mode)) actions.append(button(store.state.settings.layout === 'list' ? '\u25a6 Grid' : '\u2637 List', () => {
    store.setSettings({ layout: store.state.settings.layout === 'grid' ? 'list' : 'grid' }); buildViewActions();
    localModes.includes(view.route.mode) ? paintLocal() : paintList();
  }, 'button subtle layout-toggle', { 'aria-label': 'Toggle grid or list layout' }));
}
async function loadCatalogs(type, version) {
  const region = store.state.settings.region;
  try {
    const [genres, providers] = await Promise.allSettled([
      api.get(`/genre/${type}/list`, { language: 'en-US' }, { signal: pageController.signal, ttl: 86400000 }),
      api.get(`/watch/providers/${type}`, { watch_region: region }, { signal: pageController.signal, ttl: 3600000 })
    ]);
    if (!alive(version)) return;
    if (genres.status === 'fulfilled' && Array.isArray(genres.value.genres)) catalogs.genres.set(type, genres.value.genres.filter(g => Number.isSafeInteger(g.id) && typeof g.name === 'string').sort((a, b) => a.name.localeCompare(b.name)));
    if (providers.status === 'fulfilled' && Array.isArray(providers.value.results)) catalogs.providers.set(`${type}/${region}`, providers.value.results.filter(p => Number.isSafeInteger(p.provider_id) && typeof p.provider_name === 'string').sort((a, b) => a.provider_name.localeCompare(b.provider_name)));
    if (view.route.mode === 'discover' && view.route.type === type && store.state.settings.region === region) buildFilters();
  } catch { /* Optional filter metadata does not prevent the results or library working. */ }
}
function mediaItems(rows, type) {
  if (!Array.isArray(rows)) throw new ApiError('The movie service returned an invalid results list.');
  return rows.filter(x => x && x.adult !== true).flatMap(raw => {
    try { return [normalizeItem({ ...raw, media_type: type || raw.media_type })]; } catch { return []; }
  }).filter(x => mediaType(x) !== 'unknown');
}
function pageTotal(data) { return Number.isInteger(data.total_pages) && data.total_pages > 0 ? Math.min(500, data.total_pages) : 0; }
function eligible(item, route = view.route) {
  if (store.state.settings.hideSeen && store.isSeen(item)) return false;
  return route.mode !== 'discover' || decadeMatches(item, route.decades);
}
async function loadNextPage(version = epoch) {
  if (!alive(version) || view.loading) return;
  const target = view, route = target.route, next = target.page + 1;
  if (target.page && next > target.totalPages) return;
  if (route.mode === 'search' && !route.q.trim()) throw new ApiError('Enter a title or a person to search.');
  target.loading = true; $('loadMoreButton').disabled = true; $('loadMoreButton').textContent = 'Loading...';
  if (!target.page) setLoading(true);
  try {
    const people = route.mode === 'search' && ['actor', 'director'].includes(route.kind);
    const data = await api.get(route.mode === 'discover' ? `/discover/${route.type}` : `/search/${people ? 'person' : route.kind}`,
      route.mode === 'discover' ? discoverParams(route, next, store.state.settings.region) : { query: route.q, page: next, include_adult: false }, { signal: pageController.signal });
    if (!alive(version)) return;
    if (!Array.isArray(data.results)) throw new ApiError('The movie service returned an invalid results list.');
    const items = people ? data.results.filter(p => p && Number.isSafeInteger(p.id) && p.adult !== true &&
      (route.kind !== 'director' || p.known_for_department === 'Directing')) : mediaItems(data.results, route.mode === 'discover' ? route.type : route.kind);
    // Commit the page cursor only after a successful response. Retries never skip pages.
    target.items = people ? [...new Map([...target.items, ...items].map(p => [p.id, p])).values()] : dedupeItems([...target.items, ...items]);
    target.page = next; target.totalPages = pageTotal(data); target.failed = false;
    target.loading = false; paintList();
  } catch (error) {
    if (alive(version) && error.name !== 'AbortError') {
      target.failed = true;
      if (!target.page) errorState(error); else notice(`${error.message} Your previous results are still here. Load more retries the same page.`, true);
    }
  } finally {
    if (alive(version)) { target.loading = false; setLoading(false); }
  }
}
function paintList() {
  if (!view || !['discover', 'search'].includes(view.route.mode)) return;
  setupObserver();
  const people = view.route.mode === 'search' && ['actor', 'director'].includes(view.route.kind);
  const visible = people ? view.items : view.items.filter(item => eligible(item));
  view.currentItems = visible;
  const grid = $('resultsContainer');
  grid.className = `results-grid${store.state.settings.layout === 'list' && !people ? ' results-list' : ''}`;
  grid.replaceChildren(...visible.map(item => people ? personCard(item, view.route.kind) : movieCard(item)));
  const more = view.page < view.totalPages;
  if (!visible.length) grid.append(listEmpty('Nothing matching yet', more ? 'No matching titles on the pages loaded so far. Load more, change the filters, or turn off Hide watched in Settings.' : 'Try a different search or clear the filters. Your personal collection is always available.', [link('Explore your picks', '#for-you', 'button secondary')]));
  $('resultCount').textContent = `${visible.length.toLocaleString()} ${people ? 'people' : 'titles'} shown${view.page ? ` \u00b7 ${view.page} of ${view.totalPages || 1} pages loaded` : ''}`;
  $('loadMoreContainer').hidden = !more;
  // Hide-watched can empty most of a page; keep fetching until a screenful is visible.
  if (more && !people && visible.length < 12 && !view.failed && (view.autoFills = (view.autoFills || 0) + 1) <= 10) {
    const version = epoch;
    setTimeout(() => { if (alive(version)) loadNextPage(version); }, 0);
  }
}
function filteredLocal() {
  const route = view.route, q = normalizeTitle(route.q);
  return sortItems(store.all().filter(item => {
    const status = store.status(item);
    if (route.mode === 'watchlist' && !status.saved) return false;
    if (route.mode === 'for-you' && (!item.recommended || (store.state.settings.hideSeen && status.watched))) return false;
    if (route.mode === 'seen' && !status.watched) return false;
    if (route.mood && !(item.moods || []).includes(route.mood)) return false;
    if (route.source && !(item.sources || []).includes(route.source)) return false;
    if (route.status === 'watched' && !status.watched) return false;
    if (route.status === 'unwatched' && status.watched) return false;
    if (route.status === 'priority' && !status.priority) return false;
    return !q || normalizeTitle(`${titleOf(item)} ${yearOf(item)} ${(item.reasons || []).join(' ')} ${status.notes}`).includes(q);
  }), route.sort, item => store.status(item));
}
function paintLocal() {
  if (!view || !localModes.includes(view.route.mode)) return;
  setupObserver(); setLoading(false);
  const all = filteredLocal(), visible = all.slice(0, view.localLimit);
  view.currentItems = visible; view.localTotal = all.length;
  const grid = $('resultsContainer'); grid.className = `results-grid${store.state.settings.layout === 'list' ? ' results-list' : ''}`;
  grid.replaceChildren();
  if (view.route.mode === 'seen' && !view.route.q) {
    const statuses = all.map(x => store.status(x)), rated = statuses.filter(x => x.rating != null);
    const average = rated.length ? (rated.reduce((s, x) => s + x.rating, 0) / rated.length).toFixed(2) : '\u2014';
    const stats = [[statuses.length.toLocaleString(), 'Seen titles'], [average, 'Average / 5 stars'], [rated.filter(x => x.rating === 5).length.toLocaleString(), 'Five-star favorites']];
    grid.append(el('div', { class: 'stats-strip' }, stats.map(([value, label]) => el('div', { class: 'stat-tile' }, el('strong', {}, value), el('span', {}, label)))));
  }
  grid.append(...visible.map(movieCard));
  if (!visible.length) grid.append(listEmpty(view.route.mode === 'watchlist' ? 'Make room for your next favorite' : 'No titles match these filters', view.route.mode === 'watchlist' ? 'Save a movie or series with the heart button, or clear your current filters.' : 'Try a shorter search, a different mood, or clear the selected filters.', [button('Clear filters', () => navigate(`#${view.route.mode}`, { force: true })), link('Discover something new', '#discover', 'button secondary')]));
  $('resultCount').textContent = `${visible.length.toLocaleString()} of ${all.length.toLocaleString()} titles shown`;
  $('loadMoreContainer').hidden = visible.length >= all.length;
  if (seedError) notice(seedError, true);
  // Imported titles have no TMDB link yet; match the visible ones automatically so posters and details appear.
  const version = epoch;
  setTimeout(() => { if (alive(version)) enrichVisible({ quiet: true }); }, 0);
}
async function enrichVisible({ quiet = false } = {}) {
  const btn = $('enrichButton'); if (!btn || btn.disabled) return;
  const version = epoch, signal = pageController.signal;
  const tried = view.enrichTried ||= new Set();
  const unresolved = (view.currentItems || []).map(x => store.get(x))
    .filter(x => x && mediaType(x) === 'unknown' && (!quiet || !tried.has(x.key)));
  if (!unresolved.length) { if (!quiet) toast('The displayed titles already have TMDB links.'); return; }
  unresolved.forEach(x => tried.add(x.key));
  btn.disabled = true; btn.textContent = 'Matching...';
  let matched = 0, ambiguous = 0, failed = 0;
  await Promise.all(unresolved.map(async item => {
    try {
      const data = await api.get('/search/multi', { query: titleOf(item), include_adult: false }, { signal });
      if (!alive(version)) return;
      if (!Array.isArray(data.results)) throw new Error('Invalid search results.');
      const candidates = exactCandidates(item, data.results.filter(x => !x.adult));
      if (candidates.length === 1) { store.link(item.key, candidates[0]); matched++; } else ambiguous++;
    } catch (error) { if (error.name !== 'AbortError') failed++; }
  }));
  if (!alive(version)) return;
  paintLocal(); btn.disabled = false; btn.textContent = 'Load posters';
  if (quiet && !failed) return;
  notice(`${matched} titles matched by exact title and year.${ambiguous ? ` ${ambiguous} need manual matching: open a title and use Find on TMDB.` : ''}${failed ? ` ${failed} could not reach the movie service; your original titles are unchanged.` : ''}`, failed > 0);
}
function personCard(person, role) {
  const card = el('article', { class: 'movie-card person-card' });
  const portrait = el('div', { class: 'person-image', 'aria-hidden': 'true' }, String(person.name || '?').slice(0, 1));
  const src = imageURL(person.profile_path, 'w185');
  if (src) {
    const img = el('img', { src, alt: '', loading: 'lazy', width: '185', height: '185' });
    img.addEventListener('error', () => img.remove(), { once: true }); portrait.replaceChildren(img);
  }
  card.append(portrait, el('h3', {}, String(person.name || 'Unknown person')), el('p', {}, String(person.known_for_department || 'Film & television')),
    link('View filmography \u2192', `#person/${person.id}?role=${role === 'director' ? 'director' : 'actor'}`, 'button secondary'));
  return card;
}
async function loadFilmography(version) {
  setLoading(true);
  const route = view.route;
  const [person, credits] = await Promise.all([
    api.get(`/person/${route.id}`, {}, { signal: pageController.signal }),
    api.get(`/person/${route.id}/combined_credits`, {}, { signal: pageController.signal })
  ]);
  if (!alive(version)) return;
  const source = route.role === 'director' ? (credits.crew || []).filter(c => c.job === 'Director') : credits.cast || [];
  view.filmography = sortItems(dedupeItems(mediaItems(source.filter(x => ['movie', 'tv'].includes(x.media_type)))), 'newest');
  view.personName = String(person.name || 'Unknown person');
  paintFilmography(); setLoading(false);
}
function paintFilmography() {
  setupObserver();
  $('viewTitle').textContent = `${view.personName}: ${view.route.role === 'director' ? 'directing' : 'acting'}`;
  document.title = `${view.personName} | WhatToWatchNext`;
  const all = (view.filmography || []).filter(item => eligible(item)), visible = all.slice(0, view.localLimit);
  view.currentItems = visible; view.localTotal = all.length;
  const grid = $('resultsContainer'); grid.className = `results-grid${store.state.settings.layout === 'list' ? ' results-list' : ''}`;
  grid.replaceChildren(...visible.map(movieCard));
  if (!visible.length) grid.append(listEmpty('No credits to show', 'No matching movie or TV credits were returned for this role. Try the other role or turn off Hide watched.', []));
  $('resultCount').textContent = `${visible.length} of ${all.length} credits shown`;
  $('loadMoreContainer').hidden = visible.length >= all.length;
}

function personalPanel(item) {
  const state = store.status(item), form = el('form');
  const saved = el('input', { type: 'checkbox', checked: state.saved });
  const watched = el('input', { type: 'checkbox', checked: state.watched });
  const rating = selectControl('Your rating', [['', 'Not rated'], ...Array.from({ length: 10 }, (_, i) => [String((i + 1) / 2), `${(i + 1) / 2} / 5 stars`])], state.rating == null ? '' : String(state.rating), value => { if (value) watched.checked = true; });
  const priority = selectControl('Watch priority', [['0', 'Whenever'], ['1', 'Watch soon'], ['2', 'Up next']], String(state.priority), () => {});
  const notes = el('textarea', { rows: '4', maxlength: '4000', placeholder: 'Why did you save this one? A note for future you...', 'aria-label': 'Personal notes' }, state.notes);
  form.append(el('label', { class: 'check-label' }, saved, 'In my watchlist'), el('label', { class: 'check-label' }, watched, 'I have watched this'),
    el('div', {}, el('label', {}, 'Your rating', rating)), el('div', {}, el('label', {}, 'Priority', priority)),
    el('div', { class: 'personal-notes' }, el('label', {}, 'A note to yourself', notes)),
    el('p', { class: 'field-hint' }, 'Giving a rating marks this title watched. These changes stay in this browser.'),
    el('button', { type: 'submit', class: 'button primary' }, 'Save changes'));
  watched.addEventListener('change', () => { if (!watched.checked) rating.value = ''; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    try { store.update(item, { saved: saved.checked, watched: watched.checked, rating: rating.value ? Number(rating.value) : null, priority: Number(priority.value), notes: notes.value }); toast('Your title notes and preferences are saved.'); }
    catch (error) { toast(error.message); }
  });
  const panel = el('aside', { class: 'personal-panel', 'aria-label': 'Your personal title preferences' }, el('h4', {}, 'Make it your next watch'), form);
  if (item.seedRating != null) panel.append(el('p', { class: 'fine-print' }, `Original imported rating: ${item.seedRating} / 5. Your edits here do not change Letterboxd.`));
  return panel;
}
function detailLayout(item, raw = {}) {
  const image = poster(item, { linked: false, className: 'detail-poster', eager: true });
  const info = el('div', { class: 'detail-info' }, el('h3', {}, titleOf(item)));
  const type = mediaType(item) === 'unknown' ? 'Imported title \u00b7 not yet matched' : item.media_type === 'tv' ? 'TV series' : 'Movie';
  const meta = [yearOf(item) || 'Year unknown', type];
  if (item.runtime) meta.push(`${item.runtime} min`);
  if (item.vote_average != null) meta.push(`TMDB ${item.vote_average.toFixed(1)} / 10`);
  info.append(el('div', { class: 'detail-meta' }, meta.map(text => el('span', {}, text))));
  if (item.reasons?.length) info.append(el('p', { class: 'overview' }, item.reasons.join(' ')));
  if (item.overview) info.append(el('p', { class: 'overview' }, item.overview));
  else if (!item.reasons?.length) info.append(el('p', { class: 'overview' }, mediaType(item) === 'unknown' ? 'This title is preserved from your imported collection. Match it to TMDB for its poster, synopsis, credits, and streaming providers.' : 'No synopsis is available for this title.'));
  const buttons = el('div', { class: 'button-row' });
  if (mediaType(item) === 'unknown') buttons.append(button('Find on TMDB', () => resolveTitle(item), 'button primary', { id: 'resolveTitleButton' }));
  else buttons.append(button('\u25b7 Watch trailer', () => playTrailer(item), 'button primary'), externalLink('TMDB \u2197', `https://www.themoviedb.org/${item.media_type}/${item.id}`));
  const letterboxd = item.url || `https://letterboxd.com/search/films/${encodeURIComponent(`${titleOf(item)} ${yearOf(item)}`)}/`;
  buttons.append(externalLink('Letterboxd \u2197', letterboxd));
  const imdb = raw.imdb_id;
  if (typeof imdb === 'string' && /^tt\d{5,12}$/.test(imdb)) buttons.append(externalLink('IMDb \u2197', `https://www.imdb.com/title/${imdb}/`));
  info.append(buttons);
  const credits = el('div', { class: 'detail-credits' }), watch = el('section', { class: 'detail-watch', 'aria-label': 'Streaming availability' });
  if (mediaType(item) !== 'unknown') {
    credits.textContent = 'Loading cast and crew...';
    watch.append(el('h4', {}, `Where to watch \u00b7 ${store.state.settings.region}`), el('p', { class: 'muted' }, 'Checking current provider listings...'));
  } else watch.append(el('p', { class: 'muted' }, 'Availability has not been checked. Imported titles are never treated as unavailable simply because they have no TMDB link.'));
  info.append(credits, watch);
  const layout = el('section', { class: 'detail-layout', 'aria-label': `${titleOf(item)} details` }, image, info, personalPanel(item));
  return { layout, credits, watch, buttons };
}
async function loadDetails(version) {
  const route = view.route;
  let item = route.mode === 'title' ? store.get(route.key) : store.get(`${route.mode}:${route.id}`);
  if (route.mode === 'title' && !item) throw new ApiError('This imported title is not in your library.');
  if (item && mediaType(item) === 'unknown') {
    $('resultsContainer').className = 'results-grid'; $('resultsContainer').replaceChildren(detailLayout(item).layout);
    view.detailItem = item; document.title = `${titleOf(item)} | WhatToWatchNext`; return;
  }
  const type = item ? item.media_type : route.mode, id = item?.id || route.id;
  if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(id) || id <= 0) throw new ApiError('Invalid title link.');
  setLoading(true); let raw;
  try { raw = await api.get(`/${type}/${id}`, { language: 'en-US' }, { signal: pageController.signal }); }
  catch (error) {
    if (!alive(version)) return;
    if (!item || error.name === 'AbortError') throw error;
    raw = item; notice(`${error.message} Showing your saved title information instead.`, true);
  }
  if (!alive(version)) return;
  const normalized = normalizeItem({ ...raw, id, media_type: type });
  const canonical = store.canonical(normalized);
  item = { ...(store.get(canonical) || {}), ...normalized, key: canonical };
  // Keep provenance, editorial reasons, and the original Letterboxd link after enrichment.
  const imported = store.get(canonical);
  if (imported?.url) item.url = imported.url;
  const slots = detailLayout(item, raw);
  $('resultsContainer').className = 'results-grid'; $('resultsContainer').replaceChildren(slots.layout);
  view.detailItem = item; view.items = []; view.page = 0; view.totalPages = 0;
  document.title = `${titleOf(item)} | WhatToWatchNext`; setLoading(false);
  const signal = pageController.signal;
  void api.get(`/${type}/${id}/credits`, {}, { signal }).then(data => {
    if (alive(version)) paintCredits(slots.credits, data, raw, type);
  }).catch(error => { if (alive(version) && error.name !== 'AbortError') slots.credits.textContent = 'Cast and crew could not be loaded.'; });
  void watchFor(item, signal).then(watch => { if (alive(version)) paintDetailWatch(slots.watch, watch); }).catch(error => {
    if (alive(version) && error.name !== 'AbortError') slots.watch.replaceChildren(el('h4', {}, `Where to watch \u00b7 ${store.state.settings.region}`), el('p', { class: 'muted' }, 'Availability could not be checked. This does not mean the title is unavailable.'), button('Retry availability', async () => {
      try { const data = await watchFor(item, signal); if (alive(version)) paintDetailWatch(slots.watch, data); } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
    }, 'button subtle'));
  });
  if (!raw.imdb_id) void api.get(`/${type}/${id}/external_ids`, {}, { signal }).then(data => {
    if (alive(version) && typeof data.imdb_id === 'string' && /^tt\d{5,12}$/.test(data.imdb_id)) slots.buttons.append(externalLink('IMDb \u2197', `https://www.imdb.com/title/${data.imdb_id}/`));
  }).catch(() => {});
  const section = el('div', { class: 'details-section-title' }, el('h3', {}, 'More like this'));
  $('resultsContainer').append(section); view.recHeading = section;
  await loadRecommendations(version);
}
function paintCredits(node, credits, raw, type) {
  node.replaceChildren();
  if (type === 'movie') {
    const directors = (Array.isArray(credits.crew) ? credits.crew : []).filter(p => p.job === 'Director' && Number.isSafeInteger(p.id));
    if (directors.length) node.append(el('strong', {}, 'Directed by'), el('div', { class: 'people-links' }, directors.map(p => link(String(p.name || 'Director'), `#person/${p.id}?role=director`))));
  } else if (Array.isArray(raw.created_by) && raw.created_by.length) {
    node.append(el('strong', {}, 'Created by'), el('span', {}, raw.created_by.map(p => String(p.name || '')).join(', ')));
  }
  const cast = (Array.isArray(credits.cast) ? credits.cast : []).filter(p => Number.isSafeInteger(p.id)).slice(0, 8);
  if (cast.length) node.append(el('strong', {}, 'Cast'), el('div', { class: 'people-links' }, cast.map(p => link(String(p.name || 'Actor'), `#person/${p.id}?role=actor`))));
  if (!node.childNodes.length) node.textContent = 'No credits listed.';
}
function paintDetailWatch(node, watch) {
  node.replaceChildren(el('h4', {}, `Where to watch \u00b7 ${watch.region}`));
  const groups = [['Subscription', watch.flatrate], ['Free', watch.free], ['With ads', watch.ads], ['Rent', watch.rent], ['Buy', watch.buy]];
  let count = 0;
  for (const [label, providers] of groups) {
    if (!providers?.length) continue;
    count += providers.length;
    const links = providers.map(p => {
      const content = [p.logo ? el('img', { src: p.logo, alt: '', width: '25', height: '25', loading: 'lazy', onerror: event => event.target.remove() }) : null, p.name];
      return watch.link ? el('a', { href: watch.link, target: '_blank', rel: 'noopener noreferrer' }, content) : el('span', {}, content);
    });
    node.append(el('div', { class: 'watch-group' }, el('span', {}, label), el('div', { class: 'watch-links' }, links)));
  }
  if (!count) node.append(el('p', { class: 'muted' }, 'No providers are listed for this country. This is not proof that the title is unavailable everywhere.'));
  node.append(el('p', { class: 'fine-print' }, 'Availability by JustWatch via TMDB. Listings can change. Provider buttons open TMDB\u2019s availability page, not the streaming service directly.'));
}
async function loadRecommendations(version = epoch) {
  if (!alive(version) || view.loading) return;
  const target = view, item = target.detailItem, next = target.page + 1;
  if (!item || mediaType(item) === 'unknown' || (target.page && next > target.totalPages)) return;
  target.loading = true; $('loadMoreButton').disabled = true; $('loadMoreButton').textContent = 'Loading...';
  try {
    const data = await api.get(`/${item.media_type}/${item.id}/recommendations`, { page: next }, { signal: pageController.signal });
    if (!alive(version)) return;
    target.items = dedupeItems([...target.items, ...mediaItems(data.results, item.media_type)]);
    target.page = next; target.totalPages = pageTotal(data);
    for (const card of $('resultsContainer').querySelectorAll('.recommendation-card, .recommendation-empty')) card.remove();
    const visible = target.items.filter(x => eligible(x));
    for (const rec of visible) { const card = movieCard(rec); card.classList.add('recommendation-card'); $('resultsContainer').append(card); }
    if (!visible.length) $('resultsContainer').append(el('p', { class: 'filmography-info recommendation-empty' }, 'No unwatched recommendations are listed on these pages.'));
    $('resultCount').textContent = `${visible.length} related titles shown`;
    $('loadMoreContainer').hidden = target.page >= target.totalPages;
  } catch (error) {
    if (alive(version) && error.name !== 'AbortError') {
      notice(`Title details are available, but recommendations could not load. ${error.message}`, true);
      $('loadMoreContainer').hidden = false; // Retry the same page, including page one.
    }
  } finally { if (alive(version)) { target.loading = false; $('loadMoreButton').disabled = false; $('loadMoreButton').textContent = 'Load more'; } }
}
async function resolveTitle(item) {
  const body = el('div'), search = el('input', { type: 'search', value: titleOf(item), 'aria-label': 'TMDB matching search', maxlength: '250' });
  const matches = el('div'), form = el('form', { class: 'button-row' }, search, el('button', { class: 'button primary', type: 'submit' }, 'Search'));
  body.append(el('p', { class: 'fine-print' }, `Match ${titleOf(item)} (${yearOf(item) || 'unknown year'}) to the correct movie or TV edition. A unique exact title/year match can be linked automatically; otherwise choose explicitly.`), form, matches);
  const signal = actionDialog('Find the right edition', body);
  let queryVersion = 0;
  async function choose(candidate) {
    try {
      if (signal.aborted) return;
      store.link(itemKey(item), candidate);
      closeDialog($('actionModal'));
      toast(`Linked ${titleOf(item)} to ${candidate.media_type === 'tv' ? 'TV' : 'movie'} details.`);
      navigate(titleRoute(store.get(itemKey(item))), { replace: true, force: true });
    } catch (error) { toast(error.message); }
  }
  async function run(auto) {
    const request = ++queryVersion, query = search.value.trim();
    if (!query) return;
    matches.replaceChildren(busyNode('Finding possible editions...'));
    try {
      const data = await api.get('/search/multi', { query, include_adult: false }, { signal });
      if (signal.aborted || request !== queryVersion) return;
      if (!Array.isArray(data.results)) throw new ApiError('Invalid matching results.');
      const results = data.results.filter(c => c && !c.adult && ['movie', 'tv'].includes(c.media_type) && Number.isSafeInteger(c.id));
      const exact = exactCandidates(item, results);
      if (auto && exact.length === 1) { await choose(exact[0]); return; }
      matches.replaceChildren(el('p', { class: 'fine-print' }, exact.length > 1 ? 'More than one exact match. Choose the correct edition:' : 'No unique exact match. Review the title, year, and media type before linking:'));
      const sorted = [...exact, ...results.filter(c => !exact.some(e => e.id === c.id && e.media_type === c.media_type))];
      for (const candidate of sorted.slice(0, 12)) matches.append(el('div', { class: 'candidate' },
        el('div', {}, titleOf(candidate), el('small', {}, `${yearOf(candidate) || 'Year unknown'} \u00b7 ${candidate.media_type === 'tv' ? 'TV series' : 'Movie'}`)),
        button('Link edition', () => choose(candidate), 'button secondary')));
      if (!sorted.length) matches.append(el('p', { class: 'muted' }, 'No matching movies or series. Try a different or original-language title. Your imported entry is unchanged.'));
    } catch (error) {
      if (!signal.aborted && request === queryVersion) matches.replaceChildren(el('p', { class: 'notice warning', role: 'alert' }, error.message));
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void run(false); });
  await run(true);
}
async function playTrailer(item) {
  videoController?.abort(); videoController = new AbortController(); const signal = videoController.signal;
  $('videoTitle').textContent = `${titleOf(item)} \u00b7 Trailer`;
  $('videoContainer').replaceChildren(busyNode('Finding a trailer...')); showDialog($('videoModal'));
  const searchURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${titleOf(item)} ${yearOf(item)} official trailer`)}`;
  const fallback = message => $('videoContainer').replaceChildren(el('p', { class: 'muted' }, message), externalLink('Search trailers on YouTube \u2197', searchURL, 'button primary'));
  try {
    const data = await api.get(`/${item.media_type}/${item.id}/videos`, { language: 'en-US' }, { signal });
    if (signal.aborted) return;
    const videos = (Array.isArray(data.results) ? data.results : []).filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type) && typeof v.key === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(v.key));
    videos.sort((a, b) => Number(b.type === 'Trailer') - Number(a.type === 'Trailer') || Number(!!b.official) - Number(!!a.official));
    const video = videos[0];
    if (!video) { fallback('No embeddable trailer was listed. You can search YouTube instead.'); return; }
    const frame = el('iframe', { class: 'video-frame', src: `https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1&rel=0`, title: `${titleOf(item)} trailer`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    $('videoContainer').replaceChildren(frame, el('div', { class: 'video-fallback' }, 'Video blocked or unavailable?', externalLink('Watch on YouTube \u2197', `https://www.youtube.com/watch?v=${video.key}`, 'text-link')));
  } catch (error) { if (!signal.aborted) fallback(error.message); }
}
function pickTonight(fromSaved = true) {
  let pool = fromSaved ? store.all().filter(x => store.status(x).saved) : localModes.includes(view?.route.mode) ? filteredLocal() : view?.currentItems || [];
  pool = dedupeItems(pool.filter(x => x && (mediaType(x) !== 'unknown' || x.key?.startsWith('lb:')) && !store.isSeen(x)));
  if (!pool.length) {
    actionDialog('No unwatched titles to pick', el('div', {}, el('p', { class: 'muted' }, 'Save a few titles, load some results, or clear your current filters first.'), link('Go to your watchlist', '#watchlist', 'button primary'))); return;
  }
  const seen = new Set();
  const description = fromSaved ? 'your unwatched watchlist' : localModes.includes(view?.route.mode) ? 'your current filtered collection' : 'the unwatched results already loaded';
  function pick() {
    const remaining = pool.filter(x => !seen.has(itemKey(x)));
    const item = remaining[Math.floor(Math.random() * remaining.length)];
    seen.add(itemKey(item));
    const content = el('div', {}, el('div', { class: 'pick-layout' }, poster(item, { linked: false, eager: true }),
      el('div', {}, el('p', { class: 'eyebrow' }, 'THE DECISION IS MADE'), el('h3', {}, titleOf(item)),
        el('p', { class: 'muted' }, `${yearOf(item)}${item.moods?.length ? ` \u00b7 ${item.moods.join(' / ')}` : ''}`),
        el('p', {}, item.reasons?.find(r => !r.startsWith('Already saved')) || 'One from your list. Settle in and give it a go.'),
        el('div', { class: 'button-row' }, link('Open title \u2197', titleRoute(item), 'button primary'), button('Pick another', pick, 'button secondary', { disabled: remaining.length < 2 })))),
      el('p', { class: 'pick-counter' }, `Pick ${seen.size} of ${pool.length} from ${description}. No repeats until you close this picker.`));
    actionDialog('Tonight, sorted.', content);
  }
  pick();
}
$('tonightButton').addEventListener('click', () => pickTonight(true));

function hideSuggestions() {
  clearTimeout(suggestionTimer); suggestionVersion++; suggestionsController?.abort();
  $('suggestions').hidden = true; $('movieInput').setAttribute('aria-expanded', 'false'); $('movieInput').removeAttribute('aria-activedescendant');
  activeSuggestion = -1; suggestions = [];
}
function searchSubmit() {
  const q = $('movieInput').value.trim(); if (!q) { $('movieInput').focus(); toast('Enter a title or a person.'); return; }
  navigate(routeHash({ mode: 'search', kind: $('searchTypeSelect').value, q }), { force: true });
}
$('searchForm').addEventListener('submit', event => { event.preventDefault(); searchSubmit(); });
$('searchTypeSelect').addEventListener('change', hideSuggestions);
$('movieInput').addEventListener('input', () => {
  hideSuggestions(); const q = $('movieInput').value.trim(), kind = $('searchTypeSelect').value;
  if (q.length < 2) return;
  const version = suggestionVersion;
  suggestionTimer = setTimeout(async () => {
    suggestionsController = new AbortController(); const signal = suggestionsController.signal;
    try {
      const people = ['actor', 'director'].includes(kind);
      const data = await api.get(`/search/${people ? 'person' : kind}`, { query: q, include_adult: false }, { signal });
      if (signal.aborted || version !== suggestionVersion || $('movieInput').value.trim() !== q || $('searchTypeSelect').value !== kind) return;
      suggestions = (Array.isArray(data.results) ? data.results : []).filter(x => x && !x.adult && Number.isSafeInteger(x.id) && (kind !== 'director' || x.known_for_department === 'Directing')).slice(0, 7)
        .map(x => ({ ...x, media_type: people ? 'person' : kind }));
      if (!suggestions.length) return;
      $('suggestions').replaceChildren(...suggestions.map((item, index) => {
        const li = el('li', { id: `suggestion-${version}-${index}`, role: 'option', 'aria-selected': 'false', onmousedown: event => event.preventDefault(), onclick: () => chooseSuggestion(item, kind) },
          el('span', {}, titleOf(item)), el('small', {}, item.media_type === 'person' ? (kind === 'director' ? 'Director' : 'Person') : `${item.media_type === 'tv' ? 'TV' : 'Movie'} ${yearOf(item)}`));
        return li;
      }));
      $('suggestions').hidden = false; $('movieInput').setAttribute('aria-expanded', 'true');
    } catch { /* Autocomplete failure is non-blocking; explicit search has a retryable error state. */ }
  }, 280);
});
function chooseSuggestion(item, kind) {
  $('movieInput').value = titleOf(item); hideSuggestions();
  navigate(item.media_type === 'person' ? `#person/${item.id}?role=${kind === 'director' ? 'director' : 'actor'}` : `#${item.media_type}/${item.id}`);
}
$('movieInput').addEventListener('keydown', event => {
  if (event.key === 'Escape') { hideSuggestions(); event.preventDefault(); return; }
  if ($('suggestions').hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
    [...$('suggestions').children].forEach((li, index) => {
      li.setAttribute('aria-selected', String(index === activeSuggestion));
      if (index === activeSuggestion) { $('movieInput').setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    });
  } else if (event.key === 'Enter' && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(suggestions[activeSuggestion], $('searchTypeSelect').value); }
  else if (event.key === 'Tab') hideSuggestions();
});
document.addEventListener('click', event => {
  if (!event.target.closest('#searchForm')) hideSuggestions();
  for (const details of $('filterBar').querySelectorAll('details[open]')) if (!details.contains(event.target)) details.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const details of $('filterBar').querySelectorAll('details[open]')) details.open = false;
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable="true"]') && !document.querySelector('dialog[open]')) {
    event.preventDefault(); $('movieInput').focus();
  }
});
$('loadMoreButton').addEventListener('click', async () => {
  if (!view || view.loading) return;
  const mode = view.route.mode;
  if (localModes.includes(mode)) { view.localLimit += PAGE_SIZE; paintLocal(); }
  else if (mode === 'person') { view.localLimit += PAGE_SIZE; paintFilmography(); }
  else if (['movie', 'tv', 'title'].includes(mode)) await loadRecommendations();
  else await loadNextPage();
});

function regionOptions() {
  const defaultCodes = ['FI', 'SE', 'NO', 'DK', 'EE', 'GB', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'PL', 'AU', 'NZ', 'JP', 'IN', 'BR'];
  const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
  const codes = [...new Set([...defaultCodes, store.state.settings.region, ...regionCatalog.map(x => x.iso_3166_1).filter(validRegion)])];
  return codes.map(code => [code, `${names?.of(code) || code} (${code})`]).sort((a, b) => a[1].localeCompare(b[1]));
}
function populateRegions() {
  const old = $('regionSelect').value || store.state.settings.region;
  $('regionSelect').replaceChildren(...regionOptions().map(([code, text]) => el('option', { value: code }, text))); $('regionSelect').value = old;
}
async function openSettings(focusRegion = false) {
  populateRegions(); $('regionSelect').value = store.state.settings.region;
  $('hideSeenToggle').checked = store.state.settings.hideSeen; $('unavailableToggle').checked = store.state.settings.hideUnavailable;
  $('backupStatus').hidden = true; showDialog($('settingsModal'));
  if (focusRegion) $('regionSelect').focus();
  if (!regionCatalog.length) {
    try { const data = await api.get('/watch/providers/regions', {}, { ttl: 86400000 }); if (Array.isArray(data.results)) { regionCatalog = data.results; if ($('settingsModal').open) populateRegions(); } }
    catch { /* The offline country list and previously saved country remain usable. */ }
  }
}
$('settingsButton').addEventListener('click', () => openSettings());
$('regionButton').addEventListener('click', () => openSettings(true));
$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  const before = store.state.settings.region;
  store.setSettings({ region: $('regionSelect').value, hideSeen: $('hideSeenToggle').checked, hideUnavailable: $('unavailableToggle').checked });
  if (before !== store.state.settings.region) watches.clear();
  views.clear(); closeDialog($('settingsModal')); toast('Settings saved.');
  if (view.route.mode === 'discover') navigate(routeHash({ ...view.route, providers: before !== store.state.settings.region ? [] : view.route.providers, available: store.state.settings.hideUnavailable }), { replace: true, force: true });
  else renderRoute({ useCache: false });
});
$('exportButton').addEventListener('click', () => {
  const blob = new Blob([store.exportText()], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `whattowatchnext-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  $('backupStatus').textContent = 'Backup created. Keep it somewhere safe; it contains your personal notes and preferences.'; $('backupStatus').hidden = false;
});
$('importButton').addEventListener('click', () => { $('backupFile').value = ''; $('backupFile').click(); });
$('backupFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 8000000) throw new Error('Choose a backup smaller than 8 MB.');
    const imported = store.prepareImport(await file.text());
    const content = el('div', {}, el('p', {}, `This backup contains ${imported.entries.length.toLocaleString()} saved title records and ${imported.changes.length.toLocaleString()} preference records.`),
      el('p', { class: 'fine-print' }, 'Matching titles will use the imported preferences. Other titles stay in your library. Your streaming region and settings will also come from this backup.'),
      el('div', { class: 'button-row' }, button('Merge this backup', () => {
        try { store.importPrepared(imported); closeDialog($('actionModal')); closeDialog($('settingsModal')); views.clear(); watches.clear(); toast('Backup imported.'); renderRoute({ useCache: false }); }
        catch (error) { toast(error.message); }
      }, 'button primary'), button('Cancel', () => closeDialog($('actionModal')), 'button secondary')));
    actionDialog('Review your backup', content);
  } catch (error) {
    $('backupStatus').textContent = error.message; $('backupStatus').hidden = false; $('backupStatus').classList.add('warning');
  }
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY && store) { store.acceptExternal(event.newValue); if (localModes.includes(view?.route.mode)) paintLocal(); }
});
function networkStatus() { $('connectionBanner').hidden = navigator.onLine; }
window.addEventListener('online', networkStatus); window.addEventListener('offline', networkStatus);

async function boot() {
  let storage = null;
  try { storage = window.localStorage; } catch { storageWarning('Browser storage is blocked. Export a backup before closing to keep new changes.'); }
  seed = { items: [] };
  try {
    const response = await fetch(new URL('../data/library.json', import.meta.url));
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!data || data.version !== 1 || !Array.isArray(data.items)) throw new Error();
    seed = data;
  } catch {
    seedError = location.protocol === 'file:' ? 'Run start.cmd or npm start, then open the localhost address. JavaScript modules and data files need an HTTP server.' : 'Your imported collection could not load. Check that data/library.json was deployed alongside this page, then reload.';
    storageWarning(seedError);
  }
  store = new LibraryStore(seed, storage, storageWarning); store.subscribe(updateCounts); updateCounts(); networkStatus();
  history.scrollRestoration = 'manual';
  if (!history.state?.app) history.replaceState({ app: true, position: 0 }, '', location.hash || '#discover');
  await renderRoute({ initial: true });
  // Offline shell only. Remote movie/provider responses are deliberately not cached by the worker.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname }).catch(() => {});
  }
}
boot().catch(error => {
  storageWarning('The app could not start. Check the included README and reload.');
  $('loader').hidden = true;
  $('resultsContainer').replaceChildren(listEmpty('Unable to start', error.message || 'Please reload the page.', [button('Reload', () => location.reload())]));
});
