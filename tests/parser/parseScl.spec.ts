import { describe, expect, it } from "vitest";

import { parseScl, SclParseError } from "../../src/index.js";
import type { SclAstNode } from "../../src/parser/astTypes.js";

describe("parseScl", () => {
  it("parses a minimal FUNCTION_BLOCK and surfaces key nodes", () => {
    const source = `
      FUNCTION_BLOCK Counter
      VAR
        count : INT;
      END_VAR
      BEGIN
        count := count + 1;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);

    expect(ast.root.type).toBe("r");

    const fbBlock = findFirst(ast.root, "fbBlock");
    expect(fbBlock).toBeDefined();

    const assignment = findFirst(ast.root, "assignmentStatement");
    expect(assignment).toBeDefined();

    const left = findFirst(assignment!, "leftHandAssignment");
    const right = findFirst(assignment!, "rightHandAssignment");

    expect(left?.text).toContain("count");
    expect(right?.text).toContain("count+1");
  });

  it("throws a descriptive error on invalid input", () => {
    let thrown: unknown;
    try {
      parseScl("FUNCTION_BLOCK Incomplete");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SclParseError);
    expect((thrown as SclParseError).message).toMatch(/line 1:/);
  });
});

function findFirst(node: SclAstNode, type: string): SclAstNode | undefined {
  if (node.type === type) {
    return node;
  }

  for (const child of node.children) {
    const found = findFirst(child, type);
    if (found) {
      return found;
    }
  }

  return undefined;
}
