const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
const introDiv = document.getElementById('intro');
const phraseDiv = document.getElementById('phrase');
const translationDiv = document.getElementById('translation');
const errorDiv = document.getElementById('error');
const studyLangSelect = document.getElementById('studyLang');
const transLangSelect = document.getElementById('transLang');
const studyVoiceSelect = document.getElementById('studyVoice');
const transVoiceSelect = document.getElementById('transVoice');
const showTransCheck = document.getElementById('showTransCheck');
const repeatCountSelect = document.getElementById('repeatCount');
const speedSelect = document.getElementById('speed');
const pauseSelect = document.getElementById('pause');
const fsBtn = document.getElementById('fsBtn');
const floatingPauseBtn = document.getElementById('floatingPauseBtn');
const restartBtn = document.getElementById('restartBtn');
const wakeLockBtn = document.getElementById('wakeLockBtn');
const installBtn = document.getElementById('installBtn');

let studyList = [];
let currentPhraseIndex = 0;
let phrases = [];
let voiceSpeech = null;
let transSpeech = null;
let phraseSpeaker = null;
let transSpeaker = null;
let isPlaying = false;
let isPaused = false;
let speechTimeout;
let repeatCount = 1;
let currentRepeat = 0;
let wakeLock = null;
let deferredPrompt;
let audioPlayer;

function saveState() {
    const state = {
        currentPhraseIndex,
        repeatCount: repeatCountSelect.value,
        speed: speedSelect.value,
        pause: pauseSelect.value,
        studyLang: studyLangSelect.value,
        transLang: transLangSelect.value,
        showTransCheck: showTransCheck.checked,
        fileName: fileNameDisplay.textContent
    };
    localStorage.setItem('flashcards_state', JSON.stringify(state));
}

function restoreState() {
    const savedState = localStorage.getItem('flashcards_state');
    if (savedState) {
        const state = JSON.parse(savedState);
        currentPhraseIndex = state.currentPhraseIndex || 0;
        repeatCountSelect.value = state.repeatCount || 2;
        speedSelect.value = state.speed || 1.2;
        pauseSelect.value = state.pause || 1;
        showTransCheck.checked = state.showTransCheck || false;
        fileNameDisplay.textContent = state.fileName || '';
        if (state.studyLang) {
            studyLangSelect.value = state.studyLang;
        }
        if (state.transLang) {
            transLangSelect.value = state.transLang;
        }
    }
}

function updateUI() {
    const phrase = phrases[currentPhraseIndex];
    if (phrase) {
        phraseDiv.textContent = phrase.phrase;
        translationDiv.textContent = showTransCheck.checked ? phrase.translation : '';
    }
    document.getElementById('counter').textContent = `${currentPhraseIndex + 1} / ${phrases.length}`;
}

function nextPhrase() {
    if (currentPhraseIndex < phrases.length - 1) {
        currentPhraseIndex++;
    } else {
        currentPhraseIndex = 0;
    }
    updateUI();
    saveState();
    startAudioSequence();
}

function startAudioSequence() {
    if (!isPlaying || isPaused) return;

    // Detener audio anterior si existe
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    
    clearTimeout(speechTimeout);
    
    const phrase = phrases[currentPhraseIndex];
    
    // Hablar la frase principal
    phraseSpeaker.text = phrase.phrase;
    phraseSpeaker.rate = speedSelect.value;
    speechSynthesis.speak(phraseSpeaker);

    speechTimeout = setTimeout(() => {
        // Hablar la traducción si está visible
        if (showTransCheck.checked) {
            transSpeaker.text = phrase.translation;
            transSpeaker.rate = speedSelect.value;
            speechSynthesis.speak(transSpeaker);
        }
    }, (phraseSpeaker.text.split(' ').length / speedSelect.value) * 1000 + (pauseSelect.value * 1000));

    speechTimeout = setTimeout(() => {
        if (currentRepeat < repeatCount - 1) {
            currentRepeat++;
            startAudioSequence();
        } else {
            currentRepeat = 0;
            nextPhrase();
        }
    }, (phraseSpeaker.text.split(' ').length / speedSelect.value) * 1000 + 
    (showTransCheck.checked ? (transSpeaker.text.split(' ').length / speedSelect.value) * 1000 : 0) + 
    (pauseSelect.value * 1000 * 2)); // Doble pausa para dar tiempo entre repeticiones
}

function toggleAudio() {
    if (isPlaying) {
        pauseAudio();
    } else {
        playAudio();
    }
}

function playAudio() {
    if (phrases.length === 0) return;
    isPlaying = true;
    isPaused = false;
    floatingPauseBtn.textContent = '⏸';
    startAudioSequence();
}

function pauseAudio() {
    isPlaying = false;
    isPaused = true;
    floatingPauseBtn.textContent = '▶';
    speechSynthesis.pause();
    clearTimeout(speechTimeout);
}

function restartList() {
    currentPhraseIndex = 0;
    currentRepeat = 0;
    saveState();
    updateUI();
    if (isPlaying) {
        playAudio();
    }
}

