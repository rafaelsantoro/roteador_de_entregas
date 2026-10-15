/* --- REDE: FILA DE REQUISIÇÕES, MATRIZ DE TEMPOS E TRECHOS DE RUA ---
   Regras para gastar pouca internet:
   - Uma única fila, com intervalo mínimo entre requisições (evita bloqueio do servidor).
   - Cada trecho de rua entre duas paradas é baixado UMA vez e guardado no aparelho.
   - Durante o dia o app só usa o que já está salvo; a rede só entra em caso de desvio real. */

const _sleep = ms => new Promise(r => setTimeout(r, ms));
const _r5 = v => Number(v).toFixed(5);

function _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + str.length.toString(36);
}

function _roundCoords(coords) {
    return coords.map(c => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))]);
}

/* ---------- Fila e requisição ---------- */

let _netChain = Promise.resolve();
let _netLastAt = 0;

function netEnqueue(task) {
    const run = _netChain.then(async () => {
        const wait = NET_MIN_GAP_MS - (Date.now() - _netLastAt);
        if (wait > 0) await _sleep(wait);
        try { return await task(); } finally { _netLastAt = Date.now(); }
    });
    _netChain = run.catch(() => {});
    return run;
}

async function netFetchJson(url, options = {}, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        if (!res.ok) {
            const e = new Error('HTTP ' + res.status);
            e.status = res.status;
            throw e;
        }
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

async function netRequest(url, options, timeoutMs, retries = 2) {
    let lastErr;
    for (let a = 0; a <= retries; a++) {
        try {
            return await netEnqueue(() => netFetchJson(url, options, timeoutMs));
        } catch (e) {
            lastErr = e;
            if (!e.status) break;                                         // sem conexão/timeout: insistir só gasta tempo
            if (e.status < 500 && e.status !== 429) break;                // erro do pedido: não adianta repetir
            if (!navigator.onLine) break;
            await _sleep(1200 * (a + 1));
        }
    }
    throw lastErr;
}

function orsHeaders() {
    return { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' };
}

/* ---------- Matriz de tempos (para ordenar as paradas) ---------- */

function estimateDurationSec(a, b) {
    return haversine(a, b) * DETOUR_FACTOR / AVG_SPEED_KMH * 3600;
}

async function osrmTable(coords, sources, destinations) {
    let url = `${OSRM_BASE}/table/v1/driving/${coords.map(c => c[0].toFixed(6) + ',' + c[1].toFixed(6)).join(';')}?annotations=duration`;
    if (sources) url += `&sources=${sources.join(';')}`;
    if (destinations) url += `&destinations=${destinations.join(';')}`;
    const d = await netRequest(url, {}, 20000);
    if (!d || d.code !== 'Ok' || !d.durations) throw new Error('osrm table');
    return d.durations;
}

async function orsTable(coords, sources, destinations) {
    const body = { locations: coords, metrics: ['duration'] };
    if (sources) body.sources = sources;
    if (destinations) body.destinations = destinations;
    const d = await netRequest(`${ORS_BASE}/v2/matrix/driving-car`,
        { method: 'POST', headers: orsHeaders(), body: JSON.stringify(body) }, 20000, 1);
    if (!d || !d.durations) throw new Error('ors table');
    return d.durations;
}

// Um "bloco" da matriz: origens srcIdx x destinos dstIdx (índices da lista completa)
async function matrixTile(locs, srcIdx, dstIdx) {
    const union = Array.from(new Set([...srcIdx, ...dstIdx]));
    const pos = new Map(union.map((g, i) => [g, i]));
    const coords = union.map(g => [locs[g].lng, locs[g].lat]);
    const sources = srcIdx.map(g => pos.get(g));
    const dests = dstIdx.map(g => pos.get(g));
    const full = sources.length === union.length && dests.length === union.length &&
        sources.every((s, i) => s === i) && dests.every((s, i) => s === i);

    const key = 'mx:' + _hash(coords.map(c => c[0].toFixed(5) + ',' + c[1].toFixed(5)).join(';') +
        '|' + sources.join(',') + '|' + dests.join(','));

    const cached = await Store.get(key);
    if (cached) return cached;
    if (!navigator.onLine) return null;

    let res = null;
    for (const prov of ROUTING_PROVIDERS) {
        try {
            res = prov === 'osrm'
                ? await osrmTable(coords, full ? null : sources, full ? null : dests)
                : await orsTable(coords, full ? null : sources, full ? null : dests);
            if (res) break;
        } catch (e) { res = null; }
    }
    if (res) {
        res = res.map(row => row.map(v => (v == null ? null : Math.round(v))));
        Store.set(key, res);
    }
    return res;
}

async function buildDurationMatrix(locs, onProgress) {
    const m = locs.length;
    const dur = Array.from({ length: m }, () => new Array(m).fill(0));
    const blockSize = m <= OSRM_MAX_COORDS ? m : MATRIX_BLOCK;
    const blocks = [];
    for (let s = 0; s < m; s += blockSize) {
        blocks.push(Array.from({ length: Math.min(blockSize, m - s) }, (_, i) => s + i));
    }

    const totalTiles = blocks.length * blocks.length;
    let done = 0, estimatedTiles = 0;

    for (const bi of blocks) {
        for (const bj of blocks) {
            let res = null;
            try { res = await matrixTile(locs, bi, bj); } catch (e) {}
            let estimated = false;
            bi.forEach((a, ia) => bj.forEach((b, ib) => {
                if (a === b) { dur[a][b] = 0; return; }
                let v = res && res[ia] ? res[ia][ib] : null;
                if (v == null || isNaN(v)) { v = estimateDurationSec(locs[a], locs[b]); estimated = true; }
                dur[a][b] = v;
            }));
            if (estimated) estimatedTiles++;
            done++;
            if (onProgress) onProgress(done, totalTiles);
        }
    }
    return { dur, totalTiles, estimatedTiles };
}

/* ---------- Trechos de rua entre paradas (salvos no aparelho) ---------- */

const legCache = new Map(); // chave -> { c: [[lng,lat],...], d: metros, t: segundos }

function legKey(a, b) {
    return `leg:${_r5(a.lng)},${_r5(a.lat)}|${_r5(b.lng)},${_r5(b.lat)}`;
}

// Descobre em qual vértice da linha cada parada fica (para dividir a rota em trechos)
function splitRouteGeometry(coords, wpLocs) {
    const idx = [0];
    let from = 0;
    for (let k = 1; k < wpLocs.length; k++) {
        if (k === wpLocs.length - 1) { idx.push(coords.length - 1); continue; }
        const target = wpLocs[k];
        let best = from, bd = Infinity;
        for (let i = from; i < coords.length; i++) {
            const dx = coords[i][0] - target[0], dy = coords[i][1] - target[1];
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; if (d < 1e-14) break; }
        }
        idx.push(best);
        from = best;
    }
    return idx;
}

function sliceLeg(coords, a, b) {
    let seg = coords.slice(a, b + 1);
    if (seg.length < 2) seg = [coords[a], coords[a]];
    return seg;
}

async function osrmRouteChunk(wps) {
    const cs = wps.map(p => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
    const d = await netRequest(`${OSRM_BASE}/route/v1/driving/${cs}?overview=full&geometries=geojson&steps=false`, {}, 25000);
    if (!d || d.code !== 'Ok' || !d.routes || !d.routes[0]) throw new Error('osrm route');
    const rt = d.routes[0];
    const coords = rt.geometry.coordinates;
    const idx = splitRouteGeometry(coords, d.waypoints.map(w => w.location));
    return rt.legs.map((lg, k) => ({
        c: _roundCoords(sliceLeg(coords, idx[k], idx[k + 1])),
        d: lg.distance,
        t: lg.duration
    }));
}

async function orsRouteChunk(wps) {
    if (wps.length > 50) { // limite de paradas por pedido no ORS
        const mid = Math.floor(wps.length / 2);
        const a = await orsRouteChunk(wps.slice(0, mid + 1));
        const b = await orsRouteChunk(wps.slice(mid));
        return a.concat(b);
    }
    const d = await netRequest(`${ORS_BASE}/v2/directions/driving-car/geojson`,
        { method: 'POST', headers: orsHeaders(), body: JSON.stringify({ coordinates: wps.map(p => [p.lng, p.lat]) }) }, 25000, 1);
    const f = d && d.features && d.features[0];
    if (!f) throw new Error('ors route');
    const coords = f.geometry.coordinates;
    const wp = f.properties.way_points;
    return f.properties.segments.map((s, k) => ({
        c: _roundCoords(sliceLeg(coords, wp[k], wp[k + 1])),
        d: s.distance,
        t: s.duration
    }));
}

async function fetchRouteLegs(wps) {
    for (const prov of ROUTING_PROVIDERS) {
        try {
            const legs = prov === 'osrm' ? await osrmRouteChunk(wps) : await orsRouteChunk(wps);
            if (legs && legs.length === wps.length - 1) return legs;
        } catch (e) {}
    }
    return null;
}

// Carrega do aparelho (sem internet) os trechos que já existem
async function loadLegsFromStore(waypoints) {
    const keys = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const k = legKey(waypoints[i], waypoints[i + 1]);
        if (!legCache.has(k)) keys.push(k);
    }
    if (keys.length) {
        const stored = await Store.getMany(keys);
        keys.forEach((k, i) => { if (stored[i]) legCache.set(k, stored[i]); });
    }
    for (let i = 0; i < waypoints.length - 1; i++) { // paradas no mesmo ponto: trecho vazio
        const k = legKey(waypoints[i], waypoints[i + 1]);
        if (!legCache.has(k) && haversine(waypoints[i], waypoints[i + 1]) * 1000 < 3) {
            legCache.set(k, { c: [], d: 0, t: 0 });
        }
    }
}

// Baixa somente os trechos que faltam. Retorna quantos continuam faltando.
async function ensureLegs(waypoints, onProgress) {
    await loadLegsFromStore(waypoints);

    const missing = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const k = legKey(waypoints[i], waypoints[i + 1]);
        if (!legCache.has(k)) missing.push({ i, a: waypoints[i], b: waypoints[i + 1], key: k });
    }
    if (missing.length === 0 || !navigator.onLine) return missing.length;

    // agrupa trechos consecutivos em pedidos de até ROUTE_CHUNK_WAYPOINTS paradas
    const runs = [];
    let run = [];
    missing.forEach(p => {
        if (run.length && (p.i !== run[run.length - 1].i + 1 || run.length >= ROUTE_CHUNK_WAYPOINTS - 1)) {
            runs.push(run); run = [];
        }
        run.push(p);
    });
    if (run.length) runs.push(run);

    let done = 0, failsInRow = 0;
    for (const r of runs) {
        const wps = [r[0].a, ...r.map(p => p.b)];
        const legs = await fetchRouteLegs(wps);
        if (legs) {
            failsInRow = 0;
            const entries = [];
            r.forEach((p, k) => { legCache.set(p.key, legs[k]); entries.push([p.key, legs[k]]); });
            Store.setMany(entries);
            done += r.length;
        } else {
            failsInRow++;
            if (failsInRow >= 2 || !navigator.onLine) break; // provavelmente sem rede: para de insistir
        }
        if (onProgress) onProgress(done, missing.length);
    }
    return missing.length - done;
}

/* ---------- Rota de navegação (veículo -> próxima parada) ---------- */

const _navMemo = new Map();

async function getNavRoute(from, to) {
    if (!navigator.onLine) return null;
    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    if (_navMemo.has(key)) return _navMemo.get(key);
    const legs = await fetchRouteLegs([from, to]);
    if (!legs || !legs[0]) return null;
    if (_navMemo.size > 30) _navMemo.delete(_navMemo.keys().next().value);
    _navMemo.set(key, legs[0]);
    return legs[0];
}
