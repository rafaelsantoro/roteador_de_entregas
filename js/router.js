/* --- CÁLCULO DE ROTAS, TSP E EXPORTAÇÕES --- */

function extractHouseNumber(address) {
    if (!address || typeof address !== 'string') return '';
    let parts = address.split(',');
    if (parts.length > 1) {
        let afterComma = parts[1].trim().split('-')[0].split('(')[0].trim();
        let match = afterComma.match(/\d+[a-zA-Z]?/);
        if (match) return match[0];
    }
    let matchNoComma = address.split('-')[0].match(/\b\d+[a-zA-Z]?\b/);
    if (matchNoComma) return matchNoComma[0];
    return '';
}

function normalizeStreetName(address) {
    if (!address || typeof address !== 'string') return '';
    let part = address.split(',')[0].split('-')[0];
    part = part.replace(/\d.*/, '');
    part = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    part = part.toLowerCase().trim();
    part = part.replace(/^(rua|r\.|r|avenida|av\.|av|alameda|al\.|al|praca|prc\.|prc|travessa|trv\.|trv|rodovia|rod\.|rod)\s+/, '');
    part = part.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    return part;
}

function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function calculateFileSummary(items) {
    const totalPackages = items.length;
    if (totalPackages === 0) {
        return { totalPackages: 0, totalAddresses: 0, singlePackageAddresses: 0, totalBags: 0 };
    }

    const groups = [];

    items.forEach(item => {
        const key = normalizeStreetName(item.address);
        if (!key) {
            groups.push({ key: 'desconhecido_' + Math.random(), count: 1 });
            return;
        }

        let foundGroup = groups.find(g => {
            if (g.key === key) return true;
            if (g.key.length >= 4 && key.length >= 4) {
                const dist = levenshteinDistance(g.key, key);
                const maxLen = Math.max(g.key.length, key.length);
                if (dist <= 2 && (1 - dist / maxLen) >= 0.80) {
                    return true;
                }
            }
            return false;
        });

        if (foundGroup) {
            foundGroup.count++;
        } else {
            groups.push({ key: key, count: 1 });
        }
    });

    const totalAddresses = groups.length;
    const singlePackageAddresses = groups.filter(g => g.count === 1).length;
    const totalBags = totalAddresses - singlePackageAddresses;

    return {
        totalPackages,
        totalAddresses,
        singlePackageAddresses,
        totalBags
    };
}

function updateFileSummaryUI(items) {
    const card = document.getElementById('file-summary-card');
    if (!items || items.length === 0) {
        if (card) card.classList.add('hidden');
        return;
    }

    const summary = calculateFileSummary(items);

    document.getElementById('sum-pkgs').textContent = summary.totalPackages;
    document.getElementById('sum-addrs').textContent = summary.totalAddresses;
    document.getElementById('sum-single').textContent = summary.singlePackageAddresses;
    document.getElementById('sum-bags').textContent = summary.totalBags;

    if (card) card.classList.remove('hidden');

    const menuBox = document.getElementById('collapsible-menu');
    const chevron = document.getElementById('menu-chevron');
    if (menuBox && menuBox.classList.contains('hidden')) {
        menuBox.classList.remove('hidden');
        if (chevron) chevron.className = "fa-solid fa-chevron-up text-[10px] ml-0.5";
    }
}

function haversine(p1, p2) {
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* --- MATRIZ DE DISTÂNCIAS E OTIMIZAÇÃO PARA QUALQUER NÚMERO DE PONTOS (>50) --- */

async function fetchDistanceMatrixChunk(locations) {
    if (!navigator.onLine || !locations || locations.length < 2) return null;
    if (locations.length > 50) return null;

    const coords = locations.map(p => [p.lng, p.lat]);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
            method: 'POST',
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                locations: coords,
                metrics: ['distance']
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const data = await response.json();
        return data && data.distances ? data.distances : null;
    } catch (e) {
        console.warn("Falha no lote da matriz ORS. A aplicar fallback por Haversine.", e);
        return null;
    }
}

