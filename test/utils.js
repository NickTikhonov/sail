const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CLI_PATH = path.resolve(__dirname, "..", "dist", "cli.js");

async function createTempProject(testContext, options = {}) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sail-test-project-"));
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sail-test-home-"));

  if (options.withSrc) {
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  }

  testContext.after(async () => {
    await fs.rm(projectRoot, { force: true, recursive: true });
    await fs.rm(homeDir, { force: true, recursive: true });
  });

  return {
    homeDir,
    projectRoot
  };
}

function runCli(cwd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: options.homeDir ?? process.env.HOME
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stderr,
        stdout
      });
    });

    child.on("error", (error) => {
      resolve({
        code: 1,
        stderr: `${stderr}${String(error)}`,
        stdout
      });
    });

    child.stdin.end(options.stdin ?? "");
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function getGraphRoot(projectRoot) {
  const config = await readJson(path.join(projectRoot, "sail.config.json"));
  return {
    config,
    graphRoot: path.join(projectRoot, ...config.graphSrc.split("/"))
  };
}

async function initProject(testContext, options = {}) {
  const context = await createTempProject(testContext, options);
  const initArgs = ["init"];
  if (options.projectName) {
    initArgs.push(options.projectName);
  }
  const initResult = await runCli(context.projectRoot, initArgs, { homeDir: context.homeDir });
  return {
    ...context,
    initResult
  };
}

async function createNextStyleProject(testContext) {
  const context = await createTempProject(testContext);
  await fs.mkdir(path.join(context.projectRoot, "app"), { recursive: true });

  await fs.writeFile(
    path.join(context.projectRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "next-style-project",
        private: true,
        dependencies: {
          next: "latest",
          react: "latest",
          "react-dom": "latest"
        },
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(context.projectRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }]
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(context.projectRoot, "next-env.d.ts"),
    '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    "utf8"
  );

  await fs.writeFile(
    path.join(context.projectRoot, "app", "page.tsx"),
    [
      "export default function Page() {",
      '  return <main>Hello from Next</main>;',
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  return context;
}

async function writeNode(projectRoot, homeDir, id, source) {
  return runCli(projectRoot, ["write", id], {
    homeDir,
    stdin: source
  });
}

async function writeTest(projectRoot, homeDir, id, source) {
  return runCli(projectRoot, ["test", "write", id], {
    homeDir,
    stdin: source
  });
}

module.exports = {
  CLI_PATH,
  createTempProject,
  createNextStyleProject,
  getGraphRoot,
  initProject,
  readJson,
  runCli,
  writeNode,
  writeTest
};
