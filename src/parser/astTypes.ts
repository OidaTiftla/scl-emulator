export interface SourceRange {
  /** Inclusive zero-based start offset within the input string. */
  start: number;
  /** Exclusive zero-based end offset within the input string. */
  end: number;
}

export interface SclAstNode {
  /** Rule or token identifier. */
  type: string;
  /** Raw text matched by the node. */
  text: string;
  /** Source-range information for downstream tooling. */
  range: SourceRange;
  /** Child nodes preserving the parse tree structure. */
  children: SclAstNode[];
}

export interface SclAst {
  /** Root parse tree node derived from the grammar entry rule. */
  root: SclAstNode;
}

export class SclParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SclParseError";
  }
}
