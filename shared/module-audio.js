/* Site-hosted synthetic speech. Never fall back silently to device voices. */
(function () {
  "use strict";
  const root = new URL("../", document.currentScript.src);
  let manifest;
  let audio = null;
  let generation = 0;
  let currentButton = null;
  const key = text => String(text).trim().toLowerCase();
  async function mapping() {
    if (!manifest) manifest = fetch(new URL("module-audio/manifest.json", root), { signal: AbortSignal.timeout(12000) }).then(r => {
      if (!r.ok) throw new Error("音频目录加载失败");
      return r.json();
    }).catch(error => { manifest = null; throw error; });
    return manifest;
  }
  function stop() {
    generation++;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio = null; }
    if (currentButton?.isConnected) { currentButton.classList.remove("playing"); currentButton.textContent = "重听 · 合成英音"; }
    currentButton = null;
  }
  async function play(text, button, rate = 1, onHeard = () => {}) {
    stop();
    const token = generation;
    currentButton = button;
    if (button) button.textContent = "加载中…";
    try {
      const map = await mapping();
      if (token !== generation || (button && !button.isConnected)) return;
      const path = map.items[key(text)];
      if (!path) throw new Error("缺少音频");
      audio = new Audio(new URL(path, root).href);
      audio.playbackRate = rate;
      const playingAudio = audio;
      const fail = () => {
        if (token !== generation) return;
        button?.classList.remove("playing");
        if (button) button.textContent = "播放失败 · 点此重试";
      };
      audio.addEventListener("error", fail);
      audio.addEventListener("playing", () => {
        if (token !== generation) return;
        button?.classList.add("playing");
        if (button) button.textContent = "正在播放…";
      });
      let heard = false;
      setTimeout(() => { if (token === generation && !heard) { playingAudio.pause(); fail(); } }, 15000);
      audio.addEventListener("timeupdate", () => {
        if (token === generation && !heard && playingAudio.currentTime > 0.05) { heard = true; onHeard(); }
      });
      audio.addEventListener("ended", () => {
        if (token !== generation) return;
        button?.classList.remove("playing");
        if (button) button.textContent = "重听 · 合成英音";
      });
      await audio.play();
    } catch (error) {
      if (token !== generation) return;
      if (button) button.textContent = error.name === "NotAllowedError" ? "点此播放" : "播放失败 · 点此重试";
    }
  }
  async function download(texts, button) {
    try {
      const map = await mapping();
      const cache = await caches.open("ielts-module-audio-v1");
      const paths = [...new Set(texts.map(text => map.items[key(text)]))];
      if (paths.includes(undefined)) throw new Error("缺少音频映射");
      let done = 0;
      for (const path of paths) {
        const url = new URL(path, root).href;
        if (!(await cache.match(url))) {
          const response = await fetch(url);
          if (!response.ok) throw new Error("下载失败");
          await cache.put(url, response);
        }
        button.textContent = `下载音频 ${++done}/${paths.length}`;
      }
      button.textContent = "本轮音频已下载";
    } catch (_) { button.textContent = "下载未完成 · 点击重试"; }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  window.addEventListener("pagehide", stop);
  window.ModuleAudio = { play, stop, download };
})();
