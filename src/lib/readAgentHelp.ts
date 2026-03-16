import fs from "node:fs/promises";
import path from "node:path";

export default async function readAgentHelp(): Promise<string> {
  const helpPath = path.resolve(__dirname, "..", "docs", "agentscript-help.md");
  const contents = await fs.readFile(helpPath, "utf8");

  return contents.trimEnd();
}
