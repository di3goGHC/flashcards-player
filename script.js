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

let flashcards = [];
let index = 0;
let playToken = 0;
let waitTimer = null;
let isPaused = false;
let wakeLock = null;
let floatingBtnTimer = null;
let alternateStudyVoice = null;
let deferredPrompt = null;

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
const installBtn = document.getElementById('installBtn');

const synth = window.speechSynthesis;
const PREFERRED = { 'en-gb': 'en-GB', 'es-es': 'es-ES', 'fr-fr': 'fr-FR' };

// --- Funcionalidad de Persistencia de Estado ---
const STATE_KEY = 'flashcard_state';

function saveState() {
    const state = {
        fileName: fileNameEl.textContent,
        flashcards: flashcards,
        currentIndex: index,
        isPaused: isPaused,
        studyLang: studySel.value,
        transLang: transSel.value,
        speed: speedSel.value,
        pause: pauseSel.value,
        showTrans: showTransChk.checked,
        repeatCount: repeatCountSel.value,
        studyVoice: studyVoiceSel.value,
        transVoice: transVoiceSel.value
    };
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error("Error al guardar el estado en localStorage:", e);
    }
}

function loadState() {
    try {
        const savedState = localStorage.getItem(STATE_KEY);
        if (savedState) {
            const state = JSON.parse(savedState);
            fileNameEl.textContent = state.fileName;
            flashcards = state.flashcards;
            index = state.currentIndex;
            isPaused = state.isPaused;
            studySel.value = state.studyLang;
            transSel.value = state.transLang;
            speedSel.value = state.speed;
            pauseSel.value = state.pause;
            showTransChk.checked = state.showTrans;
            repeatCountSel.value = state.repeatCount;
            studyVoiceSel.value = state.studyVoice;
            transVoiceSel.value = state.transVoice;

            // Mostrar la interfaz y reanudar la reproducción
            introEl.style.display = "none";
            setupSelectors(); // Para asegurar que los selectores se carguen correctamente
            if (!isPaused) {
                renderAndPlay();
            } else {
                togglePause(); // Para actualizar el botón de pausa y el estado
            }
        }
    } catch (e) {
        console.error("Error al cargar el estado desde localStorage:", e);
    }
}

// --- Funcionalidad PWA ---
if (!window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone) {
    installMessage.style.display = 'block';
    
    setTimeout(() => {
        installMessage.style.display = 'none';
    }, 4000);

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if(installBtn) installBtn.style.display = 'inline-block';
    });

    if(installBtn) {
        installBtn.addEventListener('click', () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt = null;
                installMessage.style.display = 'none';
            }
        });
    }
} else {
    installMessage.style.display = 'none';
}

// --- Gestión de Wake Lock y Media Session (mejorado) ---
function manageMediaSessionState(isPlaying) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
    if (isPlaying) {
        requestWakeLock();
    } else {
        releaseWakeLock();
    }
}

async function requestWakeLock() {
    if ('wakeLock' in navigator && !wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock fue liberado');
            });
            console.log('Wake Lock solicitado correctamente');
        } catch (err) {
            console.error('Error al solicitar Wake Lock:', err.name, err.message);
        }
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release()
            .then(() => {
                wakeLock = null;
                console.log('Wake Lock liberado');
            });
    }
}

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

function speakAsync(text, langCode, token, voiceURI = null, isStudyLanguage = true) {
    return new Promise(async resolve => {
        if (!text || isPaused) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = langCode;
        u.rate = parseFloat(speedSel.value) || 1;

        let voice = null;
        if (voiceURI) {
            voice = getVoiceByURI(voiceURI);
        } else {
            voice = getVoiceByURI(isStudyLanguage ? studyVoiceSel.value : transVoiceSel.value);
        }

        if (!voice) {
            const voices = synth.getVoices().filter(voice => voice.lang.startsWith(langCode.split('-')[0]));
            voice = voices[0];
        }

        if (voice) u.voice = voice;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        if (playToken !== token) return resolve();

        if (navigator.userAgent.match(/Android/i)) {
            synth.cancel();
        }
        synth.speak(u);
    });
}

