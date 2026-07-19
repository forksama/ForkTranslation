#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const CUE_HEADING_RE = /^##\s+(C(\d{4,}))\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/;
const POST_REF_RE = /^P\d{4,}$/;
const IGNORED_FENCE_INFOS = new Set(["ja-read", "jp-read", "read-ja"]);
const SOFT_MIN_CHARS = 15;
const SOFT_MAX_CHARS = 20;

function usage() {
  return [
    "Usage:",
    "  node scripts/convert-pr-subtitles.js <pr-subtitles-C.md> [options]",
    "",
    "Options:",
    "  -o, --output <file>         Output D JSON path. Defaults to replacing -C.md with -D.json.",
    "      --domain <name>         Domain name for D metadata. Default: gakumasu.",
    "      --source-a <file>       Optional source-A.md for source reference validation.",
    "      --translation-b <file>  Optional translation-B.md for source reference and coverage checks.",
    "      --strict                Treat warnings as errors.",
    "  -h, --help                  Show this help.",
    "",
    "Every cue must include at least one reference fenced block marked ```ja-read, ```jp-read, or ```read-ja.",
    "These blocks are validated for presence, then extracted into D's jaText / jaBlocks while omitted from subtitle lines.",
    "",
    "Use '-' as the input path to read C from stdin.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    domain: "gakumasu",
    sourceA: null,
    translationB: null,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "-o" || arg === "--output") {
      options.output = requireValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--domain") {
      options.domain = requireValue(argv, i, arg);
      i += 1;
      continue;
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
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") {
      fail(`Unknown option: ${arg}`);
    }
    if (options.input != null) {
      fail(`Unexpected extra argument: ${arg}`);
    }
    options.input = arg;
  }

  if (options.input == null) {
    fail("Missing input C markdown path.");
  }
  if (options.output == null && options.input !== "-") {
    options.output = defaultOutputPath(options.input);
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

function fail(message) {
  console.error(message);
  console.error("");
  console.error(usage());
  process.exit(2);
}

function defaultOutputPath(inputPath) {
  if (/-C\.md$/i.test(inputPath)) {
    return inputPath.replace(/-C\.md$/i, "-D.json");
  }
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}-D.json`);
}

function readText(filePath) {
  if (filePath === "-") {
    return fs.readFileSync(0, "utf8");
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseCueMarkdown(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const cues = [];
  const issues = [];
  let current = null;
  let ignoredFence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const lineNumber = index + 1;

    if (ignoredFence != null) {
      if (isFenceClose(trimmed, ignoredFence)) {
        if (ignoredFence.cue == null) {
          issues.push(issue("error", "orphan-reference-block", "Reference fenced block must appear inside a cue.", { lineNumber: ignoredFence.lineNumber }));
        } else {
          const blockText = normalizeFenceText(ignoredFence.lines.join("\n"));
          ignoredFence.cue.referenceBlocks.push({
            info: ignoredFence.info,
            lineNumber: ignoredFence.lineNumber,
            text: blockText,
          });
        }
        ignoredFence = null;
      } else {
        ignoredFence.lines.push(raw);
      }
      continue;
    }

    const ignoredFenceStart = parseIgnoredFenceStart(trimmed);
    if (ignoredFenceStart != null) {
      ignoredFence = { ...ignoredFenceStart, lineNumber, cue: current, lines: [] };
      continue;
    }

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith("##")) {
      const match = trimmed.match(CUE_HEADING_RE);
      if (!match) {
        issues.push(issue("error", "invalid-heading", "Cue heading must be: ## C0001 | role | source", { lineNumber }));
        current = null;
        continue;
      }
      current = {
        id: match[1],
        number: Number(match[2]),
        role: match[3].trim(),
        source: match[4].trim(),
        sourceRefs: splitSourceRefs(match[4]),
        lines: [],
        referenceBlocks: [],
        lineNumber,
      };
      cues.push(current);
      continue;
    }

    if (trimmed.startsWith("#")) {
      issues.push(issue("warning", "ignored-heading", "Only level-2 cue headings are parsed; this heading is ignored.", { lineNumber }));
      continue;
    }

    if (current == null) {
      issues.push(issue("warning", "ignored-preamble", "Non-empty text before the first cue heading is ignored.", { lineNumber }));
      continue;
    }

    current.lines.push(trimmed);
  }

  if (ignoredFence != null) {
    issues.push(issue("error", "unterminated-reference-block", "Reference fenced block is missing its closing fence.", { lineNumber: ignoredFence.lineNumber }));
  }

  return { cues, issues };
}

function parseIgnoredFenceStart(trimmed) {
  const match = trimmed.match(/^(`{3,}|~{3,})\s*([A-Za-z0-9_-]+)\s*$/u);
  if (!match || !IGNORED_FENCE_INFOS.has(match[2].toLowerCase())) {
    return null;
  }
  return {
    char: match[1][0],
    length: match[1].length,
    info: match[2].toLowerCase(),
  };
}

