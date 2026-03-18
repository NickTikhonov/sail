import fs from "node:fs/promises";
import path from "node:path";
import SailError from "./SailError.js";
import readSailConfig from "./readSailConfig.js";
import {
  collectManagedTypeScriptFiles,
  describeSpecFilePath,
  inferSpecFileSuffix,
  isSpecFilePath,
  resolveSpecFilePaths,
  stripSpecFileExtension
} from "./typescriptFiles.js";

export type TestFile = {
  absPath: string;
  id: string;
  pathFromRoot: string;
  source: string;
};

export function toResolvedNodeId(id: string): string {
  return id === "main" ? "index" : id;
}

export function getSpecPathFromId(
  graphSrc: string,
  id: string,
  suffix: ".spec.ts" | ".spec.tsx" = ".spec.ts"
): string {
  return path.join(graphSrc, `${toResolvedNodeId(id)}${suffix}`);
}

export async function getSpecPath(projectRoot: string, id: string, sourceText?: string): Promise<string> {
  const config = await readSailConfig(projectRoot);
  const resolvedId = toResolvedNodeId(id);
  const matches = await resolveSpecFilePaths(config.graphSrcDir, resolvedId);
  if (matches.length > 1) {
    throw new SailError(
      `Found multiple test files for node ${resolvedId}.\n` +
        `What to do: keep a single test file at ${describeSpecFilePath(config.graphSrc, resolvedId)}.`
    );
  }

  if (matches.length === 1) {
    return matches[0]!;
  }

  return path.join(config.graphSrcDir, `${resolvedId}${inferSpecFileSuffix(sourceText ?? "")}`);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readSpecFile(projectRoot: string, id: string): Promise<TestFile> {
  const config = await readSailConfig(projectRoot);
  const resolvedId = toResolvedNodeId(id);
  const matches = await resolveSpecFilePaths(config.graphSrcDir, resolvedId);
  if (matches.length > 1) {
    throw new SailError(
      `Found multiple test files for node ${resolvedId}.\n` +
        `What to do: keep a single test file at ${describeSpecFilePath(config.graphSrc, resolvedId)}.`
    );
  }

  const absPath = matches[0];
  if (!absPath || !(await pathExists(absPath))) {
    throw new SailError(
      `Could not find tests for node ${resolvedId}.\n` +
        `What to do: create them with \`sail test write ${resolvedId}\`.`
    );
  }

  return {
    absPath,
    id: resolvedId,
    pathFromRoot: path.relative(projectRoot, absPath),
    source: await fs.readFile(absPath, "utf8")
  };
}

export async function collectTypeScriptFiles(srcDir: string): Promise<string[]> {
  return collectManagedTypeScriptFiles(srcDir);
}
