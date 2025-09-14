// Script para el Media Session API
if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Flashcards de Idiomas',
        artist: 'Diego Cuaran',
        album: 'Tu álbum de frases',
        artwork: [
            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        ]
    });

    navigator.mediaSession.setActionHandler('pause', () => {
        console.log('Se ha pulsado el botón de Pausa (desde Media Session)');
        togglePause();
    });

    navigator.mediaSession.setActionHandler('play', () => {
        console.log('Se ha pulsado el botón de Reproducir (desde Media Session)');
        togglePause();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
        console.log('Se ha pulsado el botón de Siguiente (desde Media Session)');
        if (!isPaused) {
            index = (index + 1) % flashcards.length;
            renderAndPlay();
        }
    });
}

// Variables de estado
let flashcards = [];
let index = 0;
let playToken = 0;
let waitTimer = null;
let isPaused = false;
let wakeLock = null;
let floatingBtnTimer = null;
let alternateStudyVoice = null; // Variable para almacenar la voz de alternancia
let deferredPrompt = null;

const synth = window.speechSynthesis;
const PREFERRED = { 'en-gb': 'en-GB', 'es-es': 'es-ES', 'fr-fr': 'fr-FR' };

// Selectores de elementos
const phraseEl = document.getElementById('phrase');
const transEl = document.getElementById('translation');
const introEl = document.getElementById('intro');
const studySel = document.getElementById('studyLang');
const studyVoiceLabel = document.getElementById('studyVoiceLabel');
const studyVoiceSel = document.getElementById('studyVoice');
const transSel = document.getElementById('transLang');
const transVoiceLabel = document.getElementById('transVoiceLabel');
const transVoiceSel = document.getElementById('transVoice');
const showTransChk = document.getElementById('showTransCheck');
const repeatCountSel = document.getElementById('repeatCount');
const speedSel = document.getElementById('speed');
const pauseSel = document.getElementById('pause');
const counterEl = document.getElementById('counter');
const errorEl = document.getElementById('error');
const restartBtn = document.getElementById('restartBtn');
const fileNameEl = document.getElementById('fileName');
const flashcardEl = document.getElementById('flashcard');
const fsBtn = document.getElementById('fsBtn');
const wakeLockBtn = document.getElementById('wakeLockBtn');
const floatingPauseBtn = document.getElementById('floatingPauseBtn');
const installMessage = document.getElementById('installMessage');
const fileInput = document.getElementById('fileInput');

// --- Funcionalidad PWA y Wake Lock ---
if (!window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone) {
    installMessage.style.display = 'block';
    setTimeout(() => {
        installMessage.style.display = 'none';
    }, 5000);
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

const installBtn = document.getElementById('installBtn');
if (installBtn) {
    installBtn.addEventListener('click', () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt = null;
            installMessage.style.display = 'none';
        }
    });
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            if (!wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock activado');
                wakeLockBtn.textContent = '🔓';
                wakeLockBtn.title = 'Desbloquear pantalla';
            }
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().then(() => {
            wakeLock = null;
            console.log('Wake Lock liberado');
            wakeLockBtn.textContent = '🔒';
            wakeLockBtn.title = 'Bloquear pantalla';
        }).catch(err => {
            console.error(`Error al liberar wake lock: ${err.message}`);
        });
    }
}

wakeLockBtn.addEventListener('click', () => {
    if (wakeLock) {
        releaseWakeLock();
    } else {
        requestWakeLock();
    }
});

// --- Persistencia del estado con localStorage ---
function saveState() {
    if (flashcards.length > 0) {
        localStorage.setItem('flashcardsIndex', index);
        localStorage.setItem('flashcardsFileName', fileNameEl.textContent);
    }
}

function loadState() {
    const savedIndex = localStorage.getItem('flashcardsIndex');
    const savedFileName = localStorage.getItem('flashcardsFileName');

    if (savedIndex && savedFileName) {
        index = parseInt(savedIndex, 10);
        fileNameEl.textContent = savedFileName;
    }
}

window.addEventListener('beforeunload', saveState);

// --- Funcionalidad de Voz y Síntesis ---
function resolveLangCode(key) {
    if (!key) return 'en-US';
    const k = key.toLowerCase();
    if (PREFERRED[k]) return PREFERRED[k];
    if (k.includes('en')) return 'en-US';
    if (k.includes('fr')) return 'fr-FR';
    if (k.includes('es')) return 'es-ES';
    return k;
}

function getVoiceByURI(voiceURI) {
    return synth.getVoices().find(v => v.voiceURI === voiceURI) || null;
}