function isFenceClose(trimmed, fence) {
  const match = trimmed.match(/^(`{3,}|~{3,})\s*$/u);
  return Boolean(match && match[1][0] === fence.char && match[1].length >= fence.length);
}

function normalizeFenceText(text) {
  const normalized = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }

  return lines.join("\n");
}

function splitSourceRefs(source) {
  return source
    .split(/[,\s\u3001\uff0c]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function validateCues(cues, options, referenceSets) {
  const issues = [];
  const seenIds = new Set();
  const usedRefs = new Set();

  if (cues.length === 0) {
    issues.push(issue("error", "no-cues", "No cue headings were found."));
    return issues;
  }

  cues.forEach((cue, index) => {
    const expectedNumber = index + 1;
    if (seenIds.has(cue.id)) {
      issues.push(issue("error", "duplicate-id", `Duplicate cue id: ${cue.id}`, cueContext(cue)));
    }
    seenIds.add(cue.id);

    if (cue.number !== expectedNumber) {
      issues.push(issue("error", "non-sequential-id", `Cue id ${cue.id} should be C${String(expectedNumber).padStart(4, "0")}.`, cueContext(cue)));
    }

    if (cue.role.length === 0) {
      issues.push(issue("error", "empty-role", "Cue role cannot be empty.", cueContext(cue)));
    }
    if (cue.role === "P" || cue.role === "制作人") {
      issues.push(issue("warning", "role-name", "Use 学P as the subtitle role for producer cues.", cueContext(cue)));
    }

    if (cue.source.length === 0) {
      issues.push(issue("error", "empty-source", "Cue source cannot be empty.", cueContext(cue)));
    }
    if (cue.sourceRefs.length === 0) {
      issues.push(issue("error", "empty-source-ref", "Cue source must contain at least one source reference.", cueContext(cue)));
    }

    cue.sourceRefs.forEach((ref) => {
      usedRefs.add(ref);
      if (!isValidSourceRefSyntax(ref)) {
        issues.push(issue("warning", "source-ref-syntax", `Source reference looks unusual: ${ref}`, cueContext(cue)));
      }
      if (referenceSets.all.size > 0 && !referenceSets.all.has(ref)) {
        issues.push(issue("warning", "unknown-source-ref", `Source reference was not found in supplied A/B files: ${ref}`, cueContext(cue)));
      }
    });

    if (cue.lines.length === 0) {
      issues.push(issue("error", "empty-cue", "Cue must contain one or two subtitle lines.", cueContext(cue)));
    }
    if (cue.lines.length > 2) {
      issues.push(issue("error", "too-many-lines", `Cue has ${cue.lines.length} lines; maximum is 2.`, cueContext(cue)));
    }
    if (cue.referenceBlocks.length === 0) {
      issues.push(issue("error", "missing-reference-block", "Cue must include at least one ja-read reference fenced block.", cueContext(cue)));
    }
    cue.referenceBlocks.forEach((block) => {
      if (block.text.trim().length === 0) {
        issues.push(issue("error", "empty-reference-block", "Reference fenced block cannot be empty.", { ...cueContext(cue), lineNumber: block.lineNumber }));
      }
    });

    cue.lines.forEach((line, lineIndex) => {
      if (line.length === 0) {
        issues.push(issue("error", "empty-line", `Cue line ${lineIndex + 1} is empty.`, cueContext(cue)));
      }
      const length = subtitleCharCount(line);
      if (length < SOFT_MIN_CHARS || length > SOFT_MAX_CHARS) {
        issues.push(issue("warning", "line-length", `Cue line ${lineIndex + 1} has ${length} chars; target is ${SOFT_MIN_CHARS}-${SOFT_MAX_CHARS}.`, cueContext(cue)));
      }
      if (/^[^「」]{1,12}「/.test(line)) {
        issues.push(issue("warning", "embedded-speaker", "Line looks like it still contains an embedded speaker name; split it into role + text.", cueContext(cue)));
      }
    });
  });

  if (referenceSets.translationB.size > 0) {
    for (const ref of referenceSets.translationB) {
      if (!usedRefs.has(ref)) {
        issues.push(issue("warning", "uncovered-b-source", `No cue references B section ${ref}. If it should not appear on screen, record that in B remarks.`));
      }
    }
  }

  if (options.strict) {
    issues.forEach((item) => {
      if (item.level === "warning") {
        item.level = "error";
        item.strict = true;
      }
    });
  }

  return issues;
}

function isValidSourceRefSyntax(ref) {
  return POST_REF_RE.test(ref) || ref === "thread.title" || /^note:[A-Za-z0-9_.:-]+$/.test(ref);
}

function subtitleCharCount(text) {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function cueContext(cue) {
  return { cueId: cue.id, lineNumber: cue.lineNumber };
}

function issue(level, code, message, context = {}) {
  return { level, code, message, ...context };
}

function collectReferenceSets(options) {
  const sourceA = options.sourceA ? collectRefsFromSourceA(readText(options.sourceA)) : new Set();
  const translationB = options.translationB ? collectRefsFromTranslationB(readText(options.translationB)) : new Set();
  const all = new Set([...sourceA, ...translationB]);
  if (sourceA.size > 0 || translationB.size > 0) {
    all.add("thread.title");
  }
  return { sourceA, translationB, all };
}

function collectRefsFromSourceA(text) {
  const refs = new Set();
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^##\s+post:\s*(P\d{4,})\b/);
    if (match) {
      refs.add(match[1]);
    }
  }
  return refs;
}

function collectRefsFromTranslationB(text) {
  const refs = new Set();
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^##\s+(P\d{4,})\b/);
    if (match) {
      refs.add(match[1]);
    }
  }
  return refs;
}

function buildD(cues, options) {
  return {
    schema: "fork-pr-subtitles-d/v1",
    domain: options.domain,
    source: {
      format: "pr-subtitles-C.md",
      path: options.input === "-" ? null : normalizePath(options.input),
    },
    cueCount: cues.length,
    cues: cues.map((cue, index) => ({
      id: cue.id,
      order: index + 1,
      role: cue.role,
      source: cue.source,
      sourceRefs: cue.sourceRefs,
      jaText: buildJapaneseText(cue.referenceBlocks),
      jaBlocks: cue.referenceBlocks.map((block) => block.text),
      line1: cue.lines[0] ?? "",
      line2: cue.lines[1] ?? "",
      lines: cue.lines,
      text: cue.lines.join("\n"),
    })),
  };
}

function buildJapaneseText(referenceBlocks) {
  return referenceBlocks
    .map((block) => block.text)
    .filter((text) => String(text).length > 0)
    .join("\n");
}

function normalizePath(filePath) {
  return path.normalize(filePath).replace(/\\/g, "/");
}

function printIssues(issues) {
  for (const item of issues) {
    const location = [
      item.lineNumber ? `line ${item.lineNumber}` : null,
      item.cueId ? `cue ${item.cueId}` : null,
    ].filter(Boolean).join(", ");
    const prefix = location ? `${item.level.toUpperCase()} ${item.code} (${location})` : `${item.level.toUpperCase()} ${item.code}`;
    console.error(`${prefix}: ${item.message}`);
  }
}

function writeOutput(outputPath, json) {
  if (outputPath == null) {
    process.stdout.write(json);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, json, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const referenceSets = collectReferenceSets(options);
  const parsed = parseCueMarkdown(readText(options.input));
  const validationIssues = validateCues(parsed.cues, options, referenceSets);
  const issues = [...parsed.issues, ...validationIssues];
  const errors = issues.filter((item) => item.level === "error");
  const warnings = issues.filter((item) => item.level === "warning");

  if (issues.length > 0) {
    printIssues(issues);
  }

  if (errors.length > 0) {
    console.error(`Conversion failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }

  const d = buildD(parsed.cues, options);
  const json = `${JSON.stringify(d, null, 2)}\n`;
  writeOutput(options.output, json);

  const target = options.output == null ? "stdout" : options.output;
  console.error(`Wrote ${parsed.cues.length} cue(s) to ${target}. ${warnings.length} warning(s).`);
}

main();
