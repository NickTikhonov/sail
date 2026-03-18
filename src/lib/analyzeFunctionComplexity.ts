import { Node, Project, SyntaxKind } from "ts-morph";

export default function analyzeFunctionComplexity(sourceText: string): number {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("node.ts", sourceText);

  const score =
    1 +
    sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.ForStatement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.ForInStatement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.WhileStatement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.DoStatement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression).length +
    sourceFile
      .getDescendantsOfKind(SyntaxKind.SwitchStatement)
      .reduce((count, statement) => count + Math.max(0, statement.getClauses().length - 1), 0) +
    sourceFile
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter((expression) => {
        const operator = expression.getOperatorToken().getKind();
        return operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken;
      }).length;

  const exportedFunction = sourceFile.getFunctions().find((declaration) => declaration.isDefaultExport());
  if (exportedFunction) {
    return score;
  }

  const exportAssignment = sourceFile.getExportAssignments().find((assignment) => !assignment.isExportEquals());
  if (!exportAssignment) {
    return score;
  }

  const expression = exportAssignment.getExpression();
  if (!Node.isIdentifier(expression)) {
    return score;
  }

  const declaration = sourceFile.getVariableDeclaration(expression.getText());
  if (!declaration) {
    return score;
  }

  const initializer = declaration.getInitializer();
  if (!initializer) {
    return score;
  }

  return score;
}
