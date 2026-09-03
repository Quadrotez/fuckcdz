(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const CHANNEL = "mesh-tasks-debug";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Скачать debug-лог";
  button.title = "Открыть локальный диагностический журнал расширения";
  Object.assign(button.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    border: "0", borderRadius: "10px", padding: "10px 14px", cursor: "pointer",
    background: "#6d3fc0", color: "white", font: "600 13px system-ui",
    boxShadow: "0 4px 16px rgba(0,0,0,.2)"
  });
  button.addEventListener("click", () => api.runtime.sendMessage({ type: "OPEN_DEBUG" }));

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
  (document.documentElement || document.body).append(button);
})();
