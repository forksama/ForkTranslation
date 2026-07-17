(function createWorkflowApp(global) {
  const features = new Map();
  const featureApis = new Map();
  let activeTab = "";

  function registerFeature(id, feature) {
    if (!id) {
      throw new Error("Feature id is required.");
    }
    if (!feature || typeof feature.init !== "function") {
      throw new Error(`Feature ${id} must provide an init() function.`);
    }
    if (features.has(id)) {
      throw new Error(`Feature ${id} is already registered.`);
    }

    features.set(id, {
      id,
      init: feature.init,
      initialized: false
    });
  }

  function setFeatureApi(id, api) {
    if (!id || !api) {
      throw new Error("Feature API id and api are required.");
    }

    featureApis.set(id, api);
  }

  function getFeatureApi(id) {
    const api = featureApis.get(id);
    if (!api) {
      throw new Error(`Feature API is not available: ${id}`);
    }

    return api;
  }

  function setupTabs(options) {
    const config = options || {};
    const entrypoints = config.entrypoints;
    if (!entrypoints || typeof entrypoints.setup !== "function") {
      throw new Error("UXP entrypoints API is unavailable.");
    }

    const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
    const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
    activeTab = config.defaultTab || (tabButtons[0] && tabButtons[0].dataset.tabTarget) || "";

    function activateTab(tabName) {
      activeTab = tabName || activeTab;

      for (const button of tabButtons) {
        const active = button.dataset.tabTarget === activeTab;
        button.classList.toggle("active", active);
        button.tabIndex = active ? 0 : -1;
      }

      for (const panel of tabPanels) {
        panel.hidden = panel.dataset.tabPanel !== activeTab;
      }

      for (const featureId of featureIdsForTab(activeTab, tabPanels)) {
        ensureFeature(featureId);
      }
    }

    for (const button of tabButtons) {
      button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
    }
    setupLogToggles();
    setupPreviewToggles();

    entrypoints.setup({
      panels: {
        [config.panelId || "workflowPanel"]: {
          show() {
            activateTab(activeTab);
          }
        }
      }
    });

    activateTab(activeTab);
  }

  function setupLogToggles() {
    const toggles = Array.from(document.querySelectorAll("[data-log-toggle]"));

    for (const toggle of toggles) {
      toggle.addEventListener("click", () => {
        const section = toggle.closest(".logSection");
        const log = section ? section.querySelector("pre") : null;
        if (!log) {
          return;
        }

        const nextHidden = !log.hidden;
        log.hidden = nextHidden;
        section.classList.toggle("logOpen", !nextHidden);
      });
    }
  }

  function setupPreviewToggles() {
    const toggles = Array.from(document.querySelectorAll("[data-preview-toggle]"));

    for (const toggle of toggles) {
      toggle.addEventListener("click", () => {
        const section = toggle.closest(".previewSection");
        const preview = section
          ? section.querySelector("pre, .routingPreview")
          : null;
        if (!preview) {
          return;
        }

        const nextHidden = !preview.hidden;
        preview.hidden = nextHidden;
        section.classList.toggle("previewOpen", !nextHidden);
      });
    }
  }

  function ensureFeature(id) {
    const feature = features.get(id);
    if (!feature || feature.initialized) {
      return;
    }

    feature.initialized = true;
    feature.init();
  }

  function featureIdsForTab(tabName, tabPanels) {
    const panel = tabPanels.find((item) => item.dataset.tabPanel === tabName);
    const source = panel && panel.dataset.tabFeatures ? panel.dataset.tabFeatures : tabName;

    return source
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function featureRoot(featureId) {
    const root =
      document.querySelector(`[data-feature-root="${featureId}"]`) ||
      document.querySelector(`[data-tab-panel="${featureId}"]`);
    if (!root) {
      throw new Error(`Missing feature root: ${featureId}`);
    }
    return root;
  }

  function getElement(featureId, elementId) {
    const domId = `${featureId}-${elementId}`;
    const element = document.getElementById(domId);
    if (!element) {
      throw new Error(`Missing UI element: ${domId}`);
    }
    return element;
  }

  global.ForkTranslationWorkflow = {
    registerFeature,
    setFeatureApi,
    getFeatureApi,
    setupTabs,
    featureRoot,
    $: getElement
  };
})(globalThis);
