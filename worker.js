// Cloudflare Worker — OpenF1 CORS proxy for f1.html
// Deploy på: https://dash.cloudflare.com → Workers & Pages → Create Worker

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const target = 'https://api.openf1.org' + url.pathname + url.search;

    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'F1-App/1.0' },
    });

    const response = new Response(upstream.body, upstream);
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.delete('Content-Security-Policy');
    return response;
  },
};
