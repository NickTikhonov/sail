import { Node, Project, SyntaxKind } from "ts-morph";
import { inferSpecFileSuffix } from "./typescriptFiles.js";

function isActiveTestCall(expression: Node): boolean {
  if (Node.isIdentifier(expression)) {
    return expression.getText() === "it" || expression.getText() === "test";
  }

  if (!Node.isPropertyAccessExpression(expression)) {
    return false;
  }

  const root = expression.getExpression().getText();
  const name = expression.getName();
  if (root !== "it" && root !== "test") {
    return false;
  }

  return name !== "skip" && name !== "todo";
}

export default function countSpecTests(sourceText: string): number {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(`node${inferSpecFileSuffix(sourceText)}`, sourceText);

  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((callExpression) => isActiveTestCall(callExpression.getExpression())).length;
}
