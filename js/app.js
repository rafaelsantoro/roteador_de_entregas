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

    initLocalSettingsUI();
}

/* --- CONFIGURAÇÕES DO APARELHO (chave de API e Casa ficam só no localStorage, fora do GitHub) --- */

function initLocalSettingsUI() {
    const s = loadLocalSettings();
    const keyEl = document.getElementById('setting-ors-key');
    const homeEl = document.getElementById('setting-home');
    if (keyEl) keyEl.value = s.orsKey || '';
    if (homeEl && s.home) homeEl.value = `${s.home.lat}, ${s.home.lng}`;

    const st = document.getElementById('setting-status');
    if (st) {
        const orsTxt = ORS_PROXY_URL ? 'ORS via proxy' : (getOrsKey() ? 'chave ORS salva no aparelho' : 'sem chave ORS (usando só OSRM)');
        const homeTxt = (s.home && isFinite(s.home.lat)) ? 'Casa definida no aparelho' : 'Casa padrão do config.js';
        st.textContent = `${orsTxt} · ${homeTxt}`;
    }
}

async function saveLocalSettingsFromUI() {
    const key = (document.getElementById('setting-ors-key').value || '').trim();
    const homeTxt = (document.getElementById('setting-home').value || '').trim();
    const patch = { orsKey: key, home: null };

    if (homeTxt) {
        const parts = homeTxt.replace(/;/g, ',').split(/[,\s]+/).filter(Boolean);
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (parts.length < 2 || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            await customAlert('Casa: informe "latitude, longitude" com ponto decimal (ex.: -23.0864, -48.9187).');
            return;
        }
        patch.home = { lat, lng };
    }

    saveLocalSettings(patch);
    if (document.fullscreenElement) {
        sessionStorage.setItem('restore_fullscreen', 'true');
    }
    await customAlert('Configurações salvas neste aparelho. O app será recarregado para aplicar.');
    location.reload();
}

async function clearLocalData() {
    if (!await customConfirm('Apagar deste aparelho a planilha, a rota salva e os trechos de rua baixados?\n\nA chave de API e a Casa (configurações) serão mantidas.')) return;
    localStorage.removeItem(STORAGE_KEY);
    await Store.clearPrefix('leg:');
    await Store.clearPrefix('mx:');
    if (document.fullscreenElement) {
        sessionStorage.setItem('restore_fullscreen', 'true');
    }
    location.reload();
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
        optimized: routeIsOptimized,
        routeDistanceKm: currentRouteDistanceKm
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Não foi possível salvar o estado local:', e);
    }
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
        const state = JSON.parse(saved);
        if (!state.rawData || state.rawData.length === 0) return;

        rawData = state.rawData || [];
        activePoints = state.activePoints || [];
        routeIsOptimized = !!state.optimized || !!state.routeGeometry;
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

        if (routeIsOptimized && activePoints.length > 0) {
            document.getElementById('btn-qrcode-scan').disabled = false;
        }

        renderMapAndUI(activePoints, false);
        updateFileSummaryUI(rawData);

        if (activePoints.length > 0) {
            updateRouteOnMap();
            restorePlannedRoute();
            updateRouteSummaryUI();
        }
    } catch (e) {
        console.error("Erro local storage:", e);
        localStorage.removeItem(STORAGE_KEY);
    }
}

// Event Listeners Globais de Inicialização (Sem 'once: true' para reativar tela cheia a cada toque se o usuário desejar)
document.addEventListener('click', enableAutoFullscreen);
document.addEventListener('touchstart', enableAutoFullscreen);

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

document.addEventListener('fullscreenchange', () => {
    const icon = document.getElementById('fullscreen-icon');
    if (document.fullscreenElement) {
        userWantsFullscreen = true;
        if (icon) icon.className = "fa-solid fa-compress";
    } else {
        if (icon) icon.className = "fa-solid fa-expand";
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('restore_fullscreen') === 'true') {
        userWantsFullscreen = true;
        sessionStorage.removeItem('restore_fullscreen');
    }

    checkInternetConnection();
    window.addEventListener('online', checkInternetConnection);
    window.addEventListener('offline', checkInternetConnection);
    window.addEventListener('online', () => setTimeout(() => retryMissingLegs(false), 2500));

    if (window.location.protocol === 'file:') {
        const warnBox = document.getElementById('file-protocol-warning');
        if (warnBox) warnBox.classList.remove('hidden');
    }

	map = new maplibregl.Map({
		container: 'map',
		fadeDuration: 0, // Desativa o tempo global de transição da renderização
		maxZoom: 20,
		style: {
			version: 8,
			sources: {
				'carto-tiles': {
					type: 'raster',
					tiles: [
						CARTO_RASTER_URL
					],
					tileSize: 256,
					maxzoom: 19,
					attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
				}
			},
			layers: [
				{
					id: 'carto-tiles-layer',
					type: 'raster',
					source: 'carto-tiles',
					minzoom: 0,
					maxzoom: 22,
					paint: {
						'raster-fade-duration': 0 // Elimina a transição gradual de 300ms nos tiles
					}
				}
			]
		},
		pixelRatio: window.devicePixelRatio || 2,
		center: [-48.91, -23.10],
		zoom: 16
	});

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    const pauseFollow = (ev) => { if (ev && ev.originalEvent) followPausedUntil = Date.now() + FOLLOW_PAUSE_MS; };
    map.on('dragstart', pauseFollow);
    map.on('zoomstart', pauseFollow);

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