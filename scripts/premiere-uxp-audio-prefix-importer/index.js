/* global require */

const ppro = require("premierepro");
const { storage } = require("uxp");
const localFileSystem = storage.localFileSystem;

const AUDIO_FILE_PATTERN = /^(\d+)-.+\.wav$/i;

const state = {
  busy: false,
  folder: null,
  files: [],
  logLines: []
};

function $(id) {
  return document.getElementById(id);
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
  $("chooseFolderButton").disabled = busy;
  $("rescanButton").disabled = busy;
  $("runButton").disabled = busy;
  $("saveLogButton").disabled = busy;
}

async function chooseFolder() {
  if (state.busy) {
    return;
  }

  try {
    const folder = await localFileSystem.getFolder();
    if (!folder) {
      return;
    }

    state.folder = folder;
    state.files = await scanAudioFolder(folder);
    renderFolderState();
    setStatus(`Matched ${state.files.length} WAV file(s).`);
  } catch (error) {
    setStatus("Failed to choose folder");
    log(errorToString(error));
  }
}

async function rescanFolder() {
  if (state.busy) {
    return;
  }
  if (!state.folder) {
    await chooseFolder();
    return;
  }

  try {
    state.files = await scanAudioFolder(state.folder);
    renderFolderState();
    setStatus(`Matched ${state.files.length} WAV file(s).`);
  } catch (error) {
    setStatus("Failed to rescan folder");
    log(errorToString(error));
  }
}

async function run() {
  if (state.busy) {
    return;
  }

  setBusy(true);
  setStatus("Running");

  try {
    const options = readOptions();
    if (!state.folder) {
      throw new Error("Choose a folder first.");
    }

    state.files = await scanAudioFolder(state.folder);
    renderFolderState();
    if (state.files.length === 0) {
      throw new Error("No files matching number-*.wav were found.");
    }

    const project = await ppro.Project.getActiveProject();
    if (!project) {
      throw new Error("No active project.");
    }

    const sequence = await project.getActiveSequence();
    if (!sequence) {
      throw new Error("No active sequence.");
    }

    const startTime = await getSequencePlayerPosition(sequence);
    const target = await resolveTargetAudioTrack(sequence, options.trackSpec);

    log("");
    log("Script: ForkTranslation Audio Prefix Importer");
    log(`Project: ${project.path || project.name || "(unsaved)"}`);
    log(`Sequence: ${safe(sequence.name)}`);
    log(`Folder: ${getNativePath(state.folder) || state.folder.name}`);
    log(`Files: ${state.files.length}`);
    log(`Start: ${formatSeconds(startTime.seconds)}`);
    log(`Gap seconds: ${options.intervalSeconds}`);
    log(`Target audio track: ${target.label}`);

    const importPaths = state.files.map((file) => file.path);
    const rootItem = await project.getRootItem();
    const imported = await project.importFiles(importPaths, true, rootItem, false);
    if (!imported) {
      throw new Error("Project.importFiles returned false.");
    }
    log(`Imported or refreshed ${importPaths.length} file(s) in the Project panel.`);

    const projectItems = await resolveProjectItemsForFiles(project, state.files);
    const placements = await buildPlacements(projectItems, startTime, options.intervalSeconds);

    for (const placement of placements.items) {
      log(
        `  ${placement.file.name}: start ${formatSeconds(placement.startSeconds)}, ` +
          `duration ${formatSeconds(placement.durationSeconds)}, ` +
          `end ${formatSeconds(placement.endSeconds)}`
      );
    }
    log(`  final marker: ${formatSeconds(placements.finalMarkerSeconds)}`);

    const timelineResult = await insertAudioAndMarkers(project, sequence, placements, target, options);
    log(
      `Timeline check: ${timelineResult.trackLabel} has ` +
        `${timelineResult.clipCount} clip item(s) after placement.`
    );
    log(`Timeline strategy used: ${timelineResult.strategy}.`);

    if (timelineResult.clipCount < placements.items.length) {
      throw new Error(
        `Premiere accepted the action, but ${timelineResult.trackLabel} has only ` +
          `${timelineResult.clipCount} clip item(s); expected ${placements.items.length}.`
      );
    }

    try {
      await sequence.setPlayerPosition(startTime);
    } catch (error) {
      log(`Could not restore playhead: ${error && error.message ? error.message : error}`);
    }

    const text =
      `Done. Placed ${placements.items.length} audio file(s) to ${target.label}; ` +
      `created ${placements.items.length + 1} marker(s).`;
    setStatus(text);
    log(text);
  } catch (error) {
    setStatus("Failed");
    log(errorToString(error));
  } finally {
    setBusy(false);
  }
}

