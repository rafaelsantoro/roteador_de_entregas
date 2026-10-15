/* --- MANIPULAÇÃO DO MAPA, GPS, NAVEGAÇÃO 3D E BUSCA COM RECALCULO AUTOMÁTICO --- */

let navAnimFrame = null;
let visualPos = null;
let visualHeading = 0;
let startPos = null;
let targetPos = null;
let startHeading = 0;
let targetHeading = 0;
let animStartTime = 0;
let animDuration = 1000;
let lastGpsTimestamp = 0;
let cachedCityState = null;

function boostMapTextLabels() {
    if (!map || isTextBoosted) return;
    const style = map.getStyle();
    if (!style || !style.layers) return;

    const scaleFactor = 1.65;

    style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
            try {
                const currentSize = map.getLayoutProperty(layer.id, 'text-size');
                if (currentSize === undefined || currentSize === null) {
                    map.setLayoutProperty(layer.id, 'text-size', 16 * scaleFactor);
                    return;
                }

                if (typeof currentSize === 'object' && !Array.isArray(currentSize) && currentSize.stops) {
                    const newStops = currentSize.stops.map(st => [st[0], Number((st[1] * scaleFactor).toFixed(2))]);
                    map.setLayoutProperty(layer.id, 'text-size', { ...currentSize, stops: newStops });
                } 
                else if (typeof currentSize === 'number') {
                    map.setLayoutProperty(layer.id, 'text-size', Number((currentSize * scaleFactor).toFixed(2)));
                } 
                else if (Array.isArray(currentSize)) {
                    if (currentSize[0] === '*' && currentSize[1] === scaleFactor) return;
                    map.setLayoutProperty(layer.id, 'text-size', ['*', scaleFactor, currentSize]);
                }
            } catch (e) {}
        }
    });

    isTextBoosted = true;
}

function enable3DBuildings() {
    if (!map) return;
    try {
        if (!map.getLayer('3d-buildings')) {
            const layers = map.getStyle().layers;
            let labelLayerId;
            for (let i = 0; i < layers.length; i++) {
                if (layers[i].type === 'symbol' && layers[i].layout && layers[i].layout['text-field']) {
                    labelLayerId = layers[i].id;
                    break;
                }
            }
            
            const sources = map.getStyle().sources;
            const sourceKey = Object.keys(sources)[0];

            map.addLayer({
                'id': '3d-buildings',
                'source': sourceKey || 'carto',
                'source-layer': 'building',
                'type': 'fill-extrusion',
                'minzoom': 14,
                'paint': {
                    'fill-extrusion-color': '#334155',
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
                    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                    'fill-extrusion-opacity': 0.75
                }
            }, labelLayerId);
        }
    } catch(e) {}
}

function getNavPadding() {
    if (!is3DMode && !isNavMode) {
        return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    const topPad = Math.floor(window.innerHeight * 0.42);
    return { top: topPad, bottom: 20, left: 0, right: 0 };
}

function toggle3DMode() {
    is3DMode = !is3DMode;
    const btn3d = document.getElementById('btn-3d-toggle');

    if (is3DMode) {
        btn3d.className = "absolute bottom-60 right-3 z-20 w-11 h-11 bg-amber-400 text-slate-950 backdrop-blur-md rounded-full shadow-2xl border-2 border-white flex items-center justify-center font-extrabold text-xs active:scale-95 transition ring-4 ring-amber-400/30";
        btn3d.textContent = "3D";

        enable3DBuildings();

        if (map) {
            map.easeTo({
                pitch: 60,
                padding: getNavPadding(),
                duration: 800
            });
        }
    } else {
        btn3d.className = "absolute bottom-60 right-3 z-20 w-11 h-11 bg-slate-900/90 hover:bg-slate-800 text-slate-300 backdrop-blur-md rounded-full shadow-2xl border border-slate-700 flex items-center justify-center font-extrabold text-xs active:scale-95 transition";
        btn3d.textContent = "2D";

        if (map) {
            map.easeTo({
                pitch: 0,
                padding: { top: 0, bottom: 0, left: 0, right: 0 },
                duration: 800
            });
        }
    }
}

function toggleGPS() {
    const btn = document.getElementById('btn-gps-toggle');
    const icon = document.getElementById('gps-icon');

    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;

        if (navAnimFrame !== null) {
            cancelAnimationFrame(navAnimFrame);
            navAnimFrame = null;
        }

        if (driverMarker) {
            driverMarker.remove();
            driverMarker = null;
        }

        visualPos = null;
        lastGpsTimestamp = 0;

        btn.className = "absolute bottom-36 right-3 z-20 w-11 h-11 bg-slate-900/90 hover:bg-slate-800 text-slate-300 backdrop-blur-md rounded-full shadow-2xl border border-slate-700 flex items-center justify-center text-lg active:scale-95 transition";
        icon.className = "fa-solid fa-location-crosshairs";
    } else {
        if (!navigator.geolocation) {
            alert("A geolocalização não é suportada por este navegador/dispositivo.");
            return;
        }

        showLoading("Conectando ao GPS...");
        requestWakeLock();

        gpsWatchId = navigator.geolocation.watchPosition(
            onGpsSuccess,
            onGpsError,
            { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 }
        );

        btn.className = "absolute bottom-36 right-3 z-20 w-11 h-11 bg-amber-400 text-slate-950 backdrop-blur-md rounded-full shadow-2xl border-2 border-white flex items-center justify-center text-lg active:scale-95 transition";
        icon.className = "fa-solid fa-location-arrow animate-pulse";
    }
}

