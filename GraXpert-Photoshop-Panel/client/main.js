(function () {
  "use strict";

  var fs, os, path, cp;
  try {
    fs = require("fs");
    os = require("os");
    path = require("path");
    cp = require("child_process");
  } catch (e) {}

  var mode = "background";
  var settingsOpen = false;
  var helpOpen = false;
  var settingsBtn = document.getElementById("settingsBtn");
  var helpBtn = document.getElementById("helpBtn");
  var quickHelp = document.getElementById("quickHelp");
  var closeQuickHelp = document.getElementById("closeQuickHelp");
  var tabs = document.getElementById("tabs");
  var footer = document.getElementById("footer");
  var tabBg = document.getElementById("tabBg");
  var tabDn = document.getElementById("tabDn");
  var tabNeutral = document.getElementById("tabNeutral");
  var COLOR_CALIBRATION_ENABLED = false;
  var bgPanel = document.getElementById("bgPanel");
  var gradientCard = document.getElementById("gradientCard");
  var dnPanel = document.getElementById("dnPanel");
  var neutralPanel = document.getElementById("neutralPanel");
  var neutralPointSlot = document.getElementById("neutralPointSlot");
  var scopeCard = document.getElementById("scopeCard");
  var runtimeCard = document.getElementById("runtimeCard");
  var smoothing = document.getElementById("smoothing");
  var strength = document.getElementById("strength");
  var exePath = document.getElementById("exePath");
  var runBtn = document.getElementById("runBtn");
  var cancelRunBtn = document.getElementById("cancelRunBtn");
  var panelRoot = document.querySelector(".panel");
  var sampleCard = document.getElementById("sampleCard");
  var sampleEditor = document.getElementById("sampleEditor");
  var sampleCanvas = document.getElementById("sampleCanvas");
  var sampleCanvasWrap = document.getElementById("sampleCanvasWrap");
  var sampleCanvasEmpty = document.getElementById("sampleCanvasEmpty");
  var sampleCount = document.getElementById("sampleCount");
  var selectionStatus = document.getElementById("selectionStatus");
  var pointQualityStatus = document.getElementById("pointQualityStatus");
  var qualityReport = document.getElementById("qualityReport");
  var samplePoints = [];
  var previewState = null;
  var previewImage = null;
  var previewPixels = null;
  var previewDisplayCanvas = null;
  var previewLuminanceStats = null;
  var previewSelectionLuminanceStats = null;
  var selectionMask = null;
  var pendingNeutralAutoAnalysis = false;
  var pendingGradientAutoSamples = false;
  var gradientGridDirty = false;
  var sampleEditorNotice = "";
  var gradientResultJob = null;
  var gradientResultBusy = false;
  var gradientResultContextValid = true;
  var gradientResultMessage = "결과 미리보기 전";
  var gradientResultAppliedRevision = 0;
  var pendingOpenSampleEditor = false;
  var sampleEditorContextCheckPending = false;
  var samplePreviewContextCheckPending = false;
  var samplePreviewContextOutdated = false;
  var samplePreviewContextMessage = "";
  var neutralAutoReady = false;
  var neutralMaskStatus = document.getElementById("neutralMaskStatus");
  var neutralEstimateStatus = document.getElementById("neutralEstimateStatus");
  var neutralEstimate = null;
  var gradientAdvancedOpen = false;
  var gradientAdvancedToggle = document.getElementById("gradientAdvancedToggle");
  var gradientAdvancedBody = document.getElementById("gradientAdvancedBody");
  var denoiseAdvancedOpen = false;
  var denoiseAdvancedToggle = document.getElementById("denoiseAdvancedToggle");
  var denoiseAdvancedBody = document.getElementById("denoiseAdvancedBody");
  var backgroundTargetValue = document.getElementById("backgroundTargetValue");
  var backgroundTargetBadge = document.getElementById("backgroundTargetBadge");
  var backgroundTargetHint = document.getElementById("backgroundTargetHint");
  var backgroundMaskValue = document.getElementById("backgroundMaskValue");
  var backgroundMaskBadge = document.getElementById("backgroundMaskBadge");
  var backgroundMaskHint = document.getElementById("backgroundMaskHint");
  var denoiseTargetValue = document.getElementById("denoiseTargetValue");
  var denoiseTargetBadge = document.getElementById("denoiseTargetBadge");
  var denoiseTargetHint = document.getElementById("denoiseTargetHint");
  var denoiseMaskValue = document.getElementById("denoiseMaskValue");
  var denoiseMaskBadge = document.getElementById("denoiseMaskBadge");
  var denoiseMaskHint = document.getElementById("denoiseMaskHint");
  var layerScopeRefreshPending = { background:false, denoise:false };
  var gradientSampleMethod = document.getElementById("gradientSampleMethod");
  var gradientInterpolation = document.getElementById("gradientInterpolation");
  var sampleScopeStatus = document.getElementById("sampleScopeStatus");
  var previewFile = "";
  var maskFile = "";
  var sampleEditorWindow = null;
  var neutralEditorWindow = null;
  var sampleEditorRevision = 0;
  var lastSampleEditorOpenAt = { background:0, neutralize:0 };
  var GRADIENT_EDITOR_EXTENSION_ID = "com.drmedia.graxpertps.gradienteditor";
  var GRADIENT_STATE_EVENT = "com.drmedia.graxpertps.gradienteditor.state";
  var GRADIENT_COMMAND_EVENT = "com.drmedia.graxpertps.gradienteditor.command";
  var NEUTRAL_EDITOR_EXTENSION_ID = "com.drmedia.graxpertps.neutraleditor";
  var NEUTRAL_STATE_EVENT = "com.drmedia.graxpertps.neutraleditor.state";
  var NEUTRAL_COMMAND_EVENT = "com.drmedia.graxpertps.neutraleditor.command";
  var lastSampleCommandId = { background:"", neutralize:"" };
  var lastSampleCommandFileStamp = { background:"", neutralize:"" };
  var activeGraXpertController = null;
  var panelBusy = false;
  var GRAXPERT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

  function editorConfig(editorMode) {
    var neutral = editorMode === "neutralize";
    return {
      mode: neutral ? "neutralize" : "background",
      extensionId: neutral ? NEUTRAL_EDITOR_EXTENSION_ID : GRADIENT_EDITOR_EXTENSION_ID,
      stateEvent: neutral ? NEUTRAL_STATE_EVENT : GRADIENT_STATE_EVENT,
      commandEvent: neutral ? NEUTRAL_COMMAND_EVENT : GRADIENT_COMMAND_EVENT,
      stateFile: neutral ? "neutral_editor_state.json" : "gradient_editor_state.json",
      commandFile: neutral ? "neutral_editor_command.json" : "gradient_editor_command.json",
      readyFile: neutral ? "neutral_editor_ready.json" : "gradient_editor_ready.json",
      html: neutral ? "neutral-editor-window.html" : "gradient-editor-window.html",
      windowName: neutral ? "GraXpertNeutralEditor" : "GraXpertGradientEditor"
    };
  }

  function cleanupOldTempFiles() {
    if (!fs || !os || !path) return;

    var dir = path.join(os.tmpdir(), "GraXpert_Photoshop");
    if (!fs.existsSync(dir)) return;

    var cutoff = Date.now() - (3 * 24 * 60 * 60 * 1000);

    try {
      var names = fs.readdirSync(dir);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];

        // Old v1.5-v1.8 recovery directory.
        if (name === "jobs") {
          var jobsPath = path.join(dir, name);
          try {
            var jobNames = fs.readdirSync(jobsPath);
            for (var j = 0; j < jobNames.length; j++) {
              var jf = path.join(jobsPath, jobNames[j]);
              try {
                var js = fs.statSync(jf);
                if (js.isFile() && js.mtime.getTime() < cutoff) fs.unlinkSync(jf);
              } catch (_) {}
            }
          } catch (_) {}
          continue;
        }

        if (!/^(input_|output_|photoshop_|conversion_|preview_|mask_|preferences_|stretch_|neutral_|editor_|gradient_editor_|sample_editor_).*/i.test(name)) continue;

        var fp = path.join(dir, name);
        try {
          var st = fs.statSync(fp);
          if (st.isFile() && st.mtime.getTime() < cutoff) {
            fs.unlinkSync(fp);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  cleanupOldTempFiles();

  function setMode(m) {
    if (m === "neutralize" && !COLOR_CALIBRATION_ENABLED) m = "background";
    var modeChanged = mode !== m;
    mode = m;
    if (modeChanged && previewState) resetSamplePreview();
    var bg = m === "background";
    var denoise = m === "denoise";
    var neutral = m === "neutralize";
    tabBg.className = bg ? "tab active" : "tab";
    tabDn.className = denoise ? "tab active" : "tab";
    tabNeutral.className = COLOR_CALIBRATION_ENABLED
      ? (neutral ? "tab active" : "tab")
      : "tab hidden";
    bgPanel.className = bg ? "" : "hidden";
    dnPanel.className = denoise ? "" : "hidden";
    neutralPanel.className = neutral ? "" : "hidden";
    scopeCard.className = bg ? "card processing-context-card" : "card processing-context-card hidden";
    runtimeCard.className = "card hidden";
    runBtn.className = neutral ? "run-btn hidden" : "run-btn";
    if (neutral) document.getElementById("selectionOnly").checked = false;
    if (!neutral) {
      document.getElementById("runText").textContent =
        bg ? "GraXpert Gradient Removal 실행" : "GraXpert Denoise 실행";
    }
    updateMethodUi();
    updateSampleScopeStatus();
    if (neutral) refreshNeutralMaskStatus();
    if (bg) refreshBackgroundScopeStatus();
    if (denoise) refreshDenoiseScopeStatus();
    clearMsg();
  }

  tabBg.onclick = function(){ setMode("background"); };
  tabDn.onclick = function(){ setMode("denoise"); };
  tabNeutral.onclick = function(){
    if (COLOR_CALIBRATION_ENABLED) setMode("neutralize");
  };

  function setSettingsMode(open) {
    if (open && helpOpen) setHelpMode(false);
    settingsOpen = !!open;
    settingsBtn.className = settingsOpen ? "badge settings-btn active" : "badge settings-btn";
    settingsBtn.setAttribute("aria-pressed", settingsOpen ? "true" : "false");
    settingsBtn.title = settingsOpen ? "설정 닫기" : "설정";
    if (settingsOpen) {
      tabs.className = "tabs hidden";
      scopeCard.className = "card processing-context-card hidden";
      bgPanel.className = "hidden";
      dnPanel.className = "hidden";
      neutralPanel.className = "hidden";
      if (sampleCard) sampleCard.className = "card hidden";
      runtimeCard.className = "card";
      runBtn.className = "run-btn hidden";
      document.getElementById("progressWrap").className = "progress-wrap hidden";
      if (footer) footer.className = "footer hidden";
      clearMsg();
      return;
    }
    tabs.className = "tabs";
    if (footer) footer.className = "footer";
    setMode(mode);
  }

  settingsBtn.onclick = function() { setSettingsMode(!settingsOpen); };

  function setHelpMode(open) {
    if (!helpBtn || !quickHelp) return;
    if (open && settingsOpen) setSettingsMode(false);
    helpOpen = !!open;
    quickHelp.className = open ? "quick-help" : "quick-help hidden";
    helpBtn.className = open ? "badge help-btn active" : "badge help-btn";
    helpBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      tabs.className = "tabs hidden";
      scopeCard.className = "card processing-context-card hidden";
      bgPanel.className = "hidden";
      dnPanel.className = "hidden";
      neutralPanel.className = "hidden";
      if (sampleCard) sampleCard.className = "card hidden";
      runtimeCard.className = "card hidden";
      runBtn.className = "run-btn hidden";
      document.getElementById("progressWrap").className = "progress-wrap hidden";
      if (footer) footer.className = "footer hidden";
      clearMsg();
      return;
    }
    if (!settingsOpen) {
      tabs.className = "tabs";
      if (footer) footer.className = "footer";
      setMode(mode);
    }
  }

  helpBtn.onclick = function() {
    setHelpMode(!helpOpen);
  };
  closeQuickHelp.onclick = function() { setHelpMode(false); };

  smoothing.oninput = function(){
    document.getElementById("smoothingValue").textContent = Number(this.value).toFixed(2);
    dispatchSampleEditorState();
  };

  strength.oninput = function(){
    document.getElementById("strengthValue").textContent = Number(this.value).toFixed(2);
  };

  function currentGradientMethod() {
    var gradientMode = selected("gradientMethod") || "AI";
    if (gradientMode === "AI") return "AI";
    return gradientInterpolation ? gradientInterpolation.value : "RBF";
  }

  function updateMethodUi() {
    if (settingsOpen) {
      if (sampleCard) sampleCard.className = "card hidden";
      return;
    }
    if (sampleCard && mode === "background") placeSampleCardInside(gradientCard, gradientAdvancedToggle);
    if (sampleCard && mode === "neutralize") placeSampleCardInside(neutralPointSlot);
    var sampleBasedGradient = mode === "background" && currentGradientMethod() !== "AI";
    var gradientMethodHint = document.getElementById("gradientMethodHint");
    if (gradientMethodHint) gradientMethodHint.textContent = sampleBasedGradient
      ? "Gradient Editor에서 확인한 Sample Point로 배경 Gradient를 계산합니다."
      : "GraXpert가 배경 Gradient를 자동으로 분석합니다.";
    if (gradientSampleMethod) gradientSampleMethod.className = sampleBasedGradient
      ? "gradient-sample-method"
      : "gradient-sample-method hidden";
    var showSamples = sampleBasedGradient || mode === "neutralize";
    if (sampleCard) sampleCard.className = showSamples
      ? "sample-compact"
      : "sample-compact hidden";
    var sampleCardTitle = document.getElementById("sampleCardTitle");
    var generateButton = document.getElementById("generateSamples");
    var openButton = document.getElementById("openSampleWindow");
    if (sampleCardTitle) sampleCardTitle.textContent = mode === "neutralize"
      ? "Reference Point" : "Sample Point";
    if (generateButton) generateButton.textContent = mode === "neutralize"
      ? "배경 분석" : "자동 생성";
    if (openButton) openButton.textContent = mode === "neutralize"
      ? "Neutralise Editor" : "Gradient Editor 열기";
    if (generateButton) generateButton.className = mode === "neutralize"
      ? "editor-main-btn sample-window-btn" : "editor-main-btn";
    if (openButton) openButton.className = mode === "neutralize"
      ? "editor-main-btn" : "editor-main-btn sample-window-btn";
    updateSampleCount();
  }

  function placeSampleCardInside(anchor, beforeElement) {
    if (!sampleCard || !anchor) return;
    if (beforeElement && beforeElement.parentNode === anchor) {
      if (sampleCard.parentNode === anchor && sampleCard.nextElementSibling === beforeElement) return;
      anchor.insertBefore(sampleCard, beforeElement);
      return;
    }
    if (sampleCard.parentNode === anchor) return;
    anchor.appendChild(sampleCard);
  }

  function setNeutralMaskStatus(text, state) {
    if (!neutralMaskStatus) return;
    neutralMaskStatus.textContent = text;
    neutralMaskStatus.className = "hint scope-hint neutral-scope-status" + (state ? " " + state : "");
  }

  function refreshNeutralMaskStatus() {
    var skyOnly = document.getElementById("neutralSkyOnly");
    var resultLabel = skyOnly && skyOnly.checked
      ? "지정 영역"
      : "현재 레이어 전체";
    setNeutralMaskStatus("분석 영역: 확인 중… · 결과: " + resultLabel, "");
    evalPS("GX_getSkyMaskStatus()", function(error, result) {
      resultLabel = document.getElementById("neutralSkyOnly").checked
        ? "지정 영역"
        : "현재 레이어 전체";
      if (error || !result || result.indexOf("OK|") !== 0) {
        setNeutralMaskStatus(
          "분석 영역: 확인 실패 · 결과: " + resultLabel, "warning"
        );
        return;
      }
      var source = result.substring(3);
      if (source === "selection") {
        setNeutralMaskStatus(
          "분석 영역: Photoshop 선택 영역 · 결과: " + resultLabel, "ready"
        );
      } else if (source === "layer-mask") {
        setNeutralMaskStatus(
          "분석 영역: 현재 레이어 마스크 · 결과: " + resultLabel, "ready"
        );
      } else {
        if (skyOnly.checked) {
          setNeutralMaskStatus(
            "분석 영역 없음 · 선택 영역 또는 레이어 마스크가 필요합니다.", "warning"
          );
        } else {
          setNeutralMaskStatus(
            "분석 영역: 현재 레이어 전체 · 결과: " + resultLabel, "ready"
          );
        }
      }
    });
  }

  function setProcessingContextBadge(element, text, state) {
    if (!element) return;
    var className = "processing-context-badge" + (state ? " " + state : "");
    if (element.textContent !== text) element.textContent = text;
    if (element.className !== className) element.className = className;
  }

  function setProcessingContextText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function refreshLayerScopeStatus(scopeMode, targetValue, targetBadge, targetHint,
    maskValue, maskBadge, maskHint, operationLabel) {
    if (mode !== scopeMode || settingsOpen || layerScopeRefreshPending[scopeMode]) return;
    layerScopeRefreshPending[scopeMode] = true;
    evalPS("GX_getActiveLayerInfo()", function(infoError, infoResult) {
      if (infoError || !infoResult || infoResult.indexOf("OK|") !== 0) {
        layerScopeRefreshPending[scopeMode] = false;
        setProcessingContextText(targetValue, "처리할 레이어 없음");
        setProcessingContextText(targetHint, infoError || infoResult || "Photoshop 문서를 열고 레이어를 선택하세요.");
        setProcessingContextBadge(targetBadge, "사용 불가", "error");
        setProcessingContextText(maskValue, "확인 불가");
        setProcessingContextText(maskHint, "처리 대상을 먼저 선택하세요.");
        setProcessingContextBadge(maskBadge, "자동", "checking");
        return;
      }
      setProcessingContextText(targetValue, "현재 레이어");
      setProcessingContextText(targetHint, "현재 선택한 레이어 전체를 " + operationLabel + "합니다.");
      setProcessingContextBadge(targetBadge, "사용 가능", "");

      evalPS("GX_getSkyMaskStatus()", function(maskError, maskResult) {
        layerScopeRefreshPending[scopeMode] = false;
        if (maskError || !maskResult || maskResult.indexOf("OK|") !== 0) {
          setProcessingContextText(maskValue, "확인 실패");
          setProcessingContextText(maskHint, maskError || maskResult || "선택 영역 또는 레이어 마스크 상태를 확인하지 못했습니다.");
          setProcessingContextBadge(maskBadge, "확인 필요", "error");
          return;
        }
        var maskSource = maskResult.substring(3);
        var analysisOnly = scopeMode === "background";
        if (maskSource === "selection") {
          setProcessingContextText(maskValue, "선택 영역 사용");
          setProcessingContextText(maskHint, analysisOnly
            ? "Photoshop 선택 영역 안에서 Sample Point를 생성하며 결과는 현재 레이어 전체에 적용합니다."
            : "Photoshop 선택 영역을 결과 레이어 마스크로 적용합니다.");
          setProcessingContextBadge(maskBadge, analysisOnly ? "분석" : "자동", "");
        } else if (maskSource === "layer-mask") {
          setProcessingContextText(maskValue, "현재 레이어 마스크 복사");
          if (analysisOnly) setProcessingContextText(maskValue, "현재 레이어 마스크 사용");
          setProcessingContextText(maskHint, analysisOnly
            ? "현재 레이어 마스크 영역 안에서 Sample Point를 생성하며 결과 마스크는 만들지 않습니다."
            : "현재 레이어 마스크를 결과 레이어에 복사합니다.");
          setProcessingContextBadge(maskBadge, analysisOnly ? "분석" : "자동", "");
        } else {
          setProcessingContextText(maskValue, analysisOnly ? "현재 레이어 전체" : "적용 안 함");
          setProcessingContextText(maskHint, analysisOnly
            ? "지정된 영역이 없어 현재 레이어 전체에서 Sample Point를 생성합니다."
            : "선택 영역과 레이어 마스크가 없어 마스크 없이 생성합니다.");
          setProcessingContextBadge(maskBadge, analysisOnly ? "분석" : "마스크 없음", "neutral");
        }
      });
    });
  }

  function refreshBackgroundScopeStatus() {
    refreshLayerScopeStatus(
      "background",
      backgroundTargetValue, backgroundTargetBadge, backgroundTargetHint,
      backgroundMaskValue, backgroundMaskBadge, backgroundMaskHint,
      "Background Extraction"
    );
  }

  function refreshDenoiseScopeStatus() {
    refreshLayerScopeStatus(
      "denoise",
      denoiseTargetValue, denoiseTargetBadge, denoiseTargetHint,
      denoiseMaskValue, denoiseMaskBadge, denoiseMaskHint,
      "Noise Reduction"
    );
  }

  if (window.setInterval) {
    window.setInterval(function() {
      if (mode === "background" && !settingsOpen) {
        refreshBackgroundScopeStatus();
        refreshGradientResultContextStatus();
        refreshSamplePreviewContextStatus();
      }
      else if (mode === "denoise" && !settingsOpen) refreshDenoiseScopeStatus();
    }, 2000);
  }

  var methodInputs = document.querySelectorAll('input[name="gradientMethod"]');
  for (var mi=0; mi<methodInputs.length; mi++) {
    methodInputs[mi].onchange = function() {
      updateMethodUi();
      dispatchSampleEditorState();
    };
  }

  if (gradientInterpolation) gradientInterpolation.onchange = function() {
    updateMethodUi();
    dispatchSampleEditorState();
    showOk("배경 포인트 보간 방식을 " + this.value + "로 변경했습니다.");
  };

  var correctionInputs = document.querySelectorAll('input[name="correction"]');
  for (var correctionIndex=0; correctionIndex<correctionInputs.length; correctionIndex++) {
    correctionInputs[correctionIndex].onchange = dispatchSampleEditorState;
  }
  var addBackgroundLayerInput = document.getElementById("addBackgroundLayer");
  if (addBackgroundLayerInput) addBackgroundLayerInput.onchange = dispatchSampleEditorState;

  function setAdvancedSection(toggle, body, open, bodyClass) {
    if (!toggle || !body) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.className = open ? "advanced-toggle active" : "advanced-toggle";
    toggle.textContent = open ? "상세 설정 숨기기" : "상세 설정 보기";
    body.className = open ? bodyClass : bodyClass + " hidden";
  }

  if (gradientAdvancedToggle) gradientAdvancedToggle.onclick = function() {
    gradientAdvancedOpen = !gradientAdvancedOpen;
    setAdvancedSection(this, gradientAdvancedBody, gradientAdvancedOpen, "gradient-advanced-body");
  };

  if (denoiseAdvancedToggle) denoiseAdvancedToggle.onclick = function() {
    denoiseAdvancedOpen = !denoiseAdvancedOpen;
    setAdvancedSection(this, denoiseAdvancedBody, denoiseAdvancedOpen, "denoise-advanced-body");
  };

  function updateSampleCount() {
    if (!sampleCount) return;
    var warningCount = 0;
    var excludedCount = 0;
    var goodCount = 0;
    var scoreTotal = 0;
    var scoredCount = 0;
    var reasons = {};
    for (var i=0; i<samplePoints.length; i++) {
      var pointQuality = samplePoints[i].quality;
      if (pointQuality && pointQuality.status === "exclude") excludedCount++;
      else if (pointQuality && pointQuality.status === "warning") warningCount++;
      else goodCount++;
      if (pointQuality && pointQuality.score !== undefined) {
        scoreTotal += pointQuality.score;
        scoredCount++;
      }
      if (pointQuality && pointQuality.reason && pointQuality.status !== "good") {
        reasons[pointQuality.reason] = (reasons[pointQuality.reason] || 0) + 1;
      }
    }
    sampleCount.textContent = samplePoints.length
      ? samplePoints.length + "개 · 적합 " + goodCount +
        (warningCount ? " · 주의 " + warningCount : "") +
        (excludedCount ? " · 제외 " + excludedCount : "")
      : "준비되지 않음";
    var neutralCount = document.getElementById("neutralSampleCount");
    if (neutralCount) neutralCount.textContent = (samplePoints.length - excludedCount) + " usable points";
    if (qualityReport) {
      var reasonParts = [];
      for (var reason in reasons) {
        if (reasons.hasOwnProperty(reason)) reasonParts.push(reason + " " + reasons[reason]);
      }
      qualityReport.textContent = samplePoints.length
        ? "적합 " + goodCount + " · 주의 " + warningCount + " · 제외 " + excludedCount +
          " · 평균 " + Math.round(scoreTotal / Math.max(1, scoredCount)) + "점" +
          (reasonParts.length ? "\n" + reasonParts.join(" · ") : "")
        : "품질 분석 전";
    }
  }

  function updateSampleScopeStatus() {
    if (!sampleScopeStatus) return;
    var resultScope;
    var pointScope = "자동 감지 전";
    var restrictPoints = document.getElementById("selectionOnly").checked;
    if (mode === "neutralize") {
      var neutralSky = document.getElementById("neutralSkyOnly").checked;
      resultScope = neutralSky ? "지정 영역을 새 레이어 마스크로 적용" : "현재 레이어 전체 · 마스크 없음";
      if (previewState) pointScope = previewState.hasSelection && restrictPoints
        ? "감지한 입력 영역 내부"
        : (neutralSky ? "지정 영역 없음" : "현재 레이어 전체");
    } else {
      resultScope = "현재 레이어 전체 · 결과 마스크 없음";
      if (previewState) {
        pointScope = previewState.hasSelection && restrictPoints
          ? "Photoshop 선택 영역/현재 레이어 마스크"
          : "현재 레이어 전체";
      }
    }
    sampleScopeStatus.textContent = "Point 생성 영역: " + pointScope +
      "\n결과 적용 영역: " + resultScope;
    if (sampleCount && mode === "background") {
      sampleCount.title = "생성 영역: " + pointScope + " · 적용 영역: " + resultScope;
    }
  }

  function previewRegionSource(state) {
    var context = state && String(state.analysisContext || "");
    if (context.indexOf("selection:") === 0) return "selection";
    if (context.indexOf("layer-mask:") === 0) return "layer-mask";
    return "none";
  }

  function previewRegionStatusText(state) {
    var source = previewRegionSource(state);
    if (source === "selection") return "지정 영역: Photoshop 선택 영역";
    if (source === "layer-mask") return "지정 영역: 현재 레이어 마스크";
    return "지정 영역: 없음 (현재 레이어 전체 사용)";
  }

  function resetSamplePreview() {
    if (!gradientResultBusy && gradientResultJob) cleanupGradientResultJob(gradientResultJob);
    if (!gradientResultBusy) {
      gradientResultJob = null;
      gradientResultContextValid = true;
      gradientResultMessage = "결과 미리보기 전";
    }
    if (previewState && previewState.gradientInputFile) safeDelete(previewState.gradientInputFile);
    safeDelete(previewFile);
    safeDelete(maskFile);
    previewFile = "";
    maskFile = "";
    previewState = null;
    previewImage = null;
    previewPixels = null;
    previewDisplayCanvas = null;
    previewLuminanceStats = null;
    previewSelectionLuminanceStats = null;
    selectionMask = null;
    samplePoints = [];
    sampleEditorNotice = "";
    neutralAutoReady = false;
    neutralEstimate = null;
    pendingGradientAutoSamples = false;
    gradientGridDirty = false;
    pendingOpenSampleEditor = false;
    samplePreviewContextOutdated = false;
    samplePreviewContextMessage = "";
    if (sampleEditor) sampleEditor.className = "sample-editor hidden";
    if (sampleCanvasEmpty) sampleCanvasEmpty.className = "sample-canvas-empty";
    if (selectionStatus) selectionStatus.textContent = "Photoshop 선택 영역: 확인 전";
    if (pointQualityStatus) pointQualityStatus.textContent = "Point 위에 마우스를 올리면 판정 사유를 표시합니다.";
    if (qualityReport) qualityReport.textContent = "품질 분석 전";
    if (neutralEstimateStatus) {
      neutralEstimateStatus.textContent = "배경 분석 후 보정 필요도와 예상 RGB 이동량을 표시합니다.";
    }
    updateSampleScopeStatus();
    var neutralStatus = document.getElementById("neutralAnalysisStatus");
    if (neutralStatus) neutralStatus.textContent = "자동 분석 전";
    sampleEditorRevision++;
    updateSampleCount();
    dispatchSampleEditorState();
  }

  function parseActiveContextIdentity(result) {
    if (!result || result.indexOf("OK|") !== 0) return null;
    var parts = result.split("|");
    var identity = {
      docId:parseInt(parts[1], 10),
      layerId:parseInt(parts[2], 10),
      width:parseInt(parts[3], 10),
      height:parseInt(parts[4], 10),
      layerVersion:-1,
      analysisContext:""
    };
    for (var partIndex=5; partIndex<parts.length; partIndex++) {
      if (/^V:-?\d+$/.test(parts[partIndex])) {
        identity.layerVersion = parseInt(parts[partIndex].substring(2), 10);
      } else if (parts[partIndex].indexOf("C:") === 0) {
        try { identity.analysisContext = decodeURIComponent(parts[partIndex].substring(2)); }
        catch (_) { identity.analysisContext = parts[partIndex].substring(2); }
      }
    }
    return identity;
  }

  function quickAnalysisContext(context) {
    var value = String(context || "none:");
    if (value.indexOf("selection:") === 0) return value.split(",A:")[0];
    if (value.indexOf("layer-mask:") === 0) return "layer-mask:";
    return "none:";
  }

  function previewMatchesContext(preview, identity, fullAnalysis) {
    if (!preview || !identity) return false;
    if (identity.docId !== preview.docId || identity.layerId !== preview.sourceLayerId ||
        identity.width !== preview.originalWidth || identity.height !== preview.originalHeight) return false;
    if (identity.layerVersion >= 0 && preview.layerVersion >= 0 &&
        identity.layerVersion !== preview.layerVersion) return false;
    return fullAnalysis
      ? identity.analysisContext === String(preview.analysisContext || "none:")
      : quickAnalysisContext(identity.analysisContext) === quickAnalysisContext(preview.analysisContext);
  }

  function refreshSamplePreviewContextStatus() {
    if (mode !== "background" || settingsOpen || !previewState ||
        previewState.mode !== "background" || samplePreviewContextCheckPending ||
        pendingOpenSampleEditor || gradientResultBusy || panelBusy) return;
    samplePreviewContextCheckPending = true;
    var checkedPreview = previewState;
    evalPS("GX_getActiveContextIdentity(false)", function(contextError, contextResult) {
      samplePreviewContextCheckPending = false;
      if (previewState !== checkedPreview) return;
      var identity = contextError ? null : parseActiveContextIdentity(contextResult);
      var outdated = !previewMatchesContext(checkedPreview, identity, false);
      var message = outdated
        ? "현재 Photoshop 문서, 레이어 또는 지정 영역이 변경되었습니다. Gradient Editor 열기를 다시 눌러 Preview를 갱신하세요."
        : "";
      if (outdated === samplePreviewContextOutdated && message === samplePreviewContextMessage) return;
      samplePreviewContextOutdated = outdated;
      samplePreviewContextMessage = message;
      sampleEditorRevision++;
      dispatchSampleEditorState();
    });
  }

  function fileUrl(filePath) {
    var normalized = String(filePath).replace(/\\/g, "/");
    return ("file:///" + encodeURI(normalized)).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  function dispatchCepEvent(type, data, targetExtensionId) {
    if (!window.__adobe_cep__ || !window.__adobe_cep__.dispatchEvent) return false;
    try {
      window.__adobe_cep__.dispatchEvent({
        type: type,
        scope: "APPLICATION",
        appId: "PHXS",
        extensionId: targetExtensionId || "",
        data: typeof data === "string" ? data : JSON.stringify(data || {})
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function sampleEditorExchangeFile(name) {
    if (!fs || !os || !path) return "";
    var directory = path.join(os.tmpdir(), "GraXpert_Photoshop");
    try {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive:true });
      return path.join(directory, name);
    } catch (_) { return ""; }
  }

  function writeSampleEditorStateFile(editorMode) {
    var config = editorConfig(editorMode);
    var stateFile = sampleEditorExchangeFile(config.stateFile);
    if (!stateFile) return;
    try { fs.writeFileSync(stateFile, JSON.stringify(sampleEditorStateSnapshot(config.mode)), "utf8"); } catch (_) {}
  }

  function activateSampleEditorWhenReady(editorMode, openedAt, attempt) {
    var config = editorConfig(editorMode);
    var ready = false;
    var readyFile = sampleEditorExchangeFile(config.readyFile);
    if (readyFile && fs && fs.existsSync(readyFile)) {
      try {
        var readyState = JSON.parse(fs.readFileSync(readyFile, "utf8"));
        ready = Number(readyState.updatedAt) >= openedAt;
      } catch (_) {}
    }
    if (ready || attempt >= 20) {
      dispatchSampleEditorState();
      return;
    }
    setTimeout(function() { activateSampleEditorWhenReady(config.mode, openedAt, attempt + 1); }, 150);
  }

  function loadLocalImage(filePath, callback) {
    var image = new Image();
    image.onload = function(){ callback(null, image); };
    image.onerror = function(){ callback(new Error("Preview 이미지를 열 수 없습니다: " + filePath)); };
    image.src = fileUrl(filePath) + "?v=" + Date.now();
  }

  function calculateCanvasSize(imageWidth, imageHeight, availableWidth, maxHeight) {
    var width = Math.max(1, Math.min(Number(imageWidth) || 1, Math.floor(Number(availableWidth) || imageWidth || 1)));
    var height = Math.max(1, Math.round(width * imageHeight / imageWidth));
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.max(1, Math.round(height * imageWidth / imageHeight));
    }
    return { width: width, height: height };
  }

  function originalToCanvas(point, targetCanvas) {
    targetCanvas = targetCanvas || sampleCanvas;
    var originalMaxX = Math.max(1, previewState.originalWidth - 1);
    var originalMaxY = Math.max(1, previewState.originalHeight - 1);
    return {
      x: point.x / originalMaxX * Math.max(1, targetCanvas.width - 1),
      y: point.y / originalMaxY * Math.max(1, targetCanvas.height - 1)
    };
  }

  function luminanceAt(data, at) {
    return data[at] * 0.2126 + data[at + 1] * 0.7152 + data[at + 2] * 0.0722;
  }

  function getStretchPreset(name) {
    if (name === "10% Bg, 3 sigma") return { name: name, bg: 0.10, sigma: 3.0, enabled: true };
    if (name === "15% Bg, 3 sigma") return { name: name, bg: 0.15, sigma: 3.0, enabled: true };
    if (name === "20% Bg, 3 sigma") return { name: name, bg: 0.20, sigma: 3.0, enabled: true };
    if (name === "30% Bg, 2 sigma") return { name: name, bg: 0.30, sigma: 2.0, enabled: true };
    if (name === "40% Bg, 1.5 sigma") return { name: name, bg: 0.40, sigma: 1.5, enabled: true };
    return { name: "No Stretch", bg: 0, sigma: 0, enabled: false };
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

  function stretchParametersFromHistogram(histogram, preset) {
    var valid = 0;
    for (var i=1; i<histogram.length - 1; i++) valid += histogram[i] || 0;
    if (!valid) return { shadow: 0, midtone: 0.5 };
    var filtered = histogram.slice(0);
    filtered[0] = 0;
    filtered[filtered.length - 1] = 0;
    var medianBin = histogramMedian(filtered, valid);
    var deviationHistogram = [];
    for (var d=0; d<histogram.length; d++) deviationHistogram[d] = 0;
    for (var bin=1; bin<histogram.length - 1; bin++) {
      deviationHistogram[Math.abs(bin - medianBin)] += histogram[bin] || 0;
    }
    var madBin = histogramMedian(deviationHistogram, valid);
    var maxBin = histogram.length - 1;
    var median = medianBin / maxBin;
    var mad = madBin / maxBin;
    var shadow = Math.max(0, Math.min(1, median - preset.sigma * mad));
    var normalizedMedian = (median - shadow) / Math.max(1e-12, 1 - shadow);
    var midtone = mtfValue(normalizedMedian, preset.bg);
    return { shadow: shadow, midtone: midtone };
  }

  function applyPreviewStretch(imageData, presetName) {
    var preset = getStretchPreset(presetName);
    var output = new Uint8ClampedArray(imageData.data.length);
    if (!preset.enabled) {
      output.set(imageData.data);
      return { width: imageData.width, height: imageData.height, data: output };
    }
    var histograms = [[], [], []];
    for (var c=0; c<3; c++) for (var h=0; h<256; h++) histograms[c][h] = 0;
    var pixelCount = imageData.width * imageData.height;
    var stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 120000)));
    for (var y=0; y<imageData.height; y += stride) {
      for (var x=0; x<imageData.width; x += stride) {
        var sampleAt = (y * imageData.width + x) * 4;
        for (var channel=0; channel<3; channel++) histograms[channel][imageData.data[sampleAt + channel]]++;
      }
    }
    var parameters = [
      stretchParametersFromHistogram(histograms[0], preset),
      stretchParametersFromHistogram(histograms[1], preset),
      stretchParametersFromHistogram(histograms[2], preset)
    ];
    for (var at=0; at<imageData.data.length; at += 4) {
      for (var color=0; color<3; color++) {
        var value = imageData.data[at + color] / 255;
        var parameter = parameters[color];
        var stretched = value <= parameter.shadow ? 0 : mtfValue((value - parameter.shadow) / (1 - parameter.shadow), parameter.midtone);
        output[at + color] = Math.max(0, Math.min(255, Math.round(stretched * 255)));
      }
      output[at + 3] = imageData.data[at + 3];
    }
    return { width: imageData.width, height: imageData.height, data: output, parameters: parameters };
  }

  function normalizeSaturation(value) {
    var saturation = Number(value);
    if (!isFinite(saturation)) saturation = 1;
    return Math.max(0, Math.min(3, saturation));
  }

  function applyPreviewSaturation(imageData, saturationValue) {
    var saturation = normalizeSaturation(saturationValue);
    var output = new Uint8ClampedArray(imageData.data.length);
    for (var at=0; at<imageData.data.length; at += 4) {
      var red = imageData.data[at];
      var green = imageData.data[at + 1];
      var blue = imageData.data[at + 2];
      // Match PIL ImageEnhance.Color, which blends RGB with its luminance image.
      var gray = 0.299 * red + 0.587 * green + 0.114 * blue;
      output[at] = Math.max(0, Math.min(255, Math.round(gray + saturation * (red - gray))));
      output[at + 1] = Math.max(0, Math.min(255, Math.round(gray + saturation * (green - gray))));
      output[at + 2] = Math.max(0, Math.min(255, Math.round(gray + saturation * (blue - gray))));
      output[at + 3] = imageData.data[at + 3];
    }
    return { width: imageData.width, height: imageData.height, data: output };
  }

  function refreshPreviewStretch() {
    if (!previewPixels || !previewState) return;
    var presetName = document.getElementById("stretchPreset").value;
    var preset = getStretchPreset(presetName);
    var saturation = normalizeSaturation(document.getElementById("previewSaturation").value);
    previewDisplayCanvas = null;
    if (preset.enabled || Math.abs(saturation - 1) > 1e-9) {
      var stretched = applyPreviewStretch(previewPixels, presetName);
      var displayed = applyPreviewSaturation(stretched, saturation);
      var canvas = document.createElement("canvas");
      canvas.width = displayed.width;
      canvas.height = displayed.height;
      var context = canvas.getContext("2d");
      var displayData = context.createImageData(displayed.width, displayed.height);
      displayData.data.set(displayed.data);
      context.putImageData(displayData, 0, 0);
      previewDisplayCanvas = canvas;
    }
    drawSampleEditor();
  }

  function calculateLuminanceStats(imageData, maskData) {
    var histogram = [];
    for (var hi=0; hi<256; hi++) histogram[hi] = 0;
    var pixelCount = imageData.width * imageData.height;
    var stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 60000)));
    var samples = 0;
    for (var y=0; y<imageData.height; y += stride) {
      for (var x=0; x<imageData.width; x += stride) {
        var at = (y * imageData.width + x) * 4;
        if (maskData && maskData.data && maskData.data[at] < 128) continue;
        var value = Math.max(0, Math.min(255, Math.round(luminanceAt(imageData.data, at))));
        histogram[value]++;
        samples++;
      }
    }
    if (!samples && maskData) return calculateLuminanceStats(imageData, null);
    function percentile(fraction) {
      var target = samples * fraction;
      var total = 0;
      for (var value=0; value<256; value++) {
        total += histogram[value];
        if (total >= target) return value;
      }
      return 255;
    }
    return {
      p50: percentile(0.50),
      p70: percentile(0.70),
      p85: percentile(0.85),
      p95: percentile(0.95)
    };
  }

  function getQualityConfig(name) {
    if (name === "off") {
      return { name:"off" };
    }
    if (name === "relaxed") {
      return {
        name: "relaxed", meanAdjust: 20, warningAdjust: 10,
        starExclude: 0.16, starWarning: 0.09,
        coreMin: 15, coreSigma: 2.0, coreElevated: 0.62,
        brightExclude: 0.32, brightWarning: 0.18, deviationWarning: 42
      };
    }
    if (name === "strict") {
      return {
        name: "strict", meanAdjust: -5, warningAdjust: -3,
        starExclude: 0.07, starWarning: 0.035,
        coreMin: 7, coreSigma: 1.0, coreElevated: 0.32,
        brightExclude: 0.14, brightWarning: 0.07, deviationWarning: 24
      };
    }
    return {
      name: "standard", meanAdjust: 0, warningAdjust: 0,
      starExclude: 0.10, starWarning: 0.05,
      coreMin: 10, coreSigma: 1.5, coreElevated: 0.45,
      brightExclude: 0.22, brightWarning: 0.10, deviationWarning: 32
    };
  }

  function currentQualityConfig() {
    return getQualityConfig(selected("qualityPreset") || "standard");
  }

  function normalizePointsPerRow(value) {
    return Math.max(4, Math.min(25, parseInt(value, 10) || 15));
  }

  function normalizeGridTolerance(value) {
    var number = value === undefined || value === null || String(value).trim() === ""
      ? 1.0 : Number(value);
    if (!isFinite(number)) number = 1.0;
    return Math.max(-2, Math.min(10, Math.round(number * 10) / 10));
  }

  function graxpertCandidateOffsets(sampleSize) {
    return [
      [0,0], [-sampleSize,-sampleSize], [sampleSize,-sampleSize],
      [-sampleSize,sampleSize], [sampleSize,sampleSize]
    ];
  }

  function medianNumberList(values) {
    if (!values || !values.length) return 0;
    var sorted = values.slice(0).sort(function(a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function sampleLocalMedian(point, sampleSize, imageData, imageState) {
    if (!imageData || !imageState) return 0;
    var centerX = Math.round(point.x / Math.max(1, imageState.originalWidth - 1) *
      Math.max(1, imageData.width - 1));
    var centerY = Math.round(point.y / Math.max(1, imageState.originalHeight - 1) *
      Math.max(1, imageData.height - 1));
    var halfWidth = Math.max(1, Math.round(sampleSize / Math.max(1, imageState.originalWidth) * imageData.width));
    var halfHeight = Math.max(1, Math.round(sampleSize / Math.max(1, imageState.originalHeight) * imageData.height));
    var stride = Math.max(1, Math.floor(Math.max(halfWidth, halfHeight) / 12));
    var values = [];
    for (var y=Math.max(0, centerY - halfHeight); y<=Math.min(imageData.height - 1, centerY + halfHeight); y += stride) {
      for (var x=Math.max(0, centerX - halfWidth); x<=Math.min(imageData.width - 1, centerX + halfWidth); x += stride) {
        values.push(luminanceAt(imageData.data, (y * imageData.width + x) * 4));
      }
    }
    return medianNumberList(values);
  }

  function analysisGlobalMedian(selectionOnly) {
    if (!previewPixels) return previewLuminanceStats ? previewLuminanceStats.p50 : 0;
    if (!selectionOnly || !previewState || !previewState.hasSelection || !selectionMask) {
      return previewLuminanceStats ? previewLuminanceStats.p50 : 0;
    }
    var histogram = new Array(256);
    for (var hi=0; hi<256; hi++) histogram[hi] = 0;
    var totalPixels = previewPixels.width * previewPixels.height;
    var stride = Math.max(1, Math.ceil(Math.sqrt(totalPixels / 250000)));
    var count = 0;
    for (var y=0; y<previewPixels.height; y += stride) {
      var maskY = Math.round(y / Math.max(1, previewPixels.height - 1) * Math.max(1, selectionMask.height - 1));
      for (var x=0; x<previewPixels.width; x += stride) {
        var maskX = Math.round(x / Math.max(1, previewPixels.width - 1) * Math.max(1, selectionMask.width - 1));
        var maskAt = (maskY * selectionMask.width + maskX) * 4;
        if (selectionMask.data[maskAt] < 128) continue;
        var value = Math.max(0, Math.min(255, Math.round(
          luminanceAt(previewPixels.data, (y * previewPixels.width + x) * 4)
        )));
        histogram[value]++;
        count++;
      }
    }
    if (!count) return previewLuminanceStats ? previewLuminanceStats.p50 : 0;
    var target = Math.ceil(count / 2);
    var accumulated = 0;
    for (var bin=0; bin<256; bin++) {
      accumulated += histogram[bin];
      if (accumulated >= target) return bin;
    }
    return 255;
  }

  function gridToleranceStats(localMedians, globalMedian, tolerance) {
    var deviations = [];
    for (var i=0; i<localMedians.length; i++) {
      deviations.push(Math.abs(localMedians[i] - globalMedian));
    }
    var mad = medianNumberList(deviations);
    return {
      globalMedian: globalMedian,
      mad: mad,
      limit: globalMedian + normalizeGridTolerance(tolerance) * mad
    };
  }

  function analyzeSamplePoint(point, radius, imageData, stats, imageState, config) {
    if (!imageData || !stats || !imageState) return { status: "good", reason: "", score: 100 };
    config = config || getQualityConfig("standard");
    if (config.name === "off") {
      return {
        status:"good", reason:"추가 검사 끔 · Grid Tolerance 적용", score:100,
        mean:0, deviation:0, starFraction:0, coreContrast:0,
        smoothIllumination:false, qualityBypassed:true
      };
    }
    var maxOriginalX = Math.max(1, imageState.originalWidth - 1);
    var maxOriginalY = Math.max(1, imageState.originalHeight - 1);
    var centerX = Math.round(point.x / maxOriginalX * Math.max(1, imageData.width - 1));
    var centerY = Math.round(point.y / maxOriginalY * Math.max(1, imageData.height - 1));
    var radiusX = Math.max(2, Math.round(radius / imageState.originalWidth * imageData.width));
    var radiusY = Math.max(2, Math.round(radius / imageState.originalHeight * imageData.height));
    var stride = Math.max(1, Math.floor(Math.max(radiusX, radiusY) / 8));
    var count = 0, sum = 0, sumSquares = 0, veryBright = 0;
    var values = [];
    var normalizedRadii = [];
    var innerSum = 0, innerCount = 0, outerSum = 0, outerCount = 0;
    var hasBrightTail = stats.p95 > stats.p50 + 8;

    for (var y=Math.max(0, centerY - radiusY); y<=Math.min(imageData.height - 1, centerY + radiusY); y += stride) {
      for (var x=Math.max(0, centerX - radiusX); x<=Math.min(imageData.width - 1, centerX + radiusX); x += stride) {
        var dx = (x - centerX) / radiusX;
        var dy = (y - centerY) / radiusY;
        var normalizedRadius = dx * dx + dy * dy;
        if (normalizedRadius > 1) continue;
        var luminance = luminanceAt(imageData.data, (y * imageData.width + x) * 4);
        values.push(luminance);
        normalizedRadii.push(normalizedRadius);
        sum += luminance;
        sumSquares += luminance * luminance;
        if (hasBrightTail && luminance >= stats.p95) veryBright++;
        if (normalizedRadius <= 0.25) {
          innerSum += luminance;
          innerCount++;
        } else if (normalizedRadius >= 0.55) {
          outerSum += luminance;
          outerCount++;
        }
        count++;
      }
    }

    if (!count) return { status: "warning", reason: "분석 픽셀 부족", score: 50 };
    var mean = sum / count;
    var variance = Math.max(0, sumSquares / count - mean * mean);
    var deviation = Math.sqrt(variance);
    var brightFraction = veryBright / count;
    var sortedValues = values.slice(0).sort(function(a, b) { return a - b; });
    var median = sortedValues[Math.floor(sortedValues.length / 2)];
    var deviations = [];
    for (var vi=0; vi<values.length; vi++) deviations.push(Math.abs(values[vi] - median));
    deviations.sort(function(a, b) { return a - b; });
    var mad = deviations[Math.floor(deviations.length / 2)];
    var robustSigma = mad * 1.4826;
    var starThreshold = median + Math.max(10, robustSigma * 3);
    var starPixels = 0;
    for (var spi=0; spi<values.length; spi++) {
      if (values[spi] >= starThreshold) starPixels++;
    }
    var starFraction = starPixels / count;
    var innerMean = innerCount ? innerSum / innerCount : mean;
    var outerMean = outerCount ? outerSum / outerCount : median;
    var coreContrast = innerMean - outerMean;
    var coreThreshold = outerMean + Math.max(8, robustSigma * 1.5);
    var coreElevated = 0;
    for (var ci=0; ci<values.length; ci++) {
      if (normalizedRadii[ci] <= 0.25 && values[ci] >= coreThreshold) coreElevated++;
    }
    var coreElevatedFraction = innerCount ? coreElevated / innerCount : 0;
    var coreLimit = Math.max(config.coreMin, robustSigma * config.coreSigma);
    var smoothIllumination = starFraction < config.starWarning &&
      coreContrast < coreLimit * 0.7 && deviation < config.deviationWarning;

    function quality(status, reason) {
      var score = 100 - Math.min(35, starFraction * 240) -
        Math.min(35, Math.max(0, coreContrast) * 1.4) -
        Math.min(20, deviation * 0.35) - Math.min(10, mean / 25.5);
      score = Math.max(0, Math.min(100, Math.round(score)));
      if (status === "exclude") score = Math.min(score, 25);
      else if (status === "warning") score = Math.min(score, 65);
      return {
        status: status,
        reason: reason,
        score: score,
        mean: mean,
        deviation: deviation,
        starFraction: starFraction,
        coreContrast: coreContrast,
        smoothIllumination: smoothIllumination
      };
    }

    var excludeMean = (stats.p85 > stats.p50 + 8 ? stats.p85 : stats.p85 + 12) + config.meanAdjust;
    var warningMean = (stats.p70 > stats.p50 + 5 ? stats.p70 : stats.p70 + 8) + config.warningAdjust;
    if (coreContrast >= coreLimit &&
        coreElevatedFraction >= config.coreElevated) {
      return quality("exclude", "밝은 중심 구조");
    }
    if (starFraction >= config.starExclude && deviation >= 10) {
      return quality("exclude", "별 밀집 영역");
    }
    if (mean >= excludeMean || brightFraction >= config.brightExclude) {
      if (smoothIllumination) return quality("good", "부드러운 광해 배경");
      return quality("exclude", "밝은 영역");
    }
    if ((starFraction >= config.starWarning && deviation >= 7) ||
        coreContrast >= Math.max(config.coreMin * 0.7, robustSigma * config.coreSigma * 0.7)) {
      return quality("warning", starFraction >= config.starWarning ? "별 분포 주의" : "중심 구조 주의");
    }
    if (mean >= warningMean || brightFraction >= config.brightWarning || deviation >= config.deviationWarning) {
      if (smoothIllumination) return quality("good", "부드러운 광해 배경");
      return quality("warning", "밝기 편차");
    }
    return quality("good", "배경 후보");
  }

  function analyzeDiffuseStructure(point, radius, imageData, stats, imageState, config) {
    var clean = {
      status: "good", reason: "", score: 100,
      curvature: 0, texture: 0, colorCurvature: 0
    };
    if (!imageData || !stats || !imageState) return clean;
    config = config || getQualityConfig("standard");
    if (config.name === "off") return clean;

    var centerX = Math.round(point.x / Math.max(1, imageState.originalWidth - 1) *
      Math.max(1, imageData.width - 1));
    var centerY = Math.round(point.y / Math.max(1, imageState.originalHeight - 1) *
      Math.max(1, imageData.height - 1));
    var wantedX = Math.max(6, Math.round(radius * 3 / Math.max(1, imageState.originalWidth) * imageData.width));
    var wantedY = Math.max(6, Math.round(radius * 3 / Math.max(1, imageState.originalHeight) * imageData.height));
    var outerX = Math.min(wantedX, centerX, imageData.width - 1 - centerX);
    var outerY = Math.min(wantedY, centerY, imageData.height - 1 - centerY);
    if (outerX < 5 || outerY < 5) return clean;

    var gridSize = 5;
    var blockLuminance = [];
    var blockColor = [];
    for (var bi=0; bi<gridSize * gridSize; bi++) {
      blockLuminance[bi] = [];
      blockColor[bi] = [];
    }
    var xMin = centerX - outerX;
    var yMin = centerY - outerY;
    var spanX = outerX * 2 + 1;
    var spanY = outerY * 2 + 1;
    var stride = Math.max(1, Math.floor(Math.min(outerX, outerY) / 24));
    for (var sy=yMin; sy<=centerY + outerY; sy += stride) {
      var blockY = Math.min(gridSize - 1, Math.floor((sy - yMin) / spanY * gridSize));
      for (var sx=xMin; sx<=centerX + outerX; sx += stride) {
        var blockX = Math.min(gridSize - 1, Math.floor((sx - xMin) / spanX * gridSize));
        var pixelAt = (sy * imageData.width + sx) * 4;
        var red = imageData.data[pixelAt];
        var green = imageData.data[pixelAt + 1];
        var blue = imageData.data[pixelAt + 2];
        blockLuminance[blockY * gridSize + blockX].push(luminanceAt(imageData.data, pixelAt));
        blockColor[blockY * gridSize + blockX].push(
          Math.max(red, green, blue) - Math.min(red, green, blue)
        );
      }
    }

    var luminanceMedians = [];
    var colorMedians = [];
    var textureValues = [];
    var coordinates = [];
    for (var blockIndex=0; blockIndex<blockLuminance.length; blockIndex++) {
      if (!blockLuminance[blockIndex].length) continue;
      var blockMedian = medianNumberList(blockLuminance[blockIndex]);
      var blockDeviations = [];
      for (var valueIndex=0; valueIndex<blockLuminance[blockIndex].length; valueIndex++) {
        blockDeviations.push(Math.abs(blockLuminance[blockIndex][valueIndex] - blockMedian));
      }
      blockDeviations.sort(function(a, b) { return a - b; });
      luminanceMedians.push(blockMedian);
      colorMedians.push(medianNumberList(blockColor[blockIndex]));
      textureValues.push(blockDeviations[Math.floor((blockDeviations.length - 1) * 0.85)] || 0);
      coordinates.push({
        x: blockIndex % gridSize - 2,
        y: Math.floor(blockIndex / gridSize) - 2
      });
    }
    if (luminanceMedians.length < 20) return clean;

    function planeResidual(values) {
      var mean = 0;
      for (var mi=0; mi<values.length; mi++) mean += values[mi];
      mean /= values.length;
      var xx = 0, yy = 0, xz = 0, yz = 0;
      for (var fi=0; fi<values.length; fi++) {
        xx += coordinates[fi].x * coordinates[fi].x;
        yy += coordinates[fi].y * coordinates[fi].y;
        xz += coordinates[fi].x * (values[fi] - mean);
        yz += coordinates[fi].y * (values[fi] - mean);
      }
      var slopeX = xx ? xz / xx : 0;
      var slopeY = yy ? yz / yy : 0;
      var residuals = [];
      for (var ri=0; ri<values.length; ri++) {
        residuals.push(Math.abs(values[ri] -
          (mean + slopeX * coordinates[ri].x + slopeY * coordinates[ri].y)));
      }
      residuals.sort(function(a, b) { return a - b; });
      return residuals[Math.floor((residuals.length - 1) * 0.75)] || 0;
    }

    textureValues.sort(function(a, b) { return a - b; });
    var sceneRange = Math.max(8, (stats.p85 || 0) - (stats.p50 || 0));
    var sensitivity = config.name === "relaxed" ? 1.35 : config.name === "strict" ? 0.75 : 1;
    var curvature = planeResidual(luminanceMedians);
    var texture = textureValues[Math.floor((textureValues.length - 1) * 0.75)] || 0;
    var colorCurvature = planeResidual(colorMedians);
    var curvatureWarning = Math.max(1.5, sceneRange * 0.12) * sensitivity;
    var textureWarning = Math.max(2.5, sceneRange * 0.18) * sensitivity;
    var colorWarning = Math.max(2.0, sceneRange * 0.14) * sensitivity;
    var strength = Math.max(
      curvature / curvatureWarning,
      texture / textureWarning,
      colorCurvature / colorWarning
    );
    if (strength < 1) {
      clean.curvature = curvature;
      clean.texture = texture;
      clean.colorCurvature = colorCurvature;
      return clean;
    }
    return {
      status: strength >= 2 ? "exclude" : "warning",
      reason: strength >= 2 ? "확산 구조" : "확산 구조 주의",
      score: strength >= 2 ? 20 : 60,
      curvature: curvature,
      texture: texture,
      colorCurvature: colorCurvature
    };
  }

  function applyPointQuality(point) {
    var radius = Math.max(2, Math.min(200, parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var qualityStats = document.getElementById("selectionOnly").checked && previewSelectionLuminanceStats
      ? previewSelectionLuminanceStats : previewLuminanceStats;
    point.quality = analyzeSamplePoint(
      point, radius, previewPixels, qualityStats, previewState, currentQualityConfig()
    );
    var diffuse = analyzeDiffuseStructure(
      point, radius, previewPixels, qualityStats, previewState, currentQualityConfig()
    );
    point.quality.diffuseCurvature = diffuse.curvature;
    point.quality.diffuseTexture = diffuse.texture;
    point.quality.diffuseColorCurvature = diffuse.colorCurvature;
    if (currentQualityConfig().name === "off" && point.withinGridTolerance === false) {
      point.quality.status = "exclude";
      point.quality.reason = "Grid Tolerance 제외";
      point.quality.score = 0;
      return point;
    }
    if (point.quality.status !== "exclude" && diffuse.status === "exclude") {
      point.quality.status = "exclude";
      point.quality.reason = diffuse.reason;
      point.quality.score = Math.min(point.quality.score, diffuse.score);
    } else if (point.quality.status === "good" && diffuse.status === "warning") {
      // A low-strength curved signal is common in the very illumination
      // gradient that GraXpert must model. If the local sample is otherwise
      // smooth (no star/core/variance warning), keep it as a background point
      // and retain the diffuse result as diagnostic information. Strong
      // diffuse structure remains excluded above.
      if (point.quality.smoothIllumination) {
        point.quality.diffuseAdvisory = diffuse.reason;
        point.quality.reason = "부드러운 광해 배경";
      } else {
        point.quality.status = "warning";
        point.quality.reason = diffuse.reason;
        point.quality.score = Math.min(point.quality.score, diffuse.score);
      }
    }
    if (point.manualApproved) {
      point.quality.detectedStatus = point.quality.status;
      point.quality.detectedReason = point.quality.reason;
      point.quality.manualApproved = true;
      point.quality.status = "good";
      point.quality.reason = point.quality.detectedStatus === "good"
        ? "수동 승인 · " + (point.quality.detectedReason || "배경 후보")
        : "수동 승인 · 자동 검사: " + point.quality.detectedReason;
    }
    return point;
  }

  function refreshPointQualities() {
    for (var i=0; i<samplePoints.length; i++) applyPointQuality(samplePoints[i]);
  }

  function usableSamplePoints(goodOnly) {
    var usable = [];
    for (var i=0; i<samplePoints.length; i++) {
      var quality = samplePoints[i].quality;
      if (quality && quality.status === "exclude") continue;
      if (goodOnly && quality && quality.status !== "good") continue;
      usable.push(samplePoints[i]);
    }
    return usable;
  }

  function assessNeutralBalance(values, fullScale) {
    fullScale = Math.max(1, Number(fullScale) || 65535);
    var channels = values && values.length >= 3
      ? [Number(values[0]), Number(values[1]), Number(values[2])] : [0, 0, 0];
    var sorted = channels.slice().sort(function(a, b) { return a - b; });
    var target = sorted[1];
    var offsetsPercent = [
      (target - channels[0]) * 100 / fullScale,
      (target - channels[1]) * 100 / fullScale,
      (target - channels[2]) * 100 / fullScale
    ];
    var spreadPercent = (sorted[2] - sorted[0]) * 100 / fullScale;
    var label = spreadPercent < 0.1 ? "거의 중립" :
      spreadPercent < 0.3 ? "약한 편향" : "보정 권장";
    var recommendedStrength = spreadPercent < 0.1 ? 25 : spreadPercent < 0.3 ? 50 : 100;
    return {
      channels: channels,
      target: target,
      offsetsPercent: offsetsPercent,
      spreadPercent: spreadPercent,
      label: label,
      recommendedStrength: recommendedStrength
    };
  }

  function weightedMedianEntries(entries) {
    if (!entries.length) return 0;
    entries.sort(function(a, b) { return a.value - b.value; });
    var totalWeight = 0;
    for (var wi=0; wi<entries.length; wi++) totalWeight += entries[wi].weight;
    var accumulated = 0;
    for (var ei=0; ei<entries.length; ei++) {
      accumulated += entries[ei].weight;
      if (accumulated >= totalWeight / 2) return entries[ei].value;
    }
    return entries[entries.length - 1].value;
  }

  function estimateNeutralFromPreview(points, radius) {
    if (!previewPixels || !previewState || !points || !points.length) return null;
    var channelEntries = [[], [], []];
    var radiusX = Math.max(1, Math.round(radius / Math.max(1, previewState.originalWidth) * previewPixels.width));
    var radiusY = Math.max(1, Math.round(radius / Math.max(1, previewState.originalHeight) * previewPixels.height));
    var stride = Math.max(1, Math.floor(Math.max(radiusX, radiusY) / 12));
    for (var pointIndex=0; pointIndex<points.length; pointIndex++) {
      var point = points[pointIndex];
      var weight = neutralQualityWeight(point);
      if (weight <= 0) continue;
      var centerX = Math.round(point.x / Math.max(1, previewState.originalWidth - 1) *
        Math.max(1, previewPixels.width - 1));
      var centerY = Math.round(point.y / Math.max(1, previewState.originalHeight - 1) *
        Math.max(1, previewPixels.height - 1));
      var localValues = [[], [], []];
      for (var sy=Math.max(0, centerY - radiusY); sy<=Math.min(previewPixels.height - 1, centerY + radiusY); sy += stride) {
        for (var sx=Math.max(0, centerX - radiusX); sx<=Math.min(previewPixels.width - 1, centerX + radiusX); sx += stride) {
          var at = (sy * previewPixels.width + sx) * 4;
          localValues[0].push(previewPixels.data[at]);
          localValues[1].push(previewPixels.data[at + 1]);
          localValues[2].push(previewPixels.data[at + 2]);
        }
      }
      for (var channel=0; channel<3; channel++) {
        channelEntries[channel].push({ value:medianNumberList(localValues[channel]), weight:weight });
      }
    }
    if (!channelEntries[0].length) return null;
    return assessNeutralBalance([
      weightedMedianEntries(channelEntries[0]),
      weightedMedianEntries(channelEntries[1]),
      weightedMedianEntries(channelEntries[2])
    ], 255);
  }

  function signedPercent(value) {
    var number = Math.abs(value) < 0.0005 ? 0 : value;
    return (number > 0 ? "+" : "") + number.toFixed(3) + "%";
  }

  function clippingChannelText(counts, pixelCount) {
    var labels = ["R", "G", "B"];
    var parts = [];
    for (var channel=0; channel<3; channel++) {
      var count = counts && counts[channel] ? counts[channel] : 0;
      var rate = pixelCount ? count * 100 / pixelCount : 0;
      parts.push(labels[channel] + " " + count + " (" + rate.toFixed(3) + "%)");
    }
    return parts.join(" · ");
  }

  function neutralEstimateText(estimate) {
    if (!estimate) return "예상 보정값을 계산할 수 없습니다.";
    return "Preview 예상: " + estimate.label + " · 채널 차이 " +
      estimate.spreadPercent.toFixed(3) + "%p · 권장 Strength " +
      estimate.recommendedStrength + "%\nRGB 이동량: R " + signedPercent(estimate.offsetsPercent[0]) +
      " · G " + signedPercent(estimate.offsetsPercent[1]) +
      " · B " + signedPercent(estimate.offsetsPercent[2]);
  }

  function refreshNeutralReadyState() {
    if (mode !== "neutralize" || !previewState || previewState.mode !== "neutralize") return;
    var neutralPoints = usableSamplePoints(false);
    neutralAutoReady = neutralPoints.length >= 5;
    var radius = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    neutralEstimate = neutralAutoReady ? estimateNeutralFromPreview(neutralPoints, radius) : null;
    if (neutralEstimateStatus) {
      neutralEstimateStatus.textContent = neutralAutoReady
        ? neutralEstimateText(neutralEstimate)
        : "사용 가능한 Point가 5개 이상이면 예상 보정값을 표시합니다.";
    }
    var neutralStatus = document.getElementById("neutralAnalysisStatus");
    if (neutralStatus) {
      neutralStatus.textContent = neutralAutoReady
        ? "사용 가능한 Background 후보가 5개 이상입니다.\n" + neutralEstimateText(neutralEstimate)
        : "안전한 Background 후보가 5개 미만입니다. 포인트를 추가하거나 다시 분석하세요.";
    }
  }

  function chooseBestQualityCandidate(candidates) {
    for (var preferred=0; preferred<candidates.length; preferred++) {
      if (candidates[preferred].adaptiveOffset === 0 && candidates[preferred].quality &&
          candidates[preferred].quality.status === "good") {
        return candidates[preferred];
      }
    }
    var best = null;
    for (var i=0; i<candidates.length; i++) {
      var candidate = candidates[i];
      if (!candidate.quality || candidate.quality.status === "exclude") continue;
      if (!best || candidate.quality.score > best.quality.score) best = candidate;
    }
    return best;
  }

  function neutralQualityWeight(point) {
    var quality = point && point.quality ? point.quality : { status:"good", score:100 };
    if (quality.status === "exclude") return 0;
    return quality.status === "warning" ? 0.35 : 1;
  }

  function selectSpatialNeutralCandidates(candidates, maximum, width, height) {
    var available = [];
    for (var i=0; i<candidates.length; i++) {
      if (neutralQualityWeight(candidates[i]) > 0) available.push(candidates[i]);
    }
    maximum = Math.max(1, Math.round(Number(maximum) || 20));
    if (available.length <= maximum) return available;
    var selectedPoints = [];
    var diagonal = Math.max(1, Math.sqrt(width * width + height * height));

    while (available.length && selectedPoints.length < maximum) {
      var bestIndex = 0;
      var bestValue = -Infinity;
      for (var candidateIndex=0; candidateIndex<available.length; candidateIndex++) {
        var candidate = available[candidateIndex];
        var quality = candidate.quality || { score:100 };
        var qualityScore = neutralQualityWeight(candidate) *
          (0.5 + Math.max(0, Math.min(100, Number(quality.score) || 0)) / 200);
        var spacingScore = 1;
        if (selectedPoints.length) {
          var nearest = Infinity;
          for (var chosenIndex=0; chosenIndex<selectedPoints.length; chosenIndex++) {
            var dx = candidate.x - selectedPoints[chosenIndex].x;
            var dy = candidate.y - selectedPoints[chosenIndex].y;
            nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
          }
          spacingScore = Math.min(1, nearest / diagonal * 4);
        }
        var combined = qualityScore * 0.7 + spacingScore * 0.3;
        if (combined > bestValue) {
          bestValue = combined;
          bestIndex = candidateIndex;
        }
      }
      selectedPoints.push(available.splice(bestIndex, 1)[0]);
    }
    return selectedPoints;
  }

  function drawSampleCanvas(targetCanvas, availableWidth, maxHeight) {
    if (!targetCanvas || !targetCanvas.getContext || !previewImage || !previewState) return null;
    var displaySize = calculateCanvasSize(
      previewState.previewWidth,
      previewState.previewHeight,
      availableWidth,
      maxHeight
    );
    targetCanvas.style.width = displaySize.width + "px";
    targetCanvas.style.height = displaySize.height + "px";
    if (targetCanvas.width !== displaySize.width) targetCanvas.width = displaySize.width;
    if (targetCanvas.height !== displaySize.height) targetCanvas.height = displaySize.height;
    var ctx = targetCanvas.getContext("2d");
    ctx.drawImage(previewDisplayCanvas || previewImage, 0, 0, targetCanvas.width, targetCanvas.height);

    ctx.lineWidth = 2;
    ctx.font = "11px Segoe UI";
    for (var i=0; i<samplePoints.length; i++) {
      var sampleBounds = sampleBoundsOnCanvas(samplePoints[i], targetCanvas);
      var qualityStatus = samplePoints[i].quality ? samplePoints[i].quality.status : "good";
      ctx.strokeStyle = qualityStatus === "exclude"
        ? "#eb4c4c" : qualityStatus === "warning" ? "#f4a634" : "#34c76a";
      ctx.strokeRect(
        sampleBounds.left,
        sampleBounds.top,
        sampleBounds.right - sampleBounds.left,
        sampleBounds.bottom - sampleBounds.top
      );
    }
    return displaySize;
  }

  function sampleBoundsOnCanvas(point, targetCanvas) {
    var center = originalToCanvas(point, targetCanvas);
    var sampleSize = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var scaleX = Math.max(1, targetCanvas.width - 1) /
      Math.max(1, previewState.originalWidth - 1);
    var scaleY = Math.max(1, targetCanvas.height - 1) /
      Math.max(1, previewState.originalHeight - 1);
    return {
      left: center.x - sampleSize * scaleX,
      top: center.y - sampleSize * scaleY,
      right: center.x + sampleSize * scaleX,
      bottom: center.y + sampleSize * scaleY
    };
  }

  function drawSampleEditor() {
    if (!sampleCanvas || !previewImage || !previewState) return;
    var availableWidth = sampleCanvasWrap && sampleCanvasWrap.clientWidth
      ? Math.max(1, sampleCanvasWrap.clientWidth - 2)
      : previewState.previewWidth;
    drawSampleCanvas(sampleCanvas, availableWidth, 360);
    refreshNeutralReadyState();
    sampleEditorRevision++;
    updateSampleCount();
    dispatchSampleEditorState();
  }

  function mapClientPoint(clientX, clientY, rect, canvasWidth, canvasHeight) {
    var rectWidth = Math.max(1, rect.width);
    var rectHeight = Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(canvasWidth - 1, (clientX - rect.left) * canvasWidth / rectWidth)),
      y: Math.max(0, Math.min(canvasHeight - 1, (clientY - rect.top) * canvasHeight / rectHeight)),
      scaleX: canvasWidth / rectWidth,
      scaleY: canvasHeight / rectHeight
    };
  }

  function canvasPosition(event, targetCanvas) {
    targetCanvas = targetCanvas || sampleCanvas;
    var rect = targetCanvas.getBoundingClientRect();
    return mapClientPoint(event.clientX, event.clientY, rect, targetCanvas.width, targetCanvas.height);
  }

  function canvasToOriginal(pos, targetCanvas) {
    targetCanvas = targetCanvas || sampleCanvas;
    return {
      x: Math.max(0, Math.min(previewState.originalWidth - 1,
        Math.round(pos.x / Math.max(1, targetCanvas.width - 1) * Math.max(1, previewState.originalWidth - 1)))),
      y: Math.max(0, Math.min(previewState.originalHeight - 1,
        Math.round(pos.y / Math.max(1, targetCanvas.height - 1) * Math.max(1, previewState.originalHeight - 1))))
    };
  }

  function maskAllowsCoordinate(x, y) {
    if (!previewState || !previewState.hasSelection || !selectionMask) return true;
    var mx = Math.max(0, Math.min(selectionMask.width - 1,
      Math.round(x / Math.max(1, previewState.originalWidth - 1) * Math.max(1, selectionMask.width - 1))));
    var my = Math.max(0, Math.min(selectionMask.height - 1,
      Math.round(y / Math.max(1, previewState.originalHeight - 1) * Math.max(1, selectionMask.height - 1))));
    var at = (my * selectionMask.width + mx) * 4;
    return selectionMask.data[at] >= 128;
  }

  function maskAllowsPoint(point, radius) {
    if (!previewState || !previewState.hasSelection || !selectionMask) return true;
    // Check the complete sample footprint on a 5x5 grid. Corners, axes and
    // center alone can miss a narrow foreground edge or a hole in a selection.
    var checks = [];
    for (var gridY=-2; gridY<=2; gridY++) {
      for (var gridX=-2; gridX<=2; gridX++) {
        checks.push([
          Math.round(radius * gridX / 2),
          Math.round(radius * gridY / 2)
        ]);
      }
    }
    for (var i=0; i<checks.length; i++) {
      if (!maskAllowsCoordinate(point.x + checks[i][0], point.y + checks[i][1])) return false;
    }
    return true;
  }

  function addSamplePointOriginal(point) {
    if (!previewState || !previewImage || !point) return false;
    point = {
      x: Math.max(0, Math.min(previewState.originalWidth - 1, Math.round(Number(point.x) || 0))),
      y: Math.max(0, Math.min(previewState.originalHeight - 1, Math.round(Number(point.y) || 0))),
      manualApproved: true
    };
    var radius = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    if (point.x < radius || point.y < radius ||
        point.x >= previewState.originalWidth - radius ||
        point.y >= previewState.originalHeight - radius) {
      showError("Sample Point 영역이 이미지 경계를 벗어납니다.");
      return false;
    }
    if (document.getElementById("selectionOnly").checked) {
      if (!previewState.hasSelection || !selectionMask) {
        showError("Photoshop 선택 영역을 다시 불러온 후 Point를 추가하세요.");
        return false;
      }
      if (!maskAllowsPoint(point, radius)) {
        showError("선택 영역 안에 Sample Point 전체가 포함되어야 합니다.");
        return false;
      }
    }
    for (var pi=0; pi<samplePoints.length; pi++) {
      var pdx = samplePoints[pi].x - point.x;
      var pdy = samplePoints[pi].y - point.y;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < 3) return false;
    }
    samplePoints.push(applyPointQuality(point));
    drawSampleEditor();
    return true;
  }

  function addSamplePointAt(targetCanvas, pos) {
    if (!previewState || !previewImage) return false;
    return addSamplePointOriginal(canvasToOriginal(pos, targetCanvas));
  }

  function moveSamplePointOriginal(index, point) {
    index = parseInt(index, 10);
    if (!previewState || !previewImage || index < 0 || index >= samplePoints.length) return false;
    var radius = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var nextPoint = {
      x:Math.max(0, Math.min(previewState.originalWidth - 1, Math.round(Number(point.x) || 0))),
      y:Math.max(0, Math.min(previewState.originalHeight - 1, Math.round(Number(point.y) || 0))),
      manualApproved:true
    };
    function reject(message) {
      sampleEditorNotice = message;
      showError(message);
      sampleEditorRevision++;
      dispatchSampleEditorState();
      return false;
    }
    if (nextPoint.x < radius || nextPoint.y < radius ||
        nextPoint.x >= previewState.originalWidth - radius ||
        nextPoint.y >= previewState.originalHeight - radius) {
      return reject("이동할 Sample Point 영역이 이미지 경계를 벗어납니다.");
    }
    if (document.getElementById("selectionOnly").checked &&
        (!previewState.hasSelection || !selectionMask || !maskAllowsPoint(nextPoint, radius))) {
      return reject("Sample Point 전체가 Photoshop 선택 영역 안에 있어야 합니다.");
    }
    for (var pi=0; pi<samplePoints.length; pi++) {
      if (pi === index) continue;
      var dx = samplePoints[pi].x - nextPoint.x;
      var dy = samplePoints[pi].y - nextPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) < 3) {
        return reject("다른 Sample Point와 너무 가까운 위치입니다.");
      }
    }
    samplePoints[index] = applyPointQuality(nextPoint);
    var quality = samplePoints[index].quality || { status:"good", reason:"배경 후보" };
    sampleEditorNotice = "Point 이동 완료 · " +
      (quality.status === "good" ? "적합" : quality.status === "warning" ? "주의" : "제외") +
      " · " + quality.reason;
    drawSampleEditor();
    return true;
  }

  function removeNearestSampleAt(targetCanvas, pos) {
    if (!previewState || !samplePoints.length) return false;
    var original = canvasToOriginal(pos, targetCanvas);
    var sampleSize = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var nearest = -1;
    var nearestDistance = Infinity;
    for (var i=0; i<samplePoints.length; i++) {
      var dx = Math.abs(samplePoints[i].x - original.x);
      var dy = Math.abs(samplePoints[i].y - original.y);
      var distance = Math.max(dx, dy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    if (nearest < 0 || nearestDistance > sampleSize) return false;
    samplePoints.splice(nearest, 1);
    if (mode === "background" && !samplePoints.length) gradientGridDirty = false;
    drawSampleEditor();
    return true;
  }

  function samplePointInfoAt(targetCanvas, pos) {
    if (!previewState || !samplePoints.length) return "Point 위에 마우스를 올리면 판정 사유를 표시합니다.";
    var nearestPoint = null;
    var nearestDistance = Infinity;
    var original = canvasToOriginal(pos, targetCanvas);
    var sampleSize = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    for (var qi=0; qi<samplePoints.length; qi++) {
      var qdx = Math.abs(samplePoints[qi].x - original.x);
      var qdy = Math.abs(samplePoints[qi].y - original.y);
      var qdistance = Math.max(qdx, qdy);
      if (qdistance < nearestDistance) {
        nearestDistance = qdistance;
        nearestPoint = samplePoints[qi];
      }
    }
    if (nearestPoint && nearestDistance <= sampleSize) {
      var qualityInfo = nearestPoint.quality || { status: "good", reason: "배경 후보" };
      return "Point 품질: " + qualityInfo.reason +
        " · 점수 " + (qualityInfo.score === undefined ? "-" : qualityInfo.score) +
        " · 원본 좌표 " + nearestPoint.x + ", " + nearestPoint.y;
    }
    return "Point 위에 마우스를 올리면 판정 사유를 표시합니다.";
  }

  if (sampleCanvas) {
    sampleCanvas.onclick = function(event) {
      addSamplePointAt(sampleCanvas, canvasPosition(event, sampleCanvas));
    };

    sampleCanvas.oncontextmenu = function(event) {
      event.preventDefault();
      removeNearestSampleAt(sampleCanvas, canvasPosition(event, sampleCanvas));
      return false;
    };

    sampleCanvas.onmousemove = function(event) {
      if (pointQualityStatus) pointQualityStatus.textContent =
        samplePointInfoAt(sampleCanvas, canvasPosition(event, sampleCanvas));
    };

    sampleCanvas.onmouseleave = function() {
      if (pointQualityStatus) {
        pointQualityStatus.textContent = "Point 위에 마우스를 올리면 판정 사유를 표시합니다.";
      }
    };
  }

  if (window.addEventListener) {
    window.addEventListener("resize", function() {
      if (previewState && previewImage) drawSampleEditor();
    });
  }

  function openSampleEditorWindow(editorMode) {
    var config = editorConfig(editorMode);
    var openedAt = Date.now();
    if (openedAt - lastSampleEditorOpenAt[editorMode] < 700) return;
    lastSampleEditorOpenAt[editorMode] = openedAt;
    try {
      if (window.__adobe_cep__ && window.__adobe_cep__.requestOpenExtension) {
        window.__adobe_cep__.requestOpenExtension(config.extensionId, "");
        activateSampleEditorWhenReady(editorMode, openedAt, 0);
        return;
      }
      var existingWindow = editorMode === "neutralize" ? neutralEditorWindow : sampleEditorWindow;
      if (existingWindow && !existingWindow.closed) {
        existingWindow.focus();
        return;
      }
      var openedWindow = window.open(
        config.html,
        config.windowName,
        "width=1100,height=800,resizable=yes,scrollbars=no"
      );
      if (editorMode === "neutralize") neutralEditorWindow = openedWindow;
      else sampleEditorWindow = openedWindow;
      if (!openedWindow) {
        showError((editorMode === "neutralize" ? "Neutralise" : "Gradient") +
          " Editor 창을 열 수 없습니다. CEP 팝업 허용 상태를 확인하세요.");
      }
    } catch (windowError) {
      showError((editorMode === "neutralize" ? "Neutralise" : "Gradient") +
        " Editor 창 열기 실패: " + windowError.message);
    }
  }

  function prepareCurrentLayerAndOpenEditor(editorMode) {
    if (pendingOpenSampleEditor) return;
    pendingOpenSampleEditor = true;
    if (editorMode === "neutralize") document.getElementById("neutralAnalyze").onclick();
    else document.getElementById("preparePreview").onclick();
  }

  function openLargeSampleEditor() {
    clearMsg();
    var editorMode = mode === "neutralize" ? "neutralize" : "background";
    if (!previewState || !previewImage || previewState.mode !== editorMode) {
      prepareCurrentLayerAndOpenEditor(editorMode);
      return;
    }
    if (editorMode !== "background") {
      openSampleEditorWindow(editorMode);
      return;
    }
    if (sampleEditorContextCheckPending) return;
    sampleEditorContextCheckPending = true;
    var checkedPreview = previewState;
    evalPS("GX_getActiveContextIdentity(true)", function(contextError, contextResult) {
      sampleEditorContextCheckPending = false;
      if (mode !== "background") return;
      if (previewState !== checkedPreview) {
        openLargeSampleEditor();
        return;
      }
      if (contextError || !contextResult || contextResult.indexOf("OK|") !== 0) {
        showError("Gradient Editor 처리 레이어 확인 실패:\n" +
          (contextError || contextResult || "알 수 없는 오류"));
        return;
      }
      var currentIdentity = parseActiveContextIdentity(contextResult);
      var previewMatchesCurrentLayer = previewMatchesContext(checkedPreview, currentIdentity, true);
      if (!previewMatchesCurrentLayer) {
        resetSamplePreview();
        showOk("현재 레이어가 변경되어 Gradient Preview를 새로 생성합니다.");
        prepareCurrentLayerAndOpenEditor(editorMode);
        return;
      }
      samplePreviewContextOutdated = false;
      samplePreviewContextMessage = "";
      openSampleEditorWindow(editorMode);
    });
  }

  document.getElementById("openSampleWindow").onmousedown = function(event) {
    if (!event || event.button === 0) openLargeSampleEditor();
  };
  document.getElementById("openSampleWindow").onclick = openLargeSampleEditor;

  document.getElementById("undoSample").onclick = function(){
    if (samplePoints.length) samplePoints.pop();
    if (mode === "background" && !samplePoints.length) gradientGridDirty = false;
    drawSampleEditor();
  };

  document.getElementById("clearSamples").onclick = function(){
    samplePoints = [];
    if (mode === "background") gradientGridDirty = false;
    neutralAutoReady = false;
    drawSampleEditor();
  };

  document.getElementById("sampleSize").onchange = function(){
    refreshPointQualities();
    drawSampleEditor();
  };

  document.getElementById("pointsPerRow").onchange = function(){
    this.value = normalizePointsPerRow(this.value);
    if (mode === "background") gradientGridDirty = samplePoints.length > 0;
    sampleEditorRevision++;
    dispatchSampleEditorState();
  };

  document.getElementById("gridTolerance").onchange = function(){
    this.value = normalizeGridTolerance(this.value).toFixed(1);
    if (mode === "background") gradientGridDirty = samplePoints.length > 0;
    sampleEditorRevision++;
    dispatchSampleEditorState();
  };

  document.getElementById("selectionOnly").onchange = function() {
    if (mode === "neutralize") this.checked = !!(previewState && previewState.hasSelection);
    sampleEditorRevision++;
    updateSampleScopeStatus();
    dispatchSampleEditorState();
  };

  function applyQualityPresetChange(value) {
    if (value) setSelectedValue("qualityPreset", value);
    if (!previewState) {
      sampleEditorRevision++;
      dispatchSampleEditorState();
      return;
    }

    // Quality presets participate in automatic candidate selection. Reclassifying
    // the old grid in place can make excluded points appear to jump to a different
    // part of the image, especially when switching to Grid-only mode. Rebuild the
    // automatic grid with the new criteria, while preserving user-approved points.
    if (mode === "background" && samplePoints.length) {
      var manualPoints = [];
      var hasAutomaticPoints = false;
      for (var pointIndex=0; pointIndex<samplePoints.length; pointIndex++) {
        if (samplePoints[pointIndex].manualApproved) manualPoints.push(samplePoints[pointIndex]);
        else hasAutomaticPoints = true;
      }
      if (hasAutomaticPoints) {
        var regenerated = generateAutomaticSamplePoints({
          selectionOnly: document.getElementById("selectionOnly").checked
        });
        if (regenerated) {
          var automaticPoints = samplePoints.slice(0);
          for (var manualIndex=0; manualIndex<manualPoints.length; manualIndex++) {
            var manualPoint = applyPointQuality(manualPoints[manualIndex]);
            for (var automaticIndex=automaticPoints.length - 1; automaticIndex>=0; automaticIndex--) {
              var dx = automaticPoints[automaticIndex].x - manualPoint.x;
              var dy = automaticPoints[automaticIndex].y - manualPoint.y;
              if (Math.sqrt(dx * dx + dy * dy) < 3) automaticPoints.splice(automaticIndex, 1);
            }
            automaticPoints.push(manualPoint);
          }
          samplePoints = automaticPoints;
          gradientGridDirty = false;
          sampleEditorNotice = "품질 기준 변경 · 자동 Point 다시 생성 · 수동 Point " +
            manualPoints.length + "개 유지";
          drawSampleEditor();
          showOk((selected("qualityPreset") === "off"
            ? "추가 품질 검사를 끄고 Grid Tolerance만 적용했습니다."
            : "새 품질 기준으로 자동 Point를 다시 생성했습니다.") +
            (manualPoints.length ? "\n수동 승인 Point " + manualPoints.length + "개를 유지했습니다." : ""));
          return;
        }
      }
    }

    refreshPointQualities();
    drawSampleEditor();
    showOk(selected("qualityPreset") === "off"
      ? "추가 품질 검사를 끄고 Grid Tolerance만 적용했습니다."
      : "품질 분석 강도를 변경하고 기존 수동 Point를 다시 분석했습니다.");
  }

  var qualityPresetInputs = document.querySelectorAll('input[name="qualityPreset"]');
    for (var qpi=0; qpi<qualityPresetInputs.length; qpi++) {
    qualityPresetInputs[qpi].onchange = function() {
      applyQualityPresetChange(selected("qualityPreset"));
    };
  }

  document.getElementById("stretchPreset").onchange = function() {
    if (!previewState || !previewPixels) return;
    refreshPreviewStretch();
    showOk("Preview Stretch를 변경했습니다. 품질 분석과 원본 데이터는 변경되지 않습니다.");
  };

  document.getElementById("previewSaturation").oninput = function() {
    var saturation = normalizeSaturation(this.value);
    document.getElementById("previewSaturationValue").textContent = saturation.toFixed(1);
    if (previewState && previewPixels) refreshPreviewStretch();
  };

  document.getElementById("previewSaturation").onchange = function() {
    showOk("Preview Saturation을 변경했습니다. 품질 분석과 원본 데이터는 변경되지 않습니다.");
  };

  document.getElementById("neutralStrength").oninput = function() {
    var neutralAmount = normalizeNeutralStrength(this.value);
    document.getElementById("neutralStrengthValue").textContent = Math.round(neutralAmount) + "%";
  };

  document.getElementById("neutralAnalyze").onclick = function() {
    clearMsg();
    pendingNeutralAutoAnalysis = true;
    neutralAutoReady = false;
    document.getElementById("selectionOnly").checked = document.getElementById("neutralSkyOnly").checked;
    document.getElementById("preparePreview").onclick();
  };

  function neutralScopeChanged() {
    resetSamplePreview();
    refreshNeutralMaskStatus();
    updateSampleScopeStatus();
  }
  document.getElementById("neutralSkyOnly").onchange = neutralScopeChanged;
  document.getElementById("neutralScopeLayer").onchange = neutralScopeChanged;

  var neutralScopeInputs = document.querySelectorAll('input[name="neutralScope"]');
  for (var neutralScopeIndex=0; neutralScopeIndex<neutralScopeInputs.length; neutralScopeIndex++) {
    (function(neutralScopeInput) {
      var neutralScopeLabel = neutralScopeInput.parentNode;
      if (!neutralScopeLabel) return;
      neutralScopeLabel.onmouseenter = function() {
        setNeutralMaskStatus(neutralScopeLabel.getAttribute("data-description") || "", "");
      };
      neutralScopeLabel.onmouseleave = refreshNeutralMaskStatus;
      neutralScopeInput.onfocus = function() {
        setNeutralMaskStatus(neutralScopeLabel.getAttribute("data-description") || "", "");
      };
      neutralScopeInput.onblur = refreshNeutralMaskStatus;
    }(neutralScopeInputs[neutralScopeIndex]));
  }

  document.getElementById("neutralizeActiveLayer").onclick = function() {
    clearMsg();
    if (!fs || !os || !path) {
      showError("Node.js 모듈을 사용할 수 없습니다. CEP 설정을 확인하세요.");
      return;
    }
    if (!previewState || !neutralAutoReady) {
      showError("먼저 배경 분석을 실행하고 사용할 수 있는 Point를 5개 이상 준비하세요.");
      return;
    }
    var neutralPoints = usableSamplePoints(false);
    if (neutralPoints.length < 5) {
      neutralAutoReady = false;
      showError("사용 가능한 Background Reference Point가 5개 미만입니다.");
      return;
    }

    var neutralStrength = normalizeNeutralStrength(document.getElementById("neutralStrength").value);
    var neutralSkyOnly = document.getElementById("neutralSkyOnly").checked;
    var neutralRadius = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var stamp = Date.now();
    var neutralWorkdir = path.join(os.tmpdir(), "GraXpert_Photoshop");
    var neutralInput = path.join(neutralWorkdir, "neutral_input_" + stamp + ".tif");
    var neutralOutput = path.join(neutralWorkdir, "neutral_output_" + stamp + ".tif");
    try {
      if (!fs.existsSync(neutralWorkdir)) fs.mkdirSync(neutralWorkdir, { recursive:true });
    } catch (folderError) {
      showError("Neutralisation 임시 폴더 생성 실패: " + folderError.message);
      return;
    }

    setBusy(true, "Background Neutralisation 준비 중…");
    setProgress(10, "현재 레이어 확인 중…");
    evalPS("GX_getActiveLayerInfo()", function(infoError, infoResult) {
      if (infoError || !infoResult || infoResult.indexOf("OK|") !== 0) {
        setBusy(false);
        showError("현재 레이어 확인 실패:\n" + (infoError || infoResult || "알 수 없는 오류"));
        return;
      }
      var infoParts = infoResult.split("|");
      var expectedDocId = parseInt(infoParts[1], 10);
      var sourceLayerId = parseInt(infoParts[2], 10);
      var hasSourceBits = !!(infoParts[3] && /^B:(0|8|16|32)$/.test(infoParts[3]));
      var sourceBits = hasSourceBits ? parseInt(infoParts[3].substring(2), 10) : 0;
      var sourceLayerName = "Layer";
      var sourceNameIndex = hasSourceBits ? 4 : 3;
      try { sourceLayerName = decodeURIComponent(infoParts.slice(sourceNameIndex).join("|")); } catch (_) {}
      if (expectedDocId !== previewState.docId || sourceLayerId !== previewState.sourceLayerId) {
        setBusy(false);
        showError("Reference Point를 만든 Photoshop 문서 또는 현재 레이어가 변경되었습니다. Preview를 다시 준비하세요.");
        return;
      }

      setProgress(25, sourceBits === 32
        ? "현재 레이어를 32-bit float TIFF로 준비 중…"
        : "현재 레이어를 16-bit TIFF로 준비 중…");
      evalPS(
        'GX_exportInput("' + escJs(neutralInput) + '","' +
          (neutralSkyOnly ? "layer-sky" : "layer") + '","' + escJs(previewState.scope) + '",true)',
        function(exportError, exportResult) {
          if (exportError || !exportResult || exportResult.indexOf("OK|") !== 0) {
            setBusy(false);
            showError("현재 레이어 내보내기 실패:\n" + (exportError || exportResult || "알 수 없는 오류"));
            return;
          }
          var exportInfo;
          try { exportInfo = parsePhotoshopExport(exportResult); }
          catch (parseError) {
            setBusy(false);
            safeDelete(neutralInput);
            showError("현재 레이어 내보내기 정보 오류:\n" + parseError.message);
            return;
          }
          var docId = exportInfo.docId;
          var docName = exportInfo.docName;
          var maskToken = exportInfo.maskToken;
          var neutralContextError = previewContextError(
            previewState, exportInfo, "neutralize",
            neutralSkyOnly ? "layer-sky" : "layer-auto"
          );
          if (neutralContextError) {
            setBusy(false);
            safeDelete(neutralInput);
            discardPhotoshopMask(docId, maskToken);
            showError(neutralContextError);
            return;
          }

          setProgress(60, "Reference Point RGB 중앙값과 Neutral Gray 계산 중…");
          var neutralResult;
          try {
            neutralResult = neutralizeGeneratedTiff(
              neutralInput, neutralOutput, neutralPoints, neutralRadius, neutralStrength,
              { colorReject: true, minimumPoints: 5 }
            );
          } catch (neutralError) {
            setBusy(false);
            discardPhotoshopMask(docId, maskToken);
            showError(
              "Background Neutralisation 실패:\n" + neutralError.message +
              "\n진단용 입력 파일을 보존했습니다:\n" + neutralInput
            );
            return;
          }

          var strengthLabel = neutralStrength < 100 ? " " + Math.round(neutralStrength) + "%" : "";
          var neutralLayerName = sourceLayerName + " - Background Neutralised" + strengthLabel +
            (neutralSkyOnly ? " - Sky" : "");
          setProgress(88, "Background Neutralised 레이어를 Photoshop에 추가 중…");
          evalPS(
            'GX_importResultById("' + escJs(neutralOutput) + '",' +
            docId + ',"' + escJs(docName) + '","' + escJs(neutralLayerName) +
            '","' + escJs(maskToken) + '",' + sourceLayerId + ')',
            function(importError, importResult) {
              setBusy(false);
              if (importError || importResult !== "OK") {
                discardPhotoshopMask(docId, maskToken);
                showError(
                  "Background Neutralised 레이어 가져오기 실패:\n" +
                  (importError || importResult || "알 수 없는 오류") +
                  "\n임시 파일은 진단을 위해 보존했습니다."
                );
                return;
              }
              safeDelete(neutralInput);
              safeDelete(neutralOutput);
              setProgress(100, "완료");
              document.getElementById("progressWrap").className = "progress-wrap";
              function percent(value) {
                return (value * 100 / neutralResult.fullScale).toFixed(3) + "%";
              }
              var actualBalance = assessNeutralBalance(
                neutralResult.background, neutralResult.fullScale
              );
              var appliedOffsetsPercent = [
                neutralResult.offsets[0] * 100 / neutralResult.fullScale,
                neutralResult.offsets[1] * 100 / neutralResult.fullScale,
                neutralResult.offsets[2] * 100 / neutralResult.fullScale
              ];
              var clippedTotal = neutralResult.clippedLowTotal + neutralResult.clippedHighTotal;
              var clippedRate = neutralResult.pixelCount
                ? clippedTotal * 100 / (neutralResult.pixelCount * 3) : 0;
              showOk(
                "완료: `" + neutralLayerName + "` 레이어를 추가했습니다.\n" +
                "Background RGB: " + percent(neutralResult.background[0]) + " / " +
                  percent(neutralResult.background[1]) + " / " + percent(neutralResult.background[2]) +
                  " → " + percent(neutralResult.target) + "\n" +
                "보정 필요도: " + actualBalance.label + " · 채널 차이 " +
                  actualBalance.spreadPercent.toFixed(3) + "%p · 권장 Strength " +
                  actualBalance.recommendedStrength + "%\n" +
                "적용 RGB 이동량: R " + signedPercent(appliedOffsetsPercent[0]) +
                  " · G " + signedPercent(appliedOffsetsPercent[1]) +
                  " · B " + signedPercent(appliedOffsetsPercent[2]) + "\n" +
                "Reference: Auto/Edit · " + neutralResult.pointCount +
                  " points · " + neutralResult.samples + " pixels\n" +
                (neutralResult.rejectedColorCount
                  ? "RGB 색상 이상치 제외: " + neutralResult.rejectedColorCount + " points\n" : "") +
                (neutralResult.clippedLowTotal || neutralResult.clippedHighTotal
                  ? (neutralResult.rangeExcursionsPreserved
                    ? "0..1 범위 밖 값(32-bit 보존): 전체 채널 값의 "
                    : "클리핑 경고: 전체 채널 값의 ") + clippedRate.toFixed(3) + "%\n" +
                    "0 미만: " + clippingChannelText(neutralResult.clippedLow, neutralResult.pixelCount) + "\n" +
                    "최대값 초과: " + clippingChannelText(neutralResult.clippedHigh, neutralResult.pixelCount) + "\n" : "") +
                (neutralSkyOnly && clippedTotal
                  ? "참고: 위 범위/클리핑 통계는 마스크 밖 영역을 포함한 처리 버퍼 전체 기준입니다.\n" : "") +
                (neutralResult.outputBits === 32
                  ? "정밀도: 32-bit float 데이터를 유지해 처리했습니다.\n"
                  : (sourceBits === 32
                    ? "정밀도 경고: 32-bit 원본이 16-bit 처리 경로로 변경되었습니다.\n" : "")) +
                (neutralResult.iccProfilePreserved
                  ? "색상 프로파일: 입력 TIFF의 ICC 프로파일을 유지했습니다.\n"
                  : "색상 프로파일: 입력 TIFF에 내장 ICC 프로파일이 없습니다.\n") +
                (neutralSkyOnly ? "지정 영역 레이어 마스크를 적용했습니다.\n" : "") +
                "선택했던 선형 레이어는 변경하지 않았습니다."
              );
              setTimeout(function(){
                document.getElementById("progressWrap").className = "progress-wrap hidden";
              }, 2500);
            }
          );
        }
      );
    });
  };

  function generateAutomaticSamplePoints(options) {
    options = options || {};
    if (!previewState) {
      showError("먼저 포인트 자동 생성으로 Preview를 준비하세요.");
      return null;
    }
    var radius = Math.max(2, Math.min(200, parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var selectionOnly = options.selectionOnly === undefined
      ? document.getElementById("selectionOnly").checked
      : !!options.selectionOnly;
    if (selectionOnly && !previewState.hasSelection) {
      showError(
        "Photoshop 선택 영역이 감지되지 않았습니다.\n" +
        "하늘을 선택한 뒤 포인트 자동 생성을 다시 실행하세요.\n" +
        "전체 Preview에 생성하려면 선택 영역 제한을 해제하세요."
      );
      neutralAutoReady = false;
      return null;
    }
    var generated = [];
    var unavailableCells = 0;
    var relocatedCells = 0;
    var gridRejectedCells = 0;
    var smoothLightPollutionAccepted = 0;
    var columns = normalizePointsPerRow(document.getElementById("pointsPerRow").value);
    var gridSpacing = previewState.originalWidth / columns;
    var tolerance = normalizeGridTolerance(document.getElementById("gridTolerance").value);
    var goodOnly = options.goodOnly === undefined ? !options.neutral : !!options.goodOnly;
    var yStart = 0.5 * (previewState.originalHeight % gridSpacing);
    var candidateOffsets = graxpertCandidateOffsets(radius);
    var gridCells = [];
    for (var gridY=yStart; gridY<previewState.originalHeight; gridY += gridSpacing) {
      for (var gx=0; gx<columns; gx++) {
        var candidates = [];
        for (var oi=0; oi<candidateOffsets.length; oi++) {
          var point = {
            x: Math.round((gx + 0.5) * gridSpacing + candidateOffsets[oi][0]),
            y: Math.round(gridY + candidateOffsets[oi][1]),
            adaptiveOffset: oi
          };
          if (point.x < radius || point.y < radius ||
              point.x >= previewState.originalWidth - radius ||
              point.y >= previewState.originalHeight - radius) continue;
          if (selectionOnly && !maskAllowsPoint(point, radius)) continue;
          point.localMedian = sampleLocalMedian(point, radius, previewPixels, previewState);
          candidates.push(point);
        }
        if (!candidates.length) {
          unavailableCells++;
          continue;
        }
        gridCells.push(candidates);
      }
    }
    var cellMedians = [];
    for (var medianCellIndex=0; medianCellIndex<gridCells.length; medianCellIndex++) {
      var cellCandidates = gridCells[medianCellIndex];
      var darkestMedian = cellCandidates[0].localMedian;
      for (var medianCandidateIndex=1; medianCandidateIndex<cellCandidates.length; medianCandidateIndex++) {
        darkestMedian = Math.min(darkestMedian, cellCandidates[medianCandidateIndex].localMedian);
      }
      cellMedians.push(darkestMedian);
    }
    var toleranceStats = gridToleranceStats(
      cellMedians, analysisGlobalMedian(selectionOnly), tolerance
    );
    for (var cellIndex=0; cellIndex<gridCells.length; cellIndex++) {
        gridCells[cellIndex].sort(function(a, b) {
          return a.localMedian - b.localMedian;
        });
        var toleranceCandidates = [];
        for (var toleranceIndex=0; toleranceIndex<gridCells[cellIndex].length; toleranceIndex++) {
          var toleranceCandidate = gridCells[cellIndex][toleranceIndex];
          var withinTolerance = toleranceStats.mad === 0
            ? toleranceCandidate.localMedian <= toleranceStats.limit
            : toleranceCandidate.localMedian < toleranceStats.limit;
          toleranceCandidate.withinGridTolerance = withinTolerance;
          applyPointQuality(toleranceCandidate);
          if (!withinTolerance) {
            var smoothBackground = !options.neutral && toleranceCandidate.quality &&
              toleranceCandidate.quality.status === "good" &&
              toleranceCandidate.quality.smoothIllumination;
            if (!smoothBackground) continue;
            toleranceCandidate.quality.reason = "부드러운 광해 배경";
            toleranceCandidate.quality.gridToleranceOverride = true;
          }
          toleranceCandidates.push(toleranceCandidate);
        }
        if (!toleranceCandidates.length) {
          unavailableCells++;
          gridRejectedCells++;
          continue;
        }
        var bestCandidate = null;
        if (goodOnly) {
          for (var candidateIndex=0; candidateIndex<toleranceCandidates.length; candidateIndex++) {
            if (toleranceCandidates[candidateIndex].quality &&
                toleranceCandidates[candidateIndex].quality.status === "good") {
              bestCandidate = toleranceCandidates[candidateIndex];
              break;
            }
          }
          if (!bestCandidate) {
            for (var warningIndex=0; warningIndex<toleranceCandidates.length; warningIndex++) {
              if (toleranceCandidates[warningIndex].quality &&
                  toleranceCandidates[warningIndex].quality.status === "warning") {
                bestCandidate = toleranceCandidates[warningIndex];
                break;
              }
            }
          }
          // Keep an excluded point visible in the editor so the rejected cell is
          // obvious. Gradient preferences still serialize green points only.
          if (!bestCandidate) bestCandidate = toleranceCandidates[0];
        } else {
          bestCandidate = chooseBestQualityCandidate(toleranceCandidates) || toleranceCandidates[0];
        }
        if (!bestCandidate) {
          unavailableCells++;
          continue;
        }
        if (bestCandidate.adaptiveOffset !== 0) relocatedCells++;
        if (bestCandidate.quality && bestCandidate.quality.gridToleranceOverride) {
          smoothLightPollutionAccepted++;
        }
        generated.push(bestCandidate);
    }
    if (options.neutral) {
      generated = selectSpatialNeutralCandidates(
        generated, 20, previewState.originalWidth, previewState.originalHeight
      );
    }
    if (!options.neutral) gradientGridDirty = false;
    samplePoints = generated;
    var minimumPoints = options.neutral ? 5 : 1;
    var readyCount = options.neutral ? usableSamplePoints(false).length : usableSamplePoints(true).length;
    if (options.neutral) neutralAutoReady = readyCount >= minimumPoints;
    drawSampleEditor();
    var summary =
      (options.neutral ? "Background 자동 분석: " : "자동 Grid Sample ") + samplePoints.length + "개" +
      "\n행당 포인트 " + columns + " · Grid Tolerance " + tolerance.toFixed(1) +
      (relocatedCells ? "\n안전한 위치로 재배치: " + relocatedCells + "개" : "") +
      (smoothLightPollutionAccepted ? "\n부드러운 광해 배경 허용: " + smoothLightPollutionAccepted + "개" : "") +
      (gridRejectedCells ? "\nGrid Tolerance 제외: " + gridRejectedCells + "개" : "") +
      (unavailableCells ? "\n제외된 Grid 셀: " + unavailableCells + "개" : "");
    if (options.neutral) {
      var goodPoints = 0;
      var warningPoints = 0;
      for (var neutralIndex=0; neutralIndex<samplePoints.length; neutralIndex++) {
        if (samplePoints[neutralIndex].quality && samplePoints[neutralIndex].quality.status === "warning") warningPoints++;
        else goodPoints++;
      }
      summary += "\n적합 " + goodPoints + " · 주의(낮은 가중치) " + warningPoints;
      var neutralStatus = document.getElementById("neutralAnalysisStatus");
      if (neutralStatus) neutralStatus.textContent = neutralAutoReady
        ? "사용 가능 " + samplePoints.length + "개 · 적합 " + goodPoints +
          " · 주의 " + warningPoints + "\n" + neutralEstimateText(neutralEstimate)
        : "안전한 Background 후보가 " + minimumPoints + "개 미만입니다. 선택 영역을 넓히거나 Editor에서 포인트를 추가하세요.";
    } else {
      summary += "\nGradient에 사용할 적합 Point: " + readyCount + "개";
    }
    if (readyCount >= minimumPoints) showOk(summary);
    else showError("안전한 Background 후보가 " + minimumPoints + "개 미만입니다. 선택 영역을 넓히거나 Editor에서 포인트를 추가하세요.");
    return {
      points: samplePoints,
      relocatedCells: relocatedCells,
      unavailableCells: unavailableCells,
      gridRejectedCells: gridRejectedCells,
      smoothLightPollutionAccepted: smoothLightPollutionAccepted,
      gridToleranceLimit: toleranceStats.limit
    };
  }

  document.getElementById("autoSamples").onclick = function(){
    if (mode === "neutralize") {
      generateAutomaticSamplePoints({
        selectionOnly: !!(previewState && previewState.hasSelection),
        neutral: true
      });
      return;
    }
    generateAutomaticSamplePoints({});
  };

  document.getElementById("generateSamples").onclick = function() {
    clearMsg();
    if (mode === "neutralize") {
      document.getElementById("neutralAnalyze").onclick();
      return;
    }
    document.getElementById("selectionOnly").checked = false;
    pendingGradientAutoSamples = true;
    document.getElementById("preparePreview").onclick();
  };

  window.GX_SAMPLE_EDITOR_BRIDGE = {
    snapshot: sampleEditorStateSnapshot,
    draw: function(targetCanvas, availableWidth, maxHeight) {
      return drawSampleCanvas(targetCanvas, availableWidth, maxHeight);
    },
    add: function(targetCanvas, x, y, scaleX, scaleY) {
      return addSamplePointAt(targetCanvas, {
        x: x, y: y, scaleX: scaleX || 1, scaleY: scaleY || 1
      });
    },
    move: function(index, x, y) {
      return moveSamplePointOriginal(index, { x:x, y:y });
    },
    remove: function(targetCanvas, x, y, scaleX, scaleY) {
      return removeNearestSampleAt(targetCanvas, {
        x: x, y: y, scaleX: scaleX || 1, scaleY: scaleY || 1
      });
    },
    info: function(targetCanvas, x, y, scaleX, scaleY) {
      return samplePointInfoAt(targetCanvas, {
        x: x, y: y, scaleX: scaleX || 1, scaleY: scaleY || 1
      });
    },
    undo: function() { document.getElementById("undoSample").onclick(); },
    clear: function() { document.getElementById("clearSamples").onclick(); },
    auto: function() { document.getElementById("autoSamples").onclick(); },
    setStretch: function(value) {
      document.getElementById("stretchPreset").value = value;
      refreshPreviewStretch();
    },
    setSaturation: function(value) {
      var saturation = normalizeSaturation(value);
      document.getElementById("previewSaturation").value = saturation;
      document.getElementById("previewSaturationValue").textContent = saturation.toFixed(1);
      refreshPreviewStretch();
    },
    setSampleSize: function(value) {
      var radius = Math.max(2, Math.min(200, parseInt(value, 10) || 25));
      document.getElementById("sampleSize").value = radius;
      refreshPointQualities();
      drawSampleEditor();
    },
    setSelectionOnly: function(value) {
      document.getElementById("selectionOnly").checked = mode === "neutralize"
        ? !!(previewState && previewState.hasSelection) : !!value;
      sampleEditorRevision++;
      updateSampleScopeStatus();
      dispatchSampleEditorState();
    },
    setPointsPerRow: function(value) {
      document.getElementById("pointsPerRow").value = normalizePointsPerRow(value);
      if (mode === "background") gradientGridDirty = samplePoints.length > 0;
      sampleEditorRevision++;
      dispatchSampleEditorState();
    },
    setGridTolerance: function(value) {
      document.getElementById("gridTolerance").value = normalizeGridTolerance(value).toFixed(1);
      if (mode === "background") gradientGridDirty = samplePoints.length > 0;
      sampleEditorRevision++;
      dispatchSampleEditorState();
    },
    setQualityPreset: function(value) {
      applyQualityPresetChange(value);
    },
    setInterpolation: function(value) {
      var nextValue = /^(RBF|Splines|Kriging)$/.test(String(value || "")) ? String(value) : "RBF";
      if (gradientInterpolation) gradientInterpolation.value = nextValue;
      updateMethodUi();
      sampleEditorRevision++;
      dispatchSampleEditorState();
    },
    setCorrection: function(value) {
      setSelectedValue("correction", value === "Division" ? "Division" : "Subtraction");
      sampleEditorRevision++;
      dispatchSampleEditorState();
    },
    setSmoothing: function(value) {
      var nextValue = Math.max(0, Math.min(1, Number(value) || 0));
      smoothing.value = nextValue.toFixed(2);
      document.getElementById("smoothingValue").textContent = nextValue.toFixed(2);
      sampleEditorRevision++;
      dispatchSampleEditorState();
    },
    setAddBackgroundLayer: function(value) {
      document.getElementById("addBackgroundLayer").checked = !!value;
      sampleEditorRevision++;
      dispatchSampleEditorState();
    },
    previewGradient: function() { createGradientResultPreview(); },
    applyGradient: function() { applyGradientResultPreview(); },
    cancelGradientPreview: function() { cancelGradientResultPreview(); },
    releaseGradientResult: function() { releaseGradientResultPreview(); }
  };

  function gradientResultSignature() {
    if (!previewState || previewState.mode !== "background") return "";
    var points = usableSamplePoints(true);
    var pointData = [];
    for (var i=0; i<points.length; i++) pointData.push([points[i].x, points[i].y]);
    return JSON.stringify({
      docId:previewState.docId,
      layerId:previewState.sourceLayerId,
      width:previewState.originalWidth,
      height:previewState.originalHeight,
      context:previewState.analysisContext,
      method:currentGradientMethod(),
      smoothing:Number(smoothing.value),
      correction:selected("correction") || "Subtraction",
      sampleSize:parseInt(document.getElementById("sampleSize").value, 10) || 25,
      pointsPerRow:normalizePointsPerRow(document.getElementById("pointsPerRow").value),
      gridTolerance:normalizeGridTolerance(document.getElementById("gridTolerance").value),
      addBackgroundLayer:!!document.getElementById("addBackgroundLayer").checked,
      points:pointData
    });
  }

  function sampleEditorStateSnapshot(editorMode) {
    var requestedMode = editorMode === "neutralize" ? "neutralize" : "background";
    var matchingPreview = !!(previewState && previewImage && previewState.mode === requestedMode);
    var resultSignature = requestedMode === "background" ? gradientResultSignature() : "";
    var resultSettingsOutdated = !!(gradientResultJob && gradientResultJob.signature !== resultSignature);
    var resultContextInvalid = !!(gradientResultJob && !gradientResultContextValid);
    var resultOutdated = resultSettingsOutdated || resultContextInvalid;
    var resultAvailable = !!(gradientResultJob && gradientResultJob.previewFile);
    var resultReady = !!(gradientResultJob && !gradientResultBusy && !resultOutdated &&
      gradientResultJob.previewFile && (gradientResultJob.importFile || gradientResultJob.localPreview));
    var editorCount = requestedMode === "neutralize"
      ? document.getElementById("neutralSampleCount") : sampleCount;
    return {
      editorMode: requestedMode,
      ready: matchingPreview,
      revision: sampleEditorRevision,
      count: matchingPreview && editorCount ? editorCount.textContent
        : (requestedMode === "neutralize" ? "0 usable points" : "준비되지 않음"),
      selection: matchingPreview && selectionStatus
        ? selectionStatus.textContent : "메인 패널에서 해당 Preview를 준비하세요.",
      quality: matchingPreview && qualityReport ? qualityReport.textContent : "분석 전",
      pointEditMessage: sampleEditorNotice,
      stretch: document.getElementById("stretchPreset").value,
      saturation: requestedMode === "background"
        ? 1 : normalizeSaturation(document.getElementById("previewSaturation").value),
      sampleSize: parseInt(document.getElementById("sampleSize").value, 10) || 25,
      pointsPerRow: normalizePointsPerRow(document.getElementById("pointsPerRow").value),
      gridTolerance: normalizeGridTolerance(document.getElementById("gridTolerance").value),
      qualityPreset: selected("qualityPreset") || "standard",
      interpolation: currentGradientMethod() === "AI"
        ? (gradientInterpolation ? gradientInterpolation.value : "RBF") : currentGradientMethod(),
      correction: selected("correction") || "Subtraction",
      smoothing: Number(smoothing.value),
      addBackgroundLayer: !!document.getElementById("addBackgroundLayer").checked,
      regionSource: matchingPreview ? previewRegionSource(previewState) : "none",
      gridDirty: requestedMode === "background" && matchingPreview && gradientGridDirty,
      previewContextOutdated: requestedMode === "background" && matchingPreview && samplePreviewContextOutdated,
      previewContextMessage: requestedMode === "background" && matchingPreview
        ? samplePreviewContextMessage : "",
      resultBusy: requestedMode === "background" && gradientResultBusy,
      resultCancelable: requestedMode === "background" && gradientResultBusy && !!activeGraXpertController,
      resultAvailable: requestedMode === "background" && resultAvailable,
      resultReady: requestedMode === "background" && resultReady,
      resultOutdated: requestedMode === "background" && resultOutdated,
      resultMessage: requestedMode === "background"
        ? (resultContextInvalid
          ? "결과를 생성한 문서, 원본 레이어 또는 이미지 크기가 변경되었습니다."
          : resultSettingsOutdated
            ? "포인트 또는 설정이 변경되었습니다. 이전 결과를 참고해 편집한 뒤 다시 계산하세요."
            : gradientResultMessage)
        : "",
      resultPreviewFile: requestedMode === "background" && resultAvailable ? gradientResultJob.previewFile : "",
      resultAppliedRevision: requestedMode === "background" ? gradientResultAppliedRevision : 0,
      selectionOnly: requestedMode === "neutralize"
        ? !!(matchingPreview && previewState.hasSelection)
        : document.getElementById("selectionOnly").checked,
      previewFile: matchingPreview ? previewFile : "",
      previewState: matchingPreview ? previewState : null,
      points: matchingPreview ? samplePoints : []
    };
  }

  function dispatchSampleEditorState() {
    writeSampleEditorStateFile("background");
    writeSampleEditorStateFile("neutralize");
    dispatchCepEvent(GRADIENT_STATE_EVENT, sampleEditorStateSnapshot("background"), GRADIENT_EDITOR_EXTENSION_ID);
    dispatchCepEvent(NEUTRAL_STATE_EVENT, sampleEditorStateSnapshot("neutralize"), NEUTRAL_EDITOR_EXTENSION_ID);
  }

  function handleSampleEditorCommand(event, editorMode) {
    var requestedMode = editorMode === "neutralize" ? "neutralize" : "background";
    var command;
    try { command = JSON.parse(event && event.data ? event.data : "{}"); } catch (_) { return; }
    if (command.id && command.id === lastSampleCommandId[requestedMode]) return;
    if (command.id) lastSampleCommandId[requestedMode] = command.id;
    if (command.action === "requestState") {
      dispatchSampleEditorState();
      return;
    }
    if (requestedMode === "background" && command.action === "releaseGradientResult") {
      releaseGradientResultPreview();
      return;
    }
    if (requestedMode === "background" && command.action === "cancelGradientPreview") {
      cancelGradientResultPreview();
      return;
    }
    if (mode !== requestedMode || !previewState || !previewImage || previewState.mode !== requestedMode) return;
    if (requestedMode === "background" && samplePreviewContextOutdated &&
        /^(add|move|remove|undo|clear|auto|setSampleSize|setPointsPerRow|setGridTolerance|setQualityPreset|setSelectionOnly|previewGradient|applyGradient)$/.test(command.action)) {
      dispatchSampleEditorState();
      return;
    }
    if (requestedMode === "background" && gradientResultBusy &&
        /^(add|move|remove|undo|clear|auto|setSampleSize|setPointsPerRow|setGridTolerance|setQualityPreset|setSelectionOnly|setInterpolation|setCorrection|setSmoothing|setAddBackgroundLayer)$/.test(command.action)) {
      return;
    }
    if (command.action === "add") {
      var point = {
        x: Math.max(0, Math.min(previewState.originalWidth - 1, Math.round(Number(command.x) || 0))),
        y: Math.max(0, Math.min(previewState.originalHeight - 1, Math.round(Number(command.y) || 0)))
      };
      addSamplePointOriginal(point);
    } else if (command.action === "move") {
      moveSamplePointOriginal(command.index, { x:command.x, y:command.y });
    } else if (command.action === "remove") {
      var removeIndex = parseInt(command.index, 10);
      if (removeIndex >= 0 && removeIndex < samplePoints.length) samplePoints.splice(removeIndex, 1);
      if (mode === "background" && !samplePoints.length) gradientGridDirty = false;
      drawSampleEditor();
    } else if (command.action === "undo") {
      document.getElementById("undoSample").onclick();
    } else if (command.action === "clear") {
      document.getElementById("clearSamples").onclick();
    } else if (command.action === "auto") {
      document.getElementById("autoSamples").onclick();
    } else if (command.action === "setStretch") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setStretch(command.value);
    } else if (command.action === "setSaturation") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setSaturation(command.value);
    } else if (command.action === "setSampleSize") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setSampleSize(command.value);
    } else if (command.action === "setPointsPerRow") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setPointsPerRow(command.value);
    } else if (command.action === "setGridTolerance") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setGridTolerance(command.value);
    } else if (command.action === "setQualityPreset") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setQualityPreset(command.value);
    } else if (command.action === "setInterpolation") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setInterpolation(command.value);
    } else if (command.action === "setCorrection") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setCorrection(command.value);
    } else if (command.action === "setSmoothing") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setSmoothing(command.value);
    } else if (command.action === "setAddBackgroundLayer") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setAddBackgroundLayer(command.value);
    } else if (command.action === "setSelectionOnly") {
      window.GX_SAMPLE_EDITOR_BRIDGE.setSelectionOnly(command.value);
      dispatchSampleEditorState();
    } else if (command.action === "previewGradient") {
      createGradientResultPreview();
    } else if (command.action === "applyGradient") {
      applyGradientResultPreview();
    }
  }

  if (window.__adobe_cep__ && window.__adobe_cep__.addEventListener) {
    window.__adobe_cep__.addEventListener(GRADIENT_COMMAND_EVENT, function(event) {
      handleSampleEditorCommand(event, "background");
    });
    window.__adobe_cep__.addEventListener(NEUTRAL_COMMAND_EVENT, function(event) {
      handleSampleEditorCommand(event, "neutralize");
    });
  }
  dispatchSampleEditorState();
  if (window.setInterval && fs && os && path) {
    window.setInterval(function() {
      var modes = ["background", "neutralize"];
      for (var fileIndex=0; fileIndex<modes.length; fileIndex++) {
        var config = editorConfig(modes[fileIndex]);
        var commandFile = sampleEditorExchangeFile(config.commandFile);
        if (!commandFile || !fs.existsSync(commandFile)) continue;
        try {
          var commandFileState = fs.statSync(commandFile);
          var commandModifiedAt = isFinite(Number(commandFileState.mtimeMs))
            ? Number(commandFileState.mtimeMs) : commandFileState.mtime.getTime();
          var commandFileStamp = commandModifiedAt + "|" + commandFileState.size;
          if (commandFileStamp === lastSampleCommandFileStamp[config.mode]) continue;
          var commandText = fs.readFileSync(commandFile, "utf8");
          JSON.parse(commandText);
          handleSampleEditorCommand(
            { data:commandText }, config.mode
          );
          lastSampleCommandFileStamp[config.mode] = commandFileStamp;
        } catch (_) {}
      }
    }, 350);
  }

  document.getElementById("preparePreview").onclick = function(){
    clearMsg();
    if (!gradientResultBusy && gradientResultJob) {
      cleanupGradientResultJob(gradientResultJob);
      gradientResultJob = null;
      gradientResultContextValid = true;
      gradientResultMessage = "결과 미리보기 전";
    }
    if (!fs || !os || !path) {
      showError("Node.js 모듈을 사용할 수 없습니다. CEP 설정을 확인하세요.");
      return;
    }
    var workdir = path.join(os.tmpdir(), "GraXpert_Photoshop");
    try {
      if (!fs.existsSync(workdir)) fs.mkdirSync(workdir, { recursive:true });
    } catch (folderErr) {
      showError("Preview 임시 폴더 생성 실패: " + folderErr.message);
      return;
    }

    if (previewState && previewState.gradientInputFile) safeDelete(previewState.gradientInputFile);
    safeDelete(previewFile);
    safeDelete(maskFile);
    var stamp = Date.now();
    previewFile = path.join(workdir, "preview_" + stamp + ".png");
    maskFile = path.join(workdir, "mask_" + stamp + ".png");
    var gradientInputFile = mode === "background"
      ? path.join(workdir, "preview_input_" + stamp + ".tif") : "";
    var scope = mode === "neutralize"
      ? (document.getElementById("neutralSkyOnly").checked ? "layer-sky" : "layer-auto")
      : "layer-auto";

    setBusy(true, "Sample Preview 준비 중…");
    setProgress(15, "Photoshop Preview와 Selection mask 생성 중…");
    evalPS(
      'GX_exportSamplePreview("' + escJs(previewFile) + '","' + escJs(maskFile) + '",1400,900,"' +
        scope + '","' + escJs(gradientInputFile) + '")',
      function(err, result) {
        if (err || !result || result.indexOf("OK|") !== 0) {
          pendingNeutralAutoAnalysis = false;
          pendingGradientAutoSamples = false;
          pendingOpenSampleEditor = false;
          setBusy(false);
          safeDelete(gradientInputFile);
          showError("Sample Preview 생성 실패:\n" + (err || result || "알 수 없는 오류"));
          return;
        }
        var parts = result.split("|");
        previewState = {
          docId: parseInt(parts[1], 10),
          originalWidth: parseInt(parts[2], 10),
          originalHeight: parseInt(parts[3], 10),
          previewWidth: parseInt(parts[4], 10),
          previewHeight: parseInt(parts[5], 10),
          hasSelection: parts[6] === "YES",
          sourceLayerId: parts[7] && /^L:-?\d+$/.test(parts[7])
            ? parseInt(parts[7].substring(2), 10) : -1,
          analysisContext: parts[8] && parts[8].indexOf("C:") === 0
            ? decodeURIComponent(parts[8].substring(2)) : "",
          docName: parts[9] && parts[9].indexOf("N:") === 0
            ? decodeURIComponent(parts[9].substring(2)) : "",
          layerVersion: parts[10] && /^V:-?\d+$/.test(parts[10])
            ? parseInt(parts[10].substring(2), 10) : -1,
          mode: mode,
          scope: scope,
          gradientInputFile: gradientInputFile
        };
        samplePreviewContextOutdated = false;
        samplePreviewContextMessage = "";
        samplePoints = [];

        loadLocalImage(previewFile, function(previewErr, loadedPreview) {
          if (previewErr) {
            pendingNeutralAutoAnalysis = false;
            pendingGradientAutoSamples = false;
            pendingOpenSampleEditor = false;
            setBusy(false);
            showError(previewErr.message);
            return;
          }
          loadLocalImage(maskFile, function(maskErr, loadedMask) {
            if (maskErr) {
              pendingNeutralAutoAnalysis = false;
              pendingGradientAutoSamples = false;
              pendingOpenSampleEditor = false;
              setBusy(false);
              showError(maskErr.message);
              return;
            }
            previewImage = loadedPreview;
            var analysisCanvas = document.createElement("canvas");
            analysisCanvas.width = previewState.previewWidth;
            analysisCanvas.height = previewState.previewHeight;
            var analysisCtx = analysisCanvas.getContext("2d");
            analysisCtx.drawImage(loadedPreview, 0, 0, analysisCanvas.width, analysisCanvas.height);
            previewPixels = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
            previewLuminanceStats = calculateLuminanceStats(previewPixels);
            var maskCanvas = document.createElement("canvas");
            maskCanvas.width = previewState.previewWidth;
            maskCanvas.height = previewState.previewHeight;
            var maskCtx = maskCanvas.getContext("2d");
            maskCtx.drawImage(loadedMask, 0, 0, maskCanvas.width, maskCanvas.height);
            selectionMask = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            previewSelectionLuminanceStats = previewState.hasSelection
              ? calculateLuminanceStats(previewPixels, selectionMask) : null;
            sampleEditor.className = "sample-editor hidden";
            sampleCanvasEmpty.className = "sample-canvas-empty hidden";
            selectionStatus.textContent = previewRegionStatusText(previewState);
            if (mode === "neutralize") {
              document.getElementById("selectionOnly").checked = previewState.hasSelection;
            } else if (pendingGradientAutoSamples) {
              document.getElementById("selectionOnly").checked = previewState.hasSelection;
            }
            updateSampleScopeStatus();
            if (mode === "neutralize") refreshNeutralMaskStatus();
            refreshPreviewStretch();
            setBusy(false);
            document.getElementById("progressWrap").className = "progress-wrap hidden";
            if (pendingNeutralAutoAnalysis) {
              pendingNeutralAutoAnalysis = false;
              generateAutomaticSamplePoints({
                selectionOnly: previewState.hasSelection,
                neutral: true
              });
              if (pendingOpenSampleEditor) {
                pendingOpenSampleEditor = false;
                openLargeSampleEditor();
              }
            } else if (pendingGradientAutoSamples) {
              pendingGradientAutoSamples = false;
              generateAutomaticSamplePoints({
                selectionOnly: document.getElementById("selectionOnly").checked
              });
            } else if (pendingOpenSampleEditor) {
              pendingOpenSampleEditor = false;
              // The modeless editor may already be alive with an older state file.
              // Publish the completed Preview before activating/opening the window.
              dispatchSampleEditorState();
              openLargeSampleEditor();
            } else {
              showOk("Sample Preview가 준비되었습니다.");
            }
          });
        });
      }
    );
  };

  updateMethodUi();

  function defaultGraXpertExecutable() {
    var localAppData = "";
    try {
      if (typeof process !== "undefined" && process.env) {
        localAppData = process.env.LOCALAPPDATA || "";
      }
    } catch (_) {}
    if (!localAppData && os && os.homedir) {
      localAppData = path.join(os.homedir(), "AppData", "Local");
    }
    if (localAppData && path && fs) {
      var installedExe = path.join(localAppData, "Programs", "GraXpert", "GraXpert.exe");
      if (fs.existsSync(installedExe)) return installedExe;
    }
    return "GraXpert.exe";
  }

  try {
    var saved = localStorage.getItem("graxpertExe");
    if (saved) {
      var migratedExe = saved.replace(/GraXpert-win64\.exe$/i, "GraXpert.exe");
      if (/^GraXpert\.exe$/i.test(migratedExe)) migratedExe = defaultGraXpertExecutable();
      exePath.value = migratedExe;
      if (migratedExe !== saved) localStorage.setItem("graxpertExe", migratedExe);
    } else exePath.value = defaultGraXpertExecutable();
  } catch (_) {}

  document.getElementById("savePath").onclick = function(){
    try {
      localStorage.setItem("graxpertExe", exePath.value.trim() || defaultGraXpertExecutable());
      showOk("GraXpert 실행 경로를 저장했습니다.");
    } catch (_) {}
  };

  document.getElementById("browsePath").onclick = function(){
    try {
      if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialog) {
        showError("CEP 파일 선택기를 사용할 수 없습니다. 실행 파일 전체 경로를 직접 입력하세요.");
        return;
      }
      var picked = window.cep.fs.showOpenDialog(
        false,
        false,
        "GraXpert 실행 파일 선택",
        "",
        ["exe"]
      );
      if (picked && picked.data && picked.data.length) {
        exePath.value = picked.data[0];
        localStorage.setItem("graxpertExe", exePath.value);
        showOk("GraXpert 실행 파일을 선택하고 경로를 저장했습니다.");
      }
    } catch (browseErr) {
      showError("GraXpert 실행 파일 선택 실패: " + browseErr.message);
    }
  };

  function evalPS(script, cb) {
    if (!window.__adobe_cep__) {
      cb("CEP 인터페이스를 사용할 수 없습니다.");
      return;
    }
    window.__adobe_cep__.evalScript(script, function(result){ cb(null, result); });
  }

  function escJs(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function selected(name) {
    var els = document.querySelectorAll('input[name="' + name + '"]');
    for (var i=0;i<els.length;i++) if (els[i].checked) return els[i].value;
    return "";
  }

  function setSelectedValue(name, value) {
    var els = document.querySelectorAll('input[name="' + name + '"]');
    for (var i=0; i<els.length; i++) els[i].checked = els[i].value === value;
  }

  function setBusy(busy, label) {
    panelBusy = !!busy;
    runBtn.disabled = busy;

    if (label) {
      document.getElementById("runText").textContent = label;
    } else {
      document.getElementById("runText").textContent =
        mode === "background"
          ? "GraXpert Gradient Removal 실행"
          : "GraXpert Denoise 실행";
    }

    document.getElementById("progressWrap").className =
      busy ? "progress-wrap" : "progress-wrap hidden";

    if (panelRoot) {
      panelRoot.className = busy ? "panel panel-busy" : "panel";
    }

    var controls = document.querySelectorAll('input, select, button');
    for (var i = 0; i < controls.length; i++) {
      try { controls[i].disabled = !!busy; } catch (_) {}
    }
    if (cancelRunBtn) {
      cancelRunBtn.className = "cancel-run hidden";
      cancelRunBtn.disabled = true;
    }
  }

  function setGradientEditorBusy(busy) {
    var controls = [runBtn, tabBg, tabDn, tabNeutral, settingsBtn];
    for (var i=0; i<controls.length; i++) {
      if (controls[i]) controls[i].disabled = !!busy;
    }
  }

  function setCancelAvailable(available) {
    if (!cancelRunBtn) return;
    cancelRunBtn.className = available ? "cancel-run" : "cancel-run hidden";
    cancelRunBtn.disabled = !available;
  }

  if (cancelRunBtn) cancelRunBtn.onclick = function() {
    if (!activeGraXpertController) return;
    setCancelAvailable(false);
    setProgress(55, "GraXpert 처리를 취소하는 중…");
    activeGraXpertController.cancel();
  };

  function setProgress(p, text) {
    document.getElementById("progressBar").style.width = p + "%";
    document.getElementById("status").textContent = text || "";
  }

  function clearMsg() {
    var e = document.getElementById("message");
    e.className = "message";
    e.textContent = "";
  }

  function showError(s) {
    var e = document.getElementById("message");
    e.className = "message error";
    e.textContent = s;
  }

  function showOk(s) {
    var e = document.getElementById("message");
    e.className = "message ok";
    e.textContent = s;
  }

  function findOutput(baseNoExt) {
    var candidates = [
      baseNoExt + ".fits",
      baseNoExt + ".fit",
      baseNoExt + ".fts",
      baseNoExt + ".tif",
      baseNoExt + ".tiff",
      baseNoExt + ".png"
    ];
    for (var i=0;i<candidates.length;i++) {
      if (fs.existsSync(candidates[i])) return candidates[i];
    }
    return null;
  }

  function findBackgroundOutput(baseNoExt) {
    var candidates = [
      baseNoExt + "_background.fits",
      baseNoExt + "_background.fit",
      baseNoExt + "_background.fts",
      baseNoExt + "_background.tif",
      baseNoExt + "_background.tiff",
      baseNoExt + "_background.png"
    ];
    for (var i=0;i<candidates.length;i++) {
      if (fs.existsSync(candidates[i])) return candidates[i];
    }
    return null;
  }

  function prepareBackgroundModelImport(sourcePath, workdir, stamp) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error("Background Model 결과 파일을 찾지 못했습니다.");
    }
    if (/\.(fits|fit|fts)$/i.test(sourcePath)) {
      var convertedPath = path.join(workdir, "photoshop_background_" + stamp + ".tif");
      convertFitsToTiff(sourcePath, convertedPath);
      return convertedPath;
    }
    return sourcePath;
  }

  function cleanupBackgroundModelFiles(sourcePath, importPath) {
    if (importPath && importPath !== sourcePath) safeDelete(importPath);
    safeDelete(sourcePath);
  }

  function importBackgroundModelLayer(sourcePath, workdir, stamp, docId, docName, sourceLayerId, callback) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      callback("Background Model 결과 파일을 찾지 못했습니다.", false);
      return;
    }

    var importPath = "";
    try {
      importPath = prepareBackgroundModelImport(sourcePath, workdir, stamp);
    } catch (prepareError) {
      callback("Background Model 변환 실패: " + prepareError.message, false);
      return;
    }

    evalPS(
      'GX_importResultById("' + escJs(importPath) + '",' + docId +
        ',"' + escJs(docName) + '","GraXpert - Background Model","",' +
        sourceLayerId + ',true)',
      function(importError, importResult) {
        if (importPath !== sourcePath) safeDelete(importPath);
        if (importError || importResult !== "OK") {
          callback("Background Model 레이어 추가 실패: " +
            (importError || importResult || "알 수 없는 오류"), false);
          return;
        }
        callback("", true);
      }
    );
  }

  function parseFitsCardValue(card) {
    var raw = card.substring(10);
    var quoted = false;
    for (var i=0; i<raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch === "'") quoted = !quoted;
      if (ch === "/" && !quoted) {
        raw = raw.substring(0, i);
        break;
      }
    }
    raw = raw.trim();

    if (raw.length >= 2 && raw.charAt(0) === "'" && raw.charAt(raw.length - 1) === "'") {
      return raw.substring(1, raw.length - 1).trim();
    }
    if (raw === "T") return true;
    if (raw === "F") return false;

    var num = Number(raw.replace(/D/g, "E"));
    return isNaN(num) ? raw : num;
  }

  var GX_MAX_SAFE_INTEGER = 9007199254740991;
  var GX_MAX_ROW_BUFFER_BYTES = 256 * 1024 * 1024;
  var GX_MAX_TIFF_METADATA_BYTES = 64 * 1024 * 1024;

  function isSafeNonNegativeInteger(value) {
    return isFinite(value) && value >= 0 && Math.floor(value) === value &&
      value <= GX_MAX_SAFE_INTEGER;
  }

  function checkedProduct(values, label) {
    var result = 1;
    for (var i=0; i<values.length; i++) {
      var value = Number(values[i]);
      if (!isSafeNonNegativeInteger(value) || (value && result > GX_MAX_SAFE_INTEGER / value)) {
        throw new Error(label + " 크기가 안전한 정수 범위를 초과합니다.");
      }
      result *= value;
    }
    return result;
  }

  function assertFileRange(offset, length, fileSize, label) {
    if (!isSafeNonNegativeInteger(offset) || !isSafeNonNegativeInteger(length) ||
        !isSafeNonNegativeInteger(fileSize) || offset > fileSize || length > fileSize - offset) {
      throw new Error(label + " 범위가 파일 크기를 벗어납니다.");
    }
  }

  function readFitsHeader(fd, fileSize) {
    var cards = {};
    var blockSize = 2880;
    var block = Buffer.alloc(blockSize);
    var offset = 0;
    var maxHeaderBytes = 64 * 1024 * 1024;

    while (offset < fileSize && offset < maxHeaderBytes) {
      if (fileSize - offset < blockSize) {
        throw new Error("FITS 헤더 블록이 올바르게 패딩되지 않았습니다.");
      }
      readExact(fd, block, offset);
      var bytesRead = blockSize;

      for (var pos=0; pos + 80 <= bytesRead; pos += 80) {
        var card = block.toString("ascii", pos, pos + 80);
        var key = card.substring(0, 8).trim();

        if (key === "END") {
          var dataOffset = offset + blockSize;
          if (dataOffset > fileSize) {
            throw new Error("FITS 헤더 블록이 올바르게 패딩되지 않았습니다.");
          }
          return { cards: cards, dataOffset: dataOffset };
        }

        if (key && card.charAt(8) === "=") {
          cards[key] = parseFitsCardValue(card);
        }
      }

      offset += blockSize;
    }

    throw new Error("FITS END header card를 찾지 못했습니다.");
  }

  function fitsBytesPerSample(bitpix) {
    if (bitpix === 8) return 1;
    if (bitpix === 16) return 2;
    if (bitpix === 32 || bitpix === -32) return 4;
    if (bitpix === -64) return 8;
    throw new Error("지원하지 않는 FITS BITPIX=" + bitpix);
  }

  function readFitsSample(buf, byteOffset, bitpix, bscale, bzero) {
    var value;
    if (bitpix === 8) value = buf.readUInt8(byteOffset);
    else if (bitpix === 16) value = buf.readInt16BE(byteOffset);
    else if (bitpix === 32) value = buf.readInt32BE(byteOffset);
    else if (bitpix === -32) value = buf.readFloatBE(byteOffset);
    else value = buf.readDoubleBE(byteOffset);
    return value * bscale + bzero;
  }

  function readExact(fd, buf, filePosition) {
    var done = 0;
    while (done < buf.length) {
      var n = fs.readSync(fd, buf, done, buf.length - done, filePosition + done);
      if (n <= 0) throw new Error("FITS 데이터 길이가 예상보다 짧습니다.");
      done += n;
    }
  }

  function writeExact(fd, buf, filePosition) {
    var done = 0;
    while (done < buf.length) {
      var n = fs.writeSync(fd, buf, done, buf.length - done, filePosition + done);
      if (n <= 0) throw new Error("TIFF 파일 쓰기에 실패했습니다.");
      done += n;
    }
  }

  function getFitsMetadata(fd, fileSize) {
    var header = readFitsHeader(fd, fileSize);
    var c = header.cards;
    var bitpix = Number(c.BITPIX);
    var naxis = Number(c.NAXIS);
    if (naxis !== 2 && naxis !== 3) {
      throw new Error("지원하지 않는 FITS NAXIS=" + naxis + " (2D/3D만 지원)");
    }

    var n1 = Number(c.NAXIS1 || 0);
    var n2 = Number(c.NAXIS2 || 0);
    var n3 = naxis === 3 ? Number(c.NAXIS3 || 0) : 1;
    if (!isFinite(n1) || !isFinite(n2) || !isFinite(n3) ||
        n1 <= 0 || n2 <= 0 || n3 <= 0 ||
        n1 % 1 || n2 % 1 || n3 % 1 ||
        !isSafeNonNegativeInteger(n1) || !isSafeNonNegativeInteger(n2) ||
        !isSafeNonNegativeInteger(n3)) {
      throw new Error("FITS 크기 정보가 올바르지 않습니다.");
    }

    var width, height, channels, layout;
    if (naxis === 2) {
      width = n1; height = n2; channels = 1; layout = "gray";
    } else if (n3 === 3 || n3 === 1) {
      width = n1; height = n2; channels = n3; layout = "channel-last-axis";
    } else if (n1 === 3) {
      channels = 3; width = n2; height = n3; layout = "channel-first-axis";
    } else {
      throw new Error("지원하지 않는 RGB FITS 축 구성: " + n1 + "x" + n2 + "x" + n3);
    }

    var bscale = (c.BSCALE !== undefined) ? Number(c.BSCALE) : 1.0;
    var bzero = (c.BZERO !== undefined) ? Number(c.BZERO) : 0.0;
    if (!isFinite(bscale) || !isFinite(bzero)) {
      throw new Error("FITS BSCALE/BZERO 값이 올바르지 않습니다.");
    }

    var bytesPer = fitsBytesPerSample(bitpix);
    var count = checkedProduct([n1, n2, n3], "FITS 픽셀 수");
    var dataBytes = checkedProduct([count, bytesPer], "FITS 데이터");
    if (count <= 0 || dataBytes > fileSize - header.dataOffset) {
      throw new Error("FITS 데이터 길이가 예상보다 짧습니다.");
    }

    var sourceRowBytes = checkedProduct([width, bytesPer, layout === "channel-first-axis" ? 3 : 1], "FITS 행 버퍼");
    var outputRowBytes = checkedProduct([width, 6], "TIFF 행 버퍼");
    if (sourceRowBytes > GX_MAX_ROW_BUFFER_BYTES || outputRowBytes > GX_MAX_ROW_BUFFER_BYTES) {
      throw new Error("이미지 한 행이 메모리 안전 제한(256MB)을 초과합니다.");
    }
    var tiffPixelBytes = checkedProduct([width, height, 6], "TIFF 픽셀 데이터");
    if (tiffPixelBytes > 0xFFFFFFFF - 1024) {
      throw new Error("이미지가 Classic TIFF 4GB 제한을 초과합니다.");
    }

    return {
      width: width,
      height: height,
      channels: channels,
      layout: layout,
      bitpix: bitpix,
      bytesPer: bytesPer,
      bscale: bscale,
      bzero: bzero,
      count: count,
      dataBytes: dataBytes,
      dataOffset: header.dataOffset
    };
  }

  function scanFitsRange(fd, meta) {
    var chunkBytes = 4 * 1024 * 1024;
    chunkBytes -= chunkBytes % meta.bytesPer;
    var buf = Buffer.alloc(chunkBytes);
    var position = meta.dataOffset;
    var remaining = meta.dataBytes;
    var min = Infinity, max = -Infinity, finiteCount = 0;

    while (remaining > 0) {
      var wanted = Math.min(buf.length, remaining);
      var view = wanted === buf.length ? buf : buf.slice(0, wanted);
      readExact(fd, view, position);

      for (var p=0; p<wanted; p += meta.bytesPer) {
        var value = readFitsSample(buf, p, meta.bitpix, meta.bscale, meta.bzero);
        if (!isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
        finiteCount++;
      }

      position += wanted;
      remaining -= wanted;
    }

    if (!finiteCount) throw new Error("FITS에 유효한 픽셀 값이 없습니다.");
    return { min: min, max: max };
  }

  // Preserve the existing linear range rules without allocating a second image.
  function normalizationForRange(min, max) {
    var scale = 1.0;
    var mode = "raw float";

    if (min >= -0.05 && max <= 2.0) {
      scale = 1.0;
      mode = "0..1 float";
    } else if (min >= -32 && max <= 512) {
      scale = 1.0 / 255.0;
      mode = "0..255 -> 0..1";
    } else if (min >= -1024 && max <= 131072) {
      scale = 1.0 / 65535.0;
      mode = "0..65535 -> 0..1";
    } else if (min >= 0 && max > 1) {
      scale = 1.0 / max;
      mode = "positive range -> linear max normalization";
    }

    return {
      sourceMin: min,
      sourceMax: max,
      scale: scale,
      mode: mode
    };
  }

  // ------------------------------------------------------------
  // Create the small TIFF header separately. Pixel rows are streamed later.
  // ------------------------------------------------------------
  function createUint16RgbTiffHeader(width, height, iccProfile) {
    if (!isSafeNonNegativeInteger(width) || !isSafeNonNegativeInteger(height) ||
        width <= 0 || height <= 0 || width > 0xFFFFFFFF || height > 0xFFFFFFFF) {
      throw new Error("TIFF 이미지 크기가 올바르지 않습니다.");
    }
    var hasIccProfile = Buffer.isBuffer(iccProfile) && iccProfile.length >= 128;
    var entries = 10 + (hasIccProfile ? 1 : 0);
    var ifdOffset = 8;
    var ifdSize = 2 + entries * 12 + 4;

    var bitsOffset = ifdOffset + ifdSize;
    var iccOffset = bitsOffset + 6;
    var pixelOffset = iccOffset + (hasIccProfile ? iccProfile.length : 0);

    if (pixelOffset % 2) pixelOffset += 1;

    var pixelBytes = checkedProduct([width, height, 6], "TIFF 픽셀 데이터");
    if (pixelBytes > 0xFFFFFFFF - pixelOffset) {
      throw new Error("이미지가 Classic TIFF 4GB 제한을 초과합니다.");
    }
    var out = Buffer.alloc(pixelOffset);

    // TIFF header: little endian, magic 42, first IFD offset.
    out.write("II", 0, 2, "ascii");
    out.writeUInt16LE(42, 2);
    out.writeUInt32LE(ifdOffset, 4);

    var p = ifdOffset;
    out.writeUInt16LE(entries, p); p += 2;

    function entry(tag, type, count, value) {
      out.writeUInt16LE(tag, p);
      out.writeUInt16LE(type, p + 2);
      out.writeUInt32LE(count, p + 4);

      if (type === 3 && count === 1) {
        out.writeUInt16LE(value, p + 8);
        out.writeUInt16LE(0, p + 10);
      } else {
        out.writeUInt32LE(value, p + 8);
      }
      p += 12;
    }

    entry(256, 4, 1, width);       // ImageWidth
    entry(257, 4, 1, height);      // ImageLength
    entry(258, 3, 3, bitsOffset);  // BitsPerSample [16,16,16]
    entry(259, 3, 1, 1);           // Compression = none
    entry(262, 3, 1, 2);           // Photometric = RGB
    entry(273, 4, 1, pixelOffset); // StripOffsets
    entry(277, 3, 1, 3);           // SamplesPerPixel = 3
    entry(278, 4, 1, height);      // RowsPerStrip
    entry(279, 4, 1, pixelBytes);  // StripByteCounts
    entry(284, 3, 1, 1);           // PlanarConfiguration = chunky
    if (hasIccProfile) entry(34675, 7, iccProfile.length, iccOffset); // ICC profile

    out.writeUInt32LE(0, p); // no next IFD

    out.writeUInt16LE(16, bitsOffset);
    out.writeUInt16LE(16, bitsOffset + 2);
    out.writeUInt16LE(16, bitsOffset + 4);
    if (hasIccProfile) iccProfile.copy(out, iccOffset);

    return { buffer: out, pixelOffset: pixelOffset };
  }

  function createFloat32RgbTiffHeader(width, height, iccProfile) {
    if (!isSafeNonNegativeInteger(width) || !isSafeNonNegativeInteger(height) ||
        width <= 0 || height <= 0 || width > 0xFFFFFFFF || height > 0xFFFFFFFF) {
      throw new Error("TIFF 이미지 크기가 올바르지 않습니다.");
    }
    var hasIccProfile = Buffer.isBuffer(iccProfile) && iccProfile.length >= 128;
    var entries = 11 + (hasIccProfile ? 1 : 0);
    var ifdOffset = 8;
    var ifdSize = 2 + entries * 12 + 4;
    var bitsOffset = ifdOffset + ifdSize;
    var sampleFormatOffset = bitsOffset + 6;
    var iccOffset = sampleFormatOffset + 6;
    var pixelOffset = iccOffset + (hasIccProfile ? iccProfile.length : 0);
    if (pixelOffset % 4) pixelOffset += 4 - (pixelOffset % 4);
    var pixelBytes = checkedProduct([width, height, 12], "32-bit TIFF 픽셀 데이터");
    if (pixelBytes > 0xFFFFFFFF - pixelOffset) {
      throw new Error("이미지가 Classic TIFF 4GB 제한을 초과합니다.");
    }
    var out = Buffer.alloc(pixelOffset);
    out.write("II", 0, 2, "ascii");
    out.writeUInt16LE(42, 2);
    out.writeUInt32LE(ifdOffset, 4);
    var p = ifdOffset;
    out.writeUInt16LE(entries, p); p += 2;
    function entry(tag, type, count, value) {
      out.writeUInt16LE(tag, p);
      out.writeUInt16LE(type, p + 2);
      out.writeUInt32LE(count, p + 4);
      if (type === 3 && count === 1) {
        out.writeUInt16LE(value, p + 8);
        out.writeUInt16LE(0, p + 10);
      } else {
        out.writeUInt32LE(value, p + 8);
      }
      p += 12;
    }
    entry(256, 4, 1, width);
    entry(257, 4, 1, height);
    entry(258, 3, 3, bitsOffset);          // [32,32,32]
    entry(259, 3, 1, 1);                   // uncompressed
    entry(262, 3, 1, 2);                   // RGB
    entry(273, 4, 1, pixelOffset);
    entry(277, 3, 1, 3);
    entry(278, 4, 1, height);
    entry(279, 4, 1, pixelBytes);
    entry(284, 3, 1, 1);                   // chunky
    entry(339, 3, 3, sampleFormatOffset);  // IEEE floating point
    if (hasIccProfile) entry(34675, 7, iccProfile.length, iccOffset); // ICC profile
    out.writeUInt32LE(0, p);
    for (var channel=0; channel<3; channel++) {
      out.writeUInt16LE(32, bitsOffset + channel * 2);
      out.writeUInt16LE(3, sampleFormatOffset + channel * 2);
    }
    if (hasIccProfile) iccProfile.copy(out, iccOffset);
    return { buffer:out, pixelOffset:pixelOffset };
  }

  function normalizedUint16(value, norm) {
    if (!isFinite(value)) value = 0;
    value *= norm.scale;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    return Math.round(value * 65535.0);
  }

  function writeFitsRowsToTiff(inputFd, outputFd, meta, norm, pixelOffset) {
    var sourceRowBytes = meta.width * meta.bytesPer;
    var outputRowBytes = meta.width * 3 * 2;
    var outputRow = Buffer.alloc(outputRowBytes);
    var rows;

    if (meta.layout === "channel-first-axis") {
      rows = [Buffer.alloc(sourceRowBytes * 3)];
    } else if (meta.channels === 3) {
      rows = [Buffer.alloc(sourceRowBytes), Buffer.alloc(sourceRowBytes), Buffer.alloc(sourceRowBytes)];
    } else {
      rows = [Buffer.alloc(sourceRowBytes)];
    }

    for (var y=0; y<meta.height; y++) {
      if (meta.layout === "channel-first-axis") {
        readExact(
          inputFd,
          rows[0],
          meta.dataOffset + y * sourceRowBytes * 3
        );
      } else if (meta.channels === 3) {
        for (var c=0; c<3; c++) {
          readExact(
            inputFd,
            rows[c],
            meta.dataOffset + (c * meta.height + y) * sourceRowBytes
          );
        }
      } else {
        readExact(inputFd, rows[0], meta.dataOffset + y * sourceRowBytes);
      }

      for (var x=0; x<meta.width; x++) {
        var outAt = x * 6;

        if (meta.layout === "channel-first-axis") {
          var base = x * 3 * meta.bytesPer;
          for (var cf=0; cf<3; cf++) {
            var vf = readFitsSample(rows[0], base + cf * meta.bytesPer, meta.bitpix, meta.bscale, meta.bzero);
            outputRow.writeUInt16LE(normalizedUint16(vf, norm), outAt + cf * 2);
          }
        } else if (meta.channels === 3) {
          for (var cp=0; cp<3; cp++) {
            var vp = readFitsSample(rows[cp], x * meta.bytesPer, meta.bitpix, meta.bscale, meta.bzero);
            outputRow.writeUInt16LE(normalizedUint16(vp, norm), outAt + cp * 2);
          }
        } else {
          var vg = readFitsSample(rows[0], x * meta.bytesPer, meta.bitpix, meta.bscale, meta.bzero);
          var ug = normalizedUint16(vg, norm);
          outputRow.writeUInt16LE(ug, outAt);
          outputRow.writeUInt16LE(ug, outAt + 2);
          outputRow.writeUInt16LE(ug, outAt + 4);
        }
      }

      writeExact(outputFd, outputRow, pixelOffset + y * outputRowBytes);
    }
  }

  function convertFitsToTiff(fitsPath, tiffPath) {
    var inputFd = null;
    var outputFd = null;

    try {
      inputFd = fs.openSync(fitsPath, "r");
      var fileSize = fs.fstatSync(inputFd).size;
      var meta = getFitsMetadata(inputFd, fileSize);
      var range = scanFitsRange(inputFd, meta);
      var norm = normalizationForRange(range.min, range.max);
      var header = createUint16RgbTiffHeader(meta.width, meta.height);

      outputFd = fs.openSync(tiffPath, "w");
      writeExact(outputFd, header.buffer, 0);
      writeFitsRowsToTiff(inputFd, outputFd, meta, norm, header.pixelOffset);
      fs.closeSync(outputFd);
      outputFd = null;
      fs.closeSync(inputFd);
      inputFd = null;

      return {
        path: tiffPath,
        sourceMin: norm.sourceMin,
        sourceMax: norm.sourceMax,
        scale: norm.scale,
        mode: norm.mode,
        outputDepth: "16-bit unsigned RGB TIFF (streamed)"
      };
    } catch (e) {
      try { if (outputFd !== null) fs.closeSync(outputFd); } catch (_) {}
      try { if (inputFd !== null) fs.closeSync(inputFd); } catch (_) {}
      safeDelete(tiffPath);
      throw e;
    }
  }

  function readRgbTiffInfo(fd) {
    var fileSize = fs.fstatSync(fd).size;
    if (!isSafeNonNegativeInteger(fileSize) || fileSize < 8) {
      throw new Error("TIFF 파일이 너무 짧거나 크기가 올바르지 않습니다.");
    }
    var first = Buffer.alloc(8);
    readExact(fd, first, 0);
    if (first.toString("ascii", 0, 2) !== "II" || first.readUInt16LE(2) !== 42) {
      throw new Error("이 처리는 little-endian TIFF만 지원합니다.");
    }
    var ifdOffset = first.readUInt32LE(4);
    assertFileRange(ifdOffset, 2, fileSize, "TIFF IFD");
    var countBuffer = Buffer.alloc(2);
    readExact(fd, countBuffer, ifdOffset);
    var entryCount = countBuffer.readUInt16LE(0);
    var entriesBytes = checkedProduct([entryCount, 12], "TIFF IFD 항목");
    assertFileRange(ifdOffset + 2, entriesBytes + 4, fileSize, "TIFF IFD 항목");
    var entries = Buffer.alloc(entriesBytes);
    readExact(fd, entries, ifdOffset + 2);
    var info = {
      width: 0, height: 0, samples: 0, bits: 0, compression: 0,
      photometric: 0, planar: 1, rowsPerStrip: 0,
      sampleFormat: 1, stripOffsets: [], stripByteCounts: [], iccProfile: null
    };
    function dataForEntry(type, itemCount, entryAt) {
      var typeSizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1 };
      var size = typeSizes[type] || 0;
      if (!size) return Buffer.alloc(0);
      var bytes = checkedProduct([size, itemCount], "TIFF 태그 데이터");
      if (bytes > GX_MAX_TIFF_METADATA_BYTES) {
        throw new Error("TIFF 태그 데이터가 메모리 안전 제한(64MB)을 초과합니다.");
      }
      if (bytes <= 4) return entries.slice(entryAt + 8, entryAt + 8 + bytes);
      var valueOffset = entries.readUInt32LE(entryAt + 8);
      assertFileRange(valueOffset, bytes, fileSize, "TIFF 태그 데이터");
      var source = Buffer.alloc(bytes);
      readExact(fd, source, valueOffset);
      return source;
    }
    function valuesForEntry(type, itemCount, entryAt) {
      var size = type === 3 ? 2 : type === 4 ? 4 : 0;
      if (!size) return [];
      var source = dataForEntry(type, itemCount, entryAt);
      var result = [];
      for (var vi=0; vi<itemCount; vi++) {
        result.push(type === 3 ? source.readUInt16LE(vi * 2) : source.readUInt32LE(vi * 4));
      }
      return result;
    }
    for (var i=0; i<entryCount; i++) {
      var at = i * 12;
      var tag = entries.readUInt16LE(at);
      var type = entries.readUInt16LE(at + 2);
      var itemCount = entries.readUInt32LE(at + 4);
      if (tag !== 256 && tag !== 257 && tag !== 258 && tag !== 259 && tag !== 262 &&
          tag !== 273 && tag !== 277 && tag !== 278 && tag !== 279 && tag !== 284 &&
          tag !== 339 && tag !== 34675) continue;
      if (tag === 34675) {
        if (type !== 7 || itemCount < 128) throw new Error("TIFF ICC 프로파일 태그가 올바르지 않습니다.");
        var iccProfile = dataForEntry(type, itemCount, at);
        var declaredIccSize = iccProfile.readUInt32BE(0);
        if (iccProfile.toString("ascii", 36, 40) !== "acsp" ||
            declaredIccSize < 128 || declaredIccSize > iccProfile.length) {
          throw new Error("TIFF ICC 프로파일 데이터가 손상되었습니다.");
        }
        info.iccProfile = iccProfile;
        continue;
      }
      var values = valuesForEntry(type, itemCount, at);
      var value = values.length ? values[0] : 0;
      if (tag === 256) info.width = value;
      else if (tag === 257) info.height = value;
      else if (tag === 258) {
        info.bits = values.length && values.every(function(bit) { return bit === values[0]; })
          ? values[0] : 0;
      }
      else if (tag === 259) info.compression = value;
      else if (tag === 262) info.photometric = value;
      else if (tag === 273) info.stripOffsets = values;
      else if (tag === 277) info.samples = value;
      else if (tag === 278) info.rowsPerStrip = value;
      else if (tag === 279) info.stripByteCounts = values;
      else if (tag === 284) info.planar = value;
      else if (tag === 339) {
        info.sampleFormat = values.length && values.every(function(format) { return format === values[0]; })
          ? values[0] : 0;
      }
    }
    if (!info.rowsPerStrip) info.rowsPerStrip = info.height;
    var supportedSamples = (info.bits === 16 && info.sampleFormat === 1) ||
      (info.bits === 32 && info.sampleFormat === 3);
    if (!info.width || !info.height || !info.stripOffsets.length || info.samples !== 3 ||
        !supportedSamples || info.compression !== 1 || info.photometric !== 2 || info.planar !== 1 ||
        info.stripOffsets.length !== info.stripByteCounts.length ||
        !isSafeNonNegativeInteger(info.rowsPerStrip) || info.rowsPerStrip <= 0) {
      throw new Error("Neutralise는 비압축 16-bit unsigned 또는 32-bit float RGB TIFF만 지원합니다.");
    }
    info.bytesPerSample = info.bits / 8;
    info.rowBytes = checkedProduct([info.width, 3, info.bytesPerSample], "TIFF 행 버퍼");
    var rowBytes = info.rowBytes;
    if (rowBytes > GX_MAX_ROW_BUFFER_BYTES) {
      throw new Error("TIFF 한 행이 메모리 안전 제한(256MB)을 초과합니다.");
    }
    var pixelBytes = checkedProduct([info.width, info.height, 3, info.bytesPerSample], "TIFF 픽셀 데이터");
    if (pixelBytes > 0xFFFFFFFF - 1024) {
      throw new Error("이미지가 Classic TIFF 4GB 제한을 초과합니다.");
    }
    var requiredStrips = Math.ceil(info.height / info.rowsPerStrip);
    if (info.stripOffsets.length < requiredStrips) {
      throw new Error("TIFF strip 수가 이미지 높이에 비해 부족합니다.");
    }
    for (var stripIndex=0; stripIndex<info.stripOffsets.length; stripIndex++) {
      var stripOffset = info.stripOffsets[stripIndex];
      var stripByteCount = info.stripByteCounts[stripIndex];
      assertFileRange(stripOffset, stripByteCount, fileSize, "TIFF strip " + stripIndex);
      if (stripIndex < requiredStrips) {
        var firstRow = stripIndex * info.rowsPerStrip;
        var rowsInStrip = Math.min(info.rowsPerStrip, info.height - firstRow);
        var requiredBytes = checkedProduct([rowsInStrip, rowBytes], "TIFF strip 데이터");
        if (stripByteCount < requiredBytes) {
          throw new Error("TIFF strip 데이터 길이가 예상보다 짧습니다.");
        }
      }
    }
    return info;
  }

  function readUint16RgbTiffInfo(fd) {
    return readRgbTiffInfo(fd);
  }

  function rgbTiffRowPosition(info, rowIndex) {
    if (!isSafeNonNegativeInteger(rowIndex) || rowIndex >= info.height) {
      throw new Error("TIFF 행 번호가 이미지 범위를 벗어납니다.");
    }
    var stripIndex = Math.floor(rowIndex / info.rowsPerStrip);
    if (stripIndex >= info.stripOffsets.length) throw new Error("TIFF strip 정보가 올바르지 않습니다.");
    var rowInStrip = rowIndex - stripIndex * info.rowsPerStrip;
    var rowBytes = info.rowBytes || info.width * 6;
    if ((rowInStrip + 1) * rowBytes > info.stripByteCounts[stripIndex]) {
      throw new Error("TIFF strip 데이터 길이가 예상보다 짧습니다.");
    }
    return info.stripOffsets[stripIndex] + rowInStrip * rowBytes;
  }

  function createTiffPreviewBmp(tiffPath, bmpPath, maxWidth, maxHeight) {
    var inputFd = null;
    try {
      inputFd = fs.openSync(tiffPath, "r");
      var info = readRgbTiffInfo(inputFd);
      var widthLimit = Math.max(1, Math.floor(Number(maxWidth) || 1400));
      var heightLimit = Math.max(1, Math.floor(Number(maxHeight) || 900));
      var scale = Math.min(1, widthLimit / info.width, heightLimit / info.height);
      var previewWidth = Math.max(1, Math.round(info.width * scale));
      var previewHeight = Math.max(1, Math.round(info.height * scale));
      var bmpRowBytes = Math.ceil(previewWidth * 3 / 4) * 4;
      var pixelBytes = checkedProduct([bmpRowBytes, previewHeight], "Preview BMP 픽셀 데이터");
      var output = Buffer.alloc(54 + pixelBytes);
      output.write("BM", 0, 2, "ascii");
      output.writeUInt32LE(output.length, 2);
      output.writeUInt32LE(54, 10);
      output.writeUInt32LE(40, 14);
      output.writeInt32LE(previewWidth, 18);
      output.writeInt32LE(previewHeight, 22);
      output.writeUInt16LE(1, 26);
      output.writeUInt16LE(24, 28);
      output.writeUInt32LE(pixelBytes, 34);
      output.writeInt32LE(2835, 38);
      output.writeInt32LE(2835, 42);

      var sourceRow = Buffer.alloc(info.rowBytes);
      function sample8(offset) {
        if (info.bits === 16) return Math.round(sourceRow.readUInt16LE(offset) / 257);
        var value = sourceRow.readFloatLE(offset);
        if (!isFinite(value)) value = 0;
        return Math.round(Math.max(0, Math.min(1, value)) * 255);
      }
      for (var bmpY=0; bmpY<previewHeight; bmpY++) {
        var displayY = previewHeight - 1 - bmpY;
        var sourceY = previewHeight === 1 ? 0
          : Math.round(displayY * (info.height - 1) / (previewHeight - 1));
        readExact(inputFd, sourceRow, rgbTiffRowPosition(info, sourceY));
        var outputAt = 54 + bmpY * bmpRowBytes;
        for (var x=0; x<previewWidth; x++) {
          var sourceX = previewWidth === 1 ? 0
            : Math.round(x * (info.width - 1) / (previewWidth - 1));
          var sourceAt = sourceX * 3 * info.bytesPerSample;
          output[outputAt++] = sample8(sourceAt + 2 * info.bytesPerSample);
          output[outputAt++] = sample8(sourceAt + info.bytesPerSample);
          output[outputAt++] = sample8(sourceAt);
        }
      }
      fs.writeFileSync(bmpPath, output);
      fs.closeSync(inputFd);
      inputFd = null;
      return { path:bmpPath, width:previewWidth, height:previewHeight };
    } catch (error) {
      try { if (inputFd !== null) fs.closeSync(inputFd); } catch (_) {}
      safeDelete(bmpPath);
      throw error;
    }
  }

  function createGradientPreviewFile(importFile, workdir, stamp) {
    if (/\.tiff?$/i.test(importFile)) {
      var bmpPath = path.join(workdir, "editor_result_preview_" + stamp + ".bmp");
      createTiffPreviewBmp(importFile, bmpPath, 1400, 900);
      return bmpPath;
    }
    if (/\.(png|jpe?g|bmp)$/i.test(importFile)) return importFile;
    throw new Error("Editor Preview에서 지원하지 않는 결과 형식입니다: " + path.extname(importFile));
  }

  function normalizeNeutralStrength(value) {
    var strengthValue = Number(value);
    if (!isFinite(strengthValue)) strengthValue = 100;
    return Math.max(0, Math.min(100, strengthValue));
  }

  function medianFromUint16Histogram(histogram, total) {
    if (!total) throw new Error("Background Sample 픽셀이 없습니다.");
    var threshold = Math.floor((total - 1) / 2);
    var accumulated = 0;
    for (var i=0; i<histogram.length; i++) {
      accumulated += histogram[i];
      if (accumulated > threshold) return Math.min(65535, i * 16 + 8);
    }
    return 65535;
  }

  function medianOfNumbers(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function measureBackgroundAtPoints(inputFd, info, points, radiusValue, options) {
    options = options || {};
    var radius = Math.max(2, Math.min(200, Math.round(Number(radiusValue) || 25)));
    var validPoints = [];
    for (var i=0; i<points.length; i++) {
      var px = Math.round(Number(points[i].x));
      var py = Math.round(Number(points[i].y));
      var weight = neutralQualityWeight(points[i]);
      if (weight > 0 && isFinite(px) && isFinite(py) && px >= 0 && py >= 0 && px < info.width && py < info.height) {
        validPoints.push({ x:px, y:py, weight:weight, quality:points[i].quality || null });
      }
    }
    if (!validPoints.length) throw new Error("현재 문서 안에 사용할 수 있는 Background Point가 없습니다.");

    var estimated = validPoints.length * (radius * 2 + 1) * (radius * 2 + 1);
    var stride = Math.max(1, Math.ceil(Math.sqrt(estimated / 500000)));
    var row = Buffer.alloc(info.rowBytes || info.width * 6);
    var pointMeasurements = [];

    for (var pointIndex=0; pointIndex<validPoints.length; pointIndex++) {
      var point = validPoints[pointIndex];
      var pointHistograms = info.bits === 16
        ? [new Uint32Array(4096), new Uint32Array(4096), new Uint32Array(4096)] : null;
      var pointFloatValues = info.bits === 32 ? [[], [], []] : null;
      var pointSamples = 0;
      var minY = Math.max(0, point.y - radius);
      var maxY = Math.min(info.height - 1, point.y + radius);
      var minX = Math.max(0, point.x - radius);
      var maxX = Math.min(info.width - 1, point.x + radius);
      for (var y=minY; y<=maxY; y += stride) {
        readExact(inputFd, row, rgbTiffRowPosition(info, y));
        for (var x=minX; x<=maxX; x += stride) {
          var at = x * 3 * info.bytesPerSample;
          if (info.bits === 16) {
            pointHistograms[0][row.readUInt16LE(at) >>> 4]++;
            pointHistograms[1][row.readUInt16LE(at + 2) >>> 4]++;
            pointHistograms[2][row.readUInt16LE(at + 4) >>> 4]++;
            pointSamples++;
          } else {
            var floatRed = row.readFloatLE(at);
            var floatGreen = row.readFloatLE(at + 4);
            var floatBlue = row.readFloatLE(at + 8);
            if (!isFinite(floatRed) || !isFinite(floatGreen) || !isFinite(floatBlue)) continue;
            pointFloatValues[0].push(floatRed);
            pointFloatValues[1].push(floatGreen);
            pointFloatValues[2].push(floatBlue);
            pointSamples++;
          }
        }
      }
      if (!pointSamples) continue;
      var pointValues = info.bits === 16 ? [
          medianFromUint16Histogram(pointHistograms[0], pointSamples),
          medianFromUint16Histogram(pointHistograms[1], pointSamples),
          medianFromUint16Histogram(pointHistograms[2], pointSamples)
        ] : [
          medianOfNumbers(pointFloatValues[0]),
          medianOfNumbers(pointFloatValues[1]),
          medianOfNumbers(pointFloatValues[2])
        ];
      var channelSum = Math.max(1e-12, pointValues[0] + pointValues[1] + pointValues[2]);
      pointMeasurements.push({
        point:point,
        histograms:pointHistograms,
        samples:pointSamples,
        values:pointValues,
        chroma:[pointValues[0] / channelSum, pointValues[1] / channelSum, pointValues[2] / channelSum]
      });
    }

    var accepted = pointMeasurements;
    var rejectedColorCount = 0;
    var colorThreshold = 0;
    if (options.colorReject !== false && pointMeasurements.length >= 5) {
      var chromaCenter = [0, 0, 0];
      for (var color=0; color<3; color++) {
        var chromaValues = [];
        for (var chromaIndex=0; chromaIndex<pointMeasurements.length; chromaIndex++) {
          chromaValues.push(pointMeasurements[chromaIndex].chroma[color]);
        }
        chromaCenter[color] = medianOfNumbers(chromaValues);
      }
      var distances = [];
      for (var distanceIndex=0; distanceIndex<pointMeasurements.length; distanceIndex++) {
        var distance = 0;
        for (var dc=0; dc<3; dc++) {
          distance = Math.max(distance, Math.abs(pointMeasurements[distanceIndex].chroma[dc] - chromaCenter[dc]));
        }
        pointMeasurements[distanceIndex].colorDistance = distance;
        distances.push(distance);
      }
      var distanceCenter = medianOfNumbers(distances);
      var distanceDeviations = [];
      for (var deviationIndex=0; deviationIndex<distances.length; deviationIndex++) {
        distanceDeviations.push(Math.abs(distances[deviationIndex] - distanceCenter));
      }
      colorThreshold = Math.max(0.025,
        distanceCenter + 3 * 1.4826 * medianOfNumbers(distanceDeviations));
      accepted = [];
      for (var acceptIndex=0; acceptIndex<pointMeasurements.length; acceptIndex++) {
        if (pointMeasurements[acceptIndex].colorDistance <= colorThreshold) accepted.push(pointMeasurements[acceptIndex]);
        else rejectedColorCount++;
      }
    }

    var minimumPoints = Math.max(1, Math.round(Number(options.minimumPoints) || 1));
    if (accepted.length < minimumPoints) {
      throw new Error("RGB 색상 이상치 제거 후 안전한 Background 후보가 " + minimumPoints + "개 미만입니다.");
    }
    var histograms = info.bits === 16
      ? [new Float64Array(4096), new Float64Array(4096), new Float64Array(4096)] : null;
    var floatPointEntries = info.bits === 32 ? [[], [], []] : null;
    var weightedTotal = 0;
    var totalSamples = 0;
    for (var acceptedIndex=0; acceptedIndex<accepted.length; acceptedIndex++) {
      var acceptedPoint = accepted[acceptedIndex];
      var acceptedWeight = acceptedPoint.point.weight;
      weightedTotal += acceptedPoint.samples * acceptedWeight;
      totalSamples += acceptedPoint.samples;
      for (var aggregateColor=0; aggregateColor<3; aggregateColor++) {
        if (info.bits === 16) {
          for (var bin=0; bin<4096; bin++) {
            histograms[aggregateColor][bin] += acceptedPoint.histograms[aggregateColor][bin] * acceptedWeight;
          }
        } else {
          floatPointEntries[aggregateColor].push({
            value:acceptedPoint.values[aggregateColor], weight:acceptedWeight
          });
        }
      }
    }
    var measuredValues = info.bits === 16 ? [
        medianFromUint16Histogram(histograms[0], weightedTotal),
        medianFromUint16Histogram(histograms[1], weightedTotal),
        medianFromUint16Histogram(histograms[2], weightedTotal)
      ] : [
        weightedMedianEntries(floatPointEntries[0]),
        weightedMedianEntries(floatPointEntries[1]),
        weightedMedianEntries(floatPointEntries[2])
      ];
    return {
      values: measuredValues,
      samples: totalSamples,
      stride: stride,
      pointCount: accepted.length,
      candidateCount: validPoints.length,
      rejectedColorCount: rejectedColorCount,
      colorThreshold: colorThreshold,
      radius: radius,
      bits: info.bits,
      fullScale: info.bits === 32 ? 1 : 65535
    };
  }

  function neutralizeGeneratedTiff(sourcePath, destinationPath, points, radiusValue, strengthValue, options) {
    if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
      throw new Error("Neutralise 입력 TIFF와 출력 TIFF 경로는 서로 달라야 합니다.");
    }
    var strengthValueNormalized = normalizeNeutralStrength(strengthValue);
    var amount = strengthValueNormalized / 100;
    var inputFd = null;
    var outputFd = null;
    try {
      inputFd = fs.openSync(sourcePath, "r");
      var info = readRgbTiffInfo(inputFd);
      var measurement = measureBackgroundAtPoints(inputFd, info, points || [], radiusValue, options || {});
      var sorted = measurement.values.slice().sort(function(a, b) { return a - b; });
      var target = sorted[1];
      var offsets = [
        (target - measurement.values[0]) * amount,
        (target - measurement.values[1]) * amount,
        (target - measurement.values[2]) * amount
      ];
      var header = info.bits === 32
        ? createFloat32RgbTiffHeader(info.width, info.height, info.iccProfile)
        : createUint16RgbTiffHeader(info.width, info.height, info.iccProfile);
      var rowBytes = info.rowBytes;
      var row = Buffer.alloc(rowBytes);
      var clippedLow = [0, 0, 0];
      var clippedHigh = [0, 0, 0];
      outputFd = fs.openSync(destinationPath, "w");
      writeExact(outputFd, header.buffer, 0);

      for (var rowIndex=0; rowIndex<info.height; rowIndex++) {
        readExact(inputFd, row, rgbTiffRowPosition(info, rowIndex));
        for (var column=0; column<info.width; column++) {
          var pixelAt = column * 3 * info.bytesPerSample;
          for (var channel=0; channel<3; channel++) {
            var channelAt = pixelAt + channel * info.bytesPerSample;
            var sourceValue = info.bits === 32
              ? row.readFloatLE(channelAt) : row.readUInt16LE(channelAt);
            var correctedValue = sourceValue + offsets[channel];
            if (correctedValue < 0) clippedLow[channel]++;
            else if (correctedValue > measurement.fullScale) clippedHigh[channel]++;
            if (info.bits === 32) {
              row.writeFloatLE(correctedValue, channelAt);
            } else {
              var corrected = Math.max(0, Math.min(65535, Math.round(correctedValue)));
              row.writeUInt16LE(corrected, channelAt);
            }
          }
        }
        writeExact(outputFd, row, header.pixelOffset + rowIndex * rowBytes);
      }

      fs.closeSync(outputFd); outputFd = null;
      fs.closeSync(inputFd); inputFd = null;
      return {
        path: destinationPath,
        background: measurement.values,
        target: target,
        offsets: offsets,
        samples: measurement.samples,
        pointCount: measurement.pointCount,
        candidateCount: measurement.candidateCount,
        rejectedColorCount: measurement.rejectedColorCount,
        colorThreshold: measurement.colorThreshold,
        clippedLow: clippedLow,
        clippedHigh: clippedHigh,
        clippedLowTotal: clippedLow[0] + clippedLow[1] + clippedLow[2],
        clippedHighTotal: clippedHigh[0] + clippedHigh[1] + clippedHigh[2],
        pixelCount: info.width * info.height,
        radius: measurement.radius,
        stride: measurement.stride,
        strength: strengthValueNormalized,
        outputBits: info.bits,
        fullScale: measurement.fullScale,
        rangeExcursionsPreserved: info.bits === 32,
        iccProfilePreserved: !!info.iccProfile
      };
    } catch (error) {
      try { if (outputFd !== null) fs.closeSync(outputFd); } catch (_) {}
      try { if (inputFd !== null) fs.closeSync(inputFd); } catch (_) {}
      safeDelete(destinationPath);
      throw error;
    }
  }





  function createGradientPreferences(filePath, method, width, height) {
    var sampleSize = Math.max(2, Math.min(200,
      parseInt(document.getElementById("sampleSize").value, 10) || 25));
    var points = [];
    var usablePoints = usableSamplePoints(true);
    for (var i=0; i<usablePoints.length; i++) {
      points.push([usablePoints[i].x, usablePoints[i].y, 1]);
    }
    var preferences = {
      width: width,
      height: height,
      background_points: points,
      interpol_type_option: method,
      smoothing_option: Number(smoothing.value),
      sample_size: sampleSize,
      bg_pts_option: normalizePointsPerRow(document.getElementById("pointsPerRow").value),
      bg_tol_option: normalizeGridTolerance(document.getElementById("gridTolerance").value),
      display_pts: true,
      bg_flood_selection_option: false,
      RBF_kernel: "thin_plate",
      spline_order: 3,
      corr_type: selected("correction") || "Subtraction",
      ai_gpu_acceleration: document.getElementById("useGpu").checked
    };
    fs.writeFileSync(filePath, JSON.stringify(preferences, null, 2), "utf8");
    JSON.parse(fs.readFileSync(filePath, "utf8"));
    return preferences;
  }

  function appendOutputTail(current, chunk, limit) {
    var combined = current + String(chunk || "");
    return combined.length > limit ? combined.substring(combined.length - limit) : combined;
  }

  function spawnGraXpertProcess(cpModule, exe, args, options, callback) {
    options = options || {};
    var timeoutMs = Math.max(1000, Number(options.timeoutMs) || GRAXPERT_INACTIVITY_TIMEOUT_MS);
    var outputLimit = Math.max(4096, Number(options.outputLimit) || 256 * 1024);
    var setTimer = options.setTimeout || setTimeout;
    var clearTimer = options.clearTimeout || clearTimeout;
    var stdoutTail = "";
    var stderrTail = "";
    var timeoutHandle = null;
    var terminationFallbackHandle = null;
    var finished = false;
    var terminationCode = "";
    var child = null;

    function finish(error) {
      if (finished) return;
      finished = true;
      if (timeoutHandle !== null) clearTimer(timeoutHandle);
      if (terminationFallbackHandle !== null) clearTimer(terminationFallbackHandle);
      callback(error || null, stdoutTail, stderrTail);
    }

    function resetInactivityTimeout() {
      if (timeoutHandle !== null) clearTimer(timeoutHandle);
      timeoutHandle = setTimer(function() {
        if (finished) return;
        terminationCode = "GX_TIMEOUT";
        try {
          if (!child || child.kill() === false) {
            var timeoutError = new Error("GraXpert가 30분 동안 출력을 보내지 않아 처리를 중단했습니다.");
            timeoutError.gxCode = terminationCode;
            finish(timeoutError);
          } else {
            terminationFallbackHandle = setTimer(function() {
              var timeoutFallbackError = new Error("GraXpert가 취소 신호 후에도 종료되지 않았습니다.");
              timeoutFallbackError.gxCode = "GX_TERMINATE_FAILED";
              finish(timeoutFallbackError);
            }, 5000);
          }
        } catch (killError) {
          killError.gxCode = terminationCode;
          finish(killError);
        }
      }, timeoutMs);
    }

    try {
      child = cpModule.spawn(exe, args, { windowsHide:true, stdio:["ignore", "pipe", "pipe"] });
    } catch (spawnError) {
      spawnError.gxCode = "GX_START_FAILED";
      finish(spawnError);
      return { cancel:function() {}, child:null };
    }

    function receiveOutput(kind, chunk) {
      if (kind === "stdout") stdoutTail = appendOutputTail(stdoutTail, chunk, outputLimit);
      else stderrTail = appendOutputTail(stderrTail, chunk, outputLimit);
      resetInactivityTimeout();
      if (options.onOutput) options.onOutput(String(chunk || ""), kind);
    }
    if (child.stdout && child.stdout.on) child.stdout.on("data", function(chunk) { receiveOutput("stdout", chunk); });
    if (child.stderr && child.stderr.on) child.stderr.on("data", function(chunk) { receiveOutput("stderr", chunk); });
    child.on("error", function(error) {
      error.gxCode = terminationCode || "GX_PROCESS_ERROR";
      finish(error);
    });
    child.on("close", function(code, signal) {
      if (terminationCode) {
        var stoppedMessage = terminationCode === "GX_CANCELLED"
          ? "사용자가 GraXpert 처리를 취소했습니다."
          : "GraXpert가 30분 동안 출력을 보내지 않아 처리를 중단했습니다.";
        var stoppedError = new Error(stoppedMessage);
        stoppedError.gxCode = terminationCode;
        finish(stoppedError);
        return;
      }
      if (code !== 0) {
        var processError = new Error("GraXpert가 종료 코드 " + code + "로 끝났습니다." +
          (signal ? " Signal=" + signal : ""));
        processError.gxCode = "GX_EXIT_ERROR";
        finish(processError);
        return;
      }
      finish(null);
    });
    resetInactivityTimeout();

    return {
      child: child,
      cancel: function() {
        if (finished || terminationCode) return;
        terminationCode = "GX_CANCELLED";
        try {
          if (child.kill() === false) {
            var cancelError = new Error("GraXpert 프로세스에 취소 신호를 보내지 못했습니다.");
            cancelError.gxCode = terminationCode;
            finish(cancelError);
          } else {
            terminationFallbackHandle = setTimer(function() {
              var cancelFallbackError = new Error("GraXpert가 취소 신호 후에도 종료되지 않았습니다.");
              cancelFallbackError.gxCode = "GX_TERMINATE_FAILED";
              finish(cancelFallbackError);
            }, 5000);
          }
        } catch (cancelFailure) {
          cancelFailure.gxCode = terminationCode;
          finish(cancelFailure);
        }
      }
    };
  }

  function runGraXpert(input, outputBase, preferencesFile, callback, options) {
    options = options || {};
    var exe = exePath.value.trim() || defaultGraXpertExecutable();
    var args = buildGraXpertArgs(input, outputBase, preferencesFile);
    var lastOutputUpdateAt = 0;
    var controller = null;
    var completedBeforeAssignment = false;
    controller = spawnGraXpertProcess(cp, exe, args, {
      timeoutMs: GRAXPERT_INACTIVITY_TIMEOUT_MS,
      onOutput: function(chunk) {
        var now = Date.now();
        if (now - lastOutputUpdateAt < 500) return;
        lastOutputUpdateAt = now;
        var lines = String(chunk || "").replace(/\r/g, "").split("\n");
        var latest = "";
        for (var i=lines.length - 1; i>=0; i--) {
          if (lines[i].trim()) { latest = lines[i].trim(); break; }
        }
        if (latest && !options.editorOnly) {
          setProgress(55, "GraXpert 처리 중…\n" + latest.substring(0, 180));
        }
      }
    }, function(error, stdout, stderr) {
      completedBeforeAssignment = true;
      if (activeGraXpertController === controller) activeGraXpertController = null;
      if (!options.editorOnly) setCancelAvailable(false);
      callback(error, stdout || "", stderr || "");
    });
    if (!completedBeforeAssignment) {
      activeGraXpertController = controller;
      if (!options.editorOnly) setCancelAvailable(true);
    }
    return controller;
  }

  function buildGraXpertArgs(input, outputBase, preferencesFile) {
    var gpu = document.getElementById("useGpu").checked ? "true" : "false";
    var args;

    if (mode === "background") {
      args = [
        "-cmd", "background-extraction",
        input,
        "-cli",
        "-gpu", gpu,
        "-correction", selected("correction") || "Subtraction",
        "-smoothing", Number(smoothing.value).toFixed(2),
        "-output", outputBase
      ];

      if (document.getElementById("addBackgroundLayer").checked) {
        args.push("-bg");
      }
      if (preferencesFile) {
        args.push("-preferences_file", preferencesFile);
      }
    } else {
      args = [
        "-cmd", "denoising",
        input,
        "-cli",
        "-gpu", gpu,
        "-strength", Number(strength.value).toFixed(2),
        "-batch_size", document.getElementById("batchSize").value,
        "-output", outputBase
      ];
    }

    return args;
  }


  function safeDelete(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }

  function parsePhotoshopExport(result) {
    var parts = String(result || "").split("|");
    if (parts[0] !== "OK" || parts.length < 6) {
      throw new Error("Photoshop 내보내기 응답 형식이 올바르지 않습니다: " + result);
    }
    var info = {
      docId: parseInt(parts[1], 10),
      width: parseInt(parts[2], 10),
      height: parseInt(parts[3], 10),
      maskToken: parts[4] || "",
      sourceLayerId: -1,
      analysisContext: "",
      docName: ""
    };
    var nameIndex = 5;
    if (parts.length >= 7 && /^L:-?\d+$/.test(parts[5])) {
      info.sourceLayerId = parseInt(parts[5].substring(2), 10);
      nameIndex = 6;
    }
    if (parts.length > nameIndex && parts[nameIndex].indexOf("C:") === 0) {
      try { info.analysisContext = decodeURIComponent(parts[nameIndex].substring(2)); }
      catch (_) { throw new Error("Photoshop 분석 영역 정보가 올바르지 않습니다."); }
      nameIndex++;
    }
    info.docName = parts.slice(nameIndex).join("|");
    if (!isFinite(info.docId) || !isFinite(info.width) || !isFinite(info.height)) {
      throw new Error("Photoshop 문서 식별 정보가 올바르지 않습니다: " + result);
    }
    return info;
  }

  function previewContextError(preview, exportInfo, expectedMode, expectedScope) {
    var retry = " Preview를 다시 준비하세요.";
    if (!preview || preview.mode !== expectedMode || preview.scope !== expectedScope) {
      return "Sample Preview의 작업 모드 또는 처리 범위가 변경되었습니다." + retry;
    }
    if (preview.docId !== exportInfo.docId ||
        preview.originalWidth !== exportInfo.width || preview.originalHeight !== exportInfo.height) {
      return "Sample Preview를 만든 Photoshop 문서 또는 이미지 크기가 변경되었습니다." + retry;
    }
    if (preview.sourceLayerId !== exportInfo.sourceLayerId) {
      return "Sample Preview를 만든 현재 레이어가 변경되었습니다." + retry;
    }
    if (preview.analysisContext !== exportInfo.analysisContext) {
      return "Sample Preview를 만든 뒤 Photoshop 선택 영역 또는 레이어 마스크가 변경되었습니다." + retry;
    }
    return "";
  }

  function discardPhotoshopMask(documentId, maskToken) {
    if (!documentId || !maskToken) return;
    evalPS(
      'GX_discardMask(' + Number(documentId) + ',"' + escJs(maskToken) + '")',
      function() {}
    );
  }

  function cleanupSuccessfulWork(input, output, importFile, conversionFile, preferencesFile) {
    // Successful jobs are cleaned immediately.
    // On failures, files are intentionally kept for troubleshooting.
    safeDelete(input);

    if (output && output !== importFile) {
      safeDelete(output);
    }

    safeDelete(importFile);
    safeDelete(conversionFile);
    safeDelete(preferencesFile);
    if (previewState && previewState.gradientInputFile) safeDelete(previewState.gradientInputFile);
    safeDelete(previewFile);
    safeDelete(maskFile);
    previewFile = "";
    maskFile = "";
  }

  function cleanupAbortedWork(input, outputBase, conversionFile, preferencesFile) {
    safeDelete(input);
    safeDelete(conversionFile);
    safeDelete(preferencesFile);
    try {
      var outputDirectory = path.dirname(outputBase);
      var outputPrefix = path.basename(outputBase).toLowerCase();
      var outputNames = fs.readdirSync(outputDirectory);
      for (var i=0; i<outputNames.length; i++) {
        if (outputNames[i].toLowerCase().indexOf(outputPrefix) === 0) {
          var outputPath = path.join(outputDirectory, outputNames[i]);
          if (fs.statSync(outputPath).isFile()) safeDelete(outputPath);
        }
      }
    } catch (_) {}
  }

  function cleanupGradientResultJob(job) {
    if (!job) return;
    safeDelete(job.input);
    if (job.output && job.output !== job.importFile) safeDelete(job.output);
    safeDelete(job.importFile);
    safeDelete(job.previewFile);
    safeDelete(job.conversionFile);
    safeDelete(job.preferencesFile);
    safeDelete(job.backgroundOutput);
  }

  function refreshGradientResultContextStatus() {
    if (!gradientResultJob || gradientResultBusy || mode !== "background") return;
    var checkedJob = gradientResultJob;
    evalPS(
      'GX_validateProcessingContext(' + checkedJob.docId + ',' + checkedJob.sourceLayerId + ',' +
        checkedJob.width + ',' + checkedJob.height + ',"' + escJs(checkedJob.analysisContext) +
        '","layer-auto")',
      function(error, result) {
      if (gradientResultJob !== checkedJob) return;
      var valid = !error && result === "OK";
      if (gradientResultContextValid !== valid) {
        gradientResultContextValid = valid;
        if (valid) gradientResultMessage = "전체 해상도 결과가 준비되었습니다. 확인 후 Photoshop에 적용하세요.";
        dispatchSampleEditorState();
      }
    });
  }

  function releaseGradientResultPreview() {
    if (gradientResultBusy) {
      cancelGradientResultPreview();
      return;
    }
    cleanupGradientResultJob(gradientResultJob);
    gradientResultJob = null;
    gradientResultContextValid = true;
    gradientResultMessage = "결과 미리보기 전";
    dispatchSampleEditorState();
  }

  function cancelGradientResultPreview() {
    if (!gradientResultBusy || !activeGraXpertController) return;
    gradientResultMessage = "GraXpert 처리를 취소하는 중…";
    dispatchSampleEditorState();
    activeGraXpertController.cancel();
  }

  function validateGradientResultRequest() {
    if (mode !== "background") return "Background Extraction 탭에서 실행하세요.";
    if (!previewState || !previewImage || previewState.mode !== "background") {
      return "먼저 포인트 자동 생성으로 Preview를 준비하세요.";
    }
    var method = currentGradientMethod();
    if (method === "AI") return "Gradient Editor 결과 확인은 배경 포인트 방식에서 사용할 수 있습니다.";
    var minimumPoints = method === "Splines" ? 16 : 3;
    var usableCount = usableSamplePoints(true).length;
    if (usableCount < minimumPoints) {
      return method + " 실행에는 초록색 적합 Point가 최소 " + minimumPoints +
        "개 필요합니다. 현재 " + usableCount + "개입니다.";
    }
    return "";
  }

  function prepareGradientResultInput(inputPath, callback) {
    var cachedInput = previewState && previewState.gradientInputFile;
    if (!cachedInput || !fs.existsSync(cachedInput)) {
      evalPS('GX_exportInput("' + escJs(inputPath) + '","layer","layer-auto")', function(error, result) {
        if (error || !result || result.indexOf("OK|") !== 0) {
          callback(new Error(error || result || "Photoshop 입력 준비 실패"));
          return;
        }
        try { callback(null, parsePhotoshopExport(result)); }
        catch (parseError) { callback(parseError); }
      });
      return;
    }
    evalPS(
      'GX_validateProcessingContext(' + previewState.docId + ',' + previewState.sourceLayerId + ',' +
        previewState.originalWidth + ',' + previewState.originalHeight + ',"' +
        escJs(previewState.analysisContext) + '","layer-auto")',
      function(error, result) {
        if (error || result !== "OK") {
          callback(new Error(error || result || "Sample Preview 작업 문맥 확인 실패"));
          return;
        }
        try {
          fs.copyFileSync(cachedInput, inputPath);
          callback(null, {
            docId:previewState.docId,
            width:previewState.originalWidth,
            height:previewState.originalHeight,
            maskToken:"",
            sourceLayerId:previewState.sourceLayerId,
            analysisContext:previewState.analysisContext,
            docName:previewState.docName || ""
          });
        } catch (copyError) { callback(copyError); }
      }
    );
  }

  function thinPlateKernel(distanceSquared) {
    if (distanceSquared <= 1e-14) return 0;
    return 0.5 * distanceSquared * Math.log(distanceSquared);
  }

  function solveLocalRbf(samples, smoothingValue) {
    var count = samples.length;
    var size = count + 3;
    var matrix = [];
    var rhsColumns = 3;
    var rowLength = size + rhsColumns;
    var regularization = Math.max(1e-7, Math.min(1, Number(smoothingValue) || 0) * 0.02);
    var row, column;
    for (row=0; row<size; row++) matrix[row] = new Float64Array(rowLength);
    for (row=0; row<count; row++) {
      for (column=0; column<count; column++) {
        var dx = samples[row].x - samples[column].x;
        var dy = samples[row].y - samples[column].y;
        matrix[row][column] = thinPlateKernel(dx * dx + dy * dy);
      }
      matrix[row][row] += regularization;
      matrix[row][count] = 1;
      matrix[row][count + 1] = samples[row].x;
      matrix[row][count + 2] = samples[row].y;
      matrix[count][row] = 1;
      matrix[count + 1][row] = samples[row].x;
      matrix[count + 2][row] = samples[row].y;
      for (column=0; column<rhsColumns; column++) {
        matrix[row][size + column] = samples[row].rgb[column];
      }
    }

    for (column=0; column<size; column++) {
      var pivot = column;
      var pivotMagnitude = Math.abs(matrix[pivot][column]);
      for (row=column + 1; row<size; row++) {
        var magnitude = Math.abs(matrix[row][column]);
        if (magnitude > pivotMagnitude) {
          pivot = row;
          pivotMagnitude = magnitude;
        }
      }
      if (pivotMagnitude < 1e-12) throw new Error("빠른 RBF 모델을 계산할 수 없습니다. 포인트 위치를 조정하세요.");
      if (pivot !== column) {
        var swap = matrix[column];
        matrix[column] = matrix[pivot];
        matrix[pivot] = swap;
      }
      var pivotValue = matrix[column][column];
      for (var normalizeAt=column; normalizeAt<rowLength; normalizeAt++) {
        matrix[column][normalizeAt] /= pivotValue;
      }
      for (row=0; row<size; row++) {
        if (row === column) continue;
        var factor = matrix[row][column];
        if (Math.abs(factor) < 1e-15) continue;
        for (var eliminateAt=column; eliminateAt<rowLength; eliminateAt++) {
          matrix[row][eliminateAt] -= factor * matrix[column][eliminateAt];
        }
      }
    }

    var coefficients = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
    for (row=0; row<size; row++) {
      for (column=0; column<rhsColumns; column++) {
        coefficients[column][row] = matrix[row][size + column];
      }
    }
    return coefficients;
  }

  function localSampleRgb(point, radius, imageData, imageState) {
    var centerX = Math.round(point.x / Math.max(1, imageState.originalWidth - 1) *
      Math.max(1, imageData.width - 1));
    var centerY = Math.round(point.y / Math.max(1, imageState.originalHeight - 1) *
      Math.max(1, imageData.height - 1));
    var radiusX = Math.max(1, Math.round(radius / Math.max(1, imageState.originalWidth) * imageData.width));
    var radiusY = Math.max(1, Math.round(radius / Math.max(1, imageState.originalHeight) * imageData.height));
    var channels = [[], [], []];
    for (var y=Math.max(0, centerY - radiusY); y<=Math.min(imageData.height - 1, centerY + radiusY); y++) {
      for (var x=Math.max(0, centerX - radiusX); x<=Math.min(imageData.width - 1, centerX + radiusX); x++) {
        var dx = (x - centerX) / radiusX;
        var dy = (y - centerY) / radiusY;
        if (dx * dx + dy * dy > 1) continue;
        var at = (y * imageData.width + x) * 4;
        channels[0].push(imageData.data[at]);
        channels[1].push(imageData.data[at + 1]);
        channels[2].push(imageData.data[at + 2]);
      }
    }
    return [medianNumberList(channels[0]), medianNumberList(channels[1]), medianNumberList(channels[2])];
  }

  function evaluateLocalRbf(samples, coefficients, x, y, channel) {
    var count = samples.length;
    var value = coefficients[channel][count] + coefficients[channel][count + 1] * x +
      coefficients[channel][count + 2] * y;
    for (var index=0; index<count; index++) {
      var dx = x - samples[index].x;
      var dy = y - samples[index].y;
      value += coefficients[channel][index] * thinPlateKernel(dx * dx + dy * dy);
    }
    return value;
  }

  function evaluateLocalIdw(samples, x, y, channel, smoothingValue) {
    var weighted = 0;
    var weights = 0;
    var softening = 1e-6 + Math.max(0, Number(smoothingValue) || 0) * 0.002;
    for (var index=0; index<samples.length; index++) {
      var dx = x - samples[index].x;
      var dy = y - samples[index].y;
      var distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < 1e-12) return samples[index].rgb[channel];
      var weight = 1 / (distanceSquared + softening);
      weighted += samples[index].rgb[channel] * weight;
      weights += weight;
    }
    return weights ? weighted / weights : 0;
  }

  function createLocalGradientPreviewPixels(imageData, imageState, points, sampleRadius,
      smoothingValue, correction) {
    if (!imageData || !imageState || !points || points.length < 3) {
      throw new Error("빠른 미리보기에는 최소 3개의 Sample Point가 필요합니다.");
    }
    var samples = [];
    var targets = [[], [], []];
    for (var index=0; index<points.length; index++) {
      var rgb = localSampleRgb(points[index], sampleRadius, imageData, imageState);
      var sample = {
        x: points[index].x / Math.max(1, imageState.originalWidth - 1),
        y: points[index].y / Math.max(1, imageState.originalHeight - 1),
        rgb: rgb
      };
      samples.push(sample);
      for (var channel=0; channel<3; channel++) targets[channel].push(rgb[channel]);
    }
    var target = [medianNumberList(targets[0]), medianNumberList(targets[1]), medianNumberList(targets[2])];
    var coefficients = null;
    try { coefficients = solveLocalRbf(samples, smoothingValue); }
    catch (_) { coefficients = null; }
    var gridWidth = Math.min(96, imageData.width);
    var gridHeight = Math.min(96, imageData.height);
    var model = [new Float64Array(gridWidth * gridHeight), new Float64Array(gridWidth * gridHeight),
      new Float64Array(gridWidth * gridHeight)];
    var gx, gy;
    for (gy=0; gy<gridHeight; gy++) {
      var normalizedY = gy / Math.max(1, gridHeight - 1);
      for (gx=0; gx<gridWidth; gx++) {
        var normalizedX = gx / Math.max(1, gridWidth - 1);
        var gridAt = gy * gridWidth + gx;
        for (channel=0; channel<3; channel++) {
          model[channel][gridAt] = coefficients
            ? evaluateLocalRbf(samples, coefficients, normalizedX, normalizedY, channel)
            : evaluateLocalIdw(samples, normalizedX, normalizedY, channel, smoothingValue);
        }
      }
    }

    var output = new Uint8ClampedArray(imageData.data.length);
    var division = String(correction || "Subtraction").toLowerCase() === "division";
    for (var py=0; py<imageData.height; py++) {
      var modelY = py / Math.max(1, imageData.height - 1) * Math.max(1, gridHeight - 1);
      var y0 = Math.floor(modelY), y1 = Math.min(gridHeight - 1, y0 + 1), fy = modelY - y0;
      for (var px=0; px<imageData.width; px++) {
        var modelX = px / Math.max(1, imageData.width - 1) * Math.max(1, gridWidth - 1);
        var x0 = Math.floor(modelX), x1 = Math.min(gridWidth - 1, x0 + 1), fx = modelX - x0;
        var outputAt = (py * imageData.width + px) * 4;
        for (channel=0; channel<3; channel++) {
          var top = model[channel][y0 * gridWidth + x0] * (1 - fx) + model[channel][y0 * gridWidth + x1] * fx;
          var bottom = model[channel][y1 * gridWidth + x0] * (1 - fx) + model[channel][y1 * gridWidth + x1] * fx;
          var background = top * (1 - fy) + bottom * fy;
          var source = imageData.data[outputAt + channel];
          var corrected;
          if (division) {
            var scale = target[channel] / Math.max(1, background);
            corrected = source * Math.max(0.25, Math.min(4, scale));
          } else {
            corrected = source - background + target[channel];
          }
          output[outputAt + channel] = Math.max(0, Math.min(255, Math.round(corrected)));
        }
        output[outputAt + 3] = imageData.data[outputAt + 3];
      }
    }
    return {
      width:imageData.width, height:imageData.height, data:output,
      sampleCount:samples.length, interpolation:coefficients ? "RBF" : "IDW"
    };
  }

  function writePreviewPixelsPng(imageData, destinationPath) {
    var canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    var context = canvas.getContext("2d");
    var canvasData = context.createImageData(imageData.width, imageData.height);
    canvasData.data.set(imageData.data);
    context.putImageData(canvasData, 0, 0);
    var encoded = canvas.toDataURL("image/png").split(",")[1];
    fs.writeFileSync(destinationPath, Buffer.from(encoded, "base64"));
  }

  function createGradientResultPreview() {
    clearMsg();
    var requestError = validateGradientResultRequest();
    if (requestError) {
      gradientResultMessage = requestError;
      showError(requestError);
      dispatchSampleEditorState();
      return;
    }
    if (gradientResultBusy) return;
    if (!fs || !os || !path) {
      gradientResultMessage = "Node.js 모듈을 사용할 수 없습니다.";
      dispatchSampleEditorState();
      return;
    }

    cleanupGradientResultJob(gradientResultJob);
    gradientResultJob = null;
    gradientResultContextValid = true;
    gradientResultBusy = true;
    gradientResultMessage = "패널에서 빠른 RBF 미리보기를 계산하고 있습니다…";
    setGradientEditorBusy(true);
    dispatchSampleEditorState();

    setTimeout(function() {
      var stamp = Date.now();
      var workdir = path.join(os.tmpdir(), "GraXpert_Photoshop");
      var outputFile = path.join(workdir, "editor_fast_preview_" + stamp + ".png");
      try {
        if (!fs.existsSync(workdir)) fs.mkdirSync(workdir, { recursive:true });
        var points = usableSamplePoints(true);
        var sampleRadius = Math.max(2, Math.min(200,
          parseInt(document.getElementById("sampleSize").value, 10) || 25));
        var localResult = createLocalGradientPreviewPixels(
          previewPixels, previewState, points, sampleRadius, Number(smoothing.value),
          selected("correction") || "Subtraction"
        );
        writePreviewPixelsPng(localResult, outputFile);
        gradientResultJob = {
          signature:gradientResultSignature(),
          localPreview:true,
          importFile:"",
          previewFile:outputFile,
          output:"",
          backgroundOutput:"",
          addBackgroundLayer:!!document.getElementById("addBackgroundLayer").checked,
          conversionFile:"",
          preferencesFile:"",
          input:"",
          docId:previewState.docId,
          docName:previewState.docName || "",
          sourceLayerId:previewState.sourceLayerId,
          width:previewState.originalWidth,
          height:previewState.originalHeight,
          analysisContext:previewState.analysisContext,
          method:currentGradientMethod(),
          localInterpolation:localResult.interpolation,
          stamp:stamp
        };
        gradientResultMessage = "빠른 " + localResult.interpolation +
          " 미리보기입니다. Photoshop 적용 시 GraXpert가 전체 해상도로 최종 계산합니다.";
        showOk(gradientResultMessage);
      } catch (localPreviewError) {
        safeDelete(outputFile);
        gradientResultMessage = "빠른 미리보기 생성 실패: " + localPreviewError.message;
        showError(gradientResultMessage);
      }
      gradientResultBusy = false;
      setGradientEditorBusy(false);
      dispatchSampleEditorState();
    }, 20);
  }

  function createGradientFullResolutionResult(onReady) {
    clearMsg();
    var requestError = validateGradientResultRequest();
    if (requestError) {
      gradientResultMessage = requestError;
      showError(requestError);
      dispatchSampleEditorState();
      return;
    }
    if (gradientResultBusy) return;
    if (activeGraXpertController) {
      gradientResultMessage = "다른 GraXpert 처리가 진행 중입니다.";
      dispatchSampleEditorState();
      return;
    }
    if (!fs || !os || !path || !cp) {
      gradientResultMessage = "Node.js 모듈을 사용할 수 없습니다.";
      dispatchSampleEditorState();
      return;
    }

    cleanupGradientResultJob(gradientResultJob);
    gradientResultJob = null;
    gradientResultContextValid = true;
    gradientResultBusy = true;
    gradientResultMessage = "전체 해상도 입력을 준비하고 있습니다…";
    dispatchSampleEditorState();

    var stamp = Date.now();
    var workdir = path.join(os.tmpdir(), "GraXpert_Photoshop");
    try {
      if (!fs.existsSync(workdir)) fs.mkdirSync(workdir, { recursive:true });
    } catch (folderError) {
      gradientResultBusy = false;
      gradientResultMessage = "임시 폴더 생성 실패: " + folderError.message;
      dispatchSampleEditorState();
      return;
    }
    var input = path.join(workdir, "editor_input_" + stamp + ".tif");
    var outputBase = path.join(workdir, "editor_output_" + stamp);
    var preferencesFile = path.join(workdir, "editor_preferences_" + stamp + ".json");
    var conversionFile = path.join(workdir, "editor_conversion_" + stamp + ".txt");
    var signature = gradientResultSignature();

    setGradientEditorBusy(true);
    prepareGradientResultInput(
      input,
      function(exportError, exportInfo) {
        if (exportError) {
          gradientResultBusy = false;
          setGradientEditorBusy(false);
          safeDelete(input);
          gradientResultMessage = "Photoshop 입력 준비 실패: " + exportError.message;
          showError(gradientResultMessage);
          dispatchSampleEditorState();
          return;
        }
        try {
          var contextError = previewContextError(previewState, exportInfo, "background", "layer-auto");
          if (contextError) throw new Error(contextError);
          createGradientPreferences(
            preferencesFile, currentGradientMethod(), exportInfo.width, exportInfo.height
          );
        } catch (prepareError) {
          gradientResultBusy = false;
          setGradientEditorBusy(false);
          safeDelete(input);
          safeDelete(preferencesFile);
          gradientResultMessage = prepareError.message;
          showError(gradientResultMessage);
          dispatchSampleEditorState();
          return;
        }

        gradientResultMessage = "GraXpert가 전체 해상도 결과를 처리하고 있습니다…";
        dispatchSampleEditorState();
        runGraXpert(input, outputBase, preferencesFile, function(processError, stdout, stderr) {
          if (processError) {
            gradientResultBusy = false;
            setGradientEditorBusy(false);
            cleanupAbortedWork(input, outputBase, conversionFile, preferencesFile);
            gradientResultMessage = processError.gxCode === "GX_CANCELLED"
              ? "결과 미리보기 생성이 취소되었습니다."
              : "GraXpert 처리 실패: " + processError.message;
            if (processError.gxCode !== "GX_CANCELLED") showError(
              gradientResultMessage + ((stderr || stdout) ? "\n\n" + (stderr || stdout) : "")
            );
            dispatchSampleEditorState();
            return;
          }

          var output = findOutput(outputBase);
          if (!output) {
            gradientResultBusy = false;
            setGradientEditorBusy(false);
            cleanupAbortedWork(input, outputBase, conversionFile, preferencesFile);
            gradientResultMessage = "GraXpert 결과 파일을 찾지 못했습니다.";
            showError(gradientResultMessage);
            dispatchSampleEditorState();
            return;
          }
          var importFile = output;
          try {
            if (/\.(fits|fit|fts)$/i.test(output)) {
              importFile = path.join(workdir, "editor_result_" + stamp + ".tif");
              convertFitsToTiff(output, importFile);
            }
          } catch (conversionError) {
            gradientResultBusy = false;
            setGradientEditorBusy(false);
            cleanupAbortedWork(input, outputBase, conversionFile, preferencesFile);
            safeDelete(importFile);
            gradientResultMessage = "결과 변환 실패: " + conversionError.message;
            showError(gradientResultMessage);
            dispatchSampleEditorState();
            return;
          }

          var processedPreviewFile = "";
          try {
            processedPreviewFile = createGradientPreviewFile(importFile, workdir, stamp);
          } catch (previewError) {
            gradientResultBusy = false;
            setGradientEditorBusy(false);
            cleanupAbortedWork(input, outputBase, conversionFile, preferencesFile);
            safeDelete(importFile);
            safeDelete(processedPreviewFile);
            gradientResultMessage = "결과 Preview 생성 실패: " + previewError.message;
            showError(gradientResultMessage);
            dispatchSampleEditorState();
            return;
          }
          gradientResultBusy = false;
          setGradientEditorBusy(false);
          safeDelete(input);
          safeDelete(preferencesFile);
          if (output !== importFile) safeDelete(output);
          gradientResultJob = {
            signature:signature,
            importFile:importFile,
            previewFile:processedPreviewFile,
            output:importFile,
            backgroundOutput:findBackgroundOutput(outputBase),
            addBackgroundLayer:!!document.getElementById("addBackgroundLayer").checked,
            conversionFile:conversionFile,
            preferencesFile:"",
            input:"",
            docId:exportInfo.docId,
            docName:exportInfo.docName,
            sourceLayerId:exportInfo.sourceLayerId,
            width:exportInfo.width,
            height:exportInfo.height,
            analysisContext:exportInfo.analysisContext,
            method:currentGradientMethod(),
            stamp:stamp
          };
          gradientResultContextValid = true;
          gradientResultMessage = "전체 해상도 결과가 준비되었습니다. 확인 후 Photoshop에 적용하세요.";
          showOk(gradientResultMessage);
          dispatchSampleEditorState();
          if (typeof onReady === "function") setTimeout(onReady, 0);
        }, { editorOnly:true });
        dispatchSampleEditorState();
      }
    );
  }

  function applyGradientResultPreview() {
    if (gradientResultBusy || !gradientResultJob) return;
    if (gradientResultJob.signature !== gradientResultSignature()) {
      gradientResultMessage = "포인트 또는 설정이 변경되었습니다. 결과를 다시 계산하세요.";
      dispatchSampleEditorState();
      return;
    }
    if (gradientResultJob.localPreview) {
      gradientResultMessage = "GraXpert가 Photoshop 적용용 전체 해상도 결과를 계산합니다…";
      dispatchSampleEditorState();
      createGradientFullResolutionResult(function() {
        applyGradientResultPreview();
      });
      return;
    }
    var job = gradientResultJob;
    gradientResultBusy = true;
    setGradientEditorBusy(true);
    gradientResultMessage = "Photoshop 작업 문맥을 확인하고 있습니다…";
    dispatchSampleEditorState();
    evalPS(
      'GX_validateProcessingContext(' + job.docId + ',' + job.sourceLayerId + ',' +
        job.width + ',' + job.height + ',"' + escJs(job.analysisContext) + '","layer-auto")',
      function(validationError, validationResult) {
        if (validationError || validationResult !== "OK") {
          gradientResultBusy = false;
          setGradientEditorBusy(false);
          gradientResultContextValid = false;
          gradientResultMessage = validationError || validationResult || "작업 문맥 확인 실패";
          showError(gradientResultMessage);
          dispatchSampleEditorState();
          return;
        }
        evalPS(
          'GX_importResultById("' + escJs(job.importFile) + '",' + job.docId +
            ',"' + escJs(job.docName) + '","' + escJs("GraXpert - " + job.method + " Gradient") +
            '","",' + job.sourceLayerId + ')',
          function(importError, importResult) {
            if (importError || importResult !== "OK") {
              gradientResultBusy = false;
              setGradientEditorBusy(false);
              gradientResultMessage = "결과 적용 실패: " + (importError || importResult || "알 수 없는 오류");
              showError(gradientResultMessage);
              dispatchSampleEditorState();
              return;
            }

            function finishGradientApply(backgroundWarning, backgroundAdded) {
              gradientResultBusy = false;
              setGradientEditorBusy(false);
              cleanupGradientResultJob(job);
              gradientResultJob = null;
              gradientResultContextValid = true;
              gradientResultMessage = "Photoshop에 적용했습니다.";
              gradientResultAppliedRevision++;
              showOk("확인한 전체 해상도 Gradient 결과를 현재 레이어 바로 위에 적용했습니다." +
                (backgroundAdded ? "\nBackground Model을 숨김 레이어로 추가했습니다." : "") +
                (backgroundWarning ? "\n주의: " + backgroundWarning : ""));
              dispatchSampleEditorState();
            }

            if (job.addBackgroundLayer) {
              gradientResultMessage = "Background Model을 Photoshop 레이어로 가져오는 중…";
              dispatchSampleEditorState();
              importBackgroundModelLayer(
                job.backgroundOutput, path.dirname(job.importFile), job.stamp,
                job.docId, job.docName, job.sourceLayerId, finishGradientApply
              );
            } else {
              finishGradientApply("", false);
            }
          }
        );
      }
    );
  }

  if (window.addEventListener) {
    window.addEventListener("beforeunload", function() {
      if (gradientResultBusy && activeGraXpertController) activeGraXpertController.cancel();
      else cleanupGradientResultJob(gradientResultJob);
      if (previewState && previewState.gradientInputFile) safeDelete(previewState.gradientInputFile);
      safeDelete(previewFile);
      safeDelete(maskFile);
    });
  }

  runBtn.onclick = function(){
    clearMsg();

    if (gradientResultBusy) {
      showError("Gradient Editor 결과 처리가 진행 중입니다.");
      return;
    }

    if (!fs || !os || !path || !cp) {
      showError("Node.js 모듈을 사용할 수 없습니다. CEP 설정을 확인하세요.");
      return;
    }

    var stamp = Date.now();
    var workdir = path.join(os.tmpdir(), "GraXpert_Photoshop");
    var gradientMethod = currentGradientMethod();

    if (mode === "background" && gradientMethod !== "AI") {
      if (samplePreviewContextOutdated) {
        showError("현재 레이어 또는 지정 영역이 Preview 생성 시점과 다릅니다. Gradient Editor를 다시 열어 Preview를 갱신하세요.");
        return;
      }
      if (!previewState) {
        showError("먼저 포인트 자동 생성으로 Preview를 준비하세요.");
        return;
      }
      var minimumPoints = gradientMethod === "Splines" ? 16 : 3;
      var usableCount = usableSamplePoints(true).length;
      if (usableCount < minimumPoints) {
        showError(
          gradientMethod + " 실행에는 최소 " + minimumPoints +
          "개의 사용 가능한 배경 포인트가 필요합니다.\n" +
          "현재 적합 Point: " + usableCount + "개\n" +
          "초록색 적합 Point만 사용하며 주황색 주의와 빨간색 제외 Point는 사용하지 않습니다."
        );
        return;
      }
    }

    try {
      if (!fs.existsSync(workdir)) fs.mkdirSync(workdir, { recursive:true });
    } catch (e) {
      showError("임시 폴더 생성 실패: " + e.message);
      return;
    }

    var input = path.join(workdir, "input_" + stamp + ".tif");
    var outputBase = path.join(workdir, "output_" + stamp);
    var conversionFile = path.join(workdir, "conversion_" + stamp + ".txt");
    var preferencesFile = mode === "background" && gradientMethod !== "AI"
      ? path.join(workdir, "preferences_" + stamp + ".json")
      : "";
    var scope = mode === "background" ? "layer" :
      (mode === "denoise" ? "layer-auto" : "layer");
    var contextScope = (mode === "background" || mode === "denoise") ? "layer-auto" : scope;

    setBusy(true, "입력 이미지 준비 중…");
    setProgress(10, "Photoshop에서 RGB 16-bit TIFF 준비 중…");

    evalPS(
      'GX_exportInput("' + escJs(input) + '","' + scope + '","' + contextScope + '")',
      function(err, result) {
        if (err || !result || result.indexOf("OK|") !== 0) {
          setBusy(false);
          showError("Photoshop 입력 준비 실패:\n" + (err || result || "알 수 없는 오류"));
          return;
        }

        var exportInfo;
        try { exportInfo = parsePhotoshopExport(result); }
        catch (parseError) {
          setBusy(false);
          safeDelete(input);
          showError("Photoshop 입력 정보 오류:\n" + parseError.message);
          return;
        }
        var docId = exportInfo.docId;
        var documentWidth = exportInfo.width;
        var documentHeight = exportInfo.height;
        var maskToken = exportInfo.maskToken;
        var sourceLayerId = exportInfo.sourceLayerId;
        var docName = exportInfo.docName;

        if (mode === "background" && gradientMethod !== "AI") {
          var gradientContextError = previewContextError(
            previewState, exportInfo, "background", contextScope
          );
          if (gradientContextError) {
            setBusy(false);
            safeDelete(input);
            discardPhotoshopMask(docId, maskToken);
            showError(gradientContextError);
            return;
          }
          try {
            createGradientPreferences(
              preferencesFile,
              gradientMethod,
              documentWidth,
              documentHeight
            );
          } catch (preferencesErr) {
            setBusy(false);
            safeDelete(input);
            discardPhotoshopMask(docId, maskToken);
            showError("GraXpert preferences 생성 실패:\n" + preferencesErr.message);
            return;
          }
        }

        setProgress(35, "GraXpert 처리 중… 패널을 닫지 마세요.");
        setBusy(
          true,
          mode === "background"
            ? "Gradient Removal 처리 중…"
            : "Denoise 처리 중…"
        );

        showOk(
          "GraXpert 처리가 시작되었습니다.\n" +
          "완료될 때까지 패널을 닫지 마세요."
        );

        runGraXpert(input, outputBase, preferencesFile, function(procErr, stdout, stderr) {
          if (procErr) {
            setBusy(false);
            discardPhotoshopMask(docId, maskToken);
            if (procErr.gxCode === "GX_CANCELLED" || procErr.gxCode === "GX_TIMEOUT") {
              cleanupAbortedWork(input, outputBase, conversionFile, preferencesFile);
            }
            var processHeading = procErr.gxCode === "GX_CANCELLED"
              ? "GraXpert 처리가 취소되었습니다."
              : procErr.gxCode === "GX_TIMEOUT"
                ? "GraXpert 무응답 제한 시간이 초과되었습니다."
                : "GraXpert 실행 실패";
            showError(
              processHeading + "\n\n" +
              procErr.message +
              ((stderr || stdout) ? "\n\n" + (stderr || stdout) : "")
            );
            return;
          }

          var output = findOutput(outputBase);
          var backgroundOutput = "";
          var backgroundWarning = "";

          if (!output) {
            setBusy(false);
            discardPhotoshopMask(docId, maskToken);
            showError(
              "GraXpert 처리는 끝났지만 결과 파일을 찾지 못했습니다.\n\n" +
              (stderr || stdout || "")
            );
            return;
          }

          if (mode === "background" && document.getElementById("addBackgroundLayer").checked) {
            backgroundOutput = findBackgroundOutput(outputBase);
            if (!backgroundOutput) {
              backgroundWarning = "Background Model 결과 파일을 찾지 못했습니다.";
            }
          }

          setProgress(72, "GraXpert 결과 변환 중…");

          var importFile = output;
          var lower = output.toLowerCase();

          try {
            if (/\.(fits|fit|fts)$/.test(lower)) {
              importFile = path.join(workdir, "photoshop_" + stamp + ".tif");
              var convInfo = convertFitsToTiff(output, importFile);

              try {
                fs.writeFileSync(
                  conversionFile,
                  "FITS source range: " + convInfo.sourceMin + " .. " + convInfo.sourceMax + "\r\n" +
                  "Scale: " + convInfo.scale + "\r\n" +
                  "Mode: " + convInfo.mode + "\r\n" +
                  "Output: " + convInfo.outputDepth + "\r\n",
                  "utf8"
                );
              } catch (_) {}
            }
          } catch (convErr) {
            setBusy(false);
            discardPhotoshopMask(docId, maskToken);
            showError(
              "GraXpert 처리는 완료됐지만 FITS → TIFF 변환 실패\n\n" +
              convErr.message +
              (backgroundWarning ? "\n\n" + backgroundWarning : "")
            );
            return;
          }

          setProgress(88, "결과를 Photoshop 레이어로 가져오는 중…");

          var layerName =
            mode === "background"
              ? "GraXpert - " + gradientMethod + " Gradient"
              : "GraXpert Denoise";
          if (scope === "sky") layerName += " - Sky";
          evalPS(
            'GX_importResultById("' + escJs(importFile) + '",' +
            docId + ',"' + escJs(docName) + '","' + escJs(layerName) +
            '","' + escJs(maskToken) + '",' +
            sourceLayerId + ')',
            function(impErr, impResult) {
              if (impErr || impResult !== "OK") {
                setBusy(false);
                discardPhotoshopMask(docId, maskToken);
                showError(
                  "결과 가져오기 실패:\n" +
                  (impErr || impResult || "알 수 없는 오류") +
                  (backgroundWarning ? "\n\n" + backgroundWarning : "")
                );
                return;
              }

              function finishResultImport(modelWarning, modelAdded) {
                if (modelWarning) backgroundWarning = modelWarning;
                // An AI result becomes Photoshop's active layer. Any Sample Point Preview
                // captured before this run now refers to a different source layer.
                if (mode === "background" && gradientMethod === "AI") resetSamplePreview();
                setBusy(false);
                setProgress(100, "완료");
                document.getElementById("progressWrap").className = "progress-wrap";
                cleanupSuccessfulWork(input, output, importFile, conversionFile, preferencesFile);
                cleanupBackgroundModelFiles(backgroundOutput, backgroundOutput);
                showOk(
                  "완료: `" + layerName + "` 선형 레이어를 원본 문서에 추가했습니다." +
                  (scope === "sky" ? "\n지정 영역 레이어 마스크를 적용했습니다." : "") +
                  ((mode === "background" || mode === "denoise") && maskToken
                    ? "\n선택 영역 또는 현재 레이어 마스크를 결과 레이어에 자동 적용했습니다." : "") +
                  (modelAdded ? "\nBackground Model을 숨김 레이어로 추가했습니다." : "") +
                  (backgroundWarning ? "\n\n주의: " + backgroundWarning : "")
                );
                setTimeout(function(){
                  document.getElementById("progressWrap").className = "progress-wrap hidden";
                }, 2500);
              }

              if (mode === "background" && document.getElementById("addBackgroundLayer").checked && backgroundOutput) {
                setProgress(94, "Background Model을 Photoshop 레이어로 가져오는 중…");
                importBackgroundModelLayer(
                  backgroundOutput, workdir, stamp, docId, docName, sourceLayerId,
                  finishResultImport
                );
              } else {
                finishResultImport(backgroundWarning, false);
              }
            }
          );
        });
      }
    );
  };

  // Expose pure file-conversion helpers only when the automated test harness
  // explicitly opts in. This remains absent during normal CEP operation.
  if (window.__GX_TEST_HOOK__) {
    window.__GX_TEST_API__ = {
      editorConfig: editorConfig,
      spawnGraXpertProcess: spawnGraXpertProcess,
      readRgbTiffInfo: readRgbTiffInfo,
      readUint16RgbTiffInfo: readUint16RgbTiffInfo,
      createTiffPreviewBmp: createTiffPreviewBmp,
      createUint16RgbTiffHeader: createUint16RgbTiffHeader,
      createFloat32RgbTiffHeader: createFloat32RgbTiffHeader,
      convertFitsToTiff: convertFitsToTiff,
      findBackgroundOutput: findBackgroundOutput,
      prepareBackgroundModelImport: prepareBackgroundModelImport,
      cleanupBackgroundModelFiles: cleanupBackgroundModelFiles,
      createGradientPreferences: createGradientPreferences,
      buildGraXpertArgs: buildGraXpertArgs,
      calculateCanvasSize: calculateCanvasSize,
      mapClientPoint: mapClientPoint,
      calculateLuminanceStats: calculateLuminanceStats,
      getStretchPreset: getStretchPreset,
      mtfValue: mtfValue,
      applyPreviewStretch: applyPreviewStretch,
      applyPreviewSaturation: applyPreviewSaturation,
      normalizeNeutralStrength: normalizeNeutralStrength,
      assessNeutralBalance: assessNeutralBalance,
      estimateNeutralFromPreview: estimateNeutralFromPreview,
      clippingChannelText: clippingChannelText,
      neutralizeGeneratedTiff: neutralizeGeneratedTiff,
      parsePhotoshopExport: parsePhotoshopExport,
      previewContextError: previewContextError,
      previewRegionSource: previewRegionSource,
      previewRegionStatusText: previewRegionStatusText,
      analyzeSamplePoint: analyzeSamplePoint,
      analyzeDiffuseStructure: analyzeDiffuseStructure,
      applyPointQuality: applyPointQuality,
      createLocalGradientPreviewPixels: createLocalGradientPreviewPixels,
      getQualityConfig: getQualityConfig,
      normalizePointsPerRow: normalizePointsPerRow,
      normalizeGridTolerance: normalizeGridTolerance,
      graxpertCandidateOffsets: graxpertCandidateOffsets,
      sampleLocalMedian: sampleLocalMedian,
      gridToleranceStats: gridToleranceStats,
      usableSamplePoints: usableSamplePoints,
      refreshNeutralReadyState: refreshNeutralReadyState,
      isNeutralReadyForTest: function() { return neutralAutoReady; },
      setModeForTest: function(value) { mode = value; },
      addSamplePointOriginal: addSamplePointOriginal,
      addSamplePointAt: addSamplePointAt,
      moveSamplePointOriginal: moveSamplePointOriginal,
      chooseBestQualityCandidate: chooseBestQualityCandidate,
      neutralQualityWeight: neutralQualityWeight,
      selectSpatialNeutralCandidates: selectSpatialNeutralCandidates,
      generateAutomaticSamplePoints: generateAutomaticSamplePoints,
      setSamplePoints: function(points) { samplePoints = points || []; },
      setSampleGenerationOptionsForTest: function(pointsPerRow, gridTolerance, sampleSize) {
        document.getElementById("pointsPerRow").value = pointsPerRow;
        document.getElementById("gridTolerance").value = gridTolerance;
        if (sampleSize !== undefined) document.getElementById("sampleSize").value = sampleSize;
      },
      setSelectionOnlyForTest: function(value) {
        document.getElementById("selectionOnly").checked = !!value;
      },
      setPreviewAnalysisForTest: function(state, pixels, mask) {
        previewState = state;
        previewPixels = pixels;
        selectionMask = mask || null;
        previewLuminanceStats = calculateLuminanceStats(pixels);
        previewSelectionLuminanceStats = previewState && previewState.hasSelection && selectionMask
          ? calculateLuminanceStats(pixels, selectionMask) : null;
        previewImage = {};
      }
    };
  }

})();
