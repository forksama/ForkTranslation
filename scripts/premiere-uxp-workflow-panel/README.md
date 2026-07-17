# ForkTranslation Premiere Workflow Panel

Unified Premiere Pro UXP panel for the local ForkTranslation video workflow.

Tabs:

1. Input setup
2. Plan preview
3. Execute
4. Post-process

## Load

1. Open Premiere Pro 25.6 or newer.
2. Enable Developer Mode in Premiere Pro preferences and restart Premiere.
3. Open Adobe UXP Developer Tool.
4. Add this plugin manifest:
   `scripts/premiere-uxp-workflow-panel/manifest.json`
5. Load the plugin, then open the panel named `ForkTranslation Workflow`.

If you still see a single-purpose panel such as `Audio Prefix Importer`,
`Portrait Map Importer`, `PR Subtitles`, or `Image Bottom Pulse`, you opened
one of the old plugin manifests. The unified tabbed panel only appears from
`scripts/premiere-uxp-workflow-panel/manifest.json`.

Workflow:

1. In `1 输入准备`, choose the audio folder, mapping JSON, workdir, portrait
   directory, subtitle JSON, and SRT output folder.
2. In `2 计划预览`, run `Scan Plan` to compare the inputs and build the role
   routing table. This step does not require audio, portraits, or subtitles to
   already exist on the Premiere timeline.
3. In `3 执行生成`, run `Build All` or run the stages separately:
   `Build Audio + Markers`, `Build Portraits`, then `Generate Role SRTs`.
4. In `4 后处理`, run Image Pulse after the timeline has been built.

## Structure

```text
premiere-uxp-workflow-panel/
├── index.html                 # panel layout and script load order
├── index.js                   # tiny UXP entrypoint bootstrap
├── shared/workflow-app.js     # tab shell, lazy feature init, scoped DOM lookup
└── features/
    ├── audio-prefix-importer.js   # audio input and role-routed import API
    ├── portrait-map-importer.js   # mapping input and role-routed import API
    ├── pr-subtitles.js            # subtitle input and role SRT generation API
    ├── build-plan.js              # scan plan and staged workflow execution
    └── image-bottom-pulse.js      # post-process section
```

Each feature registers itself with `ForkTranslationWorkflow.registerFeature`.
The app shell initializes features lazily the first time their tab is opened.
A tab can initialize multiple features via `data-tab-features`; individual
feature sections use `data-feature-root`.

To add another workflow section, add its HTML block, load a feature script, and
register a new feature id.

This directory is the source of truth for the unified panel. It does not load,
import, generate from, or otherwise depend on the old single-purpose plugin
directories at runtime. Keep new workflow behavior inside `features/` and shared
panel behavior inside `shared/`.

The panel should stay project-agnostic: do not bake in absolute local paths,
thread-specific paths, or machine-specific assumptions. Use UXP file/folder
pickers, active Premiere project/sequence state, and user-entered options
instead.
