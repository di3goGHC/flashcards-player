document.addEventListener('DOMContentLoaded', () => {
    // Selectores de elementos
    const fileInput = document.getElementById('fileInput');
    const studyLangSelect = document.getElementById('studyLang');
    const transLangSelect = document.getElementById('transLang');
    const speedSelect = document.getElementById('speed');
    const pauseSelect = document.getElementById('pause');
    const repeatCountSelect = document.getElementById('repeatCount');
    const showTransCheck = document.getElementById('showTransCheck');
    const studyVoiceSelect = document.getElementById('studyVoice');
    const transVoiceSelect = document.getElementById('transVoice');
    const floatingPauseBtn = document.getElementById('floatingPauseBtn');
    const restartBtn = document.getElementById('restartBtn');
    const fsBtn = document.getElementById('fsBtn');
    const wakeLockBtn = document.getElementById('wakeLockBtn');
    const introSection = document.getElementById('intro');
    const phraseSection = document.getElementById('phrase');
    const translationSection = document.getElementById('translation');
    const errorSection = document.getElementById('error');
    const counterElement = document.getElementById('counter');
    const fileNameElement = document.getElementById('fileName');
    const installMessage = document.getElementById('installMessage');
    const installBtn = document.getElementById('installBtn');

    // Variables de estado
    let flashcardsData = null;
    let currentPhraseIndex = 0;
    let currentRepeat = 0;
    let isPaused = false;
    let wakeLock = null;
    let deferredPrompt = null;
    const synth = window.speechSynthesis;
    const speechQueue = [];

    // --- Funcionalidad PWA ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            installMessage.style.display = 'block';
        });

        installBtn.addEventListener('click', () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('Usuario aceptó la instalación de la PWA');
                    } else {
                        console.log('Usuario rechazó la instalación de la PWA');
                    }
                    deferredPrompt = null;
                    installMessage.style.display = 'none';
                });
            }
        });
    }

    // --- Funcionalidad de Wake Lock (Bloqueo de pantalla) ---
    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock activado');
                wakeLockBtn.textContent = '🔓';
            } catch (err) {
                console.error('Error al activar Wake Lock:', err.name, err.message);
                wakeLock = null;
            }
        }
    }

    function releaseWakeLock() {
        if (wakeLock) {
            wakeLock.release().then(() => {
                wakeLock = null;
                console.log('Wake Lock liberado');
                wakeLockBtn.textContent = '🔒';
            });
        }
    }

    // El botón ahora solo informa el estado y lo activa/desactiva manualmente
    wakeLockBtn.addEventListener('click', () => {
        if (wakeLock) {
            releaseWakeLock();
        } else {
            requestWakeLock();
        }
    });

    // --- Persistencia del estado (localStorage) ---
    function saveState() {
        if (flashcardsData) {
            localStorage.setItem('flashcardsIndex', currentPhraseIndex);
            localStorage.setItem('flashcardsFile', fileNameElement.textContent);
        }
    }

    function loadState() {
        const savedIndex = localStorage.getItem('flashcardsIndex');
        const savedFile = localStorage.getItem('flashcardsFile');
        if (savedIndex && savedFile) {
            currentPhraseIndex = parseInt(savedIndex, 10);
            fileNameElement.textContent = `Último archivo cargado: ${savedFile.replace('Archivo cargado: ', '')}`;
        }
    }

    window.addEventListener('beforeunload', saveState);
    window.addEventListener('pagehide', saveState);

    // --- Funcionalidad de Voz y Síntesis ---
    function populateVoiceList() {
        const voices = synth.getVoices().sort((a, b) => a.lang.localeCompare(b.lang));
        studyVoiceSelect.innerHTML = '';
        transVoiceSelect.innerHTML = '';
        
        const studyLang = studyLangSelect.value;
        const transLang = transLangSelect.value;
        
        voices.forEach(voice => {
            if (voice.lang.includes(studyLang)) {
                const option = new Option(voice.name, voice.name);
                studyVoiceSelect.appendChild(option);
            }
            if (voice.lang.includes(transLang)) {
                const option = new Option(voice.name, voice.name);
                transVoiceSelect.appendChild(option);
            }
        });
        document.getElementById('studyVoiceLabel').style.display = (studyVoiceSelect.options.length > 0) ? 'block' : 'none';
        document.getElementById('transVoiceLabel').style.display = (transVoiceSelect.options.length > 0) ? 'block' : 'none';
    }

    synth.onvoiceschanged = populateVoiceList;

    function speak(text, lang, voiceName) {
        return new Promise((resolve) => {
            if (!synth || !text) return resolve();
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = synth.getVoices();
            utterance.voice = voices.find(v => v.name === voiceName);
            utterance.lang = lang;
            utterance.rate = parseFloat(speedSelect.value);

            utterance.onend = () => resolve();
            utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event.error);
                resolve();
            };
            synth.speak(utterance);
        });
    }

    async function processQueue() {
        if (isPaused) return;
        const nextUtterance = speechQueue.shift();
        if (nextUtterance) {
            await speak(nextUtterance.text, nextUtterance.lang, nextUtterance.voice);
            processQueue(); // Llama a la siguiente en la cola
        } else {
            nextPhrase(); // Fin de la reproducción, ir a la siguiente flashcard
        }
    }

    // --- Lógica de la aplicación principal ---
    function updateUI() {
        if (!flashcardsData || isPaused) return;

        const phrase = flashcardsData[currentPhraseIndex];
        const studyLang = studyLangSelect.value;
        const transLang = transLangSelect.value;
        const showTranslation = showTransCheck.checked;
        const total = flashcardsData.length;

        // Mostrar elementos de la UI
        introSection.style.display = 'none';
        phraseSection.style.opacity = '1';
        translationSection.style.opacity = showTranslation ? '1' : '0';
        floatingPauseBtn.style.opacity = '1';
        restartBtn.style.opacity = '1';
        fsBtn.style.opacity = '1';

        phraseSection.textContent = phrase[studyLang] || 'N/A';
        translationSection.textContent = phrase[transLang] || 'N/A';
        counterElement.textContent = `${currentPhraseIndex + 1}/${total}`;

        // Llenar la cola de audio
        speechQueue.length = 0; // Limpiar la cola
        const studyVoice = studyVoiceSelect.value;
        const transVoice = transVoiceSelect.value;
        
        // Frase de estudio
        for (let i = 0; i < parseInt(repeatCountSelect.value); i++) {
            speechQueue.push({ text: phrase[studyLang], lang: studyLang, voice: studyVoice });
        }
        // Traducción
        if (showTranslation) {
            speechQueue.push({ text: phrase[transLang], lang: transLang, voice: transVoice });
        }

        // Iniciar la reproducción
        synth.cancel(); // Detiene cualquier audio anterior
        processQueue();
    }

    function nextPhrase() {
        currentPhraseIndex++;
        if (currentPhraseIndex < flashcardsData.length) {
            setTimeout(updateUI, parseFloat(pauseSelect.value) * 1000);
        } else {
            console.log("Fin del estudio.");
            floatingPauseBtn.style.opacity = '0';
            releaseWakeLock(); // Liberar el Wake Lock al finalizar
        }
    }

    function restart() {
        currentPhraseIndex = 0;
        currentRepeat = 0;
        isPaused = false;
        synth.cancel();
        releaseWakeLock();
        updateUI();
    }

    function togglePause() {
        isPaused = !isPaused;
        if (isPaused) {
            floatingPauseBtn.textContent = '▶️';
            synth.cancel();
            releaseWakeLock();
        } else {
            floatingPauseBtn.textContent = '⏸️';
            requestWakeLock();
            updateUI();
        }
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsedData = JSON.parse(e.target.result);
                if (Array.isArray(parsedData)) {
                    flashcardsData = parsedData;
                } else if (parsedData && Array.isArray(parsedData.phrases)) {
                    flashcardsData = parsedData.phrases;
                } else {
                    errorSection.textContent = 'El archivo JSON no contiene el formato esperado o está vacío.';
                    flashcardsData = null;
                    return;
                }
                
                if (flashcardsData.length > 0) {
                    fileNameElement.textContent = `Archivo cargado: ${file.name}`;
                    const languages = new Set();
                    flashcardsData.forEach(phrase => {
                        Object.keys(phrase).forEach(lang => languages.add(lang));
                    });
                    studyLangSelect.innerHTML = '';
                    transLangSelect.innerHTML = '';
                    languages.forEach(lang => {
                        studyLangSelect.appendChild(new Option(lang, lang));
                        transLangSelect.appendChild(new Option(lang, lang));
                    });
                    if (languages.has("en")) studyLangSelect.value = "en";
                    if (languages.has("es")) transLangSelect.value = "es";
                    errorSection.textContent = '';
                    restart();
                    requestWakeLock();
                } else {
                    errorSection.textContent = 'El archivo JSON no contiene el formato esperado o está vacío.';
                    flashcardsData = null;
                }
            } catch (err) {
                errorSection.textContent = 'Error al leer el archivo JSON. Asegúrate de que el formato sea válido.';
                console.error(err);
                flashcardsData = null;
            }
        };
        reader.readAsText(file);
    });
    
    studyLangSelect.addEventListener('change', populateVoiceList);
    transLangSelect.addEventListener('change', populateVoiceList);
    floatingPauseBtn.addEventListener('click', togglePause);
    restartBtn.addEventListener('click', restart);
    showTransCheck.addEventListener('change', updateUI);

    fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
            fsBtn.textContent = '⛶';
        } else {
            document.documentElement.requestFullscreen();
            fsBtn.textContent = '🗙';
        }
    });

    // Cargar la lista de voces al inicio y estado guardado
    populateVoiceList();
    loadState();
});