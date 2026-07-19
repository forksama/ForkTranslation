#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const A_POST_HEADING_RE = /^##\s+post:\s*(P\d{4,})\b/i;
const B_POST_HEADING_RE = /^##\s+(P\d{4,})\b(?:\s+(.*))?$/i;
const B_TITLE_HEADING_RE = /^##\s+thread\.title\s*$/i;
const C_CUE_HEADING_RE = /^##\s+(C(\d{4,}))\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/;
const FENCE_START_RE = /^(`{3,}|~{3,})\s*([A-Za-z0-9_-]+)?\s*$/u;
const FENCE_CLOSE_RE = /^(`{3,}|~{3,})\s*$/u;
const TARGET_FENCE_ALIASES = new Set(["ja-read", "jp-read", "read-ja"]);

function usage() {
  return [
    "Usage:",
    "  node tools/thread-floor-review.js [thread-dir] --floor <spec> [options]",
    "",
    "Options:",
    "      --source-a <file>       source-A.md path. Defaults to <thread-dir>/source-A.md.",
    "      --translation-b <file>  translation-B.md path. Defaults to <thread-dir>/translation-B.md.",
    "      --subtitles-c <file>    pr-subtitles-C.md path. Defaults to <thread-dir>/pr-subtitles-C.md.",
    "      --post <id>             Review by post id, e.g. P0005. Can be repeated.",
    "      --floor <spec>          Review by floor number, e.g. 5, 5-7, 5,8. Can be repeated.",
    "      --json                  Emit JSON instead of markdown.",
    "      --output <file>         Write output to a file instead of stdout.",
    "      --strict                Treat warnings as errors.",
    "  -h, --help                  Show this help.",
    "",
    "Examples:",
    "  node tools/thread-floor-review.js domains\\gakumasu\\threads\\board-6197547-rinha-distance-close --floor 5",
    "  node tools/thread-floor-review.js --source-a a.md --translation-b b.md --subtitles-c c.md --post P0005 --json",
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = resolveFiles(options);

  const sourceAText = readText(files.sourceA);
  const translationBText = readText(files.translationB);
  const subtitlesCText = readText(files.subtitlesC);

  const sourceA = parseSourceA(sourceAText, files.sourceA);
  const translationB = parseTranslationB(translationBText, files.translationB);
  const subtitlesC = parseSubtitlesC(subtitlesCText, files.subtitlesC);

  const report = buildReport({
    options,
    files,
    sourceA,
    translationB,
    subtitlesC,
  });

  const output = options.json ? JSON.stringify(report, null, 2) + "\n" : renderMarkdown(report);
  writeOutput(options.output, output);

  if (!options.json) {
    const summary = report.summary;
    const warningCount = summary.issues.filter((item) => item.level === "warning").length;
    console.error(`Wrote ${summary.targetCount} target(s). ${warningCount} warning(s).`);
  }

  const errorCount = report.summary.issues.filter((item) => item.level === "error").length;
  const warningCount = report.summary.issues.filter((item) => item.level === "warning").length;
  if (errorCount > 0) {
    console.error(`Review failed: ${errorCount} error(s), ${warningCount} warning(s).`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const options = {
    threadDir: null,
    sourceA: null,
    translationB: null,
    subtitlesC: null,
    floors: [],
    posts: [],
    json: false,
    output: null,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--source-a") {
      options.sourceA = requireValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--translation-b") {
      options.translationB = requireValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--subtitles-c") {
      options.subtitlesC = requireValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--post") {
      options.posts.push(requireValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--floor") {
      options.floors.push(requireValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--output") {
      options.output = requireValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") {
      fail(`Unknown option: ${arg}`);
    }
    if (options.threadDir != null) {
      fail(`Unexpected extra argument: ${arg}`);
    }
    options.threadDir = arg;
  }

  if (options.threadDir == null && !options.sourceA && !options.translationB && !options.subtitlesC) {
    options.threadDir = process.cwd();
  }

  if (options.posts.length === 0 && options.floors.length === 0) {
    fail("Missing --floor or --post.");
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("-")) {
    fail(`Missing value for ${optionName}.`);
  }
  return value;
}

function resolveFiles(options) {
  const baseDir = options.threadDir ? path.resolve(options.threadDir) : process.cwd();
  const sourceA = resolvePathOption(options.sourceA, baseDir, "source-A.md");
  const translationB = resolvePathOption(options.translationB, baseDir, "translation-B.md");
  const subtitlesC = resolvePathOption(options.subtitlesC, baseDir, "pr-subtitles-C.md");

  ensureReadable(sourceA, "source-A.md");
  ensureReadable(translationB, "translation-B.md");
  ensureReadable(subtitlesC, "pr-subtitles-C.md");

  return { baseDir, sourceA, translationB, subtitlesC };
}

function resolvePathOption(value, baseDir, fallbackName) {
  const candidate = value ? path.resolve(value) : path.resolve(baseDir, fallbackName);
  return candidate;
}

function ensureReadable(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    fail(`Not a file: ${filePath}`);
  }
}

function fail(message) {
  console.error(message);
  console.error("");
  console.error(usage());
  process.exit(2);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function parseFrontMatter(text) {
  const lines = text.split("\n");
  const result = {};
  let index = 0;

  while (index < lines.length && lines[index].trim().length === 0) {
    index += 1;
  }

  if (index >= lines.length || lines[index].trim() !== "---") {
    return { data: result, bodyStartIndex: 0 };
  }

  index += 1;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === "---") {
      return { data: result, bodyStartIndex: index + 1 };
    }
    const kv = parseKeyValueLine(trimmed);
    if (kv) {
      result[kv.key] = kv.value;
    }
    index += 1;
  }

  return { data: {}, bodyStartIndex: 0 };
}

function splitSections(text, headingTest) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (headingTest(trimmed)) {
      current = {
        heading: trimmed,
        startLine: index + 1,
        endLine: index + 1,
        lines: [raw],
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(raw);
      current.endLine = index + 1;
    }
  }

  return sections;
}

function parseSourceA(text, filePath) {
  const { data: frontMatter, bodyStartIndex } = parseFrontMatter(text);
  const bodyText = text.split("\n").slice(bodyStartIndex).join("\n");
  const sections = splitSections(bodyText, (line) => A_POST_HEADING_RE.test(line));
  const parsed = sections.map((section) => parseSourceASection(section));
  return {
    filePath,
    frontMatter,
    sections: parsed,
    byPost: indexBy(parsed, (item) => item.postId),
    byFloor: indexByMany(parsed, (item) => item.floor),
  };
}

function parseSourceASection(section) {
  const match = section.heading.match(A_POST_HEADING_RE);
  if (!match) {
    return null;
  }

  const meta = {};
  const codeBlocks = [];
  let fence = null;

  for (let index = 1; index < section.lines.length; index += 1) {
    const raw = section.lines[index];
    const trimmed = raw.trim();

    if (fence) {
      if (isFenceClose(trimmed, fence)) {
        codeBlocks.push({
          info: fence.info,
          startLine: fence.startLine,
          endLine: section.startLine + index,
          text: fence.lines.join("\n"),
        });
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }

    const fenceStart = parseFenceStart(trimmed);
    if (fenceStart) {
      fence = {
        char: fenceStart.char,
        len: fenceStart.len,
        info: fenceStart.info,
        startLine: section.startLine + index + 1,
        lines: [],
      };
      continue;
    }

    const kv = parseKeyValueLine(trimmed);
    if (kv) {
      meta[kv.key] = kv.value;
    }
  }

  if (fence) {
    codeBlocks.push({
      info: fence.info,
      startLine: fence.startLine,
      endLine: section.endLine,
      text: fence.lines.join("\n"),
      unterminated: true,
    });
  }

  const jaBlocks = codeBlocks.filter((block) => block.info.toLowerCase() === "ja");
  return {
    type: "post",
    postId: match[1].toUpperCase(),
    heading: section.heading,
    startLine: section.startLine,
    endLine: section.endLine,
    raw: section.lines.join("\n"),
    meta,
    floor: parseFloorNumber(meta.floor),
    role: asText(meta.role),
    kind: asText(meta.kind),
    replyTo: asArray(meta.reply_to),
    replyToFloors: asArray(meta.reply_to_floors),
    time: asText(meta.time),
    sourceUrl: asText(meta.source_url),
    tags: asArray(meta.tags),
    codeBlocks,
    jaBlocks,
    jaText: jaBlocks.map((block) => block.text).join("\n"),
  };
}

function parseTranslationB(text, filePath) {
  const { data: frontMatter, bodyStartIndex } = parseFrontMatter(text);
  const bodyText = text.split("\n").slice(bodyStartIndex).join("\n");
  const sections = splitSections(bodyText, (line) => B_TITLE_HEADING_RE.test(line) || B_POST_HEADING_RE.test(line));
  const parsed = sections.map((section) => parseTranslationBSection(section));
  return {
    filePath,
    frontMatter,
    sections: parsed,
    titleSection: parsed.find((item) => item && item.type === "thread.title") || null,
    byPost: indexBy(parsed.filter(Boolean).filter((item) => item.type === "post"), (item) => item.postId),
    byFloor: indexByMany(parsed.filter(Boolean).filter((item) => item.type === "post"), (item) => item.floor),
  };
}

function parseTranslationBSection(section) {
  const heading = section.heading;
  if (B_TITLE_HEADING_RE.test(heading)) {
    const entries = parseBEntries(section.lines.slice(1));
    return {
      type: "thread.title",
      heading,
      startLine: section.startLine,
      endLine: section.endLine,
      raw: section.lines.join("\n"),
      entries,
      translationText: entries.filter((entry) => entry.kind === "translation").map((entry) => entry.text).join("\n"),
      originalText: entries.filter((entry) => entry.kind === "original").map((entry) => entry.text).join("\n"),
      noteText: entries.filter((entry) => entry.kind === "note").map((entry) => entry.text).join("\n"),
      meta: parseSectionMeta(section.lines.slice(1)),
    };
  }

  const match = heading.match(B_POST_HEADING_RE);
  if (!match) {
    return null;
  }

  const meta = parseSectionMeta(section.lines.slice(1));
  const entries = parseBEntries(section.lines.slice(1));
  const headingRole = asText(match[2]);
  const role = asText(meta.role) || headingRole;
  const replyTo = asArray(meta.reply_to);

  return {
    type: "post",
    postId: match[1].toUpperCase(),
    heading,
    headingRole,
    startLine: section.startLine,
    endLine: section.endLine,
    raw: section.lines.join("\n"),
    meta,
    floor: parseFloorNumber(meta.floor),
    role,
    replyTo,
    entries,
    translationText: entries.filter((entry) => entry.kind === "translation").map((entry) => entry.text).join("\n"),
    originalText: entries.filter((entry) => entry.kind === "original").map((entry) => entry.text).join("\n"),
    noteText: entries.filter((entry) => entry.kind === "note").map((entry) => entry.text).join("\n"),
  };
}

function parseSectionMeta(lines) {
  const meta = {};
  for (const raw of lines) {
    const trimmed = raw.trim();
    const kv = parseKeyValueLine(trimmed);
    if (kv) {
      meta[kv.key] = kv.value;
    }
  }
  return meta;
}

function parseBEntries(lines) {
  const entries = [];
  let current = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const match = trimmed.match(/^(译文?|原文?|备注)[:：]\s*(.*)$/);
    if (match) {
      current = {
        kind: match[1].startsWith("译") ? "translation" : match[1].startsWith("原") ? "original" : "note",
        text: match[2],
      };
      entries.push(current);
      continue;
    }

    if (trimmed.length === 0) {
      if (current) {
        current.text += "\n";
      }
      continue;
    }

    if (current) {
      current.text += (current.text.length > 0 ? "\n" : "") + trimmed;
    } else {
      entries.push({ kind: "other", text: trimmed });
    }
  }

  return entries;
}

function parseSubtitlesC(text, filePath) {
  const lines = text.split("\n");
  const cues = [];
  let current = null;
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const lineNumber = index + 1;

    if (fence) {
      if (current) {
        current.rawLines.push(raw);
      }
      if (isFenceClose(trimmed, fence)) {
        if (!fence.cue) {
          fence = null;
          continue;
        }
        const blockText = normalizeBlockText(fence.lines.join("\n"));
        fence.cue.referenceBlocks.push({
          info: fence.info,
          startLine: fence.startLine,
          endLine: lineNumber,
          text: blockText,
        });
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }

    const fenceStart = parseTargetFenceStart(trimmed);
    if (fenceStart) {
      fence = {
        ...fenceStart,
        startLine: lineNumber,
        cue: current,
        lines: [],
      };
      if (current) {
        current.rawLines.push(raw);
      }
      continue;
    }

    if (trimmed.length === 0) {
      if (current) {
        current.rawLines.push(raw);
      }
      continue;
    }

    if (trimmed.startsWith("##")) {
      const match = trimmed.match(C_CUE_HEADING_RE);
      if (!match) {
        current = null;
        continue;
      }
      current = {
        id: match[1],
        number: Number(match[2]),
        role: match[3].trim(),
        source: match[4].trim(),
        sourceRefs: extractSourceRefs(match[4]),
        lines: [],
        referenceBlocks: [],
        rawLines: [raw],
        startLine: lineNumber,
        endLine: lineNumber,
      };
      cues.push(current);
      continue;
    }

    if (trimmed.startsWith("#")) {
      if (current) {
        current.rawLines.push(raw);
      }
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(trimmed);
    current.rawLines.push(raw);
    current.endLine = lineNumber;
  }

  return {
    filePath,
    cues,
    byPostRef: indexByMany(cues, (cue) => cue.sourceRefs.filter((ref) => /^P\d{4,}$/i.test(ref))),
  };
}

function parseTargetFenceStart(trimmed) {
  const match = trimmed.match(FENCE_START_RE);
  if (!match || !TARGET_FENCE_ALIASES.has((match[2] || "").toLowerCase())) {
    return null;
  }
  return {
    char: match[1][0],
    len: match[1].length,
    info: (match[2] || "").toLowerCase(),
  };
}

function isFenceClose(trimmed, fence) {
  const match = trimmed.match(FENCE_CLOSE_RE);
  return Boolean(match && match[1][0] === fence.char && match[1].length >= fence.len);
}

function parseFenceStart(trimmed) {
  const match = trimmed.match(FENCE_START_RE);
  if (!match) {
    return null;
  }
  return {
    char: match[1][0],
    len: match[1].length,
    info: (match[2] || "").toLowerCase(),
  };
}

function normalizeBlockText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").trim();
}

function parseKeyValueLine(line) {
  const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }
  return {
    key: match[1],
    value: parseInlineValue(match[2]),
  };
}