function updateVoices() {
    const voices = speechSynthesis.getVoices();
    studyVoiceSelect.innerHTML = '';
    transVoiceSelect.innerHTML = '';

    const studyLang = studyLangSelect.value;
    const transLang = transLangSelect.value;

    voices.filter(voice => voice.lang.startsWith(studyLang))
          .forEach(voice => {
              const option = document.createElement('option');
              option.textContent = `${voice.name} (${voice.lang})`;
              option.value = voice.name;
              studyVoiceSelect.appendChild(option);
          });
    
    voices.filter(voice => voice.lang.startsWith(transLang))
          .forEach(voice => {
              const option = document.createElement('option');
              option.textContent = `${voice.name} (${voice.lang})`;
              option.value = voice.name;
              transVoiceSelect.appendChild(option);
          });
}

function setupLanguages(data) {
    const availableLangs = new Set();
    data.forEach(item => {
        Object.keys(item.phrases).forEach(lang => availableLangs.add(lang));
    });

    const langOptions = Array.from(availableLangs);
    langOptions.sort();

    studyLangSelect.innerHTML = '';
    transLangSelect.innerHTML = '';
    
    langOptions.forEach(lang => {
        const studyOption = document.createElement('option');
        studyOption.value = lang;
        studyOption.textContent = lang;
        studyLangSelect.appendChild(studyOption);

        const transOption = document.createElement('option');
        transOption.value = lang;
        transOption.textContent = lang;
        transLangSelect.appendChild(transOption);
    });
}

function loadFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = `Archivo cargado: ${file.name}`;
    const reader = new FileReader();

    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            setupLanguages(data);
            
            studyList = data;
            errorDiv.textContent = '';
            introDiv.style.display = 'none';

            // Restaurar estado guardado
            restoreState();

            // Sincronizar select de idiomas
            if (studyLangSelect.value) {
                updateVoices();
            }

            // Iniciar o restaurar
            if (phrases.length > 0) {
                // Si ya había una lista, se mantiene el estado
                updatePhrases();
                updateUI();
            } else {
                updatePhrases();
                updateUI();
                playAudio();
            }
            
        } catch (err) {
            errorDiv.textContent = 'Error al leer el archivo JSON.';
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function updatePhrases() {
    const studyLang = studyLangSelect.value;
    const transLang = transLangSelect.value;

    phrases = studyList.map(item => ({
        phrase: item.phrases[studyLang] || '',
        translation: item.phrases[transLang] || ''
    }));

    // Actualizar los speakers con las nuevas voces
    const studyVoiceName = studyVoiceSelect.value;
    const transVoiceName = transVoiceSelect.value;

    const voices = speechSynthesis.getVoices();
    phraseSpeaker = voices.find(voice => voice.name === studyVoiceName) || new SpeechSynthesisUtterance();
    transSpeaker = voices.find(voice => voice.name === transVoiceName) || new SpeechSynthesisUtterance();
    phraseSpeaker.lang = studyLang;
    transSpeaker.lang = transLang;
}

// Event Listeners
fileInput.addEventListener('change', loadFile);
floatingPauseBtn.addEventListener('click', toggleAudio);
restartBtn.addEventListener('click', restartList);
fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
});

// Save state on changes
studyLangSelect.addEventListener('change', () => {
    updateVoices();
    updatePhrases();
    saveState();
    restartList();
});
transLangSelect.addEventListener('change', () => {
    updateVoices();
    updatePhrases();
    saveState();
    restartList();
});
studyVoiceSelect.addEventListener('change', saveState);
transVoiceSelect.addEventListener('change', saveState);
repeatCountSelect.addEventListener('change', saveState);
speedSelect.addEventListener('change', saveState);
pauseSelect.addEventListener('change', saveState);
showTransCheck.addEventListener('change', () => {
    updateUI();
    saveState();
});

// Speech Synthesis
speechSynthesis.onvoiceschanged = updateVoices;

// Wake Lock API
if ('wakeLock' in navigator) {
    wakeLockBtn.addEventListener('click', async () => {
        if (!wakeLock) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    wakeLockBtn.textContent = '🔒';
                    wakeLockBtn.dataset.active = "false";
                });
                wakeLockBtn.textContent = '🔓';
                wakeLockBtn.dataset.active = "true";
            } catch (err) {
                console.error('Wake Lock API:', err);
            }
        } else {
            wakeLock.release();
            wakeLock = null;
        }
    });
} else {
    wakeLockBtn.style.display = 'none';
}

// PWA Install
window.addEventListener('beforeinstallprompt', (e) => {
    deferredPrompt = e;
    installBtn.style.display = 'block';
});

installBtn.addEventListener('click', (e) => {
    installBtn.style.display = 'none';
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('Usuario aceptó instalar la PWA');
        } else {
            console.log('Usuario rechazó la instalación de la PWA');
        }
        deferredPrompt = null;
    });
});