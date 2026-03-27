import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import net from "net";
import { randomUUID } from "node:crypto";
import authRoutes from "./routes/auth.js";
import templatesRoutes from "./routes/templates.js";
import flowsRoutes from "./routes/flows.js";
import debugRoutes from "./routes/debug.js";
import sandboxRoutes from "./routes/sandbox.js";
import projectsRoutes from "./routes/projects.js";
import libraryRoutes from "./routes/library.js";
import draftsRoutes from "./routes/drafts.js";
import webhooksRoutes from "./routes/webhooks.js";
import contactsRoutes from "./routes/contacts.js";
import linksRoutes from "./routes/links.js";
import directoryRoutes from "./routes/directory.js";
import demoRoutes from "./routes/demo.js";
import { validateConfig } from "./config.js";
import {
  cleanupStoredDemoSessions,
  deleteDemoSession,
  flushDemoSessions,
  getDemoSessionById,
  getDemoSessionId,
  hydrateDemoSessions,
  isDemoSessionExpired,
  listDemoSessions,
  touchDemoSession,
  startDemoJanitor
} from "./demoSessionStore.js";
import { cleanupDemoSession } from "./routes/demoCleanup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Attach demo session to every request — also evicts expired sessions inline.
app.use((req, _res, next) => {
  const sid = getDemoSessionId(req);
  const session = sid ? getDemoSessionById(sid) : null;
  if (session) {
    if (isDemoSessionExpired(session)) {
      deleteDemoSession(session.id);
      req.demoSession = null;
    } else {
      req.demoSession = session;
      touchDemoSession(session);
    }
  } else {
    req.demoSession = null;
  }
  next();
});

const configErrors = validateConfig({ requiresAuth: true });
if (configErrors.length) {
  console.warn("[approval-portal] config warnings:");
  configErrors.forEach((message) => console.warn(`- ${message}`));
}

app.use("/api/demo", demoRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/flows", flowsRoutes);
app.use("/api/settings", sandboxRoutes);
app.use("/api/sandbox", sandboxRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/drafts", draftsRoutes);
app.use("/api/webhooks", webhooksRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/links", linksRoutes);
app.use("/api/directory", directoryRoutes);

const isProd = process.env.NODE_ENV === "production";
// Debug API requires explicit opt-in — never enabled automatically.
const debugEnabled = process.env.ENABLE_DEBUG_API === "true";
if (debugEnabled) {
  if (isProd) {
    console.warn("[approval-portal] WARNING: Debug API is enabled in production. Set ENABLE_DEBUG_API=false to disable.");
  }
  app.use("/api/debug", debugRoutes);
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "Request body is too large" });
  }
  const requestId = randomUUID();
  console.error(`[approval-portal] unhandled error requestId=${requestId}`, err);
  res.status(500).json({ error: "Internal server error", requestId });
});

const clientRoot = path.resolve(__dirname, "../../client");
const DEFAULT_PORT = 8080;
const rawPort = process.env.PORT;
const parsedPort = rawPort ? Number(rawPort) : null;
const hasExplicitPort = rawPort != null && rawPort !== "";
const requestedPort =
  parsedPort && Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : null;

function isPortAvailable(portToCheck) {
  return new Promise((resolve, reject) => {
    const tryListen = (host, fallback) => {
      const tester = net.createServer();
      tester.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
          return;
        }
        if (fallback && (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT" || err.code === "EINVAL")) {
          fallback();
          return;
        }
        reject(err);
      });
      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });
      tester.listen(portToCheck, host);
    };
    tryListen("::", () => tryListen("0.0.0.0"));
  });
}

async function start() {
  await hydrateDemoSessions();
  const recovered = listDemoSessions();
  if (recovered.length) {
    console.warn(`[approval-portal] Found ${recovered.length} stale demo session(s). Running startup cleanup.`);
    await cleanupStoredDemoSessions({ onCleanup: cleanupDemoSession });
  }

  startDemoJanitor({ onExpire: cleanupDemoSession });

  if (hasExplicitPort && requestedPort == null) {
    console.error(`[approval-portal] Invalid PORT value: ${JSON.stringify(rawPort)}`);
    process.exit(1);
  }

  const basePort = requestedPort ?? DEFAULT_PORT;
  let selectedPort = basePort;

  if (requestedPort != null) {
    const available = await isPortAvailable(selectedPort);
    if (!available) {
      console.error(`[approval-portal] Port ${selectedPort} is already in use.`);
      process.exit(1);
    }
  } else {
    for (let offset = 0; offset < 20; offset += 1) {
      const candidate = DEFAULT_PORT + offset;
      // eslint-disable-next-line no-await-in-loop
      const available = await isPortAvailable(candidate);
      if (available) {
        selectedPort = candidate;
        break;
      }
    }
    if (selectedPort !== DEFAULT_PORT) {
      console.warn(`[approval-portal] Port ${DEFAULT_PORT} is busy. Using ${selectedPort} instead.`);
    }
  }

  const httpServer = http.createServer(app);
  let shuttingDown = false;

  const cleanupLiveDemoSessions = async (reason) => {
    const active = listDemoSessions();
    if (!active.length) {
      await flushDemoSessions();
      return;
    }
    console.warn(`[approval-portal] ${reason}: cleaning ${active.length} active demo session(s).`);
    await cleanupStoredDemoSessions({ onCleanup: cleanupDemoSession });
  };

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await cleanupLiveDemoSessions(signal);
    } catch (error) {
      console.warn("[approval-portal] shutdown demo cleanup failed", error?.message || error);
    }
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref?.();
  };

  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

  if (!isProd) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: clientRoot,
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa"
    });

    app.use(vite.middlewares);

    app.use("*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(clientRoot, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (error) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });
  } else {
    app.use(express.static(path.join(clientRoot, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientRoot, "dist", "index.html"));
    });
  }

  httpServer.listen(selectedPort, () => {
    console.log(`[approval-portal] ${isProd ? "prod" : "dev"} on http://localhost:${selectedPort}`);
  });

  httpServer.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`[approval-portal] Port ${selectedPort} is already in use.`);
      process.exit(1);
    }
    console.error("[approval-portal] server error", err);
  });
}

start().catch((error) => {
  console.error("[approval-portal] failed to start", error);
  process.exit(1);
});
