const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let audioCtx, analyser, dataArray, source;
let image = null;
let currentEffect = localStorage.getItem('effect') || "0";
let isRunning = false;
let pulseCircles = [];
let frameId;
let autoMode = currentEffect === "auto";
let autoTimer = 0;
let devMode = false;

// Настройки чувствительности
let autoSensitivity = 1.0;
let manualSensitivity = 1.5;
let volumeHistory = [];
let sensitivityAdjustTimer = 0;

// Переменные для анализа ритма
let lastPulseTime = 0;
let beatHistory = [];
let rhythmMode = 'smooth';
let beatDetectionTimer = 0;
let lastBeatTime = 0;
let beatIntensity = 0;

// Мониторинг производительности
let frameTimes = [];
let lastFrameTime = 0;

const FPS = 60;
const frameInterval = 1000 / FPS;

// === Улучшенное управление dropdown ===
const dropdown = document.querySelector('.dropdown');
const dropdownContent = document.querySelector('.dropdown-content');
let dropdownHideTimeout;

dropdown.addEventListener('mouseenter', () => {
  clearTimeout(dropdownHideTimeout);
  dropdownContent.style.display = 'block';
});

dropdown.addEventListener('mouseleave', () => {
  dropdownHideTimeout = setTimeout(() => {
    dropdownContent.style.display = 'none';
  }, 800);
});

dropdownContent.addEventListener('mouseenter', () => {
  clearTimeout(dropdownHideTimeout);
});

dropdownContent.addEventListener('mouseleave', () => {
  dropdownHideTimeout = setTimeout(() => {
    dropdownContent.style.display = 'none';
  }, 800);
});

// === Регулятор чувствительности ===
const sensitivitySlider = document.getElementById('sensitivitySlider');
const sensitivityValue = document.getElementById('sensitivityValue');

sensitivitySlider.addEventListener('input', (e) => {
  manualSensitivity = parseFloat(e.target.value);
  sensitivityValue.textContent = manualSensitivity.toFixed(1);
  autoSensitivity = manualSensitivity;
});

// === Обработчик полного экрана ===
function updateFullscreenButton() {
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (document.fullscreenElement) {
    fullscreenBtn.textContent = "⛶ Выйти из полного экрана";
  } else {
    fullscreenBtn.textContent = "⛶ Полный экран";
  }
}

document.addEventListener('fullscreenchange', updateFullscreenButton);

// === Инициализация UI ===
document.getElementById('currentMode').textContent = modeName(currentEffect);

// === Уведомления ===
function showNotification(message, duration = 2000) {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.classList.add('show');
  setTimeout(() => notification.classList.remove('show'), duration);
}

// === Режим разработчика (Ctrl+D) ===
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'd') {
    devMode = !devMode;
    document.getElementById('uploadPanel').style.display = devMode ? 'block' : 'none';
    document.getElementById('audioControls').style.display = devMode ? 'flex' : 'none';
    showNotification(devMode ? 'Режим разработчика включен' : 'Режим разработчика выключен');
  }

  if (e.code === 'Space') {
    e.preventDefault();
    document.getElementById('startBtn').click();
  }
});

// === PNG загрузка ===
document.getElementById('imageUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = () => {
    image = img;
    document.getElementById('centerText').style.display = 'none';
    showNotification('Изображение загружено');
  };
});

