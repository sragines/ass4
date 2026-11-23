/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { MetricCards } from './components/MetricCards.tsx';
import { SearchControls } from './components/SearchControls.tsx';
import { RecordsTable } from './components/RecordsTable.tsx';
import { EditReplicateModal } from './components/EditReplicateModal.tsx';
import { FulfillModal } from './components/FulfillModal.tsx';
import { RecordDetailModal } from './components/RecordDetailModal.tsx';
import { RetryQueueDrawer } from './components/RetryQueueDrawer.tsx';
import {
  SalesRecord,
  DatabaseMetrics,
  RetryQueueItem,
  ReplicationEvent,
  SortField,
  SortDirection,
  StorageLocation,
} from './types/sales.ts';

export default function App() {
  // Navigation & view states
  const [activeTab, setActiveTab] = useState<'explorer' | 'retries'>('explorer');

  // Metrics
  const [metrics, setMetrics] = useState<DatabaseMetrics | null>(null);

  // Search, Filtering & Sorting state
  const [searchMode, setSearchMode] = useState<'ALL' | 'SQL' | 'NOSQL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('Transaction_ID');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const limit = 25;

  // Records data
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableStatuses, setAvailableStatuses] = useState<string[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);

  // Retries & Replication
  const [retries, setRetries] = useState<RetryQueueItem[]>([]);
  const [replicationEvents, setReplicationEvents] = useState<ReplicationEvent[]>([]);
  const [eventsCount, setEventsCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRefreshingRetries, setIsRefreshingRetries] = useState(false);

  // Modals state
  const [selectedRecordForEdit, setSelectedRecordForEdit] = useState<SalesRecord | null>(null);
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<SalesRecord | null>(null);
  const [isFulfillModalOpen, setIsFulfillModalOpen] = useState(false);
  const [isRetryDrawerOpen, setIsRetryDrawerOpen] = useState(false);

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/metrics', { cache: 'no-store' });
      if (res.ok) {
        const data: DatabaseMetrics = await res.json();
        setMetrics(data);
        if (typeof data.eventsCount === 'number') {
          setEventsCount(data.eventsCount);
        }
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  }, []);

  // Fetch retries & protocol event log
  const fetchRetries = useCallback(async () => {
    setIsRefreshingRetries(true);
    try {
      const res = await fetch('/api/retries', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRetries(data.retries || []);
        setReplicationEvents(data.events || []);
        setEventsCount(
          typeof data.eventsCount === 'number'
            ? data.eventsCount
            : (data.events || []).length
        );
      }
    } catch (err) {
      console.error('Failed to fetch retries:', err);
    } finally {
      setIsRefreshingRetries(false);
    }
  }, []);

  const appendReplicationEvent = useCallback((evt?: ReplicationEvent) => {
    if (!evt) return;
    setReplicationEvents((prev) => {
      if (prev.some((existing) => existing.eventId === evt.eventId)) return prev;
      return [evt, ...prev];
    });
    setEventsCount((prev) => prev + 1);
  }, []);

  // Fetch records
  const fetchRecords = useCallback(
    async (overrides?: {
      mode?: 'ALL' | 'SQL' | 'NOSQL';
      query?: string;
      category?: string;
      status?: string;
      sortBy?: SortField;
      sortDir?: SortDirection;
      page?: number;
    }) => {
      setIsLoadingRecords(true);
      try {
        const params = new URLSearchParams({
          mode: overrides?.mode ?? searchMode,
          query: overrides?.query ?? searchQuery,
          category: overrides?.category ?? selectedCategory,
          status: overrides?.status ?? selectedStatus,
          sortBy: overrides?.sortBy ?? sortBy,
          sortDir: overrides?.sortDir ?? sortDir,
          page: (overrides?.page ?? page).toString(),
          limit: limit.toString(),
        });

        const res = await fetch(`/api/records?${params.toString()}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setRecords(data.records || []);
          setTotalCount(data.totalCount || 0);
          setTotalPages(data.totalPages || 1);
          setAvailableCategories(data.categories || []);
          setAvailableStatuses(data.statuses || []);
        }
      } catch (err) {
        console.error('Failed to fetch records:', err);
      } finally {
        setIsLoadingRecords(false);
      }
    },
    [searchMode, searchQuery, selectedCategory, selectedStatus, sortBy, sortDir, page, limit]
  );

  // Initial load
  useEffect(() => {
    fetchMetrics();
    fetchRetries();
  }, [fetchMetrics, fetchRetries]);

  // Reset page to 1 when search filters or sorting change
  useEffect(() => {
    setPage(1);
  }, [searchMode, searchQuery, selectedCategory, selectedStatus, sortBy, sortDir]);

  // Fetch records when parameters change
  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleSortChange = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(
        field === 'Transaction_ID' || field === 'Order_Date' || field === 'Sales_Amount'
          ? 'desc'
          : 'asc'
      );
    }
    setPage(1);
  };

  // Handle retry single item
  const handleRetrySingle = async (transactionId: string) => {
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/retries/${transactionId}/retry`, { method: 'POST' });
      if (res.ok) {
        await Promise.all([fetchMetrics(), fetchRecords(), fetchRetries()]);
      }
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setIsRetrying(false);
    }
  };

  // Handle retry all items
  const handleRetryAll = async () => {
    setIsRetrying(true);
    try {
      const res = await fetch('/api/retries/retry-all', { method: 'POST' });
      if (res.ok) {
        await Promise.all([fetchMetrics(), fetchRecords(), fetchRetries()]);
      }
    } catch (err) {
      console.error('Retry all failed:', err);
    } finally {
      setIsRetrying(false);
    }
  };

  // Handle discard retry item
  const handleDiscardRetry = async (transactionId: string) => {
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/retries/${transactionId}`, { method: 'DELETE' });
      if (res.ok) {
        await Promise.all([fetchMetrics(), fetchRetries()]);
      }
    } catch (err) {
      console.error('Discard retry failed:', err);
    } finally {
      setIsRetrying(false);
    }
  };

  // Synchronize tab clicks with drawers
  const handleTabChange = (tab: 'explorer' | 'retries') => {
    setActiveTab(tab);
    if (tab === 'retries') {
      void Promise.all([fetchRetries(), fetchMetrics()]);
      setIsRetryDrawerOpen(true);
    } else {
      setIsRetryDrawerOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col font-sans antialiased selection:bg-indigo-500/15 selection:text-indigo-900">
      {/* Top Bar Contract Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        eventsCount={eventsCount}
        onOpenFulfillModal={() => setIsFulfillModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-4">
        {/* Metric Counters (x3 compact aligned with Search Tabs) */}
        <MetricCards
          metrics={metrics}
          activeMode={searchMode}
          onSelectMode={(mode) => setSearchMode(mode)}
        />

        {/* Search Controls & 3 Search Modes */}
        <SearchControls
          searchMode={searchMode}
          setSearchMode={setSearchMode}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          selectedStatus={selectedStatus}
          setSelectedStatus={setSelectedStatus}
          availableCategories={availableCategories}
          availableStatuses={availableStatuses}
          totalRecords={totalCount}
        />

        {/* Interactive Results Table */}
        <RecordsTable
          records={records}
          isLoading={isLoadingRecords}
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          limit={limit}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onPageChange={(newPage) => setPage(newPage)}
          onEditReplicate={(record) => setSelectedRecordForEdit(record)}
          onViewDetails={(record) => setSelectedRecordForDetail(record)}
        />
      </main>

      {/* Modals & Drawers */}
      <EditReplicateModal
        record={selectedRecordForEdit}
        isOpen={Boolean(selectedRecordForEdit)}
        onClose={() => setSelectedRecordForEdit(null)}
        onSuccess={async (updatedRecord, event) => {
          appendReplicationEvent(event);
          if (updatedRecord) {
            setRecords((prev) =>
              prev.map((r) =>
                r.Transaction_ID === updatedRecord.Transaction_ID ? updatedRecord : r
              )
            );
          }
          await Promise.all([fetchMetrics(), fetchRecords(), fetchRetries()]);
        }}
      />

      <FulfillModal
        isOpen={isFulfillModalOpen}
        onClose={() => setIsFulfillModalOpen(false)}
        onSuccess={async (createdRecord, targetStore?: StorageLocation, event?: ReplicationEvent) => {
          appendReplicationEvent(event);

          const nextMode: 'ALL' | 'SQL' | 'NOSQL' =
            (searchMode === 'SQL' && targetStore === 'NOSQL_ONLY') ||
            (searchMode === 'NOSQL' && targetStore === 'SQL_ONLY')
              ? 'ALL'
              : searchMode;
          const nextCategory =
            selectedCategory && createdRecord?.Product_Category !== selectedCategory
              ? ''
              : selectedCategory;
          const nextStatus =
            selectedStatus && createdRecord?.Order_Status !== selectedStatus
              ? ''
              : selectedStatus;
          const nextQuery = searchQuery ? '' : searchQuery;

          if (nextMode !== searchMode) setSearchMode(nextMode);
          if (nextCategory !== selectedCategory) setSelectedCategory(nextCategory);
          if (nextStatus !== selectedStatus) setSelectedStatus(nextStatus);
          if (nextQuery !== searchQuery) setSearchQuery(nextQuery);
          if (sortBy !== 'Transaction_ID') setSortBy('Transaction_ID');
          if (sortDir !== 'desc') setSortDir('desc');
          if (page !== 1) setPage(1);

          await Promise.all([
            fetchMetrics(),
            fetchRecords({
              mode: nextMode,
              query: nextQuery,
              category: nextCategory,
              status: nextStatus,
              sortBy: 'Transaction_ID',
              sortDir: 'desc',
              page: 1,
            }),
            fetchRetries(),
          ]);
        }}
      />

      <RecordDetailModal
        record={selectedRecordForDetail}
        isOpen={Boolean(selectedRecordForDetail)}
        onClose={() => setSelectedRecordForDetail(null)}
      />

      <RetryQueueDrawer
        isOpen={isRetryDrawerOpen}
        onClose={() => {
          setIsRetryDrawerOpen(false);
          setActiveTab('explorer');
        }}
        events={replicationEvents}
        onRefresh={async () => {
          await Promise.all([fetchRetries(), fetchMetrics()]);
        }}
        isRefreshing={isRefreshingRetries}
      />
    </div>
  );
}
