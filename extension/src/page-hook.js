(() => {
  const CHANNEL = "mesh-tasks-debug";
  const MAX_BODY = 12000;
  const SECRET_KEY = /(authorization|cookie|token|secret|password|passwd|jwt|session|csrf|set-cookie|api[-_]?key)/i;

  function redact(value, depth = 0) {
    if (depth > 20) return "[depth-limit]";
    if (typeof value === "string") {
      if (/^(Bearer\s+)?[A-Za-z0-9._~+/=-]{24,}$/.test(value)) return "[redacted-string]";
      return value.length > MAX_BODY ? `${value.slice(0, MAX_BODY)}…[truncated]` : value;
    }
    if (Array.isArray(value)) return value.slice(0, 300).map((item) => redact(item, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1)
      ]));
    }
    return value;
  }

  function safeUrl(raw) {
    try {
      const url = new URL(String(raw), location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_KEY.test(key)) url.searchParams.set(key, "[redacted]");
      }
      url.username = "";
      url.password = "";
      return url.href;
    } catch {
      return String(raw).slice(0, 1000);
    }
  }

  function headersToObject(headers) {
    const result = {};
    if (!headers) return result;
    if (headers instanceof Headers) headers.forEach((value, key) => { result[key] = value; });
    else if (Array.isArray(headers)) headers.forEach(([key, value]) => { result[key] = value; });
    else Object.assign(result, headers);
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : String(value).slice(0, 300)
    ]));
  }

  async function responseBody(response) {
    try {
      const text = await response.clone().text();
      if (!text) return null;
      try { return redact(JSON.parse(text)); } catch { return redact(text); }
    } catch (error) {
      return { readError: String(error?.message || error) };
    }
  }

  async function serializeBody(body) {
    if (body == null) return null;
    try {
      if (body instanceof FormData) {
        const entries = [];
        for (const [key, value] of [...body.entries()].slice(0, 100)) {
          if (value instanceof Blob) {
            const text = await value.slice(0, MAX_BODY).text();
            let payload;
            try { payload = redact(JSON.parse(text)); }
            catch { payload = redact(text); }
            entries.push([key, { fileName: value instanceof File ? value.name : "", blobType: value.type, blobSize: value.size, json: payload }]);
          } else entries.push([key, redact(value)]);
        }
        return Object.fromEntries(entries);
      }
      if (body instanceof URLSearchParams) return redact(Object.fromEntries(body.entries()));
      if (body instanceof Blob) {
        const text = await body.slice(0, MAX_BODY).text();
        try { return { blobType: body.type, blobSize: body.size, json: redact(JSON.parse(text)) }; }
        catch { return { blobType: body.type, blobSize: body.size, text: redact(text) }; }
      }
      if (body instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(body.slice(0, MAX_BODY));
        try { return { arrayBufferSize: body.byteLength, json: redact(JSON.parse(text)) }; }
        catch { return { arrayBufferSize: body.byteLength, text: redact(text) }; }
      }
    } catch (error) {
      return { serializeError: String(error?.message || error) };
    }
    return redact(body);
  }

  function emit(payload) {
    window.postMessage({ source: CHANNEL, type: "event", payload }, location.origin);
  }

  async function submitAnswer(requestId, payload) {
    const started = performance.now();
    try {
      const body = new FormData();
      body.append("request", new Blob([JSON.stringify(payload)], { type: "application/json" }), "blob");
      const response = await nativeFetch("/webtests/exam/rest/secure/challenge/task/answer", { method: "POST", body, credentials: "include" });
      window.postMessage({ source: CHANNEL, type: "command-result", requestId, result: { ok: response.ok, status: response.status, durationMs: Math.round(performance.now() - started) } }, location.origin);
    } catch (error) {
      window.postMessage({ source: CHANNEL, type: "command-result", requestId, result: { ok: false, error: String(error?.message || error) } }, location.origin);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== CHANNEL || event.data?.type !== "command") return;
    if (event.data.command === "submit-answer" && event.data.payload && event.data.requestId) submitAnswer(event.data.requestId, event.data.payload);
  });

  const nativeFetch = window.fetch;
  window.fetch = async function debugFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = String(request?.url || input || "");
    const started = performance.now();
    let response;
    try {
      response = await nativeFetch.apply(this, arguments);
      emit({
        kind: "fetch",
        method: init.method || request?.method || "GET",
        url: safeUrl(url),
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        durationMs: Math.round(performance.now() - started),
        requestHeaders: headersToObject(init.headers || request?.headers),
        requestBody: await serializeBody(init.body),
        response: await responseBody(response)
      });
      return response;
    } catch (error) {
      emit({ kind: "fetch-error", method: init.method || request?.method || "GET", url: safeUrl(url), error: String(error?.message || error) });
      throw error;
    }
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function debugOpen(method, url) {
    this.__meshDebug = { method, url: String(url), started: performance.now() };
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function debugSend(body) {
    const request = this.__meshDebug || { method: "GET", url: "" };
    this.addEventListener("loadend", async () => {
      let response = null;
      try {
        if (this.responseType === "json") response = redact(this.response);
        else if (!this.responseType || this.responseType === "text") {
          const text = this.responseText;
          try { response = text ? redact(JSON.parse(text)) : null; } catch { response = redact(text); }
        } else response = `[responseType:${this.responseType}]`;
      } catch (error) {
        response = { readError: String(error?.message || error) };
      }
      emit({
        kind: "xhr",
        method: request.method,
        url: safeUrl(request.url),
        status: this.status,
        contentType: this.getResponseHeader("content-type") || "",
        durationMs: Math.round(performance.now() - (request.started || performance.now())),
        response: response,
        requestBody: await serializeBody(body)
      });
    }, { once: true });
    return nativeSend.apply(this, arguments);
  };

  emit({ kind: "hook-installed", url: location.href, title: document.title });
})();
