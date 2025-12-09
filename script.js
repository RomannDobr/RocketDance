const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Основные переменные
let audioCtx, analyser, dataArray, source;
let currentEffect = "0";
let isRunning = false;
let pulseCircles = [];
let frameId;

// Настройки чувствительности
let autoSensitivity = 1.5;
let manualSensitivity = 1.5;
let volumeHistory = [];

// Для анализа ритма
let lastPulseTime = 0;
let beatHistory = [];
let lastBeatTime = 0;
let beatIntensity = 0;

// Синхронизация времени
let timeOffset = 0;

// Wake Lock системы
let audioWakeLock = null;
let wakeLockWorker = null;
let controlsTimeout;

// === ОПРЕДЕЛЕНИЕ УСТРОЙСТВА ===
const deviceInfo = (() => {
    const ua = navigator.userAgent;
    return {
        isIOS: /iPad|iPhone|iPod/.test(ua) && !window.MSStream,
        isAndroid: /Android/.test(ua),
        isSafari: /Safari/.test(ua) && !/Chrome/.test(ua),
        isChrome: /Chrome/.test(ua) && !/Edge/.test(ua),
        isPWA: window.matchMedia('(display-mode: standalone)').matches || 
               window.navigator.standalone,
        hasWakeLock: 'wakeLock' in navigator
    };
})();

// Проверка автовоспроизведения
let hasAutoPlay = true;

// === АУДИО WAKE LOCK ===
class AudioWakeLock {
    constructor() {
        this.ctx = null;
        this.osc = null;
        this.gain = null;
        this.active = false;
        this.timer = null;
    }
    
    // Автоматический запуск
    async startAuto() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            
            if (this.ctx.state === 'suspended') {
                await this.ctx.resume();
            }
            
            this.osc = this.ctx.createOscillator();
            this.gain = this.ctx.createGain();
            
            // Неслышимые настройки
            this.osc.frequency.value = 0.1;
            this.gain.gain.value = 0.00001;
            this.osc.type = 'sine';
            
            this.osc.connect(this.gain);
            this.gain.connect(this.ctx.destination);
            this.osc.start();
            this.active = true;
            
            this.startParameterTimer();
            return true;
            
        } catch (err) {
            hasAutoPlay = false;
            return false;
        }
    }
    
    // Запуск по клику
    startManual() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.osc = this.ctx.createOscillator();
            this.gain = this.ctx.createGain();
            
            this.osc.frequency.value = 0.1;
            this.gain.gain.value = 0.00001;
            this.osc.type = 'sine';
            
            this.osc.connect(this.gain);
            this.gain.connect(this.ctx.destination);
            this.osc.start();
            this.active = true;
            
            this.startParameterTimer();
            
        } catch (err) {
            console.log('Audio wake lock failed');
        }
    }
    
    startParameterTimer() {
        this.timer = setInterval(() => {
            if (this.active && this.osc) {
                this.osc.frequency.value = 0.1 + Math.random() * 0.05;
            }
        }, 15000);
    }
    
    stop() {
        if (this.timer) clearInterval(this.timer);
        if (this.osc) this.osc.stop();
        if (this.ctx) this.ctx.close();
        this.active = false;
    }
}

// === WEB WORKER ===
function startWakeLockWorker() {
    if (typeof Worker !== 'undefined') {
        try {
            const workerCode = `
                let timer;
                self.onmessage = (e) => {
                    if (e.data === 'start') {
                        timer = setInterval(() => self.postMessage('ping'), 20000);
                    } else if (e.data === 'stop') {
                        if (timer) clearInterval(timer);
                    }
                };
            `;
            
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            wakeLockWorker = new Worker(URL.createObjectURL(blob));
            wakeLockWorker.postMessage('start');
            wakeLockWorker.onmessage = () => localStorage.setItem('_wl', Date.now());
            
        } catch (err) {
            // Web Worker не доступен - игнорируем
        }
    }
}

