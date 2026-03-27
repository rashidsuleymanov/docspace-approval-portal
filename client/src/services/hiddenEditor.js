let sdkLoaderPromise = null;

// Cache: skip re-auth if same role was authed within TTL
const AUTH_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes
const authCache = new Map(); // credentialsUrl -> timestamp

export function resetDocSpaceAuth() {
  authCache.clear();
}

export function loadDocSpaceSdk(src) {
  if (sdkLoaderPromise) return sdkLoaderPromise;
  // Strip trailing slashes so SDK doesn't construct double-slash URLs.
  const cleanSrc = String(src || "").replace(/\/+$/, "");
  sdkLoaderPromise = new Promise((resolve, reject) => {
    if (window.DocSpace?.SDK) {
      resolve(window.DocSpace.SDK);
      return;
    }
    if (!cleanSrc) {
      reject(new Error("DocSpace URL is missing"));
      return;
    }
    const script = document.createElement("script");
    script.src = `${cleanSrc}/static/scripts/sdk/2.0.0/api.js`;
    script.async = true;
    script.onload = () => resolve(window.DocSpace?.SDK);
    script.onerror = () => reject(new Error("Failed to load DocSpace SDK"));
    document.head.appendChild(script);
  });
  return sdkLoaderPromise;
}

export function destroyHiddenEditor(instanceRef) {
  const instance = instanceRef?.current || null;
  if (instance?.destroyFrame) {
    instance.destroyFrame();
  } else if (instance?.destroy) {
    instance.destroy();
  }
  if (instanceRef) {
    instanceRef.current = null;
  }
}

/**
 * Authenticates a DocSpace user before a hidden editor opens.
 * Runs initSystem → login → waits for onAuthSuccess, then destroys the frame.
 * Always resolves (failures are silent) so the caller can continue regardless.
 *
 * Call this before initHiddenEditor to ensure the asc_auth_key cookie
 * belongs to the right user, even after role switches.
 */
export async function ensureDocSpaceAuth(docspaceUrl, credentialsUrl = "/api/demo/credentials") {
  const cleanUrl = String(docspaceUrl || "").replace(/\/+$/, "");
  if (!cleanUrl) return;

  const cached = authCache.get(credentialsUrl);
  if (cached && Date.now() - cached < AUTH_CACHE_TTL_MS) {
    return; // already authed for this role recently
  }

  try {
    await loadDocSpaceSdk(cleanUrl);

    const res = await fetch(credentialsUrl, { credentials: "include" });
    if (!res.ok) return;
    const creds = await res.json().catch(() => null);
    if (!creds?.email || !creds?.password) return;

    const frameId = `docspace-pre-auth-${Date.now()}`;
    const container = document.createElement("div");
    container.id = frameId;
    container.style.cssText =
      "position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-1";
    document.body.appendChild(container);

    await new Promise((resolve) => {
      const cleanup = () => {
        try { window.DocSpace?.SDK?.frames?.[frameId]?.destroyFrame?.(); } catch {}
        container.remove();
        resolve();
      };
      const timer = setTimeout(() => {
        console.warn("[pre-auth] timeout, continuing without auth");
        cleanup();
      }, 15_000);
      const done = () => { clearTimeout(timer); cleanup(); };

      const instance = window.DocSpace.SDK.initSystem({
        src: cleanUrl,
        frameId,
        width: "1px",
        height: "1px",
        events: {
          onAppReady: async () => {
            try {
              const hs = await instance.getHashSettings();
              const hash = await instance.createHash(creds.password, hs);
              await instance.login(creds.email, hash);
            } catch (e) {
              console.warn("[pre-auth] login error:", e?.message);
              done();
            }
          },
          onAuthSuccess: () => { console.log("[pre-auth] auth ok"); authCache.set(credentialsUrl, Date.now()); done(); },
          onSignIn: () => { authCache.set(credentialsUrl, Date.now()); done(); },
          onAppError: () => { console.warn("[pre-auth] frame error"); done(); }
        }
      });
    });
  } catch (e) {
    console.warn("[pre-auth] failed:", e?.message);
  }
}

export async function initHiddenEditor({
  docspaceUrl,
  fileId,
  frameId,
  mode = "edit",
  width = "1px",
  height = "1px",
  events
} = {}) {
  const cleanUrl = String(docspaceUrl || "").replace(/\/+$/, "");
  await loadDocSpaceSdk(cleanUrl);
  return window.DocSpace?.SDK?.initEditor({
    src: cleanUrl,
    id: String(fileId),
    frameId,
    mode,
    width,
    height,
    events
  });
}