function createSpatialClusters(deliveries, maxClusterSize = 40) {
    let unvisited = [...deliveries];
    const clusters = [];

    let currentCenter = FIXED_PK2U;

    while (unvisited.length > 0) {
        let seedIdx = 0;
        let minSeedDist = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            let d = haversine(currentCenter, unvisited[i]);
            if (d < minSeedDist) {
                minSeedDist = d;
                seedIdx = i;
            }
        }

        const cluster = [];
        let seed = unvisited.splice(seedIdx, 1)[0];
        cluster.push(seed);

        while (cluster.length < maxClusterSize && unvisited.length > 0) {
            let lastPoint = cluster[cluster.length - 1];
            let nearestIdx = 0;
            let minDist = Infinity;

            for (let i = 0; i < unvisited.length; i++) {
                let d = haversine(lastPoint, unvisited[i]);
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }

            cluster.push(unvisited.splice(nearestIdx, 1)[0]);
        }

        clusters.push(cluster);
        currentCenter = cluster[cluster.length - 1];
    }

    return clusters;
}

async function optimizeSingleCluster(clusterPoints, startOrigin, endDestination, prioritizeSameStreet, manualFirstIdx = -1) {
    if (!clusterPoints || clusterPoints.length === 0) return [];
    if (clusterPoints.length === 1) return [...clusterPoints];

    const clusterLocations = [startOrigin, ...clusterPoints, endDestination];
    const originIdx = 0;
    const destIdx = clusterLocations.length - 1;

    const deliveryWithIdx = clusterPoints.map((d, i) => ({ ...d, matrixIdx: i + 1 }));
    const matrix = await fetchDistanceMatrixChunk(clusterLocations);

    function getRawDist(i, j) {
        if (matrix && matrix[i] && matrix[i][j] !== null && matrix[i][j] !== undefined) {
            return matrix[i][j] / 1000.0;
        }
        return haversine(clusterLocations[i], clusterLocations[j]);
    }

    function getPenaltyDist(i, j, p1, p2) {
        let d = getRawDist(i, j);
        if (prioritizeSameStreet && p1 && p2 && p1.streetKey && p1.streetKey === p2.streetKey) {
            return d - 1000.0;
        }
        return d;
    }

    let unvisited = [...deliveryWithIdx];
    let route = [];

    if (manualFirstIdx >= 0 && manualFirstIdx < unvisited.length) {
        let first = unvisited.splice(manualFirstIdx, 1)[0];
        route.push(first);
    }

    while (unvisited.length > 0) {
        let currentItem = route.length > 0 ? route[route.length - 1] : null;
        let currentIdx = currentItem ? currentItem.matrixIdx : originIdx;
        let currentStreetKey = currentItem ? currentItem.streetKey : '';

        let sameStreetCandidates = (prioritizeSameStreet && currentStreetKey)
            ? unvisited.filter(p => p.streetKey && p.streetKey === currentStreetKey)
            : [];

        let candidatePool = sameStreetCandidates.length > 0 ? sameStreetCandidates : unvisited;

        let nearestIdxInUnvisited = 0;
        let minDist = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            let candidate = unvisited[i];
            if (candidatePool.includes(candidate)) {
                let d = getRawDist(currentIdx, candidate.matrixIdx);
                if (d < minDist) {
                    minDist = d;
                    nearestIdxInUnvisited = i;
                }
            }
        }

        route.push(unvisited.splice(nearestIdxInUnvisited, 1)[0]);
    }

    let improved = true;
    let count = 0;
    let startI = (manualFirstIdx >= 0) ? 1 : 0;

    while (improved && count < 50) {
        improved = false;
        count++;
        for (let i = startI; i < route.length - 1; i++) {
            for (let j = i + 1; j < route.length; j++) {
                let prevItem = (i === 0) ? null : route[i - 1];
                let prevIdx = prevItem ? prevItem.matrixIdx : originIdx;
                let prevPoint = prevItem || startOrigin;

                let nextItem = (j === route.length - 1) ? null : route[j + 1];
                let nextIdx = nextItem ? nextItem.matrixIdx : destIdx;
                let nextPoint = nextItem || endDestination;

                let d1 = getPenaltyDist(prevIdx, route[i].matrixIdx, prevPoint, route[i]) +
                         getPenaltyDist(route[j].matrixIdx, nextIdx, route[j], nextPoint);

                let d2 = getPenaltyDist(prevIdx, route[j].matrixIdx, prevPoint, route[j]) +
                         getPenaltyDist(route[i].matrixIdx, nextIdx, route[i], nextPoint);

                if (d2 < d1) {
                    let segment = route.slice(i, j + 1).reverse();
                    route.splice(i, j - i + 1, ...segment);
                    improved = true;
                }
            }
        }
    }

    return route.map(({ matrixIdx, ...rest }) => rest);
}