// === Полный экран ===
document.getElementById('fullscreenBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

// === Эффекты ===
document.querySelectorAll('.dropdown-content div').forEach(item => {
  item.addEventListener('click', () => {
    currentEffect = item.dataset.mode;
    autoMode = currentEffect === "auto";
    localStorage.setItem('effect', currentEffect);
    document.getElementById('currentMode').textContent = modeName(currentEffect);
    showNotification(`Режим: ${modeName(currentEffect)}`);

    pulseCircles = [];
    beatHistory = [];
    rhythmMode = 'smooth';
    volumeHistory = [];
    autoSensitivity = manualSensitivity;
    autoTimer = 0;
  });
});

function modeName(mode) {
  switch (mode) {
    case "0": return "💥 Вспышки";
    case "1": return "📊 Спектр";
    case "2": return "💓 Пульс";
    case "auto": return "🔄 Авто";
    default: return "💥 Вспышки";
  }
}

// === Мониторинг производительности ===
function monitorPerformance() {
  const now = performance.now();
  if (lastFrameTime) {
    frameTimes.push(now - lastFrameTime);
    if (frameTimes.length > 60) {
      const avg = frameTimes.reduce((a, b) => a + b) / frameTimes.length;
      if (avg > 20 && devMode) console.warn(`Low FPS: ${(1000 / avg).toFixed(1)}`);
      frameTimes = [];
    }
  }
  lastFrameTime = now;
}

// === Улучшенный запуск микрофона БЕЗ снижения громкости ===
async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Ваш браузер не поддерживает аудио захват');
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // РАДИКАЛЬНОЕ РЕШЕНИЕ: используем только необходимые параметры
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Минимальные настройки - только то что действительно нужно
      channelCount: 1,
      sampleRate: 44100,
      // Убираем ВСЕ обработки звука
      echoCancellation: { exact: false },
      noiseSuppression: { exact: false },
      autoGainControl: { exact: false },
      // Явно отключаем коммуникационные функции
      googEchoCancellation: false,
      googAutoGainControl: false,
      googNoiseSuppression: false,
      googHighpassFilter: false,
      // Пробуем указать низкий приоритет
      latency: 0.01
    }
  });

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  // Важно: НЕ подключаем к выходу системы
  // analyser.connect(audioCtx.destination);

  return true;
}

// === Запуск/остановка ===
document.getElementById('startBtn').addEventListener('click', async e => {
  if (isRunning) {
    cancelAnimationFrame(frameId);
    if (audioCtx) {
      // Быстрое и чистое закрытие
      try {
        await audioCtx.suspend();
        await audioCtx.close();
      } catch (err) {
        console.log('Аудиоконтекст уже закрыт');
      }
      audioCtx = null;
    }
    isRunning = false;
    e.target.textContent = "🎵 Запустить цветомузыку";
    showNotification('Визуализация остановлена');
    volumeHistory = [];
    autoSensitivity = manualSensitivity;
    return;
  }

  try {
    await startMicrophone();

    isRunning = true;
    e.target.textContent = "⏹️ Остановить цветомузыку";
    showNotification('Визуализация запущена!');
    draw();
  } catch (error) {
    console.error('Ошибка:', error);

    let errorMessage = error.message;
    if (error.name === 'NotAllowedError') {
      errorMessage = 'Разрешите доступ к микрофону в настройках браузера';
    } else if (error.name === 'NotFoundError') {
      errorMessage = 'Микрофон не найден. Проверьте подключение устройства';
    } else if (error.name === 'NotSupportedError') {
      errorMessage = 'Ваш браузер не поддерживает аудио захват';
    }

    showNotification(`Ошибка: ${errorMessage}`, 5000);
    isRunning = false;
    e.target.textContent = "🎵 Запустить цветомузыку";
  }
});

// === Автоматическая настройка чувствительности ===
function updateAutoSensitivity(overallVolume) {
  if (manualSensitivity !== 1.5) {
    autoSensitivity = manualSensitivity;
    return;
  }

  volumeHistory.push(overallVolume);

  if (volumeHistory.length > 100) {
    volumeHistory = volumeHistory.slice(-100);
  }

  sensitivityAdjustTimer++;
  if (sensitivityAdjustTimer < 30 || volumeHistory.length < 50) return;
  sensitivityAdjustTimer = 0;

  const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
  const maxVolume = Math.max(...volumeHistory);
  const dynamicRange = maxVolume - avgVolume;

  if (maxVolume < 50) {
    autoSensitivity = Math.min(3.0, autoSensitivity + 0.05);
  } else if (maxVolume > 180) {
    autoSensitivity = Math.max(0.5, autoSensitivity - 0.05);
  } else if (dynamicRange < 30) {
    autoSensitivity = Math.min(2.5, autoSensitivity + 0.02);
  } else if (dynamicRange > 80) {
    autoSensitivity = Math.max(0.8, autoSensitivity - 0.02);
  }

  const targetSensitivity = 1.5;
  autoSensitivity += (targetSensitivity - autoSensitivity) * 0.01;
  autoSensitivity = Math.max(0.5, Math.min(3.0, autoSensitivity));
}

