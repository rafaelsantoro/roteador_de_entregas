/* --- SOLVER DE ORDENAÇÃO DAS PARADAS ---
   Índices: 0 = início fixo (PK2U), 1..n = paradas, n+1 = fim fixo (Casa).
   - Custos assimétricos (ruas de mão única): Or-opt + 2-opt com custo exato.
   - "Mesma rua" vira uma penalidade por troca de rua (não um bloco rígido).
   - Determinístico: a mesma planilha gera sempre a mesma ordem. */

function _mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function solverBuildWeights(dur, streetKeys, penalty) {
    const m = dur.length;
    const W = new Array(m);
    for (let a = 0; a < m; a++) {
        W[a] = new Float64Array(m);
        for (let b = 0; b < m; b++) {
            let c = dur[a][b];
            if (a !== b && penalty > 0 && streetKeys[a] !== streetKeys[b]) c += penalty;
            W[a][b] = c;
        }
    }
    return W;
}

function solverRouteCost(W, r) {
    const END = W.length - 1;
    if (r.length === 0) return W[0][END];
    let c = W[0][r[0]];
    for (let i = 0; i < r.length - 1; i++) c += W[r[i]][r[i + 1]];
    return c + W[r[r.length - 1]][END];
}

function solverNearestNeighbor(W, n, firstFixed) {
    const used = new Uint8Array(n + 2);
    const r = [];
    let cur = 0;
    if (firstFixed > 0) { r.push(firstFixed); used[firstFixed] = 1; cur = firstFixed; }
    while (r.length < n) {
        let best = -1, bc = Infinity;
        for (let c = 1; c <= n; c++) {
            if (used[c]) continue;
            const w = W[cur][c];
            if (w < bc) { bc = w; best = c; }
        }
        r.push(best); used[best] = 1; cur = best;
    }
    return r;
}

// lo = 1 quando a primeira parada é fixa (escolhida pelo usuário)
function solverLocalSearch(W, r, lo) {
    const n = r.length;
    const END = W.length - 1;
    const F = new Float64Array(n);
    const B = new Float64Array(n);
    const rebuild = () => {
        F[0] = 0; B[0] = 0;
        for (let k = 1; k < n; k++) {
            F[k] = F[k - 1] + W[r[k - 1]][r[k]];
            B[k] = B[k - 1] + W[r[k]][r[k - 1]];
        }
    };

    let improved = true, guard = 0;
    while (improved && guard++ < 200) {
        improved = false;

        // Or-opt: move trechos de 1 a 3 paradas (sem inverter) para outra posição
        for (let len = 1; len <= 3; len++) {
            for (let i = lo; i + len <= n; i++) {
                const prev = i === 0 ? 0 : r[i - 1];
                const next = i + len === n ? END : r[i + len];
                const sf = r[i], sl = r[i + len - 1];
                const removeGain = W[prev][sf] + W[sl][next] - W[prev][next];
                if (removeGain <= 1e-9) continue;

                const rem = r.slice(0, i).concat(r.slice(i + len));
                let bestDelta = -1e-9, bestP = -1;
                for (let p = lo; p <= rem.length; p++) {
                    const a = p === 0 ? 0 : rem[p - 1];
                    const b = p === rem.length ? END : rem[p];
                    const delta = W[a][sf] + W[sl][b] - W[a][b] - removeGain;
                    if (delta < bestDelta) { bestDelta = delta; bestP = p; }
                }
                if (bestP >= 0) {
                    const seg = r.slice(i, i + len);
                    r.splice(i, len);
                    r.splice(bestP, 0, ...seg);
                    improved = true;
                }
            }
        }

        // 2-opt com custo assimétrico exato (prefixos para frente e para trás)
        rebuild();
        for (let i = lo; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                const prev = i === 0 ? 0 : r[i - 1];
                const next = j === n - 1 ? END : r[j + 1];
                const fwd = F[j] - F[i];
                const bwd = B[j] - B[i];
                const delta = W[prev][r[j]] + bwd + W[r[i]][next] - W[prev][r[i]] - fwd - W[r[j]][next];
                if (delta < -1e-9) {
                    for (let x = i, y = j; x < y; x++, y--) { const t = r[x]; r[x] = r[y]; r[y] = t; }
                    rebuild();
                    improved = true;
                }
            }
        }
    }
    return r;
}

// Double-bridge: reorganiza 3 cortes aleatórios (respeitando a 1ª parada fixa)
function solverPerturb(r, lo, rnd) {
    const n = r.length;
    if (n - lo < 4) return r.slice();
    const span = n - lo - 1;
    const cuts = new Set();
    while (cuts.size < 3) cuts.add(lo + 1 + Math.floor(rnd() * span));
    const [a, b, c] = Array.from(cuts).sort((x, y) => x - y);
    return r.slice(0, a).concat(r.slice(b, c), r.slice(a, b), r.slice(c));
}

/* dur: matriz (n+2)x(n+2) de tempos em segundos. streetKeys: n+2 chaves de rua.
   Retorna a ordem das paradas (valores 1..n). */
async function solveRoute({ dur, streetKeys, penalty = 0, firstFixed = 0, iterations = 300, timeMs = 2500 }) {
    const m = dur.length;
    const n = m - 2;
    if (n <= 0) return [];

    const W = solverBuildWeights(dur, streetKeys, penalty);
    const lo = firstFixed > 0 ? 1 : 0;

    let best = solverNearestNeighbor(W, n, firstFixed);
    solverLocalSearch(W, best, lo);
    let bestCost = solverRouteCost(W, best);
    if (n < 5) return best;

    const rnd = _mulberry32(n * 7919 + 13);
    let cur = best.slice();
    let curCost = bestCost;
    const t0 = Date.now();
    let lastYield = t0;

    for (let it = 0; it < iterations && Date.now() - t0 < timeMs; it++) {
        const cand = solverPerturb(cur, lo, rnd);
        solverLocalSearch(W, cand, lo);
        const c = solverRouteCost(W, cand);
        if (c < curCost - 1e-9) {
            cur = cand; curCost = c;
            if (c < bestCost - 1e-9) { best = cand.slice(); bestCost = c; }
        }
        if (Date.now() - lastYield > 30) {
            await new Promise(res => setTimeout(res, 0)); // deixa a tela respirar
            lastYield = Date.now();
        }
    }
    return best;
}
