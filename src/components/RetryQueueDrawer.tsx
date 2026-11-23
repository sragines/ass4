import React, { useEffect } from 'react';
import { X, RefreshCw, ArrowLeftRight, History } from 'lucide-react';
import type { ReplicationEvent } from '../types/sales.ts';

interface RetryQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  events: ReplicationEvent[];
  onRefresh: () => Promise<void>;
  isRefreshing?: boolean;
}

export const RetryQueueDrawer: React.FC<RetryQueueDrawerProps> = ({
  isOpen,
  onClose,
  events,
  onRefresh,
  isRefreshing = false,
}) => {
  useEffect(() => {
    if (isOpen) {
      void onRefresh();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getSyncLabel = (evt: ReplicationEvent) => {
    if (evt.syncSummary) return evt.syncSummary;
    if (evt.partition === 'BOTH') {
      return evt.status === 'SYNCED' || evt.status === 'SUCCESS_SYNCHRONIZED'
        ? 'SQLite ↔ NeDB · SYNCED'
        : `SQLite ↔ NeDB · ${evt.status}`;
    }
    if (evt.partition === 'SQL_ONLY') return 'SQLite Only · Isolated (NeDB N/A)';
    return 'NeDB Only · Isolated (SQLite N/A)';
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[2px]">
      <div className="w-full max-w-xl bg-white border-l border-[#E2E8F0] h-full flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="p-5 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0F172A]">
                Replication Protocol Log
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Versioned synchronization audit log between SQLite and NeDB
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void onRefresh()}
              disabled={isRefreshing}
              title="Refresh replication log"
              className="p-1.5 rounded-lg text-slate-500 hover:text-[#0F172A] hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-[#0F172A] hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Body: Direct Chronological Replication Event Log */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]">
          {events.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs text-center p-6">
              <div className="w-11 h-11 rounded-xl bg-white border border-[#E2E8F0] flex items-center justify-center text-slate-400 mb-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <History className="w-5 h-5" />
              </div>
              <p className="font-semibold text-[#0F172A]">No Replication Events Logged Yet</p>
              <p className="mt-1 text-slate-500 max-w-xs">
                Create or update a shared BOTH record to inspect version transitions and SQLite ↔ NeDB sync events here.
              </p>
            </div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.eventId}
                className="p-3.5 rounded-xl border border-[#E2E8F0] bg-white text-xs space-y-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-bold text-[#0F172A]">{evt.transactionId}</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md font-semibold border ${
                        evt.action === 'INSERT'
                          ? 'bg-sky-50 text-sky-800 border-sky-200'
                          : 'bg-slate-100 text-slate-700 border-[#E2E8F0]'
                      }`}
                    >
                      {evt.action}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-[#E2E8F0]">
                      {evt.partition}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 font-medium tabular-nums">
                      v{evt.fromVersion} → v{evt.toVersion}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap font-semibold border ${
                      evt.status === 'SYNCED' || evt.status === 'SUCCESS_SYNCHRONIZED'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : evt.status === 'PENDING_RETRY'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : evt.status === 'CONFLICT_REJECTED'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-slate-100 text-slate-700 border-[#E2E8F0]'
                    }`}
                  >
                    {evt.status}
                  </span>
                </div>

                {/* Changed Fields List */}
                {evt.changedFields && evt.changedFields.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {evt.changedFields.map((diff) => (
                      <span
                        key={diff.field}
                        className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] text-slate-700"
                      >
                        <span className="text-indigo-700 font-medium">{diff.field}</span>:{' '}
                        <span className="text-slate-500">{String(diff.from)}</span> →{' '}
                        <span className="text-emerald-700 font-medium">{String(diff.to)}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-600">{evt.details}</div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-mono pt-1.5 border-t border-[#E2E8F0]">
                  <span className="text-slate-700 font-medium">{getSyncLabel(evt)}</span>
                  <span className="text-slate-500 tabular-nums">
                    {new Date(evt.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-[#0F172A] bg-white border border-[#E2E8F0] hover:bg-slate-100 rounded-lg transition-colors"
          >
            Close Drawer
          </button>
        </div>
      </div>
    </div>
  );
};
