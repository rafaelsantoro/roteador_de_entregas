/* --- INICIALIZAÇÃO E GERENCIAMENTO DE ESTADO --- */

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (err) {}
    }
}

function setupEvents() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-indigo-500'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-indigo-500'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-indigo-500');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    document.getElementById('start-point-select').addEventListener('change', saveStateToLocalStorage);
    document.getElementById('prioritize-same-street').addEventListener('change', saveStateToLocalStorage);

    document.getElementById('btn-optimize').addEventListener('click', optimizeAndDrawRoute);
    document.getElementById('btn-export-gpx').addEventListener('click', exportToGPX);
    document.getElementById('btn-export').addEventListener('click', exportToXLSX);
}

function setupDeviceOrientation() {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {}
}

function saveStateToLocalStorage() {
    if (!activePoints || activePoints.length === 0) return;

    const state = {
        rawData: rawData,
        activePoints: activePoints,
        startIdx: document.getElementById('start-point-select').value,
        prioritizeSameStreet: document.getElementById('prioritize-same-street').checked,
        routeGeometry: currentRouteGeometry,
        routeDistanceKm: currentRouteDistanceKm
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
        const state = JSON.parse(saved);
        if (!state.rawData || state.rawData.length === 0) return;

        rawData = state.rawData || [];
        activePoints = state.activePoints || [];
        currentRouteGeometry = state.routeGeometry || null;
        currentRouteDistanceKm = state.routeDistanceKm || '0';

        populateSelect(rawData);

        if (state.startIdx !== undefined) {
            document.getElementById('start-point-select').value = state.startIdx;
        }

        if (state.prioritizeSameStreet !== undefined) {
            document.getElementById('prioritize-same-street').checked = !!state.prioritizeSameStreet;
        }

        document.getElementById('start-point-select').disabled = false;
        document.getElementById('btn-optimize').disabled = false;
        document.getElementById('btn-export-gpx').disabled = false;
        document.getElementById('btn-export').disabled = false;

        if (currentRouteGeometry && activePoints.length > 0) {
            document.getElementById('btn-qrcode-scan').disabled = false;
        }

        renderMapAndUI(activePoints, false);
        updateFileSummaryUI(rawData);

        if (activePoints.length > 0) {
            updateRouteOnMap();
            document.getElementById('dist-badge').classList.remove('hidden');
            document.getElementById('dist-text').textContent = `${currentRouteDistanceKm} km`;
        }
    } catch (e) {
        console.error("Erro local storage:", e);
        localStorage.removeItem(STORAGE_KEY);
    }
}

// Event Listeners Globais de Inicialização
document.addEventListener('click', enableAutoFullscreen, { once: true });
document.addEventListener('touchstart', enableAutoFullscreen, { once: true });

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

document.addEventListener('fullscreenchange', () => {
    const icon = document.getElementById('fullscreen-icon');
    if (icon) {
        icon.className = document.fullscreenElement ? "fa-solid fa-compress" : "fa-solid fa-expand";
    }
});

document.addEventListener('DOMContentLoaded', () => {
    checkInternetConnection();
    window.addEventListener('online', checkInternetConnection);
    window.addEventListener('offline', checkInternetConnection);

    if (window.location.protocol === 'file:') {
        const warnBox = document.getElementById('file-protocol-warning');
        if (warnBox) warnBox.classList.remove('hidden');
    }

map = new maplibregl.Map({
        container: 'map',
        maxZoom: 20,
        style: {
            version: 8,
            sources: {
                'osm-tiles': {
                    type: 'raster',
                    tiles: [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    tileSize: 128,
                    maxnativezoom: 18, // Ajustado para o limite da escala de 128px
                    attribution: '&copy; OpenStreetMap contributors'
                }
            },
            layers: [
                {
                    id: 'osm-tiles-layer',
                    type: 'raster',
                    source: 'osm-tiles',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        },
        pixelRatio: window.devicePixelRatio || 2,
        center: [-48.91, -23.10],
        zoom: 16
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('style.load', () => {
        isTextBoosted = false;
        try {
            boostMapTextLabels();
        } catch(e) {}
        updateRouteOnMap();
    });

    map.on('load', () => {
        loadStateFromLocalStorage();
    });

    setupEvents();
    setupDeviceOrientation();
    requestWakeLock();
});

// Registro do Service Worker
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado com sucesso!'))
            .catch(err => console.error('Erro ao registrar Service Worker:', err));
    });
}
