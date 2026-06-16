(() => {
  'use strict';

  const state = {
    files: [],
    currentIndex: -1,
    currentImage: null,
    originalBitmap: null,
    outputSize: { width: 0, height: 0, scale: 1 },
    autoRegions: [],
    manualRegions: [],
    activePreset: 'balanced',
    drawing: null,
    lastResultUrls: [],
  };

  const $ = (id) => document.getElementById(id);
  const ui = {
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    fileList: $('fileList'),
    supportList: $('supportList'),
    previewCanvas: $('previewCanvas'),
    analyzeBtn: $('analyzeBtn'),
    compressBtn: $('compressBtn'),
    clearRegionsBtn: $('clearRegionsBtn'),
    statusText: $('statusText'),
    resultList: $('resultList'),
    fileTemplate: $('fileItemTemplate'),
    resultTemplate: $('resultTemplate'),
    qualityRange: $('qualityRange'),
    backgroundRange: $('backgroundRange'),
    protectRange: $('protectRange'),
    qualityValue: $('qualityValue'),
    backgroundValue: $('backgroundValue'),
    protectValue: $('protectValue'),
    formatSelect: $('formatSelect'),
    maxEdge: $('maxEdge'),
    autoFace: $('autoFace'),
    autoSaliency: $('autoSaliency'),
    stripMeta: $('stripMeta'),
  };

  const ctx = ui.previewCanvas.getContext('2d', { alpha: false });

  const presets = {
    balanced: { quality: 82, background: 62, protect: 32, maxEdge: 2400, format: 'image/webp' },
    face: { quality: 86, background: 72, protect: 52, maxEdge: 2400, format: 'image/webp' },
    max: { quality: 68, background: 92, protect: 26, maxEdge: 1600, format: 'image/webp' },
    manual: { quality: 82, background: 76, protect: 42, maxEdge: 2048, format: 'image/webp' },
  };

  boot();

  function boot() {
    renderSupport();
    bindEvents();
    syncSliderLabels();
    drawEmptyPreview();
  }

  function bindEvents() {
    ui.fileInput.addEventListener('change', (event) => addFiles([...event.target.files]));

    ['dragenter', 'dragover'].forEach((name) => {
      ui.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        ui.dropZone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      ui.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        ui.dropZone.classList.remove('is-over');
      });
    });
    ui.dropZone.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files]));

    document.querySelectorAll('.preset').forEach((button) => {
      button.addEventListener('click', () => applyPreset(button.dataset.preset));
    });

    [ui.qualityRange, ui.backgroundRange, ui.protectRange].forEach((input) => {
      input.addEventListener('input', () => {
        syncSliderLabels();
        schedulePreviewRender();
      });
    });

    [ui.formatSelect, ui.maxEdge, ui.autoFace, ui.autoSaliency].forEach((input) => {
      input.addEventListener('change', () => {
        if (input === ui.maxEdge && state.currentImage) loadCurrentImage(true);
        else schedulePreviewRender();
      });
    });

    ui.analyzeBtn.addEventListener('click', () => analyzeCurrentImage());
    ui.compressBtn.addEventListener('click', () => compressAllFiles());
    ui.clearRegionsBtn.addEventListener('click', () => {
      state.manualRegions = [];
      drawPreview();
      setStatus('手動保護範囲を削除しました。');
    });

    ui.previewCanvas.addEventListener('pointerdown', onPointerDown);
    ui.previewCanvas.addEventListener('pointermove', onPointerMove);
    ui.previewCanvas.addEventListener('pointerup', onPointerUp);
    ui.previewCanvas.addEventListener('pointercancel', onPointerUp);
  }

  function renderSupport() {
    const supports = [
      ['Canvas圧縮', !!HTMLCanvasElement.prototype.toBlob],
      ['WebP出力', true],
      ['JS顔検出 FaceDetector', 'FaceDetector' in window],
      ['Web Worker', 'Worker' in window],
      ['ブラウザ内処理', true],
    ];
    ui.supportList.innerHTML = supports.map(([label, ok]) => (
      `<div class="support-pill"><span>${escapeHtml(label)}</span><b class="${ok ? 'ok' : 'ng'}">${ok ? '対応' : '非対応'}</b></div>`
    )).join('');
  }

  function applyPreset(name) {
    const preset = presets[name];
    if (!preset) return;
    state.activePreset = name;
    document.querySelectorAll('.preset').forEach((button) => {
      button.classList.toggle('active', button.dataset.preset === name);
    });
    ui.qualityRange.value = preset.quality;
    ui.backgroundRange.value = preset.background;
    ui.protectRange.value = preset.protect;
    ui.maxEdge.value = String(preset.maxEdge);
    ui.formatSelect.value = preset.format;
    syncSliderLabels();
    if (state.currentImage) loadCurrentImage(true);
  }

  function syncSliderLabels() {
    ui.qualityValue.value = ui.qualityRange.value;
    ui.backgroundValue.value = ui.backgroundRange.value;
    ui.protectValue.value = ui.protectRange.value;
  }

  function addFiles(files) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      setStatus('画像ファイルを選択してください。');
      return;
    }
    state.files.push(...imageFiles.map((file) => ({ file, id: cryptoRandomId() })));
    renderFileList();
    if (state.currentIndex === -1) selectFile(0);
    setStatus(`${imageFiles.length}件の画像を追加しました。`);
  }

  function renderFileList() {
    ui.fileList.innerHTML = '';
    state.files.forEach((item, index) => {
      const node = ui.fileTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('.file-name').textContent = item.file.name;
      node.querySelector('.file-meta').textContent = `${formatBytes(item.file.size)} / ${item.file.type || 'unknown'}`;
      node.classList.toggle('active', index === state.currentIndex);
      node.addEventListener('click', () => selectFile(index));
      ui.fileList.appendChild(node);
    });
  }

  async function selectFile(index) {
    state.currentIndex = index;
    state.autoRegions = [];
    state.manualRegions = [];
    renderFileList();
    await loadCurrentImage(false);
    await analyzeCurrentImage();
  }

  async function loadCurrentImage(keepRegions) {
    const current = state.files[state.currentIndex];
    if (!current) return;
    if (!keepRegions) {
      state.autoRegions = [];
      state.manualRegions = [];
    }
    revokeBitmap();
    setStatus('画像を読み込み中です…');
    const bitmap = await createBitmapFromFile(current.file);
    state.originalBitmap = bitmap;
    const maxEdge = Number(ui.maxEdge.value || 0);
    const out = computeOutputSize(bitmap.width, bitmap.height, maxEdge);
    state.outputSize = out;
    state.currentImage = current;
    drawPreview();
    setStatus('画像を読み込みました。必要ならキャンバス上で保護範囲を囲んでください。');
  }

  async function createBitmapFromFile(file) {
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (error) {
        console.warn('createImageBitmap failed, fallback to Image:', error);
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function analyzeCurrentImage() {
    if (!state.originalBitmap) {
      setStatus('先に画像を追加してください。');
      return;
    }
    setStatus('自動解析中です…');
    state.autoRegions = [];

    if (ui.autoFace.checked) {
      const faceRegions = await detectFaces(state.originalBitmap);
      state.autoRegions.push(...faceRegions.map((region) => ({ ...region, source: 'face', strength: 1 })));
    }

    if (ui.autoSaliency.checked) {
      const saliencyRegions = detectSimpleSaliency(state.originalBitmap);
      state.autoRegions.push(...saliencyRegions.map((region) => ({ ...region, source: 'saliency', strength: 0.42 })));
    }

    drawPreview();
    const faces = state.autoRegions.filter((region) => region.source === 'face').length;
    const saliency = state.autoRegions.filter((region) => region.source === 'saliency').length;
    const faceNote = 'FaceDetector' in window ? `顔候補 ${faces}件` : 'FaceDetector非対応のため顔検出はスキップ';
    setStatus(`${faceNote}、注目領域 ${saliency}件を保護候補にしました。`);
  }

  async function detectFaces(bitmap) {
    if (!('FaceDetector' in window)) return [];
    try {
      const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 20 });
      const detected = await detector.detect(bitmap);
      const protect = Number(ui.protectRange.value);
      const expand = 0.35 + protect / 140;
      return detected.map((face) => {
        const box = face.boundingBox;
        return expandRect({ x: box.x, y: box.y, w: box.width, h: box.height }, expand, bitmap.width, bitmap.height);
      });
    } catch (error) {
      console.warn('FaceDetector failed:', error);
      return [];
    }
  }

  function detectSimpleSaliency(bitmap) {
    const analysisMax = 420;
    const scale = Math.min(1, analysisMax / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(w, h);
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(bitmap, 0, 0, w, h);
    const data = c.getImageData(0, 0, w, h).data;
    const grid = 12;
    const cells = [];
    const cellW = Math.floor(w / grid);
    const cellH = Math.floor(h / grid);

    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        let contrast = 0;
        let saturation = 0;
        let skinScore = 0;
        let count = 0;
        const sx = gx * cellW;
        const sy = gy * cellH;
        const ex = gx === grid - 1 ? w : sx + cellW;
        const ey = gy === grid - 1 ? h : sy + cellH;
        for (let y = sy + 1; y < ey - 1; y += 3) {
          for (let x = sx + 1; x < ex - 1; x += 3) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const j = (y * w + Math.min(w - 1, x + 1)) * 4;
            const k = (Math.min(h - 1, y + 1) * w + x) * 4;
            const lumX = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
            const lumY = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
            contrast += Math.abs(lum - lumX) + Math.abs(lum - lumY);
            saturation += (Math.max(r, g, b) - Math.min(r, g, b));
            if (r > 80 && g > 45 && b > 25 && r > g && g > b && Math.abs(r - g) > 12) skinScore += 1;
            count++;
          }
        }
        const cx = (gx + .5) / grid;
        const cy = (gy + .5) / grid;
        const centerBias = 1 - Math.min(1, Math.hypot(cx - .5, cy - .5) * 1.6);
        const score = (contrast / Math.max(1, count)) * 0.55 + (saturation / Math.max(1, count)) * 0.18 + skinScore * 7 + centerBias * 34;
        cells.push({ gx, gy, score });
      }
    }

    cells.sort((a, b) => b.score - a.score);
    const picked = [];
    const limit = Math.min(8, Math.max(3, Math.round(cells.length * 0.04)));
    for (const cell of cells) {
      if (picked.length >= limit) break;
      if (cell.score < cells[0].score * 0.58) break;
      const rect = {
        x: Math.max(0, (cell.gx - 0.45) * cellW / scale),
        y: Math.max(0, (cell.gy - 0.45) * cellH / scale),
        w: Math.min(bitmap.width, cellW * 1.9 / scale),
        h: Math.min(bitmap.height, cellH * 1.9 / scale),
      };
      picked.push(rect);
    }
    return mergeNearRects(picked, bitmap.width, bitmap.height).slice(0, 6);
  }

  async function compressAllFiles() {
    if (!state.files.length) {
      setStatus('圧縮する画像を追加してください。');
      return;
    }
    ui.compressBtn.disabled = true;
    ui.analyzeBtn.disabled = true;
    clearOldResultUrls();
    ui.resultList.innerHTML = '';

    try {
      for (let i = 0; i < state.files.length; i++) {
        if (i !== state.currentIndex) await selectFile(i);
        setStatus(`${i + 1}/${state.files.length} を圧縮中です…`);
        const result = await compressCurrentImage();
        renderResult(result);
      }
      setStatus('圧縮が完了しました。');
    } catch (error) {
      console.error(error);
      setStatus(`エラー: ${error.message || error}`);
    } finally {
      ui.compressBtn.disabled = false;
      ui.analyzeBtn.disabled = false;
    }
  }

  async function compressCurrentImage() {
    if (!state.originalBitmap || !state.currentImage) throw new Error('画像が読み込まれていません。');
    const { canvas } = renderProcessedCanvas(state.originalBitmap);
    const type = ui.formatSelect.value;
    const quality = Number(ui.qualityRange.value) / 100;
    const blob = await canvasToBlob(canvas, type, quality);
    const original = state.currentImage.file;
    const ext = mimeToExt(blob.type || type);
    const base = original.name.replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    state.lastResultUrls.push(url);
    return {
      name: `${base}_mamecompress.${ext}`,
      url,
      blob,
      originalSize: original.size,
      outputSize: blob.size,
      type: blob.type || type,
    };
  }

  function renderProcessedCanvas(bitmap) {
    const { width, height } = state.outputSize;
    const original = createCanvas(width, height);
    const originalCtx = original.getContext('2d');
    originalCtx.drawImage(bitmap, 0, 0, width, height);

    const backgroundStrength = Number(ui.backgroundRange.value);
    const blurPx = Math.round(backgroundStrength / 18);
    const scaleDown = Math.max(0.18, 1 - backgroundStrength / 125);
    const smallW = Math.max(1, Math.round(width * scaleDown));
    const smallH = Math.max(1, Math.round(height * scaleDown));

    const small = createCanvas(smallW, smallH);
    small.getContext('2d').drawImage(original, 0, 0, smallW, smallH);

    const background = createCanvas(width, height);
    const bg = background.getContext('2d');
    bg.imageSmoothingEnabled = true;
    bg.imageSmoothingQuality = 'high';
    bg.filter = `blur(${blurPx}px) saturate(${Math.max(0.78, 1 - backgroundStrength / 360)})`;
    bg.drawImage(small, 0, 0, width, height);
    bg.filter = 'none';
    if (backgroundStrength > 75) {
      bg.globalAlpha = Math.min(.18, (backgroundStrength - 75) / 130);
      bg.fillStyle = '#f5f0eb';
      bg.fillRect(0, 0, width, height);
      bg.globalAlpha = 1;
    }

    const mask = buildMaskCanvas(width, height);
    const protectedLayer = createCanvas(width, height);
    const prot = protectedLayer.getContext('2d');
    prot.drawImage(original, 0, 0);
    prot.globalCompositeOperation = 'destination-in';
    prot.drawImage(mask, 0, 0);

    const out = createCanvas(width, height);
    const outCtx = out.getContext('2d');
    outCtx.drawImage(background, 0, 0);
    outCtx.drawImage(protectedLayer, 0, 0);
    return { canvas: out, mask };
  }

  function buildMaskCanvas(width, height) {
    const mask = createCanvas(width, height);
    const m = mask.getContext('2d');
    m.clearRect(0, 0, width, height);
    const scale = state.outputSize.scale;
    const protect = Number(ui.protectRange.value);
    const feather = Math.max(24, Math.round((protect + 28) * scale));

    const drawSoftRect = (rect, colorStrength = 1) => {
      const x = rect.x * scale;
      const y = rect.y * scale;
      const w = rect.w * scale;
      const h = rect.h * scale;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2 + feather;
      const ry = h / 2 + feather;
      const radius = Math.max(rx, ry);
      const grad = m.createRadialGradient(cx, cy, Math.max(4, Math.min(rx, ry) * .45), cx, cy, radius);
      grad.addColorStop(0, `rgba(255,255,255,${0.98 * colorStrength})`);
      grad.addColorStop(.62, `rgba(255,255,255,${0.78 * colorStrength})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      m.fillStyle = grad;
      m.beginPath();
      m.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      m.fill();
    };

    state.autoRegions.forEach((rect) => drawSoftRect(rect, rect.strength ?? .65));
    state.manualRegions.forEach((rect) => drawSoftRect(rect, 1));
    return mask;
  }

  let previewTimer = null;
  function schedulePreviewRender() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (state.currentImage) drawPreview();
    }, 80);
  }

  function drawPreview() {
    if (!state.originalBitmap) {
      drawEmptyPreview();
      return;
    }
    const canvas = ui.previewCanvas;
    const rect = containRect(state.originalBitmap.width, state.originalBitmap.height, canvas.width, canvas.height);
    ctx.fillStyle = '#201a18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.originalBitmap, rect.x, rect.y, rect.w, rect.h);
    drawOverlayRegions(rect);
    if (state.drawing) drawRegionRect(state.drawing, rect, 'manual');
  }

  function drawOverlayRegions(viewRect) {
    state.autoRegions.forEach((r) => drawRegionRect(r, viewRect, r.source === 'face' ? 'face' : 'auto'));
    state.manualRegions.forEach((r) => drawRegionRect(r, viewRect, 'manual'));
  }

  function drawRegionRect(region, view, kind) {
    const sx = view.w / state.originalBitmap.width;
    const sy = view.h / state.originalBitmap.height;
    const x = view.x + region.x * sx;
    const y = view.y + region.y * sy;
    const w = region.w * sx;
    const h = region.h * sy;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = kind === 'manual' ? 'rgba(155,107,255,.96)' : kind === 'face' ? 'rgba(45,154,115,.96)' : 'rgba(45,154,115,.62)';
    ctx.fillStyle = kind === 'manual' ? 'rgba(155,107,255,.18)' : 'rgba(45,154,115,.14)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawEmptyPreview() {
    ctx.fillStyle = '#201a18';
    ctx.fillRect(0, 0, ui.previewCanvas.width, ui.previewCanvas.height);
    ctx.fillStyle = 'rgba(255,255,255,.76)';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('画像を追加するとプレビューを表示します', ui.previewCanvas.width / 2, ui.previewCanvas.height / 2);
  }

  function onPointerDown(event) {
    if (!state.originalBitmap) return;
    ui.previewCanvas.setPointerCapture(event.pointerId);
    const p = pointerToImage(event);
    if (!p) return;
    state.drawing = { x: p.x, y: p.y, w: 1, h: 1, startX: p.x, startY: p.y };
  }

  function onPointerMove(event) {
    if (!state.drawing || !state.originalBitmap) return;
    const p = pointerToImage(event);
    if (!p) return;
    const x1 = Math.min(state.drawing.startX, p.x);
    const y1 = Math.min(state.drawing.startY, p.y);
    const x2 = Math.max(state.drawing.startX, p.x);
    const y2 = Math.max(state.drawing.startY, p.y);
    state.drawing.x = x1;
    state.drawing.y = y1;
    state.drawing.w = x2 - x1;
    state.drawing.h = y2 - y1;
    drawPreview();
  }

  function onPointerUp(event) {
    if (!state.drawing) return;
    const r = normalizeRect(state.drawing, state.originalBitmap.width, state.originalBitmap.height);
    delete r.startX;
    delete r.startY;
    if (r.w > 12 && r.h > 12) {
      state.manualRegions.push(r);
      setStatus('手動保護範囲を追加しました。');
    }
    state.drawing = null;
    drawPreview();
  }

  function pointerToImage(event) {
    const canvasRect = ui.previewCanvas.getBoundingClientRect();
    const canvasX = (event.clientX - canvasRect.left) * ui.previewCanvas.width / canvasRect.width;
    const canvasY = (event.clientY - canvasRect.top) * ui.previewCanvas.height / canvasRect.height;
    const view = containRect(state.originalBitmap.width, state.originalBitmap.height, ui.previewCanvas.width, ui.previewCanvas.height);
    if (canvasX < view.x || canvasY < view.y || canvasX > view.x + view.w || canvasY > view.y + view.h) return null;
    return {
      x: clamp((canvasX - view.x) / view.w * state.originalBitmap.width, 0, state.originalBitmap.width),
      y: clamp((canvasY - view.y) / view.h * state.originalBitmap.height, 0, state.originalBitmap.height),
    };
  }

  function renderResult(result) {
    const node = ui.resultTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('h3').textContent = result.name;
    const delta = result.originalSize ? (1 - result.outputSize / result.originalSize) * 100 : 0;
    node.querySelector('.result-meta').textContent = `${formatBytes(result.originalSize)} → ${formatBytes(result.outputSize)} / ${delta >= 0 ? '-' : '+'}${Math.abs(delta).toFixed(1)}% / ${result.type}`;
    const link = node.querySelector('.download-link');
    link.href = result.url;
    link.download = result.name;
    ui.resultList.prepend(node);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('画像の書き出しに失敗しました。'));
        else resolve(blob);
      }, type, quality);
    });
  }

  function computeOutputSize(w, h, maxEdge) {
    if (!maxEdge || Math.max(w, h) <= maxEdge) return { width: w, height: h, scale: 1 };
    const scale = maxEdge / Math.max(w, h);
    return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
  }

  function containRect(srcW, srcH, dstW, dstH) {
    const scale = Math.min(dstW / srcW, dstH / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
  }

  function createCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas;
  }

  function expandRect(rect, amount, maxW, maxH) {
    const padX = rect.w * amount;
    const padY = rect.h * amount;
    return normalizeRect({ x: rect.x - padX, y: rect.y - padY, w: rect.w + padX * 2, h: rect.h + padY * 2 }, maxW, maxH);
  }

  function normalizeRect(rect, maxW, maxH) {
    const x = clamp(rect.x, 0, maxW);
    const y = clamp(rect.y, 0, maxH);
    const w = clamp(rect.w, 0, maxW - x);
    const h = clamp(rect.h, 0, maxH - y);
    return { x, y, w, h };
  }

  function mergeNearRects(rects, maxW, maxH) {
    const out = [];
    for (const rect of rects) {
      let merged = false;
      for (const target of out) {
        if (rectsOverlapOrNear(rect, target, 0.08 * Math.max(maxW, maxH))) {
          const x1 = Math.min(target.x, rect.x);
          const y1 = Math.min(target.y, rect.y);
          const x2 = Math.max(target.x + target.w, rect.x + rect.w);
          const y2 = Math.max(target.y + target.h, rect.y + rect.h);
          Object.assign(target, normalizeRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, maxW, maxH));
          merged = true;
          break;
        }
      }
      if (!merged) out.push(normalizeRect(rect, maxW, maxH));
    }
    return out;
  }

  function rectsOverlapOrNear(a, b, margin) {
    return !(a.x + a.w + margin < b.x || b.x + b.w + margin < a.x || a.y + a.h + margin < b.y || b.y + b.h + margin < a.y);
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function setStatus(text) { ui.statusText.textContent = text; }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
    return `${size.toFixed(index === 0 ? 0 : 1)}${units[index]}`;
  }

  function mimeToExt(mime) {
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    return 'img';
  }

  function cryptoRandomId() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clearOldResultUrls() {
    state.lastResultUrls.forEach((url) => URL.revokeObjectURL(url));
    state.lastResultUrls = [];
  }

  function revokeBitmap() {
    if (state.originalBitmap && 'close' in state.originalBitmap) {
      try { state.originalBitmap.close(); } catch (_) {}
    }
    state.originalBitmap = null;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function escapeHtml(text) {
    return String(text).replace(/[&<>'"]/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s]));
  }
})();
