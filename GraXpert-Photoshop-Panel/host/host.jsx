#target photoshop

function GX_containsLayer(group, target) {
    if (group === target) return true;
    if (!group.layers) return false;

    for (var i = 0; i < group.layers.length; i++) {
        var l = group.layers[i];
        if (l === target) return true;
        if (l.typename === "LayerSet" && GX_containsLayer(l, target)) return true;
    }
    return false;
}

function GX_showTargetPath(container, target) {
    for (var i = 0; i < container.layers.length; i++) {
        var l = container.layers[i];
        var keep = (l === target);

        if (l.typename === "LayerSet") {
            keep = keep || GX_containsLayer(l, target);
        }

        // Avoid issuing redundant Photoshop Show/Hide commands. A locked,
        // sole Background layer can reject even `visible = true` although it
        // is already visible, producing a modal "표시 명령" error.
        try {
            if (l.visible !== keep) l.visible = keep;
        } catch (_) {}

        if (keep && l.typename === "LayerSet") {
            GX_showTargetPath(l, target);
        }
    }
}

function GX_hasSelection(document) {
    try {
        var bounds = document.selection.bounds;
        return bounds && bounds.length === 4;
    } catch (_) {
        return false;
    }
}

function GX_activeLayerHasMask() {
    var reference = new ActionReference();
    reference.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var descriptor = executeActionGet(reference);
    var key = stringIDToTypeID("hasUserMask");
    return descriptor.hasKey(key) && descriptor.getBoolean(key);
}

function GX_getSkyMaskStatus() {
    try {
        if (!app.documents.length) return "ERROR|열린 Photoshop 문서가 없습니다.";
        var document = app.activeDocument;
        if (GX_hasSelection(document)) return "OK|selection";
        if (GX_activeLayerHasMask()) return "OK|layer-mask";
        return "OK|none";
    } catch (e) {
        return "ERROR|" + e.message;
    }
}

function GX_selectionBoundsSignature(document) {
    var signature = "";
    var signatureChannel = null;
    var originalChannels = null;
    try {
        var bounds = document.selection.bounds;
        if (!bounds || bounds.length !== 4) return "";
        function pixels(value) {
            return Math.round(value && value.as ? value.as("px") : Number(value));
        }
        signature = [
            pixels(bounds[0]), pixels(bounds[1]), pixels(bounds[2]), pixels(bounds[3])
        ].join(",");
        // Bounds alone cannot detect a changed shape with the same rectangle.
        // Add the alpha histogram when Photoshop exposes it; older/mock hosts
        // safely fall back to the bounds signature.
        try {
            originalChannels = document.activeChannels;
            signatureChannel = document.channels.add();
            signatureChannel.name = "__GRAXPERT_CONTEXT_" + (new Date()).getTime();
            document.selection.store(signatureChannel, SelectionType.REPLACE);
            var histogram = signatureChannel.histogram;
            var nonBlack = 0;
            var alphaMass = 0;
            var histogramHash = 2166136261;
            for (var hi = 0; hi < histogram.length; hi++) {
                var count = Number(histogram[hi]) || 0;
                if (hi > 0) nonBlack += count;
                alphaMass += count * hi;
                histogramHash = ((histogramHash ^ ((count + hi * 131) & 0xFFFFFFFF)) * 16777619) >>> 0;
            }
            signature += ",A:" + nonBlack + ",M:" + alphaMass + ",H:" + histogramHash;
        } catch (_) {}
        return signature;
    } catch (_) {
        return "";
    } finally {
        try { if (signatureChannel) signatureChannel.remove(); } catch (_) {}
        try { if (originalChannels) document.activeChannels = originalChannels; } catch (_) {}
    }
}

