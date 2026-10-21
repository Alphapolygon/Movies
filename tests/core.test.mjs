import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeTitle, itemKey, normalizeItem, imageURL, safeURL, discoverParams, decadeMatches, availabilityFrom, streamProviders, sortItems, exactCandidates, parseRoute, routeHash, dedupeItems } from '../js/core.js';
const movie = { id: 5, media_type: 'movie', title: 'Test', release_date: '2020-04-01' };
test('movie and TV IDs live in separate namespaces', () => assert.notEqual(itemKey(movie), itemKey({ ...movie, media_type: 'tv' })));
test('titles with different years do not collide', () => assert.notEqual(itemKey({ title: 'Revenge', year: 1990 }), itemKey({ title: 'Revenge', year: 2017 })));
test('unicode accents and punctuation normalize without executable strings', () => assert.equal(normalizeTitle('D\u00ecdi: A & B!'), 'didi a and b'));
test('one explicit source alias merges A Silent Voice, without dropping its year', () => assert.equal(normalizeTitle('A Silent Voice: The Movie'), normalizeTitle('A Silent Voice')));
test('safe URLs reject javascript, credentials, and lookalike hosts', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@boxd.it/a', 'https://boxd.it.evil.com/a']) assert.equal(safeURL(u, ['boxd.it']), '');
  assert.equal(safeURL('https://boxd.it/abc', ['boxd.it']), 'https://boxd.it/abc');
});
test('poster paths cannot change origins, inject markup, or traverse paths', () => {
  for (const p of ['//evil.com/a.jpg', '/../../a.jpg', '/a.jpg" onload=x', 'null']) assert.equal(imageURL(p), '');
  assert.equal(imageURL('/valid_01.jpg'), 'https://image.tmdb.org/t/p/w500/valid_01.jpg');
});
test('normalization validates IDs and does not coerce null poster strings', () => {
  assert.throws(() => normalizeItem({ ...movie, id: -1 }));
  assert.equal(normalizeItem({ ...movie, poster_path: 'null', vote_average: '9.8' }).poster_path, null);
  assert.equal(normalizeItem({ ...movie, vote_average: '9.8' }).vote_average, null);
});
test('TV newest uses first_air_date sort and bounds', () => {
  const p = discoverParams({ type: 'tv', sort: 'newest' }, 1, 'FI', '2026-10-21');
  assert.equal(p.sort_by, 'first_air_date.desc'); assert.equal(p['first_air_date.lte'], '2026-10-21'); assert.ok(!('primary_release_date.lte' in p));
});
test('movie newest uses primary_release_date', () => assert.equal(discoverParams({ type: 'movie', sort: 'newest' }, 1, 'FI').sort_by, 'primary_release_date.desc'));
test('nonadjacent decades are exactly filtered, not the whole interval', () => {
  assert.equal(decadeMatches({ year: 1985 }, ['1970', '1990']), false);
  assert.equal(decadeMatches({ year: 1995 }, ['1970', '1990']), true);
});
test('date bounds never include future release dates', () => assert.equal(discoverParams({ type: 'tv', decades: ['2020'] }, 1, 'FI', '2026-10-21')['first_air_date.lte'], '2026-10-21'));
test('streaming filters include subscription, free and ads, with region', () => {
  const p = discoverParams({ type: 'movie', available: true }, 2, 'FI');
  assert.equal(p.with_watch_monetization_types, 'flatrate|free|ads'); assert.equal(p.watch_region, 'FI'); assert.equal(p.page, 2);
});
test('provider alternatives use OR and all-access supports rentals', () => {
  const p = discoverParams({ providers: ['8', '337'], access: 'all' }, 1, 'US');
  assert.equal(p.with_watch_providers, '8|337'); assert.equal(p.with_watch_monetization_types, 'flatrate|free|ads|rent|buy');
});
test('missing availability data is an error, not a false unavailable result', () => assert.throws(() => availabilityFrom(null, 'FI')));
test('free and ads are real stream options; region data is not shared', () => {
  const data = { results: { FI: { free: [{ provider_id: 1, provider_name: 'Yle' }], ads: [{ provider_id: 2, provider_name: 'Ads' }] }, US: { rent: [{ provider_id: 3, provider_name: 'Rental' }] } } };
  assert.equal(streamProviders(availabilityFrom(data, 'FI')).length, 2);
  assert.equal(streamProviders(availabilityFrom(data, 'US')).length, 0);
  assert.equal(streamProviders(availabilityFrom(data, 'US'), 'all').length, 1);
});
test('exact resolver rejects wrong-year / fuzzy candidates and surfaces ambiguity', () => {
  const source = { title: 'Test', year: 2020 };
  assert.equal(exactCandidates(source, [movie, { ...movie, id: 6, release_date: '2010-01-01' }, { ...movie, id: 7, title: 'Testing' }]).length, 1);
  assert.equal(exactCandidates(source, [movie, { ...movie, media_type: 'tv' }]).length, 2);
});
test('deduplication preserves movie/TV with identical numeric IDs', () => assert.equal(dedupeItems([movie, movie, { ...movie, media_type: 'tv' }]).length, 2));
test('routing round trips quotes, unicode, reserved characters and filters', () => {
  const hash = routeHash({ mode: 'search', q: 'O\u2019Brien & <script>? \u00e4', kind: 'director', decades: ['1970', '1990'] });
  const r = parseRoute(hash); assert.equal(r.q, 'O\u2019Brien & <script>? \u00e4'); assert.equal(r.kind, 'director'); assert.deepEqual(r.decades, ['1970', '1990']);
});
test('bad hashes and invalid parameters are safe', () => {
  assert.equal(parseRoute('#title/%E0%A4%A').key, ''); assert.equal(parseRoute('#bad').mode, 'discover');
  assert.equal(parseRoute('#movie/not-a-number').id, null); assert.deepEqual(parseRoute('#discover?genres=x,1,2').genres, ['1', '2']);
});
test('sorting never mutates source arrays or assigns absent ratings', () => {
  const source = [{ title: 'B', year: 2000 }, { title: 'A', year: 2010 }];
  assert.equal(sortItems(source, 'newest')[0].title, 'A'); assert.equal(source[0].title, 'B');
});
test('the shipped seed preserves every source row, with one documented alias merge', () => {
  const seed = JSON.parse(fs.readFileSync(new URL('../data/library.json', import.meta.url)));
  assert.equal(seed.sourceCounts.recommendationRows, 211); assert.equal(seed.items.filter(i => i.recommended).length, 210);
  assert.equal(seed.items.filter(i => i.seedSaved).length, 148); assert.equal(seed.items.filter(i => i.seedWatched).length, 2452);
  assert.equal(new Set(seed.items.map(i => i.key)).size, seed.items.length);
  for (const item of seed.items) assert.equal(item.key, itemKey({ title: item.title, year: item.year }));
});