// === УВЕДОМЛЕНИЯ ===
function showNotification(message, duration = 2000) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, duration);
}

// === УМНАЯ ИНИЦИАЛИЗАЦИЯ ===
function needsFirstClick() {
    // iOS Safari в браузере - всегда нужен клик
    if (deviceInfo.isIOS && deviceInfo.isSafari && !deviceInfo.isPWA) {
        return true;
    }
    
    // Если нет автовоспроизведения
    if (!hasAutoPlay) {
        return true;
    }
    
    // Для всех остальных случаев - не нужен
    return false;
}

async function initializeSmartWakeLock() {
    const needsClick = needsFirstClick();
    
    if (!needsClick) {
        // Автоматический запуск
        audioWakeLock = new AudioWakeLock();
        await audioWakeLock.startAuto();
        
        // Wake Lock API если доступен
        if (deviceInfo.hasWakeLock) {
            try {
                await navigator.wakeLock.request('screen');
            } catch (err) {
                // Игнорируем ошибки
            }
        }
        
        // Показываем индикатор автоматического запуска
        const indicator = document.getElementById('auto-start-indicator');
        if (indicator) {
            indicator.style.display = 'block';
            setTimeout(() => indicator.style.display = 'none', 2000);
        }
        
        // Скрываем подсказку клика
        document.body.classList.add('no-click-hint');
        
        // Автоматический полноэкран (кроме iOS)
        if (!deviceInfo.isIOS) {
            setTimeout(() => !isFullscreen() && toggleFullscreen(), 1000);
        }
        
        return false; // Не показывать подсказку клика
        
    } else {
        // Нужен клик пользователя
        let started = false;
        
        canvas.addEventListener('click', () => {
            if (!started) {
                started = true;
                
                audioWakeLock = new AudioWakeLock();
                audioWakeLock.startManual();
                
                if (deviceInfo.hasWakeLock) {
                    try {
                        navigator.wakeLock.request('screen');
                    } catch (err) {}
                }
                
                hideFirstClickHint();
                
                if (!deviceInfo.isIOS && !isFullscreen()) {
                    setTimeout(() => toggleFullscreen(), 500);
                }
            }
        }, { once: true });
        
        return true; // Показывать подсказку клика
    }
}

// === iOS PWA ИНСТРУКЦИЯ ===
function setupIOSPWAPrompt() {
    if (!deviceInfo.isIOS || deviceInfo.isPWA) return;
    if (localStorage.getItem('hidePWAPrompt') === 'true') return;
    
    setTimeout(() => {
        const instruction = document.getElementById('pwa-instruction');
        if (instruction) {
            instruction.style.display = 'block';
            
            document.getElementById('pwa-understand').addEventListener('click', () => {
                instruction.style.display = 'none';
                localStorage.setItem('hidePWAPrompt', 'true');
                showNotification('📱 Запускайте из ярлыка на домашнем экране', 3000);
            });
            
            document.getElementById('pwa-close').addEventListener('click', () => {
                instruction.style.display = 'none';
                showNotification('💡 На iOS экран может отключаться', 3000);
            });
            
            setTimeout(() => {
                if (instruction.style.display !== 'none') {
                    instruction.style.display = 'none';
                    localStorage.setItem('hidePWAPrompt', 'true');
                }
            }, 15000);
        }
    }, 5000);
}

// === УПРАВЛЕНИЕ ПОДСКАЗКАМИ ===
function showFirstClickHint() {
    const hint = document.getElementById('first-click-hint');
    if (hint) {
        hint.style.display = 'flex';
        hint.style.opacity = '0';
        hint.style.animation = 'fadeIn 0.5s ease forwards';
        
        canvas.addEventListener('click', hideFirstClickHint, { once: true });
        setTimeout(hideFirstClickHint, 8000);
    }
}

