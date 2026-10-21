import { STORAGE_KEY, DEFAULT_REGION } from './config.js';
import { normalizeItem, itemKey, titleYearKey, mediaType, validRegion } from './core.js';
const MAX_RECORDS = 20000;
const validKey = key => typeof key === 'string' && key.length <= 600 && /^(lb:.+\|\d{0,4}|(?:movie|tv):[1-9]\d*)$/.test(key);
const defaultSettings = () => ({ region: DEFAULT_REGION, hideSeen: true, hideUnavailable: false, layout: 'grid' });
export function emptyState() { return { version: 3, entries: [], changes: [], settings: defaultSettings(), updatedAt: 0 }; }
export function validateState(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 3 || !Array.isArray(raw.entries) || !Array.isArray(raw.changes))
    throw new Error('This is not a WhatToWatchNext v3 backup. No data was changed.');
  if (raw.entries.length > MAX_RECORDS || raw.changes.length > MAX_RECORDS) throw new Error('Backup contains too many records.');
  const seenEntries = new Set(), seenChanges = new Set();
  const entries = raw.entries.map(entry => {
    const item = normalizeItem(entry);
    if (!validKey(entry.key) || seenEntries.has(entry.key)) throw new Error('Backup has an invalid or duplicate title key.');
    if (!entry.key.startsWith('lb:') && entry.key !== item.key) throw new Error('Backup title identity is inconsistent.');
    seenEntries.add(entry.key);
    return { ...item, key: entry.key };
  });
  const changes = raw.changes.map(change => {
    if (!change || !validKey(change.key) || seenChanges.has(change.key)) throw new Error('Backup has an invalid or duplicate saved-state key.');
    if (!Number.isSafeInteger(change.updatedAt) || change.updatedAt < 0) throw new Error('Backup has an invalid update time.');
    seenChanges.add(change.key);
    const result = { key: change.key, updatedAt: change.updatedAt };
    for (const field of ['saved', 'watched']) if (field in change) {
      if (typeof change[field] !== 'boolean') throw new Error(`Invalid ${field} value.`);
      result[field] = change[field];
    }
    if ('rating' in change) {
      if (change.rating !== null && !(Number.isFinite(change.rating) && change.rating >= 0.5 && change.rating <= 5 && Number.isInteger(change.rating * 2)))
        throw new Error('Ratings must be half-star steps from 0.5 to 5, or null.');
      result.rating = change.rating;
    }
    if ('priority' in change) {
      if (![0, 1, 2].includes(change.priority)) throw new Error('Invalid priority.');
      result.priority = change.priority;
    }
    if ('notes' in change) {
      if (typeof change.notes !== 'string' || change.notes.length > 4000) throw new Error('Notes must be text, up to 4,000 characters.');
      result.notes = change.notes;
    }
    for (const field of ['savedAt', 'watchedAt']) if (field in change) {
      if (!Number.isSafeInteger(change[field]) || change[field] < 0) throw new Error('Invalid timestamp.');
      result[field] = change[field];
    }
    return result;
  });
  const settings = defaultSettings();
  if (raw.settings) {
    if (typeof raw.settings !== 'object' || Array.isArray(raw.settings)) throw new Error('Invalid settings.');
    if ('region' in raw.settings) {
      if (!validRegion(raw.settings.region)) throw new Error('Invalid region.');
      settings.region = raw.settings.region;
    }
    for (const field of ['hideSeen', 'hideUnavailable']) if (field in raw.settings) {
      if (typeof raw.settings[field] !== 'boolean') throw new Error('Invalid setting.');
      settings[field] = raw.settings[field];
    }
    if (['grid', 'list'].includes(raw.settings.layout)) settings.layout = raw.settings.layout;
  }
  return { version: 3, entries, changes, settings, updatedAt: Number.isSafeInteger(raw.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0 };
}
function mergeLatest(a, b, field = 'updatedAt') {
  const map = new Map(a.map(x => [x.key, x]));
  for (const value of b) if (!map.has(value.key) || (value[field] || 0) >= (map.get(value.key)[field] || 0)) map.set(value.key, value);
  return [...map.values()];
}
export class LibraryStore {
  constructor(seed = { items: [] }, storage = null, onWarning = () => {}) {
    this.seed = seed; this.storage = storage; this.onWarning = onWarning; this.persistent = !!storage;
    this.base = new Map(seed.items.map(x => [x.key, x])); this.state = emptyState(); this.listeners = new Set();
    this.lastTime = Date.now(); this.load(); this.reindex();
  }
  warning(message) { this.onWarning(message); }
  read(key) { try { return this.storage?.getItem(key) || null; } catch { this.persistent = false; this.warning('Browser storage is blocked. Changes are temporary; export a backup before closing.'); return null; } }
  load() {
    const raw = this.read(STORAGE_KEY);
    if (raw) {
      try { this.state = validateState(JSON.parse(raw)); }
      catch { this.persistent = false; this.warning('Saved data could not be read. The original storage was left untouched. New changes are temporary; export a backup.'); }
      return;
    }
    // Non-destructive migration: retain all original keys as a recovery copy.
    const region = this.read('userRegion');
    if (validRegion(region)) this.state.settings.region = region;
    this.state.settings.hideUnavailable = this.read('hide_unavailable') === 'true';
    const legacy = this.read('my_watchlist');
    if (legacy) {
      try {
        const rows = JSON.parse(legacy);
        if (!Array.isArray(rows) || rows.length > MAX_RECORDS) throw new Error();
        for (const row of rows) {
          try {
            const item = normalizeItem(row);
            this.state.entries.push(item);
            this.state.changes.push({ key: item.key, saved: true, savedAt: Date.now(), updatedAt: Date.now() });
          } catch { this.warning('An invalid old watchlist entry was skipped; the original my_watchlist value is still intact.'); }
        }
        this.state.entries = mergeLatest([], this.state.entries);
        this.state.changes = mergeLatest([], this.state.changes);
      } catch { this.warning('The old watchlist could not be migrated. Its original storage was not changed.'); }
    }
    // Import old After Credits shortlist only when both sites shared this origin.
    try {
      const saved = JSON.parse(this.read('aftercredits_saved') || '[]');
      if (Array.isArray(saved)) for (const value of saved.slice(0, MAX_RECORDS)) {
        if (typeof value !== 'string') continue;
        const sep = value.lastIndexOf('|'); if (sep < 0) continue;
        const key = `lb:${titleYearKey({ title: value.slice(0, sep), year: value.slice(sep + 1) })}`;
        if (this.base.has(key)) this.state.changes.push({ key, saved: true, savedAt: Date.now(), updatedAt: Date.now() });
      }
      this.state.changes = mergeLatest([], this.state.changes);
    } catch { /* An optional, unrelated legacy value never blocks startup. */ }
    this.persist(false);
  }
  reindex() {
    this.entries = new Map(this.state.entries.map(x => [x.key, x]));
    this.changes = new Map(this.state.changes.map(x => [x.key, x])); this.aliases = new Map();
    for (const x of this.state.entries) if (x.media_type !== 'unknown') this.aliases.set(`${x.media_type}:${x.id}`, x.key);
  }
  canonical(item) {
    const key = typeof item === 'string' ? item : itemKey(item);
    return this.aliases.get(key) || key;
  }
  get(item) {
    const key = this.canonical(item);
    const base = this.base.get(key), entry = this.entries.get(key);
    if (base || entry) return { ...base, ...entry, key };
    return typeof item === 'object' ? item : null;
  }
  status(item) {
    const key = this.canonical(item), base = this.base.get(key) || {}, change = this.changes.get(key) || {};
    return { saved: !!base.seedSaved, watched: !!base.seedWatched, rating: base.seedRating ?? null,
      priority: 0, notes: '', savedAt: 0, ...change };
  }
  /** Rating exports have no TMDB IDs or media types. A tentative movie match only
   * hides an exact title/year; it never binds identities or modifies those ratings. */
  historyMatch(item) {
    if (mediaType(item) !== 'movie') return null;
    const explicit = this.changes.get(this.canonical(item));
    if (explicit && 'watched' in explicit) return null;
    const key = `lb:${titleYearKey(item)}`, candidate = this.get(key);
    if (!candidate?.seedWatched || (candidate.media_type !== 'unknown' && (candidate.media_type !== item.media_type || candidate.id !== item.id))) return null;
    return this.status(key).watched ? candidate : null;
  }
  isSeen(item) { return this.status(item).watched || !!this.historyMatch(item); }
  all() {
    const keys = new Set([...this.base.keys(), ...this.entries.keys()]);
    return [...keys].filter(k => this.canonical(k) === k).map(k => this.get(k));
  }
  count(field) { return this.all().filter(item => this.status(item)[field]).length; }
  now() { this.lastTime = Math.max(Date.now(), this.lastTime + 1); return this.lastTime; }
  update(item, patch) {
    const key = this.canonical(item), time = this.now();
    const entries = [...this.state.entries];
    if (!this.base.has(key) && !this.entries.has(key)) entries.push({ ...normalizeItem(item), key });
    const previous = this.changes.get(key) || {};
    const change = { ...previous, ...patch, key, updatedAt: time };
    if (patch.saved === true && !this.status(item).saved) change.savedAt = time;
    if (patch.watched === true && !this.status(item).watched) change.watchedAt = time;
    if (patch.watched === false) change.rating = null;
    if (patch.rating != null && patch.watched !== false) change.watched = true;
    this.state = validateState({ ...this.state, entries, changes: mergeLatest(this.state.changes, [change]), updatedAt: time });
    this.persist();
  }
  link(key, details) {
    key = this.canonical(key);
    if (!this.base.has(key) && !this.entries.has(key)) throw new Error('Unknown imported title.');
    const normalized = normalizeItem(details), typedKey = itemKey(normalized), time = this.now();
    const previousLink = this.aliases.get(typedKey);
    if (previousLink && previousLink !== typedKey && previousLink !== key) throw new Error('That TMDB title is already linked to another imported record.');
    const entries = this.state.entries.filter(e => e.key !== typedKey && e.key !== key);
    entries.push({ ...normalized, key, url: this.get(key)?.url || '' });
    const typedChange = this.changes.get(typedKey), targetChange = this.changes.get(key);
    const changes = this.state.changes.filter(c => c.key !== typedKey || typedKey === key);
    if (typedChange && (!targetChange || typedChange.updatedAt > targetChange.updatedAt))
      changes.push({ ...typedChange, key, updatedAt: time });
    this.state = validateState({ ...this.state, entries, changes: mergeLatest([], changes), updatedAt: time });
    this.persist(false); this.reindex(); this.emit();
    return this.get(key);
  }
  setSettings(patch) {
    this.state = validateState({ ...this.state, settings: { ...this.state.settings, ...patch }, updatedAt: this.now() }); this.persist(true, true);
  }
  persist(merge = true, ownSettings = false) {
    if (this.persistent) {
      try {
        if (merge) {
          const raw = this.storage.getItem(STORAGE_KEY);
          if (raw) {
            const other = validateState(JSON.parse(raw));
            // Merge per-title timestamps, not one entire stale tab snapshot.
            if (!ownSettings) this.state.settings = other.settings;
            this.state.changes = mergeLatest(other.changes, this.state.changes);
            this.state.entries = mergeLatest(other.entries, this.state.entries);
          }
        }
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        this.persistent = false;
        this.warning('Changes could not be saved to this browser. They remain available for this session; export a backup now.');
      }
    }
    this.reindex(); this.emit();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(); }
  acceptExternal(raw) {
    if (!raw) { this.warning('Saved data was cleared in another tab. This tab still has its copy; export it to keep it.'); return; }
    try { this.state = validateState(JSON.parse(raw)); this.reindex(); this.emit(); }
    catch { this.warning('Another tab wrote invalid library data. It was not loaded.'); }
  }
  prepareImport(text) {
    if (typeof text !== 'string' || text.length > 8000000) throw new Error('Backup must be smaller than 8 MB.');
    let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('Backup is not valid JSON. No data was changed.'); }
    const imported = validateState(parsed);
    const keys = new Set([...this.base.keys(), ...imported.entries.map(e => e.key), ...this.entries.keys()]);
    if (imported.changes.some(c => !keys.has(c.key))) throw new Error('Backup references missing titles. Use its matching library data. No data was changed.');
    return imported;
  }
  importPrepared(imported) {
    imported = validateState(imported);
    const time = this.now();
    this.state = validateState({ ...this.state,
      entries: mergeLatest(this.state.entries, imported.entries),
      changes: mergeLatest(this.state.changes, imported.changes.map(c => ({ ...c, updatedAt: time }))),
      settings: imported.settings, updatedAt: time });
    this.persist(false);
  }
  exportText() {
    // A portable backup includes immutable imported defaults too, not only deltas.
    // It can restore the watchlist/history even without the bundled seed file.
    const items = this.all();
    const entries = items.map(item => ({ ...normalizeItem(item), key: item.key }));
    const changes = items.map(item => {
      const state = this.status(item);
      return { key: item.key, saved: state.saved, watched: state.watched, rating: state.rating,
        priority: state.priority, notes: state.notes, savedAt: state.savedAt || 0,
        watchedAt: state.watchedAt || 0, updatedAt: state.updatedAt || 0 };
    });
    return JSON.stringify({ ...this.state, entries, changes,
      exportedAt: new Date().toISOString(), source: 'WhatToWatchNext' }, null, 2);
  }
}