async function renderAndPlay() {
    if (!flashcards.length) return;

    if (!isPaused) {
        manageMediaSessionState(true);
    } else {
        return;
    }
    
    playToken++;
    const myToken = playToken;
    try { synth.cancel(); } catch (_) { }

    const card = flashcards[index];
    const studyKey = studySel.value;
    const transKey = transSel.value;
    const repeatCount = parseInt(repeatCountSel.value, 10) || 2;
    const showTranslation = showTransChk.checked && card[transKey];

    phraseEl.style.opacity = 0; transEl.style.opacity = 0;
    phraseEl.style.transform = 'scale(0.96)';
    transEl.style.transform = 'scale(0.96)';
    await new Promise(r => setTimeout(r, 250));

    counterEl.textContent = `${index + 1} / ${flashcards.length}`;

    if (showTranslation) {
        transEl.textContent = card[transKey];
        transEl.style.opacity = 0;
        setTimeout(() => { transEl.style.opacity = 1; transEl.style.transform = 'scale(1)'; }, 50);
        await speakAsync(card[transKey] || '', resolveLangCode(transKey), myToken, null, false);
        if (playToken !== myToken) return;

        const delayMs = (parseFloat(pauseSel.value, 10) || 2) * 1000;
        await new Promise(r => setTimeout(r, delayMs));
        if (playToken !== myToken || isPaused) return;
    }

    phraseEl.textContent = card[studyKey] || '';
    phraseEl.style.opacity = 1; phraseEl.style.transform = 'scale(1)';

    for (let i = 0; i < repeatCount; i++) {
        let voiceToUse = null;
        if (repeatCount > 1 && alternateStudyVoice) {
            voiceToUse = (i % 2 === 0) ? studyVoiceSel.value : alternateStudyVoice.voiceURI;
        } else {
            voiceToUse = studyVoiceSel.value;
        }

        await speakAsync(card[studyKey] || '', resolveLangCode(studyKey), myToken, voiceToUse, true);
        if (playToken !== myToken) return;
        if (i < repeatCount - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    clearTimeout(waitTimer);
    const delayMs = (parseFloat(pauseSel.value, 10) || 2) * 1000;
    waitTimer = setTimeout(() => {
        if (playToken !== myToken || isPaused) return;
        
        index = (index + 1);

        if (index >= flashcards.length) {
            index = 0;
            manageMediaSessionState(false);
            return;
        }

        renderAndPlay();
    }, delayMs);
}

document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileNameEl.textContent = "📂 Archivo cargado: " + file.name;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const json = JSON.parse(ev.target.result);
            if (!Array.isArray(json) || !json.length || typeof json[0] !== 'object') throw 'Formato inválido';
            flashcards = json; index = 0; errorEl.textContent = '';
            setupSelectors();
            introEl.style.display = "none";
            
            isPaused = false;
            manageMediaSessionState(true);
            saveState(); // Guardar el estado inicial después de cargar un archivo
            renderAndPlay();
        } catch (err) { errorEl.textContent = 'Error al leer JSON: ' + err; }
    };
    reader.readAsText(file);
});


function setupSelectors() {
    const keys = Object.keys(flashcards[0]);
    const preferredOrder = ['en-GB', 'fr-FR', 'es-ES'];
    const sortedKeys = [];
    preferredOrder.forEach(lang => {
        if (keys.includes(lang)) {
            sortedKeys.push(lang);
        }
    });
    keys.forEach(lang => {
        if (!sortedKeys.includes(lang)) {
            sortedKeys.push(lang);
        }
    });
    
    studySel.innerHTML = ''; transSel.innerHTML = '';
    
    sortedKeys.forEach((k) => {
        const o = document.createElement('option');
        o.value = k; o.textContent = k;
        studySel.appendChild(o);
    });
    
    if (sortedKeys.includes('en-GB')) {
        studySel.value = 'en-GB';
    }
    
    refreshTransOptions();
    
    if (sortedKeys.includes('es-ES')) {
        transSel.value = 'es-ES';
    } else if (sortedKeys.includes('fr-FR')) {
        transSel.value = 'fr-FR';
    }
    
    populateStudyVoiceSelector();
    populateVoiceSelector();
    studyVoiceSel.disabled = false;
    transLang.disabled = !showTransCheck.checked;
    transVoice.disabled = !showTransCheck.checked;
}

function refreshTransOptions() {
    const keys = Object.keys(flashcards[0]);
    const study = studySel.value;
    transSel.innerHTML = '';
    keys.forEach(k => {
        if (k !== study) {
            const o = document.createElement('option');
            o.value = k; o.textContent = k;
            transSel.appendChild(o);
        }
    });
}

function populateVoiceSelector() {
    transVoiceSel.innerHTML = '';
    const transLangCode = resolveLangCode(transSel.value);
    
    if (!transLangCode) {
        transVoiceLabel.style.display = 'none';
        return;
    }
    
    const voices = synth.getVoices().filter(voice => voice.lang.startsWith(transLangCode.split('-')[0]));
    
    if (voices.length > 0) {
        transVoiceLabel.style.display = 'block';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.value = voice.voiceURI;
            transVoiceSel.appendChild(option);
        });
        
        const preferredVoice = voices.find(v => v.name.startsWith('Google') && v.lang === transLangCode);
        if (preferredVoice) {
            transVoiceSel.value = preferredVoice.voiceURI;
        }
    } else {
        transVoiceLabel.style.display = 'none';
    }
}

