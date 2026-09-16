(() => {
  const CHANNEL = "mesh-tasks-debug";
  const INSTALL_MARKER = "__meshTasksPageHookInstalled";
  if (window[INSTALL_MARKER]) {
    window.postMessage({ source: CHANNEL, type: "event", payload: { kind: "hook-duplicate-skipped", existing: window[INSTALL_MARKER] } }, location.origin);
    return;
  }
  window[INSTALL_MARKER] = { installedAt: new Date().toISOString(), url: location.href };
  const MAX_BODY = 12000;
  const SECRET_KEY = /(authorization|cookie|token|secret|password|passwd|jwt|session|csrf|set-cookie|api[-_]?key)/i;
  const TRACE_SESSION = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function isToken(value) {
    return /^eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)?$/.test(value)
      || /^Bearer\s+[A-Za-z0-9._~+/=_-]{16,}$/.test(value)
      || /^[A-Za-z0-9._~+-]{40,}$/.test(value);
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function redact(value, depth = 0) {
    if (depth > 20) return "[depth-limit]";
    if (typeof value === "string") {
      if (isToken(value)) return "[redacted-string]";
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

  function headerEntries(headers) {
    if (!headers) return [];
    return headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  }

  function authHeaders(headers) {
    const result = {};
    for (const [name, value] of headerEntries(headers)) {
      if (/^(authorization|profile-id)$/i.test(String(name))) result[String(name).toLowerCase()] = String(value);
    }
    return result;
  }

  function mergeHeaders(...sources) {
    const result = {};
    for (const source of sources) {
      for (const [name, value] of headerEntries(source)) {
        const lower = String(name).toLowerCase();
        for (const existing of Object.keys(result)) if (existing.toLowerCase() === lower) delete result[existing];
        result[String(name)] = String(value);
      }
    }
    return result;
  }

  function authDiagnostics(headers = latestAnswerHeaders) {
    const auth = authHeaders(headers);
    const authorization = auth.authorization || "";
    return {
      authorizationPresent: Boolean(authorization),
      authorizationScheme: authorization.split(/\s+/, 1)[0] || null,
      authorizationFingerprint: authorization ? shortHash(authorization) : null,
      profileIdPresent: Boolean(auth["profile-id"]),
      profileIdFingerprint: auth["profile-id"] ? shortHash(auth["profile-id"]) : null,
      headerNames: Object.keys(headers || {}).sort()
    };
  }

  function selectedResponseHeaders(response) {
    const result = {};
    for (const name of ["content-type", "www-authenticate", "x-request-id", "x-correlation-id", "retry-after", "location"]) {
      const value = response?.headers?.get(name);
      if (value) result[name] = value.slice(0, 500);
    }
    return result;
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
    window.postMessage({ source: CHANNEL, type: "event", payload: { traceSession: TRACE_SESSION, ...payload } }, location.origin);
  }

  function commandResult(requestId, result) {
    window.postMessage({ source: CHANNEL, type: "command-result", requestId, result }, location.origin);
  }

  async function submitAnswer(requestId, payload) {
    const started = performance.now();
    const traceId = `${TRACE_SESSION}:answer:${requestId}`;
    const headers = { ...latestAnswerHeaders };
    const body = new FormData();
    body.append("request", new Blob([JSON.stringify(payload)], { type: "application/json" }), "blob");
    emit({ kind: "command-start", command: "submit-answer", traceId, requestId, method: "POST", url: safeUrl("/webtests/exam/rest/secure/challenge/task/answer"), requestHeaders: authDiagnostics(headers), requestBody: await serializeBody(body) });
    try {
      delete headers["content-type"]; delete headers["content-length"];
      const response = await nativeFetch("/webtests/exam/rest/secure/challenge/task/answer", { method: "POST", body, credentials: "include", headers });
      const result = { ok: response.ok, status: response.status, statusText: response.statusText, durationMs: Math.round(performance.now() - started), requestHeaders: authDiagnostics(headers), responseHeaders: selectedResponseHeaders(response), response: await responseBody(response) };
      emit({ kind: "command-result", command: "submit-answer", traceId, requestId, ...result });
      commandResult(requestId, { ok: result.ok, status: result.status, durationMs: result.durationMs, traceId, responseHeaders: result.responseHeaders, response: result.response });
    } catch (error) {
      const result = { ok: false, durationMs: Math.round(performance.now() - started), requestHeaders: authDiagnostics(headers), error: String(error?.message || error), errorName: error?.name || "Error" };
      emit({ kind: "command-error", command: "submit-answer", traceId, requestId, ...result });
      commandResult(requestId, { ...result, traceId });
    }
  }

  async function completeAttempt(requestId, challengeId) {
    const started = performance.now();
    const traceId = `${TRACE_SESSION}:complete:${requestId}`;
    const headers = { ...latestAnswerHeaders, "content-type": "application/json" };
    const url = `/webtests/exam/rest/secure/challenge/${encodeURIComponent(challengeId)}/complete_attempt`;
    const body = JSON.stringify({ challenge_id: Number(challengeId) });
    emit({ kind: "command-start", command: "complete-attempt", traceId, requestId, method: "POST", url: safeUrl(url), requestHeaders: authDiagnostics(headers), requestBody: redact(JSON.parse(body)) });
    try {
      const response = await nativeFetch(url, { method: "POST", credentials: "include", headers, body });
      const result = { ok: response.ok, status: response.status, statusText: response.statusText, durationMs: Math.round(performance.now() - started), requestHeaders: authDiagnostics(headers), responseHeaders: selectedResponseHeaders(response), response: await responseBody(response) };
      emit({ kind: "command-result", command: "complete-attempt", traceId, requestId, ...result });
      commandResult(requestId, { ok: result.ok, status: result.status, durationMs: result.durationMs, traceId, responseHeaders: result.responseHeaders, response: result.response });
    } catch (error) {
      const result = { ok: false, durationMs: Math.round(performance.now() - started), requestHeaders: authDiagnostics(headers), error: String(error?.message || error), errorName: error?.name || "Error" };
      emit({ kind: "command-error", command: "complete-attempt", traceId, requestId, ...result });
      commandResult(requestId, { ...result, traceId });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== CHANNEL || event.data?.type !== "command") return;
    if (event.data.command === "submit-answer" && event.data.payload && event.data.requestId) submitAnswer(event.data.requestId, event.data.payload);
    if (event.data.command === "complete-attempt" && event.data.payload?.challenge_id && event.data.requestId) completeAttempt(event.data.requestId, event.data.payload.challenge_id);
  });

  const nativeFetch = window.fetch;
  let latestAnswerHeaders = {};

  window.fetch = async function debugFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = String(request?.url || input || "");
    const started = performance.now();
    let response;
    try {
      response = await nativeFetch.apply(this, arguments);
      if (response.ok && /\/webtests\/exam\/rest\/secure\//.test(url)) {
        latestAnswerHeaders = mergeHeaders(latestAnswerHeaders, authHeaders(init.headers || request?.headers));
      }
      emit({
        kind: "fetch",
        method: init.method || request?.method || "GET",
        url: safeUrl(url),
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        durationMs: Math.round(performance.now() - started),
        requestHeaders: headersToObject(init.headers || request?.headers),
        requestBody: await serializeBody(init.body),
        responseHeaders: selectedResponseHeaders(response),
        response: await responseBody(response)
      });
      return response;
    } catch (error) {
      emit({ kind: "fetch-error", method: init.method || request?.method || "GET", url: safeUrl(url), error: String(error?.message || error), errorName: error?.name || "Error" });
      throw error;
    }
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function debugOpen(method, url) {
    this.__meshDebug = { method, url: String(url), started: performance.now(), headers: {} };
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function debugSetRequestHeader(name, value) {
    if (this.__meshDebug) this.__meshDebug.headers[String(name).toLowerCase()] = String(value);
    return nativeSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function debugSend(body) {
    const request = this.__meshDebug || { method: "GET", url: "", headers: {} };
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
      const responseHeaders = {};
      for (const name of ["content-type", "www-authenticate", "x-request-id", "x-correlation-id", "retry-after", "location"]) {
        const value = this.getResponseHeader(name);
        if (value) responseHeaders[name] = value.slice(0, 500);
      }
      const authBefore = authDiagnostics(latestAnswerHeaders);
      let refreshAuth = null;
      if (request.url.includes("/webtests/exam/rest/secure/") && this.status >= 200 && this.status < 300) latestAnswerHeaders = mergeHeaders(latestAnswerHeaders, request.headers);
      if (request.url.includes("/acl/api/session/v2/refresh") && this.status >= 200 && this.status < 300) {
        try {
          const session = this.responseType === "json" && this.response && typeof this.response === "object" ? this.response : JSON.parse(this.responseText || "{}");
          const token = session.accessTokenEom || session.accessTokenAupd;
          latestAnswerHeaders = mergeHeaders(latestAnswerHeaders, {
            ...(session.profileId ? { "profile-id": String(session.profileId) } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {})
          });
          refreshAuth = { parsed: true, tokenField: session.accessTokenEom ? "accessTokenEom" : session.accessTokenAupd ? "accessTokenAupd" : null, profileIdPresent: Boolean(session.profileId), authAfter: authDiagnostics(latestAnswerHeaders) };
        } catch (error) {
          refreshAuth = { parsed: false, parseError: String(error?.message || error), responseType: this.responseType || "text" };
        }
      }
      emit({
        kind: "xhr",
        method: request.method,
        url: safeUrl(request.url),
        status: this.status,
        statusText: this.statusText,
        contentType: this.getResponseHeader("content-type") || "",
        durationMs: Math.round(performance.now() - (request.started || performance.now())),
        requestHeaders: headersToObject(request.headers),
        requestAuth: authDiagnostics(request.headers),
        authBefore,
        refreshAuth,
        responseHeaders,
        response,
        requestBody: await serializeBody(body)
      });
    }, { once: true });
    return nativeSend.apply(this, arguments);
  };

  emit({ kind: "hook-installed", url: location.href, title: document.title, auth: authDiagnostics() });
})();
