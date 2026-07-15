/* global require */

const premiere = require("premierepro");
const { entrypoints, storage } = require("uxp");

const localFileSystem = storage.localFileSystem;

const state = {
  busy: false,
  jsonFile: null,
  outputFolder: null,
  previewText: "Choose a subtitle JSON file.",
  logLines: []
};

entrypoints.setup({
  commands: {
    generateRoleSrts: runRoleSrtsCommand
  },
  panels: {
    prSubtitlesPanel: {
      show() {
        renderPanelState();
      }
    }
  }
});

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
  $("chooseJsonButton").disabled = busy;
  $("chooseOutputButton").disabled = busy;
  $("runButton").disabled = busy;
  $("saveLogButton").disabled = busy;
}

function renderPanelState() {
  $("jsonPath").textContent = state.jsonFile
    ? getNativePath(state.jsonFile) || state.jsonFile.name
    : "No JSON selected";
  $("outputPath").textContent = state.outputFolder
    ? getNativePath(state.outputFolder) || state.outputFolder.name
    : "No output folder selected";
  $("preview").textContent = state.previewText;
  $("log").textContent = state.logLines.join("\n");
}

async function chooseJsonFile() {
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

    state.previewText = await buildJsonPreview(file);
    state.jsonFile = file;
    renderPanelState();
    setStatus(`Loaded ${file.name}.`);
  } catch (error) {
    setStatus("Failed to load JSON");
    log(errorToString(error));
  }
}

async function chooseOutputFolder() {
  if (state.busy) {
    return;
  }

  try {
    ensureFolderPickerAvailable();
    const folder = await localFileSystem.getFolder();
    if (!folder) {
      return;
    }

    state.outputFolder = folder;
    renderPanelState();
    setStatus("Output folder selected.");
  } catch (error) {
    setStatus("Failed to choose output folder");
    log(errorToString(error));
  }
}

async function buildJsonPreview(file) {
  const data = parseJson(await readTextFile(file), file.name);
  const cues = getOrderedCues(data);
  const roleCounts = new Map();

  for (const cue of cues) {
    roleCounts.set(cue.role, (roleCounts.get(cue.role) || 0) + 1);
  }

  const lines = [
    `File: ${file.name}`,
    `Cues: ${cues.length}`,
    `Roles: ${roleCounts.size}`
  ];

  for (const [role, count] of roleCounts) {
    lines.push(`  ${role}: ${count}`);
  }

  return lines.join("\n");
}

async function runPanelGeneration() {
  if (state.busy) {
    return;
  }

  setBusy(true);
  setStatus("Generating");

  try {
    if (!state.jsonFile) {
      throw new Error("Choose a subtitle JSON file first.");
    }
    if (!state.outputFolder) {
      throw new Error("Choose an output folder first.");
    }

    const result = await generateRoleSrts(state.jsonFile, state.outputFolder, log);
    state.previewText = buildGenerationPreview(result);
    renderPanelState();
    setStatus(
      `Generated ${result.writtenFiles.length} SRT file(s); ` +
        `Project import ${result.importedToProject ? "succeeded" : "did not run"}.`
    );
  } catch (error) {
    setStatus("Generation failed");
    log(errorToString(error));
  } finally {
    setBusy(false);
  }
}

async function runRoleSrtsCommand() {
  try {
    ensureFolderPickerAvailable();
    const jsonFile = await localFileSystem.getFileForOpening({
      allowMultiple: false,
      types: ["json"]
    });
    if (!jsonFile) {
      return;
    }

    const outputFolder = await localFileSystem.getFolder();
    if (!outputFolder) {
      return;
    }

    const result = await generateRoleSrts(jsonFile, outputFolder, (message) => {
      console.log(message);
    });
    await showMessage(formatGenerationResult(result));
  } catch (error) {
    await showMessage(
      "ForkTranslation Role Subtitle SRTs failed:\n\n" +
        (error && error.message ? error.message : String(error))
    );
  }
}

