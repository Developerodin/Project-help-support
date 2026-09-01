'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Icon from '@/shared/components/icons.jsx';
import UiQaStatusBadge from '@/shared/components/ui-qa/ui-qa-status-badge.jsx';
import UiQaDetailDrawer from '@/shared/components/ui-qa/ui-qa-detail-drawer.jsx';
import {
  uiQaEntityFromSearch,
  withUiQaParam,
  withoutUiQaParam,
} from '@/shared/lib/deep-link.js';
import {
  countIndicators,
  sameEntity,
} from '@/shared/components/ui-qa/ui-qa-utils.js';

function EntityIndicators({ entity }) {
  const { comments, attachments } = countIndicators(entity);
  if (!comments && !attachments) return null;
  return (
    <span className="ui-qa-indicators">
      {comments ? (
        <span className="ui-qa-indicator" title={`${comments} comment(s)`}>
          <Icon name="msg" size={12} />
          {comments}
        </span>
      ) : null}
      {attachments ? (
        <span className="ui-qa-indicator" title={`${attachments} attachment(s)`}>
          <Icon name="clip" size={12} />
          {attachments}
        </span>
      ) : null}
    </span>
  );
}

function HierarchyRow({
  level,
  label,
  expanded,
  canExpand,
  selected,
  onToggle,
  onSelect,
  status,
  entity,
  chips,
  expandLabel,
}) {
  return (
    <div
      className={`ui-qa-row ui-qa-row--${level}${expanded ? ' is-open' : ''}${selected ? ' is-selected' : ''}`}
    >
      {canExpand ? (
        <button
          type="button"
          className="ui-qa-row__chev"
          aria-expanded={expanded}
          aria-label={expandLabel}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <span className="ui-qa-row__chev-icon">
            <Icon name="chev-right" size={14} />
          </span>
        </button>
      ) : (
        <span className="ui-qa-row__chev ui-qa-row__chev--spacer" aria-hidden="true" />
      )}
      <button
        type="button"
        className="ui-qa-row__select"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="ui-qa-row__level">{level}</span>
        <strong className="ui-qa-row__title">{label}</strong>
        <span className="ui-qa-row__meta">
          <UiQaStatusBadge status={status || 'open'} />
          {chips}
          <EntityIndicators entity={entity} />
        </span>
      </button>
    </div>
  );
}

/**
 * @param {{
 *   modules: Array<Record<string, unknown>>,
 *   selected: Record<string, unknown> | null,
 *   onSelect: (selection: Record<string, unknown> | null) => void,
 * }} props
 */
