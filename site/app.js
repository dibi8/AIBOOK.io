(() => {
  const STORAGE_KEY = "dibi8_notes_v1";
  const SYNC_KEY_STORAGE = "dibi8_notes_sync_key_v1";

  const newNoteBtn = document.getElementById("newNoteBtn");
  const syncBtn = document.getElementById("syncBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  const deleteBtn = document.getElementById("deleteBtn");
  const searchInput = document.getElementById("searchInput");
  const notesList = document.getElementById("notesList");
  const contentInput = document.getElementById("contentInput");
  const updatedAtEl = document.getElementById("updatedAt");
  const syncStatusEl = document.getElementById("syncStatus");

  const nowISO = () => new Date().toISOString();
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };
  const fromB64 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };
  const sha256Hex = async (text) => {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", enc.encode(text));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  };
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

  const deriveKey = async (password, salt, iterations) => {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  };

  const encryptText = async (password, plaintext) => {
    const enc = new TextEncoder();
    const salt = new Uint8Array(16);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(salt);
    crypto.getRandomValues(iv);
    const iterations = 150000;
    const key = await deriveKey(password, salt, iterations);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
    return {
      encrypted: true,
      v: 1,
      kdf: "PBKDF2-SHA256",
      iterations,
      salt: toB64(salt.buffer),
      iv: toB64(iv.buffer),
      ct: toB64(ct),
    };
  };

  const decryptText = async (password, payload) => {
    if (!payload || payload.encrypted !== true) throw new Error("not-encrypted");
    const iterations = Number(payload.iterations);
    if (!Number.isFinite(iterations) || iterations < 1) throw new Error("bad-iterations");
    const salt = new Uint8Array(fromB64(payload.salt));
    const iv = new Uint8Array(fromB64(payload.iv));
    const ct = fromB64(payload.ct);
    const key = await deriveKey(password, salt, iterations);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
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
  let syncKey = localStorage.getItem(SYNC_KEY_STORAGE) || "";
  let syncInFlight = false;
  let syncQueued = false;
  let lastSyncAt = "";
  let lastSyncError = "";
  let lastServerUpdatedAt = "";

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
      syncStatusEl.textContent = "";
      contentInput.disabled = true;
      deleteBtn.disabled = true;
      return;
    }

    contentInput.disabled = false;
    deleteBtn.disabled = false;
    contentInput.value = note.content || "";
    updatedAtEl.textContent = formatUpdatedAt(note.updatedAt);
    syncStatusEl.textContent = getSyncStatusText();
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

  const getSyncStatusText = () => {
    if (!syncKey) return "同步：未启用";
    if (syncInFlight) return "同步：进行中...";
    if (lastSyncError) return `同步：失败（${lastSyncError}）`;
    if (lastSyncAt) return `同步：已完成（${new Date(lastSyncAt).toLocaleString()}）`;
    return "同步：已启用";
  };

  const serializeForSync = () => {
    return {
      version: 1,
      notes: state.notes,
      activeId: state.activeId,
    };
  };

  const mergeStates = (a, b) => {
    const aNotes = Array.isArray(a?.notes) ? a.notes.map(normalizeNote).filter(Boolean) : [];
    const bNotes = Array.isArray(b?.notes) ? b.notes.map(normalizeNote).filter(Boolean) : [];
    const map = new Map();
    for (const n of aNotes) map.set(n.id, n);
    for (const n of bNotes) {
      const prev = map.get(n.id);
      if (!prev) {
        map.set(n.id, n);
        continue;
      }
      map.set(n.id, prev.updatedAt >= n.updatedAt ? prev : n);
    }
    const notes = Array.from(map.values()).sort(compareByUpdatedDesc);
    const activeId =
      typeof b?.activeId === "string" && notes.some((n) => n.id === b.activeId)
        ? b.activeId
        : typeof a?.activeId === "string" && notes.some((n) => n.id === a.activeId)
          ? a.activeId
          : notes[0]?.id || "";
    return { notes, activeId };
  };

  const syncFetch = async (syncId) => {
    const res = await fetch("./api/sync", { headers: { "x-sync-id": syncId } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("fetch-failed");
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("bad-response");
    if (typeof data.payload !== "string" || typeof data.updated_at !== "string") throw new Error("bad-response");
    return data;
  };

  const syncPut = async (syncId, payload, updatedAt, prevUpdatedAt) => {
    const res = await fetch("./api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-id": syncId },
      body: JSON.stringify({ payload, updated_at: updatedAt, prev_updated_at: prevUpdatedAt || "" }),
    });
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      return { ok: false, conflict: true, server: data };
    }
    if (!res.ok) return { ok: false, conflict: false };
    const data = await res.json().catch(() => null);
    return { ok: true, conflict: false, server: data };
  };

  const runSync = async () => {
    if (!syncKey) return;
    if (syncInFlight) {
      syncQueued = true;
      return;
    }
    syncInFlight = true;
    lastSyncError = "";
    renderEditor();

    try {
      const syncId = await sha256Hex(syncKey);
      const remote = await syncFetch(syncId);

      let merged = serializeForSync();
      if (remote && remote.payload) {
        const decrypted = await decryptText(syncKey, safeJSONParse(remote.payload) || remote.payload);
        const remoteState = safeJSONParse(decrypted);
        merged = mergeStates(merged, remoteState);
        lastServerUpdatedAt = remote.updated_at;
      }

      state.notes = merged.notes;
      state.activeId = merged.activeId;
      state.query = "";
      saveState();
      render();

      const outgoing = serializeForSync();
      const outgoingUpdatedAt = nowISO();
      const encryptedObj = await encryptText(syncKey, JSON.stringify(outgoing));
      const put1 = await syncPut(syncId, JSON.stringify(encryptedObj), outgoingUpdatedAt, lastServerUpdatedAt);
      if (put1.ok) {
        lastSyncAt = nowISO();
        lastSyncError = "";
        lastServerUpdatedAt = outgoingUpdatedAt;
        return;
      }

      if (put1.conflict && put1.server && typeof put1.server.payload === "string") {
        const decrypted2 = await decryptText(syncKey, safeJSONParse(put1.server.payload) || put1.server.payload);
        const remote2 = safeJSONParse(decrypted2);
        const merged2 = mergeStates(outgoing, remote2);
        state.notes = merged2.notes;
        state.activeId = merged2.activeId;
        state.query = "";
        saveState();
        render();

        const outgoing2 = serializeForSync();
        const outgoingUpdatedAt2 = nowISO();
        const encryptedObj2 = await encryptText(syncKey, JSON.stringify(outgoing2));
        const put2 = await syncPut(syncId, JSON.stringify(encryptedObj2), outgoingUpdatedAt2, put1.server.updated_at || "");
        if (put2.ok) {
          lastSyncAt = nowISO();
          lastSyncError = "";
          lastServerUpdatedAt = outgoingUpdatedAt2;
          return;
        }
        lastSyncError = "冲突未解决";
        return;
      }

      lastSyncError = "网络或服务异常";
    } catch {
      lastSyncError = "网络或服务异常";
    } finally {
      syncInFlight = false;
      renderEditor();
      if (syncQueued) {
        syncQueued = false;
        setTimeout(() => runSync(), 200);
      }
    }
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
      scheduleSyncPush();
    }, 200);
  };

  let syncTimer = null;
  const scheduleSyncPush = () => {
    if (!syncKey) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      runSync();
    }, 1200);
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

  const exportData = async () => {
    const payload = {
      exportedAt: nowISO(),
      version: 1,
      notes: state.notes,
    };
    const password = prompt("设置导出密码（留空则不加密）：") || "";
    if (!password) {
      download(`notes-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
      return;
    }
    try {
      const encrypted = await encryptText(password, JSON.stringify(payload));
      download(`notes-${new Date().toISOString().slice(0, 10)}.encrypted.json`, JSON.stringify(encrypted, null, 2));
    } catch {
      alert("导出失败：加密出错。");
    }
  };

  const importData = async (file) => {
    const text = await file.text();
    const parsed = safeJSONParse(text);
    if (!parsed || typeof parsed !== "object") {
      alert("导入失败：不是有效的 JSON。");
      return;
    }

    let data = parsed;
    if (parsed.encrypted === true) {
      const password = prompt("这是加密备份，请输入密码：") || "";
      if (!password) return;
      try {
        const decrypted = await decryptText(password, parsed);
        const inner = safeJSONParse(decrypted);
        if (!inner || typeof inner !== "object") {
          alert("导入失败：解密内容不是有效的 JSON。");
          return;
        }
        data = inner;
      } catch {
        alert("导入失败：密码错误或数据损坏。");
        return;
      }
    }

    const notes = Array.isArray(data.notes) ? data.notes.map(normalizeNote).filter(Boolean) : [];
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
  exportBtn.addEventListener("click", () => exportData());
  syncBtn.addEventListener("click", async () => {
    if (!syncKey) {
      const v = prompt("设置同步密钥（多设备输入同一个即可）：") || "";
      if (!v) return;
      syncKey = v;
      localStorage.setItem(SYNC_KEY_STORAGE, syncKey);
      lastSyncAt = "";
      lastSyncError = "";
      lastServerUpdatedAt = "";
    }
    await runSync();
  });

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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  if (syncKey) {
    setTimeout(() => runSync(), 50);
  }
})();
