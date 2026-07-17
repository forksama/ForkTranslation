(function registerTrackTemplateCloner(app) {
  if (!app) {
    throw new Error("ForkTranslation workflow app shell is missing.");
  }

  app.registerFeature("clipclone", {
    init() {
      const ppro = require("premierepro");
      const { storage } = require("uxp");
      const localFileSystem = storage.localFileSystem;
      const TIME_TOLERANCE_SECONDS = 0.01;

      const state = {
        busy: false,
        logLines: []
      };

      function $(elementId) {
        return app.$("clipclone", elementId);
      }

      function setStatus(message) {
        $("status").textContent = message;
      }

      function log(message) {
        state.logLines.push(String(message));
        $("log").textContent = state.logLines.join("\n");
        $("log").scrollTop = $("log").scrollHeight;
      }

      function setBusy(busy) {
        state.busy = busy;
        $("runButton").disabled = busy;
        $("clearButton").disabled = busy;
        $("saveLogButton").disabled = busy;
      }

      async function run() {
        if (state.busy) {
          return;
        }

        setBusy(true);
        setStatus("正在批量复制片段");

        try {
          const options = readOptions();
          const project = await ppro.Project.getActiveProject();
          if (!project) {
            throw new Error("没有打开的 Premiere 项目。");
          }

          const sequence = await project.getActiveSequence();
          if (!sequence) {
            throw new Error("没有激活的序列。");
          }

          if (!ppro.SequenceEditor || typeof ppro.SequenceEditor.getEditor !== "function") {
            throw new Error("ppro.SequenceEditor.getEditor() 不可用。");
          }

          const editorResult = ppro.SequenceEditor.getEditor(sequence);
          const editor = editorResult && typeof editorResult.then === "function"
            ? await editorResult
            : editorResult;

          if (!editor || typeof editor.createCloneTrackItemAction !== "function") {
            throw new Error("SequenceEditor.createCloneTrackItemAction() 不可用。");
          }

          const template = await getSelectedTemplate(sequence);
          const templateInfo = await readClipInfo(template);
          const sourceTrackIndex = parseVideoTrackSpec(options.sourceTrackSpec, await sequence.getVideoTrackCount());
          const sourceItems = await collectSourceItems(sequence, sourceTrackIndex, template);
          if (sourceItems.length === 0) {
            throw new Error(`V${sourceTrackIndex + 1} 没有可匹配的视频片段。`);
          }

          const placements = [];
          for (const item of sourceItems) {
            const info = await readClipInfo(item);
            if (info.endSeconds > info.startSeconds) {
              placements.push(info);
            }
          }
          if (placements.length === 0) {
            throw new Error(`V${sourceTrackIndex + 1} 没有正时长的视频片段。`);
          }

          const target = await resolveTargetVideoTrack(sequence, options.targetTrackSpec, placements);
          await assertNoTargetOverlaps(sequence, target.index, placements);

          const maxDuration = Math.max.apply(null, placements.map((item) => item.durationSeconds));
          if (templateInfo.durationSeconds + TIME_TOLERANCE_SECONDS < maxDuration) {
            log(
              `提示：模板片段时长 ${formatSeconds(templateInfo.durationSeconds)} ` +
                `短于最长目标 ${formatSeconds(maxDuration)}，如果素材本身不够长，裁剪可能失败。`
            );
          }

          log("");
          log("Script: ForkTranslation Track Template Cloner");
          log(`Project: ${project.path || project.name || "(unsaved)"}`);
          log(`Sequence: ${safe(sequence.name)}`);
          log(`Template: ${templateInfo.name} on V${templateInfo.trackIndex + 1}`);
          log(`Source track: V${sourceTrackIndex + 1}`);
          log(`Target track: ${target.label}`);
          log(`Placements: ${placements.length}`);

          for (let index = 0; index < placements.length; index += 1) {
            const placement = placements[index];
            await cloneAndTrim({
              project,
              sequence,
              editor,
              template,
              templateInfo,
              targetIndex: target.index,
              placement,
              order: index + 1
            });
          }

          setStatus(`完成。已复制 ${placements.length} 个片段到 ${target.label}。`);
          log(`Done. Created ${placements.length} cloned clip(s) on ${target.label}.`);
        } catch (error) {
          setStatus("批量复制失败");
          log(errorToString(error));
        } finally {
          setBusy(false);
        }
      }

      function readOptions() {
        return {
          sourceTrackSpec: $("sourceTrackSpec").value.trim() || "V1",
          targetTrackSpec: $("targetTrackSpec").value.trim() || "auto"
        };
      }

      async function getSelectedTemplate(sequence) {
        if (typeof sequence.getSelection !== "function") {
          throw new Error("sequence.getSelection() 不可用。");
        }

        const selection = await sequence.getSelection();
        const items = selection && typeof selection.getTrackItems === "function"
          ? await selection.getTrackItems()
          : [];
        const videoItems = [];

        for (const item of items || []) {
          if (item && typeof item.getComponentChain === "function") {
            videoItems.push(item);
          }
        }

        if (videoItems.length !== 1) {
          throw new Error("请只选中一个要复制的模板视频段，并让它成为当前选中片段。");
        }

        return videoItems[0];
      }

      async function collectSourceItems(sequence, sourceTrackIndex, template) {
        const track = await sequence.getVideoTrack(sourceTrackIndex);
        const clips = getVideoClipItems(track);
        const items = [];

        for (const clip of clips) {
          if (clip === template) {
            continue;
          }
          items.push(clip);
        }

        return items;
      }

      async function readClipInfo(clip) {
        const startTime = await clip.getStartTime();
        const endTime = await clip.getEndTime();
        const startSeconds = Number(startTime && startTime.seconds);
        const endSeconds = Number(endTime && endTime.seconds);
        const trackIndex = typeof clip.getTrackIndex === "function"
          ? await clip.getTrackIndex()
          : -1;
        const name = typeof clip.getName === "function" ? await clip.getName() : "";

        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
          throw new Error(`无法读取片段时间：${name || "(unnamed)"}`);
        }

        return {
          clip,
          name,
          trackIndex,
          startTime,
          endTime,
          startSeconds,
          endSeconds,
          durationSeconds: endSeconds - startSeconds
        };
      }

      async function resolveTargetVideoTrack(sequence, spec, placements) {
        const videoTrackCount = await sequence.getVideoTrackCount();
        const text = String(spec || "auto").trim().toLowerCase();

        if (text === "auto") {
          for (let index = 0; index < videoTrackCount; index += 1) {
            if (await isVideoTrackEmpty(sequence, index)) {
              return {
                index,
                label: `V${index + 1}`
              };
            }
          }

          return {
            index: videoTrackCount,
            label: `V${videoTrackCount + 1} (new)`
          };
        }

        if (text === "new" || text === "+" || text === "create") {
          return {
            index: videoTrackCount,
            label: `V${videoTrackCount + 1} (new)`
          };
        }

        const index = parseVideoTrackSpec(text, videoTrackCount + 1);
        if (index > videoTrackCount) {
          throw new Error(`只能创建下一条视频轨道。当前视频轨道数：${videoTrackCount}。`);
        }

        return {
          index,
          label: index === videoTrackCount ? `V${index + 1} (new)` : `V${index + 1}`
        };
      }

      function parseVideoTrackSpec(spec, maxTrackCount) {
        const match = String(spec || "").trim().match(/^v?\s*(\d+)$/i);
        if (!match) {
          throw new Error("视频轨道必须使用 V1、V2 这样的格式，目标轨道也可以使用 auto 或 new。");
        }

        const number = Number(match[1]);
        if (!Number.isFinite(number) || Math.floor(number) !== number || number < 1 || number > maxTrackCount) {
          throw new Error(`视频轨道超出范围：V${number}。`);
        }

        return number - 1;
      }

      async function isVideoTrackEmpty(sequence, index) {
        const track = await sequence.getVideoTrack(index);
        return getVideoClipItems(track).length === 0;
      }

      async function assertNoTargetOverlaps(sequence, targetIndex, placements) {
        const videoTrackCount = await sequence.getVideoTrackCount();
        if (targetIndex >= videoTrackCount) {
          return;
        }

        const track = await sequence.getVideoTrack(targetIndex);
        const clips = getVideoClipItems(track);
        const existing = [];
        for (const clip of clips) {
          existing.push(await readClipInfo(clip));
        }

        for (const target of placements) {
          for (const clip of existing) {
            if (overlaps(target, clip)) {
              throw new Error(
                `目标轨道 V${targetIndex + 1} 已有重叠片段：` +
                  `${clip.name || "(unnamed)"} ${formatSeconds(clip.startSeconds)}-${formatSeconds(clip.endSeconds)}`
              );
            }
          }
        }
      }

      function overlaps(left, right) {
        return left.startSeconds < right.endSeconds - TIME_TOLERANCE_SECONDS &&
          right.startSeconds < left.endSeconds - TIME_TOLERANCE_SECONDS;
      }

      function getVideoClipItems(track) {
        const type = ppro.Constants && ppro.Constants.TrackItemType
          ? ppro.Constants.TrackItemType.CLIP
          : undefined;
        const clips = track.getTrackItems(type, false);
        return Array.prototype.slice.call(clips || []);
      }

      async function cloneAndTrim(context) {
        const targetStartSeconds = context.placement.startSeconds;
        const timeOffset = ppro.TickTime.createWithSeconds(
          targetStartSeconds - context.templateInfo.startSeconds
        );
        const videoTrackOffset = context.targetIndex - context.templateInfo.trackIndex;

        executeProjectTransaction(context.project, `Clone selected clip ${context.order}`, (compoundAction) => {
          compoundAction.addAction(
            context.editor.createCloneTrackItemAction(
              context.template,
              timeOffset,
              videoTrackOffset,
              0,
              true,
              false
            )
          );
        });

        await wait(250);

        const clone = await findClonedItem(
          context.sequence,
          context.targetIndex,
          context.placement.startSeconds,
          context.templateInfo.name
        );

        executeProjectTransaction(context.project, `Trim cloned clip ${context.order}`, (compoundAction) => {
          compoundAction.addAction(clone.createSetStartAction(context.placement.startTime));
          compoundAction.addAction(clone.createSetEndAction(context.placement.endTime));
        });

        log(
          `  ${context.order}. ${formatSeconds(context.placement.startSeconds)}-` +
            `${formatSeconds(context.placement.endSeconds)} -> V${context.targetIndex + 1}`
        );
      }

      async function findClonedItem(sequence, targetIndex, startSeconds, templateName) {
        const track = await sequence.getVideoTrack(targetIndex);
        const clips = getVideoClipItems(track);
        const candidates = [];

        for (const clip of clips) {
          const info = await readClipInfo(clip);
          if (Math.abs(info.startSeconds - startSeconds) <= TIME_TOLERANCE_SECONDS) {
            if (!templateName || info.name === templateName) {
              candidates.push(info);
            }
          }
        }

        if (candidates.length === 0) {
          throw new Error(`没有找到刚复制的片段：${formatSeconds(startSeconds)}。`);
        }

        candidates.sort((left, right) => right.endSeconds - left.endSeconds);
        return candidates[0].clip;
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

      function wait(milliseconds) {
        return new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        });
      }

      function formatSeconds(seconds) {
        return `${Math.round(Number(seconds) * 1000) / 1000}s`;
      }

      function safe(value) {
        return value === undefined || value === null ? "" : String(value);
      }

      function errorToString(error) {
        return error && error.stack ? error.stack : String(error);
      }

      async function saveLog() {
        try {
          const file = await localFileSystem.getFileForSaving(
            `track-template-cloner-${timestampForFileName()}.log`,
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
          log(errorToString(error));
        }
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

      $("runButton").addEventListener("click", run);
      $("clearButton").addEventListener("click", () => {
        state.logLines = [];
        $("log").textContent = "";
        setStatus("待机");
      });
      $("saveLogButton").addEventListener("click", saveLog);
    }
  });
})(globalThis.ForkTranslationWorkflow);
