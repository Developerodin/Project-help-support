/** @typedef {{ id: string, name: string, type: string, route: string, status: string, documentation: string }} ScreenFormRow */
/** @typedef {{ id: string, label: string, path: string, screens: ScreenFormRow[] }} PageFormRow */
/** @typedef {{ id: string, label: string, pages: PageFormRow[] }} ModuleFormRow */

let rowCounter = 0;

/** @returns {string} */
export function newRowId() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

/** @param {Array<{ label?: string, pages?: Array<{ label?: string, path?: string, screens?: Array<{ name?: string, type?: string, route?: string, status?: string, documentation?: string }> }> }>} [modules] @returns {ModuleFormRow[]} */
export function modulesToFormRows(modules = []) {
  return modules.map((mod) => ({
    id: newRowId(),
    label: mod.label ?? '',
    pages: (mod.pages ?? []).map((page) => ({
      id: newRowId(),
      label: page.label ?? '',
      path: page.path ?? '',
      screens: (page.screens ?? []).map((screen) => ({
        id: newRowId(),
        name: screen.name ?? '',
        type: screen.type ?? 'list',
        route: screen.route ?? '',
        status: screen.status ?? 'active',
        documentation: screen.documentation ?? '',
      })),
    })),
  }));
}

/** @param {ModuleFormRow[]} rows @returns {Array<{ label: string, pages: Array<{ label: string, path: string, screens: Array<{ name: string, type: string, route: string, status: string, documentation: string }> }> }>} */
export function formRowsToModules(rows) {
  return rows
    .map((mod) => ({
      label: mod.label.trim(),
      pages: mod.pages
        .map((page) => {
          const screens = (page.screens ?? [])
            .map((screen) => ({
              name: screen.name.trim(),
              type: screen.type || 'other',
              route: (screen.route ?? '').trim(),
              status: screen.status || 'active',
              documentation: (screen.documentation ?? '').trim(),
            }))
            .filter((screen) => screen.name);
          const nextPage = {
            label: page.label.trim(),
            path: (page.path ?? '').trim(),
          };
          if (screens.length) nextPage.screens = screens;
          return nextPage;
        })
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
