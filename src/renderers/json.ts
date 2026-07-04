// Every --json output goes through this, so a format change applies everywhere.
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
