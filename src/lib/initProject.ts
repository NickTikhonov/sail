import fs from "node:fs/promises";
import path from "node:path";
import SailError from "./SailError.js";

function createProjectHelpTemplate(graphSrc: string): string {
  return `# sail

This project is meant to be worked on through sail, not by manually editing files under the configured graph source directory.

- Use \`sail help\` first.
- Prefer \`query\`, \`graph\`, and \`read\` before \`write\`.
- Use \`write\` with a full valid file, not a fragment.
- Use \`sail test write <id>\` and \`sail test patch <id>\` for node tests.
- The graph source root for this project is \`${graphSrc}\`, defined in \`sail.config.json\`.
- If a function write opens test debt, pay it back before the next implementation write.
`;
}

function createClaudeTemplate(graphSrc: string): string {
  return `Use sail for all work in this repo.

1. Do not manually read or write files under \`${graphSrc}/\`.
2. Use \`sail\` commands to inspect and change the project.
3. \`sail\` is already on PATH. Run \`sail help\` first.
`;
}

const CLAUDE_SETTINGS_TEMPLATE = `${JSON.stringify(
  {
    permissions: {
      allow: ["Bash(sail *)", "Read", "Edit", "Glob", "Grep"]
    }
  },
  null,
  2
)}\n`;

function createSailConfig(graphSrc: string): string {
  return `${JSON.stringify({ graphSrc }, null, 2)}\n`;
}

const INDEX_TEMPLATE = `declare const process: {
  exit(code: number): never;
};

export default async function main() {
  console.log("hello from sail");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
`;

function toPackageName(projectRoot: string): string {
  return path
    .basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sail-project";
}

function createPackageJson(projectRoot: string, graphSrc: string): string {
  return `${JSON.stringify(
    {
      name: toPackageName(projectRoot),
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: `tsx ${path.posix.join(...graphSrc.split(path.sep), "index.ts")}`,
        start: `tsx ${path.posix.join(...graphSrc.split(path.sep), "index.ts")}`,
        test: "vitest run",
        typecheck: "tsc --noEmit"
      },
      devDependencies: {
        "@types/node": "^24.12.0",
        tsx: "^4.20.5",
        typescript: "^5.9.3",
        vitest: "^3.2.4"
      }
    },
    null,
    2
  )}\n`;
}

function createTsconfig(graphSrc: string): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["${path.posix.join(...graphSrc.split(path.sep), "**/*.ts")}"]
}
`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(targetPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, "utf8");
}

export default async function initProject(projectRoot: string, force: boolean): Promise<string> {
  const srcDir = path.join(projectRoot, "src");
  const defaultGraphSrc = ((await pathExists(srcDir)) ? path.join("src", "sail") : "sail").replaceAll("\\", "/");
  const graphSrcDir = path.join(projectRoot, defaultGraphSrc);
  const configPath = path.join(projectRoot, "sail.config.json");
  const indexPath = path.join(graphSrcDir, "index.ts");
  const packageJsonPath = path.join(projectRoot, "package.json");
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  const docsHelpPath = path.join(projectRoot, "docs", "sail-help.md");
  const claudePath = path.join(projectRoot, "CLAUDE.md");
  const claudeSettingsPath = path.join(projectRoot, ".claude", "settings.local.json");
  const targetPaths = [
    configPath,
    packageJsonPath,
    tsconfigPath,
    indexPath,
    docsHelpPath,
    claudePath,
    claudeSettingsPath
  ];

  if (!force) {
    const existingPaths = (
      await Promise.all(
        targetPaths.map(async (targetPath) => ((await pathExists(targetPath)) ? targetPath : null))
      )
    ).filter((targetPath): targetPath is string => targetPath !== null);

    if (existingPaths.length > 0) {
      throw new SailError(
        `Refusing to overwrite existing bootstrap files: ${existingPaths
          .map((targetPath) => path.relative(projectRoot, targetPath))
          .join(", ")}.\n` +
          `What to do: re-run \`sail init --force\` only if you want to replace the bootstrap files.`
      );
    }
  }

  await fs.mkdir(graphSrcDir, { recursive: true });
  await writeFile(configPath, createSailConfig(defaultGraphSrc));
  await writeFile(packageJsonPath, createPackageJson(projectRoot, defaultGraphSrc));
  await writeFile(tsconfigPath, createTsconfig(defaultGraphSrc));
  await writeFile(indexPath, INDEX_TEMPLATE);
  await writeFile(docsHelpPath, createProjectHelpTemplate(defaultGraphSrc));
  await writeFile(claudePath, createClaudeTemplate(defaultGraphSrc));
  await writeFile(claudeSettingsPath, CLAUDE_SETTINGS_TEMPLATE);

  return [
    "initialized project files:",
    `- ${path.relative(projectRoot, configPath) || "sail.config.json"}`,
    `- ${path.relative(projectRoot, packageJsonPath) || "package.json"}`,
    `- ${path.relative(projectRoot, tsconfigPath) || "tsconfig.json"}`,
    `- ${path.relative(projectRoot, indexPath) || path.join(defaultGraphSrc, "index.ts")}`,
    `- ${path.relative(projectRoot, docsHelpPath) || "docs/sail-help.md"}`,
    `- ${path.relative(projectRoot, claudePath) || "CLAUDE.md"}`,
    `- ${path.relative(projectRoot, claudeSettingsPath) || ".claude/settings.local.json"}`
  ].join("\n");
}
