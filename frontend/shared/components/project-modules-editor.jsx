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
 *   onSave?: () => void,
 *   hasUnsavedChanges?: boolean,
 * }} props
 */
export default function ProjectModulesEditor({
  value,
  onChange,
  projectKey,
  onSave,
  hasUnsavedChanges = false,
}) {
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
  const isEmpty = rows.length === 0;

  return (
    <div className="modules-editor">
      {isEmpty ? (
        <div className="modules-editor-empty">
          <h4>No modules configured</h4>
          <p>
            {showDefaultCatalog
              ? 'Load the WEB catalog to seed ATS, LMS, and other modules, or add modules manually.'
              : 'Add a module, then list the pages someone can pick when filing a ticket.'}
          </p>
          <div className="empty-actions">
            {showDefaultCatalog ? (
              <button type="button" className="btn btn-primary" onClick={loadDefaultCatalog}>
                <Icon name="plus" size={12} />
                Load default catalog
              </button>
            ) : null}
            <button type="button" className="btn" onClick={addModule}>
              <Icon name="plus" size={12} />
              Add module
            </button>
          </div>
        </div>
      ) : (
        <>
          {rows.map((mod, index) => (
            <article key={mod.id} className="module-card">
              <header>
                <span className="module-card-index">Module {index + 1}</span>
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

              {mod.pages.length > 0 ? (
                <div className="page-rows-head" aria-hidden="true">
                  <span>Page label</span>
                  <span>Path</span>
                  <span />
                </div>
              ) : null}

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

              <button type="button" className="btn btn-sm btn-ghost module-add-page" onClick={() => addPage(mod.id)}>
                <Icon name="plus" size={12} />
                Add page
              </button>
            </article>
          ))}

          <div className="modules-catalog-foot">
            <button type="button" className="btn btn-sm btn-ghost" onClick={addModule}>
              <Icon name="plus" size={12} />
              Add module
            </button>
            {showDefaultCatalog ? (
              <button type="button" className="btn btn-sm" onClick={loadDefaultCatalog}>
                Load default catalog
              </button>
            ) : null}
            <span className="spacer" />
            {onSave ? (
              <button
                type="button"
                className={`btn btn-sm${hasUnsavedChanges ? ' btn-primary' : ''}`}
                onClick={onSave}
              >
                Save modules
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
