// Constantes de configuração e APIs
const CARTO_API_KEY = 'cb1_4b9r_1_b3f372a90351c2d3b18c8639';
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImIwNzE4MDA5ZDMzMTRhM2RiZjNjY2EyYTQ2ZDFhZWM2IiwiaCI6Im11cm11cjY0In0=';
const STORAGE_KEY = 'delivery_router_saved_state';

// URLs de estilos e tiles do CARTO
//const CARTO_RASTER_URL = `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`;
const CARTO_RASTER_URL = `https://tile.openstreetmap.org/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`;
const LIGHT_THEME_URL = `https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json?key=${CARTO_API_KEY}`;

// --- Provedores de rota e limites (pensado para gastar pouca internet) ---
const ROUTING_PROVIDERS = ['osrm', 'ors'];      // ordem de tentativa: OSRM público primeiro, ORS como reserva
const OSRM_BASE = 'https://router.project-osrm.org';
const ORS_BASE = 'https://api.openrouteservice.org';
const OSRM_MAX_COORDS = 100;        // máx. de pontos por pedido de matriz
const MATRIX_BLOCK = 50;            // tamanho dos blocos quando há mais de 100 pontos
const ROUTE_CHUNK_WAYPOINTS = 60;   // paradas por pedido de traçado de ruas
const NET_MIN_GAP_MS = 350;         // intervalo mínimo entre requisições
const NAV_MIN_INTERVAL_MS = 20000;  // navegação: no máximo 1 consulta nova a cada 20 s
const NAV_OFFROUTE_METERS = 70;     // só considera "fora da rota" acima disso
const NAV_ARRIVED_METERS = 60;      // perto do destino: nunca recalcula
const SAME_LOCATION_METERS = 15;    // pacotes a menos disso viram uma única parada
const SAME_STREET_PENALTY_SEC = 120;// custo (em segundos) de sair de uma rua antes de terminá-la
const DETOUR_FACTOR = 1.4;          // estimativa sem internet: linha reta x 1,4
const AVG_SPEED_KMH = 15;           // estimativa sem internet: velocidade média urbana

// Pontos Fixos
const FIXED_HOME = { lat: -23.086416, lng: -48.918759 };
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

// GPS e Pesquisa
let gpsWatchId = null;
let driverMarker = null;
let searchMarker = null;

// Leitor QR Code
let html5QrCode = null;
let isQrCooldown = false;

// Estado do Mapa
let isTextBoosted = false;
