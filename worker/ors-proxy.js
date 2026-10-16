/* Proxy gratuito (Cloudflare Workers) para esconder a chave do OpenRouteService.
   A chave fica guardada no servidor da Cloudflare; o app só conhece o endereço do proxy.

   Como publicar (5 minutos, plano gratuito):
   1. Crie uma conta em https://dash.cloudflare.com  ->  Workers & Pages  ->  Create  ->  Worker.
   2. Cole este arquivo inteiro no editor do Worker e clique em Deploy.
   3. Em Settings -> Variables and Secrets, crie:
        ORS_KEY         (tipo Secret)  = sua chave do OpenRouteService
        ALLOWED_ORIGIN  (texto)        = https://SEU-USUARIO.github.io   (pode listar vários, separados por vírgula)
   4. Copie o endereço do Worker (ex.: https://ors-proxy.seu-nome.workers.dev) e cole em
      ORS_PROXY_URL no js/config.js do app. Depois disso a chave pode sair do aparelho e do GitHub.
   5. Revogue a chave antiga no painel do OpenRouteService (ela já esteve pública no repositório). */

const ALLOWED_PATHS = new Set([
  '/v2/directions/driving-car/geojson',
  '/v2/matrix/driving-car'
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);

    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!originOk) return new Response('Origem não autorizada', { status: 403, headers: cors });
    if (request.method !== 'POST') return new Response('Método não permitido', { status: 405, headers: cors });

    const path = new URL(request.url).pathname;
    if (!ALLOWED_PATHS.has(path)) return new Response('Caminho não permitido', { status: 404, headers: cors });

    const body = await request.text();
    if (body.length > 200000) return new Response('Pedido muito grande', { status: 413, headers: cors });

    const upstream = await fetch('https://api.openrouteservice.org' + path, {
      method: 'POST',
      headers: { 'Authorization': env.ORS_KEY, 'Content-Type': 'application/json' },
      body
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' }
    });
  }
};
