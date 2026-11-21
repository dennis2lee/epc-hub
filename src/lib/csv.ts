/**
 * One CSV cell. Cells that a spreadsheet could read as a formula (after leading
 * whitespace, which some import dialogs trim) get a leading apostrophe, and line
 * breaks inside a cell become spaces so a cell can never start a new formula line.
 */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const flat = raw.replace(/[\r\n]+/g, " ");
  const safe = /^[=+\-@\t]/.test(flat.trimStart()) ? `'${flat}` : flat;
  return `"${safe.replace(/"/g, '""')}"`;
}