export default function UiQaHierarchy({ modules = [], selected, onSelect }) {
  const [expandedModules, setExpandedModules] = useState(() => new Set());
  const [expandedPages, setExpandedPages] = useState(() => new Set());

  useEffect(() => {
    if (!selected?.entity) return;
    const { entity } = selected;
    if (entity.moduleKey) {
      setExpandedModules((prev) => new Set(prev).add(entity.moduleKey));
    }
    if (entity.pageKey) {
      setExpandedPages((prev) => new Set(prev).add(entity.pageKey));
    }
  }, [selected?.entity]);

  const toggleModule = (key) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePage = (key) => {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!modules.length) {
    return (
      <div className="ui-qa-empty-state">
        <h2>No module catalog yet</h2>
        <p>Configure modules and pages under Projects before tracking UI &amp; QA here.</p>
      </div>
    );
  }

  return (
    <div className="ui-qa-tree">
      {modules.map((mod) => {
        const moduleKey = mod.key;
        const moduleExpanded = expandedModules.has(moduleKey);
        const pageCount = mod.pages?.length || 0;
        const screenCount = (mod.pages || []).reduce(
          (sum, page) => sum + (page.screens?.length || 0),
          0,
        );
        const moduleEntity = { level: 'module', moduleKey };
        return (
          <div key={moduleKey} className="ui-qa-block">
            <HierarchyRow
              level="module"
              label={mod.label}
              expanded={moduleExpanded}
              canExpand={pageCount > 0}
              selected={sameEntity(selected?.entity, moduleEntity)}
              onToggle={() => toggleModule(moduleKey)}
              onSelect={() => onSelect({
                entity: moduleEntity,
                title: mod.label,
              })}
              status={mod.qaStatus}
              entity={mod}
              expandLabel={`${moduleExpanded ? 'Collapse' : 'Expand'} ${mod.label}`}
              chips={(
                <>
                  <span className="chip chip-sm ui-qa-count">{pageCount} pages</span>
                  <span className="chip chip-sm ui-qa-count">{screenCount} screens</span>
                </>
              )}
            />

            {moduleExpanded ? (mod.pages || []).map((page) => {
              const pageKey = page.key;
              const pageExpanded = expandedPages.has(pageKey);
              const screens = page.screens || [];
              const pageEntity = { level: 'page', moduleKey, pageKey };
              return (
                <div key={pageKey} className="ui-qa-block ui-qa-block--page">
                  <HierarchyRow
                    level="page"
                    label={page.label}
                    expanded={pageExpanded}
                    canExpand={screens.length > 0}
                    selected={sameEntity(selected?.entity, pageEntity)}
                    onToggle={() => togglePage(pageKey)}
                    onSelect={() => onSelect({
                      entity: pageEntity,
                      title: page.label,
                      breadcrumbs: [mod.label],
                      meta: page.path || undefined,
                    })}
                    status={page.qaStatus}
                    entity={page}
                    expandLabel={`${pageExpanded ? 'Collapse' : 'Expand'} ${page.label}`}
                    chips={<span className="chip chip-sm ui-qa-count">{screens.length} screens</span>}
                  />

                  {pageExpanded ? screens.map((screen) => {
                    const screenKey = screen.key;
                    const screenEntity = { level: 'screen', moduleKey, pageKey, screenKey };
                    return (
                      <HierarchyRow
                        key={screenKey}
                        level="screen"
                        label={screen.name}
                        expanded={false}
                        canExpand={false}
                        selected={sameEntity(selected?.entity, screenEntity)}
                        onToggle={() => {}}
                        onSelect={() => onSelect({
                          entity: screenEntity,
                          title: screen.name,
                          breadcrumbs: [mod.label, page.label],
                          meta: screen.route || undefined,
                        })}
                        status={screen.qaStatus}
                        entity={screen}
                        expandLabel=""
                        chips={null}
                      />
                    );
                  }) : null}
                </div>
              );
            }) : null}
          </div>
        );
      })}
    </div>
  );
}

function buildSelectionFromEntity(modules, entity) {
  const mod = modules.find((row) => row.key === entity.moduleKey);
  if (!mod) return null;

  if (entity.level === 'module') {
    return { entity, title: mod.label };
  }

  const page = (mod.pages || []).find((row) => row.key === entity.pageKey);
  if (!page) return null;

  if (entity.level === 'page') {
    return {
      entity,
      title: page.label,
      breadcrumbs: [mod.label],
      meta: page.path || undefined,
    };
  }

  const screen = (page.screens || []).find((row) => row.key === entity.screenKey);
  if (!screen) return null;

  return {
    entity,
    title: screen.name,
    breadcrumbs: [mod.label, page.label],
    meta: screen.route || undefined,
  };
}

/**
 * Hierarchy-only layout with ticket-style detail drawer.
 */
export function UiQaReviewWorkspace({
  projectId,
  modules = [],
  user,
  onUpdated,
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    const entity = uiQaEntityFromSearch(searchParams.toString());
    if (!entity) {
      setSelection(null);
      return;
    }
    const next = buildSelectionFromEntity(modules, entity);
    setSelection(next);
  }, [searchParams, modules]);

  const open = useCallback((next) => {
    setSelection(next);
    window.history.replaceState(
      null,
      '',
      `${pathname}${withUiQaParam(window.location.search, next?.entity)}`,
    );
  }, [pathname]);

  const close = useCallback(() => {
    setSelection(null);
    window.history.replaceState(
      null,
      '',
      `${pathname}${withoutUiQaParam(window.location.search)}`,
    );
  }, [pathname]);

  const selectedEntity = selection?.entity || null;

  return (
    <div className="ui-qa-review-workspace">
      <div className="ui-qa-review-workspace__tree" aria-label="Application hierarchy">
        <UiQaHierarchy
          modules={modules}
          selected={selection}
          onSelect={open}
        />
      </div>

      {selectedEntity ? (
        <UiQaDetailDrawer
          projectId={projectId}
          selection={selection}
          user={user}
          onClose={close}
          onChanged={onUpdated}
        />
      ) : null}
    </div>
  );
}