function speakAsync(text, langCode, voiceURI = null, isStudyLanguage = true) {
    return new Promise(async resolve => {
        if (!text || isPaused) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        const voice = getVoiceByURI(voiceURI);
        if (voice) u.voice = voice;
        u.lang = langCode;
        u.rate = parseFloat(speedSel.value) || 1;
        u.onend = () => resolve();
        u.onerror = () => resolve();

        if (navigator.userAgent.match(/Android/i)) {
            synth.cancel();
        }
        synth.speak(u);
    });
}

async function renderAndPlay() {
    if (!flashcards.length || isPaused) {
        releaseWakeLock();
        return;
    }

    if (!wakeLock) {
        requestWakeLock();
    }

    try { synth.cancel(); } catch (_) { }

    const card = flashcards[index];
    const studyKey = studySel.value;
    const transKey = transSel.value;
    const repeatCount = parseInt(repeatCountSel.value, 10) || 2;
    const showTranslation = showTransChk.checked && card[transKey];

    // Animación de la tarjeta
    phraseEl.style.opacity = 0;
    transEl.style.opacity = 0;
    phraseEl.style.transform = 'scale(0.96)';
    transEl.style.transform = 'scale(0.96)';
    await new Promise(r => setTimeout(r, 250));

    counterEl.textContent = `${index + 1} / ${flashcards.length}`;

    // Mostrar y hablar la traducción
    if (showTranslation) {
        transEl.textContent = card[transKey];
        transEl.style.opacity = 1;
        transEl.style.transform = 'scale(1)';

        if (card[transKey]) {
            await speakAsync(card[transKey] || '', resolveLangCode(transKey), null, false);
            if (isPaused) return;
        }

        const delayMs = (parseFloat(pauseSel.value, 10) || 2) * 1000;
        await new Promise(r => setTimeout(r, delayMs));
        if (isPaused) return;
    }

    // Mostrar y hablar la frase de estudio (con repeticiones)
    phraseEl.textContent = card[studyKey] || '';
    phraseEl.style.opacity = 1;
    phraseEl.style.transform = 'scale(1)';

    for (let i = 0; i < repeatCount; i++) {
        let voiceToUse = studyVoiceSel.value;
        if (repeatCount > 1 && alternateStudyVoice && i % 2 !== 0) {
            voiceToUse = alternateStudyVoice.voiceURI;
        }

        await speakAsync(card[studyKey] || '', resolveLangCode(studyKey), voiceToUse, true);
        if (isPaused) return;
        if (i < repeatCount - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Esperar y pasar a la siguiente frase
    const delayMs = (parseFloat(pauseSel.value, 10) || 2) * 1000;
    waitTimer = setTimeout(() => {
        if (isPaused) return;
        index = (index + 1);
        if (index >= flashcards.length) {
            index = 0;
            releaseWakeLock();
        }
        renderAndPlay();
    }, delayMs);
}

// --- Event Listeners y Lógica de Configuración ---
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileNameEl.textContent = "📂 Archivo cargado: " + file.name;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const json = JSON.parse(ev.target.result);
            if (!Array.isArray(json) || !json.length || typeof json[0] !== 'object') {
                throw 'Formato inválido';
            }
            flashcards = json;
            errorEl.textContent = '';
            
            // Cargar índice guardado si el archivo es el mismo
            const savedFileName = localStorage.getItem('flashcardsFileName');
            if (savedFileName && savedFileName.includes(file.name)) {
                index = parseInt(localStorage.getItem('flashcardsIndex'), 10) || 0;
                fileNameEl.textContent = savedFileName;
            } else {
                index = 0;
            }

            setupSelectors();
            introEl.style.display = "none";
            renderAndPlay();
        } catch (err) {
            errorEl.textContent = 'Error al leer JSON: ' + err;
        }
    };
    reader.readAsText(file);
});


function setupSelectors() {
    const keys = Object.keys(flashcards[0]);
    const preferredOrder = ['en-GB', 'fr-FR', 'es-ES'];
    const sortedKeys = preferredOrder.filter(k => keys.includes(k)).concat(keys.filter(k => !preferredOrder.includes(k)));

    studySel.innerHTML = '';
    transSel.innerHTML = '';
    sortedKeys.forEach((k) => {
        const o = new Option(k, k);
        studySel.appendChild(o);
        const o2 = new Option(k, k);
        transSel.appendChild(o2);
    });

    if (sortedKeys.includes('en-GB')) studySel.value = 'en-GB';
    if (sortedKeys.includes('es-ES')) transSel.value = 'es-ES';

    populateStudyVoiceSelector();
    populateVoiceSelector();
    studyVoiceSel.disabled = false;
    transSel.disabled = !showTransChk.checked;
    transVoiceSel.disabled = !showTransChk.checked;
}