function GX_analysisContext(document, scope) {
    if (GX_hasSelection(document)) {
        return "selection:" + GX_selectionBoundsSignature(document);
    }
    if ((scope === "sky" || scope === "layer-sky" || scope === "layer-auto") &&
        GX_activeLayerHasMask()) {
        try {
            GX_loadActiveLayerMaskAsSelection();
            return "layer-mask:" + GX_selectionBoundsSignature(document);
        } finally {
            try { document.selection.deselect(); } catch (_) {}
        }
    }
    return "none:";
}

function GX_loadActiveLayerMaskAsSelection() {
    var descriptor = new ActionDescriptor();
    var selectionReference = new ActionReference();
    selectionReference.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    descriptor.putReference(charIDToTypeID("null"), selectionReference);
    var maskReference = new ActionReference();
    maskReference.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Msk "));
    descriptor.putReference(charIDToTypeID("T   "), maskReference);
    executeAction(charIDToTypeID("setd"), descriptor, DialogModes.NO);
}

function GX_addRevealSelectionMask() {
    var descriptor = new ActionDescriptor();
    descriptor.putClass(charIDToTypeID("Nw  "), charIDToTypeID("Chnl"));
    var maskReference = new ActionReference();
    maskReference.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Msk "));
    descriptor.putReference(charIDToTypeID("At  "), maskReference);
    descriptor.putEnumerated(
        charIDToTypeID("Usng"), charIDToTypeID("UsrM"), charIDToTypeID("RvlS")
    );
    executeAction(charIDToTypeID("Mk  "), descriptor, DialogModes.NO);
}

function GX_maskTokenParts(maskToken) {
    var token = String(maskToken || "");
    var separator = token.indexOf(":");
    if (separator !== 1) throw new Error("지정 영역 마스크 정보가 올바르지 않습니다.");
    return { source: token.substring(0, separator), channelName: token.substring(separator + 1) };
}

function GX_findChannel(document, channelName) {
    for (var i = 0; i < document.channels.length; i++) {
        if (document.channels[i].name === channelName) return document.channels[i];
    }
    return null;
}

function GX_activateCompositeChannels(document) {
    try { document.activeChannels = document.componentChannels; }
    catch (e) { throw new Error("합성 색상 채널 활성화 실패: " + e.message); }
}

function GX_captureSkyMask(document) {
    var source = "S";
    var hadSelection = GX_hasSelection(document);
    var originalChannels = null;
    try { originalChannels = document.activeChannels; } catch (_) {}

    if (!hadSelection) {
        if (!GX_activeLayerHasMask()) {
            throw new Error("하늘 선택 영역이나 현재 레이어 마스크가 없습니다.");
        }
        GX_loadActiveLayerMaskAsSelection();
        if (!GX_hasSelection(document)) {
            throw new Error("현재 레이어 마스크에서 지정 영역을 불러올 수 없습니다.");
        }
        source = "M";
    }

    var channel = null;
    try {
        channel = document.channels.add();
        channel.name = "__GRAXPERT_SKY_MASK_" + (new Date()).getTime();
        document.selection.store(channel, SelectionType.REPLACE);
        return source + ":" + channel.name;
    } catch (e) {
        try { if (channel) channel.remove(); } catch (_) {}
        throw new Error("지정 영역 임시 저장 실패: " + e.message);
    } finally {
        try {
            if (originalChannels) document.activeChannels = originalChannels;
            else GX_activateCompositeChannels(document);
        } catch (_) {}
        if (!hadSelection) {
            try { document.selection.deselect(); } catch (_) {}
        }
    }
}

function GX_restoreSelectionAndRemoveMask(document, maskToken) {
    if (!maskToken) return;
    var parts = GX_maskTokenParts(maskToken);
    var channel = GX_findChannel(document, parts.channelName);
    if (!channel) return;
    try {
        if (parts.source === "S") document.selection.load(channel, SelectionType.REPLACE);
        else document.selection.deselect();
    } finally {
        try { channel.remove(); } catch (_) {}
    }
}

