#target premierepro

/*
  Import ForkTranslation D JSON subtitles into the active Premiere Pro sequence.

  Workflow:
  1. Choose a pr-subtitles-D.json file.
  2. Read ordered cues from data.cues[].order and data.cues[].lines.
  3. Read timeline markers from the active sequence.
  4. Ask how many cues are already imported. The default comes from the
     sidecar state file created by the previous successful run.
  5. Generate an SRT where cue N spans marker N to marker N+1.
  6. Import the SRT and create a Subtitle caption track when the current
     Premiere version exposes sequence.createCaptionTrack().

  Premiere ExtendScript can create a caption track from an SRT, but cannot delete
  or clear existing caption tracks, and cannot inspect existing caption items.
  Delete the old caption track manually before continuing if you need replacement
  instead of an additional track.

  Premiere Pro 2022 does not expose sequence.createCaptionTrack(). In that
  version, this script falls back to generating and importing the SRT into the
  Project panel; create the caption track from that SRT manually.
*/

(function () {
  var SCRIPT_NAME = "ForkTranslation PR Subtitle Import";

  function main() {
    var sequence = getActiveSequence();
    var canCreateCaptionTrack = hasCaptionTrackCreation(sequence);

    var jsonFile = File.openDialog(
      "Select pr-subtitles-D.json",
      "JSON files:*.json,All files:*.*",
      false
    );

    if (!jsonFile) {
      return;
    }

    var data = parseJsonFile(jsonFile);
    var cues = getOrderedCues(data);
    var markers = getSequenceMarkers(sequence);
    var markerCoveredCueCount = markers.length - 1;

    if (markerCoveredCueCount < 1) {
      fail(
        "The active sequence has " + markers.length + " marker(s). " +
          "At least 2 markers are needed for 1 subtitle cue."
      );
    }

    var usableCueCount = Math.min(cues.length, markerCoveredCueCount);
    var stateFile = buildStateFile(jsonFile);
    var state = readImportState(stateFile);
    var alreadyImportedCount = askAlreadyImportedCount(
      state,
      cues.length,
      usableCueCount,
      markerCoveredCueCount
    );
    var importCount = usableCueCount - alreadyImportedCount;

    if (importCount < 1) {
      alert(
        "Nothing to import.\n\n" +
          "Already imported cue count: " + alreadyImportedCount + "\n" +
          "Markers currently cover cue count: " + usableCueCount + "\n\n" +
          "Add more timeline markers, or enter a smaller already-imported " +
          "count if you want to regenerate an earlier range."
      );
      return;
    }

    var intervalProblems = validateMarkerIntervals(
      markers,
      alreadyImportedCount,
      importCount
    );
    if (intervalProblems.length > 0) {
      fail(intervalProblems.join("\n"));
    }

    var rangeStartOrder = alreadyImportedCount + 1;
    var rangeEndOrder = alreadyImportedCount + importCount;
    var srtText = buildSrt(cues, markers, alreadyImportedCount, importCount);
    var srtFile = buildSrtFile(jsonFile, rangeStartOrder, rangeEndOrder);
    writeUtf8File(srtFile, srtText);

    var missingMarkers = Math.max(0, cues.length + 1 - markers.length);
    var remainingCues = cues.length - rangeEndOrder;
    var extraMarkers = Math.max(0, markers.length - (cues.length + 1));
    var proceedMessage =
      "Prepared cue order " + rangeStartOrder + "-" + rangeEndOrder +
      " (" + importCount + " cue(s)).\n\n" +
      "Temporary SRT:\n" + srtFile.fsName + "\n\n";

    if (canCreateCaptionTrack) {
      proceedMessage +=
        "Important: Premiere ExtendScript cannot delete or clear existing " +
        "caption tracks, cannot inspect existing caption items, and cannot " +
        "append to an existing caption track. Click OK to add this range as " +
        "another Subtitle track.";
    } else {
      proceedMessage +=
        "This Premiere version does not expose sequence.createCaptionTrack(). " +
        "Click OK to generate the SRT and import it into the Project panel. " +
        "Then create the caption track from the SRT manually in Premiere.";
    }

    if (missingMarkers > 0) {
      proceedMessage += "\n\nMarker shortage: " + missingMarkers +
        " more marker(s) are needed to cover all " + cues.length +
        " cue(s). This run will stop at order " + rangeEndOrder + ".";
    }

    if (remainingCues > 0) {
      proceedMessage += "\n\nRemaining cue(s) after this run: " + remainingCues +
        ".";
    }

    if (extraMarkers > 0) {
      proceedMessage += "\n\n" + extraMarkers + " extra marker(s) at the end " +
        "will be ignored.";
    }

    if (!confirm(proceedMessage)) {
      return;
    }

    if (!canCreateCaptionTrack) {
      importFileToProjectPanel(srtFile);

      var shouldAdvanceState = confirm(
        "Generated and imported the SRT into the Project panel:\n" +
          srtFile.fsName + "\n\n" +
          "Premiere did not expose sequence.createCaptionTrack(), so the " +
          "caption track was not created automatically.\n\n" +
          "After you manually create/import this SRT as captions in Premiere, " +
          "click OK to advance the import state to cue order " +
          rangeEndOrder + ".\n\n" +
          "Click Cancel to leave the state file unchanged."
      );

      if (shouldAdvanceState) {
        writeSuccessfulImportState(
          stateFile,
          jsonFile,
          sequence,
          cues.length,
          markers.length,
          rangeStartOrder,
          rangeEndOrder,
          srtFile
        );
      }

      alert(
        "Done.\n\nGenerated SRT for cue order " +
          rangeStartOrder + "-" + rangeEndOrder + ".\n\n" +
          "Automatic caption-track creation is unavailable in this " +
          "Premiere version.\n\nSRT source:\n" + srtFile.fsName +
          "\n\nState " + (shouldAdvanceState ? "updated" : "not updated") +
          "."
      );
      return;
    }

    var captionProjectItem = importCaptionFile(srtFile);
    var created = createSubtitleCaptionTrack(sequence, captionProjectItem);

    if (!created) {
      fail("Premiere did not create the caption track.");
    }

    writeSuccessfulImportState(
      stateFile,
      jsonFile,
      sequence,
      cues.length,
      markers.length,
      rangeStartOrder,
      rangeEndOrder,
      srtFile
    );

    alert(
      "Done.\n\nCreated a Subtitle caption track for cue order " +
        rangeStartOrder + "-" + rangeEndOrder + ".\n\n" +
        "Next run will default to already imported count " + rangeEndOrder +
        ".\n\nSRT source:\n" + srtFile.fsName + "\n\nState:\n" +
        stateFile.fsName
    );
  }

  function writeSuccessfulImportState(
    stateFile,
    jsonFile,
    sequence,
    totalCueCount,
    markerCount,
    rangeStartOrder,
    rangeEndOrder,
    srtFile
  ) {
    writeImportState(stateFile, {
      schema: "fork-pr-subtitles-premiere-import-state/v1",
      sourceJsonPath: jsonFile.fsName,
      sequenceName: sequence.name ? String(sequence.name) : "",
      sequenceID: sequence.sequenceID ? String(sequence.sequenceID) : "",
      totalCueCount: totalCueCount,
      markerCount: markerCount,
      lastImportedOrder: rangeEndOrder,
      lastImportedRangeStart: rangeStartOrder,
      lastImportedRangeEnd: rangeEndOrder,
      lastSrtPath: srtFile.fsName,
      updatedAt: formatIsoLikeLocalTime(new Date())
    });
  }

  function getActiveSequence() {
    if (!app || !app.project || !app.project.activeSequence) {
      fail("Open a Premiere Pro project and make a sequence active first.");
    }
    return app.project.activeSequence;
  }

  function hasCaptionTrackCreation(sequence) {
    return !!sequence && typeof sequence.createCaptionTrack === "function";
  }

  function parseJsonFile(file) {
    var text = readTextFile(file);
    try {
      if (typeof JSON !== "undefined" && JSON.parse) {
        return JSON.parse(text);
      }
      return eval("(" + text + ")");
    } catch (error) {
      fail("Failed to parse JSON:\n" + error);
    }
    return null;
  }

  function readTextFile(file) {
    file.encoding = "UTF-8";
    if (!file.open("r")) {
      fail("Could not open JSON file:\n" + file.fsName);
    }

    var text = file.read();
    file.close();

    return String(text).replace(/^\uFEFF/, "");
  }

  function getOrderedCues(data) {
    if (!data || !isArray(data.cues)) {
      fail("JSON must contain a cues array.");
    }

    if (data.cues.length === 0) {
      fail("JSON cues array is empty.");
    }

    if (data.schema && data.schema !== "fork-pr-subtitles-d/v1") {
      if (!confirm(
        "Unexpected schema: " + data.schema + "\n\nContinue anyway?"
      )) {
        fail("Import cancelled because schema was not fork-pr-subtitles-d/v1.");
      }
    }

    var byOrder = {};
    var i;

    for (i = 0; i < data.cues.length; i += 1) {
      var cue = data.cues[i];
      var order = Number(cue.order);

      if (!isFiniteNumber(order) || order < 1 || Math.floor(order) !== order) {
        fail("Cue at index " + i + " has an invalid order value.");
      }

      if (byOrder[order]) {
        fail("Duplicate cue order: " + order);
      }

      byOrder[order] = {
        order: order,
        id: cue.id ? String(cue.id) : "order " + order,
        lines: extractCueLines(cue)
      };
    }

    var ordered = [];
    for (i = 1; i <= data.cues.length; i += 1) {
      if (!byOrder[i]) {
        fail("Missing cue with order " + i + ".");
      }
      ordered.push(byOrder[i]);
    }

    return ordered;
  }

  function extractCueLines(cue) {
    var lines = [];
    var i;

    if (cue && isArray(cue.lines)) {
      for (i = 0; i < cue.lines.length; i += 1) {
        addSubtitleLine(lines, cue.lines[i]);
      }
    } else if (cue && (cue.line1 || cue.line2)) {
      addSubtitleLine(lines, cue.line1);
      addSubtitleLine(lines, cue.line2);
    } else if (cue && cue.text) {
      addSubtitleLine(lines, cue.text);
    }

    if (lines.length === 0) {
      fail("Cue " + (cue && cue.id ? cue.id : "") + " has no subtitle lines.");
    }

    return lines;
  }

  function addSubtitleLine(lines, value) {
    if (value === undefined || value === null) {
      return;
    }

    var text = String(value).replace(/^\uFEFF/, "");
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    var parts = text.split("\n");
    for (var i = 0; i < parts.length; i += 1) {
      var part = trim(parts[i]);
      if (part.length > 0) {
        lines.push(part);
      }
    }
  }

  function getSequenceMarkers(sequence) {
    if (!sequence.markers || sequence.markers.numMarkers < 1) {
      fail("The active sequence has no timeline markers.");
    }

    var collection = sequence.markers;
    var marker = collection.getFirstMarker();
    var markers = [];

    while (marker) {
      markers.push({
        seconds: timeToSeconds(marker.start),
        name: marker.name ? String(marker.name) : ""
      });
      marker = collection.getNextMarker(marker);
    }

    markers.sort(function (a, b) {
      return a.seconds - b.seconds;
    });

    return markers;
  }

  function timeToSeconds(time) {
    if (!time || !isFiniteNumber(Number(time.seconds))) {
      fail("Could not read marker time in seconds.");
    }
    return Number(time.seconds);
  }

  function askAlreadyImportedCount(
    state,
    totalCueCount,
    usableCueCount,
    markerCoveredCueCount
  ) {
    var defaultCount = 0;
    var stateNote = "No previous state file was found.";

    if (state && isFiniteNumber(Number(state.lastImportedOrder))) {
      defaultCount = Number(state.lastImportedOrder);
      if (defaultCount < 0) {
        defaultCount = 0;
      }
      if (defaultCount > totalCueCount) {
        defaultCount = totalCueCount;
      }

      stateNote =
        "Previous state suggests " + defaultCount +
        " already imported cue(s).";
      if (state.sequenceName) {
        stateNote += "\nState sequence: " + state.sequenceName;
      }
      if (state.sequenceID) {
        stateNote += "\nState sequence ID: " + state.sequenceID;
      }
    }

    var markerNote = "Timeline markers cover " + markerCoveredCueCount +
      " cue interval(s).";

    if (usableCueCount < totalCueCount) {
      markerNote += "\nOnly cue order 1-" + usableCueCount +
        " can be imported until more markers are added.";
    }

    var answer = prompt(
      stateNote + "\n\n" + markerNote + "\n\n" +
        "Enter how many cues are already present in the timeline.\n" +
        "Use 0 to import from order 1.",
      String(defaultCount)
    );

    if (answer === null) {
      fail("Import cancelled.");
    }

    var count = Number(trim(answer));
    if (!isFiniteNumber(count) || Math.floor(count) !== count || count < 0) {
      fail("Already imported cue count must be a non-negative integer.");
    }

    if (count > totalCueCount) {
      fail(
        "Already imported cue count cannot exceed total cue count " +
          totalCueCount + "."
      );
    }

    if (count > usableCueCount) {
      fail(
        "Already imported cue count is " + count + ", but the current " +
          "markers only cover " + usableCueCount + " cue interval(s). " +
          "Add more markers or enter a smaller count."
      );
    }

    return count;
  }

  function validateMarkerIntervals(markers, startCueIndex, cueCount) {
    var problems = [];

    for (var i = 0; i < cueCount; i += 1) {
      var markerIndex = startCueIndex + i;
      var start = markers[markerIndex].seconds;
      var end = markers[markerIndex + 1].seconds;

      if (end <= start) {
        problems.push(
          "Marker interval for cue order " + (markerIndex + 1) +
            " is not positive: " +
            formatSecondsForMessage(start) + " -> " +
            formatSecondsForMessage(end) + "."
        );
      }
    }

    return problems;
  }

  function buildSrt(cues, markers, startCueIndex, cueCount) {
    var parts = [];

    for (var i = 0; i < cueCount; i += 1) {
      var cueIndex = startCueIndex + i;
      parts.push(String(i + 1));
      parts.push(formatSrtTime(markers[cueIndex].seconds) + " --> " +
        formatSrtTime(markers[cueIndex + 1].seconds));
      parts.push(cues[cueIndex].lines.join("\r\n"));
      parts.push("");
    }

    return parts.join("\r\n");
  }

  function buildSrtFile(jsonFile, rangeStartOrder, rangeEndOrder) {
    var stem = String(jsonFile.name).replace(/\.json$/i, "");
    stem = stem.replace(/[\\\/:*?"<>|]/g, "_");

    var fileName = stem + "-premiere-C" + pad4(rangeStartOrder) + "-C" +
      pad4(rangeEndOrder) + "-" + timestampForFileName() + ".srt";
    return new File(jsonFile.parent.fsName + "/" + fileName);
  }

  function buildStateFile(jsonFile) {
    var stem = String(jsonFile.name).replace(/\.json$/i, "");
    stem = stem.replace(/[\\\/:*?"<>|]/g, "_");
    return new File(jsonFile.parent.fsName + "/" + stem + "-premiere-state.json");
  }

  function readImportState(file) {
    if (!file.exists) {
      return null;
    }

    try {
      return parseJsonFile(file);
    } catch (error) {
      if (!confirm(
        "Could not read previous import state:\n" + file.fsName +
          "\n\n" + error.message + "\n\nContinue with default 0?"
      )) {
        fail("Import cancelled because state file could not be read.");
      }
    }

    return null;
  }

  function writeImportState(file, state) {
    var json;

    try {
      json = JSON.stringify(state, null, 2);
    } catch (error) {
      fail("Could not serialize import state:\n" + error);
    }

    writeUtf8File(file, json + "\n");
  }

  function writeUtf8File(file, text) {
    file.encoding = "UTF-8";

    if (!file.open("w")) {
      fail("Could not write SRT file:\n" + file.fsName);
    }

    file.write("\uFEFF" + text);
    file.close();
  }

  function importCaptionFile(file) {
    importFileToProjectPanel(file);

    var item = findProjectItemByMediaPath(file.fsName);
    if (!item) {
      fail("Imported SRT was not found in the project panel:\n" + file.fsName);
    }

    return item;
  }

  function importFileToProjectPanel(file) {
    var imported = app.project.importFiles(
      [file.fsName],
      true,
      app.project.rootItem,
      false
    );

    if (!imported) {
      fail("Premiere failed to import the generated SRT:\n" + file.fsName);
    }
  }

  function findProjectItemByMediaPath(mediaPath) {
    try {
      if (app.project.rootItem.findItemsMatchingMediaPath) {
        var matches = app.project.rootItem.findItemsMatchingMediaPath(
          mediaPath,
          1
        );

        if (matches && matches.length > 0) {
          return matches[0];
        }
      }
    } catch (error) {
      // Fall back to a recursive scan below.
    }

    return findProjectItemByMediaPathRecursive(
      app.project.rootItem,
      normalizePathForCompare(mediaPath)
    );
  }

  function findProjectItemByMediaPathRecursive(container, normalizedPath) {
    if (!container || !container.children) {
      return null;
    }

    var children = container.children;
    for (var i = 0; i < children.numItems; i += 1) {
      var child = children[i];

      try {
        if (child.getMediaPath) {
          var itemPath = normalizePathForCompare(child.getMediaPath());
          if (itemPath === normalizedPath) {
            return child;
          }
        }
      } catch (error) {
        // Some project items do not have atomic media paths.
      }

      var nested = findProjectItemByMediaPathRecursive(child, normalizedPath);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  function createSubtitleCaptionTrack(sequence, projectItem) {
    try {
      if (
        typeof Sequence !== "undefined" &&
        Sequence.CAPTION_FORMAT_SUBTITLE !== undefined
      ) {
        return sequence.createCaptionTrack(
          projectItem,
          0,
          Sequence.CAPTION_FORMAT_SUBTITLE
        );
      }
    } catch (error) {
      // Fall back to the default caption format below.
    }

    return sequence.createCaptionTrack(projectItem, 0);
  }

  function formatSrtTime(seconds) {
    var totalMs = Math.round(seconds * 1000);
    if (totalMs < 0) {
      totalMs = 0;
    }

    var hours = Math.floor(totalMs / 3600000);
    totalMs -= hours * 3600000;
    var minutes = Math.floor(totalMs / 60000);
    totalMs -= minutes * 60000;
    var wholeSeconds = Math.floor(totalMs / 1000);
    var millis = totalMs - wholeSeconds * 1000;

    return pad2(hours) + ":" + pad2(minutes) + ":" +
      pad2(wholeSeconds) + "," + pad3(millis);
  }

  function formatSecondsForMessage(seconds) {
    return formatSrtTime(seconds).replace(",", ".");
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

  function pad3(value) {
    value = String(value);
    while (value.length < 3) {
      value = "0" + value;
    }
    return value;
  }

  function pad4(value) {
    value = String(value);
    while (value.length < 4) {
      value = "0" + value;
    }
    return value;
  }

  function formatIsoLikeLocalTime(date) {
    return String(date.getFullYear()) + "-" +
      pad2(date.getMonth() + 1) + "-" +
      pad2(date.getDate()) + "T" +
      pad2(date.getHours()) + ":" +
      pad2(date.getMinutes()) + ":" +
      pad2(date.getSeconds());
  }

  function trim(value) {
    return String(value).replace(/^\s+/, "").replace(/\s+$/, "");
  }

  function normalizePathForCompare(path) {
    var normalized = String(path || "").replace(/\\/g, "/");

    if ($.os && String($.os).toLowerCase().indexOf("windows") >= 0) {
      normalized = normalized.toLowerCase();
    }

    return normalized;
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
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
    alert(SCRIPT_NAME + " failed:\n\n" + error.message);
  }
}());
