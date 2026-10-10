const CACHE_NAME = 'roteador-entregas-v1';

// Lista de arquivos para salvar no celular
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './lib/tailwindcss.js',
  './lib/maplibre-gl.css',
  './lib/maplibre-gl.js',
  './lib/xlsx.full.min.js',
  './lib/fontawesome/all.min.css'
];

// Instalação do Service Worker e gravação do cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercepta as requisições: se estiver offline, busca no cache local
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});