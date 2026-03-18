import fs from "node:fs/promises";
import path from "node:path";
import { ts } from "ts-morph";
import SailError from "./SailError.js";

function createProjectHelpTemplate(graphSrc: string): string {
  return `sail project preamble

This project is meant to be worked on through sail, not by manually editing files under the configured graph source directory.

Use \`sail help\` first.
Prefer \`query\`, \`graph\`, and \`read\` before \`write\`.
Use \`write\` with a full valid file, not a fragment.
Use \`sail test write <id>\` and \`sail test patch <id>\` for node tests.
The graph source root for this project is \`${graphSrc}\`, defined in \`sail.config.json\`.
If a function write opens test debt, pay it back before the next implementation write.
`;
}

function createClaudeTemplate(graphSrc: string): string {
  return `Use sail for all work in this repo.

1. Do not manually read or write files under \`${graphSrc}/\`.
2. Use \`sail\` commands to inspect and change the project.
3. \`sail\` is already on PATH. Run \`sail help\` first.
`;
}

function prependClaudeTemplate(existingContents: string, sailTemplate: string): string {
  const trimmedExisting = existingContents.trim();
  if (!trimmedExisting) {
    return sailTemplate;
  }

  return `${sailTemplate.trimEnd()}\n\n${trimmedExisting}\n`;
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

const MAIN_INDEX_TEMPLATE = `declare const process: {
  exit(code: number): never;
};

type SailConsole = {
  error(...args: unknown[]): void;
  log(...args: unknown[]): void;
};

export default async function main() {
  (globalThis as { console?: SailConsole }).console?.log("hello from sail");
}

try {
  await main();
} catch (error) {
  (globalThis as { console?: SailConsole }).console?.error(error);
  process.exit(1);
}
`;

const PUBLIC_INDEX_TEMPLATE = `// Re-export sail nodes from this file for use outside the sail graph.
export {};
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
    "jsx": "preserve",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["${path.posix.join(...graphSrc.split(path.sep), "**/*.ts")}", "${path.posix.join(...graphSrc.split(path.sep), "**/*.tsx")}"]
}
`;
}

