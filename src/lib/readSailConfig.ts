import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import SailError from "./SailError.js";

const SailConfigSchema = z.object({
  graphSrc: z.string().trim().min(1)
});

type SailConfig = {
  configPath: string;
  graphSrc: string;
  graphSrcDir: string;
};

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${issuePath}: ${issue.message}`;
    })
    .join("\n");
}

function validateGraphSrc(projectRoot: string, rawGraphSrc: string): { graphSrc: string; graphSrcDir: string } {
  const normalized = path.normalize(rawGraphSrc);
  if (!normalized || normalized === ".") {
    throw new SailError(
      `Invalid sail.config.json.\n` +
        `What to do: set \`graphSrc\` to a non-empty relative path like \`src/sail\` or \`sail\`.`
    );
  }

  if (path.isAbsolute(normalized)) {
    throw new SailError(
      `Invalid sail.config.json.\n` +
        `What to do: set \`graphSrc\` to a project-relative path, not an absolute path.`
    );
  }

  const graphSrcDir = path.resolve(projectRoot, normalized);
  const relativeToRoot = path.relative(projectRoot, graphSrcDir);
  if (
    !relativeToRoot ||
    relativeToRoot === "." ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new SailError(
      `Invalid sail.config.json.\n` +
        `What to do: set \`graphSrc\` to a directory inside the project root, like \`src/sail\` or \`sail\`.`
    );
  }

  return {
    graphSrc: relativeToRoot,
    graphSrcDir
  };
}

export default async function readSailConfig(projectRoot: string): Promise<SailConfig> {
  const configPath = path.join(projectRoot, "sail.config.json");
  const contents = await fs.readFile(configPath, "utf8").catch(() => null);
  if (contents === null) {
    throw new SailError(
      `Expected sail.config.json in ${projectRoot}.\n` +
        `What to do: run \`sail init\` from the project root to create the required config.`
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(contents);
  } catch (error) {
    throw new SailError(
      `Could not parse sail.config.json.\n` +
        `What to do: fix the JSON syntax. Example:\n{\n  "graphSrc": "src/sail"\n}\n` +
        `Parse error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = SailConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new SailError(
      `Invalid sail.config.json.\n` +
        `What to do: define a config like:\n{\n  "graphSrc": "src/sail"\n}\n` +
        `${formatZodIssues(parsed.error)}`
    );
  }

  const validated = validateGraphSrc(projectRoot, parsed.data.graphSrc);
  return {
    configPath,
    ...validated
  };
}
