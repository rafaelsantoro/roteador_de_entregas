// Constantes de configuração e APIs

/* --- CONFIGURAÇÕES LOCAIS (ficam SÓ neste aparelho, nunca no GitHub) ---
   A chave do OpenRouteService e as coordenadas de "Casa" são digitadas no menu do app
   (seção "Configurações do aparelho") e guardadas no localStorage do celular. */
const LOCAL_SETTINGS_KEY = 'delivery_router_local_settings';

function loadLocalSettings() {
    try { return JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) || {}; } catch (e) { return {}; }
}

function saveLocalSettings(patch) {
    const next = { ...loadLocalSettings(), ...patch };
    try { localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
}

function getOrsKey() {
    return String(loadLocalSettings().orsKey || '').trim();
}

// Opcional (mais seguro): endereço de um proxy (ex.: Cloudflare Worker) que guarda a chave no servidor.
// Se preencher, a chave não precisa existir no aparelho. Veja worker/ors-proxy.js
const ORS_PROXY_URL = 'https://ree.rafaelsantoro.workers.dev/';

const STORAGE_KEY = 'delivery_router_saved_state';

// Mapa base (OpenStreetMap). Nenhuma chave é necessária.
// const CARTO_RASTER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Chave da API CARTO
const CARTO_KEY = 'cb1_4b9r_1_b3f372a90351c2d3b18c8639';

// Endpoint oficial dos tiles da CARTO com a chave inclusa
const CARTO_RASTER_URL = `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?api_key=${CARTO_KEY}`;

// --- Provedores de rota e limites (pensado para gastar pouca internet) ---
const ROUTING_PROVIDERS = ['osrm', 'ors'];      // ordem de tentativa: OSRM público primeiro, ORS como reserva
const OSRM_BASE = 'https://router.project-osrm.org';
const ORS_BASE = 'https://api.openrouteservice.org';
const OSRM_MAX_COORDS = 100;        // máx. de pontos por pedido de matriz
const MATRIX_BLOCK = 50;            // tamanho dos blocos quando há mais de 100 pontos
const ROUTE_CHUNK_WAYPOINTS = 60;   // paradas por pedido de traçado de ruas
const NET_MIN_GAP_MS = 350;         // intervalo mínimo entre requisições
const NAV_REROUTE_MIN_MS = 4000;    // ao sair da rota: recalcula, no máximo 1x a cada 4 s
const NAV_REROUTE_MAX_BACKOFF_MS = 60000; // se a consulta falhar, espera mais (8 s, 16 s, 32 s, até 60 s)
const NAV_OFFROUTE_METERS = 50;     // "fora da rota" = mais que isso da linha planejada
const NAV_OFFROUTE_FAR_METERS = 120;// muito longe da rota: recalcula já no 1º sinal de GPS
const FOLLOW_PAUSE_MS = 10000;      // câmera para de seguir o GPS por 10 s (busca de endereço / arrastar o mapa)
const DELIVERY_MIN_PER_PACKAGE = 1; // minutos gastos por pacote (para o tempo estimado do dia)
const NAV_ARRIVED_METERS = 60;      // perto do destino: nunca recalcula
const SAME_LOCATION_METERS = 15;    // pacotes a menos disso viram uma única parada
const SAME_STREET_PENALTY_SEC = 120;// custo (em segundos) de sair de uma rua antes de terminá-la
const DETOUR_FACTOR = 1.4;          // estimativa sem internet: linha reta x 1,4
const AVG_SPEED_KMH = 15;           // estimativa sem internet: velocidade média urbana

// Pontos Fixos
// Dica de privacidade: depois de digitar a "Casa" no menu do app, troque estas coordenadas por
// as da PK2U (ou outro ponto qualquer) para não deixar o endereço da sua casa público no GitHub.
const DEFAULT_HOME = { lat: -23.086416, lng: -48.918759 };
const FIXED_HOME = (() => {
    const h = loadLocalSettings().home;
    return (h && isFinite(h.lat) && isFinite(h.lng)) ? { lat: Number(h.lat), lng: Number(h.lng) } : DEFAULT_HOME;
})();
const FIXED_PK2U = { lat: -23.166412, lng: -48.952036 };

// Estado Global da Aplicação
let rawData = [];
let activePoints = [];
let map;
let markersMap = new Map();
let currentRouteGeometry = null;
let fullNavRouteGeometry = null;
let currentRouteDistanceKm = '0';

// Rota planejada (trechos entre entregas, guardados no aparelho)
let plannedLegGeoms = [];       // plannedLegGeoms[k] = trecho da entrega k -> k+1 (null = ainda não baixado)
let plannedGapSegments = [];    // trechos pendentes (desenhados tracejados, nunca como rota real)
let routeLegsStatus = { total: 0, ready: 0 };
let routeIsOptimized = false;   // true depois de "Otimizar Rota": a numeração dos pacotes passa a valer
let lastSolveInfo = null;

// Modo Navegação, Bússola e 3D
let isNavMode = false;
let is3DMode = false;
let isCustomSearchNav = false;
let isFallbackOrigin = false; // Identifica se a rota foi gerada com ponto de origem temporário
let currentNavIndex = -1;
let smoothedHeading = 0;
let lastGpsCoords = null;
let deviceAlphaHeading = null;
let lastRecalcTime = 0;
let wakeLock = null;

// Guia de navegação (veículo -> próxima entrega); nunca sobrescreve a rota planejada
let navGuideIsStraight = false; // true = linha reta tracejada (sem rota disponível)
let navFailCount = 0;
let navBlockedUntil = 0;
let navOffCount = 0;            // sinais de GPS seguidos fora da rota
let lastGpsSpeed = null;        // m/s (quando o aparelho informa)
let followPausedUntil = 0;      // a câmera não segue o GPS antes deste instante
let suppressFitUntil = 0;       // não reenquadra o mapa nas entregas antes deste instante

// GPS e Pesquisa
let gpsWatchId = null;
let driverMarker = null;
let searchMarker = null;

// Leitor QR Code
let html5QrCode = null;
let isQrCooldown = false;

// Estado do Mapa
let isTextBoosted = false;
