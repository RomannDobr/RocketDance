const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let audioCtx, analyser, dataArray, source;
let currentEffect = "0";
let isRunning = false;
let pulseCircles = [];
let frameId;

// Настройки чувствительности
let autoSensitivity = 1.5;
let manualSensitivity = 1.5;
let volumeHistory = [];

// Переменные для анализа ритма
let lastPulseTime = 0;
let beatHistory = [];
let lastBeatTime = 0;
let beatIntensity = 0;

// Синхронизация времени между устройствами
let timeOffset = 0;

let noSleep = null;
let controlsTimeout;

// === Инициализация ===
document.addEventListener('DOMContentLoaded', async () => {
    await initializeShow();
});

// Инициализация No Sleep
function initializeNoSleep() {
    if ('wakeLock' in navigator) {
        // Используем современный Wake Lock API
        try {
            navigator.wakeLock.request('screen').then(wakeLock => {
                console.log('Screen wake lock acquired');
            }).catch(err => {
                console.log('Wake Lock API not supported:', err);
                initializeLegacyNoSleep();
            });
        } catch (err) {
            console.log('Wake Lock API error:', err);
            initializeLegacyNoSleep();
        }
    } else {
        // Используем legacy No Sleep.js
        initializeLegacyNoSleep();
    }
}

function initializeLegacyNoSleep() {
    try {
        if (typeof NoSleep !== 'undefined') {
            noSleep = new NoSleep();
            // Активируем при первом пользовательском взаимодействии
            document.addEventListener('click', enableNoSleep, { once: true });
        }
    } catch (err) {
        console.log('NoSleep.js not available:', err);
    }
}

function enableNoSleep() {
    if (noSleep) {
        noSleep.enable();
        console.log('NoSleep activated');
    }
}

// Функция скрытия контролов
function hideControls() {
    const controls = document.querySelector('.controls');
    controls.style.opacity = '0';
    controls.style.pointerEvents = 'none';
    controls.style.transition = 'opacity 0.3s ease';
}

// Функция показа контролов
function showControls() {
    const controls = document.querySelector('.controls');
    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto';
}

// Автоматическое скрытие контролов через 3 секунды
function setupAutoHideControls() {
    // Показываем контролы при любом взаимодействии
    document.addEventListener('mousemove', showControlsTemporarily);
    document.addEventListener('touchstart', showControlsTemporarily);
    document.addEventListener('click', showControlsTemporarily);

    // Скрываем через 3 секунды бездействия
    hideControlsAfterTimeout();
}

function showControlsTemporarily() {
    // Не показываем контролы в полноэкранном режиме
    if (isFullscreen()) return;
    
    showControls();
    clearTimeout(controlsTimeout);
    hideControlsAfterTimeout();
}

function hideControlsAfterTimeout() {
    controlsTimeout = setTimeout(() => {
        if (!isFullscreen()) {
            hideControls();
        }
    }, 3000);
}

// Проверка полноэкранного режима
function isFullscreen() {
    return !!(document.fullscreenElement || 
              document.webkitFullscreenElement ||
              document.mozFullScreenElement ||
              document.msFullscreenElement);
}

// === Синхронизация времени ===
async function synchronizeTime() {
    try {
        const startTime = Date.now();
        const response = await fetch('https://worldtimeapi.org/api/ip');
        if (!response.ok) throw new Error('Ошибка сервера времени');

        const data = await response.json();
        const serverTimeMs = data.unixtime * 1000;
        const localTimeMs = Date.now();

        const roundTripTime = Date.now() - startTime;
        timeOffset = serverTimeMs - localTimeMs + (roundTripTime / 2);

        console.log(`Время синхронизировано. Смещение: ${timeOffset} мс`);
        return timeOffset;
    } catch (error) {
        console.warn('Не удалось синхронизировать время:', error);
        timeOffset = 0;
        return 0;
    }
}

