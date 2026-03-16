import fs from "node:fs/promises";
import path from "node:path";
import AgentScriptError from "./AgentScriptError.js";

const PROJECT_HELP_TEMPLATE = `# AgentScript

This project is meant to be worked on through AgentScript, not by manually editing files under \`src/\`.

- Use \`agentscript help\` first.
- Prefer \`query\`, \`graph\`, and \`read\` before \`write\`.
- Use \`write\` with a full valid file, not a fragment.
`;

const CLAUDE_TEMPLATE = `Use AgentScript for all work in this repo.

1. Do not manually read or write files under \`src/\`.
2. Use \`agentscript\` commands to inspect and change the project.
3. \`agentscript\` is already on PATH. Run \`agentscript help\` first.
`;

const CLAUDE_SETTINGS_TEMPLATE = `${JSON.stringify(
  {
    permissions: {
      allow: ["Bash(agentscript *)", "Read", "Edit", "Glob", "Grep"]
    }
  },
  null,
  2
)}\n`;

const INDEX_TEMPLATE = `declare const process: {
  exit(code: number): never;
};

export default async function main() {
  console.log("hello from agentscript");
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
    .replace(/^-+|-+$/g, "") || "agentscript-project";
}

function createPackageJson(projectRoot: string): string {
  return `${JSON.stringify(
    {
      name: toPackageName(projectRoot),
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        typecheck: "tsc --noEmit"
      },
      devDependencies: {
        "@types/node": "^24.12.0",
        typescript: "^5.9.3"
      }
    },
    null,
    2
  )}\n`;
}

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
`;

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
  const indexPath = path.join(srcDir, "index.ts");
  const packageJsonPath = path.join(projectRoot, "package.json");
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  const docsHelpPath = path.join(projectRoot, "docs", "agentscript-help.md");
  const claudePath = path.join(projectRoot, "CLAUDE.md");
  const claudeSettingsPath = path.join(projectRoot, ".claude", "settings.local.json");
  const targetPaths = [packageJsonPath, tsconfigPath, indexPath, docsHelpPath, claudePath, claudeSettingsPath];

  if (!force) {
    const existingPaths = (
      await Promise.all(
        targetPaths.map(async (targetPath) => ((await pathExists(targetPath)) ? targetPath : null))
      )
    ).filter((targetPath): targetPath is string => targetPath !== null);

    if (existingPaths.length > 0) {
      throw new AgentScriptError(
        `Refusing to overwrite existing bootstrap files: ${existingPaths
          .map((targetPath) => path.relative(projectRoot, targetPath))
          .join(", ")}.\n` +
          `What to do: re-run \`agentscript init --force\` only if you want to replace the bootstrap files.`
      );
    }
  }

  await writeFile(packageJsonPath, createPackageJson(projectRoot));
  await writeFile(tsconfigPath, TSCONFIG_TEMPLATE);
  await writeFile(indexPath, INDEX_TEMPLATE);
  await writeFile(docsHelpPath, PROJECT_HELP_TEMPLATE);
  await writeFile(claudePath, CLAUDE_TEMPLATE);
  await writeFile(claudeSettingsPath, CLAUDE_SETTINGS_TEMPLATE);

  return [
    "initialized project files:",
    `- ${path.relative(projectRoot, packageJsonPath) || "package.json"}`,
    `- ${path.relative(projectRoot, tsconfigPath) || "tsconfig.json"}`,
    `- ${path.relative(projectRoot, indexPath) || "src/index.ts"}`,
    `- ${path.relative(projectRoot, docsHelpPath) || "docs/agentscript-help.md"}`,
    `- ${path.relative(projectRoot, claudePath) || "CLAUDE.md"}`,
    `- ${path.relative(projectRoot, claudeSettingsPath) || ".claude/settings.local.json"}`
  ].join("\n");
}
