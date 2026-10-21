import test from 'node:test';
import assert from 'node:assert/strict';
import { LibraryStore, emptyState, validateState } from '../js/store.js';
import { STORAGE_KEY } from '../js/config.js';
class MemoryStorage { constructor() { this.data = new Map(); } getItem(k) { return this.data.get(k) || null; } setItem(k,v) { this.data.set(k,String(v)); } }
const seed = { items: [
  { key: 'lb:imported|2020', title: 'Imported', year: '2020', media_type: 'unknown', seedSaved: true, recommended: true },
  { key: 'lb:seen|2000', title: 'Seen', year: '2000', media_type: 'unknown', seedWatched: true, seedRating: 4.5 }
] };
const film = { id: 9, title: 'Fixture', media_type: 'movie', year: '2020' };
test('seed defaults import a watchlist and ratings without network metadata', () => { const s = new LibraryStore(seed); assert.equal(s.count('saved'), 1); assert.equal(s.count('watched'), 1); });
test('removing a seeded title persists across reload without reseeding it', () => {
  const storage = new MemoryStorage(), a = new LibraryStore(seed, storage);
  a.update(seed.items[0], { saved: false }); assert.equal(new LibraryStore(seed, storage).count('saved'), 0);
});
test('movie and TV saves with identical numeric IDs remain independent', () => {
  const s = new LibraryStore(seed, new MemoryStorage()); s.update(film, { saved: true }); s.update({ ...film, media_type: 'tv' }, { saved: true });
  s.update(film, { saved: false }); assert.equal(s.status('tv:9').saved, true); assert.equal(s.status('movie:9').saved, false);
});
test('legacy watchlist and region migrate non-destructively', () => {
  const storage = new MemoryStorage(); storage.setItem('my_watchlist', JSON.stringify([film, { ...film, media_type: 'tv' }])); storage.setItem('userRegion', 'SE');
  const old = storage.getItem('my_watchlist'); const s = new LibraryStore(seed, storage);
  assert.equal(s.count('saved'), 3); assert.equal(s.state.settings.region, 'SE'); assert.equal(storage.getItem('my_watchlist'), old);
});
test('legacy duplicates are removed by typed identity', () => {
  const storage = new MemoryStorage(); storage.setItem('my_watchlist', JSON.stringify([film, film]));
  assert.equal(new LibraryStore(seed, storage).count('saved'), 2);
});
test('corrupt v3 storage survives untouched; session remains usable', () => {
  const storage = new MemoryStorage(); storage.setItem(STORAGE_KEY, '{broken'); const warnings = [];
  const s = new LibraryStore(seed, storage, message => warnings.push(message)); s.update(film, { saved: true });
  assert.equal(storage.getItem(STORAGE_KEY), '{broken'); assert.equal(s.status(film).saved, true); assert.equal(s.persistent, false); assert.ok(warnings.length);
});
test('blocked storage never crashes or drops in-memory edits', () => {
  const s = new LibraryStore(seed, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  s.update(film, { saved: true }); assert.equal(s.status(film).saved, true); assert.ok(JSON.parse(s.exportText()).changes.length);
});
test('quota failures are visible and export still works', () => {
  const warnings = [], storage = new MemoryStorage(), s = new LibraryStore(seed, storage, x => warnings.push(x));
  storage.setItem = () => { throw new Error('quota'); }; s.update(film, { saved: true });
  assert.equal(s.persistent, false); assert.ok(warnings.length); assert.ok(s.exportText().includes('Fixture'));
});
test('notes and half-star ratings round trip without HTML interpretation', () => {
  const storage = new MemoryStorage(), s = new LibraryStore(seed, storage); const notes = '<img src=x onerror=alert(1)> \' " &';
  s.update(film, { notes, rating: 4.5 }); const again = new LibraryStore(seed, storage);
  assert.equal(again.status(film).notes, notes); assert.equal(again.status(film).watched, true); assert.equal(again.status(film).rating, 4.5);
});
test('marking unwatched clears personal rating but preserves notes and saved state', () => {
  const s = new LibraryStore(seed); s.update(film, { saved: true, rating: 5, notes: 'keep me' }); s.update(film, { watched: false });
  assert.equal(s.status(film).rating, null); assert.equal(s.status(film).saved, true); assert.equal(s.status(film).notes, 'keep me');
});
test('exact history matches do not conflate movie and TV', () => {
  const s = new LibraryStore(seed); assert.ok(s.historyMatch({ id: 12, title: 'Seen', year: 2000, media_type: 'movie' }));
  assert.equal(s.historyMatch({ id: 12, title: 'Seen', year: 2000, media_type: 'tv' }), null);
});
test('an explicit unwatched override beats a tentative imported history match', () => {
  const s = new LibraryStore(seed), item = { id: 12, title: 'Seen', year: 2000, media_type: 'movie' };
  s.update(item, { watched: false }); assert.equal(s.isSeen(item), false);
});
test('metadata linking preserves imported saved state, key and provenance', () => {
  const s = new LibraryStore(seed), item = { id: 66, media_type: 'movie', title: 'Imported', year: 2020, poster_path: '/poster.jpg' };
  s.link(seed.items[0].key, item); assert.equal(s.canonical(item), seed.items[0].key); assert.equal(s.status(item).saved, true); assert.equal(s.get(seed.items[0].key).recommended, true);
});
test('linking a previously saved typed title merges it without duplicates', () => {
  const s = new LibraryStore(seed); const typed = { ...film, title: 'Imported' }; s.update(typed, { saved: true, notes: 'preserve' });
  s.link(seed.items[0].key, typed); assert.equal(s.count('saved'), 1); assert.equal(s.status(seed.items[0].key).notes, 'preserve');
});
test('backup parsing is transactional and rejects broken shapes and invalid ratings', () => {
  const s = new LibraryStore(seed, new MemoryStorage()); const before = JSON.stringify(s.state);
  for (const bad of ['{}', '{', '[]', JSON.stringify({ ...emptyState(), changes: [{ key: 'movie:9', rating: 8, updatedAt: 1 }] })]) assert.throws(() => s.prepareImport(bad));
  assert.equal(JSON.stringify(s.state), before);
});
test('backup validation rejects duplicate keys, prototypes and impossible fields', () => {
  const r = { key: 'movie:9', saved: true, updatedAt: 1 };
  assert.throws(() => validateState({ ...emptyState(), changes: [r, r] }));
  assert.throws(() => validateState({ ...emptyState(), changes: [{ key: '__proto__', saved: true, updatedAt: 1 }] }));
  assert.throws(() => validateState({ ...emptyState(), settings: { region: '../US' } }));
});
test('backup import keeps unrelated titles and applies confirmed incoming preferences', () => {
  const s = new LibraryStore(seed), source = new LibraryStore(seed); s.update(film, { saved: true }); source.update(seed.items[0], { saved: false, notes: 'incoming' });
  s.importPrepared(s.prepareImport(source.exportText())); assert.equal(s.status(film).saved, true); assert.equal(s.status(seed.items[0]).saved, false); assert.equal(s.status(seed.items[0]).notes, 'incoming');
});
test('cross-tab updates to different titles merge rather than clobber the list', () => {
  const storage = new MemoryStorage(), a = new LibraryStore(seed, storage), b = new LibraryStore(seed, storage);
  a.update(film, { saved: true }); b.update({ ...film, id: 10, title: 'Other' }, { saved: true });
  assert.equal(new LibraryStore(seed, storage).count('saved'), 3);
});
test('title edits from a stale tab retain the newer streaming settings', () => {
  const storage = new MemoryStorage(), a = new LibraryStore(seed, storage), b = new LibraryStore(seed, storage);
  a.setSettings({ region: 'US' }); b.update(film, { saved: true });
  assert.equal(new LibraryStore(seed, storage).state.settings.region, 'US');
});

test('portable backup restores imported defaults without the original seed file', () => {
  const source = new LibraryStore(seed), target = new LibraryStore({ items: [] });
  target.importPrepared(target.prepareImport(source.exportText()));
  assert.equal(target.count('saved'), 1); assert.equal(target.count('watched'), 1);
  assert.equal(target.status('lb:seen|2000').rating, 4.5);
});