function hideFirstClickHint() {
    const hint = document.getElementById('first-click-hint');
    if (hint && hint.style.display !== 'none') {
        hint.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => hint.style.display = 'none', 300);
    }
}

// === ПОЛНОЭКРАННЫЙ РЕЖИМ ===
function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
    if (!isFullscreen()) {
        const elem = document.documentElement;
        
        if (elem.requestFullscreen) {
            elem.requestFullscreen().then(() => {
                showNotification('🖥️ Полноэкранный режим', 1500);
            }).catch(err => {
                console.log('Полноэкранный режим не поддерживается:', err);
            });
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
            showNotification('🖥️ Полноэкранный режим', 1500);
        } else if (elem.webkitEnterFullscreen) { // iOS
            elem.webkitEnterFullscreen();
            showNotification('🖥️ Полноэкранный режим', 1500);
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
            showNotification('📱 Обычный режим', 1500);
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
            showNotification('📱 Обычный режим', 1500);
        }
    }
}

// === МИКРОФОН С УВЕДОМЛЕНИЯМИ ===
async function startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
        showNotification('❌ Браузер не поддерживает микрофон', 3000);
        throw new Error('No microphone support');
    }
    
    try {
        showNotification('🎤 Запрос доступа к микрофону...', 2000);
        
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
        
        showNotification('✅ Микрофон подключен!', 2000);
        return true;
        
    } catch (error) {
        console.error('Ошибка микрофона:', error);
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            showNotification('❌ Доступ к микрофону отклонён', 3000);
        } else {
            showNotification('❌ Ошибка доступа к микрофону', 3000);
        }
        
        throw error;
    }
}

// === ИНИЦИАЛИЗАЦИЯ ШОУ ===
async function initializeShow() {
    try {
        // Настройка для iOS
        if (deviceInfo.isIOS && !deviceInfo.isPWA) {
            setupIOSPWAPrompt();
        }
        
        // Умная инициализация wake lock
        const showClickHint = await initializeSmartWakeLock();
        
        // Показываем подсказку клика если нужно
        if (showClickHint) {
            showFirstClickHint();
        }
        
        // Запускаем Web Worker
        startWakeLockWorker();
        
        // Синхронизация времени
        await synchronizeTime();
        
        // Пробуем микрофон
        try {
            await startMicrophone();
            startSynchronizedShow();
            showNotification('🎵 Цветомузыка запущена!', 3000);
        } catch (error) {
            showNotification('🔇 Демо-режим (без микрофона)', 3000);
            startDemoMode();
        }
        
        setupEventListeners();
        setupAdditionalControls();
        setupAutoHideControls();
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showNotification('⚡ Запускаем демо-режим...', 2000);
        startDemoMode();
        setupEventListeners();
        setupAdditionalControls();
        setupAutoHideControls();
    }
}

// === ДЕМО-РЕЖИМ ===
function startDemoMode() {
    currentEffect = getCurrentEffectByGlobalTime();
    isRunning = true;
    draw();
}

// === СИНХРОНИЗАЦИЯ ВРЕМЕНИ ===
async function synchronizeTime() {
    try {
        const start = Date.now();
        const response = await fetch('https://worldtimeapi.org/api/ip');
        if (!response.ok) throw new Error();
        
        const data = await response.json();
        const serverTime = data.unixtime * 1000;
        const localTime = Date.now();
        const roundTrip = Date.now() - start;
        
        timeOffset = serverTime - localTime + (roundTrip / 2);
        return timeOffset;
    } catch (error) {
        timeOffset = 0;
        return 0;
    }
}

function getSyncedTime() {
    return Date.now() + timeOffset;
}

