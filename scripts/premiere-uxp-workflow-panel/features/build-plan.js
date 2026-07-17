(function registerBuildPlan(app) {
  if (!app) {
    throw new Error("ForkTranslation workflow app shell is missing.");
  }

  app.registerFeature("plan", {
    init() {
      const { storage } = require("uxp");
      const localFileSystem = storage.localFileSystem;
      const state = {
        busy: false,
        plan: null,
        stage: createEmptyStage(),
        routing: new Map(),
        logLines: []
      };

      function $(elementId) {
        return app.$("plan", elementId);
      }

      function setStatus(message) {
        $("status").textContent = message;
      }

      function log(message) {
        state.logLines.push(String(message));
        $("log").textContent = state.logLines.join("\n");
        $("log").scrollTop = $("log").scrollHeight;
        updateButtons();
      }

      function setBusy(busy) {
        state.busy = busy;
        updateButtons();
      }

      function updateButtons() {
        const hasPlan = !!state.plan;
        $("scanButton").disabled = state.busy;
        $("buildAllButton").disabled = state.busy || !hasPlan;
        $("buildAudioButton").disabled = state.busy || !hasPlan;
        $("buildPortraitsButton").disabled = state.busy || !state.stage.audioBuilt;
        $("generateSrtsButton").disabled = state.busy || !state.stage.audioBuilt;
        $("clearButton").disabled = state.busy || !hasPlan;
        $("saveLogButton").disabled = state.busy || state.logLines.length === 0;
      }

      function createEmptyStage() {
        return {
          audioBuilt: false,
          portraitBuilt: false,
          srtGenerated: false,
          timedPlan: null,
          audioPlacementCount: 0,
          portraitPlacementCount: 0,
          srtFileCount: 0
        };
      }

      async function scanPlan() {
        if (state.busy) {
          return;
        }

        setBusy(true);
        setStatus("正在扫描计划");

        try {
          const audio = app.getFeatureApi("audio");
          const portrait = app.getFeatureApi("portrait");
          const subtitles = app.getFeatureApi("subtitles");

          const audioFiles = await audio.ensureFiles();
          const mapping = portrait.getMapping();
          const cues = await subtitles.readCues();
          const plan = buildTimelinePlan(audioFiles, mapping.items, cues);

          state.plan = plan;
          state.stage = createEmptyStage();
          mergeRouting(plan.roles);
          renderPlan(plan);
          renderStageStatus();
          writePlanLog(plan);
          setStatus(
            `计划已生成：${plan.cueCount} 条，${plan.roles.length} 个角色，` +
              `${plan.diagnostics.length} 条诊断。`
          );
        } catch (error) {
          setStatus("扫描计划失败");
          log(errorToString(error));
          renderStageStatus();
        } finally {
          setBusy(false);
        }
      }

      async function buildAll() {
        await runPlanTask("正在一键生成", "一键生成失败", async () => {
          log("");
          log("Script: ForkTranslation Build Timeline");
          log("Step 1/3: importing audio by role and creating global markers.");
          await buildAudioCore();

          log("Step 2/3: importing portraits by role.");
          await buildPortraitsCore();

          log("Step 3/3: generating role subtitle SRTs.");
          await generateSrtsCore();

          setStatus("一键生成完成");
          log("Build all done.");
        });
      }

      async function buildAudioStage() {
        await runPlanTask("正在生成音频 + Marker", "生成音频失败", async () => {
          log("");
          log("Script: ForkTranslation Build Audio + Markers");
          await buildAudioCore();
          setStatus("音频 + Marker 已生成");
          log("Audio + markers done.");
        });
      }

      async function buildPortraitsStage() {
        await runPlanTask("正在生成立绘", "生成立绘失败", async () => {
          log("");
          log("Script: ForkTranslation Build Portraits");
          await buildPortraitsCore();
          setStatus("立绘已生成");
          log("Portraits done.");
        });
      }

      async function generateSrtsStage() {
        await runPlanTask("正在生成字幕", "生成字幕失败", async () => {
          log("");
          log("Script: ForkTranslation Generate Role SRTs");
          if (!state.stage.audioBuilt) {
            log("Audio stage is not marked done in this session; using current sequence markers.");
          }
          await generateSrtsCore();
          setStatus("字幕已生成");
          log("Role SRTs done.");
        });
      }

      async function runPlanTask(activeStatus, failureStatus, task) {
        if (state.busy) {
          return;
        }

        setBusy(true);
        setStatus(activeStatus);

        try {
          await task();
          renderStageStatus();
        } catch (error) {
          setStatus(failureStatus);
          log(errorToString(error));
          renderStageStatus();
        } finally {
          setBusy(false);
        }
      }

      async function buildAudioCore() {
        const plan = requirePlan();
        const routing = getRouting();
        const audio = app.getFeatureApi("audio");
        const audioResult = await audio.importByRole(plan, routing);

        state.stage.timedPlan = audioResult.plan;
        state.stage.audioBuilt = true;
        state.stage.portraitBuilt = false;
        state.stage.srtGenerated = false;
        state.stage.audioPlacementCount = audioResult.placements && audioResult.placements.items
          ? audioResult.placements.items.length
          : 0;
        state.stage.portraitPlacementCount = 0;
        state.stage.srtFileCount = 0;
        renderStageStatus();

        return audioResult;
      }

      async function buildPortraitsCore() {
        requirePlan();
        if (!state.stage.timedPlan) {
          throw new Error("Build audio + markers before building portraits.");
        }

        const routing = getRouting();
        const portrait = app.getFeatureApi("portrait");
        const result = await portrait.importByRole(state.stage.timedPlan, routing);

        state.stage.portraitBuilt = true;
        state.stage.portraitPlacementCount = result && Number.isFinite(Number(result.placedCount))
          ? Number(result.placedCount)
          : 0;
        renderStageStatus();

        return result;
      }

      async function generateSrtsCore() {
        requirePlan();
        const subtitles = app.getFeatureApi("subtitles");
        const result = await subtitles.generateSrts();

        state.stage.srtGenerated = true;
        state.stage.srtFileCount = result && result.writtenFiles
          ? result.writtenFiles.length
          : 0;
        renderStageStatus();

        return result;
      }

      function requirePlan() {
        if (!state.plan) {
          throw new Error("请先扫描计划。");
        }

        return state.plan;
      }

      function renderStageStatus() {
        if (!state.plan) {
          $("stageStatus").textContent = "计划：未扫描";
          return;
        }

        $("stageStatus").textContent = [
          `计划：${state.plan.cueCount} 条，${state.plan.roles.length} 个角色`,
          `音频 + Marker：${stageText(state.stage.audioBuilt, state.stage.audioPlacementCount)}`,
          `立绘：${stageText(state.stage.portraitBuilt, state.stage.portraitPlacementCount)}`,
          `字幕：${stageText(state.stage.srtGenerated, state.stage.srtFileCount)}`
        ].join("\n");
      }

      function stageText(done, count) {
        if (!done) {
          return "未完成";
        }

        return Number(count) > 0 ? `完成（${count}）` : "完成";
      }

      function buildTimelinePlan(audioFiles, mappingItems, cues) {
        const cueCount = Math.max(audioFiles.length, mappingItems.length, cues.length);
        const diagnostics = [];
        const rows = [];
        const roleCounts = new Map();
        const roleOrder = [];

        compareCount("audio files", audioFiles.length, cueCount, diagnostics);
        compareCount("mapping items", mappingItems.length, cueCount, diagnostics);
        compareCount("subtitle cues", cues.length, cueCount, diagnostics);

        for (let index = 0; index < cueCount; index += 1) {
          const order = index + 1;
          const audio = audioFiles[index] || null;
          const mapping = mappingItems[index] || null;
          const cue = cues[index] || null;
          const mappingRole = normalizeRole(mapping && mapping.role);
          const cueRole = normalizeRole(cue && cue.role);
          const role = cueRole || mappingRole || "unassigned";

          if (mapping && audio && !sameFileName(mapping.audioFileName, audio.name)) {
            diagnostics.push(
              `C${pad4(order)} audio mismatch: folder=${audio.name}, mapping=${mapping.audioFileName || "(empty)"}`
            );
          }
          if (mappingRole && cueRole && mappingRole !== cueRole) {
            diagnostics.push(
              `C${pad4(order)} role mismatch: mapping=${mappingRole}, subtitle=${cueRole}`
            );
          }
          if (!audio) {
            diagnostics.push(`C${pad4(order)} has no audio file.`);
          }
          if (!mapping) {
            diagnostics.push(`C${pad4(order)} has no mapping item.`);
          }
          if (!cue) {
            diagnostics.push(`C${pad4(order)} has no subtitle cue.`);
          }

          if (!roleCounts.has(role)) {
            roleCounts.set(role, 0);
            roleOrder.push(role);
          }
          roleCounts.set(role, roleCounts.get(role) + 1);

          rows.push({
            order,
            cueId: cue && cue.id ? cue.id : `C${pad4(order)}`,
            role,
            audioFileName: audio ? audio.name : "",
            mappingAudioFileName: mapping ? mapping.audioFileName : "",
            portraitRelPath: mapping ? mapping.portraitRelPath : "",
            lines: cue ? cue.lines : []
          });
        }

        const roles = roleOrder.map((role) => ({
          role,
          cueCount: roleCounts.get(role),
          audioTrack: "auto",
          portraitTrack: "auto"
        }));

        return {
          cueCount,
          audioFileCount: audioFiles.length,
          mappingItemCount: mappingItems.length,
          subtitleCueCount: cues.length,
          roles,
          rows,
          diagnostics
        };
      }

      function compareCount(label, count, expected, diagnostics) {
        if (count !== expected) {
          diagnostics.push(`${label} count is ${count}; plan row count is ${expected}.`);
        }
      }

      function mergeRouting(roles) {
        const nextRouting = new Map();
        for (const role of roles) {
          const existing = state.routing.get(role.role);
          nextRouting.set(role.role, {
            role: role.role,
            audioTrack: existing ? existing.audioTrack : role.audioTrack,
            portraitTrack: existing ? existing.portraitTrack : role.portraitTrack
          });
        }
        state.routing = nextRouting;
      }

      function getRouting() {
        const routing = {};
        for (const [role, value] of state.routing) {
          routing[role] = {
            role,
            audioTrack: String(value.audioTrack || "").trim(),
            portraitTrack: String(value.portraitTrack || "").trim()
          };
        }
        return routing;
      }

      function renderPlan(plan) {
        const container = $("preview");
        container.textContent = "";

        const summary = document.createElement("pre");
        summary.textContent = [
          `总条数: ${plan.cueCount}`,
          `音频数量: ${plan.audioFileCount}`,
          `Mapping 条目: ${plan.mappingItemCount}`,
          `字幕条数: ${plan.subtitleCueCount}`,
          `角色数量: ${plan.roles.length}`
        ].join("\n");
        container.appendChild(summary);

        const table = document.createElement("table");
        table.className = "routingTable";
        table.appendChild(row(["角色", "条数", "音频轨道", "立绘轨道"], "th"));

        for (const role of plan.roles) {
          const route = state.routing.get(role.role);
          const audioInput = trackInput(role.role, "audioTrack", route.audioTrack);
          const portraitInput = trackInput(role.role, "portraitTrack", route.portraitTrack);
          const tr = document.createElement("tr");
          appendCell(tr, role.role);
          appendCell(tr, String(role.cueCount));
          appendCell(tr, audioInput);
          appendCell(tr, portraitInput);
          table.appendChild(tr);
        }
        container.appendChild(table);

        if (plan.diagnostics.length > 0) {
          const diagnostics = document.createElement("pre");
          const lines = [`诊断: ${plan.diagnostics.length}`];
          for (const item of plan.diagnostics.slice(0, 20)) {
            lines.push(`- ${item}`);
          }
          if (plan.diagnostics.length > 20) {
            lines.push(`... ${plan.diagnostics.length - 20} more`);
          }
          diagnostics.textContent = lines.join("\n");
          container.appendChild(diagnostics);
        }
      }

      function row(values, cellName) {
        const tr = document.createElement("tr");
        for (const value of values) {
          const cell = document.createElement(cellName);
          cell.textContent = value;
          tr.appendChild(cell);
        }
        return tr;
      }

      function appendCell(tr, value) {
        const cell = document.createElement("td");
        if (value && value.nodeType) {
          cell.appendChild(value);
        } else {
          cell.textContent = value;
        }
        tr.appendChild(cell);
      }

      function trackInput(role, field, value) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = value || "";
        input.addEventListener("input", () => {
          const route = state.routing.get(role) || { role };
          route[field] = input.value;
          state.routing.set(role, route);
        });
        return input;
      }

      function writePlanLog(plan) {
        log("");
        log("Script: ForkTranslation Build Timeline Plan");
        log(`Cues: ${plan.cueCount}`);
        log(`Audio files: ${plan.audioFileCount}`);
        log(`Mapping items: ${plan.mappingItemCount}`);
        log(`Subtitle cues: ${plan.subtitleCueCount}`);
        log(`Roles: ${plan.roles.length}`);

        for (const role of plan.roles) {
          log(`  ${role.role}: ${role.cueCount} cue(s) -> ${role.audioTrack} / ${role.portraitTrack}`);
        }

        if (plan.diagnostics.length > 0) {
          log("Diagnostics:");
          for (const item of plan.diagnostics) {
            log(`  - ${item}`);
          }
        }
      }

      function normalizeRole(value) {
        return String(value === undefined || value === null ? "" : value).trim();
      }

      function sameFileName(left, right) {
        const leftName = baseName(left).toLowerCase();
        const rightName = baseName(right).toLowerCase();
        return leftName.length > 0 && leftName === rightName;
      }

      function baseName(value) {
        const text = String(value || "").replace(/[\\/]+/g, "/");
        const index = text.lastIndexOf("/");
        return index >= 0 ? text.slice(index + 1) : text;
      }

      function pad4(value) {
        value = String(value);
        while (value.length < 4) {
          value = "0" + value;
        }
        return value;
      }

      function errorToString(error) {
        return error && error.stack ? error.stack : String(error);
      }

      $("scanButton").addEventListener("click", scanPlan);
      $("buildAllButton").addEventListener("click", buildAll);
      $("buildAudioButton").addEventListener("click", buildAudioStage);
      $("buildPortraitsButton").addEventListener("click", buildPortraitsStage);
      $("generateSrtsButton").addEventListener("click", generateSrtsStage);
      $("clearButton").addEventListener("click", () => {
        state.plan = null;
        state.stage = createEmptyStage();
        state.routing = new Map();
        state.logLines = [];
        $("preview").textContent = "请选择输入后扫描计划。";
        $("log").textContent = "";
        renderStageStatus();
        setStatus("未扫描");
        updateButtons();
      });
      $("saveLogButton").addEventListener("click", saveLog);

      renderStageStatus();
      updateButtons();

      app.setFeatureApi("plan", {
        getPlan() {
          return requirePlan();
        },
        getRouting
      });

      async function saveLog() {
        try {
          const file = await localFileSystem.getFileForSaving(
            `build-timeline-plan-${timestampForFileName()}.log`,
            { types: ["log", "txt"] }
          );
          if (!file) {
            return;
          }

          await writeTextFile(file, state.logLines.join("\n") + "\n");
          setStatus(`日志已保存：${getNativePath(file) || file.name}`);
        } catch (error) {
          setStatus("保存日志失败");
          log(errorToString(error));
        }
      }

      async function writeTextFile(file, text) {
        try {
          await file.write(text, { format: storage.formats.utf8 });
        } catch (error) {
          await file.write(text);
        }
      }

      function getNativePath(file) {
        return file && (file.nativePath || file.fsName || file.path || "");
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
    }
  });
})(globalThis.ForkTranslationWorkflow);
