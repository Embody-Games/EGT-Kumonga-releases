"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/core/platform.ts
  function isDesktop() {
    return typeof Blockbench !== "undefined" && Blockbench.isWeb === false;
  }
  function nodeRequire(name) {
    try {
      return __require(name);
    } catch (e) {
      throw new Error(
        `Blockbench would not provide the "${name}" module (${e?.message || e}). If a permission prompt appeared, it may have been declined.`
      );
    }
  }
  function platform() {
    try {
      return nodeRequire("os").platform();
    } catch {
      return "unknown";
    }
  }
  var isWindows = () => platform() === "win32";
  function pluginDataDir() {
    const os = nodeRequire("os");
    const home = os.homedir().replace(/\\/g, "/");
    const env = globalThis.process?.env;
    let base;
    switch (os.platform()) {
      case "win32":
        base = (env?.APPDATA || `${home}/AppData/Roaming`).replace(/\\/g, "/");
        break;
      case "darwin":
        base = `${home}/Library/Application Support`;
        break;
      default:
        base = env?.XDG_CONFIG_HOME || `${home}/.config`;
    }
    return `${base.replace(/\/+$/, "")}/Blockbench/embody`;
  }

  // src/core/trace.ts
  function traceFile() {
    return `${pluginDataDir()}/embody_load_report.txt`;
  }
  function trace(stage) {
    try {
      const fs = nodeRequire("fs");
      const dir = pluginDataDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(traceFile(), `[${(/* @__PURE__ */ new Date()).toISOString()}] ${stage}
`, "utf8");
    } catch {
    }
  }

  // src/core/vault.ts
  var PS_PROTECT = [
    "Add-Type -AssemblyName System.Security;",
    "$in=[Console]::In.ReadToEnd().Trim();",
    "$b=[Convert]::FromBase64String($in);",
    '$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,"CurrentUser");',
    "[Convert]::ToBase64String($e)"
  ].join("");
  var PS_UNPROTECT = [
    "Add-Type -AssemblyName System.Security;",
    "$in=[Console]::In.ReadToEnd().Trim();",
    "$e=[Convert]::FromBase64String($in);",
    '$b=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,"CurrentUser");',
    "[Convert]::ToBase64String($b)"
  ].join("");
  function powershell(script, stdinB64) {
    const cp = nodeRequire("child_process");
    const out = cp.execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { input: stdinB64, encoding: "utf8", timeout: 2e4, windowsHide: true }
    );
    return out.trim();
  }
  var vaultDir = pluginDataDir;
  function vaultFile() {
    return `${vaultDir()}/credentials.json`;
  }
  var VaultUnavailable = class extends Error {
  };
  function assertUsable() {
    if (!isWindows()) {
      throw new VaultUnavailable(
        `Kumonga can only sign in on Windows for now \u2014 this is ${platform()}. Credential storage for macOS and Linux is not written yet.`
      );
    }
  }
  function selfTest() {
    assertUsable();
    if (helperDown) throw new VaultUnavailable(helperDown);
    const probe = Buffer.from(`kumonga ${Date.now()}`, "utf8").toString("base64");
    try {
      const blob = powershell(PS_PROTECT, probe);
      const back = powershell(PS_UNPROTECT, blob);
      if (back !== probe) throw new Error("round trip did not match");
    } catch (e) {
      if (isHelperFailure(e)) {
        helperDown = "Windows credential storage did not respond, so Kumonga cannot save a sign-in right now. Restart Blockbench to try again.";
        throw new VaultUnavailable(helperDown);
      }
      throw new VaultUnavailable(
        `Windows credential storage refused to encrypt a test value, so a sign-in could not be saved: ${String(e?.message || e)}`
      );
    }
  }
  var cache = null;
  var cacheIsFallback = false;
  var helperDown = null;
  function isHelperFailure(e) {
    const err = e;
    if (!err || typeof err !== "object") return true;
    if (err.code === "ETIMEDOUT" || err.code === "ENOENT" || err.code === "EACCES") return true;
    if (err.signal) return true;
    return typeof err.status !== "number";
  }
  function readBag() {
    if (cache) return cache;
    if (helperDown) throw new VaultUnavailable(helperDown);
    const fs = nodeRequire("fs");
    const file2 = vaultFile();
    if (!fs.existsSync(file2)) return cache = {};
    let blob;
    try {
      const raw = JSON.parse(fs.readFileSync(file2, "utf8"));
      if (!raw || typeof raw.blob !== "string") throw new Error("not a vault file");
      blob = raw.blob;
    } catch {
      cacheIsFallback = true;
      return cache = {};
    }
    let plain;
    try {
      plain = Buffer.from(powershell(PS_UNPROTECT, blob), "base64").toString("utf8");
    } catch (e) {
      if (isHelperFailure(e)) {
        helperDown = "Windows credential storage did not respond, so Kumonga cannot read or save a sign-in right now. Restart Blockbench to try again; your saved credentials are untouched.";
        throw new VaultUnavailable(helperDown);
      }
      cacheIsFallback = true;
      return cache = {};
    }
    try {
      return cache = JSON.parse(plain);
    } catch {
      cacheIsFallback = true;
      return cache = {};
    }
  }
  function writeBag(bag) {
    const fs = nodeRequire("fs");
    const dir = vaultDir();
    const file2 = vaultFile();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const b64 = Buffer.from(JSON.stringify(bag), "utf8").toString("base64");
    const blob = powershell(PS_PROTECT, b64);
    if (cacheIsFallback && fs.existsSync(file2)) {
      try {
        fs.copyFileSync(file2, `${file2}.bak`);
      } catch {
      }
    }
    fs.writeFileSync(`${file2}.tmp`, JSON.stringify({ v: 1, blob }), "utf8");
    fs.renameSync(`${file2}.tmp`, file2);
    cache = bag;
    cacheIsFallback = false;
  }
  var vault = {
    available() {
      try {
        assertUsable();
        return true;
      } catch {
        return false;
      }
    },
    /** See `selfTest`. Throws `VaultUnavailable` with a reason the artist can read. */
    selfTest,
    /** Why it is unavailable, for showing the user. Empty when it works. */
    unavailableReason() {
      try {
        assertUsable();
        return "";
      } catch (e) {
        return e.message;
      }
    },
    get(key) {
      assertUsable();
      const bag = readBag();
      return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
    },
    set(key, value) {
      assertUsable();
      const bag = readBag();
      bag[key] = value;
      writeBag(bag);
    },
    /**
     * Rotated refresh tokens are single-use: the new one must be durable before
     * the new access token is used, or a crash in between locks the artist out.
     * Callers must await this and only then use the access token. See M0.
     */
    setMany(entries) {
      assertUsable();
      const bag = readBag();
      Object.assign(bag, entries);
      writeBag(bag);
    },
    delete(key) {
      this.deleteMany([key]);
    },
    /**
     * Several keys in one write. Every write is a synchronous PowerShell spawn on
     * the renderer thread, roughly 700 ms each; sign-out was five of them in a
     * row, and Blockbench stopped painting for the duration.
     */
    deleteMany(keys) {
      assertUsable();
      const bag = readBag();
      let changed = false;
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(bag, key)) {
          delete bag[key];
          changed = true;
        }
      }
      if (changed) writeBag(bag);
    }
  };

  // src/core/http.ts
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function requestWithRetry(url, opts = {}, attempts = 3) {
    let wait = 1e3;
    for (let i = 1; ; i++) {
      const res = await request(url, opts);
      const retryable = res.status === 429 || res.status >= 500 && res.status < 600;
      if (!retryable || i >= attempts) return res;
      await sleep(retryDelayMs(res.headers["retry-after"], wait));
      wait *= 2;
    }
  }
  var MAX_RETRY_WAIT_MS = 6e4;
  function retryDelayMs(header, fallbackMs) {
    const advised = Number(Array.isArray(header) ? header[0] : header);
    const ms = Number.isFinite(advised) && advised > 0 ? advised * 1e3 : fallbackMs;
    return Math.min(ms, MAX_RETRY_WAIT_MS);
  }
  function request(url, opts = {}) {
    const https = nodeRequire("https");
    const target = new URL(url);
    const method = opts.method || "GET";
    const timeoutMs = opts.timeoutMs ?? 3e4;
    let payload;
    const headers = { Accept: "application/json", ...opts.headers };
    if (opts.body !== void 0) {
      payload = Buffer.isBuffer(opts.body) || typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        outcome();
      };
      const fail = (why) => settle(() => reject(new Error(`${method} ${target.host} ${why}`)));
      const req = https.request(
        {
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method,
          headers
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => settle(() => {
            const status = res.statusCode || 0;
            const ok = status >= 200 && status < 300;
            const buffer = Buffer.concat(chunks);
            if (opts.raw && ok) {
              resolve({ ok, status, json: null, text: "", headers: res.headers, buffer });
              return;
            }
            const text = buffer.toString("utf8");
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
            }
            resolve({ ok, status, json, text, headers: res.headers });
          }));
          res.on("error", (e) => fail(`failed mid-response: ${e.message}`));
        }
      );
      req.on("error", (e) => fail(`failed: ${e.message}`));
      req.setTimeout(timeoutMs, () => {
        fail(`timed out after ${Math.round(timeoutMs / 1e3)}s`);
        req.destroy();
      });
      const deadline = setTimeout(() => {
        fail(`gave up after ${Math.round(timeoutMs * 3 / 1e3)}s`);
        req.destroy();
      }, timeoutMs * 3);
      if (payload !== void 0) req.write(payload);
      req.end();
    });
  }
  async function requestBinary(url, headers, maxRedirects = 4, timeoutMs = 6e4) {
    const origin = new URL(url).host;
    let at = url;
    for (let hop = 0; ; hop++) {
      const same = new URL(at).host === origin;
      const res = await requestWithRetry(at, { raw: true, headers: same ? headers : {}, timeoutMs });
      const to = res.headers.location;
      const location = Array.isArray(to) ? to[0] : to;
      const redirect = res.status >= 300 && res.status < 400 && location;
      if (!redirect || hop >= maxRedirects) return { ...res, url: at };
      at = new URL(location, at).toString();
    }
  }
  function errorMessage(res) {
    const j = res.json;
    if (j) {
      if (Array.isArray(j.errorMessages) && j.errorMessages.length) return j.errorMessages.join(" ");
      if (j.error_description) return `${j.error || "error"}: ${j.error_description}`;
      if (j.error) return String(j.error);
      if (j.message) return String(j.message);
    }
    return res.text.slice(0, 300) || `HTTP ${res.status}`;
  }

  // src/core/loopback.ts
  var CALLBACK_PORT = 8471;
  var CALLBACK_PATH = "/callback";
  var REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
  var SignInCancelled = class extends Error {
    constructor() {
      super("Sign-in cancelled.");
      this.name = "SignInCancelled";
    }
  };
  var cancelPending = null;
  function cancelSignIn() {
    if (!cancelPending) return false;
    cancelPending();
    return true;
  }
  var escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function httpResponse(title2, body, status = "200 OK") {
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title2)}</title><body style="font:14px system-ui;padding:3rem;text-align:center"><h2>${escapeHtml(title2)}</h2><p>${escapeHtml(body)}</p></body>`;
    return [
      `HTTP/1.1 ${status}`,
      "Content-Type: text/html; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(html)}`,
      "Connection: close",
      "",
      html
    ].join("\r\n");
  }
  function awaitAuthCode(expectedState, timeoutMs = 12e4, onReady) {
    const net = nodeRequire("net");
    return new Promise((resolve, reject) => {
      let settled = false;
      let server;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancelPending = null;
        try {
          server.close();
        } catch {
        }
        fn();
      };
      cancelPending = () => finish(() => reject(new SignInCancelled()));
      const timer = setTimeout(
        () => finish(() => reject(new Error(`No response within ${Math.round(timeoutMs / 1e3)}s. Sign-in was not completed.`))),
        timeoutMs
      );
      server = net.createServer((socket) => {
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          if (buf.indexOf("\r\n\r\n") === -1 && buf.length < 8192) return;
          const requestLine = buf.split("\r\n")[0] || "";
          const target = requestLine.split(" ")[1] || "";
          if (!target.startsWith(CALLBACK_PATH)) {
            socket.end(httpResponse("Not found", "Nothing here.", "404 Not Found"));
            return;
          }
          const query = new URLSearchParams(target.slice(target.indexOf("?") + 1));
          const error = query.get("error");
          const code = query.get("code");
          const state2 = query.get("state");
          if (state2 !== expectedState) {
            socket.end(httpResponse(
              "Sign-in failed",
              "The response did not match this request. Go back to Blockbench and try again.",
              "400 Bad Request"
            ));
            return;
          }
          if (error) {
            const description = query.get("error_description") || "";
            socket.end(httpResponse("Sign-in failed", `${error}: ${description}`, "400 Bad Request"));
            finish(() => reject(new Error(`${error}: ${description || "no description"}`)));
            return;
          }
          if (!code) {
            socket.end(httpResponse("Sign-in failed", "No authorization code was returned.", "400 Bad Request"));
            finish(() => reject(new Error("No authorization code in the callback.")));
            return;
          }
          socket.end(httpResponse("Signed in", "You can close this tab and go back to Blockbench."));
          finish(() => resolve({ code, state: state2 }));
        });
        socket.on("error", () => {
        });
      });
      server.on("error", (e) => {
        finish(() => reject(new Error(
          e.code === "EADDRINUSE" ? `Port ${CALLBACK_PORT} is already in use. Close whatever holds it and sign in again.` : `Could not listen on ${CALLBACK_PORT}: ${e.message}`
        )));
      });
      server.listen(CALLBACK_PORT, "127.0.0.1", () => {
        try {
          onReady?.();
        } catch (e) {
          finish(() => reject(new Error(`Could not open the browser: ${e?.message || e}`)));
        }
      });
    });
  }

  // src/core/auth.ts
  var CLIENT_ID = "Qtf1C4NuCKoPyzVGjWHrzFJRcEmrH49L";
  var AUTH_HOST = "https://auth.atlassian.com";
  var API_HOST = "https://api.atlassian.com";
  var STUDIO_HOST = "embodygames.atlassian.net";
  var SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"];
  var K_ACCESS = "jira_access_token";
  var K_REFRESH = "jira_refresh_token";
  var K_EXPIRES = "jira_expires_at";
  var K_CLOUD = "jira_cloud_id";
  var K_SITE_URL = "jira_site_url";
  var EXPIRY_MARGIN_MS = 12e4;
  var inFlightRefresh = null;
  function b64url(buf) {
    return buf.toString("base64url");
  }
  function randomToken(bytes = 32) {
    return b64url(nodeRequire("crypto").randomBytes(bytes));
  }
  function challengeFor(verifier) {
    return b64url(nodeRequire("crypto").createHash("sha256").update(verifier).digest());
  }
  function authorizeUrl(state2, challenge) {
    const q = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: CLIENT_ID,
      scope: SCOPES.join(" "),
      redirect_uri: REDIRECT_URI,
      state: state2,
      response_type: "code",
      prompt: "consent",
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    return `${AUTH_HOST}/authorize?${q.toString()}`;
  }
  function persist(t) {
    const entries = {
      [K_ACCESS]: t.access_token,
      [K_EXPIRES]: String(Date.now() + t.expires_in * 1e3)
    };
    if (t.refresh_token) entries[K_REFRESH] = t.refresh_token;
    vault.setMany(entries);
  }
  var TokenError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "TokenError";
      this.code = code;
    }
  };
  async function exchange(body) {
    if (false) {
      throw new TokenError(
        null,
        "Sign-in failed \u2014 this build has no token broker configured (BROKER_URL)."
      );
    }
    const res = await request(`${"https://kumonga-auth.embodygames.workers.dev"}/token`, {
      method: "POST",
      body
    });
    if (!res.ok || !res.json?.access_token) {
      throw new TokenError(res.json?.error ?? null, `Sign-in failed \u2014 ${errorMessage(res)}`);
    }
    return res.json;
  }
  function pickSite(resources, preferredCloudId) {
    if (!resources.length) return null;
    if (resources.length === 1) return resources[0];
    return resources.find((r) => r.cloudId === preferredCloudId) ?? resources.find((r) => {
      try {
        return new URL(r.url).hostname === STUDIO_HOST;
      } catch {
        return false;
      }
    }) ?? resources[0];
  }
  var pendingUrl = null;
  var auth = {
    isSignedIn() {
      try {
        return !!vault.get(K_REFRESH);
      } catch {
        return false;
      }
    },
    /** The Atlassian consent URL of the sign-in in progress, or null. */
    pendingSignInUrl() {
      return pendingUrl;
    },
    /** Ends a sign-in that is waiting on the browser. See `cancelSignIn`. */
    cancelSignIn() {
      return cancelSignIn();
    },
    /**
     * Full interactive sign-in. Binds the listener first, then opens the browser
     * — the reverse order loses callbacks that arrive before the socket is up.
     */
    async signIn() {
      if (!vault.available()) throw new Error(vault.unavailableReason());
      for (const module of ["fs", "net", "https", "shell"]) nodeRequire(module);
      vault.selfTest();
      const state2 = randomToken(16);
      const verifier = randomToken(32);
      const url = authorizeUrl(state2, challengeFor(verifier));
      pendingUrl = url;
      let code;
      try {
        ;
        ({ code } = await awaitAuthCode(state2, 12e4, () => {
          nodeRequire("shell").openExternal(url);
        }));
      } finally {
        pendingUrl = null;
      }
      const tokens2 = await exchange({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      });
      const site = await auth.resolveSite(tokens2.access_token);
      vault.setMany({
        [K_ACCESS]: tokens2.access_token,
        [K_EXPIRES]: String(Date.now() + tokens2.expires_in * 1e3),
        ...tokens2.refresh_token ? { [K_REFRESH]: tokens2.refresh_token } : {},
        [K_CLOUD]: site.cloudId,
        [K_SITE_URL]: site.url
      });
      return site;
    },
    async resolveSite(accessToken) {
      const res = await request(
        `${API_HOST}/oauth/token/accessible-resources`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok || !res.json?.length) {
        throw new Error(`Could not resolve the Jira site \u2014 ${errorMessage(res)}`);
      }
      let stored = null;
      try {
        stored = vault.get(K_CLOUD);
      } catch {
      }
      const site = pickSite(
        res.json.map((r) => ({ cloudId: r.id, site: r.name, url: r.url })),
        stored
      );
      return site;
    },
    /**
     * A valid access token, refreshed if it is close to expiry.
     *
     * Single-flight, and that is not an optimisation. Refresh tokens are
     * single-use: two concurrent refreshes send the same token twice, the second
     * is rejected as already-consumed, and the artist is signed out of their own
     * account. A poll overlapping a manual refresh is enough to trigger it, so
     * every caller waits on the same promise.
     */
    async accessToken() {
      const current3 = vault.get(K_ACCESS);
      const expiresAt = Number(vault.get(K_EXPIRES) || 0);
      if (current3 && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return current3;
      if (!inFlightRefresh) {
        const refresh = vault.get(K_REFRESH);
        if (!refresh) throw new Error("Not signed in to Jira.");
        inFlightRefresh = exchange({ grant_type: "refresh_token", refresh_token: refresh }).then((tokens2) => {
          persist(tokens2);
          return tokens2.access_token;
        }).catch((e) => {
          if (e instanceof TokenError && e.code === "invalid_grant") {
            auth.signOut();
            throw new Error("Your Jira sign-in has expired. Sign in again.");
          }
          throw e;
        }).finally(() => {
          inFlightRefresh = null;
        });
      }
      return inFlightRefresh;
    },
    cloudId() {
      return vault.get(K_CLOUD);
    },
    /**
     * The site's browse URL, e.g. https://embodygames.atlassian.net.
     *
     * Resolved lazily and cached: sessions that signed in before this was stored
     * have a cloud id and nothing else, and the cloud id cannot be turned into a
     * hostname locally. Hardcoding the studio's own site would break the moment
     * anyone signs in to a second one.
     */
    async siteUrl() {
      const stored = vault.get(K_SITE_URL);
      if (stored) return stored;
      try {
        const site = await auth.resolveSite(await auth.accessToken());
        vault.set(K_SITE_URL, site.url);
        return site.url;
      } catch {
        return null;
      }
    },
    signOut() {
      vault.deleteMany([K_ACCESS, K_REFRESH, K_EXPIRES, K_CLOUD, K_SITE_URL]);
    }
  };

  // src/jira/base.ts
  async function jiraBase() {
    const token = await auth.accessToken();
    const cloudId = auth.cloudId();
    if (!cloudId) throw new Error("No Jira site resolved. Sign in again.");
    return { url: `https://api.atlassian.com/ex/jira/${cloudId}`, token };
  }
  var ApiError = class extends Error {
    status;
    // Not a parameter property: Node strips types without transforming, and
    // `constructor(public status: number)` is a transform, not a strip — a
    // SyntaxError at load in every test that imports this (AGENTS.md conventions).
    constructor(status, message) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  };
  var withAuth = (token, opts) => ({
    method: opts.method,
    body: opts.body,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` }
  });
  async function jira(path, opts = {}) {
    const { url, token } = await jiraBase();
    return requestWithRetry(`${url}${path}`, withAuth(token, opts), opts.attempts);
  }
  function explainFailure(status, detail) {
    if (/scope does not match/i.test(detail) || status === 401) {
      return "Your Jira sign-in predates write access.\n\nKumonga menu \u2192 Sign out of Jira, then Sign in to Jira. Refreshing the token is not enough \u2014 scopes are fixed at consent.";
    }
    if (status === 403) {
      return "You do not have permission to edit this issue in Jira.";
    }
    return detail;
  }
  async function api(path, opts = {}) {
    const res = await jira(path, opts);
    if (!res.ok) throw new ApiError(res.status, explainFailure(res.status, errorMessage(res)));
    return res.json;
  }

  // src/model/duration.ts
  function formatEstimate(seconds) {
    const mins = Math.round(Math.max(0, seconds) / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }
  function parseDuration(input) {
    const text = (input || "").trim().toLowerCase();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 60);
    const units = {
      w: 5 * 8 * 3600,
      d: 8 * 3600,
      h: 3600,
      m: 60
    };
    let total = 0;
    let matched = false;
    const re = /(\d+(?:\.\d+)?)\s*([wdhm])/g;
    let m;
    let consumed = "";
    while (m = re.exec(text)) {
      total += parseFloat(m[1]) * units[m[2]];
      consumed += m[0];
      matched = true;
    }
    if (!matched) return null;
    if (consumed.replace(/\s+/g, "") !== text.replace(/\s+/g, "")) return null;
    if (total <= 0) return null;
    return Math.round(total);
  }

  // src/model/checklist.ts
  var ChecklistDrift = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ChecklistDrift";
    }
  };
  function replaceLine(field, edit, replacement) {
    const lines = field.split("\n");
    if (edit.index < 0 || edit.index >= lines.length) {
      throw new ChecklistDrift(
        "That checklist item is no longer where it was \u2014 refresh and try again."
      );
    }
    if (lines[edit.index] !== edit.expected) {
      throw new ChecklistDrift(
        "The checklist changed since it was read, so nothing was written. Refresh and try again."
      );
    }
    lines[edit.index] = replacement;
    return lines.join("\n");
  }
  function renameItemLine(raw, newText) {
    const m = ITEM_LINE.exec(raw);
    if (!m) throw new ChecklistDrift("That line is not a checklist item.");
    const [, indent, marker, gap, body, cr] = m;
    const { leading, rest } = leadingTokens(body);
    const trailing = trailingMetadata(rest);
    const name = newText.trim();
    if (!name) throw new ChecklistDrift("An item needs a name.");
    return `${indent}${marker}${gap}${leading}${name}${trailing}${cr}`;
  }
  function setEstimateLine(raw, seconds) {
    const m = ITEM_LINE.exec(raw);
    if (!m) throw new ChecklistDrift("That line is not a checklist item.");
    const [, indent, marker, gap, body, cr] = m;
    const { leading, rest } = leadingTokens(body);
    let trailing = trailingMetadata(rest);
    const name = rest.slice(0, rest.length - trailing.length).trimEnd();
    const atEnd = estimateTail(trailing);
    if (atEnd) trailing = trailing.slice(0, trailing.length - atEnd.tail.length);
    const atStart = /^(\s*\[([^\]]*)\])/.exec(trailing);
    if (atStart && !/^\d+(\.\d+)?$/.test(atStart[2].trim()) && parseDuration(atStart[2]) !== null) {
      trailing = trailing.slice(atStart[0].length);
    }
    const estimate = seconds && seconds > 0 ? ` [${formatEstimate(seconds)}]` : "";
    return `${indent}${marker}${gap}${leading}${name}${estimate}${trailing}${cr}`;
  }
  var PRIORITY_RANK = {
    highest: 0,
    blocker: 0,
    urgent: 0,
    high: 1,
    critical: 1,
    major: 1,
    medium: 2,
    normal: 2,
    low: 3,
    minor: 3,
    lowest: 4,
    trivial: 4
  };
  function byPriority(items) {
    const rank = (p) => PRIORITY_RANK[(p ?? "").toLowerCase()] ?? 2;
    return items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item.priority) - rank(b.item.priority) || a.i - b.i).map((x) => x.item);
  }
  function setPriorityLine(raw, priority) {
    const m = ITEM_LINE.exec(raw);
    if (!m) throw new ChecklistDrift("That line is not a checklist item.");
    const [, indent, marker, gap, body, cr] = m;
    const value = priority?.trim() ?? "";
    if (/["\]\[]/.test(value)) throw new ChecklistDrift("A priority cannot contain quotes or brackets.");
    let rest = body;
    let others = "";
    for (; ; ) {
      const lead = /^\[([^\]]*)\]\s*/.exec(rest);
      if (!lead) break;
      const inner = lead[1].trim();
      const kv = /^([A-Za-z_][\w-]*)\s*=/.exec(inner);
      if (kv && kv[1].toLowerCase() === "priority") {
        rest = rest.slice(lead[0].length);
        continue;
      }
      if (!(kv ? isKnownAttribute(kv[1]) : overlayStatus(inner))) break;
      others += lead[0];
      rest = rest.slice(lead[0].length);
    }
    const token = value ? `[priority="${value}"] ` : "";
    return `${indent}${marker}${gap}${token}${others}${rest}${cr}`;
  }
  var ITEM_LINE = /^(\s*)(\S)(\s+)(.*?)(\r?)$/;
  var ITEM_BODY = /^\s*\S\s+(.*?)\r?$/;
  function isKnownAttribute(key) {
    return /^(priority|due)$/i.test(key);
  }
  function foldName(s) {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }
  function leadingTokens(body) {
    let rest = body;
    let leading = "";
    for (; ; ) {
      const lead = /^\[([^\]]*)\]\s*/.exec(rest);
      if (!lead) break;
      const inner = lead[1].trim();
      const kv = /^([A-Za-z_][\w-]*)\s*=/.exec(inner);
      const isAttr = !!kv && isKnownAttribute(kv[1]);
      if (!isAttr && !overlayStatus(inner)) break;
      leading += lead[0];
      rest = rest.slice(lead[0].length);
    }
    return { leading, rest };
  }
  function trailingMetadata(body) {
    let rest = body;
    let tail = "";
    const first = estimateTail(rest);
    if (first) {
      tail = first.tail;
      rest = rest.slice(0, rest.length - first.tail.length);
    }
    const tokens2 = rest.split(/(\s+)/);
    let cut = tokens2.length;
    for (let i = tokens2.length - 1; i >= 0; i--) {
      const token = tokens2[i];
      if (/^\s+$/.test(token)) continue;
      if (/^([@!]\S+|#[A-Za-z]\S*|due:\S+|\(\(.*\)\))$/i.test(token)) {
        cut = i;
        continue;
      }
      break;
    }
    if (cut > 0 && /^\s+$/.test(tokens2[cut - 1])) cut--;
    tail = tokens2.slice(cut).join("") + tail;
    rest = tokens2.slice(0, cut).join("");
    const second = estimateTail(rest);
    if (second) tail = second.tail + tail;
    return tail;
  }
  function estimateTail(body) {
    const m = /(\s*\[([^\]]*)\])\s*$/.exec(body);
    if (!m) return null;
    const inner = m[2].trim();
    if (/^\d+(\.\d+)?$/.test(inner)) return null;
    const seconds = parseDuration(inner);
    return seconds === null ? null : { tail: body.slice(m.index), seconds };
  }
  function setMarkerLine(raw, marker) {
    const m = ITEM_LINE.exec(raw);
    if (!m) throw new ChecklistDrift("That line is not a checklist item.");
    if (!marker || marker.length !== 1) {
      throw new ChecklistDrift("A checklist marker is a single character.");
    }
    const [, indent, , gap, body, cr] = m;
    return `${indent}${marker}${gap}${body}${cr}`;
  }
  function itemStates(legend) {
    if (!legend) return [];
    return Object.entries(legend).filter(([, label]) => !/^header$/i.test(String(label))).map(([marker, label]) => ({ marker, label: String(label) }));
  }
  function markerForLabel(legend, label) {
    const want = label.toLowerCase();
    return itemStates(legend).find((s) => s.label.toLowerCase() === want)?.marker ?? null;
  }
  function itemMeta(raw) {
    const m = ITEM_BODY.exec(raw);
    let body = m ? m[1] : raw.trim();
    let due = null;
    let priority = null;
    let status = null;
    for (; ; ) {
      const lead = /^\[([^\]]*)\]\s*/.exec(body);
      if (!lead) break;
      const inner = lead[1].trim();
      const kv = /^([A-Za-z_][\w-]*)\s*=\s*"?([^"]*)"?$/.exec(inner);
      if (kv) {
        const key = kv[1].toLowerCase();
        const value = kv[2].trim();
        if (!isKnownAttribute(key)) break;
        if (key === "priority") priority = value || null;
        else due = value || null;
      } else {
        const canon = overlayStatus(inner);
        if (!canon) break;
        status = canon;
      }
      body = body.slice(lead[0].length);
    }
    const meta = trailingMetadata(body);
    const name = body.slice(0, body.length - meta.length).trim();
    for (const token of meta.trim().split(/\s+/)) {
      if (/^due:/i.test(token)) due ??= token.slice(4) || null;
    }
    let estimate = null;
    for (const m2 of meta.matchAll(/\[([^\]]*)\]/g)) {
      const found = estimateTail(m2[0]);
      if (found) {
        estimate = found.seconds;
        break;
      }
    }
    return { name, status, due, priority, estimate };
  }
  var WANTED_ITEM_STATES = [
    "Todo",
    "In Progress",
    "Needs Changes",
    "Done",
    "In QA",
    "Skipped"
  ];
  function missingItemStates(legend) {
    const have2 = new Set(itemStatuses(legend).map((s) => s.label.toLowerCase()));
    return WANTED_ITEM_STATES.filter((w) => !have2.has(w.toLowerCase()));
  }
  var ITEM_OVERLAY_STATES = ["Needs Changes", "In QA"];
  var OVERLAY_ALIASES = {
    "Needs Changes": ["needs changes"],
    "In QA": ["in qa", "qa"]
  };
  function isQa(label) {
    return OVERLAY_ALIASES["In QA"].includes(label.toLowerCase().trim());
  }
  var OVERLAY_BASE = {
    "Needs Changes": "Todo",
    // Todo, not Done, since D-77: Smart Checklist corrects the marker to the
    // status's configured checkbox state, and QA is configured Unchecked — a
    // clip awaiting review is not finished. The base written here MUST match
    // that setting or the app rewrites the line a few seconds later.
    "In QA": "Todo"
  };
  var STATUS_ORDER = ["Todo", "In Progress", "Needs Changes", "In QA", "Done", "Skipped"];
  function overlayStatus(word) {
    const want = word.toLowerCase().trim();
    return ITEM_OVERLAY_STATES.find((s) => OVERLAY_ALIASES[s].includes(want)) ?? null;
  }
  function setOverlayLine(raw, status) {
    const m = ITEM_LINE.exec(raw);
    if (!m) throw new ChecklistDrift("That line is not a checklist item.");
    const [, indent, marker, gap, body, cr] = m;
    if (status !== null && !overlayStatus(status)) {
      throw new ChecklistDrift(`"${status}" is not a checklist status Kumonga knows.`);
    }
    let rest = body;
    let attrs = "";
    for (; ; ) {
      const lead = /^\[([^\]]*)\]\s*/.exec(rest);
      if (!lead) break;
      const inner = lead[1].trim();
      if (overlayStatus(inner)) {
        rest = rest.slice(lead[0].length);
        continue;
      }
      const kv = /^([A-Za-z_][\w-]*)\s*=/.exec(inner);
      if (!kv || !isKnownAttribute(kv[1])) break;
      attrs += lead[0];
      rest = rest.slice(lead[0].length);
    }
    const prefix = status ? `[${overlayStatus(status)}] ` : "";
    return `${indent}${marker}${gap}${attrs}${prefix}${rest}${cr}`;
  }
  function itemStatuses(legend) {
    const markers = itemStates(legend);
    const byLabel = (label) => markers.find((m) => m.label.toLowerCase() === label.toLowerCase())?.marker ?? null;
    const out = markers.map((m) => ({
      label: m.label,
      marker: m.marker,
      overlay: null
    }));
    for (const name of ITEM_OVERLAY_STATES) {
      const base = byLabel(OVERLAY_BASE[name]);
      if (base) out.push({ label: name, marker: base, overlay: name });
    }
    const rank = (label) => {
      const i = STATUS_ORDER.findIndex((s) => s.toLowerCase() === label.toLowerCase());
      return i === -1 ? STATUS_ORDER.length : i;
    };
    return out.sort((a, b) => rank(a.label) - rank(b.label));
  }
  function statusOf(item, legend) {
    return item.status ?? legend?.[item.marker] ?? item.marker;
  }
  function setStatusLine(raw, status) {
    return setOverlayLine(setMarkerLine(raw, status.marker), status.overlay);
  }
  function replaceLines(field, edits) {
    let out = field;
    for (const edit of edits) {
      out = replaceLine(out, edit, edit.replacement);
    }
    return out;
  }
  function appendItems(field, names, marker = "-") {
    if (!marker || marker.length !== 1) {
      throw new ChecklistDrift("A checklist marker is a single character.");
    }
    const taken = new Set(
      field.split("\n").map((line) => /^\s*\S\s+/.test(line) ? foldName(itemMeta(line).name) : "").filter(Boolean)
    );
    const added = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const k = foldName(itemMeta(`${marker} ${name}`).name || name);
      if (taken.has(k)) continue;
      taken.add(k);
      added.push(name);
    }
    if (!added.length) return { text: field, added };
    const eol = field.includes("\r\n") ? "\r\n" : "\n";
    const base = field === "" || field.endsWith("\n") ? field : field + eol;
    return { text: base + added.map((n) => `${marker} ${n}${eol}`).join(""), added };
  }

  // src/model/task.ts
  var CHECKLIST_FIELD = "customfield_10501";
  var SEARCH_FIELDS = [
    "summary",
    "status",
    "priority",
    "components",
    "labels",
    "parent",
    "timetracking",
    "duedate",
    "assignee",
    "issuetype",
    "project",
    CHECKLIST_FIELD
  ];
  var SEARCH_PROPERTIES = ["timer-running"];
  function itemsInQa(task2) {
    return (task2.checklist ?? []).filter((i) => isQa(statusOf(i, task2.checklistFormat))).length;
  }
  function handedOver(task2) {
    const items = task2.checklist ?? [];
    return itemsInQa(task2) > 0 || items.length > 0 && items.every((i) => i.resolved);
  }
  function runningElsewhere(tasks, me, localKey) {
    const mine = tasks.find((t) => t.timerRunning === true && t.key !== localKey && (!t.assignee || !me || t.assignee.accountId === me));
    return mine?.key ?? null;
  }
  function isWorkItem(issueType) {
    if (!issueType) return true;
    if (typeof issueType.hierarchyLevel === "number") {
      return issueType.hierarchyLevel <= 0;
    }
    if (typeof issueType.subtask === "boolean" && issueType.subtask) return true;
    const name = String(issueType.name ?? "");
    return !/^(epic|asset|project|initiative)$/i.test(name);
  }
  function parseChecklist(field) {
    if (!field || typeof field.v !== "string") return null;
    const legend = field.format || {};
    const resolvedMarkers = new Set(
      Object.keys(legend).filter((m) => /^(done|skipped)$/i.test(String(legend[m])))
    );
    const headerMarkers = new Set(
      Object.keys(legend).filter((m) => /^header$/i.test(String(legend[m])))
    );
    const items = [];
    const lines = field.v.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const m = raw.match(/^\s*(\S)\s+(.*?)\r?$/);
      if (!m) continue;
      const [, marker, text] = m;
      if (!(marker in legend)) continue;
      if (headerMarkers.has(marker)) continue;
      const meta = itemMeta(raw);
      items.push({
        index: i,
        marker,
        text: text.trim(),
        name: meta.name || text.trim(),
        status: meta.status,
        due: meta.due,
        priority: meta.priority,
        estimate: meta.estimate,
        resolved: resolvedMarkers.has(marker),
        raw
      });
    }
    return items;
  }
  var ANIMATION_COMPONENT = "Animation";
  var ANIMATION_TOOLS = ["Blockbench", "Blender"];
  function animationTool(labels) {
    for (const tool of ANIMATION_TOOLS) {
      if (labels.some((l) => l.toLowerCase() === tool.toLowerCase())) return tool;
    }
    return null;
  }
  function scopeOf(components, inScope, labels = []) {
    if (!components.length) return "untagged";
    if (components.includes(ANIMATION_COMPONENT) && animationTool(labels) === "Blender") {
      return "out";
    }
    return components.some((c) => inScope.includes(c)) ? "in" : "out";
  }
  function toTask(issue, inScope) {
    const f = issue.fields || {};
    const components = (f.components || []).map((c) => c.name);
    return {
      key: issue.key,
      projectKey: f.project?.key || String(issue.key || "").split("-")[0],
      summary: f.summary || "",
      status: f.status?.name || "",
      statusCategory: f.status?.statusCategory?.key || "",
      priority: f.priority?.name || "Medium",
      component: components[0] ?? null,
      components,
      labels: f.labels || [],
      duedate: f.duedate || null,
      hours: f.timetracking?.timeSpentSeconds ? Math.round(f.timetracking.timeSpentSeconds / 360) / 10 : null,
      assignee: f.assignee?.accountId ? { name: f.assignee.displayName || "Unknown", accountId: f.assignee.accountId } : null,
      parent: f.parent?.fields?.summary || null,
      parentKey: f.parent?.key || null,
      epic: null,
      issueType: f.issuetype?.name || "Task",
      checklist: parseChecklist(f[CHECKLIST_FIELD]),
      checklistFormat: f[CHECKLIST_FIELD]?.format ?? null,
      scope: scopeOf(components, inScope, f.labels || []),
      // Absent on an issue Clockwork has never touched; `running` is a count.
      timerRunning: Number(issue.properties?.["timer-running"]?.running ?? 0) > 0
    };
  }
  function localDay(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function dueInfo(task2, now) {
    if (!task2.duedate) return null;
    const today = now ?? /* @__PURE__ */ new Date();
    const todayKey = localDay(today);
    if (task2.duedate === todayKey) return { state: "today", text: "due today" };
    const [y, m, d] = task2.duedate.split("-").map(Number);
    const due = new Date(y, m - 1, d);
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const days = Math.round((due.getTime() - midnight.getTime()) / 864e5);
    if (days < 0) {
      const late = -days;
      const text = late >= 14 ? `${Math.floor(late / 7)}w overdue` : late === 1 ? "1 day overdue" : `${late} days overdue`;
      return { state: "over", text };
    }
    if (days <= 3) return { state: "soon", text: days === 1 ? "due tomorrow" : `due in ${days} days` };
    const MONTHS2 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return { state: "later", text: `due ${d} ${MONTHS2[m - 1] ?? task2.duedate.slice(5, 7)}` };
  }
  var PRIORITY_RANK2 = {
    Highest: 0,
    High: 1,
    Medium: 2,
    Low: 3,
    Lowest: 4
  };
  function taskComparator(now) {
    const late = (t) => dueInfo(t, now)?.state === "over" ? 0 : 1;
    const due = (t) => t.duedate ?? "9999-99-99";
    return (a, b) => late(a) - late(b) || (PRIORITY_RANK2[a.priority] ?? 2) - (PRIORITY_RANK2[b.priority] ?? 2) || (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0);
  }
  function progressLabel(task2) {
    if (task2.checklist === null) {
      return { text: "", complete: false, plain: true };
    }
    const total = task2.checklist.length;
    const done = task2.checklist.filter((i) => i.resolved).length;
    return { text: `${done}/${total}`, complete: total > 0 && done === total, plain: false };
  }

  // src/jira/search.ts
  async function listProjects(excluded) {
    const out = [];
    let startAt = 0;
    for (; ; ) {
      const res = await api(
        `/rest/api/3/project/search?maxResults=100&orderBy=key&startAt=${startAt}`
      );
      const values = res.values || [];
      for (const p of values) {
        if (!excluded.includes(p.key)) out.push({ key: p.key, name: p.name });
      }
      if (res.isLast !== false || !values.length) break;
      startAt += values.length;
    }
    return out;
  }
  async function projectsWithMyWork(excluded) {
    const counts = /* @__PURE__ */ new Map();
    const res = await api("/rest/api/3/search/jql", {
      method: "POST",
      body: {
        jql: "assignee = currentUser() AND statusCategory != Done",
        fields: ["project"],
        maxResults: 100
      }
    });
    for (const issue of res.issues || []) {
      const key = issue.fields?.project?.key;
      if (!key || excluded.includes(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
  var componentCache = /* @__PURE__ */ new Map();
  async function listComponents(projectKey) {
    const hit = componentCache.get(projectKey);
    if (hit) return hit;
    const res = await api(`/rest/api/3/project/${projectKey}/components`);
    const list = Array.isArray(res) ? res : res.values || [];
    const components = list.map((c) => ({
      name: c.name,
      leadAccountId: c.lead?.accountId ?? null,
      leadName: c.lead?.displayName ?? null
    }));
    componentCache.set(projectKey, components);
    return components;
  }
  function clearJiraCaches() {
    componentCache.clear();
    epicCache.clear();
  }
  function jqlFor(projectKey, aggregate, excluded, assignee) {
    const scope = aggregate ? excluded.length ? `AND project NOT IN (${excluded.map((k) => `"${k}"`).join(", ")}) ` : "" : `AND project = "${projectKey}" `;
    const who = assignee ? `assignee = "${assignee}"` : "assignee = currentUser()";
    return `${who} ${scope}AND statusCategory != Done ORDER BY updated DESC`;
  }
  async function searchTasks(projectKey, inScopeComponents, maxPages = 20, opts = {}) {
    const jql = jqlFor(projectKey, !!opts.aggregate, opts.excluded ?? [], opts.assignee);
    const tasks = [];
    let cursor;
    let pages = 0;
    do {
      const body = {
        jql,
        fields: SEARCH_FIELDS,
        properties: SEARCH_PROPERTIES,
        maxResults: 100
      };
      if (cursor) body.nextPageToken = cursor;
      const page = await api(
        "/rest/api/3/search/jql",
        { method: "POST", body }
      );
      for (const issue of page.issues || []) {
        if (!isWorkItem(issue.fields?.issuetype)) continue;
        tasks.push(toTask(issue, inScopeComponents));
      }
      cursor = page.nextPageToken;
      pages++;
    } while (cursor && pages < maxPages);
    await resolveEpics(tasks);
    return { tasks, complete: !cursor };
  }
  var epicCache = /* @__PURE__ */ new Map();
  async function resolveEpics(tasks) {
    const wanted = [...new Set(
      tasks.map((t) => t.parentKey).filter((k) => !!k && !epicCache.has(k))
    )];
    for (let i = 0; i < wanted.length; i += 100) {
      const batch = wanted.slice(i, i + 100);
      try {
        const res = await api("/rest/api/3/search/jql", {
          method: "POST",
          body: {
            jql: `key in (${batch.map((k) => `"${k}"`).join(",")})`,
            fields: ["parent"],
            maxResults: batch.length
          }
        });
        for (const issue of res.issues || []) {
          epicCache.set(issue.key, issue.fields?.parent?.fields?.summary ?? null);
        }
        for (const k of batch) if (!epicCache.has(k)) epicCache.set(k, null);
      } catch {
      }
    }
    for (const t of tasks) {
      t.epic = t.parentKey ? epicCache.get(t.parentKey) ?? null : null;
    }
  }
  async function currentAccountId() {
    const me = await api("/rest/api/3/myself");
    return me?.accountId ?? null;
  }
  function boardJql(projectKey, opts) {
    const scope = opts.aggregate ? opts.excluded.length ? `project NOT IN (${opts.excluded.map((k) => `"${k}"`).join(", ")}) ` : "" : `project = "${projectKey}" `;
    return opts.done ? `${scope}AND statusCategory = Done AND resolutiondate >= -${opts.days ?? 60}d ORDER BY resolutiondate DESC` : `${scope}AND statusCategory != Done ORDER BY updated DESC`;
  }
  async function searchBoard(projectKey, inScopeComponents, opts, maxPages = 5) {
    const jql = boardJql(projectKey, opts).replace(/^AND /, "");
    const tasks = [];
    let cursor;
    let pages = 0;
    do {
      const body = {
        jql,
        fields: SEARCH_FIELDS,
        properties: SEARCH_PROPERTIES,
        maxResults: 100
      };
      if (cursor) body.nextPageToken = cursor;
      const page = await api(
        "/rest/api/3/search/jql",
        { method: "POST", body }
      );
      for (const issue of page.issues || []) {
        if (!isWorkItem(issue.fields?.issuetype)) continue;
        tasks.push(toTask(issue, inScopeComponents));
      }
      cursor = page.nextPageToken;
      pages++;
    } while (cursor && pages < maxPages);
    return { tasks: tasks.filter((t) => t.scope !== "out"), complete: !cursor };
  }

  // src/core/settings.ts
  var DEFAULTS = {
    client: null,
    components: ["Model/Texture", "Animation"],
    excluded: ["INVOICE"],
    lanes: { Backlog: true },
    showAll: false,
    detached: true,
    roots: {},
    aggregateProject: "TT",
    timer: null,
    autoFetch: true,
    debugViewAs: null,
    debugAllowWrites: true,
    debug: false
  };
  function file() {
    return `${pluginDataDir()}/settings.json`;
  }
  var current = null;
  var loadedFromBrokenFile = false;
  function settings() {
    if (current) return current;
    const fs = nodeRequire("fs");
    try {
      if (!fs.existsSync(file())) {
        current = { ...DEFAULTS };
        return current;
      }
    } catch {
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
      current = { ...DEFAULTS, ...raw, lanes: { ...DEFAULTS.lanes, ...raw.lanes || {} } };
    } catch {
      loadedFromBrokenFile = true;
      current = { ...DEFAULTS };
    }
    return current;
  }
  function saveSettings(patch) {
    const next = { ...settings(), ...patch };
    current = next;
    try {
      const fs = nodeRequire("fs");
      const target = file();
      const dir = pluginDataDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (loadedFromBrokenFile && fs.existsSync(target)) {
        try {
          fs.copyFileSync(target, `${target}.bak`);
        } catch {
        }
        loadedFromBrokenFile = false;
      }
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(next, null, 2), "utf8");
      fs.renameSync(`${target}.tmp`, target);
    } catch {
    }
    return next;
  }

  // src/model/paths.ts
  function toPosix(p) {
    const s = p.replace(/\\/g, "/");
    const unc = s.startsWith("//") ? "//" : "";
    return unc + s.slice(unc.length).replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  }
  function comparable(p) {
    const posix = toPosix(p);
    return isWindowsPath(posix) ? posix.toLowerCase() : posix;
  }
  function isUnder(root, absolute) {
    const r = comparable(root);
    const a = comparable(absolute);
    return a === r || a.startsWith(r + "/");
  }
  function relativeTo(root, absolute) {
    if (!isUnder(root, absolute)) return null;
    const rel = toPosix(absolute).slice(toPosix(root).length).replace(/^\//, "");
    return rel || null;
  }
  function isSafeRelative(p) {
    if (!p || p.includes("\\") || p.includes("\0")) return false;
    if (/^([a-zA-Z]:|\/)/.test(p)) return false;
    return !p.split("/").some((seg) => seg === "..");
  }
  function resolveIn(root, relative) {
    const rel = toPosix(relative);
    if (!isSafeRelative(rel)) {
      throw new Error(`Refusing a path that leaves the repository root: ${relative}`);
    }
    return `${toPosix(root)}/${rel}`;
  }
  function toNative(p) {
    return isWindowsPath(p) ? p.split("/").join("\\") : p;
  }
  var isWindowsPath = (p) => /^[a-zA-Z]:/.test(p);
  var dirOf = (p) => {
    const posix = toPosix(p);
    const i = posix.lastIndexOf("/");
    return i < 0 ? "" : posix.slice(0, i);
  };
  var baseOf = (p) => toPosix(p).split("/").pop() ?? "";

  // src/core/roots.ts
  function keyFor(projectKey) {
    return `${auth.cloudId() ?? "unknown"}:${projectKey}`;
  }
  function getRoot(projectKey) {
    return settings().roots[keyFor(projectKey)] ?? null;
  }
  function checkRoot(projectKey, raw) {
    const fs = nodeRequire("fs");
    const path = toPosix((raw || "").trim());
    if (!path) return { ok: false, error: "Pick a folder." };
    let stat;
    try {
      stat = fs.statSync(path);
    } catch {
      return { ok: false, error: `That folder does not exist: ${path}` };
    }
    if (!stat.isDirectory()) return { ok: false, error: "That is a file, not a folder." };
    const mine = keyFor(projectKey);
    for (const [k, v] of Object.entries(settings().roots)) {
      if (k !== mine && isUnder(v, path) && isUnder(path, v)) {
        return { ok: false, error: `That folder is already the root for ${k.split(":")[1]}.` };
      }
    }
    let warning;
    try {
      if (!fs.existsSync(`${path}/.embody-art-root`)) {
        warning = "No .embody-art-root marker here. Double-check this is the right tree.";
      }
    } catch {
    }
    return { ok: true, normalised: path, warning };
  }
  function setRoot(projectKey, raw) {
    const check = checkRoot(projectKey, raw);
    if (!check.ok) return check;
    saveSettings({ roots: { ...settings().roots, [keyFor(projectKey)]: check.normalised } });
    return check;
  }
  function clearRoot(projectKey) {
    const roots = { ...settings().roots };
    delete roots[keyFor(projectKey)];
    saveSettings({ roots });
  }

  // src/core/scan.ts
  var HEAD_BYTES = 8192;
  function readHead(fs, absolute, bytes = HEAD_BYTES) {
    try {
      const fd = fs.openSync(absolute, "r");
      try {
        const buf = Buffer.alloc(bytes);
        const read2 = fs.readSync(fd, buf, 0, bytes, 0);
        return buf.subarray(0, read2).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }
  function headString(head, key) {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(head);
    return m ? m[1] : void 0;
  }
  function identityOf(nativePath) {
    return readIdentity(nodeRequire("fs"), nativePath);
  }
  function readIdentity(fs, absolute) {
    const head = readHead(fs, absolute);
    if (head === null) return {};
    return {
      assetId: headString(head, "embody_asset_id"),
      variant: headString(head, "embody_variant"),
      version: headString(head, "embody_version"),
      // Blockbench's own, not ours: it decides whether an Animation task has one
      // file or several (D-51). Free here — the header is already in memory.
      format: headString(head, "model_format")
    };
  }
  var DEFAULT_SKIP = [".git", "node_modules", ".vscode", "Library", ".embody"];
  function scanRoot(root, opts = {}) {
    const fs = nodeRequire("fs");
    const maxFiles = opts.maxFiles ?? 5e3;
    const skip = new Set(opts.skip ?? DEFAULT_SKIP);
    const out = [];
    const walk = (dir, prefix) => {
      if (out.length >= maxFiles) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= maxFiles) return;
        if (entry.isDirectory()) {
          if (skip.has(entry.name)) continue;
          walk(`${dir}/${entry.name}`, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.name.toLowerCase().endsWith(".bbmodel")) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          out.push({ path: rel, ...readIdentity(fs, `${dir}/${entry.name}`) });
        }
      }
    };
    walk(root, "");
    return out;
  }

  // src/core/pick.ts
  function normalise(picked) {
    if (typeof picked === "string" && picked) return toPosix(picked);
    if (Array.isArray(picked) && picked.length && picked[0]) return toPosix(String(picked[0]));
    return null;
  }
  async function pickFile(opts) {
    const start = opts.startPath ? toNative(toPosix(opts.startPath)) : void 0;
    let present = false;
    try {
      if (typeof Blockbench?.pickFile === "function") {
        present = true;
        return normalise(await Blockbench.pickFile({
          title: opts.title,
          startpath: start,
          extensions: opts.extensions,
          type: opts.typeName
        }));
      }
    } catch {
      present = false;
    }
    if (present) return null;
    try {
      const dialog = nodeRequire("dialog");
      if (typeof dialog?.showOpenDialogSync === "function") {
        return normalise(dialog.showOpenDialogSync({
          title: opts.title,
          defaultPath: start,
          properties: ["openFile"],
          filters: [{ name: opts.typeName, extensions: opts.extensions }]
        }));
      }
    } catch {
    }
    return null;
  }
  async function pickFolder(opts) {
    const start = opts.startPath ? toNative(toPosix(opts.startPath)) : void 0;
    let present = false;
    try {
      if (typeof Blockbench?.pickDirectory === "function") {
        present = true;
        return normalise(await Blockbench.pickDirectory({
          title: opts.title,
          startpath: start
        }));
      }
    } catch {
      present = false;
    }
    if (present) return null;
    try {
      const dialog = nodeRequire("dialog");
      if (typeof dialog?.showOpenDialogSync === "function") {
        return normalise(dialog.showOpenDialogSync({
          title: opts.title,
          defaultPath: start,
          properties: ["openDirectory", "createDirectory"]
        }));
      }
    } catch {
    }
    return null;
  }

  // src/model/footer.ts
  function qaBlockedReason(task2, map) {
    if (task2.checklist === null || task2.checklist.length === 0) {
      const linked = map ? Object.keys(map.assets).length : 0;
      if (linked > 0) return null;
      return task2.checklist === null ? "Nothing is linked yet, so there is no model for the lead to look at." : "The checklist is empty and nothing is linked, so there is no model for the lead to look at.";
    }
    const open = task2.checklist.filter((i) => !i.resolved && !isQa(statusOf(i, task2.checklistFormat)));
    if (!open.length) return null;
    const n = open.length;
    return `${n} checklist item${n === 1 ? "" : "s"} still open.`;
  }
  var FOOTER_STATUSES = /* @__PURE__ */ new Set(["in progress", "qa"]);
  var HIDDEN = /* @__PURE__ */ new Set(["draft"]);
  var AFTER_QA_ONLY = /* @__PURE__ */ new Set(["complete", "needs changes"]);
  function reachableFrom(to, task2) {
    return !AFTER_QA_ONLY.has(to) || underReview(task2);
  }
  function underReview(task2) {
    return task2.status.toLowerCase() === "qa" || handedOver(task2);
  }
  function approveBlockedReason(task2) {
    const items = task2.checklist ?? [];
    const open = items.filter((i) => !i.resolved).length;
    if (!open) return null;
    return `${open} checklist item${open === 1 ? " is" : "s are"} not Done yet.`;
  }
  function movesFor(task2, transitions, map) {
    const buttons = [];
    for (const t of transitions) {
      const to = t.to.toLowerCase();
      if (to === task2.status.toLowerCase()) continue;
      if (HIDDEN.has(to)) continue;
      if (!reachableFrom(to, task2)) continue;
      if (to === "blocked") {
        buttons.push({ transitionId: t.id, label: "Block\u2026", to: t.to, kind: "danger" });
        continue;
      }
      if (to === "qa") {
        const reason = qaBlockedReason(task2, map);
        buttons.push({
          transitionId: t.id,
          label: "Send to QA",
          to: t.to,
          kind: "primary",
          blockedBy: reason ?? void 0
        });
        continue;
      }
      if (to === "in progress") {
        const from = task2.status.toLowerCase();
        const label = from === "blocked" ? "Unblock" : from === "needs changes" ? "\u25B6 Resume work" : from === "qa" ? "Withdraw from QA" : /^(complete|done)$/.test(from) ? "Reopen" : "\u25B6 Start work";
        buttons.push({
          transitionId: t.id,
          label,
          to: t.to,
          kind: from === "qa" || /^(complete|done)$/.test(from) ? "normal" : "go"
        });
        continue;
      }
      buttons.push({ transitionId: t.id, label: t.to, to: t.to, kind: "normal" });
    }
    return buttons;
  }
  function footerFor(task2, transitions, map, review = false) {
    const moves = movesFor(task2, transitions, map);
    if (review && underReview(task2)) {
      const held = approveBlockedReason(task2);
      return moves.filter((b) => AFTER_QA_ONLY.has(b.to.toLowerCase())).map((b) => b.to.toLowerCase() === "complete" ? { ...b, label: "\u2713 Approve & close", kind: "go", blockedBy: held ?? void 0 } : { ...b, label: "Request changes\u2026", kind: "danger" }).sort((a, b) => (a.to.toLowerCase() === "complete" ? 1 : -1) - (b.to.toLowerCase() === "complete" ? 1 : -1));
    }
    return moves.filter((b) => FOOTER_STATUSES.has(b.to.toLowerCase())).sort((a, b) => a.to.toLowerCase() === "in progress" ? -1 : 1);
  }
  function menuMovesFor(task2, transitions, map) {
    return movesFor(task2, transitions, map).filter((b) => !FOOTER_STATUSES.has(b.to.toLowerCase()));
  }

  // src/model/time.ts
  function formatDuration(seconds) {
    const mins = Math.round(Math.max(0, seconds) / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }
  function formatElapsed(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const p = (n) => String(n).padStart(2, "0");
    return `${Math.floor(s / 3600)}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
  }
  function dayOf(worklog) {
    const d = new Date(worklog.started);
    return Number.isNaN(d.getTime()) ? "" : localDay(d);
  }
  function weekOf(day) {
    const start = fromDay(day);
    if (!start) return [];
    const back = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - back);
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(localDay(start));
      start.setDate(start.getDate() + 1);
    }
    return days;
  }
  function addDays(day, delta) {
    const d = fromDay(day);
    if (!d) return day;
    d.setDate(d.getDate() + delta);
    return localDay(d);
  }
  function fromDay(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function labelDay(day, now) {
    const d = fromDay(day);
    if (!d) return day;
    const today = localDay(now ?? /* @__PURE__ */ new Date());
    if (day === today) return "Today";
    if (day === addDays(today, -1)) return "Yesterday";
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ];
    return `${names[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  }
  function byTask(worklogs) {
    const tasks = /* @__PURE__ */ new Map();
    for (const w of worklogs) {
      const t = tasks.get(w.issueKey) ?? { seconds: 0, count: 0 };
      t.seconds += w.seconds;
      t.count += 1;
      tasks.set(w.issueKey, t);
    }
    return [...tasks.entries()].map(([issueKey, t]) => ({ issueKey, ...t })).sort((a, b) => b.seconds - a.seconds);
  }
  function overlaps(existing, started, seconds) {
    const from = started.getTime();
    const to = from + seconds * 1e3;
    return existing.filter((w) => {
      const s = new Date(w.started).getTime();
      if (Number.isNaN(s)) return false;
      return s < to && s + w.seconds * 1e3 > from;
    });
  }
  function startingDescription(running, issueKey) {
    if (!running || running.issueKey !== issueKey) return "";
    return running.item?.trim() ?? "";
  }

  // src/ui/timeview.ts
  var MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  var DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function shortDate(day) {
    const d = fromDay(day);
    return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : day;
  }
  function secondsFor(state2, day, vm) {
    const logged = state2.logs.filter((w) => dayOf(w) === day).reduce((n, w) => n + w.seconds, 0);
    const live = vm.timer && day === todayOf(vm) ? Math.max(0, vm.timer.elapsed) : 0;
    return logged + live;
  }
  function todayOf(vm) {
    const now = vm.now ?? /* @__PURE__ */ new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }
  function renderTimePage(vm) {
    const state2 = vm.time;
    if (!state2) return '<div class="empty"><div class="big">Loading\u2026</div></div>';
    const head = `<div class="tmswitch"><button class="tmsw${state2.view === "day" ? " on" : ""}" data-act="tmview" data-view="day">Day</button><button class="tmsw${state2.view === "week" ? " on" : ""}" data-act="tmview" data-view="week">Week</button></div>`;
    if (state2.error) return head + `<div class="err">${esc(state2.error)}</div>`;
    if (state2.loading && !state2.logs.length) {
      return head + '<div class="empty"><div class="big">Loading\u2026</div></div>';
    }
    return head + (state2.view === "week" ? weekView(state2, vm) : dayView(state2, vm));
  }
  function peakOf(state2, days, vm) {
    return Math.max(3600, ...days.map((d) => secondsFor(state2, d, vm)));
  }
  function dayView(state2, vm) {
    const today = todayOf(vm);
    const days = weekOf(state2.day);
    const peak = peakOf(state2, days, vm);
    const weekTotal = days.reduce((n, d) => n + secondsFor(state2, d, vm), 0);
    const total = secondsFor(state2, state2.day, vm);
    const logs = state2.logs.filter((w) => dayOf(w) === state2.day).sort((a, b) => a.started < b.started ? -1 : 1);
    let h = `<div class="tmnav"><button class="tmarrow" data-act="tmday" data-delta="-1">&#9664;</button><span class="tmdate">${esc(labelDay(state2.day, vm.now))}</span><button class="tmarrow" data-act="tmday" data-delta="1">&#9654;</button>` + (state2.day === today ? '<span class="tmtoday">today</span>' : '<button class="tmjump" data-act="tmtoday">Today</button>') + "</div>";
    const liveBase = vm.timer && state2.day === today ? ` data-el-base="${Math.max(0, total - Math.max(0, vm.timer.elapsed))}"` : "";
    h += `<div class="tmtot"><span class="tmbig"${liveBase}>${esc(formatDuration(total))}</span><span class="tmsub">logged ${state2.day === today ? "today" : "that day"}</span></div>`;
    h += '<div class="tmweek">' + days.map((d) => {
      const secs = secondsFor(state2, d, vm);
      const pct = secs ? Math.max(3, Math.round(secs / peak * 100)) : 0;
      const initial = DAY_INITIALS[fromDay(d)?.getDay() ?? 0];
      return `<button class="tmd${d === state2.day ? " on" : ""}${d === today ? " td" : ""}" data-act="tmpick" data-day="${esc(d)}" title="${esc(formatDuration(secs))}"><span class="tmdbar"><i style="height:${pct}%"></i></span><span class="tmdl">${esc(initial)}<small>${fromDay(d)?.getDate() ?? ""}</small></span></button>`;
    }).join("") + "</div>";
    h += `<div class="tmwk"><span>week to ${esc(shortDate(days[6]))}</span><button class="tmwkv lnk" data-act="tmview" data-view="week">${esc(formatDuration(weekTotal))} &rsaquo;</button></div>`;
    h += '<div class="tmlist">';
    if (vm.timer && state2.day === today) {
      h += `<div class="tment live"><span class="tmpulse"></span><span class="tmtime" data-el="1">${esc(formatElapsed(vm.timer.elapsed))}</span><div class="tmbody"><div class="tmk">${esc(vm.timer.issueKey)}</div><div class="tmd2">running now</div></div></div>`;
    }
    if (!logs.length && !(vm.timer && state2.day === today)) {
      h += '<div class="empty tmempty"><div class="small">Nothing logged.</div></div>';
    }
    for (const w of logs) {
      const summary = taskIn(vm, w.issueKey)?.summary;
      h += `<div class="tment" data-act="tmopen" data-key="${esc(w.issueKey)}"><span class="tmtime">${esc(clockOf(w))}</span><div class="tmbody"><div class="tmk">${esc(w.issueKey)}` + (summary ? `<span class="tmsum2">${esc(summary)}</span>` : "") + `<span class="tmdur">${esc(formatDuration(w.seconds))}</span></div>` + (w.comment ? `<div class="tmd2">${esc(w.comment)}</div>` : '<div class="tmd2 tmnodesc" title="Use the pencil to add one">no description</div>') + "</div>" + (w.id ? `<span class="tmacts"><button class="ib dim" data-act="tmedit" data-key="${esc(w.issueKey)}" data-worklog="${esc(w.id)}" data-seconds="${w.seconds}" data-comment="${esc(w.comment)}" title="Edit this entry">&#9998;</button><button class="ib dim" data-act="tmdelete" data-key="${esc(w.issueKey)}" data-worklog="${esc(w.id)}" data-seconds="${w.seconds}" title="Delete this entry">&#10005;</button></span>` : "") + "</div>";
    }
    h += `</div><div class="tmfoot"><button class="ib" data-act="logtimeday">Log time</button><span class="vmode">${logs.length} entr${logs.length === 1 ? "y" : "ies"}</span></div>`;
    return h;
  }
  function clockOf(w) {
    const d = new Date(w.started);
    if (Number.isNaN(d.getTime())) return "\u2014";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function weekView(state2, vm) {
    const today = todayOf(vm);
    const days = weekOf(state2.day);
    const peak = peakOf(state2, days, vm);
    const weekTotal = days.reduce((n, d) => n + secondsFor(state2, d, vm), 0);
    const worked = days.filter((d) => secondsFor(state2, d, vm) > 0).length;
    const thisWeek = weekOf(today)[0] === days[0];
    let h = `<div class="tmnav"><button class="tmarrow" data-act="tmweekshift" data-delta="-7">&#9664;</button><span class="tmdate">${esc(shortDate(days[0]))} &ndash; ${esc(shortDate(days[6]))}</span><button class="tmarrow" data-act="tmweekshift" data-delta="7">&#9654;</button>` + (thisWeek ? '<span class="tmtoday">this week</span>' : '<button class="tmjump" data-act="tmtoday">This week</button>') + "</div>";
    h += `<div class="tmtot"><span class="tmbig">${esc(formatDuration(weekTotal))}</span><span class="tmsub">across ${worked} day${worked === 1 ? "" : "s"}</span></div>`;
    h += '<div class="wkdays">' + days.map((d) => {
      const secs = secondsFor(state2, d, vm);
      const pct = secs ? Math.max(3, Math.round(secs / peak * 100)) : 0;
      const count = state2.logs.filter((w) => dayOf(w) === d).length;
      const date = fromDay(d);
      return `<div class="wkd${d === today ? " td" : ""}${secs ? "" : " zero"}" data-act="tmpick" data-day="${esc(d)}"><span class="wkdn">${esc(DAY_NAMES[date?.getDay() ?? 0])}</span><span class="wkdd">${date?.getDate() ?? ""}</span><span class="wkbar"><i style="width:${pct}%"></i></span><span class="wkh">${secs ? esc(formatDuration(secs)) : "&mdash;"}</span><span class="wkn">${count || ""}</span></div>`;
    }).join("") + "</div>";
    const rows = byTask(state2.logs);
    const top = rows.length ? rows[0].seconds : 1;
    h += `<div class="tmwk"><span>by task</span><span class="tmwkv">${rows.length}</span></div>`;
    h += '<div class="tmlist">';
    for (const r of rows) {
      const summary = taskIn(vm, r.issueKey)?.summary;
      h += `<div class="tment" data-act="tmopen" data-key="${esc(r.issueKey)}"><div class="tmbody"><div class="tmk">${esc(r.issueKey)}` + (summary ? `<span class="tmsum2">${esc(summary)}</span>` : "") + `<span class="tmdur">${esc(formatDuration(r.seconds))}</span></div><div class="tmd2">${r.count} entr${r.count === 1 ? "y" : "ies"}</div><span class="wkbar tk"><i style="width:${Math.max(3, Math.round(r.seconds / top * 100))}%"></i></span></div></div>`;
    }
    if (!rows.length) {
      h += '<div class="empty tmempty"><div class="small">Nothing logged this week.</div></div>';
    }
    h += "</div>";
    h += `<div class="tmfoot"><button class="ib" data-act="logtimeday">Log time</button><span class="vmode">${state2.logs.length} entries</span></div>`;
    return h;
  }

  // src/model/assetmap.ts
  var ASSET_MAP_PROPERTY = "com.embodygames.assetmap";
  var emptyMap = () => ({ v: 1, assets: {} });
  function parseAssetMap(raw) {
    if (!raw || typeof raw !== "object") return emptyMap();
    const src = raw;
    const out = emptyMap();
    if (typeof src.rig === "string") out.rig = src.rig;
    if (src.clips && typeof src.clips === "object") out.clips = { ...src.clips };
    if (!src.assets || typeof src.assets !== "object") return out;
    for (const [id, asset] of Object.entries(src.assets)) {
      if (!asset || typeof asset !== "object") continue;
      const a = asset;
      const variants = {};
      for (const [name, variant] of Object.entries(a.variants || {})) {
        if (!variant || typeof variant !== "object") continue;
        const v = variant;
        const files = {};
        for (const [slug, file2] of Object.entries(v.files || {})) {
          if (file2 && typeof file2.path === "string" && isSafeRelative(file2.path)) {
            files[slug] = { ...file2 };
          }
        }
        variants[name] = { current: typeof v.current === "string" ? v.current : null, files };
      }
      out.assets[id] = {
        item: typeof a.item === "string" ? a.item : null,
        mode: a.mode === "variant" ? "variant" : "iteration",
        variants
      };
    }
    return out;
  }
  var variantsOf = (asset) => Object.keys(asset.variants);
  function versionsOf(asset, variant) {
    const files = asset.variants[variant]?.files;
    if (!files) return [];
    return Object.keys(files).sort((a, b) => {
      const na = /^v(\d+)$/.exec(a);
      const nb = /^v(\d+)$/.exec(b);
      if (na && nb) return Number(na[1]) - Number(nb[1]);
      return a.localeCompare(b);
    });
  }
  function currentVersion(asset, variant) {
    const v = asset.variants[variant];
    if (!v) return null;
    if (v.current && v.files[v.current]) return v.current;
    const versions = versionsOf(asset, variant);
    return versions.length ? versions[versions.length - 1] : null;
  }
  function allFiles(asset) {
    return variantsOf(asset).flatMap((v) => versionsOf(asset, v).map((s) => asset.variants[v].files[s]));
  }
  function assetForItem(map, itemText) {
    const norm = (s) => foldName(s.replace(/^\s*\[[^\]]*\]\s*/, ""));
    const wanted = norm(itemText);
    for (const [id, asset] of Object.entries(map.assets)) {
      if (asset.item && norm(asset.item) === wanted) return [id, asset];
    }
    return null;
  }
  function unclaimedAssets(map, itemTexts) {
    const claimed = new Set(
      itemTexts.map((t) => assetForItem(map, t)?.[0]).filter(Boolean)
    );
    return Object.entries(map.assets).filter(([id]) => !claimed.has(id));
  }
  function fileNameFor(base, variant, version) {
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return [slug, variant || null, version === "v1" ? null : version].filter(Boolean).join("_") + ".bbmodel";
  }
  function addFileToMap(map, req) {
    const next = {
      ...map,
      assets: { ...map.assets }
    };
    const existing = next.assets[req.assetId];
    const variants = { ...existing?.variants ?? {} };
    const variant = variants[req.variant] ?? { current: null, files: {} };
    variants[req.variant] = {
      // First file in a variant becomes its current; later ones do not steal it.
      // Promotion is an explicit action, never a side effect of linking.
      current: variant.current ?? req.version,
      files: {
        ...variant.files,
        [req.version]: {
          path: req.path,
          ...req.by ? { by: req.by } : {},
          ...req.at ? { at: req.at } : {}
        }
      }
    };
    next.assets[req.assetId] = {
      // An existing item text wins: renaming happens through its own action, and
      // linking a second file must not silently retitle the model.
      item: existing?.item ?? req.item,
      // Mode is set by which action the user took, never inferred from naming.
      mode: existing?.mode ?? "iteration",
      variants
    };
    return next;
  }
  function nextVersion(asset, variant) {
    const files = asset?.variants[variant]?.files ?? {};
    let n = 1;
    while (files[`v${n}`]) n++;
    return `v${n}`;
  }
  function removeFileFromMap(map, req) {
    const asset = map.assets[req.assetId];
    if (!asset?.variants[req.variant]?.files[req.version]) return map;
    const files = { ...asset.variants[req.variant].files };
    delete files[req.version];
    const variants = { ...asset.variants };
    if (Object.keys(files).length === 0) {
      delete variants[req.variant];
    } else {
      const current3 = asset.variants[req.variant].current;
      variants[req.variant] = {
        files,
        current: current3 && current3 !== req.version ? current3 : null
      };
    }
    const assets = { ...map.assets };
    if (Object.keys(variants).length === 0) {
      delete assets[req.assetId];
    } else {
      assets[req.assetId] = { ...asset, variants };
    }
    const next = { ...map, assets };
    if (next.rig === req.assetId && !assets[req.assetId]) delete next.rig;
    return next;
  }
  function setCurrent(map, assetId, variant, version) {
    const asset = map.assets[assetId];
    if (!asset?.variants[variant]?.files[version]) return map;
    return {
      ...map,
      assets: {
        ...map.assets,
        [assetId]: {
          ...asset,
          variants: {
            ...asset.variants,
            [variant]: { ...asset.variants[variant], current: version }
          }
        }
      }
    };
  }
  function renameVariant(map, assetId, from, to) {
    const asset = map.assets[assetId];
    if (!asset?.variants[from]) return map;
    if (from === to) return map;
    if (asset.variants[to]) return map;
    const variants = {};
    for (const [name, variant] of Object.entries(asset.variants)) {
      variants[name === from ? to : name] = variant;
    }
    return {
      ...map,
      assets: { ...map.assets, [assetId]: { ...asset, mode: "variant", variants } }
    };
  }
  function addVariant(map, assetId, name) {
    const asset = map.assets[assetId];
    if (!asset || !name || asset.variants[name]) return map;
    return {
      ...map,
      assets: {
        ...map.assets,
        [assetId]: {
          ...asset,
          mode: "variant",
          variants: { ...asset.variants, [name]: { current: null, files: {} } }
        }
      }
    };
  }
  function movePath(map, assetId, variant, version, path) {
    const asset = map.assets[assetId];
    const file2 = asset?.variants[variant]?.files[version];
    if (!file2) return map;
    return {
      ...map,
      assets: {
        ...map.assets,
        [assetId]: {
          ...asset,
          variants: {
            ...asset.variants,
            [variant]: {
              ...asset.variants[variant],
              files: { ...asset.variants[variant].files, [version]: { ...file2, path } }
            }
          }
        }
      }
    };
  }
  function rebasePaths(map, { from, to }) {
    const prefix = from.replace(/\/+$/, "");
    const target = to.replace(/\/+$/, "");
    if (!prefix || prefix === target) return map;
    let touched = false;
    const assets = {};
    for (const [id, asset] of Object.entries(map.assets)) {
      const variants = {};
      for (const [name, variant] of Object.entries(asset.variants)) {
        const files = {};
        for (const [slug, file2] of Object.entries(variant.files)) {
          if (file2.path === prefix || file2.path.startsWith(`${prefix}/`)) {
            touched = true;
            const rest = file2.path.slice(prefix.length).replace(/^\//, "");
            files[slug] = { ...file2, path: target ? rest ? `${target}/${rest}` : target : rest };
          } else {
            files[slug] = file2;
          }
        }
        variants[name] = { ...variant, files };
      }
      assets[id] = { ...asset, variants };
    }
    return touched ? { ...map, assets } : map;
  }
  function allPaths(map) {
    return Object.values(map.assets).flatMap((a) => allFiles(a).map((f) => f.path));
  }
  function variantForLink(asset, stamped) {
    const names = asset ? variantsOf(asset) : [];
    if (!names.length) return { variant: stamped ?? "" };
    if (stamped !== null && names.includes(stamped)) return { variant: stamped };
    if (names.length === 1) return { variant: names[0] };
    return { choices: names };
  }
  function removeVariant(map, assetId, variant) {
    const asset = map.assets[assetId];
    if (!asset?.variants[variant]) return map;
    const variants = { ...asset.variants };
    delete variants[variant];
    const assets = { ...map.assets };
    if (Object.keys(variants).length === 0) {
      delete assets[assetId];
    } else {
      assets[assetId] = { ...asset, variants };
    }
    const next = { ...map, assets };
    if (next.rig === assetId && !assets[assetId]) delete next.rig;
    return next;
  }

  // src/model/filestate.ts
  var DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
  function resolveFile(file2, assetId, variant, disk, opts = {}) {
    if (!file2) return { state: "unlinked", recorded: null };
    const onDisk = disk.find((d) => d.path === file2.path);
    if (onDisk) return { state: "ok", recorded: file2.path };
    const taken = new Set(opts.taken ?? []);
    const moved = disk.find(
      (d) => d.assetId === assetId && (d.variant ?? "") === variant && d.path !== file2.path && (!opts.version || !d.version || d.version === opts.version) && !taken.has(d.path)
    );
    if (moved) {
      return { state: "moved", recorded: file2.path, found: moved.path, by: file2.by, at: file2.at };
    }
    const now = opts.now ?? Date.now();
    const window2 = opts.unpulledWindowMs ?? DEFAULT_WINDOW_MS;
    const recordedByOther = !!file2.by && !!opts.me && file2.by !== opts.me;
    const recent = !!file2.at && now - Date.parse(file2.at) < window2;
    if (recordedByOther && recent) {
      return { state: "unpulled", recorded: file2.path, by: file2.by, at: file2.at };
    }
    return { state: "missing", recorded: file2.path, by: file2.by, at: file2.at };
  }
  var SEVERITY = {
    missing: 0,
    unpulled: 1,
    moved: 2,
    unlinked: 3,
    ok: 4
  };
  function worstState(states) {
    if (!states.length) return "unlinked";
    return states.reduce((a, b) => SEVERITY[b] < SEVERITY[a] ? b : a);
  }

  // src/model/match.ts
  function stem(word) {
    if (word.length <= 3) return word;
    if (word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (word.endsWith("ves")) return word.slice(0, -3) + "f";
    if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }
  function tokens(name) {
    return name.replace(/\.bbmodel$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/).map((w) => w.toLowerCase()).filter((w) => w && !/^\d+$/.test(w)).map((w) => w.replace(/\d+$/, "")).filter((w) => w.length > 1).map(stem);
  }
  function joinsToRun(joined, t) {
    for (let i = 0; i < t.length; i++) {
      let run = "";
      for (let j = i; j < t.length; j++) {
        run += t[j];
        if (run === joined) return true;
        if (run.length >= joined.length) break;
      }
    }
    return false;
  }
  function findCandidates(query, paths, limit = 3) {
    const q = tokens(query);
    if (!q.length) return [];
    const joined = q.join("");
    const scored = [];
    for (const path of paths) {
      const t = tokens(baseOf(path));
      if (!t.length) continue;
      const matched = q.filter((w) => t.includes(w));
      const byTokens = matched.length === q.length;
      const byRun = joinsToRun(joined, t);
      let score;
      if (byTokens) score = 1;
      else if (byRun) score = 0.9;
      else {
        const substantial = matched.some((w) => w.length >= 4);
        const coverage = matched.length / q.length;
        if (!substantial || coverage < 0.5) continue;
        score = 0.4 + 0.4 * coverage;
      }
      const extra = Math.max(0, t.length - q.length);
      scored.push({ path, score, extra });
    }
    return scored.sort((a, b) => b.score - a.score || a.extra - b.extra || a.path.length - b.path.length).slice(0, limit);
  }
  function bestCandidate(query, paths) {
    const ranked = findCandidates(query, paths, 2);
    if (!ranked.length) return null;
    if (ranked[0].score < 0.9) return null;
    if (ranked.length > 1 && ranked[1].score === ranked[0].score && ranked[1].extra === ranked[0].extra) return null;
    return ranked[0];
  }

  // src/model/structure.ts
  var STOPWORDS = /* @__PURE__ */ new Set(["the", "a", "an", "of", "and", "for", "with"]);
  function noiseTokens(corpus, threshold = 0.25) {
    if (corpus.length < 4) return new Set(STOPWORDS);
    const counts = /* @__PURE__ */ new Map();
    for (const path of corpus) {
      for (const t of new Set(tokens(baseOf(path)))) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const limit = corpus.length * threshold;
    return /* @__PURE__ */ new Set([
      ...STOPWORDS,
      ...[...counts].filter(([, n]) => n > limit).map(([t]) => t)
    ]);
  }
  function trailingNumber(path) {
    const m = /(\d+)$/.exec(baseOf(path).replace(/\.bbmodel$/i, ""));
    return m ? Number(m[1]) : 0;
  }
  function proposeStructure(query, paths, corpus) {
    const noise = noiseTokens(corpus);
    const q = new Set(tokens(query));
    const groups = /* @__PURE__ */ new Map();
    for (const path of paths) {
      const extra = tokens(baseOf(path)).filter((t) => !q.has(t) && !noise.has(t));
      const name = extra.length <= 1 ? extra[0] ?? "" : `\0${path}`;
      const list = groups.get(name) ?? [];
      list.push(path);
      groups.set(name, list);
    }
    const variants = [...groups.entries()].map(([name, list]) => ({
      // A group keyed by its own path is a loner, not a named variant.
      name: name.startsWith("\0") ? "" : name,
      files: list.sort((a, b) => trailingNumber(a) - trailingNumber(b) || a.length - b.length).map((path, i) => ({ path, version: `v${i + 1}` }))
    })).sort((a, b) => a.name === "" ? -1 : b.name === "" ? 1 : a.name.localeCompare(b.name));
    const total = paths.length;
    return { variants, trivial: total <= 1 };
  }
  function describeProposal(p) {
    if (p.trivial) return "";
    const named = p.variants.filter((v) => v.name);
    const versions = p.variants.reduce((n, v) => Math.max(n, v.files.length), 0);
    const bits = [];
    if (named.length) {
      bits.push(`${p.variants.length} variants (${p.variants.map((v) => v.name || "\u2014").join(", ")})`);
    }
    if (versions > 1) bits.push(`${versions} versions`);
    return bits.join(" \xB7 ");
  }

  // src/model/animation.ts
  var SEPARATE_ANIMATION_FORMATS = ["hytale_prop", "hytale_character"];
  function animationsEmbedded(formatId) {
    if (!formatId) return false;
    return !SEPARATE_ANIMATION_FORMATS.includes(formatId);
  }
  function sharesOneFile(shape) {
    return shape.kind !== "none";
  }
  function animationShape(task2, formatId) {
    if (!task2.components.includes(ANIMATION_COMPONENT)) return { kind: "none" };
    const tool = animationTool(task2.labels);
    if (tool === "Blender") return { kind: "blender" };
    if (tool === null) return { kind: "unknown" };
    if (!formatId) return { kind: "unknown" };
    return animationsEmbedded(formatId) ? { kind: "embedded" } : { kind: "separate" };
  }
  function describeShape(shape) {
    switch (shape.kind) {
      case "embedded":
        return "Animations are saved inside the .bbmodel, so this task has one file \u2014 the same model the clips live in.";
      case "separate":
        return "This format keeps animations outside the model, so every clip on this task lives in one animation file beside it.";
      case "blender":
        return "Animated in Blender. Kumonga cannot open or link a .blend, so the clips here are tracked in Jira only.";
      // `unknown` covers both "tool not said" and "tool said, no file linked
      // yet"; the card's "animated where?" button asks the first, and the second
      // needs no sentence.
      default:
        return "";
    }
  }
  function formatOfLinked(paths, disk) {
    const byPath = new Map(disk.map((d) => [d.path, d]));
    for (const p of paths) {
      const fmt = byPath.get(p)?.format;
      if (fmt) return fmt;
    }
    return null;
  }
  function linkedOnDisk(paths, disk) {
    const byPath = new Set(disk.map((d) => d.path));
    for (const p of paths) if (byPath.has(p)) return p;
    return null;
  }

  // src/model/clips.ts
  function normaliseClip(name) {
    return lastSegment(name).toLowerCase().replace(/[_\-\s]+/g, " ").trim();
  }
  function lastSegment(name) {
    return (name.trim().split(".").filter(Boolean).pop() ?? "").trim();
  }
  function assessClips(itemNames, fileClips) {
    const inFile = /* @__PURE__ */ new Map();
    for (const clip of fileClips) {
      const key = normaliseClip(clip);
      if (key && !inFile.has(key)) inFile.set(key, clip);
    }
    const states = {};
    const asked = /* @__PURE__ */ new Set();
    for (const name of itemNames) {
      const key = normaliseClip(name);
      asked.add(key);
      states[name] = inFile.has(key) ? "present" : "missing";
    }
    const extra = [];
    for (const [key, original] of inFile) {
      if (!asked.has(key)) extra.push(original);
    }
    return { states, extra };
  }
  function clipTally(report) {
    const values = Object.values(report.states);
    return { present: values.filter((s) => s === "present").length, total: values.length };
  }
  var NOT_TICKABLE = ["done", "skipped", "qa", "needs changes"];
  function tickable(items, report) {
    return items.filter((i) => report.states[i.name] === "present" && !NOT_TICKABLE.includes(i.status.toLowerCase()));
  }
  function staleTicks(items, report) {
    return items.filter((i) => report.states[i.name] === "missing" && ["done", "qa"].includes(i.status.toLowerCase()));
  }
  function newClipNames(extras, existing) {
    const taken = new Set(existing.map(normaliseClip).filter(Boolean));
    const out = [];
    for (const clip of extras) {
      const key = normaliseClip(clip);
      if (!key || taken.has(key)) continue;
      taken.add(key);
      out.push(lastSegment(clip));
    }
    return out;
  }

  // src/model/review.ts
  function targetKey(target) {
    return `${target.kind}:${target.kind === "clip" ? normaliseClip(target.id) : foldName(target.id)}`;
  }
  function parseReviewProperty(value) {
    const kind = value?.target?.kind;
    const id = value?.target?.id;
    const target = (kind === "asset" || kind === "clip") && typeof id === "string" && id.trim() ? { kind, id: id.trim() } : null;
    return {
      target,
      // Anything that is not the word "resolved" is still open. Feedback that
      // reads as dealt with when it is not is the failure that costs a handoff.
      status: value?.status === "resolved" ? "resolved" : "open",
      attachments: Array.isArray(value?.attachments) ? value.attachments.filter((a) => typeof a === "string") : [],
      at: parsePin(value?.at),
      camera: parseCamera(value?.camera),
      range: parseRange(value?.range),
      resolvedBy: typeof value?.resolvedBy === "string" ? value.resolvedBy : null,
      resolvedAt: typeof value?.resolvedAt === "string" ? value.resolvedAt : null
    };
  }
  function parsePin(value) {
    const time = Number(value?.time);
    const frame = Number(value?.frame);
    const fps = Number(value?.fps);
    if (![time, frame, fps].every(Number.isFinite)) return null;
    if (time < 0 || fps <= 0) return null;
    return { time, frame: Math.round(frame), fps };
  }
  function parseRange(value) {
    const from = parsePin(value?.from);
    const to = parsePin(value?.to);
    if (!from || !to || from.time > to.time) return null;
    return { from, to };
  }
  var vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? [Number(v[0]), Number(v[1]), Number(v[2])] : null;
  function parseCamera(value) {
    const position = vec3(value?.position);
    const target = vec3(value?.target);
    if (!position || !target) return null;
    const out = {
      projection: value?.projection === "orthographic" ? "orthographic" : "perspective",
      position,
      target
    };
    const zoom = Number(value?.zoom);
    if (Number.isFinite(zoom) && zoom > 0) out.zoom = zoom;
    const fov = Number(value?.fov);
    if (Number.isFinite(fov) && fov > 0) out.fov = fov;
    if (typeof value?.angle === "string" && value.angle.trim()) out.angle = value.angle.trim();
    return out;
  }
  function pinAt(time, fps) {
    const rate = Number.isFinite(fps) && fps > 0 ? fps : 24;
    const t = Math.max(0, Math.round(time * 1e3) / 1e3);
    return { time: t, frame: Math.round(t * rate), fps: rate };
  }
  function formatPin(at) {
    return `f${at.frame} \xB7 ${at.time.toFixed(2)}s`;
  }
  function formatFrames(r) {
    return `f${r.from.frame}\u2013f${r.to.frame}`;
  }
  function formatRange(r) {
    return `${formatFrames(r)} \xB7 ${r.from.time.toFixed(2)}\u2013${r.to.time.toFixed(2)}s`;
  }
  function feedback(threads) {
    return threads.filter((t) => t.target !== null);
  }
  function openThreads(threads) {
    return feedback(threads).filter((t) => t.status === "open").sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  }
  function threadsFor(threads, target) {
    const want = targetKey(target);
    return feedback(threads).filter((t) => targetKey(t.target) === want).sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  }
  function openCounts(threads) {
    const out = {};
    for (const t of openThreads(threads)) {
      const key = targetKey(t.target);
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }
  function resolvedCounts(threads) {
    const out = {};
    for (const t of feedback(threads)) {
      if (t.status !== "resolved") continue;
      const key = targetKey(t.target);
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }
  function canPushForReview(threads) {
    return openThreads(threads).length === 0;
  }
  function itemForTarget(task2, target) {
    if (target.kind !== "clip" || !task2.checklist) return null;
    const want = targetKey(target);
    return task2.checklist.find((i) => targetKey({ kind: "clip", id: i.name }) === want) ?? null;
  }

  // src/ui/render.ts
  var LANES = ["Needs a component", "Blocked", "Needs Changes", "In Progress", "QA", "Backlog"];
  function taskIn(vm, key) {
    return vm.tasks.find((t) => t.key === key) ?? vm.qa?.queue.find((t) => t.key === key) ?? vm.qa?.partial?.find((t) => t.key === key) ?? vm.qa?.cleared.find((t) => t.key === key) ?? vm.board?.overview?.tasks.find((t) => t.key === key) ?? vm.board?.done?.tasks.find((t) => t.key === key) ?? null;
  }
  var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function priorityChip(p) {
    if (p === "Highest") return '<span class="urgent">URGENT</span>';
    if (p === "High") return '<span class="high">High</span>';
    return "";
  }
  function laneHead(name, list, now) {
    const overdue = list.filter((t) => dueInfo(t, now)?.state === "over").length;
    return `<span class="ldot s-${name.replace(/[^\w-]/g, "")}"></span><span class="lname">${esc(name.toUpperCase())}</span><span class="lcnt">${list.length}</span>` + (overdue ? `<span class="lbadge over">${overdue} late</span>` : "");
  }
  function primaryOf(asset, id, detail) {
    const variant = variantsOf(asset)[0] ?? "";
    const version = currentVersion(asset, variant);
    const r = resolveVersion(asset, id, variant, version, detail);
    return { variant, version, r };
  }
  function resolveVersion(asset, id, variant, version, detail) {
    const file2 = version ? asset.variants[variant]?.files[version] ?? null : null;
    return resolveFile(file2, id, variant, detail.disk, {
      me: detail.me ?? void 0,
      version: version ?? void 0,
      taken: allFiles(asset).map((f) => f.path)
    });
  }
  function pathCell(asset, id, detail) {
    const variants = variantsOf(asset);
    const { r } = primaryOf(asset, id, detail);
    if (variants.length > 1) {
      const healthy = variants.filter((v) => resolveVersion(asset, id, v, currentVersion(asset, v), detail).state === "ok").length;
      const short = variants.length - healthy;
      return `<span class="ipath">${variants.length} variants` + (short ? ` &middot; ${short} need attention` : "") + "</span>";
    }
    if (r.state === "ok") return `<span class="ipath">${esc(r.recorded ?? "")}</span>`;
    if (r.state === "moved") return '<span class="ipath w" title="Moved \u2014 found elsewhere on disk. Fix updates the record.">moved</span>';
    if (r.state === "unpulled") return '<span class="ipath m" title="Recorded by someone else and not in your copy of the repository yet">not pulled yet</span>';
    if (r.state === "missing") return '<span class="ipath m" title="Recorded here, but nothing is at that path. Locate points at where it went.">missing</span>';
    return '<span class="ipath n">no file yet</span>';
  }
  function rowFix(asset, id, detail) {
    const { variant, version, r } = primaryOf(asset, id, detail);
    if (!version) return "";
    const ref = ` data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" data-version="${esc(version)}"`;
    if (r.state === "moved") {
      return `<button class="ib warn" data-act="repair"${ref} data-old="${esc(r.recorded ?? "")}" data-new="${esc(r.found ?? "")}">Fix</button>`;
    }
    if (r.state === "missing" || r.state === "unpulled") {
      return `<button class="ib warn" data-act="locate"${ref} data-path="${esc(r.recorded ?? "")}" title="Point at the file this record should mean">Locate</button>`;
    }
    return "";
  }
  function nameFor(vm, accountId) {
    if (!accountId) return null;
    const lists = [
      vm.tasks,
      vm.qa?.queue ?? [],
      vm.qa?.cleared ?? [],
      vm.board?.overview?.tasks ?? [],
      vm.board?.done?.tasks ?? []
    ];
    for (const list of lists) {
      const hit = list.find((t) => t.assignee?.accountId === accountId);
      if (hit?.assignee) return hit.assignee.name;
    }
    return null;
  }
  function agoText(iso, now) {
    if (!iso) return null;
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return null;
    const mins = Math.max(0, Math.round((now.getTime() - then) / 6e4));
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  function subnote(asset, id, detail, vm) {
    const { r } = primaryOf(asset, id, detail);
    if (r.state === "moved") {
      return '<div class="subnote">Recorded at <code>' + esc(r.recorded ?? "") + "</code>, found at <code>" + esc(r.found ?? "") + "</code>. The file identifies itself as this model.</div>";
    }
    if (r.state === "unpulled") {
      const who = nameFor(vm, r.by);
      const when = agoText(r.at, vm.now ?? /* @__PURE__ */ new Date());
      const pull = (vm.git?.behind ?? 0) > 0 ? ` <button class="ib" data-act="pull">Pull ${vm.git.behind} commit${vm.git.behind === 1 ? "" : "s"}</button>` : "";
      return '<div class="subnote m">Recorded by <b>' + esc(who ?? "someone else") + "</b>" + (when ? ` ${esc(when)}` : "") + " at <code>" + esc(r.recorded ?? "") + "</code>. You may not have pulled yet &mdash; do not relink." + pull + "</div>";
    }
    return "";
  }
  function versionChip(asset, id, detail) {
    const variants = variantsOf(asset);
    const files = allFiles(asset).length;
    const open = detail.openAsset === id;
    const arrow = open ? "&#9652;" : "&#9662;";
    const gk = ` data-act="group" data-key="${esc(detail.key)}" data-asset="${esc(id)}"`;
    const title2 = ' title="Versions and file actions"';
    if (variants.length > 1 || asset.mode === "variant") {
      return `<button class="vchip var"${gk}${title2}>${files} file${files === 1 ? "" : "s"} ${arrow}</button>`;
    }
    const { version } = primaryOf(asset, id, detail);
    return `<button class="vchip${files > 1 ? "" : " one"}"${gk}${title2}>${esc(version ?? "\u2014")}` + (files > 1 ? `<span class="vn"> +${files - 1}</span>` : "") + ` ${arrow}</button>`;
  }
  function versionList(asset, id, detail) {
    if (detail.openAsset !== id) return "";
    const multi = variantsOf(asset).length > 1 || asset.mode === "variant";
    let h = '<div class="vlist">';
    for (const variant of variantsOf(asset)) {
      const versions = versionsOf(asset, variant);
      const current3 = currentVersion(asset, variant);
      if (multi) {
        h += `<div class="vhead"><span class="vhn">${esc(variant || "base")}</span><span class="vhc">${versions.length} version${versions.length === 1 ? "" : "s"}</span><button class="ib dim" data-act="newversion" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" title="Save what is open in Blockbench as the next version of this variant">+ version</button><button class="ib dim vdel" data-act="delvariant" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" title="Remove this variant and every path recorded under it">&#10005;</button></div>`;
      }
      for (const version of versions) {
        const file2 = asset.variants[variant].files[version];
        const r = resolveVersion(asset, id, variant, version, detail);
        const openable = r.state === "ok" || r.state === "moved";
        const shown = r.state === "moved" ? r.found ?? "" : r.recorded ?? "";
        h += `<div class="vrow${multi ? " ind" : ""}"><span class="vtag${version === current3 ? " cur" : ""}">${esc(version)}</span>` + (file2?.label ? `<span class="vlab">${esc(file2.label)}</span>` : "") + (r.state === "ok" ? `<span class="vpath">${esc(shown)}</span>` : r.state === "moved" ? `<span class="vpath w">${esc(shown)}</span>` : `<span class="vpath m">${esc(r.recorded ?? "missing")}</span>`) + (openable ? `<button class="ib" data-act="open" data-path="${esc(shown)}">Open</button><button class="ib dim" data-act="reveal" data-path="${esc(shown)}" title="Show in the file manager">&#128193;</button>` : "") + (r.state === "moved" ? `<button class="ib warn" data-act="repair" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" data-version="${esc(version)}" data-old="${esc(r.recorded ?? "")}" data-new="${esc(r.found ?? "")}">Fix</button>` : "") + (r.state === "missing" || r.state === "unpulled" ? `<button class="ib warn" data-act="locate" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" data-version="${esc(version)}" data-path="${esc(r.recorded ?? "")}" title="Point at the file this record should mean">Locate</button>` : "") + (version === current3 ? "" : `<button class="ib dim" data-act="makecurrent" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" data-version="${esc(version)}" title="Make this the version that ships">&#9733;</button>`) + `<button class="ib dim" data-act="movefile" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" data-version="${esc(version)}" data-path="${esc(r.recorded ?? "")}" title="Move or rename this file">&#8644;</button><button class="ib dim" data-act="unlink" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(variant)}" data-version="${esc(version)}" data-path="${esc(r.recorded ?? "")}" title="Remove this file from the task. The file itself is not touched.">&#10005;</button></div>`;
      }
    }
    h += '<div class="vfoot">' + (multi ? "" : `<button class="ib" data-act="newversion" data-key="${esc(detail.key)}" data-asset="${esc(id)}" data-variant="${esc(currentVariant(asset))}" title="Save what is open in Blockbench as the next version">save as new version</button>`) + `<button class="ib" data-act="variant" data-key="${esc(detail.key)}" data-asset="${esc(id)}"` + (multi ? ' title="Add another variant">add variant</button>' : ' title="Name what is here, so a second variant can be added">name variant</button>') + `<button class="ib" data-act="linkvariant" data-key="${esc(detail.key)}" data-asset="${esc(id)}" title="Record the open .bbmodel as a file of one of these variants">link existing variant</button></div>`;
    return h + "</div>";
  }
  function currentVariant(asset) {
    const names = variantsOf(asset);
    return names.length === 1 ? names[0] : names[0] ?? "";
  }
  function assetWorst(asset, id, detail) {
    const states = variantsOf(asset).map((v) => resolveVersion(asset, id, v, currentVersion(asset, v), detail).state);
    return worstState(states);
  }
  function linkedPaths(detail) {
    const out = /* @__PURE__ */ new Set();
    for (const asset of Object.values(detail.map?.assets ?? {})) {
      for (const f of allFiles(asset)) out.add(f.path);
    }
    return out;
  }
  function shapeOf(task2, detail) {
    const fmt = detail ? formatOfLinked(linkedPaths(detail), detail.disk) : null;
    return animationShape(task2, fmt);
  }
  function clipReportFor(task2, detail) {
    const names = detail?.clips?.names;
    if (!names) return null;
    return assessClips((task2.checklist ?? []).map((i) => i.name), names);
  }
  function fbChip(vm, taskKey, kind, id, label = "") {
    if (vm.review?.key !== taskKey) return "";
    const n = openCounts(vm.review.threads)[targetKey({ kind, id })] ?? 0;
    if (!n) return "";
    const attrs = `data-act="showfb" data-key="${esc(taskKey)}" data-kind="${kind}" data-id="${esc(id)}"` + (label && label !== id ? ` data-label="${esc(label)}"` : "");
    return `<button class="fbc" ${attrs} title="${n} open note${n === 1 ? "" : "s"} \u2014 open the review">${n}</button>`;
  }
  function feedbackLine(task2, vm) {
    if (vm.page === "review" || vm.review?.key !== task2.key) return "";
    const open = openThreads(vm.review.threads).filter((t) => t.target);
    if (!open.length) return "";
    const who = [...new Set(open.map((t) => t.author))];
    const from = who.length === 1 ? who[0] : who.length === 2 ? `${who[0]} and ${who[1]}` : `${who[0]} and ${who.length - 1} others`;
    return `<div class="fbline"><span>${open.length} open note${open.length === 1 ? "" : "s"} from ${esc(from)}</span><button class="lnk" data-act="page" data-page="review">open Review</button></div>`;
  }
  function clipItems(task2) {
    return (task2.checklist ?? []).map((i) => ({
      index: i.index,
      name: i.name,
      raw: i.raw,
      status: statusOf(i, task2.checklistFormat)
    }));
  }
  function clipChip(report, name) {
    if (!report) return "";
    const state2 = report.states[name];
    if (!state2) return '<span class="clipst"></span>';
    return state2 === "present" ? '<span class="clipst in" title="This animation is in the linked file">in file</span>' : '<span class="clipst out" title="No animation of this name in the linked file">not in file</span>';
  }
  function clipSummary(task2, detail, report, vm) {
    const clips = detail?.clips;
    if (!clips) return "";
    const inQa = task2.status === "QA";
    const lead = !!task2.component && vm.leadComponents.includes(task2.component);
    const mayEdit = !inQa || lead;
    const file2 = `<code title="${esc(clips.path)}">${esc(baseOf(clips.path))}</code>`;
    if (clips.names === null) {
      return `<div class="clipsum bad"><span class="csw">&#9888;</span><span>Could not read the animations in ${file2}, so nothing above is checked against it.</span></div>`;
    }
    if (!report) return "";
    const { present, total } = clipTally(report);
    const all = total > 0 && present === total;
    const head = total ? `<b class="${all ? "csall" : "cssome"}">${present} of ${total}</b> clip${total === 1 ? "" : "s"} on this checklist ${all ? "are" : "were found"} in ${file2}` : `${file2} holds ${clips.names.length} animation${clips.names.length === 1 ? "" : "s"}`;
    const live = clips.live ? ' <span class="cslive" title="Read from the project you have open, not from the saved file">unsaved changes included</span>' : "";
    const items = clipItems(task2);
    const canTick = tickable(items, report);
    const tick2 = canTick.length && lead ? `<button class="ib go" data-act="tickclips" data-key="${esc(task2.key)}">Mark ${canTick.length} Done</button>` : "";
    const stale = staleTicks(items, report);
    const staleLine = stale.length ? `<div class="csbad"><span class="csw">&#9888;</span><span>${stale.length === 1 ? "One finished clip is" : stale.length + " finished clips are"} not in the file: ` + stale.map((i) => `<b>${esc(i.name)}</b>`).join(", ") + ". Renamed, or is this the wrong file? Nothing has been changed.</span></div>" : "";
    const fresh = newClipNames(report.extra, items.map((i) => i.name));
    const extra = report.extra.length ? `<div class="csx"><span class="csxh">${report.extra.length} animation${report.extra.length === 1 ? "" : "s"} in the file that this checklist does not mention` + (fresh.length && mayEdit ? ` <button class="ib" data-act="addclips" data-key="${esc(task2.key)}">Add ${fresh.length} clip${fresh.length === 1 ? "" : "s"} to the checklist</button>` : "") + "</span>" + (fresh.length && mayEdit && inQa ? '<span class="kmwarn csqa">This task is in QA. Adding clips reopens the work, so it goes back to the artist as Needs Changes.</span>' : "") + report.extra.map((c) => `<span class="csxc">${esc(c)}</span>`).join("") + "</div>" : "";
    return `<div class="clipsum${report.extra.length ? " note" : ""}"><div class="csline">${head}${live}${tick2}</div>` + staleLine + extra + "</div>";
  }
  function suggestion(name, detail) {
    if (!detail.hasRoot || !detail.disk.length) return "";
    const already = linkedPaths(detail);
    const paths = detail.disk.map((d) => d.path).filter((p) => !already.has(p));
    if (!paths.length) return "";
    const chip = (path, lead) => `<span class="fchip guess rv" data-act="open" data-path="${esc(path)}" title="${esc(path)} \u2014 click to open this model, Alt+click to show it in the file manager"><em>${esc(lead)}</em> ${esc(baseOf(path))}</span>`;
    const strip = (html) => `<span class="sugg">${html}</span>`;
    const best = bestCandidate(name, paths);
    if (best) return strip(chip(best.path, "maybe"));
    const all = findCandidates(name, paths, 6);
    if (!all.length) return "";
    const proposal = proposeStructure(name, all.map((c) => c.path), paths);
    const summary = describeProposal(proposal);
    const chips = proposal.variants.flatMap(
      (v) => v.files.map((f) => chip(f.path, v.name ? `${v.name} ${f.version}` : f.version))
    ).join("");
    return strip(summary ? `<span class="fchip guess struct" title="Inferred from the filenames \u2014 nothing is linked until you say so"><em>${esc(summary)}</em></span>` + chips : all.map((c) => chip(c.path, "?")).join(""));
  }
  function renameButton(item, taskKey, assetId) {
    return `<button class="ib dim" data-act="renameitem" data-key="${esc(taskKey)}" data-asset="${esc(assetId)}" data-index="${item.index}" data-raw="${esc(item.raw)}" data-name="${esc(item.name)}"` + (item.estimate ? ` data-estimate="${item.estimate}"` : "") + (item.priority ? ` data-priority="${esc(item.priority)}"` : "") + ' title="Edit this item: name, estimate, priority">&#9998;</button>';
  }
  function linkButton(taskKey, item) {
    const keys = ` data-key="${esc(taskKey)}"` + (item === null ? "" : ` data-item="${esc(item)}"`);
    return '<button class="ib" data-act="create"' + keys + ' title="Create a new .bbmodel for this model and record it">new file</button><button class="ib" data-act="link"' + keys + ' title="Record the currently open .bbmodel against this model">link open file</button><button class="ib" data-act="linkfile"' + keys + ' title="Pick a .bbmodel in the repository, open it and record it against this model">link file\u2026</button>';
  }
  function markClass(item, legend = null) {
    const label = statusOf(item, legend).toLowerCase();
    if (label === "needs changes") return "m-chg";
    if (isQa(label)) return "m-qa";
    if (item.resolved) return item.marker === "x" ? "m-skip" : "m-done";
    return item.marker === "~" ? "m-doing" : "m-todo";
  }
  function markerButton(item, taskKey, open, legend = null) {
    const label = statusOf(item, legend);
    return `<button class="istate ${markClass(item, legend)} mbtn${open ? " on" : ""}" data-act="itemstate" data-key="${esc(taskKey)}" data-index="${item.index}" data-raw="${esc(item.raw)}" title="${esc(label)} \u2014 click to change"><span class="istl">${esc(label)}</span><span class="istc">&#9662;</span></button>`;
  }
  var CHEVRON = {
    up: "M2 6.5 5 3.5 8 6.5",
    up2: "M2 5 5 2 8 5M2 8.5 5 5.5 8 8.5",
    bars: "M2 3.5h6M2 6.5h6",
    down: "M2 3.5 5 6.5 8 3.5",
    down2: "M2 1.5 5 4.5 8 1.5M2 5 5 8 8 5"
  };
  function priorityGlyph(priority) {
    const level = priority.toLowerCase();
    const shape = /^(highest|blocker|urgent)$/.test(level) ? ["p-high", CHEVRON.up2] : /^(high|critical|major)$/.test(level) ? ["p-high", CHEVRON.up] : /^(medium|normal)$/.test(level) ? ["p-med", CHEVRON.bars] : /^(low|minor)$/.test(level) ? ["p-low", CHEVRON.down] : /^(lowest|trivial)$/.test(level) ? ["p-low", CHEVRON.down2] : null;
    if (!shape) return `<span class="ipri" title="Priority: ${esc(priority)}">${esc(priority)}</span>`;
    const [cls, d] = shape;
    return `<span class="ipri ${cls}" title="Priority: ${esc(priority)}" data-priority="${esc(priority)}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="${d}"/></svg></span>`;
  }
  function itemMetaChips(item) {
    if (!item.due) return '<span class="imeta"></span>';
    return `<span class="imeta"><span class="idue" title="Due ${esc(item.due)}">${esc(item.due)}</span></span>`;
  }
  function itemStateMenu(vm) {
    const open = vm.itemMenu;
    if (!open) return "";
    const task2 = taskIn(vm, open.key);
    const legend = task2?.checklistFormat ?? null;
    const lead = !!task2?.component && vm.leadComponents.includes(task2.component);
    const all = itemStatuses(legend);
    const states = lead ? all : all.filter((s) => s.label !== "Done");
    const doneHeld = states.length < all.length;
    const missing = missingItemStates(legend);
    const current3 = task2?.checklist?.find((i) => i.index === open.index) ?? null;
    const at = vm.itemMenuAt;
    const pos = at ? ` style="top:${Math.round(at.y)}px;left:${Math.round(at.x)}px"` : "";
    const note = missing.length ? `<div class="mnote">${missing.map((m) => `<b>${esc(m)}</b>`).join(" and ")} ${missing.length === 1 ? "is" : "are"} not set up in Smart Checklist, so ${missing.length === 1 ? "it is" : "they are"} not offered here. Kumonga only ever writes a marker Smart Checklist has sent it, and these have not arrived on this task. Set one in Jira first; whatever comes back shows up here.</div>` : "";
    if (!states.length) {
      return `<div class="kmenu"${pos}><div class="mnote">Smart Checklist has not sent its list of statuses for this task, so there is nothing to choose from. Refresh, and check the checklist still exists in Jira.</div></div>`;
    }
    const now = current3 ? statusOf(current3, legend) : null;
    return `<div class="kmenu"${pos}>` + states.map((st) => `<button class="mi${st.label === now ? " on" : ""}" data-act="setitemstate" data-key="${esc(open.key)}" data-index="${open.index}" data-raw="${esc(open.raw)}" data-status="${esc(st.label)}">${esc(st.label)}</button>`).join("") + (doneHeld ? '<div class="mnote">Done is your lead\u2019s call. Mark it <b>In QA</b> when it is ready for review, and they mark it Done.</div>' : "") + note + "</div>";
  }
  function modelRow(opts) {
    const rowAct = opts.openPath ? ` data-act="open" data-path="${esc(opts.openPath)}" title="Open this model in Blockbench. Alt+click shows it in the file manager."` : "";
    return `<div class="item ${opts.rowClass}${opts.openPath ? " hit" : ""}"${rowAct}>` + (opts.markHtml ?? `<span class="mark ${opts.markClass}">${opts.markGlyph}</span>`) + `<span class="ipsl">${opts.pri ?? ""}</span><span class="iname ${opts.nameClass}${opts.grow ? " grow" : ""}" title="${esc(opts.name)}">${esc(opts.name)}</span>` + (opts.byName ?? "") + opts.body + opts.trailing + (opts.end ?? "") + (opts.tail ?? "") + "</div>" + opts.after;
  }
  function taskModelRow(task2, detail) {
    if (!detail?.hasRoot || detail.loading) return "";
    const hasModels = !!(detail.map && Object.keys(detail.map.assets).length);
    return modelRow({
      markGlyph: hasModels ? "&#43;" : "&#9679;",
      markClass: hasModels ? "m-add" : "m-free",
      name: hasModels ? "Add another model" : task2.summary,
      nameClass: hasModels ? "d" : "",
      // The suggestions stay either way — a task with one model linked may well
      // have a second file on disk waiting for it. Only the "no file yet" goes,
      // because that part was the lie.
      body: hasModels ? "" : '<span class="ipath n">no file yet</span>',
      trailing: linkButton(task2.key, null),
      rowClass: "",
      // The suggestions go UNDER the row, wrapping, rather than in it: three
      // link buttons and a strip of variant guesses on one 460px line left the
      // strip scrolling inside the row behind a scrollbar of its own.
      after: ((s) => s ? `<div class="isugg">${s}</div>` : "")(suggestion(task2.summary, detail))
    });
  }
  function renderChecklistItem(item, detail, task2, vm, oneFile = false, report = null) {
    const taskKey = task2.key;
    const nameClass = item.resolved ? item.marker === "x" ? "s" : "d" : "";
    const found = detail?.map ? assetForItem(detail.map, item.name) : null;
    const time = estimateChip(item, detail, hasTimeColumn(task2, detail)) + itemTimerButton(task2, vm, item.name);
    const stale = !!report && item.resolved && report.states[item.name] === "missing";
    const state2 = markerButton(item, taskKey, false, task2.checklistFormat);
    const clipFb = oneFile ? fbChip(vm, taskKey, "clip", item.name) : "";
    const end = itemMetaChips(item);
    const pri = item.priority ? priorityGlyph(item.priority) : "";
    if (!found) {
      const loading = !!detail?.loading;
      const body = loading ? '<span class="ipath n">\u2026</span>' : detail && !oneFile ? '<span class="ipath n">no file yet</span>' + suggestion(item.name, detail) : clipChip(report, item.name);
      return modelRow({
        markGlyph: esc(item.marker),
        markClass: markClass(item),
        markHtml: state2,
        pri,
        name: item.name,
        nameClass,
        body,
        grow: oneFile,
        byName: clipFb,
        rowClass: stale ? "alert" : "",
        trailing: detail?.hasRoot && !oneFile && !loading ? linkButton(taskKey, item.name) : "",
        end,
        tail: time + renameButton(item, taskKey, ""),
        after: ""
      });
    }
    const [id, asset] = found;
    const worst = assetWorst(asset, id, detail);
    const primary = primaryOf(asset, id, detail);
    const openPath = primary.r.state === "ok" ? primary.r.recorded : primary.r.state === "moved" ? primary.r.found : null;
    return modelRow({
      openPath,
      markGlyph: esc(item.marker),
      markClass: markClass(item),
      markHtml: state2,
      pri,
      name: item.name,
      nameClass,
      byName: oneFile ? clipFb : fbChip(vm, taskKey, "asset", id, item.name),
      body: clipChip(report, item.name) + pathCell(asset, id, detail),
      grow: oneFile,
      trailing: rowFix(asset, id, detail) + versionChip(asset, id, detail),
      end,
      tail: time + renameButton(item, taskKey, id),
      rowClass: stale || worst === "moved" ? "alert" : worst === "missing" || worst === "unpulled" ? "miss" : "",
      after: subnote(asset, id, detail, vm) + versionList(asset, id, detail)
    });
  }
  function assetLabel(id, asset) {
    if (asset.item) return asset.item;
    const file2 = allFiles(asset)[0];
    return file2 ? baseOf(file2.path).replace(/\.bbmodel$/i, "") : id;
  }
  function renderLooseAssets(task2, vm, detail) {
    const claimed = (task2.checklist ?? []).map((i) => i.name);
    const loose = unclaimedAssets(detail.map, claimed);
    if (!loose.length) return "";
    return loose.map(([id, asset]) => {
      const worst = assetWorst(asset, id, detail);
      const primary = primaryOf(asset, id, detail);
      return modelRow({
        openPath: primary.r.state === "ok" ? primary.r.recorded : primary.r.state === "moved" ? primary.r.found : null,
        // A filled dot rather than a checklist marker: this model answers no item.
        markGlyph: "&#9679;",
        markClass: "m-free",
        name: assetLabel(id, asset),
        nameClass: "",
        body: pathCell(asset, id, detail),
        // Feedback belongs here as much as on a checklist row — more, in fact:
        // most Model/Texture tasks on this instance have no checklist at all, so
        // a loose row IS the deliverable (D-23). Leaving the chip off them made
        // the review unreachable on the majority of tasks (D-65).
        byName: fbChip(vm, task2.key, "asset", id, assetLabel(id, asset)),
        trailing: rowFix(asset, id, detail) + versionChip(asset, id, detail),
        rowClass: worst === "moved" ? "alert" : worst === "missing" || worst === "unpulled" ? "miss" : "",
        after: subnote(asset, id, detail, vm) + versionList(asset, id, detail)
      });
    }).join("");
  }
  function renderDetail(task2, detail) {
    if (!detail || detail.key !== task2.key) return "";
    if (detail.loading) return '<div class="nochk">Reading files\u2026</div>';
    if (detail.error) return `<div class="err">${esc(detail.error)}</div>`;
    if (!detail.hasRoot) {
      return '<div class="nochk">Set a repository root to see where these files are.</div>';
    }
    return "";
  }
  function canTime(task2, vm) {
    if (!vm.clockwork) return false;
    if (vm.me && task2.assignee && task2.assignee.accountId !== vm.me) return false;
    return !/^(blocked|qa|complete|done)$/i.test(task2.status);
  }
  function timing(task2, vm) {
    return vm.timer?.issueKey === task2.key || vm.externalTimer === task2.key;
  }
  function timerButton(task2, vm) {
    if (!canTime(task2, vm)) return "";
    const running = timing(task2, vm);
    return running ? `<button class="tmbtn on" data-act="stoptimer" data-key="${esc(task2.key)}" title="Stop the timer and log the time">&#9632;</button>` : `<button class="tmbtn" data-act="starttimer" data-key="${esc(task2.key)}" title="Start a timer on this task">&#9654;</button>`;
  }
  function hasTimeColumn(task2, detail) {
    return (task2.checklist ?? []).some((i) => i.estimate) || Object.keys(detail?.itemTime ?? {}).length > 0;
  }
  function estimateChip(item, detail, column = false) {
    const tracked = detail?.itemTime?.[item.name] ?? 0;
    const est = item.estimate ?? 0;
    if (!est && !tracked) return column ? '<span class="iest"></span>' : "";
    const t = formatDuration(tracked);
    const e = formatDuration(est);
    if (est && tracked) {
      const over = tracked > est;
      return `<span class="iest${over ? " over" : ""}" title="${esc(t)} tracked against a ${esc(e)} estimate${over ? " \u2014 over" : ""}. Tracked time is the worklogs whose description names this item.">${esc(t)}<span class="of"> / ${esc(e)}</span></span>`;
    }
    if (est) {
      const known = detail?.itemTime !== void 0 && detail?.itemTime !== null;
      return `<span class="iest" title="Estimated ${esc(e)}${known ? ", nothing tracked yet" : ""}">${esc(e)}</span>`;
    }
    return `<span class="iest" title="${esc(t)} tracked, no estimate. Tracked time is the worklogs whose description names this item.">${esc(t)}</span>`;
  }
  function itemTimerButton(task2, vm, item) {
    if (!canTime(task2, vm)) return "";
    const running = vm.timer?.issueKey === task2.key && vm.timer?.item === item;
    return running ? `<button class="ib tmi on" data-act="stoptimer" data-key="${esc(task2.key)}" title="Stop the timer and log the time">&#9632;</button>` : `<button class="ib tmi" data-act="starttimeritem" data-key="${esc(task2.key)}" data-item="${esc(item)}" title="Start a timer on &quot;${esc(item)}&quot;">&#9654;</button>`;
  }
  function rowMenu(task2, vm) {
    const open = vm.menu === task2.key;
    return `<button class="kebab${open ? " on" : ""}" data-act="menu" data-key="${esc(task2.key)}" title="More">&#8942;</button>`;
  }
  function floatingMenu(vm) {
    if (!vm.menu) return "";
    const key = vm.menu;
    const item = (act, label) => `<button class="mi" data-act="${act}" data-key="${esc(key)}">${esc(label)}</button>`;
    const at = vm.menuAt;
    const pos = at ? ` style="top:${Math.round(at.y)}px;left:${Math.round(at.x)}px"` : "";
    const task2 = taskIn(vm, key);
    return `<div class="kmenu"${pos}>` + item("openjira", "Open task in Jira") + item("setcomponent", "Change component") + item("setpriority", "Set priority") + item("setdue", task2?.duedate ? "Change due date" : "Set due date") + item("leavefb", "Leave feedback\u2026") + item("rebase", "Folder moved? Fix recorded paths\u2026") + moveEntries(task2, key, vm) + "</div>";
  }
  function moveEntries(task2, key, vm) {
    if (!task2) return "";
    const ts = vm.transitions?.[key];
    if (!ts || ts.loading) return '<span class="mi mnote">Loading moves\u2026</span>';
    if (ts.error) return '<span class="mi mnote bad">Could not read moves</span>';
    return menuMovesFor(task2, ts.list, vm.detail?.key === key ? vm.detail.map : null).map((b) => `<button class="mi${b.kind === "danger" ? " bad" : ""}" data-act="move" data-key="${esc(key)}" data-transition="${esc(b.transitionId)}" data-to="${esc(b.to)}">${esc(b.label)}</button>`).join("");
  }
  function gitNotice(git) {
    if (!git) return "";
    if (git.error) {
      return '<div class="notice git bad">' + esc(git.error) + '<button data-act="pull">Try again</button></div>';
    }
    if (git.behind < 1) return pushNotice(git);
    const n = git.behind;
    const checked = git.checkedAt ? ` Only checked, at ${new Date(git.checkedAt).toLocaleTimeString()} \u2014 nothing pulled yet.` : "";
    return `<div class="notice git"><b>${n} commit${n === 1 ? "" : "s"} to pull</b> on ${esc(git.branch)}` + (git.dirty ? " &mdash; you have uncommitted changes, so this may refuse." : git.ahead ? ` &mdash; and ${git.ahead} of yours to push.` : "") + esc(checked) + `<button data-act="pull"${git.pulling ? " disabled" : ""}>` + (git.pulling ? "Pulling\u2026" : "Pull") + "</button></div>";
  }
  function pushNotice(git) {
    if (git.ahead < 1 && !git.dirty) return "";
    const n = git.ahead;
    const head = n ? `<b>${n} commit${n === 1 ? "" : "s"} to push</b> on ${esc(git.branch)}` + (git.dirty ? " &mdash; and files not committed yet." : ".") : `<b>Files not committed yet</b> on ${esc(git.branch)}.`;
    return '<div class="notice git push">' + head + ' Commit and push in GitHub Desktop so the team has your work.<button data-act="github">Open GitHub Desktop</button></div>';
  }
  function renderFooter(task2, vm) {
    const ts = vm.transitions?.[task2.key];
    if (!ts) return "";
    const reviewing = vm.page === "qa" && underReview(task2);
    if (vm.me && task2.assignee && task2.assignee.accountId !== vm.me && !reviewing) {
      return `<div class="foot"><span class="fnote">Assigned to ${esc(task2.assignee.name)}. Moves are in the task menu.</span></div>`;
    }
    if (ts.loading) return '<div class="foot"><span class="fnote">Loading actions\u2026</span></div>';
    if (ts.error) {
      return `<div class="foot"><span class="fnote bad">${esc(ts.error)}</span></div>`;
    }
    const detailLoading = vm.detail?.key === task2.key && vm.detail.loading;
    const buttons = footerFor(
      task2,
      ts.list,
      vm.detail?.key === task2.key ? vm.detail.map : null,
      vm.page === "qa"
    ).map((b) => b.blockedBy && detailLoading ? { ...b, blockedBy: "Checking what is linked\u2026" } : b);
    const timer = footerTimer(task2, vm);
    if (!buttons.length && !timer) {
      return '<div class="foot"><span class="fnote">Jira offers no moves from here.</span></div>';
    }
    return '<div class="foot">' + timer + (buttons.length ? "" : '<span class="fnote">Jira offers no moves from here.</span>') + buttons.map(
      (b) => `<button class="act ${b.kind}${b.blockedBy ? " off" : ""}" data-act="move" data-key="${esc(task2.key)}" data-transition="${esc(b.transitionId)}" data-to="${esc(b.to)}"` + (b.blockedBy ? ` disabled title="${esc(b.blockedBy)}"` : "") + `>${esc(b.label)}</button>`
    ).join("") + (buttons.find((b) => b.blockedBy) ? `<span class="fnote">${esc(buttons.find((b) => b.blockedBy).blockedBy)}</span>` : "") + "</div>";
  }
  function timerStrip(vm) {
    if (!vm.clockwork) return "";
    const open = `<button class="tmopenbtn${vm.page === "time" ? " on" : ""}" data-act="page" data-page="time" title="Time logged \u2014 day and week">Time</button>`;
    const t = vm.timer;
    if (t) {
      const summary = taskIn(vm, t.issueKey)?.summary;
      return '<div class="tmbar run">' + open + `<span class="tmdot"></span><span class="tmkey">${esc(t.issueKey)}</span>` + (summary ? `<span class="tmsum">${esc(summary)}</span>` : "") + (t.item ? `<span class="tmitem">${esc(t.item)}</span>` : "") + `<span class="tmel" data-el="1">${esc(formatElapsed(t.elapsed))}</span><button class="ib" data-act="stoptimer" data-key="${esc(t.issueKey)}">Stop</button></div>`;
    }
    if (vm.externalTimer) {
      const summary = taskIn(vm, vm.externalTimer)?.summary;
      return '<div class="tmbar ext">' + open + `<span class="tmdot"></span><span class="tmkey">${esc(vm.externalTimer)}</span>` + (summary ? `<span class="tmsum">${esc(summary)}</span>` : "") + `<span class="tmnote" title="Clockwork reports a timer running on this task. It was started in Jira, or before Kumonga was last restarted, so there is no clock for it.">timing in Jira</span><button class="ib" data-act="stoptimer" data-key="${esc(vm.externalTimer)}">Stop</button></div>`;
    }
    return '<div class="tmbar idle">' + open + `<span class="tmdot"></span><span class="tmkey">No timer running</span><button class="ib" data-act="logtimeday">Log time</button><span class="tmnote" title="Checked against Clockwork's record on each of your tasks">on your tasks</span></div>`;
  }
  function footerTimer(task2, vm) {
    if (!vm.clockwork) return "";
    if (vm.me && task2.assignee && task2.assignee.accountId !== vm.me) return "";
    if (!timing(task2, vm)) return "";
    return `<button class="act danger" data-act="stoptimer" data-key="${esc(task2.key)}">&#9632; Stop timer</button>`;
  }
  function renderTask(task2, vm, showCrumb, showComponent) {
    const detail = vm.detail && vm.detail.key === task2.key ? vm.detail : null;
    const fileCount = task2.checklist === null && detail?.map ? Object.keys(detail.map.assets).length : null;
    const expanded = vm.expanded === task2.key;
    const gated = task2.scope === "untagged";
    const progress = progressLabel(task2);
    const due = dueInfo(task2, vm.now);
    let cls = "task";
    if (task2.priority === "Low") cls += " low";
    if (task2.priority === "Lowest") cls += " lowest";
    if (gated) cls += " gated";
    else if (task2.status === "Blocked") cls += " blk";
    else if (progress.complete && task2.status === "In Progress") cls += " ready";
    if (expanded) cls += " sel";
    let hcls = "thead";
    if (gated) hcls += " gated";
    else if (task2.status === "Blocked") hcls += " blk";
    else if (task2.status === "Needs Changes") hcls += " chg";
    else if (task2.status === "QA") hcls += " qa";
    else if (progress.complete && task2.status === "In Progress") hcls += " ready";
    if (expanded) hcls += " sel";
    const crumbEpic = task2.epic && !(task2.parent ?? "").toLowerCase().startsWith(task2.epic.toLowerCase());
    let h = `<div class="${cls}" data-key="${esc(task2.key)}"><div class="${hcls}"${gated ? "" : ` data-act="toggle" data-key="${esc(task2.key)}"`}><span class="tw">${gated ? "" : expanded ? "&#9660;" : "&#9654;"}</span><div class="tbody">` + (showCrumb && task2.parent ? '<div class="crumb">' + (crumbEpic ? `<span class="ep">${esc(task2.epic)}</span> &rsaquo; ` : "") + esc(task2.parent) + "</div>" : "") + `<div class="trow"><span class="tkey">${esc(task2.key)}</span><span class="tname">${esc(task2.summary)}</span>` + (progress.plain ? fileCount !== null ? `<span class="prog plain">${fileCount} file${fileCount === 1 ? "" : "s"}</span>` : "" : `<span class="prog${progress.complete ? " all" : ""}">${progress.text}</span>`) + (gated ? "" : timerButton(task2, vm)) + (gated ? "" : rowMenu(task2, vm)) + '</div><div class="tmeta">' + priorityChip(task2.priority) + (task2.component ? showComponent ? `<span class="chip comp">${esc(task2.component)}</span>` : "" : '<span class="chip notag">&#9888; no component</span>') + (task2.components.includes(ANIMATION_COMPONENT) && !animationTool(task2.labels) ? `<button class="chip ask" data-act="settool" data-key="${esc(task2.key)}" title="Blockbench or Blender? Click to say.">animated where?</button>` : "") + (task2.scope === "out" ? '<span class="chip off">out of scope</span>' : "") + task2.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join("") + (due ? `<span class="due ${due.state}">${esc(due.text)}</span>` : "") + (task2.assignee && vm.page === "qa" ? `<span class="thours" title="Assignee, and hours logged on this task">${esc(task2.assignee.name)}${task2.hours ? ` \xB7 ${task2.hours}h` : ""}</span>` : task2.hours ? `<span class="thours" title="${task2.hours}h logged on this task">${task2.hours}h</span>` : "") + "</div></div></div>";
    const reason = vm.transitions?.[task2.key]?.reason;
    if (task2.status === "Blocked" && reason) {
      h += `<div class="reason">${esc(reason)}</div>`;
    }
    if (gated) {
      return h + `<div class="gate"><div class="gt">This task has no component</div><div class="gb">Without one it has no reviewer, so it cannot be sent to QA. Set a component to start work on it.</div><button class="ib" data-act="setcomponent" data-key="${esc(task2.key)}">set component</button></div></div>`;
    }
    if (expanded) {
      const shape = shapeOf(task2, detail);
      const note = describeShape(shape);
      const blender = shape.kind === "blender";
      const files = blender ? null : detail;
      h += blender ? "" : renderDetail(task2, vm.detail ?? null);
      h += feedbackLine(task2, vm);
      const loose = files?.map ? renderLooseAssets(task2, vm, files) : "";
      if (note) h += `<div class="anote">${esc(note)}</div>`;
      const oneFile = sharesOneFile(shape);
      if (blender && task2.checklist === null) {
      } else if (task2.checklist === null) {
        const add = taskModelRow(task2, files);
        h += loose || add ? '<div class="items">' + loose + add + "</div>" : '<div class="nochk">No checklist on this task &mdash; no models linked yet.</div>';
      } else if (!task2.checklist.length) {
        h += '<div class="nochk">Checklist is empty.</div>';
      } else {
        const report = clipReportFor(task2, files);
        const clips = byPriority(task2.checklist).map((i) => renderChecklistItem(i, files, task2, vm, oneFile, report)).join("");
        const cols = (report ? " wclip" : "") + (task2.checklist.some((i) => i.priority) ? " wpri" : "") + (task2.checklist.some((i) => i.due) ? " wmeta" : "") + (hasTimeColumn(task2, files) ? " wtime" : "");
        h += `<div class="items${cols}">` + (oneFile ? loose + taskModelRow(task2, files) + clips : clips + loose) + "</div>";
        h += clipSummary(task2, files, report, vm);
      }
      h += renderFooter(task2, vm);
    }
    return h + "</div>";
  }
  function debugBanner(vm) {
    const as = vm.viewingAs;
    if (!as) return "";
    return `<div class="dbgbar"><b>Viewing as ${esc(as.name)}</b>` + (as.writes ? '<span class="dbgwarn">timers run as them &middot; Jira changes show YOUR name</span>' : "<span>read-only</span>") + '<button class="ib" data-act="viewasoff">Stop</button></div>';
  }
  function renderToolbar(vm) {
    const options = vm.projects.map(
      (p) => `<option value="${esc(p.key)}"${p.key === vm.client ? " selected" : ""}>${esc(p.name)}</option>`
    ).join("");
    const stamp = vm.loading ? "loading\u2026" : vm.fetchedAt ? new Date(vm.fetchedAt).toLocaleTimeString() : "";
    return `<div class="bar"><select data-act="client" title="Which client's work to show">${options}</select><button data-act="refresh">Refresh</button><button data-act="root" title="Set the repository root for this client">Root</button><button data-act="openroot" title="Open the repository folder">Folder</button><button data-act="github" title="Open this repository in GitHub Desktop">GitHub</button><button data-act="scope" title="Choose which components are modelling work">Scope</button>` + (vm.debug ? `<button data-act="devreload" title="Rebuild picked up? Reload the plugin">&#8635;</button><button data-act="debugmenu" class="${vm.debugMenuAt ? "on" : ""}" title="Developer tools">Debug &#9662;</button>` : "") + `<span class="stamp">${esc(stamp)}</span></div>`;
  }
  function debugMenu(vm) {
    if (!vm.debug || !vm.debugMenuAt) return "";
    const at = vm.debugMenuAt;
    const item = (act, label) => `<button class="mi" data-act="${act}">${esc(label)}</button>`;
    return `<div class="kmenu" style="top:${Math.round(at.y)}px;left:${Math.round(at.x)}px">` + item("viewas", "View as another artist\u2026") + (vm.viewingAs ? item("viewasoff", `Stop viewing as ${vm.viewingAs.name}`) + item("viewaswrites", vm.viewingAs.writes ? "Make view-as read-only" : "Allow changes again") : "") + item("reviewbardiag", "Why no review bar?") + item("devreload", "Reload plugin") + "</div>";
  }
  function plainError(message) {
    const m = message;
    if (/access_denied/i.test(m)) {
      return "You cancelled the sign-in in your browser. Nothing was changed.";
    }
    if (/Port 8471 is already in use/i.test(m)) {
      return "Another Blockbench window may be signing in. Close it, or wait two minutes and try again.";
    }
    if (/No response within \d+s/i.test(m)) {
      return 'The browser did not come back within two minutes. Try again \u2014 and if no page opened, use "Copy the link".';
    }
    if (/ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed out|failed mid-response|gave up after|failed: (read|connect|getaddrinfo)/i.test(m)) {
      return "Could not reach Jira. Check the connection; the list refreshes on its own.";
    }
    if (/\b429\b|rate.?limit|Retry-After/i.test(m)) {
      return "Jira is rate-limiting requests. Retrying shortly.";
    }
    if (/\b(502|503|504)\b|Service Unavailable|Bad Gateway/i.test(m)) {
      return "Jira is having trouble at its end. Retrying shortly.";
    }
    return m;
  }
  function renderBody(vm) {
    if (vm.error && !vm.tasks.length) return `<div class="err">${esc(vm.error)}</div>`;
    if (vm.loading && !vm.tasks.length) return '<div class="empty"><div class="big">Loading\u2026</div></div>';
    let body = "";
    const missing = vm.rootsMissing ?? [];
    if (missing.length) {
      const nameOf = (key) => vm.projects.find((p) => p.key === key)?.name ?? key;
      body += '<div class="notice">' + (missing.length === 1 ? `No repository root set for ${esc(missing[0])}. ` : `No repository root set for ${esc(missing.join(", "))}. `) + "Those tasks still list, but their files cannot be found or linked." + missing.map(
        (k) => `<button data-act="root" data-project="${esc(k)}">Set folder for ${esc(nameOf(k))}</button>`
      ).join("") + "</div>";
    } else if (vm.client && !vm.aggregate && !vm.hasRoot) {
      body += '<div class="notice">No repository root set for this client. Tasks still list, but files cannot be found or linked.<button data-act="root">Set folder</button></div>';
    }
    body += gitNotice(vm.git ?? null);
    if (vm.error) {
      const plain = plainError(vm.error);
      body += `<div class="err"${plain !== vm.error ? ` title="${esc(vm.error)}"` : ""}>Last refresh failed &mdash; showing work from ${esc(vm.fetchedAt ? new Date(vm.fetchedAt).toLocaleTimeString() : "earlier")}.<br>${esc(plain)}</div>`;
    }
    const inScope = vm.tasks.filter((t) => t.scope === "in");
    const untagged = vm.tasks.filter((t) => t.scope === "untagged");
    const offScope = vm.tasks.filter((t) => t.scope === "out");
    const mine = vm.showAll ? vm.tasks : inScope.concat(untagged);
    if (!mine.length) {
      const client = vm.projects.find((p) => p.key === vm.client)?.name ?? vm.client;
      body += '<div class="empty"><div class="big">' + (client ? `Nothing assigned to you in ${esc(client)}` : "No modelling work assigned") + `</div><div class="small">Showing <button class="lnk" data-act="scope">${esc(vm.components.join(" and "))}</button> tasks.` + (vm.projects.length > 1 ? " Pick another client above, or widen the scope." : "") + "</div></div>";
    } else {
      const known = new Set(LANES);
      const extra = [...new Set(
        mine.filter((t) => t.scope !== "untagged" && !known.has(t.status)).map((t) => t.status)
      )].sort();
      for (const lane of [...LANES, ...extra]) {
        const list = (lane === "Needs a component" ? mine.filter((t) => t.scope === "untagged") : mine.filter((t) => t.status === lane && t.scope !== "untagged")).sort(taskComparator(vm.now ?? /* @__PURE__ */ new Date()));
        if (!list.length) continue;
        const shut = !!vm.lanes[lane];
        body += `<div class="lane" data-act="lane" data-lane="${esc(lane)}"><span class="ltw">${shut ? "&#9654;" : "&#9660;"}</span>` + laneHead(lane, list, vm.now) + "</div>";
        if (shut) continue;
        let lastCrumb = null;
        let lastComp = null;
        for (const t of list) {
          const crumb = t.epic && t.parent ? `${t.epic} \u203A ${t.parent}` : t.parent;
          body += renderTask(t, vm, crumb !== lastCrumb, t.component !== lastComp);
          lastCrumb = crumb;
          lastComp = t.component;
        }
      }
    }
    if (!vm.complete) body += `<div class="notice">${TRUNCATED}</div>`;
    if (offScope.length) {
      body += `<div class="filterbar"><span>${offScope.length} task${offScope.length > 1 ? "s" : ""} in other disciplines</span><button data-act="toggleall">${vm.showAll ? "Hide other disciplines" : "Show all"}</button></div>`;
    }
    return body;
  }
  function threadHead(t, taskKey) {
    const when = t.created ? t.created.slice(0, 10) : "";
    const seekable = t.at && t.target?.kind === "clip" ? "frame" : t.camera ? "view" : null;
    const pin = seekable ? `<button class="pin" data-act="seeknote" data-comment="${esc(t.commentId)}" data-key="${esc(taskKey)}" title="${seekable === "frame" ? "Seek Blockbench to this frame and ghost the pose" + (t.range ? `, looping ${esc(formatRange(t.range))}` : "") + (t.camera ? ", from this camera" : "") : "Restore the camera this note was left from"}">` + (seekable === "frame" ? `@ ${esc(formatPin(t.at))}` : "") + (seekable === "frame" && t.range ? `<span class="pinrng">loop ${esc(formatFrames(t.range))}</span>` : "") + (t.camera ? '<span class="pincam" aria-label="camera saved">&#128247;</span>' : "") + "</button>" : "";
    return `<div class="thd"><span class="av">${esc((t.author || "?").slice(0, 1).toUpperCase())}</span><span class="who">${esc(t.author)}</span><span class="when">${esc(when)}</span>` + pin + (t.status === "resolved" ? '<span class="rst">&#10003; resolved</span>' : '<span class="rst op">open</span>') + "</div>";
  }
  function shots(t, vm) {
    if (!t.attachments.length) return "";
    return '<div class="shots">' + t.attachments.map((id) => {
      const url = vm.shots?.[id];
      return url ? `<img class="shotimg" src="${esc(url)}" alt="screenshot" data-act="openshot" data-shot="${esc(id)}" title="Open this screenshot in Jira">` : `<button class="shotb" data-act="openshot" data-shot="${esc(id)}" title="Open this screenshot in Jira">&#128247; screenshot</button>`;
    }).join("") + "</div>";
  }
  function del(commentId, taskKey) {
    return `<button class="ib dim thdel" data-act="delfb" data-comment="${esc(commentId)}" data-key="${esc(taskKey)}" title="Delete this note from Jira \u2014 asks first">Delete\u2026</button>`;
  }
  function renderThread(vm, t, taskKey) {
    const acts = t.status === "open" ? `<div class="thact"><button class="ib" data-act="replyfb" data-comment="${esc(t.commentId)}" data-key="${esc(taskKey)}">Reply</button><button class="ib go" data-act="resolvefb" data-comment="${esc(t.commentId)}" data-key="${esc(taskKey)}">Mark resolved</button>` + del(t.commentId, taskKey) + "</div>" : `<div class="thfoot">Resolved${t.resolvedAt ? " &middot; " + esc(t.resolvedAt.slice(0, 10)) : ""}<button class="ib dim" data-act="reopenfb" data-comment="${esc(t.commentId)}" data-key="${esc(taskKey)}">Reopen</button>` + del(t.commentId, taskKey) + "</div>";
    return `<div class="thread${t.status === "resolved" ? " done" : ""}">` + threadHead(t, taskKey) + `<div class="tbody2">${esc(t.text)}</div>` + shots(t, vm) + acts + "</div>";
  }
  function renderReviewPage(vm) {
    const review = vm.review;
    if (!review) {
      return '<div class="empty"><div class="big">No task open</div><div class="small">Expand a task to see the feedback on it.</div></div>';
    }
    if (review.loading && !review.threads.length) {
      return '<div class="empty"><div class="big">Loading&hellip;</div></div>';
    }
    if (review.error) return `<div class="err">${esc(review.error)}</div>`;
    const aim = vm.reviewTarget?.taskKey === review.key ? vm.reviewTarget : null;
    const open = openThreads(review.threads);
    const task2 = vm.tasks.find((t) => t.key === review.key) ?? vm.qa?.queue.find((t) => t.key === review.key);
    let h = `<div class="rvhead">${esc(review.key)}` + (aim ? ` &middot; ${aim.kind === "asset" ? "model" : "clip"} <b>${esc(aim.label ?? aim.id)}</b>` : "") + (open.length ? `<span class="rvcnt">${open.length} open</span>` : '<span class="rvcnt ok">all resolved</span>') + (aim ? '<button class="ib dim" data-act="showall">Show all</button>' : "") + "</div>";
    const shown = aim ? threadsFor(review.threads, { kind: aim.kind, id: aim.id }) : review.threads.filter((t) => t.target !== null);
    if (!shown.length) {
      h += '<div class="empty"><div class="big">' + (aim ? "Nothing on this one" : "No feedback yet") + '</div><div class="small">' + (aim ? "No notes have been left on it." : "Feedback a lead leaves in QA appears here, with the model or clip it is about.") + "</div></div>";
    } else {
      h += shown.map((t) => renderThread(vm, t, review.key)).join("");
    }
    const inRound = !task2 || /^(needs changes|in progress)$/i.test(task2.status);
    h += '<div class="rvadd">' + (aim ? `<button class="ib go" data-act="newfb" data-key="${esc(review.key)}" data-kind="${aim.kind}" data-id="${esc(aim.id)}"` + (aim.label ? ` data-label="${esc(aim.label)}"` : "") + ">+ Add feedback</button>" : `<button class="ib go" data-act="leavefb" data-key="${esc(review.key)}">+ Leave feedback\u2026</button>`) + (inRound && canPushForReview(review.threads) && review.threads.some((t) => t.target) ? `<button class="ib" data-act="rerequest" data-key="${esc(review.key)}">Push for re-review</button>` : "") + "</div>";
    return h;
  }
  function renderTabs(vm) {
    const tab = (id, label, count, floor = false) => `<button class="tab${vm.page === id ? " on" : ""}" data-act="page" data-page="${id}">` + esc(label) + (count ? `<span class="lcnt">${count}${floor ? "+" : ""}</span>` : "") + "</button>";
    return '<div class="tabs">' + tab("work", "My work") + tab("overview", "Overview", vm.board?.overview?.tasks.length, vm.board?.overview?.complete === false) + tab("done", "Done", vm.board?.done?.tasks.length, vm.board?.done?.complete === false) + (vm.leadComponents.length ? tab("qa", "QA", vm.qa?.queue.length, vm.qa?.complete === false) : "") + tab("review", "Review", vm.review ? openThreads(vm.review.threads).length : 0) + "</div>";
  }
  function renderBoard(vm, which) {
    const state2 = vm.board?.[which];
    if (!state2 || state2.loading && !state2.tasks.length) {
      return '<div class="empty"><div class="big">Loading\u2026</div></div>';
    }
    if (state2.error) return `<div class="err">${esc(state2.error)}</div>`;
    if (!state2.tasks.length) {
      return '<div class="empty"><div class="big">' + (which === "done" ? "Nothing finished yet" : "No open work") + '</div><div class="small">' + esc(which === "done" ? "Completed work from the last 60 days appears here." : "Everything in scope is finished, or has no component.") + "</div></div>";
    }
    let body = "";
    if (!state2.complete) body += `<div class="notice">${TRUNCATED}</div>`;
    if (which === "done") {
      return body + state2.tasks.map((t) => renderTask(t, vm, true, true)).join("");
    }
    const known = new Set(LANES);
    const extra = [...new Set(
      state2.tasks.filter((t) => !known.has(t.status)).map((t) => t.status)
    )].sort();
    for (const lane of [...LANES, ...extra]) {
      const list = state2.tasks.filter((t) => t.status === lane).sort(taskComparator(vm.now ?? /* @__PURE__ */ new Date()));
      if (!list.length) continue;
      const shut = !!vm.lanes[lane];
      body += `<div class="lane" data-act="lane" data-lane="${esc(lane)}"><span class="ltw">${shut ? "&#9654;" : "&#9660;"}</span>` + laneHead(lane, list, vm.now) + "</div>";
      if (shut) continue;
      let lastCrumb = null;
      for (const t of list) {
        const crumb = t.epic && t.parent ? `${t.epic} \u203A ${t.parent}` : t.parent;
        body += renderTask(t, vm, crumb !== lastCrumb, true);
        lastCrumb = crumb;
      }
    }
    return body;
  }
  function renderQaTask(task2, vm) {
    return renderTask(task2, vm, true, true);
  }
  function leadPicker(vm) {
    const leads = vm.leads ?? [];
    if (leads.length < 2) return "";
    const current3 = vm.viewingLead ?? vm.me ?? "";
    return '<div class="qbar"><span class="qlab">Reviewing for</span><select data-act="lead">' + leads.map((l) => `<option value="${esc(l.accountId)}"${l.accountId === current3 ? " selected" : ""}>` + esc(l.accountId === vm.me ? `${l.name} (you)` : l.name) + esc(` \u2014 ${l.components.join(", ")}`) + "</option>").join("") + "</select></div>";
  }
  var TRUNCATED = "Showing the first page only \u2014 there is more here than one request returns, so the counts are a floor.";
  function renderQaPage(vm) {
    const qa = vm.qa;
    if (!qa) return '<div class="empty"><div class="big">Loading\u2026</div></div>';
    if (qa.error) return `<div class="err">${esc(qa.error)}</div>`;
    const other = vm.viewingLead && vm.viewingLead !== vm.me ? vm.leads?.find((l) => l.accountId === vm.viewingLead) : null;
    let html = leadPicker(vm) + `<div class="lane static"><span class="ldot s-QA"></span><span class="lname">${other ? esc(`WAITING ON ${other.name.toUpperCase()}`) : "WAITING ON YOU"}</span><span class="lcnt">${qa.queue.length}${qa.complete === false ? "+" : ""}</span></div>`;
    if (qa.complete === false) html += `<div class="notice">${TRUNCATED}</div>`;
    html += qa.loading && !qa.queue.length ? '<div class="empty"><div class="big">Loading\u2026</div></div>' : qa.queue.length ? [...qa.queue].sort(taskComparator(vm.now ?? /* @__PURE__ */ new Date())).map((t) => renderQaTask(t, vm)).join("") : `<div class="empty"><div class="big">Nothing waiting</div><div class="small">${other ? esc(`${other.name} leads ${other.components.join(", ")}.`) : esc(`You lead ${vm.leadComponents.join(", ")}.`)}</div></div>`;
    if (qa.partial?.length) {
      const n = qa.partial.length;
      html += `<div class="lane static"><span class="ldot s-InProgress"></span><span class="lname">PARTLY READY</span><span class="lcnt">${n}${qa.partialComplete === false ? "+" : ""}</span></div><div class="notice">Not in QA yet, but with items handed over for review. Set each to Done or Needs Changes; Approve &amp; close opens once every item is Done.</div>` + [...qa.partial].sort(taskComparator(vm.now ?? /* @__PURE__ */ new Date())).map((t) => renderQaTask(t, vm)).join("");
    }
    if (qa.cleared.length) {
      html += `<div class="lane static"><span class="ldot s-Backlog"></span><span class="lname">${other ? esc(`CLEARED BY ${other.name.toUpperCase()}`) : "CLEARED BY YOU"}</span><span class="lcnt">${qa.cleared.length}</span></div>` + qa.cleared.map((t) => renderQaTask(t, vm)).join("");
    }
    return html;
  }
  function renderPanel(vm) {
    if (!vm.signedIn) return renderSignIn(vm);
    if (!vm.clockwork) return renderClockworkSetup(vm);
    const page = vm.page === "time" ? renderTimePage(vm) : vm.page === "qa" && vm.leadComponents.length ? renderQaPage(vm) : vm.page === "overview" ? renderBoard(vm, "overview") : vm.page === "done" ? renderBoard(vm, "done") : vm.page === "review" ? renderReviewPage(vm) : renderBody(vm);
    return debugBanner(vm) + renderToolbar(vm) + timerStrip(vm) + renderTabs(vm) + page + floatingMenu(vm) + itemStateMenu(vm) + debugMenu(vm);
  }
  function renderClockworkSetup(vm) {
    return '<div class="signin"><div class="si-title">Connect Clockwork</div><div class="si-sub">One more step, then you are done.</div>' + (vm.error ? `<div class="si-err">${esc(vm.error)}</div>` : "") + '<div class="si-note">Kumonga records time through Clockwork, which needs its own API token \u2014 Jira\u2019s sign-in does not cover it. The token is yours personally and is stored encrypted on this machine.</div><div class="si-step"><span class="si-num">1</span><button class="si-btn" data-act="clockworklink">Create a token in Jira</button><div class="si-note">Opens Apps &rsaquo; Clockwork &rsaquo; API Tokens in your browser. Tick <b>Clockwork Timesheets Access</b> \u2014 that is what lets Kumonga read and log your time.</div></div><div class="si-step"><span class="si-num">2</span><button class="si-btn" data-act="clockworktoken">Paste the token here</button><div class="si-note">It is checked with Clockwork before it is saved.</div></div></div>';
  }
  function renderSignIn(vm) {
    const error = vm.error ? plainError(vm.error) : null;
    return '<div class="signin"><div class="si-title">Kumonga</div><div class="si-sub">Your Jira work, where you model.</div>' + (error ? `<div class="si-err"${error !== vm.error ? ` title="${esc(vm.error)}"` : ""}>${esc(error)}</div>` : "") + (vm.vaultReason ? `<div class="si-err">${esc(vm.vaultReason)}</div>` : vm.signingIn ? '<div class="si-wait">Waiting for your browser\u2026</div><div class="si-note">Approve the request on the Atlassian page that just opened. This window updates by itself once you do.</div><div class="si-row"><button class="ib" data-act="copysigninlink">Didn&rsquo;t open? Copy the link</button><button class="ib" data-act="cancelsignin">Cancel</button></div>' : '<button class="si-btn" data-act="signin">Sign in to Jira</button><div class="si-note">Opens your browser so Atlassian can ask you to approve. Kumonga never sees your password.</div><div class="si-note">Blockbench will first ask to allow network access and to <b>launch external programs</b>. That second one is how Kumonga encrypts your sign-in on this PC.</div>') + "</div>";
  }

  // src/ui/modal.ts
  var host = null;
  function setModalHost(doc) {
    host = doc;
  }
  var forcedDepth = 0;
  async function inMainWindow(fn) {
    forcedDepth++;
    try {
      return await fn();
    } finally {
      forcedDepth--;
    }
  }
  function hostDoc() {
    if (forcedDepth > 0) return document;
    if (host && host.defaultView && !host.defaultView.closed) return host;
    return document;
  }
  var stack = [];
  function modalOpen() {
    return stack.length > 0;
  }
  function shell(doc, title2, buttons) {
    const overlay = doc.createElement("div");
    overlay.className = "kmodal";
    overlay.innerHTML = `<div class="kmbox" role="dialog" aria-modal="true"><div class="kmtitle">${esc(title2)}</div><div class="kmbody"></div><div class="kmfoot">` + buttons.map(
      (b, i) => `<button class="kmbtn${i === buttons.length - 1 ? " primary" : ""}" data-i="${i}">${esc(b)}</button>`
    ).join("") + "</div></div>";
    doc.body.appendChild(overlay);
    let settle;
    const promise = new Promise((res) => {
      settle = res;
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      doc.removeEventListener("keydown", onKey, true);
      overlay.remove();
      const at = stack.indexOf(self);
      if (at !== -1) stack.splice(at, 1);
    };
    const done = (value) => {
      close();
      settle(value);
    };
    function onKey(ev) {
      if (ev.key === "Escape" && stack[stack.length - 1] === self) {
        ev.stopPropagation();
        done(null);
      }
    }
    doc.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (ev) => {
      if (ev.target === overlay && stack[stack.length - 1] === self) done(null);
    });
    const self = {
      overlay,
      body: overlay.querySelector(".kmbody"),
      close,
      done,
      promise
    };
    stack.push(self);
    return self;
  }
  function toast(text, ms = 2500) {
    const doc = hostDoc();
    let host2 = doc.getElementById("kmtoasts");
    if (!host2) {
      host2 = doc.createElement("div");
      host2.id = "kmtoasts";
      host2.className = "kmtoasts";
      doc.body.appendChild(host2);
    }
    const el = doc.createElement("div");
    el.className = "kmtoast";
    el.textContent = text;
    host2.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  function showMessage(title2, text) {
    const doc = hostDoc();
    const s = shell(doc, title2, ["Close"]);
    s.body.innerHTML = `<p class="kmtext">${esc(text)}</p>`;
    s.overlay.querySelector(".kmbtn")?.addEventListener("click", () => s.done(void 0));
    s.overlay.querySelector(".kmbtn")?.focus();
    return s.promise;
  }
  function chooseOne(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", opts.confirm ?? "Set"]);
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + `<label class="kmfield"><span>${esc(opts.label)}</span><select class="kmselect">` + opts.options.map(
      (o) => `<option value="${esc(o.value)}"${o.value === opts.value ? " selected" : ""}>${esc(o.label)}</option>`
    ).join("") + "</select></label>";
    const select = s.body.querySelector(".kmselect");
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmbtn"));
    cancel.addEventListener("click", () => s.done(null));
    confirm.addEventListener("click", () => s.done(select.value));
    select.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") s.done(select.value);
    });
    select.focus();
    return s.promise;
  }
  function confirmHtml(title2, html, confirmLabel = "Confirm") {
    const doc = hostDoc();
    const s = shell(doc, title2, ["Cancel", confirmLabel]);
    s.body.innerHTML = html;
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmbtn"));
    cancel.addEventListener("click", () => s.done(false));
    confirm.addEventListener("click", () => s.done(true));
    confirm.focus();
    return s.promise.then((v) => v === true);
  }
  function chooseDate(opts) {
    const doc = hostDoc();
    const buttons = opts.value ? ["Cancel", "Clear", "Save"] : ["Cancel", "Save"];
    const s = shell(doc, opts.title, buttons);
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + `<label class="kmfield"><span>Due date</span><input class="kmdate" type="date" value="${esc(opts.value ?? "")}"></label>` + (opts.hint ? `<p class="kmnote kmhint">${esc(opts.hint)}</p>` : "");
    const input = s.body.querySelector(".kmdate");
    const btns = Array.from(s.overlay.querySelectorAll(".kmbtn"));
    const save = btns[btns.length - 1];
    btns[0].addEventListener("click", () => s.done(null));
    if (opts.value) btns[1].addEventListener("click", () => s.done({ value: null }));
    save.addEventListener("click", () => s.done({ value: input.value || null }));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") s.done({ value: input.value || null });
    });
    input.focus();
    return s.promise;
  }
  var NEW_BRANCH = ":new";
  function chooseNewFile(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", "Create"]);
    const branchRow = opts.branch ? '<label class="kmfield kmgap"><span>Branch</span><select class="kmbranch">' + opts.branch.options.map(
      (b) => `<option value="${esc(b.value)}"${b.value === opts.branch.value ? " selected" : ""}>${esc(b.label)}</option>`
    ).join("") + `<option value="${esc(NEW_BRANCH)}">New branch\u2026</option></select></label>` : "";
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + `<label class="kmfield"><span>File, relative to the repository root</span><span class="kmrow"><input class="kmtext" type="text" spellcheck="false" value="${esc(opts.path)}">` + (opts.onBrowse ? '<button class="kmbtn kmbrowse" type="button">Browse\u2026</button>' : "") + '</span></label><label class="kmfield kmgap"><span>Format</span><select class="kmselect">' + opts.formats.map(
      (f) => `<option value="${esc(f.value)}"${f.value === opts.format ? " selected" : ""}>${esc(f.label)}</option>`
    ).join("") + "</select></label>" + branchRow + '<p class="kmbad" hidden></p>' + (opts.hint ? `<p class="kmnote kmhint">${esc(opts.hint)}</p>` : "");
    const input = s.body.querySelector(".kmtext");
    const select = s.body.querySelector(".kmselect");
    const branch = s.body.querySelector(".kmbranch");
    s.body.querySelector(".kmbrowse")?.addEventListener("click", () => {
      void opts.onBrowse().then((folder) => {
        if (folder === null) return;
        const name = input.value.split("/").pop() || "";
        input.value = folder ? `${folder}/${name}` : name;
        bad.hidden = true;
      });
    });
    let lastBranch = opts.branch?.value ?? "";
    branch?.addEventListener("change", () => {
      if (branch.value !== NEW_BRANCH) {
        lastBranch = branch.value;
        return;
      }
      void opts.branch.onNew().then((created) => {
        if (created) {
          const option = doc.createElement("option");
          option.value = created;
          option.textContent = created;
          branch.insertBefore(option, branch.lastElementChild);
          lastBranch = created;
        }
        branch.value = lastBranch;
      });
    });
    const bad = s.body.querySelector(".kmbad");
    const [cancel, create] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    const submit = () => {
      const problem = opts.validate(input.value);
      if (problem) {
        bad.textContent = problem;
        bad.hidden = false;
        input.focus();
        return;
      }
      s.done({
        path: input.value.trim(),
        format: select.value,
        branch: branch ? branch.value : null
      });
    };
    cancel.addEventListener("click", () => s.done(null));
    create.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit();
    });
    input.addEventListener("input", () => {
      bad.hidden = true;
    });
    input.focus();
    const slash = opts.path.lastIndexOf("/");
    const dot = opts.path.lastIndexOf(".");
    if (dot > slash) input.setSelectionRange(slash + 1, dot);
    return s.promise;
  }
  function chooseTextAndSelect(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", opts.confirmLabel ?? "Create"]);
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + `<label class="kmfield"><span>${esc(opts.textLabel)}</span><span class="kmrow">` + (opts.multiline ? `<textarea class="kmtext kmplain kmarea" rows="4" spellcheck="true" placeholder="${esc(opts.textPlaceholder ?? "")}">${esc(opts.textValue)}</textarea>` : `<input class="${opts.mono ? "kmtext" : "kmtext kmplain"}" type="text" spellcheck="false" placeholder="${esc(opts.textPlaceholder ?? "")}" value="${esc(opts.textValue)}">`) + (opts.onBrowse ? '<button class="kmbtn kmbrowse" type="button">Browse\u2026</button>' : "") + "</span></label>" + (opts.options.length === 1 ? `<p class="kmnote kmstatic"><span>${esc(opts.selectLabel)}</span> ${esc(opts.options[0].label)}</p>` : `<label class="kmfield kmgap"><span>${esc(opts.selectLabel)}</span><select class="kmselect">` + opts.options.map(
      (o) => `<option value="${esc(o.value)}"${o.value === opts.value ? " selected" : ""}>${esc(o.label)}</option>`
    ).join("") + "</select></label>") + '<p class="kmbad" hidden></p>' + (opts.hint ? `<p class="kmnote kmhint">${esc(opts.hint)}</p>` : "");
    const input = s.body.querySelector(".kmtext");
    const select = s.body.querySelector(".kmselect");
    const chosen = () => select ? select.value : opts.options[0].value;
    const bad = s.body.querySelector(".kmbad");
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    const submit = () => {
      const problem = opts.validate?.(input.value, chosen()) ?? null;
      if (problem) {
        bad.textContent = problem;
        bad.hidden = false;
        input.focus();
        return;
      }
      s.done({ text: input.value.trim(), value: chosen() });
    };
    cancel.addEventListener("click", () => s.done(null));
    confirm.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => {
      const key = ev.key;
      if (key !== "Enter") return;
      if (!opts.multiline || ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        submit();
      }
    });
    input.addEventListener("input", () => {
      bad.hidden = true;
    });
    s.body.querySelector(".kmbrowse")?.addEventListener("click", () => {
      void opts.onBrowse().then((picked) => {
        if (picked === null) return;
        input.value = picked;
        bad.hidden = true;
      });
    });
    input.focus();
    return s.promise;
  }
  function confirmChecked(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", opts.confirmLabel ?? "Confirm"]);
    s.body.innerHTML = opts.html + `<label class="kmcheck"><input type="checkbox"><span>${esc(opts.checkboxLabel)}</span></label>`;
    const box = s.body.querySelector('input[type="checkbox"]');
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    confirm.disabled = true;
    box.addEventListener("change", () => {
      confirm.disabled = !box.checked;
    });
    cancel.addEventListener("click", () => s.done(false));
    confirm.addEventListener("click", () => {
      if (box.checked) s.done(true);
    });
    box.focus();
    return s.promise.then((v) => v === true);
  }
  function chooseAction(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, opts.choices.map((c) => c.label));
    s.body.innerHTML = opts.html;
    const buttons = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    buttons.forEach((b, i) => b.addEventListener("click", () => s.done(opts.choices[i].value)));
    buttons[buttons.length - 1]?.focus();
    return s.promise.then((v) => typeof v === "string" ? v : null);
  }
  function chooseText(opts) {
    const doc = hostDoc();
    const buttons = ["Cancel", ...opts.extraLabel ? [opts.extraLabel] : [], opts.confirmLabel ?? "Save"];
    const s = shell(doc, opts.title, buttons);
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + `<label class="kmfield"><span>${esc(opts.label)}</span><span class="kmrow">` + (opts.multiline ? `<textarea class="kmtext kmplain kmarea" rows="4" spellcheck="true" placeholder="${esc(opts.placeholder ?? "")}">${esc(opts.value)}</textarea>` : `<input class="${opts.mono ? "kmtext" : "kmtext kmplain"}" type="text" spellcheck="false" placeholder="${esc(opts.placeholder ?? "")}" value="${esc(opts.value)}">`) + (opts.onBrowse ? '<button class="kmbtn kmbrowse" type="button">Browse\u2026</button>' : "") + '</span></label><p class="kmbad" hidden></p>' + (opts.hint ? `<p class="kmnote kmhint">${esc(opts.hint)}</p>` : "") + (opts.second ? `<label class="kmfield kmgap"><span>${esc(opts.second.label)}</span><input class="kmtext kmsecond kmshort" type="text" spellcheck="false" placeholder="${esc(opts.second.placeholder ?? "")}" value="${esc(opts.second.value)}"></label><p class="kmbad kmbad2" hidden></p>` + (opts.second.hint ? `<p class="kmnote kmhint">${esc(opts.second.hint)}</p>` : "") : "") + (opts.choice ? `<label class="kmfield kmgap"><span>${esc(opts.choice.label)}</span><select class="kmselect kmchoice">` + opts.choice.options.map(
      (o) => `<option value="${esc(o.value)}"${o.value === opts.choice.value ? " selected" : ""}>${esc(o.label)}</option>`
    ).join("") + "</select></label>" : "");
    const input = s.body.querySelector(".kmtext");
    const second = s.body.querySelector(".kmsecond");
    const choice = s.body.querySelector(".kmchoice");
    const bad = s.body.querySelector(".kmbad");
    const bad2 = s.body.querySelector(".kmbad2");
    const foot = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    const cancel = foot[0];
    const confirm = foot[foot.length - 1];
    const extra = opts.extraLabel ? foot[1] : null;
    const submit = () => {
      const problem = opts.validate?.(input.value) ?? null;
      if (problem) {
        bad.textContent = problem;
        bad.hidden = false;
        input.focus();
        return;
      }
      if (second && bad2) {
        const problem2 = opts.second?.validate?.(second.value) ?? null;
        if (problem2) {
          bad2.textContent = problem2;
          bad2.hidden = false;
          second.focus();
          return;
        }
      }
      s.done({
        text: input.value.trim(),
        ...second ? { second: second.value.trim() } : {},
        ...choice ? { choice: choice.value } : {}
      });
    };
    second?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submit();
      }
    });
    second?.addEventListener("input", () => {
      if (bad2) bad2.hidden = true;
    });
    cancel.addEventListener("click", () => s.done(null));
    extra?.addEventListener("click", () => s.done({ extra: true }));
    confirm.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => {
      const k = ev;
      if (k.key !== "Enter") return;
      if (!opts.multiline || k.ctrlKey || k.metaKey) {
        ev.preventDefault();
        submit();
      }
    });
    input.addEventListener("input", () => {
      bad.hidden = true;
    });
    s.body.querySelector(".kmbrowse")?.addEventListener("click", () => {
      void opts.onBrowse().then((picked) => {
        if (picked === null) return;
        input.value = picked;
        bad.hidden = true;
      });
    });
    input.focus();
    return s.promise;
  }
  function chooseWorklog(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", "Log time"]);
    s.body.innerHTML = (opts.warning ? `<p class="kmwarn">${esc(opts.warning)}</p>` : "") + (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + '<label class="kmfield"><span>Time spent</span><input class="kmtext kmdur" type="text" spellcheck="false" placeholder="1h 30m"></label><div class="kmrow kmgap"><label class="kmfield" style="flex:1"><span>Day</span><select class="kmselect kmday">' + opts.days.map(
      (d) => `<option value="${esc(d.value)}"${d.value === opts.day ? " selected" : ""}>${esc(d.label)}</option>`
    ).join("") + `</select></label><label class="kmfield" style="flex:0 0 96px"><span>Started at</span><input class="kmtext kmstart" type="time" value="${esc(opts.start)}"></label></div><label class="kmfield kmgap"><span>Description</span><textarea class="kmtext kmplain kmarea kmdesc" rows="3" spellcheck="true" placeholder="Retopologised the barrel"></textarea></label><p class="kmbad" hidden></p>`;
    const duration = s.body.querySelector(".kmdur");
    const day = s.body.querySelector(".kmday");
    const start = s.body.querySelector(".kmstart");
    const description = s.body.querySelector(".kmdesc");
    const bad = s.body.querySelector(".kmbad");
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    const complain = (text, focus) => {
      bad.textContent = text;
      bad.hidden = false;
      focus.focus();
    };
    const submit = () => {
      const problem = opts.validateDuration(duration.value);
      if (problem) return complain(problem, duration);
      if (!/^\d{2}:\d{2}$/.test(start.value)) return complain("Give a start time, like 09:30.", start);
      s.done({
        duration: duration.value.trim(),
        day: day.value,
        start: start.value,
        description: description.value.trim()
      });
    };
    cancel.addEventListener("click", () => s.done(null));
    confirm.addEventListener("click", submit);
    for (const el of [duration, start]) {
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") submit();
      });
      el.addEventListener("input", () => {
        bad.hidden = true;
      });
    }
    description.addEventListener("keydown", (ev) => {
      const k = ev;
      if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) {
        ev.preventDefault();
        submit();
      }
    });
    duration.focus();
    return s.promise;
  }
  function chooseTextAndMany(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", opts.confirmLabel ?? "Send"]);
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + `<label class="kmfield"><span>${esc(opts.textLabel)}</span><textarea class="kmtext kmplain kmarea" rows="4" spellcheck="true" placeholder="${esc(opts.placeholder ?? "")}"></textarea></label><p class="kmnote kmgap kmpick">${esc(opts.pickLabel)}</p><div class="kmlist">` + opts.options.map(
      (o, i) => `<label class="kmcheck"><input type="checkbox" data-i="${i}"${o.checked ? " checked" : ""}><span>${esc(o.label)}` + (o.description ? `<span class="kmdesc">${esc(o.description)}</span>` : "") + "</span></label>"
    ).join("") + '</div><p class="kmbad" hidden></p>';
    const input = s.body.querySelector(".kmtext");
    const boxes = Array.from(s.body.querySelectorAll('input[type="checkbox"]'));
    const bad = s.body.querySelector(".kmbad");
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    const chosen = () => boxes.filter((b) => b.checked).map((b) => opts.options[Number(b.dataset.i)].value);
    const submit = () => {
      const problem = opts.validate?.(input.value, chosen()) ?? null;
      if (problem) {
        bad.textContent = problem;
        bad.hidden = false;
        return;
      }
      s.done({ text: input.value.trim(), chosen: chosen() });
    };
    cancel.addEventListener("click", () => s.done(null));
    confirm.addEventListener("click", submit);
    input.addEventListener("input", () => {
      bad.hidden = true;
    });
    input.addEventListener("keydown", (ev) => {
      const k = ev;
      if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) {
        ev.preventDefault();
        submit();
      }
    });
    boxes.forEach((b) => b.addEventListener("change", () => {
      bad.hidden = true;
    }));
    input.focus();
    return s.promise;
  }
  function chooseMany(opts) {
    const doc = hostDoc();
    const s = shell(doc, opts.title, ["Cancel", opts.confirmLabel ?? "Save"]);
    s.body.innerHTML = (opts.note ? `<p class="kmnote">${esc(opts.note)}</p>` : "") + '<div class="kmlist">' + opts.options.map(
      (o, i) => `<label class="kmcheck"><input type="checkbox" data-i="${i}"${o.checked ? " checked" : ""}><span>${esc(o.label)}` + (o.description ? `<span class="kmdesc">${esc(o.description)}</span>` : "") + "</span></label>"
    ).join("") + '</div><p class="kmbad" hidden></p>';
    const boxes = Array.from(s.body.querySelectorAll('input[type="checkbox"]'));
    const bad = s.body.querySelector(".kmbad");
    const [cancel, confirm] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    const chosen = () => boxes.filter((b) => b.checked).map((b) => opts.options[Number(b.dataset.i)].value);
    const submit = () => {
      const picked = chosen();
      const problem = opts.validate?.(picked) ?? null;
      if (problem) {
        bad.textContent = problem;
        bad.hidden = false;
        return;
      }
      s.done(picked);
    };
    cancel.addEventListener("click", () => s.done(null));
    confirm.addEventListener("click", submit);
    boxes.forEach((b) => b.addEventListener("change", () => {
      bad.hidden = true;
    }));
    (boxes[0] ?? confirm).focus();
    return s.promise;
  }

  // src/ui/inside.ts
  async function insideRoot(root, picked, what) {
    const inside = relativeTo(toPosix(root), picked);
    if (inside !== null) return inside;
    if (what === "folder" && toPosix(picked) === toPosix(root)) return "";
    await showMessage(
      `That ${what} is outside the repository`,
      `${picked}

Root: ${root}

Jira stores paths relative to the root, so a ${what} outside it is one nobody else could resolve.`
    );
    return null;
  }

  // src/ui/links.ts
  async function openInJira(key) {
    const base = await auth.siteUrl();
    if (!base) {
      void showMessage(
        "Could not open Jira",
        "The site address is not known yet. Sign in again and try once more."
      );
      return;
    }
    try {
      nodeRequire("shell").openExternal(`${base.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`);
    } catch (e) {
      void showMessage("Could not open Jira", e?.message || String(e));
    }
  }

  // src/core/project.ts
  var PROJECT_PROPS = [
    "embody_asset_id",
    "embody_variant",
    "embody_version",
    "embody_jira_key",
    "embody_jira_site"
  ];
  var registered = false;
  function registerProjectProperties() {
    if (registered) return;
    for (const name of PROJECT_PROPS) new Property(ModelProject, "string", name);
    registered = true;
  }
  function openProject() {
    if (typeof Project === "undefined" || !Project) return null;
    return {
      path: Project.save_path ? toPosix(Project.save_path) : null,
      name: Project.name || "untitled",
      assetId: Project.embody_asset_id || null,
      variant: Project.embody_variant ?? "",
      version: Project.embody_version || null,
      jiraKey: Project.embody_jira_key || null,
      site: Project.embody_jira_site || null
    };
  }
  function stampProject(stamp) {
    Project.embody_asset_id = stamp.assetId;
    Project.embody_variant = stamp.variant;
    Project.embody_version = stamp.version;
    Project.embody_jira_key = stamp.jiraKey;
    if (stamp.site) Project.embody_jira_site = stamp.site;
  }
  function saveProject() {
    if (!Project?.save_path) throw new Error("The project has not been saved to a file yet.");
    BarItems.save_project.trigger();
  }
  function newAssetId() {
    return nodeRequire("crypto").randomBytes(4).toString("hex");
  }
  function availableFormats() {
    if (typeof Formats === "undefined" || !Formats) return [];
    return Object.entries(Formats).map(([id, f]) => ({ id, name: f?.display_name || f?.name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }
  function currentFormatId() {
    const p = typeof Project !== "undefined" ? Project : null;
    return p?.format?.id ?? null;
  }
  function existsOnDisk(nativePath) {
    try {
      return nodeRequire("fs").existsSync(nativePath);
    } catch {
      return false;
    }
  }
  function formatOf(nativePath) {
    const head = readHead(nodeRequire("fs"), nativePath, 2048);
    return head === null ? null : headString(head, "model_format") || null;
  }
  function createProjectFile(nativePath, formatId, name) {
    const format = typeof Formats !== "undefined" ? Formats?.[formatId] : null;
    if (!format) throw new Error(`Blockbench does not have a "${formatId}" format registered.`);
    const fs = nodeRequire("fs");
    const path = nodeRequire("path");
    if (fs.existsSync(nativePath)) {
      throw new Error(`${nativePath} already exists. Link it instead of creating it again.`);
    }
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    if (!newProject(format)) {
      throw new Error("Blockbench would not start a new project \u2014 unsaved changes, perhaps?");
    }
    Project.name = name;
    Project.save_path = nativePath;
    BarItems.save_project.trigger();
    if (!fs.existsSync(nativePath)) {
      throw new Error(`Blockbench did not write ${nativePath}.`);
    }
  }
  function saveProjectAs(nativePath) {
    if (typeof Project === "undefined" || !Project) {
      throw new Error("No project is open.");
    }
    Project.save_path = nativePath;
    BarItems.save_project.trigger();
  }
  function renameOnDisk(fromNative, toNative2) {
    const fs = nodeRequire("fs");
    const path = nodeRequire("path");
    if (fromNative === toNative2) return;
    if (!fs.existsSync(fromNative)) {
      throw new Error(`${fromNative} is not there, so it cannot be moved.`);
    }
    if (fs.existsSync(toNative2)) {
      throw new Error(`${toNative2} already exists. Pick another name.`);
    }
    fs.mkdirSync(path.dirname(toNative2), { recursive: true });
    fs.renameSync(fromNative, toNative2);
  }
  function openModelFile(nativePath) {
    return new Promise((resolve, reject) => {
      try {
        Blockbench.read([nativePath], {}, (files) => {
          if (!files?.length) {
            reject(new Error(`Blockbench could not read ${nativePath}.`));
            return;
          }
          try {
            loadModelFile(files[0]);
            resolve();
          } catch (e) {
            reject(new Error(String(e?.message || e)));
          }
        });
      } catch (e) {
        reject(new Error(String(e?.message || e)));
      }
    });
  }
  function clipsOf(nativePath) {
    try {
      const fs = nodeRequire("fs");
      if (fs.statSync(nativePath).size > 64 * 1024 * 1024) return null;
      const data = JSON.parse(fs.readFileSync(nativePath, "utf8"));
      const list = data?.animations;
      if (!Array.isArray(list)) return [];
      return clipNames(list);
    } catch {
      return null;
    }
  }
  function clipNames(list) {
    return list.map((a) => typeof a?.name === "string" ? a.name : "").filter((n) => !!n.trim());
  }
  function openProjectClips() {
    const p = typeof Project !== "undefined" ? Project : null;
    if (!p) return null;
    const list = p.animations;
    if (!Array.isArray(list)) return null;
    return clipNames(list);
  }

  // src/core/git.ts
  function parseOriginUrl(config) {
    let section = "";
    const remotes = /* @__PURE__ */ new Map();
    for (const raw of config.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith(";")) continue;
      const header = /^\[(.+?)\]$/.exec(line);
      if (header) {
        section = header[1].trim();
        continue;
      }
      const remote = /^remote\s+"(.+)"$/.exec(section);
      if (!remote) continue;
      const kv = /^url\s*=\s*(.+)$/.exec(line);
      if (kv) remotes.set(remote[1], kv[1].trim());
    }
    return remotes.get("origin") ?? (remotes.size === 1 ? [...remotes.values()][0] : null);
  }
  function findRepoRoot(start) {
    const fs = nodeRequire("fs");
    let dir = toPosix(start);
    for (let depth = 0; depth < 24; depth++) {
      try {
        if (fs.existsSync(`${dir}/.git`)) return dir;
      } catch {
      }
      const parent = dirOf(dir);
      if (!parent || parent === dir) return null;
      dir = parent;
    }
    return null;
  }
  function configPath(repoRoot) {
    const fs = nodeRequire("fs");
    const dotGit = `${repoRoot}/.git`;
    try {
      if (fs.statSync(dotGit).isDirectory()) return `${dotGit}/config`;
      const pointer = fs.readFileSync(dotGit, "utf8");
      const m = /^gitdir:\s*(.+)$/m.exec(pointer);
      if (!m) return null;
      const target = toPosix(m[1].trim());
      const gitDir = /^([a-zA-Z]:|\/)/.test(target) ? target : `${repoRoot}/${target}`;
      try {
        const common = toPosix(fs.readFileSync(`${gitDir}/commondir`, "utf8").trim());
        const commonDir = /^([a-zA-Z]:|\/)/.test(common) ? common : `${gitDir}/${common}`;
        return `${commonDir}/config`;
      } catch {
        return `${gitDir}/config`;
      }
    } catch {
      return null;
    }
  }
  function repoFor(path) {
    const root = findRepoRoot(path);
    if (!root) return null;
    const config = configPath(root);
    if (!config) return { root, remote: null };
    try {
      const fs = nodeRequire("fs");
      return { root, remote: parseOriginUrl(fs.readFileSync(config, "utf8")) };
    } catch {
      return { root, remote: null };
    }
  }
  function gitHubDesktopUrl(remote) {
    return "x-github-client://openRepo/" + remote.replace(/\.git$/, "");
  }
  function gitEnv() {
    const env = globalThis.process?.env;
    if (!env) return void 0;
    return { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  }
  function killTree(cp, child2) {
    try {
      if (isWindows() && child2.pid) {
        cp.spawn("taskkill", ["/T", "/F", "/PID", String(child2.pid)], { windowsHide: true }).on("error", () => {
        });
      }
      child2.kill();
    } catch {
    }
  }
  function runGit(repoRoot, args, timeoutMs = 2e4) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (!done) {
          done = true;
          resolve(r);
        }
      };
      try {
        const cp = nodeRequire("child_process");
        const child2 = cp.spawn("git", args, {
          cwd: toNative(repoRoot),
          windowsHide: true,
          env: gitEnv()
        });
        let out = "";
        let err = "";
        child2.stdout?.on("data", (d) => {
          out += d.toString("utf8");
        });
        child2.stderr?.on("data", (d) => {
          err += d.toString("utf8");
        });
        const timer = setTimeout(() => {
          killTree(cp, child2);
          finish({ ok: false, out: out.trim(), err: `git ${args[0]} timed out` });
        }, timeoutMs);
        child2.on("error", (e) => {
          clearTimeout(timer);
          finish({ ok: false, out: "", err: String(e?.message || e) });
        });
        child2.on("close", (code) => {
          clearTimeout(timer);
          finish({ ok: code === 0, out: out.trim(), err: err.trim() });
        });
      } catch (e) {
        finish({ ok: false, out: "", err: String(e?.message || e) });
      }
    });
  }
  function parseAheadBehind(out) {
    const m = /^(\d+)\s+(\d+)$/.exec(out.trim());
    if (!m) return { behind: 0, ahead: 0 };
    return { behind: Number(m[1]), ahead: Number(m[2]) };
  }
  function parseCount(out) {
    const n = Number(out.trim());
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }
  function parseDirty(out) {
    return out.trim().length > 0;
  }
  async function branchState(repoRoot) {
    const branch = await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], 5e3);
    if (!branch.ok || !branch.out) return null;
    const upstream = await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 5e3);
    if (!upstream.ok || !upstream.out) {
      const [local, status2] = await Promise.all([
        runGit(repoRoot, ["rev-list", "--count", "HEAD", "--not", "--remotes"], 15e3),
        runGit(repoRoot, ["status", "--porcelain"], 15e3)
      ]);
      return {
        branch: branch.out,
        upstream: null,
        behind: 0,
        ahead: local.ok ? parseCount(local.out) : 0,
        dirty: parseDirty(status2.ok ? status2.out : "")
      };
    }
    const [counts, status] = await Promise.all([
      runGit(repoRoot, ["rev-list", "--left-right", "--count", `${upstream.out}...HEAD`], 15e3),
      runGit(repoRoot, ["status", "--porcelain"], 15e3)
    ]);
    return {
      branch: branch.out,
      upstream: upstream.out,
      ...parseAheadBehind(counts.ok ? counts.out : ""),
      dirty: parseDirty(status.ok ? status.out : "")
    };
  }
  async function fetchRemote(repoRoot) {
    return (await runGit(repoRoot, ["fetch", "--quiet"], 3e4)).ok;
  }
  function pullFastForward(repoRoot) {
    return runGit(repoRoot, ["pull", "--ff-only"], 12e4);
  }
  function validateBranchName(name) {
    const n = name.trim();
    if (!n) return "Give the branch a name.";
    if (/\s/.test(n)) return "Branch names cannot contain spaces.";
    if (/[~^:?*[\\]/.test(n)) return "Branch names cannot contain ~ ^ : ? * [ or backslash.";
    if (n.includes("..")) return "Branch names cannot contain two dots.";
    if (n.includes("//")) return "Branch names cannot contain two slashes.";
    if (n.startsWith("/") || n.endsWith("/")) return "Branch names cannot start or end with a slash.";
    if (n.startsWith("-")) return "Branch names cannot start with a dash.";
    if (n.startsWith(".") || n.endsWith(".")) return "Branch names cannot start or end with a dot.";
    if (n.endsWith(".lock")) return "Branch names cannot end with .lock.";
    if (n === "@") return "@ on its own is not a branch name.";
    if (/[\x00-\x1f\x7f]/.test(n)) return "Branch names cannot contain control characters.";
    return null;
  }
  async function listBranches(repoRoot) {
    const res = await runGit(repoRoot, ["branch", "--format=%(refname:short)"], 8e3);
    const branches = res.ok ? res.out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    const head = await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], 5e3);
    return { current: head.ok && head.out ? head.out : null, branches };
  }
  function switchBranch(repoRoot, name) {
    return runGit(repoRoot, ["switch", "--", name], 3e4);
  }
  function createBranch(repoRoot, name, base) {
    const args = base ? ["switch", "-c", name, base] : ["switch", "-c", name];
    return runGit(repoRoot, args, 3e4);
  }
  function parseStatusFiles(out) {
    const files = [];
    for (const raw of out.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.length < 4) continue;
      let name = line.slice(3);
      const arrow = name.indexOf(" -> ");
      if (arrow !== -1) name = name.slice(arrow + 4);
      name = unquoteGitPath(name);
      if (name) files.push(name);
    }
    return files;
  }
  function unquoteGitPath(name) {
    if (!(name.startsWith('"') && name.endsWith('"') && name.length >= 2)) return name;
    const body = name.slice(1, -1);
    const bytes = [];
    const push = (text) => {
      for (const b of Buffer.from(text, "utf8")) bytes.push(b);
    };
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== "\\") {
        push(body[i]);
        continue;
      }
      const next = body[++i];
      if (next >= "0" && next <= "7") {
        bytes.push(parseInt(body.slice(i, i + 3), 8) & 255);
        i += 2;
      } else {
        push({ n: "\n", t: "	", r: "\r", '"': '"', "\\": "\\" }[next] ?? next);
      }
    }
    return Buffer.from(bytes).toString("utf8");
  }
  async function changedFiles(repoRoot) {
    const res = await runGit(repoRoot, ["status", "--porcelain"], 15e3);
    return res.ok ? parseStatusFiles(res.out) : [];
  }
  function stashChanges(repoRoot, message) {
    return runGit(repoRoot, ["stash", "push", "--include-untracked", "-m", message], 6e4);
  }

  // src/jira/transitions.ts
  function parseTransitions(json) {
    const out = [];
    for (const t of json?.transitions ?? []) {
      if (!t?.id) continue;
      if (t.isAvailable === false) continue;
      const fields = [];
      for (const [key, f] of Object.entries(t.fields ?? {})) {
        if (f?.required) fields.push({ key, name: f.name || key, required: true });
      }
      out.push({
        id: String(t.id),
        name: String(t.name ?? ""),
        to: String(t.to?.name ?? ""),
        fields
      });
    }
    return out;
  }
  async function listTransitions(issueKey) {
    return parseTransitions(
      await api(`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`)
    );
  }
  async function applyTransition(issueKey, transitionId, opts = {}) {
    const body = { transition: { id: transitionId } };
    if (opts.fields && Object.keys(opts.fields).length) body.fields = opts.fields;
    if (opts.comment?.trim()) {
      body.update = { comment: [{ add: { body: toADF(opts.comment) } }] };
    }
    await api(`/rest/api/3/issue/${issueKey}/transitions`, { method: "POST", body, attempts: 1 });
  }
  function toADF(text) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      type: "doc",
      version: 1,
      content: (paragraphs.length ? paragraphs : [""]).map((p) => ({
        type: "paragraph",
        content: p ? [{ type: "text", text: p }] : []
      }))
    };
  }
  function adfToText(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(adfToText).join("");
    if (node.type === "text") return String(node.text ?? "");
    if (node.type === "hardBreak") return " ";
    const inner = adfToText(node.content);
    return node.type === "paragraph" ? inner + "\n" : inner;
  }
  async function latestComment(issueKey) {
    const json = await api(`/rest/api/3/issue/${issueKey}/comment?orderBy=-created&maxResults=1`);
    const c = json?.comments?.[0];
    if (!c) return null;
    return {
      author: c.author?.displayName || "Someone",
      created: c.created || "",
      text: adfToText(c.body).trim()
    };
  }
  async function addComment(issueKey, text) {
    if (!text.trim()) throw new Error("A comment needs something in it.");
    await api(
      `/rest/api/3/issue/${issueKey}/comment`,
      { method: "POST", body: { body: toADF(text) }, attempts: 1 }
    );
  }

  // src/jira/properties.ts
  var propertyPath = (issueKey) => `/rest/api/3/issue/${issueKey}/properties/${ASSET_MAP_PROPERTY}`;
  async function getAssetMap(issueKey) {
    const res = await jira(propertyPath(issueKey));
    if (res.status === 404) return emptyMap();
    if (!res.ok) throw new Error(errorMessage(res));
    return parseAssetMap(res.json?.value);
  }
  async function updateAssetMap(issueKey, mutate) {
    const current3 = await getAssetMap(issueKey);
    const next = mutate(current3);
    const res = await jira(propertyPath(issueKey), { method: "PUT", body: next });
    if (!res.ok) {
      throw new ApiError(res.status, explainFailure(res.status, errorMessage(res)));
    }
    return next;
  }

  // src/jira/qa.ts
  async function search(jql, opts = {}) {
    const maxPages = opts.maxPages ?? 10;
    const tasks = [];
    let cursor;
    let pages = 0;
    do {
      const body = {
        jql,
        // Scope is irrelevant here: a lead reviews their components by definition,
        // so everything returned is in scope for this page.
        fields: SEARCH_FIELDS,
        properties: SEARCH_PROPERTIES,
        maxResults: opts.maxResults ?? 100
      };
      if (cursor) body.nextPageToken = cursor;
      const page = await api(
        "/rest/api/3/search/jql",
        { method: "POST", body }
      );
      for (const i of page.issues || []) {
        if (isWorkItem(i.fields?.issuetype)) tasks.push(toTask(i, []));
      }
      cursor = page.nextPageToken;
      pages++;
    } while (cursor && pages < maxPages);
    return { tasks, complete: !cursor };
  }
  async function allLeads(projectKeys) {
    const found = /* @__PURE__ */ new Map();
    for (const key of projectKeys) {
      let components;
      try {
        components = await listComponents(key);
      } catch {
        continue;
      }
      for (const c of components) {
        if (!c.leadAccountId) continue;
        const lead = found.get(c.leadAccountId) ?? { accountId: c.leadAccountId, name: c.leadName || "Unknown", components: [] };
        if (!lead.components.includes(c.name)) lead.components.push(c.name);
        found.set(c.leadAccountId, lead);
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async function leadScopesFor(projectKeys, accountId) {
    const scopes = [];
    for (const key of projectKeys) {
      try {
        const components = (await listComponents(key)).filter((c) => c.leadAccountId === accountId).map((c) => c.name);
        if (components.length) scopes.push({ projectKey: key, components });
      } catch {
      }
    }
    return scopes;
  }
  async function myLeadComponents(projectKey, myAccountId) {
    if (!myAccountId) return [];
    const components = await listComponents(projectKey);
    return components.filter((c) => c.leadAccountId === myAccountId).map((c) => c.name);
  }
  var quote = (s) => `"${s.replace(/"/g, '\\"')}"`;
  function qaJql(scopes) {
    const clause = scopeClause(scopes);
    return clause ? `status = "QA" AND (${clause}) ORDER BY duedate ASC, priority DESC` : null;
  }
  function scopeClause(scopes) {
    const usable = scopes.filter((s) => s.components.length);
    if (!usable.length) return null;
    return usable.map((s) => `(project = ${quote(s.projectKey)} AND component in (${s.components.map(quote).join(",")}))`).join(" OR ");
  }
  async function qaQueue(scopes) {
    const jql = qaJql(scopes);
    return jql ? search(jql) : { tasks: [], complete: true };
  }
  function partialQaJql(scopes) {
    const clause = scopeClause(scopes);
    return clause ? `status in ("In Progress","Needs Changes") AND (${clause}) ORDER BY duedate ASC, priority DESC` : null;
  }
  async function partialQueue(scopes) {
    const jql = partialQaJql(scopes);
    if (!jql) return { tasks: [], complete: true };
    const found = await search(jql, { maxResults: 100, maxPages: 1 });
    return { tasks: found.tasks.filter(handedOver), complete: found.complete };
  }
  function clearedJql(projectKeys, days = 30, accountId = null) {
    const scope = projectKeys.length ? `project in (${projectKeys.map(quote).join(",")}) AND ` : "";
    const by = accountId ? quote(accountId) : "currentUser()";
    return `${scope}status CHANGED TO "Complete" BY ${by} AFTER -${days}d ORDER BY updated DESC`;
  }
  async function clearedBy(projectKeys, accountId = null, days = 30) {
    return (await search(clearedJql(projectKeys, days, accountId), { maxResults: 25, maxPages: 1 })).tasks;
  }

  // src/jira/link.ts
  function versionFor(map, assetId, variant, path, stamped) {
    const asset = map.assets[assetId];
    const files = asset?.variants[variant]?.files ?? {};
    const samePath = Object.entries(files).find(([, f]) => f.path === path)?.[0];
    if (samePath) return samePath;
    if (stamped && !files[stamped]) return stamped;
    return nextVersion(asset, variant);
  }
  async function linkOpenProject(opts) {
    const project = openProject();
    if (!project) {
      throw new Error("Open the .bbmodel in Blockbench first, then link it.");
    }
    if (!project.path) {
      throw new Error("Save this project to a file before linking it, so there is a path to record.");
    }
    const relative = relativeTo(opts.root, project.path);
    if (!relative) {
      throw new Error(
        `That file is outside this client's repository root.

${project.path}

Root: ${opts.root}

Jira stores paths relative to the root, so a file outside it is one nobody else could resolve.`
      );
    }
    const recorded = relative;
    const assetId = project.assetId || newAssetId();
    const variant = opts.variant ?? project.variant ?? "";
    const existing = await getAssetMap(opts.taskKey);
    const version = versionFor(existing, assetId, variant, relative, project.version);
    stampProject({ assetId, variant, version, jiraKey: opts.taskKey, site: opts.cloudId });
    saveProject();
    try {
      await recordLink();
    } catch (e) {
      if (e?.status === 403) {
        throw new Error(`${e.message} The file is identified on disk but was not recorded for the team.`);
      }
      throw e;
    }
    return { path: relative, assetId, version, variant };
    async function recordLink() {
      await updateAssetMap(opts.taskKey, (current3) => addFileToMap(current3, {
        assetId,
        item: opts.itemText,
        variant,
        version,
        path: recorded,
        by: opts.me ?? void 0,
        at: (/* @__PURE__ */ new Date()).toISOString()
      }));
    }
  }

  // src/jira/checklist.ts
  var CHECKLIST_FIELD2 = "customfield_10501";
  async function getChecklistField(issueKey) {
    const json = await api(`/rest/api/3/issue/${issueKey}?fields=${CHECKLIST_FIELD2}`);
    const field = json?.fields?.[CHECKLIST_FIELD2];
    return field && typeof field.v === "string" ? field : null;
  }
  async function putChecklistField(issueKey, field, v) {
    await api(`/rest/api/3/issue/${issueKey}`, {
      method: "PUT",
      body: { fields: { [CHECKLIST_FIELD2]: { ...field, v } } }
    });
  }
  async function renameChecklistItem(issueKey, index, expectedRaw, newText, estimate, priority) {
    const field = await getChecklistField(issueKey);
    if (!field) {
      throw new ChecklistDrift(
        `${issueKey} has no checklist, so there is no item to rename.`
      );
    }
    let line = renameItemLine(expectedRaw, newText);
    if (estimate !== void 0) line = setEstimateLine(line, estimate);
    if (priority !== void 0) line = setPriorityLine(line, priority);
    const next = replaceLine(field.v, { index, expected: expectedRaw }, line);
    if (next === field.v) return;
    await putChecklistField(issueKey, field, next);
  }
  async function setChecklistStatus(issueKey, index, expectedRaw, status) {
    const field = await getChecklistField(issueKey);
    if (!field) {
      throw new ChecklistDrift(`${issueKey} has no checklist, so there is nothing to mark.`);
    }
    if (!field.format || !(status.marker in field.format)) {
      throw new ChecklistDrift(
        `This checklist does not use "${status.marker}" as a state. Smart Checklist decides which markers exist, in its own configuration.`
      );
    }
    const next = replaceLine(
      field.v,
      { index, expected: expectedRaw },
      setStatusLine(expectedRaw, status)
    );
    if (next === field.v) return;
    await putChecklistField(issueKey, field, next);
  }
  async function setChecklistStatuses(issueKey, edits) {
    if (!edits.length) return 0;
    const field = await getChecklistField(issueKey);
    if (!field) {
      throw new ChecklistDrift(`${issueKey} has no checklist, so there is nothing to tick.`);
    }
    for (const e of edits) {
      if (!field.format || !(e.status.marker in field.format)) {
        throw new ChecklistDrift(
          `This checklist does not use "${e.status.marker}" as a state. Smart Checklist decides which markers exist, in its own configuration.`
        );
      }
    }
    const next = replaceLines(field.v, edits.map((e) => ({
      index: e.index,
      expected: e.expectedRaw,
      replacement: setStatusLine(e.expectedRaw, e.status)
    })));
    if (next === field.v) return 0;
    await putChecklistField(issueKey, field, next);
    return edits.length;
  }
  async function appendChecklistItems(issueKey, names) {
    if (!names.length) return [];
    const field = await getChecklistField(issueKey);
    if (!field) {
      throw new ChecklistDrift(
        `${issueKey} has no checklist. Kumonga does not create one \u2014 add the first item in Jira and it will pick it up.`
      );
    }
    const marker = markerForLabel(field.format, "Todo");
    if (!marker) {
      throw new ChecklistDrift(
        "This checklist's legend has no Todo state, so there is nothing safe to add items as."
      );
    }
    const { text, added } = appendItems(field.v, names, marker);
    if (!added.length) return [];
    await putChecklistField(issueKey, field, text);
    return added;
  }

  // src/model/notebody.ts
  function wikiEscape(text) {
    return text.replace(/[[\]{}!|_\-+^~?#]/g, "\\$&");
  }
  function safeAttachmentName(name) {
    return !!name && !/[!|\r\n]/.test(name);
  }
  function wikiWithImages(text, filenames) {
    const images = filenames.filter(safeAttachmentName).map((f) => `!${f}|width=560!`);
    return [wikiEscape(text.trim()), ...images].filter(Boolean).join("\n\n");
  }
  function shotFilename(taskKey, clip, frame, now = Date.now()) {
    const slug = (clip ?? "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";
    const at = frame === null ? "" : `-f${frame}`;
    return `kumonga-${taskKey}-${slug}${at}-${now.toString(36)}.png`;
  }

  // src/jira/review.ts
  var REVIEW_PROPERTY = "com.embodygames.review";
  async function listReview(issueKey) {
    const comments = [];
    let startAt = 0;
    for (; ; ) {
      const json = await api(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?expand=properties&orderBy=created&maxResults=100&startAt=${startAt}`
      );
      const page = Array.isArray(json?.comments) ? json.comments : [];
      comments.push(...page);
      startAt += page.length;
      const total = Number(json?.total);
      if (!page.length || !Number.isFinite(total) || startAt >= total) break;
    }
    const values = await Promise.all(comments.map((c) => {
      if (Array.isArray(c?.properties)) {
        return c.properties.find((p) => p?.key === REVIEW_PROPERTY)?.value ?? null;
      }
      const id = String(c?.id ?? "");
      return id ? commentProperty(id) : null;
    }));
    const threads = [];
    comments.forEach((c, i) => {
      const id = String(c?.id ?? "");
      if (!id) return;
      const parsed = parseReviewProperty(values[i]);
      threads.push({
        commentId: id,
        target: parsed.target,
        status: parsed.status,
        attachments: parsed.attachments,
        at: parsed.at,
        camera: parsed.camera,
        range: parsed.range,
        resolvedBy: parsed.resolvedBy,
        resolvedAt: parsed.resolvedAt,
        authorId: String(c?.author?.accountId ?? ""),
        author: String(c?.author?.displayName ?? "Someone"),
        created: String(c?.created ?? ""),
        text: adfToText(c?.body)
      });
    });
    return threads;
  }
  async function commentProperty(commentId) {
    try {
      const json = await api(
        `/rest/api/3/comment/${encodeURIComponent(commentId)}/properties/${encodeURIComponent(REVIEW_PROPERTY)}`
      );
      return json?.value ?? null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  async function postFeedback(issueKey, target, text, attachments = [], at = null, camera = null, range = null) {
    const body = text.trim();
    if (!body) throw new Error("Feedback needs something in it.");
    const created = attachments.length ? await api(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`,
      { method: "POST", body: { body: wikiWithImages(body, attachments.map((a) => a.filename)) }, attempts: 1 }
    ) : await api(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      { method: "POST", body: { body: toADF(body) }, attempts: 1 }
    );
    const commentId = String(created?.id ?? "");
    if (!commentId) throw new Error("Jira accepted the comment but returned no id.");
    try {
      await putReviewProperty(commentId, {
        target,
        status: "open",
        attachments: attachments.map((a) => a.id),
        at,
        camera,
        range,
        resolvedBy: null,
        resolvedAt: null
      });
      return { commentId, scoped: true, reason: null };
    } catch (e) {
      return { commentId, scoped: false, reason: e?.message || String(e) };
    }
  }
  async function setThreadStatus(commentId, status, accountId, at) {
    const current3 = parseReviewProperty(await commentProperty(commentId));
    if (!current3.target) {
      throw new Error("That comment is not scoped feedback, so it cannot be resolved.");
    }
    await putReviewProperty(commentId, {
      target: current3.target,
      status,
      attachments: current3.attachments,
      at: current3.at,
      camera: current3.camera,
      range: current3.range,
      // Reopening clears who resolved it: the previous answer is no longer the
      // answer, and leaving a name on it reads as somebody standing behind it.
      resolvedBy: status === "resolved" ? accountId : null,
      resolvedAt: status === "resolved" ? at : null
    });
  }
  async function deleteFeedback(issueKey, commentId) {
    await api(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
      { method: "DELETE", attempts: 1 }
    );
  }
  async function putReviewProperty(commentId, value) {
    await api(
      `/rest/api/3/comment/${encodeURIComponent(commentId)}/properties/${encodeURIComponent(REVIEW_PROPERTY)}`,
      { method: "PUT", body: value }
    );
  }

  // src/core/multipart.ts
  function multipart(parts, boundary2) {
    const buffers = parts.map((p) => Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data, "utf8"));
    let b = boundary2 ?? newBoundary();
    while (buffers.some((buf) => buf.includes(b))) b = newBoundary();
    const chunks = [];
    parts.forEach((p, i) => {
      let head = `--${b}\r
Content-Disposition: form-data; name="${quote2(p.name)}"`;
      if (p.filename !== void 0) head += `; filename="${quote2(p.filename)}"`;
      head += "\r\n";
      if (p.contentType) head += `Content-Type: ${p.contentType}\r
`;
      head += "\r\n";
      chunks.push(Buffer.from(head, "utf8"), buffers[i], Buffer.from("\r\n", "utf8"));
    });
    chunks.push(Buffer.from(`--${b}--\r
`, "utf8"));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${b}` };
  }
  function quote2(s) {
    return s.replace(/["\\]/g, "\\$&").replace(/[\r\n]/g, " ");
  }
  function newBoundary() {
    let s = "----kumonga";
    for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
    return s;
  }

  // src/jira/attachments.ts
  async function uploadAttachment(issueKey, filename, data, contentType) {
    const form = multipart([{ name: "file", filename, contentType, data }]);
    const list = await api(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
      {
        method: "POST",
        body: form.body,
        attempts: 1,
        headers: { "Content-Type": form.contentType, "X-Atlassian-Token": "no-check" }
      }
    );
    const first = Array.isArray(list) ? list[0] : null;
    const id = String(first?.id ?? "");
    if (!id) throw new Error("Jira accepted the upload but returned no attachment id.");
    return { id, filename: String(first?.filename ?? filename) };
  }
  async function deleteAttachment(id) {
    await api(`/rest/api/3/attachment/${encodeURIComponent(id)}`, { method: "DELETE", attempts: 1 });
  }
  async function fetchAttachment(id) {
    const { url, token } = await jiraBase();
    const res = await requestBinary(
      `${url}/rest/api/3/attachment/content/${encodeURIComponent(id)}`,
      { Authorization: `Bearer ${token}` }
    );
    if (!res.ok || !res.buffer) {
      const fromJira = !res.url || new URL(res.url).host === new URL(url).host;
      throw new ApiError(res.status, fromJira ? explainFailure(res.status, errorMessage(res)) : `The media store answered ${res.status} for that screenshot. ${errorMessage(res)}`);
    }
    const ct = res.headers["content-type"];
    const contentType = (Array.isArray(ct) ? ct[0] : ct) || "application/octet-stream";
    return { data: res.buffer, contentType: contentType.split(";")[0].trim() };
  }

  // src/core/shot.ts
  async function captureViewport(maxWidth = 1280) {
    if (typeof Preview === "undefined" || !Preview) return null;
    const preview = Preview.selected ?? Preview.all?.[0];
    const canvas = preview?.canvas;
    if (!preview || !canvas) return null;
    let dataUrl = "";
    const grab = () => {
      preview.render();
      dataUrl = canvas.toDataURL("image/png");
    };
    try {
      if (typeof Canvas !== "undefined" && typeof Canvas?.withoutGizmos === "function") Canvas.withoutGizmos(grab);
      else grab();
    } catch {
      return null;
    }
    if (!dataUrl.startsWith("data:image/png;base64,")) return null;
    let width = canvas.width;
    let height = canvas.height;
    if (width > maxWidth) {
      const scaled = await downscale(dataUrl, maxWidth);
      if (scaled) ({ dataUrl, width, height } = scaled);
    }
    const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    return { png, dataUrl, width, height };
  }
  function downscale(dataUrl, maxWidth) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = maxWidth / img.naturalWidth;
          const c = document.createElement("canvas");
          c.width = Math.round(img.naturalWidth * scale);
          c.height = Math.round(img.naturalHeight * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve({ dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // src/core/camera.ts
  var round2 = (v) => Math.round(v * 100) / 100;
  var vec32 = (arr) => [round2(arr[0] ?? 0), round2(arr[1] ?? 0), round2(arr[2] ?? 0)];
  function cameraNow() {
    if (typeof Preview === "undefined" || !Preview) return null;
    const p = Preview.selected ?? Preview.all?.[0];
    const cam = p?.camera;
    if (!p || !cam?.position || !p.controls?.target) return null;
    const ortho = !!p.isOrtho;
    const out = {
      projection: ortho ? "orthographic" : "perspective",
      position: vec32(cam.position.toArray()),
      target: vec32(p.controls.target.toArray())
    };
    if (ortho) {
      const zoom = Number(cam.zoom);
      if (Number.isFinite(zoom) && zoom > 0) out.zoom = Math.round(zoom * 1e4) / 1e4;
      if (typeof p.angle === "string" && p.angle) out.angle = p.angle;
    } else {
      const fov = Number(cam.fov);
      if (Number.isFinite(fov) && fov > 0) out.fov = round2(fov);
    }
    return out;
  }
  function restoreCamera(c) {
    if (typeof Preview === "undefined" || !Preview) return false;
    const p = Preview.selected ?? Preview.all?.[0];
    if (!p || typeof p.loadAnglePreset !== "function") return false;
    try {
      p.loadAnglePreset({
        projection: c.projection,
        position: c.position,
        target: c.target,
        zoom: c.zoom,
        fov: c.fov,
        locked_angle: c.angle ?? void 0
      });
      p.controls?.update?.();
      return true;
    } catch {
      return false;
    }
  }

  // src/model/drawover.ts
  var COLOURS = ["#ff3b30", "#ffd60a"];
  function strokeWidth(imageWidth) {
    return Math.max(2, Math.round(imageWidth / 320));
  }
  function pushOp(ops, op) {
    if (op.tool === "pen" && op.points.length < 2) return [...ops];
    if (op.tool !== "pen" && op.from.x === op.to.x && op.from.y === op.to.y) return [...ops];
    return [...ops, op];
  }
  function undo(ops) {
    return ops.slice(0, -1);
  }
  var hasMarks = (ops) => ops.length > 0;
  function ellipseOf(from, to) {
    return {
      cx: (from.x + to.x) / 2,
      cy: (from.y + to.y) / 2,
      rx: Math.abs(to.x - from.x) / 2,
      ry: Math.abs(to.y - from.y) / 2
    };
  }
  function arrowHead(from, to, width) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (!len) return null;
    const size = Math.max(8, width * 4);
    const ux = dx / len;
    const uy = dy / len;
    const bx = to.x - ux * size;
    const by = to.y - uy * size;
    const half = size * 0.5;
    return [
      { x: bx - uy * half, y: by + ux * half },
      { x: bx + uy * half, y: by - ux * half }
    ];
  }
  var MIN_CROP = 16;
  function cropRect(from, to, imageWidth, imageHeight) {
    const x0 = Math.max(0, Math.min(from.x, to.x));
    const y0 = Math.max(0, Math.min(from.y, to.y));
    const x1 = Math.min(imageWidth, Math.max(from.x, to.x));
    const y1 = Math.min(imageHeight, Math.max(from.y, to.y));
    const w = Math.round(x1 - x0);
    const h = Math.round(y1 - y0);
    if (w < MIN_CROP || h < MIN_CROP) return null;
    return { x: Math.round(x0), y: Math.round(y0), w, h };
  }
  function toImage(clientX, clientY, rect, imageWidth, imageHeight) {
    const sx = rect.width ? imageWidth / rect.width : 1;
    const sy = rect.height ? imageHeight / rect.height : 1;
    return {
      x: Math.max(0, Math.min(imageWidth, (clientX - rect.left) * sx)),
      y: Math.max(0, Math.min(imageHeight, (clientY - rect.top) * sy))
    };
  }

  // src/ui/drawover.ts
  function drawOver(shot) {
    const doc = hostDoc();
    const s = shell(doc, "Mark up the screenshot", ["Attach unmarked", "Attach with marks"]);
    s.overlay.querySelector(".kmbox")?.classList.add("kmwide");
    const tools = [
      ["pen", "gesture", "Pen \u2014 drag to scribble"],
      ["arrow", "north_east", "Arrow \u2014 drag from the tail to the point"],
      ["ellipse", "radio_button_unchecked", "Ellipse \u2014 drag a box round the thing"],
      ["crop", "crop", "Crop \u2014 drag the part to keep; drag again to change it"]
    ];
    s.body.innerHTML = '<div class="kdo-bar">' + tools.map(([t, icon2, title2]) => `<button class="kdo-t${t === "pen" ? " on" : ""}" data-tool="${t}" title="${title2}" type="button"><i class="material-icons">${icon2}</i></button>`).join("") + '<span class="kdo-sep"></span>' + COLOURS.map((c, i) => `<button class="kdo-c${i === 0 ? " on" : ""}" data-color="${c}" style="--c:${c}" title="${i === 0 ? "Red \u2014 this is wrong" : "Yellow \u2014 look here"}" type="button"></button>`).join("") + '<span class="kdo-sep"></span><button class="kdo-t" data-act="undo" title="Undo the last mark (Ctrl+Z)" type="button"><i class="material-icons">undo</i></button><button class="kdo-t" data-act="clear" title="Remove every mark" type="button"><i class="material-icons">delete_sweep</i></button><span class="kdo-hint">Drag to draw. Ctrl+Z undoes.</span></div><div class="kdo-wrap"><canvas class="kdo-canvas"></canvas></div>';
    const canvas = s.body.querySelector(".kdo-canvas");
    canvas.width = shot.width;
    canvas.height = shot.height;
    const ctx = canvas.getContext("2d");
    const width = strokeWidth(shot.width);
    const image = new Image();
    let ops = [];
    let tool = "pen";
    let color = COLOURS[0];
    let live = null;
    let crop = null;
    let cropStart = null;
    let cropLive = null;
    let history = [];
    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image.complete && image.naturalWidth) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const op of ops) paintOp(ctx, op);
      if (live) paintOp(ctx, live);
      const box = cropLive ?? crop;
      if (box) paintCrop(ctx, box, canvas.width, canvas.height);
    };
    const undoLast = () => {
      const last2 = history.pop();
      if (last2 === "crop") crop = null;
      else if (last2 === "op") ops = undo(ops);
      paint();
    };
    image.onload = paint;
    image.src = shot.dataUrl;
    const setTool = (t) => {
      tool = t;
      s.body.querySelectorAll(".kdo-t[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
    };
    const setColor = (c) => {
      color = c;
      s.body.querySelectorAll(".kdo-c").forEach((b) => b.classList.toggle("on", b.dataset.color === c));
    };
    s.body.querySelector(".kdo-bar").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool);
      else if (b.dataset.color) setColor(b.dataset.color);
      else if (b.dataset.act === "undo") undoLast();
      else if (b.dataset.act === "clear") {
        ops = [];
        crop = null;
        history = [];
        paint();
      }
    });
    const at = (e) => toImage(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = at(e);
      if (tool === "crop") {
        cropStart = p;
        cropLive = null;
        paint();
        return;
      }
      live = tool === "pen" ? { tool, color, width, points: [p] } : { tool, color, width, from: p, to: p };
      paint();
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = at(e);
      if (cropStart) {
        cropLive = cropRect(cropStart, p, canvas.width, canvas.height);
        paint();
        return;
      }
      if (!live) return;
      if (live.tool === "pen") live.points.push(p);
      else live.to = p;
      paint();
    });
    const finish = () => {
      if (cropStart) {
        if (cropLive) {
          crop = cropLive;
          history.push("crop");
        }
        cropStart = null;
        cropLive = null;
        paint();
        return;
      }
      if (!live) return;
      const before = ops.length;
      ops = pushOp(ops, live);
      if (ops.length > before) history.push("op");
      live = null;
      paint();
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        undoLast();
      }
    };
    doc.addEventListener("keydown", onKey, true);
    const [unmarked, marked] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    unmarked.addEventListener("click", () => s.done(false));
    marked.addEventListener("click", () => s.done(true));
    marked.focus();
    return s.promise.then((withMarks) => {
      doc.removeEventListener("keydown", onKey, true);
      if (withMarks !== true || !hasMarks(ops) && !crop) return shot;
      const box = crop ?? { x: 0, y: 0, w: shot.width, h: shot.height };
      const out = doc.createElement("canvas");
      out.width = box.w;
      out.height = box.h;
      const octx = out.getContext("2d");
      octx.translate(-box.x, -box.y);
      octx.drawImage(image, 0, 0, shot.width, shot.height);
      for (const op of ops) paintOp(octx, op);
      const dataUrl = out.toDataURL("image/png");
      return {
        png: Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"),
        dataUrl,
        width: box.w,
        height: box.h
      };
    });
  }
  function paintCrop(ctx, c, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, Math.round(w / 640));
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
    ctx.restore();
  }
  function paintOp(ctx, op) {
    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (op.tool === "pen") {
      ctx.beginPath();
      op.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    } else if (op.tool === "arrow") {
      ctx.beginPath();
      ctx.moveTo(op.from.x, op.from.y);
      ctx.lineTo(op.to.x, op.to.y);
      ctx.stroke();
      const head = arrowHead(op.from, op.to, op.width);
      if (head) {
        ctx.beginPath();
        ctx.moveTo(op.to.x, op.to.y);
        ctx.lineTo(head[0].x, head[0].y);
        ctx.lineTo(head[1].x, head[1].y);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      const { cx, cy, rx, ry } = ellipseOf(op.from, op.to);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // src/core/timeline.ts
  var have = () => typeof Timeline !== "undefined" && !!Timeline && typeof Animation !== "undefined";
  function selectedClip() {
    if (!have()) return null;
    const name = Animation.selected?.name;
    return typeof name === "string" && name.trim() ? name : null;
  }
  function fpsOf(anim) {
    const n = Number(anim?.snapping);
    return Number.isFinite(n) && n > 0 ? n : 24;
  }
  function playheadFor(clip) {
    if (!have()) return null;
    const anim = Animation.selected;
    if (!anim || normaliseClip(String(anim.name ?? "")) !== normaliseClip(clip)) return null;
    return pinAt(Number(Timeline.time) || 0, fpsOf(anim));
  }
  function timelineLive() {
    if (!have()) return null;
    const anim = Animation.selected;
    const range = Timeline.custom_range;
    return {
      clip: selectedClip(),
      pin: anim ? pinAt(Number(Timeline.time) || 0, fpsOf(anim)) : null,
      playing: !!Timeline.playing,
      speed: Number(Timeline.playback_speed) || 100,
      looping: Array.isArray(range) && (!!range[0] || !!range[1]),
      onion: !!onionToggle()?.value,
      ghost
    };
  }
  function seekTo(clip, at) {
    if (!have()) return false;
    const want = normaliseClip(clip);
    const anim = (Animation.all ?? []).find((a) => normaliseClip(String(a?.name ?? "")) === want);
    if (!anim) return false;
    try {
      if (!Modes?.animate) Modes.options?.animate?.select?.();
    } catch {
    }
    if (Animation.selected !== anim) anim.select();
    Timeline.setTime(Math.min(at.time, Number(anim.length) || at.time));
    Animator.preview();
    return true;
  }
  function animationsInProject() {
    if (!have()) return [];
    return (Animation.all ?? []).filter((a) => typeof a?.name === "string" && typeof a?.uuid === "string").map((a) => ({ uuid: a.uuid, name: a.name }));
  }
  function createAnimation(name) {
    if (!have() || !name.trim()) return false;
    try {
      const sibling = (Animation.all ?? [])[0];
      const scope = sibling?.scope ?? (typeof Group !== "undefined" ? Group?.first_selected?.scope : void 0) ?? 0;
      new Animation({
        name: name.trim(),
        path: sibling?.path || void 0,
        group_name: sibling?.group_name || void 0,
        scope,
        saved: false
      }).add(true);
      return true;
    } catch (e) {
      trace(`create animation "${name}": ${e?.message || e}`);
      return false;
    }
  }
  function loopRangeNow() {
    if (!have()) return null;
    const range = Timeline.custom_range;
    const anim = Animation.selected;
    if (!anim || !Array.isArray(range) || !(range[0] || range[1])) return null;
    const a = Number(range[0]) || 0;
    const b = Number(range[1]) || 0;
    if (b <= a) return null;
    const fps = fpsOf(anim);
    return { from: pinAt(a, fps), to: pinAt(b, fps) };
  }
  function setLoopRange(r) {
    if (!have()) return;
    const range = Timeline.custom_range;
    if (!Array.isArray(range)) return;
    range.splice(0, 2, r.from.time, r.to.time);
    if (BarItems?.looped_animation_playback && !BarItems.looped_animation_playback.value) {
      BarItems.looped_animation_playback.trigger?.();
    }
    try {
      BARS?.updateConditions?.();
    } catch {
    }
  }
  function stepFrame(dir) {
    if (!have()) return;
    BarItems?.[dir < 0 ? "timeline_frame_back" : "timeline_frame_forth"]?.trigger?.();
  }
  function togglePlay() {
    if (!have()) return;
    BarItems?.play_animation?.trigger?.();
  }
  function setSpeed(pct) {
    if (!have()) return;
    Timeline.playback_speed = Math.max(1, Math.min(1e4, Math.round(pct)));
    try {
      BarItems?.slider_animation_speed?.update?.();
    } catch {
    }
  }
  function toggleLoopAround() {
    if (!have()) return;
    const range = Timeline.custom_range;
    if (!Array.isArray(range)) return;
    if (range[0] || range[1]) {
      range.splice(0, 2, 0, 0);
    } else {
      const step = Number(Timeline.getStep?.()) || 1 / 24;
      const t = Number(Timeline.time) || 0;
      const max = Number(Animation.selected?.length) || t + step * 6;
      range.splice(0, 2, Math.max(0, t - step * 6), Math.min(max, t + step * 6) || step * 6);
      if (BarItems?.looped_animation_playback && !BarItems.looped_animation_playback.value) {
        BarItems.looped_animation_playback.trigger?.();
      }
    }
    try {
      BARS?.updateConditions?.();
    } catch {
    }
  }
  function onionToggle() {
    return typeof BarItems !== "undefined" ? BarItems?.animation_onion_skin : null;
  }
  function toggleOnionSkin() {
    onionToggle()?.trigger?.();
  }
  var ghost = null;
  function ghostAt(at) {
    const toggle2 = onionToggle();
    const opts = toggle2?.tool_config?.options;
    if (!toggle2 || !opts || !have()) return false;
    if (!at) {
      ghost = null;
      if (toggle2.value) toggle2.trigger?.();
      opts.enabled = false;
      return true;
    }
    opts.frames = "select";
    opts.selective = false;
    opts.enabled = true;
    if (Timeline.vue) {
      Timeline.vue.onion_skin_time = at.time;
      Timeline.vue.onion_skin_selectable = true;
    }
    ghost = at;
    if (!toggle2.value) toggle2.trigger?.();
    else Animator.updateOnionSkin?.();
    return true;
  }

  // src/ui/noteview.ts
  function renderNoteView(notes, busy, error) {
    return notes.map((n) => {
      const flip = n.status === "open" ? "resolved" : "open";
      return `<div class="knv-note${n.status === "resolved" ? " done" : ""}"><div class="knv-who"><b>${esc(n.author)}</b>` + (n.when ? `<span>${esc(n.when)}</span>` : "") + `<span class="knv-st ${n.status === "open" ? "op" : "ok"}">${n.status}</span></div><div class="knv-text">${esc(n.text)}</div>` + n.shots.map((u) => `<img class="knv-img" src="${esc(u)}" alt="screenshot">`).join("") + (n.attachments.length > n.shots.length ? `<div class="knv-pending">${n.attachments.length - n.shots.length} screenshot${n.attachments.length - n.shots.length === 1 ? "" : "s"} still loading \u2014 open the Review tab to fetch them.</div>` : "") + `<div class="knv-act"><button class="kmbtn${flip === "resolved" ? " primary" : ""}" type="button" data-act="flip" data-comment="${esc(n.commentId)}" data-to="${flip}"${busy === n.commentId ? " disabled" : ""}>` + (busy === n.commentId ? "Saving\u2026" : flip === "resolved" ? "Mark resolved" : "Reopen") + `</button><button class="kmbtn knv-del" type="button" data-act="del" data-comment="${esc(n.commentId)}" title="Delete this note from Jira \u2014 asks first"${busy === n.commentId ? " disabled" : ""}>Delete\u2026</button></div></div>`;
    }).join("") + (error ? `<p class="kmbad">${esc(error)}</p>` : "");
  }
  var SNIP = 160;
  function renderNoteList(rows, busy, error) {
    if (!rows.length) return '<p class="kmnote">No notes on this clip under the current filters.</p>';
    return rows.map(({ marker, note: n }) => {
      const text = n.text.length > SNIP ? n.text.slice(0, SNIP) + "\u2026" : n.text;
      return `<div class="knl-row${n.status === "resolved" ? " done" : ""}"><button class="kmbtn knl-go" type="button" data-act="go" data-comment="${esc(n.commentId)}" title="Seek to this frame">${esc(formatPin(marker))}</button><div class="knl-body"><div class="knv-who"><b>${esc(n.author)}</b>` + (n.when ? `<span>${esc(n.when)}</span>` : "") + (n.shots.length || n.attachments.length ? '<span class="knl-cam" title="Has a screenshot">&#128247;</span>' : "") + `<span class="knv-st ${n.status === "open" ? "op" : "ok"}">${n.status}</span></div><div class="knl-text">${esc(text)}</div></div>` + (n.status === "open" ? `<button class="kmbtn primary knl-tick" type="button" data-act="flip" data-comment="${esc(n.commentId)}" data-to="resolved"${busy === n.commentId ? " disabled" : ""}>${busy === n.commentId ? "Saving\u2026" : "Mark resolved"}</button>` : `<button class="kmbtn knl-tick" type="button" data-act="flip" data-comment="${esc(n.commentId)}" data-to="open"${busy === n.commentId ? " disabled" : ""}>${busy === n.commentId ? "Saving\u2026" : "Reopen"}</button>`) + "</div>";
    }).join("") + (error ? `<p class="kmbad">${esc(error)}</p>` : "");
  }
  function openNoteList(markers, clip, hooks3) {
    const rows = markers.flatMap((marker) => marker.notes.map((note) => ({ marker, note: { ...note } })));
    const open = rows.filter((r) => r.note.status === "open").length;
    const s = shell(document, `Notes on ${clip} \xB7 ${open} open`, ["Close"]);
    s.overlay.querySelector(".kmbox")?.classList.add("kmmed");
    let busy = null;
    let error = null;
    const paint = () => {
      s.body.innerHTML = renderNoteList(rows, busy, error);
    };
    paint();
    s.body.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || busy) return;
      const id = b.dataset.comment;
      if (b.dataset.act === "go") {
        s.done(null);
        hooks3.jump(id);
        return;
      }
      if (b.dataset.act !== "flip") return;
      const to = b.dataset.to === "resolved" ? "resolved" : "open";
      busy = id;
      error = null;
      paint();
      try {
        await hooks3.resolve(id, to);
        const r = rows.find((x) => x.note.commentId === id);
        if (r) r.note.status = to;
      } catch (err) {
        error = String(err?.message || err);
      }
      busy = null;
      paint();
    });
    const [close] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    close?.addEventListener("click", () => s.done(null));
  }
  function openNoteView(m, clip, hooks3) {
    const notes = m.notes.map((n) => ({ ...n }));
    const title2 = `${clip} \xB7 ${formatPin(m)}`;
    const s = shell(document, title2, ["Close", "Jump here"]);
    s.overlay.querySelector(".kmbox")?.classList.add("kmmed");
    let busy = null;
    let error = null;
    const paint = () => {
      s.body.innerHTML = renderNoteView(notes, busy, error);
    };
    paint();
    s.body.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || busy) return;
      const id = b.dataset.comment;
      if (b.dataset.act === "del") {
        busy = id;
        paint();
        let gone = false;
        try {
          gone = await hooks3.remove(id);
        } catch (err) {
          error = String(err?.message || err);
        }
        busy = null;
        if (gone) {
          const at = notes.findIndex((x) => x.commentId === id);
          if (at !== -1) notes.splice(at, 1);
          if (!notes.length) {
            s.done(null);
            return;
          }
        }
        paint();
        return;
      }
      if (b.dataset.act !== "flip") return;
      const to = b.dataset.to === "resolved" ? "resolved" : "open";
      busy = id;
      error = null;
      paint();
      try {
        await hooks3.resolve(id, to);
        const n = notes.find((x) => x.commentId === id);
        if (n) n.status = to;
      } catch (err) {
        error = String(err?.message || err);
      }
      busy = null;
      paint();
    });
    const [close, jump] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    close.addEventListener("click", () => s.done(null));
    jump.addEventListener("click", () => {
      s.done(null);
      if (notes[0]) hooks3.jump(notes[0].commentId);
    });
    close.focus();
  }

  // src/ui/notemarkers.ts
  var NOTE_MARKERS_ID = "kumonga_note_markers";
  var NOTE_LANE_ID = "kumonga_note_lane";
  function noteMarkers(threads, clip, shots2 = {}) {
    const want = targetKey({ kind: "clip", id: clip });
    const byFrame = /* @__PURE__ */ new Map();
    for (const t of threads) {
      if (!t.at || t.target?.kind !== "clip" || targetKey(t.target) !== want) continue;
      const key = Math.round(t.at.time * 1e3);
      let m = byFrame.get(key);
      if (!m) {
        m = { time: t.at.time, frame: t.at.frame, fps: t.at.fps, open: 0, notes: [], range: null };
        byFrame.set(key, m);
      }
      if (t.range) {
        m.range = !m.range ? t.range : {
          from: t.range.from.time < m.range.from.time ? t.range.from : m.range.from,
          to: t.range.to.time > m.range.to.time ? t.range.to : m.range.to
        };
      }
      if (t.status === "open") m.open++;
      m.notes.push({
        commentId: t.commentId,
        author: t.author,
        when: t.created ? t.created.slice(0, 10) : "",
        status: t.status,
        text: t.text.trim(),
        camera: !!t.camera,
        attachments: t.attachments,
        shots: t.attachments.map((id) => shots2[id]).filter((u) => !!u)
      });
    }
    const out = [...byFrame.values()].sort((a, b) => a.time - b.time);
    for (const m of out) m.notes.sort((a, b) => a.status === b.status ? 0 : a.status === "open" ? -1 : 1);
    return out;
  }
  var MAX_TIP_CHARS = 240;
  function renderNoteMarkers(markers, size) {
    return markers.map((m) => {
      const first = m.notes[0];
      const cls = m.open ? "knm knm-open" : "knm knm-done";
      const rows = m.notes.map((n) => {
        const text = n.text.length > MAX_TIP_CHARS ? n.text.slice(0, MAX_TIP_CHARS) + "\u2026" : n.text;
        return `<div class="knm-note"><div class="knm-who"><b>${esc(n.author)}</b>` + (n.when ? `<span>${esc(n.when)}</span>` : "") + `<span class="knm-st ${n.status === "open" ? "op" : "ok"}">${n.status}</span></div><div class="knm-text">${esc(text)}</div>` + (n.shots.length ? '<div class="knm-imgs">' + n.shots.map(
          (u) => `<img class="knm-img" src="${esc(u)}" data-comment="${esc(n.commentId)}" alt="screenshot" title="Click to open">`
        ).join("") + "</div>" : n.attachments.length ? `<div class="knm-pending">${n.attachments.length} screenshot${n.attachments.length === 1 ? "" : "s"} loading\u2026</div>` : "") + "</div>";
      }).join("");
      const summary = m.notes.length === 1 ? m.open ? "1 open note" : "1 resolved note" : `${m.notes.length} notes${m.open ? `, ${m.open} open` : ", all resolved"}`;
      const band = m.range ? `<div class="knm-band${m.open ? "" : " done"}" style="left:${Math.round(m.range.from.time * size * 100) / 100}px;width:${Math.max(2, Math.round((m.range.to.time - m.range.from.time) * size * 100) / 100)}px" title="${esc(formatPin(m))} is about ${esc(formatFrames(m.range))}"></div>` : "";
      return band + `<div class="${cls}" style="left:${Math.round(m.time * size * 100) / 100}px" data-comment="${esc(first?.commentId ?? "")}" data-frame="${m.frame}" title="${esc(formatPin(m))} \u2014 ${esc(summary)}. Click to jump here."><i class="material-icons">mode_comment</i>` + (m.notes.length > 1 ? `<span class="knm-n">${m.notes.length}</span>` : "") + `<div class="knm-tip"><div class="knm-head">${esc(formatPin(m))}<span>${esc(summary)}</span></div>` + rows + `<div class="knm-foot">${m.notes.some((n) => n.camera) ? "Click to jump here and restore the view" : "Click to jump here"} &middot; Shift+click to open</div></div></div>`;
    }).join("");
  }
  var NOTE_MARKERS_CSS = `
#${NOTE_LANE_ID} { display: none; height: 20px; flex: none; align-items: stretch;
  background: var(--color-back); border-bottom: 1px solid var(--color-border); }
#${NOTE_LANE_ID}.on { display: flex; }
#${NOTE_LANE_ID} .knl-head { flex: none; display: flex; align-items: center; gap: 4px; padding: 0 8px;
  box-sizing: border-box; position: relative; z-index: 7; background: var(--color-ui);
  color: var(--color-text); opacity: .75; font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
  border-right: 1px solid var(--color-border); white-space: nowrap; overflow: hidden; }
#${NOTE_LANE_ID} .knl-head .material-icons { font-size: 12px; }
#${NOTE_LANE_ID} .knl-track { flex: 1; position: relative; overflow: hidden; }
#${NOTE_MARKERS_ID} { position: absolute; top: 0; bottom: 0; pointer-events: none; }
#${NOTE_MARKERS_ID} .knm { position: absolute; top: 3px; margin-left: -8px; width: 16px; height: 14px;
  z-index: 6; cursor: pointer; pointer-events: auto; color: #e78b8b; }
/* The fade is on the icon, not the pin: the tooltip is the pin's child and
   inherited it, and a 75% tooltip over keyframes was unreadable. */
#${NOTE_MARKERS_ID} .knm-done { color: #79c98a; }
#${NOTE_MARKERS_ID} .knm-done > .material-icons { opacity: .75; }
#${NOTE_MARKERS_ID} .knm-band { position: absolute; bottom: 1px; height: 3px; border-radius: 2px;
  background: rgba(231,139,139,.55); pointer-events: auto; }
#${NOTE_MARKERS_ID} .knm-band.done { background: rgba(121,201,138,.45); }
#${NOTE_MARKERS_ID} .knm > .material-icons { font-size: 14px; line-height: 1; display: block;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.6)); }
#${NOTE_MARKERS_ID} .knm:hover > .material-icons { transform: translateY(-1px); }
#${NOTE_MARKERS_ID} .knm-n { position: absolute; top: -3px; right: -5px; min-width: 11px; height: 11px;
  padding: 0 2px; border-radius: 6px; background: var(--color-accent); color: var(--color-accent_text);
  font-size: 8px; line-height: 11px; text-align: center; font-weight: 700; }
#${NOTE_MARKERS_ID} .knm-imgs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
#${NOTE_MARKERS_ID} .knm-img { width: 118px; height: auto; border-radius: 3px; cursor: zoom-in;
  border: 1px solid var(--color-border); }
#${NOTE_MARKERS_ID} .knm-img:hover { border-color: var(--color-accent); }
#${NOTE_MARKERS_ID} .knm-pending { margin-top: 3px; font-size: 9.5px; opacity: .55; }
#${NOTE_MARKERS_ID} .knm-tip { display: none; position: fixed; z-index: 60; opacity: 1;
  width: 260px; padding: 7px 9px; border-radius: 4px; background: var(--color-ui);
  border: 1px solid var(--color-border); box-shadow: 0 4px 14px rgba(0,0,0,.45);
  color: var(--color-text); font-size: 11px; line-height: 1.45; white-space: normal;
  text-align: left; cursor: default; }
#${NOTE_MARKERS_ID} .knm:hover .knm-tip { display: block; }
#${NOTE_MARKERS_ID} .knm-head { display: flex; justify-content: space-between; gap: 8px;
  font-variant-numeric: tabular-nums; font-weight: 600; margin-bottom: 4px; }
#${NOTE_MARKERS_ID} .knm-head span { font-weight: 400; opacity: .65; }
#${NOTE_MARKERS_ID} .knm-note { padding: 4px 0; border-top: 1px solid var(--color-border); }
#${NOTE_MARKERS_ID} .knm-who { display: flex; align-items: center; gap: 6px; font-size: 10px; }
#${NOTE_MARKERS_ID} .knm-who span { opacity: .55; font-variant-numeric: tabular-nums; }
#${NOTE_MARKERS_ID} .knm-st { margin-left: auto; font-size: 8.5px; text-transform: uppercase;
  letter-spacing: .04em; padding: 0 4px; border-radius: 3px; opacity: 1; }
#${NOTE_MARKERS_ID} .knm-st.op { background: rgba(208,82,82,.16); color: #e78b8b; }
#${NOTE_MARKERS_ID} .knm-st.ok { background: rgba(90,164,105,.16); color: #79c98a; }
#${NOTE_MARKERS_ID} .knm-text { margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
#${NOTE_MARKERS_ID} .knm-foot { margin-top: 5px; font-size: 9.5px; opacity: .55; }
`;
  function nextMarker(markers, time, dir) {
    if (!markers.length) return null;
    const eps = 1e-4;
    const sorted = [...markers].sort((a, b) => a.time - b.time);
    if (dir > 0) return sorted.find((m) => m.time > time + eps) ?? sorted[0];
    return [...sorted].reverse().find((m) => m.time < time - eps) ?? sorted[sorted.length - 1];
  }
  var hooks = null;
  var installed = false;
  var unwatchers = [];
  var current2 = [];
  var navActions = [];
  function visibleMarkers() {
    return visible ? current2 : [];
  }
  function jumpRelative(dir) {
    const m = nextMarker(visibleMarkers(), Number(Timeline?.time) || 0, dir);
    if (!m || !hooks) return false;
    hooks.jump(m.notes[0].commentId);
    return true;
  }
  function openNoteChecklist() {
    if (!hooks || !currentClip) return;
    openNoteList(visibleMarkers(), currentClip, { jump: hooks.jump, resolve: hooks.resolve, remove: hooks.remove });
  }
  var currentClip = null;
  var lastHtml = "";
  var visible = true;
  var toggle = null;
  var withResolved = true;
  var resolvedToggle = null;
  var currentThreads = null;
  var currentShots = {};
  function notesVisible() {
    return visible;
  }
  function resolvedVisible() {
    return withResolved;
  }
  function setNotesVisible(v) {
    visible = v;
    try {
      if (toggle && !!toggle.value !== v) toggle.set(v);
    } catch {
    }
    reposition();
    hooks?.changed?.();
  }
  function setResolvedVisible(v) {
    withResolved = v;
    try {
      if (resolvedToggle && !!resolvedToggle.value !== v) resolvedToggle.set(v);
    } catch {
    }
    regroup();
    hooks?.changed?.();
  }
  function pinnable(threads, showResolved) {
    return showResolved ? threads : threads.filter((t) => t.status === "open");
  }
  function installNoteMarkers(h) {
    uninstallNoteMarkers();
    installed = true;
    hooks = h;
    visible = true;
    try {
      unwatchers = ["size", "scroll_left", "head_width", "length"].map((k) => Timeline?.vue?.$watch?.(k, () => reposition())).filter((f) => typeof f === "function");
    } catch {
      unwatchers = [];
    }
    try {
      toggle = new Toggle("kumonga_timeline_notes", {
        name: "Review notes",
        description: "Show Kumonga review notes on the timeline",
        icon: "mode_comment",
        category: "animation",
        condition: { modes: ["animate"] },
        default: true,
        onChange(value) {
          visible = !!value;
          reposition();
          hooks?.changed?.();
        }
      });
      if (!toggle.value) toggle.set(true);
      Toolbars?.timeline?.add?.(toggle);
    } catch {
      toggle = null;
    }
    try {
      resolvedToggle = new Toggle("kumonga_timeline_resolved", {
        name: "Resolved notes",
        description: "Show resolved review notes on the timeline as well as open ones",
        icon: "task_alt",
        category: "animation",
        condition: { modes: ["animate"] },
        default: true,
        onChange(value) {
          withResolved = !!value;
          regroup();
          hooks?.changed?.();
        }
      });
      if (!resolvedToggle.value) resolvedToggle.set(true);
      Toolbars?.timeline?.add?.(resolvedToggle);
    } catch {
      resolvedToggle = null;
    }
    try {
      navActions = [
        new Action("kumonga_next_note", {
          name: "Next review note",
          description: "Seek to the next Kumonga note on this clip",
          icon: "navigate_next",
          category: "animation",
          condition: { modes: ["animate"] },
          keybind: new Keybind({ key: 221, alt: true }),
          click: () => {
            jumpRelative(1);
          }
        }),
        new Action("kumonga_prev_note", {
          name: "Previous review note",
          description: "Seek to the previous Kumonga note on this clip",
          icon: "navigate_before",
          category: "animation",
          condition: { modes: ["animate"] },
          keybind: new Keybind({ key: 219, alt: true }),
          click: () => {
            jumpRelative(-1);
          }
        })
      ];
    } catch {
      navActions = [];
    }
  }
  function uninstallNoteMarkers() {
    installed = false;
    for (const a of navActions) {
      try {
        a.delete?.();
      } catch {
      }
    }
    navActions = [];
    for (const u of unwatchers) {
      try {
        u();
      } catch {
      }
    }
    unwatchers = [];
    document.getElementById(NOTE_LANE_ID)?.remove();
    try {
      Toolbars?.timeline?.remove?.(toggle);
    } catch {
    }
    try {
      toggle?.delete?.();
    } catch {
    }
    toggle = null;
    try {
      Toolbars?.timeline?.remove?.(resolvedToggle);
    } catch {
    }
    try {
      resolvedToggle?.delete?.();
    } catch {
    }
    resolvedToggle = null;
    currentThreads = null;
    currentShots = {};
    document.getElementById(NOTE_MARKERS_ID)?.remove();
    hooks = null;
    current2 = [];
    currentClip = null;
    lastHtml = "";
  }
  function updateNoteMarkers(threads, clip, shots2 = {}) {
    currentThreads = threads;
    currentShots = shots2;
    currentClip = clip;
    regroup();
  }
  function regroup() {
    current2 = currentThreads && currentClip ? noteMarkers(pinnable(currentThreads, withResolved), currentClip, currentShots) : [];
    reposition();
  }
  function reposition() {
    if (!installed) return;
    const panel = document.getElementById("panel_timeline");
    let lane = document.getElementById(NOTE_LANE_ID);
    if (!panel) {
      lane?.remove();
      lastHtml = "";
      return;
    }
    if (!lane || lane.parentElement !== panel) {
      lane?.remove();
      lane = document.createElement("div");
      lane.id = NOTE_LANE_ID;
      lane.innerHTML = `<div class="knl-head" title="Review notes on the selected clip"><i class="material-icons">mode_comment</i>Notes</div><div class="knl-track"><div id="${NOTE_MARKERS_ID}"></div></div>`;
      lane.addEventListener("mousedown", onDown);
      lane.addEventListener("click", onClick);
      lane.addEventListener("mouseover", onHover);
      const vueRoot = panel.querySelector(":scope > .panel_vue_wrapper") ?? document.getElementById("timeline_vue")?.parentElement ?? null;
      if (vueRoot && vueRoot.parentElement === panel) panel.insertBefore(lane, vueRoot);
      else panel.appendChild(lane);
      lastHtml = "";
    }
    const data = Timeline?.vue?._data ?? {};
    const size = Number(data.size) || 0;
    const show2 = visible && size > 0 && current2.length > 0;
    lane.classList.toggle("on", show2);
    const host2 = lane.querySelector(`#${NOTE_MARKERS_ID}`);
    const head = lane.querySelector(".knl-head");
    if (!host2 || !head) return;
    if (!show2) {
      host2.innerHTML = "";
      lastHtml = "";
      lastDrawn = null;
      return;
    }
    head.style.width = `${Number(data.head_width) || 144}px`;
    host2.style.left = `${8 - (Number(data.scroll_left) || 0)}px`;
    host2.style.width = `${size * (Number(data.length) || 0)}px`;
    if (lastDrawn && lastDrawn.markers === current2 && lastDrawn.size === size) return;
    const html = renderNoteMarkers(current2, size);
    lastDrawn = { markers: current2, size };
    if (html !== lastHtml) {
      host2.innerHTML = html;
      lastHtml = html;
    }
  }
  var lastDrawn = null;
  function onHover(e) {
    const pin = e.target?.closest?.(".knm");
    const tip = pin?.querySelector(".knm-tip");
    if (!pin || !tip) return;
    const r = pin.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(r.left - 8, window.innerWidth - 272))}px`;
    tip.style.top = `${r.bottom + 2}px`;
  }
  function onDown(e) {
    e.stopPropagation();
  }
  function onClick(e) {
    const target = e.target;
    const pin = target?.closest?.(".knm");
    if (!pin || !hooks) return;
    e.stopPropagation();
    const wantsView = e.shiftKey || !!target?.closest?.(".knm-img");
    if (wantsView) {
      const m = current2.find((x) => x.frame === Number(pin.dataset.frame));
      if (m) openNoteView(m, currentClip ?? "", { jump: hooks.jump, resolve: hooks.resolve, remove: hooks.remove });
      return;
    }
    const id = pin.dataset.comment;
    if (id) hooks.jump(id);
  }

  // src/ui/animlist.ts
  var decorOf = (item, legend) => ({
    status: statusOf(item, legend),
    mark: markClass(item, legend),
    priority: item.priority
  });
  function animationRows(task2, clips) {
    const items = task2.checklist ?? [];
    const report = assessClips(items.map((i) => i.name), clips);
    const present = {};
    const names = {};
    const missing = [];
    for (const item of items) {
      const decor = decorOf(item, task2.checklistFormat);
      if (report.states[item.name] === "present") {
        present[normaliseClip(item.name)] = decor;
        names[normaliseClip(item.name)] = item.name;
      } else missing.push({ ...decor, name: item.name, index: item.index });
    }
    return { present, items: names, extra: report.extra, missing };
  }
  function openNotesFor(rows, clipName, counts) {
    if (!counts) return null;
    const id = rows.items[normaliseClip(clipName)] ?? clipName;
    return counts[targetKey({ kind: "clip", id })] ?? 0;
  }
  function decorFor(rows, clipName) {
    return rows.present[normaliseClip(clipName)] ?? "extra";
  }
  function renderRowChips(decor, notes = null, resolved = null) {
    const count = (notes ? `<span class="kal-notes" title="${notes} open note${notes === 1 ? "" : "s"} on this animation">${notes}</span>` : "") + (resolved ? `<span class="kal-notes ok" title="${resolved} resolved note${resolved === 1 ? "" : "s"} on this animation">&#10003;${resolved}</span>` : "");
    if (decor === "extra") {
      return '<span class="kal">' + count + '<span class="kal-tag" title="No checklist item asks for this animation">Not in list</span></span>';
    }
    return '<span class="kal">' + count + (decor.priority ? priorityGlyph(decor.priority) : '<span class="ipri kal-nopri"></span>') + `<span class="kal-st ${esc(decor.mark)}" title="Checklist state: ${esc(decor.status)}">${esc(decor.status)}</span></span>`;
  }
  function renderGhostRow(row) {
    return `<li class="animation kal-ghost" data-name="${esc(row.name)}" title="On the checklist, not in this file yet"><i class="material-icons">movie</i><label>${esc(row.name)}</label>` + renderRowChips(row) + `<div class="in_list_button kal-add" data-name="${esc(row.name)}" title="Create the animation &quot;${esc(row.name)}&quot;"><i class="material-icons">add</i></div><div class="in_list_button kal-blank"></div></li>`;
  }
  var ANIM_LIST_CSS = `
#animations_list .kal { display: inline-flex; align-items: center; gap: 5px; margin: 0 6px 0 4px;
  flex: none; font-size: 9px; line-height: 1; }
#animations_list .kal-st { padding: 2px 6px; border-radius: 3px; border: 1px solid var(--color-border);
  text-transform: uppercase; letter-spacing: .04em; font-weight: 600; color: var(--color-text);
  white-space: nowrap; }
#animations_list .kal-st.m-todo { opacity: .7; }
#animations_list .kal-st.m-doing { color: #6fb2e8; border-color: #2f5c80; }
#animations_list .kal-st.m-done { color: #79c98a; border-color: #33603d; }
#animations_list .kal-st.m-skip { opacity: .45; text-decoration: line-through; }
#animations_list .kal-st.m-chg { color: #e8b862; border-color: #6b5423; }
#animations_list .kal-st.m-qa { color: #c0a4e8; border-color: #553f70; }
#animations_list .kal-notes { min-width: 14px; padding: 1px 5px; border-radius: 8px; text-align: center;
  background: rgba(208,82,82,.18); color: #e78b8b; font-weight: 700; font-variant-numeric: tabular-nums; }
#animations_list .kal-notes.ok { background: rgba(90,164,105,.16); color: #79c98a; }
#animations_list .kal-tag { padding: 2px 6px; border-radius: 3px; text-transform: uppercase;
  letter-spacing: .04em; font-weight: 600; background: rgba(224,160,48,.16); color: #e0a030;
  white-space: nowrap; }
#animations_list .ipri { display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 14px; border-radius: 3px; font-weight: 600;
  background: var(--color-border); color: var(--color-text); }
#animations_list .ipri.kal-nopri { background: transparent; }
#animations_list .ipri:not(:has(svg)) { width: auto; padding: 1px 6px; font-size: 8px;
  text-transform: uppercase; letter-spacing: .04em; }
#animations_list .ipri svg { width: 10px; height: 10px; fill: none; stroke: currentColor;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
#animations_list .ipri.p-high { background: rgba(208,82,82,.18); color: #e78b8b; }
#animations_list .ipri.p-med { background: rgba(224,160,48,.18); color: #e8b862; }
#animations_list .ipri.p-low { background: rgba(90,140,200,.16); color: #8fb6dd; }
#animations_list .kal-ghost { opacity: .5; cursor: default; }
#animations_list .kal-ghost:hover { opacity: .85; background: none; }
#animations_list .kal-ghost > label { font-style: italic; }
#animations_list .kal-ghost .kal-add { opacity: 1; cursor: pointer; color: var(--color-accent); }
#animations_list .kal-ghost .kal-add:hover { color: var(--color-light); }
#animations_list .kal-ghost .kal-blank { pointer-events: none; }
`;
  var task = null;
  var openNotes = null;
  var resolvedNotes = null;
  var installed2 = false;
  var last = { at: 0, rows: 0, matched: 0, missing: [], ghosts: 0, host: "", error: "" };
  var observer = null;
  var watched = null;
  var applying = false;
  var queued = false;
  var EVENTS = [
    "select_animation",
    "remove_animation",
    "edit_animation_properties",
    "select_project",
    "load_project",
    "select_mode",
    "add_animation"
  ];
  function installAnimationList() {
    uninstallAnimationList();
    installed2 = true;
    for (const name of EVENTS) {
      try {
        Blockbench.on?.(name, schedule);
      } catch {
      }
    }
  }
  function uninstallAnimationList() {
    installed2 = false;
    for (const name of EVENTS) {
      try {
        Blockbench.removeListener?.(name, schedule);
      } catch {
      }
    }
    observer?.disconnect();
    observer = null;
    watched?.removeEventListener("mousedown", onDown2, true);
    watched?.removeEventListener("click", onClick2, true);
    watched = null;
    task = null;
    clear(document.getElementById("animations_list"));
  }
  function updateAnimationList(t, counts = null, resolved = null) {
    task = t;
    openNotes = counts;
    resolvedNotes = resolved;
    apply();
  }
  function schedule() {
    if (queued || !installed2) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  }
  function clear(list) {
    if (!list) return;
    list.querySelectorAll(".kal, .kal-ghost").forEach((el) => el.remove());
  }
  function apply() {
    if (!installed2) return;
    const list = document.getElementById("animations_list");
    if (!list) return;
    if (!observer || watched !== list) {
      observer?.disconnect();
      watched?.removeEventListener("mousedown", onDown2, true);
      watched?.removeEventListener("click", onClick2, true);
      watch(list);
    }
    if (applying) return;
    applying = true;
    try {
      clear(list);
      if (!task?.checklist?.length) return;
      const anims = animationsInProject();
      const rows = animationRows(task, anims.map((a) => a.name));
      const byUuid = new Map(anims.map((a) => [a.uuid, a.name]));
      const lis = Array.from(list.querySelectorAll("li.animation[anim_id]"));
      last = { at: Date.now(), rows: lis.length, matched: 0, missing: rows.missing.map((m) => m.name), ghosts: 0, host: "", error: "" };
      let host2 = null;
      for (const li of lis) {
        const name = byUuid.get(li.getAttribute("anim_id") ?? "");
        if (!name) continue;
        last.matched++;
        host2 = host2 ?? li.parentElement;
        const chips = document.createElement("span");
        chips.innerHTML = renderRowChips(decorFor(rows, name), openNotesFor(rows, name, openNotes), openNotesFor(rows, name, resolvedNotes));
        const first = li.querySelector(".in_list_button");
        li.insertBefore(chips.firstElementChild, first);
      }
      if (!rows.missing.length) return;
      host2 = host2 ?? list.querySelector("li.animation_file > ul") ?? list;
      last.host = host2 === list ? "#animations_list" : `${host2.tagName.toLowerCase()}.${host2.className}`;
      const frag = document.createElement("template");
      frag.innerHTML = rows.missing.map(renderGhostRow).join("");
      host2.appendChild(frag.content);
      last.ghosts = list.querySelectorAll(".kal-ghost").length;
    } catch (e) {
      last.error = String(e?.message || e);
      trace(`animation list: ${e?.message || e}`);
    } finally {
      observer?.takeRecords();
      applying = false;
    }
  }
  function animationListDiagnosis() {
    const list = document.getElementById("animations_list");
    const lines = [
      task ? `Animations panel mirrors ${task.key} (${task.checklist?.length ?? 0} checklist items).` : "Animations panel has no task to mirror \u2014 not an Animation task, or none known.",
      !list ? "The list element (#animations_list) is not in the page." : `The list has ${list.querySelectorAll("li.animation[anim_id]").length} animation rows, ${list.querySelectorAll(".kal").length} chips and ${list.querySelectorAll(".kal-ghost").length} ghost rows right now.`
    ];
    if (last.at) {
      lines.push(`Last pass ${Math.round((Date.now() - last.at) / 1e3)}s ago: ${last.rows} rows seen, ${last.matched} matched to the project's animations; ` + (last.missing.length ? `missing: ${last.missing.join(", ")}; ` : "nothing missing; ") + (last.host ? `ghosts appended to ${last.host} (${last.ghosts} present after).` : "no ghosts appended."));
    } else lines.push("No pass has run yet.");
    if (last.error) lines.push(`Last error: ${last.error}`);
    lines.push(`Observer ${observer ? "attached" : "not attached"}${watched ? watched === list ? " to this list" : " to a stale list" : ""}.`);
    return lines.join("\n");
  }
  function watch(list) {
    observer = new MutationObserver(() => {
      if (!applying) schedule();
    });
    observer.observe(list, { childList: true, subtree: true });
    list.addEventListener("mousedown", onDown2, true);
    list.addEventListener("click", onClick2, true);
    watched = list;
  }
  function onDown2(e) {
    if (e.target?.closest?.(".kal-ghost")) e.stopPropagation();
  }
  function onClick2(e) {
    const target = e.target;
    const add = target?.closest?.(".kal-add");
    if (add) {
      e.stopPropagation();
      e.preventDefault();
      const name = add.dataset.name;
      if (name && !createAnimation(name)) trace(`animation list: could not create "${name}"`);
      schedule();
      return;
    }
    if (target?.closest?.(".kal-ghost")) e.stopPropagation();
  }

  // src/ui/reviewbar.ts
  var REVIEW_BAR_ID = "kumonga_review_bar";
  function reviewBarModel(ctx, live, notesShown = true, resolvedShown = true, pins = 0) {
    if (!ctx || !live || !ctx.lead || !live.clip) return null;
    const task2 = ctx.task;
    const want = normaliseClip(live.clip);
    const item = (task2.checklist ?? []).find((i) => normaliseClip(i.name) === want) ?? null;
    const clipQa = !!item && isQa(statusOf(item, task2.checklistFormat));
    const taskQa = /^(in )?qa$/i.test(task2.status);
    if (!clipQa && !taskQa) return null;
    return {
      taskKey: task2.key,
      clip: live.clip,
      status: clipQa ? statusOf(item, task2.checklistFormat) : task2.status,
      notes: ctx.openNotes ? ctx.openNotes[targetKey({ kind: "clip", id: live.clip })] ?? 0 : null,
      pin: live.pin,
      playing: live.playing,
      speed: live.speed,
      looping: live.looping,
      onion: live.onion,
      ghost: live.ghost,
      notesShown,
      resolvedShown,
      pins
    };
  }
  var icon = (name) => `<i class="material-icons">${name}</i>`;
  function renderReviewBar(m) {
    const speed = (pct) => `<button class="krb-b krb-sp${m.speed === pct ? " on" : ""}" data-act="rb-speed" data-speed="${pct}" title="Play at ${pct}%">${pct}%</button>`;
    const sep = '<span class="krb-sep"></span>';
    return `<span class="krb-tag"><span class="krb-eyebrow">Review</span><span class="krb-key">${esc(m.taskKey)}</span><b class="krb-clip" title="The selected animation">${esc(m.clip)}</b><span class="krb-status" title="Its state on the checklist">${esc(m.status)}</span></span>` + sep + `<span class="krb-group"><button class="krb-b krb-ico" data-act="rb-back" title="Previous frame">${icon("skip_previous")}</button><button class="krb-b krb-ico" data-act="rb-play" title="${m.playing ? "Pause" : "Play"}">` + icon(m.playing ? "pause" : "play_arrow") + `</button><button class="krb-b krb-ico" data-act="rb-forth" title="Next frame">${icon("skip_next")}</button><span class="krb-frame" title="Playhead: frame and seconds">${m.pin ? esc(formatPin(m.pin)) : ""}</span></span>` + sep + '<span class="krb-group krb-speeds" title="Playback speed">' + speed(25) + speed(50) + speed(100) + "</span>" + sep + `<span class="krb-group"><button class="krb-b${m.looping ? " on" : ""}" data-act="rb-loop" title="${m.looping ? "Clear the loop range" : "Loop six frames either side of the playhead"}">${icon("repeat")}<span class="krb-lbl">Loop</span></button><button class="krb-b${m.onion ? " on" : ""}" data-act="rb-onion" title="Blockbench's onion skin">${icon("layers")}<span class="krb-lbl">Onion</span></button><button class="krb-b${m.notesShown ? " on" : ""}" data-act="rb-notesvis" title="${m.notesShown ? "Hide the note pins on the ruler" : "Show the note pins on the ruler"}">${icon("mode_comment")}<span class="krb-lbl">Notes</span></button>` + (m.notesShown ? `<button class="krb-b${m.resolvedShown ? " on" : ""}" data-act="rb-resolvedvis" title="${m.resolvedShown ? "Hide resolved notes \u2014 only what is still open" : "Show resolved notes as well"}">${icon("task_alt")}<span class="krb-lbl">Resolved</span></button>` : "") + (m.ghost ? `<button class="krb-b on" data-act="rb-ghost" title="The pose at ${esc(formatPin(m.ghost))} is ghosted \u2014 click to clear">${icon("person_outline")}<span class="krb-lbl">Ghost ${esc(formatPin(m.ghost))}</span>${icon("close")}</button>` : "") + '</span><span class="krb-spring"></span><span class="krb-group krb-right">' + (m.pins > 0 ? `<button class="krb-b krb-ico" data-act="rb-prevnote" title="Previous note (Alt+[)">${icon("navigate_before")}</button>` : "") + (m.notes !== null && m.notes > 0 ? `<button class="krb-notes" data-act="rb-notelist" title="Every note on this clip \u2014 the review checklist">${icon("chat_bubble_outline")}${m.notes} open note${m.notes === 1 ? "" : "s"}</button>` : m.pins > 0 ? `<button class="krb-notes ok" data-act="rb-notelist" title="Every note on this clip \u2014 the review checklist">${icon("task_alt")}all resolved</button>` : "") + (m.pins > 0 ? `<button class="krb-b krb-ico" data-act="rb-nextnote" title="Next note (Alt+])">${icon("navigate_next")}</button>` : "") + `<button class="krb-b krb-note" data-act="rb-note" data-key="${esc(m.taskKey)}" data-clip="${esc(m.clip)}" title="Leave a note pinned to this frame, with a screenshot">${icon("rate_review")}<span class="krb-lbl">Note here</span></button></span>`;
  }
  var REVIEW_BAR_CSS = `
#${REVIEW_BAR_ID} {
  display: none; align-items: center; flex-wrap: wrap; gap: 3px 6px; flex: none;
  min-height: 28px; padding: 3px 8px; box-sizing: border-box;
  font-size: 11px; line-height: 1; white-space: nowrap;
  background: var(--color-back); border-bottom: 1px solid var(--color-border);
  color: var(--color-text); user-select: none;
  container-type: inline-size;
}
/* Narrow panels: labels go first (every button keeps its tooltip), then the
   task key and the state pill, then the dividers \u2014 the bar wraps into a
   second row only once it is down to icons. Nothing is ever clipped. */
@container (max-width: 820px) {
  #${REVIEW_BAR_ID} .krb-lbl { display: none; }
  #${REVIEW_BAR_ID} .krb-b { padding: 0 5px; }
  #${REVIEW_BAR_ID} .krb-note { padding: 0 6px; }
  #${REVIEW_BAR_ID} .krb-key { display: none; }
}
@container (max-width: 600px) {
  #${REVIEW_BAR_ID} .krb-status, #${REVIEW_BAR_ID} .krb-sep { display: none; }
  #${REVIEW_BAR_ID} .krb-frame { min-width: 0; }
  #${REVIEW_BAR_ID} .krb-eyebrow { display: none; }
}
#${REVIEW_BAR_ID}.on { display: flex; }
#${REVIEW_BAR_ID} > * { flex: none; }
#${REVIEW_BAR_ID} .krb-group { display: inline-flex; align-items: center; gap: 3px; }
#${REVIEW_BAR_ID} .krb-sep { width: 1px; height: 16px; background: var(--color-border); margin: 0 2px; }
#${REVIEW_BAR_ID} .krb-spring { flex: 1 1 0; min-width: 0; }
#${REVIEW_BAR_ID} .krb-right { margin-left: auto; gap: 4px; }

#${REVIEW_BAR_ID} .krb-tag { display: inline-flex; align-items: center; gap: 7px; }
#${REVIEW_BAR_ID} .krb-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; padding: 2px 5px; border-radius: 3px;
  background: var(--color-accent); color: var(--color-accent_text); }
#${REVIEW_BAR_ID} .krb-key { font-size: 10px; opacity: .6; font-variant-numeric: tabular-nums; }
#${REVIEW_BAR_ID} .krb-clip { font-weight: 600; font-size: 11.5px; }
#${REVIEW_BAR_ID} .krb-status { font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
  padding: 1px 5px; border-radius: 3px; background: rgba(224,160,48,.18); color: #e0a030; }

#${REVIEW_BAR_ID} .krb-b { all: unset; box-sizing: border-box; display: inline-flex; align-items: center;
  justify-content: center; gap: 4px; height: 22px; min-width: 22px; padding: 0 7px; margin: 0;
  border-radius: 3px; border: 1px solid transparent; background: var(--color-button);
  color: var(--color-text); cursor: pointer; font: inherit; font-size: 10.5px; line-height: 1;
  white-space: nowrap; }
#${REVIEW_BAR_ID} .krb-b:hover { background: var(--color-selected); }
#${REVIEW_BAR_ID} .krb-b:focus-visible { border-color: var(--color-accent); }
#${REVIEW_BAR_ID} .krb-b.on { background: var(--color-accent); color: var(--color-accent_text); }
#${REVIEW_BAR_ID} .krb-b .material-icons { font-size: 15px; line-height: 1; width: 15px; }
#${REVIEW_BAR_ID} .krb-ico { padding: 0 4px; }
#${REVIEW_BAR_ID} .krb-frame { min-width: 80px; padding: 0 4px; text-align: center;
  font-variant-numeric: tabular-nums; font-size: 11px; opacity: .85; }

#${REVIEW_BAR_ID} .krb-speeds { gap: 0; border-radius: 3px; overflow: hidden;
  border: 1px solid var(--color-border); }
#${REVIEW_BAR_ID} .krb-sp { border-radius: 0; height: 20px; padding: 0 7px; font-size: 10px;
  font-variant-numeric: tabular-nums; }
#${REVIEW_BAR_ID} .krb-sp + .krb-sp { border-left: 1px solid var(--color-border); }

#${REVIEW_BAR_ID} .krb-notes { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px;
  font: inherit; font-size: 10px; padding: 0 7px; height: 20px; border-radius: 10px; cursor: pointer;
  background: rgba(208,82,82,.16); color: #e78b8b; white-space: nowrap; }
#${REVIEW_BAR_ID} .krb-notes:hover { filter: brightness(1.2); }
#${REVIEW_BAR_ID} .krb-notes.ok { background: rgba(90,164,105,.16); color: #79c98a; }
#${REVIEW_BAR_ID} .krb-notes .material-icons { font-size: 13px; }
#${REVIEW_BAR_ID} .krb-note { background: var(--color-accent); color: var(--color-accent_text);
  font-weight: 600; padding: 0 9px; }
#${REVIEW_BAR_ID} .krb-note:hover { filter: brightness(1.12); background: var(--color-accent); }
`;
  var hooks2 = null;
  var lastHtml2 = "";
  var frameTimer = null;
  var EVENTS2 = [
    "select_animation",
    "select_project",
    "load_project",
    "select_mode",
    "timeline_play",
    "timeline_pause",
    "update_selection"
  ];
  function installReviewBar(h) {
    uninstallReviewBar();
    hooks2 = h;
    for (const name of EVENTS2) {
      try {
        Blockbench.on?.(name, onEvent);
      } catch {
      }
    }
    try {
      Blockbench.on?.("display_animation_frame", onFrame);
    } catch {
    }
    installNoteMarkers({
      jump: (commentId) => {
        const task2 = hooks2?.context()?.task;
        if (task2) hooks2?.onJump(task2.key, commentId);
      },
      resolve: (commentId, status) => {
        const task2 = hooks2?.context()?.task;
        return task2 && hooks2 ? hooks2.onResolve(task2.key, commentId, status) : Promise.resolve();
      },
      remove: (commentId) => {
        const task2 = hooks2?.context()?.task;
        return task2 && hooks2 ? hooks2.onDelete(task2.key, commentId) : Promise.resolve(false);
      },
      changed: () => updateReviewBar()
    });
    installAnimationList();
    updateReviewBar();
  }
  function uninstallReviewBar() {
    for (const name of EVENTS2) {
      try {
        Blockbench.removeListener?.(name, onEvent);
      } catch {
      }
    }
    try {
      Blockbench.removeListener?.("display_animation_frame", onFrame);
    } catch {
    }
    if (frameTimer) {
      clearTimeout(frameTimer);
      frameTimer = null;
    }
    uninstallNoteMarkers();
    uninstallAnimationList();
    document.getElementById(REVIEW_BAR_ID)?.remove();
    hooks2 = null;
    lastHtml2 = "";
  }
  function onEvent() {
    updateReviewBar();
  }
  function onFrame() {
    if (frameTimer) return;
    frameTimer = setTimeout(() => {
      frameTimer = null;
      const bar = document.getElementById(REVIEW_BAR_ID);
      if (!bar || !bar.classList.contains("on")) return;
      const live = timelineLive();
      const readout = bar.querySelector(".krb-frame");
      if (readout && live?.pin) readout.textContent = formatPin(live.pin);
    }, 120);
  }
  function updateReviewBar() {
    if (!hooks2) return;
    let model = null;
    try {
      const ctx = hooks2.context();
      const live = timelineLive();
      updateNoteMarkers(ctx?.threads ?? null, live?.clip ?? null, ctx?.shots ?? {});
      model = reviewBarModel(ctx, live, notesVisible(), resolvedVisible(), visibleMarkers().length);
      updateAnimationList(ctx?.clipsTask ? ctx.task : null, ctx?.openNotes ?? null, ctx?.resolvedNotes ?? null);
    } catch (e) {
      trace(`review bar: ${e?.message || e}`);
    }
    const bar = ensureBar();
    if (!bar) return;
    if (!model) {
      bar.classList.remove("on");
      lastHtml2 = "";
      return;
    }
    const html = renderReviewBar(model);
    if (html !== lastHtml2) {
      bar.innerHTML = html;
      lastHtml2 = html;
    }
    bar.classList.add("on");
  }
  function reviewBarDiagnosis(project) {
    const lines = [];
    const live = timelineLive();
    if (!live) return "Blockbench's Timeline or Animation objects are not there \u2014 is this the desktop app in Animate mode?";
    if (!project) lines.push("No project is open in Blockbench.");
    else if (!project.jiraKey) lines.push(`The open project "${project.name}" carries no Jira task key. Link it to the task (Link open file) so it is stamped and saved.`);
    else lines.push(`Open project "${project.name}" is stamped ${project.jiraKey}.`);
    const ctx = hooks2 ? hooks2.context() : null;
    if (!hooks2) lines.push("The bar is not installed \u2014 the plugin did not finish loading.");
    else if (project?.jiraKey && !ctx) lines.push(`Kumonga has not loaded ${project.jiraKey} in any list yet. Open the task's tab (My work, QA, Overview) so it is known.`);
    if (ctx) {
      lines.push(ctx.lead ? `You lead "${ctx.task.component}", so you may review it.` : `You do not lead "${ctx.task.component ?? "(no component)"}" \u2014 the bar is for the component lead.`);
      const clip = live.clip;
      if (!clip) lines.push("No animation is selected in Blockbench.");
      else {
        const item = (ctx.task.checklist ?? []).find((i) => normaliseClip(i.name) === normaliseClip(clip));
        lines.push(item ? `Selected clip "${clip}" is ${statusOf(item, ctx.task.checklistFormat)} on the checklist; the task is ${ctx.task.status}.` : `Selected clip "${clip}" is not on the checklist; the task is ${ctx.task.status}.`);
      }
      lines.push(reviewBarModel(ctx, live) ? "Every condition holds \u2014 the bar should be showing." : "So the bar stays hidden.");
      const threads = ctx.threads;
      if (!threads) lines.push("Feedback for this task has not been fetched yet (or the fetch failed \u2014 see the load report).");
      else {
        const want = live.clip ? targetKey({ kind: "clip", id: live.clip }) : null;
        const clipNotes = threads.filter((t) => t.target?.kind === "clip");
        lines.push(`${threads.length} comment${threads.length === 1 ? "" : "s"} on the task, ${clipNotes.length} of them clip notes${want ? `; pins are drawn for ${want}` : ""}:`);
        for (const t of clipNotes) {
          const key = targetKey(t.target);
          const why = !t.at ? "NO FRAME \u2014 was left without the clip on screen, so it cannot be pinned" : want && key !== want ? `other clip (${key})` : notesVisible() ? "pinned" : "pinned, but pins are hidden";
          lines.push(`  #${t.commentId} "${t.target.id}" ${t.status}${t.at ? " @ " + formatPin(t.at) : ""} \u2014 ${why}`);
        }
      }
    }
    const panel = document.getElementById("panel_timeline");
    const bar = document.getElementById(REVIEW_BAR_ID);
    lines.push(!panel ? "The timeline panel (#panel_timeline) is not in the page \u2014 it only exists in Animate mode." : !bar ? "The bar element has not been created yet." : `The bar element exists${bar.parentElement === panel ? " inside the timeline panel" : " but not inside the timeline panel"} and is ${bar.classList.contains("on") ? "on" : "off"}.`);
    lines.push("", animationListDiagnosis());
    return lines.join("\n");
  }
  function ensureBar() {
    const existing = document.getElementById(REVIEW_BAR_ID);
    const panel = document.getElementById("panel_timeline");
    if (!panel) return existing;
    if (existing && existing.parentElement === panel) return existing;
    existing?.remove();
    const bar = document.createElement("div");
    bar.id = REVIEW_BAR_ID;
    bar.addEventListener("click", onClick3);
    const handle = panel.querySelector(":scope > .panel_handle");
    if (handle?.nextSibling) panel.insertBefore(bar, handle.nextSibling);
    else panel.prepend(bar);
    lastHtml2 = "";
    return bar;
  }
  function onClick3(e) {
    const el = e.target?.closest?.("[data-act]");
    if (!el) return;
    e.stopPropagation();
    switch (el.dataset.act) {
      case "rb-back":
        stepFrame(-1);
        break;
      case "rb-forth":
        stepFrame(1);
        break;
      case "rb-play":
        togglePlay();
        break;
      case "rb-speed":
        setSpeed(Number(el.dataset.speed) || 100);
        break;
      case "rb-loop":
        toggleLoopAround();
        break;
      case "rb-onion":
        toggleOnionSkin();
        break;
      case "rb-ghost":
        ghostAt(null);
        break;
      case "rb-notesvis":
        setNotesVisible(!notesVisible());
        break;
      case "rb-resolvedvis":
        setResolvedVisible(!resolvedVisible());
        break;
      case "rb-prevnote":
        jumpRelative(-1);
        break;
      case "rb-nextnote":
        jumpRelative(1);
        break;
      case "rb-notelist":
        openNoteChecklist();
        break;
      case "rb-note":
        hooks2?.onNote(el.dataset.key ?? "", el.dataset.clip ?? "");
        break;
    }
    updateReviewBar();
  }

  // src/ui/quitdialog.ts
  function repoName(root) {
    const leaf = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
    return leaf.replace(/^EGT[-_]/i, "") || leaf;
  }
  function describeUnpushed(r) {
    const parts = [];
    if (r.ahead > 0) parts.push(`${r.ahead} commit${r.ahead === 1 ? "" : "s"} not pushed`);
    if (r.dirty) parts.push("files not committed");
    if (r.local) parts.push("branch not on origin yet");
    return parts.join(" \xB7 ");
  }
  function renderUnpushed(rows) {
    const cards = rows.map((r, i) => {
      const keys = r.projects.map((p) => `<span class="kq-proj" title="${esc(p.name)}">${esc(p.key)}</span>`).join("");
      return `<div class="kq-repo" data-i="${i}"><div class="kq-head"><b class="kq-name">${esc(repoName(r.root))}</b><span class="kq-branch">${esc(r.branch)}</span>${keys}</div><div class="kq-what">${esc(describeUnpushed(r))}</div><div class="kq-root" title="${esc(r.root)}">${esc(r.root)}</div><button class="kmbtn kq-open" type="button" data-act="desktop" data-i="${i}"` + (r.remote ? "" : ' title="No remote recorded \u2014 opens the folder instead"') + `>${r.remote ? "Open in GitHub Desktop" : "Open folder"}</button></div>`;
    }).join("");
    return `<p class="kmtext">Until this is pushed, nobody else on the team has it, and neither does the backup.</p><div class="kq-list">${cards}</div><p class="kmnote">Kumonga does not commit or push for you \u2014 GitHub Desktop does. Commit and push there, then quit Blockbench.</p><label class="kmcheck"><input type="checkbox"><span>Quit without pushing. I know this work is only on this machine until I push it.</span></label>`;
  }
  var QUIT_DIALOG_CSS = `
.kmbox.kmquit { width:min(560px, calc(100vw - 32px)); max-width:min(560px, calc(100vw - 32px)); }
.kq-list { display:flex; flex-direction:column; gap:8px; margin:10px 0 2px; }
.kq-repo { display:grid; grid-template-columns:1fr auto; grid-template-areas:"head open" "what open" "root open";
  column-gap:12px; row-gap:3px; align-items:center; padding:9px 11px; border-radius:4px;
  background:var(--color-back); border:1px solid var(--color-border); border-left:3px solid #e0a030; }
.kq-head { grid-area:head; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.kq-name { font-size:12.5px; font-weight:700; }
.kq-proj { font-size:9px; font-weight:600; letter-spacing:.04em; padding:1px 5px; border-radius:3px;
  background:var(--color-border); color:var(--color-text); opacity:.75; }
.kq-branch { font-family:var(--font-code, monospace); font-size:11px; opacity:.85; }
.kq-what { grid-area:what; font-size:11.5px; font-weight:600; color:#e8b862; }
.kq-root { grid-area:root; font-size:9.5px; opacity:.5; font-family:var(--font-code, monospace);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; direction:rtl; text-align:left; }
.kq-open { grid-area:open; white-space:nowrap; }
.kmbtn.danger { background:rgba(208,82,82,.22); color:#e78b8b; }
.kmbtn.danger:hover:not(:disabled) { background:#c94a4a; color:#fff; filter:none; }
.kmbtn:disabled { opacity:.4; cursor:default; filter:none; }
.kmbtn:disabled:hover { background:var(--color-button); color:var(--color-text); }
`;
  var title = (n) => `Work on ${n} ${n === 1 ? "repository" : "repositories"} has not been pushed`;
  function openQuitDialog(rows, hooks3) {
    let current3 = rows;
    const s = shell(document, title(rows.length), ["Don't quit", "Check again", "Quit anyway"]);
    s.overlay.querySelector(".kmbox")?.classList.add("kmquit");
    const heading = s.overlay.querySelector(".kmtitle");
    const [stay, again, quit] = Array.from(s.overlay.querySelectorAll(".kmfoot .kmbtn"));
    quit.classList.remove("primary");
    quit.classList.add("danger");
    again.classList.add("primary");
    let acknowledged = false;
    const paint = () => {
      s.body.innerHTML = renderUnpushed(current3);
      if (heading) heading.textContent = title(current3.length);
      const box = s.body.querySelector('input[type="checkbox"]');
      box.checked = acknowledged;
      quit.disabled = !acknowledged;
      box.addEventListener("change", () => {
        acknowledged = box.checked;
        quit.disabled = !acknowledged;
      });
    };
    paint();
    stay.addEventListener("click", () => s.done("stay"));
    quit.addEventListener("click", () => {
      if (acknowledged) s.done("quit");
    });
    again.addEventListener("click", async () => {
      again.disabled = true;
      again.textContent = "Checking\u2026";
      try {
        const fresh = await hooks3.recheck();
        if (!fresh.length) {
          s.done("quit");
          return;
        }
        current3 = fresh;
        paint();
      } finally {
        again.disabled = false;
        again.textContent = "Check again";
      }
    });
    s.body.addEventListener("click", (e) => {
      const b = e.target.closest('[data-act="desktop"]');
      if (!b) return;
      const r = current3[Number(b.dataset.i)];
      if (r) hooks3.openDesktop(r);
    });
    again.focus();
    return s.promise.then((v) => v === "quit" ? "quit" : "stay");
  }

  // src/ui/note.ts
  async function askNote(kind, subject, opts = { canShoot: false }) {
    const where = (kind !== "clip" ? "" : opts.pin ? ` Pinned to ${opts.pin} \u2014 move the playhead first if it should be elsewhere.` + (opts.range ? ` The loop range ${opts.range} is saved with it; clear the range in Blockbench if the note is about one frame.` : "") : " Open this clip in Blockbench first to pin the note to a frame.") + (opts.canShoot ? " The camera view is saved with the note." : "");
    const answer = await chooseTextAndSelect({
      title: `Feedback on ${subject}`,
      note: `This posts a Jira comment tagged to this ${kind}, so it reaches the artist in Jira as well as here.` + (kind === "clip" ? " The clip goes back to Needs Changes." : "") + where,
      textLabel: "What needs changing?",
      textValue: "",
      textPlaceholder: "The foot slides on the third step.",
      multiline: true,
      selectLabel: "Screenshot",
      options: opts.canShoot ? [
        { value: "shot", label: "attach the viewport as it is now" },
        { value: "draw", label: "attach the viewport, after cropping or drawing on it" },
        { value: "none", label: "none" }
      ] : [{ value: "none", label: "none \u2014 open the model in Blockbench to attach the viewport" }],
      value: opts.canShoot ? "shot" : "none",
      confirmLabel: "Post feedback",
      validate: (text) => text.trim() ? null : "Say what needs changing \u2014 an empty note blocks the re-review and tells nobody anything."
    });
    return answer ? { text: answer.text.trim(), shot: answer.value === "draw" ? "draw" : answer.value === "shot" ? "shot" : "none" } : null;
  }
  async function askReply(quoting) {
    const short = quoting.length > 220 ? quoting.slice(0, 220) + "\u2026" : quoting;
    const answer = await chooseTextAndSelect({
      title: "Reply",
      // Plain text: the modal escapes its note itself, and escaping here as well
      // showed a quoted `&` as `&amp;`.
      note: short ? `Answering: \u201C${short}\u201D` : "Answering this feedback.",
      textLabel: "Reply",
      textValue: "",
      textPlaceholder: "Fixed \u2014 the contact frame was two off.",
      multiline: true,
      selectLabel: "Post as",
      options: [{ value: "comment", label: "a Jira comment" }],
      value: "comment",
      confirmLabel: "Reply",
      validate: (text) => text.trim() ? null : "A reply needs something in it."
    });
    return answer ? answer.text.trim() : null;
  }

  // src/clockwork/client.ts
  var BASE = "https://api.clockwork.report/v1";
  var K_TOKEN = "clockwork_api_token";
  var TOKEN_PATH = "/jira/apps/2f4dbb6a-b1b8-4824-94b1-42a64e507a09/725dad32-d2c5-4b58-a141-a093d70c8d34/api-tokens";
  function tokenPageUrl(siteUrl) {
    const base = (siteUrl || "https://embodygames.atlassian.net").replace(/\/+$/, "");
    return base + TOKEN_PATH;
  }
  function clockworkToken() {
    try {
      return vault.get(K_TOKEN);
    } catch {
      return null;
    }
  }
  function setClockworkToken(token) {
    vault.set(K_TOKEN, token.trim());
  }
  function clearClockworkToken() {
    vault.delete(K_TOKEN);
  }
  function hasClockwork() {
    return !!clockworkToken();
  }
  async function probeToken(token) {
    const day = /* @__PURE__ */ new Date();
    const p = (n) => String(n).padStart(2, "0");
    const today = `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
    try {
      const res = await requestWithRetry(
        `${BASE}/worklogs${buildQuery({ starting_at: today, ending_at: today })}`,
        { headers: { Authorization: `Token ${token.trim()}` } },
        2
      );
      if (res.status === 401 || res.status === 403) return "refused";
      return res.ok ? "ok" : "unreachable";
    } catch {
      return "unreachable";
    }
  }
  var NoClockworkToken = class extends Error {
    constructor() {
      super("No Clockwork token. Add one from the Kumonga menu to use timers.");
      this.name = "NoClockworkToken";
    }
  };
  async function clockwork(path, opts = {}) {
    const token = clockworkToken();
    if (!token) throw new NoClockworkToken();
    const query = buildQuery(opts.query);
    const res = await requestWithRetry(`${BASE}${path}${query}`, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers: { Authorization: `Token ${token}` }
    }, opts.attempts);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Clockwork rejected the token. Check it is current and has Clockwork Timesheets Access, then paste it again."
      );
    }
    if (!res.ok) throw new Error(errorMessage(res));
    return res.json;
  }
  function buildQuery(params) {
    if (!params) return "";
    const parts = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === void 0) continue;
      if (Array.isArray(value)) {
        for (const v of value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    }
    return parts.length ? `?${parts.join("&")}` : "";
  }

  // src/clockwork/timers.ts
  function parseStopMessages(json) {
    const messages = Array.isArray(json?.messages) ? json.messages : [];
    const out = [];
    for (const raw of messages) {
      const text = typeof raw === "string" ? raw : String(raw?.message ?? raw?.text ?? "");
      if (!text) continue;
      if (!/stop|logged|saved/i.test(text)) continue;
      const key = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(text);
      out.push({ issueKey: key ? key[1] : null, message: text.trim() });
    }
    return out;
  }
  async function startTimer(issueKey, runningFor) {
    const json = await clockwork("/start_timer", {
      method: "POST",
      body: runningFor ? { issue_key: issueKey, running_for: runningFor } : { issue_key: issueKey },
      attempts: 1
    });
    return { stopped: parseStopMessages(json) };
  }
  async function stopClockworkTimer(issueKey, runningFor) {
    await clockwork("/stop_timer", {
      method: "POST",
      body: runningFor ? { issue_key: issueKey, running_for: runningFor } : { issue_key: issueKey },
      attempts: 1
    });
  }
  var worklogsPath = (issueKey) => `/rest/api/3/issue/${issueKey}/worklog`;
  async function listJiraWorklogs(issueKey) {
    const json = await api(worklogsPath(issueKey));
    const rows = json?.worklogs ?? [];
    return rows.map((w) => ({
      id: String(w.id ?? ""),
      authorId: String(w.author?.accountId ?? ""),
      started: String(w.started ?? ""),
      created: String(w.created ?? ""),
      seconds: Number(w.timeSpentSeconds ?? 0),
      comment: w.comment ? adfToText(w.comment) : ""
    }));
  }
  function pickNewWorklog(rows, accountId, before) {
    if (!before && !accountId) return null;
    const candidates = rows.filter((w) => w.id && (!before || !before.has(w.id)) && (!accountId || w.authorId === accountId));
    if (!candidates.length) return null;
    const stamp = (w) => w.created || w.started;
    return candidates.reduce((a, b) => stamp(b) > stamp(a) ? b : a);
  }
  async function snapshotWorklogIds(issueKey) {
    try {
      return new Set((await listJiraWorklogs(issueKey)).map((w) => w.id));
    } catch {
      return null;
    }
  }
  async function findNewWorklog(issueKey, accountId, before) {
    if (!before && !accountId) {
      return {
        worklog: null,
        failed: `Could not tell which worklog on ${issueKey} the timer created \u2014 the list could not be read before stopping and your account is unknown.`
      };
    }
    let failed = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await pause(750);
      try {
        const worklog = pickNewWorklog(await listJiraWorklogs(issueKey), accountId, before);
        if (worklog) return { worklog, failed: null };
      } catch (e) {
        failed = String(e?.message || e);
      }
    }
    return { worklog: null, failed };
  }
  async function stopTimer(issueKey, description, accountId, runningFor) {
    const before = description.trim() ? await snapshotWorklogIds(issueKey) : null;
    await stopClockworkTimer(issueKey, runningFor);
    if (!description.trim()) return { described: true };
    const { worklog, failed } = await findNewWorklog(issueKey, accountId, before);
    if (!worklog) {
      return {
        described: false,
        reason: failed ?? `No worklog appeared on ${issueKey} within a second and a half of stopping. Clockwork may have logged it against a different account.`
      };
    }
    try {
      await updateWorklog(issueKey, worklog.id, { comment: description });
      return { described: true, worklogId: worklog.id, seconds: worklog.seconds };
    } catch (e) {
      return { described: false, reason: String(e?.message || e), worklogId: worklog.id, seconds: worklog.seconds };
    }
  }
  var pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function logWork(issueKey, seconds, started, comment) {
    await api(worklogsPath(issueKey), {
      method: "POST",
      body: {
        timeSpentSeconds: Math.round(seconds),
        started: jiraInstant(started),
        ...comment.trim() ? { comment: adf(comment) } : {}
      },
      attempts: 1
    });
  }
  function jiraInstant(d) {
    const p = (n, w = 2) => String(Math.abs(n)).padStart(w, "0");
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${sign}${p(Math.floor(Math.abs(offset) / 60))}${p(Math.abs(offset) % 60)}`;
  }
  function adf(text) {
    return {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }]
    };
  }
  async function listWorklogs(q) {
    const json = await clockwork("/worklogs", {
      query: {
        starting_at: q.from,
        ending_at: q.to,
        account_id: q.accountId,
        "project_keys[]": q.projectKeys,
        // Without this the response carries only `issue.id` and
        // `author.accountId` — no issue key, no comment, no name. The panel
        // needs all three, and asking for them is the difference between a
        // populated timesheet and an empty one.
        expand: "issues,worklogs,authors"
      }
    });
    return parseWorklogs(json);
  }
  function parseWorklogs(json) {
    const rows = Array.isArray(json) ? json : json?.worklogs ?? json?.data ?? json?.results ?? [];
    const out = [];
    for (const r of rows) {
      if (!r) continue;
      const key = r.issue_key ?? r.issueKey ?? r.issue?.key;
      const id = r.issue?.id ?? r.issue_id ?? r.issueId;
      const label = key ?? (id != null ? String(id) : null);
      const seconds = Number(
        r.timeSpentSeconds ?? r.time_spent_seconds ?? r.seconds ?? r.duration ?? NaN
      );
      if (!label || !Number.isFinite(seconds)) continue;
      out.push({
        id: String(r.id ?? r.worklog_id ?? ""),
        issueKey: String(label),
        seconds,
        started: String(r.started ?? r.started_at ?? r.date ?? ""),
        comment: String(r.comment ?? r.description ?? ""),
        author: String(
          r.author?.displayName ?? r.author?.display_name ?? r.author_name ?? ""
        ),
        authorId: String(
          r.author?.accountId ?? r.author?.account_id ?? r.account_id ?? ""
        )
      });
    }
    return out;
  }
  async function abandonTimer(issueKey, accountId, runningFor) {
    const before = await snapshotWorklogIds(issueKey);
    await stopClockworkTimer(issueKey, runningFor);
    const { worklog, failed } = await findNewWorklog(issueKey, accountId, before);
    if (!worklog) {
      return {
        deleted: false,
        seconds: 0,
        reason: failed ?? `No worklog appeared on ${issueKey} to remove. It may not have been created.`
      };
    }
    try {
      await deleteWorklog(issueKey, worklog.id);
    } catch (e) {
      return { deleted: false, seconds: worklog.seconds, reason: String(e?.message || e) };
    }
    return { deleted: true, seconds: worklog.seconds };
  }
  var worklogPath = (issueKey, worklogId) => `${worklogsPath(issueKey)}/${worklogId}`;
  async function updateWorklog(issueKey, worklogId, change) {
    const body = {};
    if (typeof change.seconds === "number") body.timeSpentSeconds = Math.round(change.seconds);
    if (typeof change.comment === "string") body.comment = adf(change.comment);
    if (!Object.keys(body).length) return;
    await api(worklogPath(issueKey, worklogId), { method: "PUT", body });
  }
  async function deleteWorklog(issueKey, worklogId) {
    await api(worklogPath(issueKey, worklogId), { method: "DELETE" });
  }

  // src/model/itemtime.ts
  function itemSeconds(names, entries) {
    const folded = names.map((name) => ({ name, key: foldName(name) })).filter((n) => n.key).sort((a, b) => b.key.length - a.key.length);
    const out = {};
    for (const e of entries) {
      const text = foldName(e.comment);
      if (!text || !(e.seconds > 0)) continue;
      const hit = folded.find((n) => text.startsWith(n.key) && boundary(text, n.key.length));
      if (hit) out[hit.name] = (out[hit.name] ?? 0) + e.seconds;
    }
    return out;
  }
  function boundary(text, at) {
    return at >= text.length || !/[\p{L}\p{N}]/u.test(text[at]);
  }

  // src/ui/styles.ts
  var TITLEBAR_CSS = `
.wbar { display:flex; align-items:center; height:30px; flex:none;
  background:var(--color-frame, var(--color-ui)); color:var(--color-text);
  border-bottom:1px solid var(--color-border);
  -webkit-app-region: drag; user-select:none; }
.wbar .wtitle { font-size:12px; padding-left:11px; opacity:.85; }
.wbar .wbtns { margin-left:auto; display:flex; height:100%; -webkit-app-region: no-drag; }
.wbar .wbtn { width:44px; height:100%; display:flex; align-items:center;
  justify-content:center; cursor:pointer; background:none; border:none;
  color:var(--color-text); font-size:13px; line-height:1; padding:0; }
.wbar .wbtn:hover { background:var(--color-hover); }
.wbar .wbtn.close:hover { background:#c4302b; color:#fff; }
html,body { height:100%; }
body { display:flex; flex-direction:column; }
body > .embody { flex:1; min-height:0; overflow:auto; }
`;
  var PANEL_CSS = `
.embody { font-size: 12px; color: var(--color-text); }
.embody * { box-sizing: border-box; }

/* Blockbench styles every <button> with a height and a min-width meant for its
   own toolbars \u2014 roughly 30px tall and 100px wide. Ours are inline, a few
   pixels tall, and sit in rows beside a path, so that sizing makes them
   enormous. Every rule below sets padding and font-size but none unset height
   and min-width, which is why chips, footer buttons and row buttons have each
   been "unnecessarily large" in turn.

   Reset once, here. Rules with more classes \u2014 the toolbar's, for instance \u2014
   still win where a fixed height is actually wanted. */
.embody button { height:auto; min-width:0; width:auto; box-shadow:none; }

.embody .bar { display:flex; align-items:center; gap:4px; padding:5px 6px;
  border-bottom:1px solid var(--color-border); position:sticky; top:0;
  background:var(--color-ui); z-index:2; }
/* Blockbench's own sheets are cloned into the detached window and some of their
   select/button rules outrank ours, which turned the client picker into blue
   underlined text. Reset the inherited look explicitly rather than hoping to
   win on specificity \u2014 appearance and text-decoration are the two that bite. */
.embody .bar select,
.embody .bar select:focus {
  flex:0 1 auto; max-width:46%; min-width:70px;
  -webkit-appearance:none; appearance:none;
  background:var(--color-back) !important; color:var(--color-text) !important;
  border:1px solid var(--color-border) !important; border-radius:3px !important;
  height:22px; padding:0 18px 0 6px; font-size:11px; cursor:pointer;
  text-decoration:none !important; outline:none; box-shadow:none;
  background-image:linear-gradient(45deg,transparent 50%,var(--color-text) 50%),
                   linear-gradient(135deg,var(--color-text) 50%,transparent 50%) !important;
  background-position:calc(100% - 11px) 10px, calc(100% - 7px) 10px !important;
  background-size:4px 4px, 4px 4px !important;
  background-repeat:no-repeat !important;
}
.embody .bar select:hover { border-color:var(--color-accent) !important; }
.embody .bar select option { background:var(--color-back); color:var(--color-text); }

.embody .bar button {
  background:transparent !important; color:var(--color-text) !important;
  border:1px solid var(--color-border) !important; border-radius:3px !important;
  height:22px; padding:0 9px; cursor:pointer; font-size:11px; line-height:1;
  text-decoration:none !important; box-shadow:none !important; min-width:0;
  font-family:inherit;
}
.embody .bar button:hover { background:var(--color-accent) !important;
  color:var(--color-accent_text) !important; border-color:var(--color-accent) !important; }
.embody .stamp { opacity:.45; font-size:10px; white-space:nowrap;
  margin-left:auto; font-variant-numeric:tabular-nums; }

.embody .lane { display:flex; align-items:center; gap:6px; padding:7px 8px 5px;
  cursor:pointer; user-select:none; letter-spacing:.08em; }
.embody .lane:hover { background:var(--color-hover); }
.embody .ltw { opacity:.5; font-size:9px; width:9px; }
.embody .ldot { width:5px; height:5px; border-radius:50%; background:var(--color-text);
  opacity:.75; flex:none; }
.embody .ldot.s-Blocked { background:#c77dd6; }
.embody .ldot.s-NeedsChanges { background:#e05c5c; }
.embody .ldot.s-InProgress { background:#3e90ff; }
.embody .ldot.s-QA { background:#e0a030; }
.embody .ldot.s-Backlog { background:#4a515b; }
.embody .ldot.s-Needsacomponent { background:#e0a030;
  box-shadow:0 0 0 3px rgba(224,160,48,.18); }
.embody .lname { font-size:10px; font-weight:600; opacity:.75; }
.embody .lcnt { font-size:10px; opacity:.55; background:var(--color-back);
  border-radius:8px; padding:0 5px; }
.embody .lbadge { font-size:9px; border-radius:7px; padding:0 5px; }
.embody .lbadge.over { background:#d05252; color:#fff; }
.embody .lbadge.fb { background:#9a6fd0; color:#fff; }

.embody .task { margin:0 8px 6px; border:1px solid var(--color-border);
  border-radius:4px; overflow:hidden; transition:opacity .13s; }
.embody .task.low { opacity:.72; }
.embody .task.lowest { opacity:.45; }
.embody .task.low:hover, .embody .task.lowest:hover, .embody .task.sel { opacity:1; }
.embody .task.gated { border-color:#6b4d1c; }
.embody .task.blk { border-color:#57376b; }
.embody .task.ready { border-color:#3d6b40; }
.embody .task.sel { border-color:var(--color-accent); }

.embody .thead { display:flex; gap:7px; align-items:flex-start;
  padding:7px 9px 7px 8px; cursor:pointer; background:var(--color-ui); }
.embody .thead:hover { background:var(--color-hover); }
/* 3px accent + 5px padding keeps the text on the same x as an unaccented row. */
.embody .thead.gated { border-left:3px solid #e0a030; padding-left:5px; }
.embody .thead.blk { border-left:3px solid #c77dd6; padding-left:5px; }
.embody .thead.chg { border-left:3px solid #e05c5c; padding-left:5px; }
.embody .thead.qa { border-left:3px solid #e0a030; padding-left:5px; }
.embody .thead.ready { border-left:3px solid #5cb85c; padding-left:5px; }
/* Last, so an expanded card shows the accent whatever its status. */
.embody .thead.sel { border-left:3px solid var(--color-accent); padding-left:5px;
  background:var(--color-selected); }
.embody .tw { opacity:.45; font-size:8px; flex:0 0 9px; padding-top:2px; }
.embody .tbody { flex:1; min-width:0; }

.embody .crumb { font-size:10px; opacity:.5; margin-bottom:1px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.embody .crumb .ep { color:#9b7fd4; opacity:1; }
.embody .trow { display:flex; align-items:center; gap:6px; }
.embody .tkey { font-size:10px; opacity:.6; flex:none; }
.embody .tname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.embody .prog { font-size:10px; opacity:.6; flex:none; }
.embody .prog.all { color:#5aa469; opacity:1; }

.embody .tmeta { display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;
  align-items:center; }
.embody .chip { font-size:9px; border-radius:3px; padding:1px 5px;
  background:var(--color-back); opacity:.85; }
.embody .chip.comp { background:#2a3340; color:#8fb3d9; opacity:1; }
.embody .chip.notag { background:#4a3418; color:#e0a030; opacity:1; }
.embody .chip.off { opacity:.5; }
/* An open question, not a warning: it needs answering, but nothing is wrong. */
.embody .chip.ask { background:rgba(63,143,208,.18); color:#8fb3d9; opacity:1;
  border:0; height:auto; min-width:0; font:inherit; font-size:9px; cursor:pointer; }
.embody .chip.ask:hover { background:rgba(63,143,208,.35); color:#fff; }
.embody .urgent { font-size:9px; border-radius:3px; padding:1px 5px;
  background:#d05252; color:#fff; font-weight:600; }
.embody .high { font-size:9px; border-radius:3px; padding:1px 5px;
  background:#d08a3a; color:#fff; }
.embody .due { font-size:9px; border-radius:3px; padding:1px 5px; }
.embody .due.over { background:#d05252; color:#fff; }
.embody .due.today { color:#d08a3a; border:1px solid #d08a3a; }
.embody .due.soon { color:#d08a3a; opacity:.8; }
.embody .due.later { opacity:.45; }
.embody .thours { font-size:9px; opacity:.45; margin-left:auto; }

.embody .items { padding:2px 8px 7px 22px; }
.embody .item { display:flex; gap:6px; padding:2px 0; font-size:11px; }
.embody .item .mk { width:10px; opacity:.6; flex:none; text-align:center; }
.embody .item.done .tx { opacity:.45; text-decoration:line-through; }
.embody .nochk { display:flex; align-items:center; gap:8px; padding:7px 10px;
  font-size:10px; opacity:.6; border-top:1px solid var(--color-border); }

.embody .gate { padding:12px 12px 13px; text-align:center;
  background:rgba(224,160,48,.10); border-top:1px solid #3a301c; }
.embody .gate .gt { font-size:11.5px; font-weight:600; color:#f0b849;
  margin-bottom:5px; }
.embody .gate .gb { font-size:10px; color:#b39a6a; line-height:1.55;
  max-width:290px; margin:0 auto 11px; }
.embody .gate .ib { display:inline-block; margin-left:0; }

.embody .filterbar { display:flex; align-items:center; gap:8px; padding:7px 8px;
  border-top:1px solid var(--color-border); font-size:10px; opacity:.75; }
.embody .filterbar button { margin-left:auto; background:var(--color-button);
  color:var(--color-text); border:none; border-radius:3px; padding:2px 7px;
  cursor:pointer; font-size:10px; }

.embody .notice { display:flex; align-items:center; gap:8px; margin:6px 8px;
  padding:7px 9px; border-radius:4px; font-size:10px; line-height:1.5;
  background:var(--color-back); border:1px solid var(--color-border); }
.embody .notice button { margin-left:auto; flex:none; background:transparent;
  color:var(--color-text); border:1px solid var(--color-border);
  border-radius:3px; padding:2px 8px; cursor:pointer; font-size:10px; }
.embody .notice button:hover { background:var(--color-accent);
  color:var(--color-accent_text); border-color:var(--color-accent); }
/* Sign-in extras: the row of small actions under the wait, and the numbered
   Clockwork steps. */
.embody .si-row { display:flex; gap:8px; justify-content:center; margin-top:10px; }
.embody .si-row .ib { margin-left:0; }
/* Each step is a centred column \u2014 number, button, note \u2014 on the same axis as
   the title above it. A left-aligned two-column grid here read as a different
   screen bolted under a centred one. */
.embody .si-step { display:flex; flex-direction:column; align-items:center; gap:7px;
  text-align:center; margin-top:14px; max-width:360px; }
.embody .si-step .si-num { width:20px; height:20px; border-radius:50%; font-size:10px;
  font-weight:700; line-height:20px; text-align:center;
  background:var(--color-back); border:1px solid var(--color-border); opacity:.8; }
.embody .si-step .si-btn { margin:0; }
.embody .si-step .si-note { margin:0; text-align:center; }
.embody .empty { padding:34px 18px; text-align:center; opacity:.65; }
/* A word in the empty state that opens its own dialog. A link, not a button:
   it is part of the sentence. */
.embody .empty .lnk, .embody .fbline .lnk { background:none; border:0; padding:0; margin:0;
  height:auto; min-width:0;
  font:inherit; color:var(--color-accent); text-decoration:underline; cursor:pointer; }
/* Open feedback, headlined at the top of the open card with the way to it. */
.embody .fbline { display:flex; gap:6px; align-items:center; padding:6px 10px;
  font-size:10px; color:#f0c877; background:rgba(224,160,48,.10);
  border-bottom:1px solid rgba(224,160,48,.3); }
.embody .csqa { display:block; flex:1 0 100%; margin:6px 0 0; }
.embody .empty .big { font-size:13px; margin-bottom:4px; }
.embody .empty .small { font-size:10px; opacity:.75; line-height:1.5; }
.embody .err { margin:8px; padding:8px 10px; border-radius:4px; font-size:11px;
  background:rgba(208,82,82,.15); border:1px solid rgba(208,82,82,.5); line-height:1.5; }
`;
  var FILE_CSS = `
.embody .item { align-items:center; }
.embody .fchip { margin-left:auto; font-size:9px; border-radius:3px; padding:1px 5px;
  background:var(--color-back); display:inline-flex; align-items:center; gap:4px;
  max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.embody .fchip + .fchip { margin-left:4px; }
.embody .fchip em { font-style:normal; opacity:.9; }
.embody .fchip .fv { opacity:.55; }
.embody .fchip .fn { opacity:.45; }
.embody .fchip.ok { opacity:.7; }
.embody .fchip.moved { background:rgba(208,138,58,.22); }
.embody .fchip.moved em { color:#e0a45c; }
.embody .fchip.missing { background:rgba(208,82,82,.22); }
.embody .fchip.missing em { color:#e07a7a; }
.embody .fchip.unpulled { background:rgba(63,143,208,.22); }
.embody .fchip.unpulled em { color:#7ab4e0; }
.embody .fchip.unlinked { opacity:.4; }
.embody .item.f-missing .tx { color:#e07a7a; }
.embody .item.f-moved .tx { color:#e0a45c; }
`;
  var INLINE_BTN_CSS = `
.embody .ib { margin-left:6px; flex:none; font-size:9px; line-height:1;
  padding:2px 6px; border-radius:3px; cursor:pointer;
  background:transparent; color:var(--color-text);
  border:1px solid var(--color-border); }
.embody .ib:hover { background:var(--color-accent); color:var(--color-accent_text);
  border-color:var(--color-accent); }
`;
  var REVEAL_CSS = `
.embody .fchip.rv { cursor:pointer; }
.embody .fchip.rv:hover { outline:1px solid var(--color-accent); }
`;
  var TABS_CSS = `
.embody .tabs { display:flex; gap:2px; padding:4px 6px 0;
  border-bottom:1px solid var(--color-border); }
.embody .tabs .tab { display:flex; align-items:center; gap:5px;
  background:transparent; border:none; border-bottom:2px solid transparent;
  color:var(--color-text); opacity:.6; cursor:pointer;
  font-size:11px; padding:4px 9px 5px; }
.embody .tabs .tab:hover { opacity:.9; }
.embody .tabs .tab.on { opacity:1; border-bottom-color:var(--color-accent); }
.embody .lane.static { cursor:default; }
.embody .lane.static:hover { background:none; }
`;
  var GUESS_CSS = `
.embody .fchip.guess { background:rgba(63,143,208,.16); opacity:.9; }
.embody .fchip.guess em { font-style:normal; opacity:.65; }

.embody .sugg { margin-left:auto; display:flex; align-items:center; gap:4px;
  flex:0 1 auto; min-width:0; overflow-x:auto; scrollbar-width:thin;
  padding-bottom:1px; }
.embody .sugg .fchip { margin-left:0; flex:0 0 auto; max-width:190px; }
/* Under the "add another model" row, the guesses wrap on lines of their own
   instead of scrolling inside the row beside three buttons. */
.embody .isugg { padding:0 10px 7px 29px; }
.embody .isugg .sugg { margin-left:0; flex-wrap:wrap; overflow:visible; row-gap:4px; }
`;
  var STRUCT_CSS = `
.embody .fchip.struct { background:transparent; border:1px dashed var(--color-border); }
.embody .fchip.struct em { opacity:.8; }
`;
  var DIM_BTN_CSS = `
.embody .ib.dim { opacity:.5; padding:2px 5px; border-color:transparent; }
.embody .ib.dim:hover { opacity:1; }
`;
  var ITEM_CSS = `
.embody .items { padding:0; }
.embody .item { display:flex; align-items:center; gap:8px; padding:6px 10px;
  border-top:1px solid var(--color-border); font-size:11px; }
.embody .item:hover { background:var(--color-hover); }
.embody .item.alert { background:rgba(208,138,58,.10); }
.embody .item.miss { background:rgba(208,82,82,.10); }

.embody .mark { font-family:var(--font-code, monospace); font-size:11px;
  width:11px; flex:0 0 11px; text-align:center; }
.embody .m-todo { opacity:.45; }
.embody .m-doing { color:#3f8fd0; }
.embody .m-done { color:#5aa469; }
.embody .m-skip { opacity:.35; }
.embody .m-free { color:#7ab4e0; font-size:8px; }
.embody .m-add { opacity:.45; font-size:11px; }

.embody .iname { flex:0 0 96px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* On a row with no path beside it the name takes the slack, instead of being
   clipped at 96px while half the row sits empty. */
.embody .iname.grow { flex:1 1 auto; min-width:0; }

/* An item's priority, in a column between the state and the name, and its due
   date in one at the far end. Each column exists only on a checklist where
   something fills it (.items.wpri, .items.wmeta), so nothing is indented to
   make room for an empty one; on a list that has one, every row keeps the
   slot so the names start on one line. */
.embody .ipsl { display:none; }
.embody .items.wpri .ipsl { display:inline-flex; flex:0 0 16px; justify-content:center; }
.embody .imeta { display:none; }
.embody .items.wmeta .imeta { display:flex; align-items:center; justify-content:flex-end;
  gap:5px; flex:0 0 72px; font-size:9px; }
.embody .ipri { display:inline-flex; align-items:center; justify-content:center;
  width:16px; height:14px; padding:0; border-radius:3px; font-weight:600;
  background:var(--color-border); color:var(--color-text); }
/* A value the glyph table does not know falls back to its word. */
.embody .ipri:not(:has(svg)) { width:auto; padding:1px 6px; font-size:8px;
  text-transform:uppercase; letter-spacing:.04em; }
.embody .ipri svg { width:10px; height:10px; fill:none; stroke:currentColor;
  stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
/* By level, so a column of them reads at a glance. */
.embody .ipri.p-high { background:rgba(208,82,82,.18); color:#e78b8b; }
.embody .ipri.p-med { background:rgba(224,160,48,.18); color:#e8b862; }
.embody .ipri.p-low { background:rgba(90,140,200,.16); color:#8fb6dd; }
.embody .idue { opacity:.65; font-family:var(--font-code, monospace); }

/* Open feedback on a model or clip. A button, because it opens the review \u2014
   a tag that is secretly clickable reads as broken (CLAUDE.md). */
.embody .fbc { flex:none; height:auto; min-width:0; padding:1px 6px; margin-left:4px;
  font-size:9px; line-height:1.4; font-weight:700; border-radius:8px; cursor:pointer;
  background:rgba(208,82,82,.20); color:#e78b8b; border:1px solid rgba(208,82,82,.40); }
.embody .fbc:hover { background:#d05252; color:#fff; border-color:#d05252; }
/* Nothing open yet: the way in, not an alarm. */
.embody .fbc.none { background:transparent; color:var(--color-text); opacity:.4;
  border-color:transparent; font-weight:400; }
.embody .fbc.none:hover { opacity:1; background:var(--color-hover);
  color:var(--color-text); border-color:var(--color-border); }

/* The review page. Threads read top to bottom, oldest first, so the newest
   thing to answer is nearest the actions. */
.embody .rvhead { display:flex; align-items:center; gap:7px; padding:8px 10px 6px;
  font-size:10px; letter-spacing:.05em; text-transform:uppercase; opacity:.8;
  border-bottom:1px solid var(--color-border); }
.embody .rvhead b { text-transform:none; letter-spacing:0; opacity:1; }
.embody .rvcnt { margin-left:auto; font-size:9px; padding:1px 6px; border-radius:8px;
  background:rgba(208,82,82,.18); color:#e78b8b; text-transform:none; letter-spacing:0; }
.embody .rvcnt.ok { background:rgba(90,164,105,.16); color:#79c98a; }

.embody .thread { padding:9px 11px; border-bottom:1px solid var(--color-border); }
.embody .thread.done { opacity:.6; }
.embody .thd { display:flex; align-items:center; gap:6px; font-size:10px; }
.embody .thd .av { width:16px; height:16px; border-radius:50%; flex:none;
  display:flex; align-items:center; justify-content:center; font-size:8.5px;
  font-weight:700; background:var(--color-accent); color:var(--color-accent_text); }
.embody .thd .who { font-weight:600; }
.embody .thd .when { opacity:.5; font-variant-numeric:tabular-nums; }
.embody .thd .rst { margin-left:auto; font-size:8.5px; text-transform:uppercase;
  letter-spacing:.04em; padding:1px 5px; border-radius:3px;
  background:rgba(90,164,105,.16); color:#79c98a; }
.embody .thd .rst.op { background:rgba(208,82,82,.16); color:#e78b8b; }
.embody .tbody2 { margin:5px 0 0 22px; font-size:11px; line-height:1.55;
  white-space:pre-wrap; word-break:break-word; }
.embody .shots { margin:6px 0 0 22px; display:flex; flex-wrap:wrap; gap:5px; }
.embody .shotb { height:auto; min-width:0; padding:2px 7px; font-size:9px;
  border-radius:3px; cursor:pointer; background:var(--color-back);
  color:var(--color-text); border:1px solid var(--color-border); }
.embody .shotb:hover { border-color:var(--color-accent); }
.embody .shotimg { display:block; max-width:100%; max-height:220px; border-radius:3px;
  border:1px solid var(--color-border); cursor:zoom-in; }
.embody .shotimg:hover { border-color:var(--color-accent); }
.embody .pin { height:auto; min-width:0; padding:0 6px; font-size:9px; line-height:16px;
  border-radius:8px; cursor:pointer; background:rgba(90,140,220,.16); color:#8db4ec;
  border:1px solid transparent; font-variant-numeric:tabular-nums; }
.embody .pin:hover { border-color:#8db4ec; }
.embody .pin .pincam { font-size:9px; margin-left:3px; opacity:.85; }
.embody .pin .pinrng { margin-left:5px; padding-left:5px; border-left:1px solid rgba(141,180,236,.4); opacity:.85; }
.embody .thact { margin:7px 0 0 22px; display:flex; gap:5px; }
.embody .thdel { margin-left:auto; }
.embody .thdel:hover { color:#e78b8b; }
.embody .thact .ib { margin-left:0; }
.embody .thfoot { margin:7px 0 0 22px; display:flex; align-items:center; gap:7px;
  font-size:9px; opacity:.6; }

.embody .rvadd { display:flex; align-items:center; gap:6px; padding:9px 11px;
  border-top:1px solid var(--color-border); }
.embody .rvadd .ib { margin-left:0; }
.embody .rvadd .vmode { font-size:9.5px; opacity:.55; }

/* Whether a clip is actually in the linked .bbmodel (D-51).
   A fixed column so it reads straight down the list, and quiet when present \u2014
   that is the expected state. Absent is the one worth noticing. */
.embody .clipst { flex:0 0 60px; font-size:8.5px; padding:1px 0; border-radius:3px;
  text-align:center; text-transform:uppercase; letter-spacing:.03em; }
.embody .clipst.in { color:#79c98a; background:rgba(90,164,105,.13); }
.embody .clipst.out { color:#e0a030; background:rgba(224,160,48,.13); }

/* The tally under the list, and what the file holds that nobody asked for. */
.embody .clipsum { padding:7px 10px 8px; font-size:9.5px; line-height:1.5;
  border-top:1px solid var(--color-border); }
.embody .clipsum code { font-family:var(--font-code, monospace); opacity:.85; }
.embody .csline { opacity:.75; }
.embody .csall { color:#79c98a; }
.embody .cssome { color:#e0a030; }
.embody .clipsum.note { background:rgba(224,160,48,.07); }
.embody .clipsum.bad { display:flex; gap:7px; color:#e08d8d;
  background:rgba(208,82,82,.09); }
.embody .clipsum.bad .csw { flex:none; }
/* Finished clips the file no longer holds. Same voice as .clipsum.bad; it
   rendered as plain text because this rule did not exist. */
.embody .csbad { display:flex; gap:7px; margin-top:6px; padding:5px 8px; border-radius:3px;
  color:#e08d8d; background:rgba(208,82,82,.09); line-height:1.45; }
.embody .csbad .csw { flex:none; }
/* "unsaved changes included": a caveat, not a headline. */
.embody .cslive { opacity:.6; font-style:italic; }

/* Names of untracked animations, as chips. Fifteen of them in a sentence is a
   paragraph nobody reads; each one is a thing to go and look for. */
.embody .csx { margin-top:6px; display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.embody .csxh { flex:0 0 100%; opacity:.7; margin-bottom:1px; }
.embody .csxc { font-family:var(--font-code, monospace); font-size:9px;
  padding:1px 5px; border-radius:3px; background:rgba(224,160,48,.14);
  color:#e8b862; max-width:100%; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.embody .iname.d { opacity:.55; }
.embody .iname.s { opacity:.4; text-decoration:line-through; }

.embody .ipath { flex:1; min-width:0; font-family:var(--font-code, monospace);
  font-size:9.5px; opacity:.55; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  direction:rtl; text-align:left; }
.embody .ipath.w { color:#e0a45c; opacity:.95; direction:ltr; }
.embody .ipath.m { color:#e07a7a; opacity:.9; direction:ltr; }
.embody .ipath.n { opacity:.35; direction:ltr; }

.embody .vchip { font-size:8.5px; font-weight:700; font-family:var(--font-code, monospace);
  padding:2px 6px; border-radius:3px; white-space:nowrap; cursor:pointer;
  background:rgba(63,143,208,.20); color:#8fb3d9; border:none; }
.embody .vchip:hover { background:rgba(63,143,208,.34); }
.embody .vchip.one { background:var(--color-back); color:var(--color-text); opacity:.6; }
.embody .vchip.var { background:rgba(154,111,208,.22); color:#b39ddb; }
.embody .vchip .vn { opacity:.75; }

.embody .subnote { padding:5px 10px 7px 29px; font-size:9.5px; line-height:1.5;
  background:rgba(208,138,58,.09); color:#c9a86a; border-top:1px solid var(--color-border); }
.embody .subnote.m { background:rgba(208,82,82,.09); color:#d59a9a; }
.embody .subnote code { font-family:var(--font-code, monospace); }

.embody .vlist { background:var(--color-back); border-top:1px solid var(--color-border);
  padding:3px 0 0; }
.embody .vhead { display:flex; align-items:center; gap:7px; padding:6px 10px 4px 20px; }
.embody .vhn { font-size:9.5px; font-weight:700; color:#b39ddb;
  font-family:var(--font-code, monospace); }
.embody .vhc { font-size:8.5px; opacity:.45; }
.embody .vrow { display:flex; align-items:center; gap:8px; padding:5px 10px 5px 29px; }
.embody .vrow.ind { padding-left:38px; }
.embody .vrow:hover { background:var(--color-hover); }
.embody .vtag { font-size:8.5px; font-weight:700; font-family:var(--font-code, monospace);
  padding:1px 6px; border-radius:3px; background:var(--color-ui); opacity:.6; flex:0 0 auto; }
.embody .vtag.cur { background:rgba(63,143,208,.28); color:#7ab4ff; opacity:1; }
.embody .vlab { font-size:9.5px; opacity:.45; flex:0 0 auto; }
.embody .vpath { flex:1; min-width:0; font-size:9.5px; opacity:.55;
  font-family:var(--font-code, monospace);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.embody .vpath.w { color:#e0a45c; opacity:.95; }
.embody .vpath.m { color:#e07a7a; opacity:.9; }
.embody .ib.warn { background:rgba(208,138,58,.25); border-color:transparent; color:#f0c877; }
`;
  var HIT_CSS = `
.embody .item.hit { cursor:pointer; }
`;
  var MODAL_CSS = `
.kmodal { position:fixed; inset:0; z-index:9999; display:flex;
  align-items:center; justify-content:center; background:rgba(0,0,0,.45); }
.kmbox { min-width:260px; max-width:min(420px, calc(100vw - 32px));
  background:var(--color-ui); color:var(--color-text);
  border:1px solid var(--color-border); border-radius:5px;
  box-shadow:0 8px 28px rgba(0,0,0,.5); font-size:11px; }
.kmtitle { padding:8px 12px; font-weight:600; font-size:12px;
  border-bottom:1px solid var(--color-border); background:var(--color-frame); }
.kmbody { padding:12px; }
.kmtext, .kmnote { margin:0 0 10px; line-height:1.5; white-space:pre-wrap; }
.kmnote { opacity:.7; }
.kmbody .kmtext:last-child, .kmbody .kmnote:last-child { margin-bottom:0; }
.kmfield { display:flex; flex-direction:column; gap:4px; }
.kmfield > span { opacity:.7; }
.kmtext { width:100%; padding:4px 6px; font-size:11px;
  font-family:var(--font-code, monospace);
  background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); border-radius:3px; }
.kmgap { margin-top:10px; }
/* A short second field \u2014 an estimate \u2014 does not need the width of a name. */
.kmshort { max-width:160px; }
.kmbad { margin:8px 0 0; font-size:10px; line-height:1.45; padding:5px 7px;
  border-radius:3px; background:rgba(208,82,82,.12);
  border:1px solid rgba(208,82,82,.5); }
.kmdate { width:100%; padding:4px 6px; font-size:11px;
  background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); border-radius:3px; }
.kmhint { margin-top:10px; padding-top:9px; border-top:1px solid var(--color-border);
  margin-bottom:0; }
.kmselect { width:100%; padding:4px 6px; font-size:11px;
  background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); border-radius:3px; }
.kmfoot { display:flex; justify-content:flex-end; gap:6px;
  padding:8px 12px; border-top:1px solid var(--color-border); }
.kmbtn { padding:4px 12px; font-size:11px; cursor:pointer; border-radius:3px;
  background:var(--color-button); color:var(--color-text);
  border:1px solid var(--color-border); }
.kmbtn:hover { background:var(--color-accent); color:var(--color-accent_text);
  border-color:var(--color-accent); }
.kmbtn.primary { background:var(--color-accent); color:var(--color-accent_text);
  border-color:var(--color-accent); }
.kmbtn.primary:hover { filter:brightness(1.1); }
/* The expanded note view: wide enough for a screenshot to be read. */
.kmbox.kmmed { max-width:min(680px, calc(100vw - 32px)); width:min(680px, calc(100vw - 32px)); }
.kmbox.kmmed .kmbody { max-height:calc(100vh - 140px); overflow-y:auto; }
.knv-note { padding:8px 0; border-top:1px solid var(--color-border); }
.knv-note:first-child { border-top:0; padding-top:0; }
.knv-note.done { opacity:.7; }
.knv-who { display:flex; align-items:center; gap:7px; font-size:11px; }
.knv-who span { opacity:.55; font-variant-numeric:tabular-nums; }
.knv-st { margin-left:auto; font-size:8.5px; text-transform:uppercase; letter-spacing:.04em;
  padding:1px 5px; border-radius:3px; }
.knv-st.op { background:rgba(208,82,82,.16); color:#e78b8b; }
.knv-st.ok { background:rgba(90,164,105,.16); color:#79c98a; }
.knv-text { margin:5px 0 0; font-size:12px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.knv-img { display:block; max-width:100%; max-height:60vh; margin-top:7px; border-radius:4px;
  border:1px solid var(--color-border); }
.knv-pending { margin-top:5px; font-size:10px; opacity:.55; }
.knv-act { display:flex; gap:6px; margin-top:8px; }
.knl-row { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-top:1px solid var(--color-border); }
.knl-row:first-child { border-top:0; padding-top:0; }
.knl-row.done { opacity:.6; }
.knl-go { flex:none; font-variant-numeric:tabular-nums; font-size:10px; padding:3px 8px; }
.knl-body { flex:1; min-width:0; }
.knl-text { margin-top:3px; font-size:11.5px; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
.knl-cam { font-size:10px; opacity:.7; }
.knl-tick { flex:none; }
.knv-del { margin-left:auto; opacity:.7; }
.knv-del:hover { opacity:1; background:rgba(208,82,82,.25); color:#e78b8b; }
/* The mark-up dialog is as wide as the screenshot needs, up to the window. */
.kmbox.kmwide { max-width:min(1320px, calc(100vw - 32px)); }
.kdo-bar { display:flex; align-items:center; gap:4px; margin-bottom:8px; }
.kdo-t { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center;
  width:26px; height:24px; border-radius:3px; background:var(--color-button); color:var(--color-text);
  cursor:pointer; border:1px solid transparent; }
.kdo-t:hover { border-color:var(--color-accent); }
.kdo-t.on { background:var(--color-accent); color:var(--color-accent_text); }
.kdo-t .material-icons { font-size:16px; line-height:1; }
.kdo-c { all:unset; box-sizing:border-box; width:18px; height:18px; border-radius:50%; background:var(--c);
  cursor:pointer; border:2px solid transparent; box-shadow:0 0 0 1px rgba(0,0,0,.4); }
.kdo-c.on { border-color:var(--color-text); }
.kdo-sep { width:1px; height:16px; background:var(--color-border); margin:0 3px; }
.kdo-hint { margin-left:auto; font-size:10px; opacity:.6; }
.kdo-wrap { display:flex; justify-content:center; background:var(--color-back); border-radius:3px;
  border:1px solid var(--color-border); padding:4px; }
.kdo-canvas { display:block; max-width:min(1280px, calc(100vw - 80px)); max-height:calc(100vh - 190px);
  width:auto; height:auto; cursor:crosshair; touch-action:none; }
`;
  var KEBAB_CSS = `
.embody .kebab { padding:0 3px; height:auto; min-width:0; line-height:1;
  font-size:12px; border:0; background:none; cursor:pointer;
  color:var(--color-text); opacity:.45; flex:none; }
.embody .kebab:hover, .embody .kebab.on { opacity:1; }
/* Fixed, not absolute: the card it is triggered from is overflow:hidden.
   Placed by panel.ts against the trigger's rect, then clamped to the window. */
.embody .kmenu { position:fixed; top:0; left:0; z-index:60;
  width:186px; padding:4px 0; display:flex; flex-direction:column;
  background:var(--color-ui); border:1px solid var(--color-border);
  border-radius:4px; box-shadow:0 10px 28px rgba(0,0,0,.6); }
.embody .mi { width:100%; height:auto; min-width:0; text-align:left;
  padding:6px 12px; font-size:11px; line-height:1.3; border:0; border-radius:0;
  background:none; color:var(--color-text); cursor:pointer; }
.embody .mi:hover { background:var(--color-accent); color:var(--color-accent_text); }
`;
  var GIT_CSS = `
.embody .notice.git { border-color:rgba(63,143,208,.5);
  background:rgba(63,143,208,.10); }
.embody .notice.git b { font-weight:600; }
.embody .notice.git.push { border-color:rgba(224,160,48,.5); }
.embody .notice.git.bad { border-color:rgba(208,82,82,.5);
  background:rgba(208,82,82,.10); }
.embody .notice.git button[disabled] { opacity:.5; cursor:default; }
`;
  var SIGNIN_CSS = `
.embody .signin { display:flex; flex-direction:column; align-items:center;
  justify-content:center; text-align:center; gap:9px;
  padding:56px 26px; min-height:100%; }
.embody .si-title { font-size:19px; font-weight:600; letter-spacing:-.01em; }
.embody .si-sub { font-size:11px; opacity:.55; margin-bottom:10px; }
.embody .si-btn { padding:7px 18px; font-size:12px; border-radius:4px;
  cursor:pointer; height:auto; min-width:0; font-family:inherit;
  background:var(--color-accent); color:var(--color-accent_text);
  border:1px solid var(--color-accent); }
.embody .si-btn:hover { filter:brightness(1.1); }
.embody .si-wait { font-size:12px; opacity:.8; }
.embody .si-note { font-size:10px; opacity:.5; line-height:1.55; max-width:270px; }
.embody .si-err { font-size:10px; line-height:1.5; max-width:290px;
  padding:7px 9px; border-radius:4px; text-align:left;
  background:rgba(208,82,82,.12); border:1px solid rgba(208,82,82,.5); }
`;
  var MODAL_ROW_CSS = `
.kmrow { display:flex; gap:6px; align-items:stretch; }
.kmrow .kmtext { flex:1; min-width:0; }
.kmrow .kmbtn { flex:none; white-space:nowrap; }
`;
  var MODAL_TEXT_CSS = `
.kmtext.kmplain { font-family:inherit; }
.kmcheck { display:flex; gap:8px; align-items:flex-start; margin-top:11px;
  font-size:10px; line-height:1.5; cursor:pointer; }
.kmcheck input { margin:1px 0 0; flex:none; }
.kmlist { display:flex; flex-direction:column; }
.kmlist .kmcheck { margin-top:7px; font-size:11px; }
.kmcheck .kmdesc { display:block; font-size:10px; opacity:.6; }
/* A caution above a form: a timer already running while time is logged by hand. */
.kmwarn { margin:0 0 10px; padding:6px 9px; border-radius:3px; font-size:11px; line-height:1.45;
  color:#f0c877; background:rgba(224,160,48,.12); border:1px solid rgba(224,160,48,.45); }
/* A one-option "select", said as a line. The label keeps the field's muted tone. */
.kmstatic { margin-top:10px; }
.kmstatic > span { opacity:.7; }
.kmstatic > span::after { content:": "; }
/* Toasts, in whichever document hosts the panel. Bottom centre, above the
   footer, never in the way of a click. */
.kmtoasts { position:fixed; left:50%; bottom:18px; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; gap:6px; z-index:10000;
  pointer-events:none; max-width:calc(100% - 32px); }
.kmtoast { background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); border-radius:4px; padding:6px 12px;
  font-size:11px; line-height:1.4; box-shadow:0 4px 14px rgba(0,0,0,.35);
  white-space:pre-wrap; text-align:center; }
`;
  var VFOOT_CSS = `
.embody .vfoot { display:flex; gap:6px; padding:5px 10px 7px 20px;
  border-top:1px solid var(--color-border); }
.embody .vfoot .ib { margin-left:0; }
`;
  var VDEL_CSS = `
.embody .vhead { position:relative; }
.embody .vhead .vdel { margin-left:auto; }
`;
  var MODAL_AREA_CSS = `
.kmarea { resize:vertical; min-height:66px; line-height:1.45; }
`;
  var FOOTER_CSS = `
.embody .foot { display:flex; flex-wrap:wrap; align-items:center; gap:6px;
  padding:8px 10px; border-top:1px solid var(--color-border);
  background:var(--color-back); }
.embody .act { padding:4px 11px; font-size:11px; line-height:1.3; height:auto;
  min-width:0; border-radius:3px; cursor:pointer; font-family:inherit;
  background:var(--color-button); color:var(--color-text);
  border:1px solid var(--color-border); }
.embody .act:hover { background:var(--color-accent);
  color:var(--color-accent_text); border-color:var(--color-accent); }
.embody .act.primary { background:var(--color-accent);
  color:var(--color-accent_text); border-color:var(--color-accent); }
.embody .act.primary:hover { filter:brightness(1.1); }
.embody .act.danger { color:#e08d8d; border-color:rgba(208,82,82,.5); }
.embody .act.danger:hover { background:#5c2626; color:#ffd7d7; border-color:#5c2626; }
.embody .act.off, .embody .act[disabled] { opacity:.45; cursor:default; }
.embody .act.off:hover, .embody .act[disabled]:hover { background:var(--color-button);
  color:var(--color-text); border-color:var(--color-border); filter:none; }
.embody .fnote { font-size:9.5px; opacity:.6; line-height:1.4; }
.embody .fnote.bad { color:#e08d8d; opacity:1; }
.embody .reason { padding:7px 10px; font-size:10px; line-height:1.5;
  background:rgba(199,125,214,.10); border-top:1px solid rgba(199,125,214,.35);
  color:#d9b6e3; }

/* Where an animation task's files live (D-51). Quiet \u2014 it explains the rows
   below it rather than competing with them. */
.embody .anote { padding:6px 10px; font-size:9.5px; line-height:1.5; opacity:.7;
  border-top:1px solid var(--color-border); }
`;
  var GO_CSS = `
.embody .act.go { background:#3d6b40; color:#e6f3e6; border-color:#3d6b40; }
.embody .act.go:hover { filter:brightness(1.15); }
.embody .mi.bad { color:#e08d8d; }
.embody .mi.mnote { opacity:.5; cursor:default; font-size:10px; }
.embody .mi.mnote:hover { background:none; color:var(--color-text); }
/* A note inside a menu, rather than an entry: it explains what is NOT on the
   list, so it must not look like something that can be picked. */
.embody .kmenu > .mnote { max-width:250px; padding:7px 9px; font-size:9.5px;
  line-height:1.5; opacity:.7; border-top:1px solid var(--color-border);
  white-space:normal; cursor:default; }
.embody .kmenu > .mnote b { opacity:.95; }
.embody .mi.bad:hover { background:#5c2626; color:#ffd7d7; }
`;
  var MARK_BTN_CSS = `
.embody .mark.mbtn { background:none; border:0; padding:0; cursor:pointer;
  font-family:var(--font-code, monospace); font-size:11px; line-height:inherit; }
.embody .mark.mbtn:hover, .embody .mark.mbtn.on { outline:1px solid var(--color-accent);
  border-radius:2px; }

.embody .istate { display:flex; align-items:center; justify-content:space-between;
  gap:3px; flex:0 0 110px; height:auto; min-width:0; padding:2px 4px;
  font-size:9px; line-height:1.3; text-transform:uppercase; letter-spacing:.03em;
  cursor:pointer; border-radius:3px; text-align:left;
  background:var(--color-back); border:1px solid var(--color-border);
  color:var(--color-text); }
.embody .istate .istl { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.embody .istate .istc { opacity:.5; font-size:8px; flex:none; }
/* Blockbench styles every button's hover itself, and in the dark themes that
   background is near-black \u2014 which swallowed the label whole. Setting only
   border-color left its rule to win, so the background and the colour are
   both stated here. Same trap as the button sizing reset above. */
.embody .istate:hover, .embody .istate.on {
  background:var(--color-hover); border-color:var(--color-accent);
  color:var(--color-text); }
.embody .istate.m-doing:hover, .embody .istate.m-doing.on { color:#8cc6f5; }
.embody .istate.m-done:hover, .embody .istate.m-done.on { color:#8fdba0; }
.embody .istate.m-todo:hover, .embody .istate.m-todo.on { opacity:1; }
.embody .istate.m-skip:hover, .embody .istate.m-skip.on { opacity:.8; }
.embody .istate.m-chg:hover, .embody .istate.m-chg.on { color:#f0c87a; }
.embody .istate.m-qa:hover, .embody .istate.m-qa.on { color:#d0bcf0; }

/* The two statuses that have no marker of their own. Same pill, same column \u2014
   an item has one status and it reads as one thing (D-59). Both are wider
   words, so the pill has to hold them without the caret jumping. */
.embody .istate.m-chg { color:#e8b862; border-color:#6b5423; }
.embody .istate.m-qa { color:#c0a4e8; border-color:#553f70; }

.embody .kmenu .mi.on { background:var(--color-hover); }
.embody .kmenu .mi.on::after { content:'\\2713'; margin-left:auto; opacity:.7; }
/* The state colours the label and its edge, never the whole pill: a row of
   filled blocks competes with the names, which are what is being read. */
.embody .istate.m-todo { opacity:.75; }
.embody .istate.m-doing { color:#6fb2e8; border-color:#2f5c80; }
.embody .istate.m-done { color:#79c98a; border-color:#33603d; }
.embody .istate.m-skip { opacity:.45; text-decoration:line-through; }
`;
  var TIMER_CSS = `
.embody .tmbar { display:flex; align-items:center; gap:8px; margin:0;
  padding:6px 9px; font-size:11px;
  border-bottom:1px solid var(--color-border); }
.embody .tmbar.run { background:rgba(61,107,64,.18); border:1px solid #3d6b40; }
.embody .tmbar.idle { background:rgba(208,82,82,.10); border:1px solid rgba(208,82,82,.45); }
/* Running per Jira, not started here: amber \u2014 billing, but with no clock. */
.embody .tmbar.ext { background:rgba(224,160,48,.12); border:1px solid rgba(224,160,48,.5); }
.embody .tmdot { width:7px; height:7px; border-radius:50%; flex:none; }
.embody .tmbar.run .tmdot { background:#5cb85c; }
.embody .tmbar.idle .tmdot { background:#d05252; }
.embody .tmbar.ext .tmdot { background:#e0a030; }
.embody .tmbar.ext .tmnote { margin-left:auto; opacity:.8; font-size:10px; }
.embody .tmkey { font-weight:600; flex:none; }
/* The task's name, then which part of it. Both truncate rather than pushing
   the clock off; the name gives way first, since the item is the more specific
   answer to "what am I timing". */
.embody .tmsum { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  flex:0 1 auto; }
.embody .tmitem { opacity:.75; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; flex:0 0.5 auto; }
.embody .tmsum + .tmitem::before { content:"\xB7 "; opacity:.6; }
/* The way in to the Time panel, at the left of the strip it belongs to. */
.embody .tmopenbtn { flex:none; padding:2px 9px; font-size:10px; line-height:1.3;
  height:auto; min-width:0; border-radius:3px; cursor:pointer; font-family:inherit;
  background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); }
.embody .tmopenbtn:hover { border-color:var(--color-accent); }
.embody .tmopenbtn.on { background:var(--color-accent);
  color:var(--color-accent_text); border-color:var(--color-accent); }
.embody .tmel { margin-left:auto; font-variant-numeric:tabular-nums;
  font-family:var(--font-code, monospace); font-size:12px; }
.embody .tmnote { margin-left:auto; opacity:.5; font-size:9.5px; }
`;
  var QBAR_CSS = `
.embody .qbar { display:flex; align-items:center; gap:8px; padding:7px 9px;
  border-bottom:1px solid var(--color-border); }
.embody .qlab { font-size:10px; opacity:.6; flex:none; }
.embody .qbar select { flex:1; min-width:0; height:22px; font-size:11px;
  background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); border-radius:3px; }
`;
  var TMBTN_CSS = `
.embody .tmbtn { padding:0 4px; height:auto; min-width:0; line-height:1;
  font-size:10px; border:0; background:none; cursor:pointer; flex:none;
  color:#5cb85c; opacity:.85; }
.embody .tmbtn:hover { opacity:1; }
/* Stop is the red one: it is the button that ends something. */
.embody .tmbtn.on { color:#d05252; opacity:1; }

/* The same control on a checklist line. It sits among .ib buttons and keeps
   their metrics, so only the colour marks it as the timer. */
/* The item's estimate, immediately left of its timer button. A label, not a
   control (AGENTS.md: chips are labels); muted and tabular so a column of them
   lines up. */
.embody .iest { margin-left:6px; flex:none; font-size:9px; opacity:.6;
  font-family:var(--font-code, monospace); font-variant-numeric:tabular-nums;
  white-space:nowrap; }
/* One column for the whole list once any row has a time, so the clip state
   beside it reads straight down instead of stepping with each chip's width. */
.embody .items.wtime .iest { flex:0 0 64px; text-align:right; margin-left:0; }
/* Tracked past the estimate: the one state worth a colour. */
.embody .iest.over { color:#e78b8b; opacity:.9; }
.embody .iest .of { opacity:.65; }
.embody .ib.tmi { color:#5cb85c; border-color:#3f6b3f; padding:2px 5px; }
.embody .ib.tmi:hover { background:#5cb85c; border-color:#5cb85c; color:#12240f; }
.embody .ib.tmi.on { color:#d05252; border-color:#7a3838; }
.embody .ib.tmi.on:hover { background:#d05252; border-color:#d05252; color:#2a0f0f; }
`;
  var TIME_CSS = `
.embody .tmswitch { display:flex; gap:4px; padding:7px 9px;
  border-bottom:1px solid var(--color-border); }
.embody .tmsw { flex:1; padding:4px 0; font-size:11px; border-radius:3px;
  height:auto; min-width:0; cursor:pointer; font-family:inherit;
  background:var(--color-back); color:var(--color-text);
  border:1px solid var(--color-border); }
.embody .tmsw.on { background:var(--color-accent); color:var(--color-accent_text);
  border-color:var(--color-accent); }
.embody .tmnav { display:flex; align-items:center; gap:8px; padding:8px 11px 2px; }
.embody .tmarrow { padding:0 6px; height:auto; min-width:0; border:0;
  background:none; color:var(--color-text); opacity:.5; cursor:pointer; font-size:10px; }
.embody .tmarrow:hover { opacity:1; }
.embody .tmdate { font-size:11px; font-weight:600; }
.embody .tmtoday { font-size:9px; opacity:.45; margin-left:auto; }
.embody .tmjump { margin-left:auto; font-size:9.5px; padding:2px 7px;
  height:auto; min-width:0; border-radius:3px; cursor:pointer; font-family:inherit;
  background:transparent; color:var(--color-text);
  border:1px solid var(--color-border); }
.embody .tmtot { padding:2px 11px 10px; display:flex; align-items:baseline; gap:8px; }
.embody .tmbig { font-size:21px; font-weight:600; font-variant-numeric:tabular-nums; }
.embody .tmsub { font-size:10px; opacity:.5; }
/* The task's name beside its key on an entry, and a missing description dimmed. */
.embody .tmsum2 { margin-left:7px; font-weight:400; opacity:.75; font-family:inherit;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60%; display:inline-block; vertical-align:bottom; }
.embody .tmd2.tmnodesc { opacity:.4; font-style:italic; }
.embody .tmdl small { display:block; font-size:8px; opacity:.7; }
.embody .tmweek { display:flex; gap:3px; padding:0 11px 8px; }
.embody .tmd { flex:1; padding:0; border:0; background:none; cursor:pointer; }
/* .tmdbar, not .tmbar: that is the timer strip in TIMER_CSS, and sharing the
   name gave the strip a 34px bar height and the bar the strip's padding. */
.embody .tmdbar { width:100%; height:34px; background:var(--color-back);
  border-radius:2px; display:flex; align-items:flex-end; overflow:hidden; }
.embody .tmdbar i { width:100%; background:#3a4049; border-radius:2px; display:block; }
.embody .tmd.on .tmdbar i { background:var(--color-accent); }
.embody .tmd.td .tmdbar { outline:1px solid #2c5231; }
.embody .tmd:hover .tmdbar i { background:#4d5560; }
.embody .tmd.on:hover .tmdbar i { background:var(--color-accent); }
.embody .tmdl { font-size:9px; opacity:.5; display:block; padding-top:3px; }
.embody .tmwk { display:flex; align-items:center; padding:7px 11px;
  border-top:1px solid var(--color-border); border-bottom:1px solid var(--color-border);
  font-size:9.5px; opacity:.6; }
.embody .tmwkv { margin-left:auto; font-family:var(--font-code, monospace);
  font-weight:700; opacity:1; }
.embody .tmwkv.lnk { background:none; border:0; cursor:pointer;
  color:var(--color-text); font-size:9.5px; }
.embody .tmwkv.lnk:hover { color:var(--color-accent); }
.embody .tmlist { padding:4px 0; }
.embody .tment { display:flex; gap:9px; padding:7px 11px; cursor:pointer;
  border-bottom:1px solid var(--color-border); }
.embody .tment:hover { background:var(--color-hover); }
.embody .tment.live { background:rgba(61,107,64,.16); }
.embody .tment.live .tmtime { color:#8fd193; font-weight:700; }
.embody .tmpulse { width:6px; height:6px; border-radius:50%; background:#5cb85c;
  align-self:center; flex:none; }
.embody .tmtime { font-size:10px; opacity:.6; font-variant-numeric:tabular-nums;
  font-family:var(--font-code, monospace); flex:none; }
.embody .tmbody { flex:1; min-width:0; }
.embody .tmk { font-size:10px; font-weight:700; opacity:.75; display:flex; gap:7px;
  font-family:var(--font-code, monospace); }
.embody .tmdur { margin-left:auto; opacity:.8; }
.embody .tmd2 { font-size:10px; opacity:.55; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.embody .tmempty { padding:26px 16px; }
/* Entry actions stay out of the way until the row is under the pointer. */
.embody .tmacts { display:flex; gap:2px; align-self:center; flex:none;
  visibility:hidden; }
.embody .tment:hover .tmacts { visibility:visible; }
.embody .tmacts .ib { margin-left:0; }
.embody .tmfoot { display:flex; align-items:center; gap:8px; padding:8px 11px;
  border-top:1px solid var(--color-border); }
.embody .tmfoot .ib { margin-left:0; }
.embody .vmode { margin-left:auto; font-size:9.5px; opacity:.45; }
.embody .wkdays { padding:2px 11px 9px; }
.embody .wkd { display:flex; align-items:center; gap:8px; padding:5px 0;
  cursor:pointer; border-radius:3px; }
.embody .wkd:hover { background:var(--color-hover); }
.embody .wkd.zero { opacity:.45; }
.embody .wkdn { font-size:10px; width:26px; flex:none; }
.embody .wkdd { font-size:10px; opacity:.5; width:16px; flex:none; }
.embody .wkd.td .wkdn { color:#8fd193; font-weight:700; }
.embody .wkbar { flex:1; height:7px; background:var(--color-back);
  border-radius:2px; overflow:hidden; display:block; }
.embody .wkbar i { display:block; height:100%; background:#3f4b5c; border-radius:2px; }
.embody .wkd.td .wkbar i { background:#2c5231; }
.embody .wkd:hover .wkbar i { background:var(--color-accent); }
.embody .wkbar.tk { margin-top:5px; height:5px; }
.embody .wkh { font-size:10px; width:52px; text-align:right; flex:none;
  font-variant-numeric:tabular-nums; }
.embody .wkn { font-size:9px; opacity:.4; width:16px; text-align:right; flex:none; }
`;
  var DEBUG_CSS = `
.embody .dbgbar { display:flex; align-items:center; gap:8px; padding:6px 9px;
  font-size:10px; background:#4a1d5c; color:#e9d5f2;
  border-bottom:1px solid #6b2d86; }
.embody .dbgbar .ib { margin-left:auto; border-color:#a86fc4; color:#f0e0f8; }
.embody .dbgwarn { color:#ffb3b3; font-weight:700; }
`;
  var ALL_CSS = PANEL_CSS + FILE_CSS + INLINE_BTN_CSS + REVEAL_CSS + TABS_CSS + GUESS_CSS + STRUCT_CSS + DIM_BTN_CSS + ITEM_CSS + HIT_CSS + KEBAB_CSS + GIT_CSS + SIGNIN_CSS + VFOOT_CSS + VDEL_CSS + FOOTER_CSS + GO_CSS + MARK_BTN_CSS + TIMER_CSS + QBAR_CSS + TMBTN_CSS + TIME_CSS + DEBUG_CSS + MODAL_CSS + MODAL_ROW_CSS + MODAL_TEXT_CSS + MODAL_AREA_CSS;

  // src/ui/guard.ts
  var ACTIONS = {
    // Panel chrome.
    toggle: { global: true },
    lane: { global: true },
    refresh: { global: true },
    toggleall: { global: true },
    client: { global: true },
    /** The Time panel: switching view, stepping days, picking one. All chrome. */
    tmview: { global: true },
    tmday: { global: true },
    tmweekshift: { global: true },
    tmtoday: { global: true },
    tmpick: { global: true },
    tmopen: { global: true },
    /** Correcting or removing your own time entry. */
    tmedit: { global: true, ownRecord: true },
    tmdelete: { global: true, ownRecord: true },
    /** Log time from the Time panel, which asks which task before writing. */
    logtimeday: { global: true, picksTask: true },
    /** Choosing whose QA queue to look at. Chrome — it changes no data. */
    lead: { global: true },
    scope: { global: true },
    root: { global: true },
    // Opening the repository folder is chrome, but still needs somewhere to open.
    openroot: { global: true, needsRoot: true },
    github: { global: true, needsRoot: true },
    devreload: { global: true },
    /** Debug: says which condition the timeline review bar is failing on. */
    reviewbardiag: { global: true },
    /** DEBUG ONLY — leaving the view-as mode. Remove with src/debug/. */
    viewasoff: { global: true },
    /** The toolbar's Debug dropdown and its entries. Rendered only with the debug setting on. */
    debugmenu: { global: true },
    viewas: { global: true },
    viewaswrites: { global: true },
    /** Signing in. Nothing else works until it has happened, so it cannot be gated. */
    signin: { global: true },
    /** Backing out of the wait for the browser, and copying the consent link. */
    cancelsignin: { global: true },
    copysigninlink: { global: true },
    /** Connecting Clockwork, which is the other half of signing in. */
    clockworktoken: { global: true },
    clockworklink: { global: true },
    page: { global: true },
    group: { global: true },
    // Task actions. Setting a component is the one thing a gated task allows —
    // it is the action that ungates it, so denying it would be a deadlock.
    setcomponent: { allowedWhenGated: true, writes: true },
    /** "animated where?" — writes the Blockbench/Blender label on an Animation task. */
    settool: { writes: true },
    /**
     * Priority and due date are ordinary task writes: they are not offered on a
     * gated task, which has no menu at all and exactly one way forward.
     */
    setpriority: { writes: true },
    setdue: { writes: true },
    /** Opening the row menu. Chrome — it changes nothing but which panel is open. */
    menu: { global: true },
    /** Read-only, and the gated task is the one you most want to open in Jira. */
    openjira: { allowedWhenGated: true },
    /**
     * Pull from origin. Panel chrome rather than a task action — it is about the
     * repository, not about any one issue — but it still needs a root to run in,
     * and it writes to the working tree, which is why it is never automatic.
     */
    pull: { global: true, needsRoot: true, localWrite: true },
    // File actions. All need a root, none are available while gated.
    link: { needsRoot: true, writes: true },
    /** Browse for a .bbmodel under the root, open it, then link it as `link` does. */
    linkfile: { needsRoot: true, writes: true },
    create: { needsRoot: true, writes: true },
    repair: { needsRoot: true, writes: true },
    /** Point at the file a missing or not-yet-pulled record should mean. */
    locate: { needsRoot: true, writes: true },
    /**
     * Removing a recorded path. No root needed — it only edits the map, and a
     * link recorded against a root that is no longer set is one an artist may
     * very well want to remove.
     */
    unlink: { writes: true },
    /** Promote a version to be its variant's current one. Map only. */
    makecurrent: { writes: true },
    /** Name a variant, or add another. Map only. */
    variant: { writes: true },
    /** Rename the checklist item, which writes the checklist as well as the map. */
    renameitem: { writes: true },
    /**
     * Save the open model as the next version. Needs a root: the new file lands
     * beside the old one, and both paths are recorded relative to it.
     */
    newversion: { needsRoot: true, writes: true },
    /**
     * Move the task through the workflow.
     *
     * One entry for every transition, because the guard has no business knowing
     * which ones exist — Jira decides that, per issue, per user. Gated like any
     * other write, and never available on a task with no component: an untagged
     * task has no reviewer, so sending it to QA would send it nowhere.
     */
    move: { writes: true },
    /**
     * Timers. Starting one stops whatever else is running, so it writes — and it
     * is never available on a task with no component, which cannot reach QA and
     * therefore has nothing worth timing yet.
     */
    starttimer: { writes: true },
    /** The same timer, started from one checklist item so the entry can say so. */
    starttimeritem: { writes: true },
    stoptimer: { writes: true },
    /** Opening the state menu on a checklist item. Chrome. */
    itemstate: { global: true },
    /** Writing one marker byte on the checklist. */
    setitemstate: { writes: true },
    /**
     * Mark every verified clip Done, and add untracked animations to the list.
     *
     * Both are ordinary task-scoped writes. Neither is ever automatic: the file
     * is only ever compared and reported until somebody presses one of these
     * (D-60).
     */
    /**
     * Review. Reading and aiming are chrome; the rest write to Jira.
     *
     * `showall` and `showfb` only change what the review page is pointed at, so
     * they are global — a task with no component still has feedback worth
     * reading, and gating that would hide the reason it is stuck.
     */
    showfb: { global: true },
    showall: { global: true },
    openshot: { global: true },
    /** Seek Blockbench to the frame a note was left at. Reads nothing from Jira. */
    seeknote: { global: true },
    newfb: { writes: true },
    /** Pick a model or clip, then leave the first note on it (D-71). */
    leavefb: { writes: true },
    resolvefb: { writes: true },
    /** Delete a note. Offered to all; Jira's comment permissions decide (non-negotiable 4). */
    delfb: { writes: true },
    reopenfb: { writes: true },
    replyfb: { writes: true },
    rerequest: { writes: true },
    tickclips: { writes: true },
    addclips: { writes: true },
    /** Remove a whole variant and every path recorded under it. Map only. */
    delvariant: { writes: true },
    /** Record the open model as a file of a variant that already exists. */
    linkvariant: { needsRoot: true, writes: true },
    /** Move or rename a file, on disk as well as in the map. */
    movefile: { needsRoot: true, writes: true },
    /**
     * Rewrite a shared path prefix across every file on the task. Map only —
     * its own dialog says "nothing on disk is touched", so it needs no root.
     */
    rebase: { writes: true },
    open: { global: true, needsRoot: true },
    /**
     * Show a recorded file in the OS file manager. Global because it is rendered
     * on a file chip, which carries a path rather than a task key — and a gated
     * task never renders file chips at all, so nothing is bypassed.
     */
    reveal: { global: true, needsRoot: true }
  };
  function resolveAction(act, mods, hasPath) {
    return act === "open" && mods.alt && hasPath ? "reveal" : act;
  }
  var ALLOW = { allowed: true };
  var deny = (reason) => ({ allowed: false, reason });
  function checkAction(name, ctx) {
    const policy = ACTIONS[name];
    if (!policy) return deny(`Unknown action "${name}".`);
    if (policy.needsRoot && !ctx.hasRoot) {
      return deny("No repository root is set for this client, so files cannot be found.");
    }
    if (policy.global) return ALLOW;
    if (!ctx.task) return deny("That action needs a task.");
    if (ctx.task.scope === "untagged" && !policy.allowedWhenGated) {
      return deny("This task has no component, so it has no reviewer and cannot reach QA. Set one first.");
    }
    return ALLOW;
  }

  // src/ui/nag.ts
  var ID = "kumonga_timer_nag";
  var dismissed = false;
  var read = null;
  var NAG_CSS = `
#${ID} {
  display: none; align-items: center; gap: 6px;
  padding: 4px 10px; margin: 0 2px; cursor: default; user-select: none;
  font-size: 12px; line-height: 1.4; white-space: nowrap; color: #e0a030;
  animation: kumonga-nag-pulse 4s ease-in-out infinite;
}
#${ID}.on { display: inline-flex; }
#${ID}.quiet { color: var(--color-text); opacity: .55; animation: none; }
#${ID} .kn-dot {
  width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none;
}
#${ID} .kn-hush {
  display: none; font-size: 10px; opacity: .8; padding: 2px 6px;
  border: 1px solid currentColor; border-radius: 3px; background: none;
  color: inherit; cursor: pointer; font-family: inherit; line-height: 1;
}
#${ID}:hover .kn-hush { display: inline-block; }
#${ID}:hover { animation: none; }

/* Four seconds is slow enough to notice without becoming something you have to
   look away from. Anyone who has asked the OS for less motion gets none. */
@keyframes kumonga-nag-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: .35; }
}
@media (prefers-reduced-motion: reduce) {
  #${ID} { animation: none; }
}
`;
  function installNag(getState) {
    uninstallNag();
    read = getState;
    installed3 = 0;
    ensureNag();
    updateNag();
  }
  var installed3 = 0;
  function ensureNag() {
    const existing = document.getElementById(ID);
    if (existing) return existing;
    const bar = document.getElementById("menu_bar");
    if (!bar) {
      if (installed3 === 0) trace("nag: no #menu_bar to attach to");
      return null;
    }
    const el = document.createElement("div");
    el.id = ID;
    el.title = "Clockwork reports no timer on your tasks. Start one from a task, or log the time later.";
    el.innerHTML = '<span class="kn-dot"></span><span class="kn-text">Not timing your work</span>';
    const hush = document.createElement("button");
    hush.className = "kn-hush";
    hush.textContent = "Stop reminding me";
    hush.addEventListener("click", (ev) => {
      ev.stopPropagation();
      dismissed = true;
      updateNag();
    });
    el.appendChild(hush);
    bar.append(el);
    installed3++;
    if (installed3 <= 3) trace(`nag: inserted (${installed3})`);
    return el;
  }
  function uninstallNag() {
    try {
      document.getElementById(ID)?.remove();
    } catch {
    }
    read = null;
  }
  function resetNag() {
    dismissed = false;
    updateNag();
  }
  function shouldShow(state2) {
    return state2.enabled && !state2.running;
  }
  function updateNag() {
    if (!read) return;
    const el = ensureNag();
    if (!el) return;
    const state2 = read();
    const show2 = shouldShow(state2);
    el.classList.toggle("on", show2);
    el.classList.toggle("quiet", dismissed);
    el.title = dismissed ? "Not timing your work. Reminder paused until the next model is opened." : "Clockwork reports no timer on your tasks. Start one from a task, or log the time later.";
  }
  var PROJECT_EVENTS = ["load_project", "new_project", "select_project", "setup_project"];
  function watchProjects() {
    for (const name of PROJECT_EVENTS) {
      try {
        Blockbench.on?.(name, resetNag);
      } catch {
      }
    }
  }
  function unwatchProjects() {
    for (const name of PROJECT_EVENTS) {
      try {
        Blockbench.removeListener?.(name, resetNag);
      } catch {
      }
    }
  }

  // src/model/template.ts
  function mostCommon(values) {
    const counts = /* @__PURE__ */ new Map();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = null;
    let bestN = 0;
    for (const [v, n] of counts) {
      if (n > bestN) {
        best = v;
        bestN = n;
      }
    }
    return best;
  }
  var STOP = /* @__PURE__ */ new Set(["and", "the", "of", "a", "an", "or", "for", "to", "in", "on", "with"]);
  function contextFolder(context, disk) {
    const wanted = new Set(
      context.flatMap((c) => tokens(c)).filter((t) => !STOP.has(t)).map(stem)
    );
    if (!wanted.size) return null;
    const counts = /* @__PURE__ */ new Map();
    for (const p of disk) {
      const dir = dirOf(p);
      if (dir) counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
    let best = null;
    let bestScore = 0;
    let bestCount = 0;
    for (const [dir, count] of counts) {
      const have2 = new Set(tokens(dir.split("/").join(" ")).map(stem));
      let score = 0;
      for (const w of wanted) if (have2.has(w)) score++;
      if (score > bestScore || score === bestScore && score > 0 && count > bestCount) {
        best = dir;
        bestScore = score;
        bestCount = count;
      }
    }
    return bestScore > 0 ? best : null;
  }
  function proposeTarget(input) {
    const name = fileNameFor(input.base, input.variant ?? "", input.version ?? "v1");
    const folder = firstFolder(input.siblings ?? []) ?? contextFolder(input.context ?? [], input.disk ?? []) ?? mostCommon((input.disk ?? []).map(dirOf).filter((d) => !!d)) ?? "";
    return folder ? `${folder}/${name}` : name;
  }
  function firstFolder(paths) {
    for (const p of paths) {
      const dir = dirOf(p);
      if (dir) return dir;
    }
    return null;
  }
  function validateTarget(path) {
    const p = path.trim();
    if (!p) return "Give the file a name.";
    if (p.includes("\\")) return "Use forward slashes.";
    if (/^([a-zA-Z]:|\/)/.test(p)) return "Must be relative to the repository root, not an absolute path.";
    if (p.split("/").some((seg) => seg === "..")) return "Cannot point outside the repository root.";
    if (!/\.bbmodel$/i.test(p)) return "The name must end in .bbmodel.";
    if (/[<>:"|?*]/.test(p)) return "Those characters are not allowed in a filename.";
    return null;
  }

  // src/ui/branchdialog.ts
  async function planForDirtyTree(repoRoot, branchLabel) {
    const files = await changedFiles(repoRoot);
    if (!files.length) return "bring";
    const listed = files.slice(0, 6).map((f) => `<code>${esc(f)}</code>`).join("<br>");
    const more = files.length > 6 ? `<br>and ${files.length - 6} more` : "";
    const answer = await chooseAction({
      title: "You have uncommitted changes",
      html: `<p class="kmtext">${files.length} file${files.length === 1 ? "" : "s"} changed and not committed:</p><p class="kmtext">${listed}${more}</p><p class="kmnote"><b>Bring them</b> and they come with you to ${esc(branchLabel)}, which is what git does by default. <b>Stash them</b> and they are set aside on this branch; get them back with <code>git stash pop</code>, or from GitHub Desktop's Stashed Changes.</p>`,
      choices: [
        { value: "cancel", label: "Cancel" },
        { value: "stash", label: "Stash changes" },
        { value: "bring", label: "Bring changes" }
      ]
    });
    return answer === "bring" || answer === "stash" ? answer : null;
  }
  async function openNewBranchDialog(repoRoot, suggestedBase) {
    const { current: current3, branches } = await listBranches(repoRoot);
    const base = suggestedBase ?? current3 ?? branches[0];
    if (!base) {
      await showMessage(
        "No branches yet",
        "This repository has no branches to start from \u2014 commit something first."
      );
      return null;
    }
    const plan = await planForDirtyTree(repoRoot, "the new branch");
    if (plan === null) return null;
    const answer = await chooseTextAndSelect({
      title: "New branch",
      note: "The new branch starts from the one you pick and is checked out straight away. Uncommitted work comes with you, as it does in GitHub Desktop.",
      textLabel: "Name",
      textValue: "",
      textPlaceholder: "feat/pot-of-soup",
      mono: true,
      selectLabel: "Based on",
      options: branches.map((b) => ({ value: b, label: b === current3 ? `${b} (current)` : b })),
      value: base,
      confirmLabel: "Create branch",
      validate: (name2) => {
        const problem = validateBranchName(name2);
        if (problem) return problem;
        if (branches.includes(name2.trim())) return `${name2.trim()} already exists.`;
        return null;
      }
    });
    if (!answer) return null;
    const name = answer.text.trim();
    if (plan === "stash") {
      const stashed = await stashChanges(repoRoot, `Kumonga: before ${name}`);
      if (!stashed.ok) {
        await showMessage("Could not stash", stashed.err || stashed.out || "git refused.");
        return null;
      }
    }
    const res = await createBranch(repoRoot, name, answer.value);
    if (!res.ok) {
      await showMessage(
        "Could not create the branch",
        (res.err || res.out || "git refused.") + (plan === "stash" ? "\n\nYour changes were stashed and are still there \u2014 git stash pop restores them." : "")
      );
      return null;
    }
    if (plan === "stash") {
      await showMessage(
        `Created ${name}`,
        `Your changes were stashed on ${answer.value}. Restore them with git stash pop, or from GitHub Desktop's Stashed Changes.`
      );
    }
    return name;
  }
  async function switchTo(repoRoot, name) {
    const res = await switchBranch(repoRoot, name);
    if (!res.ok) {
      await showMessage(
        `Could not switch to ${name}`,
        (res.err || res.out || "git refused.") + "\n\nGitHub Desktop can stash the changes in the way; this cannot."
      );
      return false;
    }
    return true;
  }

  // src/ui/newfile.ts
  function preferredFormat(neighbourFormats, openFormat) {
    return mostCommon(neighbourFormats.filter(Boolean)) ?? openFormat;
  }
  function sample(disk, root, limit = 24) {
    const step = Math.max(1, Math.floor(disk.length / limit));
    const out = [];
    for (let i = 0; i < disk.length && out.length < limit; i += step) {
      const f = formatOf(toNative(resolveIn(root, disk[i])));
      if (f) out.push(f);
    }
    return out;
  }
  async function openCreateDialog(req, onCreated) {
    const repo = repoFor(req.root)?.root ?? null;
    const branchState2 = repo ? await listBranches(repo) : null;
    const formats = availableFormats();
    if (!formats.length) {
      await showMessage(
        "No formats available",
        "Blockbench reported no model formats, which should not happen. Create the file with File \u25B8 New and link it instead."
      );
      return;
    }
    const target = proposeTarget({
      base: req.base,
      siblings: req.siblings,
      disk: req.disk,
      context: req.context
    });
    const folder = dirOf(target);
    const neighbours = req.disk.filter((p) => dirOf(p) === folder).slice(0, 12).map((p) => formatOf(toNative(resolveIn(req.root, p)))).filter((f) => !!f);
    const preferred = preferredFormat(neighbours, currentFormatId()) ?? preferredFormat(sample(req.disk, req.root), null);
    const choice = await chooseNewFile({
      title: `New model for ${req.taskKey}`,
      note: req.itemText ? `For \u201C${req.itemText}\u201D.` : void 0,
      path: target,
      formats: formats.map((f) => ({ value: f.id, label: f.name })),
      format: preferred && formats.some((f) => f.id === preferred) ? preferred : formats[0].id,
      hint: "Creates an empty model, opens it, and records the path against the task. Whatever is open now is replaced, as with File \u25B8 New.",
      validate: validateTarget,
      // Browse hands back a folder relative to the root, because that is what
      // gets stored (non-negotiable 3). A folder outside the root is refused
      // here rather than accepted and then rejected on save.
      onBrowse: async () => {
        const picked = await pickFolder({
          title: "Where should this model go?",
          startPath: req.root
        });
        if (!picked) return null;
        return insideRoot(req.root, picked, "folder");
      },
      branch: branchState2?.current ? {
        options: branchState2.branches.map((b) => ({ value: b, label: b })),
        value: branchState2.current,
        onNew: () => openNewBranchDialog(repo, branchState2.current ?? void 0)
      } : void 0
    });
    if (choice === null) return;
    if (repo && choice.branch && choice.branch !== (await listBranches(repo)).current) {
      if (!await switchTo(repo, choice.branch)) return;
    }
    try {
      createProjectFile(toNative(resolveIn(req.root, choice.path)), choice.format, req.base);
    } catch (e) {
      await showMessage("Could not create the file", String(e?.message || e));
      return;
    }
    toast(`Created ${choice.path}`, 2500);
    onCreated(choice.path);
  }

  // src/ui/rootdialog.ts
  async function openRootDialog(projectKey, projectName, onSaved) {
    const existing = getRoot(projectKey);
    const title2 = `Repository root for ${projectName}`;
    const choice = await chooseText({
      title: title2,
      note: "The folder holding this client's art repository. Jira stores paths relative to it, so every artist can point at their own copy and still resolve the same files. It is never uploaded or shared.",
      label: "Folder",
      value: existing || "",
      mono: true,
      confirmLabel: "Save",
      extraLabel: existing ? "Forget this root" : void 0,
      // Inline, in the dialog the artist is looking at — not a toast elsewhere.
      validate: (text) => {
        const check2 = checkRoot(projectKey, text);
        return check2.ok ? null : check2.error || "Could not use that folder";
      },
      onBrowse: () => pickFolder({ title: title2, startPath: existing || void 0 })
    });
    if (!choice) return;
    if ("extra" in choice) {
      const yes = await confirmHtml(
        `Forget the root for ${esc(projectName)}?`,
        `<p class="kmtext">Kumonga stops looking for this client's files under <code>${esc(existing ?? "")}</code>.</p><p class="kmnote">Nothing on disk or in Jira changes. Set a folder again any time.</p>`,
        "Forget"
      );
      if (!yes) return;
      clearRoot(projectKey);
      toast(`Forgot the root for ${projectName}`, 2500);
      onSaved();
      return;
    }
    const check = setRoot(projectKey, choice.text);
    if (!check.ok) {
      toast(check.error || "Could not use that folder", 3500);
      return;
    }
    if (check.warning) toast(check.warning, 4e3);
    onSaved();
  }

  // src/ui/scope.ts
  async function openScopeDialog(projectKey, tasks, onSaved) {
    let components;
    try {
      components = await listComponents(projectKey);
    } catch (e) {
      toast(`Could not read components: ${e?.message || e}`, 3e3);
      return;
    }
    const current3 = settings().components;
    const counts = /* @__PURE__ */ new Map();
    for (const t of tasks) {
      for (const c of t.components) counts.set(c, (counts.get(c) || 0) + 1);
    }
    const chosen = await chooseMany({
      title: "Which components are modelling work?",
      note: "Tasks in the chosen components appear in the panel. Tasks with no component always appear, gated, because they have no reviewer.",
      confirmLabel: "Save",
      options: components.map((c) => {
        const mine = counts.get(c.name) || 0;
        const bits = [c.leadName ? `lead ${c.leadName}` : "no lead"];
        if (mine) bits.push(`${mine} assigned to you`);
        return { value: c.name, label: c.name, description: bits.join(" \xB7 "), checked: current3.includes(c.name) };
      }),
      // An empty scope hides every tagged task and leaves only the gated lane,
      // which reads as the plugin being broken. Refuse it.
      validate: (picked) => picked.length ? null : "Pick at least one component"
    });
    if (!chosen) return;
    saveSettings({ components: chosen });
    onSaved();
  }

  // src/jira/editmeta.ts
  function parseAllowedValues(field) {
    if (!field || !Array.isArray(field.allowedValues)) return [];
    const out = [];
    for (const v of field.allowedValues) {
      if (!v || typeof v !== "object") continue;
      const id = v.id ?? v.key;
      const name = v.name ?? v.value ?? v.label;
      if (typeof id === "string" && typeof name === "string") out.push({ id, name });
    }
    return out;
  }
  function readField(meta, field) {
    const f = meta?.fields?.[field];
    if (!f) return { editable: false, options: [] };
    return { editable: true, options: parseAllowedValues(f) };
  }
  async function editMeta(issueKey) {
    return api(`/rest/api/3/issue/${issueKey}/editmeta`);
  }
  async function setComponents(issueKey, ids) {
    await putFields(issueKey, { components: ids.map((id) => ({ id })) });
  }
  async function setPriority(issueKey, id) {
    await putFields(issueKey, { priority: { id } });
  }
  async function setDueDate(issueKey, day) {
    await putFields(issueKey, { duedate: day });
  }
  async function putFields(issueKey, fields) {
    await api(`/rest/api/3/issue/${issueKey}`, { method: "PUT", body: { fields } });
  }
  async function swapLabels(issueKey, add, remove) {
    const ops = [];
    for (const label of remove) {
      if (label !== add) ops.push({ remove: label });
    }
    if (add) ops.push({ add });
    if (!ops.length) return;
    await api(`/rest/api/3/issue/${issueKey}`, { method: "PUT", body: { update: { labels: ops } } });
  }

  // src/ui/taskfields.ts
  async function askAnimationTool(taskKey, current3) {
    const choice = await chooseOne({
      title: `Where is ${taskKey} animated?`,
      note: "Blockbench work appears in My Work. Blender work does not \u2014 this plugin cannot open a .blend \u2014 but it stays visible under \u201Cshow all\u201D.",
      label: "Animated in",
      options: ANIMATION_TOOLS.map((t) => ({ value: t, label: t })),
      value: current3 ?? "Blockbench",
      confirm: "Save"
    });
    return choice === "Blockbench" || choice === "Blender" ? choice : null;
  }
  async function openToolDialog(taskKey, currentLabels, onSaved) {
    const tool = await askAnimationTool(taskKey, animationTool(currentLabels));
    if (!tool) return;
    try {
      await swapLabels(taskKey, tool, [...ANIMATION_TOOLS]);
    } catch (e) {
      await showMessage(
        "Could not record the animation tool",
        `The ${tool} label could not be written on ${taskKey}.

${String(e?.message || e)}`
      );
      return;
    }
    onSaved();
  }
  async function openComponentDialog(taskKey, current3, onSaved, currentLabels = []) {
    let field;
    try {
      field = readField(await editMeta(taskKey), "components");
    } catch (e) {
      await showMessage(`Could not read ${taskKey}`, String(e?.message || e));
      return;
    }
    if (!field.editable || !field.options.length) {
      await showMessage(
        "Cannot set a component here",
        `Jira does not offer the component field on ${taskKey} for your account.

That usually means the field is not on this issue type's edit screen, or you do not have Edit Issues permission in this project. Either is an admin setting rather than something the plugin can work around.`
      );
      return;
    }
    const currentId = field.options.find((o) => o.name === current3)?.id ?? field.options[0].id;
    const choice = await chooseOne({
      title: `Component for ${taskKey}`,
      note: "The component decides who reviews this task. Without one it cannot reach QA.",
      label: "Component",
      options: field.options.map((o) => ({ value: o.id, label: o.name })),
      value: currentId
    });
    if (choice === null) return;
    const chosen = field.options.find((o) => o.id === choice);
    try {
      await setComponents(taskKey, [choice]);
    } catch (e) {
      await showMessage("Could not set the component", String(e?.message || e));
      return;
    }
    if (chosen?.name === ANIMATION_COMPONENT) {
      const tool = await askAnimationTool(taskKey, animationTool(currentLabels));
      if (tool) {
        try {
          await swapLabels(taskKey, tool, [...ANIMATION_TOOLS]);
        } catch (e) {
          await showMessage(
            "Could not record the animation tool",
            `${taskKey} is set to Animation, but the ${tool} label could not be written.

${String(e?.message || e)}`
          );
        }
      }
    }
    onSaved();
    const s = settings();
    const inScope = !chosen || s.showAll || s.components.includes(chosen.name);
    if (inScope) {
      toast(`${taskKey} \u2192 ${chosen?.name ?? "set"}`, 2500);
    } else {
      await showMessage(
        `${taskKey} \u2192 ${chosen.name}`,
        `${chosen.name} is outside the components you count as modelling work, so this task has left the panel. It is set correctly in Jira \u2014 widen your scope to see it.`
      );
    }
  }
  function notOffered(taskKey, field) {
    return showMessage(
      `Cannot set the ${field} here`,
      `Jira does not offer the ${field} field on ${taskKey} for your account.

That usually means the field is not on this issue type's edit screen, or you do not have Edit Issues permission in this project. Either is an admin setting rather than something the plugin can work around.`
    );
  }
  async function openPriorityDialog(taskKey, current3, onSaved) {
    let field;
    try {
      field = readField(await editMeta(taskKey), "priority");
    } catch (e) {
      await showMessage(`Could not read ${taskKey}`, String(e?.message || e));
      return;
    }
    if (!field.editable || !field.options.length) {
      await notOffered(taskKey, "priority");
      return;
    }
    const choice = await chooseOne({
      title: `Priority for ${taskKey}`,
      // What each level does to the card, because that is the actual consequence
      // the artist is choosing between (the prototype spells this out too).
      note: "Highest sorts to the top of its lane. Low and Lowest fade the card without disabling it. Medium is the default and renders no chip.",
      label: "Priority",
      options: field.options.map((o) => ({ value: o.id, label: o.name })),
      value: field.options.find((o) => o.name === current3)?.id ?? field.options[0].id
    });
    if (choice === null) return;
    const chosen = field.options.find((o) => o.id === choice);
    try {
      await setPriority(taskKey, choice);
    } catch (e) {
      await showMessage("Could not set the priority", String(e?.message || e));
      return;
    }
    toast(`${taskKey} \u2192 ${chosen?.name ?? "set"}`, 2500);
    onSaved();
  }
  async function openDueDialog(taskKey, current3, onSaved) {
    let field;
    try {
      field = readField(await editMeta(taskKey), "duedate");
    } catch (e) {
      await showMessage(`Could not read ${taskKey}`, String(e?.message || e));
      return;
    }
    if (!field.editable) {
      await notOffered(taskKey, "due date");
      return;
    }
    const choice = await chooseDate({
      title: current3 ? `Change due date \u2014 ${taskKey}` : `Set due date \u2014 ${taskKey}`,
      value: current3,
      hint: "Overdue tasks jump to the top of their lane regardless of priority. Clear removes the date entirely."
    });
    if (choice === null) return;
    try {
      await setDueDate(taskKey, choice.value);
    } catch (e) {
      await showMessage("Could not set the due date", String(e?.message || e));
      return;
    }
    toast(
      choice.value ? `${taskKey} due ${choice.value}` : `Due date cleared on ${taskKey}`,
      2500
    );
    onSaved();
  }

  // src/ui/time.ts
  var LONG_ENTRY_SECONDS = 12 * 3600;
  async function openTokenDialog(onSaved) {
    const existing = clockworkToken();
    const answer = await chooseText({
      title: existing ? "Replace the Clockwork token" : "Connect Clockwork",
      note: "Create one in Jira at Apps \u2192 Clockwork \u2192 API Tokens, ticking Clockwork Timesheets Access \u2014 that is what lets Kumonga read and log your time. It belongs to you personally: requests run as whoever the token belongs to.",
      label: existing ? "New token" : "API token",
      value: "",
      placeholder: existing ? "leave empty to keep the current one" : "",
      mono: true,
      confirmLabel: "Save",
      hint: "Stored encrypted on this machine, never synced.",
      validate: (t) => {
        if (!t.trim() && existing) return null;
        return t.trim() ? null : "Paste the token, or cancel to keep things as they are.";
      }
    });
    if (!answer || "extra" in answer) return;
    const token = answer.text.trim();
    if (!token) return;
    const verdict = await probeToken(token);
    if (verdict === "refused") {
      await showMessage(
        "Clockwork refused that token",
        "It was not saved. Check it is current and has Clockwork Timesheets Access, then paste it again."
      );
      return openTokenDialog(onSaved);
    }
    if (verdict === "unreachable") {
      await showMessage(
        "Could not reach Clockwork",
        "The token was not saved, because it could not be checked. Try again in a moment."
      );
      return;
    }
    try {
      setClockworkToken(token);
    } catch (e) {
      await showMessage("Could not store the token", String(e?.message || e));
      return;
    }
    toast("Clockwork connected", 2500);
    onSaved();
  }
  async function forgetToken(onSaved) {
    const yes = await confirmHtml(
      "Disconnect Clockwork?",
      '<p class="kmtext">The token is removed from this machine. Timers and time entry stop working until a new one is pasted.</p><p class="kmnote">Nothing already logged is affected.</p>',
      "Disconnect"
    );
    if (!yes) return;
    clearClockworkToken();
    saveSettings({ timer: null });
    toast("Clockwork disconnected", 2e3);
    onSaved();
  }
  function runningTimer() {
    return settings().timer ?? null;
  }
  var external = null;
  function noteExternalTimer(key) {
    external = key;
  }
  function externalTimer() {
    return external;
  }
  async function startFor(issueKey, summary, done, runningFor, item) {
    if (!hasClockwork()) {
      await showMessage(
        "Clockwork is not connected",
        "Add your Clockwork API token from the Kumonga menu, then try again."
      );
      return;
    }
    const on = item ? `${issueKey} &mdash; ${esc(item)}` : esc(issueKey);
    const yes = await confirmTimerStart({
      title: `Start a timer on ${item ? item : issueKey}?`,
      lead: item ? `<p class="kmtext">Timing <b>${on}</b>. That is what the entry will say it was for, unless you change it when you stop.</p>` : "",
      confirmLabel: "Start timer"
    });
    if (!yes) return;
    await beginTimer(issueKey, summary, done, runningFor, item);
  }
  async function confirmTimerStart(opts) {
    const mine = runningTimer();
    const known = mine ? `<p class="kmtext">Kumonga has a timer running on <b>${esc(mine.issueKey)}</b>, started ${formatElapsed((Date.now() - mine.startedAt) / 1e3)} ago. It will be stopped and logged.</p>` : external ? `<p class="kmtext">Clockwork reports a timer running on <b>${esc(external)}</b>, started in Jira. It will be stopped and logged, with no description.</p>` : "";
    return confirmHtml(
      opts.title,
      (opts.lead ?? "") + known + '<p class="kmtext">Clockwork allows one timer per person, so this stops whatever else you have running.</p>' + (known ? "" : `<p class="kmnote">Nothing is running on your tasks according to Clockwork. A timer on somebody else's task would not show here; if there is one, Kumonga will say what got stopped straight after.</p>`),
      opts.confirmLabel
    );
  }
  async function beginTimer(issueKey, summary, done, runningFor, item, failureTitle = "Could not start the timer") {
    let result;
    try {
      result = await startTimer(issueKey, runningFor);
    } catch (e) {
      await showMessage(failureTitle, String(e?.message || e));
      return false;
    }
    saveSettings({ timer: { issueKey, startedAt: Date.now(), item: item ?? void 0 } });
    done();
    if (result.stopped.length) {
      await showMessage(
        "Another timer was stopped",
        result.stopped.map((s) => s.message).join("\n\n") + "\n\nThat time is now logged. If it was a mistake, fix it in Clockwork before it gets lost among the rest of the day."
      );
    } else {
      toast(`Timing ${issueKey} \u2014 ${item || summary}`, 2500);
    }
    return true;
  }
  async function stopFor(issueKey, accountId, done, runningFor, opts = {}) {
    const forItem = startingDescription(runningTimer(), issueKey);
    const answer = await chooseText({
      title: `Stop the timer on ${issueKey}`,
      note: (forItem ? `Timed against "${forItem}". ` : "") + "What was the time for? This is written onto the worklog afterwards, because Clockwork discards a description given while stopping.",
      label: "Description",
      value: forItem,
      placeholder: "Blocked out the base mesh",
      multiline: true,
      extraLabel: "Discard\u2026",
      confirmLabel: "Stop timer",
      validate: (text) => text.trim() ? null : "Say what the time was for \u2014 an entry nobody can account for is worse than no entry."
    });
    if (!answer) return;
    if ("extra" in answer) {
      await abandon(issueKey, accountId, done, runningFor);
      return;
    }
    let result;
    try {
      result = await stopTimer(issueKey, answer.text, accountId, runningFor);
    } catch (e) {
      await stopFailed(issueKey, e, done);
      return;
    }
    saveSettings({ timer: null });
    done();
    if (answer.text.trim() && !result.described) {
      const go = await chooseAction({
        title: "Stopped, but the description did not save",
        html: '<p class="kmtext">The time is logged. Clockwork discards descriptions given while stopping, so Kumonga writes them afterwards \u2014 and that second step failed.</p>' + (result.reason ? `<p class="kmnote">${esc(result.reason)}</p>` : "") + `<p class="kmtext">Paste this onto the worklog:</p><p class="kmtext"><code>${esc(answer.text.trim())}</code></p>`,
        choices: [{ value: "close", label: "Close" }, { value: "jira", label: `Open ${issueKey} in Jira` }]
      });
      if (go === "jira") void openInJira(issueKey);
      return;
    }
    toast("Timer stopped and logged", 2500);
    if (opts.thenCorrect && result.worklogId) {
      await editEntry(issueKey, result.worklogId, result.seconds ?? 0, answer.text.trim(), done);
    }
  }
  async function stopFailed(issueKey, e, done) {
    const timer = runningTimer();
    const elapsed = timer && timer.issueKey === issueKey ? formatElapsed((Date.now() - timer.startedAt) / 1e3) : null;
    const answer = await chooseAction({
      title: "Could not stop the timer",
      html: `<p class="kmtext">${esc(String(e?.message || e))}</p>` + (elapsed ? `<p class="kmnote">Kumonga has been counting <b>${esc(elapsed)}</b> on ${esc(issueKey)}. If Clockwork says nothing is running, the stop may already have gone through: forget this timer here and check the entry in Jira.</p>` : ""),
      choices: [{ value: "keep", label: "Try again later" }, { value: "forget", label: "Forget this timer" }]
    });
    if (answer === "forget") {
      saveSettings({ timer: null });
      toast("Forgotten. Log the time by hand if Clockwork did not.", 3500);
      done();
    }
  }
  async function abandon(issueKey, accountId, done, runningFor) {
    const timer = runningTimer();
    const elapsed = timer && timer.issueKey === issueKey ? formatElapsed((Date.now() - timer.startedAt) / 1e3) : "the time";
    const yes = await confirmChecked({
      title: `Discard this time on ${issueKey}?`,
      html: `<p class="kmtext">The timer stops and <b>${esc(elapsed)}</b> is thrown away. Nothing is logged against ` + esc(issueKey) + '.</p><p class="kmnote">Clockwork has no cancel, so the entry is created and then deleted. Deleting a worklog cannot be undone.</p>',
      checkboxLabel: "None of this time was work worth recording.",
      confirmLabel: "Discard"
    });
    if (!yes) return;
    let result;
    try {
      result = await abandonTimer(issueKey, accountId, runningFor);
    } catch (e) {
      await stopFailed(issueKey, e, done);
      return;
    }
    saveSettings({ timer: null });
    done();
    if (result.deleted) {
      toast("Timer stopped, nothing logged", 2500);
      return;
    }
    await showMessage(
      "Stopped, but the entry is still there",
      "The timer has stopped and Clockwork filed " + (result.seconds ? formatDuration(result.seconds) : "an entry") + " against " + issueKey + ". Kumonga could not remove it.\n\n" + (result.reason ? result.reason + "\n\n" : "") + "Delete it in Jira or Clockwork if it should not be there."
    );
  }
  async function openLogWork(issueKey, accountId, done) {
    const now = /* @__PURE__ */ new Date();
    const today = localDay(now);
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS2 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const days = Array.from({ length: 7 }, (_, i) => {
      const value = dayBefore(today, i);
      const d = fromDay(value);
      const label = i === 0 ? "Today" : i === 1 ? "Yesterday" : d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS2[d.getMonth()]}` : value;
      return { value, label };
    });
    const hourAgo = new Date(now.getTime() - 36e5);
    const p = (n) => String(n).padStart(2, "0");
    const live = runningTimer()?.issueKey ?? externalTimer();
    const warning = live ? `A timer is running on ${live}. Time logged over the same period will count twice.` : void 0;
    const answer = await chooseWorklog({
      title: `Log time on ${issueKey}`,
      note: "Jira duration syntax: 2h, 45m, 1h 30m. A bare number is minutes.",
      days,
      day: today,
      start: `${p(hourAgo.getHours())}:${p(hourAgo.getMinutes())}`,
      warning,
      validateDuration: (t) => parseDuration(t) === null ? "Try something like 2h, 45m or 1h 30m." : null
    });
    if (!answer) return;
    const seconds = parseDuration(answer.duration);
    if (seconds === null) return;
    if (seconds > LONG_ENTRY_SECONDS) {
      const yes = await confirmHtml(
        "That is a long entry",
        `<p class="kmtext">${esc(formatDuration(seconds))} on ${esc(issueKey)}.</p><p class="kmnote">Longer than a working day, so worth a second look \u2014 "90" means ninety minutes, but "90h" means ninety hours.</p>`,
        "Log it anyway"
      );
      if (!yes) return;
    }
    const started = fromDay(answer.day) ?? /* @__PURE__ */ new Date();
    const [hh, mm] = answer.start.split(":").map(Number);
    started.setHours(hh, mm, 0, 0);
    try {
      const existing = await listWorklogs({
        from: answer.day,
        to: answer.day,
        accountId: accountId ?? void 0
      });
      const clash = overlaps(existing, started, seconds);
      if (clash.length) {
        const yes = await confirmHtml(
          "That overlaps time already logged",
          `<p class="kmtext">${clash.length} entr${clash.length === 1 ? "y" : "ies"} already cover${clash.length === 1 ? "s" : ""} part of that:</p><p class="kmtext">${clash.slice(0, 4).map((w) => `<code>${esc(w.issueKey)}</code> ${esc(formatDuration(w.seconds))}`).join("<br>")}</p><p class="kmnote">Jira allows overlapping entries, so this is a warning rather than a refusal.</p>`,
          "Log it anyway"
        );
        if (!yes) return;
      }
    } catch {
    }
    try {
      await logWork(issueKey, seconds, started, answer.description);
    } catch (e) {
      await showMessage("Could not log the time", String(e?.message || e));
      return;
    }
    toast(`Logged ${formatDuration(seconds)} on ${issueKey}`, 2500);
    done();
  }
  function dayBefore(day, n) {
    const d = fromDay(day);
    if (!d) return day;
    d.setDate(d.getDate() - n);
    return localDay(d);
  }
  async function recoverTimer(accountId, done) {
    const timer = runningTimer();
    if (!timer) return;
    const elapsed = formatElapsed((Date.now() - timer.startedAt) / 1e3);
    const answer = await chooseAction({
      title: "A timer was left running",
      html: `<p class="kmtext">Kumonga was timing <b>${esc(timer.issueKey)}</b> when it last closed \u2014 ${esc(elapsed)} ago.</p><p class="kmnote">Clockwork has been running it the whole time; the plugin restarting changed nothing. Keep going, or stop and log it.</p>`,
      choices: [
        { value: "forget", label: "Not mine" },
        { value: "keep", label: "Keep timing" },
        { value: "stop", label: "Stop and log" }
      ]
    });
    if (answer === "stop") await stopFor(timer.issueKey, accountId, done, void 0, { thenCorrect: true });
    else if (answer === "forget") {
      saveSettings({ timer: null });
      done();
    }
  }
  async function editEntry(issueKey, worklogId, seconds, comment, done) {
    const answer = await chooseTextAndSelect({
      title: `Edit ${formatDuration(seconds)} on ${issueKey}`,
      note: "Changes the worklog in Jira, which is where Clockwork reads from.",
      textLabel: "Time spent",
      textValue: formatDuration(seconds),
      mono: true,
      selectLabel: "Description",
      options: [{ value: "keep", label: "edit it below" }],
      value: "keep",
      confirmLabel: "Next",
      validate: (t) => parseDuration(t) === null ? "Try something like 2h or 45m." : null
    });
    if (!answer) return;
    const nextSeconds = parseDuration(answer.text);
    if (nextSeconds === null) return;
    const note = await chooseTextAndSelect({
      title: `Description for ${issueKey}`,
      textLabel: "Description",
      textValue: comment,
      multiline: true,
      selectLabel: "Applies to",
      options: [{ value: "entry", label: "this entry only" }],
      value: "entry",
      confirmLabel: "Save",
      validate: (t) => t.trim() ? null : "An entry needs to say what it was for."
    });
    if (!note) return;
    try {
      await updateWorklog(issueKey, worklogId, {
        seconds: nextSeconds !== seconds ? nextSeconds : void 0,
        comment: note.text.trim() !== comment ? note.text.trim() : void 0
      });
    } catch (e) {
      await showMessage("Could not change that entry", String(e?.message || e));
      return;
    }
    toast("Entry updated", 2e3);
    done();
  }
  async function deleteEntry(issueKey, worklogId, seconds, done) {
    const yes = await confirmChecked({
      title: "Delete this entry?",
      html: `<p class="kmtext"><b>${esc(formatDuration(seconds))}</b> on ${esc(issueKey)} is removed from the timesheet.</p><p class="kmnote">Jira keeps no history of a deleted worklog. There is no undo, and nothing to recover it from.</p>`,
      checkboxLabel: "This time was not worked, or is logged somewhere else.",
      confirmLabel: "Delete"
    });
    if (!yes) return;
    try {
      await deleteWorklog(issueKey, worklogId);
    } catch (e) {
      await showMessage("Could not delete that entry", String(e?.message || e));
      return;
    }
    toast("Entry deleted", 2e3);
    done();
  }

  // src/ui/versions.ts
  async function apply2(taskKey, mutate, success, done, extra) {
    try {
      await updateAssetMap(taskKey, mutate);
      toast(success, 2500);
      done();
    } catch (e) {
      await showMessage(
        "Could not update Jira",
        String(e?.message || e) + (extra ? "\n\n" + extra : "")
      );
    }
  }
  async function makeCurrent(ref, done) {
    await apply2(
      ref.taskKey,
      (m) => setCurrent(m, ref.assetId, ref.variant, ref.version),
      ref.version + " is now current",
      done
    );
  }
  async function saveAsNewVersion(ref, root, base, map, done) {
    const project = openProject();
    if (!project) {
      await showMessage(
        "Nothing is open",
        "Open the model you want to version, then try again."
      );
      return;
    }
    if (project.assetId && project.assetId !== ref.assetId) {
      await showMessage(
        "That is a different model",
        "The open project carries another model\u2019s identity, so saving it here would record it as a version of this one. Open the right model first."
      );
      return;
    }
    const version = nextVersion(map.assets[ref.assetId], ref.variant);
    const folder = dirOf(ref.path || "") || "";
    const name = fileNameFor(base, ref.variant, version);
    const answer = await chooseTextAndSelect({
      title: "New version of " + base,
      note: "Saves what is open as " + version + ". The current file stays as it is.",
      textLabel: "File, relative to the repository root",
      textValue: folder ? folder + "/" + name : name,
      mono: true,
      selectLabel: "Make it current",
      options: [
        { value: "yes", label: "Yes \u2014 this is what ships" },
        { value: "no", label: "No \u2014 keep the current one" }
      ],
      value: "yes",
      confirmLabel: "Save version",
      validate: validateTarget
    });
    if (!answer) return;
    try {
      stampProject({
        assetId: ref.assetId,
        variant: ref.variant,
        version,
        jiraKey: ref.taskKey,
        site: auth.cloudId()
      });
      saveProjectAs(toNative(resolveIn(root, answer.text)));
    } catch (e) {
      await showMessage("Could not save the new version", String(e?.message || e));
      return;
    }
    try {
      await updateAssetMap(ref.taskKey, (m) => {
        const withFile = addFileToMap(m, {
          assetId: ref.assetId,
          item: m.assets[ref.assetId]?.item ?? null,
          variant: ref.variant,
          version,
          path: answer.text.trim(),
          at: (/* @__PURE__ */ new Date()).toISOString()
        });
        return answer.value === "yes" ? setCurrent(withFile, ref.assetId, ref.variant, version) : withFile;
      });
    } catch (e) {
      await showMessage(
        "Saved, but not recorded",
        answer.text + " was written to disk, but Jira could not be updated.\n\n" + String(e?.message || e) + "\n\nLink it manually, or try again."
      );
      return;
    }
    toast("Saved " + version, 2500);
    done();
  }
  async function manageVariant(ref, map, done) {
    const asset = map.assets[ref.assetId];
    if (!asset) return;
    const names = Object.keys(asset.variants);
    const unnamedOnly = names.length === 1 && names[0] === "";
    if (unnamedOnly) {
      const count = versionsOf(asset, "").length;
      const answer2 = await chooseTextAndSelect({
        title: "Name this variant",
        note: "This model has " + count + " file" + (count === 1 ? "" : "s") + " and no variants yet. Name what is already there before adding another, or the existing files belong to nothing in particular.",
        textLabel: "The existing files are the\u2026",
        textValue: "",
        textPlaceholder: "copper",
        selectLabel: "Applies to",
        options: [{ value: "existing", label: "all " + count + " existing file" + (count === 1 ? "" : "s") }],
        value: "existing",
        confirmLabel: "Name it",
        validate: (name) => name.trim() ? null : "Give the variant a name."
      });
      if (!answer2) return;
      await apply2(
        ref.taskKey,
        (m) => renameVariant(m, ref.assetId, "", answer2.text.trim()),
        "Existing files are now the " + answer2.text.trim() + " variant",
        done
      );
      return;
    }
    const answer = await chooseTextAndSelect({
      title: "Add a variant",
      note: "Existing: " + names.map((n) => n || "unnamed").join(", ") + ".",
      textLabel: "Name",
      textValue: "",
      textPlaceholder: "iron",
      selectLabel: "Applies to",
      options: [{ value: "new", label: "a new, empty variant" }],
      value: "new",
      confirmLabel: "Add",
      validate: (name) => {
        const n = name.trim();
        if (!n) return "Give the variant a name.";
        if (names.includes(n)) return n + " already exists.";
        return null;
      }
    });
    if (!answer) return;
    await apply2(
      ref.taskKey,
      (m) => addVariant(m, ref.assetId, answer.text.trim()),
      "Added the " + answer.text.trim() + " variant",
      done
    );
  }
  async function moveOrRename(ref, root, done) {
    const current3 = ref.path || "";
    const onDisk = !!current3 && existsOnDisk(toNative(resolveIn(root, current3)));
    const answer = await chooseTextAndSelect({
      title: "Move or rename",
      note: onDisk ? "Jira records the new path. Moving the file itself is optional \u2014 a record can be corrected without touching anything on disk." : "Nothing is at the recorded path, so only the record can change here. If the file exists somewhere else, Locate is the better tool.",
      textLabel: "File, relative to the repository root",
      textValue: current3,
      mono: true,
      selectLabel: "On disk",
      options: [
        { value: "move", label: "Move the file too" },
        { value: "record", label: "Only change the record" }
      ],
      value: onDisk ? "move" : "record",
      confirmLabel: "Move",
      validate: (path) => {
        const problem = validateTarget(path);
        if (problem) return problem;
        if (path.trim() === current3) return "That is where it already is.";
        return null;
      }
    });
    if (!answer) return;
    if (answer.value === "move") {
      try {
        renameOnDisk(toNative(resolveIn(root, current3)), toNative(resolveIn(root, answer.text)));
      } catch (e) {
        await showMessage("Could not move the file", String(e?.message || e));
        return;
      }
    }
    await apply2(
      ref.taskKey,
      (m) => movePath(m, ref.assetId, ref.variant, ref.version, answer.text.trim()),
      "Path updated",
      done,
      answer.value === "move" ? "The file WAS moved to " + answer.text + ", but Jira still points at the old path." : void 0
    );
  }
  async function rebaseTask(taskKey, map, done) {
    const paths = allPaths(map);
    const folders = [...new Set(paths.map((p) => dirOf(p)).filter((d) => !!d))].sort();
    if (!folders.length) {
      await showMessage(
        "Nothing to rebase",
        paths.length ? "Every recorded file is already at the repository root." : "This task has no recorded files yet."
      );
      return;
    }
    const from = await chooseOne({
      title: "Rebase paths",
      note: "Pick the folder that moved. Every recorded file under it is rewritten in one write. Nothing on disk is touched.",
      label: "Folder that moved",
      options: folders.map((f) => ({ value: f, label: f })),
      value: folders[0],
      confirm: "Next"
    });
    if (from === null) return;
    const affected = paths.filter((p) => p === from || p.startsWith(from + "/"));
    const answer = await chooseTextAndSelect({
      title: "Rebase " + from,
      textLabel: "New folder, relative to the repository root",
      textValue: from,
      mono: true,
      selectLabel: "Applies to",
      options: [{ value: "all", label: affected.length + " recorded file" + (affected.length === 1 ? "" : "s") }],
      value: "all",
      confirmLabel: "Next",
      validate: (to) => {
        const t = to.trim();
        if (t === from) return "That is the same folder.";
        if (t.includes("\\")) return "Use forward slashes.";
        if (/^([a-zA-Z]:|\/)/.test(t)) return "Must be relative to the repository root.";
        if (t.split("/").some((seg) => seg === "..")) return "Cannot point outside the root.";
        return null;
      }
    });
    if (!answer) return;
    const yes = await confirmChecked({
      title: "Rewrite these paths?",
      html: '<p class="kmtext">' + affected.length + " recorded path" + (affected.length === 1 ? "" : "s") + ' will change:</p><p class="kmtext"><code>' + esc(from) + "</code> &rarr; <code>" + esc(answer.text.trim() || "(repository root)") + '</code></p><p class="kmnote">Only what Jira records changes. No file is moved.</p>',
      checkboxLabel: "The files have already been moved on disk.",
      confirmLabel: "Rewrite"
    });
    if (!yes) return;
    await apply2(
      taskKey,
      (m) => rebasePaths(m, { from, to: answer.text.trim() }),
      affected.length + " path" + (affected.length === 1 ? "" : "s") + " rewritten",
      done
    );
  }
  async function renameItem(taskKey, assetId, index, raw, currentName, currentEstimate, currentPriority, done) {
    const levels = ["Highest", "High", "Medium", "Low", "Lowest"];
    const known = currentPriority && !levels.includes(currentPriority) ? [currentPriority, ...levels] : levels;
    const answer = await chooseText({
      title: "Edit this item",
      note: "The name changes in the Jira checklist and on the model recorded against it. The estimate is written after the name as [30m] and the priority in front of it. Anything else on that line \u2014 a due date, an assignee \u2014 is left alone.",
      label: "Name",
      value: currentName,
      confirmLabel: "Save",
      validate: (name2) => name2.trim() ? null : "An item needs a name.",
      second: {
        label: "Estimate",
        value: currentEstimate ? formatEstimate(currentEstimate) : "",
        placeholder: "30m, 1h 30m \u2014 or blank for none",
        validate: (text) => !text.trim() || parseDuration(text) !== null ? null : "Write it as a duration: 30m, 1h 30m, 2h."
      },
      choice: {
        label: "Priority",
        options: [{ value: "", label: "None" }, ...known.map((p) => ({ value: p, label: p }))],
        value: currentPriority ?? ""
      }
    });
    if (!answer || "extra" in answer) return;
    const name = answer.text.trim();
    const estimate = answer.second?.trim() ? parseDuration(answer.second) : null;
    const priority = answer.choice || null;
    const renamed = name !== currentName.trim();
    const retimed = (estimate ?? null) !== (currentEstimate ?? null);
    const reranked = priority !== (currentPriority || null);
    if (!renamed && !retimed && !reranked) return;
    try {
      await renameChecklistItem(
        taskKey,
        index,
        raw,
        name,
        retimed ? estimate : void 0,
        reranked ? priority : void 0
      );
    } catch (e) {
      if (e?.name === "ChecklistDrift") {
        done();
        await showMessage(
          "Nothing was written",
          `${String(e.message)}

The checklist has been reloaded \u2014 try the rename again.`
        );
        return;
      }
      await showMessage("Could not edit the item", String(e?.message || e));
      return;
    }
    if (renamed) {
      try {
        await updateAssetMap(taskKey, (m) => {
          const asset = m.assets[assetId];
          if (!asset) return m;
          return { ...m, assets: { ...m.assets, [assetId]: { ...asset, item: name } } };
        });
      } catch {
        toast(
          "Renamed in Jira; the recorded model still carries the old name",
          4e3
        );
        done();
        return;
      }
    }
    toast(renamed ? "Renamed to " + name : retimed ? estimate ? `Estimate set to ${formatEstimate(estimate)}` : "Estimate removed" : priority ? `Priority set to ${priority}` : "Priority removed", 2500);
    done();
  }
  async function linkIntoVariant(ref, root, map, me, done) {
    const asset = map.assets[ref.assetId];
    if (!asset) return;
    const names = Object.keys(asset.variants);
    if (!names.length) {
      await showMessage(
        "No variants yet",
        "Name this model\u2019s variant first, then link a file into it."
      );
      return;
    }
    const open = openProject();
    const openPath = open?.path ? relativeTo(toPosix(root), open.path) : null;
    const answer = await chooseTextAndSelect({
      title: "Link into a variant",
      note: "Records a .bbmodel as a file of the variant you pick, and stamps that variant into the file so it is recognised next time. Leave the path as it is to use the open model, or browse for another \u2014 browsing opens it first, because stamping means writing to it.",
      textLabel: "File, relative to the repository root",
      textValue: openPath ?? "",
      textPlaceholder: "browse, or open the model first",
      mono: true,
      selectLabel: "Variant",
      options: names.map((n) => ({
        value: n,
        label: (n || "unnamed") + describeFill(asset.variants[n].files)
      })),
      value: names[0],
      confirmLabel: "Link",
      onBrowse: () => browseInsideRoot(root),
      validate: (path) => {
        const p = path.trim();
        if (!p) return "Pick a file, or open the model in Blockbench first.";
        if (!/\.bbmodel$/i.test(p)) return "That is not a .bbmodel.";
        if (p.includes("\\")) return "Use forward slashes.";
        if (/^([a-zA-Z]:|\/)/.test(p)) return "Must be relative to the repository root.";
        return null;
      }
    });
    if (!answer) return;
    const chosen = answer.text.trim();
    if (chosen !== openPath) {
      try {
        await openModelFile(toNative(resolveIn(root, chosen)));
      } catch (e) {
        await showMessage("Could not open that model", String(e?.message || e));
        return;
      }
    }
    const nowOpen = openProject();
    if (nowOpen?.assetId && nowOpen.assetId !== ref.assetId) {
      await showMessage(
        "That is a different model",
        "That file already carries another model\u2019s identity. Linking it here would record one file as two different models."
      );
      return;
    }
    try {
      const result = await linkOpenProject({
        taskKey: ref.taskKey,
        itemText: asset.item,
        root,
        me,
        cloudId: auth.cloudId(),
        variant: answer.value
      });
      toast(
        "Linked " + result.path + " as " + (answer.value || "unnamed") + " " + result.version,
        2500
      );
      done();
    } catch (e) {
      await showMessage("Could not link that file", String(e?.message || e));
    }
  }
  async function browseInsideRoot(root) {
    const picked = await pickFile({
      title: "Which .bbmodel?",
      startPath: root,
      extensions: ["bbmodel"],
      typeName: "Blockbench Model"
    });
    if (!picked) return null;
    return await insideRoot(root, picked, "file") || null;
  }
  function describeFill(files) {
    const n = Object.keys(files).length;
    if (!n) return " \u2014 empty";
    return " \u2014 " + n + " version" + (n === 1 ? "" : "s");
  }
  async function deleteVariant(ref, map, done) {
    const asset = map.assets[ref.assetId];
    const variant = asset?.variants[ref.variant];
    if (!asset || !variant) return;
    const names = Object.keys(asset.variants);
    const paths = Object.values(variant.files).map((f) => f.path);
    const last2 = names.length === 1;
    const yes = await confirmChecked({
      title: "Remove the " + (ref.variant || "unnamed") + " variant?",
      html: (paths.length ? '<p class="kmtext">' + paths.length + " recorded file" + (paths.length === 1 ? "" : "s") + " will stop being recorded against " + esc(ref.taskKey) + ':</p><p class="kmtext">' + paths.map((p) => "<code>" + esc(p) + "</code>").join("<br>") + "</p>" : '<p class="kmtext">This variant has no files recorded against it.</p>') + (last2 ? '<p class="kmnote">It is the only variant, so the model itself stops being recorded on this task.</p>' : "") + '<p class="kmnote">No file is deleted, moved or changed. Each keeps the identity written inside it, so any of them may be suggested again.</p>',
      checkboxLabel: paths.length ? "I know these files do not belong to this model." : "Remove this variant.",
      confirmLabel: "Remove variant"
    });
    if (!yes) return;
    await apply2(
      ref.taskKey,
      (m) => removeVariant(m, ref.assetId, ref.variant),
      "Removed the " + (ref.variant || "unnamed") + " variant",
      done
    );
  }

  // src/ui/workflow.ts
  async function move(req, done) {
    const to = req.to.toLowerCase();
    let comment;
    if (to === "blocked") {
      const reason = await askReason(req.taskKey);
      if (reason === null) return;
      comment = reason;
    } else if (to === "needs changes") {
      if (req.targets?.length && req.postFeedback) {
        const picked = await chooseTextAndMany({
          title: `Send ${req.taskKey} back?`,
          note: "This is the feedback round. What you write is posted against each model you pick, and it is what the artist works from.",
          textLabel: "What needs changing?",
          placeholder: "Handle is too thin against the body.",
          pickLabel: "Which need work? At least one.",
          options: req.targets.map((t) => ({
            value: `${t.kind}:${t.id}`,
            label: t.label,
            checked: t.checked ?? req.targets.length === 1
          })),
          confirmLabel: "Send back",
          validate: (text, chosen) => !text.trim() ? "Say what needs changing \u2014 the artist works from this." : !chosen.length ? "Pick at least one model." : null
        });
        if (!picked) return;
        const targets = req.targets.filter((t) => picked.chosen.includes(`${t.kind}:${t.id}`));
        for (const t of targets) await req.postFeedback(t.kind, t.id, picked.text);
        comment = `Sent back with notes on: ${targets.map((t) => t.label).join(", ")}`;
      } else {
        const feedback2 = await askFeedback(req.taskKey, req.postFeedback ? "Expand the task first to aim the note at one of its models; posted from here it goes on the task as a whole." : "");
        if (feedback2 === null) return;
        comment = feedback2;
      }
    } else if (to === "complete") {
      const yes = await confirmHtml(
        `Approve and close ${req.taskKey}?`,
        '<p class="kmtext">The work is accepted and the task is finished.</p>',
        "Approve & close"
      );
      if (!yes) return;
    } else if (to === "in progress" && req.from.toLowerCase() === "blocked") {
      const note = await askUnblockNote(req.taskKey);
      if (note === null) return;
      if (note) comment = note;
    } else if (to === "in progress" && req.from.toLowerCase() === "qa") {
      const yes = await confirmHtml(
        `Withdraw ${req.taskKey} from QA?`,
        '<p class="kmtext">It leaves the lead\u2019s queue and goes back to In Progress. Send it to QA again when it is ready.</p>',
        "Withdraw"
      );
      if (!yes) return;
    }
    const startsTimer = to === "in progress" && !!req.timer && runningTimer()?.issueKey !== req.taskKey;
    if (startsTimer) {
      const yes = await confirmTimerStart({
        title: `Start work on ${req.taskKey}?`,
        lead: '<p class="kmtext">Moves it to <b>In Progress</b> and starts the timer. Time on the clock is billed, so stop it when you step away.</p>',
        confirmLabel: "\u25B6 Start work"
      });
      if (!yes) return;
    }
    try {
      await applyTransition(req.taskKey, req.transition.id, { comment });
    } catch (e) {
      const retry = await confirmHtml(
        `${req.taskKey} did not move`,
        `<p class="kmtext">Jira refused the move to ${esc(req.to)}:</p><p class="kmtext">${esc(String(e?.message || e))}</p>`,
        "Try again"
      );
      if (retry) await move(req, done);
      return;
    }
    toast(`${req.taskKey} \u2192 ${req.to}`, 2500);
    done();
    if (startsTimer) {
      await beginTimer(
        req.taskKey,
        req.summary ?? req.taskKey,
        done,
        req.timer.runningFor,
        null,
        `${req.taskKey} is In Progress, but the timer did not start`
      );
    }
    if (to === "qa" && req.mine !== false) await offerPush(req);
  }
  async function askReason(taskKey) {
    const answer = await chooseTextAndSelect({
      title: `Why is ${taskKey} blocked?`,
      note: "This is posted as a comment on the task, which is what a lead reads when deciding how to unblock it. Jira requires it.",
      textLabel: "Reason",
      textValue: "",
      textPlaceholder: "Waiting on the rig from AINU-20",
      multiline: true,
      selectLabel: "Applies to",
      options: [{ value: "task", label: "this task" }],
      value: "task",
      confirmLabel: "Block",
      validate: (text) => text.trim() ? null : "Say why it is blocked \u2014 Jira will not accept it empty."
    });
    return answer ? answer.text.trim() : null;
  }
  async function askFeedback(taskKey, hint = "") {
    const answer = await chooseTextAndSelect({
      title: `Send ${taskKey} back?`,
      note: "This is the feedback round. What you write is posted as a comment, and it is what the artist works from." + (hint ? ` ${hint}` : ""),
      textLabel: "What needs changing",
      textValue: "",
      textPlaceholder: "The handle clips through the barrel at frame 12",
      multiline: true,
      selectLabel: "Applies to",
      options: [{ value: "task", label: "this task" }],
      value: "task",
      confirmLabel: "Send back",
      validate: (text) => text.trim() ? null : "Say what needs changing."
    });
    return answer ? answer.text.trim() : null;
  }
  async function askUnblockNote(taskKey) {
    const answer = await chooseTextAndSelect({
      title: `Resume ${taskKey}`,
      note: "If this was blocked, say what changed. The note is posted under the original reason so the thread reads in order. Leave it empty to just move on.",
      textLabel: "Note (optional)",
      textValue: "",
      textPlaceholder: "Rig landed, carrying on",
      multiline: true,
      selectLabel: "Applies to",
      options: [{ value: "task", label: "this task" }],
      value: "task",
      confirmLabel: "Resume"
    });
    return answer ? answer.text.trim() : null;
  }
  async function offerPush(req) {
    const paths = req.map ? allPaths(req.map) : [];
    if (!paths.length) return;
    if (req.git && req.git.ahead === 0 && !req.git.dirty) return;
    const listed = paths.slice(0, 6).map((p) => `<code>${esc(p)}</code>`).join("<br>");
    const more = paths.length > 6 ? `<br>and ${paths.length - 6} more` : "";
    const known = !!req.git;
    const n = paths.length;
    if (!req.root) {
      await showMessage(
        "Make sure these are pushed",
        `${req.taskKey} is with the next person now, and its ${n} file${n === 1 ? "" : "s"} only reach them once pushed. Set a repository root for this client and Kumonga can open the folder or GitHub Desktop from here.`
      );
      return;
    }
    const answer = await chooseAction({
      title: known ? "Push these files?" : "Are these pushed?",
      html: `<p class="kmtext">${esc(req.taskKey)} is with the next person now. ` + (known ? `Its ${n} file${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} not pushed yet` + (req.git.dirty ? " \u2014 there are uncommitted changes" : "") + ":</p>" : `Make sure its ${n} file${n === 1 ? "" : "s"} ${n === 1 ? "has" : "have"} been pushed:</p>`) + `<p class="kmtext">${listed}${more}</p><p class="kmnote">Kumonga does not push for you \u2014 the commit is yours to write. This just opens the tool.</p>`,
      choices: [
        // Not "Later": nothing follows later. The honest third answer is that it
        // is already done.
        { value: "done", label: "Already pushed" },
        { value: "folder", label: "Open folder" },
        { value: "desktop", label: "GitHub Desktop" }
      ]
    });
    if (answer === "desktop") openGitHubDesktop(req.root);
    else if (answer === "folder") openFolder(req.root);
  }
  function openGitHubDesktop(root) {
    const repo = repoFor(root);
    if (!repo?.remote) {
      toast("This repository has no remote, so GitHub Desktop cannot open it \u2014 showing the folder instead", 4e3);
      openFolder(root);
      return;
    }
    try {
      nodeRequire("shell").openExternal(gitHubDesktopUrl(repo.remote));
    } catch {
      toast("GitHub Desktop did not open \u2014 showing the folder instead", 3500);
      openFolder(root);
    }
  }
  function openFolder(root) {
    try {
      nodeRequire("shell").openPath(toNative(root));
    } catch (e) {
      void showMessage("Could not open the folder", String(e?.message || e));
    }
  }
  async function blockedReason(taskKey) {
    try {
      const c = await latestComment(taskKey);
      if (!c?.text) return null;
      return `${c.author}: ${c.text.split("\n")[0]}`;
    } catch {
      return null;
    }
  }

  // src/debug/impersonate.ts
  function viewingAs() {
    return settings().debugViewAs ?? null;
  }
  function isImpersonating() {
    return !!viewingAs();
  }
  function effectiveAccountId(real) {
    return viewingAs()?.accountId ?? real;
  }
  function blockedReason2() {
    if (!isImpersonating()) return null;
    if (settings().debugAllowWrites) return null;
    const who = viewingAs().name;
    return `Read-only is on, so Kumonga is showing ${who}'s work without letting anything change.

Turn writes back on from the Kumonga menu, or stop viewing as them.`;
  }
  function timerAccount() {
    return viewingAs()?.accountId ?? null;
  }
  async function assignableUsers(projectKey) {
    const rows = await api(
      `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=100`
    );
    return (Array.isArray(rows) ? rows : []).filter((u) => u?.accountId && u?.accountType === "atlassian").map((u) => ({ accountId: String(u.accountId), name: String(u.displayName || u.accountId) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function openViewAsPicker(projectKey, realAccountId2, done) {
    let users;
    try {
      users = await assignableUsers(projectKey);
    } catch (e) {
      await showMessage("Could not list users", String(e?.message || e));
      return;
    }
    if (!users.length) {
      await showMessage(
        "Nobody to view as",
        `Jira returned no assignable users for ${projectKey}.`
      );
      return;
    }
    const choice = await chooseOne({
      title: "Debug: view as",
      note: "Shows their work, their QA queue and their timesheet, and lets you act. Timers run as them; Jira changes are recorded as you.",
      label: "Artist",
      options: users.map((u) => ({
        value: u.accountId,
        label: u.accountId === realAccountId2 ? `${u.name} (you \u2014 stop pretending)` : u.name
      })),
      value: viewingAs()?.accountId ?? users[0].accountId,
      confirm: "View as"
    });
    if (choice === null) return;
    if (choice === realAccountId2) {
      stopViewingAs();
      done();
      return;
    }
    const who = users.find((u) => u.accountId === choice);
    saveSettings({ debugViewAs: who ?? null, debugAllowWrites: true });
    toast(`Viewing as ${who?.name ?? "someone else"}`, 3e3);
    done();
  }
  function stopViewingAs() {
    saveSettings({ debugViewAs: null, debugAllowWrites: false });
    toast("Back to your own work", 2e3);
  }
  async function toggleWrites(done) {
    if (settings().debugAllowWrites) {
      saveSettings({ debugAllowWrites: false });
      toast("Read-only: nothing here will change anything", 2500);
      done();
      return;
    }
    const who = viewingAs()?.name ?? "someone else";
    const yes = await confirmChecked({
      title: "Act as " + who + " again?",
      html: `<p class="kmtext">Timers will run against <b>${escapeHtml2(who)}</b>'s Clockwork account, which is genuinely theirs.</p><p class="kmtext">Everything in Jira \u2014 transitions, comments, checklist ticks, manual worklogs \u2014 uses YOUR account, because Jira has no way to act as somebody else over OAuth. Those land on their task attributed to you, on the real board.</p><p class="kmnote">A debugging switch on live data. There is no sandbox behind it.</p>`,
      checkboxLabel: "I understand Jira changes will show my name, not theirs.",
      confirmLabel: "Allow changes"
    });
    if (!yes) return;
    saveSettings({ debugAllowWrites: true });
    done();
  }
  var escapeHtml2 = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  // src/ui/panel.ts
  var state = {
    projects: [],
    tasks: [],
    expanded: null,
    loading: false,
    error: null,
    fetchedAt: null,
    complete: true,
    detail: null,
    disk: null,
    page: "work",
    leadScopes: [],
    qa: null,
    board: { overview: null, done: null },
    leads: [],
    viewingLead: null,
    time: null,
    menu: null,
    menuAt: null,
    debugMenuAt: null,
    git: null,
    signingIn: false,
    transitions: {},
    itemMenu: null,
    itemMenuAt: null,
    review: null,
    reviewTarget: null
  };
  function findTask(key) {
    return state.tasks.find((t) => t.key === key) ?? state.qa?.queue.find((t) => t.key === key) ?? state.qa?.partial?.find((t) => t.key === key) ?? state.qa?.cleared.find((t) => t.key === key) ?? state.board.overview?.tasks.find((t) => t.key === key) ?? state.board.done?.tasks.find((t) => t.key === key) ?? null;
  }
  var realAccountId = null;
  var meAccountId = null;
  var shotCache = {};
  var barReview = null;
  var RETRY_REVIEW_MS = 6e4;
  var shotFailedAt = {};
  var barMenu = null;
  var menuActions = [];
  var child = null;
  var childRoot = null;
  var themeWatcher = null;
  function syncStyles() {
    if (!child || child.closed) return;
    const doc = child.document;
    for (const node of Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
      node.remove();
    }
    for (const node of Array.from(
      document.head.querySelectorAll('style, link[rel="stylesheet"]')
    )) {
      doc.head.appendChild(node.cloneNode(true));
    }
    doc.documentElement.setAttribute("style", document.documentElement.getAttribute("style") || "");
    doc.documentElement.className = document.documentElement.className;
    doc.body.className = document.body.className;
    const own = doc.createElement("style");
    own.textContent = ALL_CSS + TITLEBAR_CSS + `
    html,body{margin:0;padding:0;overflow:hidden;
      background:var(--color-ui);color:var(--color-text);}
    body{font-family:var(--font-main, "Inter", system-ui, sans-serif);}`;
    doc.head.appendChild(own);
  }
  function watchTheme() {
    themeWatcher?.disconnect();
    themeWatcher = new MutationObserver(() => syncStyles());
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    themeWatcher.observe(document.head, { childList: true });
  }
  var pendingOpen = false;
  function detach() {
    if (child && !child.closed) {
      if (child.document.hasFocus()) {
        child.focus();
        return;
      }
      trace("detach: window open but not in front \u2014 reopening in front");
      closeChild("user");
    }
    saveSettings({ detached: true });
    const name = "kumonga_" + Date.now().toString(36);
    child = window.open(
      "",
      name,
      // 460 fitted a work list; a checklist row now carries a state, a priority,
      // a name, a clip state, its time, a timer and a pencil, and was clipping.
      "width=640,height=900,frame=false,autoHideMenuBar=yes,title=Kumonga"
    );
    trace(`detach: window.open(${name}) -> ${child ? "window" : "null"}`);
    if (!child) {
      if (!pendingOpen) {
        pendingOpen = true;
        document.addEventListener("pointerdown", function retry() {
          document.removeEventListener("pointerdown", retry);
          pendingOpen = false;
          if (settings().detached) detach();
        }, { once: true });
        toast("Kumonga opens on your next click", 3e3);
      }
      return;
    }
    child.document.title = "Kumonga";
    child.document.body.innerHTML = '<div class="wbar"><span class="wtitle">Kumonga</span><span class="wbtns"><button class="wbtn" data-win="max" title="Maximise">&#9723;</button><button class="wbtn close" data-win="close" title="Close">&#10005;</button></span></div><div class="embody" id="embody_jira_root"></div>';
    syncStyles();
    watchTheme();
    child.document.querySelector(".wbtns")?.addEventListener("click", onWindowButton);
    setModalHost(child.document);
    childRoot = child.document.getElementById("embody_jira_root");
    childRoot?.addEventListener("click", onClick4);
    childRoot?.addEventListener("change", onChange);
    child.addEventListener("focus", onFocus);
    window.addEventListener("beforeunload", closeOnQuit);
    window.addEventListener("beforeunload", warnAboutTimer);
    window.addEventListener("beforeunload", warnAboutUnpushed);
    const me = child;
    child.addEventListener("beforeunload", () => {
      trace(`child beforeunload, closing=${closing}${child === me ? "" : " (superseded window)"}`);
      if (closing === null) saveSettings({ detached: false });
      closing = null;
      if (child !== me) return;
      setModalHost(null);
      themeWatcher?.disconnect();
      themeWatcher = null;
      child = null;
      childRoot = null;
    });
    render();
    void load();
  }
  var restoreBounds = null;
  function onWindowButton(ev) {
    const btn = ev.target.closest("[data-win]");
    if (!btn || !child || child.closed) return;
    if (btn.dataset.win === "close") {
      closeChild("user");
      render();
      return;
    }
    if (restoreBounds) {
      child.moveTo(restoreBounds.x, restoreBounds.y);
      child.resizeTo(restoreBounds.w, restoreBounds.h);
      restoreBounds = null;
      btn.title = "Maximise";
    } else {
      restoreBounds = {
        x: child.screenX,
        y: child.screenY,
        w: child.outerWidth,
        h: child.outerHeight
      };
      const scr = child.screen;
      child.moveTo(scr.availLeft ?? 0, scr.availTop ?? 0);
      child.resizeTo(child.screen.availWidth, child.screen.availHeight);
      btn.title = "Restore";
    }
  }
  var closing = null;
  function closeChild(reason = "teardown") {
    trace(`closeChild(${reason}) child=${child ? child.closed ? "closed" : "open" : "none"}`);
    closing = reason;
    if (reason === "user") saveSettings({ detached: false });
    setModalHost(null);
    themeWatcher?.disconnect();
    themeWatcher = null;
    try {
      child?.close();
    } catch {
    }
    child = null;
    childRoot = null;
  }
  var quitAllowed = false;
  var quitPrompting = false;
  function warnAboutTimer(ev) {
    const timer = runningTimer();
    if (!timer || quitAllowed) return;
    ev.preventDefault();
    ev.returnValue = `A timer is still running on ${timer.issueKey}.`;
    if (quitPrompting) return;
    quitPrompting = true;
    setTimeout(() => {
      void chooseAction({
        title: `A timer is running on ${timer.issueKey}`,
        html: '<p class="kmtext">Clockwork keeps timing whether or not Blockbench is open \u2014 quitting does not stop it, and the hours keep accruing.</p><p class="kmnote">Kumonga will remember it and ask about it next launch.</p>',
        choices: [
          { value: "stay", label: "Don't quit" },
          { value: "leave", label: "Leave it running and quit" },
          { value: "stop", label: "Stop and log\u2026" }
        ]
      }).then((answer) => {
        quitPrompting = false;
        const quit = () => {
          quitAllowed = true;
          window.close();
        };
        if (answer === "leave") quit();
        else if (answer === "stop") void stopFor(timer.issueKey, meAccountId, quit, timerAccount());
      });
    }, 0);
  }
  var pushAllowed = false;
  var pushPrompting = false;
  function warnAboutUnpushed(ev) {
    if (pushAllowed || quitPrompting) return;
    if (!repositoriesToCheck().length) return;
    ev.preventDefault();
    ev.returnValue = "Checking for work that has not been pushed.";
    if (pushPrompting) return;
    pushPrompting = true;
    setTimeout(async () => {
      const quit = () => {
        pushAllowed = true;
        window.close();
      };
      const rows = await unpushedRepositories();
      if (!rows.length) {
        pushPrompting = false;
        quit();
        return;
      }
      const answer = await openQuitDialog(rows, {
        openDesktop: (r) => {
          if (r.remote) {
            try {
              nodeRequire("shell").openExternal(gitHubDesktopUrl(r.remote));
              return;
            } catch {
            }
          }
          try {
            nodeRequire("shell").openPath(toNative(r.root));
          } catch {
          }
        },
        recheck: () => unpushedRepositories()
      });
      pushPrompting = false;
      if (answer === "quit") quit();
    }, 0);
  }
  function repositoriesToCheck() {
    const keys = new Set(state.projects.map((p) => p.key));
    const client = settings().client;
    if (client && !isAggregate(client)) keys.add(client);
    for (const t of state.tasks) keys.add(t.projectKey);
    const byRoot = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const root = getRoot(key);
      if (!root) continue;
      const repo = repoFor(root);
      if (!repo) continue;
      const entry = byRoot.get(repo.root) ?? { root: repo.root, projects: [], remote: repo.remote ?? null };
      entry.projects.push({ key, name: state.projects.find((p) => p.key === key)?.name ?? key });
      byRoot.set(repo.root, entry);
    }
    return [...byRoot.values()];
  }
  async function unpushedRepositories() {
    const budget = new Promise((r) => setTimeout(() => r(null), 6e3));
    const checks = repositoriesToCheck().map(async (r) => {
      const st = await Promise.race([branchState(r.root).catch(() => null), budget]);
      if (!st || st.ahead < 1 && !st.dirty) return null;
      return {
        projects: r.projects,
        root: r.root,
        branch: st.branch,
        ahead: st.ahead,
        dirty: st.dirty,
        remote: r.remote,
        local: !st.upstream
      };
    });
    return (await Promise.all(checks)).filter((r) => r !== null);
  }
  var closeOnQuit = () => {
    const timerClear = !runningTimer() || quitAllowed;
    const pushClear = pushAllowed || !repositoriesToCheck().length;
    if (timerClear && pushClear) closeChild("teardown");
  };
  function viewModel() {
    const s = settings();
    return {
      signedIn: auth.isSignedIn(),
      loading: state.loading,
      error: state.error,
      fetchedAt: state.fetchedAt,
      complete: state.complete,
      tasks: state.tasks,
      expanded: state.expanded,
      projects: state.projects,
      client: s.client,
      components: s.components,
      lanes: s.lanes,
      showAll: s.showAll,
      hasRoot: !!currentRoot(),
      aggregate: isAggregate(s.client),
      // Only projects actually on screen: an unset root for a project with no
      // work in it is not a problem anybody needs telling about.
      rootsMissing: [...new Set(
        state.tasks.filter((t) => !getRoot(t.projectKey)).map((t) => t.projectKey)
      )].sort(),
      page: state.page,
      leadComponents: state.leadScopes.flatMap((sc) => sc.components),
      qa: state.qa,
      board: state.board,
      time: state.time,
      leads: state.leads,
      viewingLead: state.viewingLead,
      me: meAccountId,
      detail: state.detail,
      menu: state.menu,
      menuAt: state.menuAt,
      debugMenuAt: state.debugMenuAt,
      git: state.git,
      clockwork: hasClockwork(),
      viewingAs: viewingAs() ? { name: viewingAs().name, writes: settings().debugAllowWrites } : null,
      timer: (() => {
        const t = runningTimer();
        return t ? { ...t, elapsed: Math.max(0, (Date.now() - t.startedAt) / 1e3) } : null;
      })(),
      externalTimer: externalTimerKey(),
      debug: settings().debug,
      vaultReason: vault.available() ? null : vault.unavailableReason(),
      transitions: state.transitions,
      review: state.review,
      reviewTarget: state.reviewTarget,
      shots: loadedShots(),
      itemMenu: state.itemMenu,
      itemMenuAt: state.itemMenuAt,
      signingIn: state.signingIn,
      detached: !!(child && !child.closed)
    };
  }
  var MENU_WIDTH = 186;
  function clampMenu() {
    if (!child || child.closed || !childRoot) return;
    const el = childRoot.querySelector(".kmenu");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = child.innerWidth;
    const h = child.innerHeight;
    let left = r.left;
    let top = r.top;
    if (left + r.width > w - 4) left = w - r.width - 4;
    if (left < 4) left = 4;
    if (top + r.height > h - 4) top = Math.max(4, top - r.height - 20);
    const box = el;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }
  var tickTimer = null;
  function startTicking() {
    stopTicking();
    tickTimer = setInterval(() => {
      const t = runningTimer();
      updateNag();
      if (!t || !childRoot) return;
      const elapsed = (Date.now() - t.startedAt) / 1e3;
      for (const el of Array.from(childRoot.querySelectorAll("[data-el]"))) {
        el.textContent = formatElapsed(elapsed);
      }
      for (const el of Array.from(childRoot.querySelectorAll("[data-el-base]"))) {
        el.textContent = formatDuration(Number(el.dataset.elBase || 0) + elapsed);
      }
    }, 1e3);
  }
  function stopTicking() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }
  function render() {
    updateNag();
    updateReviewBar();
    if (!childRoot || !child || child.closed) return;
    try {
      childRoot.innerHTML = renderPanel(viewModel());
    } catch (e) {
      const msg = String(e?.stack || e?.message || e);
      trace(`render failed: ${msg}`);
      childRoot.innerHTML = '<div class="err">Kumonga could not draw this screen. The details are in the load report.<br><small>' + esc(msg.split("\n")[0]) + "</small></div>";
      return;
    }
    clampMenu();
  }
  var POLL_FOCUSED_MS = 6e4;
  var POLL_UNFOCUSED_MS = 3e5;
  var pollTimer = null;
  function scheduleNextPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    const focused = document.hasFocus() || !!(child && !child.closed && !child.document.hidden);
    pollTimer = setTimeout(tick, focused ? POLL_FOCUSED_MS : POLL_UNFOCUSED_MS);
  }
  async function tick() {
    if (auth.isSignedIn() && !state.loading && !modalOpen()) await load();
    scheduleNextPoll();
  }
  function startPolling() {
    stopPolling();
    window.addEventListener("focus", onFocus);
    scheduleNextPoll();
  }
  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    window.removeEventListener("focus", onFocus);
  }
  function onFocus() {
    const stale = !state.fetchedAt || Date.now() - state.fetchedAt > POLL_FOCUSED_MS;
    if (stale && auth.isSignedIn() && !state.loading) void load();
    void checkGit(true);
    scheduleNextPoll();
  }
  function readClips(task2, map, rootPath, disk) {
    if (!task2 || !rootPath || !map) return null;
    if (!sharesOneFile(animationShape(task2, null))) return null;
    const paths = [];
    for (const asset of Object.values(map.assets ?? {})) {
      for (const file2 of allFiles(asset)) paths.push(file2.path);
    }
    const rel = linkedOnDisk(paths, disk);
    if (!rel) return null;
    const open = openProject();
    if (open?.path === rel) {
      const live = openProjectClips();
      if (live) return { path: rel, names: live, live: true };
    }
    return { path: rel, names: clipsOf(toNative(resolveIn(rootPath, rel))) };
  }
  async function loadDetail(key) {
    const task2 = findTask(key);
    const rootPath = rootForTask(task2);
    const base = () => ({
      key,
      loading: false,
      error: null,
      map: null,
      disk: state.disk ?? [],
      me: meAccountId,
      hasRoot: !!rootPath,
      openAsset: null
    });
    state.detail = { ...base(), loading: true };
    render();
    try {
      if (rootPath && !state.disk) state.disk = scanRoot(rootPath);
      const names = (task2?.checklist ?? []).map((i) => i.name);
      const [map, logs] = await Promise.all([
        getAssetMap(key),
        names.length ? listJiraWorklogs(key).catch(() => null) : Promise.resolve([])
      ]);
      if (state.expanded !== key) return;
      state.detail = {
        ...base(),
        map,
        disk: state.disk ?? [],
        clips: readClips(task2, map, rootPath, state.disk ?? []),
        itemTime: logs ? itemSeconds(names, logs) : null
      };
    } catch (e) {
      if (state.expanded !== key) return;
      state.detail = { ...base(), error: e?.message || String(e) };
    }
    render();
  }
  function openModel(relative) {
    const rootPath = currentRoot();
    if (!rootPath || !relative) return;
    const absolute = toNative(resolveIn(rootPath, relative));
    try {
      Blockbench.read([absolute], {}, (files) => {
        if (!files?.length) {
          toast("Could not read that file", 3e3);
          return;
        }
        loadModelFile(files[0]);
      });
    } catch (e) {
      toast(`Could not open the model: ${e?.message || e}`, 4e3);
    }
  }
  function revealPath(relative) {
    const rootPath = currentRoot();
    if (!rootPath) return;
    try {
      const shell2 = nodeRequire("shell");
      const native = toNative(relative ? resolveIn(rootPath, relative) : rootPath);
      if (isWindows()) {
        try {
          const cp = nodeRequire("child_process");
          const arg = relative ? `/select,"${native}"` : `"${native}"`;
          cp.spawn("explorer.exe", [arg], {
            windowsVerbatimArguments: true,
            detached: true,
            stdio: "ignore"
          }).unref();
          return;
        } catch {
        }
      }
      if (relative) shell2.showItemInFolder(native);
      else shell2.openPath(native);
    } catch (e) {
      toast(`Could not open the folder: ${e?.message || e}`, 3e3);
    }
  }
  function openInGitHubDesktop() {
    const rootPath = currentRoot();
    if (!rootPath) return;
    const repo = repoFor(rootPath);
    if (!repo) {
      toast("That folder is not inside a git repository", 3e3);
      revealPath(null);
      return;
    }
    if (!repo.remote) {
      toast("This repository has no remote \u2014 opening the folder instead", 3500);
      revealPath(null);
      return;
    }
    try {
      nodeRequire("shell").openExternal(gitHubDesktopUrl(repo.remote));
    } catch (e) {
      toast(`Could not reach GitHub Desktop: ${e?.message || e}`, 3500);
      revealPath(null);
    }
  }
  function confirmRepair(req) {
    const how = req.how === "chosen" ? `<p class="kmtext">You picked this file for the record Jira holds.</p>` : `<p class="kmtext">This file identifies itself as the model Jira has recorded \u2014 it has moved.</p>`;
    void confirmHtml(
      "Update the recorded path?",
      how + `<p class="kmtext"><b>Recorded</b><br><code>${esc(req.oldPath)}</code></p><p class="kmtext"><b>Found</b><br><code>${esc(req.newPath)}</code></p><p class="kmnote">Only the record in Jira changes. The file itself is not touched.</p>`,
      "Update the record"
    ).then((yes) => {
      if (yes) void applyRepair(req);
    });
  }
  async function runLocate(req) {
    const root = currentRoot();
    if (!root) return;
    const picked = await pickFile({
      title: `Where is ${req.path || "this file"} now?`,
      startPath: root,
      extensions: ["bbmodel"],
      typeName: "Blockbench Model"
    });
    if (!picked) return;
    const inside = await insideRoot(root, picked, "file");
    if (!inside) return;
    const id = identityOf(toNative(picked));
    if (id.assetId && id.assetId !== req.assetId) {
      await showMessage(
        "That is a different model",
        "The file you picked identifies itself as another model. Recording it here would point this model at somebody else's file."
      );
      return;
    }
    if (id.variant !== void 0 && (id.variant || "") !== (req.variant || "")) {
      await showMessage(
        "That file belongs to another variant",
        `It is stamped as the "${id.variant || "unnamed"}" variant, and this record is "${req.variant || "unnamed"}".`
      );
      return;
    }
    confirmRepair({ ...req, oldPath: req.path ?? "", newPath: inside, how: "chosen" });
  }
  async function applyRepair(req) {
    try {
      await updateAssetMap(req.taskKey, (current22) => addFileToMap(current22, {
        assetId: req.assetId,
        item: null,
        // an existing item text always wins
        variant: req.variant,
        version: req.version,
        path: req.newPath,
        by: meAccountId ?? void 0,
        at: (/* @__PURE__ */ new Date()).toISOString()
      }));
      toast("Path updated", 2e3);
      await loadDetail(req.taskKey);
    } catch (e) {
      void showMessage("Could not update the path", e?.message || String(e));
    }
  }
  function currentRepo() {
    const root = currentRoot();
    return root ? repoFor(root)?.root ?? null : null;
  }
  var FETCH_FOCUSED_MS = 55e3;
  var FETCH_UNFOCUSED_MS = 10 * 60 * 1e3;
  var lastFetch = 0;
  var checking = false;
  function looking() {
    try {
      return document.hasFocus() || !!(child && !child.closed && !child.document.hidden);
    } catch {
      return false;
    }
  }
  async function checkGit(force = false) {
    const repo = currentRepo();
    if (!repo) {
      state.git = null;
      return;
    }
    if (checking) return;
    checking = true;
    try {
      const every = looking() ? FETCH_FOCUSED_MS : FETCH_UNFOCUSED_MS;
      const allowed = force || settings().autoFetch;
      if (allowed && (force || Date.now() - lastFetch > every)) {
        await fetchRemote(repo);
        lastFetch = Date.now();
      }
      const st = await branchState(repo);
      if (currentRepo() !== repo) return;
      state.git = gitStateFrom(st, lastFetch || Date.now());
      render();
    } finally {
      checking = false;
    }
  }
  function gitStateFrom(st, checkedAt) {
    if (!st) return null;
    return {
      branch: st.branch,
      behind: st.behind,
      ahead: st.ahead,
      dirty: st.dirty,
      pulling: false,
      error: null,
      ...checkedAt ? { checkedAt } : {}
    };
  }
  async function runPull() {
    const repo = currentRepo();
    if (!repo || !state.git || state.git.pulling) return;
    const g = state.git;
    const yes = await confirmHtml(
      `Pull ${g.behind} commit${g.behind === 1 ? "" : "s"} into ${g.branch}?`,
      `<p class="kmtext">This runs <code>git pull --ff-only</code> and changes files on disk. A model you have open in Blockbench can be replaced underneath you \u2014 save first if you are mid-edit.</p>` + (g.dirty ? '<p class="kmnote">You have uncommitted changes. A fast-forward will refuse rather than overwrite them, but it may simply not go through.</p>' : "") + (g.ahead ? `<p class="kmnote">${g.ahead} commit${g.ahead === 1 ? "" : "s"} of yours are not pushed. Pulling does not push them.</p>` : ""),
      "Pull"
    );
    if (!yes) return;
    state.git = { ...state.git, pulling: true, error: null };
    render();
    const res = await pullFastForward(repo);
    if (res.ok) {
      toast("Pulled from origin", 2500);
      state.disk = null;
      state.git = gitStateFrom(await branchState(repo));
      render();
      if (state.expanded) void loadDetail(state.expanded);
      return;
    }
    state.git = {
      ...state.git,
      pulling: false,
      error: (res.err || res.out || "git pull failed").split("\n").slice(0, 3).join(" ")
    };
    render();
  }
  async function logTimeFromPanel() {
    const options = state.tasks.map((t) => ({ value: t.key, label: `${t.key} \u2014 ${t.summary}` }));
    if (!options.length) {
      void showMessage(
        "Nothing to log against",
        "Time is logged against a task, and there are none in your list right now."
      );
      return;
    }
    const key = await chooseOne({
      title: "Log time",
      note: "Which task was the time on?",
      label: "Task",
      options,
      value: state.expanded ?? options[0].value,
      confirm: "Next"
    });
    if (key === null) return;
    void openLogWork(key, meAccountId, () => {
      if (state.time) void loadTime(state.time.day);
    });
  }
  async function openTokenPage() {
    const url = tokenPageUrl(await auth.siteUrl());
    try {
      nodeRequire("shell").openExternal(url);
    } catch (e) {
      void showMessage(
        "Could not open the browser",
        `${String(e?.message || e)}

Open this instead:
${url}`
      );
    }
  }
  function isAggregate(client) {
    const key = settings().aggregateProject;
    return !!key && !!client && client === key;
  }
  function rootForTask(task2) {
    if (task2?.projectKey) return getRoot(task2.projectKey);
    const client = settings().client;
    return client && !isAggregate(client) ? getRoot(client) : null;
  }
  function currentRoot() {
    const expanded = state.expanded ? findTask(state.expanded) : null;
    if (expanded) return rootForTask(expanded);
    const client = settings().client;
    return client && !isAggregate(client) ? getRoot(client) : null;
  }
  function refFrom(el) {
    return {
      taskKey: el.dataset.key,
      assetId: el.dataset.asset,
      variant: el.dataset.variant ?? "",
      version: el.dataset.version,
      path: el.dataset.path
    };
  }
  async function reloadDetail(key) {
    state.disk = null;
    await loadDetail(key);
  }
  async function runNewVersion(el) {
    const key = el.dataset.key;
    const root = currentRoot();
    const map = state.detail?.key === key ? state.detail?.map : null;
    if (!root || !map) return;
    const ref = refFrom(el);
    const asset = map.assets[ref.assetId];
    const base = asset?.item || findTask(key)?.summary || key;
    const path = asset?.variants[ref.variant] ? Object.values(asset.variants[ref.variant].files)[0]?.path : void 0;
    await saveAsNewVersion({ ...ref, path }, root, base, map, () => void reloadDetail(key));
  }
  async function confirmUnlink(req) {
    const yes = await confirmChecked({
      title: "Remove this link?",
      html: `<p class="kmtext">Jira will no longer record this file against ${esc(req.taskKey)}.</p>` + (req.path ? `<p class="kmtext"><code>${esc(req.path)}</code></p>` : "") + '<p class="kmnote">The file is not deleted, moved or changed. It keeps the identity written inside it, so it may be suggested again as a match.</p>',
      // Not "I know this is the wrong file": removing a duplicate or a
      // mis-versioned entry is not that, and the checkbox forced a false statement.
      checkboxLabel: "Yes, take this file off the task.",
      confirmLabel: "Remove link"
    });
    if (!yes) return;
    try {
      await updateAssetMap(req.taskKey, (current22) => removeFileFromMap(current22, {
        assetId: req.assetId,
        variant: req.variant,
        version: req.version
      }));
      toast("Link removed", 2e3);
      state.disk = null;
      await loadDetail(req.taskKey);
    } catch (e) {
      void showMessage("Could not remove the link", e?.message || String(e));
    }
  }
  async function runCreate(taskKey, itemText) {
    const rootPath = rootForTask(findTask(taskKey));
    if (!rootPath) return;
    const task2 = findTask(taskKey);
    const base = itemText ?? task2?.summary ?? taskKey;
    const map = state.detail?.key === taskKey ? state.detail?.map ?? null : null;
    const siblings = map ? Object.values(map.assets).flatMap((a) => Object.values(a.variants).flatMap((v) => Object.values(v.files).map((f) => f.path))) : [];
    let disk = [];
    try {
      state.disk ??= scanRoot(rootPath);
      disk = state.disk.map((d) => d.path);
    } catch {
    }
    await openCreateDialog(
      {
        taskKey,
        itemText,
        base,
        root: rootPath,
        siblings,
        disk,
        // The breadcrumb names the area of the game, and the repository is laid
        // out by area — without it, "Food Items" landed in the busiest folder
        // in the repo rather than anywhere near Bree.
        context: [task2?.summary, task2?.parent, task2?.epic].filter((c) => !!c)
      },
      () => {
        state.disk = null;
        void runLink(taskKey, itemText);
      }
    );
  }
  async function runLink(taskKey, itemText) {
    const rootPath = rootForTask(findTask(taskKey));
    if (!rootPath) return;
    const open = openProject();
    const map = state.detail?.key === taskKey ? state.detail?.map ?? null : null;
    if (open?.assetId && map) {
      const claimedBy = map.assets[open.assetId]?.item ?? null;
      const target = itemText ?? null;
      if (map.assets[open.assetId] && (claimedBy ?? "") !== (target ?? "")) {
        await showMessage(
          "That is a different model",
          `The open project is ${claimedBy ? `"${claimedBy}"` : "already recorded on this task as another model"}. Open the model for ${target ? `"${target}"` : "this task"} first.`
        );
        return;
      }
    }
    const shownPath = open?.path ? relativeTo(rootPath, open.path) ?? open.path : null;
    const yes = await confirmHtml(
      "Record this file?",
      `<p class="kmtext">Records <code>${esc(shownPath ?? open?.name ?? "the open project")}</code> as <b>${esc(itemText ?? findTask(taskKey)?.summary ?? taskKey)}</b> on ${esc(taskKey)}.</p><p class="kmnote">The file is stamped with this model\u2019s identity and saved, then the path is written to Jira.</p>`,
      "Link it"
    );
    if (!yes) return;
    await linkOpenNow(taskKey, itemText, rootPath);
  }
  async function runLinkFile(taskKey, itemText) {
    const rootPath = rootForTask(findTask(taskKey));
    if (!rootPath) return;
    const target = itemText ?? findTask(taskKey)?.summary ?? taskKey;
    const picked = await pickFile({
      title: `Which file is ${target}?`,
      startPath: rootPath,
      extensions: ["bbmodel"],
      typeName: "Blockbench Model"
    });
    if (!picked) return;
    const relative = await insideRoot(rootPath, picked, "file");
    if (!relative) return;
    const id = identityOf(toNative(picked));
    const map = state.detail?.key === taskKey ? state.detail?.map ?? null : null;
    if (id.assetId && map?.assets[id.assetId]) {
      const claimedBy = map.assets[id.assetId].item ?? null;
      if ((claimedBy ?? "") !== (itemText ?? "")) {
        await showMessage(
          "That is a different model",
          `That file is ${claimedBy ? `"${claimedBy}"` : "already recorded on this task as another model"}. Pick the file for ${itemText ? `"${itemText}"` : "this task"} instead.`
        );
        return;
      }
    }
    const open = openProject();
    const alreadyOpen = open?.path === picked;
    const yes = await confirmHtml(
      "Record this file?",
      `<p class="kmtext">Records <code>${esc(relative)}</code> as <b>${esc(target)}</b> on ${esc(taskKey)}.</p>` + (alreadyOpen ? '<p class="kmnote">It is the open project. It is stamped with this model\u2019s identity and saved, then the path is written to Jira.</p>' : '<p class="kmnote">It is opened in Blockbench first \u2014 stamping means writing to it \u2014 then stamped with this model\u2019s identity and saved, then the path is written to Jira.</p>'),
      alreadyOpen ? "Link it" : "Open and link"
    );
    if (!yes) return;
    if (!alreadyOpen) {
      try {
        await openModelFile(toNative(picked));
      } catch (e) {
        await showMessage("Could not open that model", String(e?.message || e));
        return;
      }
      if (openProject()?.path !== picked) {
        await showMessage(
          "Nothing was linked",
          `${relative} did not become the open project, so it was not stamped or recorded.`
        );
        return;
      }
    }
    await linkOpenNow(taskKey, itemText, rootPath);
  }
  async function linkOpenNow(taskKey, itemText, rootPath) {
    const variant = await variantToLinkInto(taskKey, itemText);
    if (variant === CANCELLED) return;
    try {
      const result = await linkOpenProject({
        taskKey,
        itemText,
        root: rootPath,
        me: meAccountId,
        cloudId: auth.cloudId(),
        variant
      });
      toast(
        result.variant ? `Linked ${result.path} as ${result.variant}` : `Linked ${result.path}`,
        2500
      );
      state.disk = null;
      await loadDetail(taskKey);
    } catch (e) {
      void showMessage("Could not link that file", e?.message || String(e));
    }
  }
  var CANCELLED = Symbol("cancelled");
  async function variantToLinkInto(taskKey, itemText) {
    const map = state.detail?.key === taskKey ? state.detail?.map ?? null : null;
    if (!map) return void 0;
    const found = itemText ? assetForItem(map, itemText) : null;
    const asset = found?.[1];
    if (!asset) return void 0;
    const stamped = openProject()?.variant ?? null;
    const target = variantForLink(asset, stamped);
    if ("variant" in target) return target.variant;
    const choice = await chooseOne({
      title: "Which variant is this?",
      note: `${asset.item ?? "This model"} has ${variantsOf(asset).length} variants. The file carries no variant of its own, so pick the one it belongs to.`,
      label: "Variant",
      options: target.choices.map((v) => ({ value: v, label: v || "unnamed" })),
      value: target.choices[0],
      confirm: "Link"
    });
    return choice === null ? CANCELLED : choice;
  }
  var leadCache = /* @__PURE__ */ new Map();
  function externalTimerKey() {
    const key = runningElsewhere(state.tasks, meAccountId, runningTimer()?.issueKey ?? null);
    noteExternalTimer(key);
    return key;
  }
  function projectsInPlay() {
    const client = settings().client;
    if (!client) return [];
    return isAggregate(client) ? state.projects.map((p) => p.key).filter((k) => k !== client) : [client];
  }
  async function ownLeadScopes(client, force) {
    if (force) leadCache.clear();
    const keys = isAggregate(client) ? state.projects.map((p) => p.key).filter((k) => k !== client) : [client];
    const scopes = [];
    for (const key of keys) {
      let components = leadCache.get(key);
      if (!components) {
        components = await myLeadComponents(key, meAccountId).catch(() => []);
        leadCache.set(key, components);
      }
      if (components.length) scopes.push({ projectKey: key, components });
    }
    return scopes;
  }
  async function setItemState(key, index, raw, label) {
    const task2 = findTask(key);
    const status = itemStatuses(task2?.checklistFormat ?? null).find((s) => s.label === label);
    if (!status) {
      void showMessage(
        "Could not change that item",
        `"${label}" is not a status this checklist offers.`
      );
      return;
    }
    const lead = !!task2?.component && state.leadScopes.some((sc) => sc.components.includes(task2.component));
    if (status.label === "Done" && !lead) {
      await showMessage(
        "Done is your lead\u2019s call",
        "Mark the item In QA when it is ready for review; the lead of this component marks it Done."
      );
      return;
    }
    const item = task2?.checklist?.find((i) => i.index === index);
    if (item?.resolved && !/^(done|skipped|in qa|qa)$/i.test(status.label)) {
      const current3 = statusOf(item, task2?.checklistFormat ?? null);
      const yes = await confirmHtml(
        `Reopen "${item.name}"?`,
        `<p class="kmtext">It is <b>${esc(current3)}</b>. Marking it <b>${esc(status.label)}</b> undoes that for whoever set it.</p>`,
        "Reopen"
      );
      if (!yes) return;
    }
    try {
      await setChecklistStatus(key, index, raw, status);
      toast(`Marked ${status.label}`, 1500);
      await load(true);
    } catch (e) {
      if (e?.name === "ChecklistDrift") {
        await load(true);
        void showMessage(
          "Nothing was written",
          `${e.message}

The checklist has been reloaded \u2014 pick the item again.`
        );
        return;
      }
      void showMessage("Could not change that item", e?.message || String(e));
    }
  }
  function clipItemsOf(key) {
    const task2 = findTask(key);
    return (task2?.checklist ?? []).map((i) => ({
      index: i.index,
      name: i.name,
      raw: i.raw,
      status: statusOf(i, task2?.checklistFormat ?? null)
    }));
  }
  function clipsFor(key) {
    const detail = state.detail?.key === key ? state.detail : null;
    const names = detail?.clips?.names;
    if (!names) return null;
    return { names, items: clipItemsOf(key) };
  }
  async function tickClips(key) {
    const found = clipsFor(key);
    const task2 = findTask(key);
    if (!found || !task2) return;
    if (!task2.component || !state.leadScopes.some((sc) => sc.components.includes(task2.component))) {
      await showMessage(
        "Done is your lead\u2019s call",
        "Mark the clips In QA when they are ready for review; the lead of this component marks them Done."
      );
      return;
    }
    const report = assessClips(found.items.map((i) => i.name), found.names);
    const todo = tickable(found.items, report);
    if (!todo.length) return;
    const status = itemStatuses(task2.checklistFormat).find((s) => s.label === "Done");
    if (!status) {
      await showMessage(
        "Nothing to mark with",
        "This checklist has no Done state, so there is nothing to set."
      );
      return;
    }
    const yes = await confirmHtml(
      `Mark ${todo.length} clip${todo.length === 1 ? "" : "s"} Done?`,
      '<p class="kmtext">Every one of these is in the linked file:</p><p class="kmtext">' + todo.map((i) => esc(i.name)).join(", ") + '</p><p class="kmnote">Anything already Done, Skipped, in QA or sent back for changes is left alone \u2014 a file cannot overrule a decision somebody made.</p>',
      "Mark Done"
    );
    if (!yes) return;
    try {
      const n = await setChecklistStatuses(
        key,
        todo.map((i) => ({ index: i.index, expectedRaw: i.raw, status }))
      );
      toast(`${n} marked Done`, 2e3);
      await load(true);
    } catch (e) {
      void showMessage("Could not mark those clips", e?.message || String(e));
    }
  }
  async function addClips(key) {
    const found = clipsFor(key);
    if (!found) return;
    const report = assessClips(found.items.map((i) => i.name), found.names);
    const fresh = newClipNames(report.extra, found.items.map((i) => i.name));
    if (!fresh.length) return;
    const task2 = findTask(key);
    const inQa = task2?.status === "QA";
    const yes = await confirmHtml(
      `Add ${fresh.length} clip${fresh.length === 1 ? "" : "s"} to the checklist?`,
      '<p class="kmtext">These are in the file and not on the list:</p><p class="kmtext">' + fresh.map((n) => esc(n)).join(", ") + '</p><p class="kmnote">They are added at the end as Todo. Nothing already on the checklist is touched.</p>' + (inQa ? '<p class="kmwarn">This task is in QA. Once they are added it goes back to the artist as Needs Changes, and you will be asked what to tell them.</p>' : ""),
      inQa ? "Add and send back" : "Add them"
    );
    if (!yes) return;
    let added;
    try {
      added = await appendChecklistItems(key, fresh);
      toast(
        added.length ? `${added.length} added` : "Already on the checklist",
        2e3
      );
    } catch (e) {
      void showMessage("Could not add those clips", e?.message || String(e));
      return;
    }
    if (!inQa || !task2) {
      await load(true);
      return;
    }
    await loadTransitions(key);
    const back = (state.transitions[key]?.list ?? []).find((t) => /^needs changes$/i.test(t.to));
    if (!back) {
      await showMessage(
        "Added, but the task is still in QA",
        "Jira is not offering a move to Needs Changes on this task, so it was not sent back. Use Request changes when it is."
      );
      await load(true);
      return;
    }
    void move(
      {
        taskKey: key,
        transition: back,
        to: back.to,
        from: task2.status,
        map: state.detail?.key === key ? state.detail?.map ?? null : null,
        root: rootForTask(task2),
        // The new clips are what needs doing, so they are what the note is aimed at.
        targets: fresh.map((n) => ({ kind: "clip", id: n, label: n, checked: true })),
        postFeedback: (kind, id, text) => postScopedFeedback(key, kind, id, text).then(() => {
        })
      },
      () => void load(true)
    );
  }
  async function loadReview(key) {
    state.review = {
      key,
      loading: true,
      error: null,
      threads: state.review?.key === key ? state.review.threads : []
    };
    render();
    try {
      const threads = await listReview(key);
      if (state.expanded !== key) return;
      state.review = { key, loading: false, error: null, threads };
      void loadShots(threads.flatMap((t) => t.attachments));
    } catch (e) {
      if (state.expanded !== key) return;
      state.review = { key, loading: false, error: e?.message || String(e), threads: [] };
    }
    render();
  }
  async function newFeedback(taskKey, kind, id, label) {
    const pin = kind === "clip" ? playheadFor(id) : null;
    const project = openProject();
    const camera = project && project.jiraKey === taskKey ? cameraNow() : null;
    const range = pin ? loopRangeNow() : null;
    const note = await askNote(kind, label || id, {
      pin: pin ? formatPin(pin) : null,
      range: range ? formatRange(range) : null,
      // The viewport is worth a picture only when the open project is this
      // task's file; a screenshot of some other model would mislead.
      canShoot: !!project && project.jiraKey === taskKey
    });
    if (!note) return;
    const attachments = [];
    if (note.shot !== "none") {
      let shot = await captureViewport();
      if (!shot) {
        await showMessage(
          "No screenshot taken",
          "Blockbench has no viewport to photograph right now. The note is posted without one."
        );
      } else {
        if (note.shot === "draw") shot = await drawOver(shot);
        try {
          const up = await uploadAttachment(
            taskKey,
            shotFilename(taskKey, kind === "clip" ? id : null, pin?.frame ?? null),
            shot.png,
            "image/png"
          );
          attachments.push(up);
          shotCache[up.id] = shot.dataUrl;
        } catch (e) {
          await showMessage(
            "Screenshot not attached",
            "The note will be posted without it. " + (e?.message || String(e))
          );
        }
      }
    }
    const ok = await postScopedFeedback(taskKey, kind, id, note.text, { attachments, at: pin, camera, range });
    if (!ok) return;
    if (barReview?.key === taskKey) barReview = null;
    await load(true);
    if (state.expanded === taskKey) void loadReview(taskKey);
  }
  function timelineRefusal(act, task2) {
    const viewing = blockedReason2();
    if (viewing) return viewing;
    const verdict = checkAction(act, { task: task2, hasRoot: !!(task2 ? rootForTask(task2) : currentRoot()) });
    return verdict.allowed ? null : verdict.reason;
  }
  function loadedShots() {
    return Object.fromEntries(
      Object.entries(shotCache).filter(([, v]) => v !== "loading" && v !== "failed")
    );
  }
  async function resolveFromTimeline(key, commentId, status) {
    const at = (/* @__PURE__ */ new Date()).toISOString();
    await setThreadStatus(commentId, status, meAccountId, at);
    toast(status === "resolved" ? "Resolved" : "Reopened", 1500);
    noteChanged(key, flipped(commentId, status, at));
  }
  function flipped(commentId, status, at) {
    return (ts) => ts.map((t) => t.commentId !== commentId ? t : {
      ...t,
      status,
      resolvedBy: status === "resolved" ? meAccountId : null,
      resolvedAt: status === "resolved" ? at : null
    });
  }
  function noteChanged(key, change) {
    if (state.review?.key === key) state.review = { ...state.review, threads: change(state.review.threads) };
    if (barReview && barReview.key === key && "threads" in barReview && barReview.threads) {
      barReview = { key, threads: change(barReview.threads) };
    }
    render();
    if (state.expanded === key) void loadReview(key);
  }
  async function deleteThread(key, commentId) {
    const thread = knownThreads(key)?.find((t) => t.commentId === commentId) ?? null;
    const shots2 = thread?.attachments.length ?? 0;
    const yes = await confirmHtml(
      "Delete this note?",
      '<p class="kmtext">It is removed from Jira for everyone' + (shots2 ? `, with its ${shots2} screenshot${shots2 === 1 ? "" : "s"}` : "") + '.</p><p class="kmnote">Jira decides whether you may \u2014 a refusal is shown as Jira says it. If this note sent the clip to Needs Changes, that stays; set it back yourself if it should.</p>',
      "Delete"
    );
    if (!yes) return false;
    try {
      await deleteFeedback(key, commentId);
    } catch (e) {
      await showMessage("Could not delete that note", e?.message || String(e));
      return false;
    }
    const failed = [];
    for (const id of thread?.attachments ?? []) {
      try {
        await deleteAttachment(id);
        delete shotCache[id];
      } catch (e) {
        failed.push(e?.message || String(e));
      }
    }
    toast("Note deleted", 1500);
    noteChanged(key, (ts) => ts.filter((t) => t.commentId !== commentId));
    if (failed.length) {
      await showMessage(
        "Note deleted, screenshot not",
        "The note is gone; its screenshot is still attached to the issue and can be removed in Jira.\n\n" + failed[0]
      );
    }
    return true;
  }
  function knownThreads(taskKey) {
    const page = state.review?.key === taskKey ? state.review : null;
    if (page && !page.loading && !page.error) return page.threads;
    if (barReview && barReview.key === taskKey && "threads" in barReview) return barReview.threads;
    return null;
  }
  function threadsForBar(taskKey) {
    const known = knownThreads(taskKey);
    if (known) return known;
    if (state.review?.key === taskKey && state.review.loading) return null;
    if (barReview && barReview.key === taskKey) {
      const failedAt = "threads" in barReview && barReview.threads === null ? barReview.at ?? 0 : null;
      if (failedAt === null || Date.now() - failedAt < RETRY_REVIEW_MS) return null;
    }
    barReview = { key: taskKey, loading: true };
    listReview(taskKey).then((threads) => {
      if (barReview?.key !== taskKey) return;
      barReview = { key: taskKey, threads };
      updateReviewBar();
      void loadShots(threads.flatMap((t) => t.attachments));
    }).catch((e) => {
      trace(`review for the open file ${taskKey}: ${e?.message || e}`);
      if (barReview?.key === taskKey) barReview = { key: taskKey, threads: null, at: Date.now() };
    });
    return null;
  }
  async function loadShots(ids) {
    const want = [...new Set(ids)].filter((id) => !(id in shotCache) || shotCache[id] === "failed" && Date.now() - (shotFailedAt[id] ?? 0) > RETRY_REVIEW_MS);
    if (!want.length) return;
    for (const id of want) shotCache[id] = "loading";
    await Promise.all(want.map(async (id) => {
      try {
        const { data, contentType } = await fetchAttachment(id);
        const image = contentType.startsWith("image/") && data.length <= 8 * 1024 * 1024;
        shotCache[id] = image ? `data:${contentType};base64,${data.toString("base64")}` : "failed";
        if (!image) shotFailedAt[id] = Infinity;
      } catch (e) {
        trace(`screenshot ${id}: ${e?.message || e}`);
        shotCache[id] = "failed";
        shotFailedAt[id] = Date.now();
      }
      render();
    }));
  }
  async function seekToNote(taskKey, commentId) {
    const thread = knownThreads(taskKey)?.find((t) => t.commentId === commentId) ?? null;
    if (!thread?.target) return;
    const pinned = thread.at && thread.target.kind === "clip" ? thread.at : null;
    if (!pinned && !thread.camera) return;
    const clip = thread.target.id;
    const open = openProject();
    if (!open || open.jiraKey !== taskKey) {
      const task2 = findTask(taskKey);
      const rel = state.detail?.key === taskKey ? state.detail.clips?.path : null;
      const root = rootForTask(task2);
      if (!rel || !root) {
        await showMessage(
          "Open the clip first",
          "Kumonga does not know which file this clip is in yet. Expand the task, open its animation file, then click the frame again."
        );
        return;
      }
      try {
        await openModelFile(toNative(resolveIn(root, rel)));
      } catch (e) {
        await showMessage("Could not open the file", e?.message || String(e));
        return;
      }
    }
    if (pinned) {
      if (!seekTo(clip, pinned)) {
        await showMessage(
          "Clip not in this file",
          `There is no animation called "${clip}" in the open project, so there is nothing to seek.`
        );
        return;
      }
      ghostAt(pinned);
      if (thread.range) setLoopRange(thread.range);
    }
    if (thread.camera) restoreCamera(thread.camera);
    toast(pinned ? `${clip} @ ${formatPin(pinned)}` : "View restored", 1800);
    try {
      window.focus();
    } catch {
    }
    updateReviewBar();
  }
  async function leaveFeedback(taskKey) {
    state.menu = null;
    state.menuAt = null;
    const task2 = findTask(taskKey);
    if (!task2) return;
    const targets = reviewTargets(task2);
    if (!targets.length) {
      await showMessage(
        "Nothing to leave feedback on",
        state.detail?.key === taskKey && !state.detail.loading ? "This task has no models linked yet. Feedback is left on a model or a clip, never on the task as a whole." : "Expand the task first, so its models are known."
      );
      return;
    }
    let pick = targets[0];
    if (targets.length > 1) {
      const choice = await chooseOne({
        title: `Feedback on ${taskKey}`,
        note: "Which is it about? The note is posted against that one and shows on its row.",
        label: targets[0].kind === "clip" ? "Clip" : "Model",
        options: targets.map((t) => ({ value: `${t.kind}:${t.id}`, label: t.label })),
        value: `${pick.kind}:${pick.id}`,
        confirm: "Next"
      });
      if (choice === null) return;
      pick = targets.find((t) => `${t.kind}:${t.id}` === choice) ?? pick;
    }
    await newFeedback(taskKey, pick.kind, pick.id, pick.label);
  }
  async function postScopedFeedback(taskKey, kind, id, text, extra = {}) {
    let posted;
    try {
      posted = await postFeedback(
        taskKey,
        { kind, id },
        text,
        extra.attachments ?? [],
        extra.at ?? null,
        extra.camera ?? null,
        extra.range ?? null
      );
    } catch (e) {
      await showMessage("Could not leave that feedback", e?.message || String(e));
      return false;
    }
    if (!posted.scoped) {
      await showMessage(
        "Posted, but not attached to anything",
        "The comment is on the task and the artist will see it in Jira. What failed was the part recording which model it is about, so it will not show against the row here.\n\n" + (posted.reason ?? "") + "\n\nNothing was deleted \u2014 the words are there either way."
      );
    }
    const task2 = findTask(taskKey);
    const item = task2 ? itemForTarget(task2, { kind, id }) : null;
    if (item) {
      const status = itemStatuses(task2.checklistFormat).find((s) => s.label === "Needs Changes");
      if (status) {
        try {
          await setChecklistStatus(taskKey, item.index, item.raw, status);
        } catch (e) {
          await showMessage(
            "Feedback posted, but the clip was not sent back",
            `"${item.name}" is still ${statusOf(item, task2.checklistFormat)}. ` + (e?.message || String(e))
          );
        }
      }
    }
    return true;
  }
  function reviewTargets(task2) {
    const detail = state.detail?.key === task2.key ? state.detail : null;
    if (sharesOneFile(animationShape(task2, null))) {
      return (task2.checklist ?? []).map((i) => ({ kind: "clip", id: i.name, label: i.name }));
    }
    if (!detail?.map) return [];
    return Object.entries(detail.map.assets).map(([id, asset]) => ({ kind: "asset", id, label: assetLabel(id, asset) }));
  }
  async function flipThread(key, commentId, status) {
    try {
      const at = (/* @__PURE__ */ new Date()).toISOString();
      await setThreadStatus(commentId, status, meAccountId, at);
      toast(status === "resolved" ? "Resolved" : "Reopened", 1500);
      noteChanged(key, flipped(commentId, status, at));
    } catch (e) {
      void showMessage("Could not change that", e?.message || String(e));
    }
  }
  async function replyToThread(key, commentId) {
    const thread = state.review?.threads.find((t) => t.commentId === commentId);
    const text = await askReply(thread?.text ?? "");
    if (!text) return;
    try {
      await addComment(key, text);
      toast("Replied", 1500);
      if (barReview?.key === key) barReview = null;
      void loadReview(key);
    } catch (e) {
      void showMessage("Could not post that reply", e?.message || String(e));
    }
  }
  async function pushForReview(key) {
    const task2 = findTask(key);
    if (!task2) return;
    await loadTransitions(key);
    const toQa = (state.transitions[key]?.list ?? []).find((t) => /^qa$/i.test(t.to));
    if (!toQa) {
      await showMessage(
        "No way back to QA",
        "Jira is not offering a move into QA on this task. It may already be there, or the workflow may not allow it from this status."
      );
      return;
    }
    try {
      await addComment(key, "All feedback addressed \u2014 back for re-review.");
    } catch {
    }
    void move(
      {
        taskKey: key,
        transition: toQa,
        to: toQa.to,
        from: task2.status,
        map: state.detail?.key === key ? state.detail?.map ?? null : null,
        root: rootForTask(task2)
      },
      () => {
        void load(true);
      }
    );
  }
  async function openShot(id) {
    if (!id) return;
    const site = await auth.siteUrl();
    if (!site) return;
    try {
      nodeRequire("shell").openExternal(
        `${site.replace(/\/+$/, "")}/rest/api/3/attachment/content/${encodeURIComponent(id)}`
      );
    } catch (e) {
      void showMessage("Could not open that screenshot", e?.message || String(e));
    }
  }
  async function loadTransitions(key) {
    if (state.transitions[key]) return;
    state.transitions = { ...state.transitions, [key]: { key, loading: true, error: null, list: [] } };
    render();
    try {
      const list = await listTransitions(key);
      state.transitions = { ...state.transitions, [key]: { key, loading: false, error: null, list } };
      render();
      if (findTask(key)?.status === "Blocked") {
        const reason = await blockedReason(key);
        const current22 = state.transitions[key];
        if (current22) {
          state.transitions = { ...state.transitions, [key]: { ...current22, reason } };
          render();
        }
      }
    } catch (e) {
      state.transitions = {
        ...state.transitions,
        [key]: {
          key,
          loading: false,
          list: [],
          error: `Could not read what Jira allows here: ${e?.message || e}`
        }
      };
      render();
    }
  }
  async function loadBoard(which) {
    const s = settings();
    const client = s.client;
    if (!client) return;
    state.board = { ...state.board, [which]: { loading: true, error: null, tasks: [], complete: true } };
    render();
    try {
      const result = await searchBoard(client, s.components, {
        done: which === "done",
        aggregate: isAggregate(client),
        excluded: s.excluded
      });
      state.board = {
        ...state.board,
        [which]: { loading: false, error: null, tasks: result.tasks, complete: result.complete }
      };
    } catch (e) {
      state.board = {
        ...state.board,
        [which]: { loading: false, error: e?.message || String(e), tasks: [], complete: true }
      };
    }
    render();
  }
  async function loadTime(day, view) {
    const week = weekOf(day);
    const current22 = state.time;
    state.time = {
      view: view ?? current22?.view ?? "day",
      day,
      loading: true,
      error: null,
      logs: current22?.logs ?? []
    };
    render();
    try {
      const logs = await listWorklogs({
        from: week[0],
        to: week[6],
        accountId: meAccountId ?? void 0
      });
      if (state.time?.day !== day) return;
      state.time = { ...state.time, loading: false, logs };
    } catch (e) {
      if (state.time?.day !== day) return;
      state.time = { ...state.time, loading: false, error: e?.message || String(e), logs: [] };
    }
    render();
  }
  function weekLoaded(day) {
    const t = state.time;
    if (!t || t.loading) return false;
    return weekOf(t.day)[0] === weekOf(day)[0];
  }
  async function loadQa() {
    const client = settings().client;
    if (!client) return;
    const lead = state.viewingLead;
    const held = state.qa && !state.qa.error ? state.qa : null;
    state.qa = {
      loading: true,
      error: null,
      queue: held?.queue ?? [],
      cleared: held?.cleared ?? [],
      partial: held?.partial ?? []
    };
    render();
    try {
      const other = lead && lead !== meAccountId ? lead : null;
      const scopes = other ? await leadScopesFor(projectsInPlay(), other) : state.leadScopes;
      const [queue, cleared, partial] = await Promise.all([
        qaQueue(scopes),
        clearedBy(scopes.map((sc) => sc.projectKey), other),
        // Not fatal: the partly-ready lane is a pointer, and its search failing
        // must not blank the queue the lead came for.
        partialQueue(scopes).catch(() => ({ tasks: [], complete: true }))
      ]);
      if (state.viewingLead !== lead || settings().client !== client) return;
      state.qa = {
        loading: false,
        error: null,
        queue: queue.tasks,
        cleared,
        complete: queue.complete,
        partial: partial.tasks,
        partialComplete: partial.complete
      };
    } catch (e) {
      if (state.viewingLead !== lead || settings().client !== client) return;
      state.qa = { loading: false, error: e?.message || String(e), queue: [], cleared: [] };
    }
    render();
  }
  var reloadWanted = false;
  async function load(force = false) {
    const s = settings();
    if (!auth.isSignedIn()) {
      render();
      return;
    }
    if (state.loading) {
      if (force || reloadWanted !== "force") reloadWanted = force ? "force" : "plain";
      return;
    }
    state.loading = true;
    state.error = null;
    if (!state.fetchedAt) render();
    try {
      if (force) {
        state.disk = null;
        state.transitions = {};
        state.board = { overview: null, done: null };
        if (state.page === "qa" && state.qa) void loadQa();
        clearJiraCaches();
      }
      if (!state.projects.length || force) {
        state.projects = await listProjects(s.excluded);
        if (!s.client && state.projects.length) {
          const counts = await projectsWithMyWork(s.excluded).catch(() => /* @__PURE__ */ new Map());
          const best = state.projects.map((p) => ({ key: p.key, n: counts.get(p.key) ?? 0 })).sort((a, b) => b.n - a.n)[0];
          saveSettings({ client: best && best.n > 0 ? best.key : state.projects[0].key });
        }
      }
      if (!realAccountId) realAccountId = await currentAccountId().catch(() => null);
      meAccountId = effectiveAccountId(realAccountId);
      const client = settings().client;
      if (client) {
        state.leadScopes = await ownLeadScopes(client, force);
        if (!state.leadScopes.length && state.page === "qa") state.page = "work";
        state.leads = await allLeads(projectsInPlay()).catch(() => []);
        const s2 = settings();
        const result = await searchTasks(client, s2.components, 20, {
          aggregate: isAggregate(client),
          excluded: s2.excluded,
          // Null unless the debug view-as is on (src/debug/).
          assignee: viewingAs()?.accountId ?? null
        });
        if (settings().client !== client) return;
        state.tasks = result.tasks;
        state.complete = result.complete;
        state.fetchedAt = Date.now();
      }
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.loading = false;
      render();
      void checkGit();
      if (reloadWanted) {
        const again = reloadWanted === "force";
        reloadWanted = false;
        void load(again);
      }
    }
  }
  function onClick4(ev) {
    const el = ev.target?.closest("[data-act]");
    if (!el) {
      if (state.menu || state.itemMenu) {
        state.menu = null;
        state.menuAt = null;
        state.itemMenu = null;
        state.itemMenuAt = null;
        render();
      }
      return;
    }
    const act = resolveAction(
      el.dataset.act,
      { alt: ev.altKey },
      !!el.dataset.path
    );
    const policy = ACTIONS[act];
    if (policy?.writes || policy?.localWrite || policy?.picksTask || policy?.ownRecord) {
      const refused = blockedReason2();
      if (refused) {
        void showMessage("Not while viewing as someone else", refused);
        return;
      }
    }
    const key = el.dataset.key;
    const task2 = key ? findTask(key) : null;
    const verdict = checkAction(act, {
      task: task2,
      // The task's repository where there is a task, the panel's otherwise. In
      // the Team Tasks view these are different questions with different answers.
      hasRoot: !!(task2 ? rootForTask(task2) : currentRoot())
    });
    if (!verdict.allowed) {
      toast(verdict.reason, 3500);
      return;
    }
    if (act === "itemstate") {
      const key2 = el.dataset.key;
      const index = Number(el.dataset.index);
      const same = state.itemMenu?.key === key2 && state.itemMenu?.index === index;
      if (same) {
        state.itemMenu = null;
        state.itemMenuAt = null;
      } else {
        const r = el.getBoundingClientRect();
        state.itemMenu = { key: key2, index, raw: el.dataset.raw ?? "" };
        state.itemMenuAt = { x: r.left, y: r.bottom + 3 };
      }
      state.menu = null;
      render();
      return;
    }
    if (act === "setitemstate") {
      const key2 = el.dataset.key;
      state.itemMenu = null;
      state.itemMenuAt = null;
      void setItemState(key2, Number(el.dataset.index), el.dataset.raw ?? "", el.dataset.status ?? "");
      return;
    }
    if (state.itemMenu) {
      state.itemMenu = null;
      state.itemMenuAt = null;
    }
    if (act === "menu") {
      const key2 = el.dataset.key;
      if (state.menu === key2) {
        state.menu = null;
        state.menuAt = null;
      } else {
        const r = el.getBoundingClientRect();
        state.menu = key2;
        state.menuAt = { x: r.right - MENU_WIDTH, y: r.bottom + 3 };
        void loadTransitions(key2);
      }
      render();
      return;
    }
    if (act === "debugmenu") {
      if (state.debugMenuAt) {
        state.debugMenuAt = null;
      } else {
        const r = el.getBoundingClientRect();
        state.debugMenuAt = { x: r.left, y: r.bottom + 3 };
      }
      render();
      return;
    }
    if (state.debugMenuAt) state.debugMenuAt = null;
    if (state.menu) {
      state.menu = null;
      state.menuAt = null;
    }
    if (act === "pull") {
      void runPull();
      return;
    }
    if (act === "openjira") {
      void openInJira(el.dataset.key);
      render();
      return;
    }
    if (act === "toggle") {
      const key2 = el.dataset.key;
      expandTask(state.expanded === key2 ? null : key2);
    } else if (act === "lane") {
      const lane = el.dataset.lane;
      const lanes = { ...settings().lanes, [lane]: !settings().lanes[lane] };
      saveSettings({ lanes });
      render();
    } else if (act === "toggleall") {
      saveSettings({ showAll: !settings().showAll });
      render();
    } else if (act === "refresh") {
      void load(true);
    } else if (act === "root") {
      const target = el.dataset.project ?? (state.expanded ? findTask(state.expanded)?.projectKey : null) ?? state.tasks.find((t) => !getRoot(t.projectKey))?.projectKey ?? settings().client;
      const name = state.projects.find((p) => p.key === target)?.name || target || "";
      if (target) void openRootDialog(target, name, () => {
        state.disk = null;
        render();
        if (state.expanded) void loadDetail(state.expanded);
        void checkGit(true);
      });
    } else if (act === "openroot") {
      revealPath(null);
    } else if (act === "page") {
      state.page = el.dataset.page ?? "work";
      state.expanded = null;
      state.detail = null;
      render();
      if (state.page === "qa" && !state.qa) void loadQa();
      if (state.page === "time" && !state.time) void loadTime(localDay(/* @__PURE__ */ new Date()));
      if (state.page === "overview" && !state.board.overview) void loadBoard("overview");
      if (state.page === "done" && !state.board.done) void loadBoard("done");
    } else if (act === "github") {
      openInGitHubDesktop();
    } else if (act === "open") {
      openModel(el.dataset.path ?? null);
    } else if (act === "reveal") {
      revealPath(el.dataset.path ?? null);
    } else if (act === "group") {
      const id = el.dataset.asset;
      if (state.detail) {
        state.detail = { ...state.detail, openAsset: state.detail.openAsset === id ? null : id };
        render();
      }
    } else if (act === "settool") {
      const key2 = el.dataset.key;
      void openToolDialog(key2, findTask(key2)?.labels ?? [], () => void load(true));
    } else if (act === "setcomponent") {
      const key2 = el.dataset.key;
      const task22 = findTask(key2);
      void openComponentDialog(
        key2,
        task22?.component ?? null,
        () => void load(true),
        task22?.labels ?? []
      );
    } else if (act === "setpriority") {
      const key2 = el.dataset.key;
      void openPriorityDialog(key2, findTask(key2)?.priority ?? null, () => void load(true));
    } else if (act === "setdue") {
      const key2 = el.dataset.key;
      void openDueDialog(key2, findTask(key2)?.duedate ?? null, () => void load(true));
    } else if (act === "create") {
      void runCreate(el.dataset.key, el.dataset.item ?? null);
    } else if (act === "link") {
      void runLink(el.dataset.key, el.dataset.item ?? null);
    } else if (act === "linkfile") {
      void runLinkFile(el.dataset.key, el.dataset.item ?? null);
    } else if (act === "tmview") {
      const view = el.dataset.view === "week" ? "week" : "day";
      if (state.time) {
        state.time = { ...state.time, view };
        render();
      } else void loadTime(localDay(/* @__PURE__ */ new Date()), view);
    } else if (act === "tmday" || act === "tmweekshift") {
      const day = addDays(state.time?.day ?? localDay(/* @__PURE__ */ new Date()), Number(el.dataset.delta) || 0);
      if (weekLoaded(day) && state.time) {
        state.time = { ...state.time, day };
        render();
      } else void loadTime(day);
    } else if (act === "tmpick") {
      const day = el.dataset.day ?? localDay(/* @__PURE__ */ new Date());
      const view = state.time?.view === "week" ? "day" : state.time?.view;
      if (weekLoaded(day) && state.time) {
        state.time = { ...state.time, day, view: view ?? "day" };
        render();
      } else void loadTime(day, view);
    } else if (act === "tmtoday") {
      void loadTime(localDay(/* @__PURE__ */ new Date()));
    } else if (act === "tmopen") {
      const key2 = el.dataset.key ?? null;
      if (key2 && !findTask(key2)) {
        void openInJira(key2);
      } else {
        state.page = "work";
        expandTask(key2);
      }
    } else if (act === "tmedit") {
      void editEntry(
        el.dataset.key,
        el.dataset.worklog,
        Number(el.dataset.seconds) || 0,
        el.dataset.comment ?? "",
        () => {
          if (state.time) void loadTime(state.time.day);
        }
      );
    } else if (act === "tmdelete") {
      void deleteEntry(
        el.dataset.key,
        el.dataset.worklog,
        Number(el.dataset.seconds) || 0,
        () => {
          if (state.time) void loadTime(state.time.day);
        }
      );
    } else if (act === "logtimeday") {
      void logTimeFromPanel();
    } else if (act === "viewasoff") {
      stopViewingAs();
      meAccountId = realAccountId;
      void load(true);
    } else if (act === "viewas") {
      const client = settings().client;
      if (client) void openViewAsPicker(client, realAccountId, () => void load(true));
    } else if (act === "viewaswrites") {
      void toggleWrites(() => render());
    } else if (act === "reviewbardiag") {
      updateReviewBar();
      void showMessage("Review bar", reviewBarDiagnosis(openProject()));
    } else if (act === "clockworktoken") {
      void openTokenDialog(() => {
        void load(true);
      });
    } else if (act === "clockworklink") {
      void openTokenPage();
    } else if (act === "showfb") {
      state.reviewTarget = {
        taskKey: el.dataset.key,
        kind: el.dataset.kind === "asset" ? "asset" : "clip",
        id: el.dataset.id ?? "",
        label: el.dataset.label || void 0
      };
      state.page = "review";
      render();
    } else if (act === "showall") {
      state.reviewTarget = null;
      render();
    } else if (act === "leavefb") {
      void leaveFeedback(el.dataset.key);
    } else if (act === "newfb") {
      void newFeedback(
        el.dataset.key,
        el.dataset.kind === "asset" ? "asset" : "clip",
        el.dataset.id ?? "",
        el.dataset.label
      );
    } else if (act === "resolvefb") {
      void flipThread(el.dataset.key, el.dataset.comment ?? "", "resolved");
    } else if (act === "reopenfb") {
      void flipThread(el.dataset.key, el.dataset.comment ?? "", "open");
    } else if (act === "replyfb") {
      void replyToThread(el.dataset.key, el.dataset.comment ?? "");
    } else if (act === "delfb") {
      void deleteThread(el.dataset.key, el.dataset.comment ?? "");
    } else if (act === "rerequest") {
      void pushForReview(el.dataset.key);
    } else if (act === "openshot") {
      void openShot(el.dataset.shot ?? "");
    } else if (act === "seeknote") {
      void seekToNote(el.dataset.key, el.dataset.comment ?? "");
    } else if (act === "tickclips") {
      void tickClips(el.dataset.key);
    } else if (act === "addclips") {
      void addClips(el.dataset.key);
    } else if (act === "starttimer") {
      const t = findTask(el.dataset.key);
      if (t) void startFor(t.key, t.summary, () => render(), timerAccount());
    } else if (act === "starttimeritem") {
      const t = findTask(el.dataset.key);
      if (t) void startFor(t.key, t.summary, () => render(), timerAccount(), el.dataset.item);
    } else if (act === "stoptimer") {
      const key2 = el.dataset.key;
      const external2 = externalTimerKey() === key2;
      void stopFor(key2, meAccountId, () => external2 ? void load() : render(), timerAccount());
    } else if (act === "move") {
      const key2 = el.dataset.key;
      const transition = state.transitions[key2]?.list.find((t) => t.id === el.dataset.transition);
      if (transition) {
        const t = findTask(key2);
        const timeable = hasClockwork() && !!t && (!t.assignee || t.assignee.accountId === meAccountId);
        void move(
          {
            taskKey: key2,
            transition,
            to: el.dataset.to ?? transition.to,
            from: t?.status ?? "",
            map: state.detail?.key === key2 ? state.detail?.map ?? null : null,
            root: rootForTask(t),
            summary: t?.summary,
            timer: timeable ? { runningFor: timerAccount() } : null,
            // For Request changes: which models or clips the note is about, and
            // how to post it against each (D-63).
            targets: t ? reviewTargets(t) : [],
            postFeedback: (kind, id, text) => postScopedFeedback(key2, kind, id, text).then(() => {
            }),
            mine: !!t && (!t.assignee || t.assignee.accountId === meAccountId),
            // The repository state the panel already holds, when it is this
            // task's repository. Otherwise unknown, and the push prompt says so.
            git: state.git && rootForTask(t) === currentRoot() ? { ahead: state.git.ahead, dirty: state.git.dirty } : null
          },
          () => void load(true)
        );
      }
    } else if (act === "makecurrent") {
      void makeCurrent(refFrom(el), () => void loadDetail(el.dataset.key));
    } else if (act === "movefile") {
      const root = currentRoot();
      if (root) void moveOrRename(refFrom(el), root, () => void reloadDetail(el.dataset.key));
    } else if (act === "newversion") {
      void runNewVersion(el);
    } else if (act === "variant") {
      const key2 = el.dataset.key;
      const map = state.detail?.key === key2 ? state.detail.map : null;
      if (map) void manageVariant(refFrom(el), map, () => void loadDetail(key2));
    } else if (act === "delvariant") {
      const key2 = el.dataset.key;
      const map = state.detail?.key === key2 ? state.detail.map : null;
      if (map) void deleteVariant(refFrom(el), map, () => void loadDetail(key2));
    } else if (act === "linkvariant") {
      const key2 = el.dataset.key;
      const root = currentRoot();
      const map = state.detail?.key === key2 ? state.detail.map : null;
      if (root && map) {
        void linkIntoVariant(refFrom(el), root, map, meAccountId, () => void reloadDetail(key2));
      }
    } else if (act === "rebase") {
      const key2 = el.dataset.key;
      void (async () => {
        try {
          const map = state.detail?.key === key2 && state.detail.map ? state.detail.map : await getAssetMap(key2);
          await rebaseTask(key2, map, () => void reloadDetail(key2));
        } catch (e) {
          void showMessage("Could not read the task's files", e?.message || String(e));
        }
      })();
    } else if (act === "renameitem") {
      void renameItem(
        el.dataset.key,
        el.dataset.asset,
        Number(el.dataset.index),
        el.dataset.raw ?? "",
        el.dataset.name ?? "",
        el.dataset.estimate ? Number(el.dataset.estimate) : null,
        el.dataset.priority || null,
        () => void load(true)
      );
    } else if (act === "unlink") {
      void confirmUnlink({
        taskKey: el.dataset.key,
        assetId: el.dataset.asset,
        variant: el.dataset.variant ?? "",
        version: el.dataset.version,
        path: el.dataset.path ?? ""
      });
    } else if (act === "repair") {
      confirmRepair({
        taskKey: el.dataset.key,
        assetId: el.dataset.asset,
        variant: el.dataset.variant ?? "",
        version: el.dataset.version,
        oldPath: el.dataset.old ?? "",
        newPath: el.dataset.new ?? "",
        how: "matched"
      });
    } else if (act === "locate") {
      void runLocate(refFrom(el));
    } else if (act === "scope") {
      const client = settings().client;
      if (client) {
        void openScopeDialog(client, state.tasks, () => void load(true));
      }
    } else if (act === "signin") {
      void signIn();
    } else if (act === "cancelsignin") {
      auth.cancelSignIn();
    } else if (act === "copysigninlink") {
      const url = auth.pendingSignInUrl();
      if (!url) {
        toast("No sign-in is waiting", 2e3);
      } else {
        const win = childRoot?.ownerDocument.defaultView ?? window;
        void win.navigator.clipboard.writeText(url).then(
          () => toast("Link copied \u2014 paste it into your browser", 3e3),
          () => void showMessage("Copy the link by hand", url)
        );
      }
    } else if (act === "devreload") {
      ;
      globalThis.Plugins?.devReload?.();
    }
  }
  function onChange(ev) {
    const el = ev.target;
    if (el.dataset.act === "lead") {
      state.viewingLead = el.value === meAccountId ? null : el.value;
      state.qa = null;
      state.expanded = null;
      state.detail = null;
      render();
      void loadQa();
      return;
    }
    if (el.dataset.act === "client") {
      saveSettings({ client: el.value });
      state.tasks = [];
      state.expanded = null;
      state.detail = null;
      state.disk = null;
      state.qa = null;
      state.leadScopes = [];
      state.leads = [];
      state.viewingLead = null;
      state.page = "work";
      state.git = null;
      state.board = { overview: null, done: null };
      state.review = null;
      state.reviewTarget = null;
      state.menu = null;
      state.menuAt = null;
      state.itemMenu = null;
      state.transitions = {};
      void load();
    }
  }
  function expandTask(key) {
    state.expanded = key;
    state.detail = null;
    state.review = null;
    state.reviewTarget = null;
    render();
    if (key) {
      void loadDetail(key);
      void loadTransitions(key);
      void loadReview(key);
    }
  }
  function installKumonga() {
    uninstallKumonga();
    const style = document.createElement("style");
    style.id = "embody_jira_css";
    style.textContent = ALL_CSS + NAG_CSS + REVIEW_BAR_CSS + NOTE_MARKERS_CSS + ANIM_LIST_CSS + QUIT_DIALOG_CSS;
    document.head.appendChild(style);
    menuActions = [
      new Action("kumonga_open", {
        name: "Open Kumonga",
        icon: "open_in_new",
        click: () => detach()
      }),
      // Only ever one of these two. Blockbench evaluates `condition` each time
      // the menu opens, so the pair tracks the session without the menu having to
      // be rebuilt on sign-in and sign-out.
      new Action("kumonga_signin", {
        name: "Sign in to Jira",
        icon: "login",
        condition: () => !auth.isSignedIn(),
        click: () => {
          void signIn();
        }
      }),
      new Action("kumonga_signout", {
        name: "Sign out of Jira",
        icon: "logout",
        condition: () => auth.isSignedIn(),
        // The error too: a failure from the last session would otherwise greet
        // the next one on the sign-in screen as if it had just happened.
        click: () => {
          auth.signOut();
          state.tasks = [];
          state.qa = null;
          state.error = null;
          state.git = null;
          render();
        }
      }),
      new Action("kumonga_clockwork", {
        name: "Connect Clockwork\u2026",
        icon: "schedule",
        condition: () => !hasClockwork(),
        click: () => {
          void openTokenDialog(() => render());
        }
      }),
      new Action("kumonga_clockwork_replace", {
        name: "Replace Clockwork token\u2026",
        icon: "key",
        condition: () => hasClockwork(),
        click: () => {
          void openTokenDialog(() => render());
        }
      }),
      new Action("kumonga_clockwork_forget", {
        name: "Disconnect Clockwork",
        icon: "link_off",
        condition: () => hasClockwork(),
        click: () => {
          void forgetToken(() => render());
        }
      }),
      new Action("kumonga_autofetch_off", {
        name: "Stop checking git automatically",
        icon: "sync_disabled",
        condition: () => settings().autoFetch,
        click: () => {
          saveSettings({ autoFetch: false });
          toast("Kumonga will only check git when you refresh", 3e3);
          render();
        }
      }),
      new Action("kumonga_autofetch_on", {
        name: "Check git automatically",
        icon: "sync",
        condition: () => !settings().autoFetch,
        click: () => {
          saveSettings({ autoFetch: true });
          void checkGit(true);
        }
      }),
      new Action("kumonga_viewas", {
        name: "Debug: view as another artist\u2026",
        icon: "visibility",
        // Developer control. An artist could otherwise impersonate a
        // colleague's view from the menu.
        condition: () => settings().debug,
        click: () => {
          const client = settings().client;
          if (client) void openViewAsPicker(client, realAccountId, () => void load(true));
        }
      }),
      new Action("kumonga_viewas_off", {
        name: "Debug: stop viewing as",
        icon: "visibility_off",
        condition: () => isImpersonating(),
        click: () => {
          stopViewingAs();
          meAccountId = realAccountId;
          void load(true);
        }
      }),
      new Action("kumonga_viewas_readonly", {
        name: "Debug: make view-as read-only",
        icon: "lock",
        condition: () => isImpersonating() && settings().debugAllowWrites,
        click: () => {
          void toggleWrites(() => render());
        }
      }),
      new Action("kumonga_viewas_writes", {
        name: "Debug: allow changes again",
        icon: "edit",
        condition: () => isImpersonating() && !settings().debugAllowWrites,
        click: () => {
          void toggleWrites(() => render());
        }
      }),
      new Action("kumonga_reload", {
        name: "Reload plugin",
        icon: "refresh",
        // Developer control: a reload sends the window through the reopen dance.
        condition: () => settings().debug,
        click: () => globalThis.Plugins?.devReload?.()
      })
    ];
    barMenu = new BarMenu("kumonga", menuActions.map((a) => a.id), { name: "Kumonga" });
    document.getElementById("menu_bar")?.append(barMenu.label);
    installNag(() => ({
      enabled: hasClockwork(),
      // A timer Jira reports on the artist's work counts: nagging "no timer
      // running" at somebody who started one in Jira was the surest way to make
      // them start a second, which stops the first with no description.
      running: runningTimer()?.issueKey ?? externalTimerKey()
    }));
    watchProjects();
    installReviewBar({
      context: () => {
        const p = openProject();
        const task2 = p?.jiraKey ? findTask(p.jiraKey) : null;
        if (!task2) return null;
        const threads = threadsForBar(task2.key);
        return {
          task: task2,
          lead: !!task2.component && state.leadScopes.some((sc) => sc.components.includes(task2.component)),
          openNotes: threads ? openCounts(threads) : null,
          resolvedNotes: threads ? resolvedCounts(threads) : null,
          threads,
          // The same test readClips and reviewTargets use: any Animation task's
          // checklist is clips, whatever file they live in.
          clipsTask: sharesOneFile(animationShape(task2, null)),
          shots: loadedShots()
        };
      },
      onNote: (taskKey, clip) => {
        const task2 = findTask(taskKey);
        void inMainWindow(async () => {
          const refused = timelineRefusal("newfb", task2);
          if (refused) {
            toast(refused, 3500);
            return;
          }
          const item = task2 ? itemForTarget(task2, { kind: "clip", id: clip }) : null;
          await newFeedback(taskKey, "clip", item?.name ?? clip, item?.name ?? clip);
        });
      },
      onJump: (taskKey, commentId) => void inMainWindow(() => seekToNote(taskKey, commentId)),
      onResolve: (taskKey, commentId, status) => inMainWindow(async () => {
        const refused = timelineRefusal(status === "resolved" ? "resolvefb" : "reopenfb", findTask(taskKey));
        if (refused) throw new Error(refused);
        await resolveFromTimeline(taskKey, commentId, status);
      }),
      onDelete: (taskKey, commentId) => inMainWindow(async () => {
        const refused = timelineRefusal("delfb", findTask(taskKey));
        if (refused) {
          toast(refused, 3500);
          return false;
        }
        return deleteThread(taskKey, commentId);
      })
    });
    startPolling();
    startTicking();
    if (runningTimer()) {
      setTimeout(() => void recoverTimer(meAccountId, () => render()), 1200);
    }
    if (settings().detached || !auth.isSignedIn()) detach();
  }
  function uninstallKumonga() {
    stopPolling();
    stopTicking();
    unwatchProjects();
    uninstallNag();
    uninstallReviewBar();
    closeChild();
    window.removeEventListener("beforeunload", closeOnQuit);
    window.removeEventListener("beforeunload", warnAboutTimer);
    window.removeEventListener("beforeunload", warnAboutUnpushed);
    document.getElementById("embody_jira_css")?.remove();
    try {
      barMenu?.label?.remove();
    } catch {
    }
    try {
      delete globalThis.MenuBar?.menus?.kumonga;
    } catch {
    }
    for (const action of menuActions) {
      try {
        action.delete();
      } catch {
      }
    }
    menuActions = [];
    barMenu = null;
  }
  async function signIn() {
    if (state.signingIn) return;
    state.signingIn = true;
    state.error = null;
    render();
    try {
      if (auth.isSignedIn()) {
        toast("Already signed in to Jira", 2e3);
      } else {
        const site = await auth.signIn();
        toast(`Signed in to ${site.site}`, 2500);
      }
      meAccountId = await currentAccountId().catch(() => null);
      state.signingIn = false;
      await load(true);
    } catch (e) {
      state.signingIn = false;
      state.error = e?.name === "SignInCancelled" ? null : e?.message || String(e);
      if (state.error) trace(`sign-in failed: ${state.error}`);
      render();
    }
  }

  // src/main.ts
  var PLUGIN_ID = "embody_jira";
  var breadcrumb = trace;
  breadcrumb("--- script evaluated ---");
  function show(title2, lines) {
    new Dialog({
      id: "kumonga_message",
      title: title2,
      lines: [`<pre style="white-space:pre-wrap;font-size:11px;line-height:1.5">${lines.join("\n")}</pre>`],
      buttons: ["Close"]
    }).show();
  }
  breadcrumb("about to call BBPlugin.register");
  BBPlugin.register(PLUGIN_ID, {
    title: "Kumonga",
    author: "Embody Games",
    description: "Connects Blockbench to Jira Cloud: assigned work, where every .bbmodel lives, and the QA handoff.",
    icon: "checklist",
    version: "0.2.0",
    variant: "desktop",
    min_version: "5.0.5",
    tags: ["Embody"],
    onload() {
      breadcrumb("onload fired");
      try {
        if (!isDesktop()) {
          show("Kumonga", ["This plugin needs the Blockbench desktop app."]);
          breadcrumb("not desktop \u2014 stopped");
          return;
        }
        if (!vault.available()) {
          breadcrumb(`vault unavailable on ${platform()}`);
        }
        registerProjectProperties();
        breadcrumb("project properties registered");
        installKumonga();
        breadcrumb("menu installed; window reopened if it was open before");
      } catch (e) {
        breadcrumb(`onload threw: ${e?.stack || e?.message || e}`);
        try {
          show("Kumonga \u2014 load failed", [String(e?.stack || e?.message || e)]);
        } catch {
        }
      }
    },
    onunload() {
      breadcrumb("onunload fired");
      try {
        uninstallKumonga();
      } catch {
      }
      breadcrumb("onunload done");
    }
  });
})();
