import fs from "node:fs/promises";
import path from "node:path";
import SailError from "./SailError.js";
import readSailConfig from "./readSailConfig.js";

export type TestFile = {
  absPath: string;
  id: string;
  pathFromRoot: string;
  source: string;
};

export function toResolvedNodeId(id: string): string {
  return id === "main" ? "index" : id;
}

export function isSpecFilePath(filePath: string): boolean {
  return filePath.endsWith(".spec.ts");
}

export function getSpecPathFromId(graphSrc: string, id: string): string {
  return path.join(graphSrc, `${toResolvedNodeId(id)}.spec.ts`);
}

export async function getSpecPath(projectRoot: string, id: string): Promise<string> {
  const config = await readSailConfig(projectRoot);
  return path.join(config.graphSrcDir, `${toResolvedNodeId(id)}.spec.ts`);
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
  const absPath = path.join(config.graphSrcDir, `${resolvedId}.spec.ts`);
  if (!(await pathExists(absPath))) {
    throw new SailError(
      `Could not find tests for node ${resolvedId}.\n` +
        `What to do: create them with \`sail test write ${resolvedId}\`.`
    );
  }

  return {
    absPath,
    id: resolvedId,
    pathFromRoot: getSpecPathFromId(config.graphSrc, resolvedId),
    source: await fs.readFile(absPath, "utf8")
  };
}

export async function collectTypeScriptFiles(srcDir: string): Promise<string[]> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absPath = path.join(srcDir, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(absPath);
      }

      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
        return [];
      }

      return [absPath];
    })
  );

  return files.flat().sort();
}