function GX_applySkyMask(document, layer, maskToken) {
    var parts = GX_maskTokenParts(maskToken);
    var channel = GX_findChannel(document, parts.channelName);
    if (!channel) throw new Error("저장된 지정 영역을 찾을 수 없습니다.");
    app.activeDocument = document;
    GX_activateCompositeChannels(document);
    document.activeLayer = layer;
    document.selection.load(channel, SelectionType.REPLACE);
    GX_addRevealSelectionMask();
    GX_restoreSelectionAndRemoveMask(document, maskToken);
    GX_activateCompositeChannels(document);
}

function GX_exportInput(outPath, scope, contextScope, preserve32Bit) {
    if (app.documents.length === 0) {
        return "ERR|열려 있는 문서가 없습니다.";
    }

    var original = app.activeDocument;
    var originalName = original.name;
    var sourceLayerId = -1;
    try { sourceLayerId = original.activeLayer.id; } catch (_) {}
    var work = null;
    var maskToken = "";
    var analysisContext = "none:";
    var result = "";

    try {
        analysisContext = GX_analysisContext(original, contextScope || scope);
        if (scope === "sky" || scope === "layer-sky" ||
            (scope === "layer-auto" && (GX_hasSelection(original) || GX_activeLayerHasMask()))) {
            maskToken = GX_captureSkyMask(original);
        }
        work = original.duplicate("__GRAXPERT_TEMP__", false);

        if (scope === "layer" || scope === "layer-sky" || scope === "layer-auto") {
            var target = work.activeLayer;
            // GX_showTargetPath already hides every sibling while preserving
            // the active layer and its parent groups. Never hide all layers
            // first: Photoshop rejects hiding the only Background layer.
            GX_showTargetPath(work, target);
        }

        try {
            if (work.mode !== DocumentMode.RGB) {
                work.changeMode(ChangeMode.RGB);
            }
        } catch (_) {}

        try { work.flatten(); } catch (_) {}

        // GraXpert uses the stable 16-bit exchange path. Neutralise can retain
        // Photoshop 32-bit float data end-to-end.
        try {
            var keepFloat32 = preserve32Bit === true &&
                original.bitsPerChannel === BitsPerChannelType.THIRTYTWO;
            if (!keepFloat32 && work.bitsPerChannel !== BitsPerChannelType.SIXTEEN) {
                work.bitsPerChannel = BitsPerChannelType.SIXTEEN;
            }
        } catch (bitErr) {
            throw new Error("처리용 비트 심도 준비 실패: " + bitErr.message + " (line " + bitErr.line + ")");
        }

        var f = new File(outPath);
        var opt = new TiffSaveOptions();
        opt.imageCompression = TIFFEncoding.NONE;
        opt.layers = false;
        try { opt.alphaChannels = false; } catch (_) {}
        opt.embedColorProfile = true;
        try { opt.byteOrder = ByteOrder.IBM; } catch (_) {}
        try { opt.interleaveChannels = true; } catch (_) {}
        try { opt.transparency = false; } catch (_) {}

        work.saveAs(f, opt, true, Extension.LOWERCASE);
        var docId = -1;
        try { docId = original.id; } catch (_) {}
        var widthPx = Math.round(original.width.as("px"));
        var heightPx = Math.round(original.height.as("px"));
        result = "OK|" + docId + "|" + widthPx + "|" + heightPx + "|" + maskToken +
            "|L:" + sourceLayerId + "|C:" + encodeURIComponent(analysisContext) + "|" + originalName;

    } catch (e) {
        try { GX_restoreSelectionAndRemoveMask(original, maskToken); } catch (_) {}
        result = "ERR|" + e.message + " (line " + e.line + ")";
    } finally {
        // The duplicated work document must never survive this call, including
        // early conversion/save failures. Always restore the original document.
        try { if (work) work.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        try { app.activeDocument = original; } catch (_) {}
    }

    return result;
}

function GX_exportSamplePreview(previewPath, maskPath, maxWidth, maxHeight, scope, fullInputPath) {
    if (app.documents.length === 0) {
        return "ERR|열려 있는 문서가 없습니다.";
    }

    var original = app.activeDocument;
    var previewDoc = null;
    var maskDoc = null;
    var originalSelectionChannel = null;
    var skyMaskToken = "";
    var sourceLayerId = -1;
    var sourceLayerVersion = -1;
    var analysisContext = "none:";
    var result = "";

    try {
        try { sourceLayerId = original.activeLayer.id; } catch (_) {}
        sourceLayerVersion = GX_activeLayerVersion();
        analysisContext = GX_analysisContext(original, scope);
        var originalWidth = Math.round(original.width.as("px"));
        var originalHeight = Math.round(original.height.as("px"));
        var scale = Math.min(1, Number(maxWidth) / originalWidth, Number(maxHeight) / originalHeight);
        var previewWidth = Math.max(1, Math.round(originalWidth * scale));
        var previewHeight = Math.max(1, Math.round(originalHeight * scale));

        previewDoc = original.duplicate("__GRAXPERT_PREVIEW__", false);
        if (scope === "layer" || scope === "layer-auto" || scope === "layer-sky") {
            var target = previewDoc.activeLayer;
            GX_showTargetPath(previewDoc, target);
        }
        try {
            if (previewDoc.mode !== DocumentMode.RGB) previewDoc.changeMode(ChangeMode.RGB);
        } catch (_) {}
        try { previewDoc.flatten(); } catch (_) {}
        if (fullInputPath) {
            try { previewDoc.bitsPerChannel = BitsPerChannelType.SIXTEEN; } catch (_) {}
            var fullInputOptions = new TiffSaveOptions();
            fullInputOptions.imageCompression = TIFFEncoding.NONE;
            fullInputOptions.layers = false;
            try { fullInputOptions.alphaChannels = false; } catch (_) {}
            fullInputOptions.embedColorProfile = true;
            try { fullInputOptions.byteOrder = ByteOrder.IBM; } catch (_) {}
            try { fullInputOptions.interleaveChannels = true; } catch (_) {}
            try { fullInputOptions.transparency = false; } catch (_) {}
            previewDoc.saveAs(new File(fullInputPath), fullInputOptions, true, Extension.LOWERCASE);
        }
        try { previewDoc.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (_) {}
        previewDoc.resizeImage(UnitValue(previewWidth, "px"), UnitValue(previewHeight, "px"), null, ResampleMethod.BICUBICSHARPER);

        var pngPreview = new PNGSaveOptions();
        pngPreview.interlaced = false;
        previewDoc.saveAs(new File(previewPath), pngPreview, true, Extension.LOWERCASE);

        // Photoshop does not reliably carry a live selection into duplicate().
        // Store it in a temporary alpha channel on the original first, then copy
        // that channel as part of the mask document duplication.
        app.activeDocument = original;
        var hasSelection = false;
        var selectionChannelName = "__GRAXPERT_SELECTION_" + (new Date().getTime()) + "__";
        try {
            var selectionBounds = original.selection.bounds;
            hasSelection = selectionBounds && selectionBounds.length === 4;
        } catch (_) {
            hasSelection = false;
        }
        if (scope === "sky" || scope === "layer-sky") {
            skyMaskToken = GX_captureSkyMask(original);
            selectionChannelName = GX_maskTokenParts(skyMaskToken).channelName;
            hasSelection = true;
        } else if (scope === "layer-auto" && (hasSelection || GX_activeLayerHasMask())) {
            skyMaskToken = GX_captureSkyMask(original);
            selectionChannelName = GX_maskTokenParts(skyMaskToken).channelName;
            hasSelection = true;
        } else if (hasSelection) {
            originalSelectionChannel = original.channels.add();
            originalSelectionChannel.name = selectionChannelName;
            original.selection.store(originalSelectionChannel);
        }

        maskDoc = original.duplicate("__GRAXPERT_SELECTION_MASK__", false);
        var maskSelectionChannel = null;
        var componentChannels = [];
        for (var ci=0; ci<maskDoc.channels.length; ci++) {
            if (maskDoc.channels[ci].kind === ChannelType.COMPONENT) {
                componentChannels.push(maskDoc.channels[ci]);
            } else if (hasSelection && maskDoc.channels[ci].name === selectionChannelName) {
                maskSelectionChannel = maskDoc.channels[ci];
            }
        }
        if (componentChannels.length) maskDoc.activeChannels = componentChannels;
        if (hasSelection && !maskSelectionChannel) throw new Error("Photoshop 선택 영역 채널을 복제하지 못했습니다.");

        try {
            if (maskDoc.mode !== DocumentMode.RGB) maskDoc.changeMode(ChangeMode.RGB);
        } catch (_) {}
        try { maskDoc.flatten(); } catch (_) {}
        try { maskDoc.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (_) {}

        var black = new SolidColor();
        black.rgb.red = 0; black.rgb.green = 0; black.rgb.blue = 0;
        var white = new SolidColor();
        white.rgb.red = 255; white.rgb.green = 255; white.rgb.blue = 255;

        maskDoc.selection.selectAll();
        maskDoc.selection.fill(hasSelection ? black : white, ColorBlendMode.NORMAL, 100, false);
        if (hasSelection) {
            maskDoc.selection.load(maskSelectionChannel, SelectionType.REPLACE);
            maskDoc.selection.fill(white, ColorBlendMode.NORMAL, 100, false);
            maskDoc.selection.deselect();
            try { maskSelectionChannel.remove(); } catch (_) {}
        } else {
            maskDoc.selection.deselect();
        }

        maskDoc.resizeImage(UnitValue(previewWidth, "px"), UnitValue(previewHeight, "px"), null, ResampleMethod.NEARESTNEIGHBOR);
        var png = new PNGSaveOptions();
        png.interlaced = false;
        maskDoc.saveAs(new File(maskPath), png, true, Extension.LOWERCASE);

        var docId = -1;
        try { docId = original.id; } catch (_) {}
        var previewDocumentName = "";
        try { previewDocumentName = original.name || ""; } catch (_) {}
        result = "OK|" + docId + "|" + originalWidth + "|" + originalHeight + "|" +
            previewWidth + "|" + previewHeight + "|" + (hasSelection ? "YES" : "NO") +
            "|L:" + sourceLayerId + "|C:" + encodeURIComponent(analysisContext) +
            "|N:" + encodeURIComponent(previewDocumentName);
    } catch (e) {
        result = "ERR|" + e.message + " (line " + e.line + ")";
    } finally {
        try { if (previewDoc) previewDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        try { if (maskDoc) maskDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        try { app.activeDocument = original; } catch (_) {}
        try {
            if (skyMaskToken) GX_restoreSelectionAndRemoveMask(original, skyMaskToken);
            else if (originalSelectionChannel) originalSelectionChannel.remove();
        } catch (_) {}
        try { app.activeDocument = original; } catch (_) {}
    }

    if (result.indexOf("OK|") === 0) {
        sourceLayerVersion = GX_activeLayerVersion();
        result += "|V:" + sourceLayerVersion;
    }

    return result;
}

function GX_getActiveLayerInfo() {
    if (app.documents.length === 0) return "ERR|열려 있는 문서가 없습니다.";
    try {
        var doc = app.activeDocument;
        var layerName = "Layer";
        var layerId = -1;
        var bitDepth = 0;
        try { layerName = doc.activeLayer.name; } catch (_) {}
        try { layerId = doc.activeLayer.id; } catch (_) {}
        try {
            var documentBits = doc.bitsPerChannel;
            if (documentBits !== undefined && documentBits !== null) {
                if (documentBits === BitsPerChannelType.EIGHT) bitDepth = 8;
                else if (documentBits === BitsPerChannelType.SIXTEEN) bitDepth = 16;
                else if (documentBits === BitsPerChannelType.THIRTYTWO) bitDepth = 32;
            }
        } catch (_) {}
        return "OK|" + doc.id + "|" + layerId + "|B:" + bitDepth + "|" + encodeURIComponent(layerName);
    } catch (e) {
        return "ERR|" + e.message + " (line " + e.line + ")";
    }
}

function GX_activeLayerVersion() {
    try {
        var reference = new ActionReference();
        reference.putProperty(stringIDToTypeID("property"), stringIDToTypeID("layerVersion"));
        reference.putEnumerated(
            stringIDToTypeID("layer"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum")
        );
        var descriptor = executeActionGet(reference);
        var key = stringIDToTypeID("layerVersion");
        if (descriptor.hasKey(key)) return descriptor.getInteger(key);
    } catch (_) {}
    try {
        var document = app.activeDocument;
        var activeState = document.activeHistoryState;
        var activeIndex = -1;
        for (var historyIndex = 0; historyIndex < document.historyStates.length; historyIndex++) {
            if (document.historyStates[historyIndex] === activeState) {
                activeIndex = historyIndex;
                break;
            }
        }
        var signature = document.historyStates.length + ":" + activeIndex + ":" +
            (activeState && activeState.name ? activeState.name : "");
        var hash = 2166136261;
        for (var characterIndex=0; characterIndex<signature.length; characterIndex++) {
            hash = ((hash ^ signature.charCodeAt(characterIndex)) * 16777619) >>> 0;
        }
        return hash & 0x7FFFFFFF;
    } catch (_) {
        return -1;
    }
}

function GX_quickAnalysisContext(document) {
    if (GX_hasSelection(document)) {
        try {
            var bounds = document.selection.bounds;
            function px(value) { return Math.round(value && value.as ? value.as("px") : Number(value)); }
            return "selection:" + [px(bounds[0]), px(bounds[1]), px(bounds[2]), px(bounds[3])].join(",");
        } catch (_) {
            return "selection:";
        }
    }
    if (GX_activeLayerHasMask()) return "layer-mask:";
    return "none:";
}

function GX_getActiveContextIdentity(includeAnalysisSignature) {
    if (app.documents.length === 0) return "ERR|열려 있는 문서가 없습니다.";
    try {
        var document = app.activeDocument;
        var layerId = -1;
        try { layerId = document.activeLayer.id; } catch (_) {}
        var layerVersion = GX_activeLayerVersion();
        var analysisContext = includeAnalysisSignature
            ? GX_analysisContext(document, "layer-auto")
            : GX_quickAnalysisContext(document);
        return "OK|" + document.id + "|" + layerId + "|" +
            Math.round(document.width.as("px")) + "|" + Math.round(document.height.as("px")) +
            "|V:" + layerVersion + "|C:" + encodeURIComponent(analysisContext);
    } catch (e) {
        return "ERR|현재 작업 문맥 확인 실패: " + e.message + " (line " + e.line + ")";
    }
}

function GX_findDocumentById(id) {
    try {
        for (var i = 0; i < app.documents.length; i++) {
            try {
                if (app.documents[i].id == id) return app.documents[i];
            } catch (_) {}
        }
    } catch (_) {}
    return null;
}

function GX_findLayerById(container, id) {
    if (id === undefined || id === null || Number(id) < 0 || !container || !container.layers) return null;
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        try { if (layer.id == id) return layer; } catch (_) {}
        if (layer.typename === "LayerSet") {
            var nested = GX_findLayerById(layer, id);
            if (nested) return nested;
        }
    }
    return null;
}

function GX_discardMask(originalDocId, maskToken) {
    if (!maskToken) return "OK";
    var targetDoc = GX_findDocumentById(originalDocId);
    if (!targetDoc) return "OK";
    try {
        GX_restoreSelectionAndRemoveMask(targetDoc, maskToken);
        return "OK";
    } catch (e) {
        return "ERR|지정 영역 임시 데이터 정리 실패: " + e.message + " (line " + e.line + ")";
    }
}

function GX_importResultById(resultPath, originalDocId, originalDocName, layerName, maskToken, anchorLayerId, hideImportedLayer) {
    var targetDoc = GX_findDocumentById(originalDocId);

    if (!targetDoc) {
        return "ERR|처리 시작 시 원본 문서를 찾을 수 없습니다. 다른 문서에는 결과를 가져오지 않습니다. ID=" +
            originalDocId + ", Name=" + originalDocName;
    }

    var resultDoc = null;
    var importedLayer = null;
    var insertionAnchor = GX_findLayerById(targetDoc, anchorLayerId);

    if (anchorLayerId !== undefined && anchorLayerId !== null && Number(anchorLayerId) >= 0 && !insertionAnchor) {
        return "ERR|처리 시작 시 선택한 원본 레이어를 찾을 수 없습니다. Layer ID=" + anchorLayerId;
    }

    try {
        var rf = new File(resultPath);
        if (!rf.exists) {
            throw new Error("결과 파일이 없습니다: " + resultPath);
        }

        resultDoc = app.open(rf);

        var resultWidth = Math.round(resultDoc.width.as("px"));
        var resultHeight = Math.round(resultDoc.height.as("px"));
        var targetWidth = Math.round(targetDoc.width.as("px"));
        var targetHeight = Math.round(targetDoc.height.as("px"));
        if (resultWidth !== targetWidth || resultHeight !== targetHeight) {
            resultDoc.close(SaveOptions.DONOTSAVECHANGES);
            resultDoc = null;
            try { app.activeDocument = targetDoc; } catch (_) {}
            throw new Error("결과 이미지 크기가 원본과 다릅니다. 결과=" + resultWidth + "x" + resultHeight +
                ", 원본=" + targetWidth + "x" + targetHeight);
        }

        // Match the result image depth directly to the target. Avoid a 32 -> 16
        // -> 32 round trip, which would discard the precision Neutralise kept.
        try {
            if (targetDoc.bitsPerChannel === BitsPerChannelType.THIRTYTWO) {
                if (resultDoc.bitsPerChannel !== BitsPerChannelType.THIRTYTWO) {
                    resultDoc.bitsPerChannel = BitsPerChannelType.THIRTYTWO;
                }
            } else if (targetDoc.bitsPerChannel === BitsPerChannelType.EIGHT) {
                if (resultDoc.bitsPerChannel !== BitsPerChannelType.EIGHT) {
                    resultDoc.bitsPerChannel = BitsPerChannelType.EIGHT;
                }
            } else if (resultDoc.bitsPerChannel !== BitsPerChannelType.SIXTEEN) {
                resultDoc.bitsPerChannel = BitsPerChannelType.SIXTEEN;
            }
        } catch (_) {}

        var resultLayer = resultDoc.activeLayer;
        importedLayer = resultLayer.duplicate(targetDoc, ElementPlacement.PLACEATBEGINNING);

        app.activeDocument = targetDoc;
        if (insertionAnchor) {
            importedLayer.move(insertionAnchor, ElementPlacement.PLACEBEFORE);
        }
        if (importedLayer) targetDoc.activeLayer = importedLayer;
        targetDoc.activeLayer.name = layerName;
        if (maskToken) GX_applySkyMask(targetDoc, targetDoc.activeLayer, maskToken);
        if (hideImportedLayer === true) importedLayer.visible = false;

        resultDoc.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = targetDoc;

        return "OK";
    } catch (e) {
        try { if (resultDoc) resultDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        try { app.activeDocument = targetDoc; } catch (_) {}
        try { if (importedLayer) importedLayer.remove(); } catch (_) {}
        try { GX_restoreSelectionAndRemoveMask(targetDoc, maskToken); } catch (_) {}
        return "ERR|" + e.message + " (line " + e.line + ")";
    }
}

function GX_exportProcessedPreview(resultPath, previewPath, maxWidth, maxHeight) {
    var previousDocument = null;
    var resultDocument = null;
    try {
        try { previousDocument = app.activeDocument; } catch (_) {}
        var sourceFile = new File(resultPath);
        if (!sourceFile.exists) throw new Error("결과 파일이 없습니다: " + resultPath);
        resultDocument = app.open(sourceFile);
        try {
            if (resultDocument.mode !== DocumentMode.RGB) resultDocument.changeMode(ChangeMode.RGB);
        } catch (_) {}
        var width = Math.round(resultDocument.width.as("px"));
        var height = Math.round(resultDocument.height.as("px"));
        var scale = Math.min(1, Number(maxWidth) / width, Number(maxHeight) / height);
        var previewWidth = Math.max(1, Math.round(width * scale));
        var previewHeight = Math.max(1, Math.round(height * scale));
        if (previewWidth !== width || previewHeight !== height) {
            resultDocument.resizeImage(
                UnitValue(previewWidth, "px"), UnitValue(previewHeight, "px"), null,
                ResampleMethod.BICUBICSHARPER
            );
        }
        try { resultDocument.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (_) {}
        var pngOptions = new PNGSaveOptions();
        pngOptions.interlaced = false;
        resultDocument.saveAs(new File(previewPath), pngOptions, true, Extension.LOWERCASE);
        resultDocument.close(SaveOptions.DONOTSAVECHANGES);
        resultDocument = null;
        try { if (previousDocument) app.activeDocument = previousDocument; } catch (_) {}
        return "OK|" + previewWidth + "|" + previewHeight;
    } catch (e) {
        try { if (resultDocument) resultDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        try { if (previousDocument) app.activeDocument = previousDocument; } catch (_) {}
        return "ERR|" + e.message + " (line " + e.line + ")";
    }
}

function GX_validateProcessingContext(documentId, layerId, width, height, analysisContext, scope) {
    var targetDocument = GX_findDocumentById(documentId);
    if (!targetDocument) return "ERR|결과를 생성한 Photoshop 문서를 찾을 수 없습니다.";
    var previousDocument = null;
    var previousLayer = null;
    try {
        try { previousDocument = app.activeDocument; } catch (_) {}
        app.activeDocument = targetDocument;
        if (Math.round(targetDocument.width.as("px")) !== Number(width) ||
            Math.round(targetDocument.height.as("px")) !== Number(height)) {
            return "ERR|결과를 생성한 뒤 문서 크기가 변경되었습니다.";
        }
        var sourceLayer = GX_findLayerById(targetDocument, layerId);
        if (!sourceLayer) return "ERR|결과를 생성한 원본 레이어를 찾을 수 없습니다.";
        try { previousLayer = targetDocument.activeLayer; } catch (_) {}
        targetDocument.activeLayer = sourceLayer;
        var currentContext = GX_analysisContext(targetDocument, scope || "layer-auto");
        if (String(currentContext) !== String(analysisContext || "")) {
            return "ERR|결과를 생성한 뒤 Photoshop 선택 영역 또는 레이어 마스크가 변경되었습니다.";
        }
        return "OK";
    } catch (e) {
        return "ERR|작업 문맥 확인 실패: " + e.message + " (line " + e.line + ")";
    } finally {
        try { if (previousLayer) targetDocument.activeLayer = previousLayer; } catch (_) {}
        try { if (previousDocument) app.activeDocument = previousDocument; } catch (_) {}
    }
}

function GX_documentExistsById(id) {
    return GX_findDocumentById(id) ? "YES" : "NO";
}
