'use client';

import { WEB_MODULE_TAXONOMY } from '@pms/shared';
import Icon from '@/shared/components/icons.jsx';
import {
  cloneModules,
  isModulesDraftEmpty,
  modulesToFormRows,
  newRowId,
} from '@/shared/lib/project-modules.js';

/**
 * @param {{
 *   value: import('@/shared/lib/project-modules.js').ModuleFormRow[],
 *   onChange: (rows: import('@/shared/lib/project-modules.js').ModuleFormRow[]) => void,
 *   projectKey?: string,
 * }} props
 */
export default function ProjectModulesEditor({ value, onChange, projectKey }) {
  const rows = value ?? [];

  const updateRows = (next) => onChange(next);

  const updateModule = (moduleId, patch) => {
    updateRows(rows.map((mod) => (mod.id === moduleId ? { ...mod, ...patch } : mod)));
  };

  const removeModule = (moduleId) => {
    updateRows(rows.filter((mod) => mod.id !== moduleId));
  };

  const addModule = () => {
    updateRows([...rows, { id: newRowId(), label: '', pages: [] }]);
  };

  const addPage = (moduleId) => {
    updateRows(rows.map((mod) => (
      mod.id === moduleId
        ? { ...mod, pages: [...mod.pages, { id: newRowId(), label: '', path: '' }] }
        : mod
    )));
  };

  const updatePage = (moduleId, pageId, patch) => {
    updateRows(rows.map((mod) => (
      mod.id === moduleId
        ? {
          ...mod,
          pages: mod.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
        }
        : mod
    )));
  };

  const removePage = (moduleId, pageId) => {
    updateRows(rows.map((mod) => (
      mod.id === moduleId
        ? { ...mod, pages: mod.pages.filter((page) => page.id !== pageId) }
        : mod
    )));
  };

  const loadDefaultCatalog = () => {
    updateRows(modulesToFormRows(cloneModules(WEB_MODULE_TAXONOMY)));
  };

  const showDefaultCatalog = projectKey === 'WEB' && isModulesDraftEmpty(rows);

  return (
    <div className="modules-editor">
      {rows.length === 0 ? (
        <p className="meta">No modules yet. Add a module or load the default catalog.</p>
      ) : null}

      {rows.map((mod, index) => (
        <article key={mod.id} className="module-card">
          <header>
            <span className="lbl">Module {index + 1}</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-ico"
              aria-label={`Remove module ${index + 1}`}
              onClick={() => removeModule(mod.id)}
            >
              <Icon name="x" size={12} />
            </button>
          </header>

          <div className="form-row">
            <label htmlFor={`module-label-${mod.id}`}>Module name</label>
            <input
              id={`module-label-${mod.id}`}
              type="text"
              placeholder="e.g. ATS"
              value={mod.label}
              onChange={(e) => updateModule(mod.id, { label: e.target.value })}
            />
          </div>

          <div className="page-rows">
            {mod.pages.map((page, pageIndex) => (
              <div key={page.id} className="page-row">
                <input
                  type="text"
                  aria-label={`Page label ${pageIndex + 1} in module ${index + 1}`}
                  placeholder="Page label"
                  value={page.label}
                  onChange={(e) => updatePage(mod.id, page.id, { label: e.target.value })}
                />
                <input
                  type="text"
                  aria-label={`Page path ${pageIndex + 1} in module ${index + 1}`}
                  placeholder="/path (optional)"
                  value={page.path}
                  onChange={(e) => updatePage(mod.id, page.id, { path: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-ico"
                  aria-label={`Remove page ${pageIndex + 1} in module ${index + 1}`}
                  onClick={() => removePage(mod.id, page.id)}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-sm btn-ghost" onClick={() => addPage(mod.id)}>
            <Icon name="plus" size={12} />
            Add page
          </button>
        </article>
      ))}

      <div className="modules-editor-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={addModule}>
          <Icon name="plus" size={12} />
          Add module
        </button>
        {showDefaultCatalog ? (
          <button type="button" className="btn btn-sm" onClick={loadDefaultCatalog}>
            Load default catalog
          </button>
        ) : null}
      </div>
    </div>
  );
}