// === Основной цикл ===
function draw(timestamp) {
  frameId = requestAnimationFrame(draw);

  if (timestamp - lastFrameTime < frameInterval) return;
  lastFrameTime = timestamp;

  monitorPerformance();

  if (!analyser) return;

  analyser.getByteFrequencyData(dataArray);

  // Смещаем диапазоны чтобы исключить самые крайние частоты
  const bass = getFrequencyRange(dataArray, 8, 30);     // Уже и выше
  const mid = getFrequencyRange(dataArray, 30, 100);    // Сужен  
  const high = getFrequencyRange(dataArray, 100, 220);  // Расширен и выше
  const overall = (bass + mid + high) / 3;

  updateAutoSensitivity(overall);

  const brightness = Math.min(1, (overall * autoSensitivity) / 128);

  detectRhythm(bass, mid, high);

  ctx.fillStyle = `rgba(0,0,0,${0.15 + (1 - brightness) * 0.2})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (autoMode) {
    autoTimer += brightness;
    if (autoTimer > 100) {
      const effects = ["0", "1", "2"];
      const currentIndex = effects.indexOf(currentEffect === "auto" ? "0" : currentEffect);
      const nextIndex = (currentIndex + 1) % effects.length;
      currentEffect = effects[nextIndex];
      document.getElementById('currentMode').textContent = modeName(currentEffect);
      autoTimer = 0;
      pulseCircles = [];
    }
  }

  switch (currentEffect) {
    case "0": drawPulse(bass, mid, high, overall, brightness); break;
    case "1": drawSpectrumBars(bass, mid, high, brightness); break;
    case "2": drawHeart(bass, mid, high, overall, brightness); break;
  }

  if (image) {
    const scale = 0.5 + bass * 0.002;
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.globalAlpha = 0.7 + brightness * 0.3;
    ctx.drawImage(image, canvas.width / 2 - w / 2, canvas.height / 2 - h / 2, w, h);
    ctx.globalAlpha = 1;
  } else {
    const text = document.getElementById('centerText');
    text.style.opacity = 0.5 + brightness * 0.5;
    text.style.transform = `translate(-50%, -50%) scale(${1 + bass * 0.001})`;
  }
}

function getFrequencyRange(data, start, end) {
  let sum = 0;
  let count = 0;

  for (let i = start; i < end; i++) {
    // УСИЛЕННЫЕ высокие частоты, РЕЗКИЙ срез низких
    let weight = 1.0;
    const position = (i - start) / (end - start); // 0-1 позиция в диапазоне

    // РЕЗКИЙ срез самых низких частот (первые 20% диапазона)
    if (position < 0.2) {
      weight = Math.pow(position / 0.2, 3) * 0.1; // Очень резкое падение
    }
    // УСИЛЕНИЕ высоких частот (последние 40% диапазона)
    else if (position > 0.6) {
      weight = 1.2 + (position - 0.6) * 0.8; // Усиление до 1.6x
    }
    // Средние частоты - нормальная чувствительность
    else {
      weight = 0.8 + (position - 0.2) * 1.0; // Плавный рост до 1.0
    }

    sum += data[i] * weight;
    count += weight;
  }

  return count > 0 ? sum / count : 0;
}

// === Детектор ритма ===
function detectRhythm(bass, mid, high) {
  const currentTime = Date.now();

  const beatThreshold = 70 * autoSensitivity;
  const isBeat = (bass > beatThreshold || mid > beatThreshold * 0.8) &&
    currentTime - lastBeatTime > 100;

  if (isBeat) {
    beatIntensity = Math.max(bass, mid) / 255;
    lastBeatTime = currentTime;

    beatHistory.push(currentTime);
    if (beatHistory.length > 20) {
      beatHistory = beatHistory.slice(-20);
    }
  }

  beatDetectionTimer++;
  if (beatDetectionTimer > 120) {
    analyzeRhythmPattern();
    beatDetectionTimer = 0;
  }
}

function analyzeRhythmPattern() {
  if (beatHistory.length < 8) {
    if (rhythmMode !== 'smooth') {
      rhythmMode = 'smooth';
    }
    return;
  }

  const intervals = [];
  for (let i = 1; i < beatHistory.length; i++) {
    intervals.push(beatHistory[i] - beatHistory[i - 1]);
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + Math.pow(b - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const rhythmCoefficient = stdDev / avgInterval;

  const rhythmThreshold = 0.3;

  if (rhythmCoefficient < rhythmThreshold && avgInterval < 600) {
    if (rhythmMode !== 'rhythmic') {
      rhythmMode = 'rhythmic';
    }
  } else {
    if (rhythmMode !== 'smooth') {
      rhythmMode = 'smooth';
    }
  }
}

// === Эффект Вспышки - УВЕЛИЧЕННЫЙ ===
function drawPulse(bass, mid, high, overall, brightness) {
  const currentTime = Date.now();

  if (pulseCircles.length > 25) {
    pulseCircles = pulseCircles.slice(-20);
  }

  if (rhythmMode === 'rhythmic') {
    const beatThreshold = 70 * autoSensitivity;
    if ((bass > beatThreshold || mid > beatThreshold * 0.8) &&
      currentTime - lastPulseTime > 150) {
      createRhythmicPulse(Math.max(bass, mid), 'beat');
      lastPulseTime = currentTime;
    }
  } else {
    const pulseInterval = 180 + (1 - brightness) * 250;
    if (currentTime - lastPulseTime > pulseInterval) {
      createSmoothPulse(overall, 'smooth');
      lastPulseTime = currentTime;
    }

    if (high > 35 * autoSensitivity && Math.random() > 0.5) {
      createSmoothPulse(high, 'high');
    }
  }

  drawPulseCircles();
}

function createRhythmicPulse(intensity, type) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const maxSize = Math.max(canvas.width, canvas.height) * 2.5;

  const mainCircle = {
    x: centerX,
    y: centerY,
    radius: 0,
    maxRadius: maxSize,
    hue: type === 'beat' ? Math.random() * 60 : 180 + Math.random() * 120,
    saturation: 95,
    lightness: 90,
    alpha: 0.9 + intensity * 0.001,
    speed: 60 + Math.random() * 40,
    life: 1.0,
    decay: 0.06,
    type: 'rhythmic'
  };

  pulseCircles.push(mainCircle);

  for (let i = 0; i < 5; i++) {
    pulseCircles.push({
      x: centerX,
      y: centerY,
      radius: 0,
      maxRadius: maxSize * (0.4 + Math.random() * 0.6),
      hue: (mainCircle.hue + 20 + Math.random() * 140) % 360,
      saturation: 85 + Math.random() * 20,
      lightness: 75 + Math.random() * 20,
      alpha: 0.7 + Math.random() * 0.3,
      speed: mainCircle.speed * (0.5 + Math.random() * 0.6),
      life: 0.95,
      decay: 0.08 + Math.random() * 0.1,
      type: 'rhythmic_echo'
    });
  }
}

function createSmoothPulse(intensity, type) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const maxSize = Math.max(canvas.width, canvas.height) * 2.2;

  const smoothCircle = {
    x: centerX,
    y: centerY,
    radius: 0,
    maxRadius: maxSize,
    hue: type === 'high' ? 270 + Math.random() * 60 : 120 + Math.random() * 120,
    saturation: 80 + Math.random() * 20,
    lightness: 70 + Math.random() * 25,
    alpha: 0.6 + intensity * 0.004,
    speed: 25 + Math.random() * 20,
    life: 1.0,
    decay: 0.02,
    type: 'smooth'
  };

  pulseCircles.push(smoothCircle);
}

function drawPulseCircles() {
  for (let i = pulseCircles.length - 1; i >= 0; i--) {
    const circle = pulseCircles[i];
    const intensity = circle.life;

    const gradient = ctx.createRadialGradient(
      circle.x, circle.y, Math.max(0, circle.radius * 0.03),
      circle.x, circle.y, circle.radius
    );

    if (circle.type.includes('rhythmic')) {
      gradient.addColorStop(0, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness}%, ${circle.alpha * intensity})`);
      gradient.addColorStop(0.15, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.85}%, ${circle.alpha * intensity * 0.8})`);
      gradient.addColorStop(0.4, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.7}%, ${circle.alpha * intensity * 0.5})`);
      gradient.addColorStop(0.7, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.5}%, ${circle.alpha * intensity * 0.3})`);
      gradient.addColorStop(1, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.3}%, 0)`);
    } else {
      gradient.addColorStop(0, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness}%, ${circle.alpha * intensity * 0.95})`);
      gradient.addColorStop(0.3, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.85}%, ${circle.alpha * intensity * 0.7})`);
      gradient.addColorStop(0.6, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.7}%, ${circle.alpha * intensity * 0.4})`);
      gradient.addColorStop(1, `hsla(${circle.hue}, ${circle.saturation}%, ${circle.lightness * 0.5}%, 0)`);
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();

    circle.radius += circle.speed;
    circle.life -= circle.decay;
    circle.speed *= circle.type.includes('rhythmic') ? 0.94 : 0.97;

    if (circle.life <= 0 || circle.radius > circle.maxRadius) {
      pulseCircles.splice(i, 1);
    }
  }
}

// === Спектр с обрезанными низкими и усиленными высокими частотами ===
function drawSpectrumBars(bass, mid, high, brightness) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const totalBars = 8;

  const barWidth = canvas.width * 0.1;
  const spacing = canvas.width * 0.02;
  const totalWidth = totalBars * (barWidth + spacing);

  // Увеличиваем обрезку только низких частот, высокие оставляем
  const frequenciesPerBar = Math.floor((dataArray.length - 30) / totalBars); // Убираем только первые 15 частот

  for (let i = 0; i < totalBars; i++) {
    // Пропускаем только первые 15 низких частот, высокие не трогаем
    const startFreq = 25 + i * frequenciesPerBar;
    const endFreq = 15 + (i + 1) * frequenciesPerBar;
    
    // Получаем значение частот для этого диапазона
    let sum = 0;
    let count = 0;
    
    // Весовая функция с УСИЛЕНИЕМ высоких частот
    for (let j = startFreq; j < endFreq; j++) {
      let weight = 1.0;
      const positionInBar = (j - startFreq) / (endFreq - startFreq);
      
      // Сильно обрезаем самые низкие внутри диапазона
      if (positionInBar < 0.2) {
        weight = 0.2;
      }
      // СИЛЬНО УСИЛИВАЕМ высокие внутри диапазона  
      else if (positionInBar > 0.6) {
        weight = 1.5 + (positionInBar - 0.6) * 2.0; // Усиление до 2.3x
      }
      // Средние частоты диапазона - нормальный вес
      else {
        weight = 0.8 + (positionInBar - 0.2) * 1.75; // Плавный рост
      }
      
      sum += dataArray[j] * weight;
      count += weight;
    }
    
    let value = count > 0 ? (sum / count) * autoSensitivity : 0;
    
    // ДОПОЛНИТЕЛЬНОЕ УСИЛЕНИЕ для полос с высокими частотами
    if (i > 5) { // Последние 3 полосы - высокие частоты
      value *= 5.3;
    } else if (i == 8) { // Последняя полоса
      value *= 20.2;
    } else if (i >= 3) { // Средние полосы
      value *= 1.2;
    }
    // Низкие полосы оставляем как есть

    const barHeight = Math.max(30, value * canvas.height * 0.004);
    
    // Цветовая схема с акцентом на холодные тона для высоких частот
    let hue, saturation;
    
    if (i < 3) {
      // Низкие частоты - теплые тона
      hue = 0 + i * 20;
      saturation = 70;
    } else if (i < 6) {
      // Средние частоты - зеленые/голубые
      hue = 120 + (i - 3) * 25;
      saturation = 85;
    } else {
      // Высокие частоты - фиолетовые/синие с максимальной насыщенностью
      hue = 260 + (i - 6) * 15;
      saturation = 100;
    }

    const x = centerX - totalWidth / 2 + i * (barWidth + spacing);

    // Верхняя часть (расходится вверх из центра)
    const gradientTop = ctx.createLinearGradient(x, centerY, x, centerY - barHeight);
    gradientTop.addColorStop(0, `hsla(${hue}, ${saturation}%, 70%, 0.9)`);
    gradientTop.addColorStop(0.5, `hsla(${hue}, ${saturation}%, 65%, 0.6)`);
    gradientTop.addColorStop(1, `hsla(${hue}, ${saturation}%, 60%, 0.3)`);

    ctx.fillStyle = gradientTop;
    ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);

    // Нижняя часть (расходится вниз из центра)
    const gradientBottom = ctx.createLinearGradient(x, centerY, x, centerY + barHeight);
    gradientBottom.addColorStop(0, `hsla(${hue}, ${saturation}%, 70%, 0.9)`);
    gradientBottom.addColorStop(0.5, `hsla(${hue}, ${saturation}%, 65%, 0.6)`);
    gradientBottom.addColorStop(1, `hsla(${hue}, ${saturation}%, 60%, 0.3)`);

    ctx.fillStyle = gradientBottom;
    ctx.fillRect(x, centerY, barWidth, barHeight);

    // ИНТЕНСИВНОЕ свечение для высоких частот
    ctx.shadowColor = `hsl(${hue}, ${saturation}%, 70%)`;
    if (i >= 5) {
      ctx.shadowBlur = 30 + value * 0.3; // Максимальное свечение для высоких
    } else if (i >= 3) {
      ctx.shadowBlur = 20 + value * 0.2; // Умеренное свечение для средних
    } else {
      ctx.shadowBlur = 10 + value * 0.1; // Минимальное свечение для низких
    }
    
    ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
    ctx.shadowBlur = 0;
  }
}

// === Эффект Пульс с УМЕНЬШЕННЫМ сердцем и красной окантовкой ===
function drawHeart(bass, mid, high, overall, brightness) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2 + canvas.height * 0.08;

  // УМЕНЬШЕННЫЙ размер сердца
  const baseSize = Math.min(canvas.width, canvas.height) * 0.08;
  const pulseIntensity = 1 + (overall * autoSensitivity * 0.03);
  const heartSize = baseSize * pulseIntensity;

  // Всегда красный цвет с вариациями насыщенности
  let saturation, lightness;
  const volumeRatio = Math.min(1, overall / 150);

  if (overall > 120) {
    saturation = 100;
    lightness = 65 + (bass * 0.15);
  } else if (overall > 60) {
    saturation = 90 + (volumeRatio * 10);
    lightness = 60 + (mid * 0.12);
  } else {
    saturation = 80 + (volumeRatio * 10);
    lightness = 50 + (overall * 0.2);
  }

  // Дополнительное увеличение на битах
  let beatBonus = 1;
  if (rhythmMode === 'rhythmic' && beatIntensity > 0.3) {
    beatBonus = 1 + (beatIntensity * 0.15);
  }

  const finalHeartSize = heartSize * beatBonus;

  ctx.save();
  ctx.translate(centerX, centerY);

  // УМЕНЬШЕН размер шрифта
  const fontSize = finalHeartSize * 2.5;
  ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Основной цвет сердца
  const mainColor = `hsl(0, ${saturation}%, ${lightness}%)`;
  ctx.fillStyle = mainColor;
  ctx.shadowBlur = 0;

  // Рисуем основное сердце
  ctx.fillText('❤️', 0, 0);

  // КРАСНАЯ ОКАНТОВКА - используем тот же цвет что и у сердца
  if (rhythmMode === 'rhythmic' && beatIntensity > 0.4) {
    const pulseSize = fontSize * (1 + beatIntensity * 0.15);
    ctx.font = `bold ${pulseSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

    // Окантовка красным цветом (таким же как у сердца)
    ctx.shadowBlur = 8 + (beatIntensity * 12);
    ctx.shadowColor = mainColor; // Используем основной цвет сердца

    // Рисуем сердце с окантовкой
    ctx.fillText('❤️', 0, 0);
  }

  // Дрожание на высоких частотах
  if (high > 60) {
    const shakeIntensity = high * 0.002;
    const shakeX = (Math.random() - 0.5) * shakeIntensity;
    const shakeY = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(shakeX, shakeY);
    ctx.fillText('❤️', 0, 0);
  }

  ctx.restore();
}

// Адаптация к изменению размера окна
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});