function parseInlineValue(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (text.length === 0) {
    return "";
  }
  if (text === "[]") {
    return [];
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    return text
      .slice(1, -1)
      .split(",")
      .map((part) => stripOuterQuotes(part.trim()))
      .filter((part) => part.length > 0);
  }
  return stripOuterQuotes(text);
}

function stripOuterQuotes(text) {
  const value = String(text == null ? "" : text).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return value;
}

function parseFloorNumber(value) {
  const text = asText(value);
  if (!text) {
    return null;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value) {
  if (value == null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).join(", ");
  }
  return String(value);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter((item) => item.length > 0);
  }
  const text = asText(value);
  if (!text) {
    return [];
  }
  return [text];
}

function extractSourceRefs(sourceText) {
  const refs = [];
  const seen = new Set();
  const text = String(sourceText == null ? "" : sourceText);
  const matches = text.match(/thread\.title|note:[A-Za-z0-9_.:-]+|P\d{4,}/g) || [];
  for (const ref of matches) {
    const normalized = ref.trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      refs.push(normalized);
    }
  }
  return refs;
}

function indexBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    if (!item) {
      continue;
    }
    const key = keyFn(item);
    if (key == null || key === "") {
      continue;
    }
    map.set(key, item);
  }
  return map;
}

function indexByMany(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    if (!item) {
      continue;
    }
    const rawKeys = keyFn(item);
    const keyList = Array.isArray(rawKeys) ? rawKeys : [rawKeys];
    const keys = Array.from(new Set(keyList.filter((key) => key != null && key !== "")));
    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(item);
    }
  }
  return map;
}

