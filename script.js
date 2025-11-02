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
let autoSensitivity = 1.0;
let manualSensitivity = 1.5;
let volumeHistory = [];

// Переменные для анализа ритма
let lastPulseTime = 0;
let beatHistory = [];
let rhythmMode = 'smooth';
let lastBeatTime = 0;
let beatIntensity = 0;

// Синхронизация по времени
let nextEffectChangeTime = null;
const EFFECT_DURATION = 6000;

// === Инициализация ===
document.addEventListener('DOMContentLoaded', () => {
    initializeShow();
    setupEventListeners();
});

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
    const sensitivityValue = document.getElementById('sensitivityValue');

    sensitivitySlider.addEventListener('input', (e) => {
        manualSensitivity = parseFloat(e.target.value);
        sensitivityValue.textContent = manualSensitivity.toFixed(1);
        autoSensitivity = manualSensitivity;
    });

    // Клик по canvas для полноэкранного режима
    canvas.addEventListener('click', toggleFullscreen);
}

// === Полный экран по клику ===
function toggleFullscreen() {
    if (!document.fullscreenElement) {
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
        await startMicrophone();
        startSynchronizedShow();
        showNotification('🎵 Цветомузыка запущена!', 3000);
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showNotification('🔇 Демо-режим', 3000);
        startDemoMode();
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
    nextEffectChangeTime = Date.now() + EFFECT_DURATION;
    currentEffect = "0";
    isRunning = true;
    draw();
}

// === Запуск синхронизированного шоу ===
function startSynchronizedShow() {
    nextEffectChangeTime = Date.now() + EFFECT_DURATION;
    currentEffect = "0";
    isRunning = true;
    draw();
}

// === Автоматическая смена эффектов ===
function updateEffectByTime() {
    const now = Date.now();
    
    if (now >= nextEffectChangeTime) {
        const effects = ["0", "1", "2"];
        const currentIndex = effects.indexOf(currentEffect);
        const nextIndex = (currentIndex + 1) % effects.length;
        currentEffect = effects[nextIndex];
        
        nextEffectChangeTime = now + EFFECT_DURATION;
        pulseCircles = [];
        beatHistory = [];
        
        showNotification(`✨ ${modeName(currentEffect)}`);
    }
}

function modeName(mode) {
    switch (mode) {
        case "0": return "Вспышки";
        case "1": return "Спектр";
        case "2": return "Пульс";
        default: return "Вспышки";
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
            
            bass = getFrequencyRange(dataArray, 1, 10);
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
        const demoScale = 1 + Math.sin(Date.now() * 0.003) * 0.1;
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
    
    if (maxVolume < 30) {
        autoSensitivity = Math.min(3.0, autoSensitivity + 0.1);
    } else if (maxVolume > 200) {
        autoSensitivity = Math.max(0.5, autoSensitivity - 0.1);
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
    const currentTime = Date.now();
    const beatThreshold = 60 * autoSensitivity;
    
    const isBeat = (bass > beatThreshold || mid > beatThreshold * 0.8) && 
                  currentTime - lastBeatTime > 150;
    
    if (isBeat) {
        beatIntensity = Math.max(bass, mid) / 255;
        lastBeatTime = currentTime;
        beatHistory.push(currentTime);
        
        if (beatHistory.length > 10) {
            beatHistory = beatHistory.slice(-10);
        }
    }
}

// === Эффект Вспышки ===
function drawPulse(bass, mid, high, overall, brightness) {
    const currentTime = Date.now();
    
    // Ограничиваем количество кругов
    if (pulseCircles.length > 20) {
        pulseCircles = pulseCircles.slice(-15);
    }
    
    // Создаем пульсации на битах
    const beatThreshold = 70 * autoSensitivity;
    if ((bass > beatThreshold || mid > beatThreshold * 0.8) && 
        currentTime - lastPulseTime > 200) {
        createPulseCircle(Math.max(bass, mid));
        lastPulseTime = currentTime;
    }
    
    // Создаем случайные пульсации
    if (currentTime - lastPulseTime > 500 && Math.random() > 0.8) {
        createPulseCircle(overall);
        lastPulseTime = currentTime;
    }
    
    // Отрисовываем круги
    drawPulseCircles();
}

function createPulseCircle(intensity) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxSize = Math.max(canvas.width, canvas.height) * 2;
    
    pulseCircles.push({
        x: centerX,
        y: centerY,
        radius: 0,
        maxRadius: maxSize,
        hue: Math.random() * 360,
        saturation: 80 + Math.random() * 20,
        lightness: 70 + Math.random() * 20,
        alpha: 0.7 + intensity * 0.002,
        speed: 30 + Math.random() * 20,
        life: 1.0,
        decay: 0.03
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
        
        // Усиливаем высокие частоты
        if (i > 6) value *= 2;
        
        const barHeight = Math.max(20, value * canvas.height * 0.003);
        const hue = (i / totalBars) * 360;
        
        const x = centerX - totalWidth / 2 + i * (barWidth + spacing);

        // Верхняя часть
        const gradientTop = ctx.createLinearGradient(x, centerY, x, centerY - barHeight);
        gradientTop.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.9)`);
        gradientTop.addColorStop(1, `hsla(${hue}, 100%, 70%, 0.3)`);
        ctx.fillStyle = gradientTop;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);

        // Нижняя часть
        const gradientBottom = ctx.createLinearGradient(x, centerY, x, centerY + barHeight);
        gradientBottom.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.9)`);
        gradientBottom.addColorStop(1, `hsla(${hue}, 100%, 70%, 0.3)`);
        ctx.fillStyle = gradientBottom;
        ctx.fillRect(x, centerY, barWidth, barHeight);
    }
}

// === Эффект Пульс (Сердце) ===
function drawHeart(bass, mid, high, overall, brightness) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2; // Поднято выше

    const baseSize = Math.min(canvas.width, canvas.height) * 0.12;
    const pulseIntensity = 1 + (overall * autoSensitivity * 0.02);
    const heartSize = baseSize * pulseIntensity;

    // Цвет в зависимости от громкости
    let saturation = 80 + Math.min(20, overall * 0.2);
    let lightness = 60 + Math.min(15, overall * 0.1);

    // Пульсация на битах
    let beatBonus = 1;
    if (beatIntensity > 0.3) {
        beatBonus = 1 + (beatIntensity * 0.2);
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

    // Свечение на битах
    if (beatIntensity > 0.4) {
        ctx.shadowBlur = 15 + (beatIntensity * 20);
        ctx.shadowColor = mainColor;
    }

    ctx.fillText('❤️', 0, 0);

    ctx.restore();
}

// === Демо-режим эффектов ===
function drawDemoPulse() {
    const currentTime = Date.now();
    
    if (currentTime - lastPulseTime > 800) {
        createPulseCircle(150);
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
    
    const wave = Math.sin(Date.now() * 0.005);

    for (let i = 0; i < totalBars; i++) {
        const barHeight = 30 + Math.abs(Math.sin(Date.now() * 0.005 + i * 0.3)) * 80;
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

    const pulse = Math.sin(Date.now() * 0.004) * 0.15 + 1;
    const baseSize = Math.min(canvas.width, canvas.height) * 0.12;
    const heartSize = baseSize * pulse;

    ctx.save();
    ctx.translate(centerX, centerY);

    const fontSize = heartSize * 2.5;
    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lightness = 60 + Math.sin(Date.now() * 0.005) * 10;
    const mainColor = `hsl(0, 90%, ${lightness}%)`;
    
    ctx.fillStyle = mainColor;
    ctx.fillText('❤️', 0, 0);

    ctx.restore();
}

// === Обработчики событий ===
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Скрытие контроллера в полноэкранном режиме
document.addEventListener('fullscreenchange', updateControlsVisibility);
document.addEventListener('webkitfullscreenchange', updateControlsVisibility);

function updateControlsVisibility() {
    const controls = document.querySelector('.controls');
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none';
    } else {
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
    }
}