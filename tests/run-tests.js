"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var vm = require("vm");

var root = path.resolve(__dirname, "..");
var panelDir = path.join(root, "GraXpert-Photoshop-Panel");
var testDir = fs.mkdtempSync(path.join(os.tmpdir(), "gx-panel-test-"));

function element() {
  return {
    value: "", checked: false, className: "", style: {}, disabled: false, textContent: "",
    appendChild: function (child) { child.parentNode = this; return child; },
    insertBefore: function (child) { child.parentNode = this; return child; }
  };
}

function loadPanelApi() {
  var elements = {};
  var ids = [
    "settingsBtn", "tabs", "footer", "tabBg", "tabDn", "tabNeutral", "bgPanel", "gradientCard", "dnPanel", "neutralPanel",
    "scopeCard", "scopeHint", "runtimeCard", "smoothing", "strength",
    "exePath", "runBtn", "cancelRunBtn", "busyBanner", "savePath", "smoothingValue",
    "strengthValue", "runText", "progressWrap", "progressBar", "status",
    "message", "useGpu", "saveBackground", "batchSize", "sampleCard",
    "sampleEditor", "sampleCanvas", "sampleCanvasEmpty", "sampleCount",
    "selectionStatus", "undoSample", "clearSamples", "autoSamples", "openSampleWindow",
    "preparePreview", "sampleSize", "pointsPerRow", "gridTolerance", "selectionOnly", "browsePath", "sampleCanvasWrap",
    "pointQualityStatus", "qualityReport", "stretchPreset", "previewSaturation",
    "previewSaturationValue", "neutralSampleCount", "neutralStrength", "neutralStrengthValue",
    "neutralSkyOnly", "neutralScopeLayer", "neutralizeActiveLayer", "neutralAnalyze", "neutralAnalysisStatus", "neutralPointSlot", "neutralEstimateStatus",
    "gradientAdvancedToggle", "gradientAdvancedBody", "gradientSampleMethod", "gradientInterpolation",
    "denoiseAdvancedToggle", "denoiseAdvancedBody",
    "sampleScopeStatus", "generateSamples"
  ];
  ids.forEach(function (id) { elements[id] = element(); });

  var panelWindow = { __GX_TEST_HOOK__: true };
  var osMock = {
    tmpdir: function () { return testDir; },
    homedir: function () { return testDir; }
  };
  var context = {
    require: function (name) {
      return { fs: fs, os: osMock, path: path, child_process: {} }[name];
    },
    document: {
      getElementById: function (id) { return elements[id]; },
      querySelector: function () { return element(); },
      querySelectorAll: function () { return []; }
    },
    window: panelWindow,
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    setTimeout: function () {},
    Buffer: Buffer,
    console: console
  };

  var source = fs.readFileSync(path.join(panelDir, "client", "main.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "main.js" });
  return panelWindow.__GX_TEST_API__;
}

function fitsCard(key, value) {
  var text = (key + "        ").substring(0, 8);
  if (key !== "END") text += "= " + ("                    " + String(value)).slice(-20);
  return (text + new Array(81).join(" ")).substring(0, 80);
}

function createFits(name, bitpix, dims, values, bscale, bzero) {
  var cards = [fitsCard("SIMPLE", "T"), fitsCard("BITPIX", bitpix), fitsCard("NAXIS", dims.length)];
  dims.forEach(function (value, index) { cards.push(fitsCard("NAXIS" + (index + 1), value)); });
  if (bscale !== undefined) cards.push(fitsCard("BSCALE", bscale));
  if (bzero !== undefined) cards.push(fitsCard("BZERO", bzero));
  cards.push(fitsCard("END", ""));

  var headerText = cards.join("");
  headerText += new Array(Math.ceil(headerText.length / 2880) * 2880 - headerText.length + 1).join(" ");
  var bytesPer = Math.abs(bitpix) / 8;
  var data = Buffer.alloc(values.length * bytesPer);

  values.forEach(function (value, index) {
    var p = index * bytesPer;
    if (bitpix === 8) data.writeUInt8(value, p);
    else if (bitpix === 16) data.writeInt16BE(value, p);
    else if (bitpix === 32) data.writeInt32BE(value, p);
    else if (bitpix === -32) data.writeFloatBE(value, p);
    else data.writeDoubleBE(value, p);
  });

  var file = path.join(testDir, name + ".fits");
  fs.writeFileSync(file, Buffer.concat([Buffer.from(headerText, "ascii"), data]));
  return file;
}

function readTiff(file) {
  var data = fs.readFileSync(file);
  var ifd = data.readUInt32LE(4);
  var entries = data.readUInt16LE(ifd);
  var width = 0, height = 0, pixelOffset = 0;

  for (var i=0; i<entries; i++) {
    var p = ifd + 2 + i * 12;
    var tag = data.readUInt16LE(p);
    var value = data.readUInt32LE(p + 8);
    if (tag === 256) width = value;
    if (tag === 257) height = value;
    if (tag === 273) pixelOffset = value;
  }

  var pixels = [];
  for (var at=pixelOffset; at<pixelOffset + width * height * 6; at += 2) {
    pixels.push(data.readUInt16LE(at));
  }
  return { width: width, height: height, pixels: pixels };
}

function createTestIccProfile() {
  var profile = Buffer.alloc(128);
  profile.writeUInt32BE(profile.length, 0);
  profile.write("acsp", 36, 4, "ascii");
  return profile;
}

function createFloatRgbTiff(api, name, width, height, pixelValues, iccProfile) {
  var header = api.createFloat32RgbTiffHeader(width, height, iccProfile);
  var file = path.join(testDir, name + ".tif");
  var data = Buffer.alloc(header.pixelOffset + width * height * 12);
  header.buffer.copy(data, 0);
  for (var i=0; i<pixelValues.length; i++) {
    data.writeFloatLE(pixelValues[i], header.pixelOffset + i * 4);
  }
  fs.writeFileSync(file, data);
  return file;
}

function createUint16RgbTiff(api, name, width, height, pixelValues, iccProfile) {
  var header = api.createUint16RgbTiffHeader(width, height, iccProfile);
  var file = path.join(testDir, name + ".tif");
  var data = Buffer.alloc(header.pixelOffset + width * height * 6);
  header.buffer.copy(data, 0);
  for (var i=0; i<pixelValues.length; i++) {
    data.writeUInt16LE(pixelValues[i], header.pixelOffset + i * 2);
  }
  fs.writeFileSync(file, data);
  return file;
}

function readFloatRgbTiff(api, file) {
  var fd = fs.openSync(file, "r");
  try {
    var info = api.readRgbTiffInfo(fd);
    assert.strictEqual(info.bits, 32);
    var row = Buffer.alloc(info.rowBytes);
    var values = [];
    for (var y=0; y<info.height; y++) {
      var stripIndex = Math.floor(y / info.rowsPerStrip);
      var rowPosition = info.stripOffsets[stripIndex] +
        (y - stripIndex * info.rowsPerStrip) * info.rowBytes;
      fs.readSync(fd, row, 0, row.length, rowPosition);
      for (var at=0; at<row.length; at += 4) values.push(row.readFloatLE(at));
    }
    return { width:info.width, height:info.height, values:values };
  } finally {
    fs.closeSync(fd);
  }
}

function testConversion(api, name, bitpix, dims, values, expected, bscale, bzero) {
  var input = createFits(name, bitpix, dims, values, bscale, bzero);
  var output = path.join(testDir, name + ".tif");
  api.convertFitsToTiff(input, output);
  assert.deepStrictEqual(readTiff(output), expected);
}

function testHostCleanup() {
  var code = fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8").replace(/^#target photoshop\s*/, "");
  function runCase(failConversion, scope, singleLayer) {
    var closeCount = 0;
    var saveCount = 0;
    var hideAttempts = 0;
    var showAttempts = 0;
    var workTarget = { typename: "ArtLayer", name: "Background" };
    Object.defineProperty(workTarget, "visible", {
      get: function () { return true; },
      set: function (value) {
        if (!value) {
          hideAttempts++;
          throw new Error("'숨기기' 명령은 현재 사용할 수 없습니다.");
        }
        showAttempts++;
        throw new Error("'표시' 명령은 현재 사용할 수 없습니다.");
      }
    });
    var original = {
    name: "test.psd",
    id: 7,
    bitsPerChannel: "SIXTEEN",
    activeLayer: { name: "BXT Result", id: 42 },
    width: { as: function () { return 100; } },
      height: { as: function () { return 50; } },
      duplicate: function () {
        return {
          layers: singleLayer ? [workTarget] : [], activeLayer: workTarget,
          mode: "RGB", flatten: function () {},
          get bitsPerChannel() { return "EIGHT"; },
          set bitsPerChannel(value) {
            if (failConversion) throw new Error("forced conversion failure");
          },
          saveAs: function () { saveCount++; },
          close: function () { closeCount++; }
        };
      }
    };
    var context = {
      app: { documents: [original], activeDocument: original },
      DocumentMode: { RGB: "RGB" }, ChangeMode: { RGB: "RGB" },
      BitsPerChannelType: { SIXTEEN: "SIXTEEN" },
      SaveOptions: { DONOTSAVECHANGES: 0 }, File: function () {},
      TiffSaveOptions: function () {}, TIFFEncoding: { NONE: 0 }, Extension: { LOWERCASE: 0 }
    };
    vm.runInNewContext(code, context, { filename: "host.jsx" });
    assert.strictEqual(context.GX_getActiveLayerInfo(), "OK|7|42|B:16|BXT%20Result");
    var result = context.GX_exportInput("test.tif", scope || "document");
    assert.strictEqual(closeCount, 1);
    assert.strictEqual(context.app.activeDocument, original);
    return {
      result: result, saveCount: saveCount,
      hideAttempts: hideAttempts, showAttempts: showAttempts
    };
  }

  var failed = runCase(true);
  assert.match(failed.result, /^ERR\|처리용 비트 심도 준비 실패/);
  assert.strictEqual(failed.saveCount, 0);

  var succeeded = runCase(false);
  assert.strictEqual(succeeded.result, "OK|7|100|50||L:42|C:none%3A|test.psd");
  assert.strictEqual(succeeded.saveCount, 1);

  var backgroundOnly = runCase(false, "layer", true);
  assert.strictEqual(backgroundOnly.result, "OK|7|100|50||L:42|C:none%3A|test.psd");
  assert.strictEqual(backgroundOnly.hideAttempts, 0);
  assert.strictEqual(backgroundOnly.showAttempts, 0);
  assert.strictEqual(backgroundOnly.saveCount, 1);
}

function testSamplePreviewCleanup() {
  var code = fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8").replace(/^#target photoshop\s*/, "");
  var closeCount = 0;
  var saveCount = 0;
  var originalAlphaRemoved = 0;
  var maskAlphaRemoved = 0;
  var selectionStored = 0;
  var selectionLoaded = 0;
  var originalAlpha = { kind: "ALPHA", name: "", remove: function () { originalAlphaRemoved++; } };

  function createWorkDocument(maskAlpha) {
    var channels = [{ kind: "COMPONENT" }, { kind: "COMPONENT" }, { kind: "COMPONENT" }];
    if (maskAlpha) channels.push(maskAlpha);
    return {
      activeLayer: {}, layers: [], mode: "RGB", channels: channels,
      selection: {
        store: function () {}, selectAll: function () {}, fill: function () {},
        load: function () { selectionLoaded++; }, deselect: function () {}
      },
      flatten: function () {}, resizeImage: function () {},
      saveAs: function () { saveCount++; }, close: function () { closeCount++; }
    };
  }

  var duplicateCount = 0;
  var originalChannels = [];
  originalChannels.add = function () { originalChannels.push(originalAlpha); return originalAlpha; };
  var original = {
    id: 7,
    width: { as: function () { return 100; } },
    height: { as: function () { return 50; } },
    channels: originalChannels,
    selection: {
      bounds: [0, 0, 50, 25],
      store: function (channel) { assert.strictEqual(channel, originalAlpha); selectionStored++; },
      load: function () { selectionLoaded++; }
    },
    duplicate: function () {
      duplicateCount++;
      if (duplicateCount === 1) return createWorkDocument(null);
      return createWorkDocument({
        kind: "ALPHA", name: originalAlpha.name,
        remove: function () { maskAlphaRemoved++; }
      });
    }
  };
  var context = {
    app: { documents: [original], activeDocument: original },
    DocumentMode: { RGB: "RGB" }, ChangeMode: { RGB: "RGB" },
    BitsPerChannelType: { EIGHT: "EIGHT" }, SaveOptions: { DONOTSAVECHANGES: 0 },
    File: function (value) { return value; }, UnitValue: function (value) { return value; },
    JPEGSaveOptions: function () {}, PNGSaveOptions: function () {},
    Extension: { LOWERCASE: 0 }, ResampleMethod: { BICUBICSHARPER: 0, NEARESTNEIGHBOR: 1 },
    SolidColor: function () { this.rgb = {}; }, ChannelType: { COMPONENT: "COMPONENT" },
    ColorBlendMode: { NORMAL: 0 }, SelectionType: { REPLACE: 0 }
  };

  vm.runInNewContext(code, context, { filename: "host.jsx" });
  var result = context.GX_exportSamplePreview("preview.png", "mask.png", 1400, 900, "sky");
  assert.strictEqual(result, "OK|7|100|50|100|50|YES|L:-1|C:selection%3A0%2C0%2C50%2C25");
  assert.strictEqual(saveCount, 2);
  assert.strictEqual(closeCount, 2);
  assert.strictEqual(selectionStored, 2);
  assert.strictEqual(selectionLoaded, 2);
  assert.strictEqual(maskAlphaRemoved, 1);
  assert.strictEqual(originalAlphaRemoved, 2);
  assert.strictEqual(context.app.activeDocument, original);
}

function testSkyMaskWorkflow() {
  var code = fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8").replace(/^#target photoshop\s*/, "");
  var selectionStores = 0;
  var selectionLoads = 0;
  var removedChannels = 0;
  var masksAdded = 0;
  var resultClosed = 0;
  var openCalls = 0;
  var channelSerial = 0;
  var componentChannels = [{ kind: "COMPONENT" }, { kind: "COMPONENT" }, { kind: "COMPONENT" }];
  var channels = componentChannels.slice(0);
  channels.add = function () {
    var channel = {
      name: "",
      remove: function () {
        removedChannels++;
        var index = channels.indexOf(channel);
        if (index >= 0) channels.splice(index, 1);
      }
    };
    channelSerial++;
    channels.push(channel);
    return channel;
  };
  var target = {
    id: 7, name: "sky|target.psd", mode: "RGB", bitsPerChannel: "SIXTEEN",
    width: { as: function () { return 100; } },
    height: { as: function () { return 50; } },
    activeLayer: { name: "Source" },
    channels: channels, componentChannels: componentChannels, activeChannels: componentChannels,
    selection: {
      bounds: [0, 0, 100, 35],
      store: function () { selectionStores++; },
      load: function () { selectionLoads++; },
      deselect: function () {}
    },
    duplicate: function () {
      return {
        activeLayer: {}, layers: [], mode: "RGB", bitsPerChannel: "SIXTEEN",
        flatten: function () {}, saveAs: function () {}, close: function () {}
      };
    }
  };
  var importedLayer = { name: "", remove: function () {} };
  var resultDocument = {
    width: { as: function () { return 100; } },
    height: { as: function () { return 50; } },
    bitsPerChannel: "SIXTEEN",
    activeLayer: {
      duplicate: function (document) {
        document.activeLayer = importedLayer;
        return importedLayer;
      }
    },
    close: function () { resultClosed++; }
  };
  var context = {
    app: {
      documents: [target], activeDocument: target,
      open: function () { openCalls++; return resultDocument; }
    },
    DocumentMode: { RGB: "RGB" }, ChangeMode: { RGB: "RGB" },
    BitsPerChannelType: { EIGHT: "EIGHT", SIXTEEN: "SIXTEEN", THIRTYTWO: "THIRTYTWO" },
    SaveOptions: { DONOTSAVECHANGES: 0 },
    File: function () { this.exists = true; }, TiffSaveOptions: function () {},
    TIFFEncoding: { NONE: 0 }, Extension: { LOWERCASE: 0 },
    ElementPlacement: { PLACEATBEGINNING: 0 }, SelectionType: { REPLACE: 0 },
    DialogModes: { NO: 0 },
    ActionReference: function () {
      this.putEnumerated = function () {};
      this.putProperty = function () {};
    },
    ActionDescriptor: function () {
      this.putReference = function () {};
      this.putClass = function () {};
      this.putEnumerated = function () {};
    },
    charIDToTypeID: function (value) { return value; },
    stringIDToTypeID: function (value) { return value; },
    executeAction: function (action) { if (action === "Mk  ") masksAdded++; },
    executeActionGet: function () {
      return { hasKey: function () { return false; }, getBoolean: function () { return false; } };
    }
  };
  vm.runInNewContext(code, context, { filename: "host.jsx" });
  var exportResult = context.GX_exportInput("input.tif", "sky");
  assert.match(exportResult, /^OK\|7\|100\|50\|S:__GRAXPERT_SKY_MASK_/);
  assert.strictEqual(selectionStores, 2);
  var exportParts = exportResult.split("|");
  var maskToken = exportParts[4];
  var importResult = context.GX_importResultById(
    "result.tif", 7, "sky|target.psd", "GraXpert Denoise - Sky", maskToken
  );
  assert.strictEqual(importResult, "OK");
  assert.strictEqual(importedLayer.name, "GraXpert Denoise - Sky");
  assert.strictEqual(masksAdded, 1);
  assert.strictEqual(selectionLoads, 2);
  assert.strictEqual(removedChannels, 2);
  assert.strictEqual(resultClosed, 1);
  assert.strictEqual(channelSerial, 2);
  var wrongDocumentResult = context.GX_importResultById(
    "result.tif", 999, "sky|target.psd", "Wrong target", ""
  );
  assert.match(wrongDocumentResult, /^ERR\|처리 시작 시 원본 문서를 찾을 수 없습니다\./);
  var missingLayerResult = context.GX_importResultById(
    "result.tif", 7, "sky|target.psd", "Missing anchor", "", 999
  );
  assert.match(missingLayerResult, /^ERR\|처리 시작 시 선택한 원본 레이어를 찾을 수 없습니다\./);
  assert.strictEqual(openCalls, 1);
}

function testLayerMaskFallbackCapture() {
  var code = fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8").replace(/^#target photoshop\s*/, "");
  var selected = false;
  var stored = 0;
  var removed = 0;
  var channels = [];
  channels.add = function () {
    var channel = {
      name: "",
      remove: function () { removed++; }
    };
    channels.push(channel);
    return channel;
  };
  var selection = {
    store: function () { stored++; },
    load: function () { selected = true; },
    deselect: function () { selected = false; }
  };
  Object.defineProperty(selection, "bounds", {
    get: function () {
      if (!selected) throw new Error("no selection");
      return [0, 0, 20, 20];
    }
  });
  var document = {
    channels: channels, selection: selection,
    activeChannels: [], componentChannels: []
  };
  var context = {
    app: { activeDocument: document, documents: [document] },
    SelectionType: { REPLACE: 0 }, DialogModes: { NO: 0 },
    ActionReference: function () {
      this.putEnumerated = function () {};
      this.putProperty = function () {};
    },
    ActionDescriptor: function () { this.putReference = function () {}; },
    charIDToTypeID: function (value) { return value; },
    stringIDToTypeID: function (value) { return value; },
    executeActionGet: function () {
      return { hasKey: function () { return true; }, getBoolean: function () { return true; } };
    },
    executeAction: function (action) { if (action === "setd") selected = true; }
  };
  vm.runInNewContext(code, context, { filename: "host.jsx" });
  var token = context.GX_captureSkyMask(document);
  assert.match(token, /^M:__GRAXPERT_SKY_MASK_/);
  assert.strictEqual(stored, 1);
  assert.strictEqual(selected, false);
  context.GX_restoreSelectionAndRemoveMask(document, token);
  assert.strictEqual(removed, 1);
  assert.strictEqual(selected, false);
  context.executeActionGet = function () {
    return { hasKey: function () { return true; }, getBoolean: function () { return false; } };
  };
  assert.throws(
    function () { context.GX_captureSkyMask(document); },
    /하늘 선택 영역이나 현재 레이어 마스크가 없습니다/
  );
  assert.strictEqual(stored, 1);
}

function testHtmlAndInstaller() {
  var html = fs.readFileSync(path.join(panelDir, "client", "index.html"), "utf8");
  var editorHtml = fs.readFileSync(path.join(panelDir, "client", "gradient-editor-window.html"), "utf8");
  var neutralEditorHtml = fs.readFileSync(path.join(panelDir, "client", "neutral-editor-window.html"), "utf8");
  var editorScript = fs.readFileSync(path.join(panelDir, "client", "sample-editor-window.js"), "utf8");
  var editorStyle = fs.readFileSync(path.join(panelDir, "client", "sample-editor-window.css"), "utf8");
  assert.strictEqual((html.match(/<div\b/g) || []).length, (html.match(/<\/div>/g) || []).length);
  assert.strictEqual((editorHtml.match(/<div\b/g) || []).length, (editorHtml.match(/<\/div>/g) || []).length);
  assert.strictEqual((neutralEditorHtml.match(/<div\b/g) || []).length, (neutralEditorHtml.match(/<\/div>/g) || []).length);

  var installer = fs.readFileSync(path.join(root, "Install_Windows.bat"), "ascii");
  var uninstaller = fs.readFileSync(path.join(root, "Uninstall_Windows.bat"), "ascii");
  var manifest = fs.readFileSync(path.join(panelDir, "CSXS", "manifest.xml"), "utf8");
  var panelScript = fs.readFileSync(path.join(panelDir, "client", "main.js"), "utf8");
  var readme = fs.readFileSync(path.join(root, "README_KO.txt"), "utf8");
  var integrationRunner = fs.readFileSync(path.join(root, "tests", "Run_Photoshop_Integration.ps1"), "utf8");
  var integrationScript = fs.readFileSync(path.join(root, "tests", "Photoshop_Integration_Test.jsx"), "utf8");
  assert.match(installer, /v0\.9\.0/);
  assert.match(uninstaller, /v0\.9\.0/);
  assert.match(manifest, /ExtensionBundleVersion="0\.9\.0"/);
  assert.match(manifest, /ExtensionBundleId="com\.drmedia\.graxpertps"/);
  assert.match(manifest, /Extension Id="com\.drmedia\.graxpertps\.panel"/);
  assert.match(manifest, /Extension Id="com\.drmedia\.graxpertps\.gradienteditor"/);
  assert.match(manifest, /Extension Id="com\.drmedia\.graxpertps\.neutraleditor"/);
  assert.doesNotMatch(manifest + panelScript + editorScript, /com\.openai\.graxpertps/);
  assert.doesNotMatch(manifest + panelScript + editorScript, /com\.drmedia\.graxpertps\.sampleeditor/);
  assert.doesNotMatch(manifest + panelScript + installer, /sample-editor-window\.html/);
  assert.match(
    manifest,
    /<Extension Id="com\.drmedia\.graxpertps\.gradienteditor">[\s\S]*?<AutoVisible>true<\/AutoVisible>[\s\S]*?<Type>Modeless<\/Type>/
  );
  assert.match(
    manifest,
    /<Extension Id="com\.drmedia\.graxpertps\.neutraleditor">[\s\S]*?<AutoVisible>true<\/AutoVisible>[\s\S]*?<Type>Modeless<\/Type>/
  );
  assert.strictEqual((manifest.match(/<Menu>/g) || []).length, 1);
  assert.match(manifest, /<Menu>GraXpert<\/Menu>/);
  assert.match(panelScript, /requestOpenExtension\(config\.extensionId/);
  assert.match(panelScript, /openSampleWindow"\)\.onmousedown/);
  assert.match(panelScript, /pendingGradientAutoSamples/);
  assert.match(panelScript, /pendingOpenSampleEditor/);
  assert.match(panelScript, /selectionOnly"\)\.checked = previewState\.hasSelection/);
  assert.match(panelScript, /Point 생성 영역: /);
  assert.match(panelScript, /결과 적용 영역: /);
  assert.match(panelScript, /normalizePointsPerRow\(document\.getElementById\("pointsPerRow"\)\.value\)/);
  assert.match(panelScript, /gridToleranceStats/);
  assert.match(panelScript, /GRADIENT_COMMAND_EVENT/);
  assert.match(panelScript, /gradient_editor_state\.json/);
  assert.match(panelScript, /neutral_editor_state\.json/);
  assert.match(panelScript, /gradient_editor_ready\.json/);
  assert.match(panelScript, /neutral_editor_ready\.json/);
  assert.match(editorScript, /gradient_editor_command\.json/);
  assert.match(editorScript, /neutral_editor_command\.json/);
  assert.match(readme, /v0\.9\.0/);
  assert.match(html, /<option selected>No Stretch<\/option>/);
  assert.match(html, /id="smoothingValue"[^>]*>0\.00<\/span>/);
  assert.match(html, /id="smoothing"[^>]*value="0\.00"/);
  assert.match(html, /id="openSampleWindow"/);
  assert.match(html, /id="generateSamples"[^>]*>포인트 자동 생성<\/button>/);
  assert.match(html, /id="openSampleWindow"[^>]*>Gradient Editor<\/button>/);
  assert.match(html, /id="sampleMainDetails" class="hidden" aria-hidden="true"/);
  assert.doesNotMatch(html, /id="sampleAdvancedToggle"/);
  assert.match(html, /id="samplePreviewDisplayState" class="hidden" aria-hidden="true"/);
  assert.match(html, /id="sampleScopeStatus"/);
  assert.doesNotMatch(html, />Preview Stretch<\/div>/);
  assert.match(html, /id="pointsPerRow"[^>]*min="4"[^>]*max="25"[^>]*value="15"/);
  assert.match(html, /id="gridTolerance"[^>]*min="-2"[^>]*max="10"[^>]*value="1\.0"/);
  assert.match(html, /id="sampleCanvasWrap" class="sample-canvas-wrap hidden"/);
  assert.match(html, /<label for="sampleSize">Sample Size<\/label>/);
  assert.match(editorHtml, />Sample Size\s*<input id="sampleSize"[^>]*value="25"/);
  assert.match(neutralEditorHtml, />Sample Size\s*<input id="sampleSize"[^>]*value="25"/);
  assert.match(panelScript, /function sampleBoundsOnCanvas\(point, targetCanvas\)/);
  assert.match(panelScript, /ctx\.strokeRect\(/);
  assert.match(panelScript, /for \(var gridY=-2; gridY<=2; gridY\+\+\)/);
  assert.match(panelScript, /for \(var gridX=-2; gridX<=2; gridX\+\+\)/);
  assert.match(editorScript, /function sampleBoundsOnCanvas\(point\)/);
  assert.match(editorScript, /context\.strokeRect\(/);
  assert.doesNotMatch(panelScript, /ctx\.arc\(canvasPoint\.x, canvasPoint\.y/);
  assert.doesNotMatch(editorScript, /context\.arc\(shown\.x, shown\.y/);
  assert.doesNotMatch(html + editorHtml + neutralEditorHtml, /Sample Radius|포인트 반경/);
  assert.doesNotMatch(html, /id="tabStretch"/);
  assert.doesNotMatch(html, /id="stretchPanel"/);
  assert.match(html, /name="scope" value="sky"/);
  assert.match(html, /id="cancelRunBtn"[^>]*>처리 취소<\/button>/);
  assert.match(html, /id="settingsBtn"[^>]*title="설정"/);
  assert.match(html, /class="settings-icon"[^>]*>&#9881;&#65038;<\/span>/);
  assert.doesNotMatch(html, />GX<\/button>/);
  assert.match(html, /id="runtimeCard" class="card hidden"/);
  assert.match(panelScript, /function setSettingsMode\(open\)/);
  assert.match(panelScript, /cpModule\.spawn/);
  assert.doesNotMatch(panelScript, /cp\.execFile/);
  assert.match(panelScript, /runtimeCard\.className = "card"/);
  assert.match(html, /name="scope" value="layer" checked/);
  assert.doesNotMatch(html, /name="scope" value="document" checked/);
  assert.match(html, /<span>보이는 레이어<\/span>/);
  assert.match(html, /<span>현재 레이어<\/span>/);
  assert.match(html, /<span>지정 영역<\/span>/);
  assert.match(html, /id="scopeHint"/);
  assert.match(panelScript, /onmouseenter/);
  assert.match(panelScript, /restoreSelectedScopeDescription/);
  assert.match(html, /name="gradientMethod" value="AI" checked><span>AI 자동<\/span>/);
  assert.match(html, /name="gradientMethod" value="sample"><span>배경 포인트<\/span>/);
  assert.match(html, /id="gradientCard" class="card"/);
  assert.doesNotMatch(html, /name="gradientMethod" value="(?:RBF|Splines|Kriging)"/);
  assert.match(html, /id="gradientInterpolation"/);
  assert.match(html, /<option value="RBF" selected>RBF<\/option>/);
  assert.match(html, /<option value="Splines">Splines<\/option>/);
  assert.match(html, /<option value="Kriging">Kriging<\/option>/);
  assert.match(html, /id="gradientAdvancedBody" class="gradient-advanced-body hidden"/);
  assert.ok(html.indexOf('id="gradientAdvancedBody"') < html.indexOf('id="gradientSampleMethod"'));
  assert.match(html, /id="gradientAdvancedToggle"[^>]*>상세 설정 보기<\/button>/);
  assert.ok(html.indexOf('id="gradientAdvancedBody"') < html.indexOf('id="gradientAdvancedToggle"'));
  assert.match(panelScript, /return gradientInterpolation \? gradientInterpolation\.value : "RBF"/);
  assert.match(panelScript, /gradientAdvancedOpen/);
  assert.match(html, /id="denoiseAdvancedBody" class="denoise-advanced-body hidden"/);
  assert.match(html, /id="denoiseAdvancedToggle"[^>]*>상세 설정 보기<\/button>/);
  assert.ok(html.indexOf('id="denoiseAdvancedBody"') < html.indexOf('id="denoiseAdvancedToggle"'));
  assert.match(panelScript, /denoiseAdvancedOpen/);
  assert.match(panelScript, /setAdvancedSection/);
  assert.match(panelScript, /placeSampleCardInside\(gradientCard, gradientAdvancedToggle\)/);
  assert.match(html, /id="tabNeutral"/);
  assert.ok(html.indexOf('id="tabBg"') < html.indexOf('id="tabNeutral"'));
  assert.ok(html.indexOf('id="tabNeutral"') < html.indexOf('id="tabDn"'));
  assert.match(html, /id="neutralPanel" class="hidden"/);
  assert.match(html, /id="neutralStrength"/);
  assert.match(html, /id="neutralScopeLayer" type="radio" name="neutralScope" value="layer" checked/);
  assert.match(html, /id="neutralSkyOnly" type="radio" name="neutralScope" value="sky">/);
  assert.match(html, /id="neutralMaskStatus"/);
  assert.match(html, /GraXpert CLI 3\.0\.x · v0\.9\.0/);
  assert.match(html, /<span>현재 레이어<\/span>/);
  assert.match(html, /<span>지정 영역<\/span>/);
  assert.match(html, /분석: 확인 전 · 결과: 현재 레이어 전체/);
  assert.match(panelScript, /분석 영역: Photoshop 선택 영역/);
  assert.match(panelScript, /분석 영역: 현재 레이어 마스크/);
  assert.match(panelScript, /resultLabel[\s\S]*?"현재 레이어 전체"/);
  assert.match(panelScript, /neutralSkyOnly"\)\.checked \? "layer-sky" : "layer-auto"/);
  assert.match(panelScript, /selectionOnly: previewState\.hasSelection,\s*neutral: true/);
  assert.match(panelScript, /분석 영역: 현재 레이어 전체/);
  assert.match(fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8"), /scope === "layer-auto" && \(hasSelection \|\| GX_activeLayerHasMask\(\)\)/);
  assert.match(panelScript, /matchingPreview && previewState\.hasSelection/);
  assert.match(panelScript, /neutralScopeLayer"\)\.onchange = neutralScopeChanged/);
  assert.doesNotMatch(html, /id="neutralAdvancedToggle"/);
  assert.match(html, /id="neutralInternalState" class="hidden" aria-hidden="true"/);
  assert.match(html, /id="neutralPointSlot"/);
  assert.match(html, /id="neutralizeActiveLayer"[^>]*>중화 레이어 생성<\/button>/);
  assert.doesNotMatch(html, /name="neutralReference"/);
  assert.match(html, /id="neutralAnalyze"/);
  assert.match(panelScript, /generateAutomaticSamplePoints/);
  assert.match(panelScript, /neutralQualityWeight/);
  assert.doesNotMatch(panelScript, /\breferenceMode\b/);
  assert.match(panelScript, /Reference: Auto\/Edit/);
  assert.match(panelScript, /clippedLowTotal/);
  assert.match(panelScript, /sourceBits === 32/);
  assert.match(panelScript, /GX_getSkyMaskStatus\(\)/);
  assert.doesNotMatch(panelScript, /neutralAdvancedOpen/);
  assert.match(panelScript, /placeSampleCardInside\(neutralPointSlot\)/);
  assert.match(panelScript, /editorMode === "neutralize"\) document\.getElementById\("neutralAnalyze"\)\.onclick\(\)/);
  assert.match(panelScript, /selectSpatialNeutralCandidates/);
  assert.match(panelScript, /rejectedColorCount/);
  assert.match(panelScript, /escJs\(maskToken\) \+ '\",' \+\s*sourceLayerId \+ '\)'/);
  assert.doesNotMatch(panelScript, /mode === "background" \? sourceLayerId : -1/);
  assert.match(html, /id="neutralizeActiveLayer"/);
  assert.match(panelScript, /GX_discardMask/);
  assert.match(editorHtml, /id="sampleCanvas"/);
  assert.match(neutralEditorHtml, /data-editor-mode="neutralize"/);
  assert.match(neutralEditorHtml, /GraXpert Neutralise Editor/);
  assert.match(editorHtml, /id="closeEditor"/);
  assert.match(editorHtml, /<label class="preview-stretch-label">Preview Stretch/);
  assert.match(editorHtml, /<label class="saturation-label">Saturation/);
  assert.match(editorHtml, /id="pointsPerRow"[^>]*value="15"/);
  assert.match(editorHtml, /id="gridTolerance"[^>]*value="1\.0"/);
  assert.ok(editorHtml.indexOf('id="pointsPerRow"') < editorHtml.indexOf('id="gridTolerance"'));
  assert.ok(editorHtml.indexOf('id="gridTolerance"') < editorHtml.indexOf('id="sampleSize"'));
  assert.match(neutralEditorHtml, /id="pointsPerRow"[^>]*value="15"/);
  assert.match(neutralEditorHtml, /id="gridTolerance"[^>]*value="1\.0"/);
  assert.match(editorHtml, /id="qualityPreset"/);
  assert.match(editorHtml, /class="editor-button-group"/);
  assert.match(editorStyle, /\.toolbar\s*\{[\s\S]*?flex-wrap:nowrap/);
  assert.match(editorStyle, /\.editor-button-group\s*\{[\s\S]*?flex-wrap:nowrap/);
  assert.match(editorHtml, /class="editor-button-group"[\s\S]*id="autoSamples"[\s\S]*id="undoSample"[\s\S]*id="clearSamples"/);
  assert.match(neutralEditorHtml, /class="editor-button-group"[\s\S]*id="autoSamples"[\s\S]*id="undoSample"[\s\S]*id="clearSamples"/);
  assert.match(editorScript, /dispatchCommand\("setPointsPerRow"/);
  assert.match(editorScript, /dispatchCommand\("setGridTolerance"/);
  assert.match(editorScript, /dispatchCommand\("setQualityPreset"/);
  assert.match(panelScript, /pointsPerRow: normalizePointsPerRow/);
  assert.match(panelScript, /gridTolerance: normalizeGridTolerance/);
  assert.match(panelScript, /qualityPreset: selected\("qualityPreset"\) \|\| "standard"/);
  assert.match(editorScript, /GX_SAMPLE_EDITOR_BRIDGE/);
  assert.match(editorScript, /closeExtension/);
  assert.match(installer, /if defined REG_FAILED/);
  assert.match(installer, /REGEXE%" query .*PlayerDebugMode/i);
  assert.match(installer, /Could not remove the previous installation/);
  assert.match(installer, /setlocal EnableExtensions DisableDelayedExpansion/i);
  assert.match(installer, /tasklist\.exe/i);
  assert.match(installer, /if \/I not "%DST_PARENT%"=="%CEP_ROOT%"/i);
  assert.match(installer, /for %%V in \(9 10 11 12 13 14 15\)/);
  assert.match(installer, /"%FCEXE%" \/B/i);
  assert.match(installer, /PlayerDebugMode \*REG_SZ \*1\$/);
  assert.match(installer, /sample-editor-window\.js/);
  assert.match(installer, /neutral-editor-window\.html/);
  assert.match(uninstaller, /setlocal EnableExtensions DisableDelayedExpansion/i);
  assert.match(uninstaller, /tasklist\.exe/i);
  assert.match(uninstaller, /if \/I not "%DST_PARENT%"=="%CEP_ROOT%"/i);
  assert.match(uninstaller, /set "REMOVE_DEBUG=N"/);
  assert.match(uninstaller, /"%~1"=="\/remove-debug"/i);
  assert.match(uninstaller, /REGEXE%" delete .*PlayerDebugMode/i);
  assert.match(uninstaller, /for %%V in \(9 10 11 12 13 14 15\)/);
  assert.doesNotMatch(uninstaller, /rmdir \/S \/Q "%CEP_ROOT%"/i);
  assert.match(readme, /Uninstall_Windows\.bat \/remove-debug/);
  assert.match(integrationRunner, /Photoshop\.Application/);
  assert.match(integrationRunner, /Photoshop_Integration_Result\.txt/);
  assert.match(integrationScript, /GX_exportInput\(tempTiff\.fsName, "sky"\)/);
  assert.match(integrationScript, /GX_exportInput\(tempTiff\.fsName, "layer-sky"\)/);
  assert.match(integrationScript, /GX_importResultById/);
  assert.match(integrationScript, /문서 이름 fallback이 차단되지 않았습니다/);
  assert.doesNotMatch(fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8"), /GX_findDocumentByName/);
  assert.match(integrationScript, /GX_exportSamplePreview/);
  assert.match(fs.readFileSync(path.join(panelDir, "host", "host.jsx"), "utf8"), /function GX_getSkyMaskStatus\(\)/);
}

function testGraXpertProcessController(api) {
  function emitter() {
    var handlers = {};
    return {
      on: function (name, callback) { handlers[name] = handlers[name] || []; handlers[name].push(callback); },
      emit: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        (handlers[name] || []).forEach(function (callback) { callback.apply(null, args); });
      }
    };
  }
  function childProcess() {
    var child = emitter();
    child.stdout = emitter();
    child.stderr = emitter();
    child.killCount = 0;
    child.kill = function () { child.killCount++; return true; };
    return child;
  }
  function fakeTimers() {
    var entries = [];
    return {
      entries: entries,
      setTimeout: function (callback) {
        var entry = { callback:callback, cleared:false };
        entries.push(entry);
        return entry;
      },
      clearTimeout: function (entry) { if (entry) entry.cleared = true; },
      fireLatestActive: function () {
        for (var i=entries.length - 1; i>=0; i--) {
          if (!entries[i].cleared) { entries[i].callback(); return; }
        }
        throw new Error("실행할 타이머가 없습니다.");
      }
    };
  }

  var successChild = childProcess();
  var successTimers = fakeTimers();
  var successResult = null;
  api.spawnGraXpertProcess({ spawn:function () { return successChild; } }, "gx.exe", ["-cli"], {
    timeoutMs:1000, outputLimit:4096,
    setTimeout:successTimers.setTimeout, clearTimeout:successTimers.clearTimeout
  }, function (error, stdout, stderr) {
    successResult = { error:error, stdout:stdout, stderr:stderr };
  });
  successChild.stdout.emit("data", new Array(5001).join("x"));
  successChild.stderr.emit("data", "warning");
  successChild.emit("close", 0, null);
  assert.strictEqual(successResult.error, null);
  assert.strictEqual(successResult.stdout.length, 4096);
  assert.strictEqual(successResult.stderr, "warning");

  var cancelChild = childProcess();
  var cancelTimers = fakeTimers();
  var cancelError = null;
  var cancelController = api.spawnGraXpertProcess({ spawn:function () { return cancelChild; } }, "gx.exe", [], {
    timeoutMs:1000, setTimeout:cancelTimers.setTimeout, clearTimeout:cancelTimers.clearTimeout
  }, function (error) { cancelError = error; });
  cancelController.cancel();
  assert.strictEqual(cancelChild.killCount, 1);
  cancelChild.emit("close", null, "SIGTERM");
  assert.strictEqual(cancelError.gxCode, "GX_CANCELLED");

  var timeoutChild = childProcess();
  var timeoutTimers = fakeTimers();
  var timeoutError = null;
  api.spawnGraXpertProcess({ spawn:function () { return timeoutChild; } }, "gx.exe", [], {
    timeoutMs:1000, setTimeout:timeoutTimers.setTimeout, clearTimeout:timeoutTimers.clearTimeout
  }, function (error) { timeoutError = error; });
  timeoutTimers.fireLatestActive();
  assert.strictEqual(timeoutChild.killCount, 1);
  timeoutChild.emit("close", null, "SIGTERM");
  assert.strictEqual(timeoutError.gxCode, "GX_TIMEOUT");
}

function testMalformedImageGuards(api) {
  function readTiffInfo(file) {
    var fd = fs.openSync(file, "r");
    try { return api.readUint16RgbTiffInfo(fd); }
    finally { fs.closeSync(fd); }
  }

  var badIfd = Buffer.alloc(8);
  badIfd.write("II", 0, 2, "ascii");
  badIfd.writeUInt16LE(42, 2);
  badIfd.writeUInt32LE(1024, 4);
  var badIfdFile = path.join(testDir, "bad-ifd.tif");
  fs.writeFileSync(badIfdFile, badIfd);
  assert.throws(function () { readTiffInfo(badIfdFile); }, /TIFF IFD.*파일 크기/);

  var hugeTag = Buffer.alloc(26);
  hugeTag.write("II", 0, 2, "ascii");
  hugeTag.writeUInt16LE(42, 2);
  hugeTag.writeUInt32LE(8, 4);
  hugeTag.writeUInt16LE(1, 8);
  hugeTag.writeUInt16LE(258, 10);
  hugeTag.writeUInt16LE(4, 12);
  hugeTag.writeUInt32LE(0xFFFFFFFF, 14);
  hugeTag.writeUInt32LE(0, 18);
  hugeTag.writeUInt32LE(0, 22);
  var hugeTagFile = path.join(testDir, "huge-tag.tif");
  fs.writeFileSync(hugeTagFile, hugeTag);
  assert.throws(function () { readTiffInfo(hugeTagFile); }, /메모리 안전 제한/);

  var sourceFits = createFits("strip-source", -32, [2, 1], [0, 1]);
  var corruptStripFile = path.join(testDir, "corrupt-strip.tif");
  api.convertFitsToTiff(sourceFits, corruptStripFile);
  var corrupt = fs.readFileSync(corruptStripFile);
  var ifdOffset = corrupt.readUInt32LE(4);
  var entryCount = corrupt.readUInt16LE(ifdOffset);
  for (var i=0; i<entryCount; i++) {
    var entryAt = ifdOffset + 2 + i * 12;
    if (corrupt.readUInt16LE(entryAt) === 273) {
      corrupt.writeUInt32LE(corrupt.length + 100, entryAt + 8);
    }
  }
  fs.writeFileSync(corruptStripFile, corrupt);
  assert.throws(function () { readTiffInfo(corruptStripFile); }, /TIFF strip 0.*파일 크기/);

  var unsafeFits = createFits("unsafe-dimensions", 8, [9007199254740992, 2], []);
  var unsafeOutput = path.join(testDir, "unsafe-dimensions.tif");
  assert.throws(function () { api.convertFitsToTiff(unsafeFits, unsafeOutput); }, /FITS 크기|안전한 정수/);
  assert.strictEqual(fs.existsSync(unsafeOutput), false);
}

function readTiffPreviewForAnalysis(api, file, maxWidth, maxHeight, skyFraction) {
  var fd = fs.openSync(file, "r");
  try {
    var info = api.readRgbTiffInfo(fd);
    var scale = Math.min(1, maxWidth / info.width, maxHeight / info.height);
    var width = Math.max(1, Math.round(info.width * scale));
    var height = Math.max(1, Math.round(info.height * scale));
    var pixels = new Uint8ClampedArray(width * height * 4);
    var mask = new Uint8ClampedArray(width * height * 4);
    var sourceRow = Buffer.alloc(info.rowBytes);
    var lastSourceY = -1;
    function rowPosition(rowIndex) {
      var stripIndex = Math.floor(rowIndex / info.rowsPerStrip);
      return info.stripOffsets[stripIndex] +
        (rowIndex - stripIndex * info.rowsPerStrip) * info.rowBytes;
    }
    for (var y=0; y<height; y++) {
      var sourceY = Math.min(info.height - 1, Math.round(y / Math.max(1, height - 1) * (info.height - 1)));
      if (sourceY !== lastSourceY) {
        var bytesRead = fs.readSync(fd, sourceRow, 0, sourceRow.length, rowPosition(sourceY));
        if (bytesRead !== sourceRow.length) throw new Error("실제 이미지 Preview 행 읽기가 중단되었습니다.");
        lastSourceY = sourceY;
      }
      for (var x=0; x<width; x++) {
        var sourceX = Math.min(info.width - 1, Math.round(x / Math.max(1, width - 1) * (info.width - 1)));
        var sourceAt = sourceX * 3 * info.bytesPerSample;
        var targetAt = (y * width + x) * 4;
        for (var channel=0; channel<3; channel++) {
          var value = info.bits === 32
            ? sourceRow.readFloatLE(sourceAt + channel * 4) * 255
            : sourceRow.readUInt16LE(sourceAt + channel * 2) / 257;
          pixels[targetAt + channel] = isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;
        }
        pixels[targetAt + 3] = 255;
        var selected = sourceY < info.height * skyFraction ? 255 : 0;
        mask[targetAt] = mask[targetAt + 1] = mask[targetAt + 2] = selected;
        mask[targetAt + 3] = 255;
      }
    }
    return { info:info, image:{ width:width, height:height, data:pixels },
      mask:{ width:width, height:height, data:mask } };
  } finally {
    fs.closeSync(fd);
  }
}

function cleanup() {
  var tempRoot = path.resolve(os.tmpdir());
  var resolved = path.resolve(testDir);
  assert.strictEqual(path.dirname(resolved), tempRoot);
  assert.match(path.basename(resolved), /^gx-panel-test-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

try {
  var api = loadPanelApi();
  if (process.argv[2] === "--write-neutral-float-fixture") {
    var fixturePath = path.resolve(process.argv[3] || "");
    if (!process.argv[3]) throw new Error("32-bit TIFF fixture 출력 경로가 필요합니다.");
    var fixturePixels = [];
    for (var fixturePixel=0; fixturePixel<32 * 32; fixturePixel++) {
      fixturePixels.push(fixturePixel === 0 ? -0.05 : 0.3);
      fixturePixels.push(0.2);
      fixturePixels.push(fixturePixel === 0 ? 1.2 : 0.1);
    }
    var fixtureInput = createFloatRgbTiff(api, "neutral-float32-photoshop-input", 32, 32, fixturePixels);
    api.neutralizeGeneratedTiff(
      fixtureInput, fixturePath, [{ x:16, y:16 }], 12, 100
    );
    assert.ok(fs.statSync(fixturePath).size > 0, "32-bit TIFF fixture가 비어 있습니다.");
    cleanup();
    console.log("32-bit Neutralise TIFF fixture created: " + fixturePath);
    process.exit(0);
  }
  if (process.argv[2] === "--neutralize-existing-tiff") {
    var existingInputPath = path.resolve(process.argv[3] || "");
    var existingOutputPath = path.resolve(process.argv[4] || "");
    if (!process.argv[3] || !process.argv[4]) {
      throw new Error("Neutralise 입력 및 출력 TIFF 경로가 필요합니다.");
    }
    var existingInfoFd = fs.openSync(existingInputPath, "r");
    var existingInfo;
    try { existingInfo = api.readRgbTiffInfo(existingInfoFd); }
    finally { fs.closeSync(existingInfoFd); }
    var existingResult = api.neutralizeGeneratedTiff(
      existingInputPath, existingOutputPath,
      [{ x:Math.floor(existingInfo.width / 2), y:Math.floor(existingInfo.height / 2) }],
      Math.max(2, Math.min(12, Math.floor(Math.min(existingInfo.width, existingInfo.height) / 3))),
      100
    );
    assert.strictEqual(existingResult.outputBits, 32, "Photoshop 입력 TIFF가 32-bit가 아닙니다.");
    assert.strictEqual(existingResult.iccProfilePreserved, true,
      "Photoshop 입력 TIFF의 ICC 프로파일을 보존하지 못했습니다.");
    cleanup();
    console.log("Photoshop 32-bit TIFF neutralized with ICC profile preserved.");
    process.exit(0);
  }
  if (process.argv[2] === "--analyze-neutral-tiff") {
    var realInputPath = path.resolve(process.argv[3] || "");
    var realOutputPath = path.resolve(process.argv[4] || "");
    var realReportPath = path.resolve(process.argv[5] || "");
    var realSkyFraction = Math.max(0.1, Math.min(1, Number(process.argv[6]) || 0.66));
    if (!process.argv[3] || !process.argv[4] || !process.argv[5]) {
      throw new Error("실제 TIFF 입력, 결과 및 분석 보고서 경로가 필요합니다.");
    }
    var realPreview = readTiffPreviewForAnalysis(api, realInputPath, 900, 900, realSkyFraction);
    api.setPreviewAnalysisForTest(
      { docId:1, originalWidth:realPreview.info.width, originalHeight:realPreview.info.height,
        previewWidth:realPreview.image.width, previewHeight:realPreview.image.height,
        hasSelection:true, mode:"neutralize", scope:"layer-sky" },
      realPreview.image, realPreview.mask
    );
    api.setSampleGenerationOptionsForTest(15, 1.0, 25);
    api.setSelectionOnlyForTest(true);
    api.setSamplePoints([]);
    var realGrid = api.generateAutomaticSamplePoints({ selectionOnly:true, neutral:true });
    var realPoints = realGrid ? realGrid.points.filter(function(point) {
      return api.neutralQualityWeight(point) > 0;
    }) : [];
    if (realPoints.length < 5) throw new Error("실제 이미지의 안전한 Background Point가 5개 미만입니다.");
    var realResult = api.neutralizeGeneratedTiff(
      realInputPath, realOutputPath, realPoints, 25, 100,
      { colorReject:true, minimumPoints:5 }
    );
    var realReport = {
      source:path.basename(realInputPath), width:realPreview.info.width, height:realPreview.info.height,
      bits:realPreview.info.bits, skyFraction:realSkyFraction,
      generatedPoints:realGrid.points.length, acceptedPoints:realResult.pointCount,
      colorOutliers:realResult.rejectedColorCount, background:realResult.background,
      target:realResult.target, offsets:realResult.offsets,
      clippedLow:realResult.clippedLow, clippedHigh:realResult.clippedHigh,
      iccProfilePreserved:realResult.iccProfilePreserved,
      points:realGrid.points
    };
    fs.writeFileSync(realReportPath, JSON.stringify(realReport, null, 2), "utf8");
    cleanup();
    console.log(JSON.stringify({ output:realOutputPath, report:realReportPath,
      points:realResult.pointCount, colorOutliers:realResult.rejectedColorCount,
      background:realResult.background, offsets:realResult.offsets }));
    process.exit(0);
  }
  var gradientStateFile = path.join(testDir, "GraXpert_Photoshop", "gradient_editor_state.json");
  var neutralStateFile = path.join(testDir, "GraXpert_Photoshop", "neutral_editor_state.json");
  assert.ok(fs.existsSync(gradientStateFile));
  assert.ok(fs.existsSync(neutralStateFile));
  assert.strictEqual(JSON.parse(fs.readFileSync(gradientStateFile, "utf8")).ready, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(neutralStateFile, "utf8")).ready, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(gradientStateFile, "utf8")).editorMode, "background");
  assert.strictEqual(JSON.parse(fs.readFileSync(neutralStateFile, "utf8")).editorMode, "neutralize");
  assert.strictEqual(api.editorConfig("background").extensionId, "com.drmedia.graxpertps.gradienteditor");
  assert.strictEqual(api.editorConfig("background").stateFile, "gradient_editor_state.json");
  assert.strictEqual(api.editorConfig("neutralize").extensionId, "com.drmedia.graxpertps.neutraleditor");
  assert.strictEqual(api.editorConfig("neutralize").stateFile, "neutral_editor_state.json");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.parsePhotoshopExport("OK|7|100|50|S:mask|L:42|C:selection%3A1%2C2%2C90%2C40|sky|target.psd"))),
    { docId:7, width:100, height:50, maskToken:"S:mask", sourceLayerId:42,
      analysisContext:"selection:1,2,90,40", docName:"sky|target.psd" }
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.parsePhotoshopExport("OK|7|100|50||legacy|name.psd"))),
    { docId:7, width:100, height:50, maskToken:"", sourceLayerId:-1,
      analysisContext:"", docName:"legacy|name.psd" }
  );
  var validPreviewContext = {
    mode:"background", scope:"layer", docId:7, sourceLayerId:42,
    originalWidth:100, originalHeight:50, analysisContext:"selection:1,2,90,40"
  };
  var validExportContext = {
    docId:7, sourceLayerId:42, width:100, height:50,
    analysisContext:"selection:1,2,90,40"
  };
  assert.strictEqual(api.previewContextError(validPreviewContext, validExportContext, "background", "layer"), "");
  assert.match(api.previewContextError(validPreviewContext,
    Object.assign({}, validExportContext, { sourceLayerId:43 }), "background", "layer"), /현재 레이어/);
  assert.match(api.previewContextError(validPreviewContext,
    Object.assign({}, validExportContext, { analysisContext:"selection:2,2,90,40" }), "background", "layer"), /선택 영역/);
  testConversion(api, "gray-f32", -32, [2, 2], [0, 0.5, 1, NaN], {
    width: 2, height: 2,
    pixels: [0,0,0, 32768,32768,32768, 65535,65535,65535, 0,0,0]
  });
  testConversion(api, "rgb-planar-f32", -32, [2, 1, 3], [0,1, 0.25,0.75, 0.5,0.1], {
    width: 2, height: 1, pixels: [0,16384,32768, 65535,49151,6554]
  });
  testConversion(api, "gray-i16", 16, [2, 1], [0, 255], {
    width: 2, height: 1, pixels: [0,0,0, 65535,65535,65535]
  }, 1, 0);

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.getStretchPreset("30% Bg, 2 sigma"))),
    { name: "30% Bg, 2 sigma", bg: 0.3, sigma: 2, enabled: true }
  );
  var previewData = new Uint8ClampedArray(12 * 4);
  for (var pv=0; pv<12; pv++) {
    var previewLevel = pv < 10 ? 8 + pv : 200;
    previewData[pv * 4] = previewData[pv * 4 + 1] = previewData[pv * 4 + 2] = previewLevel;
    previewData[pv * 4 + 3] = 255;
  }
  var stretchedPreview = api.applyPreviewStretch(
    { width: 12, height: 1, data: previewData }, "15% Bg, 3 sigma"
  );
  assert.strictEqual(previewData[5 * 4], 13);
  assert.ok(stretchedPreview.data[5 * 4] > previewData[5 * 4]);

  var colorPreview = { width: 1, height: 1, data: new Uint8ClampedArray([200, 100, 50, 123]) };
  var grayscalePreview = api.applyPreviewSaturation(colorPreview, 0);
  assert.deepStrictEqual(Array.from(grayscalePreview.data), [124, 124, 124, 123]);
  var unchangedPreview = api.applyPreviewSaturation(colorPreview, 1);
  assert.deepStrictEqual(Array.from(unchangedPreview.data), [200, 100, 50, 123]);
  var saturatedPreview = api.applyPreviewSaturation(colorPreview, 1.8);
  assert.ok(saturatedPreview.data[0] > colorPreview.data[0]);
  assert.ok(saturatedPreview.data[2] < colorPreview.data[2]);
  assert.strictEqual(saturatedPreview.data[3], 123);

  var neutralValues = [];
  for (var nc=0; nc<3; nc++) {
    for (var np=0; np<25; np++) {
      neutralValues.push(np === 24 ? 1 : [0.1, 0.2, 0.3][nc]);
    }
  }
  var neutralFits = createFits("neutral-linear", -32, [5, 5, 3], neutralValues);
  var neutralInput = path.join(testDir, "neutral-linear.tif");
  var neutralOutput = path.join(testDir, "neutral-result.tif");
  api.convertFitsToTiff(neutralFits, neutralInput);
  var neutralResult = api.neutralizeGeneratedTiff(
    neutralInput, neutralOutput, [{ x:2, y:2 }], 2, 100
  );
  var neutralPixels = readTiff(neutralOutput).pixels;
  var neutralCenter = neutralPixels.slice((2 * 5 + 2) * 3, (2 * 5 + 2) * 3 + 3);
  assert.ok(Math.max.apply(Math, neutralCenter) - Math.min.apply(Math, neutralCenter) <= 16, neutralCenter.join(","));
  assert.ok(neutralResult.background[0] < neutralResult.background[1]);
  assert.ok(neutralResult.background[1] < neutralResult.background[2]);
  assert.strictEqual(neutralResult.target, neutralResult.background[1]);
  assert.strictEqual(neutralResult.pointCount, 1);
  assert.strictEqual(neutralResult.strength, 100);
  assert.strictEqual(neutralResult.clippedLowTotal, 0);
  assert.strictEqual(neutralResult.clippedHighTotal, 1);
  assert.strictEqual(api.normalizeNeutralStrength(-5), 0);
  assert.strictEqual(api.normalizeNeutralStrength(150), 100);
  var nearlyNeutral = api.assessNeutralBalance([13608, 13577, 13561], 65535);
  assert.strictEqual(nearlyNeutral.label, "거의 중립");
  assert.strictEqual(nearlyNeutral.recommendedStrength, 25);
  assert.ok(nearlyNeutral.offsetsPercent[0] < 0);
  assert.ok(nearlyNeutral.offsetsPercent[2] > 0);
  var strongNeutral = api.assessNeutralBalance([10000, 10200, 10400], 65535);
  assert.strictEqual(strongNeutral.label, "보정 권장");
  assert.strictEqual(strongNeutral.recommendedStrength, 100);
  assert.match(api.clippingChannelText([10, 0, 5], 1000), /R 10 \(1\.000%\).*B 5 \(0\.500%\)/);

  var clippingValues = [];
  for (var clippingChannel=0; clippingChannel<3; clippingChannel++) {
    for (var clippingPixel=0; clippingPixel<25; clippingPixel++) {
      var clippingValue = [0.3, 0.2, 0.1][clippingChannel];
      if (clippingPixel === 0 && clippingChannel === 0) clippingValue = 0;
      if (clippingPixel === 0 && clippingChannel === 2) clippingValue = 1;
      clippingValues.push(clippingValue);
    }
  }
  var clippingFits = createFits("neutral-clipping", -32, [5, 5, 3], clippingValues);
  var clippingInput = path.join(testDir, "neutral-clipping.tif");
  var clippingOutput = path.join(testDir, "neutral-clipping-result.tif");
  api.convertFitsToTiff(clippingFits, clippingInput);
  var clippingResult = api.neutralizeGeneratedTiff(
    clippingInput, clippingOutput, [{ x:2, y:2 }], 2, 100
  );
  assert.ok(clippingResult.clippedLowTotal > 0, JSON.stringify(clippingResult));
  assert.ok(clippingResult.clippedHighTotal > 0, JSON.stringify(clippingResult));

  var floatPixels = [];
  for (var floatPixel=0; floatPixel<25; floatPixel++) {
    floatPixels.push(floatPixel === 0 ? -0.05 : 0.3);
    floatPixels.push(0.2);
    floatPixels.push(floatPixel === 0 ? 1.2 : 0.1);
  }
  var testIccProfile = createTestIccProfile();
  var floatInput = createFloatRgbTiff(api, "neutral-float32", 5, 5, floatPixels, testIccProfile);
  var floatOutput = path.join(testDir, "neutral-float32-result.tif");
  var floatResult = api.neutralizeGeneratedTiff(
    floatInput, floatOutput, [{ x:2, y:2 }], 2, 100
  );
  var floatResultPixels = readFloatRgbTiff(api, floatOutput).values;
  assert.strictEqual(floatResult.outputBits, 32);
  assert.strictEqual(floatResult.fullScale, 1);
  assert.strictEqual(floatResult.rangeExcursionsPreserved, true);
  assert.strictEqual(floatResult.iccProfilePreserved, true);
  var floatOutputFd = fs.openSync(floatOutput, "r");
  try {
    assert.deepStrictEqual(api.readRgbTiffInfo(floatOutputFd).iccProfile, testIccProfile);
  } finally {
    fs.closeSync(floatOutputFd);
  }
  assert.ok(floatResult.clippedLowTotal > 0);
  assert.ok(floatResult.clippedHighTotal > 0);
  assert.ok(floatResultPixels[0] < -0.1, String(floatResultPixels[0]));
  assert.ok(floatResultPixels[2] > 1.25, String(floatResultPixels[2]));

  var collisionSize = fs.statSync(floatInput).size;
  assert.throws(function () {
    api.neutralizeGeneratedTiff(floatInput, floatInput, [{ x:2, y:2 }], 2, 100);
  }, /입력 TIFF와 출력 TIFF 경로/);
  assert.strictEqual(fs.statSync(floatInput).size, collisionSize,
    "입출력 경로 충돌 검사에서 원본 TIFF가 변경되었습니다.");

  var partialOutput = path.join(testDir, "neutral-partial-write.tif");
  var originalWriteSync = fs.writeSync;
  var writeCallCount = 0;
  fs.writeSync = function() {
    writeCallCount++;
    if (writeCallCount >= 2) throw new Error("forced neutral output write failure");
    return originalWriteSync.apply(fs, arguments);
  };
  try {
    assert.throws(function () {
      api.neutralizeGeneratedTiff(floatInput, partialOutput, [{ x:2, y:2 }], 2, 100);
    }, /forced neutral output write failure/);
  } finally {
    fs.writeSync = originalWriteSync;
  }
  assert.strictEqual(fs.existsSync(partialOutput), false,
    "쓰기 실패 후 불완전한 Neutralise TIFF가 남았습니다.");
  assert.strictEqual(fs.existsSync(floatInput), true,
    "쓰기 실패 후 진단용 입력 TIFF가 삭제되었습니다.");

  var uintIccPixels = [];
  for (var uintIccPixel=0; uintIccPixel<25; uintIccPixel++) {
    uintIccPixels.push(18000, 14000, 10000);
  }
  var uintIccInput = createUint16RgbTiff(
    api, "neutral-uint16-icc", 5, 5, uintIccPixels, testIccProfile
  );
  var uintIccOutput = path.join(testDir, "neutral-uint16-icc-result.tif");
  var uintIccResult = api.neutralizeGeneratedTiff(
    uintIccInput, uintIccOutput, [{ x:2, y:2 }], 2, 100
  );
  assert.strictEqual(uintIccResult.outputBits, 16);
  assert.strictEqual(uintIccResult.iccProfilePreserved, true);
  var uintIccOutputFd = fs.openSync(uintIccOutput, "r");
  try {
    assert.deepStrictEqual(api.readRgbTiffInfo(uintIccOutputFd).iccProfile, testIccProfile);
  } finally {
    fs.closeSync(uintIccOutputFd);
  }

  // End-to-end linear astro regression: a smooth light-pollution gradient is
  // retained, while a constant RGB background cast is neutralized. Milky Way
  // and foreground samples marked as excluded must not affect the estimate.
  var astroLinearWidth = 80, astroLinearHeight = 60;
  var astroLinearPixels = [];
  for (var astroLinearY=0; astroLinearY<astroLinearHeight; astroLinearY++) {
    for (var astroLinearX=0; astroLinearX<astroLinearWidth; astroLinearX++) {
      var astroLinearBase = 0.12 + astroLinearX * 0.001 + astroLinearY * 0.0002;
      var astroLinearRgb = [astroLinearBase + 0.03, astroLinearBase, astroLinearBase - 0.02];
      if (astroLinearX >= 30 && astroLinearX <= 46 && astroLinearY < 45) {
        astroLinearRgb = [astroLinearBase + 0.18, astroLinearBase + 0.10, astroLinearBase + 0.06];
      }
      if (astroLinearY >= 45) {
        astroLinearRgb = [0.04, 0.025, 0.015];
      }
      astroLinearPixels.push(astroLinearRgb[0], astroLinearRgb[1], astroLinearRgb[2]);
    }
  }
  var astroLinearInput = createFloatRgbTiff(
    api, "neutral-astro-regression", astroLinearWidth, astroLinearHeight,
    astroLinearPixels, testIccProfile
  );
  var astroLinearOutput = path.join(testDir, "neutral-astro-regression-result.tif");
  var astroLinearPoints = [
    { x:10, y:10, quality:{ status:"good", score:90 } },
    { x:65, y:10, quality:{ status:"good", score:90 } },
    { x:10, y:32, quality:{ status:"good", score:90 } },
    { x:65, y:32, quality:{ status:"good", score:90 } },
    { x:38, y:20, quality:{ status:"exclude", score:10 } },
    { x:40, y:52, quality:{ status:"exclude", score:10 } }
  ];
  var astroLinearResult = api.neutralizeGeneratedTiff(
    astroLinearInput, astroLinearOutput, astroLinearPoints, 2, 100,
    { minimumPoints:4 }
  );
  var astroLinearOutputPixels = readFloatRgbTiff(api, astroLinearOutput).values;
  function astroOutputRgb(x, y) {
    var pixelAt = (y * astroLinearWidth + x) * 3;
    return astroLinearOutputPixels.slice(pixelAt, pixelAt + 3);
  }
  var cleanLeft = astroOutputRgb(10, 10);
  var cleanRight = astroOutputRgb(65, 10);
  assert.ok(Math.max.apply(Math, cleanLeft) - Math.min.apply(Math, cleanLeft) < 0.00001,
    cleanLeft.join(","));
  assert.ok(Math.max.apply(Math, cleanRight) - Math.min.apply(Math, cleanRight) < 0.00001,
    cleanRight.join(","));
  assert.ok(Math.abs((cleanRight[1] - cleanLeft[1]) - 0.055) < 0.00001,
    "Smooth gradient was not preserved: " + cleanLeft[1] + " -> " + cleanRight[1]);
  assert.strictEqual(astroLinearResult.pointCount, 4);
  assert.strictEqual(astroLinearResult.iccProfilePreserved, true);

  var outlierValues = [];
  for (var outlierChannel=0; outlierChannel<3; outlierChannel++) {
    for (var outlierPixel=0; outlierPixel<25 * 5; outlierPixel++) {
      var outlierX = outlierPixel % 25;
      var normalValue = [0.1, 0.2, 0.3][outlierChannel];
      var unusualValue = [0.5, 0.05, 0.05][outlierChannel];
      outlierValues.push(outlierX >= 20 ? unusualValue : normalValue);
    }
  }
  var outlierFits = createFits("neutral-outlier", -32, [25, 5, 3], outlierValues);
  var outlierInput = path.join(testDir, "neutral-outlier.tif");
  var outlierOutput = path.join(testDir, "neutral-outlier-result.tif");
  api.convertFitsToTiff(outlierFits, outlierInput);
  var outlierResult = api.neutralizeGeneratedTiff(
    outlierInput, outlierOutput,
    [2, 7, 12, 17, 22].map(function(x) {
      return { x:x, y:2, quality:{ status:"good", score:90 } };
    }),
    2, 100, { colorReject:true, minimumPoints:4 }
  );
  assert.strictEqual(outlierResult.candidateCount, 5);
  assert.strictEqual(outlierResult.rejectedColorCount, 1);
  assert.strictEqual(outlierResult.pointCount, 4);
  assert.strictEqual(outlierResult.colorThreshold, 0.025);

  var backgroundSource = createFits("output_123_background", -32, [1, 1], [0.5]);
  assert.strictEqual(api.findBackgroundOutput(path.join(testDir, "output_123")), backgroundSource);
  var saved = api.saveBackgroundOutput(backgroundSource, "M31:stack.psd", 123);
  assert.strictEqual(path.basename(saved), "M31_stack_GraXpert_background_123.fits");
  assert.ok(fs.existsSync(saved));
  assert.ok(!fs.existsSync(backgroundSource));

  var preferencesFile = path.join(testDir, "preferences.json");
  api.setSamplePoints([{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }]);
  var preferences = api.createGradientPreferences(preferencesFile, "RBF", 100, 80);
  assert.strictEqual(preferences.interpol_type_option, "RBF");
  assert.strictEqual(JSON.stringify(preferences.background_points), JSON.stringify([[10,20,1], [30,40,1], [50,60,1]]));
  assert.strictEqual(preferences.sample_size, 25);
  assert.strictEqual(preferences.bg_pts_option, 15);
  assert.strictEqual(preferences.bg_tol_option, 1.0);
  assert.strictEqual(preferences.display_pts, true);
  assert.strictEqual(preferences.bg_flood_selection_option, false);
  assert.strictEqual(
    JSON.stringify(JSON.parse(fs.readFileSync(preferencesFile, "utf8")).background_points),
    JSON.stringify(preferences.background_points)
  );
  api.setSamplePoints([
    { x:11, y:21, quality:{ status:"good" } },
    { x:31, y:41, quality:{ status:"warning" } },
    { x:51, y:61, quality:{ status:"exclude" } }
  ]);
  var qualityPreferences = api.createGradientPreferences(
    path.join(testDir, "quality-preferences.json"), "RBF", 100, 80
  );
  assert.strictEqual(JSON.stringify(qualityPreferences.background_points), JSON.stringify([[11,21,1]]));
  var cliArgs = api.buildGraXpertArgs("input.tif", "output", preferencesFile);
  var preferencesIndex = cliArgs.indexOf("-preferences_file");
  assert.ok(preferencesIndex >= 0);
  assert.strictEqual(cliArgs[preferencesIndex + 1], preferencesFile);
  assert.strictEqual(cliArgs[cliArgs.indexOf("-cmd") + 1], "background-extraction");

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.calculateCanvasSize(1400, 900, 300, 360))),
    { width: 300, height: 193 }
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.calculateCanvasSize(900, 1400, 300, 360))),
    { width: 231, height: 360 }
  );
  var mapped = api.mapClientPoint(160, 95, { left: 10, top: 20, width: 300, height: 150 }, 300, 150);
  assert.strictEqual(mapped.x, 150);
  assert.strictEqual(mapped.y, 75);

  var qualityPixels = new Uint8ClampedArray(20 * 20 * 4);
  for (var qp=0; qp<20 * 20; qp++) {
    qualityPixels[qp * 4] = 20;
    qualityPixels[qp * 4 + 1] = 20;
    qualityPixels[qp * 4 + 2] = 20;
    qualityPixels[qp * 4 + 3] = 255;
  }
  for (var qy=12; qy<20; qy++) {
    for (var qx=12; qx<20; qx++) {
      var qat = (qy * 20 + qx) * 4;
      qualityPixels[qat] = qualityPixels[qat + 1] = qualityPixels[qat + 2] = 240;
    }
  }
  var qualityImage = { width: 20, height: 20, data: qualityPixels };
  var qualityStats = api.calculateLuminanceStats(qualityImage);
  var qualityState = { originalWidth: 20, originalHeight: 20 };
  assert.strictEqual(api.analyzeSamplePoint({ x: 4, y: 4 }, 2, qualityImage, qualityStats, qualityState).status, "good");
  assert.strictEqual(api.analyzeSamplePoint({ x: 16, y: 16 }, 2, qualityImage, qualityStats, qualityState).status, "exclude");

  var selectedStatsMask = new Uint8ClampedArray(20 * 20 * 4);
  for (var selectedStatsPixel=0; selectedStatsPixel<20 * 20; selectedStatsPixel++) {
    var selectedStatsY = Math.floor(selectedStatsPixel / 20);
    var selectedStatsAt = selectedStatsPixel * 4;
    var selectedStatsValue = selectedStatsY < 10 ? 255 : 0;
    selectedStatsMask[selectedStatsAt] = selectedStatsMask[selectedStatsAt + 1] =
      selectedStatsMask[selectedStatsAt + 2] = selectedStatsValue;
    selectedStatsMask[selectedStatsAt + 3] = 255;
  }
  var selectedQualityStats = api.calculateLuminanceStats(
    qualityImage, { width:20, height:20, data:selectedStatsMask }
  );
  assert.ok(selectedQualityStats.p85 < qualityStats.p85,
    "선택 영역 밖의 밝은 전경이 하늘 품질 통계에 포함되었습니다.");

  function multiscaleImage(painter) {
    var pixels = new Uint8ClampedArray(101 * 101 * 4);
    for (var my=0; my<101; my++) {
      for (var mx=0; mx<101; mx++) {
        var rgb = painter(mx, my);
        if (typeof rgb === "number") rgb = [rgb, rgb, rgb];
        var mat = (my * 101 + mx) * 4;
        pixels[mat] = rgb[0]; pixels[mat + 1] = rgb[1]; pixels[mat + 2] = rgb[2];
        pixels[mat + 3] = 255;
      }
    }
    return { width:101, height:101, data:pixels };
  }
  var smoothGradient = multiscaleImage(function(x, y) {
    return 20 + x * 0.12 + y * 0.06;
  });
  var smoothDiffuse = api.analyzeDiffuseStructure(
    { x:50, y:50 }, 12, smoothGradient, api.calculateLuminanceStats(smoothGradient),
    { originalWidth:101, originalHeight:101 }, api.getQualityConfig("standard")
  );
  assert.strictEqual(smoothDiffuse.status, "good", JSON.stringify(smoothDiffuse));
  var milkyWayBand = multiscaleImage(function(x, y) {
    var base = 20 + x * 0.08 + y * 0.04;
    if (Math.abs(x - y) < 13) base += 16 + ((x * 13 + y * 7) % 9);
    return base;
  });
  var bandDiffuse = api.analyzeDiffuseStructure(
    { x:50, y:50 }, 12, milkyWayBand, api.calculateLuminanceStats(milkyWayBand),
    { originalWidth:101, originalHeight:101 }, api.getQualityConfig("standard")
  );
  assert.notStrictEqual(bandDiffuse.status, "good", JSON.stringify(bandDiffuse));
  api.setPreviewAnalysisForTest(
    { originalWidth:101, originalHeight:101, previewWidth:101, previewHeight:101, hasSelection:false },
    milkyWayBand, null
  );
  assert.notStrictEqual(api.applyPointQuality({ x:50, y:50 }).quality.status, "good");

  function syntheticQualityImage(painter) {
    var pixels = new Uint8ClampedArray(31 * 31 * 4);
    for (var sy=0; sy<31; sy++) {
      for (var sx=0; sx<31; sx++) {
        var level = painter(sx, sy);
        var sat = (sy * 31 + sx) * 4;
        pixels[sat] = pixels[sat + 1] = pixels[sat + 2] = level;
        pixels[sat + 3] = 255;
      }
    }
    return { width: 31, height: 31, data: pixels };
  }

  var starImage = syntheticQualityImage(function(x, y) {
    var dx = x - 15, dy = y - 15;
    return dx * dx + dy * dy <= 64 && (x + y) % 8 === 0 ? 240 : 20;
  });
  var starQuality = api.analyzeSamplePoint(
    { x: 15, y: 15 }, 8, starImage, api.calculateLuminanceStats(starImage),
    { originalWidth: 31, originalHeight: 31 }
  );
  assert.strictEqual(starQuality.status, "exclude");
  assert.strictEqual(starQuality.reason, "별 밀집 영역");
  var relaxedStarQuality = api.analyzeSamplePoint(
    { x: 15, y: 15 }, 8, starImage, api.calculateLuminanceStats(starImage),
    { originalWidth: 31, originalHeight: 31 }, api.getQualityConfig("relaxed")
  );
  var strictStarQuality = api.analyzeSamplePoint(
    { x: 15, y: 15 }, 8, starImage, api.calculateLuminanceStats(starImage),
    { originalWidth: 31, originalHeight: 31 }, api.getQualityConfig("strict")
  );
  assert.notStrictEqual(relaxedStarQuality.status, "exclude", JSON.stringify(relaxedStarQuality));
  assert.strictEqual(strictStarQuality.status, "exclude");
  assert.ok(api.getQualityConfig("relaxed").starExclude > api.getQualityConfig("standard").starExclude);
  assert.ok(api.getQualityConfig("strict").starExclude < api.getQualityConfig("standard").starExclude);
  assert.strictEqual(api.normalizePointsPerRow(2), 4);
  assert.strictEqual(api.normalizePointsPerRow(99), 25);
  assert.strictEqual(api.normalizeGridTolerance(1.04), 1.0);
  assert.strictEqual(api.normalizeGridTolerance(99), 10);
  assert.strictEqual(
    JSON.stringify(api.graxpertCandidateOffsets(25)),
    JSON.stringify([[0,0],[-25,-25],[25,-25],[-25,25],[25,25]])
  );
  var toleranceStats = api.gridToleranceStats([18, 20, 22, 40], 20, 1.0);
  assert.strictEqual(toleranceStats.mad, 2);
  assert.strictEqual(toleranceStats.limit, 22);

  var autoPixels = new Uint8ClampedArray(100 * 70 * 4);
  var autoMaskPixels = new Uint8ClampedArray(100 * 70 * 4);
  for (var autoPixel=0; autoPixel<100 * 70; autoPixel++) {
    autoPixels[autoPixel * 4] = autoPixels[autoPixel * 4 + 1] = autoPixels[autoPixel * 4 + 2] = 20;
    autoPixels[autoPixel * 4 + 3] = 255;
    var autoX = autoPixel % 100;
    autoMaskPixels[autoPixel * 4] = autoMaskPixels[autoPixel * 4 + 1] =
      autoMaskPixels[autoPixel * 4 + 2] = autoX < 50 ? 255 : 0;
    autoMaskPixels[autoPixel * 4 + 3] = 255;
  }
  api.setPreviewAnalysisForTest(
    { docId:7, originalWidth:1000, originalHeight:700, previewWidth:100, previewHeight:70,
      hasSelection:true, mode:"neutralize" },
    { width:100, height:70, data:autoPixels },
    { width:100, height:70, data:autoMaskPixels }
  );
  api.setSamplePoints([]);
  api.setSelectionOnlyForTest(true);
  assert.strictEqual(api.addSamplePointAt({ width:100, height:70 }, { x:75, y:35 }), false);
  assert.strictEqual(api.addSamplePointAt({ width:100, height:70 }, { x:25, y:35 }), true);
  api.setSamplePoints([
    { x:100, y:100, quality:{ status:"good" } },
    { x:200, y:100, quality:{ status:"warning" } },
    { x:300, y:100, quality:{ status:"exclude" } }
  ]);
  assert.strictEqual(api.usableSamplePoints(false).length, 2);
  assert.strictEqual(api.usableSamplePoints(true).length, 1);
  var autoNeutral = api.generateAutomaticSamplePoints({ selectionOnly:true, neutral:true });
  assert.ok(autoNeutral.points.length >= 5);
  assert.ok(autoNeutral.points.length <= 20);
  assert.ok(autoNeutral.points.every(function(point) { return point.x < 500; }));
  assert.ok(autoNeutral.points.every(function(point) { return point.quality.status === "good"; }));
  assert.strictEqual(api.neutralQualityWeight({ quality:{ status:"good" } }), 1);
  assert.strictEqual(api.neutralQualityWeight({ quality:{ status:"warning" } }), 0.35);
  assert.strictEqual(api.neutralQualityWeight({ quality:{ status:"exclude" } }), 0);
  api.setModeForTest("neutralize");
  api.setSamplePoints([1,2,3,4].map(function(index) { return { x:index * 10, y:20 }; }));
  api.refreshNeutralReadyState();
  assert.strictEqual(api.isNeutralReadyForTest(), false);
  api.setSamplePoints([1,2,3,4,5].map(function(index) { return { x:index * 10, y:20 }; }));
  api.refreshNeutralReadyState();
  assert.strictEqual(api.isNeutralReadyForTest(), true);
  api.setModeForTest("background");

  // Representative astro scene: smooth light pollution, a diffuse Milky Way
  // band, sparse stars and a hard foreground boundary. Automatic Neutralise
  // points must remain completely inside clean sky samples.
  var astroWidth = 160, astroHeight = 120, astroSkyLimit = 86, astroRadius = 8;
  var astroPixels = new Uint8ClampedArray(astroWidth * astroHeight * 4);
  var astroMaskPixels = new Uint8ClampedArray(astroWidth * astroHeight * 4);
  for (var astroY=0; astroY<astroHeight; astroY++) {
    for (var astroX=0; astroX<astroWidth; astroX++) {
      var astroAt = (astroY * astroWidth + astroX) * 4;
      var astroBase = 22 + astroX * 0.10 + astroY * 0.025;
      var astroBandCenter = 50 + astroY * 0.45;
      if (Math.abs(astroX - astroBandCenter) < 11) {
        astroBase += 22 + ((astroX * 11 + astroY * 7) % 13);
      }
      if (astroY >= astroSkyLimit) {
        astroBase = 7 + ((astroX * 5 + astroY * 3) % 45);
      } else if ((astroX * 17 + astroY * 29) % 347 === 0) {
        astroBase += 150;
      }
      astroPixels[astroAt] = Math.min(255, astroBase + 6);
      astroPixels[astroAt + 1] = Math.min(255, astroBase + 2);
      astroPixels[astroAt + 2] = Math.min(255, astroBase);
      astroPixels[astroAt + 3] = 255;
      var astroMaskValue = astroY < astroSkyLimit ? 255 : 0;
      astroMaskPixels[astroAt] = astroMaskPixels[astroAt + 1] =
        astroMaskPixels[astroAt + 2] = astroMaskValue;
      astroMaskPixels[astroAt + 3] = 255;
    }
  }
  api.setPreviewAnalysisForTest(
    { docId:9, originalWidth:astroWidth, originalHeight:astroHeight,
      previewWidth:astroWidth, previewHeight:astroHeight, hasSelection:true, mode:"neutralize" },
    { width:astroWidth, height:astroHeight, data:astroPixels },
    { width:astroWidth, height:astroHeight, data:astroMaskPixels }
  );
  api.setSampleGenerationOptionsForTest(12, 1.0, astroRadius);
  var astroGrid = api.generateAutomaticSamplePoints({ selectionOnly:true, neutral:true });
  assert.ok(astroGrid.points.length >= 5, JSON.stringify(astroGrid));
  assert.ok(astroGrid.points.length <= 20);
  assert.ok(astroGrid.points.every(function(point) {
    return point.y - astroRadius >= 0 && point.y + astroRadius < astroSkyLimit;
  }), JSON.stringify(astroGrid.points));
  assert.ok(astroGrid.points.filter(function(point) {
    return point.quality && point.quality.status === "exclude";
  }).length === 0, JSON.stringify(astroGrid.points));

  // A small hole inside the sample footprint must be rejected even when the
  // center, corners and cardinal points are selected.
  var holeMaskPixels = new Uint8ClampedArray(41 * 41 * 4);
  var holePreviewPixels = new Uint8ClampedArray(41 * 41 * 4);
  for (var holePixel=0; holePixel<41 * 41; holePixel++) {
    holePreviewPixels[holePixel * 4] = holePreviewPixels[holePixel * 4 + 1] =
      holePreviewPixels[holePixel * 4 + 2] = 20;
    holePreviewPixels[holePixel * 4 + 3] = 255;
    holeMaskPixels[holePixel * 4] = holeMaskPixels[holePixel * 4 + 1] =
      holeMaskPixels[holePixel * 4 + 2] = 255;
    holeMaskPixels[holePixel * 4 + 3] = 255;
  }
  var holeAt = (20 * 41 + 25) * 4;
  holeMaskPixels[holeAt] = holeMaskPixels[holeAt + 1] = holeMaskPixels[holeAt + 2] = 0;
  api.setPreviewAnalysisForTest(
    { originalWidth:41, originalHeight:41, previewWidth:41, previewHeight:41,
      hasSelection:true, mode:"neutralize" },
    { width:41, height:41, data:holePreviewPixels },
    { width:41, height:41, data:holeMaskPixels }
  );
  api.setSampleGenerationOptionsForTest(8, 1.0, 10);
  api.setSelectionOnlyForTest(true);
  api.setSamplePoints([]);
  assert.strictEqual(api.addSamplePointAt({ width:41, height:41 }, { x:20, y:20 }), false);

  var tolerancePixels = new Uint8ClampedArray(100 * 70 * 4);
  for (var tolerancePixel=0; tolerancePixel<100 * 70; tolerancePixel++) {
    var toleranceX = tolerancePixel % 100;
    var toleranceLevel = toleranceX < 50 ? 20 : 60;
    tolerancePixels[tolerancePixel * 4] = toleranceLevel;
    tolerancePixels[tolerancePixel * 4 + 1] = toleranceLevel;
    tolerancePixels[tolerancePixel * 4 + 2] = toleranceLevel;
    tolerancePixels[tolerancePixel * 4 + 3] = 255;
  }
  api.setPreviewAnalysisForTest(
    { docId:8, originalWidth:1000, originalHeight:700, previewWidth:100, previewHeight:70, hasSelection:false },
    { width:100, height:70, data:tolerancePixels }, null
  );
  api.setSampleGenerationOptionsForTest(15, 1.0);
  var toleranceGrid = api.generateAutomaticSamplePoints({ selectionOnly:false });
  assert.ok(toleranceGrid.gridRejectedCells > 0);
  assert.ok(toleranceGrid.points.every(function(point) { return point.x < 600; }));

  var coreImage = syntheticQualityImage(function(x, y) {
    var dx = x - 15, dy = y - 15;
    return dx * dx + dy * dy <= 16 ? 110 : 20;
  });
  var coreQuality = api.analyzeSamplePoint(
    { x: 15, y: 15 }, 8, coreImage, api.calculateLuminanceStats(coreImage),
    { originalWidth: 31, originalHeight: 31 }
  );
  assert.strictEqual(coreQuality.status, "exclude");
  assert.strictEqual(coreQuality.reason, "밝은 중심 구조");

  var preferredCenter = { adaptiveOffset: 0, quality: { status: "good", score: 72 } };
  var higherOffset = { adaptiveOffset: 1, quality: { status: "good", score: 90 } };
  assert.strictEqual(api.chooseBestQualityCandidate([preferredCenter, higherOffset]), preferredCenter);
  var excludedCenter = { adaptiveOffset: 0, quality: { status: "exclude", score: 25 } };
  var replacement = { adaptiveOffset: 2, quality: { status: "good", score: 81 } };
  assert.strictEqual(api.chooseBestQualityCandidate([excludedCenter, replacement]), replacement);

  testHostCleanup();
  testSamplePreviewCleanup();
  testSkyMaskWorkflow();
  testLayerMaskFallbackCapture();
  testHtmlAndInstaller();
  testGraXpertProcessController(api);
  testMalformedImageGuards(api);
  console.log("All GraXpert panel tests passed.");
  cleanup();
  process.exit(0);
} catch (error) {
  try { cleanup(); } catch (_) {}
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
