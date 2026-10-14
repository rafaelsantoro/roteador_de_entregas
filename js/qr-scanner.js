/* --- LEITOR DE QR CODE --- */

function openQrScannerModal() {
    if (!activePoints || activePoints.length === 0) {
        alert("Otimize a rota primeiro antes de utilizar a câmera de identificação dos pacotes.");
        return;
    }

    const modal = document.getElementById('qr-modal');
    modal.classList.remove('hidden');

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    const config = { fps: 10, qrbox: { width: 230, height: 230 } };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        onQrCodeScanned,
        onQrScanError
    ).catch(err => {
        console.error("Erro ao iniciar câmera:", err);
        alert("Não foi possível acessar a câmera do dispositivo. Verifique as permissões do navegador.");
        closeQrScannerModal();
    });
}

function closeQrScannerModal() {
    const modal = document.getElementById('qr-modal');
    modal.classList.add('hidden');

    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
        }).catch(err => console.error("Erro ao parar leitor:", err));
    }

    document.getElementById('qr-result-overlay').classList.add('hidden');
    document.getElementById('qr-error-overlay').classList.add('hidden');
    isQrCooldown = false;
}

function playBeepSound(isSuccess = true) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = isSuccess ? 'sine' : 'sawtooth';
        osc.frequency.setValueAtTime(isSuccess ? 880 : 280, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + (isSuccess ? 0.18 : 0.35));
    } catch (e) {}
}

function onQrCodeScanned(decodedText) {
    if (isQrCooldown) return;
    isQrCooldown = true;

    const scannedRaw = decodedText.trim();
    const scannedUpper = scannedRaw.toUpperCase();

    let matchedIdx = -1;
    let matchedPoint = null;

    activePoints.forEach((p, idx) => {
        const spxCode = p.spx ? p.spx.trim().toUpperCase() : '';
        if (spxCode && (scannedUpper === spxCode || scannedUpper.includes(spxCode) || spxCode.includes(scannedUpper))) {
            matchedIdx = idx;
            matchedPoint = p;
        }
    });

    if (matchedPoint && matchedIdx !== -1) {
        const seqNumber = matchedIdx + 1;
        playBeepSound(true);

        const overlay = document.getElementById('qr-result-overlay');
        document.getElementById('qr-result-number').textContent = `#${seqNumber}`;
        document.getElementById('qr-result-code').textContent = matchedPoint.spx;
        document.getElementById('qr-result-address').textContent = `${matchedPoint.address} (${matchedPoint.bairro})`;

        overlay.classList.remove('hidden');

        setTimeout(() => {
            overlay.classList.add('hidden');
            isQrCooldown = false;
        }, 4500);
    } else {
        playBeepSound(false);

        const errOverlay = document.getElementById('qr-error-overlay');
        document.getElementById('qr-error-code').textContent = `Lido: "${scannedRaw}"`;

        errOverlay.classList.remove('hidden');

        setTimeout(() => {
            errOverlay.classList.add('hidden');
            isQrCooldown = false;
        }, 3000);
    }
}

function onQrScanError(errorMessage) {
    // Leitura contínua silenciosa
}