// === ОСНОВНОЙ ЦИКЛ ===
function draw(timestamp) {
    if (!isRunning) return;
    frameId = requestAnimationFrame(draw);
    
    let bass = 0, mid = 0, high = 0, overall = 0, brightness = 0.5;
    
    if (analyser && dataArray) {
        try {
            analyser.getByteFrequencyData(dataArray);
            bass = getFrequencyRange(dataArray, 1, 10) * 0.3;
            mid = getFrequencyRange(dataArray, 10, 50);
            high = getFrequencyRange(dataArray, 50, 100);
            overall = (bass + mid + high) / 3;
            
            updateAutoSensitivity(overall);
            brightness = Math.min(1, (overall * autoSensitivity) / 128);
            detectRhythm(bass, mid, high);
            
        } catch (error) {}
    }
    
    ctx.fillStyle = `rgba(0,0,0,${0.15 + (1 - brightness) * 0.2})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
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
    
    updateCenterText(brightness, bass);
    updateEffectByTime();
}

// === СМЕНА ЭФФЕКТОВ ===
function getCurrentEffectByGlobalTime() {
    const now = getSyncedTime();
    const totalSeconds = Math.floor(now / 1000);
    const cycleSecond = totalSeconds % 24;
    
    if (cycleSecond < 6) return "0";
    else if (cycleSecond < 12) return "1";
    else if (cycleSecond < 18) return "0";
    else return "2";
}

function updateEffectByTime() {
    const newEffect = getCurrentEffectByGlobalTime();
    if (newEffect !== currentEffect) {
        currentEffect = newEffect;
        pulseCircles = [];
        beatHistory = [];
    }
}

function startSynchronizedShow() {
    currentEffect = getCurrentEffectByGlobalTime();
    isRunning = true;
    draw();
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
function getFrequencyRange(data, start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i];
    return sum / (end - start);
}

function updateAutoSensitivity(overallVolume) {
    if (manualSensitivity !== 1.5) {
        autoSensitivity = manualSensitivity;
        return;
    }
    
    volumeHistory.push(overallVolume);
    if (volumeHistory.length > 50) volumeHistory = volumeHistory.slice(-50);
    if (volumeHistory.length < 10) return;
    
    const maxVolume = Math.max(...volumeHistory);
    if (maxVolume < 30) autoSensitivity = Math.min(5.0, autoSensitivity + 0.1);
    else if (maxVolume > 200) autoSensitivity = Math.max(0.1, autoSensitivity - 0.1);
}

function detectRhythm(bass, mid, high) {
    const currentTime = getSyncedTime();
    const beatThreshold = 25 * (autoSensitivity / 1.5);
    const isBeat = (bass > beatThreshold || mid > beatThreshold * 0.5) &&
        currentTime - lastBeatTime > 100;
    
    if (isBeat) {
        beatIntensity = Math.max(bass, mid) / 255;
        lastBeatTime = currentTime;
        beatHistory.push(currentTime);
        if (beatHistory.length > 10) beatHistory = beatHistory.slice(-10);
    }
}

// === ЭФФЕКТЫ ===
function drawPulse(bass, mid, high, overall, brightness) {
    const currentTime = getSyncedTime();
    if (pulseCircles.length > 30) pulseCircles = pulseCircles.slice(-25);
    
    const silenceThreshold = 15 * (1.5 / autoSensitivity);
    const isSilent = overall < silenceThreshold;
    
    if (isSilent) {
        if (currentTime - lastPulseTime > 1500 + Math.random() * 2000) {
            createCalmPulseCircle(overall);
            lastPulseTime = currentTime;
        }
    } else {
        const beatThreshold = 25 * (autoSensitivity / 1.5);
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
    const sensitivityMultiplier = 0.5 + (autoSensitivity / 10);
    
    pulseCircles.push({
        x: centerX, y: centerY,
        radius: 0, maxRadius: maxSize,
        hue: Math.random() * 360,
        saturation: 90 + Math.random() * 10,
        lightness: 80 + Math.random() * 15,
        alpha: (0.8 + intensity * 0.005) * sensitivityMultiplier,
        speed: (30 + Math.random() * 40) * (0.5 + autoSensitivity / 3),
        life: 1.0,
        decay: 0.04 * (2 - autoSensitivity / 2.5)
    });
}

function createCalmPulseCircle(intensity) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxSize = Math.max(canvas.width, canvas.height) * 1.5;
    const sensitivityMultiplier = 0.3 + (autoSensitivity / 15);
    
    pulseCircles.push({
        x: centerX, y: centerY,
        radius: 0, maxRadius: maxSize,
        hue: 200 + Math.random() * 160,
        saturation: 30 + Math.random() * 20,
        lightness: 40 + Math.random() * 15,
        alpha: (0.3 + intensity * 0.002) * sensitivityMultiplier,
        speed: (4 + Math.random() * 4) * (0.3 + autoSensitivity / 5),
        life: 1.0,
        decay: 0.006 * (1.5 - autoSensitivity / 3.3)
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
        
        if (i === 0) value *= 0.3;
        else if (i > 6) value *= (1 + autoSensitivity / 2.5);
        
        const barHeight = Math.max(20, value * canvas.height * 0.003);
        const hue = (i / totalBars) * 360;
        const x = centerX - totalWidth / 2 + i * (barWidth + spacing);
        
        const gradientTop = ctx.createLinearGradient(x, centerY, x, centerY - barHeight);
        gradientTop.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.7 + autoSensitivity * 0.05})`);
        gradientTop.addColorStop(1, `hsla(${hue}, 100%, 70%, ${0.2 + autoSensitivity * 0.05})`);
        ctx.fillStyle = gradientTop;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
        
        const gradientBottom = ctx.createLinearGradient(x, centerY, x, centerY + barHeight);
        gradientBottom.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.7 + autoSensitivity * 0.05})`);
        gradientBottom.addColorStop(1, `hsla(${hue}, 100%, 70%, ${0.2 + autoSensitivity * 0.05})`);
        ctx.fillStyle = gradientBottom;
        ctx.fillRect(x, centerY, barWidth, barHeight);
    }
}

function drawHeart(bass, mid, high, overall, brightness) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseSize = Math.min(canvas.width, canvas.height) * 0.12;
    const pulseIntensity = 1 + (overall * autoSensitivity * 0.03);
    const heartSize = baseSize * pulseIntensity;
    
    let saturation = 80 + Math.min(20, overall * 0.2);
    let lightness = 60 + Math.min(15, overall * 0.1);
    let beatBonus = 1;
    
    if (beatIntensity > 0.3) {
        beatBonus = 1 + (beatIntensity * (0.2 + autoSensitivity * 0.05));
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
    
    if (beatIntensity > 0.4) {
        ctx.shadowBlur = 15 + (beatIntensity * 20 * (1 + autoSensitivity * 0.1));
        ctx.shadowColor = mainColor;
    }
    
    ctx.fillText('❤️', 0, 0);
    ctx.restore();
}

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
    
    for (let i = 0; i < totalBars; i++) {
        let barHeight = i === 0 ? 
            30 + Math.abs(Math.sin(getSyncedTime() * 0.005 + i * 0.3)) * 40 :
            30 + Math.abs(Math.sin(getSyncedTime() * 0.005 + i * 0.3)) * 80;
        
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
    ctx.fillStyle = `hsl(0, 90%, ${lightness}%)`;
    ctx.fillText('❤️', 0, 0);
    
    ctx.restore();
}

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

// === КОНТРОЛЛЕРЫ С УВЕДОМЛЕНИЯМИ ===
function setupEventListeners() {
    const sensitivitySlider = document.getElementById('sensitivitySlider');
    sensitivitySlider.addEventListener('input', (e) => {
        manualSensitivity = parseFloat(e.target.value);
        autoSensitivity = manualSensitivity;
        showNotification(`🎚️ Чувствительность: ${manualSensitivity.toFixed(1)}`, 1500);
    });
    
    canvas.addEventListener('click', () => {
        if (!isFullscreen()) toggleFullscreen();
    });
}

function setupAdditionalControls() {
    const qrButton = document.getElementById('qrButton');
    const bookmarkButton = document.getElementById('bookmarkButton');
    const qrModal = document.getElementById('qrModal');
    const closeQr = document.getElementById('closeQr');
    
    // QR-код
    qrButton.addEventListener('click', () => {
        generateQRCode();
        qrModal.classList.add('show');
        showNotification('📱 QR-код сгенерирован', 1500);
    });
    
    closeQr.addEventListener('click', () => {
        qrModal.classList.remove('show');
        showNotification('❌ QR-код закрыт', 1000);
    });
    
    qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) {
            qrModal.classList.remove('show');
            showNotification('❌ QR-код закрыт', 1000);
        }
    });
    
    // Кнопка "Поделиться"
    bookmarkButton.addEventListener('click', () => {
        const title = 'RocketDance - Цветомузыка';
        const url = window.location.href;
        
        if (navigator.share) {
            // Используем Web Share API если доступен
            navigator.share({
                title: title,
                url: url
            }).then(() => {
                showNotification('✅ Поделились успешно!', 2000);
            }).catch((error) => {
                if (error.name !== 'AbortError') {
                    fallbackShare(title, url);
                }
            });
        } else {
            fallbackShare(title, url);
        }
    });
}

// Функция для резервного способа поделиться
function fallbackShare(title, url) {
    // Проверяем различные браузеры
    if (window.sidebar && window.sidebar.addPanel) {
        // Firefox
        window.sidebar.addPanel(title, url, '');
        showNotification('✅ Добавлено в закладки Firefox', 2000);
    } else if (window.external && ('AddFavorite' in window.external)) {
        // Internet Explorer
        window.external.AddFavorite(url, title);
        showNotification('✅ Добавлено в избранное', 2000);
    } else {
        // Копирование в буфер обмена
        navigator.clipboard.writeText(url).then(() => {
            showNotification('📋 Ссылка скопирована в буфер обмена!', 2000);
        }).catch(() => {
            // Резервный способ показа ссылки
            const shareText = `RocketDance - Цветомузыка\n${url}`;
            prompt('Скопируйте ссылку:', shareText);
            showNotification('📋 Скопируйте ссылку из адресной строки', 3000);
        });
    }
}

function generateQRCode() {
    const qrCanvas = document.getElementById('qrCode');
    const ctx = qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    
    const qr = qrcode(0, 'M');
    qr.addData(window.location.href);
    qr.make();
    
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
                ctx.fillRect(col * cellSize + margin, row * cellSize + margin, cellSize, cellSize);
            }
        }
    }
}

// === УПРАВЛЕНИЕ КОНТРОЛЛАМИ ===
function hideControls() {
    const controls = document.querySelector('.controls');
    controls.style.opacity = '0';
    controls.style.pointerEvents = 'none';
}

function showControls() {
    const controls = document.querySelector('.controls');
    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto';
}

function setupAutoHideControls() {
    document.addEventListener('mousemove', showControlsTemporarily);
    document.addEventListener('touchstart', showControlsTemporarily);
    document.addEventListener('click', showControlsTemporarily);
    hideControlsAfterTimeout();
}

function showControlsTemporarily() {
    if (isFullscreen()) return;
    showControls();
    clearTimeout(controlsTimeout);
    hideControlsAfterTimeout();
}

function hideControlsAfterTimeout() {
    controlsTimeout = setTimeout(() => {
        if (!isFullscreen()) hideControls();
    }, 3000);
}

// === ОБРАБОТЧИКИ СОБЫТИЙ ===
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

window.addEventListener('beforeunload', () => {
    if (audioWakeLock) audioWakeLock.stop();
    if (wakeLockWorker) {
        wakeLockWorker.postMessage('stop');
        wakeLockWorker.terminate();
    }
});

// === ЗАПУСК ===
document.addEventListener('DOMContentLoaded', initializeShow);