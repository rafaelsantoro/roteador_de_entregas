// Constantes de configuração e APIs
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImIwNzE4MDA5ZDMzMTRhM2RiZjNjY2EyYTQ2ZDFhZWM2IiwiaCI6Im11cm11cjY0In0=';
const STORAGE_KEY = 'delivery_router_saved_state';
const LIGHT_THEME_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// Pontos Fixos
const FIXED_HOME = { lat: -23.086416, lng: -48.918759 };
const FIXED_PK2U = { lat: -23.166412, lng: -48.952036 };

// Estado Global da Aplicação
let rawData = [];
let activePoints = [];
let map;
let markersMap = new Map();
let currentRouteGeometry = null;
let currentRouteDistanceKm = '0';

// Modo Navegação, Bússola e 3D
let isNavMode = false;
let is3DMode = false;
let isCustomSearchNav = false;
let currentNavIndex = -1;
let smoothedHeading = 0;
let lastGpsCoords = null;
let deviceAlphaHeading = null;
let lastRecalcTime = 0;
let wakeLock = null;

// GPS e Pesquisa
let gpsWatchId = null;
let driverMarker = null;
let searchMarker = null;

// Leitor QR Code
let html5QrCode = null;
let isQrCooldown = false;

// Estado do Mapa
let isTextBoosted = false;