function resolveTargets(options, sourceA, translationB, subtitlesC) {
  const targets = [];
  const seen = new Set();

  for (const postId of options.posts) {
    addTarget(targets, seen, {
      kind: "post",
      postId: postId.toUpperCase(),
      requestedBy: ["post"],
    });
  }

  for (const floorSpec of options.floors) {
    for (const floor of expandFloorSpec(floorSpec)) {
      const aMatches = sourceA.byFloor.get(floor) || [];
      const bMatches = translationB.byFloor.get(floor) || [];
      const candidates = uniqueBy([
        ...aMatches.map((item) => item.postId),
        ...bMatches.map((item) => item.postId),
      ]);

      if (candidates.length === 0) {
        addTarget(targets, seen, {
          kind: "floor",
          floor,
          requestedBy: ["floor"],
        });
        continue;
      }

      for (const postId of candidates) {
        addTarget(targets, seen, {
          kind: "floor",
          floor,
          postId,
          requestedBy: ["floor"],
        });
      }
    }
  }

  return targets.map((target) => enrichTarget(target, sourceA, translationB, subtitlesC));
}

function addTarget(targets, seen, target) {
  const key = target.postId ? `post:${target.postId}` : `floor:${target.floor}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  targets.push(target);
}

function enrichTarget(target, sourceA, translationB, subtitlesC) {
  const aByPost = target.postId ? sourceA.byPost.get(target.postId) || null : null;
  const bByPost = target.postId ? translationB.byPost.get(target.postId) || null : null;
  const floor = target.floor ?? aByPost?.floor ?? bByPost?.floor ?? null;
  const postId = target.postId ?? aByPost?.postId ?? bByPost?.postId ?? null;

  const aCandidates = postId ? [aByPost].filter(Boolean) : floor == null ? [] : sourceA.byFloor.get(floor) || [];
  const bCandidates = postId ? [bByPost].filter(Boolean) : floor == null ? [] : translationB.byFloor.get(floor) || [];
  const cCandidates = postId ? subtitlesC.byPostRef.get(postId) || [] : [];

  const checks = buildChecks({
    floor,
    postId,
    aCandidates,
    bCandidates,
    cCandidates,
  });

  return {
    ...target,
    floor,
    postId,
    aCandidates,
    bCandidates,
    cCandidates,
    checks,
  };
}

function buildChecks({ floor, postId, aCandidates, bCandidates, cCandidates }) {
  const issues = [];
  const aSection = aCandidates[0] || null;
  const bSection = bCandidates[0] || null;
  const cSummary = cCandidates.length;

  if (!aSection && !bSection) {
    issues.push(issue("warning", "target-missing", `No A/B section found for ${floor != null ? `floor ${floor}` : postId}.`));
    return issues;
  }

  if (aSection && bSection && aSection.postId !== bSection.postId) {
    issues.push(issue("warning", "post-mismatch", `A/B post id mismatch: ${aSection.postId} vs ${bSection.postId}.`));
  }

  if (floor != null && aSection && aSection.floor != null && aSection.floor !== floor) {
    issues.push(issue("warning", "a-floor-mismatch", `A floor mismatch: expected ${floor}, got ${aSection.floor}.`));
  }

  if (floor != null && bSection && bSection.floor != null && bSection.floor !== floor) {
    issues.push(issue("warning", "b-floor-mismatch", `B floor mismatch: expected ${floor}, got ${bSection.floor}.`));
  }

  if (aSection && bSection) {
    const aText = normalizeLoose(aSection.jaText || aSection.raw);
    const bText = normalizeLoose(bSection.originalText || "");
    if (aText && bText) {
      if (aText === bText) {
        issues.push(issue("info", "a-b-original-match", "A ja text matches B original text."));
      } else if (aText.includes(bText) || bText.includes(aText)) {
        issues.push(issue("info", "a-b-original-partial", "A ja text and B original text are partially aligned."));
      } else {
        issues.push(issue("warning", "a-b-original-mismatch", "A ja text does not match B original text."));
      }
    }
  }

  if (cCandidates.length > 0 && bSection) {
    const bTranslation = normalizeLoose(bSection.translationText || "");
    let matched = 0;
    for (const cue of cCandidates) {
      const cueText = normalizeLoose(cue.lines.join("\n"));
      if (!cueText) {
        continue;
      }
      if (bTranslation.includes(cueText)) {
        matched += 1;
      }
    }
    if (matched === cCandidates.length) {
      issues.push(issue("info", "c-translation-match", `All ${matched} C cue(s) align with B translation text.`));
    } else {
      issues.push(issue("warning", "c-translation-mismatch", `${matched}/${cCandidates.length} C cue(s) align with B translation text.`));
    }
  } else if (cSummary === 0) {
    issues.push(issue("warning", "c-missing", "No C cue references found for this target."));
  }

  if (aSection && cCandidates.length > 0) {
    const aText = normalizeLoose(aSection.jaText || aSection.raw);
    let matchedBlocks = 0;
    let totalBlocks = 0;
    for (const cue of cCandidates) {
      for (const block of cue.referenceBlocks) {
        totalBlocks += 1;
        const blockText = normalizeLoose(block.text);
        if (!blockText) {
          continue;
        }
        if (aText.includes(blockText)) {
          matchedBlocks += 1;
        }
      }
    }
    if (totalBlocks > 0) {
      if (matchedBlocks === totalBlocks) {
        issues.push(issue("info", "c-ja-match", `All ${matchedBlocks} ja-read block(s) align with A text.`));
      } else {
        issues.push(issue("warning", "c-ja-mismatch", `${matchedBlocks}/${totalBlocks} ja-read block(s) align with A text.`));
      }
    }
  }

  return issues;
}

function normalizeLoose(text) {
  return String(text == null ? "" : text).replace(/[\s\u3000]+/g, "");
}

function expandFloorSpec(spec) {
  const parts = String(spec || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const floors = [];
  for (const part of parts) {
    const range = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) {
      fail(`Invalid floor spec: ${part}`);
    }
    const start = Number.parseInt(range[1], 10);
    const end = range[2] ? Number.parseInt(range[2], 10) : start;
    if (end < start) {
      fail(`Invalid floor range: ${part}`);
    }
    for (let value = start; value <= end; value += 1) {
      floors.push(value);
    }
  }
  return floors;
}

function uniqueBy(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item == null || item === "") {
      continue;
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function issue(level, code, message) {
  return { level, code, message };
}

function buildReport({ options, files, sourceA, translationB, subtitlesC }) {
  const targets = resolveTargets(options, sourceA, translationB, subtitlesC);
  const sourceTitle =
    asText(sourceA.frontMatter.thread_title) ||
    asText(sourceA.frontMatter.threadTitle) ||
    asText(translationB.titleSection?.originalText) ||
    "";
  const translatedTitle =
    asText(translationB.frontMatter.thread_title) ||
    asText(translationB.frontMatter.threadTitle) ||
    asText(translationB.titleSection?.translationText) ||
    "";
  const boardId = asText(sourceA.frontMatter.board_id) || asText(sourceA.frontMatter.boardId) || "";
  const allIssues = [];
  const targetReports = targets.map((target) => {
    const report = buildTargetReport(target, sourceA, translationB, subtitlesC);
    allIssues.push(...report.issues);
    return report;
  });

  const titleIssues = [];
  if (sourceTitle && translationB.titleSection?.originalText) {
    if (normalizeLoose(sourceTitle) !== normalizeLoose(translationB.titleSection.originalText)) {
      titleIssues.push(issue("warning", "title-original-mismatch", "A thread title differs from B thread.title original line."));
    }
  }
  if (translatedTitle && translationB.titleSection?.translationText) {
    if (normalizeLoose(translatedTitle) !== normalizeLoose(translationB.titleSection.translationText)) {
      titleIssues.push(issue("warning", "title-translation-mismatch", "B front matter title differs from B thread.title translation line."));
    }
  }
  allIssues.push(...titleIssues);

  if (options.strict) {
    for (const item of allIssues) {
      if (item.level === "warning") {
        item.level = "error";
        item.strict = true;
      }
    }
  }

  return {
    schema: "fork-thread-floor-review/v1",
    domain: "gakumasu",
    thread: {
      title: sourceTitle || translatedTitle,
      sourceTitle,
      translatedTitle,
      boardId,
    },
    files: {
      sourceA: files.sourceA,
      translationB: files.translationB,
      subtitlesC: files.subtitlesC,
    },
    request: {
      floors: options.floors.map((spec) => spec),
      posts: options.posts.map((post) => post.toUpperCase()),
    },
    targets: targetReports,
    summary: {
      targetCount: targetReports.length,
      issueCount: allIssues.length,
      issues: allIssues,
    },
  };
}

function buildTargetReport(target, sourceA, translationB, subtitlesC) {
  const aSections = target.aCandidates || [];
  const bSections = target.bCandidates || [];
  const cCues = target.cCandidates || [];
  const issues = target.checks || [];

  return {
    kind: target.kind,
    floor: target.floor,
    postId: target.postId,
    a: aSections.map((section) => ({
      postId: section.postId,
      floor: section.floor,
      role: section.role,
      kind: section.kind,
      replyTo: section.replyTo,
      replyToFloors: section.replyToFloors,
      time: section.time,
      sourceUrl: section.sourceUrl,
      tags: section.tags,
      startLine: section.startLine,
      endLine: section.endLine,
      raw: section.raw,
      jaText: section.jaText,
      jaBlocks: section.jaBlocks,
    })),
    b: bSections.map((section) => ({
      type: section.type,
      postId: section.postId || null,
      floor: section.floor ?? null,
      role: section.role || "",
      headingRole: section.headingRole || "",
      replyTo: section.replyTo || [],
      startLine: section.startLine,
      endLine: section.endLine,
      raw: section.raw,
      translationText: section.translationText || "",
      originalText: section.originalText || "",
      noteText: section.noteText || "",
    })),
    c: cCues.map((cue) => ({
      id: cue.id,
      role: cue.role,
      source: cue.source,
      sourceRefs: cue.sourceRefs,
      startLine: cue.startLine,
      endLine: cue.endLine,
      raw: cue.rawLines.join("\n"),
      lines: cue.lines,
      referenceBlocks: cue.referenceBlocks,
    })),
    issues,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Thread Floor Review");
  if (report.thread.sourceTitle) {
    lines.push(`- source_title: ${report.thread.sourceTitle}`);
  }
  if (report.thread.translatedTitle) {
    lines.push(`- translated_title: ${report.thread.translatedTitle}`);
  }
  if (!report.thread.sourceTitle && !report.thread.translatedTitle && report.thread.title) {
    lines.push(`- title: ${report.thread.title}`);
  }
  if (report.thread.boardId) {
    lines.push(`- board_id: ${report.thread.boardId}`);
  }
  lines.push(`- source-A: ${report.files.sourceA}`);
  lines.push(`- translation-B: ${report.files.translationB}`);
  lines.push(`- pr-subtitles-C: ${report.files.subtitlesC}`);
  lines.push("");

  for (const target of report.targets) {
    lines.push(`## ${targetLabel(target)}`);
    lines.push(`- floor: ${target.floor != null ? target.floor : "(none)"}`);
    lines.push(`- post: ${target.postId || "(none)"}`);
    lines.push(`- A sections: ${target.a.length}`);
    lines.push(`- B sections: ${target.b.length}`);
    lines.push(`- C cues: ${target.c.length}`);
    if (target.issues.length > 0) {
      lines.push("- checks:");
      for (const item of target.issues) {
        lines.push(`  - [${item.level}] ${item.message}`);
      }
    }
    lines.push("");

    if (target.a.length > 0) {
      lines.push("### A");
      for (const section of target.a) {
        lines.push(`- post: ${section.postId}`);
        lines.push(`- floor: ${section.floor != null ? section.floor : "(none)"}`);
        lines.push(`- role: ${section.role || "(none)"}`);
        lines.push(`- kind: ${section.kind || "(none)"}`);
        lines.push(`- lines: ${section.startLine}-${section.endLine}`);
        if (section.tags && section.tags.length > 0) {
          lines.push(`- tags: ${section.tags.join(", ")}`);
        }
        pushFencedBlock(lines, "markdown", section.raw);
      }
      lines.push("");
    } else {
      lines.push("### A");
      lines.push("_not found_");
      lines.push("");
    }

    if (target.b.length > 0) {
      lines.push("### B");
      for (const section of target.b) {
        lines.push(`- post: ${section.postId || "(thread.title)"}`);
        lines.push(`- floor: ${section.floor != null ? section.floor : "(none)"}`);
        lines.push(`- role: ${section.role || "(none)"}`);
        lines.push(`- lines: ${section.startLine}-${section.endLine}`);
        pushFencedBlock(lines, "markdown", section.raw);
      }
      lines.push("");
    } else {
      lines.push("### B");
      lines.push("_not found_");
      lines.push("");
    }

    if (target.c.length > 0) {
      lines.push("### C");
      for (const cue of target.c) {
        lines.push(`- ${cue.id} | ${cue.role} | ${cue.source}`);
        lines.push(`- lines: ${cue.startLine}-${cue.endLine}`);
        if (cue.sourceRefs && cue.sourceRefs.length > 0) {
          lines.push(`- source refs: ${cue.sourceRefs.join(", ")}`);
        }
        pushFencedBlock(lines, "markdown", cue.raw);
      }
      lines.push("");
    } else {
      lines.push("### C");
      lines.push("_not found_");
      lines.push("");
    }
  }

  lines.push("## Summary");
  for (const item of report.summary.issues) {
    lines.push(`- [${item.level}] ${item.code}: ${item.message}`);
  }

  return lines.join("\n") + "\n";
}

function pushFencedBlock(lines, info, text) {
  const content = String(text == null ? "" : text);
  const fence = "`".repeat(Math.max(3, maxBacktickRun(content) + 1));
  lines.push(`${fence}${info || ""}`);
  lines.push(content);
  lines.push(fence);
}

function maxBacktickRun(text) {
  let max = 0;
  for (const match of String(text == null ? "" : text).matchAll(/`+/g)) {
    max = Math.max(max, match[0].length);
  }
  return max;
}

function targetLabel(target) {
  if (target.postId && target.floor != null) {
    return `Floor ${target.floor} | ${target.postId}`;
  }
  if (target.postId) {
    return target.postId;
  }
  if (target.floor != null) {
    return `Floor ${target.floor}`;
  }
  return "Unresolved target";
}

function writeOutput(outputPath, text) {
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

if (require.main === module) {
  main();
}
