# Standalone SCL Runner

The standalone runner executes Siemens SCL snippets that contain only an optional `VAR` declaration block followed by statements. It reuses the emulator's parser, IR, and interpreter while swapping in an in-memory PLC state so snippets can execute without FB scaffolding or symbol databases.

## Quick Start

```ts
import { executeStandaloneScl } from "scl-emulator";

const source = `
VAR
  index : INT;
  total : INT;
END_VAR

total := 0;
FOR index := 0 TO 7 DO
  IF (index = 0) OR (index = 2) OR (index = 4) OR (index = 6) THEN
    CONTINUE;
  END_IF;
  total := total + index;
END_FOR;
`;

const result = executeStandaloneScl(source, { trace: true });
console.log(result.variables.total); // 16
```

## Supported Constructs

- Siemens scalar types already handled by the emulator (`BOOL`, `INT`, `DINT`, `LINT`, `REAL`, `LREAL`, `TIME`, `DATE`, `TOD`, `STRING[...]`, etc.).
- Control flow: assignments, `IF`/`ELSIF`/`ELSE`, `FOR`, `WHILE`, `EXIT`, `CONTINUE`, and `CASE` (including value and range selectors).
- Arithmetic, comparison, and boolean operators covered by the existing interpreter.

## Restrictions

- No access to hardware I/O, data blocks, or system flags - any `I*`, `Q*`, `M*`, or `DB*` address usage raises a build error.
- Arrays, user-defined `TYPE`s, and multi-block projects are out of scope.
- Only variables declared in the snippet may be referenced; undeclared identifiers are rejected during preparation.

## Tracing and Results

`executeStandaloneScl` returns final variable bindings and, when `trace: true` is provided, a per-statement write trace identical to the emulator's execution trace. Each trace entry lists the statement range and the addresses affected in the standalone memory store.

## Advanced Usage

Use `prepareStandaloneProgram` when you need to parse and validate a snippet once and execute it multiple times:

```ts
import { executeProgram, prepareStandaloneProgram, StandaloneMemory } from "scl-emulator";

const program = prepareStandaloneProgram(source);
const memory = new StandaloneMemory();

const symbols: Record<string, { address: string; dataType: typeof program.variables[number]["dataType"] }> = {};
for (const variable of program.variables) {
  symbols[variable.name] = {
    address: memory.bindVariable(variable.name, variable.dataType, variable.stringLength),
    dataType: variable.dataType,
    stringLength: variable.stringLength,
  };
}

executeProgram(program.ir, memory, { symbols });
console.log(memory.getVariables());
```

## Error Handling

The runner surfaces `SclEmulatorBuildError` for semantic violations (e.g., using an undeclared variable or PLC address) and reuses `SclEmulatorRuntimeError` for runtime issues such as division by zero or loop iteration limits.
