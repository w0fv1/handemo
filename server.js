const http = require("http");
const path = require("path");

const express = require("express");

function createServer() {
  const app = express();
  app.disable("x-powered-by");

  app.use(express.static(path.join(__dirname, "public")));
  app.get("/healthz", (_req, res) => res.type("text").send("ok"));

  const server = http.createServer(app);
  return { app, server };
}

module.exports = { createServer };

if (require.main === module) {
  function normalizePort(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function listenAsync(server, port) {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const onListening = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        server.off("error", onError);
        server.off("listening", onListening);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    });
  }

  (async () => {
    const portEnv = process.env.PORT;
    const requestedPort = normalizePort(portEnv) ?? 3000;
    const allowFallback = !portEnv;

    const { server } = createServer();

    let port = requestedPort;
    const maxTries = allowFallback ? 20 : 1;

    for (let attempt = 0; attempt < maxTries; attempt += 1) {
      try {
        await listenAsync(server, port);
        const actualPort = server.address().port;
        console.log(`HTTP:  http://localhost:${actualPort}`);
        if (actualPort !== requestedPort) {
          console.log(`NOTE: Port ${requestedPort} was busy; using ${actualPort} instead.`);
        }
        return;
      } catch (err) {
        if (err && err.code === "EADDRINUSE" && allowFallback) {
          port += 1;
          continue;
        }
        console.error(err);
        process.exitCode = 1;
        return;
      }
    }

    // Last resort: let the OS choose a free port.
    try {
      await listenAsync(server, 0);
      const actualPort = server.address().port;
      console.log(`HTTP:  http://localhost:${actualPort}`);
      console.log(`NOTE: Default port ${requestedPort} was busy; using ${actualPort} instead.`);
    } catch (err) {
      console.error(err);
      process.exitCode = 1;
    }
  })();
}
