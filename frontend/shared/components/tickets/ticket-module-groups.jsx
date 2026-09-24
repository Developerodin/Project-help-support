'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { LANES, laneOf } from '@pms/shared';
import { ASSISTANT_MODULE_VIEW_EVENT, takeModuleView } from '@/shared/lib/assistant-ticket-filters.js';
import Icon, { isOverdue } from '../icons.jsx';
import TicketCard from './ticket-card.jsx';

const NO_MODULE = 'No module';
const COLLAPSED_KEY = 'tickets.collapsedModules';
const SORT_KEY = 'tickets.moduleSort';
const PREVIEW_COUNT = 5;

const needsAttention = (ticket) => Boolean(ticket.blocked) || isOverdue(ticket);

const byName = (a, b) => {
  if (a.module === NO_MODULE) return 1;
  if (b.module === NO_MODULE) return -1;
  return a.module.localeCompare(b.module);
};

/** Most blocked-or-overdue tickets first, then the bigger module, then by name. */
const byUrgency = (a, b) => (b.attention - a.attention) || (b.tickets.length - a.tickets.length) || byName(a, b);

/**
 * Buckets tickets by module; server order is kept inside each bucket.
 * `sort` is 'name' (A–Z, "No module" last) or 'urgency'.
 */
export function groupTicketsByModule(tickets, sort = 'name') {
  const groups = new Map();
  for (const ticket of tickets) {
    const key = ticket.module?.trim() || NO_MODULE;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ticket);
  }
  return [...groups.entries()]
    .map(([module, items]) => ({ module, tickets: items, attention: items.filter(needsAttention).length }))
    .sort(sort === 'urgency' ? byUrgency : byName);
}

/**
 * Splits one module's tickets by page, A–Z with page-less tickets last.
 * Returns a single unlabelled group when no ticket names a page.
 */
export function groupTicketsByPage(tickets) {
  const pages = new Map();
  for (const ticket of tickets) {
    const key = ticket.page?.trim() || '';
    if (!pages.has(key)) pages.set(key, []);
    pages.get(key).push(ticket);
  }
  return [...pages.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
    .map(([page, items]) => ({ page, tickets: items }));
}

/** Tickets per board lane (intake → done), in LANES order. */
export function laneCounts(tickets) {
  const counts = Object.fromEntries(LANES.map((lane) => [lane.key, 0]));
  for (const ticket of tickets) {
    const key = laneOf(ticket.status);
    if (key) counts[key] += 1;
  }
  return LANES.map((lane) => ({ key: lane.key, label: lane.label, count: counts[lane.key] }));
}

function StageBar({ lanes, total }) {
  const summary = lanes.filter((lane) => lane.count > 0).map((lane) => `${lane.label} ${lane.count}`).join(', ');
  return (
    <span className="mg-bar" role="img" aria-label={`By stage: ${summary || 'none'}`}>
      {lanes.map((lane) => (lane.count > 0 ? (
        <i
          key={lane.key}
          data-lane={lane.key}
          style={{ flexGrow: lane.count }}
          title={`${lane.label}: ${lane.count} of ${total}`}
        />
      ) : null))}
    </span>
  );
}

// ponytail: per-browser conveniences only; neither is part of the shared URL.
function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage blocked: the choice still holds for this visit */ }
}

