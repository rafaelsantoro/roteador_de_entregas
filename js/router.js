/* --- CÁLCULO DE ROTAS, TSP E EXPORTAÇÕES --- */

function extractHouseNumber(address) {
    if (!address || typeof address !== 'string') return null;
    let parts = address.split(',');
    if (parts.length > 1) {
        let afterComma = parts[1].trim().split('-')[0].split('(')[0].trim();
        let match = afterComma.match(/\d+/);
        if (match) return parseInt(match[0], 10);
    }
    let matchNoComma = address.split('-')[0].match(/\b\d+\b/);
    if (matchNoComma) return parseInt(matchNoComma[0], 10);
    return null;
}

function normalizeStreetName(address) {
    if (!address || typeof address !== 'string') return '';
    
    let part = address.split(',')[0].split('-')[0].trim();
    part = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    
    part = part.replace(/\bprof\b|\bprof\./g, 'professor')
               .replace(/\bdr\b|\bdr\./g, 'doutor')
               .replace(/\bdra\b|\bdra\./g, 'doutora')
               .replace(/\bs\b|\bs\./g, 'sao')
               .replace(/\bsto\b|\bsto\./g, 'santo')
               .replace(/\bsta\b|\bsta\./g, 'santa')
               .replace(/\bjd\b|\bjd\./g, 'jardim')
               .replace(/\bvl\b|\bvl\./g, 'vila')
               .replace(/\bpq\b|\bpq\./g, 'parque')
               .replace(/\bres\b|\bres\./g, 'residencial');
               
    part = part.replace(/^(rua|r\.|r|avenida|av\.|av|alameda|al\.|al|praca|prc\.|prc|travessa|trv\.|trv|rodovia|rod\.|rod)\s+/, '');
    part = part.replace(/\s+\d+[a-z]?\s*$/i, '');
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

/* --- CHAVES DE RUA (rua + bairro, tolerante a erros de digitação) --- */

function normalizeText(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isSimilarStreet(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4) {
        const dist = levenshteinDistance(a, b);
        const maxLen = Math.max(a.length, b.length);
        return dist <= 2 && (1 - dist / maxLen) >= 0.80;
    }
    return false;
}

// Mesma rua em bairros diferentes NÃO é a mesma rua. Pequenos erros de digitação são unificados.
function assignStreetKeys(items) {
    const groups = [];
    items.forEach(it => {
        const name = normalizeStreetName(it.address);
        const bairro = normalizeText(it.bairro === '-' ? '' : it.bairro);
        if (!name) { it.streetKey = ''; return; }
        let g = groups.find(x => x.bairro === bairro && isSimilarStreet(x.name, name));
        if (!g) {
            g = { name, bairro, key: name + '|' + bairro };
            groups.push(g);
        }
        it.streetKey = g.key;
    });
}

/* --- PARADAS: pacotes no mesmo ponto viram uma única parada (matriz menor = menos internet) --- */

function groupStops(points) {
    const stops = [];
    points.forEach(p => {
        const s = stops.find(st => haversine(st, p) * 1000 <= SAME_LOCATION_METERS);
        if (s) s.pts.push(p);
        else stops.push({ lat: p.lat, lng: p.lng, pts: [p], streetKey: p.streetKey || '' });
    });
    return stops;
}

/* --- ORDENAÇÃO DA ROTA ---
   Casa e PK2U só entram no cálculo (distância do dia); não são desenhadas.
   Início fixo na PK2U e fim fixo em Casa. */

async function solveDeliveriesTSP(deliveries, manualFirstIdx, prioritizeSameStreet, onStatus) {
    lastSolveInfo = null;
    if (!deliveries || deliveries.length === 0) return [];

    const say = (t) => { if (onStatus) onStatus(t); };
    const stops = groupStops(deliveries);
    const locs = [FIXED_PK2U, ...stops, FIXED_HOME];

    say('Calculando tempos de viagem entre as paradas...');
    const { dur, totalTiles, estimatedTiles } = await buildDurationMatrix(locs, (d, t) => {
        say(`Calculando tempos de viagem (${d}/${t})...`);
    });

    const streetKeys = ['__inicio', ...stops.map((s, i) => s.streetKey || ('__avulsa' + i)), '__fim'];

    let firstFixed = 0;
    const manualPoint = (manualFirstIdx >= 0 && manualFirstIdx < deliveries.length) ? deliveries[manualFirstIdx] : null;
    if (manualPoint) firstFixed = stops.findIndex(s => s.pts.includes(manualPoint)) + 1;

    say('Definindo a melhor ordem das entregas...');
    const order = await solveRoute({
        dur,
        streetKeys,
        penalty: prioritizeSameStreet ? SAME_STREET_PENALTY_SEC : 0,
        firstFixed
    });

    const result = [];
    order.forEach(stopIdx => {
        const stop = stops[stopIdx - 1];
        const pts = stop.pts.slice();
        if (manualPoint && pts.includes(manualPoint)) { // o pacote escolhido como 1ª entrega vai primeiro
            pts.splice(pts.indexOf(manualPoint), 1);
            pts.unshift(manualPoint);
        }
        result.push(...pts);
    });

    lastSolveInfo = { stops: stops.length, packages: deliveries.length, totalTiles, estimatedTiles };
    return result;
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

/* --- ROTA PLANEJADA: trechos de rua entre as entregas, salvos no aparelho ---
   Casa -> PK2U -> 1ª entrega e última entrega -> Casa entram só na distância total.
   Só os trechos entre entregas são desenhados no mapa. */

let _legsBusy = false;

function getPlanWaypoints(points) {
    return [FIXED_HOME, FIXED_PK2U, ...points.map(p => ({ lat: p.lat, lng: p.lng })), FIXED_HOME];
}

function getPlannedFlatCoords() {
    const flat = [];
    (plannedLegGeoms || []).forEach(g => {
        if (g && g.length > 1) {
            for (let i = flat.length ? 1 : 0; i < g.length; i++) flat.push(g[i]);
        }
    });
    return flat;
}

function updateRouteStatusUI() {
    const el = document.getElementById('route-status');
    const btn = document.getElementById('btn-retry-legs');
    const { total, ready } = routeLegsStatus;

    if (el) {
        if (!total) {
            el.textContent = 'Nenhuma rota calculada.';
        } else if (ready >= total) {
            el.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i>Rota completa salva no aparelho (${ready}/${total} trechos). Funciona sem internet.`;
        } else {
            el.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-600 mr-1"></i>${ready}/${total} trechos salvos. Conecte-se para completar (linhas tracejadas = pendentes).`;
        }
    }
    if (btn) btn.classList.toggle('hidden', !(total && ready < total));

    const dt = document.getElementById('dist-text');
    if (dt && total) {
        // Cálculo do tempo estimado
        const totalPackages = activePoints ? activePoints.length : 0;
        const deliveryTimeMinutes = totalPackages * 1; // 1 minuto por pacote

        // Estima o tempo de direção (se não houver matriz, usa 25 km/h)
        const driveTimeMinutes = Math.round((parseFloat(currentRouteDistanceKm) / AVG_SPEED_KMH) * 60);
        const totalMinutes = driveTimeMinutes + deliveryTimeMinutes;

        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const timeFormatted = hours > 0 ? `${hours}h ${mins}min` : `${mins} min`;

        dt.textContent = `${ready < total ? '≈ ' : ''}${currentRouteDistanceKm} km | ⏱️ ${timeFormatted}`;
    }
}

// Monta tudo a partir do que está guardado no aparelho (sem internet)
function refreshPlannedFromCache(points) {
    const wps = getPlanWaypoints(points);
    const n = points.length;
    const totalPairs = wps.length - 1;
    let sumM = 0, estM = 0, ready = 0;

    plannedLegGeoms = new Array(Math.max(0, n - 1)).fill(null);
    plannedGapSegments = [];

    for (let i = 0; i < totalPairs; i++) {
        const leg = legCache.get(legKey(wps[i], wps[i + 1]));
        if (leg) { ready++; sumM += leg.d; }
        else estM += haversine(wps[i], wps[i + 1]) * 1000 * DETOUR_FACTOR;

        if (i >= 2 && i <= n) { // pares entre entregas (os 3 trechos extras só contam distância)
            const k = i - 2;
            if (leg) plannedLegGeoms[k] = leg.c;
            else plannedGapSegments.push([[wps[i].lng, wps[i].lat], [wps[i + 1].lng, wps[i + 1].lat]]);
        }
    }

    const flat = getPlannedFlatCoords();
    currentRouteGeometry = flat.length > 1 ? { type: 'LineString', coordinates: flat } : null;
    currentRouteDistanceKm = ((sumM + estM) / 1000).toFixed(1);
    routeLegsStatus = { total: totalPairs, ready };
    updateRouteStatusUI();
}

async function buildPlannedRoute(points, showProgress = false) {
    if (!points || points.length === 0) return;
    await ensureLegs(getPlanWaypoints(points), (done, total) => {
        if (showProgress) showLoading(`Baixando ruas para uso offline (${done}/${total} trechos)...`);
    });
    refreshPlannedFromCache(points);
}

// Ao abrir o app: usa o que está salvo e só completa o que faltar se houver internet
async function restorePlannedRoute() {
    if (!activePoints || activePoints.length === 0) return;
    await loadLegsFromStore(getPlanWaypoints(activePoints));
    refreshPlannedFromCache(activePoints);
    updateRouteOnMap();
    if (navigator.onLine && routeLegsStatus.ready < routeLegsStatus.total) retryMissingLegs(false);
}

async function retryMissingLegs(manual = false) {
    if (_legsBusy || !activePoints || activePoints.length === 0) return;
    if (!navigator.onLine) {
        if (manual) alert('Sem internet no momento. Tente novamente quando houver sinal.');
        return;
    }
    _legsBusy = true;
    try {
        if (manual) showLoading('Baixando trechos pendentes...');
        await buildPlannedRoute(activePoints, manual);
        updateRouteOnMap();
    } finally {
        _legsBusy = false;
        if (manual) hideLoading();
    }
}

/* --- GUIA DE NAVEGAÇÃO (veículo -> próxima entrega) ---
   1º usa o trecho planejado que já está no aparelho (zero internet).
   2º só consulta a rede se o veículo realmente saiu da rota, no máximo 1x a cada 20 s,
      com espera maior depois de falhas.
   3º sem rede: linha reta TRACEJADA como guia. A rota planejada nunca é alterada. */

function nearestOnLine(coords, lat, lng) {
    const kLng = Math.cos(lat * Math.PI / 180);
    const M = 111320;
    let best = { distM: Infinity, segIdx: 0 };
    for (let i = 0; i < coords.length - 1; i++) {
        const ax = (coords[i][0] - lng) * kLng, ay = coords[i][1] - lat;
        const bx = (coords[i + 1][0] - lng) * kLng, by = coords[i + 1][1] - lat;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, py = ay + t * dy;
        const d = Math.sqrt(px * px + py * py) * M;
        if (d < best.distM) best = { distM: d, segIdx: i };
    }
    return best;
}

let _navBusy = false;

async function computeNavGeometry(targetIdx, force = false) {
    const target = activePoints[targetIdx];
    if (!target) return;
    const gps = lastGpsCoords;
    navGuideIsStraight = false;

    const leg = targetIdx > 0 ? plannedLegGeoms[targetIdx - 1] : null; // trecho planejado: parada anterior -> esta

    if (!gps) { // sem GPS: mostra só o trecho planejado (nunca PK2U -> 1ª entrega)
        fullNavRouteGeometry = (leg && leg.length > 1) ? { type: 'LineString', coordinates: leg } : null;
        return;
    }

    if (leg && leg.length > 1) {
        const nr = nearestOnLine(leg, gps.lat, gps.lng);
        if (nr.distM <= NAV_OFFROUTE_METERS) { // está na rota planejada: sem internet
            fullNavRouteGeometry = { type: 'LineString', coordinates: [[gps.lng, gps.lat], ...leg.slice(nr.segIdx + 1)] };
            return;
        }
    }

    if ((force || Date.now() >= navBlockedUntil) && !_navBusy && navigator.onLine) {
        _navBusy = true;
        let res = null;
        try {
            res = await getNavRoute({ lat: gps.lat, lng: gps.lng }, { lat: target.lat, lng: target.lng });
        } catch (e) { res = null; }
        _navBusy = false;

        if (currentNavIndex !== targetIdx) return; // o destino mudou enquanto consultava

        if (res && res.c && res.c.length > 1) {
            fullNavRouteGeometry = { type: 'LineString', coordinates: res.c };
            navFailCount = 0;
            navBlockedUntil = Date.now() + NAV_MIN_INTERVAL_MS;
            return;
        }
        navFailCount++;
        navBlockedUntil = Date.now() + Math.min(300000, NAV_MIN_INTERVAL_MS * Math.pow(2, navFailCount - 1));
    }

    fullNavRouteGeometry = { type: 'LineString', coordinates: [[gps.lng, gps.lat], [target.lng, target.lat]] };
    navGuideIsStraight = true;
}

function refreshNavTarget(force) {
    if (isCustomSearchNav) {
        if (searchMarker && (force || Date.now() >= navBlockedUntil)) {
            const ll = searchMarker.getLngLat();
            navigateToSearchLocation(ll.lat, ll.lng, document.getElementById('nav-next-address').textContent);
        }
        return;
    }
    const idx = currentNavIndex;
    computeNavGeometry(idx, force).then(() => { if (currentNavIndex === idx) updateNavLayer(); });
}

// Chamada a cada posição de GPS (≈1x por segundo) – leve e sem internet na maior parte do tempo
function onNavGpsUpdate(lat, lng) {
    if (!isNavMode) return;

    let target = null;
    if (isCustomSearchNav) {
        if (searchMarker) { const ll = searchMarker.getLngLat(); target = { lat: ll.lat, lng: ll.lng }; }
    } else if (currentNavIndex >= 0 && activePoints[currentNavIndex]) {
        target = activePoints[currentNavIndex];
    }
    if (!target) return;

    const here = { lat, lng };
    const dTarget = haversine(here, target) * 1000;

    if (isFallbackOrigin) { // navegação começou antes do primeiro sinal de GPS
        isFallbackOrigin = false;
        refreshNavTarget(true);
        return;
    }

    const geom = (fullNavRouteGeometry && !navGuideIsStraight) ? fullNavRouteGeometry.coordinates : null;
    if (geom && geom.length > 1) {
        const nr = nearestOnLine(geom, lat, lng);
        if (nr.distM <= NAV_OFFROUTE_METERS || dTarget <= NAV_ARRIVED_METERS) {
            fullNavRouteGeometry = { type: 'LineString', coordinates: [[lng, lat], ...geom.slice(nr.segIdx + 1)] };
            updateNavLayer();
            return;
        }
    }

    if (dTarget <= NAV_ARRIVED_METERS || navGuideIsStraight) { // guia curto/sem rede acompanha o veículo
        fullNavRouteGeometry = { type: 'LineString', coordinates: [[lng, lat], [target.lng, target.lat]] };
        navGuideIsStraight = true;
        updateNavLayer();
        if (dTarget <= NAV_ARRIVED_METERS) return;
    }

    const now = Date.now();
    if (now - lastRecalcTime < 3000) return;
    lastRecalcTime = now;
    refreshNavTarget(false);
}

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

    const sameAddressPoints = activePoints.filter((p, i) => i >= nextIdx && p.status === 'pending' &&
        (p === targetPoint || (targetPoint.streetKey && p.streetKey === targetPoint.streetKey)));

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
        if (nextPendingPoint && targetPoint.streetKey && nextPendingPoint.streetKey === targetPoint.streetKey) {
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

    isFallbackOrigin = !lastGpsCoords;
    await computeNavGeometry(nextIdx, true);
    updateRouteOnMap();

    if (map) {
        const center = lastGpsCoords ? [lastGpsCoords.lng, lastGpsCoords.lat] : [targetPoint.lng, targetPoint.lat];
        map.flyTo({
            center,
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
    plannedLegGeoms = [];
    plannedGapSegments = [];
    routeLegsStatus = { total: 0, ready: 0 };
    routeIsOptimized = false;
    legCache.clear();
    Store.clearPrefix('leg:');
    updateRouteStatusUI();
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
                status: 'pending',
				scanned: false // Indica se o pacote foi conferido via QR Code
            });
        } else {
            skippedCount++;
        }
    });

    assignStreetKeys(rawData);

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
    if (isNavMode) {
        alert("Saia do modo navegação antes de otimizar a rota.");
        return;
    }

    // Proteção da numeração: os pacotes já estão etiquetados/separados pela ordem atual
    if (routeIsOptimized) {
        const hasProgress = activePoints.some(p => p.status !== 'pending');
        const msg = hasProgress
            ? "ATENÇÃO: a rota já está em andamento.\n\nOtimizar de novo pode MUDAR A NUMERAÇÃO dos pacotes e eles deixarão de bater com a ordem que você já separou.\n\nTem certeza que deseja continuar?"
            : "Esta rota já foi otimizada.\n\nOtimizar de novo pode mudar a numeração dos pacotes que você já separou.\n\nDeseja continuar?";
        if (!confirm(msg)) return;
    }

    if (!navigator.onLine) {
        const ok = confirm("Sem internet: a ordem será calculada por estimativa em linha reta (menos precisa) e as ruas não poderão ser baixadas.\n\nO ideal é otimizar com internet, antes de sair.\n\nContinuar mesmo assim?");
        if (!ok) return;
    }

    showLoading("Otimizando e agrupando entregas por rua...");

    try {
        const firstIdx = parseInt(document.getElementById('start-point-select').value);
        const prioritizeSameStreet = document.getElementById('prioritize-same-street').checked;

        activePoints = await solveDeliveriesTSP(rawData, firstIdx, prioritizeSameStreet, showLoading);
        routeIsOptimized = true;
        await renderMapAndUI(activePoints, true);

        document.getElementById('btn-qrcode-scan').disabled = false;

        if (lastSolveInfo && lastSolveInfo.estimatedTiles > 0) {
            alert("Parte dos tempos de viagem foi estimada em linha reta por falta de internet. A ordem pode ficar menos precisa.");
        }
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

    const trackCoords = getPlannedFlatCoords();
    if (trackCoords.length > 0) {
        gpxContent += `\n  <trk>\n`;
        gpxContent += `    <name>Tracado das Ruas</name>\n`;
        gpxContent += `    <trkseg>\n`;
        trackCoords.forEach(coord => {
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
