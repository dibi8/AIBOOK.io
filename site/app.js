(() => {
  const STORAGE_KEY = "dibi8_notes_v1";

  const newNoteBtn = document.getElementById("newNoteBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  const deleteBtn = document.getElementById("deleteBtn");
  const searchInput = document.getElementById("searchInput");
  const notesList = document.getElementById("notesList");
  const contentInput = document.getElementById("contentInput");
  const updatedAtEl = document.getElementById("updatedAt");

  const nowISO = () => new Date().toISOString();
  const safeJSONParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const generateId = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  const normalizeNote = (note) => {
    if (!note || typeof note !== "object") return null;
    if (typeof note.id !== "string" || note.id.length < 8) return null;
    const content = typeof note.content === "string" ? note.content : "";
    const createdAt = typeof note.createdAt === "string" ? note.createdAt : nowISO();
    const updatedAt = typeof note.updatedAt === "string" ? note.updatedAt : createdAt;
    return { id: note.id, content, createdAt, updatedAt };
  };

  const defaultState = () => {
    const first = {
      id: generateId(),
      content: "欢迎使用 Notes\n\n- 全部内容都保存在你的浏览器本地（localStorage）\n- 不依赖服务器\n- 可导入/导出 JSON\n",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    return { notes: [first], activeId: first.id, query: "" };
  };

  const loadState = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? safeJSONParse(raw) : null;
    if (!parsed || typeof parsed !== "object") return defaultState();

    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(normalizeNote).filter(Boolean) : [];
    if (notes.length === 0) return defaultState();

    const activeId =
      typeof parsed.activeId === "string" && notes.some((n) => n.id === parsed.activeId) ? parsed.activeId : notes[0].id;
    const query = typeof parsed.query === "string" ? parsed.query : "";

    return { notes, activeId, query };
  };

  const saveState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  const state = loadState();

  const getActiveNote = () => state.notes.find((n) => n.id === state.activeId) || null;

  const summarize = (content) => {
    const text = String(content || "").replace(/\r/g, "").trim();
    if (!text) return { title: "未命名", preview: "" };
    const lines = text.split("\n");
    const firstLine = lines.find((l) => l.trim().length > 0) || "";
    const title = firstLine.trim().slice(0, 40) || "未命名";
    const preview = text.slice(firstLine.length).trim().replace(/\s+/g, " ").slice(0, 120);
    return { title, preview };
  };

  const formatUpdatedAt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `更新时间：${d.toLocaleString()}`;
  };

  const compareByUpdatedDesc = (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

  const matchesQuery = (note, query) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (note.content || "").toLowerCase().includes(q);
  };

  const renderList = () => {
    const query = state.query.trim();
    const visible = state.notes
      .slice()
      .sort(compareByUpdatedDesc)
      .filter((n) => matchesQuery(n, query));

    notesList.innerHTML = "";

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "noteItem";
      empty.style.cursor = "default";
      empty.innerHTML = `<div class="noteTitle">没有结果</div><div class="notePreview">换个关键词试试</div>`;
      notesList.appendChild(empty);
      return;
    }

    for (const note of visible) {
      const { title, preview } = summarize(note.content);
      const item = document.createElement("div");
      item.className = "noteItem" + (note.id === state.activeId ? " active" : "");
      item.setAttribute("role", "listitem");
      item.dataset.id = note.id;
      item.innerHTML = `<div class="noteTitle"></div><div class="notePreview"></div>`;
      item.querySelector(".noteTitle").textContent = title;
      item.querySelector(".notePreview").textContent = preview;
      item.addEventListener("click", () => {
        if (state.activeId === note.id) return;
        state.activeId = note.id;
        saveState();
        render();
        contentInput.focus();
      });
      notesList.appendChild(item);
    }
  };

  const renderEditor = () => {
    const note = getActiveNote();
    if (!note) {
      contentInput.value = "";
      updatedAtEl.textContent = "";
      contentInput.disabled = true;
      deleteBtn.disabled = true;
      return;
    }

    contentInput.disabled = false;
    deleteBtn.disabled = false;
    contentInput.value = note.content || "";
    updatedAtEl.textContent = formatUpdatedAt(note.updatedAt);
  };

  const render = () => {
    searchInput.value = state.query;
    renderList();
    renderEditor();
  };

  const createNote = () => {
    const n = { id: generateId(), content: "", createdAt: nowISO(), updatedAt: nowISO() };
    state.notes.unshift(n);
    state.activeId = n.id;
    saveState();
    render();
    contentInput.focus();
  };

  const deleteActive = () => {
    const note = getActiveNote();
    if (!note) return;
    const ok = confirm("确定删除这条笔记？此操作不可恢复。");
    if (!ok) return;
    const idx = state.notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) state.notes.splice(idx, 1);
    if (state.notes.length === 0) {
      const fresh = defaultState();
      state.notes = fresh.notes;
      state.activeId = fresh.activeId;
      state.query = "";
    } else {
      state.activeId = state.notes[0].id;
    }
    saveState();
    render();
  };

  let saveTimer = null;
  const scheduleSaveContent = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const note = getActiveNote();
      if (!note) return;
      note.content = contentInput.value || "";
      note.updatedAt = nowISO();
      saveState();
      updatedAtEl.textContent = formatUpdatedAt(note.updatedAt);
      renderList();
    }, 200);
  };

  const download = (filename, text) => {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportData = () => {
    const payload = {
      exportedAt: nowISO(),
      version: 1,
      notes: state.notes,
    };
    download(`notes-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  };

  const importData = async (file) => {
    const text = await file.text();
    const parsed = safeJSONParse(text);
    if (!parsed || typeof parsed !== "object") {
      alert("导入失败：不是有效的 JSON。");
      return;
    }

    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(normalizeNote).filter(Boolean) : [];
    if (notes.length === 0) {
      alert("导入失败：没有可用的 notes 数据。");
      return;
    }

    const merge = confirm("导入会覆盖当前所有笔记（更简单、更安全）。确定继续？");
    if (!merge) return;

    state.notes = notes;
    state.activeId = notes[0].id;
    state.query = "";
    saveState();
    render();
  };

  newNoteBtn.addEventListener("click", createNote);
  deleteBtn.addEventListener("click", deleteActive);
  exportBtn.addEventListener("click", exportData);

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    importInput.value = "";
    if (!file) return;
    try {
      await importData(file);
    } catch {
      alert("导入失败：读取文件出错。");
    }
  });

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value || "";
    saveState();
    renderList();
  });

  contentInput.addEventListener("input", scheduleSaveContent);

  window.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (mod && e.key.toLowerCase() === "n") {
      e.preventDefault();
      createNote();
      return;
    }

    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
  });

  render();
})();
