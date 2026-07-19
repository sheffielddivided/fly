// Cloudflare Worker — OpenF1 CORS proxy + edge cache for f1.html
// Deploy på: https://dash.cloudflare.com → Workers & Pages → Create Worker
//
// Edge-cachen er nøkkelen: OpenF1 rate-limiter (429) når mange forespørsler
// kommer raskt. Ved å cache svarene på Cloudflares kant treffer gjentatte
// kall (auto-oppdatering, retries, flere brukere) cachen i stedet for OpenF1.
//
// OpenF1 blokkerer anonym tilgang (401) mens en live-økt pågår. Har du en
// API-nøkkel (https://openf1.org), legg den inn som en hemmelighet i Workeren:
//   Worker → Settings → Variables → Add secret → navn: OPENF1_KEY
// Da sender Workeren nøkkelen med hvert kall og live-blokkeringen forsvinner.
// Uten nøkkel fungerer alt som før (utenom under live-økter).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Cache-nøkkel basert kun på URL (OpenF1 er GET-only).
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });

    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const target = 'https://api.openf1.org' + url.pathname + url.search;
    const headers = { 'User-Agent': 'F1-App/1.0' };
    if (env && env.OPENF1_KEY) headers['Authorization'] = `Bearer ${env.OPENF1_KEY}`;
    const upstream = await fetch(target, { headers });

    const response = new Response(upstream.body, upstream);
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.delete('Content-Security-Policy');

    // Cache vellykkede svar OG 404 (avlyste løp / manglende resultater), slik
    // at gjentatte kall ikke treffer OpenF1 på nytt. "latest"-spørringer endrer
    // seg i løpet av en løpshelg → kort TTL; historiske resultater er
    // uforanderlige → en time; 404 caches kort i tilfelle data kommer senere.
    if (upstream.ok || upstream.status === 404) {
      const ttl = upstream.status === 404 ? 300
                : url.search.includes('latest') ? 30
                : 3600;
      response.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};