function refreshTransOptions() {
    const keys = Object.keys(flashcards[0]);
    const study = studySel.value;
    transSel.innerHTML = '';
    keys.forEach(k => {
        if (k !== study) {
            transSel.appendChild(new Option(k, k));
        }
    });
}

function populateVoiceSelector() {
    transVoiceSel.innerHTML = '';
    const transLangCode = resolveLangCode(transSel.value);
    const voices = synth.getVoices().filter(voice => voice.lang.startsWith(transLangCode.split('-')[0]));
    if (voices.length > 0) {
        transVoiceLabel.style.display = 'block';
        voices.forEach(voice => {
            const option = new Option(`${voice.name} (${voice.lang})`, voice.voiceURI);
            transVoiceSel.appendChild(option);
        });
        const preferredVoice = voices.find(v => v.name.startsWith('Google') && v.lang === transLangCode);
        if (preferredVoice) transVoiceSel.value = preferredVoice.voiceURI;
    } else {
        transVoiceLabel.style.display = 'none';
    }
}

function populateStudyVoiceSelector() {
    studyVoiceSel.innerHTML = '';
    const studyLangCode = resolveLangCode(studySel.value);
    const voices = synth.getVoices().filter(voice => voice.lang.startsWith(studyLangCode.split('-')[0]));
    if (voices.length > 0) {
        studyVoiceLabel.style.display = 'block';
        voices.forEach(voice => {
            const option = new Option(`${voice.name} (${voice.lang})`, voice.voiceURI);
            studyVoiceSel.appendChild(option);
        });
        const preferredMaleVoice = voices.find(v => v.name.includes('Google UK English Male'));
        const firstGoogleMale = voices.find(v => v.name.startsWith('Google') && v.name.toLowerCase().includes('male'));
        const firstGoogleVoice = voices.find(v => v.name.startsWith('Google'));
        let defaultVoiceURI = (preferredMaleVoice || firstGoogleMale || firstGoogleVoice || voices[0])?.voiceURI;

        if (defaultVoiceURI) {
            studyVoiceSel.value = defaultVoiceURI;
            alternateStudyVoice = voices.find(v => v.voiceURI !== defaultVoiceURI);
        } else {
            alternateStudyVoice = null;
        }
    } else {
        studyVoiceLabel.style.display = 'none';
    }
}

// Eventos de la UI
transSel.addEventListener('change', () => { refreshTransOptions(); populateVoiceSelector(); renderAndPlay(); });
studySel.addEventListener('change', () => { refreshTransOptions(); populateStudyVoiceSelector(); renderAndPlay(); });
synth.onvoiceschanged = () => { populateStudyVoiceSelector(); populateVoiceSelector(); };
floatingPauseBtn.addEventListener('click', togglePause);
restartBtn.addEventListener("click", () => {
    if (!flashcards.length) return;
    index = 0;
    isPaused = false;
    clearTimeout(waitTimer);
    try { synth.cancel(); } catch (_) { }
    renderAndPlay();
});

function togglePause() {
    if (flashcards.length === 0) return;
    isPaused = !isPaused;
    if (isPaused) {
        floatingPauseBtn.textContent = '▶️';
        try { synth.cancel(); } catch (_) { }
        releaseWakeLock();
        clearTimeout(floatingBtnTimer);
    } else {
        floatingPauseBtn.textContent = '⏸️';
        requestWakeLock();
        renderAndPlay();
    }
}

// Lógica de visibilidad de botones flotantes y fullscreen
function showFloatingButtons() {
    if (flashcards.length === 0) return;
    floatingPauseBtn.style.opacity = 1;
    fsBtn.style.opacity = 1;
    restartBtn.style.opacity = 1;

    clearTimeout(floatingBtnTimer);
    floatingBtnTimer = setTimeout(() => {
        if (!isPaused) {
            floatingPauseBtn.style.opacity = 0;
            fsBtn.style.opacity = 0;
            restartBtn.style.opacity = 0;
        }
    }, 3000);
}

flashcardEl.addEventListener('click', showFloatingButtons);
flashcardEl.addEventListener('touchstart', showFloatingButtons);

fsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) {
        await document.exitFullscreen();
        fsBtn.textContent = '⛶';
    } else {
        await flashcardEl.requestFullscreen();
        fsBtn.textContent = '🗙';
    }
});

document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '🗙' : '⛶';
});

repeatCountSel.addEventListener('change', () => {
    renderAndPlay();
});

showTransChk.addEventListener('change', () => {
    transSel.disabled = !showTransChk.checked;
    transVoiceSel.disabled = !showTransChk.checked;
    renderAndPlay();
});

studyVoiceSel.addEventListener('change', () => {
    renderAndPlay();
});