(function() {
  "use strict";

  var EDITOR_MODE = document.body.getAttribute("data-editor-mode") === "neutralize"
    ? "neutralize" : "background";
  var IS_NEUTRAL = EDITOR_MODE === "neutralize";
  var WINDOW_TITLE = IS_NEUTRAL
    ? "GraXpert Neutralise Editor" : "GraXpert Gradient Editor";
  document.title = WINDOW_TITLE;
  try {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.invokeSync === "function") {
      window.__adobe_cep__.invokeSync("setWindowTitle", WINDOW_TITLE);
    } else if (window.__adobe_cep__ && typeof window.__adobe_cep__.setWindowTitle === "function") {
      window.__adobe_cep__.setWindowTitle(WINDOW_TITLE);
    }
  } catch (_) {}
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
  var selectionOnlyLabel = document.getElementById("selectionOnlyLabel");
  var gridStatus = document.getElementById("gridStatus");
  var zoomValue = document.getElementById("zoomValue");
  var viewOriginal = document.getElementById("viewOriginal");
  var viewResult = document.getElementById("viewResult");
  var showPoints = document.getElementById("showPoints");
  var resultStatus = document.getElementById("resultStatus");
  var resultBusyOverlay = document.getElementById("resultBusyOverlay");
  var generateResult = document.getElementById("generateResult");
  var cancelResult = document.getElementById("cancelResult");
  var applyResult = document.getElementById("applyResult");
  var state = null;
  var loadedPreviewFile = "";
  var sourcePixels = null;
  var originalPixels = null;
  var resultPixels = null;
  var displayCanvas = null;
  var displayKey = "";
  var updatingControls = false;
  var exchangeFs = null, exchangeOs = null, exchangePath = null;
  var lastStateText = "";
  var lastStateFileStamp = "";
  var zoomMode = "fit";
  var zoomScale = 1;
  var spacePressed = false;
  var panState = null;
  var pointDragState = null;
  var suppressNextClick = false;
  var viewMode = "original";
  var pointsVisible = true;
  var loadedResultPreviewFile = "";
  var lastAppliedRevision = null;
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
      var fileState = exchangeFs.statSync(stateFile);
      var modifiedAt = isFinite(Number(fileState.mtimeMs))
        ? Number(fileState.mtimeMs) : fileState.mtime.getTime();
      var fileStamp = modifiedAt + "|" + fileState.size;
      if (fileStamp === lastStateFileStamp) return;
      var serialized = exchangeFs.readFileSync(stateFile, "utf8");
      if (!serialized) return;
      if (serialized === lastStateText) {
        lastStateFileStamp = fileStamp;
        return;
      }
      var current = JSON.parse(serialized);
      lastStateFileStamp = fileStamp;
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
      else if (action === "previewGradient") api.previewGradient();
      else if (action === "applyGradient") api.applyGradient();
      else if (action === "cancelGradientPreview") api.cancelGradientPreview();
      else if (action === "releaseGradientResult") api.releaseGradientResult();
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

  function fitZoomScale(imageWidth, imageHeight) {
    return Math.min(
      1,
      Math.max(1, canvasWrap.clientWidth - 4) / Math.max(1, imageWidth),
      Math.max(1, canvasWrap.clientHeight - 4) / Math.max(1, imageHeight)
    );
  }

  function activeZoomScale(imageWidth, imageHeight) {
    return zoomMode === "fit" ? fitZoomScale(imageWidth, imageHeight) : zoomScale;
  }

  function calculateDisplaySize(imageWidth, imageHeight) {
    var scale = Math.max(0.05, Math.min(4, activeZoomScale(imageWidth, imageHeight)));
    return {
      width:Math.max(1, Math.round(imageWidth * scale)),
      height:Math.max(1, Math.round(imageHeight * scale)),
      scale:scale
    };
  }

  function updateZoomValue(scale) {
    if (!zoomValue) return;
    zoomValue.textContent = zoomMode === "fit" ? "맞춤" : Math.round(scale * 100) + "%";
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
    canvas.style.marginTop = Math.max(0, Math.round((canvasWrap.clientHeight - size.height - 2) / 2)) + "px";
    updateZoomValue(size.scale);
    var context = canvas.getContext("2d");
    context.drawImage(display, 0, 0, size.width, size.height);
    if (pointsVisible) {
      context.lineWidth = 2;
      for (var i=0; i<state.points.length; i++) {
        if (pointDragState && pointDragState.index === i) continue;
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
      if (pointDragState && pointDragState.previewPoint) {
        var dragBounds = sampleBoundsOnCanvas(pointDragState.previewPoint);
        context.save();
        context.setLineDash([6, 4]);
        context.lineWidth = 2;
        context.strokeStyle = "#67b7ff";
        context.strokeRect(
          dragBounds.left, dragBounds.top,
          dragBounds.right - dragBounds.left,
          dragBounds.bottom - dragBounds.top
        );
        context.restore();
      }
    }
  }

  function loadPreviewIfNeeded() {
    if (!state || !state.ready || !state.previewFile) return;
    if (loadedPreviewFile === state.previewFile && sourcePixels) { drawLocalEditor(); return; }
    var expectedFile = state.previewFile;
    var image = new Image();
    image.onload = function() {
      if (!state || state.previewFile !== expectedFile) return;
      zoomMode = "fit";
      zoomScale = 1;
      viewMode = "original";
      canvasWrap.scrollLeft = 0;
      canvasWrap.scrollTop = 0;
      var sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = state.previewState.previewWidth;
      sourceCanvas.height = state.previewState.previewHeight;
      var context = sourceCanvas.getContext("2d");
      context.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
      sourcePixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      originalPixels = sourcePixels;
      loadedPreviewFile = expectedFile; displayKey = ""; drawLocalEditor();
    };
    image.onerror = function() {
      emptyMessage.textContent = "Sample Preview 이미지를 불러올 수 없습니다."; emptyMessage.className = "";
    };
    image.src = fileUrl(expectedFile) + "?v=" + Date.now();
  }

  function loadResultPreviewIfNeeded() {
    if (!state || !state.resultReady || !state.resultPreviewFile) return;
    if (loadedResultPreviewFile === state.resultPreviewFile && resultPixels) {
      if (viewMode === "result") { sourcePixels = resultPixels; displayKey = ""; drawLocalEditor(); }
      return;
    }
    var expectedFile = state.resultPreviewFile;
    var image = new Image();
    image.onload = function() {
      if (!state || state.resultPreviewFile !== expectedFile) return;
      var resultCanvas = document.createElement("canvas");
      resultCanvas.width = state.previewState.previewWidth;
      resultCanvas.height = state.previewState.previewHeight;
      var context = resultCanvas.getContext("2d");
      context.drawImage(image, 0, 0, resultCanvas.width, resultCanvas.height);
      resultPixels = context.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
      loadedResultPreviewFile = expectedFile;
      if (viewMode === "result") { sourcePixels = resultPixels; displayKey = ""; drawLocalEditor(); }
    };
    image.onerror = function() {
      if (resultStatus) {
        resultStatus.textContent = "결과 Preview 이미지를 불러올 수 없습니다.";
        resultStatus.className = "result-status error";
      }
    };
    image.src = fileUrl(expectedFile) + "?v=" + Date.now();
  }

  function setViewMode(nextMode) {
    if (nextMode === "result" && (!state || !state.resultReady || !resultPixels)) return;
    viewMode = nextMode === "result" ? "result" : "original";
    sourcePixels = viewMode === "result" ? resultPixels : originalPixels;
    displayKey = "";
    if (viewOriginal) viewOriginal.className = viewMode === "original" ? "active" : "";
    if (viewResult) viewResult.className = viewMode === "result" ? "active" : "";
    drawLocalEditor();
  }

  function syncResultControls(current) {
    if (!resultStatus) return;
    var ready = !!current.resultReady;
    var busy = !!current.resultBusy;
    if (ready && current.resultPreviewFile && current.resultPreviewFile !== loadedResultPreviewFile) {
      resultPixels = null;
      viewMode = "result";
    }
    resultStatus.textContent = current.resultMessage || (ready ? "적용 가능한 결과가 준비되었습니다." : "결과 미리보기 전");
    resultStatus.className = "result-status" + (busy ? " busy" : ready ? " ready" : current.resultOutdated ? " outdated" : "");
    if (generateResult) generateResult.disabled = busy || !current.ready;
    if (generateResult) {
      generateResult.className = "result-generate" + (busy ? " busy" : "");
      generateResult.textContent = busy ? "처리 중…" : current.resultOutdated ? "결과 다시 계산" : "결과 미리보기 생성";
    }
    if (resultBusyOverlay) resultBusyOverlay.className = busy
      ? "result-busy-overlay" : "result-busy-overlay hidden";
    if (cancelResult) cancelResult.className = busy && current.resultCancelable ? "" : "hidden";
    if (applyResult) applyResult.disabled = busy || !ready;
    if (viewResult) viewResult.disabled = !ready;
    var lockedControls = [
      "pointsPerRow", "gridTolerance", "sampleSize", "qualityPreset", "selectionOnly",
      "autoSamples", "undoSample", "clearSamples"
    ];
    for (var lockedIndex=0; lockedIndex<lockedControls.length; lockedIndex++) {
      var lockedControl = document.getElementById(lockedControls[lockedIndex]);
      if (lockedControl) lockedControl.disabled = busy;
    }
    if (!ready && viewMode === "result") setViewMode("original");
    if (viewOriginal) viewOriginal.className = viewMode === "original" ? "active" : "";
    if (viewResult) viewResult.className = viewMode === "result" ? "active" : "";
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
    if (selectionOnlyLabel && !IS_NEUTRAL) {
      selectionOnlyLabel.textContent = current.regionSource === "selection"
        ? "Photoshop 선택 영역만"
        : current.regionSource === "layer-mask"
          ? "현재 레이어 마스크 영역만"
          : "지정 영역만";
    }
    updatingControls = false;
  }

  function applyState(current) {
    if (!current || current.editorMode !== EDITOR_MODE) return;
    if (!IS_NEUTRAL) {
      var appliedRevision = Number(current.resultAppliedRevision) || 0;
      if (lastAppliedRevision === null) lastAppliedRevision = appliedRevision;
      else if (appliedRevision !== lastAppliedRevision) {
        lastAppliedRevision = appliedRevision;
        closeEditorWindow(false);
        return;
      }
    }
    state = current;
    document.getElementById("sampleCount").textContent = current.count;
    document.getElementById("selectionStatus").textContent = current.selection;
    document.getElementById("qualityReport").textContent = current.quality;
    if (current.pointEditMessage) {
      document.getElementById("pointInfo").textContent = current.pointEditMessage;
    }
    if (gridStatus) {
      var gridStatusClass = current.gridDirty ? "grid-status" : "grid-status hidden";
      if (gridStatus.className !== gridStatusClass) gridStatus.className = gridStatusClass;
    }
    if (!IS_NEUTRAL) syncResultControls(current);
    syncControls(current);
    if (!current.ready) {
      emptyMessage.textContent = IS_NEUTRAL
        ? "메인 패널에서 배경 분석을 먼저 실행하세요."
        : "메인 패널에서 포인트 자동 생성을 먼저 실행하세요.";
      emptyMessage.className = ""; return;
    }
    emptyMessage.className = "hidden";
    loadPreviewIfNeeded();
    if (!IS_NEUTRAL) loadResultPreviewIfNeeded();
  }

  function setZoom(nextScale, modeName, clientX, clientY) {
    if (!state || !state.ready || !sourcePixels) return;
    var wrapRect = canvasWrap.getBoundingClientRect();
    var viewportX = clientX === undefined ? canvasWrap.clientWidth / 2 : clientX - wrapRect.left;
    var viewportY = clientY === undefined ? canvasWrap.clientHeight / 2 : clientY - wrapRect.top;
    var anchorX = (canvasWrap.scrollLeft + viewportX - canvas.offsetLeft) / Math.max(1, canvas.width);
    var anchorY = (canvasWrap.scrollTop + viewportY - canvas.offsetTop) / Math.max(1, canvas.height);
    zoomMode = modeName || "custom";
    zoomScale = Math.max(0.05, Math.min(4, Number(nextScale) || 1));
    drawLocalEditor();
    canvasWrap.scrollLeft = canvas.offsetLeft + anchorX * canvas.width - viewportX;
    canvasWrap.scrollTop = canvas.offsetTop + anchorY * canvas.height - viewportY;
  }

  function zoomBy(factor, event) {
    if (!sourcePixels) return;
    var currentScale = activeZoomScale(sourcePixels.width, sourcePixels.height);
    setZoom(currentScale * factor, "custom", event && event.clientX, event && event.clientY);
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
    if (!state || !state.ready || state.resultBusy) return;
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (!pointsVisible) return;
    var pos = canvasPosition(event), api = directBridge();
    if (api) api.add(canvas, pos.x, pos.y, 1, 1);
    else { var original = originalPosition(pos); sendEvent({ action:"add", x:original.x, y:original.y }); }
  };
  canvas.oncontextmenu = function(event) {
    event.preventDefault();
    if (!state || !state.ready || state.resultBusy || !pointsVisible) return false;
    var pos = canvasPosition(event), api = directBridge();
    if (api) api.remove(canvas, pos.x, pos.y, 1, 1);
    else { var nearest = nearestPoint(pos); if (nearest) sendEvent({ action:"remove", index:nearest.index }); }
    return false;
  };
  canvas.onmousemove = function(event) {
    if (!state || !state.ready) return;
    if (!pointsVisible) {
      document.getElementById("pointInfo").textContent = "포인트가 숨겨져 있습니다. 편집하려면 포인트 표시를 켜세요.";
      return;
    }
    var pos = canvasPosition(event), api = directBridge();
    if (api) { document.getElementById("pointInfo").textContent = api.info(canvas, pos.x, pos.y, 1, 1); return; }
    var nearest = nearestPoint(pos);
    if (!nearest) { document.getElementById("pointInfo").textContent = "Point 드래그: 위치 이동 · 빈 곳 좌클릭: 추가 · 우클릭: 삭제 · Space+드래그: 화면 이동"; return; }
    var quality = nearest.point.quality || { reason:"배경 후보" };
    document.getElementById("pointInfo").textContent = "Point 품질: " + quality.reason +
      " · 점수 " + (quality.score === undefined ? "-" : quality.score) +
      " · 원본 좌표 " + nearest.point.x + ", " + nearest.point.y;
  };
  canvas.onmouseleave = function() {
    document.getElementById("pointInfo").textContent = pointsVisible
      ? "Point 드래그: 위치 이동 · 빈 곳 좌클릭: 추가 · 우클릭: 삭제 · Space+드래그: 화면 이동"
      : "포인트가 숨겨져 있습니다. 편집하려면 포인트 표시를 켜세요.";
  };

  canvas.addEventListener("wheel", function(event) {
    if (!state || !state.ready) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.2 : (1 / 1.2), event);
  });

  canvas.addEventListener("mousedown", function(event) {
    if (event.button === 0 && !spacePressed && pointsVisible && state && state.ready && !state.resultBusy) {
      var dragTarget = nearestPoint(canvasPosition(event));
      if (dragTarget) {
        event.preventDefault();
        pointDragState = {
          index:dragTarget.index,
          startX:event.clientX,
          startY:event.clientY,
          moved:false,
          previewPoint:{ x:dragTarget.point.x, y:dragTarget.point.y }
        };
        canvas.className = "point-dragging";
        return;
      }
    }
    if (event.button !== 1 && !(event.button === 0 && spacePressed)) return;
    event.preventDefault();
    panState = {
      x:event.clientX, y:event.clientY,
      left:canvasWrap.scrollLeft, top:canvasWrap.scrollTop,
      moved:false
    };
    canvas.className = "panning";
  });

  window.addEventListener("mousemove", function(event) {
    if (pointDragState) {
      if (Math.abs(event.clientX - pointDragState.startX) +
          Math.abs(event.clientY - pointDragState.startY) > 2) pointDragState.moved = true;
      pointDragState.previewPoint = originalPosition(canvasPosition(event));
      document.getElementById("pointInfo").textContent = "Point 이동 중 · 놓으면 새 위치를 다시 검사합니다.";
      drawLocalEditor();
      return;
    }
    if (!panState) return;
    var dx = event.clientX - panState.x;
    var dy = event.clientY - panState.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) panState.moved = true;
    canvasWrap.scrollLeft = panState.left - dx;
    canvasWrap.scrollTop = panState.top - dy;
  });

  window.addEventListener("mouseup", function() {
    if (pointDragState) {
      var completedDrag = pointDragState;
      pointDragState = null;
      suppressNextClick = true;
      window.setTimeout(function() { suppressNextClick = false; }, 0);
      canvas.className = "";
      drawLocalEditor();
      if (completedDrag.moved) {
        var api = directBridge();
        if (api && api.move) api.move(
          completedDrag.index, completedDrag.previewPoint.x, completedDrag.previewPoint.y
        );
        else sendEvent({
          action:"move", index:completedDrag.index,
          x:completedDrag.previewPoint.x, y:completedDrag.previewPoint.y
        });
      }
      return;
    }
    if (!panState) return;
    suppressNextClick = panState.moved;
    panState = null;
    canvas.className = "";
  });

  window.addEventListener("keydown", function(event) {
    var targetTag = event.target && event.target.tagName ? event.target.tagName : "";
    if (event.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(targetTag)) {
      spacePressed = true;
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", function(event) {
    if (event.code === "Space") spacePressed = false;
  });
  window.addEventListener("blur", function() { spacePressed = false; });

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
  var zoomOut = document.getElementById("zoomOut");
  var zoomIn = document.getElementById("zoomIn");
  var zoomFit = document.getElementById("zoomFit");
  var zoomActual = document.getElementById("zoomActual");
  if (zoomOut) zoomOut.onclick = function() { zoomBy(1 / 1.2); };
  if (zoomIn) zoomIn.onclick = function() { zoomBy(1.2); };
  if (zoomFit) zoomFit.onclick = function() { setZoom(1, "fit"); };
  if (zoomActual) zoomActual.onclick = function() { setZoom(1, "custom"); };
  if (viewOriginal) viewOriginal.onclick = function() { setViewMode("original"); };
  if (viewResult) viewResult.onclick = function() {
    if (resultPixels) setViewMode("result");
    else { viewMode = "result"; loadResultPreviewIfNeeded(); }
  };
  if (showPoints) showPoints.onchange = function() {
    pointsVisible = !!this.checked;
    displayKey = "";
    drawLocalEditor();
    document.getElementById("pointInfo").textContent = pointsVisible
      ? "Point 드래그: 위치 이동 · 빈 곳 좌클릭: 추가 · 우클릭: 삭제 · Space+드래그: 화면 이동"
      : "포인트가 숨겨져 있습니다. 편집하려면 포인트 표시를 켜세요.";
  };
  if (generateResult) generateResult.onclick = function() { dispatchCommand("previewGradient"); };
  if (applyResult) applyResult.onclick = function() { dispatchCommand("applyGradient"); };
  if (cancelResult) cancelResult.onclick = function() { dispatchCommand("cancelGradientPreview"); };
  function closeEditorWindow(releaseResult) {
    if (releaseResult && !IS_NEUTRAL) dispatchCommand("releaseGradientResult");
    try {
      if (window.__adobe_cep__ && window.__adobe_cep__.closeExtension) {
        window.__adobe_cep__.closeExtension();
        return;
      }
    } catch (_) {}
    window.close();
  }

  document.getElementById("closeEditor").onclick = function() {
    closeEditorWindow(true);
  };

  window.addEventListener("resize", function() {
    if (!state || !state.ready) return;
    drawLocalEditor();
  });

  if (window.__adobe_cep__ && window.__adobe_cep__.addEventListener) {
    window.__adobe_cep__.addEventListener(STATE_EVENT, function(event) {
      try { applyState(JSON.parse(event.data || "{}")); } catch (_) {}
    });
  }
  if (directBridge()) {
    applyState(directBridge().snapshot(EDITOR_MODE));
    window.setInterval(function() {
      var api = directBridge();
      if (!api) return;
      var nextState = api.snapshot(EDITOR_MODE);
      if (!state || nextState.revision !== state.revision || nextState.ready !== state.ready ||
          nextState.resultBusy !== state.resultBusy || nextState.resultReady !== state.resultReady ||
          nextState.resultCancelable !== state.resultCancelable ||
          nextState.resultOutdated !== state.resultOutdated ||
          nextState.resultMessage !== state.resultMessage ||
          nextState.resultPreviewFile !== state.resultPreviewFile ||
          nextState.resultAppliedRevision !== state.resultAppliedRevision) {
        applyState(nextState);
      }
    }, 300);
  } else {
    writeReadyFile();
    window.addEventListener("focus", writeReadyFile);
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden) writeReadyFile();
    });
    window.setInterval(writeReadyFile, 5000);
    dispatchCommand("requestState");
    pollStateFile();
    window.setInterval(pollStateFile, 350);
  }
})();
