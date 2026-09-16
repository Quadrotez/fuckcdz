(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const CHANNEL = "mesh-tasks-debug";

  function emit(event) {
    api.runtime.sendMessage({ type: "DEBUG_EVENT", event: { ...event, bridge: true } }).catch?.(() => {});
  }

  function installHook() {
    if (document.querySelector("script[data-mesh-debug-hook='true']")) {
      emit({ kind: "bridge-duplicate-skipped", reason: "hook-script-already-present" });
      return;
    }
    const script = document.createElement("script");
    script.src = api.runtime.getURL("page-hook.js");
    script.dataset.meshDebugHook = "true";
    script.addEventListener("error", () => emit({ kind: "hook-load-error", url: script.src }));
    (document.head || document.documentElement).append(script);
    script.addEventListener("load", () => { emit({ kind: "hook-loaded", url: location.href }); }, { once: true });
  }

  const pending = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== CHANNEL) return;
    if (event.data.type === "event") api.runtime.sendMessage({ type: "DEBUG_EVENT", event: event.data.payload }).catch?.(() => {});
    if (event.data.type === "command-result") {
      const pendingRequest = pending.get(event.data.requestId);
      if (pendingRequest) {
        pending.delete(event.data.requestId);
        clearTimeout(pendingRequest.timer);
        emit({ kind: "bridge-result", requestId: event.data.requestId, result: event.data.result });
        pendingRequest.resolve(event.data.result);
      } else {
        emit({ kind: "bridge-orphan-result", requestId: event.data.requestId, result: event.data.result });
      }
    }
  });

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "REFRESH_EXAM_SNAPSHOT") {
      emit({ kind: "snapshot-refresh-start", url: location.href });
      location.reload();
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 2500));
    }
    if (message?.type !== "SUBMIT_ANSWER" && message?.type !== "COMPLETE_ATTEMPT") return undefined;
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const command = message.type === "COMPLETE_ATTEMPT" ? "complete-attempt" : "submit-answer";
    emit({ kind: "bridge-command-start", requestId, command, payload: message.payload });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        const result = { ok: false, error: "Истекло время ожидания ответа МЭШ", timeoutMs: 15000 };
        emit({ kind: "bridge-timeout", requestId, command, ...result });
        resolve(result);
      }, 15000);
      pending.set(requestId, { resolve, timer });
      window.postMessage({ source: CHANNEL, type: "command", command, requestId, payload: message.payload }, location.origin);
    });
  });

  installHook();
})();
