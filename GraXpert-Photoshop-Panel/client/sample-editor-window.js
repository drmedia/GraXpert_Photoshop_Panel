(function() {
  "use strict";

  var EDITOR_MODE = document.body.getAttribute("data-editor-mode") === "neutralize"
    ? "neutralize" : "background";
  var IS_NEUTRAL = EDITOR_MODE === "neutralize";
  var STATE_EVENT = IS_NEUTRAL
    ? "com.drmedia.graxpertps.neutraleditor.state"
    : "com.drmedia.graxpertps.gradienteditor.state";
  var COMMAND_EVENT = IS_NEUTRAL
    ? "com.drmedia.graxpertps.neutraleditor.command"
    : "com.drmedia.graxpertps.gradienteditor.command";
  var MAIN_EXTENSION_ID = "com.drmedia.graxpertps.panel";
  var STATE_FILE = IS_NEUTRAL ? "neutral_editor_state.json" : "gradient_editor_state.json";
  var COMMAND_FILE = IS_NEUTRAL ? "neutral_editor_command.json" : "gradient_editor_command.json";
  var READY_FILE = IS_NEUTRAL ? "neutral_editor_ready.json" : "gradient_editor_ready.json";
  var canvas = document.getElementById("sampleCanvas");
  var canvasWrap = document.getElementById("canvasWrap");
  var emptyMessage = document.getElementById("emptyMessage");
  var pointsPerRowInput = document.getElementById("pointsPerRow");
  var gridToleranceInput = document.getElementById("gridTolerance");
  var qualityPresetSelect = document.getElementById("qualityPreset");
  var state = null;
  var loadedPreviewFile = "";
  var sourcePixels = null;
  var displayCanvas = null;
  var displayKey = "";
  var updatingControls = false;
  var exchangeFs = null, exchangeOs = null, exchangePath = null;
  var lastStateText = "";
  try {
    exchangeFs = require("fs");
    exchangeOs = require("os");
    exchangePath = require("path");
  } catch (_) {}

  function directBridge() {
    try {
      return window.opener && !window.opener.closed ? window.opener.GX_SAMPLE_EDITOR_BRIDGE : null;
    } catch (_) { return null; }
  }

  function exchangeFile(name) {
    if (!exchangeFs || !exchangeOs || !exchangePath) return "";
    var directory = exchangePath.join(exchangeOs.tmpdir(), "GraXpert_Photoshop");
    try {
      if (!exchangeFs.existsSync(directory)) exchangeFs.mkdirSync(directory, { recursive:true });
      return exchangePath.join(directory, name);
    } catch (_) { return ""; }
  }

  function writeReadyFile() {
    var readyFile = exchangeFile(READY_FILE);
    if (!readyFile) return;
    try { exchangeFs.writeFileSync(readyFile, JSON.stringify({ updatedAt:Date.now() }), "utf8"); } catch (_) {}
  }

  function sendEvent(data) {
    data.id = data.id || (Date.now() + "_" + Math.random().toString(16).slice(2));
    var serialized = JSON.stringify(data);
    var commandFile = exchangeFile(COMMAND_FILE);
    if (commandFile) {
      try { exchangeFs.writeFileSync(commandFile, serialized, "utf8"); } catch (_) {}
    }
    if (window.__adobe_cep__ && window.__adobe_cep__.dispatchEvent) {
      window.__adobe_cep__.dispatchEvent({
        type: COMMAND_EVENT, scope: "APPLICATION", appId: "PHXS",
        extensionId: MAIN_EXTENSION_ID, data: serialized
      });
    }
  }

  function pollStateFile() {
    var stateFile = exchangeFile(STATE_FILE);
    if (!stateFile || !exchangeFs.existsSync(stateFile)) return;
    try {
      var serialized = exchangeFs.readFileSync(stateFile, "utf8");
      if (!serialized || serialized === lastStateText) return;
      var current = JSON.parse(serialized);
      lastStateText = serialized;
      applyState(current);
    } catch (_) {}
  }

  function dispatchCommand(action, value) {
    var api = directBridge();
    if (api) {
      if (action === "undo" || action === "clear" || action === "auto") api[action]();
      else if (action === "setStretch") api.setStretch(value);
      else if (action === "setSaturation") api.setSaturation(value);
      else if (action === "setSampleSize") api.setSampleSize(value);
      else if (action === "setPointsPerRow") api.setPointsPerRow(value);
      else if (action === "setGridTolerance") api.setGridTolerance(value);
      else if (action === "setQualityPreset") api.setQualityPreset(value);
      else if (action === "setSelectionOnly") api.setSelectionOnly(value);
      return;
    }
    var command = { action: action };
    if (value !== undefined) command.value = value;
    sendEvent(command);
  }

  function fileUrl(filePath) {
    var normalized = String(filePath || "").replace(/\\/g, "/");
    return ("file:///" + encodeURI(normalized)).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  function getStretchPreset(name) {
    if (name === "10% Bg, 3 sigma") return { bg:0.10, sigma:3, enabled:true };
    if (name === "15% Bg, 3 sigma") return { bg:0.15, sigma:3, enabled:true };
    if (name === "20% Bg, 3 sigma") return { bg:0.20, sigma:3, enabled:true };
    if (name === "30% Bg, 2 sigma") return { bg:0.30, sigma:2, enabled:true };
    return { bg:0, sigma:0, enabled:false };
  }

  function histogramMedian(histogram, total) {
    if (!total) return 0;
    var target = (total + 1) / 2;
    var sum = 0;
    for (var i=0; i<histogram.length; i++) {
      sum += histogram[i] || 0;
      if (sum >= target) return i;
    }
    return histogram.length - 1;
  }

  function mtfValue(value, midtone) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    var denominator = (2 * midtone - 1) * value - midtone;
    if (Math.abs(denominator) < 1e-12) return value;
    return (midtone - 1) * value / denominator;
  }

  function stretchParameters(histogram, preset) {
    var valid = 0;
    for (var i=1; i<histogram.length - 1; i++) valid += histogram[i] || 0;
    if (!valid) return { shadow:0, midtone:0.5 };
    var filtered = histogram.slice(0);
    filtered[0] = 0;
    filtered[filtered.length - 1] = 0;
    var medianBin = histogramMedian(filtered, valid);
    var deviation = [];
    for (var d=0; d<histogram.length; d++) deviation[d] = 0;
    for (var bin=1; bin<histogram.length - 1; bin++) {
      deviation[Math.abs(bin - medianBin)] += histogram[bin] || 0;
    }
    var maxBin = histogram.length - 1;
    var median = medianBin / maxBin;
    var mad = histogramMedian(deviation, valid) / maxBin;
    var shadow = Math.max(0, Math.min(1, median - preset.sigma * mad));
    var normalizedMedian = (median - shadow) / Math.max(1e-12, 1 - shadow);
    return { shadow:shadow, midtone:mtfValue(normalizedMedian, preset.bg) };
  }

  function stretchChannel8(value, parameter) {
    var normalized = value / 255;
    var stretched = normalized <= parameter.shadow ? 0 :
      mtfValue((normalized - parameter.shadow) / (1 - parameter.shadow), parameter.midtone);
    return Math.max(0, Math.min(255, Math.round(stretched * 255)));
  }

  function buildDisplayCanvas() {
    if (!sourcePixels || !state) return null;
    var saturation = Math.max(0, Math.min(3, Number(state.saturation)));
    if (!isFinite(saturation)) saturation = 1;
    var key = loadedPreviewFile + "|" + state.stretch + "|" + saturation.toFixed(1);
    if (displayCanvas && displayKey === key) return displayCanvas;
    var preset = getStretchPreset(state.stretch);
    var histograms = [[], [], []];
    var c, h;
    for (c=0; c<3; c++) for (h=0; h<256; h++) histograms[c][h] = 0;
    var pixelCount = sourcePixels.width * sourcePixels.height;
    var stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 120000)));
    var x, y, at, channel;
    if (preset.enabled) {
      for (y=0; y<sourcePixels.height; y += stride) {
        for (x=0; x<sourcePixels.width; x += stride) {
          at = (y * sourcePixels.width + x) * 4;
          for (channel=0; channel<3; channel++) histograms[channel][sourcePixels.data[at + channel]]++;
        }
      }
    }
    var parameters = preset.enabled ? [
      stretchParameters(histograms[0], preset), stretchParameters(histograms[1], preset),
      stretchParameters(histograms[2], preset)
    ] : null;
    var output = new Uint8ClampedArray(sourcePixels.data.length);
    for (at=0; at<sourcePixels.data.length; at += 4) {
      var red = sourcePixels.data[at];
      var green = sourcePixels.data[at + 1];
      var blue = sourcePixels.data[at + 2];
      if (preset.enabled) {
        red = stretchChannel8(red, parameters[0]);
        green = stretchChannel8(green, parameters[1]);
        blue = stretchChannel8(blue, parameters[2]);
      }
      var gray = 0.299 * red + 0.587 * green + 0.114 * blue;
      output[at] = Math.max(0, Math.min(255, Math.round(gray + saturation * (red - gray))));
      output[at + 1] = Math.max(0, Math.min(255, Math.round(gray + saturation * (green - gray))));
      output[at + 2] = Math.max(0, Math.min(255, Math.round(gray + saturation * (blue - gray))));
      output[at + 3] = sourcePixels.data[at + 3];
    }
    displayCanvas = document.createElement("canvas");
    displayCanvas.width = sourcePixels.width;
    displayCanvas.height = sourcePixels.height;
    var context = displayCanvas.getContext("2d");
    var imageData = context.createImageData(sourcePixels.width, sourcePixels.height);
    imageData.data.set(output);
    context.putImageData(imageData, 0, 0);
    displayKey = key;
    return displayCanvas;
  }

  function calculateDisplaySize(imageWidth, imageHeight) {
    var width = Math.min(imageWidth, Math.max(1, canvasWrap.clientWidth - 4));
    var height = Math.round(width * imageHeight / imageWidth);
    var availableHeight = Math.max(1, canvasWrap.clientHeight - 4);
    if (height > availableHeight) {
      height = Math.min(imageHeight, availableHeight);
      width = Math.round(height * imageWidth / imageHeight);
    }
    return { width:Math.max(1, width), height:Math.max(1, height) };
  }

  function pointOnCanvas(point) {
    return {
      x: point.x / Math.max(1, state.previewState.originalWidth - 1) * Math.max(1, canvas.width - 1),
      y: point.y / Math.max(1, state.previewState.originalHeight - 1) * Math.max(1, canvas.height - 1)
    };
  }

  function sampleBoundsOnCanvas(point) {
    var center = pointOnCanvas(point);
    var sampleSize = Math.max(2, Math.min(200, parseInt(state.sampleSize, 10) || 25));
    var scaleX = Math.max(1, canvas.width - 1) /
      Math.max(1, state.previewState.originalWidth - 1);
    var scaleY = Math.max(1, canvas.height - 1) /
      Math.max(1, state.previewState.originalHeight - 1);
    return {
      left: center.x - sampleSize * scaleX,
      top: center.y - sampleSize * scaleY,
      right: center.x + sampleSize * scaleX,
      bottom: center.y + sampleSize * scaleY
    };
  }

  function drawLocalEditor() {
    var display = buildDisplayCanvas();
    if (!display || !state || !state.previewState) return;
    var size = calculateDisplaySize(display.width, display.height);
    canvas.width = size.width; canvas.height = size.height;
    canvas.style.width = size.width + "px"; canvas.style.height = size.height + "px";
    var context = canvas.getContext("2d");
    context.drawImage(display, 0, 0, size.width, size.height);
    context.lineWidth = 2;
    for (var i=0; i<state.points.length; i++) {
      var bounds = sampleBoundsOnCanvas(state.points[i]);
      var status = state.points[i].quality ? state.points[i].quality.status : "good";
      context.strokeStyle = status === "exclude" ? "#eb4c4c" :
        status === "warning" ? "#f4a634" : "#34c76a";
      context.strokeRect(
        bounds.left,
        bounds.top,
        bounds.right - bounds.left,
        bounds.bottom - bounds.top
      );
    }
  }

  function loadPreviewIfNeeded() {
    if (!state || !state.ready || !state.previewFile) return;
    if (loadedPreviewFile === state.previewFile && sourcePixels) { drawLocalEditor(); return; }
    var expectedFile = state.previewFile;
    var image = new Image();
    image.onload = function() {
      if (!state || state.previewFile !== expectedFile) return;
      var sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = state.previewState.previewWidth;
      sourceCanvas.height = state.previewState.previewHeight;
      var context = sourceCanvas.getContext("2d");
      context.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
      sourcePixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      loadedPreviewFile = expectedFile; displayKey = ""; drawLocalEditor();
    };
    image.onerror = function() {
      emptyMessage.textContent = "Sample Preview 이미지를 불러올 수 없습니다."; emptyMessage.className = "";
    };
    image.src = fileUrl(expectedFile) + "?v=" + Date.now();
  }

  function syncControls(current) {
    updatingControls = true;
    document.getElementById("stretchPreset").value = current.stretch;
    document.getElementById("saturation").value = current.saturation;
    document.getElementById("saturationValue").textContent = Number(current.saturation).toFixed(1);
    document.getElementById("sampleSize").value = current.sampleSize;
    if (pointsPerRowInput) pointsPerRowInput.value = current.pointsPerRow || 15;
    if (gridToleranceInput) gridToleranceInput.value = Number(current.gridTolerance).toFixed(1);
    if (qualityPresetSelect) qualityPresetSelect.value = current.qualityPreset || "standard";
    document.getElementById("selectionOnly").checked = current.selectionOnly;
    updatingControls = false;
  }

  function applyState(current) {
    if (!current || current.editorMode !== EDITOR_MODE) return;
    state = current;
    document.getElementById("sampleCount").textContent = current.count;
    document.getElementById("selectionStatus").textContent = current.selection;
    document.getElementById("qualityReport").textContent = current.quality;
    syncControls(current);
    if (!current.ready) {
      emptyMessage.textContent = IS_NEUTRAL
        ? "메인 패널에서 배경 분석을 먼저 실행하세요."
        : "메인 패널에서 포인트 자동 생성을 먼저 실행하세요.";
      emptyMessage.className = ""; return;
    }
    emptyMessage.className = "hidden";
    var api = directBridge();
    if (api) api.draw(canvas, Math.max(1, canvasWrap.clientWidth - 4), Math.max(1, canvasWrap.clientHeight - 4));
    else loadPreviewIfNeeded();
  }

  function canvasPosition(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width - 1, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(canvas.height - 1, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height)))
    };
  }

  function originalPosition(pos) {
    return {
      x: Math.round(pos.x / Math.max(1, canvas.width - 1) * Math.max(1, state.previewState.originalWidth - 1)),
      y: Math.round(pos.y / Math.max(1, canvas.height - 1) * Math.max(1, state.previewState.originalHeight - 1))
    };
  }

  function nearestPoint(pos) {
    if (!state || !state.points) return null;
    var result = null, best = Infinity;
    for (var i=0; i<state.points.length; i++) {
      var shown = pointOnCanvas(state.points[i]);
      var dx = shown.x - pos.x, dy = shown.y - pos.y;
      var bounds = sampleBoundsOnCanvas(state.points[i]);
      var distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (pos.x >= bounds.left && pos.x <= bounds.right &&
          pos.y >= bounds.top && pos.y <= bounds.bottom && distance < best) {
        best = distance;
        result = { index:i, point:state.points[i], distance:distance };
      }
    }
    return result;
  }

  canvas.onclick = function(event) {
    if (!state || !state.ready) return;
    var pos = canvasPosition(event), api = directBridge();
    if (api) api.add(canvas, pos.x, pos.y, 1, 1);
    else { var original = originalPosition(pos); sendEvent({ action:"add", x:original.x, y:original.y }); }
  };
  canvas.oncontextmenu = function(event) {
    event.preventDefault();
    if (!state || !state.ready) return false;
    var pos = canvasPosition(event), api = directBridge();
    if (api) api.remove(canvas, pos.x, pos.y, 1, 1);
    else { var nearest = nearestPoint(pos); if (nearest) sendEvent({ action:"remove", index:nearest.index }); }
    return false;
  };
  canvas.onmousemove = function(event) {
    if (!state || !state.ready) return;
    var pos = canvasPosition(event), api = directBridge();
    if (api) { document.getElementById("pointInfo").textContent = api.info(canvas, pos.x, pos.y, 1, 1); return; }
    var nearest = nearestPoint(pos);
    if (!nearest) { document.getElementById("pointInfo").textContent = "좌클릭: Point 추가 · 우클릭: Sample 사각 영역의 Point 삭제"; return; }
    var quality = nearest.point.quality || { reason:"배경 후보" };
    document.getElementById("pointInfo").textContent = "Point 품질: " + quality.reason +
      " · 점수 " + (quality.score === undefined ? "-" : quality.score) +
      " · 원본 좌표 " + nearest.point.x + ", " + nearest.point.y;
  };
  canvas.onmouseleave = function() {
    document.getElementById("pointInfo").textContent = "좌클릭: Point 추가 · 우클릭: Sample 사각 영역의 Point 삭제";
  };

  document.getElementById("autoSamples").onclick = function() { dispatchCommand("auto"); };
  document.getElementById("undoSample").onclick = function() { dispatchCommand("undo"); };
  document.getElementById("clearSamples").onclick = function() { dispatchCommand("clear"); };
  document.getElementById("stretchPreset").onchange = function() {
    if (!updatingControls) dispatchCommand("setStretch", this.value);
  };
  document.getElementById("saturation").oninput = function() {
    if (updatingControls) return;
    document.getElementById("saturationValue").textContent = Number(this.value).toFixed(1);
    dispatchCommand("setSaturation", this.value);
  };
  document.getElementById("sampleSize").onchange = function() {
    if (!updatingControls) dispatchCommand("setSampleSize", this.value);
  };
  if (pointsPerRowInput) pointsPerRowInput.onchange = function() {
    if (!updatingControls) dispatchCommand("setPointsPerRow", this.value);
  };
  if (gridToleranceInput) gridToleranceInput.onchange = function() {
    if (!updatingControls) dispatchCommand("setGridTolerance", this.value);
  };
  if (qualityPresetSelect) qualityPresetSelect.onchange = function() {
    if (!updatingControls) dispatchCommand("setQualityPreset", this.value);
  };
  document.getElementById("selectionOnly").onchange = function() {
    if (!updatingControls) dispatchCommand("setSelectionOnly", this.checked);
  };
  document.getElementById("closeEditor").onclick = function() {
    try {
      if (window.__adobe_cep__ && window.__adobe_cep__.closeExtension) {
        window.__adobe_cep__.closeExtension();
        return;
      }
    } catch (_) {}
    window.close();
  };

  window.addEventListener("resize", function() {
    if (!state || !state.ready) return;
    var api = directBridge();
    if (api) applyState(api.snapshot(EDITOR_MODE)); else drawLocalEditor();
  });

  if (window.__adobe_cep__ && window.__adobe_cep__.addEventListener) {
    window.__adobe_cep__.addEventListener(STATE_EVENT, function(event) {
      try { applyState(JSON.parse(event.data || "{}")); } catch (_) {}
    });
  }
  if (directBridge()) {
    applyState(directBridge().snapshot(EDITOR_MODE));
    window.setInterval(function() { var api = directBridge(); if (api) applyState(api.snapshot(EDITOR_MODE)); }, 250);
  } else {
    writeReadyFile();
    window.setInterval(writeReadyFile, 400);
    dispatchCommand("requestState");
    pollStateFile();
    window.setInterval(pollStateFile, 250);
  }
})();
