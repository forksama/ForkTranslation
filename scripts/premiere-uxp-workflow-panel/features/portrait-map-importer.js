/* global require */

(function registerPortraitMapImporter(app) {
  if (!app) {
    throw new Error("ForkTranslation workflow app shell is missing.");
  }

  app.registerFeature("portrait", {
    init() {
      const ppro = require("premierepro");
      const { storage } = require("uxp");
      const localFileSystem = storage.localFileSystem;

      const IMAGE_EXTENSIONS = {
        ai: true,
        bmp: true,
        gif: true,
        heic: true,
        heif: true,
        jpeg: true,
        jpg: true,
        png: true,
        psb: true,
        psd: true,
        svg: true,
        tif: true,
        tiff: true,
        webp: true
      };

      const PORTRAIT_HEIGHT_RATIO = 0.95;
      const TIMING_TOLERANCE_SECONDS = 0.05;
      const TRANSFORM_TOLERANCE = 0.05;

      const state = {
        busy: false,
        mappingFile: null,
        mappingPath: "",
        mapping: null,
        workdir: null,
        workdirPath: "",
        portraitDir: null,
        portraitDirPath: "",
        lastScan: null,
        logLines: []
      };

      function $(elementId) {
        return app.$("portrait", elementId);
      }

      function optional$(elementId) {
        try {
          return $(elementId);
        } catch (error) {
          return null;
        }
      }

      function log(message) {
        state.logLines.push(String(message));
        $("log").textContent = state.logLines.join("\n");
        $("log").scrollTop = $("log").scrollHeight;
      }

      function setStatus(message) {
        $("status").textContent = message;
      }

      function setBusy(busy) {
        state.busy = busy;
        setDisabled("chooseMappingButton", busy);
        setDisabled("chooseWorkdirButton", busy);
        setDisabled("choosePortraitDirButton", busy);
        setDisabled("scanButton", busy);
        setDisabled("runButton", busy);
        setDisabled("saveLogButton", busy);
      }

      function setDisabled(elementId, disabled) {
        const element = optional$(elementId);
        if (element) {
          element.disabled = disabled;
        }
      }

      async function chooseMappingFile() {
        if (state.busy) {
          return;
        }

        try {
          const file = await localFileSystem.getFileForOpening({
            allowMultiple: false,
            types: ["json"]
          });
          if (!file) {
            return;
          }

          const text = await readTextFile(file);
          const mapping = normalizeMapping(parseJson(text, file.name));
          const mappingPath = getNativePath(file);
          const inferredWorkdirPath = inferWorkdirPathFromMappingPath(mappingPath);
          const inferredWorkdir = inferredWorkdirPath
            ? await getEntryForNativePath(inferredWorkdirPath)
            : null;

          state.mappingFile = file;
          state.mappingPath = mappingPath;
          state.mapping = mapping;
          if (inferredWorkdirPath) {
            state.workdirPath = inferredWorkdirPath;
            state.workdir = inferredWorkdir && inferredWorkdir.isFolder ? inferredWorkdir : null;
          }
          state.lastScan = null;

          renderState();
          renderMappingPreview(mapping);
          setStatus(`Loaded ${mapping.items.length} mapping item(s).`);
        } catch (error) {
          setStatus("Failed to choose mapping");
          log(errorToString(error));
        }
      }

      async function chooseWorkdir() {
        if (state.busy) {
          return;
        }

        try {
          const folder = await localFileSystem.getFolder();
          if (!folder) {
            return;
          }

          state.workdir = folder;
          state.workdirPath = getNativePath(folder);
          state.lastScan = null;
          renderState();
          setStatus("Workdir selected.");
        } catch (error) {
          setStatus("Failed to choose workdir");
          log(errorToString(error));
        }
      }

      async function choosePortraitDir() {
        if (state.busy) {
          return;
        }

        try {
          const folder = await localFileSystem.getFolder();
          if (!folder) {
            return;
          }

          state.portraitDir = folder;
          state.portraitDirPath = getNativePath(folder);
          state.lastScan = null;
          renderState();
          setStatus("Portrait dir selected.");
        } catch (error) {
          setStatus("Failed to choose portrait dir");
          log(errorToString(error));
        }
      }

      async function scanOnly() {
        if (state.busy) {
          return;
        }

        setBusy(true);
        setStatus("Scanning");

        try {
          const scan = await buildScan();
          state.lastScan = scan;
          renderScanPreview(scan);
          logScan(scan);
          setStatus(
            `Scan done. Matched ${scan.matches.length} audio clip(s), ` +
              `${scan.diagnostics.errors.length} error(s).`
          );
        } catch (error) {
          setStatus("Scan failed");
          log(errorToString(error));
        } finally {
          setBusy(false);
        }
      }

      async function run() {
        if (state.busy) {
          return;
        }

        setBusy(true);
        setStatus("Running");

        try {
          const scan = await buildScan();
          state.lastScan = scan;
          renderScanPreview(scan);
          logScan(scan);

          if (scan.diagnostics.errors.length > 0) {
            throw new Error(
              "Scan has blocking error(s):\n" +
                scan.diagnostics.errors.map((item) => `- ${item}`).join("\n")
            );
          }
          if (scan.matches.length === 0) {
            throw new Error("No timeline audio clips matched the mapping file.");
          }

          const result = await importAndPlacePortraits(scan);
          setStatus(
            `Done. Placed ${result.placedCount} portrait clip(s) on ${result.trackLabel}.`
          );
          log(`Done. Placed ${result.placedCount} portrait clip(s) on ${result.trackLabel}.`);
          if (result.trimWarnings.length > 0) {
            log("Trim warnings:");
            for (const warning of result.trimWarnings) {
              log(`  - ${warning}`);
            }
          }
        } catch (error) {
          setStatus("Failed");
          log(errorToString(error));
        } finally {
          setBusy(false);
        }
      }

      async function buildScan() {
        if (!state.mapping) {
          throw new Error("Choose a mapping file first.");
        }
        if (!state.workdirPath) {
          throw new Error("Choose a workdir first.");
        }
        if (!state.portraitDir || !state.portraitDirPath) {
          throw new Error("Choose a portrait dir first.");
        }

        const options = readOptions();
        const project = await ppro.Project.getActiveProject();
        if (!project) {
          throw new Error("No active project.");
        }

        const sequence = await project.getActiveSequence();
        if (!sequence) {
          throw new Error("No active sequence.");
        }

        const sourceAudioTrack = await resolveSourceAudioTrack(sequence, options.audioTrackSpec);
        const targetVideoTrack = await resolveTargetVideoTrack(sequence, options.videoTrackSpec);
        const audioClips = await collectAudioTrackClips(sequence, sourceAudioTrack.index);
        const diagnostics = await validateMappingItems(state.mapping.items);
        const matches = matchAudioClipsToMapping(audioClips, state.mapping.items, diagnostics);

        for (const match of matches) {
          if (match.item.audioResolved.exists === false) {
            diagnostics.errors.push(
              `Audio file is missing under workdir: ${match.item.audioRelPath}`
            );
          }
          if (match.item.portraitResolved.exists === false) {
            diagnostics.errors.push(
              `Portrait file is missing under portrait dir: ${match.item.portraitRelPath}`
            );
          }
        }

        const usedOrders = {};
        for (const match of matches) {
          usedOrders[match.item.order] = true;
        }
        const unusedItems = state.mapping.items.filter((item) => !usedOrders[item.order]);

        return {
          project,
          sequence,
          options,
          sourceAudioTrack,
          targetVideoTrack,
          audioClips,
          matches,
          unusedItems,
          diagnostics
        };
      }

      function readOptions() {
        const audioTrackInput = optional$("audioTrackSpec");
        const videoTrackInput = optional$("videoTrackSpec");
        return {
          audioTrackSpec: audioTrackInput ? audioTrackInput.value.trim() || "A1" : "A1",
          videoTrackSpec: videoTrackInput ? videoTrackInput.value.trim() || "auto" : "auto"
        };
      }

      function normalizeMapping(data) {
        if (!data || !Array.isArray(data.items)) {
          throw new Error("Mapping JSON must contain an items array.");
        }

        const items = [];
        for (let index = 0; index < data.items.length; index += 1) {
          const raw = data.items[index] || {};
          const order = Number(raw.order);
          const audioRelPath = normalizeRelativePath(raw.audioRelPath || "");
          const audioFileName = String(raw.audioFileName || basename(audioRelPath)).trim();
          const portraitRelPath = normalizeRelativePath(raw.portraitRelPath || "");

          if (!Number.isFinite(order) || Math.floor(order) !== order || order < 1) {
            throw new Error(`Mapping item at index ${index} has an invalid order.`);
          }

          items.push({
            order,
            audioFileName,
            audioFileKey: fileNameKey(audioFileName),
            audioRelPath,
            portraitRelPath,
            role: String(raw.role || ""),
            engine: String(raw.engine || ""),
            text: String(raw.text || ""),
            raw
          });
        }

        items.sort((left, right) => left.order - right.order);

        return {
          schemaVersion: Number(data.schemaVersion || 1),
          audioPathBase: String(data.audioPathBase || data.threadPathBase || ""),
          portraitPathBase: String(data.portraitPathBase || ""),
          items
        };
      }

      async function validateMappingItems(items) {
        const diagnostics = {
          errors: [],
          warnings: []
        };
        const orderSeen = {};
        const audioNameSeen = {};

        for (const item of items) {
          if (!item.audioFileName) {
            diagnostics.errors.push(`Mapping order ${item.order} has no audioFileName.`);
          }
          if (!item.audioRelPath) {
            diagnostics.warnings.push(`Mapping order ${item.order} has no audioRelPath.`);
          }
          if (!item.portraitRelPath) {
            diagnostics.errors.push(`Mapping order ${item.order} has no portraitRelPath.`);
          }
          if (!IMAGE_EXTENSIONS[extensionOf(item.portraitRelPath)]) {
            diagnostics.warnings.push(
              `Mapping order ${item.order} portrait does not look like an image: ` +
                item.portraitRelPath
            );
          }

          if (orderSeen[item.order]) {
            diagnostics.warnings.push(`Duplicate mapping order: ${item.order}.`);
          } else {
            orderSeen[item.order] = true;
          }

          if (item.audioFileKey) {
            if (audioNameSeen[item.audioFileKey]) {
              diagnostics.errors.push(`Duplicate audioFileName: ${item.audioFileName}.`);
            } else {
              audioNameSeen[item.audioFileKey] = true;
            }
          }

          item.audioResolved = await resolveRelativeFile(
            state.workdir,
            state.workdirPath,
            item.audioRelPath
          );
          item.portraitResolved = await resolveRelativeFile(
            state.portraitDir,
            state.portraitDirPath,
            item.portraitRelPath
          );
        }

        return diagnostics;
      }

      function matchAudioClipsToMapping(audioClips, items, diagnostics) {
        const byAudioName = {};
        const matches = [];

        for (const item of items) {
          if (item.audioFileKey && !byAudioName[item.audioFileKey]) {
            byAudioName[item.audioFileKey] = item;
          }
        }

        for (const clip of audioClips) {
          const item = byAudioName[clip.fileKey];
          if (!item) {
            diagnostics.warnings.push(`Unmatched audio clip on timeline: ${clip.fileName}`);
            continue;
          }

          matches.push({
            item,
            audioClip: clip,
            portraitPath: item.portraitResolved.path,
            startTime: clip.startTime,
            endTime: clip.endTime,
            startSeconds: clip.startSeconds,
            endSeconds: clip.endSeconds,
            durationSeconds: clip.endSeconds - clip.startSeconds
          });
        }

        matches.sort((left, right) => {
          if (left.startSeconds !== right.startSeconds) {
            return left.startSeconds - right.startSeconds;
          }
          return left.item.order - right.item.order;
        });

        return matches;
      }

      async function importAndPlacePortraits(scan) {
        const uniqueImages = uniqueImageFiles(scan.matches);
        const rootItem = await scan.project.getRootItem();
        const importPaths = uniqueImages.map((file) => file.path);

        log("");
        log("Importing portrait images:");
        for (const file of uniqueImages) {
          log(`  ${file.path}`);
        }

        const imported = await scan.project.importFiles(importPaths, true, rootItem, false);
        if (!imported) {
          throw new Error("Project.importFiles returned false for portrait images.");
        }

        const projectItems = await resolveProjectItemsForFiles(scan.project, uniqueImages);
        const projectItemsByPath = {};
        for (const item of projectItems) {
          projectItemsByPath[normalizePath(item.file.path).toLowerCase()] = item.projectItem;
        }

        for (const match of scan.matches) {
          const key = normalizePath(match.portraitPath).toLowerCase();
          match.projectItem = projectItemsByPath[key];
          if (!match.projectItem) {
            throw new Error(`Imported portrait project item not found: ${match.portraitPath}`);
          }
        }

        const timelineResult = await insertPortraits(scan);
        return {
          placedCount: timelineResult.placedCount,
          trackLabel: timelineResult.trackLabel,
          trimWarnings: timelineResult.trimWarnings
        };
      }

      function uniqueImageFiles(matches) {
        const output = [];
        const seen = {};

        for (const match of matches) {
          const key = normalizePath(match.portraitPath).toLowerCase();
          if (!seen[key]) {
            output.push({
              name: basename(match.portraitPath),
              path: match.portraitPath
            });
            seen[key] = true;
          }
        }

        return output;
      }

      async function insertPortraits(scan) {
        if (!ppro.SequenceEditor || typeof ppro.SequenceEditor.getEditor !== "function") {
          throw new Error("ppro.SequenceEditor.getEditor() is unavailable.");
        }

        const editorResult = ppro.SequenceEditor.getEditor(scan.sequence);
        const editor = editorResult && typeof editorResult.then === "function"
          ? await editorResult
          : editorResult;
        const before = await readVideoTrackClipCount(scan.sequence, scan.targetVideoTrack.index);
        const expectedClipCount = before.clipCount + scan.matches.length;
        const strategies = buildPlacementStrategies(scan.targetVideoTrack, editor);
        let lastError = null;

        log("");
        log(
          `Timeline before: ${scan.targetVideoTrack.label} ` +
            `${before.exists ? "exists" : "does not exist yet"}, ` +
            `${before.clipCount} clip item(s).`
        );

        for (const strategy of strategies) {
          const attemptBefore = await readVideoTrackClipCount(
            scan.sequence,
            scan.targetVideoTrack.index
          );

          if (attemptBefore.clipCount > before.clipCount) {
            throw new Error(
              `${scan.targetVideoTrack.label} already changed during fallback attempts. ` +
                `It now has ${attemptBefore.clipCount} clip item(s).`
            );
          }

          log(`Trying timeline strategy: ${strategy.name}.`);

          try {
            placePortraitsWithStrategy(scan.project, editor, scan.matches, strategy);
            await wait(700);

            const attemptAfter = await readVideoTrackClipCount(
              scan.sequence,
              scan.targetVideoTrack.index
            );
            log(
              `Strategy result: ${scan.targetVideoTrack.label} has ` +
                `${attemptAfter.clipCount} clip item(s).`
            );

            if (attemptAfter.clipCount >= expectedClipCount) {
              const postWarnings = await postProcessPlacedPortraits(scan);
              return {
                trackLabel: scan.targetVideoTrack.label,
                placedCount: scan.matches.length,
                strategy: strategy.name,
                trimWarnings: postWarnings
              };
            }

            if (attemptAfter.clipCount > before.clipCount) {
              throw new Error(
                `${strategy.name} placed only ${attemptAfter.clipCount - before.clipCount} ` +
                  `of ${scan.matches.length} clip(s). Stopping to avoid duplicates.`
              );
            }

            lastError = new Error(`${strategy.name} committed but did not add timeline clips.`);
          } catch (error) {
            lastError = error;
            log(`Strategy failed: ${error && error.message ? error.message : error}`);
          }
        }

        throw lastError || new Error("No timeline placement strategy was available.");
      }

      function buildPlacementStrategies(target, editor) {
        const overwriteMode = typeof editor.createOverwriteItemAction === "function"
          ? "overwrite"
          : "insert";
        const firstMode = target.createsTrack ? "insert" : overwriteMode;
        const candidates = [
          {
            name: "video-only target track",
            videoTrackIndex: target.index,
            audioTrackIndex: -1,
            firstMode,
            restMode: overwriteMode
          },
          {
            name: "insert-only video target track",
            videoTrackIndex: target.index,
            audioTrackIndex: -1,
            firstMode: "insert",
            restMode: "insert"
          }
        ];
        const unique = [];
        const seen = {};

        for (const candidate of candidates) {
          const key = [
            candidate.videoTrackIndex,
            candidate.audioTrackIndex,
            candidate.firstMode,
            candidate.restMode
          ].join(":");
          if (!seen[key]) {
            unique.push(candidate);
            seen[key] = true;
          }
        }

        return unique;
      }

      function placePortraitsWithStrategy(project, editor, matches, strategy) {
        for (let index = 0; index < matches.length; index += 1) {
          const match = matches[index];
          const mode = index === 0 ? strategy.firstMode : strategy.restMode;

          executeProjectTransaction(project, `Place portrait ${match.item.order}`, (compoundAction) => {
            compoundAction.addAction(
              createPlaceProjectItemAction(
                editor,
                match.projectItem,
                match.startTime,
                strategy.videoTrackIndex,
                strategy.audioTrackIndex,
                mode
              )
            );
          });

          log(
            `Committed ${mode} action for order ${match.item.order}: ` +
              `${basename(match.portraitPath)} at ${formatSeconds(match.startSeconds)}.`
          );
        }
      }

      async function postProcessPlacedPortraits(scan) {
        const warnings = [];
        const steps = [
          {
            label: "trim portrait clips",
            run: () => trimPlacedPortraits(scan)
          },
          {
            label: "apply portrait transforms",
            run: () => applyPortraitTransforms(scan)
          },
          {
            label: "verify portrait timing",
            run: () => verifyPlacedPortraitTiming(scan, "final")
          }
        ];

        for (const step of steps) {
          try {
            const stepWarnings = await step.run();
            warnings.push.apply(warnings, stepWarnings || []);
          } catch (error) {
            const message =
              `Post-process step failed (${step.label}): ` +
              `${error && error.message ? error.message : error}`;
            warnings.push(message);
            log(message);
          }
        }

        return warnings;
      }

      async function trimPlacedPortraits(scan) {
        const warnings = [];
        const clips = await readVideoTrackClips(scan.sequence, scan.targetVideoTrack.index);
        const pairs = pairPlacedClips(scan.matches, clips);
        let actionCount = 0;

        log("");
        log("Trimming portraits to the next audio start; the final portrait ends with its audio:");

        for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
          const pair = pairs[pairIndex];
          const target = getPortraitTimingTarget(pairs, pairIndex);

          if (!pair.clip) {
            warnings.push(
              `Could not find placed portrait clip for order ${pair.match.item.order}.`
            );
            continue;
          }

          log(
            `  order ${pair.match.item.order}: audio ` +
              `${formatSeconds(pair.match.startSeconds)}-${formatSeconds(pair.match.endSeconds)} ` +
              `(${formatSeconds(pair.match.durationSeconds)}), target end ` +
              `${formatSeconds(target.endSeconds)} (${target.endBasis}), portrait before ` +
              `${formatSeconds(pair.clip.startSeconds)}-${formatSeconds(pair.clip.endSeconds)} ` +
              `(${formatSeconds(pair.clip.endSeconds - pair.clip.startSeconds)}).`
          );

          const clip = castVideoClipTrackItem(pair.clip.clip) || pair.clip.clip;
          const order = pair.match.item.order;
          const endAlreadyMatches =
            Math.abs(pair.clip.endSeconds - target.endSeconds) <= TIMING_TOLERANCE_SECONDS;

          if (endAlreadyMatches) {
            log(`    Trim portrait ${order} end: already at target.`);
          } else if (!supportsSetEndAction(clip)) {
            warnings.push(
              `Host does not expose an end trim action for order ${order}.`
            );
          } else if (
            tryExecuteSingleAction(scan.project, `Trim portrait ${order} end`, () =>
              createSetEndAction(clip, copyTickTime(target.endTime, target.endSeconds))
            )
          ) {
            actionCount += 1;
          } else {
            warnings.push(`Could not trim portrait end for order ${order}.`);
          }

          if (Math.abs(pair.clip.startSeconds - pair.match.startSeconds) <= TIMING_TOLERANCE_SECONDS) {
            continue;
          }

          if (!supportsSetStartAction(clip)) {
            warnings.push(
              `Host does not expose a start trim action for order ${order}.`
            );
          } else if (
            tryExecuteSingleAction(scan.project, `Trim portrait ${order} start`, () =>
              createSetStartAction(clip, copyTickTime(pair.match.startTime, pair.match.startSeconds))
            )
          ) {
            actionCount += 1;
          } else {
            warnings.push(`Could not trim portrait start for order ${order}.`);
          }
        }

        log(`Trim action attempts committed: ${actionCount}.`);

        return warnings;
      }

      function getPortraitTimingTarget(pairs, pairIndex) {
        const pair = pairs[pairIndex];
        if (pair.match.targetEndTime && Number.isFinite(Number(pair.match.targetEndSeconds))) {
          return {
            startTime: pair.match.startTime,
            startSeconds: pair.match.startSeconds,
            endTime: pair.match.targetEndTime,
            endSeconds: pair.match.targetEndSeconds,
            endBasis: "planned next cue start"
          };
        }

        const nextPair = pairIndex + 1 < pairs.length ? pairs[pairIndex + 1] : null;

        if (nextPair) {
          return {
            startTime: pair.match.startTime,
            startSeconds: pair.match.startSeconds,
            endTime: nextPair.match.startTime,
            endSeconds: nextPair.match.startSeconds,
            endBasis: "next audio start"
          };
        }

        return {
          startTime: pair.match.startTime,
          startSeconds: pair.match.startSeconds,
          endTime: pair.match.endTime,
          endSeconds: pair.match.endSeconds,
          endBasis: "final audio end"
        };
      }

      function tryExecuteSingleAction(project, name, createAction) {
        try {
          executeProjectTransaction(project, name, (compoundAction) => {
            const action = createAction();
            if (!action) {
              throw new Error("Action factory returned no action.");
            }
            compoundAction.addAction(action);
          });
          log(`    ${name}: ok`);
          return true;
        } catch (error) {
          log(`    ${name}: skipped: ${error && error.message ? error.message : error}`);
          return false;
        }
      }

      async function applyPortraitTransforms(scan) {
        const warnings = [];
        const frameSize = await scan.sequence.getFrameSize();
        const clips = await readVideoTrackClips(scan.sequence, scan.targetVideoTrack.index);
        const pairs = pairPlacedClips(scan.matches, clips);

        log("");
        log(
          `Applying portrait transforms: bottom aligned, target height ` +
            `${roundForLog(PORTRAIT_HEIGHT_RATIO * 100)}% of frame ${valueToString(frameSize)}.`
        );

        for (const pair of pairs) {
          if (!pair.clip) {
            warnings.push(
              `Could not find placed portrait clip for transform, order ${pair.match.item.order}.`
            );
            continue;
          }

          try {
            const transformWarnings = await applyPortraitTransform(scan.project, pair, frameSize);
            warnings.push.apply(warnings, transformWarnings);
          } catch (error) {
            const message =
              `Transform failed for order ${pair.match.item.order}: ` +
              `${error && error.message ? error.message : error}`;
            warnings.push(message);
            log(`  ${message}`);
            await logClipComponentSummary(pair.clip.clip);
          }
        }

        return warnings;
      }

      async function applyPortraitTransform(project, pair, frameSize) {
        const warnings = [];
        const match = pair.match;
        const clip = castVideoClipTrackItem(pair.clip.clip) || pair.clip.clip;
        const imageSize = await readImageDimensionsForMatch(match);
        const frameWidth = Number(frameSize.width);
        const frameHeight = Number(frameSize.height);

        if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameHeight <= 0) {
          throw new Error(`Could not read sequence frame size: ${valueToString(frameSize)}.`);
        }
        if (!imageSize || !imageSize.width || !imageSize.height) {
          throw new Error(`Could not read image dimensions for ${basename(match.portraitPath)}.`);
        }

        const chain = await clip.getComponentChain();
        const motion = findMotionComponent(chain);
        const params = getMotionParams(motion);
        const readTime = await getClipInPoint(clip);
        const positionValue = await params.position.getValueAtTime(readTime);
        const anchorValue = await params.anchorPoint.getValueAtTime(readTime);
        const scaleHeightValue = await params.scaleHeight.getValueAtTime(readTime);
        const scaleWidthValue = await params.scaleWidth.getValueAtTime(readTime);
        const uniformValue = await params.uniformScale.getValueAtTime(readTime);
        const targetScale = frameHeight * PORTRAIT_HEIGHT_RATIO / imageSize.height * 100;
        const positionTarget = frameBottomCenterPoint(positionValue, frameSize);
        const anchorTarget = imageBottomCenterPoint(anchorValue, imageSize);
        const labelPrefix = `order ${match.item.order}`;

        log(
          `  order ${match.item.order}: ${basename(match.portraitPath)} ` +
            `${imageSize.width}x${imageSize.height}, scale ${roundForLog(targetScale)}.`
        );
        log(
          `    motion: ${await motion.getDisplayName()} ` +
            `matchName=${await motion.getMatchName()} params=${motion.getParamCount()}`
        );
        log(
          `    before: position=${valueToString(positionValue)}, ` +
            `anchor=${valueToString(anchorValue)}, ` +
            `scaleH=${valueToString(scaleHeightValue)}, ` +
            `scaleW=${valueToString(scaleWidthValue)}, uniform=${valueToString(uniformValue)}`
        );
        log(
          `    target: position=${valueToString(positionTarget)}, ` +
            `anchor=${valueToString(anchorTarget)}, ` +
            `scaleH=${roundForLog(targetScale)}, scaleW=${roundForLog(targetScale)}, uniform=true`
        );

        if (!trySetStaticValue(project, params.position, positionTarget, `${labelPrefix} Position`)) {
          warnings.push(`Transform set Position failed for order ${match.item.order}.`);
        }
        if (!trySetStaticValue(project, params.anchorPoint, anchorTarget, `${labelPrefix} Anchor Point`)) {
          warnings.push(`Transform set Anchor Point failed for order ${match.item.order}.`);
        }
        if (!trySetStaticValue(project, params.uniformScale, true, `${labelPrefix} Uniform Scale`)) {
          warnings.push(`Transform set Uniform Scale failed for order ${match.item.order}.`);
        }
        if (!trySetStaticValue(project, params.scaleHeight, targetScale, `${labelPrefix} Scale Height`)) {
          warnings.push(`Transform set Scale Height failed for order ${match.item.order}.`);
        }
        if (!trySetStaticValue(project, params.scaleWidth, targetScale, `${labelPrefix} Scale Width`)) {
          warnings.push(`Transform set Scale Width failed for order ${match.item.order}.`);
        }

        await wait(100);

        const afterPosition = await params.position.getValueAtTime(readTime);
        const afterAnchor = await params.anchorPoint.getValueAtTime(readTime);
        const afterScaleHeight = await params.scaleHeight.getValueAtTime(readTime);
        const afterScaleWidth = await params.scaleWidth.getValueAtTime(readTime);
        const afterUniform = await params.uniformScale.getValueAtTime(readTime);

        log(
          `    after: position=${valueToString(afterPosition)}, ` +
            `anchor=${valueToString(afterAnchor)}, ` +
            `scaleH=${valueToString(afterScaleHeight)}, ` +
            `scaleW=${valueToString(afterScaleWidth)}, uniform=${valueToString(afterUniform)}`
        );

        if (Math.abs(numberFromValue(afterScaleHeight) - targetScale) > TRANSFORM_TOLERANCE) {
          const message =
            `    warning: Scale Height did not verify. ` +
              `Expected ${roundForLog(targetScale)}, got ${valueToString(afterScaleHeight)}.`;
          log(message);
          warnings.push(
            `Transform Scale Height mismatch for order ${match.item.order}: ` +
              `expected ${roundForLog(targetScale)}, got ${valueToString(afterScaleHeight)}.`
          );
        }

        return warnings;
      }

      async function verifyPlacedPortraitTiming(scan, label) {
        const warnings = [];

        await wait(300);

        const clips = await readVideoTrackClips(scan.sequence, scan.targetVideoTrack.index);
        const pairs = pairPlacedClips(scan.matches, clips);

        log("");
        log(`Timing verification (${label}):`);

        for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
          const pair = pairs[pairIndex];
          const target = getPortraitTimingTarget(pairs, pairIndex);

          if (!pair.clip) {
            warnings.push(
              `Could not verify portrait timing for order ${pair.match.item.order}; clip not found.`
            );
            log(`  order ${pair.match.item.order}: clip not found.`);
            continue;
          }

          const portraitDuration = pair.clip.endSeconds - pair.clip.startSeconds;
          const targetDuration = target.endSeconds - target.startSeconds;
          const startDiff = pair.clip.startSeconds - target.startSeconds;
          const endDiff = pair.clip.endSeconds - target.endSeconds;
          const durationDiff = portraitDuration - targetDuration;

          log(
            `  order ${pair.match.item.order}: audio ` +
              `${formatSeconds(pair.match.startSeconds)}-${formatSeconds(pair.match.endSeconds)} ` +
              `dur ${formatSeconds(pair.match.durationSeconds)} | target ` +
              `${formatSeconds(target.startSeconds)}-${formatSeconds(target.endSeconds)} ` +
              `(${target.endBasis}) | portrait ` +
              `${formatSeconds(pair.clip.startSeconds)}-${formatSeconds(pair.clip.endSeconds)} ` +
              `dur ${formatSeconds(portraitDuration)} | diff ` +
              `start ${formatSignedSeconds(startDiff)}, end ${formatSignedSeconds(endDiff)}, ` +
              `dur ${formatSignedSeconds(durationDiff)}`
          );

          if (
            Math.abs(startDiff) > TIMING_TOLERANCE_SECONDS ||
            Math.abs(endDiff) > TIMING_TOLERANCE_SECONDS ||
            Math.abs(durationDiff) > TIMING_TOLERANCE_SECONDS
          ) {
            warnings.push(
              `Timing mismatch for order ${pair.match.item.order}: ` +
                `target ${formatSeconds(targetDuration)}, ` +
                `portrait ${formatSeconds(portraitDuration)}, ` +
                `end diff ${formatSignedSeconds(endDiff)}.`
            );
          }
        }

        return warnings;
      }

      function pairPlacedClips(matches, clips) {
        const pairs = [];
        const used = {};
        const sortedClips = clips.slice().sort((left, right) => left.startSeconds - right.startSeconds);

        for (const match of matches) {
          let selected = null;

          for (let index = 0; index < sortedClips.length; index += 1) {
            const clip = sortedClips[index];
            if (used[index]) {
              continue;
            }
            if (!sameClipMedia(clip, match)) {
              continue;
            }
            if (Math.abs(clip.startSeconds - match.startSeconds) > 0.75) {
              continue;
            }

            selected = { index, clip };
            break;
          }

          if (!selected) {
            for (let index = 0; index < sortedClips.length; index += 1) {
              const clip = sortedClips[index];
              if (!used[index] && sameClipMedia(clip, match)) {
                selected = { index, clip };
                break;
              }
            }
          }

          if (selected) {
            used[selected.index] = true;
            pairs.push({ match, clip: selected.clip });
          } else {
            pairs.push({ match, clip: null });
          }
        }

        return pairs;
      }

      function sameClipMedia(clip, match) {
        if (clip && samePath(clip.mediaPath, match.portraitPath)) {
          return true;
        }

        const clipName = clip && (clip.fileName || basename(clip.name));
        const expectedName = basename(match.portraitPath);
        return !!clipName && fileNameKey(clipName) === fileNameKey(expectedName);
      }

      function createSetStartAction(clip, time) {
        if (clip && typeof clip.createSetStartAction === "function") {
          return clip.createSetStartAction(time);
        }
        if (clip && typeof clip.createSetStartTimeAction === "function") {
          return clip.createSetStartTimeAction(time);
        }
        return null;
      }

      function supportsSetStartAction(clip) {
        return !!(
          clip &&
          (typeof clip.createSetStartAction === "function" ||
            typeof clip.createSetStartTimeAction === "function")
        );
      }

      function createSetEndAction(clip, time) {
        if (clip && typeof clip.createSetEndAction === "function") {
          return clip.createSetEndAction(time);
        }
        if (clip && typeof clip.createSetEndTimeAction === "function") {
          return clip.createSetEndTimeAction(time);
        }
        return null;
      }

      function supportsSetEndAction(clip) {
        return !!(
          clip &&
          (typeof clip.createSetEndAction === "function" ||
            typeof clip.createSetEndTimeAction === "function")
        );
      }

      function copyTickTime(time, fallbackSeconds) {
        if (time && typeof time.ticks === "string" && time.ticks) {
          return ppro.TickTime.createWithTicks(time.ticks);
        }

        return ppro.TickTime.createWithSeconds(Number(fallbackSeconds));
      }

      function findMotionComponent(chain) {
        const count = chain.getComponentCount();
        const indexed = count > 1 ? chain.getComponentAtIndex(1) : null;

        if (indexed && looksLikeMotion(indexed)) {
          return indexed;
        }

        for (let index = 0; index < count; index += 1) {
          const component = chain.getComponentAtIndex(index);
          if (looksLikeMotion(component)) {
            return component;
          }
        }

        throw new Error("Motion component was not found.");
      }

      function looksLikeMotion(component) {
        if (!component || component.getParamCount() < 6) {
          return false;
        }

        try {
          return !!component.getParam(0) && !!component.getParam(1) && !!component.getParam(5);
        } catch (error) {
          return false;
        }
      }

      function getMotionParams(motion) {
        return {
          position: motion.getParam(0),
          scaleHeight: motion.getParam(1),
          scaleWidth: motion.getParam(2),
          uniformScale: motion.getParam(3),
          anchorPoint: motion.getParam(5)
        };
      }

      function trySetStaticValue(project, param, value, label) {
        try {
          executeProjectTransaction(project, `Set ${label}`, (compoundAction) => {
            compoundAction.addAction(param.createSetTimeVaryingAction(false));
            compoundAction.addAction(param.createSetValueAction(param.createKeyframe(value), true));
          });
          log(`    set ${label}: ok`);
          return true;
        } catch (error) {
          log(`    set ${label}: skipped: ${error && error.message ? error.message : error}`);
          return false;
        }
      }

      async function logClipComponentSummary(clip) {
        try {
          const castClip = castVideoClipTrackItem(clip) || clip;
          const chain = await castClip.getComponentChain();
          const count = chain.getComponentCount();
          log(`    component chain count: ${count}`);

          for (let index = 0; index < count; index += 1) {
            const component = chain.getComponentAtIndex(index);
            log(
              `    component ${index}: ${await component.getDisplayName()} ` +
                `matchName=${await component.getMatchName()} params=${component.getParamCount()}`
            );

            for (let paramIndex = 0; paramIndex < component.getParamCount(); paramIndex += 1) {
              const param = component.getParam(paramIndex);
              log(`      param ${paramIndex}: ${param.displayName}`);
            }
          }
        } catch (error) {
          log(
            `    component summary failed: ` +
              `${error && error.message ? error.message : error}`
          );
        }
      }

      async function getClipInPoint(clip) {
        try {
          const inPoint = await clip.getInPoint();
          if (inPoint && Number.isFinite(Number(inPoint.seconds))) {
            return inPoint;
          }
        } catch (error) {
          // Fall back below.
        }

        return ppro.TickTime.createWithSeconds(0);
      }

      function frameBottomCenterPoint(currentValue, frameSize) {
        const frameWidth = Number(frameSize.width);
        const frameHeight = Number(frameSize.height);

        if (usesAbsolutePoint(currentValue)) {
          return ppro.PointF(frameWidth / 2, frameHeight);
        }

        return ppro.PointF(0.5, 1);
      }

      function imageBottomCenterPoint(currentValue, imageSize) {
        if (usesAbsolutePoint(currentValue)) {
          return ppro.PointF(Number(imageSize.width) / 2, Number(imageSize.height));
        }

        return ppro.PointF(0.5, 1);
      }

      function usesAbsolutePoint(value) {
        const point = pointFromValue(value);

        return !!point && (Math.abs(Number(point.x)) > 2 || Math.abs(Number(point.y)) > 2);
      }

      function pointFromValue(value) {
        if (!value) {
          return null;
        }
        if (typeof value.x === "number" && typeof value.y === "number") {
          return value;
        }
        if (value.value && typeof value.value.x === "number" && typeof value.value.y === "number") {
          return value.value;
        }
        return null;
      }

      function numberFromValue(value) {
        if (value && value.value !== undefined) {
          return Number(value.value);
        }
        return Number(value);
      }

      function createPlaceProjectItemAction(editor, projectItem, startTime, videoTrackIndex, audioTrackIndex, mode) {
        if (mode === "overwrite" && typeof editor.createOverwriteItemAction === "function") {
          return editor.createOverwriteItemAction(
            projectItem,
            startTime,
            videoTrackIndex,
            audioTrackIndex
          );
        }

        return editor.createInsertProjectItemAction(
          projectItem,
          startTime,
          videoTrackIndex,
          audioTrackIndex,
          true
        );
      }

      async function resolveSourceAudioTrack(sequence, spec) {
        const audioTrackCount = await sequence.getAudioTrackCount();
        const text = String(spec || "A1").trim().toLowerCase();
        const match = text.match(/^a?\s*(\d+)$/);

        if (!match) {
          throw new Error("Source audio track must use A1 format.");
        }

        const trackNumber = Number(match[1]);
        if (
          !Number.isFinite(trackNumber) ||
          Math.floor(trackNumber) !== trackNumber ||
          trackNumber < 1 ||
          trackNumber > audioTrackCount
        ) {
          throw new Error(`Source audio track is out of range. Available: A1-A${audioTrackCount}.`);
        }

        return {
          index: trackNumber - 1,
          label: `A${trackNumber}`
        };
      }

      async function resolveTargetVideoTrack(sequence, spec) {
        const videoTrackCount = await sequence.getVideoTrackCount();
        const text = String(spec || "auto").trim().toLowerCase();

        if (text === "auto") {
          for (let index = 0; index < videoTrackCount; index += 1) {
            if (await isVideoTrackEmpty(sequence, index)) {
              return {
                index,
                label: `V${index + 1}`,
                createsTrack: false
              };
            }
          }

          return {
            index: videoTrackCount,
            label: `V${videoTrackCount + 1} (new)`,
            createsTrack: true
          };
        }

        if (text === "new" || text === "+" || text === "create") {
          return {
            index: videoTrackCount,
            label: `V${videoTrackCount + 1} (new)`,
            createsTrack: true
          };
        }

        const match = text.match(/^v?\s*(\d+)$/);
        if (!match) {
          throw new Error("Target video track must be auto, new, or use V1 format.");
        }

        const trackNumber = Number(match[1]);
        if (!Number.isFinite(trackNumber) || Math.floor(trackNumber) !== trackNumber || trackNumber < 1) {
          throw new Error("Target video track must be a positive integer.");
        }

        if (trackNumber <= videoTrackCount) {
          const index = trackNumber - 1;
          if (!(await isVideoTrackEmpty(sequence, index))) {
            throw new Error(`V${trackNumber} is not empty. Choose an empty track, auto, or new.`);
          }

          return {
            index,
            label: `V${trackNumber}`,
            createsTrack: false
          };
        }

        if (trackNumber === videoTrackCount + 1) {
          return {
            index: videoTrackCount,
            label: `V${trackNumber} (new)`,
            createsTrack: true
          };
        }

        throw new Error(`Only the next new track can be created. Current video tracks: ${videoTrackCount}.`);
      }

      async function isVideoTrackEmpty(sequence, index) {
        const track = await sequence.getVideoTrack(index);
        if (!track || typeof track.getTrackItems !== "function") {
          throw new Error(`Could not read V${index + 1}.`);
        }

        const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
        return !clips || clips.length === 0;
      }

      async function collectAudioTrackClips(sequence, audioTrackIndex) {
        const track = await sequence.getAudioTrack(audioTrackIndex);
        if (!track || typeof track.getTrackItems !== "function") {
          throw new Error(`Could not read A${audioTrackIndex + 1}.`);
        }

        const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) || [];
        const output = [];

        for (let index = 0; index < clips.length; index += 1) {
          const clip = clips[index];
          const item = await describeTimelineClip(clip, index);
          if (item) {
            output.push(item);
          }
        }

        output.sort((left, right) => left.startSeconds - right.startSeconds);
        return output;
      }

      async function readVideoTrackClipCount(sequence, videoTrackIndex) {
        const trackCount = await sequence.getVideoTrackCount();
        if (videoTrackIndex >= trackCount) {
          return {
            exists: false,
            trackCount,
            clipCount: 0
          };
        }

        const track = await sequence.getVideoTrack(videoTrackIndex);
        const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
        return {
          exists: true,
          trackCount,
          clipCount: clips ? clips.length : 0
        };
      }

      async function readVideoTrackClips(sequence, videoTrackIndex) {
        const trackCount = await sequence.getVideoTrackCount();
        if (videoTrackIndex >= trackCount) {
          return [];
        }

        const track = await sequence.getVideoTrack(videoTrackIndex);
        const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) || [];
        const output = [];

        for (let index = 0; index < clips.length; index += 1) {
          const item = await describeTimelineClip(clips[index], index);
          if (item) {
            output.push(item);
          }
        }

        output.sort((left, right) => left.startSeconds - right.startSeconds);
        return output;
      }

      async function describeTimelineClip(clip, index) {
        const name = await safeGetClipName(clip);
        const mediaPath = await getMediaPath(clip);
        const fileName = basename(mediaPath) || basename(name);
        const startTime = await clip.getStartTime();
        const endTime = await clip.getEndTime();
        const startSeconds = Number(startTime && startTime.seconds);
        const endSeconds = Number(endTime && endTime.seconds);

        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
          log(`Skipping timeline clip ${index + 1}; could not read start/end.`);
          return null;
        }

        return {
          clip,
          index,
          name,
          mediaPath,
          fileName,
          fileKey: fileNameKey(fileName),
          startTime,
          endTime,
          startSeconds,
          endSeconds
        };
      }

      async function safeGetClipName(clip) {
        try {
          if (clip && typeof clip.getName === "function") {
            return await clip.getName();
          }
        } catch (error) {
          // Fall back below.
        }

        return clip && clip.name ? String(clip.name) : "";
      }

      async function getMediaPath(clip) {
        try {
          const projectItem = await clip.getProjectItem();
          const clipProjectItem = ppro.ClipProjectItem.cast(projectItem);
          return await clipProjectItem.getMediaFilePath();
        } catch (error) {
          return "";
        }
      }

      async function resolveProjectItemsForFiles(project, files) {
        const selectedProjectItems = await collectSelectedClipProjectItems(project);
        if (selectedProjectItems.length > 0) {
          try {
            return matchProjectItemsForFiles(selectedProjectItems, files, false);
          } catch (error) {
            log("Project selection did not cover all imported images; falling back to project tree scan.");
          }
        }

        const rootItem = await project.getRootItem();
        const projectItems = [];

        await collectClipProjectItems(rootItem, projectItems);

        return matchProjectItemsForFiles(projectItems, files, true);
      }

      async function collectSelectedClipProjectItems(project) {
        const output = [];

        if (!ppro.ProjectUtils || typeof ppro.ProjectUtils.getSelection !== "function") {
          return output;
        }

        try {
          const selection = await ppro.ProjectUtils.getSelection(project);
          const items = selection && typeof selection.getItems === "function"
            ? await selection.getItems()
            : [];

          for (const item of items) {
            await collectClipProjectItems(item, output);
          }
        } catch (error) {
          log(`Could not read project selection: ${error && error.message ? error.message : error}`);
        }

        return output;
      }

      function matchProjectItemsForFiles(projectItems, files, allowNameFallback) {
        return files.map((file) => {
          const pathMatches = projectItems.filter((item) => samePath(item.mediaPath, file.path));

          if (pathMatches.length > 0) {
            return {
              file,
              projectItem: pathMatches[0].projectItem
            };
          }

          const nameMatches = allowNameFallback
            ? projectItems.filter((item) => item.name === file.name)
            : [];
          if (nameMatches.length > 0) {
            log(`Warning: matched ${file.name} by name because its media path was not found.`);
            return {
              file,
              projectItem: nameMatches[0].projectItem
            };
          }

          throw new Error(`Imported project item was not found for ${file.name}.`);
        });
      }

      async function collectClipProjectItems(projectItem, output) {
        const folder = getFolderLikeItem(projectItem);
        if (folder) {
          const children = await folder.getItems();
          for (const child of children) {
            await collectClipProjectItems(child, output);
          }
        }

        const clip = castClipProjectItem(projectItem);
        if (!clip || typeof clip.getMediaFilePath !== "function") {
          return;
        }

        let mediaPath = "";
        try {
          mediaPath = await clip.getMediaFilePath();
        } catch (error) {
          return;
        }

        if (!mediaPath) {
          return;
        }

        output.push({
          projectItem,
          clipProjectItem: clip,
          mediaPath,
          name: await getProjectItemName(projectItem)
        });
      }

      function getFolderLikeItem(projectItem) {
        if (projectItem && typeof projectItem.getItems === "function") {
          return projectItem;
        }

        try {
          const folder = ppro.FolderItem.cast(projectItem);
          return folder && typeof folder.getItems === "function" ? folder : null;
        } catch (error) {
          return null;
        }
      }

      function castClipProjectItem(projectItem) {
        try {
          return ppro.ClipProjectItem.cast(projectItem);
        } catch (error) {
          return null;
        }
      }

      function castVideoClipTrackItem(clip) {
        if (!ppro.VideoClipTrackItem || typeof ppro.VideoClipTrackItem.cast !== "function") {
          return null;
        }

        try {
          return ppro.VideoClipTrackItem.cast(clip);
        } catch (error) {
          return null;
        }
      }

      async function getProjectItemName(projectItem) {
        try {
          if (projectItem && typeof projectItem.getName === "function") {
            return await projectItem.getName();
          }
        } catch (error) {
          // Fall back below.
        }

        return projectItem && projectItem.name ? String(projectItem.name) : "";
      }

      async function resolveRelativeFile(baseEntry, basePath, relPath) {
        const path = joinNativePath(basePath, relPath);

        if (!relPath) {
          return {
            path,
            exists: false
          };
        }

        if (baseEntry && baseEntry.isFolder) {
          try {
            const entry = await getEntryForRelativePath(baseEntry, relPath);
            return {
              path: getNativePath(entry) || path,
              exists: true,
              entry
            };
          } catch (error) {
            return {
              path,
              exists: false
            };
          }
        }

        return {
          path,
          exists: null
        };
      }

      async function getEntryForRelativePath(baseFolder, relPath) {
        const parts = normalizeRelativePath(relPath).split("/").filter(Boolean);
        let current = baseFolder;

        for (const part of parts) {
          if (!current || !current.isFolder || typeof current.getEntries !== "function") {
            throw new Error(`Could not traverse ${relPath}.`);
          }

          const entries = await current.getEntries();
          const exact = entries.find((entry) => entry.name === part);
          const folded = exact || entries.find((entry) => entry.name.toLowerCase() === part.toLowerCase());
          if (!folded) {
            throw new Error(`Missing path part ${part}.`);
          }
          current = folded;
        }

        return current;
      }

      async function getEntryForNativePath(path) {
        if (!path || !localFileSystem || typeof localFileSystem.getEntryWithUrl !== "function") {
          return null;
        }

        const urls = nativePathToFileUrls(path);
        for (const url of urls) {
          try {
            return await localFileSystem.getEntryWithUrl(url);
          } catch (error) {
            // Try the next URL spelling.
          }
        }

        return null;
      }

      function nativePathToFileUrls(path) {
        const normalized = normalizePath(path);
        const urls = [];

        if (/^[A-Za-z]:\//.test(normalized)) {
          urls.push(`file:/${normalized}`);
          urls.push(`file:///${normalized}`);
        } else if (normalized.startsWith("/")) {
          urls.push(`file:${normalized}`);
          urls.push(`file://${normalized}`);
        } else {
          urls.push(`file:/${normalized}`);
        }

        return urls.concat(urls.map((url) => encodeURI(url)));
      }

      function inferWorkdirPathFromMappingPath(mappingPath) {
        if (!mappingPath) {
          return "";
        }

        const voiceDir = dirname(mappingPath);
        const mediaDir = dirname(voiceDir);
        const workdir = dirname(mediaDir);
        const voiceName = basename(voiceDir).toLowerCase();
        const mediaName = basename(mediaDir).toLowerCase();

        if (voiceName === "voice" && mediaName === "media") {
          return workdir;
        }

        return "";
      }

      function renderState() {
        $("mappingPath").textContent = state.mappingPath || "No mapping selected";
        $("workdirPath").textContent = state.workdirPath || "No workdir selected";
        $("portraitDirPath").textContent = state.portraitDirPath || "No portrait dir selected";
      }

      function renderMappingPreview(mapping) {
        if (!mapping || !mapping.items.length) {
          $("preview").textContent = "No mapping items.";
          return;
        }

        const lines = [
          `schemaVersion: ${mapping.schemaVersion}`,
          `items: ${mapping.items.length}`,
          ""
        ];

        for (const item of mapping.items.slice(0, 40)) {
          lines.push(
            `${item.order}. ${item.audioFileName} -> ${item.portraitRelPath}` +
              (item.role ? ` [${item.role}]` : "")
          );
        }

        if (mapping.items.length > 40) {
          lines.push(`... ${mapping.items.length - 40} more`);
        }

        $("preview").textContent = lines.join("\n");
      }

      function renderScanPreview(scan) {
        const lines = [
          `Mapping items: ${scan.mappingItemCount || state.mapping.items.length}`,
          `Timeline audio clips: ${scan.audioClips.length}`,
          `Matched clips: ${scan.matches.length}`,
          `Unused mapping rows: ${scan.unusedItems.length}`,
          `Warnings: ${scan.diagnostics.warnings.length}`,
          `Errors: ${scan.diagnostics.errors.length}`,
          ""
        ];

        for (const match of scan.matches.slice(0, 60)) {
          lines.push(
            `${formatSeconds(match.startSeconds)}-${formatSeconds(match.endSeconds)} ` +
              `${match.item.audioFileName} -> ${match.item.portraitRelPath}`
          );
        }

        if (scan.matches.length > 60) {
          lines.push(`... ${scan.matches.length - 60} more match(es)`);
        }

        $("preview").textContent = lines.join("\n");
      }

      function logScan(scan) {
        log("");
        log("Script: ForkTranslation Portrait Map Importer");
        log(`Project: ${scan.project.path || scan.project.name || "(unsaved)"}`);
        log(`Sequence: ${safe(scan.sequence.name)}`);
        log(`Mapping: ${state.mappingPath}`);
        log(`Workdir: ${state.workdirPath}`);
        log(`Portrait dir: ${state.portraitDirPath}`);
        log(`Source audio track: ${scan.sourceAudioTrack.label}`);
        log(`Target video track: ${scan.targetVideoTrack.label}`);
        log(`Timeline audio clips: ${scan.audioClips.length}`);
        log(`Matched clips: ${scan.matches.length}`);
        log(`Unused mapping rows: ${scan.unusedItems.length}`);

        if (scan.diagnostics.warnings.length > 0) {
          log("Warnings:");
          for (const warning of scan.diagnostics.warnings) {
            log(`  - ${warning}`);
          }
        }

        if (scan.diagnostics.errors.length > 0) {
          log("Errors:");
          for (const error of scan.diagnostics.errors) {
            log(`  - ${error}`);
          }
        }
      }

      async function readImageDimensionsForMatch(match) {
        const resolved = match.item && match.item.portraitResolved;
        const entry = resolved && resolved.entry
          ? resolved.entry
          : await getEntryForNativePath(match.portraitPath);

        if (!entry || typeof entry.read !== "function") {
          throw new Error(`Could not open image file entry: ${match.portraitPath}`);
        }

        const buffer = await readBinaryFile(entry);
        return parseImageDimensions(buffer, match.portraitPath);
      }

      async function readBinaryFile(entry) {
        const formats = storage && storage.formats ? storage.formats : {};
        const attempts = [];

        if (formats.binary !== undefined) {
          attempts.push({ format: formats.binary });
        }
        attempts.push({ format: "binary" });
        attempts.push({});

        let lastError = null;
        for (const options of attempts) {
          try {
            const value = Object.keys(options).length > 0
              ? await entry.read(options)
              : await entry.read();
            const buffer = normalizeBinaryBuffer(value);

            if (buffer) {
              return buffer;
            }
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError || new Error("File.read() did not return binary data.");
      }

      function normalizeBinaryBuffer(value) {
        if (value instanceof ArrayBuffer) {
          return value;
        }
        if (ArrayBuffer.isView(value)) {
          return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        }
        if (typeof value === "string") {
          const bytes = new Uint8Array(value.length);
          for (let index = 0; index < value.length; index += 1) {
            bytes[index] = value.charCodeAt(index) & 0xff;
          }
          return bytes.buffer;
        }

        return null;
      }

      function parseImageDimensions(buffer, path) {
        if (!buffer || buffer.byteLength < 10) {
          throw new Error(`Image file is too small: ${basename(path)}`);
        }

        const view = new DataView(buffer);
        const ext = extensionOf(path);

        if (isPng(view)) {
          return {
            width: view.getUint32(16, false),
            height: view.getUint32(20, false),
            format: "png"
          };
        }
        if (isJpeg(view)) {
          return parseJpegDimensions(view);
        }
        if (readFourCC(view, 0) === "RIFF" && readFourCC(view, 8) === "WEBP") {
          return parseWebpDimensions(view);
        }
        if (readAscii(view, 0, 3) === "GIF") {
          return {
            width: view.getUint16(6, true),
            height: view.getUint16(8, true),
            format: "gif"
          };
        }
        if (readFourCC(view, 0).slice(0, 2) === "BM" && view.byteLength >= 26) {
          return {
            width: Math.abs(view.getInt32(18, true)),
            height: Math.abs(view.getInt32(22, true)),
            format: "bmp"
          };
        }
        if (readFourCC(view, 0) === "8BPS" && view.byteLength >= 26) {
          return {
            width: view.getUint32(18, false),
            height: view.getUint32(14, false),
            format: "psd"
          };
        }
        if (ext === "tif" || ext === "tiff") {
          return parseTiffDimensions(view);
        }

        throw new Error(`Unsupported image dimension format for ${basename(path)}.`);
      }

      function isPng(view) {
        return view.byteLength >= 24 &&
          view.getUint8(0) === 0x89 &&
          readAscii(view, 1, 3) === "PNG" &&
          view.getUint8(4) === 0x0d &&
          view.getUint8(5) === 0x0a &&
          view.getUint8(6) === 0x1a &&
          view.getUint8(7) === 0x0a;
      }

      function isJpeg(view) {
        return view.byteLength >= 4 &&
          view.getUint8(0) === 0xff &&
          view.getUint8(1) === 0xd8;
      }

      function parseJpegDimensions(view) {
        let offset = 2;

        while (offset + 3 < view.byteLength) {
          while (offset < view.byteLength && view.getUint8(offset) === 0xff) {
            offset += 1;
          }

          const marker = view.getUint8(offset);
          offset += 1;

          if (marker === 0xd9 || marker === 0xda) {
            break;
          }
          if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
          }
          if (offset + 2 > view.byteLength) {
            break;
          }

          const segmentLength = view.getUint16(offset, false);
          if (segmentLength < 2 || offset + segmentLength > view.byteLength) {
            break;
          }

          if (isJpegSofMarker(marker) && segmentLength >= 7) {
            return {
              width: view.getUint16(offset + 5, false),
              height: view.getUint16(offset + 3, false),
              format: "jpeg"
            };
          }

          offset += segmentLength;
        }

        throw new Error("JPEG SOF marker was not found.");
      }

      function isJpegSofMarker(marker) {
        return (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        );
      }

      function parseWebpDimensions(view) {
        let offset = 12;

        while (offset + 8 <= view.byteLength) {
          const chunkId = readFourCC(view, offset);
          const chunkSize = view.getUint32(offset + 4, true);
          const payload = offset + 8;

          if (payload + chunkSize > view.byteLength) {
            break;
          }

          if (chunkId === "VP8X" && chunkSize >= 10) {
            return {
              width: readUint24LE(view, payload + 4) + 1,
              height: readUint24LE(view, payload + 7) + 1,
              format: "webp"
            };
          }
          if (chunkId === "VP8L" && chunkSize >= 5 && view.getUint8(payload) === 0x2f) {
            const bits = view.getUint8(payload + 1) |
              (view.getUint8(payload + 2) << 8) |
              (view.getUint8(payload + 3) << 16) |
              (view.getUint8(payload + 4) << 24);
            return {
              width: (bits & 0x3fff) + 1,
              height: ((bits >>> 14) & 0x3fff) + 1,
              format: "webp"
            };
          }
          if (
            chunkId === "VP8 " &&
            chunkSize >= 10 &&
            view.getUint8(payload + 3) === 0x9d &&
            view.getUint8(payload + 4) === 0x01 &&
            view.getUint8(payload + 5) === 0x2a
          ) {
            return {
              width: view.getUint16(payload + 6, true) & 0x3fff,
              height: view.getUint16(payload + 8, true) & 0x3fff,
              format: "webp"
            };
          }

          offset = payload + chunkSize + (chunkSize % 2);
        }

        throw new Error("WEBP size chunk was not found.");
      }

      function parseTiffDimensions(view) {
        const byteOrder = readAscii(view, 0, 2);
        const littleEndian = byteOrder === "II";

        if (byteOrder !== "II" && byteOrder !== "MM") {
          throw new Error("TIFF byte order was not found.");
        }
        if (view.getUint16(2, littleEndian) !== 42) {
          throw new Error("TIFF magic number was not found.");
        }

        const ifdOffset = view.getUint32(4, littleEndian);
        if (ifdOffset + 2 > view.byteLength) {
          throw new Error("TIFF IFD offset is out of range.");
        }

        const entryCount = view.getUint16(ifdOffset, littleEndian);
        let width = 0;
        let height = 0;

        for (let index = 0; index < entryCount; index += 1) {
          const entryOffset = ifdOffset + 2 + index * 12;
          if (entryOffset + 12 > view.byteLength) {
            break;
          }

          const tag = view.getUint16(entryOffset, littleEndian);
          if (tag === 256 || tag === 257) {
            const value = readTiffInlineNumber(view, entryOffset, littleEndian);
            if (tag === 256) {
              width = value;
            } else {
              height = value;
            }
          }
        }

        if (width > 0 && height > 0) {
          return {
            width,
            height,
            format: "tiff"
          };
        }

        throw new Error("TIFF width/height tags were not found.");
      }

      function readTiffInlineNumber(view, entryOffset, littleEndian) {
        const type = view.getUint16(entryOffset + 2, littleEndian);

        if (type === 3) {
          return view.getUint16(entryOffset + 8, littleEndian);
        }
        if (type === 4) {
          return view.getUint32(entryOffset + 8, littleEndian);
        }

        return 0;
      }

      function readUint24LE(view, offset) {
        return view.getUint8(offset) |
          (view.getUint8(offset + 1) << 8) |
          (view.getUint8(offset + 2) << 16);
      }

      function readFourCC(view, offset) {
        return readAscii(view, offset, 4);
      }

      function readAscii(view, offset, length) {
        let output = "";

        for (let index = 0; index < length && offset + index < view.byteLength; index += 1) {
          output += String.fromCharCode(view.getUint8(offset + index));
        }

        return output;
      }

      async function readTextFile(file) {
        try {
          return await file.read({ format: storage.formats.utf8 });
        } catch (error) {
          return await file.read();
        }
      }

      async function writeTextFile(file, text) {
        try {
          await file.write(text, { format: storage.formats.utf8 });
        } catch (error) {
          await file.write(text);
        }
      }

      function parseJson(text, fileName) {
        try {
          return JSON.parse(String(text).replace(/^\uFEFF/, ""));
        } catch (error) {
          throw new Error(`Failed to parse JSON file ${fileName}: ${error}`);
        }
      }

      function executeProjectTransaction(project, name, buildActions) {
        let transactionOk = false;

        const execute = () => {
          transactionOk = project.executeTransaction((compoundAction) => {
            buildActions(compoundAction);
          }, name);
        };

        if (typeof project.lockedAccess === "function") {
          project.lockedAccess(execute);
        } else {
          execute();
        }

        if (!transactionOk) {
          throw new Error(`${name}: executeTransaction returned false.`);
        }

        return transactionOk;
      }

      function getNativePath(entry) {
        return entry && (entry.nativePath || entry.fsName || entry.path || "");
      }

      function dirname(path) {
        const normalized = String(path || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "");
        const index = normalized.lastIndexOf("/");
        if (index <= 0) {
          return "";
        }
        return normalized.slice(0, index);
      }

      function basename(pathOrName) {
        const text = String(pathOrName || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "");
        const index = text.lastIndexOf("/");
        return index >= 0 ? text.slice(index + 1) : text;
      }

      function extensionOf(pathOrName) {
        const match = String(pathOrName || "").replace(/\?.*$/, "").match(/\.([A-Za-z0-9]+)$/);
        return match ? match[1].toLowerCase() : "";
      }

      function normalizePath(path) {
        return String(path || "")
          .replace(/[\\/]+/g, "/")
          .replace(/\/+$/, "");
      }

      function normalizeRelativePath(path) {
        return normalizePath(path)
          .replace(/^[A-Za-z]:\//, "")
          .replace(/^\/+/, "")
          .split("/")
          .filter((part) => part && part !== ".")
          .join("/");
      }

      function joinNativePath(basePath, relPath) {
        const base = String(basePath || "").replace(/[\\/]+/g, "\\").replace(/[\\\/]+$/, "");
        const rel = normalizeRelativePath(relPath).replace(/\//g, "\\");
        if (!base) {
          return rel;
        }
        return rel ? `${base}\\${rel}` : base;
      }

      function samePath(left, right) {
        const leftPath = normalizePath(left);
        const rightPath = normalizePath(right);

        return leftPath === rightPath || leftPath.toLowerCase() === rightPath.toLowerCase();
      }

      function fileNameKey(value) {
        return basename(value).toLowerCase();
      }

      function formatSeconds(seconds) {
        return `${roundForLog(seconds)}s`;
      }

      function formatSignedSeconds(seconds) {
        const rounded = roundForLog(seconds);
        return `${rounded >= 0 ? "+" : ""}${rounded}s`;
      }

      function roundForLog(value) {
        return Math.round(Number(value) * 1000) / 1000;
      }

      function valueToString(value) {
        if (value === undefined || value === null) {
          return String(value);
        }
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
          return String(value);
        }
        if (typeof value.x === "number" && typeof value.y === "number") {
          return `[${roundForLog(value.x)}, ${roundForLog(value.y)}]`;
        }
        if (value.value !== undefined) {
          return valueToString(value.value);
        }
        if (typeof value.width === "number" && typeof value.height === "number") {
          return `${roundForLog(value.width)}x${roundForLog(value.height)}`;
        }
        return String(value);
      }

      function safe(value) {
        return value === undefined || value === null ? "" : String(value);
      }

      function wait(milliseconds) {
        return new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        });
      }

      function errorToString(error) {
        return error && error.stack ? error.stack : String(error);
      }

      function timestampForFileName() {
        const now = new Date();
        return String(now.getFullYear()) +
          pad2(now.getMonth() + 1) +
          pad2(now.getDate()) + "-" +
          pad2(now.getHours()) +
          pad2(now.getMinutes()) +
          pad2(now.getSeconds());
      }

      function pad2(value) {
        value = String(value);
        while (value.length < 2) {
          value = "0" + value;
        }
        return value;
      }

      const chooseMappingButton = optional$("chooseMappingButton");
      if (chooseMappingButton) {
        chooseMappingButton.addEventListener("click", chooseMappingFile);
      }

      const chooseWorkdirButton = optional$("chooseWorkdirButton");
      if (chooseWorkdirButton) {
        chooseWorkdirButton.addEventListener("click", chooseWorkdir);
      }

      const choosePortraitDirButton = optional$("choosePortraitDirButton");
      if (choosePortraitDirButton) {
        choosePortraitDirButton.addEventListener("click", choosePortraitDir);
      }

      const scanButton = optional$("scanButton");
      if (scanButton) {
        scanButton.addEventListener("click", scanOnly);
      }

      const runButton = optional$("runButton");
      if (runButton) {
        runButton.addEventListener("click", run);
      }

      const clearButton = optional$("clearButton");
      if (clearButton) {
        clearButton.addEventListener("click", () => {
          state.logLines = [];
          $("log").textContent = "";
          $("preview").textContent = "";
          setStatus("Idle");
        });
      }

      const saveLogButton = optional$("saveLogButton");
      if (saveLogButton) {
        saveLogButton.addEventListener("click", async () => {
        try {
          const file = await localFileSystem.getFileForSaving(
            `portrait-map-importer-${timestampForFileName()}.log`,
            { types: ["log", "txt"] }
          );

          if (!file) {
            return;
          }

          await writeTextFile(file, state.logLines.join("\n") + "\n");
          setStatus(`Saved log: ${getNativePath(file) || file.name}`);
        } catch (error) {
          setStatus("Failed to save log");
          log(errorToString(error));
        }
        });
      }

      renderState();

      app.setFeatureApi("portrait", {
        async importByRole(plan, routing) {
          if (!state.mapping) {
            throw new Error("Choose a mapping file first.");
          }
          if (!state.portraitDir || !state.portraitDirPath) {
            throw new Error("Choose a portrait dir first.");
          }

          const project = await ppro.Project.getActiveProject();
          if (!project) {
            throw new Error("No active project.");
          }

          const sequence = await project.getActiveSequence();
          if (!sequence) {
            throw new Error("No active sequence.");
          }

          const matches = await buildRolePlanPortraitMatches(plan);
          const groups = groupMatchesByRole(matches);
          let placedCount = 0;

          log("");
          log("Script: ForkTranslation Portrait Map Importer - Role Tracks");
          log(`Project: ${project.path || project.name || "(unsaved)"}`);
          log(`Sequence: ${safe(sequence.name)}`);

          for (const group of groups) {
            const route = routing[group.role];
            if (!route || !route.portraitTrack) {
              throw new Error(`No portrait track was configured for role: ${group.role}`);
            }

            const targetVideoTrack = await resolveTargetVideoTrack(sequence, route.portraitTrack);
            log(`Role ${group.role}: ${group.matches.length} portrait clip(s) -> ${targetVideoTrack.label}`);
            const result = await importAndPlacePortraits({
              project,
              sequence,
              targetVideoTrack,
              matches: group.matches
            });
            placedCount += result.placedCount;
            if (result.trimWarnings.length > 0) {
              log(`Warnings for ${group.role}:`);
              for (const warning of result.trimWarnings) {
                log(`  - ${warning}`);
              }
            }
          }

          const text = `Done. Placed ${placedCount} role-routed portrait clip(s).`;
          setStatus(text);
          log(text);

          return {
            placedCount
          };
        },
        getMapping() {
          if (!state.mapping) {
            throw new Error("Choose a mapping file first.");
          }

          return state.mapping;
        },
        getState() {
          return {
            mappingPath: state.mappingPath,
            workdirPath: state.workdirPath,
            portraitDirPath: state.portraitDirPath,
            mapping: state.mapping
          };
        }
      });

      async function buildRolePlanPortraitMatches(plan) {
        const matches = [];

        for (const row of plan.rows) {
          if (!Number.isFinite(Number(row.startSeconds)) || !Number.isFinite(Number(row.endSeconds))) {
            throw new Error("Audio must be imported by role before importing portraits by role.");
          }
          if (!row.portraitRelPath) {
            throw new Error(`Plan row ${row.cueId || row.order} has no portraitRelPath.`);
          }

          const resolved = await resolveRelativeFile(
            state.portraitDir,
            state.portraitDirPath,
            row.portraitRelPath
          );
          if (resolved.exists === false) {
            throw new Error(`Portrait file is missing under portrait dir: ${row.portraitRelPath}`);
          }

          matches.push({
            item: {
              order: row.order,
              role: row.role,
              portraitRelPath: row.portraitRelPath,
              portraitResolved: resolved
            },
            portraitPath: resolved.path,
            startTime: ppro.TickTime.createWithSeconds(row.startSeconds),
            endTime: ppro.TickTime.createWithSeconds(row.endSeconds),
            targetEndTime: ppro.TickTime.createWithSeconds(row.targetEndSeconds),
            startSeconds: row.startSeconds,
            endSeconds: row.endSeconds,
            targetEndSeconds: row.targetEndSeconds,
            durationSeconds: row.endSeconds - row.startSeconds
          });
        }

        return matches;
      }

      function groupMatchesByRole(matches) {
        const byRole = new Map();
        const groups = [];

        for (const match of matches) {
          const role = match.item.role || "unassigned";
          let group = byRole.get(role);
          if (!group) {
            group = {
              role,
              matches: []
            };
            byRole.set(role, group);
            groups.push(group);
          }
          group.matches.push(match);
        }

        return groups;
      }

    }
  });
})(globalThis.ForkTranslationWorkflow);
