// Minimal arg parser. Supports:
//   positional args (non-flag tokens)
//   --flag (boolean true)
//   --key value or --key=value (string)
//   -- (stop flag parsing; rest go to positional)

export type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let stopFlags = false;
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (stopFlags || !a.startsWith("-")) {
      positional.push(a);
      i++;
      continue;
    }
    if (a === "--") {
      stopFlags = true;
      i++;
      continue;
    }
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      if (eqIdx !== -1) {
        const key = a.slice(2, eqIdx);
        const val = a.slice(eqIdx + 1);
        flags[key] = val;
        i++;
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        // bare "-" 是 Unix stdin 慣例,允許當 value(--prompt-file -);其餘以 "-" 開頭視為下個 flag
        if (next !== undefined && (next === "-" || !next.startsWith("-"))) {
          flags[key] = next;
          i += 2;
        } else {
          flags[key] = true;
          i++;
        }
      }
    } else {
      // single dash flags treated as booleans
      const key = a.slice(1);
      flags[key] = true;
      i++;
    }
  }
  return { positional, flags };
}

export function bool(v: string | boolean | undefined): boolean {
  return v === true || v === "true" || v === "1";
}
