document.addEventListener('DOMContentLoaded', () => {
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

    let flashcardsData = null;
    let currentPhraseIndex = 0;
    let currentRepeat = 0;
    let isPaused = false;
    let isSpeaking = false;
    let isFullScreen = false;
    let speechQueue = [];
    let wakeLock = null;

    // --- Funcionalidad del Service Worker y PWA
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        if ('BeforeInstallPromptEvent' in window) {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                installMessage.style.display = 'block';
                installMessage.addEventListener('click', () => {
                    e.prompt();
                });
            });
        }
    }

    // --- Gestión de la pantalla encendida (Wake Lock)
    if ('wakeLock' in navigator) {
        wakeLockBtn.addEventListener('click', async () => {
            if (wakeLock === null) {
                try {
                    wakeLock = await navigator.wakeLock.request('screen');
                    wakeLockBtn.textContent = '💡';
                    wakeLockBtn.dataset.active = 'true';
                    console.log('Wake Lock activo');
                    wakeLock.addEventListener('release', () => {
                        console.log('Wake Lock liberado');
                        wakeLockBtn.textContent = '💡';
                        wakeLockBtn.dataset.active = 'false';
                    });
                } catch (err) {
                    console.error('Error al activar Wake Lock:', err);
                }
            } else {
                wakeLock.release();
                wakeLock = null;
            }
        });
    } else {
        wakeLockBtn.style.display = 'none';
    }

    // --- Funcionalidad de Voz y Síntesis
    function populateVoiceList() {
        const voices = speechSynthesis.getVoices();
        voices.sort((a, b) => a.lang.localeCompare(b.lang));
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

    speechSynthesis.onvoiceschanged = populateVoiceList;

    function speak(text, lang, voiceName) {
        return new Promise((resolve) => {
            if (!speechSynthesis) return resolve();
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = speechSynthesis.getVoices();
            utterance.voice = voices.find(v => v.name === voiceName);
            utterance.lang = lang;
            utterance.rate = parseFloat(speedSelect.value);

            utterance.onend = () => {
                isSpeaking = false;
                resolve();
                processQueue();
            };
            utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event.error);
                resolve();
            };

            isSpeaking = true;
            speechSynthesis.speak(utterance);
        });
    }

    function processQueue() {
        if (!isSpeaking && speechQueue.length > 0) {
            const nextUtterance = speechQueue.shift();
            speak(nextUtterance.text, nextUtterance.lang, nextUtterance.voice).then(() => {
                if (speechQueue.length === 0) {
                    nextPhrase();
                }
            });
        }
    }

    function addUtterance(text, lang, voice) {
        speechQueue.push({ text, lang, voice });
        if (!isSpeaking) {
            processQueue();
        }
    }

    // --- Lógica de la aplicación
    function updateUI() {
        const phrase = flashcardsData.phrases[currentPhraseIndex];
        const studyLang = studyLangSelect.value;
        const transLang = transLangSelect.value;
        const showTranslation = showTransCheck.checked;
        const total = flashcardsData.phrases.length;

        introSection.style.display = 'none';
        phraseSection.style.opacity = '1';
        translationSection.style.opacity = (showTranslation) ? '1' : '0';
        floatingPauseBtn.style.opacity = '1';
        restartBtn.style.opacity = '1';
        fsBtn.style.opacity = '1';

        phraseSection.textContent = phrase[studyLang] || 'N/A';
        translationSection.textContent = phrase[transLang] || 'N/A';
        counterElement.textContent = `${currentPhraseIndex + 1}/${total}`;

        if (!isPaused) {
            const studyVoice = studyVoiceSelect.value;
            const transVoice = transVoiceSelect.value;
            
            speechQueue = [];
            addUtterance(phrase[studyLang], studyLang, studyVoice);
            for (let i = 0; i < currentRepeat; i++) {
                addUtterance(phrase[studyLang], studyLang, studyVoice);
            }
            if (showTranslation) {
                addUtterance(phrase[transLang], transLang, transVoice);
            }
        }
    }

    function nextPhrase() {
        if (isPaused) return;

        currentRepeat++;
        if (currentRepeat >= parseInt(repeatCountSelect.value)) {
            currentRepeat = 0;
            currentPhraseIndex++;
        }

        if (currentPhraseIndex < flashcardsData.phrases.length) {
            setTimeout(updateUI, parseFloat(pauseSelect.value) * 1000);
        } else {
            console.log("Fin del estudio.");
            floatingPauseBtn.style.opacity = '0';
        }
    }

    function restart() {
        currentPhraseIndex = 0;
        currentRepeat = 0;
        isPaused = false;
        speechSynthesis.cancel();
        updateUI();
    }

    function togglePause() {
        if (isSpeaking) {
            speechSynthesis.pause();
            isPaused = true;
            floatingPauseBtn.textContent = '▶️';
        } else {
            speechSynthesis.resume();
            isPaused = false;
            floatingPauseBtn.textContent = '⏸️';
        }
        isSpeaking = !isSpeaking;
    }

    // --- Event Listeners
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                flashcardsData = JSON.parse(e.target.result);
                if (flashcardsData && flashcardsData.phrases && flashcardsData.phrases.length > 0) {
                    fileNameElement.textContent = `Archivo cargado: ${file.name}`;
                    const languages = new Set();
                    flashcardsData.phrases.forEach(phrase => {
                        Object.keys(phrase).forEach(lang => languages.add(lang));
                    });

                    studyLangSelect.innerHTML = '';
                    transLangSelect.innerHTML = '';
                    languages.forEach(lang => {
                        const option1 = new Option(lang, lang);
                        const option2 = new Option(lang, lang);
                        studyLangSelect.appendChild(option1);
                        transLangSelect.appendChild(option2);
                    });
                    
                    const defaultStudyLang = "en";
                    const defaultTransLang = "es";
                    if (languages.has(defaultStudyLang)) studyLangSelect.value = defaultStudyLang;
                    if (languages.has(defaultTransLang)) transLangSelect.value = defaultTransLang;
                    
                    errorSection.textContent = '';
                    restart();
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
        if (!isFullScreen) {
            document.documentElement.requestFullscreen();
            fsBtn.textContent = '🗗';
        } else {
            document.exitFullscreen();
            fsBtn.textContent = '🗖';
        }
        isFullScreen = !isFullScreen;
    });

    // Cargar la lista de voces al inicio
    populateVoiceList();
});