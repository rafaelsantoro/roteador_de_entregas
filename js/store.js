/* --- ARMAZENAMENTO LOCAL (IndexedDB) ---
   Guarda no aparelho os trechos de rua e as matrizes de tempo já baixados,
   para que o app NÃO precise consultar a internet de novo durante o dia. */

const Store = (() => {
    const DB_NAME = 'roteador-store';
    const STORE = 'kv';
    const mem = new Map(); // reserva caso o IndexedDB não esteja disponível
    let dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { reject(new Error('IndexedDB indisponível')); return; }
            const rq = indexedDB.open(DB_NAME, 1);
            rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
            rq.onsuccess = () => resolve(rq.result);
            rq.onerror = () => reject(rq.error);
        });
        return dbPromise;
    }

    async function run(mode, fn) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const store = tx.objectStore(STORE);
            const out = fn(store);
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async function get(key) {
        try {
            const req = await run('readonly', s => s.get(key));
            return req && req.result !== undefined ? req.result : mem.get(key);
        } catch (e) { return mem.get(key); }
    }

    async function getMany(keys) {
        try {
            const reqs = await run('readonly', s => keys.map(k => s.get(k)));
            return reqs.map((r, i) => (r.result !== undefined ? r.result : mem.get(keys[i])));
        } catch (e) { return keys.map(k => mem.get(k)); }
    }

    async function set(key, value) {
        try { await run('readwrite', s => s.put(value, key)); }
        catch (e) { mem.set(key, value); }
    }

    async function setMany(entries) {
        try { await run('readwrite', s => { entries.forEach(([k, v]) => s.put(v, k)); }); }
        catch (e) { entries.forEach(([k, v]) => mem.set(k, v)); }
    }

    async function clearPrefix(prefix) {
        for (const k of Array.from(mem.keys())) if (k.startsWith(prefix)) mem.delete(k);
        try {
            await run('readwrite', s => s.delete(IDBKeyRange.bound(prefix, prefix + '\uffff')));
        } catch (e) {}
    }

    return { get, getMany, set, setMany, clearPrefix };
})();
