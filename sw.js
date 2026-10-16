// Para publicar uma nova versão do app: aumente este número (v3, v4...)
const CACHE_NAME = 'roteador-entregas-v3';
const TILE_CACHE_NAME = 'map-tiles-cache';

// Todos os arquivos do app: depois da 1ª abertura com internet, ele abre 100% offline
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.jpg',
  './icon-192.png',
  './icon-512.jpg',
  './favicon.ico',
  './css/styles.css',
  './js/config.js',
  './js/store.js',
  './js/ui.js',
  './js/net.js',
  './js/solver.js',
  './js/map.js',
  './js/router.js',
  './js/qr-scanner.js',
  './js/app.js',
  './lib/tailwindcss.js',
  './lib/maplibre-gl.css',
  './lib/maplibre-gl.js',
  './lib/xlsx.full.min.js',
  './lib/html5-qrcode.min.js',
  './lib/fontawesome/all.min.css',
  './lib/webfonts/fa-solid-900.woff2',
  './lib/webfonts/fa-regular-400.woff2',
  './lib/webfonts/fa-brands-400.woff2',
  './lib/webfonts/fa-v4compatibility.woff2'
];

// Instalação: salva cada arquivo separadamente (um arquivo ausente não derruba os outros)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS_TO_CACHE.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

// Ativação: apaga versões antigas do app (preserva o cache de mapas)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) return caches.delete(key);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

// 1. Tiles do mapa (CARTO / OSM): usa o que está salvo; o que for visto online fica salvo
if (url.hostname.includes('cartocdn.com') || url.hostname.includes('tile.openstreetmap.org')) {
  event.respondWith(
    caches.open(TILE_CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const net = await fetch(req);
        if (net && net.status === 200) {
          try { await cache.put(req, net.clone()); } catch (e) {}
        }
        return net;
      } catch (e) {
        // Retorna 404 em vez de lançar exceção de rede
        return new Response('', { status: 404, statusText: 'Tile offline indisponível' });
      }
    })
  );
  return;
}

  // 2. Arquivos do próprio app: abre na hora pelo cache e atualiza em segundo plano quando há internet
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true });

        const refresh = fetch(req, { cache: 'no-cache' })
          .then((net) => {
            if (net && net.status === 200) cache.put(req, net.clone());
            return net;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        const net = await refresh;
        if (net) return net;
        if (req.mode === 'navigate') {
          const home = await cache.match('./index.html');
          if (home) return home;
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      })
    );
  }
  // 3. Qualquer outro endereço (OSRM, ORS, etc.): não interfere
});