async function solveDeliveriesTSP(deliveries, manualFirstIdx, prioritizeSameStreet) {
    if (!deliveries || deliveries.length === 0) return [];

    if (deliveries.length <= 45) {
        return await optimizeSingleCluster(deliveries, FIXED_PK2U, FIXED_HOME, prioritizeSameStreet, manualFirstIdx);
    }

    let workingDeliveries = [...deliveries];
    let manualFirstPoint = null;

    if (manualFirstIdx >= 0 && manualFirstIdx < workingDeliveries.length) {
        manualFirstPoint = workingDeliveries.splice(manualFirstIdx, 1)[0];
    }

    const clusters = createSpatialClusters(workingDeliveries, 40);

    if (manualFirstPoint) {
        if (clusters.length > 0) {
            clusters[0].unshift(manualFirstPoint);
        } else {
            clusters.push([manualFirstPoint]);
        }
    }

    let finalRoute = [];
    let currentOrigin = FIXED_PK2U;

    for (let c = 0; c < clusters.length; c++) {
        const isLastCluster = (c === clusters.length - 1);
        const nextCluster = isLastCluster ? null : clusters[c + 1];
        const clusterDestination = (nextCluster && nextCluster.length > 0) ? nextCluster[0] : FIXED_HOME;
        const manualIdxInCluster = (c === 0 && manualFirstPoint) ? 0 : -1;

        const optimizedCluster = await optimizeSingleCluster(
            clusters[c],
            currentOrigin,
            clusterDestination,
            prioritizeSameStreet,
            manualIdxInCluster
        );

        finalRoute.push(...optimizedCluster);

        if (optimizedCluster.length > 0) {
            currentOrigin = optimizedCluster[optimizedCluster.length - 1];
        }
    }

    return finalRoute;
}

function applyMarkerJitter(points) {
    const threshold = 0.00012;
    const groups = [];

    points.forEach(p => {
        p._displayLat = p.lat;
        p._displayLng = p.lng;

        let added = false;
        for (let g of groups) {
            let center = g[0];
            let dist = Math.sqrt(Math.pow(p.lat - center.lat, 2) + Math.pow(p.lng - center.lng, 2));
            if (dist < threshold) {
                g.push(p);
                added = true;
                break;
            }
        }
        if (!added) {
            groups.push([p]);
        }
    });

    groups.forEach(g => {
        if (g.length > 1) {
            const stepLng = 0.00006;
            const totalWidth = (g.length - 1) * stepLng;
            const startLng = -totalWidth / 2;

            g.forEach((p, i) => {
                p._displayLat = p.lat;
                p._displayLng = p.lng + startLng + (i * stepLng);
            });
        }
    });
}

/* --- BUSCA O TRAÇADO REAL DAS RUAS PARA A ROTA COMPLETA --- */

