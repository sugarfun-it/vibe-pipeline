// Unified output helpers. All exit-code logic lives here.

let jsonMode = false;

export function setJsonMode(v: boolean): void {
  jsonMode = v;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function okJson<T>(data: T): void {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
}

// Print human-readable line (no-op in JSON mode)
export function print(line: string): void {
  if (!jsonMode) process.stdout.write(line + "\n");
}

export function printLines(lines: string[]): void {
  if (!jsonMode) {
    for (const l of lines) process.stdout.write(l + "\n");
  }
}

export function fail(code: string, message: string, exitCode = 1): never {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + "\n");
  } else {
    process.stderr.write(`Error [${code}]: ${message}\n`);
  }
  process.exit(exitCode);
}

// Simple column table renderer
export function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const cols = rows[0].length;
  const widths: number[] = Array.from({ length: cols }, (_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length))
  );
  return rows
    .map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  "))
    .join("\n");
}
