#target photoshop

(function () {
    var projectDir;
    var testDir;
    if (typeof GX_TEST_PROJECT_PATH !== "undefined" && GX_TEST_PROJECT_PATH) {
        projectDir = new Folder(GX_TEST_PROJECT_PATH);
        testDir = new Folder(projectDir.fsName + "/tests");
    } else {
        var testFile = new File($.fileName);
        testDir = testFile.parent;
        projectDir = testDir.parent;
    }

    var hostFile = new File(projectDir.fsName + "/GraXpert-Photoshop-Panel/host/host.jsx");
    var reportFile = new File(testDir.fsName + "/Photoshop_Integration_Result.txt");
    var tempTiff = new File(testDir.fsName + "/GraXpert_Integration_Temp.tif");
    var floatResultTiff = new File(testDir.fsName + "/GraXpert_Integration_Float32_Result.tif");
    var tempPreview = new File(testDir.fsName + "/GraXpert_Integration_Preview.png");
    var tempCachedInput = new File(testDir.fsName + "/GraXpert_Integration_Cached_Input.tif");
    var processedPreview = new File(testDir.fsName + "/GraXpert_Integration_Processed_Preview.png");
    var tempMask = new File(testDir.fsName + "/GraXpert_Integration_Mask.png");
    var originalDialogs = app.displayDialogs;
    var createdDocuments = [];
    var results = [];

    function assertTrue(condition, message) {
        if (!condition) throw new Error(message);
    }

    function remember(document) {
        createdDocuments.push(document);
        return document;
    }

    function makeRgb(name, bits) {
        var document = remember(app.documents.add(
            32, 32, 72, name, NewDocumentMode.RGB, DocumentFill.WHITE
        ));
        document.bitsPerChannel = bits;
        return document;
    }

    function closeCreatedDocuments() {
        for (var i = createdDocuments.length - 1; i >= 0; i--) {
            try { createdDocuments[i].close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        }
    }

    function removeTempFiles() {
        var files = [tempTiff, tempPreview, tempCachedInput, processedPreview, tempMask];
        for (var i = 0; i < files.length; i++) {
            try { if (files[i].exists) files[i].remove(); } catch (_) {}
        }
    }

    function test(name, callback) {
        try {
            removeTempFiles();
            callback();
            results.push("PASS | " + name);
        } catch (e) {
            results.push("FAIL | " + name + " | " + e.message + " (line " + e.line + ")");
        }
    }

    function exportParts(result) {
        var parts = String(result || "").split("|");
        if (parts[0] !== "OK" || parts.length < 7 || parts[5].indexOf("L:") !== 0) {
            throw new Error("내보내기 응답 형식이 올바르지 않습니다: " + result);
        }
        var nameIndex = 6;
        var analysisContext = "";
        if (parts[nameIndex] && parts[nameIndex].indexOf("C:") === 0) {
            analysisContext = decodeURIComponent(parts[nameIndex].substring(2));
            nameIndex++;
        }
        return {
            documentId: parts[1],
            maskToken: parts[4],
            sourceLayerId: Number(parts[5].substring(2)),
            analysisContext: analysisContext,
            documentName: parts.slice(nameIndex).join("|")
        };
    }

    function previewParts(result) {
        var parts = String(result || "").split("|");
        if (parts[0] !== "OK" || parts.length < 9 || parts[7].indexOf("L:") !== 0 ||
            parts[8].indexOf("C:") !== 0) {
            throw new Error("Preview 응답 형식이 올바르지 않습니다: " + result);
        }
        return {
            hasSelection: parts[6] === "YES",
            sourceLayerId: Number(parts[7].substring(2)),
            analysisContext: decodeURIComponent(parts[8].substring(2))
        };
    }

    function writeReport() {
        var failures = 0;
        for (var i = 0; i < results.length; i++) {
            if (results[i].indexOf("FAIL |") === 0) failures++;
        }
        var summary = failures === 0 ? "PASS" : "FAIL";
        var lines = [
            "GraXpert Photoshop integration test",
            "Photoshop: " + app.version,
            "Result: " + summary,
            "Passed: " + (results.length - failures),
            "Failed: " + failures,
            ""
        ].concat(results);
        reportFile.encoding = "UTF-8";
        reportFile.open("w");
        reportFile.write(lines.join("\n"));
        reportFile.close();
    }

    app.displayDialogs = DialogModes.NO;

    try {
        assertTrue(hostFile.exists, "host.jsx를 찾을 수 없습니다: " + hostFile.fsName);
        $.evalFile(hostFile);

        test("동일 이름 문서를 ID로 구분", function () {
            var first = makeRgb("GX_SAME_NAME", BitsPerChannelType.EIGHT);
            var second = makeRgb("GX_SAME_NAME", BitsPerChannelType.EIGHT);
            assertTrue(first.id !== second.id, "서로 다른 문서의 ID가 같습니다.");
            assertTrue(GX_findDocumentById(first.id) === first, "첫 번째 문서를 ID로 찾지 못했습니다.");
            assertTrue(GX_findDocumentById(second.id) === second, "두 번째 문서를 ID로 찾지 못했습니다.");
            var firstLayerCount = first.layers.length;
            var secondLayerCount = second.layers.length;
            var blocked = GX_importResultById(
                tempTiff.fsName, -987654, first.name, "잘못된 문서 결과", "", -1
            );
            assertTrue(blocked.indexOf("ERR|처리 시작 시 원본 문서를 찾을 수 없습니다.") === 0,
                "문서 이름 fallback이 차단되지 않았습니다: " + blocked);
            assertTrue(first.layers.length === firstLayerCount && second.layers.length === secondLayerCount,
                "잘못된 문서 ID 검사 중 동일 이름 문서가 변경되었습니다.");
        });

        test("16-bit TIFF 내보내기 및 결과 레이어 가져오기", function () {
            var target = makeRgb("GX_TIFF_ROUNDTRIP", BitsPerChannelType.SIXTEEN);
            app.activeDocument = target;
            var exported = GX_exportInput(tempTiff.fsName, "document");
            var info = exportParts(exported);
            assertTrue(tempTiff.exists && tempTiff.length > 0, "TIFF 파일이 생성되지 않았습니다.");
            var contextValidation = GX_validateProcessingContext(
                Number(info.documentId), info.sourceLayerId, 32, 32, info.analysisContext, "document"
            );
            assertTrue(contextValidation === "OK", "결과 적용 문맥 검사 실패: " + contextValidation);
            var previewExported = GX_exportProcessedPreview(
                tempTiff.fsName, processedPreview.fsName, 16, 16
            );
            assertTrue(previewExported === "OK|16|16", "처리 결과 Preview 생성 실패: " + previewExported);
            assertTrue(processedPreview.exists && processedPreview.length > 0, "처리 결과 Preview 파일이 없습니다.");
            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName, "GraXpert Test", info.maskToken
            );
            assertTrue(imported === "OK", "결과 가져오기 실패: " + imported);
            assertTrue(target.activeLayer.name === "GraXpert Test", "결과 레이어 이름이 올바르지 않습니다.");
            assertTrue(target.bitsPerChannel === BitsPerChannelType.SIXTEEN, "원본 비트 심도가 변경되었습니다.");
        });

        test("단일 Background 레이어 현재 레이어 내보내기", function () {
            var target = makeRgb("GX_BACKGROUND_ONLY", BitsPerChannelType.SIXTEEN);
            app.activeDocument = target;
            assertTrue(target.layers.length === 1, "테스트 문서가 단일 레이어가 아닙니다.");
            var exported = GX_exportInput(tempTiff.fsName, "layer");
            assertTrue(exported.indexOf("OK|") === 0, "단일 레이어 내보내기 실패: " + exported);
            assertTrue(tempTiff.exists, "단일 레이어 TIFF가 생성되지 않았습니다.");
        });

        test("Gradient/Denoise 결과를 선택 레이어 바로 위에 배치", function () {
            var target = makeRgb("GX_LAYER_PLACEMENT", BitsPerChannelType.SIXTEEN);
            var source = target.artLayers.add();
            source.name = "GX Source";
            var upper = target.artLayers.add();
            upper.name = "GX Existing Upper";
            target.activeLayer = source;
            app.activeDocument = target;
            var info = exportParts(GX_exportInput(tempTiff.fsName, "layer"));
            assertTrue(info.sourceLayerId === source.id, "내보내기에서 원본 레이어 ID가 보존되지 않았습니다.");
            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "GX Gradient", info.maskToken, info.sourceLayerId
            );
            assertTrue(imported === "OK", "결과 레이어 가져오기 실패: " + imported);
            var resultIndex = -1;
            var sourceIndex = -1;
            for (var layerIndex=0; layerIndex<target.layers.length; layerIndex++) {
                if (target.layers[layerIndex].name === "GX Gradient") resultIndex = layerIndex;
                if (target.layers[layerIndex].id === source.id) sourceIndex = layerIndex;
            }
            assertTrue(resultIndex >= 0 && sourceIndex === resultIndex + 1,
                "결과 레이어가 원본 레이어 바로 위에 있지 않습니다.");
            assertTrue(target.layers[0].name === upper.name,
                "기존 상단 레이어의 위치가 변경되었습니다.");

            var modelImported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "GraXpert - Background Model", "", info.sourceLayerId, true
            );
            assertTrue(modelImported === "OK", "Background Model 가져오기 실패: " + modelImported);
            var modelIndex = -1;
            resultIndex = -1;
            sourceIndex = -1;
            for (layerIndex=0; layerIndex<target.layers.length; layerIndex++) {
                if (target.layers[layerIndex].name === "GX Gradient") resultIndex = layerIndex;
                if (target.layers[layerIndex].name === "GraXpert - Background Model") modelIndex = layerIndex;
                if (target.layers[layerIndex].id === source.id) sourceIndex = layerIndex;
            }
            assertTrue(resultIndex >= 0 && modelIndex === resultIndex + 1 && sourceIndex === modelIndex + 1,
                "Background Model이 Gradient 결과 아래와 원본 레이어 위에 배치되지 않았습니다.");
            assertTrue(target.layers[modelIndex].visible === false,
                "Background Model 레이어가 숨김 상태가 아닙니다.");
        });

        test("처리 시작 레이어가 삭제되면 결과 가져오기 중단", function () {
            var target = makeRgb("GX_MISSING_SOURCE_LAYER", BitsPerChannelType.SIXTEEN);
            var source = target.artLayers.add();
            source.name = "GX Temporary Source";
            target.activeLayer = source;
            app.activeDocument = target;
            var info = exportParts(GX_exportInput(tempTiff.fsName, "layer"));
            var sourceLayerId = info.sourceLayerId;
            source.remove();
            var layerCount = target.layers.length;
            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "Should Not Import", info.maskToken, sourceLayerId
            );
            assertTrue(imported.indexOf("ERR|처리 시작 시 선택한 원본 레이어를 찾을 수 없습니다.") === 0,
                "삭제된 시작 레이어 검사가 작동하지 않았습니다: " + imported);
            assertTrue(target.layers.length === layerCount,
                "삭제된 시작 레이어 검사 후 결과 레이어가 추가되었습니다.");
        });

        test("지정 영역이 없으면 안전하게 중단", function () {
            var target = makeRgb("GX_SKY_MISSING", BitsPerChannelType.EIGHT);
            var originalChannelCount = target.channels.length;
            app.activeDocument = target;
            var exported = GX_exportInput(tempTiff.fsName, "sky");
            assertTrue(exported.indexOf("ERR|") === 0, "영역 없이 하늘 처리가 시작되었습니다: " + exported);
            assertTrue(exported.indexOf("선택 영역") >= 0, "영역 누락 안내가 없습니다: " + exported);
            assertTrue(target.channels.length === originalChannelCount, "실패 후 임시 채널이 남았습니다.");
            assertTrue(!tempTiff.exists, "실패 후 TIFF가 남았습니다.");
        });

        test("현재 레이어는 지정 영역으로 분석하고 결과 마스크를 만들지 않음", function () {
            var target = makeRgb("GX_NEUTRAL_LAYER_SELECTION", BitsPerChannelType.SIXTEEN);
            target.selection.select([[0, 0], [16, 0], [16, 32], [0, 32]]);
            app.activeDocument = target;
            var originalChannelCount = target.channels.length;
            var previewResult = GX_exportSamplePreview(
                tempPreview.fsName, tempMask.fsName, 1400, 900, "layer-auto", tempCachedInput.fsName
            );
            var previewInfo = previewParts(previewResult);
            assertTrue(previewResult.indexOf("OK|") === 0, "현재 레이어 분석 Preview 실패: " + previewResult);
            assertTrue(previewInfo.hasSelection,
                "Photoshop 선택 영역이 분석 영역으로 감지되지 않았습니다.");
            assertTrue(previewInfo.sourceLayerId === target.activeLayer.id,
                "Preview에서 현재 레이어 ID를 보존하지 못했습니다.");
            assertTrue(previewInfo.analysisContext.indexOf("selection:") === 0,
                "Preview 선택 영역 식별 정보가 없습니다.");
            assertTrue(tempCachedInput.exists, "Gradient용 전체 해상도 입력 캐시가 생성되지 않았습니다.");
            assertTrue(target.channels.length === originalChannelCount, "분석 Preview 후 임시 채널이 남았습니다.");
            assertTrue(GX_hasSelection(target), "분석 Preview 후 원래 선택 영역이 복원되지 않았습니다.");

            var info = exportParts(GX_exportInput(tempTiff.fsName, "layer"));
            assertTrue(info.maskToken === "", "현재 레이어 결과에 마스크 토큰이 생성되었습니다.");
            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "Background Neutralised", info.maskToken, info.sourceLayerId
            );
            assertTrue(imported === "OK", "현재 레이어 결과 가져오기 실패: " + imported);
            assertTrue(!GX_activeLayerHasMask(), "현재 레이어 결과에 마스크가 생성되었습니다.");
        });

        test("현재 레이어는 지정 영역이 없으면 전체 Preview로 분석", function () {
            var target = makeRgb("GX_NEUTRAL_LAYER_FULL", BitsPerChannelType.EIGHT);
            app.activeDocument = target;
            var originalChannelCount = target.channels.length;
            var previewResult = GX_exportSamplePreview(
                tempPreview.fsName, tempMask.fsName, 1400, 900, "layer-auto"
            );
            var previewInfo = previewParts(previewResult);
            assertTrue(previewResult.indexOf("OK|") === 0, "현재 레이어 전체 Preview 실패: " + previewResult);
            assertTrue(!previewInfo.hasSelection,
                "영역이 없는데 선택 영역이 감지되었습니다.");
            assertTrue(previewInfo.analysisContext === "none:",
                "영역 없는 Preview 식별 정보가 올바르지 않습니다.");
            assertTrue(tempPreview.exists && tempMask.exists, "전체 Preview 또는 mask 파일이 생성되지 않았습니다.");
            assertTrue(target.channels.length === originalChannelCount, "전체 Preview 후 임시 채널이 남았습니다.");
        });

        test("선택 영역을 결과 레이어 마스크로 적용", function () {
            var target = makeRgb("GX_SKY_SELECTION", BitsPerChannelType.SIXTEEN);
            target.selection.select([[0, 0], [16, 0], [16, 32], [0, 32]]);
            app.activeDocument = target;
            var info = exportParts(GX_exportInput(tempTiff.fsName, "sky"));
            assertTrue(info.maskToken.indexOf("S:") === 0, "선택 영역 토큰이 아닙니다: " + info.maskToken);
            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "GraXpert Gradient - Sky", info.maskToken
            );
            assertTrue(imported === "OK", "하늘 결과 가져오기 실패: " + imported);
            assertTrue(GX_activeLayerHasMask(), "하늘 결과 레이어에 마스크가 없습니다.");
            assertTrue(GX_hasSelection(target), "원래 선택 영역이 복원되지 않았습니다.");
            assertTrue(!GX_findChannel(target, GX_maskTokenParts(info.maskToken).channelName), "임시 채널이 남았습니다.");
        });

        test("현재 레이어 마스크를 지정 영역 결과에 적용", function () {
            var target = makeRgb("GX_SKY_LAYER_MASK", BitsPerChannelType.EIGHT);
            target.selection.select([[0, 0], [32, 0], [32, 16], [0, 16]]);
            app.activeDocument = target;
            GX_addRevealSelectionMask();
            target.selection.deselect();
            var info = exportParts(GX_exportInput(tempTiff.fsName, "layer-sky"));
            assertTrue(info.maskToken.indexOf("M:") === 0, "레이어 마스크 토큰이 아닙니다: " + info.maskToken);
            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "Stretched - Sky", info.maskToken
            );
            assertTrue(imported === "OK", "레이어 마스크 결과 가져오기 실패: " + imported);
            assertTrue(GX_activeLayerHasMask(), "가져온 결과 레이어에 마스크가 없습니다.");
            assertTrue(!GX_hasSelection(target), "레이어 마스크 사용 후 선택 영역이 남았습니다.");
            assertTrue(!GX_findChannel(target, GX_maskTokenParts(info.maskToken).channelName), "임시 채널이 남았습니다.");
        });

        test("32-bit Neutralise 입력 TIFF 정밀도 보존 및 결과 가져오기", function () {
            var target = makeRgb("GX_NEUTRAL_BITS", BitsPerChannelType.THIRTYTWO);
            app.activeDocument = target;
            var layerInfo = GX_getActiveLayerInfo();
            assertTrue(layerInfo.indexOf("|B:32|") >= 0, "32-bit 입력 정보가 없습니다: " + layerInfo);
            var info = exportParts(GX_exportInput(tempTiff.fsName, "layer", "layer-auto", true));
            assertTrue(tempTiff.exists && tempTiff.length > 0, "32-bit TIFF 파일이 생성되지 않았습니다.");

            var exportedDocument = app.open(tempTiff);
            assertTrue(exportedDocument.bitsPerChannel === BitsPerChannelType.THIRTYTWO,
                "Neutralise 입력 TIFF가 32-bit를 유지하지 않았습니다.");
            exportedDocument.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = target;

            var imported = GX_importResultById(
                tempTiff.fsName, info.documentId, info.documentName,
                "GX Neutralise 32-bit", info.maskToken, info.sourceLayerId
            );
            assertTrue(imported === "OK", "32-bit 결과 가져오기 실패: " + imported);
            assertTrue(target.bitsPerChannel === BitsPerChannelType.THIRTYTWO,
                "결과 가져오기 후 원본 문서가 32-bit를 유지하지 않았습니다.");
            assertTrue(target.activeLayer.name === "GX Neutralise 32-bit",
                "32-bit 결과 레이어 이름이 올바르지 않습니다.");
        });

        test("생성된 32-bit Neutralise 결과 TIFF Photoshop 호환", function () {
            assertTrue(floatResultTiff.exists && floatResultTiff.length > 0,
                "Node 처리로 생성한 32-bit 결과 TIFF가 없습니다.");
            var resultDocument = app.open(floatResultTiff);
            assertTrue(resultDocument.bitsPerChannel === BitsPerChannelType.THIRTYTWO,
                "생성된 Neutralise 결과 TIFF를 Photoshop이 32-bit로 열지 못했습니다.");
            var profileName = "";
            try { profileName = String(resultDocument.colorProfileName || ""); } catch (_) {}
            assertTrue(profileName && profileName.toLowerCase().indexOf("untagged") < 0,
                "생성된 결과 TIFF의 ICC 프로파일이 유지되지 않았습니다: " + profileName);
            var sampler = resultDocument.colorSamplers.add([16, 16]);
            var sampledRgb = sampler.color.rgb;
            var sampledSpread = Math.max(sampledRgb.red, sampledRgb.green, sampledRgb.blue) -
                Math.min(sampledRgb.red, sampledRgb.green, sampledRgb.blue);
            sampler.remove();
            assertTrue(sampledSpread < 1.0,
                "Neutralise 결과 중심 픽셀이 중립 RGB가 아닙니다: " +
                sampledRgb.red + "/" + sampledRgb.green + "/" + sampledRgb.blue);
            resultDocument.close(SaveOptions.DONOTSAVECHANGES);

            var target = makeRgb("GX_NEUTRAL_FLOAT_RESULT", BitsPerChannelType.THIRTYTWO);
            app.activeDocument = target;
            var imported = GX_importResultById(
                floatResultTiff.fsName, target.id, target.name,
                "GX Generated Neutralise 32-bit", "", target.activeLayer.id
            );
            assertTrue(imported === "OK", "생성된 32-bit 결과 가져오기 실패: " + imported);
            assertTrue(target.bitsPerChannel === BitsPerChannelType.THIRTYTWO,
                "생성된 결과 가져오기 후 문서 정밀도가 변경되었습니다.");
        });

        test("같은 경계의 다른 선택 영역 변경 감지", function () {
            var target = makeRgb("GX_SELECTION_CONTEXT", BitsPerChannelType.EIGHT);
            app.activeDocument = target;
            var originalChannelCount = target.channels.length;
            target.selection.select([[0, 0], [32, 0], [32, 32], [0, 32]]);
            var rectangleContext = GX_analysisContext(target, "layer-auto");
            target.selection.select([[0, 0], [32, 0], [0, 32]]);
            var triangleContext = GX_analysisContext(target, "layer-auto");
            assertTrue(rectangleContext !== triangleContext,
                "같은 경계 안에서 선택 영역 모양 변경을 감지하지 못했습니다.");
            assertTrue(target.channels.length === originalChannelCount,
                "선택 영역 식별 후 임시 채널이 남았습니다.");
        });

        test("레이어 마스크 기반 Sample Preview 생성", function () {
            var target = makeRgb("GX_SKY_PREVIEW", BitsPerChannelType.EIGHT);
            target.selection.select([[0, 0], [32, 0], [32, 18], [0, 18]]);
            app.activeDocument = target;
            GX_addRevealSelectionMask();
            target.selection.deselect();
            var originalChannelCount = target.channels.length;
            var previewResult = GX_exportSamplePreview(
                tempPreview.fsName, tempMask.fsName, 1400, 900, "sky"
            );
            var previewInfo = previewParts(previewResult);
            assertTrue(previewResult.indexOf("OK|") === 0, "Sample Preview 실패: " + previewResult);
            assertTrue(previewInfo.hasSelection, "지정 영역 마스크가 감지되지 않았습니다.");
            assertTrue(previewInfo.analysisContext.indexOf("layer-mask:") === 0,
                "레이어 마스크 Preview 식별 정보가 없습니다.");
            assertTrue(tempPreview.exists && tempMask.exists, "Preview 또는 mask 파일이 생성되지 않았습니다.");
            assertTrue(target.channels.length === originalChannelCount, "Preview 후 임시 채널이 남았습니다.");
            assertTrue(!GX_hasSelection(target), "Preview 후 임시 선택 영역이 남았습니다.");
        });
    } catch (e) {
        results.push("FAIL | 테스트 초기화 | " + e.message + " (line " + e.line + ")");
    } finally {
        closeCreatedDocuments();
        removeTempFiles();
        app.displayDialogs = originalDialogs;
    }

    writeReport();
}());