function ModuleGroup({
  group, collapsed, onToggle, showAll, onToggleShowAll, onOpen, canCreate,
}) {
  const bodyId = useId();
  const overdue = group.tickets.filter(isOverdue).length;
  const blocked = group.tickets.filter((ticket) => ticket.blocked).length;
  const count = group.tickets.length;
  const lanes = laneCounts(group.tickets);
  const open = count - lanes.find((lane) => lane.key === 'done').count;
  const hidden = count - PREVIEW_COUNT;
  const pages = groupTicketsByPage(group.tickets);
  const labelled = pages.some((entry) => entry.page);
  // The preview cap runs over page order, so "Show more" continues where the pages leave off.
  const ordered = pages.flatMap((entry) => entry.tickets);
  const shown = new Set(showAll ? ordered : ordered.slice(0, PREVIEW_COUNT));
  const named = group.module !== NO_MODULE;

  return (
    // The whole card toggles. Clicks on anything interactive inside it (a ticket,
    // "Show more", the + link) do their own thing instead. The header button
    // carries the same toggle for keyboard and screen-reader users.
    <section
      className={`lane module-group${collapsed ? ' is-collapsed' : ''}${group.attention === 0 ? ' is-calm' : ''}`}
      aria-label={group.module}
      onClick={(event) => {
        if (!event.target.closest('button, a, select, .card-shell')) onToggle(group.module);
      }}
    >
      <div className="module-group-head">
        <h3>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => onToggle(group.module)}
          >
            <span className="mg-top">
              <span className="module-group-name">{group.module}</span>
              <span className="mg-open"><b className="num">{open}</b> open</span>
            </span>
            <StageBar lanes={lanes} total={count} />
            <span className="mg-meta">
              <span className="num">{count} total</span>
              {blocked > 0 && <span className="chip chip-blocked">{blocked} blocked</span>}
              {overdue > 0 && <span className="chip chip-late">{overdue} overdue</span>}
            </span>
          </button>
        </h3>
        {canCreate ? (
          <Link
            href={named ? `/tickets/new?module=${encodeURIComponent(group.module)}` : '/tickets/new'}
            className="module-group-add"
            aria-label={named ? `New ticket in ${group.module}` : 'New ticket'}
            title={named ? `New ticket in ${group.module}` : 'New ticket'}
          >
            <Icon name="plus" size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {/* Always rendered so open/close can animate; collapsed content is made
          visibility:hidden in CSS, which also drops it from tab order and the a11y tree. */}
      <div id={bodyId} className="mg-body">
        <div className="mg-body-clip">
          <div className="lane-stack">
            {pages.map((entry) => {
              const cards = entry.tickets.filter((ticket) => shown.has(ticket)).map((ticket) => (
                <TicketCard
                  key={ticket.id || ticket.ticketId}
                  ticket={ticket}
                  onOpen={onOpen}
                  draggable={false}
                  quietPriority
                />
              ));
              if (!cards.length) return null;
              if (!labelled) return cards;
              const name = entry.page || 'Other';
              return (
                <div key={name} className="mg-page" role="group" aria-label={`Page: ${name}`}>
                  <p className="mg-page-head" aria-hidden="true">
                    <span>{name}</span>
                    <span className="mg-page-sep">-</span>
                    <span className="num">{entry.tickets.length}</span>
                  </p>
                  {cards}
                </div>
              );
            })}
            {hidden > 0 ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost module-group-more"
                aria-expanded={showAll}
                onClick={() => onToggleShowAll(group.module)}
              >
                {showAll ? 'Show fewer' : `Show ${hidden} more`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

const lower = (names) => names.map((name) => String(name).trim().toLowerCase());

/**
 * Module names the assistant asked for (null = all), matched to the groups on
 * screen. The `except` ones get the opposite, so "collapse all but X" leaves X open.
 */
function namedGroups(groups, modules, except = []) {
  const all = groups.map((group) => group.module);
  const wanted = modules == null ? null : lower(modules);
  const kept = lower(except);
  const targets = all.filter((name) => (wanted == null || wanted.includes(name.toLowerCase()))
    && !kept.includes(name.toLowerCase()));
  const spared = all.filter((name) => kept.includes(name.toLowerCase()));
  return { targets, spared };
}

export default function TicketModuleGroups({ tickets, onOpen, busy = false, canCreate = false }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sort, setSort] = useState('name');
  // Modules showing every ticket rather than the first few ("Show more").
  const [showingAll, setShowingAll] = useState(() => new Set());
  // Off until the stored state is restored, so remembered-collapsed modules
  // don't visibly animate shut on page load.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setCollapsed(new Set(readStored(COLLAPSED_KEY, [])));
    setSort(readStored(SORT_KEY, 'name') === 'urgency' ? 'urgency' : 'name');
    const timer = window.setTimeout(() => setAnimate(true), 50);
    return () => window.clearTimeout(timer);
  }, []);

  const saveCollapsed = (next) => {
    setCollapsed(next);
    writeStored(COLLAPSED_KEY, [...next]);
  };

  const chooseSort = (next) => {
    setSort(next);
    writeStored(SORT_KEY, next);
  };

  const groups = groupTicketsByModule(tickets, sort);
  const allCollapsed = groups.every((group) => collapsed.has(group.module));
  const overdueTotal = tickets.filter(isOverdue).length;
  const blockedTotal = tickets.filter((ticket) => ticket.blocked).length;

  const toggle = (module) => {
    const next = new Set(collapsed);
    if (next.has(module)) next.delete(module);
    else next.add(module);
    saveCollapsed(next);
  };

  const toggleShowAll = (module) => {
    const next = new Set(showingAll);
    if (next.has(module)) next.delete(module);
    else next.add(module);
    setShowingAll(next);
  };

  // Steps from the assistant: taken now (it may have opened this view for them)
  // and whenever more arrive; applied once the tickets are here to match names against.
  const [assistantSteps, setAssistantSteps] = useState(null);
  useEffect(() => {
    const takeSteps = () => {
      const steps = takeModuleView();
      if (steps) setAssistantSteps(steps);
    };
    takeSteps();
    window.addEventListener(ASSISTANT_MODULE_VIEW_EVENT, takeSteps);
    return () => window.removeEventListener(ASSISTANT_MODULE_VIEW_EVENT, takeSteps);
  }, []);
  useEffect(() => {
    if (!assistantSteps || (busy && !tickets.length)) return;
    setAssistantSteps(null);
    for (const step of assistantSteps) {
      if (step.order) chooseSort(step.order === 'attention' ? 'urgency' : 'name');
      if (!step.action) continue;
      const { targets, spared } = namedGroups(groups, step.modules, step.except);
      if (step.action === 'collapse' || step.action === 'expand') {
        const collapse = step.action === 'collapse';
        // Updater form: the stored state may have been restored in this same commit.
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const name of targets) {
            if (collapse) next.add(name);
            else next.delete(name);
          }
          for (const name of spared) {
            if (collapse) next.delete(name);
            else next.add(name);
          }
          writeStored(COLLAPSED_KEY, [...next]);
          return next;
        });
      } else {
        setShowingAll((prev) => {
          const next = new Set(prev);
          for (const name of targets) {
            if (step.action === 'show_all') next.add(name);
            else next.delete(name);
          }
          return next;
        });
      }
    }
  }, [assistantSteps, busy, tickets]); // Applied once per request, against the modules on screen.

  const toggleAll = () => {
    const next = new Set(collapsed);
    for (const group of groups) {
      if (allCollapsed) next.delete(group.module);
      else next.add(group.module);
    }
    saveCollapsed(next);
  };

  return (
    <>
      <div className="module-grid-bar">
        <p className="mg-summary">
          <span>{groups.length} {groups.length === 1 ? 'module' : 'modules'}</span>
          <span>{tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'}</span>
          {overdueTotal > 0 && <span className="mg-summary-warn">{overdueTotal} overdue</span>}
          {blockedTotal > 0 && <span className="mg-summary-alarm">{blockedTotal} blocked</span>}
        </p>
        <span className="spacer" />
        <ul className="mg-legend" aria-label="Stage bar legend">
          {LANES.map((lane) => (
            <li key={lane.key}><i data-lane={lane.key} aria-hidden="true" />{lane.label}</li>
          ))}
        </ul>
        <div className="seg" role="group" aria-label="Order modules by">
          <button type="button" aria-pressed={sort === 'name'} onClick={() => chooseSort('name')}>A–Z</button>
          <button type="button" aria-pressed={sort === 'urgency'} onClick={() => chooseSort('urgency')}>Needs attention</button>
        </div>
        <button type="button" className="btn btn-sm" onClick={toggleAll}>
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>
      <div
        className="module-grid"
        data-animate={animate ? 'true' : undefined}
        data-busy={busy ? 'true' : undefined}
        aria-busy={busy || undefined}
      >
        {groups.map((group) => (
          <ModuleGroup
            key={group.module}
            group={group}
            collapsed={collapsed.has(group.module)}
            onToggle={toggle}
            showAll={showingAll.has(group.module)}
            onToggleShowAll={toggleShowAll}
            onOpen={onOpen}
            canCreate={canCreate}
          />
        ))}
      </div>
    </>
  );
}
