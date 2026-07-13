const premiere = require("premierepro");
const { entrypoints, storage } = require("uxp");

const localFileSystem = storage.localFileSystem;
const CLIP_TRACK_ITEM_TYPE = 1;

entrypoints.setup({
  commands: {
    generateIncrementalSrt: runCommand
  }
});

async function runCommand() {
  try {
    const project = await premiere.Project.getActiveProject();
    if (!project) {
      throw new Error("Open a Premiere Pro project first.");
    }

    const sequence = await project.getActiveSequence();
    if (!sequence) {
      throw new Error("Make a sequence active first.");
    }

    const jsonFile = await localFileSystem.getFileForOpening({
      allowMultiple: false,
      types: ["json"]
    });
    if (!jsonFile) {
      return;
    }

    const data = parseJson(await readTextFile(jsonFile), jsonFile.name);
    const cues = getOrderedCues(data);
    const markers = await getSequenceMarkers(sequence);
    const captionStats = await getCaptionStats(sequence);

    const markerCoveredCueCount = Math.max(0, markers.length - 1);
    if (markerCoveredCueCount < 1) {
      throw new Error(
        "The active sequence has " + markers.length +
          " marker(s). At least 2 markers are needed for 1 subtitle cue."
      );
    }

    const usableCueCount = Math.min(cues.length, markerCoveredCueCount);
    const alreadyImportedCount = captionStats.itemCount;

    if (alreadyImportedCount > usableCueCount) {
      throw new Error(
        "Existing caption item count is " + alreadyImportedCount +
          ", but current markers only cover " + usableCueCount +
          " cue interval(s). Add more markers or remove unrelated caption " +
          "tracks before generating an incremental SRT."
      );
    }

    const importCount = usableCueCount - alreadyImportedCount;
    if (importCount < 1) {
      await showMessage(
        "Nothing to generate.\n\n" +
          "Detected caption tracks: " + captionStats.trackCount + "\n" +
          "Detected caption items: " + alreadyImportedCount + "\n" +
          "Markers currently cover cue count: " + usableCueCount
      );
      return;
    }

    validateMarkerIntervals(markers, alreadyImportedCount, importCount);

    const rangeStartOrder = alreadyImportedCount + 1;
    const rangeEndOrder = alreadyImportedCount + importCount;
    const srtText = buildSrt(cues, markers, alreadyImportedCount, importCount);
    const suggestedName = buildSrtFileName(
      jsonFile.name,
      rangeStartOrder,
      rangeEndOrder
    );

    const srtFile = await localFileSystem.getFileForSaving(suggestedName, {
      types: ["srt"]
    });
    if (!srtFile) {
      return;
    }

    await writeTextFile(srtFile, "\uFEFF" + srtText);

    let importedToProject = false;
    const srtPath = getNativePath(srtFile);
    if (srtPath) {
      const rootItem = await project.getRootItem();
      importedToProject = await project.importFiles(
        [srtPath],
        true,
        rootItem,
        false
      );
    }

    await showMessage(
      "Generated cue order " + rangeStartOrder + "-" + rangeEndOrder +
        " (" + importCount + " cue(s)).\n\n" +
        "Detected caption tracks: " + captionStats.trackCount + "\n" +
        "Detected existing caption items: " + alreadyImportedCount + "\n" +
        "Timeline markers: " + markers.length + "\n" +
        "SRT: " + (srtPath || srtFile.name) + "\n" +
        "Imported to Project panel: " + (importedToProject ? "yes" : "no") +
        "\n\nCurrent public UXP APIs can read caption tracks/items, but do " +
        "not expose create/delete/clear/append caption-track operations. " +
        "Create the Subtitle track from the generated SRT manually unless " +
        "Adobe adds those APIs in a future Premiere build."
    );
  } catch (error) {
    await showMessage(
      "ForkTranslation PR Subtitles failed:\n\n" +
        (error && error.message ? error.message : String(error))
    );
  }
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
    throw new Error("Failed to parse JSON file " + fileName + ":\n" + error);
  }
}

function getOrderedCues(data) {
  if (!data || !Array.isArray(data.cues)) {
    throw new Error("JSON must contain a cues array.");
  }

  if (data.cues.length === 0) {
    throw new Error("JSON cues array is empty.");
  }

  const byOrder = new Map();
  for (let index = 0; index < data.cues.length; index += 1) {
    const cue = data.cues[index];
    const order = Number(cue && cue.order);

    if (!Number.isFinite(order) || order < 1 || Math.floor(order) !== order) {
      throw new Error("Cue at index " + index + " has an invalid order value.");
    }

    if (byOrder.has(order)) {
      throw new Error("Duplicate cue order: " + order);
    }

    byOrder.set(order, {
      order: order,
      id: cue.id ? String(cue.id) : "order " + order,
      lines: extractCueLines(cue)
    });
  }

  const ordered = [];
  for (let order = 1; order <= data.cues.length; order += 1) {
    if (!byOrder.has(order)) {
      throw new Error("Missing cue with order " + order + ".");
    }
    ordered.push(byOrder.get(order));
  }

  return ordered;
}