function getSyncedTime() {
    return Date.now() + timeOffset;
}

// === Определение текущего эффекта по глобальным секундам ===
function getCurrentEffectByGlobalTime() {
    const now = getSyncedTime();
    const totalSeconds = Math.floor(now / 1000);
    const cycleSecond = totalSeconds % 24; // 24-секундный цикл
    
    // Порядок: Вспышки, Спектр, Вспышки, Пульс
    if (cycleSecond < 6) {
        return "0"; // Вспышки (0-6 сек)
    } else if (cycleSecond < 12) {
        return "1"; // Спектр (6-12 сек)
    } else if (cycleSecond < 18) {
        return "0"; // Вспышки (12-18 сек)
    } else {
        return "2"; // Пульс (18-24 сек)
    }
}

// === Уведомления ===
function showNotification(message, duration = 2000) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), duration);
}

// === Регулятор чувствительности ===
function setupEventListeners() {
    const sensitivitySlider = document.getElementById('sensitivitySlider');

    sensitivitySlider.addEventListener('input', (e) => {
        manualSensitivity = parseFloat(e.target.value);
        autoSensitivity = manualSensitivity;
    });

    canvas.addEventListener('click', toggleFullscreen);
}

// === Полный экран по клику ===
function toggleFullscreen() {
    if (!isFullscreen()) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log('Полноэкранный режим не поддерживается');
        });
    } else {
        document.exitFullscreen();
    }
}

// === Инициализация шоу ===
async function initializeShow() {
    try {
        await synchronizeTime();
        initializeNoSleep();
        await startMicrophone();
        startSynchronizedShow();
        setupEventListeners();
        setupAdditionalControls();
        setupAutoHideControls();
        showNotification('🎵 Цветомузыка запущена!', 3000);
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        initializeNoSleep();
        showNotification('🔇 Демо-режим', 3000);
        startDemoMode();
        setupEventListeners();
        setupAdditionalControls();
        setupAutoHideControls();
    }
}

// === Запуск микрофона ===
async function startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не поддерживает аудио захват');
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        dataArray = new Uint8Array(analyser.frequencyBinCount);

        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        console.log('Микрофон подключен');
        return true;

    } catch (error) {
        console.error('Ошибка микрофона:', error);
        throw error;
    }
}

// === Демо-режим ===
function startDemoMode() {
    currentEffect = getCurrentEffectByGlobalTime();
    isRunning = true;
    draw();
}

// === Запуск синхронизированного шоу ===
function startSynchronizedShow() {
    currentEffect = getCurrentEffectByGlobalTime();
    isRunning = true;
    draw();
}

// === Автоматическая смена эффектов ===
function updateEffectByTime() {
    const newEffect = getCurrentEffectByGlobalTime();

    if (newEffect !== currentEffect) {
        currentEffect = newEffect;
        pulseCircles = [];
        beatHistory = [];
    }
}