async function fetchDeliveryPolyline(orderedDeliveries) {
    if (!orderedDeliveries || orderedDeliveries.length < 2) return null;
    const allCoordinates = orderedDeliveries.map(p => [p.lng, p.lat]);

    const CHUNK_SIZE = 20;
    const chunks = [];

    for (let i = 0; i < allCoordinates.length - 1; i += (CHUNK_SIZE - 1)) {
        const chunk = allCoordinates.slice(i, i + CHUNK_SIZE);
        if (chunk.length >= 2) {
            chunks.push(chunk);
        }
    }

    try {
        const promises = chunks.map(async (chunk) => {
            // 1. Tenta via OpenRouteService
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
                    method: 'POST',
                    headers: {
                        'Authorization': ORS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        coordinates: chunk
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    if (data && data.features && data.features[0] && data.features[0].geometry) {
                        return data.features[0].geometry.coordinates;
                    }
                }
            } catch (e) {}

            // 2. Fallback via OSRM público
            try {
                const coordString = chunk.map(c => `${c[0]},${c[1]}`).join(';');
                const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`);
                if (osrmRes.ok) {
                    const osrmData = await osrmRes.json();
                    if (osrmData && osrmData.routes && osrmData.routes[0] && osrmData.routes[0].geometry) {
                        return osrmData.routes[0].geometry.coordinates;
                    }
                }
            } catch (e) {}

            // 3. Sequência direta do lote se ambos falharem
            return chunk;
        });

        const results = await Promise.all(promises);
        let combinedCoordinates = [];

        results.forEach((coords) => {
            if (combinedCoordinates.length > 0) {
                combinedCoordinates.push(...coords.slice(1));
            } else {
                combinedCoordinates.push(...coords);
            }
        });

        return {
            'type': 'LineString',
            'coordinates': combinedCoordinates.length > 0 ? combinedCoordinates : allCoordinates
        };
    } catch (err) {
        console.warn("Sem conexão / Falha na rota. Utilizando traçado estimado.");
        return {
            'type': 'LineString',
            'coordinates': allCoordinates
        };
    }
}

/* --- CÁLCULO DA DISTÂNCIA TOTAL DO DIA EM KM --- */

async function fetchFullDayTotalDistance(orderedDeliveries) {
    if (!orderedDeliveries || orderedDeliveries.length === 0) return '0';

    const fullCoords = [
        [FIXED_HOME.lng, FIXED_HOME.lat],
        [FIXED_PK2U.lng, FIXED_PK2U.lat],
        ...orderedDeliveries.map(p => [p.lng, p.lat]),
        [FIXED_HOME.lng, FIXED_HOME.lat]
    ];

    const CHUNK_SIZE = 20;
    const chunks = [];

    for (let i = 0; i < fullCoords.length - 1; i += (CHUNK_SIZE - 1)) {
        const chunk = fullCoords.slice(i, i + CHUNK_SIZE);
        if (chunk.length >= 2) {
            chunks.push(chunk);
        }
    }

    try {
        const promises = chunks.map(async (chunk) => {
            // 1. Tenta ORS
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
                    method: 'POST',
                    headers: {
                        'Authorization': ORS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ coordinates: chunk }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    if (data && data.features && data.features[0] && data.features[0].properties) {
                        return data.features[0].properties.summary.distance;
                    }
                }
            } catch (e) {}

            // 2. Fallback OSRM
            try {
                const coordString = chunk.map(c => `${c[0]},${c[1]}`).join(';');
                const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordString}?overview=false`);
                if (osrmRes.ok) {
                    const osrmData = await osrmRes.json();
                    if (osrmData && osrmData.routes && osrmData.routes[0]) {
                        return osrmData.routes[0].distance;
                    }
                }
            } catch (e) {}

            return null;
        });

        const results = await Promise.all(promises);
        let totalMeters = 0;
        let hasSuccess = false;

        results.forEach(dist => {
            if (dist !== null && !isNaN(dist)) {
                totalMeters += dist;
                hasSuccess = true;
            }
        });

        if (hasSuccess) {
            return (totalMeters / 1000).toFixed(1);
        }
    } catch (err) {}

    let totalKm = haversine(FIXED_HOME, FIXED_PK2U);
    totalKm += haversine(FIXED_PK2U, orderedDeliveries[0]);
    for (let i = 0; i < orderedDeliveries.length - 1; i++) {
        totalKm += haversine(orderedDeliveries[i], orderedDeliveries[i + 1]);
    }
    totalKm += haversine(orderedDeliveries[orderedDeliveries.length - 1], FIXED_HOME);
    return totalKm.toFixed(1);
}