function readOptions() {
  return {
    intervalSeconds: parseNonNegativeSeconds($("intervalSeconds").value, "Gap seconds"),
    trackSpec: $("audioTrackSpec").value.trim() || "auto"
  };
}

function parseNonNegativeSeconds(value, label) {
  const text = String(value || "").trim().replace(",", ".");
  const number = Number(text);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return number;
}

async function scanAudioFolder(folder) {
  const entries = await folder.getEntries();
  const files = [];

  for (const entry of entries) {
    if (entry.isFolder) {
      continue;
    }

    const match = String(entry.name || "").match(AUDIO_FILE_PATTERN);
    if (!match) {
      continue;
    }

    const path = getNativePath(entry);
    if (!path) {
      throw new Error(`Could not read native path for ${entry.name}.`);
    }

    files.push({
      entry,
      name: entry.name,
      path,
      prefix: Number(match[1]),
      prefixText: match[1]
    });
  }

  files.sort((left, right) => {
    if (left.prefix !== right.prefix) {
      return left.prefix - right.prefix;
    }
    return left.name.localeCompare(right.name);
  });

  return files;
}

function renderFolderState() {
  $("folderPath").textContent = state.folder
    ? getNativePath(state.folder) || state.folder.name
    : "No folder selected";

  if (!state.files.length) {
    $("filePreview").textContent = "No files matching number-*.wav";
    return;
  }

  const preview = state.files.slice(0, 80).map((file, index) => {
    return `${index + 1}. ${file.prefixText} - ${file.name}`;
  });

  if (state.files.length > preview.length) {
    preview.push(`... ${state.files.length - preview.length} more`);
  }

  $("filePreview").textContent = preview.join("\n");
}

async function getSequencePlayerPosition(sequence) {
  if (typeof sequence.getPlayerPosition !== "function") {
    throw new Error("sequence.getPlayerPosition() is unavailable.");
  }

  const time = await sequence.getPlayerPosition();
  if (!time || !Number.isFinite(Number(time.seconds))) {
    throw new Error("Could not read the active sequence playhead position.");
  }

  return time;
}

async function resolveTargetAudioTrack(sequence, spec) {
  const audioTrackCount = await sequence.getAudioTrackCount();
  const text = String(spec || "auto").trim().toLowerCase();

  if (text === "auto") {
    for (let index = 0; index < audioTrackCount; index += 1) {
      if (await isAudioTrackEmpty(sequence, index)) {
        return {
          index,
          label: `A${index + 1}`,
          existingTrackCount: audioTrackCount,
          createsTrack: false
        };
      }
    }

    return {
      index: audioTrackCount,
      label: `A${audioTrackCount + 1} (new)`,
      existingTrackCount: audioTrackCount,
      createsTrack: true
    };
  }

  if (text === "new" || text === "+" || text === "create") {
    return {
      index: audioTrackCount,
      label: `A${audioTrackCount + 1} (new)`,
      existingTrackCount: audioTrackCount,
      createsTrack: true
    };
  }

  const match = text.match(/^a?\s*(\d+)$/);
  if (!match) {
    throw new Error("Target audio track must be auto, new, A1, or a track number.");
  }

  const trackNumber = Number(match[1]);
  if (!Number.isFinite(trackNumber) || Math.floor(trackNumber) !== trackNumber || trackNumber < 1) {
    throw new Error("Target audio track must be a positive integer.");
  }

  if (trackNumber <= audioTrackCount) {
    const index = trackNumber - 1;
    if (!(await isAudioTrackEmpty(sequence, index))) {
      throw new Error(`A${trackNumber} is not empty. Choose an empty track, auto, or new.`);
    }

    return {
      index,
      label: `A${trackNumber}`,
      existingTrackCount: audioTrackCount,
      createsTrack: false
    };
  }

  if (trackNumber === audioTrackCount + 1) {
    return {
      index: audioTrackCount,
      label: `A${trackNumber} (new)`,
      existingTrackCount: audioTrackCount,
      createsTrack: true
    };
  }

  throw new Error(`Only the next new track can be created. Current audio tracks: ${audioTrackCount}.`);
}

