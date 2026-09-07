(function () {
  "use strict";
  function create(key, validate) {
    let snapshot;
    let blocked = false;
    let latest;
    let owner = !navigator.locks;
    if (navigator.locks) navigator.locks.request(`${key}:writer`, { ifAvailable: true }, async lock => {
      if (!lock) { blocked = true; warn("此模块已在另一页面打开。请关闭另一页面，再重新读取继续。"); return; }
      owner = true;
      await new Promise(resolve => window.addEventListener("pagehide", () => { owner = false; resolve(); }, { once: true }));
    });
    window.addEventListener("pageshow", event => { if (event.persisted) { blocked = true; warn("页面从缓存恢复，请重新读取最新记录后继续。"); } });
    function exportData(value = latest ?? snapshot) {
      const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `${key}-${Date.now()}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function warn(message, retry) {
      document.getElementById("module-storage-warning")?.remove();
      const dialog = document.createElement("dialog"); dialog.id = "module-storage-warning";
      dialog.style.cssText = "max-width:min(90vw,440px);border:1px solid #888;border-radius:16px;padding:24px;line-height:1.6";
      const text = document.createElement("p"); text.textContent = message; dialog.append(text);
      const button = (title, action) => { const b = document.createElement("button"); b.textContent = title; b.style.cssText = "padding:12px;margin:5px"; b.onclick = action; dialog.append(b); };
      button("导出备份", () => exportData());
      button("重新读取", () => location.reload());
      if (retry) button("重试保存", () => { retry(); location.reload(); });
      button("导入备份", importData);
      dialog.addEventListener("cancel", event => event.preventDefault());
      document.body.append(dialog); dialog.showModal();
    }
    function read(fallback) {
      try {
        snapshot = localStorage.getItem(key);
        if (!snapshot) return fallback();
        const parsed = JSON.parse(snapshot);
        if (!validate(parsed)) throw new Error("记录结构不合法");
        latest = parsed;
        return parsed;
      } catch (_) {
        blocked = true;
        latest = snapshot;
        queueMicrotask(() => warn("原记录损坏或无法读取，已停止写入，不会用空记录覆盖。请先导出备份，或导入有效备份。"));
        return fallback();
      }
    }
    function write(value) {
      if (!owner) { warn("此模块写入锁尚未取得，请重新读取后继续。"); throw new Error("未取得写入锁"); }
      if (blocked) throw new Error("记录已保护，停止写入");
      latest = value;
      if (localStorage.getItem(key) !== snapshot) {
        blocked = true;
        warn("另一页面已经更新记录，本页暂停写入。请导出当前备份，再重新读取。" );
        throw new Error("多页面写入冲突");
      }
      const next = JSON.stringify(value);
      try { localStorage.setItem(key, next); snapshot = next; }
      catch (error) {
        warn("保存失败（可能空间已满）。当前作答保留在内存，训练已暂停，请导出备份或重试保存。", () => write(value));
        throw error;
      }
    }
    function importData() {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
      input.onchange = async () => {
        try {
          const text = await input.files[0].text(); const value = JSON.parse(text);
          if (!validate(value)) throw new Error("备份不属于此模块或数据损坏");
          if (!confirm("导入会替换此模块记录；请先导出当前备份。继续？")) return;
          if (localStorage.getItem(key) !== snapshot) throw new Error("其他页面已更新，请重新读取后再导入");
          localStorage.setItem(key, JSON.stringify(value)); location.reload();
        } catch (error) { alert(`未导入：${error.message}`); }
      };
      input.click();
    }
    window.addEventListener("storage", event => {
      if (event.key === key && event.newValue !== snapshot) { blocked = true; window.ModuleAudio?.stop(); warn("另一页面已更新此模块，本页已暂停。重新读取后继续，避免覆盖新进度。"); }
    });
    function controls() {
      const box = document.createElement("details"); box.style.cssText = "margin:16px;padding:10px";
      const summary = document.createElement("summary"); summary.textContent = "此模块数据备份"; box.append(summary);
      for (const [title, action] of [["导出备份", () => exportData()], ["导入备份", importData]]) {
        const b = document.createElement("button"); b.textContent = title; b.onclick = action; b.style.cssText = "padding:12px;margin:5px"; box.append(b);
      }
      document.body.append(box);
    }
    return { read, write, controls };
  }
  function recordsValid(records, counters) {
    return records && typeof records === "object" && !Array.isArray(records)
      && Object.values(records).every(record => record && typeof record === "object" && !Array.isArray(record)
        && counters.every(field => record[field] === undefined || (Number.isFinite(record[field]) && record[field] >= 0)));
  }
  function sessionValid(session) {
    return session == null || (session && typeof session === "object" && Array.isArray(session.queue)
      && session.queue.every(entry => entry && typeof entry.term === "string" && entry.term.trim())
      && (session.cursor === undefined || (Number.isInteger(session.cursor) && session.cursor >= 0 && session.cursor <= session.queue.length)));
  }
  window.ModuleStore = { create, recordsValid, sessionValid };
})();
