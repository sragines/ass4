import React from 'react';
import { Database, FileText, Layers } from 'lucide-react';
import { DatabaseMetrics } from '../types/sales.ts';

interface MetricCardsProps {
  metrics: DatabaseMetrics | null;
  activeMode: 'ALL' | 'SQL' | 'NOSQL';
  onSelectMode: (mode: 'ALL' | 'SQL' | 'NOSQL') => void;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ metrics, activeMode, onSelectMode }) => {
  const totalSql = metrics?.totalSql ?? 600;
  const totalNosql = metrics?.totalNosql ?? 600;
  const sqlOnly = metrics?.sqlOnly ?? 300;
  const nosqlOnly = metrics?.nosqlOnly ?? 300;
  const sharedBoth = metrics?.sharedBoth ?? 300;
  const totalUnique = metrics?.totalUnique ?? 900;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3.5">
      {/* 1. SQL (SQLite) */}
      <button
        type="button"
        onClick={() => onSelectMode('SQL')}
        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
          activeMode === 'SQL'
            ? 'bg-sky-50/70 border-sky-400 ring-1 ring-sky-400/40'
            : 'bg-white border-[#E2E8F0] hover:border-slate-300 hover:bg-slate-50/60'
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap">
            <Database className="w-3.5 h-3.5 shrink-0 text-sky-600" />
            <span>SQL (SQLite)</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums whitespace-nowrap truncate">
            {sqlOnly.toLocaleString()} SQL-only · {sharedBoth.toLocaleString()} Shared
          </div>
        </div>
        <div className="text-xl font-bold font-mono tracking-tight text-[#0F172A] tabular-nums shrink-0">
          {totalSql.toLocaleString()}
        </div>
      </button>

      {/* 2. NoSQL (NeDB) */}
      <button
        type="button"
        onClick={() => onSelectMode('NOSQL')}
        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
          activeMode === 'NOSQL'
            ? 'bg-violet-50/70 border-violet-400 ring-1 ring-violet-400/40'
            : 'bg-white border-[#E2E8F0] hover:border-slate-300 hover:bg-slate-50/60'
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap">
            <FileText className="w-3.5 h-3.5 shrink-0 text-violet-600" />
            <span>NoSQL (NeDB)</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums whitespace-nowrap truncate">
            {nosqlOnly.toLocaleString()} NoSQL-only · {sharedBoth.toLocaleString()} Shared
          </div>
        </div>
        <div className="text-xl font-bold font-mono tracking-tight text-[#0F172A] tabular-nums shrink-0">
          {totalNosql.toLocaleString()}
        </div>
      </button>

      {/* 3. Total Unique Records */}
      <button
        type="button"
        onClick={() => onSelectMode('ALL')}
        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
          activeMode === 'ALL'
            ? 'bg-indigo-50/70 border-indigo-400 ring-1 ring-indigo-400/40'
            : 'bg-white border-[#E2E8F0] hover:border-slate-300 hover:bg-slate-50/60'
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap">
            <Layers className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
            <span>Total Unique Records</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums whitespace-nowrap truncate">
            {sqlOnly.toLocaleString()} SQL · {nosqlOnly.toLocaleString()} NoSQL · {sharedBoth.toLocaleString()} Replicated
          </div>
        </div>
        <div className="text-xl font-bold font-mono tracking-tight text-indigo-700 tabular-nums shrink-0">
          {totalUnique.toLocaleString()}
        </div>
      </button>
    </div>
  );
};