async function isAudioTrackEmpty(sequence, index) {
  const track = await sequence.getAudioTrack(index);
  if (!track || typeof track.getTrackItems !== "function") {
    throw new Error(`Could not read A${index + 1}.`);
  }

  const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  return !clips || clips.length === 0;
}

async function resolveProjectItemsForFiles(project, files) {
  const selectedProjectItems = await collectSelectedClipProjectItems(project);
  if (selectedProjectItems.length > 0) {
    log(`Project selection after import: ${selectedProjectItems.length} clip item(s).`);
    try {
      return matchProjectItemsForFiles(selectedProjectItems, files, false);
    } catch (error) {
      log(
        "Project selection did not cover all imported files; falling back to project tree scan."
      );
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

async function buildPlacements(projectItems, startTime, intervalSeconds) {
  let cursorSeconds = Number(startTime.seconds);
  const items = [];

  for (const item of projectItems) {
    const durationSeconds = await getAudioDurationSeconds(
      item.clipProjectItem || item.projectItem,
      item.file
    );
    const startSeconds = cursorSeconds;
    const endSeconds = startSeconds + durationSeconds;

    items.push({
      file: item.file,
      projectItem: item.projectItem,
      startSeconds,
      startTime: ppro.TickTime.createWithSeconds(startSeconds),
      durationSeconds,
      endSeconds
    });

    cursorSeconds = endSeconds + intervalSeconds;
  }

  return {
    items,
    finalMarkerSeconds: cursorSeconds,
    finalMarkerTime: ppro.TickTime.createWithSeconds(cursorSeconds)
  };
}

async function getAudioDurationSeconds(projectItem, file) {
  const label = file && file.name ? file.name : "audio file";
  const mediaDuration = await getMediaDurationSeconds(projectItem);
  if (isPositiveFinite(mediaDuration)) {
    log(`Duration for ${label}: ${formatSeconds(mediaDuration)} from media.duration.`);
    return mediaDuration;
  }

  const inPoint = await getProjectItemTime(projectItem, "getInPoint");
  const outPoint = await getProjectItemTime(projectItem, "getOutPoint");
  const inSeconds = Number(inPoint && inPoint.seconds);
  const outSeconds = Number(outPoint && outPoint.seconds);

  if (Number.isFinite(inSeconds) && Number.isFinite(outSeconds) && outSeconds > inSeconds) {
    const duration = outSeconds - inSeconds;
    log(`Duration for ${label}: ${formatSeconds(duration)} from project item in/out.`);
    return duration;
  }

  const wavDuration = await getWavDurationSeconds(file);
  if (isPositiveFinite(wavDuration)) {
    log(`Duration for ${label}: ${formatSeconds(wavDuration)} from WAV header.`);
    return wavDuration;
  }

  throw new Error(
    `Could not read a positive audio duration for ${label}. ` +
      `media.duration=${formatDebugNumber(mediaDuration)}, ` +
      `in=${formatDebugNumber(inSeconds)}, out=${formatDebugNumber(outSeconds)}.`
  );
}

async function getMediaDurationSeconds(projectItem) {
  if (!projectItem || typeof projectItem.getMedia !== "function") {
    return NaN;
  }

  try {
    const media = await projectItem.getMedia();
    if (!media) {
      return NaN;
    }

    const duration = await valueOrPromise(media.duration);
    return tickTimeSeconds(duration);
  } catch (error) {
    return NaN;
  }
}

async function valueOrPromise(value) {
  if (value && typeof value.then === "function") {
    return await value;
  }

  return value;
}

function tickTimeSeconds(value) {
  if (value && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds);
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

async function getWavDurationSeconds(file) {
  if (!file || !file.entry || typeof file.entry.read !== "function") {
    return NaN;
  }

  try {
    const buffer = await readBinaryFile(file.entry);
    return parseWavDurationSeconds(buffer);
  } catch (error) {
    log(`Could not parse WAV duration for ${file.name}: ${error && error.message ? error.message : error}`);
    return NaN;
  }
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

function parseWavDurationSeconds(buffer) {
  if (!buffer || buffer.byteLength < 44) {
    throw new Error("WAV file is too small.");
  }

  const view = new DataView(buffer);
  const riff = readFourCC(view, 0);
  const wave = readFourCC(view, 8);

  if ((riff !== "RIFF" && riff !== "RF64") || wave !== "WAVE") {
    throw new Error("File is not a RIFF/WAVE file.");
  }

  let offset = 12;
  let byteRate = 0;
  let blockAlign = 0;
  let sampleRate = 0;
  let dataBytes = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;

    if (chunkId === "fmt " && dataOffset + 16 <= view.byteLength) {
      sampleRate = view.getUint32(dataOffset + 4, true);
      byteRate = view.getUint32(dataOffset + 8, true);
      blockAlign = view.getUint16(dataOffset + 12, true);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
      break;
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  if (byteRate > 0 && dataBytes > 0) {
    return dataBytes / byteRate;
  }

  if (sampleRate > 0 && blockAlign > 0 && dataBytes > 0) {
    return dataBytes / blockAlign / sampleRate;
  }

  throw new Error("WAV fmt/data chunks did not contain a usable duration.");
}

function readFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

async function getProjectItemTime(projectItem, methodName) {
  if (!projectItem || typeof projectItem[methodName] !== "function") {
    return null;
  }

  const mediaType = audioMediaType();
  if (mediaType !== null) {
    try {
      return await projectItem[methodName](mediaType);
    } catch (error) {
      // Try without an explicit media type below.
    }
  }

  try {
    return await projectItem[methodName]();
  } catch (error) {
    return null;
  }
}

function audioMediaType() {
  if (
    ppro.Constants &&
    ppro.Constants.MediaType &&
    ppro.Constants.MediaType.AUDIO !== undefined
  ) {
    return ppro.Constants.MediaType.AUDIO;
  }

  return null;
}

async function insertAudioAndMarkers(project, sequence, placements, target, options) {
  if (!ppro.SequenceEditor || typeof ppro.SequenceEditor.getEditor !== "function") {
    throw new Error("ppro.SequenceEditor.getEditor() is unavailable.");
  }
  if (!ppro.Markers || typeof ppro.Markers.getMarkers !== "function") {
    throw new Error("ppro.Markers.getMarkers() is unavailable.");
  }

  const editorResult = ppro.SequenceEditor.getEditor(sequence);
  const editor = editorResult && typeof editorResult.then === "function"
    ? await editorResult
    : editorResult;
  const before = await readAudioTrackClipCount(sequence, target.index);
  const expectedClipCount = before.clipCount + placements.items.length;
  const strategies = buildPlacementStrategies(target, editor);
  let lastError = null;

  log(
    `Timeline before: A${target.index + 1} ` +
      `${before.exists ? "exists" : "does not exist yet"}, ` +
      `${before.clipCount} clip item(s).`
  );

  for (const strategy of strategies) {
    const attemptBefore = await readAudioTrackClipCount(sequence, target.index);

    if (attemptBefore.clipCount > before.clipCount) {
      throw new Error(
        `A${target.index + 1} already changed during fallback attempts. ` +
          `It now has ${attemptBefore.clipCount} clip item(s).`
      );
    }

    log(`Trying timeline strategy: ${strategy.name}.`);

    try {
      placeAudioItemsWithStrategy(project, editor, placements, target, strategy);
      await wait(500);

      const attemptAfter = await readAudioTrackClipCount(sequence, target.index);
      log(
        `Strategy result: A${target.index + 1} has ` +
          `${attemptAfter.clipCount} clip item(s).`
      );

      if (attemptAfter.clipCount >= expectedClipCount) {
        await addPlacementMarkers(project, sequence, placements, options);
        return {
          trackLabel: `A${target.index + 1}`,
          clipCount: attemptAfter.clipCount,
          strategy: strategy.name
        };
      }

      if (attemptAfter.clipCount > before.clipCount) {
        throw new Error(
          `${strategy.name} placed only ${attemptAfter.clipCount - before.clipCount} ` +
            `of ${placements.items.length} clip(s). Stopping to avoid duplicates.`
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
      name: "audio-only unused video track (-1)",
      videoTrackIndex: -1,
      firstMode,
      restMode: overwriteMode
    },
    {
      name: "paired V1 plus target audio",
      videoTrackIndex: 0,
      firstMode,
      restMode: overwriteMode
    },
    {
      name: "insert-only audio track (-1)",
      videoTrackIndex: -1,
      firstMode: "insert",
      restMode: "insert"
    },
    {
      name: "insert-only paired V1 plus target audio",
      videoTrackIndex: 0,
      firstMode: "insert",
      restMode: "insert"
    }
  ];
  const unique = [];
  const seen = {};

  for (const candidate of candidates) {
    const key = [
      candidate.videoTrackIndex,
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

function placeAudioItemsWithStrategy(project, editor, placements, target, strategy) {
  for (let index = 0; index < placements.items.length; index += 1) {
    const placement = placements.items[index];
    const mode = index === 0 ? strategy.firstMode : strategy.restMode;

    executeProjectTransaction(project, `Place ${placement.file.name}`, (compoundAction) => {
      compoundAction.addAction(
        createPlaceProjectItemAction(
          editor,
          placement.projectItem,
          placement.startTime,
          strategy.videoTrackIndex,
          target.index,
          mode
        )
      );
    });

    log(
      `Committed ${mode} action for ${placement.file.name}: ` +
        `videoTrackIndex=${strategy.videoTrackIndex}, audioTrackIndex=${target.index}.`
    );
  }
}

async function addPlacementMarkers(project, sequence, placements, options) {
  const markers = await ppro.Markers.getMarkers(sequence);

  executeProjectTransaction(project, "Add prefix audio markers", (compoundAction) => {
    for (const placement of placements.items) {
      compoundAction.addAction(
        markers.createAddMarkerAction(
          markerNameForAudio(placement.file),
          "Comment",
          placement.startTime,
          ppro.TickTime.createWithSeconds(0),
          `start: ${placement.file.name}`
        )
      );
    }

    compoundAction.addAction(
      markers.createAddMarkerAction(
        "audio batch end",
        "Comment",
        placements.finalMarkerTime,
        ppro.TickTime.createWithSeconds(0),
        `last audio end + ${options.intervalSeconds}s`
      )
    );
  });
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

async function readAudioTrackClipCount(sequence, audioTrackIndex) {
  const trackCount = await sequence.getAudioTrackCount();
  if (audioTrackIndex >= trackCount) {
    return {
      exists: false,
      trackCount,
      clipCount: 0
    };
  }

  const track = await sequence.getAudioTrack(audioTrackIndex);
  const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  return {
    exists: true,
    trackCount,
    clipCount: clips ? clips.length : 0
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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

function markerNameForAudio(file) {
  const stem = file.name.replace(/\.wav$/i, "");
  return stem.length <= 60 ? stem : stem.slice(0, 57) + "...";
}

function getNativePath(entry) {
  return entry && (entry.nativePath || entry.fsName || entry.path || "");
}

function normalizePath(path) {
  return String(path || "")
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "");
}

function samePath(left, right) {
  const leftPath = normalizePath(left);
  const rightPath = normalizePath(right);

  return leftPath === rightPath || leftPath.toLowerCase() === rightPath.toLowerCase();
}

function isPositiveFinite(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function formatDebugNumber(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "unavailable";
}

function formatSeconds(seconds) {
  return `${roundForLog(seconds)}s`;
}

function roundForLog(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function safe(value) {
  return value === undefined || value === null ? "" : String(value);
}

function errorToString(error) {
  return error && error.stack ? error.stack : String(error);
}

$("chooseFolderButton").addEventListener("click", chooseFolder);
$("rescanButton").addEventListener("click", rescanFolder);
$("runButton").addEventListener("click", run);
$("clearButton").addEventListener("click", () => {
  state.logLines = [];
  $("log").textContent = "";
  setStatus("Idle");
});

$("saveLogButton").addEventListener("click", async () => {
  try {
    const file = await localFileSystem.getFileForSaving(
      `audio-prefix-importer-${timestampForFileName()}.log`,
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
    setStatus(`Saved log: ${file.nativePath || file.name}`);
  } catch (error) {
    setStatus("Failed to save log");
    log(errorToString(error));
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
