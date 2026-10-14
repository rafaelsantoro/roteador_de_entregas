/* --- MANIPULAÇÃO DO MAPA, GPS E NAVEGAÇÃO 3D --- */

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
                    'fill-extrusion-color': '#cbd5e1',
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
                    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                    'fill-extrusion-opacity': 0.65
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
                zoom: Math.max(map.getZoom(), 16.5),
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

        if (driverMarker) {
            driverMarker.remove();
            driverMarker = null;
        }

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

function smoothHeadingAngle(current, target, factor = 0.20) {
    if (target === null || target === undefined || isNaN(target)) return current;
    let diff = target - current;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    if (Math.abs(diff) < 0.8) return current;
    return (current + diff * factor + 360) % 360;
}

function onGpsSuccess(position) {
    hideLoading();
    const lng = position.coords.longitude;
    const lat = position.coords.latitude;
    
    const isFirstGps = !lastGpsCoords;
    let targetHeading = null;

    if (lastGpsCoords) {
        const distMovedMeters = haversine(lastGpsCoords, { lat, lng }) * 1000;
        if (distMovedMeters >= 1.5) {
            targetHeading = calculateBearing(lastGpsCoords.lat, lastGpsCoords.lng, lat, lng);
        }
    }

    if (targetHeading === null) {
        if (position.coords.heading !== null && position.coords.heading !== undefined && !isNaN(position.coords.heading)) {
            targetHeading = position.coords.heading;
        } else if (deviceAlphaHeading !== null) {
            targetHeading = deviceAlphaHeading;
        }
    }

    if (targetHeading !== null) {
        const factor = (lastGpsCoords && haversine(lastGpsCoords, { lat, lng }) * 1000 >= 1.5) ? 0.30 : 0.08;
        smoothedHeading = smoothHeadingAngle(smoothedHeading, targetHeading, factor);
    }

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

        driverMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);
    } else {
        driverMarker.setLngLat([lng, lat]);
    }

    const arrowIcon = document.getElementById('driver-arrow-icon');
    if (arrowIcon) {
        const arrowRotation = isNavMode ? 0 : smoothedHeading;
        arrowIcon.style.transform = `rotate(${arrowRotation}deg)`;
    }

    if (isNavMode && currentRouteGeometry && currentRouteGeometry.coordinates && currentRouteGeometry.coordinates.length > 1) {
        const coords = currentRouteGeometry.coordinates;
        let closestIdx = 0;
        let minD = Infinity;

        for (let i = 0; i < coords.length; i++) {
            const d = haversine({ lat, lng }, { lat: coords[i][1], lng: coords[i][0] });
            if (d < minD) {
                minD = d;
                closestIdx = i;
            }
        }

        const now = Date.now();
        if (minD * 1000 > 45 && (now - lastRecalcTime > 6000)) {
            lastRecalcTime = now;
            if (isCustomSearchNav && searchMarker) {
                const targetLngLat = searchMarker.getLngLat();
                const addressText = document.getElementById('nav-next-address').textContent;
                navigateToSearchLocation(targetLngLat.lat, targetLngLat.lng, addressText);
            } else if (currentNavIndex >= 0 && activePoints && activePoints[currentNavIndex]) {
                updateNavSegmentRoute(currentNavIndex);
            }
        } else {
            const remainingCoords = [[lng, lat], ...coords.slice(closestIdx + 1)];
            if (remainingCoords.length >= 2) {
                currentRouteGeometry.coordinates = remainingCoords;
                if (map && map.getSource('route-source')) {
                    map.getSource('route-source').setData({
                        'type': 'Feature',
                        'properties': {},
                        'geometry': currentRouteGeometry
                    });
                }
            }
        }
    }

    if (isNavMode && map) {
        if (isFirstGps && currentNavIndex >= 0 && !isCustomSearchNav && activePoints && activePoints.length > 0) {
            updateNavSegmentRoute(currentNavIndex);
        }

        map.easeTo({
            center: [lng, lat],
            bearing: smoothedHeading,
            pitch: is3DMode ? 60 : 0,
            zoom: is3DMode ? 17.5 : 17,
            padding: getNavPadding(),
            duration: 500,
            easing: t => t
        });
    }
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

