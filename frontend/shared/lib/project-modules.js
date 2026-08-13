/** @typedef {{ id: string, label: string, path: string }} PageFormRow */
/** @typedef {{ id: string, label: string, pages: PageFormRow[] }} ModuleFormRow */

let rowCounter = 0;

/** @returns {string} */
export function newRowId() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

/** @param {Array<{ label?: string, pages?: Array<{ label?: string, path?: string }> }>} [modules] @returns {ModuleFormRow[]} */
export function modulesToFormRows(modules = []) {
  return modules.map((mod) => ({
    id: newRowId(),
    label: mod.label ?? '',
    pages: (mod.pages ?? []).map((page) => ({
      id: newRowId(),
      label: page.label ?? '',
      path: page.path ?? '',
    })),
  }));
}

/** @param {ModuleFormRow[]} rows @returns {Array<{ label: string, pages: Array<{ label: string, path: string }> }>} */
export function formRowsToModules(rows) {
  return rows
    .map((mod) => ({
      label: mod.label.trim(),
      pages: mod.pages
        .map((page) => ({
          label: page.label.trim(),
          path: (page.path ?? '').trim(),
        }))
        .filter((page) => page.label),
    }))
    .filter((mod) => mod.label);
}

/** @param {Array<{ label?: string, pages?: Array<{ label?: string, path?: string }> }>} modules */
export function cloneModules(modules) {
  return JSON.parse(JSON.stringify(modules));
}

/** @param {ModuleFormRow[]} rows */
export function isModulesDraftEmpty(rows) {
  if (!rows?.length) return true;
  return rows.every((mod) => !mod.label.trim() && mod.pages.every((page) => !page.label.trim() && !page.path.trim()));
}