function calculateBearing(lat1, lng1, lat2, lng2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    let brng = toDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
}

function lerpAngle(start, target, t) {
    let diff = target - start;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return (start + diff * t + 360) % 360;
}

function startNavAnimationLoop() {
    if (navAnimFrame !== null) return;

    function renderStep(now) {
        if (startPos && targetPos) {
            const elapsed = now - animStartTime;
            const progress = Math.min(elapsed / animDuration, 1.0);

            const lat = startPos.lat + (targetPos.lat - startPos.lat) * progress;
            const lng = startPos.lng + (targetPos.lng - startPos.lng) * progress;
            
            visualPos = { lat, lng };
            visualHeading = lerpAngle(startHeading, targetHeading, Math.min(progress * 1.5, 1.0));

            if (driverMarker) {
                driverMarker.setLngLat([lng, lat]);
                const arrowIcon = document.getElementById('driver-arrow-icon');
                if (arrowIcon) {
                    const arrowRotation = isNavMode ? 0 : visualHeading;
                    arrowIcon.style.transform = `rotate(${arrowRotation}deg)`;
                }
            }

            if (isNavMode && map) {
                map.jumpTo({
                    center: [lng, lat],
                    bearing: visualHeading,
                    pitch: is3DMode ? 60 : 0,
                    padding: getNavPadding()
                });
            }
        }

        navAnimFrame = requestAnimationFrame(renderStep);
    }

    navAnimFrame = requestAnimationFrame(renderStep);
}

function onGpsSuccess(position) {
    hideLoading();
    const lng = position.coords.longitude;
    const lat = position.coords.latitude;
    const now = performance.now();

    if (lastGpsTimestamp > 0) {
        animDuration = Math.max(300, Math.min(2000, now - lastGpsTimestamp));
    } else {
        animDuration = 1000;
    }
    lastGpsTimestamp = now;
    
    let newTargetHeading = null;

    if (lastGpsCoords) {
        const distMovedMeters = haversine(lastGpsCoords, { lat, lng }) * 1000;
        if (distMovedMeters >= 1.2) {
            newTargetHeading = calculateBearing(lastGpsCoords.lat, lastGpsCoords.lng, lat, lng);
        }
    }

    if (newTargetHeading === null) {
        if (position.coords.heading !== null && position.coords.heading !== undefined && !isNaN(position.coords.heading)) {
            newTargetHeading = position.coords.heading;
        } else if (deviceAlphaHeading !== null) {
            newTargetHeading = deviceAlphaHeading;
        }
    }

    startPos = visualPos ? { ...visualPos } : { lat, lng };
    targetPos = { lat, lng };

    startHeading = visualHeading;
    targetHeading = (newTargetHeading !== null) ? newTargetHeading : visualHeading;

    animStartTime = now;
    lastGpsCoords = { lat, lng };

    if (!driverMarker) {
        const el = document.createElement('div');
        el.className = 'custom-marker-wrapper';
        el.innerHTML = `
            <div class="driver-pulse w-9 h-9 rounded-full bg-slate-900/95 border-2 border-amber-400 shadow-2xl flex items-center justify-center">
                <svg id="driver-arrow-icon" class="w-5 h-5 text-amber-400 transition-transform duration-200" viewBox="0 0 24 24" fill="currentColor" style="transform-origin: center;">
                    <path d="M12 2L21 21L12 17L3 21L12 2Z"/>
                </svg>
            </div>
        `;

        visualPos = { lat, lng };
        visualHeading = targetHeading;

        driverMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);
    }

    startNavAnimationLoop();

    // Linha de guia da navegação: usa o trecho planejado salvo no aparelho e só consulta a internet em caso de desvio real
    onNavGpsUpdate(lat, lng);
}

