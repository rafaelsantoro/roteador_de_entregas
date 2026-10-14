const CACHE_NAME = 'roteador-entregas-v1';
const TILE_CACHE_NAME = 'map-tiles-cache';

// Lista de arquivos para salvar no celular (App Shell)
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './lib/tailwindcss.js',
  './lib/maplibre-gl.css',
  './lib/maplibre-gl.js',
  './lib/xlsx.full.min.js',
  './lib/fontawesome/all.min.css'
];

// Instalação do Service Worker e gravação do cache inicial
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches antigos (preservando o cache de tiles)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptação das requisições
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. Interceptação de Tiles do OpenStreetMap (Grava automaticamente qualquer rota/rua percorrida)
  if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse; // Retorna do cache local se já tiver sido percorrido ou baixado antes
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone()); // Salva automaticamente a imagem do novo trecho percorrido
          }
          return networkResponse;
        } catch (error) {
          // Se estiver offline e o tile nunca tiver sido visto, evita erros de rede no console
          return new Response('', { status: 408, statusText: 'Tile offline indisponível' });
        }
      })
    );
    return;
  }

  // 2. Estratégia Padrão (Cache-First) para os restantes arquivos da aplicação (HTML, CSS, JS)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
