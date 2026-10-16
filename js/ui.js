/* --- INTERFACE E ELEMENTOS VISUAIS --- */

// Escapa texto vindo da planilha/internet antes de colocá-lo em HTML (evita injeção de código)
function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function checkInternetConnection() {
    const offlineBanner = document.getElementById('offline-warning');
    if (!offlineBanner) return;

    if (!navigator.onLine) {
        offlineBanner.classList.remove('hidden');
    } else {
        offlineBanner.classList.add('hidden');
    }
}

function enableAutoFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
}

function toggleFullscreen() {
    const icon = document.getElementById('fullscreen-icon');
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            if (icon) icon.className = "fa-solid fa-compress";
        }).catch(() => {});
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().then(() => {
                if (icon) icon.className = "fa-solid fa-expand";
            });
        }
    }
}

function toggleMenuConfig() {
    const menuBox = document.getElementById('collapsible-menu');
    const chevron = document.getElementById('menu-chevron');
    if (menuBox.classList.contains('hidden')) {
        menuBox.classList.remove('hidden');
        if (chevron) chevron.className = "fa-solid fa-chevron-up text-[10px] ml-0.5";
    } else {
        menuBox.classList.add('hidden');
        if (chevron) chevron.className = "fa-solid fa-chevron-down text-[10px] ml-0.5";
    }
}

function switchMobileTab(tab) {
    const sidebar = document.getElementById('sidebar-panel');
    const mapPanel = document.getElementById('map-panel');
    const btnList = document.getElementById('nav-btn-list');
    const btnMap = document.getElementById('nav-btn-map');

    if (tab === 'list') {
        sidebar.classList.remove('hidden');
        mapPanel.classList.add('hidden');
        mapPanel.classList.remove('block');
        
        btnList.className = "flex-1 py-1.5 px-3 text-center text-indigo-400 font-bold text-xs flex flex-col items-center space-y-1 bg-slate-800/80 rounded-lg";
        btnMap.className = "flex-1 py-1.5 px-3 text-center text-slate-400 font-bold text-xs flex flex-col items-center space-y-1";
    } else {
        sidebar.classList.add('hidden');
        mapPanel.classList.remove('hidden');
        mapPanel.classList.add('block');
        
        btnList.className = "flex-1 py-1.5 px-3 text-center text-slate-400 font-bold text-xs flex flex-col items-center space-y-1";
        btnMap.className = "flex-1 py-1.5 px-3 text-center text-indigo-400 font-bold text-xs flex flex-col items-center space-y-1 bg-slate-800/80 rounded-lg";
        
        setTimeout(() => {
            if (map) {
                map.resize();
                if (activePoints.length > 0 && !isNavMode && Date.now() >= suppressFitUntil) {
                    const bounds = new maplibregl.LngLatBounds();
                    activePoints.forEach(p => bounds.extend([p.lng, p.lat]));
                    map.fitBounds(bounds, { padding: 40 });
                }
            }
        }, 100);
    }
}

function updateCounters() {
    const total = activePoints.length;
    const success = activePoints.filter(p => p.status === 'success').length;
    const occurrence = activePoints.filter(p => p.status === 'occurrence').length;

    document.getElementById('cnt-total').textContent = total;
    document.getElementById('cnt-success').textContent = success;
    document.getElementById('cnt-occurrence').textContent = occurrence;
}

function renderSidebarList(points) {
    const container = document.getElementById('stops-list-container');
    container.innerHTML = '';

    points.forEach((p, idx) => {
        const isSuccess = p.status === 'success';
        const isOccurrence = p.status === 'occurrence';

        let cardBg = "bg-white border-slate-200";
        if (isSuccess) cardBg = "bg-emerald-50/70 border-emerald-300";
        if (isOccurrence) cardBg = "bg-rose-50/70 border-rose-300";

        const item = document.createElement('div');
        item.className = `p-3 rounded-xl border shadow-sm transition flex flex-col space-y-2 ${cardBg}`;

        item.innerHTML = `
            <div class="flex items-start justify-between cursor-pointer" onclick="focusOnPoint(${idx})">
                <div class="flex items-start space-x-2.5 min-w-0">
                    <div class="flex-shrink-0 w-6 h-6 rounded-full ${isSuccess ? 'bg-emerald-600' : isOccurrence ? 'bg-rose-600' : 'bg-indigo-600'} text-white font-bold text-xs flex items-center justify-center mt-0.5 shadow-sm">
                        ${isSuccess ? '<i class="fa-solid fa-check"></i>' : isOccurrence ? '<i class="fa-solid fa-xmark"></i>' : idx + 1}
                    </div>
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-slate-900 truncate tracking-tight">${escapeHtml(p.spx)}</p>
                        <p class="text-[11px] font-semibold text-slate-700 truncate leading-snug mt-0.5">${escapeHtml(p.address)}</p>
                        <p class="text-[10px] font-medium text-slate-500 truncate mt-0.5"><i class="fa-solid fa-location-dot text-slate-400 mr-1"></i>${escapeHtml(p.bairro)}</p>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-1 pt-1">
                <button onclick="navigateToPoint(${idx})" class="py-1.5 px-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-[11px] font-bold transition flex items-center justify-center space-x-1 shadow-sm" title="Navegar no App">
                    <i class="fa-solid fa-compass"></i>
                    <span>App</span>
                </button>
                <button onclick="openWaze(${Number(p.lat)}, ${Number(p.lng)})" class="py-1.5 px-1 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-solid fa-location-arrow"></i>
                    <span>Waze</span>
                </button>
                <button onclick="openGoogleMaps(${Number(p.lat)}, ${Number(p.lng)})" class="py-1.5 px-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center space-x-1 shadow-sm">
                    <i class="fa-brands fa-google"></i>
                    <span>G. Maps</span>
                </button>
            </div>

            <div class="flex space-x-1.5 pt-1 border-t border-slate-100/80">
                <button onclick="setDeliveryStatus(${idx}, 'success')" class="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center space-x-1 ${isSuccess ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 hover:bg-emerald-100 text-emerald-700'}">
                    <i class="fa-solid fa-circle-check"></i>
                    <span>Entregue</span>
                </button>
                <button onclick="setDeliveryStatus(${idx}, 'occurrence')" class="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center space-x-1 ${isOccurrence ? 'bg-rose-600 text-white shadow' : 'bg-slate-100 hover:bg-rose-100 text-rose-700'}">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>Ocorrência</span>
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

function showLoading(text) {
    document.getElementById('loading-text').textContent = text || "Carregando...";
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}