/* --- ATUALIZAR TRAÇADO DO SEGMENTO ATUAL NO MODO NAVEGAÇÃO --- */

async function updateNavSegmentRoute(forceIdx = null) {
    if (!activePoints || activePoints.length === 0) return;

    isCustomSearchNav = false;
    document.getElementById('nav-custom-search-actions').classList.add('hidden');
    document.getElementById('nav-delivery-actions').classList.remove('hidden');
    document.getElementById('nav-next-label').textContent = 'Próximo Destino';

    let nextIdx = (typeof forceIdx === 'number' && forceIdx >= 0 && forceIdx < activePoints.length) 
        ? forceIdx 
        : activePoints.findIndex(p => p.status === 'pending');

    if (nextIdx === -1) {
        const pendingCount = activePoints.filter(p => p.status === 'pending').length;
        if (pendingCount === 0) {
            alert("Parabéns! Todas as entregas da lista foram concluídas.");
            if (isNavMode) toggleNavigationMode();
            return;
        }
        nextIdx = 0;
    }

    currentNavIndex = nextIdx;
    const targetPoint = activePoints[nextIdx];
    if (!targetPoint) return;

    const sameAddressPoints = activePoints.filter((p, i) => i >= nextIdx && p.status === 'pending' && p.streetKey === targetPoint.streetKey);

    document.getElementById('nav-next-num').textContent = `${nextIdx + 1}`;
    document.getElementById('nav-next-title').textContent = `${targetPoint.spx}${sameAddressPoints.length > 1 ? ` (+${sameAddressPoints.length - 1} nessa rua)` : ''}`;
    
    const pkgCountPrefix = sameAddressPoints.length > 1 ? `(${sameAddressPoints.length}) ` : '';
    document.getElementById('nav-next-address').textContent = `${pkgCountPrefix}${targetPoint.address} - ${targetPoint.bairro}`;

    let nextPendingPoint = null;
    for (let i = nextIdx + 1; i < activePoints.length; i++) {
        if (activePoints[i].status === 'pending') {
            nextPendingPoint = activePoints[i];
            break;
        }
    }

    const houseNumEl = document.getElementById('nav-next-house-num');
    if (houseNumEl) {
        if (nextPendingPoint && nextPendingPoint.streetKey === targetPoint.streetKey) {
            const num = extractHouseNumber(nextPendingPoint.address);
            if (num) {
                houseNumEl.innerHTML = `Próx. n.: <span class="text-sm sm:text-base font-extrabold text-amber-200 ml-0.5">${num}</span>`;
                houseNumEl.classList.remove('hidden');
            } else {
                houseNumEl.classList.add('hidden');
                houseNumEl.textContent = '';
            }
        } else {
            houseNumEl.classList.add('hidden');
            houseNumEl.textContent = '';
        }
    }

    let startCoord;
    if (lastGpsCoords) {
        startCoord = [lastGpsCoords.lng, lastGpsCoords.lat];
        isFallbackOrigin = false;
    } else {
        startCoord = (nextIdx > 0 ? [activePoints[nextIdx - 1].lng, activePoints[nextIdx - 1].lat] : [FIXED_PK2U.lng, FIXED_PK2U.lat]);
        isFallbackOrigin = true;
    }

    const endCoord = [targetPoint.lng, targetPoint.lat];
    let routeFound = false;

    // 1. Tenta via OpenRouteService
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
            method: 'POST',
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                coordinates: [startCoord, endCoord]
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data && data.features && data.features[0] && data.features[0].geometry) {
                fullNavRouteGeometry = data.features[0].geometry;
                currentRouteGeometry = JSON.parse(JSON.stringify(fullNavRouteGeometry));
                routeFound = true;
            }
        }
    } catch (err) {}

    // 2. Fallback via OSRM público
    if (!routeFound) {
        try {
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startCoord[0]},${startCoord[1]};${endCoord[0]},${endCoord[1]}?overview=full&geometries=geojson`;
            const osrmRes = await fetch(osrmUrl);
            if (osrmRes.ok) {
                const osrmData = await osrmRes.json();
                if (osrmData && osrmData.routes && osrmData.routes[0] && osrmData.routes[0].geometry) {
                    fullNavRouteGeometry = osrmData.routes[0].geometry;
                    currentRouteGeometry = JSON.parse(JSON.stringify(fullNavRouteGeometry));
                    routeFound = true;
                }
            }
        } catch (e) {}
    }

    // 3. Linha reta como último recurso (offline)
    if (!routeFound) {
        fullNavRouteGeometry = { 'type': 'LineString', 'coordinates': [startCoord, endCoord] };
        currentRouteGeometry = JSON.parse(JSON.stringify(fullNavRouteGeometry));
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

function skipCurrentDelivery() {
    if (!activePoints || activePoints.length === 0) return;

    let nextIdx = -1;
    for (let i = currentNavIndex + 1; i < activePoints.length; i++) {
        if (activePoints[i].status === 'pending') {
            nextIdx = i;
            break;
        }
    }

    if (nextIdx === -1) {
        for (let i = 0; i < currentNavIndex; i++) {
            if (activePoints[i].status === 'pending') {
                nextIdx = i;
                break;
            }
        }
    }

    if (nextIdx === -1 || nextIdx === currentNavIndex) {
        alert("Não há outras entregas pendentes na lista para pular.");
        return;
    }

    updateNavSegmentRoute(nextIdx);
}

function navigateToPoint(idx) {
    if (!activePoints || !activePoints[idx]) return;

    if (window.innerWidth < 768) {
        switchMobileTab('map');
    }

    if (!isNavMode) {
        toggleNavigationMode(idx);
    } else {
        updateNavSegmentRoute(idx);
    }
}

function toggleNavigationMode(forceIdx = null) {
    isNavMode = !isNavMode;

    const btnMap = document.getElementById('btn-gps-nav-mode');
    const navHeader = document.getElementById('nav-header-panel');
    const distBadge = document.getElementById('dist-badge');
    const topNavBtnText = document.getElementById('nav-mode-top-text');

    let validIdx = (activePoints && typeof forceIdx === 'number' && forceIdx >= 0 && forceIdx < activePoints.length) ? forceIdx : null;

    if (isNavMode) {
        requestWakeLock();
        btnMap.className = "absolute bottom-48 right-3 z-20 w-11 h-11 bg-amber-400 text-slate-950 backdrop-blur-md rounded-full shadow-2xl border-2 border-white flex items-center justify-center text-lg active:scale-95 transition ring-4 ring-amber-400/30";
        
        if (activePoints && activePoints.length > 0) {
            navHeader.classList.remove('hidden');
        }
        
        distBadge.classList.add('hidden');
        if (topNavBtnText) topNavBtnText.textContent = "Sair da Navegação";

        if (gpsWatchId === null) {
            toggleGPS();
        }

        if (window.innerWidth < 768) {
            switchMobileTab('map');
        }

        if (activePoints && activePoints.length > 0) {
            updateNavSegmentRoute(validIdx);
        } else {
            toggleSearchBox(true);
        }
    } else {
        btnMap.className = "absolute bottom-48 right-3 z-20 w-11 h-11 bg-slate-900/90 hover:bg-slate-800 text-amber-400 backdrop-blur-md rounded-full shadow-2xl border border-slate-700 flex items-center justify-center text-lg active:scale-95 transition";
        navHeader.classList.add('hidden');
        if (activePoints && activePoints.length > 0) {
            distBadge.classList.remove('hidden');
        }
        if (topNavBtnText) topNavBtnText.textContent = "Navegação";

        fullNavRouteGeometry = null;

        map.easeTo({
            bearing: 0,
            pitch: 0,
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            zoom: 13,
            duration: 800
        });

        updateRouteOnMap();
    }
}

function handleFile(file) {
    localStorage.removeItem(STORAGE_KEY);
    currentRouteGeometry = null;
    fullNavRouteGeometry = null;
    currentRouteDistanceKm = '0';
    updateRouteOnMap();
    document.getElementById('dist-badge').classList.add('hidden');
    document.getElementById('file-summary-card').classList.add('hidden');
    document.getElementById('btn-qrcode-scan').disabled = true;

    showLoading("Lendo todas as abas da planilha...");
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            let json = [];
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const sheetJson = XLSX.utils.sheet_to_json(sheet);
                json = json.concat(sheetJson);
            });

            parseAndValidateData(json);
        } catch (err) {
            alert("Erro ao ler arquivo Excel: " + err.message);
        } finally {
            hideLoading();
        }
    };
    reader.readAsArrayBuffer(file);
}

function populateSelect(deliveries) {
    const select = document.getElementById('start-point-select');
    select.innerHTML = '<option value="-1">Automática (Melhor Rota a partir da PK2U)</option>';
    deliveries.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${i + 1}. ${p.spx} - ${p.address.substring(0, 30)}`;
        select.appendChild(opt);
    });
}

