// ==UserScript==
// @name         ForkTranslation Animanch Source Exporter
// @namespace    https://github.com/fork/ForkTranslation
// @version      0.1.0
// @description  Select and label Animanch thread posts, then export source-A.md for ForkTranslation.
// @match        https://bbs.animanch.com/board/*
// @match        http://bbs.animanch.com/board/*
// @match        file:///*
// @include      https://bbs.animanch.com/board/*
// @include      http://bbs.animanch.com/board/*
// @include      file:///*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  console.log("[ForkTranslation] userscript loaded:", location.href);

  const ROOT_SELECTOR = "#resList > li[id^='res']";
  const DELETED_TEXT = "このレスは削除されています";
  const ROLE_STORAGE_KEY = "forktranslation.animanch.rolePresets";
  const DEFAULT_ROLE_PRESETS = [
    "楼主",
    "回复者1",
    "回复者2",
    "回复者3",
    "回复者4",
    "回复者5",
    "回复者6",
    "回复者7",
    "回复者8",
    "回复者9",
  ];
  let rolePresets = loadRolePresets();
  let activePost = null;

  let posts = [];
  waitForPosts();

  function waitForPosts(attempt = 0) {
    posts = Array.from(document.querySelectorAll(ROOT_SELECTOR));
    if (!posts.length) {
      if (attempt < 60) {
        window.setTimeout(() => waitForPosts(attempt + 1), 500);
      } else {
        console.warn("[ForkTranslation] resList posts were not found.");
      }
      return;
    }
    if (document.getElementById("ft-export-panel")) {
      return;
    }

    console.info(`[ForkTranslation] Found ${posts.length} posts. Initializing exporter.`);
    injectStyles();
    injectRoleDatalist();
    posts.forEach((post) => addPostControls(post));
    addPanel();
    updateSelectedCount();
  }

  function addPostControls(post) {
    const header = post.querySelector(".resheader") || post;
    const body = post.querySelector(".resbody");
    const isDeleted = isDeletedPost(post);
    post.setAttribute("tabindex", "0");

    const controls = document.createElement("span");
    controls.className = "ft-post-tools";
    controls.innerHTML = `
      <label class="ft-check-label">
        <input class="ft-select" type="checkbox">
        导出
      </label>
      <label class="ft-role-label">
        角色
        <input class="ft-role" type="text" list="ft-role-presets" value="${escapeAttr(rolePresets[0] || "楼主")}">
      </label>
    `;
    header.appendChild(controls);

    if (isDeleted) {
      post.classList.add("ft-post-deleted");
    }
    if (body) {
      body.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, textarea, select, label")) return;
        setActivePost(post);
        const checkbox = post.querySelector(".ft-select");
        checkbox.checked = !checkbox.checked;
        updateSelectedCount();
      });
    }

    post.addEventListener("click", () => setActivePost(post));
    post.addEventListener("focusin", () => setActivePost(post));
    post.addEventListener("mouseenter", () => setActivePost(post));
    post.querySelector(".ft-select").addEventListener("change", updateSelectedCount);
    post.querySelector(".ft-role").addEventListener("input", updateSelectedCount);
  }

  function addPanel() {
    const panel = document.createElement("div");
    panel.id = "ft-export-panel";
    panel.innerHTML = `
      <div class="ft-title">ForkTranslation 导出</div>
      <div class="ft-row ft-muted" id="ft-selected-count"></div>
      <div class="ft-row">
        <button type="button" id="ft-download">下载</button>
        <button type="button" id="ft-copy">复制</button>
      </div>
      <div class="ft-row">
        <button type="button" id="ft-select-all">全选非删除</button>
        <button type="button" id="ft-clear">清空</button>
      </div>
      <div class="ft-row">
        <input id="ft-range" type="text" placeholder="1-6,11-20,22">
        <button type="button" id="ft-select-range">按范围选择</button>
      </div>
      <div class="ft-row">
        <input id="ft-bulk-role" type="text" list="ft-role-presets" value="楼主">
        <button type="button" id="ft-apply-role">应用到已选</button>
      </div>
      <div class="ft-role-manager">
        <div class="ft-role-manager-title">角色列表</div>
        <div id="ft-role-list"></div>
        <div class="ft-row">
          <input id="ft-new-role" type="text" list="ft-role-presets" placeholder="新增角色">
          <button type="button" id="ft-add-role">添加</button>
        </div>
      </div>
      <div class="ft-row ft-muted">快捷键：当前楼按数字键，按角色列表顺序套用。</div>
      <div class="ft-row ft-muted">图片不会导出；正文里的 &gt;&gt;N 会保留。</div>
    `;
    document.body.appendChild(panel);

    document.getElementById("ft-download").addEventListener("click", downloadMarkdown);
    document.getElementById("ft-copy").addEventListener("click", copyMarkdown);
    document.getElementById("ft-select-all").addEventListener("click", () => {
      posts.forEach((post) => {
        post.querySelector(".ft-select").checked = !isDeletedPost(post);
      });
      updateSelectedCount();
    });
    document.getElementById("ft-clear").addEventListener("click", () => {
      posts.forEach((post) => {
        post.querySelector(".ft-select").checked = false;
      });
      updateSelectedCount();
    });
    document.getElementById("ft-select-range").addEventListener("click", () => {
      const floors = parseFloorSet(document.getElementById("ft-range").value);
      posts.forEach((post) => {
        post.querySelector(".ft-select").checked = floors.has(getFloor(post));
      });
      updateSelectedCount();
    });
    document.getElementById("ft-apply-role").addEventListener("click", () => {
      const role = document.getElementById("ft-bulk-role").value.trim();
      if (!role) return;
      addRolePreset(role);
      getSelectedPosts().forEach((post) => {
        post.querySelector(".ft-role").value = role;
      });
      updateSelectedCount();
    });
    document.getElementById("ft-add-role").addEventListener("click", () => {
      const input = document.getElementById("ft-new-role");
      const role = input.value.trim();
      if (!role) return;
      addRolePreset(role);
      document.getElementById("ft-bulk-role").value = role;
      input.value = "";
    });
    document.getElementById("ft-new-role").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      document.getElementById("ft-add-role").click();
      event.preventDefault();
    });
    document.getElementById("ft-role-list").addEventListener("click", handleRoleListClick);
    document.getElementById("ft-role-list").addEventListener("change", handleRoleListChange);
    document.addEventListener("keydown", handleRoleHotkey);
    renderRoleManager();
  }

  function buildMarkdown() {
    const selected = getSelectedPosts();
    const sourceUrl = getSourceUrl();
    const title = getThreadTitle();
    const boardId = getBoardId(sourceUrl);
    const idByFloor = new Map();

    selected.forEach((post, index) => {
      idByFloor.set(getFloor(post), formatPostId(index + 1));
    });

    const lines = [
      "---",
      "schema: fork-thread-source/v1",
      "domain: gakumasu",
      "source_site: animanch",
      `source_url: ${yamlString(sourceUrl)}`,
      `thread_title: ${yamlString(title)}`,
      `board_id: ${yamlString(boardId)}`,
      `capture_date: ${yamlString(formatDate(new Date()))}`,
      "source_language: ja",
      "selected_by: userscript",
      'role_policy: "roles were assigned manually in the userscript UI"',
      "---",
      "",
      "# thread",
      "",
    ];

    selected.forEach((post, index) => {
      const floor = getFloor(post);
      const postId = formatPostId(index + 1);
      const references = getReferenceFloors(post);
      const replyTo = references
        .map((refFloor) => idByFloor.get(refFloor))
        .filter(Boolean);
      const text = extractPostText(post);
      const tags = getTags(post);

      lines.push(`## post: ${postId}`);
      lines.push(`floor: ${floor}`);
      lines.push(`role: ${yamlString(getRole(post))}`);
      lines.push(`kind: ${yamlString(getKind(post))}`);
      lines.push(`reply_to: ${yamlArray(replyTo)}`);
      lines.push(`reply_to_floors: ${yamlArray(references)}`);
      lines.push(`time: ${yamlString(getPostedTime(post))}`);
      lines.push(`source_url: ${yamlString(makePostUrl(sourceUrl, floor))}`);
      lines.push(`tags: ${yamlArray(tags)}`);
      lines.push("");
      lines.push(markdownFence(text || DELETED_TEXT, "ja"));
      lines.push("");
    });

    return lines.join("\n");
  }

  function getSelectedPosts() {
    return posts.filter((post) => post.querySelector(".ft-select")?.checked);
  }

  function getFloor(post) {
    const numberText =
      post.querySelector(".resnumber")?.textContent?.trim() ||
      post.id?.replace(/^res/, "") ||
      "";
    return Number(numberText) || 0;
  }

  function getRole(post) {
    return post.querySelector(".ft-role")?.value.trim() || "回复者1";
  }

  function getKind(post) {
    if (isDeletedPost(post)) return "deleted-note";
    return getFloor(post) === 1 ? "post" : "reply";
  }

  function getTags(post) {
    const tags = [];
    if (getFloor(post) === 1) tags.push("opening");
    if (isDeletedPost(post)) tags.push("deleted");
    if (getReferenceFloors(post).length) tags.push("has-reference");
    return tags;
  }

  function getPostedTime(post) {
    return post.querySelector(".resposted")?.textContent?.trim() || "";
  }

  function isDeletedPost(post) {
    const body = post.querySelector(".resbody");
    return Boolean(
      body?.classList.contains("disabled") ||
        body?.textContent?.includes(DELETED_TEXT)
    );
  }

  function getReferenceFloors(post) {
    const body = clonePostBody(post);
    body.querySelectorAll(".reply").forEach((node) => node.remove());
    const refs = new Set();
    body.querySelectorAll("a.reslink").forEach((link) => {
      const raw = `${link.textContent || ""} ${link.getAttribute("href") || ""}`;
      const match = raw.match(/res(\d+)|>>\s*(\d+)/);
      if (match) refs.add(Number(match[1] || match[2]));
    });
    return Array.from(refs).filter(Boolean).sort((a, b) => a - b);
  }

  function extractPostText(post) {
    const body = clonePostBody(post);
    body.querySelectorAll(".reply, .thumb, img, script, style, button, .ft-post-tools").forEach((node) => {
      node.remove();
    });
    const text = domToText(body);
    return normalizeText(text);
  }

  function clonePostBody(post) {
    return (post.querySelector(".resbody") || post).cloneNode(true);
  }

  function domToText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return "";
    }

    const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName.toLowerCase() : "";
    if (tag === "br") return "\n";

    let text = "";
    node.childNodes.forEach((child) => {
      text += domToText(child);
    });

    if (["p", "div", "li", "blockquote", "section"].includes(tag)) {
      text += "\n";
    }
    return text;
  }

  function normalizeText(text) {
    return text
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getThreadTitle() {
    const titleNode = document.querySelector("#threadTitle");
    if (titleNode) {
      const clone = titleNode.cloneNode(true);
      clone.querySelectorAll(".shareBtns").forEach((node) => node.remove());
      const title = clone.textContent.trim();
      if (title) return title;
    }
    return document.title.replace(/\s*[|｜]\s*あにまん掲示板\s*$/, "").trim();
  }

  function getSourceUrl() {
    const canonical = document.querySelector("link[rel='canonical']")?.href;
    const ogUrl = document.querySelector("meta[property='og:url']")?.content;
    return canonical || ogUrl || location.href.split("#")[0];
  }

  function getBoardId(url) {
    const match = String(url).match(/\/board\/(\d+)/);
    return match ? match[1] : "";
  }

  function makePostUrl(sourceUrl, floor) {
    const base = String(sourceUrl || location.href).split("#")[0];
    return `${base}#res${floor}`;
  }

  function formatPostId(index) {
    return `P${String(index).padStart(4, "0")}`;
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function yamlString(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function yamlArray(values) {
    if (!values || !values.length) return "[]";
    return `[${values.map((value) => (typeof value === "number" ? String(value) : yamlString(value))).join(", ")}]`;
  }

  function markdownFence(text, language) {
    const matches = String(text).match(/`{3,}/g) || [];
    const maxFence = matches.reduce((max, run) => Math.max(max, run.length), 2);
    const fence = "`".repeat(maxFence + 1);
    return `${fence}${language}\n${text}\n${fence}`;
  }

  function parseFloorSet(value) {
    const result = new Set();
    String(value)
      .split(/[,\s，、]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const range = part.match(/^(\d+)\s*[-~ー]\s*(\d+)$/);
        if (range) {
          const start = Number(range[1]);
          const end = Number(range[2]);
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let floor = min; floor <= max; floor += 1) {
            result.add(floor);
          }
          return;
        }
        const single = Number(part);
        if (single) result.add(single);
      });
    return result;
  }

  function downloadMarkdown() {
    const markdown = buildMarkdown();
    const filename = makeFilename();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyMarkdown() {
    const button = document.getElementById("ft-copy");
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      flashButton(button, "已复制");
    } catch (error) {
      console.error(error);
      flashButton(button, "复制失败");
    }
  }

  function makeFilename() {
    const boardId = getBoardId(getSourceUrl()) || "thread";
    const title = getThreadTitle()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 40);
    return `${boardId}-${title || "source"}-source-A.md`;
  }

  function updateSelectedCount() {
    const selected = getSelectedPosts();
    const countNode = document.getElementById("ft-selected-count");
    if (countNode) {
      const activeText = activePost ? `；当前楼 ${getFloor(activePost)}` : "";
      countNode.textContent = `已选 ${selected.length} / ${posts.length} 楼${activeText}`;
    }

    posts.forEach((post) => {
      post.classList.toggle("ft-post-selected", post.querySelector(".ft-select")?.checked);
    });
  }

  function setActivePost(post) {
    if (!post || activePost === post) return;
    if (activePost) activePost.classList.remove("ft-post-active");
    activePost = post;
    activePost.classList.add("ft-post-active");
    updateSelectedCount();
  }

  function handleRoleHotkey(event) {
    if (!activePost || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isEditableTarget(event.target)) return;
    if (!/^[0-9]$/.test(event.key)) return;

    const role = rolePresets[Number(event.key)];
    if (!role) return;
    activePost.querySelector(".ft-role").value = role;
    updateSelectedCount();
    event.preventDefault();
  }

  function isEditableTarget(target) {
    return Boolean(
      target?.closest?.("input, textarea, select, button, [contenteditable='true']")
    );
  }

  function loadRolePresets() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(ROLE_STORAGE_KEY) || "null");
    } catch (error) {
      saved = null;
    }
    if (Array.isArray(saved) && saved.length) {
      return uniqueRoles(saved);
    }
    return [...DEFAULT_ROLE_PRESETS];
  }

  function saveRolePresets() {
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(rolePresets));
    } catch (error) {
      console.warn("[ForkTranslation] Failed to save role presets.", error);
    }
  }

  function addRolePreset(role) {
    const normalized = String(role || "").trim();
    if (!normalized) return;
    if (!rolePresets.includes(normalized)) {
      rolePresets.push(normalized);
      saveRolePresets();
      updateRoleDatalist();
      renderRoleManager();
    }
  }

  function renameRolePreset(index, role) {
    const normalized = String(role || "").trim();
    const current = rolePresets[index];
    if (!current) return;
    if (!normalized) {
      renderRoleManager();
      return;
    }
    const duplicateIndex = rolePresets.findIndex((value, valueIndex) => {
      return value === normalized && valueIndex !== index;
    });
    if (duplicateIndex !== -1) {
      renderRoleManager();
      return;
    }

    rolePresets[index] = normalized;
    saveRolePresets();
    updateRoleDatalist();
    updateAssignedRoleNames(current, normalized);
    renderRoleManager();
  }

  function deleteRolePreset(index) {
    if (rolePresets.length <= 1) return;
    rolePresets.splice(index, 1);
    saveRolePresets();
    updateRoleDatalist();
    renderRoleManager();
  }

  function moveRolePreset(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rolePresets.length) return;
    const role = rolePresets[index];
    rolePresets[index] = rolePresets[target];
    rolePresets[target] = role;
    saveRolePresets();
    updateRoleDatalist();
    renderRoleManager();
  }

  function updateAssignedRoleNames(oldRole, newRole) {
    posts.forEach((post) => {
      const input = post.querySelector(".ft-role");
      if (input?.value === oldRole) {
        input.value = newRole;
      }
    });
  }

  function handleRoleListClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest(".ft-role-row");
    const index = Number(row?.dataset.index);
    if (!Number.isInteger(index)) return;

    const action = button.dataset.action;
    if (action === "up") moveRolePreset(index, -1);
    if (action === "down") moveRolePreset(index, 1);
    if (action === "delete") deleteRolePreset(index);
  }

  function handleRoleListChange(event) {
    const input = event.target.closest(".ft-role-name");
    if (!input) return;
    const row = input.closest(".ft-role-row");
    const index = Number(row?.dataset.index);
    if (!Number.isInteger(index)) return;
    renameRolePreset(index, input.value);
  }

  function renderRoleManager() {
    const list = document.getElementById("ft-role-list");
    if (!list) return;
    list.innerHTML = rolePresets
      .map((role, index) => {
        const hotkey = index <= 9 ? String(index) : "";
        return `
          <div class="ft-role-row" data-index="${index}">
            <span class="ft-hotkey">${escapeAttr(hotkey)}</span>
            <input class="ft-role-name" type="text" value="${escapeAttr(role)}">
            <button type="button" data-action="up" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-action="down" title="下移" ${index === rolePresets.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" data-action="delete" title="删除" ${rolePresets.length <= 1 ? "disabled" : ""}>×</button>
          </div>
        `;
      })
      .join("");
  }

  function uniqueRoles(values) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  }

  function flashButton(button, text) {
    if (!button) return;
    const oldText = button.textContent;
    button.textContent = text;
    window.setTimeout(() => {
      button.textContent = oldText;
    }, 1200);
  }

  function injectRoleDatalist() {
    const datalist = document.createElement("datalist");
    datalist.id = "ft-role-presets";
    document.body.appendChild(datalist);
    updateRoleDatalist();
  }

  function updateRoleDatalist() {
    const datalist = document.getElementById("ft-role-presets");
    if (!datalist) return;
    datalist.innerHTML = rolePresets.map((role) => `<option value="${escapeAttr(role)}"></option>`).join("");
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #ft-export-panel {
        position: fixed;
        z-index: 99999;
        right: 12px;
        top: 80px;
        width: 320px;
        padding: 10px;
        color: #1f2933;
        background: #fff;
        border: 1px solid #9aa5b1;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
        font-size: 13px;
        line-height: 1.4;
      }
      #ft-export-panel .ft-title {
        font-weight: 700;
        margin-bottom: 8px;
      }
      #ft-export-panel .ft-row {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-top: 6px;
      }
      #ft-export-panel .ft-muted {
        color: #52606d;
        font-size: 12px;
      }
      #ft-export-panel button {
        flex: 1;
        min-width: 0;
        padding: 4px 6px;
        border: 1px solid #8d99a6;
        border-radius: 4px;
        background: #f5f7fa;
        cursor: pointer;
      }
      #ft-export-panel input {
        min-width: 0;
        flex: 1;
        padding: 4px 6px;
        border: 1px solid #8d99a6;
        border-radius: 4px;
      }
      .ft-post-tools {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        margin-left: 10px;
        padding: 2px 6px;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
        background: #f5f7fa;
        color: #1f2933;
        font-size: 12px;
        vertical-align: middle;
      }
      .ft-post-tools input[type="text"] {
        width: 110px;
        padding: 1px 4px;
        border: 1px solid #9aa5b1;
        border-radius: 3px;
      }
      .ft-role-manager {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid #d9e2ec;
      }
      .ft-role-manager-title {
        margin-bottom: 4px;
        color: #52606d;
        font-size: 12px;
        font-weight: 700;
      }
      .ft-role-row {
        display: grid;
        grid-template-columns: 18px minmax(120px, 1fr) 28px 28px 28px;
        gap: 4px;
        align-items: center;
        margin-top: 4px;
      }
      .ft-role-row .ft-role-name {
        width: 100%;
      }
      .ft-role-row button {
        padding: 2px 0;
      }
      .ft-role-row button:disabled {
        cursor: default;
        opacity: 0.45;
      }
      .ft-hotkey {
        color: #52606d;
        font-size: 12px;
        text-align: center;
      }
      .ft-post-selected {
        outline: 2px solid #2f80ed;
        outline-offset: -2px;
      }
      .ft-post-deleted {
        opacity: 0.72;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
