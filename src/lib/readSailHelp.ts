import fs from "node:fs/promises";
import path from "node:path";

export default async function readSailHelp(): Promise<string> {
  const helpPath = path.resolve(__dirname, "..", "docs", "sail-help-preamble.txt");
  const contents = await fs.readFile(helpPath, "utf8");

  return contents.trimEnd();
}