async function generateRoleSrts(jsonFile, outputFolder, writeLog) {
  const report = typeof writeLog === "function" ? writeLog : () => {};
  const project = await premiere.Project.getActiveProject();
  if (!project) {
    throw new Error("Open a Premiere Pro project first.");
  }

  const sequence = await project.getActiveSequence();
  if (!sequence) {
    throw new Error("Make a sequence active first.");
  }

  const data = parseJson(await readTextFile(jsonFile), jsonFile.name);
  const cues = getOrderedCues(data);
  const markers = await getSequenceMarkers(sequence);
  const markerCoveredCueCount = Math.max(0, markers.length - 1);

  report("");
  report("Script: ForkTranslation PR Subtitles");
  report(`Project: ${project.path || project.name || "(unsaved)"}`);
  report(`Sequence: ${sequence.name || "(unnamed)"}`);
  report(`Subtitle JSON: ${getNativePath(jsonFile) || jsonFile.name}`);
  report(`Output folder: ${getNativePath(outputFolder) || outputFolder.name}`);
  report(`JSON cues: ${cues.length}`);
  report(`Sequence markers: ${markers.length}`);

  if (markerCoveredCueCount < 1) {
    throw new Error(
      "The active sequence has " + markers.length +
        " marker(s). At least 2 markers are needed for 1 subtitle cue."
    );
  }

  const usableCueCount = Math.min(cues.length, markerCoveredCueCount);
  validateMarkerIntervals(markers, 0, usableCueCount);

  const roleGroups = groupCuesByRole(cues, markers, usableCueCount);
  if (roleGroups.length === 0) {
    throw new Error("No role groups were generated.");
  }

  report(`Usable cues: ${usableCueCount}`);
  report(`Role groups: ${roleGroups.length}`);

  const writtenFiles = [];
  const timestamp = timestampForFileName();

  for (const group of roleGroups) {
    const srtText = buildRoleSrt(group.entries);
    const fileName = buildRoleSrtFileName(
      jsonFile.name,
      group.role,
      1,
      usableCueCount,
      timestamp
    );
    const srtFile = await outputFolder.createFile(fileName, { overwrite: true });

    await writeTextFile(srtFile, "\uFEFF" + srtText);
    writtenFiles.push({
      role: group.role,
      cueCount: group.entries.length,
      file: srtFile,
      fileName,
      path: getNativePath(srtFile)
    });
    report(`  ${group.role}: ${group.entries.length} cue(s) -> ${fileName}`);
  }

  const importPaths = writtenFiles
    .map((entry) => entry.path)
    .filter((path) => path);
  let importedToProject = false;

  if (importPaths.length > 0) {
    const rootItem = await project.getRootItem();
    importedToProject = await project.importFiles(
      importPaths,
      true,
      rootItem,
      false
    );
  }

  report(`Imported to Project panel: ${importedToProject ? "yes" : "no"}`);
  report("Done.");

  return {
    cueCount: cues.length,
    markerCount: markers.length,
    usableCueCount,
    writtenFiles,
    importedToProject
  };
}

function buildGenerationPreview(result) {
  const lines = [
    `Cue range: C${pad4(1)}-C${pad4(result.usableCueCount)}`,
    `Sequence markers: ${result.markerCount}`,
    `Role files: ${result.writtenFiles.length}`,
    `Imported to Project panel: ${result.importedToProject ? "yes" : "no"}`
  ];

  for (const entry of result.writtenFiles) {
    lines.push(`  ${entry.role}: ${entry.cueCount}`);
  }

  return lines.join("\n");
}

function formatGenerationResult(result) {
  return "Generated role subtitle SRTs.\n\n" +
    "Cue range: C" + pad4(1) + "-C" + pad4(result.usableCueCount) + "\n" +
    "Role files: " + result.writtenFiles.length + "\n" +
    "Imported to Project panel: " + (result.importedToProject ? "yes" : "no") + "\n\n" +
    result.writtenFiles
      .map((entry) => entry.role + ": " + entry.cueCount + " cue(s)")
      .join("\n") +
    "\n\nCreate one Subtitle track from each SRT manually, then apply the matching Track Style.";
}

function ensureFolderPickerAvailable() {
  if (typeof localFileSystem.getFolder !== "function") {
    throw new Error("localFileSystem.getFolder() is unavailable in this UXP host.");
  }
}

function errorToString(error) {
  return error && error.stack ? error.stack : String(error);
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
      role: normalizeRole(cue.role),
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

function normalizeRole(value) {
  const role = String(value === undefined || value === null ? "" : value)
    .trim()
    .replace(/学\s+P/g, "学P");
  return role.length > 0 ? role : "未分组";
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

function groupCuesByRole(cues, markers, cueCount) {
  const byRole = new Map();
  const groups = [];

  for (let cueIndex = 0; cueIndex < cueCount; cueIndex += 1) {
    const cue = cues[cueIndex];
    const role = normalizeRole(cue.role);
    let group = byRole.get(role);

    if (!group) {
      group = {
        role,
        entries: []
      };
      byRole.set(role, group);
      groups.push(group);
    }

    group.entries.push({
      cue,
      order: cueIndex + 1,
      startSeconds: markers[cueIndex].seconds,
      endSeconds: markers[cueIndex + 1].seconds
    });
  }

  return groups;
}

function buildRoleSrt(entries) {
  const parts = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    parts.push(String(index + 1));
    parts.push(
      formatSrtTime(entry.startSeconds) + " --> " +
        formatSrtTime(entry.endSeconds)
    );
    parts.push(entry.cue.lines.join("\r\n"));
    parts.push("");
  }

  return parts.join("\r\n");
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

function buildRoleSrtFileName(jsonFileName, role, rangeStartOrder, rangeEndOrder, timestamp) {
  const stem = String(jsonFileName || "pr-subtitles-D")
    .replace(/\.json$/i, "")
    .replace(/[\\/:*?"<>|]/g, "_");
  const safeRole = sanitizeFileNamePart(role || "未分组");

  return stem + "-role-" + safeRole + "-C" + pad4(rangeStartOrder) + "-C" +
    pad4(rangeEndOrder) + "-" + (timestamp || timestampForFileName()) + ".srt";
}

function sanitizeFileNamePart(value) {
  const text = String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim();

  return text.length > 0 ? text : "untitled";
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

async function savePanelLog() {
  try {
    const file = await localFileSystem.getFileForSaving(
      `pr-subtitles-${timestampForFileName()}.log`,
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
}

$("chooseJsonButton").addEventListener("click", chooseJsonFile);
$("chooseOutputButton").addEventListener("click", chooseOutputFolder);
$("runButton").addEventListener("click", runPanelGeneration);
$("clearButton").addEventListener("click", () => {
  state.logLines = [];
  $("log").textContent = "";
});
$("saveLogButton").addEventListener("click", savePanelLog);

renderPanelState();