// === Основной цикл ===
function draw(timestamp) {
    if (!isRunning) return;

    frameId = requestAnimationFrame(draw);

    let bass = 0, mid = 0, high = 0, overall = 0, brightness = 0.5;

    // Анализ аудио если микрофон доступен
    if (analyser && dataArray) {
        try {
            analyser.getByteFrequencyData(dataArray);

            // Басовый диапазон делаем менее чувствительным
            bass = getFrequencyRange(dataArray, 1, 10) * 0.3;
            mid = getFrequencyRange(dataArray, 10, 50);
            high = getFrequencyRange(dataArray, 50, 100);
            overall = (bass + mid + high) / 3;

            updateAutoSensitivity(overall);
            brightness = Math.min(1, (overall * autoSensitivity) / 128);
            detectRhythm(bass, mid, high);

        } catch (error) {
            console.log('Ошибка анализа аудио');
        }
    }

    // Очистка canvas
    ctx.fillStyle = `rgba(0,0,0,${0.15 + (1 - brightness) * 0.2})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Рендер эффекта
    if (analyser) {
        switch (currentEffect) {
            case "0": drawPulse(bass, mid, high, overall, brightness); break;
            case "1": drawSpectrumBars(bass, mid, high, brightness); break;
            case "2": drawHeart(bass, mid, high, overall, brightness); break;
        }
    } else {
        switch (currentEffect) {
            case "0": drawDemoPulse(); break;
            case "1": drawDemoSpectrum(); break;
            case "2": drawDemoHeart(); break;
        }
    }

    // Центральный текст
    updateCenterText(brightness, bass);

    // Смена эффектов
    updateEffectByTime();
}

// === Обновление центрального текста ===
function updateCenterText(brightness, bass) {
    const text = document.getElementById('centerText');
    text.style.opacity = 0.5 + brightness * 0.5;

    if (analyser) {
        text.style.transform = `translate(-50%, -50%) scale(${1 + bass * 0.001})`;
    } else {
        const demoScale = 1 + Math.sin(getSyncedTime() * 0.003) * 0.1;
        text.style.transform = `translate(-50%, -50%) scale(${demoScale})`;
    }
}

// === Автоматическая настройка чувствительности ===
function updateAutoSensitivity(overallVolume) {
    if (manualSensitivity !== 1.5) {
        autoSensitivity = manualSensitivity;
        return;
    }

    volumeHistory.push(overallVolume);
    if (volumeHistory.length > 50) {
        volumeHistory = volumeHistory.slice(-50);
    }

    if (volumeHistory.length < 10) return;

    const maxVolume = Math.max(...volumeHistory);

    // ОБНОВЛЕННЫЕ ПОРОГИ для увеличенного диапазона
    if (maxVolume < 30) {
        autoSensitivity = Math.min(5.0, autoSensitivity + 0.1);
    } else if (maxVolume > 200) {
        autoSensitivity = Math.max(0.1, autoSensitivity - 0.1);
    }
}

// === Анализ частот ===
function getFrequencyRange(data, start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) {
        sum += data[i];
    }
    return sum / (end - start);
}

// === Детектор ритма ===
function detectRhythm(bass, mid, high) {
    const currentTime = getSyncedTime();
    // УМЕНЬШЕН порог для лучшей реакции на низкой чувствительности
    const beatThreshold = 25 * (autoSensitivity / 1.5); // нормализуем к старому значению

    const isBeat = (bass > beatThreshold || mid > beatThreshold * 0.5) &&
        currentTime - lastBeatTime > 100;

    if (isBeat) {
        beatIntensity = Math.max(bass, mid) / 255;
        lastBeatTime = currentTime;
        beatHistory.push(currentTime);

        if (beatHistory.length > 10) {
            beatHistory = beatHistory.slice(-10);
        }
    }
}

// === Эффект Вспышки (повышенная чувствительность) ===
function drawPulse(bass, mid, high, overall, brightness) {
    const currentTime = getSyncedTime();
    
    if (pulseCircles.length > 30) {
        pulseCircles = pulseCircles.slice(-25);
    }
    
    // ОБНОВЛЕННЫЕ ПОРОГИ для увеличенного диапазона
    const silenceThreshold = 15 * (1.5 / autoSensitivity); // адаптивный порог
    
    const isSilent = overall < silenceThreshold;
    
    if (isSilent) {
        if (currentTime - lastPulseTime > 1500 + Math.random() * 2000) {
            createCalmPulseCircle(overall);
            lastPulseTime = currentTime;
        }
    } else {
        // ОБНОВЛЕННЫЙ порог для битов
        const beatThreshold = 25 * (autoSensitivity / 1.5); // нормализация
        
        const strongBeat = (bass > beatThreshold || mid > beatThreshold * 0.5);
        
        if (strongBeat && currentTime - lastPulseTime > 60) {
            createPulseCircle(Math.max(bass, mid));
            lastPulseTime = currentTime;
        }
        else if (overall > 20 && currentTime - lastPulseTime > 200 && Math.random() > 0.3) {
            createPulseCircle(overall * 0.8);
            lastPulseTime = currentTime;
        }
    }
    
    drawPulseCircles();
}

function createPulseCircle(intensity) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxSize = Math.max(canvas.width, canvas.height) * 2;
    
    // УСИЛЕНА зависимость от чувствительности
    const sensitivityMultiplier = 0.5 + (autoSensitivity / 10); // от 0.6 до 1.0
    
    pulseCircles.push({
        x: centerX,
        y: centerY,
        radius: 0,
        maxRadius: maxSize,
        hue: Math.random() * 360,
        saturation: 90 + Math.random() * 10,
        lightness: 80 + Math.random() * 15,
        alpha: (0.8 + intensity * 0.005) * sensitivityMultiplier, // зависимость от чувствительности
        speed: (30 + Math.random() * 40) * (0.5 + autoSensitivity / 3), // скорость зависит от чувствительности
        life: 1.0,
        decay: 0.04 * (2 - autoSensitivity / 2.5) // затухание зависит от чувствительности
    });
}

function createCalmPulseCircle(intensity) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxSize = Math.max(canvas.width, canvas.height) * 1.5;
    
    // ЗАВИСИМОСТЬ от чувствительности для спокойного режима
    const sensitivityMultiplier = 0.3 + (autoSensitivity / 15); // от 0.37 до 0.63
    
    pulseCircles.push({
        x: centerX,
        y: centerY,
        radius: 0,
        maxRadius: maxSize,
        hue: 200 + Math.random() * 160,
        saturation: 30 + Math.random() * 20,
        lightness: 40 + Math.random() * 15,
        alpha: (0.3 + intensity * 0.002) * sensitivityMultiplier,
        speed: (4 + Math.random() * 4) * (0.3 + autoSensitivity / 5), // от 0.46 до 1.3
        life: 1.0,
        decay: 0.006 * (1.5 - autoSensitivity / 3.3) // от 0.009 до 0.0036
    });
}

function drawPulseCircles() {
    for (let i = pulseCircles.length - 1; i >= 0; i--) {
        const circle = pulseCircles[i];
        const intensity = circle.life;

        const gradient = ctx.createRadialGradient(
            circle.x, circle.y, 0,
            circle.x, circle.y, circle.radius
        );

        gradient.addColorStop(0, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness}%, ${circle.alpha * intensity})`);
        gradient.addColorStop(0.5, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.8}%, ${circle.alpha * intensity * 0.5})`);
        gradient.addColorStop(1, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.6}%, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        ctx.fill();

        circle.radius += circle.speed;
        circle.life -= circle.decay;
        circle.speed *= 0.98;

        if (circle.life <= 0 || circle.radius > circle.maxRadius) {
            pulseCircles.splice(i, 1);
        }
    }
}

// === Эффект Спектр ===
function drawSpectrumBars(bass, mid, high, brightness) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const totalBars = 12;
    const barWidth = canvas.width * 0.06;
    const spacing = canvas.width * 0.01;
    const totalWidth = totalBars * (barWidth + spacing);

    for (let i = 0; i < totalBars; i++) {
        const startFreq = i * 5;
        const endFreq = (i + 1) * 5;
        let value = getFrequencyRange(dataArray, startFreq, endFreq) * autoSensitivity;
        
        // ОБНОВЛЕННЫЕ коэффициенты для увеличенного диапазона
        if (i === 0) {
            value *= 0.3; // басы
        } else if (i > 6) {
            value *= (1 + autoSensitivity / 2.5); // высокие частоты усиливаются с чувствительностью
        }
        
        const barHeight = Math.max(20, value * canvas.height * 0.003);
        const hue = (i / totalBars) * 360;
        
        const x = centerX - totalWidth / 2 + i * (barWidth + spacing);

        // Верхняя часть
        const gradientTop = ctx.createLinearGradient(x, centerY, x, centerY - barHeight);
        gradientTop.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.7 + autoSensitivity * 0.05})`); // прозрачность зависит от чувствительности
        gradientTop.addColorStop(1, `hsla(${hue}, 100%, 70%, ${0.2 + autoSensitivity * 0.05})`);
        ctx.fillStyle = gradientTop;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);

        // Нижняя часть
        const gradientBottom = ctx.createLinearGradient(x, centerY, x, centerY + barHeight);
        gradientBottom.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.7 + autoSensitivity * 0.05})`);
        gradientBottom.addColorStop(1, `hsla(${hue}, 100%, 70%, ${0.2 + autoSensitivity * 0.05})`);
        ctx.fillStyle = gradientBottom;
        ctx.fillRect(x, centerY, barWidth, barHeight);
    }
}

// === Эффект Пульс ===
function drawHeart(bass, mid, high, overall, brightness) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const baseSize = Math.min(canvas.width, canvas.height) * 0.12;
    
    // УСИЛЕНА зависимость пульсации от чувствительности
    const pulseIntensity = 1 + (overall * autoSensitivity * 0.03); // было 0.02
    const heartSize = baseSize * pulseIntensity;

    let saturation = 80 + Math.min(20, overall * 0.2);
    let lightness = 60 + Math.min(15, overall * 0.1);

    let beatBonus = 1;
    if (beatIntensity > 0.3) {
        beatBonus = 1 + (beatIntensity * (0.2 + autoSensitivity * 0.05)); // зависимость от чувствительности
    }

    const finalHeartSize = heartSize * beatBonus;

    ctx.save();
    ctx.translate(centerX, centerY);

    const fontSize = finalHeartSize * 2.5;
    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const mainColor = `hsl(0, ${saturation}%, ${lightness}%)`;
    ctx.fillStyle = mainColor;

    // УСИЛЕН эффект свечения на высокой чувствительности
    if (beatIntensity > 0.4) {
        ctx.shadowBlur = 15 + (beatIntensity * 20 * (1 + autoSensitivity * 0.1));
        ctx.shadowColor = mainColor;
    }

    ctx.fillText('❤️', 0, 0);

    ctx.restore();
}

// === Демо-режим эффектов ===
function drawDemoPulse() {
    const currentTime = getSyncedTime();

    if (currentTime - lastPulseTime > 1500) {
        createCalmPulseCircle(150);
        lastPulseTime = currentTime;
    }

    drawPulseCircles();
}

function drawDemoSpectrum() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const totalBars = 12;
    const barWidth = canvas.width * 0.06;
    const spacing = canvas.width * 0.01;
    const totalWidth = totalBars * (barWidth + spacing);

    const wave = Math.sin(getSyncedTime() * 0.005);

    for (let i = 0; i < totalBars; i++) {
        let barHeight;
        if (i === 0) {
            barHeight = 30 + Math.abs(Math.sin(getSyncedTime() * 0.005 + i * 0.3)) * 40;
        } else {
            barHeight = 30 + Math.abs(Math.sin(getSyncedTime() * 0.005 + i * 0.3)) * 80;
        }

        const hue = (i / totalBars) * 360;
        const x = centerX - totalWidth / 2 + i * (barWidth + spacing);

        const gradient = ctx.createLinearGradient(x, centerY, x, centerY - barHeight);
        gradient.addColorStop(0, `hsla(${hue}, 80%, 65%, 0.8)`);
        gradient.addColorStop(1, `hsla(${hue}, 80%, 65%, 0.3)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
        ctx.fillRect(x, centerY, barWidth, barHeight);
    }
}

