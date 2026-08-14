/** @typedef {{ label: string, path?: string }} ModulePage */
/** @typedef {{ label: string, pages?: ModulePage[] }} ModuleGroup */

/** @param {ModuleGroup[]} modules */
export function pagesForModule(modules, moduleLabel) {
  return modules.find((m) => m.label === moduleLabel)?.pages ?? [];
}

/** @param {ModuleGroup[]} modules @param {string} moduleLabel */
export function defaultPageForModule(modules, moduleLabel) {
  return pagesForModule(modules, moduleLabel)[0]?.label ?? '';
}

/** @param {ModuleGroup[]} modules */
export function defaultModulePageSelection(modules) {
  if (!modules.length) return { module: '', page: '' };
  const module = modules[0].label;
  return { module, page: defaultPageForModule(modules, module) };
}