function parseAndValidateData(json) {
    rawData = [];
    let skippedCount = 0;
    
    json.forEach((row) => {
        const getVal = (keys) => {
            for (let k of keys) {
                const found = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
                if (found && row[found] !== undefined) return row[found];
            }
            return '';
        };

        const spx = getVal(['SPX TN', 'SPX', 'TN', 'Codigo', 'ID', 'Tracking', 'Pedido']);
        const address = getVal(['Destination Address', 'Endereço', 'Endereco', 'Address', 'Rua']);
        const bairro = getVal(['Bairro', 'Neighborhood', 'District']);
        let lat = parseFloat(String(getVal(['Latitude', 'Lat', 'Latitud'])).replace(',', '.'));
        let lng = parseFloat(String(getVal(['Longitude', 'Lng', 'Long', 'Longitud'])).replace(',', '.'));

        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
            const addrStr = String(address || 'Endereço não informado').trim();
            rawData.push({
                id: rawData.length + 1,
                spx: String(spx || `Entrega #${rawData.length + 1}`).trim(),
                address: addrStr,
                streetKey: normalizeStreetName(addrStr),
                bairro: String(bairro || '-').trim(),
                lat: lat,
                lng: lng,
                status: 'pending'
            });
        } else {
            skippedCount++;
        }
    });

    if (rawData.length === 0) {
        alert("Nenhuma coordenada válida encontrada na planilha! Verifique se as colunas Latitude e Longitude estão preenchidas.");
        return;
    }

    if (skippedCount > 0) {
        console.warn(`${skippedCount} linhas foram ignoradas por não conterem Latitude/Longitude válidas.`);
    }

    populateSelect(rawData);

    document.getElementById('start-point-select').disabled = false;
    document.getElementById('btn-optimize').disabled = false;
    document.getElementById('btn-export-gpx').disabled = false;
    document.getElementById('btn-export').disabled = false;
    document.getElementById('btn-qrcode-scan').disabled = true;

    activePoints = [...rawData];
    renderMapAndUI(activePoints, false);
    updateFileSummaryUI(rawData);
    saveStateToLocalStorage();
}

