/* global require */

(function bootWorkflowPanel(app) {
  if (!app) {
    throw new Error("ForkTranslation workflow app shell is missing.");
  }

  const { entrypoints } = require("uxp");

  app.setupTabs({
    entrypoints,
    panelId: "workflowPanel",
    defaultTab: "input"
  });
})(globalThis.ForkTranslationWorkflow);