function populateStudyVoiceSelector() {
    studyVoiceSel.innerHTML = '';
    const studyLangCode = resolveLangCode(studySel.value);
    
    if (!studyLangCode) {
        studyVoiceLabel.style.display = 'none';
        return;
    }
    
    const voices = synth.getVoices().filter(voice => voice.lang.startsWith(studyLangCode.split('-')[0]));
    
    if (voices.length > 0) {
        studyVoiceLabel.style.display = 'block';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.value = voice.voiceURI;
            studyVoiceSel.appendChild(option);
        });

        const preferredMaleVoice = voices.find(v => v.name.includes('Google UK English Male'));
        const firstGoogleMale = voices.find(v => v.name.startsWith('Google') && v.name.toLowerCase().includes('male'));
        const firstGoogleVoice = voices.find(v => v.name.startsWith('Google'));
        const firstVoice = voices[0];
        
        let defaultVoiceURI = null;
        if (preferredMaleVoice) {
            defaultVoiceURI = preferredMaleVoice.voiceURI;
        } else if (firstGoogleMale) {
            defaultVoiceURI = firstGoogleMale.voiceURI;
        } else if (firstGoogleVoice) {
            defaultVoiceURI = firstGoogleVoice.voiceURI;
        } else if (firstVoice) {
            defaultVoiceURI = firstVoice.voiceURI;
        }

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


transSel.addEventListener('change', populateVoiceSelector);
studySel.addEventListener('change', populateStudyVoiceSelector);

synth.onvoiceschanged = () => {
    populateStudyVoiceSelector();
    populateVoiceSelector();
};


const togglePause = () => {
    if (flashcards.length === 0) return;
    isPaused = !isPaused;
    if (isPaused) {
        floatingPauseBtn.textContent = '▶';
        try { synth.cancel(); } catch (_) { }
        manageMediaSessionState(false);
        clearTimeout(floatingBtnTimer);
        floatingPauseBtn.classList.add('visible');
        fsBtn.classList.add('visible');
        restartBtn.classList.add('visible');
    } else {
        floatingPauseBtn.textContent = '❚❚';
        showFloatingButtons();
        manageMediaSessionState(true);
        renderAndPlay();
    }
    saveState(); // Guardamos el estado al pausar/reanudar
};

const showFloatingButtons = () => {
    if (flashcards.length === 0) return;
    
    floatingPauseBtn.classList.add('visible');
    fsBtn.classList.add('visible');
    restartBtn.classList.add('visible');
    
    floatingPauseBtn.textContent = isPaused ? '▶' : '❚❚';

    clearTimeout(floatingBtnTimer);
    floatingBtnTimer = setTimeout(() => {
        if (!isPaused) {
            floatingPauseBtn.classList.remove('visible');
            fsBtn.classList.remove('visible');
            restartBtn.classList.remove('visible');
        }
    }, 3000);
};

flashcardEl.addEventListener('click', showFloatingButtons);
flashcardEl.addEventListener('touchstart', showFloatingButtons);

floatingPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePause();
});

restartBtn.addEventListener("click", () => {
    if(!flashcards.length) return;
    index=0;
    isPaused = false;
    clearTimeout(waitTimer);
    try{ synth.cancel(); }catch(_){ }
    saveState(); // Guardar el estado al reiniciar
    renderAndPlay();
});

wakeLockBtn.addEventListener('click', () => {
    alert("La gestión de pantalla ahora es automática. ¡A estudiar sin interrupciones!");
});

function isFullscreenActive(){
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
}
function updateFsIcon(){
    fsBtn.textContent = isFullscreenActive() ? '🗙' : '⛶';
    fsBtn.title = isFullscreenActive() ? 'Restaurar' : 'Pantalla completa';
}

async function enterFullscreen(el){
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) await el.msRequestFullscreen();
    updateFsIcon();
}
async function exitFullscreen(){
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    else if (document.msExitFullscreen) await document.webkitExitFullscreen();
    updateFsIcon();
}

fsBtn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if (isFullscreenActive()) await exitFullscreen();
    else await enterFullscreen(flashcardEl);
});

['fullscreenchange','webkitfullscreenchange','msfullscreenchange'].forEach(evt=>{
    document.addEventListener(evt, updateFsIcon);
});

repeatCountSel.addEventListener('change', () => {
    if (repeatCountSel.value === '1') {
        studyVoiceSel.disabled = false;
    }
    renderAndPlay();
    saveState(); // Guardar el estado al cambiar la configuración de repetición
});

showTransCheck.addEventListener('change', () => {
    const isChecked = showTransCheck.checked;
    transLang.disabled = !isChecked;
    transVoice.disabled = !isChecked;
    saveState(); // Guardar el estado al activar/desactivar la traducción
});

studySel.addEventListener('change', () => {
    renderAndPlay();
    saveState(); // Guardar el estado al cambiar de idioma de estudio
});

transSel.addEventListener('change', () => {
    renderAndPlay();
    saveState(); // Guardar el estado al cambiar de idioma de traducción
});

studyVoiceSel.addEventListener('change', () => {
    renderAndPlay();
    saveState(); // Guardar el estado al cambiar la voz de estudio
});

transVoiceSel.addEventListener('change', () => {
    renderAndPlay();
    saveState(); // Guardar el estado al cambiar la voz de traducción
});

// Guardar el estado cuando la página se oculta (por ejemplo, al apagar la pantalla)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        saveState();
        try {
            speechSynthesis.cancel();
        } catch (_) {}
    }
});

// Cargar el estado al iniciar la aplicación
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    
    // Si no se carga un estado previo, se inician los selectores.
    if (!localStorage.getItem(STATE_KEY)) {
        setupSelectors();
    }
});