async function optimizeAndDrawRoute() {
    if (!rawData || rawData.length === 0) {
        alert("Carregue uma planilha XLSX antes de otimizar a rota.");
        return;
    }

    showLoading("Otimizando e agrupando entregas por rua...");
    
    try {
        const firstIdx = parseInt(document.getElementById('start-point-select').value);
        const prioritizeSameStreet = document.getElementById('prioritize-same-street').checked;

        activePoints = await solveDeliveriesTSP(rawData, firstIdx, prioritizeSameStreet);
        await renderMapAndUI(activePoints, true);

        document.getElementById('btn-qrcode-scan').disabled = false;
    } catch (err) {
        console.error("Erro na otimização:", err);
        alert("Erro ao otimizar a rota: " + err.message);
    } finally {
        hideLoading();
    }
}

function setDeliveryStatus(index, newStatus) {
    if (!activePoints[index]) return;

    if (activePoints[index].status === newStatus) {
        activePoints[index].status = 'pending';
    } else {
        activePoints[index].status = newStatus;
    }

    const currentPoint = activePoints[index];

    const marker = markersMap.get(index);
    if (marker) {
        const markerEl = marker.getElement();
        const innerBadge = markerEl.querySelector('.marker-badge');
        if (innerBadge) {
            const styleConfig = getMarkerStyleConfig(index + 1, currentPoint.status);
            innerBadge.className = `marker-badge ${styleConfig.className}`;
            innerBadge.innerHTML = styleConfig.innerHTML;
        }

        const popup = marker.getPopup();
        if (popup) {
            popup.setHTML(createPopupHtml(index, currentPoint));
        }
    }

    updateCounters();
    renderSidebarList(activePoints);

    if (isNavMode) {
        updateNavSegmentRoute();
    }

    saveStateToLocalStorage();
}