function toggleSearchBox(forceOpen) {
    const box = document.getElementById('search-box-panel');
    if (forceOpen === true) {
        box.classList.remove('hidden');
    } else if (forceOpen === false) {
        box.classList.add('hidden');
    } else {
        box.classList.toggle('hidden');
    }
    if (!box.classList.contains('hidden')) {
        document.getElementById('search-address-input').focus();
    }
}

async function executeAddressSearch() {
    const query = document.getElementById('search-address-input').value.trim();
    const resultsContainer = document.getElementById('search-results-list');
    if (!query) return;

    resultsContainer.innerHTML = '<p class="text-slate-400 text-[11px] p-1">Buscando endereço...</p>';

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=br`);
        const data = await res.json();

        if (!data || data.length === 0) {
            resultsContainer.innerHTML = '<p class="text-rose-400 text-[11px] p-1">Nenhum endereço encontrado.</p>';
            return;
        }

        resultsContainer.innerHTML = '';
        data.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'w-full text-left p-2 hover:bg-slate-800 rounded-lg text-[11px] text-slate-200 truncate border-b border-slate-800/60 flex items-center space-x-2';
            btn.innerHTML = `<i class="fa-solid fa-location-dot text-amber-400 shrink-0"></i><span class="truncate">${item.display_name}</span>`;
            btn.onclick = () => selectSearchResult(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
            resultsContainer.appendChild(btn);
        });
    } catch(err) {
        resultsContainer.innerHTML = '<p class="text-rose-400 text-[11px] p-1">Erro ao pesquisar endereço.</p>';
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

    map.flyTo({ center: [lng, lat], zoom: 16.5 });
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

    const startCoord = lastGpsCoords 
        ? [lastGpsCoords.lng, lastGpsCoords.lat] 
        : [FIXED_PK2U.lng, FIXED_PK2U.lat];

    const endCoord = [lng, lat];

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
            method: 'POST',
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ coordinates: [startCoord, endCoord] }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data && data.features && data.features[0] && data.features[0].geometry) {
                currentRouteGeometry = data.features[0].geometry;
            } else {
                currentRouteGeometry = { 'type': 'LineString', 'coordinates': [startCoord, endCoord] };
            }
        } else {
            currentRouteGeometry = { 'type': 'LineString', 'coordinates': [startCoord, endCoord] };
        }
    } catch (err) {
        currentRouteGeometry = { 'type': 'LineString', 'coordinates': [startCoord, endCoord] };
    }

    updateRouteOnMap();

    if (map) {
        map.flyTo({
            center: startCoord,
            zoom: is3DMode ? 17.5 : 16,
            pitch: is3DMode ? 60 : 0,
            padding: getNavPadding(),
            duration: 800
        });
    }
}

function cancelCustomSearchRoute() {
    isCustomSearchNav = false;

    currentRouteGeometry = null;
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

function updateRouteOnMap() {
    if (!map) return;

    let routeGeometry = currentRouteGeometry;

    if (!routeGeometry || !routeGeometry.coordinates || routeGeometry.coordinates.length === 0) {
        if (activePoints && activePoints.length > 0) {
            routeGeometry = {
                'type': 'LineString',
                'coordinates': activePoints.map(p => [p.lng, p.lat])
            };
        } else {
            routeGeometry = { 'type': 'LineString', 'coordinates': [] };
        }
    }

    const geojsonData = {
        'type': 'Feature',
        'properties': {},
        'geometry': routeGeometry
    };

    const lineColor = '#ef4444';

    try {
        if (!map.getSource('route-source')) {
            map.addSource('route-source', {
                'type': 'geojson',
                'data': geojsonData
            });
        } else {
            map.getSource('route-source').setData(geojsonData);
        }
    } catch (e) {}

    try {
        if (!map.getLayer('route-layer')) {
            map.addLayer({
                'id': 'route-layer',
                'type': 'line',
                'source': 'route-source',
                'layout': {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                'paint': {
                    'line-color': lineColor,
                    'line-width': 5,
                    'line-opacity': 0.95
                }
            });
        } else {
            map.setPaintProperty('route-layer', 'line-color', lineColor);
        }
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
        const geom = await fetchDeliveryPolyline(points);
        const distTotal = await fetchFullDayTotalDistance(points);

        currentRouteGeometry = geom;
        currentRouteDistanceKm = distTotal;

        updateRouteOnMap();

        document.getElementById('dist-badge').classList.remove('hidden');
        document.getElementById('dist-text').textContent = `${currentRouteDistanceKm} km`;
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
