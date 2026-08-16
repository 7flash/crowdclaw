type Fields = Record<string, unknown>;

function clean(value: unknown): unknown {
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function log(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields: Fields = {},
): void {
  const payload: Fields = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  for (const [key, value] of Object.entries(fields))
    payload[key] = clean(value);
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error || "unknown error");
}
