/* global require */

(function registerImageBottomPulse(app) {
  if (!app) {
    throw new Error("ForkTranslation workflow app shell is missing.");
  }

  app.registerFeature("pulse", {
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

      const VIDEO_EXTENSIONS = {
        avi: true,
        m2ts: true,
        m4v: true,
        mkv: true,
        mov: true,
        mp4: true,
        mpeg: true,
        mpg: true,
        mts: true,
        mxf: true,
        r3d: true,
        webm: true,
        wmv: true
      };

      const state = {
        busy: false,
        logLines: []
      };

      function $(elementId) {
        return app.$("pulse", elementId);
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
        $("runButton").disabled = busy;
      }

      async function run() {
        if (state.busy) {
          return;
        }

        setBusy(true);
        setStatus("正在运行");

        try {
          const options = readOptions();
          const project = await ppro.Project.getActiveProject();

          if (!project) {
            throw new Error("No active project.");
          }

          const sequence = await project.getActiveSequence();

          if (!sequence) {
            throw new Error("No active sequence.");
          }

          const trackCount = await sequence.getVideoTrackCount();
          const frameSize = await sequence.getFrameSize();
          const trackIndexes = parseTrackSpec(options.trackSpec, trackCount);
          const summary = {
            clipsSeen: 0,
            imagesSeen: 0,
            unknownSeen: 0,
            videosSkipped: 0,
            processed: 0,
            skipped: 0
          };

          log("");
          log("Script: ForkTranslation Image Bottom Pulse UXP");
          log(`Project: ${project.path || project.name || "(unsaved)"}`);
          log(`Sequence: ${safe(sequence.name)}`);
          log(`Frame size: ${valueToString(frameSize)}`);
          log(`Video track count: ${trackCount}`);
          log(`Track spec: ${options.trackSpec}`);
          log(`Selected tracks: ${trackIndexes.map((index) => `V${index + 1}`).join(", ")}`);
          log(`Base scale override: ${options.baseScaleOverride === null ? "auto" : options.baseScaleOverride}`);
          log(`Height multiplier: ${options.heightMultiplier}`);
          log(`Pulse duration seconds: ${options.pulseSeconds}`);
          log(`Rate curve: cubic-bezier(${options.curve.join(", ")})`);
          log(`Curve samples: ${options.curveSamples}`);

          for (const trackIndex of trackIndexes) {
            await processTrack(project, sequence, trackIndex, frameSize, options, summary);
          }

          const text =
            `Done. Processed ${summary.processed} clip(s). ` +
            `Images: ${summary.imagesSeen}, unknown tried: ${summary.unknownSeen}, ` +
            `videos skipped: ${summary.videosSkipped}, skipped: ${summary.skipped}.`;
          setStatus(
            `完成。处理 ${summary.processed} 个片段，` +
              `跳过 ${summary.skipped + summary.videosSkipped} 个。`
          );
          log(text);
        } catch (error) {
          const message = error && error.stack ? error.stack : String(error);
          setStatus("运行失败");
          log(message);
        } finally {
          setBusy(false);
        }
      }

      function readOptions() {
        const heightMultiplier = parsePositiveNumber($("heightMultiplier").value, "Start height");
        const pulseSeconds = parsePositiveSeconds($("pulseSeconds").value, "Pulse duration");
        const baseText = $("baseScale").value.trim();
        const baseScaleOverride = baseText.length > 0 ? parsePositiveNumber(baseText, "Base scale") : null;
        const curve = parseCurveSpec($("curveSpec").value.trim());
        const curveSamples = parsePositiveNumber($("curveSamples").value, "Curve samples");

        if (!Number.isFinite(curveSamples) || Math.floor(curveSamples) !== curveSamples || curveSamples < 2 || curveSamples > 30) {
          throw new Error("Curve samples must be an integer from 2 to 30.");
        }

        return {
          trackSpec: $("trackSpec").value.trim(),
          heightMultiplier,
          pulseSeconds,
          baseScaleOverride,
          curve,
          curveSamples,
          tryUnknown: $("tryUnknown").checked
        };
      }

      function parsePositiveSeconds(value, label) {
        const seconds = parsePositiveNumber(value, label);

        return seconds;
      }

      function parsePositiveNumber(value, label) {
        const text = String(value || "").trim().replace(",", ".");
        const number = Number(text);

        if (!Number.isFinite(number) || number <= 0) {
          throw new Error(`${label} must be a positive number.`);
        }

        return number;
      }

      async function processTrack(project, sequence, trackIndex, frameSize, options, summary) {
        const track = await sequence.getVideoTrack(trackIndex);
        const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);

        log("");
        log(`V${trackIndex + 1} clip count: ${clips.length}`);

        for (let i = 0; i < clips.length; i += 1) {
          const clip = clips[i];
          const name = await clip.getName();
          const mediaPath = await getMediaPath(clip);
          const classification = classifyClip(name, mediaPath);
          summary.clipsSeen += 1;

          log(`  clip ${i + 1}: ${name}`);
          log(`    media: ${mediaPath}`);
          log(`    class: ${classification}`);

          if (classification === "video") {
            summary.videosSkipped += 1;
            continue;
          }
          if (classification === "unknown" && !options.tryUnknown) {
            summary.skipped += 1;
            log("    result: skipped unknown-extension clip");
            continue;
          }
          if (classification === "image") {
            summary.imagesSeen += 1;
          } else {
            summary.unknownSeen += 1;
          }

          try {
            await applyPulse(project, sequence, clip, frameSize, options);
            summary.processed += 1;
            log("    result: processed");
          } catch (error) {
            summary.skipped += 1;
            log(`    result: skipped: ${error && error.message ? error.message : error}`);
          }
        }
      }

      async function applyPulse(project, sequence, clip, frameSize, options) {
        const start = await clip.getStartTime();
        const end = await clip.getEndTime();
        const inPoint = await getClipInPoint(clip);
        const duration = end.subtract(start);

        log(`    start/end seconds: ${start.seconds} / ${end.seconds}`);
        log(`    clip in point seconds: ${inPoint.seconds}`);

        if (duration.seconds < options.pulseSeconds) {
          throw new Error(`Clip is shorter than ${options.pulseSeconds}s.`);
        }

        const chain = await clip.getComponentChain();
        const motion = findMotionComponent(chain);
        const params = getMotionParams(motion);
        const localStartTime = ppro.TickTime.createWithSeconds(0);
        const localEndTime = ppro.TickTime.createWithSeconds(options.pulseSeconds);
        const startTime = addTickTimes(localStartTime, inPoint);
        const endTime = addTickTimes(localEndTime, inPoint);
        const midpoint = addTickTimes(ppro.TickTime.createWithSeconds(options.pulseSeconds / 2), inPoint);
        const beforeKeys = keyList(params.scaleHeight);
        const positionValue = await params.position.getValueAtTime(startTime);
        const anchorValue = await params.anchorPoint.getValueAtTime(startTime);
        const widthValue = await params.scaleWidth.getValueAtTime(startTime);
        const uniformValue = await params.uniformScale.getValueAtTime(startTime);
        const baseScale = await resolveBaseScale(params.scaleHeight, endTime, options.baseScaleOverride);
        const targetScale = baseScale * options.heightMultiplier;
        const positionTarget = bottomCenterPoint(positionValue, frameSize);
        const anchorTarget = bottomCenterPoint(anchorValue, frameSize);
        const removeTimes = keyTimesInRanges(params.scaleHeight, [
          { start: -0.001, end: options.pulseSeconds + 0.001 },
          { start: inPoint.seconds - 0.001, end: inPoint.seconds + options.pulseSeconds + 0.001 }
        ]);
        const scaleKeyframes = buildScaleCurveKeyframes(
          inPoint,
          options.pulseSeconds,
          targetScale,
          baseScale,
          options.curve,
          options.curveSamples
        );

        log(`    motion: ${await motion.getDisplayName()} matchName=${await motion.getMatchName()} props=${motion.getParamCount()}`);
        log(`    key times local/actual: 0s/${startTime.seconds}s, ${options.pulseSeconds}s/${endTime.seconds}s`);
        log(`    position: ${params.position.displayName} ${valueToString(positionValue)} -> ${valueToString(positionTarget)}`);
        log(`    anchor: ${params.anchorPoint.displayName} ${valueToString(anchorValue)} -> ${valueToString(anchorTarget)}`);
        log(`    width scale: ${params.scaleWidth.displayName} ${valueToString(widthValue)}`);
        log(`    uniform scale: ${params.uniformScale.displayName} ${valueToString(uniformValue)} -> false`);
        log(`    keys before: ${beforeKeys}`);
        log(`    keys to remove: ${removeTimes.length ? removeTimes.map((time) => `${time.seconds.toFixed(6)}s`).join(", ") : "none"}`);
        log(`    base scale: ${baseScale}`);
        log(`    target scale: ${targetScale}`);
        log(`    sampled scale curve: ${scaleKeyframes.map((key) => `${key.localSeconds.toFixed(4)}s=${roundForLog(key.value)}`).join(", ")}`);

        await ensureKeyframeSupport(params.scaleHeight);

        setScaleHeightKeys(
          project,
          params.scaleHeight,
          scaleKeyframes,
          removeTimes
        );
        trySetInterpolation(project, params.scaleHeight, scaleKeyframes.map((key) => key.time));
        trySetStaticValue(project, params.position, positionTarget, "Position");
        trySetStaticValue(project, params.anchorPoint, anchorTarget, "Anchor Point");
        trySetStaticValue(project, params.scaleWidth, numberFromValue(widthValue), "Scale Width");
        trySetStaticValue(project, params.uniformScale, false, "Uniform Scale");

        log(`    keys after: ${keyList(params.scaleHeight)}`);
        log(`    value at start: ${valueToString(await params.scaleHeight.getValueAtTime(startTime))}`);
        log(`    value at mid: ${valueToString(await params.scaleHeight.getValueAtTime(midpoint))}`);
        log(`    value at end: ${valueToString(await params.scaleHeight.getValueAtTime(endTime))}`);

        await sequence.setPlayerPosition(start);
      }

      function findMotionComponent(chain) {
        const count = chain.getComponentCount();
        const indexed = count > 1 ? chain.getComponentAtIndex(1) : null;

        if (indexed && looksLikeMotion(indexed)) {
          return indexed;
        }

        for (let i = 0; i < count; i += 1) {
          const component = chain.getComponentAtIndex(i);
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

      function setStaticValue(project, param, value, label) {
        executeProjectTransaction(project, `Set ${label}`, (compoundAction) => {
          compoundAction.addAction(param.createSetTimeVaryingAction(false));
          compoundAction.addAction(param.createSetValueAction(param.createKeyframe(value), true));
        });
        log(`    set ${label}: ok`);
      }

      function trySetStaticValue(project, param, value, label) {
        try {
          setStaticValue(project, param, value, label);
          return true;
        } catch (error) {
          log(`    set ${label}: skipped: ${error && error.message ? error.message : error}`);
          return false;
        }
      }

      function setScaleHeightKeys(project, param, keyframes, removeTimes) {
        executeProjectTransaction(project, "Set Scale Height keyframes", (compoundAction) => {
          compoundAction.addAction(param.createSetTimeVaryingAction(true));

          for (const time of removeTimes) {
            compoundAction.addAction(param.createRemoveKeyframeAction(time, true));
          }

          for (const keyframe of keyframes) {
            compoundAction.addAction(createAddKeyframeAction(param, keyframe.time, keyframe.value));
          }
        });
        log("    set Scale Height keyframes: ok");
      }

      function trySetInterpolation(project, param, keyTimes) {
        try {
          executeProjectTransaction(project, "Set Scale Height interpolation", (compoundAction) => {
            for (const keyTime of keyTimes) {
              compoundAction.addAction(param.createSetInterpolationAtKeyframeAction(keyTime, bezierMode(), true));
            }
          });
          log("    set interpolation: ok");
        } catch (error) {
          log(`    set interpolation: skipped: ${error && error.message ? error.message : error}`);
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

      function createAddKeyframeAction(param, time, value) {
        const keyframe = param.createKeyframe(value);
        keyframe.position = time;
        return param.createAddKeyframeAction(keyframe);
      }

      function buildScaleCurveKeyframes(inPoint, pulseSeconds, targetScale, baseScale, curve, samples) {
        const keyframes = [];

        for (let index = 0; index <= samples; index += 1) {
          const progress = index / samples;
          const localSeconds = pulseSeconds * progress;
          const eased = cubicBezierYForX(progress, curve[0], curve[1], curve[2], curve[3]);
          const value = targetScale + (baseScale - targetScale) * eased;

          keyframes.push({
            localSeconds,
            time: addTickTimes(ppro.TickTime.createWithSeconds(localSeconds), inPoint),
            value
          });
        }

        return keyframes;
      }

      async function ensureKeyframeSupport(param) {
        const supported = await param.areKeyframesSupported();
        if (!supported) {
          throw new Error(`${param.displayName} does not support keyframes.`);
        }
      }

      async function resolveBaseScale(param, endTime, override) {
        if (override !== null) {
          return override;
        }

        const endKeyValue = keyValueAt(param, endTime);
        if (Number.isFinite(endKeyValue)) {
          return endKeyValue;
        }

        const endTimeValue = numberFromValue(await param.getValueAtTime(endTime));
        if (Number.isFinite(endTimeValue)) {
          return endTimeValue;
        }

        const startValue = await param.getStartValue();
        return numberFromValue(startValue.value.value);
      }

      function keyValueAt(param, time) {
        const keys = param.getKeyframeListAsTickTimes();

        for (const keyTime of keys) {
          if (Math.abs(keyTime.seconds - time.seconds) < 0.002) {
            try {
              const keyframe = param.getKeyframePtr(keyTime);
              return numberFromValue(keyframe.value.value);
            } catch (error) {
              return NaN;
            }
          }
        }

        return NaN;
      }

      function keyList(param) {
        const keys = param.getKeyframeListAsTickTimes();

        if (!keys || keys.length === 0) {
          return "none";
        }

        return keys.map((time) => `${time.seconds.toFixed(6)}s`).join(", ");
      }

      function keyTimesInRanges(param, ranges) {
        const keys = param.getKeyframeListAsTickTimes();
        const selected = [];

        if (!keys || keys.length === 0) {
          return selected;
        }

        for (const key of keys) {
          for (const range of ranges) {
            if (key.seconds >= range.start && key.seconds <= range.end) {
              selected.push(key);
              break;
            }
          }
        }

        return selected;
      }

      function parseCurveSpec(text) {
        const source = text || "0.19,1,0.22,1";
        const parts = source.split(/[,\s]+/).filter(Boolean).map(Number);

        if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
          throw new Error("Rate curve must be four numbers: x1,y1,x2,y2.");
        }

        if (parts[0] < 0 || parts[0] > 1 || parts[2] < 0 || parts[2] > 1) {
          throw new Error("Rate curve x1 and x2 must be between 0 and 1.");
        }

        return parts;
      }

      function cubicBezierYForX(x, x1, y1, x2, y2) {
        if (x <= 0) {
          return 0;
        }
        if (x >= 1) {
          return 1;
        }

        let t = x;
        for (let i = 0; i < 8; i += 1) {
          const currentX = cubicBezierValue(t, x1, x2);
          const slope = cubicBezierSlope(t, x1, x2);

          if (Math.abs(currentX - x) < 0.000001) {
            return clamp01(cubicBezierValue(t, y1, y2));
          }
          if (Math.abs(slope) < 0.000001) {
            break;
          }

          t -= (currentX - x) / slope;
          if (t < 0 || t > 1) {
            break;
          }
        }

        let lo = 0;
        let hi = 1;
        t = x;

        for (let i = 0; i < 16; i += 1) {
          const currentX = cubicBezierValue(t, x1, x2);
          if (Math.abs(currentX - x) < 0.000001) {
            break;
          }
          if (currentX < x) {
            lo = t;
          } else {
            hi = t;
          }
          t = (lo + hi) / 2;
        }

        return clamp01(cubicBezierValue(t, y1, y2));
      }

      function cubicBezierValue(t, p1, p2) {
        const inv = 1 - t;
        return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
      }

      function cubicBezierSlope(t, p1, p2) {
        return 3 * (1 - t) * (1 - t) * p1 +
          6 * (1 - t) * t * (p2 - p1) +
          3 * t * t * (1 - p2);
      }

      function clamp01(value) {
        return Math.max(0, Math.min(1, value));
      }

      function roundForLog(value) {
        return Math.round(Number(value) * 10000) / 10000;
      }

      function bottomCenterPoint(currentValue, frameSize) {
        const point = pointFromValue(currentValue);

        if (point && (Math.abs(point.x) > 2 || Math.abs(point.y) > 2)) {
          return ppro.PointF(Number(frameSize.width) / 2, Number(frameSize.height));
        }

        return ppro.PointF(0.5, 1);
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

      async function getMediaPath(clip) {
        try {
          const projectItem = await clip.getProjectItem();
          const clipProjectItem = ppro.ClipProjectItem.cast(projectItem);
          return await clipProjectItem.getMediaFilePath();
        } catch (error) {
          return "";
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

      function addTickTimes(left, right) {
        if (left && typeof left.add === "function") {
          return left.add(right);
        }

        return ppro.TickTime.createWithSeconds(Number(left.seconds) + Number(right.seconds));
      }

      function classifyClip(name, mediaPath) {
        const ext = extensionOf(mediaPath) || extensionOf(name);

        if (IMAGE_EXTENSIONS[ext]) {
          return "image";
        }
        if (VIDEO_EXTENSIONS[ext]) {
          return "video";
        }
        return "unknown";
      }

      function extensionOf(pathOrName) {
        const match = String(pathOrName || "").replace(/\?.*$/, "").match(/\.([A-Za-z0-9]+)$/);
        return match ? match[1].toLowerCase() : "";
      }

      function parseTrackSpec(spec, maxTracks) {
        const text = String(spec || "").trim();
        const indexes = [];
        const seen = {};

        if (text.toLowerCase() === "all" || text === "*") {
          for (let i = 0; i < maxTracks; i += 1) {
            indexes.push(i);
          }
          return indexes;
        }

        for (const rawToken of text.split(/[,\s]+/)) {
          const token = rawToken.trim();
          if (!token) {
            continue;
          }

          const range = token.match(/^v?(\d+)-v?(\d+)$/i);
          if (range) {
            addTrackRange(indexes, seen, Number(range[1]), Number(range[2]), maxTracks);
            continue;
          }

          const single = token.match(/^v?(\d+)$/i);
          if (single) {
            addTrackIndex(indexes, seen, Number(single[1]), maxTracks);
            continue;
          }

          throw new Error(`Invalid track token: ${token}`);
        }

        if (indexes.length === 0) {
          throw new Error("No valid video tracks were selected.");
        }

        return indexes;
      }

      function addTrackRange(indexes, seen, start, end, maxTracks) {
        const from = Math.min(start, end);
        const to = Math.max(start, end);

        for (let number = from; number <= to; number += 1) {
          addTrackIndex(indexes, seen, number, maxTracks);
        }
      }

      function addTrackIndex(indexes, seen, trackNumber, maxTracks) {
        if (Math.floor(trackNumber) !== trackNumber || trackNumber < 1 || trackNumber > maxTracks) {
          throw new Error(`Track V${trackNumber} is out of range. Available: V1-V${maxTracks}.`);
        }

        const index = trackNumber - 1;
        if (!seen[index]) {
          indexes.push(index);
          seen[index] = true;
        }
      }

      function bezierMode() {
        if (ppro.Constants && ppro.Constants.InterpolationMode && ppro.Constants.InterpolationMode.BEZIER !== undefined) {
          return ppro.Constants.InterpolationMode.BEZIER;
        }
        if (ppro.Keyframe && ppro.Keyframe.INTERPOLATION_MODE_BEZIER !== undefined) {
          return ppro.Keyframe.INTERPOLATION_MODE_BEZIER;
        }
        return 5;
      }

      function valueToString(value) {
        if (value === undefined || value === null) {
          return String(value);
        }
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
          return String(value);
        }
        if (typeof value.x === "number" && typeof value.y === "number") {
          return `[${value.x}, ${value.y}]`;
        }
        if (value.value !== undefined) {
          return valueToString(value.value);
        }
        if (typeof value.width === "number" && typeof value.height === "number") {
          return `${value.width}x${value.height}`;
        }
        return String(value);
      }

      function safe(value) {
        return value === undefined || value === null ? "" : String(value);
      }

      $("runButton").addEventListener("click", run);
      $("clearButton").addEventListener("click", () => {
        state.logLines = [];
        $("log").textContent = "";
        setStatus("待机");
      });

      $("saveLogButton").addEventListener("click", async () => {
        try {
          const file = await localFileSystem.getFileForSaving(
            `image-bottom-pulse-${timestampForFileName()}.log`,
            { types: ["log", "txt"] }
          );

          if (!file) {
            return;
          }

          const text = state.logLines.join("\n") + "\n";
          try {
            await file.write(text, { format: storage.formats.utf8 });
          } catch (error) {
            await file.write(text);
          }
          setStatus(`日志已保存：${file.nativePath || file.name}`);
        } catch (error) {
          setStatus("保存日志失败");
          log(error && error.stack ? error.stack : String(error));
        }
      });

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

    }
  });
})(globalThis.ForkTranslationWorkflow);