function escapeXml(str) {
    if (!str) return '';
    return String(str).replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

function exportToGPX() {
    if (!activePoints || activePoints.length === 0) {
        alert("Nenhuma rota para exportar! Carregue a planilha primeiro.");
        return;
    }

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const dateStr = `${day}-${month}-${now.getFullYear()}`;

    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    gpxContent += `<gpx version="1.1" creator="Roteirizador Entregas" xmlns="http://www.topografix.com/GPX/1/1">\n`;
    gpxContent += `  <metadata>\n`;
    gpxContent += `    <name>Rota Entregas - ${dateStr}</name>\n`;
    gpxContent += `    <desc>Rota de entregas otimizada para o OsmAnd</desc>\n`;
    gpxContent += `  </metadata>\n\n`;

    activePoints.forEach((p, idx) => {
        const name = `${idx + 1}. ${p.spx}`;
        const desc = `${p.address} - ${p.bairro}`;

        gpxContent += `  <wpt lat="${p.lat}" lon="${p.lng}">\n`;
        gpxContent += `    <name>${escapeXml(name)}</name>\n`;
        gpxContent += `    <desc>${escapeXml(desc)}</desc>\n`;
        gpxContent += `    <sym>red-pin</sym>\n`;
        gpxContent += `  </wpt>\n`;
    });

    gpxContent += `\n  <rte>\n`;
    gpxContent += `    <name>Sequencia de Entregas</name>\n`;
    activePoints.forEach((p, idx) => {
        gpxContent += `    <rtept lat="${p.lat}" lon="${p.lng}">\n`;
        gpxContent += `      <name>${idx + 1}. ${escapeXml(p.spx)}</name>\n`;
        gpxContent += `    </rtept>\n`;
    });
    gpxContent += `  </rte>\n`;

    if (currentRouteGeometry && currentRouteGeometry.coordinates && currentRouteGeometry.coordinates.length > 0) {
        gpxContent += `\n  <trk>\n`;
        gpxContent += `    <name>Tracado das Ruas</name>\n`;
        gpxContent += `    <trkseg>\n`;
        currentRouteGeometry.coordinates.forEach(coord => {
            gpxContent += `      <trkpt lat="${coord[1]}" lon="${coord[0]}"></trkpt>\n`;
        });
        gpxContent += `    </trkseg>\n`;
        gpxContent += `  </trk>\n`;
    }

    gpxContent += `\n</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Rota_OsmAnd_${dateStr}.gpx`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function exportToXLSX() {
    if (!activePoints || activePoints.length === 0) return;

    const exportData = activePoints.map((p, idx) => ({
        'Ordem Rota': idx + 1,
        'Status Entrega': p.status === 'success' ? 'SUCESSO' : p.status === 'occurrence' ? 'OCORRÊNCIA' : 'PENDENTE',
        'SPX TN': p.spx,
        'Endereço': p.address,
        'Bairro': p.bairro,
        'Latitude': p.lat,
        'Longitude': p.lng
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Status_Entregas");

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentDateStr = `${day}-${month}-${year}`;

    XLSX.writeFile(wb, `Relatorio_Entregas_Status_${currentDateStr}.xlsx`);
}
