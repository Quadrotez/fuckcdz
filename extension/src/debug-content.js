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

  const pending = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== CHANNEL) return;
    if (event.data.type === "event") api.runtime.sendMessage({ type: "DEBUG_EVENT", event: event.data.payload });
    if (event.data.type === "command-result") {
      const resolve = pending.get(event.data.requestId);
      if (resolve) { pending.delete(event.data.requestId); resolve(event.data.result); }
    }
  });

  api.runtime.onMessage.addListener((message) => {
    if (message?.type !== "SUBMIT_ANSWER") return undefined;
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: "Истекло время ожидания ответа МЭШ" }); }, 15000);
      pending.set(requestId, (result) => { clearTimeout(timer); resolve(result); });
      window.postMessage({ source: CHANNEL, type: "command", command: "submit-answer", requestId, payload: message.payload }, location.origin);
    });
  });

  installHook();
})();
