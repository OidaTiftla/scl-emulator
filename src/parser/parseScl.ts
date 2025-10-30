import {
  ATNSimulator,
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  ErrorNode,
  ParserRuleContext,
  RecognitionException,
  Recognizer,
  TerminalNode,
  Token,
  type ParseTree,
  type Vocabulary
} from "antlr4ng";

import { SclParseError, type SclAst, type SclAstNode, type SourceRange } from "./astTypes.js";
import { sclLexer } from "../generated/sclLexer.js";
import { sclParser } from "../generated/sclParser.js";

class ThrowingErrorListener extends BaseErrorListener {
  override syntaxError<T extends Token, S extends ATNSimulator>(
    _recognizer: Recognizer<S>,
    offendingSymbol: T | null,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: RecognitionException | null
  ): void {
    const symbolText = offendingSymbol?.text;
    const decoratedMessage = symbolText
      ? `line ${line}:${charPositionInLine} near '${symbolText}': ${msg}`
      : `line ${line}:${charPositionInLine}: ${msg}`;
    throw new SclParseError(decoratedMessage);
  }
}

const errorListener = new ThrowingErrorListener();

export function parseScl(source: string): SclAst {
  const inputStream = CharStream.fromString(source);
  const lexer = new sclLexer(inputStream);
  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener);

  const tokenStream = new CommonTokenStream(lexer);
  const parser = new sclParser(tokenStream);
  parser.removeErrorListeners();
  parser.addErrorListener(errorListener);

  const tree = parser.r();
  const ruleNames = parser.ruleNames;
  const vocabulary = parser.vocabulary;

  const root = toAst(tree, ruleNames, vocabulary);

  return { root };
}

function toAst(
  node: ParseTree,
  ruleNames: readonly string[],
  vocabulary: Vocabulary
): SclAstNode {
  if (node instanceof ErrorNode) {
    const symbol = node.symbol;
    return {
      type: "ERROR",
      text: symbol?.text ?? "",
      range: toRange(symbol?.start, symbol?.stop),
      children: []
    };
  }

  if (node instanceof TerminalNode) {
    const symbol = node.symbol;
    const tokenType = symbol?.type ?? -1;
    const type =
      vocabulary.getSymbolicName(tokenType) ??
      vocabulary.getDisplayName(tokenType) ??
      "UNKNOWN";
    return {
      type,
      text: symbol?.text ?? "",
      range: toRange(symbol?.start, symbol?.stop),
      children: []
    };
  }

  if (node instanceof ParserRuleContext) {
    const type = ruleNames[node.ruleIndex] ?? `rule_${node.ruleIndex}`;
    const children: SclAstNode[] = [];
    const count = node.getChildCount();
    for (let i = 0; i < count; i += 1) {
      const child = node.getChild(i);
      if (child) {
        children.push(toAst(child, ruleNames, vocabulary));
      }
    }

    const startIndex = node.start?.start;
    const stopIndex = node.stop?.stop;

    return {
      type,
      text: node.getText(),
      range: toRange(startIndex, stopIndex),
      children
    };
  }

  return {
    type: "UNKNOWN",
    text: node.getText(),
    range: { start: 0, end: 0 },
    children: []
  };
}

function toRange(startIndex?: number, stopIndex?: number): SourceRange {
  const start = startIndex ?? -1;
  const end = (stopIndex ?? startIndex ?? -1) + 1;
  return { start, end };
}
