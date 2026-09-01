/** @typedef {{ id: string, key?: string, name: string, type: string, route: string, status: string, documentation: string }} ScreenFormRow */
/** @typedef {{ id: string, key?: string, label: string, path: string, screens: ScreenFormRow[] }} PageFormRow */
/** @typedef {{ id: string, key?: string, label: string, pages: PageFormRow[] }} ModuleFormRow */

let rowCounter = 0;

/** @returns {string} */
export function newRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  rowCounter += 1;
  return `row-${rowCounter}`;
}

const QA_PASSTHROUGH = ['qaStatus', 'comments', 'attachments', 'qaStatusHistory'];

/** @param {Record<string, unknown>} source @param {Record<string, unknown>} target */
function copyQaFields(source, target) {
  for (const field of QA_PASSTHROUGH) {
    if (source?.[field] !== undefined) target[field] = source[field];
  }
}

/** @param {Array<Record<string, unknown>>} [modules] @returns {ModuleFormRow[]} */
export function modulesToFormRows(modules = []) {
  return modules.map((mod) => ({
    id: mod.key || newRowId(),
    key: mod.key || undefined,
    label: mod.label ?? '',
    pages: (mod.pages ?? []).map((page) => ({
      id: page.key || newRowId(),
      key: page.key || undefined,
      label: page.label ?? '',
      path: page.path ?? '',
      screens: (page.screens ?? []).map((screen) => ({
        id: screen.key || newRowId(),
        key: screen.key || undefined,
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
    .map((mod) => {
      const nextMod = {
        key: mod.key || mod.id,
        label: mod.label.trim(),
        pages: mod.pages
          .map((page) => {
            const screens = (page.screens ?? [])
              .map((screen) => {
                const nextScreen = {
                  key: screen.key || screen.id,
                  name: screen.name.trim(),
                  type: screen.type || 'other',
                  route: (screen.route ?? '').trim(),
                  status: screen.status || 'active',
                  documentation: (screen.documentation ?? '').trim(),
                };
                copyQaFields(screen, nextScreen);
                return nextScreen;
              })
              .filter((screen) => screen.name);
            const nextPage = {
              key: page.key || page.id,
              label: page.label.trim(),
              path: (page.path ?? '').trim(),
            };
            copyQaFields(page, nextPage);
            if (screens.length) nextPage.screens = screens;
            return nextPage;
          })
          .filter((page) => page.label),
      };
      copyQaFields(mod, nextMod);
      return nextMod;
    })
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
