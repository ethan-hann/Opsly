import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { context } from "esbuild";
import { createApiServerEsbuildOptions } from "./esbuild.config.mjs";

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) {
  console.error(`Node 24 or newer is required. Detected ${process.versions.node}. Use \`nvm use\` or \`fnm use\` after installing Node 24 (see .nvmrc).`);
  process.exit(1);
}

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(artifactDir, "dist");
const entryPoint = "./dist/index.mjs";

let child = null;
let shuttingDown = false;
let restartChain = Promise.resolve();

function logBuildErrors(errors) {
  for (const error of errors) {
    console.error(error);
  }
}

function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const current = child;
    current.once("exit", () => resolve());
    current.kill();
  });
}

async function startChild() {
  child = spawn(process.execPath, ["--enable-source-maps", entryPoint], {
    cwd: artifactDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
    stdio: "inherit",
  });

  child.once("exit", (code, signal) => {
    if (!shuttingDown && code !== 0 && signal === null) {
      console.error(`api-server exited with code ${code}.`);
    }
  });
}

async function restartChild() {
  if (shuttingDown) {
    return;
  }

  await stopChild();
  if (shuttingDown) {
    return;
  }

  await startChild();
}

const restartPlugin = {
  name: "restart-api-server-on-success",
  setup(build) {
    build.onEnd((result) => {
      if (shuttingDown) {
        return;
      }

      if (result.errors.length > 0) {
        logBuildErrors(result.errors);
        return;
      }

      restartChain = restartChain.then(() => restartChild()).catch((err) => {
        console.error(err);
      });
    });
  },
};

async function main() {
  const ctx = await context(createApiServerEsbuildOptions({ artifactDir, distDir, plugins: [restartPlugin] }));
  await ctx.watch();

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await stopChild();
    await ctx.dispose();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
