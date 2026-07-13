#target premierepro

/*
  Apply a bottom-anchored height pulse to image-like clips on chosen video tracks.

  Premiere's intrinsic Motion component is available on every video clip. In
  practice, Motion is clip.components[1], and its common properties are:
  0 Position, 1 Scale / Scale Height, 2 Scale Width, 3 Uniform Scale,
  4 Rotation, 5 Anchor Point.

  This script prefers those indexes and writes a detailed log next to the
  project file, or to the user's Documents folder when the project is unsaved.
*/

(function () {
  var SCRIPT_NAME = "ForkTranslation Image Bottom Pulse";
  var SCRIPT_VERSION = "2026-07-14.3";
  var CURRENT_STEP = "startup";
  var LOG_LINES = [];

  var RECOVERY_SECONDS = 0.15;
  var HEIGHT_MULTIPLIER = 1.05;
  var KF_BEZIER = 5;
  var TICKS_PER_SECOND = 254016000000;

  var IMAGE_EXTENSIONS = {
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

  var VIDEO_EXTENSIONS = {
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

  function main() {
    setStep("reading active sequence");
    var sequence = getActiveSequence();
    var videoTracks = sequence.videoTracks;
    var trackCount = getCollectionCount(videoTracks);

    log("Script: " + SCRIPT_NAME);
    log("Version: " + SCRIPT_VERSION);
    log("Project: " + safeProjectPath());
    log("Sequence: " + safeString(sequence.name));
    log("Frame size: " + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical);
    log("Video track count: " + trackCount);

    if (trackCount < 1) {
      fail("The active sequence has no video tracks.");
    }

    setStep("asking for target tracks");
    var trackSpec = prompt(
      "Enter video track numbers to process.\n\n" +
        "Examples: 1   1,3   1-3   all\n" +
        "Premiere V1 is track 1.",
      "1",
      SCRIPT_NAME
    );

    if (trackSpec === null) {
      return;
    }

    var trackIndexes = parseTrackSpec(trackSpec, trackCount);
    if (trackIndexes.length === 0) {
      fail("No valid video tracks were selected.");
    }

    setStep("confirming changes");
    if (!confirm(
      SCRIPT_NAME + " " + SCRIPT_VERSION + "\n\n" +
        "This will process image-like clips on " + formatTrackNames(trackIndexes) + ".\n\n" +
        "The script skips clips with known video extensions, and tries clips " +
        "whose extension cannot be read because Premiere often hides still " +
        "image paths.\n\nContinue?",
      false,
      SCRIPT_NAME
    )) {
      return;
    }

    var summary = {
      tracks: trackIndexes.length,
      clipsSeen: 0,
      imagesSeen: 0,
      unknownSeen: 0,
      videosSkipped: 0,
      processed: 0,
      skipped: []
    };

    for (var i = 0; i < trackIndexes.length; i += 1) {
      setStep("processing V" + (trackIndexes[i] + 1));
      processTrack(sequence, videoTracks, trackIndexes[i], summary);
    }

    var logFile = writeLogFile();
    alert(buildSummary(summary, logFile), SCRIPT_NAME);
  }

  function processTrack(sequence, videoTracks, trackIndex, summary) {
    var track = getCollectionItem(videoTracks, trackIndex);
    if (!track || !track.clips) {
      summary.skipped.push("V" + (trackIndex + 1) + ": track is unavailable.");
      log("V" + (trackIndex + 1) + ": unavailable");
      return;
    }

    var clips = track.clips;
    var clipCount = getCollectionCount(clips);
    log("");
    log("V" + (trackIndex + 1) + " clip count: " + clipCount);

    for (var i = 0; i < clipCount; i += 1) {
      setStep("reading V" + (trackIndex + 1) + " clip " + (i + 1));
      var clip = getCollectionItem(clips, i);
      summary.clipsSeen += 1;

      if (!clip) {
        summary.skipped.push("V" + (trackIndex + 1) + " clip " + (i + 1) + ": unavailable.");
        log("  clip " + (i + 1) + ": unavailable");
        continue;
      }

      var label = clipLabel(clip);
      var mediaPath = mediaPathOf(clip);
      var classification = classifyClip(clip, mediaPath);
      log("  clip " + (i + 1) + ": " + label);
      log("    media: " + mediaPath);
      log("    class: " + classification);

      if (classification === "video") {
        summary.videosSkipped += 1;
        continue;
      }

      if (classification === "image") {
        summary.imagesSeen += 1;
      } else {
        summary.unknownSeen += 1;
      }

      try {
        setStep("applying pulse to " + label);
        applyBottomPulseToClip(sequence, clip);
        summary.processed += 1;
        log("    result: processed");
      } catch (error) {
        var formatted = formatError(error);
        summary.skipped.push("V" + (trackIndex + 1) + " / " + label + ": " + formatted);
        log("    result: skipped");
        log(indent(formatted, "      "));
      }
    }
  }

  function applyBottomPulseToClip(sequence, clip) {
    setStep("reading timing for " + clipLabel(clip));
    var startSeconds = timeToSeconds(clip.start);
    var endSeconds = timeToSeconds(clip.end);
    var duration = endSeconds - startSeconds;

    log("    start/end seconds: " + startSeconds + " / " + endSeconds);

    if (!isFiniteNumber(startSeconds) || !isFiniteNumber(endSeconds)) {
      fail("Could not read clip start/end.");
    }
    if (duration < RECOVERY_SECONDS) {
      fail("Clip is shorter than " + RECOVERY_SECONDS + "s.");
    }

    setStep("finding Motion component for " + clipLabel(clip));
    var motion = findMotionComponent(clip);
    if (!motion) {
      fail("Motion component was not found.");
    }

    log("    motion: " + componentSummary(motion));
    logComponentProperties(motion);

    setStep("finding Motion parameters for " + clipLabel(clip));
    var params = findMotionParams(motion);
    validateMotionParams(params);

    log("    selected position: " + paramSummary(params.position));
    log("    selected scale height: " + paramSummary(params.scaleHeight));
    log("    selected scale width: " + paramSummary(params.scaleWidth));
    log("    selected uniform scale: " + paramSummary(params.uniformScale));
    log("    selected anchor point: " + paramSummary(params.anchorPoint));

    setStep("turning off uniform scale for " + clipLabel(clip));
    turnOffUniformScale(params.uniformScale);

    var startRel = makeTime(0);
    var endRel = makeTime(RECOVERY_SECONDS);

    setStep("reading current Motion values for " + clipLabel(clip));
    var currentPosition = getParamValue(params.position, startRel);
    var currentAnchor = getParamValue(params.anchorPoint, startRel);
    var animatedStartScale = Number(getParamValue(params.scaleHeight, startRel));
    var baseScale = Number(getStaticParamValue(params.scaleHeight));
    var targetPosition = bottomCenterForSequence(currentPosition, sequence);
    var targetAnchor = bottomCenterForAnchor(currentAnchor);

    log("    current position: " + valueToString(currentPosition));
    log("    target position: " + valueToString(targetPosition));
    log("    current anchor: " + valueToString(currentAnchor));
    log("    target anchor: " + valueToString(targetAnchor));
    log("    animated start scale before rewrite: " + animatedStartScale);
    log("    static/base scale for rewrite: " + baseScale);

    if (!isFiniteNumber(baseScale)) {
      fail("Could not read height scale value.");
    }

    setStep("setting bottom-center position for " + clipLabel(clip));
    setStaticValue(params.position, targetPosition);
    setStep("setting bottom-center anchor point for " + clipLabel(clip));
    setStaticValue(params.anchorPoint, targetAnchor);

    if (params.scaleWidth) {
      setStep("preserving width scale for " + clipLabel(clip));
      setStaticValue(params.scaleWidth, getParamValue(params.scaleWidth, startRel));
    }

    setStep("adding height scale keys for " + clipLabel(clip));
    applyHeightPulse(params.scaleHeight, startRel, endRel, baseScale);
  }

  function applyHeightPulse(scaleParam, startRel, endRel, baseScale) {
    var targetScale = baseScale * HEIGHT_MULTIPLIER;
    var beforeKeys = keysSummary(scaleParam);

    log("    keys before: " + beforeKeys);
    log("    using clip-local key times: " + timeSummary(startRel) + ", " + timeSummary(endRel));

    scaleParam.setTimeVarying(true);
    removeKeyRange(scaleParam, startRel, endRel);
    addOrReplaceKey(scaleParam, startRel, targetScale);
    addOrReplaceKey(scaleParam, endRel, baseScale);
    setInterpolation(scaleParam, startRel, KF_BEZIER);
    setInterpolation(scaleParam, endRel, KF_BEZIER);

    log("    keys after write: " + keysSummary(scaleParam));
    log("    value at start key: " + valueToString(getValueAtKey(scaleParam, startRel)));
    log("    value at end key: " + valueToString(getValueAtKey(scaleParam, endRel)));
    log("    value at start time: " + valueToString(getParamValue(scaleParam, startRel)));
    log("    value at mid time: " + valueToString(getParamValue(scaleParam, makeTime(RECOVERY_SECONDS / 2))));
    log("    value at end time: " + valueToString(getParamValue(scaleParam, endRel)));

    if (!hasAtLeastTwoKeys(scaleParam)) {
      fail("Premiere reported success, but the Scale parameter still has fewer than two keys.");
    }
  }

  function findMotionComponent(clip) {
    var components = clip.components;
    var count = getCollectionCount(components);
    var indexed = getCollectionItem(components, 1);

    if (looksLikeMotionComponent(indexed)) {
      return indexed;
    }

    for (var i = 0; i < count; i += 1) {
      var component = getCollectionItem(components, i);
      var displayName = lower(component && component.displayName);
      var matchName = lower(component && component.matchName);

      if (contains(displayName, "motion") || contains(matchName, "motion")) {
        return component;
      }
    }

    for (i = 0; i < count; i += 1) {
      var fallback = getCollectionItem(components, i);
      if (looksLikeMotionComponent(fallback)) {
        return fallback;
      }
    }

    return null;
  }

  function looksLikeMotionComponent(component) {
    if (!component || !component.properties) {
      return false;
    }

    var properties = component.properties;
    return getCollectionCount(properties) >= 6 &&
      isVector2Param(getCollectionItem(properties, 0)) &&
      isNumericParam(getCollectionItem(properties, 1));
  }

  function findMotionParams(motion) {
    var properties = motion.properties;
    var params = {
      position: null,
      scaleHeight: null,
      scaleWidth: null,
      uniformScale: null,
      anchorPoint: null
    };

    params.position = isVector2Param(getCollectionItem(properties, 0)) ?
      getCollectionItem(properties, 0) :
      firstVectorParam(properties);
    params.scaleHeight = isNumericParam(getCollectionItem(properties, 1)) ?
      getCollectionItem(properties, 1) :
      firstNumericParam(properties);
    params.scaleWidth = isNumericParam(getCollectionItem(properties, 2)) ?
      getCollectionItem(properties, 2) :
      findNumericParamByName(properties, "width");
    params.uniformScale = getCollectionItem(properties, 3) || firstBooleanLikeParam(properties);
    params.anchorPoint = isVector2Param(getCollectionItem(properties, 5)) ?
      getCollectionItem(properties, 5) :
      lastVectorParam(properties);

    return params;
  }

  function validateMotionParams(params) {
    if (!params.position) {
      fail("Motion Position parameter was not found.");
    }
    if (!params.scaleHeight) {
      fail("Motion Scale parameter was not found.");
    }
    if (!params.anchorPoint) {
      fail("Motion Anchor Point parameter was not found.");
    }
    if (!supportsKeyframes(params.scaleHeight)) {
      fail("Motion Scale parameter does not report keyframe support.");
    }
  }

  function setStaticValue(param, value) {
    if (!param) {
      return;
    }

    try {
      if (param.isTimeVarying && param.isTimeVarying()) {
        param.setTimeVarying(false);
      }
    } catch (error) {
      log("      setTimeVarying(false) ignored: " + error);
    }

    var result = param.setValue(value, 1);
    log("      setValue(" + safeString(param.displayName) + ") -> " + result);
  }

  function turnOffUniformScale(param) {
    if (!param) {
      return;
    }

    var value;
    try {
      value = param.getValue();
      log("      uniform scale current: " + valueToString(value));
    } catch (error) {
      log("      could not read uniform scale: " + error);
      return;
    }

    try {
      if (typeof value === "boolean") {
        log("      uniform scale set false -> " + param.setValue(false, 1));
      } else if (isFiniteNumber(Number(value))) {
        log("      uniform scale set 0 -> " + param.setValue(0, 1));
      }
    } catch (ignored) {
      log("      could not turn off uniform scale: " + ignored);
    }
  }

  function addOrReplaceKey(param, time, value) {
    try {
      param.removeKey(time);
    } catch (ignoredRemove) {
      log("      removeKey ignored at " + timeSummary(time) + ": " + ignoredRemove);
    }

    try {
      var addResult = param.addKey(time);
      log("      addKey " + timeSummary(time) + " -> " + addResult);
    } catch (addError) {
      log("      addKey threw at " + timeSummary(time) + ": " + addError);
    }

    var setResult = param.setValueAtKey(time, value, 1);
    log("      setValueAtKey " + timeSummary(time) + " = " + value + " -> " + setResult);
  }

  function removeKeyRange(param, startTime, endTime) {
    try {
      var result = param.removeKeyRange(startTime, endTime);
      log("      removeKeyRange " + timeSummary(startTime) + "-" + timeSummary(endTime) + " -> " + result);
    } catch (error) {
      log("      removeKeyRange ignored: " + error);
    }
  }

  function setInterpolation(param, time, mode) {
    try {
      var result = param.setInterpolationTypeAtKey(time, mode, 1);
      log("      setInterpolation " + timeSummary(time) + " mode " + mode + " -> " + result);
    } catch (error) {
      log("      setInterpolation ignored at " + timeSummary(time) + ": " + error);
    }
  }

  function getParamValue(param, time) {
    if (!param) {
      return null;
    }

    try {
      if (time && param.getValueAtTime) {
        return param.getValueAtTime(time);
      }
    } catch (error) {
      log("      getValueAtTime ignored for " + safeString(param.displayName) + ": " + error);
    }

    return param.getValue();
  }

  function getValueAtKey(param, time) {
    if (!param || !param.getValueAtKey) {
      return null;
    }

    try {
      return param.getValueAtKey(time);
    } catch (error) {
      return "(getValueAtKey failed: " + error + ")";
    }
  }

  function getStaticParamValue(param) {
    if (!param || !param.getValue) {
      return null;
    }

    return param.getValue();
  }

  function classifyClip(clip, mediaPath) {
    var ext = extensionOf(mediaPath);

    if (!ext) {
      ext = extensionOf(clipLabel(clip));
    }

    if (IMAGE_EXTENSIONS[ext]) {
      return "image";
    }
    if (VIDEO_EXTENSIONS[ext]) {
      return "video";
    }
    return "unknown";
  }

  function mediaPathOf(clip) {
    try {
      if (clip.projectItem && clip.projectItem.getMediaPath) {
        return String(clip.projectItem.getMediaPath() || "");
      }
    } catch (error) {
      return "";
    }

    return "";
  }

  function extensionOf(pathOrName) {
    var text = String(pathOrName || "").replace(/\?.*$/, "");
    var match = text.match(/\.([A-Za-z0-9]+)(?:\s*)$/);
    if (!match) {
      return "";
    }
    return lower(match[1]);
  }

  function bottomCenterForSequence(currentPosition, sequence) {
    if (isVector2(currentPosition) && usesLargeCoordinate(currentPosition)) {
      return [Number(sequence.frameSizeHorizontal) / 2, Number(sequence.frameSizeVertical)];
    }

    return [0.5, 1.0];
  }

  function bottomCenterForAnchor(currentAnchor) {
    if (isVector2(currentAnchor) && usesLargeCoordinate(currentAnchor)) {
      return [Number(currentAnchor[0]), Number(currentAnchor[1]) * 2];
    }

    return [0.5, 1.0];
  }

  function usesLargeCoordinate(value) {
    return Math.abs(Number(value[0])) > 2 || Math.abs(Number(value[1])) > 2;
  }

  function supportsKeyframes(param) {
    if (!param || !param.areKeyframesSupported) {
      return false;
    }

    try {
      return param.areKeyframesSupported() === true;
    } catch (error) {
      return false;
    }
  }

  function keysContain(param, time) {
    var keys = getKeysArray(param);
    var target = timeToSeconds(time);

    for (var i = 0; i < keys.length; i += 1) {
      if (Math.abs(timeToSeconds(keys[i]) - target) < 0.002) {
        return true;
      }
    }

    return false;
  }

  function hasAtLeastTwoKeys(param) {
    return getKeysArray(param).length >= 2;
  }

  function getKeysArray(param) {
    if (!param || !param.getKeys) {
      return [];
    }

    try {
      var keys = param.getKeys();
      if (!keys || keys === 0) {
        return [];
      }
      if (Object.prototype.toString.call(keys) === "[object Array]") {
        return keys;
      }
      if (typeof keys.length === "number") {
        var result = [];
        for (var i = 0; i < keys.length; i += 1) {
          result.push(keys[i]);
        }
        return result;
      }
    } catch (error) {
      log("      getKeys failed: " + error);
    }

    return [];
  }

  function keysSummary(param) {
    var keys = getKeysArray(param);
    if (keys.length === 0) {
      return "none";
    }

    var parts = [];
    for (var i = 0; i < keys.length; i += 1) {
      parts.push(timeSummary(keys[i]));
    }
    return parts.join(", ");
  }

  function firstVectorParam(properties) {
    var count = getCollectionCount(properties);
    for (var i = 0; i < count; i += 1) {
      var param = getCollectionItem(properties, i);
      if (isVector2Param(param)) {
        return param;
      }
    }
    return null;
  }

  function lastVectorParam(properties) {
    var count = getCollectionCount(properties);
    var found = null;
    for (var i = 0; i < count; i += 1) {
      var param = getCollectionItem(properties, i);
      if (isVector2Param(param)) {
        found = param;
      }
    }
    return found;
  }

  function firstNumericParam(properties) {
    var count = getCollectionCount(properties);
    for (var i = 0; i < count; i += 1) {
      var param = getCollectionItem(properties, i);
      if (isNumericParam(param)) {
        return param;
      }
    }
    return null;
  }

  function findNumericParamByName(properties, needle) {
    var count = getCollectionCount(properties);
    for (var i = 0; i < count; i += 1) {
      var param = getCollectionItem(properties, i);
      if (param && contains(lower(param.displayName), lower(needle)) && isNumericParam(param)) {
        return param;
      }
    }
    return null;
  }

  function firstBooleanLikeParam(properties) {
    var count = getCollectionCount(properties);
    for (var i = 0; i < count; i += 1) {
      var param = getCollectionItem(properties, i);
      try {
        var value = param.getValue();
        if (typeof value === "boolean" || Number(value) === 0 || Number(value) === 1) {
          return param;
        }
      } catch (error) {
        // Keep scanning.
      }
    }
    return null;
  }

  function isNumericParam(param) {
    if (!param || !param.getValue) {
      return false;
    }

    try {
      return isFiniteNumber(Number(param.getValue()));
    } catch (error) {
      return false;
    }
  }

  function isVector2Param(param) {
    if (!param || !param.getValue) {
      return false;
    }

    try {
      return isVector2(param.getValue());
    } catch (error) {
      return false;
    }
  }

  function isVector2(value) {
    return value &&
      typeof value.length === "number" &&
      value.length >= 2 &&
      isFiniteNumber(Number(value[0])) &&
      isFiniteNumber(Number(value[1]));
  }

  function getActiveSequence() {
    if (!app || !app.project || !app.project.activeSequence) {
      fail("Open a Premiere Pro project and make a sequence active first.");
    }
    return app.project.activeSequence;
  }

  function getCollectionCount(collection) {
    if (!collection) {
      return 0;
    }
    if (isFiniteNumber(Number(collection.numItems))) {
      return Number(collection.numItems);
    }
    if (isFiniteNumber(Number(collection.numTracks))) {
      return Number(collection.numTracks);
    }
    if (isFiniteNumber(Number(collection.length))) {
      return Number(collection.length);
    }
    return 0;
  }

  function getCollectionItem(collection, index) {
    if (!collection) {
      return null;
    }
    try {
      return collection[index] || null;
    } catch (error) {
      return null;
    }
  }

  function parseTrackSpec(spec, maxTracks) {
    var text = trim(spec);
    var indexes = [];
    var seen = {};

    if (lower(text) === "all" || text === "*") {
      for (var allIndex = 0; allIndex < maxTracks; allIndex += 1) {
        indexes.push(allIndex);
      }
      return indexes;
    }

    var tokens = text.split(/[,\s]+/);
    for (var i = 0; i < tokens.length; i += 1) {
      var token = trim(tokens[i]);
      if (token.length === 0) {
        continue;
      }

      token = token.replace(/^v/i, "");
      var range = token.match(/^(\d+)-(\d+)$/);
      if (range) {
        addTrackRange(indexes, seen, Number(range[1]), Number(range[2]), maxTracks);
        continue;
      }

      var number = Number(token);
      if (isFiniteNumber(number)) {
        addTrackIndex(indexes, seen, number, maxTracks);
        continue;
      }

      fail("Invalid track token: " + token);
    }

    return indexes;
  }

  function addTrackRange(indexes, seen, start, end, maxTracks) {
    if (start > end) {
      var temp = start;
      start = end;
      end = temp;
    }

    for (var number = start; number <= end; number += 1) {
      addTrackIndex(indexes, seen, number, maxTracks);
    }
  }

  function addTrackIndex(indexes, seen, trackNumber, maxTracks) {
    if (Math.floor(trackNumber) !== trackNumber || trackNumber < 1 || trackNumber > maxTracks) {
      fail("Track " + trackNumber + " is out of range. Available: 1-" + maxTracks + ".");
    }

    var index = trackNumber - 1;
    if (!seen[index]) {
      indexes.push(index);
      seen[index] = true;
    }
  }

  function makeTime(seconds) {
    var time = new Time();
    time.ticks = String(Math.round(seconds * TICKS_PER_SECOND));
    return time;
  }

  function timeToSeconds(time) {
    if (time && isFiniteNumber(Number(time.seconds))) {
      return Number(time.seconds);
    }
    return NaN;
  }

  function writeLogFile() {
    var folder = logFolder();
    var file = new File(folder.fsName + "/forktranslation-image-bottom-pulse-" + timestampForFileName() + ".log");
    file.encoding = "UTF-8";

    if (file.open("w")) {
      file.write(LOG_LINES.join("\r\n"));
      file.close();
      return file;
    }

    return null;
  }

  function logFolder() {
    try {
      if (app.project && app.project.path) {
        var projectFile = new File(app.project.path);
        if (projectFile.parent && projectFile.parent.exists) {
          return projectFile.parent;
        }
      }
    } catch (error) {
      // Fall through.
    }

    if (Folder.myDocuments && Folder.myDocuments.exists) {
      return Folder.myDocuments;
    }
    return Folder.desktop;
  }

  function logComponentProperties(component) {
    var properties = component.properties;
    var count = getCollectionCount(properties);
    log("    motion property count: " + count);

    for (var i = 0; i < count; i += 1) {
      log("      [" + i + "] " + paramSummary(getCollectionItem(properties, i)));
    }
  }

  function componentSummary(component) {
    if (!component) {
      return "(none)";
    }

    return safeString(component.displayName) +
      " matchName=" +
      safeString(component.matchName) +
      " props=" +
      getCollectionCount(component.properties);
  }

  function paramSummary(param) {
    if (!param) {
      return "(none)";
    }

    var parts = [safeString(param.displayName)];

    try {
      parts.push("value=" + valueToString(param.getValue()));
    } catch (error) {
      parts.push("value=(unreadable)");
    }

    try {
      parts.push("keys=" + keysSummary(param));
    } catch (ignored) {
      parts.push("keys=(unreadable)");
    }

    try {
      parts.push("supportsKeys=" + param.areKeyframesSupported());
    } catch (ignored2) {
      parts.push("supportsKeys=(unknown)");
    }

    return parts.join(" ");
  }

  function buildSummary(summary, logFile) {
    var text =
      "Done.\n\n" +
      "Version: " + SCRIPT_VERSION +
      "Tracks selected: " + summary.tracks +
      "\nClips scanned: " + summary.clipsSeen +
      "\nImage clips found: " + summary.imagesSeen +
      "\nUnknown-extension clips tried: " + summary.unknownSeen +
      "\nKnown video clips skipped: " + summary.videosSkipped +
      "\nClips processed: " + summary.processed;

    if (logFile) {
      text += "\n\nLog:\n" + logFile.fsName;
    }

    if (summary.skipped.length > 0) {
      text += "\n\nSkipped / warnings:\n" + summary.skipped.slice(0, 8).join("\n");
      if (summary.skipped.length > 8) {
        text += "\n...and " + (summary.skipped.length - 8) + " more. See log.";
      }
    }

    return text;
  }

  function safeProjectPath() {
    try {
      return String(app.project.path || "");
    } catch (error) {
      return "";
    }
  }

  function clipLabel(clip) {
    try {
      if (clip && clip.name) {
        return String(clip.name);
      }
    } catch (error) {
      // Fall through.
    }
    return "unnamed clip";
  }

  function valueToString(value) {
    if (value === null || value === undefined) {
      return String(value);
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value.length === "number") {
      var parts = [];
      for (var i = 0; i < value.length; i += 1) {
        parts.push(String(value[i]));
      }
      return "[" + parts.join(", ") + "]";
    }
    return String(value);
  }

  function timeSummary(time) {
    return timeToSeconds(time).toFixed(6) + "s";
  }

  function formatTrackNames(trackIndexes) {
    var names = [];
    for (var i = 0; i < trackIndexes.length; i += 1) {
      names.push("V" + (trackIndexes[i] + 1));
    }
    return names.join(", ");
  }

  function timestampForFileName() {
    var now = new Date();
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

  function indent(text, prefix) {
    return prefix + String(text).replace(/\n/g, "\n" + prefix);
  }

  function log(message) {
    LOG_LINES.push(String(message));
  }

  function setStep(step) {
    CURRENT_STEP = step;
  }

  function formatError(error) {
    var message = error && error.message ? String(error.message) : String(error);

    if (CURRENT_STEP) {
      message += "\n\nStep: " + CURRENT_STEP;
    }
    if (error && error.line) {
      message += "\nLine: " + error.line;
    }
    if (error && error.fileName) {
      message += "\nFile: " + error.fileName;
    }

    return message;
  }

  function safeString(value) {
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  }

  function contains(haystack, needle) {
    return String(haystack || "").indexOf(String(needle || "")) >= 0;
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function trim(value) {
    return String(value || "").replace(/^\s+/, "").replace(/\s+$/, "");
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function fail(message) {
    throw new Error(message);
  }

  try {
    main();
  } catch (error) {
    var logFile = writeLogFile();
    var details = formatError(error);
    if (logFile) {
      details += "\n\nLog:\n" + logFile.fsName;
    }
    alert(SCRIPT_NAME + " failed:\n\n" + details, SCRIPT_NAME);
  }
}());