function extractCueLines(cue) {
  const lines = [];

  if (cue && Array.isArray(cue.lines)) {
    for (const line of cue.lines) {
      addSubtitleLine(lines, line);
    }
  } else if (cue && (cue.line1 || cue.line2)) {
    addSubtitleLine(lines, cue.line1);
    addSubtitleLine(lines, cue.line2);
  } else if (cue && cue.text) {
    addSubtitleLine(lines, cue.text);
  }

  if (lines.length === 0) {
    throw new Error("Cue " + (cue && cue.id ? cue.id : "") + " has no lines.");
  }

  return lines;
}

function addSubtitleLine(lines, value) {
  if (value === undefined || value === null) {
    return;
  }

  const parts = String(value)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      lines.push(trimmed);
    }
  }
}

async function getSequenceMarkers(sequence) {
  if (!premiere.Markers || typeof premiere.Markers.getMarkers !== "function") {
    throw new Error("premiere.Markers.getMarkers() is unavailable.");
  }

  const markerCollection = await premiere.Markers.getMarkers(sequence);
  const markerItems = await markerCollection.getMarkers([]);
  const markers = [];

  for (const marker of markerItems) {
    const start = await marker.getStart();
    if (!start || !Number.isFinite(Number(start.seconds))) {
      throw new Error("Could not read marker start time.");
    }

    markers.push({
      seconds: Number(start.seconds),
      name: marker.getName ? await marker.getName() : ""
    });
  }

  markers.sort((a, b) => a.seconds - b.seconds);
  return markers;
}

async function getCaptionStats(sequence) {
  const stats = {
    trackCount: 0,
    itemCount: 0,
    perTrack: []
  };

  if (typeof sequence.getCaptionTrackCount !== "function") {
    return stats;
  }

  stats.trackCount = Number(await sequence.getCaptionTrackCount()) || 0;

  for (let index = 0; index < stats.trackCount; index += 1) {
    const track = await sequence.getCaptionTrack(index);
    const items = await getCaptionTrackItems(track);

    stats.perTrack.push({
      index: index,
      name: track && track.name ? String(track.name) : "",
      itemCount: items.length
    });
    stats.itemCount += items.length;
  }

  return stats;
}

async function getCaptionTrackItems(track) {
  if (!track || typeof track.getTrackItems !== "function") {
    return [];
  }

  try {
    const items = await track.getTrackItems(getClipTrackItemType(), false);
    return Array.isArray(items) ? items : [];
  } catch (firstError) {
    const items = await track.getTrackItems(CLIP_TRACK_ITEM_TYPE, false);
    return Array.isArray(items) ? items : [];
  }
}

function getClipTrackItemType() {
  try {
    if (
      premiere.Constants &&
      premiere.Constants.TrackItemType &&
      premiere.Constants.TrackItemType.CLIP !== undefined
    ) {
      return premiere.Constants.TrackItemType.CLIP;
    }
  } catch (error) {
    // Fall back below.
  }

  return CLIP_TRACK_ITEM_TYPE;
}

function validateMarkerIntervals(markers, startCueIndex, cueCount) {
  for (let index = 0; index < cueCount; index += 1) {
    const markerIndex = startCueIndex + index;
    const start = markers[markerIndex].seconds;
    const end = markers[markerIndex + 1].seconds;

    if (end <= start) {
      throw new Error(
        "Marker interval for cue order " + (markerIndex + 1) +
          " is not positive: " + formatSrtTime(start) + " -> " +
          formatSrtTime(end) + "."
      );
    }
  }
}

function buildSrt(cues, markers, startCueIndex, cueCount) {
  const parts = [];

  for (let index = 0; index < cueCount; index += 1) {
    const cueIndex = startCueIndex + index;
    parts.push(String(index + 1));
    parts.push(
      formatSrtTime(markers[cueIndex].seconds) + " --> " +
        formatSrtTime(markers[cueIndex + 1].seconds)
    );
    parts.push(cues[cueIndex].lines.join("\r\n"));
    parts.push("");
  }

  return parts.join("\r\n");
}

function buildSrtFileName(jsonFileName, rangeStartOrder, rangeEndOrder) {
  const stem = String(jsonFileName || "pr-subtitles-D")
    .replace(/\.json$/i, "")
    .replace(/[\\/:*?"<>|]/g, "_");

  return stem + "-premiere-C" + pad4(rangeStartOrder) + "-C" +
    pad4(rangeEndOrder) + "-" + timestampForFileName() + ".srt";
}

function formatSrtTime(seconds) {
  let totalMs = Math.round(seconds * 1000);
  if (totalMs < 0) {
    totalMs = 0;
  }

  const hours = Math.floor(totalMs / 3600000);
  totalMs -= hours * 3600000;
  const minutes = Math.floor(totalMs / 60000);
  totalMs -= minutes * 60000;
  const wholeSeconds = Math.floor(totalMs / 1000);
  const millis = totalMs - wholeSeconds * 1000;

  return pad2(hours) + ":" + pad2(minutes) + ":" +
    pad2(wholeSeconds) + "," + pad3(millis);
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

function getNativePath(file) {
  return file && (file.nativePath || file.fsName || file.path || "");
}

async function showMessage(message) {
  console.log(message);
  if (typeof alert === "function") {
    try {
      alert(message);
      return;
    } catch (error) {
      // Premiere UXP does not fully support alert/confirm/prompt yet.
    }
  }
}
