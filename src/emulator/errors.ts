import type { SourceRange } from "../parser/astTypes.js";

export class SclEmulatorError extends Error {
  readonly range: SourceRange;

  constructor(message: string, range: SourceRange) {
    super(message);
    this.name = "SclEmulatorError";
    this.range = range;
  }
}

export class SclEmulatorBuildError extends SclEmulatorError {
  constructor(message: string, range: SourceRange) {
    super(message, range);
    this.name = "SclEmulatorBuildError";
  }
}

export class SclEmulatorRuntimeError extends SclEmulatorError {
  constructor(message: string, range: SourceRange) {
    super(message, range);
    this.name = "SclEmulatorRuntimeError";
  }
}
