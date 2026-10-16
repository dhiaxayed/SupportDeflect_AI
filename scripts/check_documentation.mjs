/**
 * Inspect repository JavaScript/TypeScript declarations with the installed compiler.
 * Called by check_documentation.py; comments are checked structurally, while human
 * review remains responsible for their accuracy and usefulness. No source is changed.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

/** Return the statement/property that owns documentation for a named function value. */
function commentOwner(node) {
  if (ts.isVariableDeclaration(node)) {
    return node.parent.parent;
  }
  return node;
}

/** Read only comments immediately preceding a declaration, including its export modifiers. */
function hasComment(node, source) {
  const owner = commentOwner(node);
  const ranges = ts.getLeadingCommentRanges(source.text, owner.getFullStart()) || [];
  return ranges.some((range) => {
    const content = source.text.slice(range.pos, range.end).replace(/[/\s*]+/g, "");
    return content.length >= 12;
  });
}

/** Recognize functions assigned directly or through React's ref/memo component adapters. */
function isFunctionValue(node) {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  return (
    ts.isCallExpression(node) &&
    /(?:^|\.)(?:forwardRef|memo)$/.test(node.expression.getText()) &&
    node.arguments.some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
  );
}

/** Inspect one parsed file and return named contracts plus explicit missing-comment locations. */
function inspect(filename) {
  const text = fs.readFileSync(filename, "utf8");
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const missing = [];
  let declarations = 0;
  const header = text.replace(/^\uFEFF/, "").replace(/^#![^\n]*\n/, "").trimStart();
  if (!header.startsWith("//") && !header.startsWith("/*")) {
    missing.push({ name: "<module>", line: 1 });
  }
  // TypeScript owns JSONC grammar, including comments/trailing commas in tsconfig.
  if (filename === "frontend/tsconfig.json") {
    const configuration = ts.parseConfigFileTextToJson(filename, text);
    if (configuration.error) missing.push({ name: "<invalid JSONC>", line: 1 });
    return { file: filename, declarations, missing };
  }

  /** Traverse nested named contracts without requiring repetitive docs on inline JSX/test callbacks. */
  function visit(node) {
    const named =
      (ts.isFunctionDeclaration(node) && node.name) ||
      (ts.isClassDeclaration(node) && node.name) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      (ts.isPropertyAssignment(node) && isFunctionValue(node.initializer)) ||
      (ts.isVariableDeclaration(node) && node.initializer && isFunctionValue(node.initializer));
    if (named) {
      declarations += 1;
      if (!hasComment(node, source)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        missing.push({ name: node.name?.getText(source) || "constructor", line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return { file: filename.replaceAll(path.sep, "/"), declarations, missing };
}

const filenames = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(filenames.map(inspect)));