function onGpsError(err) {
    hideLoading();
    let msg = "Erro ao obter localização.";
    switch(err.code) {
        case err.PERMISSION_DENIED:
            msg = "A permissão de localização foi negada no navegador.\n\nAtive a permissão de GPS para utilizar a navegação em tempo real.";
            break;
        case err.POSITION_UNAVAILABLE:
            msg = "Sinal de GPS indisponível no momento.";
            break;
        case err.TIMEOUT:
            msg = "Tempo esgotado ao buscar o sinal GPS.";
            break;
    }
    alert(msg);
    toggleGPS();
}

/* --- DETECÇÃO DE MUNICÍPIO E ESTADO VIA GPS --- */

async function detectCurrentCityState() {
    if (cachedCityState) return cachedCityState;

    const refCoords = lastGpsCoords || FIXED_PK2U;
    if (!refCoords) return '';

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${refCoords.lat}&lon=${refCoords.lng}&zoom=10`);
        const data = await res.json();
        if (data && data.address) {
            const city = data.address.city || data.address.town || data.address.municipality || data.address.village || '';
            const state = data.address.state || '';
            if (city || state) {
                cachedCityState = [city, state].filter(Boolean).join(' - ');
                return cachedCityState;
            }
        }
    } catch(e) {}
    return '';
}

async function toggleSearchBox(forceOpen) {
    const box = document.getElementById('search-box-panel');
    const isOpening = forceOpen === true || (forceOpen !== false && box.classList.contains('hidden'));

    if (forceOpen === true) {
        box.classList.remove('hidden');
    } else if (forceOpen === false) {
        box.classList.add('hidden');
    } else {
        box.classList.toggle('hidden');
    }

    if (isOpening) {
        document.getElementById('search-address-input').focus();
        const cityHint = document.getElementById('search-city-hint');
        if (cityHint) {
            cityHint.classList.remove('hidden');
            cityHint.textContent = '📍 Detectando município e estado...';
            const locationStr = await detectCurrentCityState();
            if (locationStr) {
                cityHint.textContent = `📍 Busca otimizada para: ${locationStr}`;
            } else {
                cityHint.classList.add('hidden');
            }
        }
    }
}

/* --- BUSCA OPENSTREETMAP (NOMINATIM) --- */

async function executeAddressSearch() {
    const queryInput = document.getElementById('search-address-input').value.trim();
    const resultsContainer = document.getElementById('search-results-list');
    if (!queryInput) return;

    resultsContainer.innerHTML = '<p class="text-slate-400 text-[11px] p-1"><i class="fa-solid fa-spinner animate-spin mr-1"></i>Buscando no OpenStreetMap...</p>';

    const refCoords = lastGpsCoords || FIXED_PK2U;
    const cityState = await detectCurrentCityState();
    let searchQuery = queryInput;

    if (cityState) {
        const cityName = cityState.split(' - ')[0].toLowerCase();
        if (!queryInput.toLowerCase().includes(cityName)) {
            searchQuery = `${queryInput}, ${cityState}, Brasil`;
        }
    }

    try {
        let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=7&countrycodes=br&addressdetails=1`;
        if (refCoords) {
            const delta = 0.3;
            const viewbox = `${refCoords.lng - delta},${refCoords.lat + delta},${refCoords.lng + delta},${refCoords.lat - delta}`;
            url += `&viewbox=${viewbox}&bounded=0`;
        }

        let res = await fetch(url);
        let data = await res.json();

        if ((!data || data.length === 0) && searchQuery !== queryInput) {
            const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryInput)}&limit=7&countrycodes=br&addressdetails=1`;
            res = await fetch(fallbackUrl);
            data = await res.json();
        }

        if (!data || data.length === 0) {
            resultsContainer.innerHTML = '<p class="text-rose-400 text-[11px] p-1">Nenhum endereço encontrado.</p>';
            return;
        }

        resultsContainer.innerHTML = '';
        data.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'w-full text-left p-2 hover:bg-slate-800 rounded-lg text-[11px] text-slate-200 truncate border-b border-slate-800/60 flex items-center space-x-2';
            
            const houseNum = item.address && item.address.house_number ? ` (Nº ${item.address.house_number})` : '';
            const mainTitle = item.display_name.split(',')[0];

            btn.innerHTML = `<i class="fa-solid fa-location-dot text-amber-400 shrink-0"></i><span class="truncate"><strong>${mainTitle}${houseNum}</strong> - ${item.display_name}</span>`;
            btn.onclick = () => selectSearchResult(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
            resultsContainer.appendChild(btn);
        });
    } catch(err) {
        resultsContainer.innerHTML = '<p class="text-rose-400 text-[11px] p-1">Erro ao pesquisar endereço no OSM.</p>';
    }
}

function selectSearchResult(lat, lng, name) {
    toggleSearchBox(false);
    if (searchMarker) searchMarker.remove();

    const el = document.createElement('div');
    el.innerHTML = '<div class="w-8 h-8 rounded-full bg-rose-600 border-2 border-white text-white flex items-center justify-center shadow-lg"><i class="fa-solid fa-flag-checkered text-xs"></i></div>';

    const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    searchMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup({ closeButton: false, offset: 25 }).setHTML(`
            <div class="p-1 max-w-xs font-sans">
                <h4 class="font-bold text-slate-900 text-xs truncate">${name.substring(0, 45)}...</h4>
                <div class="grid grid-cols-3 gap-1 mt-2.5">
                    <button onclick="navigateToSearchLocation(${lat}, ${lng}, '${safeName}')" class="bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-bold py-1.5 px-1 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                        <i class="fa-solid fa-compass"></i> <span>App</span>
                    </button>
                    <button onclick="openWaze(${lat}, ${lng})" class="bg-cyan-500 hover:bg-cyan-600 text-white text-[10px] font-bold py-1.5 px-1 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                        <i class="fa-solid fa-location-arrow"></i> <span>Waze</span>
                    </button>
                    <button onclick="openGoogleMaps(${lat}, ${lng})" class="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold py-1.5 px-1 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                        <i class="fa-brands fa-google"></i> <span>G. Maps</span>
                    </button>
                </div>
            </div>
        `))
        .addTo(map);

    if (window.innerWidth < 768) switchMobileTab('map');

    map.flyTo({ center: [lng, lat], zoom: 17 });
    searchMarker.togglePopup();
}

async function navigateToSearchLocation(lat, lng, name) {
    if (window.innerWidth < 768) {
        switchMobileTab('map');
    }

    isCustomSearchNav = true;

    document.getElementById('nav-delivery-actions').classList.add('hidden');
    document.getElementById('nav-custom-search-actions').classList.remove('hidden');

    const houseNumEl = document.getElementById('nav-next-house-num');
    if (houseNumEl) houseNumEl.classList.add('hidden');

    if (!isNavMode) {
        isNavMode = true;
        requestWakeLock();
        const btnMap = document.getElementById('btn-gps-nav-mode');
        const navHeader = document.getElementById('nav-header-panel');
        const distBadge = document.getElementById('dist-badge');
        const topNavBtnText = document.getElementById('nav-mode-top-text');

        btnMap.className = "absolute bottom-48 right-3 z-20 w-11 h-11 bg-amber-400 text-slate-950 backdrop-blur-md rounded-full shadow-2xl border-2 border-white flex items-center justify-center text-lg active:scale-95 transition ring-4 ring-amber-400/30";
        navHeader.classList.remove('hidden');
        distBadge.classList.add('hidden');
        if (topNavBtnText) topNavBtnText.textContent = "Sair da Navegação";

        if (gpsWatchId === null) {
            toggleGPS();
        }
    } else {
        document.getElementById('nav-header-panel').classList.remove('hidden');
    }

    document.getElementById('nav-next-num').textContent = '🔍';
    document.getElementById('nav-next-label').textContent = 'Local Pesquisado';
    document.getElementById('nav-next-title').textContent = 'Endereço Pesquisado';
    document.getElementById('nav-next-address').textContent = name || 'Local pesquisado';

    let startCoord;
    if (lastGpsCoords) {
        startCoord = [lastGpsCoords.lng, lastGpsCoords.lat];
        isFallbackOrigin = false;
    } else {
        startCoord = [FIXED_PK2U.lng, FIXED_PK2U.lat];
        isFallbackOrigin = true; // Rota iniciada com ponto temporário
    }

    const endCoord = [lng, lat];
    navGuideIsStraight = false;

    let res = null;
    if (navigator.onLine) {
        try {
            res = await getNavRoute({ lat: startCoord[1], lng: startCoord[0] }, { lat, lng });
        } catch (err) { res = null; }
    }

    if (res && res.c && res.c.length > 1) {
        fullNavRouteGeometry = { type: 'LineString', coordinates: res.c };
        navFailCount = 0;
        navBlockedUntil = Date.now() + NAV_MIN_INTERVAL_MS;
    } else {
        fullNavRouteGeometry = { type: 'LineString', coordinates: [startCoord, endCoord] };
        navGuideIsStraight = true;
        navFailCount++;
        navBlockedUntil = Date.now() + Math.min(300000, NAV_MIN_INTERVAL_MS * Math.pow(2, navFailCount - 1));
    }

    updateRouteOnMap();

    if (map) {
        map.flyTo({
            center: startCoord,
            pitch: is3DMode ? 60 : 0,
            padding: getNavPadding(),
            duration: 800
        });
    }
}

function cancelCustomSearchRoute() {
    isCustomSearchNav = false;
    fullNavRouteGeometry = null;
    navGuideIsStraight = false;
    updateRouteOnMap();

    if (searchMarker) {
        searchMarker.remove();
        searchMarker = null;
    }

    document.getElementById('nav-header-panel').classList.add('hidden');

    document.getElementById('nav-custom-search-actions').classList.add('hidden');
    document.getElementById('nav-delivery-actions').classList.remove('hidden');
    document.getElementById('nav-next-label').textContent = 'Próximo Destino';

    const houseNumEl = document.getElementById('nav-next-house-num');
    if (houseNumEl) houseNumEl.classList.add('hidden');
}

function ensureArrowIcon() {
    if (!map) return;
    try {
        if (!map.hasImage('route-arrow-icon')) {
            const canvas = document.createElement('canvas');
            canvas.width = 24;
            canvas.height = 24;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2.0;

            ctx.beginPath();
            ctx.moveTo(22, 12);
            ctx.lineTo(4, 3);
            ctx.lineTo(9, 12);
            ctx.lineTo(4, 21);
            ctx.closePath();

            ctx.fill();
            ctx.stroke();

            const imageData = ctx.getImageData(0, 0, 24, 24);
            map.addImage('route-arrow-icon', imageData);
        }
    } catch(e) {}
}

function _setGeoSource(id, geometry) {
    const data = { 'type': 'Feature', 'properties': {}, 'geometry': geometry };
    try {
        if (!map.getSource(id)) {
            map.addSource(id, { 'type': 'geojson', 'data': data });
        } else {
            map.getSource(id).setData(data);
        }
    } catch (e) {}
}

function updateRouteOnMap() {
    if (!map) return;

    const empty = { 'type': 'LineString', 'coordinates': [] };

    // Rota planejada: apenas trechos reais entre as entregas (já salvos no aparelho)
    const knownLegs = (plannedLegGeoms || []).filter(g => g && g.length > 1);
    const plannedGeom = knownLegs.length ? { 'type': 'MultiLineString', 'coordinates': knownLegs } : empty;

    // Trechos ainda não baixados: tracejado cinza, para nunca parecer uma rota de verdade
    const gapGeom = (plannedGapSegments && plannedGapSegments.length)
        ? { 'type': 'MultiLineString', 'coordinates': plannedGapSegments } : empty;

    // Guia da navegação (veículo -> próxima entrega)
    const hasNav = isNavMode && fullNavRouteGeometry && fullNavRouteGeometry.coordinates && fullNavRouteGeometry.coordinates.length > 1;
    const navRouted = (hasNav && !navGuideIsStraight) ? fullNavRouteGeometry : empty;
    const navStraight = (hasNav && navGuideIsStraight) ? fullNavRouteGeometry : empty;

    _setGeoSource('route-gap-source', gapGeom);
    _setGeoSource('route-source', plannedGeom);
    _setGeoSource('nav-source', navRouted);
    _setGeoSource('nav-straight-source', navStraight);

    try {
        if (!map.getLayer('route-gap-layer')) {
            map.addLayer({
                'id': 'route-gap-layer',
                'type': 'line',
                'source': 'route-gap-source',
                'layout': { 'line-join': 'round', 'line-cap': 'butt' },
                'paint': { 'line-color': '#64748b', 'line-width': 3, 'line-opacity': 0.8, 'line-dasharray': [2, 2] }
            });
        }
    } catch (e) {}

    try {
        if (!map.getLayer('route-layer')) {
            map.addLayer({
                'id': 'route-layer',
                'type': 'line',
                'source': 'route-source',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#ef4444', 'line-width': 5, 'line-opacity': 0.95 }
            });
        }
        map.setPaintProperty('route-layer', 'line-opacity', isNavMode ? 0.5 : 0.95);
    } catch (e) {}

    try {
        ensureArrowIcon();
        if (!map.getLayer('route-arrows-layer')) {
            map.addLayer({
                'id': 'route-arrows-layer',
                'type': 'symbol',
                'source': 'route-source',
                'layout': {
                    'symbol-placement': 'line',
                    'symbol-spacing': 60,
                    'icon-image': 'route-arrow-icon',
                    'icon-size': 0.5,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-rotation-alignment': 'map'
                }
            });
        }
    } catch (e) {}

    try {
        if (!map.getLayer('nav-casing-layer')) {
            map.addLayer({
                'id': 'nav-casing-layer',
                'type': 'line',
                'source': 'nav-source',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.9 }
            });
        }
        if (!map.getLayer('nav-layer')) {
            map.addLayer({
                'id': 'nav-layer',
                'type': 'line',
                'source': 'nav-source',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.95 }
            });
        }
        if (!map.getLayer('nav-straight-layer')) {
            map.addLayer({
                'id': 'nav-straight-layer',
                'type': 'line',
                'source': 'nav-straight-source',
                'layout': { 'line-join': 'round', 'line-cap': 'butt' },
                'paint': { 'line-color': '#f59e0b', 'line-width': 4, 'line-opacity': 0.95, 'line-dasharray': [1.5, 1.5] }
            });
        }
    } catch (e) {}
}

// Atualização leve (1x por segundo): mexe só na linha de guia, sem redesenhar a rota inteira
function updateNavLayer() {
    if (!map || !map.getSource('nav-source') || !map.getSource('nav-straight-source')) {
        updateRouteOnMap();
        return;
    }
    const empty = { 'type': 'LineString', 'coordinates': [] };
    const hasNav = isNavMode && fullNavRouteGeometry && fullNavRouteGeometry.coordinates && fullNavRouteGeometry.coordinates.length > 1;
    try {
        map.getSource('nav-source').setData({ 'type': 'Feature', 'properties': {}, 'geometry': (hasNav && !navGuideIsStraight) ? fullNavRouteGeometry : empty });
        map.getSource('nav-straight-source').setData({ 'type': 'Feature', 'properties': {}, 'geometry': (hasNav && navGuideIsStraight) ? fullNavRouteGeometry : empty });
    } catch (e) {}
}

function getMarkerStyleConfig(number, status) {
    let colorClasses = 'bg-indigo-600 text-white border-white';
    let iconHtml = `${number}`;

    if (status === 'success') {
        colorClasses = 'bg-emerald-500 text-white border-emerald-200 ring-2 ring-emerald-400';
        iconHtml = '<i class="fa-solid fa-check text-xs"></i>';
    } else if (status === 'occurrence') {
        colorClasses = 'bg-rose-600 text-white border-rose-200 ring-2 ring-rose-400';
        iconHtml = '<i class="fa-solid fa-xmark text-xs"></i>';
    }

    return {
        className: `flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shadow-lg border-2 cursor-pointer transition-all ${colorClasses}`,
        innerHTML: iconHtml
    };
}

function createMarkerElement(number, status) {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-marker-wrapper';

    const inner = document.createElement('div');
    const styleConfig = getMarkerStyleConfig(number, status);
    inner.className = `marker-badge ${styleConfig.className}`;
    inner.innerHTML = styleConfig.innerHTML;

    wrapper.appendChild(inner);
    return wrapper;
}

function openWaze(lat, lng) {
    window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
}

function openGoogleMaps(lat, lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

function createPopupHtml(idx, p) {
    return `
        <div class="p-1 max-w-xs font-sans">
            <span class="text-xs uppercase font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">Parada #${idx + 1}</span>
            <h4 class="font-bold text-slate-900 text-base mt-1.5 leading-snug">${p.spx}</h4>
            <p class="text-sm text-slate-700 font-medium mt-1"><i class="fa-solid fa-location-dot text-indigo-500 mr-1"></i>${p.address}</p>
            <p class="text-xs text-slate-500 mt-1"><strong>Bairro:</strong> ${p.bairro}</p>
            
            <div class="grid grid-cols-3 gap-1 mt-2.5 pt-2 border-t border-slate-100">
                <button onclick="navigateToPoint(${idx})" class="bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-bold py-1.5 px-1 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-solid fa-compass"></i> <span>App</span>
                </button>
                <button onclick="openWaze(${p.lat}, ${p.lng})" class="bg-cyan-500 hover:bg-cyan-600 text-white text-[11px] font-bold py-1.5 px-1 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-solid fa-location-arrow"></i> <span>Waze</span>
                </button>
                <button onclick="openGoogleMaps(${p.lat}, ${p.lng})" class="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold py-1.5 px-1 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-brands fa-google"></i> <span>G. Maps</span>
                </button>
            </div>

            <div class="flex space-x-1.5 mt-2">
                <button onclick="setDeliveryStatus(${idx}, 'success')" class="flex-1 ${p.status === 'success' ? 'bg-emerald-700 ring-2 ring-emerald-300' : 'bg-emerald-600'} hover:bg-emerald-700 text-white text-xs font-bold py-1.5 px-2 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-solid fa-check"></i> <span>Sucesso</span>
                </button>
                <button onclick="setDeliveryStatus(${idx}, 'occurrence')" class="flex-1 ${p.status === 'occurrence' ? 'bg-rose-700 ring-2 ring-rose-300' : 'bg-rose-600'} hover:bg-rose-700 text-white text-xs font-bold py-1.5 px-2 rounded-lg flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-solid fa-triangle-exclamation"></i> <span>Ocorrência</span>
                </button>
            </div>
        </div>
    `;
}

async function renderMapAndUI(points, fetchRoads = true) {
    markersMap.forEach(m => m.remove());
    markersMap.clear();

    const bounds = new maplibregl.LngLatBounds();
    applyMarkerJitter(points);

    points.forEach((p, idx) => {
        bounds.extend([p.lng, p.lat]);
        
        const markerEl = createMarkerElement(idx + 1, p.status);
        const popup = new maplibregl.Popup({ closeButton: false, offset: 25 }).setHTML(createPopupHtml(idx, p));

        const marker = new maplibregl.Marker({ element: markerEl })
            .setLngLat([p._displayLng, p._displayLat])
            .setPopup(popup)
            .addTo(map);

        markersMap.set(idx, marker);
    });

    if (points.length > 0 && !isNavMode) {
        map.fitBounds(bounds, { padding: 40 });
    }

    if (isNavMode) {
        if (!isCustomSearchNav) {
            updateNavSegmentRoute();
        }
    } else if (fetchRoads) {
        await buildPlannedRoute(points, true);   // baixa cada trecho uma vez e guarda no aparelho
        updateRouteOnMap();

        document.getElementById('dist-badge').classList.remove('hidden');
        document.getElementById('dist-text').textContent = `${routeLegsStatus.ready < routeLegsStatus.total ? '≈ ' : ''}${currentRouteDistanceKm} km`;
    } else {
        updateRouteOnMap();
    }

    updateCounters();
    renderSidebarList(points);
    saveStateToLocalStorage();
}

function focusOnPoint(idx) {
    const p = activePoints[idx];
    if (!p) return;

    if (window.innerWidth < 768) {
        switchMobileTab('map');
    }

    map.flyTo({ center: [p.lng, p.lat], zoom: 16 });
    const marker = markersMap.get(idx);
    if (marker) marker.togglePopup();
}


/* --- PRÉ-CARREGAMENTO DA ÁREA URBANA DE AVARÉ (OFFLINE) --- */

// Limites Geográficos (Bounding Box) da Área Urbana de Avaré - SP
const AVARE_URBAN_BBOX = {
    southLat: -23.135, // Limite Sul (Entrada de Cerqueira César / SP-255)
    northLat: -23.070, // Limite Norte (Bairro Brabância / Distrito Industrial)
    westLng:  -48.965, // Limite Oeste (Camargo)
    eastLng:  -48.885  // Limite Leste (Planalto)
};

function lng2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

async function downloadAvareUrbanMap(minZoom = 14, maxZoom = 17) {
    if (!navigator.onLine) {
        alert("Necessita de estar ligado à internet para descarregar o mapa offline.");
        return;
    }

    const subdomains = ['a', 'b', 'c'];
    const urlsToFetch = new Set();

    // Calcula os tiles necessários para cada nível de zoom dentro do quadrado urbano
    for (let z = minZoom; z <= maxZoom; z++) {
        const xMin = lng2tile(AVARE_URBAN_BBOX.westLng, z);
        const xMax = lng2tile(AVARE_URBAN_BBOX.eastLng, z);
        
        // No sistema Web Mercator, a latitude Norte gera um Y menor que a latitude Sul
        const yMin = lat2tile(AVARE_URBAN_BBOX.northLat, z);
        const yMax = lat2tile(AVARE_URBAN_BBOX.southLat, z);

        for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
                const sub = subdomains[Math.abs(x + y) % 3];
                urlsToFetch.add(`https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`);
            }
        }
    }

    const totalTiles = urlsToFetch.size;
    showLoading(`A descarregar Avaré Offline (0/${totalTiles} imagens)...`);

    try {
        const cache = await caches.open('map-tiles-cache');
        const urlArray = Array.from(urlsToFetch);
        let downloaded = 0;

        // Processa em pequenos lotes de 10 para transferência rápida sem travar a rede
        for (let i = 0; i < urlArray.length; i += 10) {
            const batch = urlArray.slice(i, i + 10);
            await Promise.all(batch.map(async (url) => {
                const match = await cache.match(url);
                if (!match) {
                    try {
                        const res = await fetch(url);
                        if (res.ok) await cache.put(url, res);
                    } catch (e) {}
                }
            }));
            
            downloaded += batch.length;
            showLoading(`A descarregar Avaré Offline (${Math.min(downloaded, totalTiles)}/${totalTiles})...`);
        }

        alert(`Download concluído! A área urbana de Avaré (${totalTiles} blocos) está salva e pronta para uso sem internet.`);
    } catch (e) {
        console.error("Erro ao guardar mapa offline de Avaré:", e);
        alert("Ocorreu uma falha ao guardar o mapa offline.");
    } finally {
        hideLoading();
    }
}


/* --- SIMULADOR DE NAVEGAÇÃO (TESTE VISUAL PONTO A -> PONTO B) --- */
/* Para iniciar aperte F12 e em seguida digite: runDemoNavigation(); */
/* Para parar: stopDemoNavigation(); */


let demoIntervalId = null;

async function runDemoNavigation() {
    // Para qualquer simulação em andamento
    stopDemoNavigation();

    // Coordenadas de teste em Avaré - SP
    // Ponto A: Centro / Largo São João
    const pointA = { lat: -23.1025, lng: -48.9555 }; 
    // Ponto B: Avenida Paranapanema
    const pointB = { lat: -23.1130, lng: -48.9280 }; 

    showLoading("A gerar rota de teste Avaré...");

    try {
        // 1. Busca rota real entre o Ponto A e Ponto B no OpenRouteService
        const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
            method: 'POST',
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                coordinates: [
                    [pointA.lng, pointA.lat],
                    [pointB.lng, pointB.lat]
                ]
            })
        });

        hideLoading();

        if (!response.ok) {
            alert("Erro ao obter rota da API ORS. Verifique a chave de API.");
            return;
        }

        const data = await response.json();
        const coords = data.features[0].geometry.coordinates; // Array de [lng, lat]

        if (!coords || coords.length < 2) {
            alert("Rota não encontrada.");
            return;
        }

        // 2. Ativa Modos de Navegação e 3D
        isNavMode = true;
        if (!is3DMode) toggle3DMode();

        document.getElementById('nav-header-panel')?.classList.remove('hidden');
        document.getElementById('nav-next-label').textContent = 'Simulação de Teste';
        document.getElementById('nav-next-title').textContent = 'Ponto A → Ponto B';
        document.getElementById('nav-next-address').textContent = 'Av. Paranapanema - Avaré';

        // Configura as geometrias globais da rota
        fullNavRouteGeometry = { 'type': 'LineString', 'coordinates': coords };
        navGuideIsStraight = false;
        updateRouteOnMap();

        // 3. Inicia loop de simulação de movimento do veículo a cada 1.2s
        let stepIndex = 0;

        demoIntervalId = setInterval(() => {
            if (stepIndex >= coords.length) {
                stopDemoNavigation();
                alert("Simulação concluída! Chegou ao destino (Ponto B).");
                return;
            }

            const currentCoord = coords[stepIndex];
            const nextCoord = coords[Math.min(stepIndex + 1, coords.length - 1)];

            // Calcula a direção em graus (heading) para a próxima curva
            const heading = calculateBearing(
                currentCoord[1], currentCoord[0],
                nextCoord[1], nextCoord[0]
            );

            // Injeta posição simulada na função real do GPS
            onGpsSuccess({
                coords: {
                    latitude: currentCoord[1],
                    longitude: currentCoord[0],
                    heading: heading,
                    speed: 10 // ~36 km/h
                }
            });

            stepIndex++;
        }, 1200);

    } catch (err) {
        hideLoading();
        console.error("Erro na simulação:", err);
        alert("Falha ao iniciar simulação de navegação.");
    }
}

function stopDemoNavigation() {
    if (demoIntervalId !== null) {
        clearInterval(demoIntervalId);
        demoIntervalId = null;
    }
    isNavMode = false;
    document.getElementById('nav-header-panel')?.classList.add('hidden');
}