function drawDemoHeart() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const pulse = Math.sin(getSyncedTime() * 0.004) * 0.15 + 1;
    const baseSize = Math.min(canvas.width, canvas.height) * 0.12;
    const heartSize = baseSize * pulse;

    ctx.save();
    ctx.translate(centerX, centerY);

    const fontSize = heartSize * 2.5;
    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lightness = 60 + Math.sin(getSyncedTime() * 0.005) * 10;
    const mainColor = `hsl(0, 90%, ${lightness}%)`;

    ctx.fillStyle = mainColor;
    ctx.fillText('❤️', 0, 0);

    ctx.restore();
}

// === QR-код и закладки ===
function setupAdditionalControls() {
    const qrButton = document.getElementById('qrButton');
    const bookmarkButton = document.getElementById('bookmarkButton');
    const qrModal = document.getElementById('qrModal');
    const closeQr = document.getElementById('closeQr');

    // Генерация QR-кода
    qrButton.addEventListener('click', () => {
        generateQRCode();
        qrModal.classList.add('show');
    });

    // Закрытие QR-модального окна
    closeQr.addEventListener('click', () => {
        qrModal.classList.remove('show');
    });

    // Закрытие по клику вне окна
    qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) {
            qrModal.classList.remove('show');
        }
    });

    // Добавление в закладки
    bookmarkButton.addEventListener('click', () => {
        addToBookmarks();
    });
}

