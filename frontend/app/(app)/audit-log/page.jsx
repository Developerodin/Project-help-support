'use client';



import { useCallback, useMemo } from 'react';

import { usePathname } from 'next/navigation';

import '../../rbac-access.css';

import AuditLogView from '@/shared/components/rbac/audit-log-view.jsx';

import { useHistorySearch } from '@/shared/lib/use-history-search.js';



const PAGE_LIMITS = [20, 50, 100];

const DEFAULT_LIMIT = 50;

const SORT_OPTIONS = ['createdAt:desc', 'createdAt:asc'];

const CATEGORIES = ['', 'policy', 'access', 'security', 'whatsapp'];



function auditQueryFromSearch(searchString) {

  const params = new URLSearchParams(searchString);

  const page = Math.max(1, Number(params.get('page')) || 1);

  const limit = PAGE_LIMITS.includes(Number(params.get('limit')))

    ? Number(params.get('limit'))

    : DEFAULT_LIMIT;

  const category = CATEGORIES.includes(params.get('category') ?? '') ? (params.get('category') || '') : '';

  const action = (params.get('action') || '').trim();

  const targetUserId = (params.get('targetUserId') || '').trim();

  const actorId = (params.get('actorId') || '').trim();

  const sortBy = SORT_OPTIONS.includes(params.get('sortBy')) ? params.get('sortBy') : 'createdAt:desc';

  return { page, limit, category, action, targetUserId, actorId, sortBy };

}



export default function AuditLogPage() {

  const pathname = usePathname();

  const searchString = useHistorySearch();

  const query = useMemo(() => auditQueryFromSearch(searchString), [searchString]);



  const writeAuditSearch = useCallback((patch) => {

    const params = new URLSearchParams(window.location.search);

    const next = { ...query, ...patch };

    if (next.page > 1) params.set('page', String(next.page));

    else params.delete('page');

    if (next.limit !== DEFAULT_LIMIT) params.set('limit', String(next.limit));

    else params.delete('limit');

    if (next.category) params.set('category', next.category);

    else params.delete('category');

    if (next.action) params.set('action', next.action);

    else params.delete('action');

    if (next.targetUserId) params.set('targetUserId', next.targetUserId);

    else params.delete('targetUserId');

    if (next.actorId) params.set('actorId', next.actorId);

    else params.delete('actorId');

    if (next.sortBy && next.sortBy !== 'createdAt:desc') params.set('sortBy', next.sortBy);

    else params.delete('sortBy');

    const qs = params.toString();

    const url = qs ? `${pathname}?${qs}` : pathname;

    window.history.replaceState(null, '', url);

  }, [pathname, query]);



  const patchQuery = useCallback((patch) => {

    const resetPage = 'category' in patch || 'action' in patch || 'targetUserId' in patch

      || 'actorId' in patch || 'sortBy' in patch || 'limit' in patch;

    writeAuditSearch({ ...patch, ...(resetPage ? { page: 1 } : {}) });

  }, [writeAuditSearch]);



  return (

    <>

      <div className="page-head">

        <div>

          <h1>Audit log</h1>

          <p className="sub">Append-only trail of role policy, scoped access, security events and actions taken from WhatsApp.</p>

        </div>

      </div>



      <AuditLogView

        query={query}

        onQueryChange={patchQuery}

        showOutboxBanner

      />

    </>

  );

}


