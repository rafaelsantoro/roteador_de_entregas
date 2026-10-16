/* --- LEITOR DE QR CODE COM CONFERÊNCIA E CONTAGEM DE PACOTES --- */

function updateQrCounterUI() {
    const counterEl = document.getElementById('qr-scan-counter');
    const completeBanner = document.getElementById('qr-complete-banner');

    if (!activePoints || activePoints.length === 0) {
        if (counterEl) counterEl.textContent = '0 / 0';
        if (completeBanner) completeBanner.classList.add('hidden');
        return;
    }

    const total = activePoints.length;
    const scannedCount = activePoints.filter(p => p.scanned === true).length;

    if (counterEl) {
        counterEl.textContent = `${scannedCount} / ${total}`;
        if (scannedCount === total) {
            counterEl.className = "text-xs bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-black animate-pulse";
        } else {
            counterEl.className = "text-xs bg-purple-950 text-purple-200 px-2.5 py-0.5 rounded-full font-bold border border-purple-700/50";
        }
    }

    // Exibe banner persistente no leitor se todos já foram conferidos
    if (completeBanner) {
        if (scannedCount === total && total > 0) {
            completeBanner.classList.remove('hidden');
        } else {
            completeBanner.classList.add('hidden');
        }
    }
}

async function openQrScannerModal() {
    if (!activePoints || activePoints.length === 0) {
        alert("Carregue uma planilha e otimize a rota antes de escanear os pacotes.");
        return;
    }

    const modal = document.getElementById('qr-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    updateQrCounterUI();

    // Se a biblioteca Html5Qrcode não estiver inicializada
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };

    try {
        await html5QrCode.start(
            { facingMode: "environment" },
            config,
            onQrCodeScanned,
            onQrCodeError
        );
    } catch (err) {
        console.warn("Não foi possível iniciar a câmera traseira, tentando câmera padrão...", err);
        try {
            await html5QrCode.start({ facingMode: "user" }, config, onQrCodeScanned, onQrCodeError);
        } catch (err2) {
            alert("Erro ao acessar a câmera do dispositivo: " + err2.message);
        }
    }
}

function onQrCodeScanned(decodedText, decodedResult) {
    if (isQrCooldown) return;
    isQrCooldown = true;

    const code = String(decodedText || '').trim();
    if (!code) {
        isQrCooldown = false;
        return;
    }

    // Busca o pacote na lista otimizada (por código exato ou contido)
    const foundIdx = activePoints.findIndex(p => {
        const spx = String(p.spx || '').trim().toLowerCase();
        const searchCode = code.toLowerCase();
        return spx && (searchCode.includes(spx) || spx.includes(searchCode));
    });

    const overlayResult = document.getElementById('qr-result-overlay');
    const overlayError = document.getElementById('qr-error-overlay');
    const numEl = document.getElementById('qr-result-number');
    const codeEl = document.getElementById('qr-result-code');
    const addrEl = document.getElementById('qr-result-address');
    const errCodeEl = document.getElementById('qr-error-code');

    if (foundIdx !== -1) {
        const pkg = activePoints[foundIdx];
        const stopNum = foundIdx + 1;
        const wasAlreadyScanned = pkg.scanned === true;

        // Marca como conferido e salva o estado no aparelho
        pkg.scanned = true;
        saveStateToLocalStorage();
        updateQrCounterUI();

        // Feedback sonoro/vibração se suportado
        if ('vibrate' in navigator) navigator.vibrate(100);

        if (numEl) numEl.textContent = `#${stopNum}`;
        if (codeEl) {
            codeEl.textContent = `${pkg.spx}${wasAlreadyScanned ? ' (Já conferido)' : ''}`;
        }
        if (addrEl) addrEl.textContent = `${pkg.address} - ${pkg.bairro}`;

        if (overlayError) overlayError.classList.add('hidden');
        if (overlayResult) overlayResult.classList.remove('hidden');

        // Verifica se completou 100% dos pacotes do dia com esta leitura
        const total = activePoints.length;
        const scannedTotal = activePoints.filter(p => p.scanned === true).length;

        if (scannedTotal === total) {
            if ('vibrate' in navigator) navigator.vibrate([150, 100, 150, 100, 200]);
            // Exibe mensagem de comemoração sem fechar a tela
            setTimeout(() => {
                alert(`🎉 PARABÉNS!\n\nTodos os ${total} pacotes do dia foram escaneados e conferidos com sucesso!`);
            }, 300);
        }

        // Aguarda 2 segundos para ler o próximo pacote
        setTimeout(() => {
            if (overlayResult) overlayResult.classList.add('hidden');
            isQrCooldown = false;
        }, 2000);

    } else {
        // Pacote não encontrado na planilha
        if ('vibrate' in navigator) navigator.vibrate(350);

        if (errCodeEl) errCodeEl.textContent = `Código lido: ${code}`;
        if (overlayResult) overlayResult.classList.add('hidden');
        if (overlayError) overlayError.classList.remove('hidden');

        setTimeout(() => {
            if (overlayError) overlayError.classList.add('hidden');
            isQrCooldown = false;
        }, 2000);
    }
}

function onQrCodeError(errorMessage) {
    // Erros contínuos de leitura de quadro da câmera são ignorados
}

async function closeQrScannerModal() {
    if (!activePoints || activePoints.length === 0) {
        stopQrScannerAndClose();
        return;
    }

    const total = activePoints.length;
    const scannedList = activePoints.filter(p => p.scanned === true);
    const missingItems = activePoints
        .map((p, idx) => ({ num: idx + 1, spx: p.spx }))
        .filter((_, idx) => !activePoints[idx].scanned);

    // Se fechar sem ter escaneado todos os pacotes
    if (missingItems.length > 0) {
        const missingCount = missingItems.length;
        
        // Monta a lista dos números que faltam (ex: #3, #7, #12)
        let missingNumbersStr = missingItems.map(m => `#${m.num}`).join(', ');
        if (missingCount > 15) {
            const firstFew = missingItems.slice(0, 15).map(m => `#${m.num}`).join(', ');
            missingNumbersStr = `${firstFew}... e mais ${missingCount - 15} pacote(s)`;
        }

        const msg = `⚠️ ATENÇÃO: Conferência de pacotes incompleta!\n\n` +
                    `• Escaneados: ${scannedList.length} de ${total} pacotes.\n` +
                    `• Faltam escanear: ${missingCount} pacote(s).\n\n` +
                    `Pacotes pendentes: ${missingNumbersStr}\n\n` +
                    `Deseja fechar o scanner assim mesmo?`;

        if (!confirm(msg)) {
            return; // Cancela o fechamento e permanece no leitor
        }
    }

    stopQrScannerAndClose();
}

function stopQrScannerAndClose() {
    const overlayResult = document.getElementById('qr-result-overlay');
    const overlayError = document.getElementById('qr-error-overlay');
    const modal = document.getElementById('qr-modal');

    if (overlayResult) overlayResult.classList.add('hidden');
    if (overlayError) overlayError.classList.add('hidden');

    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            if (modal) modal.classList.add('hidden');
            isQrCooldown = false;
        }).catch(() => {
            if (modal) modal.classList.add('hidden');
            isQrCooldown = false;
        });
    } else {
        if (modal) modal.classList.add('hidden');
        isQrCooldown = false;
    }
}