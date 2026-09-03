(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const CHANNEL = "mesh-tasks-debug";
  const panel = document.createElement("div");
  const downloadButton = document.createElement("button");
  const examButton = document.createElement("button");
  panel.append(downloadButton, examButton);
  downloadButton.type = "button";
  examButton.type = "button";
  downloadButton.textContent = "Скачать debug-лог";
  examButton.textContent = "Показать все задания";
  downloadButton.title = "Открыть локальный диагностический журнал расширения";
  examButton.title = "Открыть локальную страницу со всеми заданиями текущей попытки";
  Object.assign(panel.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    display: "flex", gap: "7px", alignItems: "center"
  });
  const baseButtonStyle = {
    border: "0", borderRadius: "10px", padding: "10px 14px", cursor: "pointer",
    color: "white", font: "600 13px system-ui", boxShadow: "0 4px 16px rgba(0,0,0,.2)"
  };
  Object.assign(downloadButton.style, baseButtonStyle, { background: "#6d3fc0" });
  Object.assign(examButton.style, baseButtonStyle, { background: "#315fc1" });
  downloadButton.addEventListener("click", () => api.runtime.sendMessage({ type: "OPEN_DEBUG" }));
  examButton.addEventListener("click", () => api.runtime.sendMessage({ type: "OPEN_EXAM" }));

  function installHook() {
    const script = document.createElement("script");
    script.src = api.runtime.getURL("page-hook.js");
    script.dataset.meshDebugHook = "true";
    (document.head || document.documentElement).append(script);
    script.addEventListener("load", () => script.remove(), { once: true });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== CHANNEL || event.data?.type !== "event") return;
    api.runtime.sendMessage({ type: "DEBUG_EVENT", event: event.data.payload });
  });

  installHook();
  (document.documentElement || document.body).append(panel);
})();