function createIndexTemplate(publicSurface: boolean): string {
  return publicSurface ? PUBLIC_INDEX_TEMPLATE : MAIN_INDEX_TEMPLATE;
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

async function mergeTsconfigIfNeeded(tsconfigPath: string, graphSrc: string): Promise<"created" | "merged" | "unchanged"> {
  if (!(await pathExists(tsconfigPath))) {
    await writeFile(tsconfigPath, createTsconfig(graphSrc));
    return "created";
  }

  const existingText = await fs.readFile(tsconfigPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, existingText);
  if (parsed.error) {
    const message = ts.formatDiagnosticsWithColorAndContext([parsed.error], {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n"
    });
    throw new SailError(
      `Could not parse the existing tsconfig.json.\n` +
        `What to do: fix tsconfig.json before running \`sail init\`.\n${message}`
    );
  }

  const config = parsed.config && typeof parsed.config === "object" ? parsed.config : {};
  const includePatterns = Array.isArray(config.include) ? [...config.include] : null;
  const requiredPatterns = [`${graphSrc}/**/*.ts`, `${graphSrc}/**/*.tsx`];
  let changed = false;

  if (includePatterns) {
    const nextIncludePatterns = [...includePatterns];
    for (const requiredPattern of requiredPatterns) {
      if (!nextIncludePatterns.includes(requiredPattern)) {
        nextIncludePatterns.push(requiredPattern);
        changed = true;
      }
    }
    config.include = nextIncludePatterns;
  }

  if (!config.compilerOptions || typeof config.compilerOptions !== "object") {
    config.compilerOptions = {};
  }

  if (config.compilerOptions.jsx === undefined) {
    config.compilerOptions.jsx = "preserve";
    changed = true;
  }

  if (changed) {
    await writeFile(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`);
    return "merged";
  }

  return "unchanged";
}

function resolveInitTarget(projectRoot: string, projectName?: string): { createdDirectory: boolean; targetRoot: string } {
  if (!projectName) {
    return {
      createdDirectory: false,
      targetRoot: projectRoot
    };
  }

  const normalized = path.normalize(projectName);
  if (!normalized || normalized === "." || path.isAbsolute(normalized)) {
    throw new SailError(
      `Invalid project name for \`sail init\`.\n` +
        `What to do: pass a relative directory name like \`my-app\`.`
    );
  }

  const targetRoot = path.resolve(projectRoot, normalized);
  const relativeToCwd = path.relative(projectRoot, targetRoot);
  if (
    !relativeToCwd ||
    relativeToCwd === "." ||
    relativeToCwd.startsWith("..") ||
    path.isAbsolute(relativeToCwd)
  ) {
    throw new SailError(
      `Invalid project name for \`sail init\`.\n` +
        `What to do: pass a relative directory name inside the current working directory, like \`my-app\`.`
    );
  }

  return {
    createdDirectory: true,
    targetRoot
  };
}

export default async function initProject(
  projectRoot: string,
  force: boolean,
  projectName?: string
): Promise<{ projectRoot: string; stdout: string }> {
  const target = resolveInitTarget(projectRoot, projectName);
  const packageJsonPath = path.join(target.targetRoot, "package.json");
  const tsconfigPath = path.join(target.targetRoot, "tsconfig.json");
  const hasExistingPackageJson = await pathExists(packageJsonPath);
  const hasExistingTsConfig = await pathExists(tsconfigPath);
  const isEmbeddedProject = hasExistingPackageJson || hasExistingTsConfig;
  const srcDir = path.join(target.targetRoot, "src");
  const defaultGraphSrc = ((await pathExists(srcDir)) ? path.join("src", "sail") : "sail").replaceAll("\\", "/");
  const graphSrcDir = path.join(target.targetRoot, defaultGraphSrc);
  const configPath = path.join(target.targetRoot, "sail.config.json");
  const indexPath = path.join(graphSrcDir, "index.ts");
  const docsHelpPath = path.join(target.targetRoot, "docs", "sail-help-preamble.txt");
  const claudePath = path.join(target.targetRoot, "CLAUDE.md");
  const claudeSettingsPath = path.join(target.targetRoot, ".claude", "settings.local.json");
  const canMergeClaude = !target.createdDirectory && (await pathExists(claudePath));
  const targetPaths = [
    configPath,
    indexPath,
    docsHelpPath,
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
          .map((targetPath) => path.relative(target.targetRoot, targetPath))
          .join(", ")}.\n` +
          `What to do: re-run \`sail init${projectName ? ` ${projectName}` : ""} --force\` only if you want to replace the bootstrap files.`
      );
    }
  }

  await fs.mkdir(graphSrcDir, { recursive: true });
  await writeFile(configPath, createSailConfig(defaultGraphSrc));
  if (!hasExistingPackageJson) {
    await writeFile(packageJsonPath, createPackageJson(target.targetRoot, defaultGraphSrc));
  }
  const tsconfigStatus = await mergeTsconfigIfNeeded(tsconfigPath, defaultGraphSrc);
  await writeFile(indexPath, createIndexTemplate(isEmbeddedProject));
  await writeFile(docsHelpPath, createProjectHelpTemplate(defaultGraphSrc));
  const claudeTemplate = createClaudeTemplate(defaultGraphSrc);
  if (canMergeClaude) {
    const existingClaude = await fs.readFile(claudePath, "utf8");
    await writeFile(claudePath, prependClaudeTemplate(existingClaude, claudeTemplate));
  } else {
    await writeFile(claudePath, claudeTemplate);
  }
  await writeFile(claudeSettingsPath, CLAUDE_SETTINGS_TEMPLATE);

  const header = target.createdDirectory
    ? `initialized project in ${path.relative(projectRoot, target.targetRoot)}:`
    : "initialized project files:";

  const lines = [
    header,
    `- ${path.relative(target.targetRoot, configPath) || "sail.config.json"}`,
    `- ${
      hasExistingPackageJson
        ? `${path.relative(target.targetRoot, packageJsonPath) || "package.json"} (kept existing)`
        : path.relative(target.targetRoot, packageJsonPath) || "package.json"
    }`,
    `- ${
      tsconfigStatus === "created"
        ? path.relative(target.targetRoot, tsconfigPath) || "tsconfig.json"
        : `${path.relative(target.targetRoot, tsconfigPath) || "tsconfig.json"} (${tsconfigStatus})`
    }`,
    `- ${path.relative(target.targetRoot, indexPath) || path.join(defaultGraphSrc, "index.ts")}`,
    `- ${path.relative(target.targetRoot, docsHelpPath) || "docs/sail-help-preamble.txt"}`,
    `- ${path.relative(target.targetRoot, claudePath) || "CLAUDE.md"}`,
    `- ${path.relative(target.targetRoot, claudeSettingsPath) || ".claude/settings.local.json"}`
  ];

  if (canMergeClaude) {
    lines.push(
      "",
      "note: prepended sail guidance to the existing CLAUDE.md.",
      "review that file and tailor the merged instructions to fit your workflow."
    );
  }

  return {
    projectRoot: target.targetRoot,
    stdout: lines.join("\n")
  };
}
