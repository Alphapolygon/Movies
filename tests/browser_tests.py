"""Chromium UI regression tests. Uses only deterministic local/API fixtures.

Run against the normal HTTP app: python tests/browser_tests.py
Restricted environments can run the SAME ES modules with an in-memory host:
  python tests/browser_tests.py --in-memory
The in-memory host removes the document CSP to load Blob ES modules, substitutes
only import.meta.url with the real served URL, and supplies a Storage-compatible
in-memory adapter. It tests UI logic/layout, NOT CSP, real storage, service-worker
installation, or production HTTP integration. Node tests independently exercise
storage and API logic. Live TMDB/Cloudflare access is never required by this suite.
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'results'
ORIGIN = 'http://127.0.0.1:8000'
KEY = 'whattowatchnext.library.v3'
SEED = json.loads((ROOT / 'data/library.json').read_text())
RESULTS = []
IN_MEMORY = False

class Fixture:
    def __init__(self):
        self.requests = []
        self.fail_pages = set()
        self.all_fail = False
        self.trailer_valid = False
        self.slow_seconds = .35
    def movie(self, ident, media='movie'):
        title = f'Fixture Movie {ident}' if media == 'movie' else f'Fixture Series {ident}'
        return {'id': ident, 'media_type': media, 'title': title, 'name': title,
                'release_date': '2020-05-10', 'first_air_date': '2020-05-10',
                'poster_path': None, 'genre_ids': [18], 'vote_average': 7.5, 'vote_count': 500,
                'overview': 'A deterministic test synopsis. This is fixture data, not a real film.'}
    async def response(self, url):
        parts = urlsplit(str(url)); q = parse_qs(parts.query); path = parts.path
        if path.endswith('/data/library.json'):
            return {'status': 200, 'body': json.dumps(SEED)}
        self.requests.append(url)
        if self.all_fail:
            return {'status': 503, 'body': '{}'}
        path = re.sub(r'^/3', '', path)
        page = int(q.get('page', ['1'])[0])
        data = {}
        if path.startswith('/discover/'):
            media = path.rsplit('/', 1)[1]
            if page in self.fail_pages: return {'status': 503, 'body': '{}'}
            await asyncio.sleep(.03)
            data = {'page': page, 'total_pages': 3, 'total_results': 60,
                    'results': [self.movie(n, media) for n in range((page-1)*20+1, page*20+1)]}
        elif path.startswith('/genre/'):
            data = {'genres': [{'id': 18, 'name': 'Drama'}, {'id': 53, 'name': 'Thriller'}]}
        elif path == '/watch/providers/regions':
            data = {'results': [{'iso_3166_1': 'FI'}, {'iso_3166_1': 'US'}, {'iso_3166_1': 'SE'}]}
        elif path.startswith('/watch/providers/'):
            data = {'results': [{'provider_id': 8, 'provider_name': 'Netflix'}, {'provider_id': 20, 'provider_name': 'Yle Areena'}]}
        elif path.startswith('/search/'):
            query = q.get('query', [''])[0]
            if query == 'slow': await asyncio.sleep(self.slow_seconds)
            kind = path.rsplit('/', 1)[1]
            if kind == 'person':
                data = {'page': page, 'total_pages': 1, 'results': [
                    {'id': 501, 'name': 'Fixture Director', 'known_for_department': 'Directing'},
                    {'id': 502, 'name': 'Fixture Actor', 'known_for_department': 'Acting'}]}
            elif kind == 'multi':
                match = next((x for x in SEED['items'] if x['title'] == query), None)
                candidate = {**self.movie(990), 'title': query, 'release_date': (match['year'] if match else '2020') + '-01-01'}
                if query == 'Monster':
                    data = {'results': [candidate, {**candidate, 'id': 991, 'media_type': 'tv'}]}
                else:
                    # Give each source record a distinct, stable fixture ID.
                    if match: candidate['id'] = 10000 + next(i for i, x in enumerate(SEED['items']) if x['key'] == match['key'])
                    data = {'results': [candidate]}
            else:
                data = {'page': page, 'total_pages': 1, 'results': [{**self.movie(100, kind), 'title': query, 'name': query}]}
        elif re.match(r'^/person/\d+/combined_credits$', path):
            data = {'cast': [self.movie(810), self.movie(811, 'tv')],
                    'crew': [{**self.movie(800), 'job': 'Director'}, {**self.movie(801, 'tv'), 'job': 'Director'}, {**self.movie(800), 'job': 'Director'}, {**self.movie(805), 'job': 'Writer'}]}
        elif re.match(r'^/person/\d+$', path):
            data = {'id': int(path.rsplit('/', 1)[1]), 'name': 'Fixture Director'}
        elif path.endswith('/watch/providers'):
            data = {'results': {'FI': {'link': 'https://www.themoviedb.org/movie/1/watch',
                       'free': [{'provider_id': 20, 'provider_name': 'Yle Areena', 'logo_path': None}],
                       'ads': [{'provider_id': 21, 'provider_name': 'Free with ads', 'logo_path': None}],
                       'rent': [{'provider_id': 8, 'provider_name': 'Rental option', 'logo_path': None}]},
                       'US': {'link': 'https://www.themoviedb.org/movie/1/watch', 'flatrate': [{'provider_id': 8, 'provider_name': 'Netflix', 'logo_path': None}]}}}
        elif path.endswith('/credits'):
            data = {'cast': [{'id': 502, 'name': 'Fixture Actor'}], 'crew': [{'id': 501, 'name': 'Fixture Director', 'job': 'Director'}]}
        elif path.endswith('/external_ids'):
            data = {'imdb_id': 'tt1234567'}
        elif path.endswith('/recommendations'):
            media = path.split('/')[1]
            data = {'page': page, 'total_pages': 1, 'results': [self.movie(701, media), self.movie(702, media)]}
        elif path.endswith('/videos'):
            data = {'results': [{'site': 'YouTube', 'type': 'Trailer', 'official': True, 'key': 'abcdefghijk'}] if self.trailer_valid else []}
        elif re.match(r'^/(movie|tv)/\d+$', path):
            _, media, ident = path.split('/')
            data = self.movie(int(ident), media); data['runtime'] = 101
            if int(ident) >= 10000:
                row = SEED['items'][int(ident)-10000]
                data.update(title=row['title'], release_date=row['year']+'-01-01')
        return {'status': 200, 'body': json.dumps(data)}

async def hosted_routes(route, fixture):
    url = route.request.url
    if 'workers.dev' in url:
        result = await fixture.response(url)
        await route.fulfill(status=result['status'], content_type='application/json', body=result['body'])
    elif url.startswith(ORIGIN):
        await route.continue_()
    else:
        await route.abort()

async def load_memory(page, fixture, hash='#discover', storage=None):
    html = (ROOT / 'index.html').read_text()
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', html)
    html = re.sub(r'<script type="module"[^>]+></script>', '', html)
    html = re.sub(r'<link[^>]+>', '', html)
    await page.set_content(html)
    await page.add_style_tag(content=(ROOT / 'style.css').read_text())
    await page.expose_function('__fixtureFetch', fixture.response)
    await page.evaluate("""({hash, initial}) => {
      const map = new Map(Object.entries(initial || {}));
      Object.defineProperty(window, 'localStorage', {configurable: true, value: {
        getItem: key => map.has(key) ? map.get(key) : null,
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key), clear: () => map.clear(),
        key: i => [...map.keys()][i] || null, get length() {return map.size}
      }});
      history.replaceState(null, '', hash);
      window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) {reject(new DOMException('Aborted','AbortError'));return;}
        let done = false;
        const abort = () => {if (!done) {done = true; reject(new DOMException('Aborted','AbortError'));}};
        signal?.addEventListener('abort', abort, {once:true});
        window.__fixtureFetch(String(url)).then(result => {
          if (!done) {done = true; resolve(new Response(result.body, {status: result.status, headers: {'content-type':'application/json'}}));}
        }).catch(error => {if (!done) {done = true;reject(error)}}).finally(() => signal?.removeEventListener('abort', abort));
      });
    }""", {'hash': hash, 'initial': storage or {}})
    modules = {name: (ROOT / 'js' / name).read_text() for name in ['config.js', 'core.js', 'api.js', 'store.js', 'app.js']}
    await page.evaluate(r"""async ({modules, origin}) => {
      const urls = {};
      for (const [name, original] of Object.entries(modules)) {
        let code = original.replace(/from ['"]\.\/([^'"]+)['"]/g, (_, dependency) => `from '${urls[dependency]}'`);
        if (name === 'app.js') code = code.replaceAll('import.meta.url', JSON.stringify(origin + '/js/app.js'));
        urls[name] = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
      }
      window.__moduleURLs = urls;
      await import(urls['app.js']);
    }""", {'modules': modules, 'origin': ORIGIN})

async def new_page(browser, hash='#discover', width=1440, height=1000, storage=None, fixture=None):
    fixture = fixture or Fixture()
    context = await browser.new_context(viewport={'width':width, 'height':height}, service_workers='block', accept_downloads=True)
    page = await context.new_page(); page.set_default_timeout(4500)
    errors=[]; page.on('pageerror', lambda error: errors.append(str(error)))
    await context.route('**/*', lambda route: hosted_routes(route, fixture))
    if IN_MEMORY:
        await load_memory(page, fixture, hash, storage)
    else:
        if storage:
            await page.add_init_script('for (const [k,v] of Object.entries('+json.dumps(storage)+')) localStorage.setItem(k,v);')
        await page.goto(ORIGIN+'/'+hash)
    return context, page, fixture, errors

async def goto_hash(page, hash):
    await page.evaluate('(hash) => { location.hash = hash; }', hash)
    await page.wait_for_timeout(100)

async def save_result(name, coro):
    started=time.monotonic()
    try:
        await asyncio.wait_for(coro, timeout=24)
        result={'name':name,'status':'passed','seconds':round(time.monotonic()-started,2)}
    except Exception as error:
        result={'name':name,'status':'failed','error':str(error),'seconds':round(time.monotonic()-started,2)}
    RESULTS.append(result); OUT.mkdir(parents=True,exist_ok=True); (OUT/'browser-progress.json').write_text(json.dumps(RESULTS,indent=2)); print(result['status'].upper(),name, result.get('error','')[:250],flush=True)

async def layout_case(browser, width):
    ctx, page, fix, errors = await new_page(browser, '#for-you', width=width, height=900)
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth'), f'Horizontal overflow at {width}px'
        assert await page.locator('#viewTitle').inner_text() == 'Picked for you'
        if width in [390, 1440]: await page.screenshot(path=str(OUT / f'personal-picks-{width}.png'))
        await page.get_by_role('button', name='Settings and backups').click()
        await expect(page.locator('#settingsModal')).to_be_visible()
        bounds = await page.locator('#settingsModal').bounding_box()
        assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width + 1
        await page.keyboard.press('Escape')
        await expect(page.locator('#settingsModal')).not_to_be_visible()
        assert not errors, errors
    finally: await ctx.close()

async def discovery_case(browser):
    ctx, page, fix, errors = await new_page(browser)
    try:
        await expect(page.locator('.movie-card')).to_have_count(20)
        await page.locator('.provider-row').first.scroll_into_view_if_needed()
        await expect(page.locator('.provider-row').first).to_contain_text('Yle Areena')
        await page.screenshot(path=str(OUT / 'discovery-desktop-fixtures.png'))
        await page.get_by_role('button', name='TV SHOWS', exact=True).click()
        await expect(page.locator('.movie-card').first).to_contain_text('Fixture Series')
        await page.get_by_label('Sort discoveries').select_option('newest')
        await expect(page.locator('#loader')).not_to_be_visible()
        urls = [u for u in fix.requests if '/discover/tv' in u]
        assert any('sort_by=first_air_date.desc' in u and 'first_air_date.lte' in u and 'primary_release_date' not in u for u in urls)
        assert not errors, errors
    finally: await ctx.close()

async def paging_case(browser):
    ctx, page, fix, errors = await new_page(browser)
    try:
        await expect(page.locator('.movie-card')).to_have_count(20)
        fix.fail_pages.add(2)
        await page.get_by_role('button', name='Load more', exact=True).click()
        await expect(page.locator('#viewNotice')).to_contain_text('retries the same page')
        await expect(page.locator('.movie-card')).to_have_count(20)
        fix.fail_pages.clear()
        await page.locator('#loadMoreButton').evaluate('(b) => { b.click(); b.click(); }')
        await expect(page.locator('.movie-card')).to_have_count(40)
        await page.get_by_role('button', name='Load more', exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(60)
        await expect(page.locator('#loadMoreContainer')).not_to_be_visible()
        urls=[parse_qs(urlsplit(u).query).get('page',['1'])[0] for u in fix.requests if '/discover/movie' in u]
        assert urls == ['1','2','2','3'], urls
        assert not errors, errors
    finally: await ctx.close()

async def local_paging_case(browser):
    ctx, page, fix, errors = await new_page(browser, '#for-you')
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        await expect(page.locator('#resultCount')).to_contain_text('of 210')
        await page.get_by_role('button', name='Load more', exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(48)
        await goto_hash(page, '#watchlist')
        await expect(page.locator('#resultCount')).to_contain_text('of 148')
        assert not errors, errors
    finally: await ctx.close()

async def saved_case(browser):
    ctx, page, fix, errors = await new_page(browser, '#watchlist')
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        await page.get_by_label('Filter personal collection').fill('Incendies')
        await expect(page.locator('.movie-card')).to_have_count(1)
        await page.get_by_role('button', name='Remove Incendies from watchlist',exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(0)
        raw = await page.evaluate(f'localStorage.getItem("{KEY}")')
        assert not errors, errors
    finally: await ctx.close()
    ctx, page, fix, errors = await new_page(browser, '#watchlist?q=Incendies', storage={KEY:raw})
    try:
        await expect(page.locator('.empty-state')).to_be_visible()
        assert await page.locator('.movie-card').count()==0
        assert not errors, errors
    finally: await ctx.close()

async def notes_case(browser):
    ctx, page, fix, errors = await new_page(browser, '#title/lb%3Aincendies%7C2010')
    try:
        await expect(page.locator('.personal-panel')).to_be_visible()
        notes = '<img src=x onerror="window.__xss=1"> O\'Brien\u2019s notes & "quotes"'
        await page.get_by_label('Personal notes').fill(notes)
        await page.get_by_label('Your rating',exact=True).select_option('4.5')
        await page.get_by_label('Watch priority').select_option('2')
        await page.get_by_role('button',name='Save changes',exact=True).click()
        await goto_hash(page,'#seen?q=Incendies')
        await expect(page.locator('.movie-card')).to_have_count(1)
        await expect(page.locator('.movie-card')).to_contain_text('Your 4.5 / 5')
        await page.get_by_role('link',name='Incendies',exact=True).click()
        await expect(page.get_by_label('Personal notes')).to_have_value(notes)
        assert await page.evaluate('window.__xss || null') is None
        assert not errors, errors
    finally: await ctx.close()

async def ids_case(browser):
    ctx, page, fix, errors = await new_page(browser, '#movie/9')
    try:
        await expect(page.locator('.personal-panel')).to_be_visible()
        await page.get_by_label('In my watchlist',exact=True).check()
        await page.get_by_role('button',name='Save changes',exact=True).click()
        await goto_hash(page,'#tv/9')
        await expect(page.locator('.personal-panel')).to_be_visible()
        await expect(page.get_by_label('In my watchlist',exact=True)).not_to_be_checked()
        await page.get_by_label('In my watchlist',exact=True).check()
        await page.get_by_role('button',name='Save changes',exact=True).click()
        await goto_hash(page,'#watchlist?q=Fixture')
        await expect(page.locator('.movie-card')).to_have_count(2)
        assert not errors, errors
    finally: await ctx.close()

async def navigation_case(browser):
    ctx, page, fix, errors = await new_page(browser)
    try:
        await expect(page.locator('.movie-card')).to_have_count(20)
        await page.get_by_role('button',name='Load more',exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(40)
        await page.get_by_role('link',name='Fixture Movie 1',exact=True).click()
        await page.get_by_role('link',name='Fixture Director',exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(2)
        await expect(page.locator('#viewTitle')).to_contain_text('directing')
        await expect(page.locator('.movie-card').nth(1)).to_contain_text('Fixture Series 801')
        await page.get_by_role('link',name='Fixture Series 801',exact=True).click()
        await expect(page.locator('.detail-info')).to_contain_text('TV series')
        await page.get_by_role('button',name='\u2190 Back',exact=True).click()
        await expect(page.locator('#viewTitle')).to_contain_text('directing')
        await page.get_by_role('button',name='\u2190 Back',exact=True).click()
        await expect(page.locator('.detail-info')).to_contain_text('Fixture Movie 1')
        await page.get_by_role('button',name='\u2190 Back',exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(40)
        assert not errors, errors
    finally: await ctx.close()

async def search_case(browser):
    ctx, page, fix, errors = await new_page(browser)
    try:
        await expect(page.locator('.movie-card')).to_have_count(20)
        await page.get_by_label('Search by title or name').fill('slow')
        await page.get_by_label('Search by title or name').press('Enter')
        await page.wait_for_timeout(30)
        query='O\'Brien "Cut" <script>window.__xss=1</script>'
        await page.get_by_label('Search by title or name').fill(query)
        await page.get_by_label('Search by title or name').press('Enter')
        await expect(page.locator('#viewTitle')).to_contain_text(query)
        await page.wait_for_timeout(500)
        await expect(page.locator('.movie-card')).to_have_count(1)
        await expect(page.locator('.movie-card')).to_contain_text(query)
        assert await page.evaluate('window.__xss || null') is None
        assert not errors, errors
    finally: await ctx.close()

async def autocomplete_case(browser):
    ctx, page, fix, errors = await new_page(browser)
    try:
        await expect(page.locator('.movie-card')).to_have_count(20)
        await page.get_by_label('Search type').select_option('director')
        await page.get_by_label('Search by title or name').fill('Fixture')
        await expect(page.locator('#suggestions')).to_be_visible()
        await expect(page.locator('#suggestions [role=option]')).to_have_count(1)
        await page.get_by_label('Search by title or name').press('ArrowDown')
        await page.get_by_label('Search by title or name').press('Enter')
        await expect(page.locator('#viewTitle')).to_contain_text('directing')
        assert any('/person/501/combined_credits' in x for x in fix.requests)
        assert not errors, errors
    finally: await ctx.close()

async def availability_case(browser):
    ctx, page, fix, errors = await new_page(browser)
    try:
        await expect(page.locator('.movie-card')).to_have_count(20)
        await page.get_by_role('button',name='Settings and backups').click()
        await page.get_by_label('Streaming only by default',exact=False).check()
        await page.get_by_role('button',name='Save settings',exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(20)
        await goto_hash(page,'#watchlist')
        await expect(page.locator('#resultCount')).to_contain_text('of 148')
        await page.get_by_role('button',name='Change streaming region').click()
        await page.get_by_label('Streaming region',exact=True).select_option('US')
        await page.get_by_role('button',name='Save settings',exact=True).click()
        await expect(page.locator('#regionDisplay')).to_have_text('US')
        await goto_hash(page,'#discover')
        await expect(page.locator('.movie-card')).to_have_count(20)
        await page.locator('.provider-row').first.scroll_into_view_if_needed()
        await expect(page.locator('.provider-row').first).to_contain_text('Netflix')
        assert any('watch_region=US' in u for u in fix.requests if '/discover/movie' in u)
        assert not errors, errors
    finally: await ctx.close()

async def trailer_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#movie/9')
    try:
        await page.get_by_role('button',name='\u25b7 Watch trailer',exact=True).click()
        await expect(page.get_by_role('link',name='Search trailers on YouTube',exact=False)).to_be_visible()
        await page.keyboard.press('Escape')
        fix.trailer_valid=True
        await goto_hash(page,'#movie/10')
        await page.get_by_role('button',name='\u25b7 Watch trailer',exact=True).click()
        await expect(page.locator('#videoContainer iframe')).to_have_attribute('src','https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0')
        await page.keyboard.press('Escape')
        await expect(page.locator('#videoContainer iframe')).to_have_count(0)
        assert not errors, errors
    finally: await ctx.close()

async def resolver_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#title/lb%3Aincendies%7C2010')
    try:
        await page.get_by_role('button',name='Find on TMDB',exact=True).click()
        await expect(page.locator('.detail-info')).to_contain_text('Incendies')
        await expect(page.locator('.detail-watch')).to_contain_text('Yle Areena')
        await expect(page.get_by_label('In my watchlist',exact=True)).to_be_checked()
        await goto_hash(page,'#title/lb%3Amonster%7C2023')
        await page.get_by_role('button',name='Find on TMDB',exact=True).click()
        await expect(page.locator('#actionBody .candidate')).to_have_count(2)
        await expect(page.locator('#actionBody')).to_contain_text('More than one exact match')
        raw=json.loads(await page.evaluate(f'localStorage.getItem("{KEY}")'))
        assert not any(x['key']=='lb:monster|2023' for x in raw['entries'])
        assert not errors, errors
    finally: await ctx.close()

async def enrichment_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#for-you')
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        await page.get_by_role('button',name='Load posters',exact=True).click()
        await expect(page.locator('#viewNotice')).to_contain_text('24 titles matched')
        assert len([u for u in fix.requests if '/search/multi' in u])==24
        await expect(page.locator('.movie-card')).to_have_count(24)
        assert not errors, errors
    finally: await ctx.close()

async def picker_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#watchlist?q=Incendies')
    try:
        await expect(page.locator('.movie-card')).to_have_count(1)
        await page.get_by_role('button',name='Pick one',exact=False).click()
        await expect(page.locator('#actionBody')).to_contain_text('Incendies')
        await expect(page.get_by_role('button',name='Pick another',exact=True)).to_be_disabled()
        await expect(page.locator('.pick-counter')).to_contain_text('1 of 1')
        assert not errors, errors
    finally: await ctx.close()

async def corrupt_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#watchlist',storage={KEY:'{broken'})
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        await expect(page.locator('#storageWarning')).to_contain_text('original storage was left untouched')
        assert await page.evaluate(f'localStorage.getItem("{KEY}")')=='{broken'
        assert not errors, errors
    finally: await ctx.close()

async def network_case(browser):
    f=Fixture();f.all_fail=True
    ctx, page, fix, errors = await new_page(browser,fixture=f)
    try:
        await expect(page.locator('.error-state')).to_be_visible()
        await page.get_by_role('link',name='Browse your imported picks',exact=True).click()
        await expect(page.locator('.movie-card')).to_have_count(24)
        assert not errors, errors
    finally: await ctx.close()

async def backup_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#watchlist')
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        await page.get_by_role('button',name='Settings and backups').click()
        before=await page.evaluate(f'localStorage.getItem("{KEY}")')
        await page.locator('#backupFile').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{bad'})
        await expect(page.locator('#backupStatus')).to_contain_text('not valid JSON')
        assert await page.evaluate(f'localStorage.getItem("{KEY}")')==before
        incoming=json.loads(before);incoming['changes']=[{'key':'lb:incendies|2010','saved':False,'updatedAt':1}]
        await page.locator('#backupFile').set_input_files({'name':'valid.json','mimeType':'application/json','buffer':json.dumps(incoming).encode()})
        await expect(page.locator('#actionModal')).to_be_visible()
        assert await page.evaluate(f'localStorage.getItem("{KEY}")')==before
        await page.get_by_role('button',name='Merge this backup',exact=True).click()
        await expect(page.locator('#resultCount')).to_contain_text('of 147')
        await page.get_by_role('button',name='Settings and backups').click()
        async with page.expect_download() as download_info:
            await page.get_by_role('button',name='Export backup',exact=True).click()
        download=await download_info.value
        dest=OUT/'round-trip-backup.json';await download.save_as(str(dest))
        assert json.loads(dest.read_text())['version']==3
        assert not errors, errors
    finally: await ctx.close()

async def keyboard_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#watchlist',width=390)
    try:
        await expect(page.locator('.movie-card')).to_have_count(24)
        await page.keyboard.press('/')
        await expect(page.locator('#movieInput')).to_be_focused()
        await page.get_by_role('button',name='Settings and backups').click()
        for _ in range(14):
            await page.keyboard.press('Tab')
            assert await page.evaluate('!!document.activeElement.closest("#settingsModal")')
        await page.keyboard.press('Escape')
        await expect(page.get_by_role('button',name='Settings and backups')).to_be_focused()
        assert not errors, errors
    finally: await ctx.close()

async def storage_event_case(browser):
    ctx, page, fix, errors = await new_page(browser,'#watchlist')
    try:
        await expect(page.locator('#resultCount')).to_contain_text('of 148')
        await page.evaluate("""(key) => {
          const value=JSON.parse(localStorage.getItem(key));
          value.changes=[{key:'lb:incendies|2010',saved:false,updatedAt:Date.now()}];
          window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(value)}));
        }""",KEY)
        await expect(page.locator('#resultCount')).to_contain_text('of 147')
        assert not errors, errors
    finally: await ctx.close()

async def main(args):
    global IN_MEMORY
    IN_MEMORY=args.in_memory;OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        launch={'headless':True}
        if args.chromium: launch['executable_path']=args.chromium
        elif Path('/usr/bin/chromium').exists(): launch['executable_path']='/usr/bin/chromium'
        browser=await p.chromium.launch(**launch)
        for width in [320,375,390,768,1024,1440]:
            await save_result(f'responsive layout and dialog bounds at {width}px',layout_case(browser,width))
        for name, fn in [
            ('movie/TV discovery and TV-specific sorting',discovery_case),
            ('failed pagination retries the same page and stops at the end',paging_case),
            ('personal recommendations and watchlist pagination',local_paging_case),
            ('removed seeded entry survives store reinitialization',saved_case),
            ('notes, half-star rating, watched status, and HTML escaping',notes_case),
            ('movie and TV with same ID save independently',ids_case),
            ('details / director / TV navigation restores 40 loaded results',navigation_case),
            ('latest search wins; quotes and markup remain text',search_case),
            ('keyboard autocomplete opens the exact director ID',autocomplete_case),
            ('free/ads listings, watchlist visibility, and region change',availability_case),
            ('trailer fallback and iframe removal on Escape',trailer_case),
            ('exact imported-title linking and ambiguous-edition review',resolver_case),
            ('metadata enrichment is limited to the 24 displayed titles',enrichment_case),
            ('picker respects the current filter and no-repeat limit',picker_case),
            ('corrupt browser data remains untouched',corrupt_case),
            ('API failure has a working personal-library escape route',network_case),
            ('backup validation, explicit merge confirmation, and export',backup_case),
            ('keyboard search shortcut, modal focus trap and restoration',keyboard_case),
            ('cross-tab storage event updates the local view',storage_event_case),
        ]:
            await save_result(name,fn(browser))
        await browser.close()
    report={'mode':'in-memory ES module UI harness' if IN_MEMORY else 'HTTP browser integration with mocked API',
            'browser':'Chromium','results':RESULTS,'passed':sum(r['status']=='passed' for r in RESULTS),'failed':sum(r['status']=='failed' for r in RESULTS)}
    (OUT/'browser-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:report[k] for k in ['mode','passed','failed']}),flush=True)
    return report['failed']

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--in-memory',action='store_true');parser.add_argument('--chromium',default=None)
    raise SystemExit(asyncio.run(main(parser.parse_args())))
