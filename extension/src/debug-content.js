(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const CHANNEL = "mesh-tasks-debug";

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
})();