// Генерация QR-кода
function generateQRCode() {
    const qrCanvas = document.getElementById('qrCode');
    const currentUrl = window.location.href;

    // Очищаем canvas
    const ctx = qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);

    // Генерируем QR-код
    const qr = qrcode(0, 'M');
    qr.addData(currentUrl);
    qr.make();

    // Рисуем QR-код на canvas
    const cellSize = 4;
    const margin = 10;
    const size = qr.getModuleCount() * cellSize + margin * 2;

    qrCanvas.width = size;
    qrCanvas.height = size;

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'black';
    for (let row = 0; row < qr.getModuleCount(); row++) {
        for (let col = 0; col < qr.getModuleCount(); col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect(
                    col * cellSize + margin,
                    row * cellSize + margin,
                    cellSize,
                    cellSize
                );
            }
        }
    }
}

// Добавление в закладки
function addToBookmarks() {
    const title = 'RocketDance - Цветомузыка';
    const url = window.location.href;

    if (window.sidebar && window.sidebar.addPanel) {
        // Firefox
        window.sidebar.addPanel(title, url, '');
    } else if (window.external && ('AddFavorite' in window.external)) {
        // Internet Explorer
        window.external.AddFavorite(url, title);
    } else if (window.opera && window.print) {
        // Opera
        const elem = document.createElement('a');
        elem.setAttribute('href', url);
        elem.setAttribute('title', title);
        elem.setAttribute('rel', 'sidebar');
        elem.click();
    } else {
        // Современные браузеры
        if (navigator.share) {
            navigator.share({
                title: title,
                url: url
            }).catch(() => {
                showNotification('Скопируйте ссылку из адресной строки');
            });
        } else {
            // Копирование в буфер обмена
            navigator.clipboard.writeText(url).then(() => {
                showNotification('📑 Ссылка скопирована в буфер обмена!');
            }).catch(() => {
                showNotification('📑 Скопируйте ссылку из адресной строки');
            });
        }
    }
}

// === Обработчики событий ===
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Обновленная функция проверки видимости контролов
function updateControlsVisibility() {
    if (isFullscreen()) {
        hideControls();
    } else {
        showControls();
        // Запускаем таймер автоскрытия только если не в полноэкранном режиме
        hideControlsAfterTimeout();
    }
}

// Обработчики изменения полноэкранного режима
document.addEventListener('fullscreenchange', updateControlsVisibility);
document.addEventListener('webkitfullscreenchange', updateControlsVisibility);
document.addEventListener('mozfullscreenchange', updateControlsVisibility);
document.addEventListener('MSFullscreenChange', updateControlsVisibility);

// Инициализация видимости контролов при загрузке
updateControlsVisibility();