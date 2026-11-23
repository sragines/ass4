import React from 'react';
import { Database, Plus } from 'lucide-react';

interface NavbarProps {
  activeTab: 'explorer' | 'retries';
  setActiveTab: (tab: 'explorer' | 'retries') => void;
  eventsCount?: number;
  onOpenFulfillModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  eventsCount = 0,
  onOpenFulfillModal,
}) => {
  return (
    <header className="border-b border-[#E2E8F0] bg-white/95 backdrop-blur-md sticky top-0 z-40 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Database className="w-4 h-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0">
            Sales Ledger
          </span>
        </div>

        {/* Zone 2: Focused Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
          <button
            onClick={() => setActiveTab('explorer')}
            className={`transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeTab === 'explorer'
                ? 'border-indigo-600 text-[#0F172A] font-semibold'
                : 'border-transparent hover:text-[#0F172A]'
            }`}
          >
            Data Explorer
          </button>
          <button
            onClick={() => setActiveTab('retries')}
            title={`Replication Protocol Log (${eventsCount} events)`}
            className={`flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeTab === 'retries'
                ? 'border-indigo-600 text-[#0F172A] font-semibold'
                : 'border-transparent hover:text-[#0F172A]'
            }`}
          >
            <span>Replication Log</span>
            <span className="px-1.5 py-0.2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-mono rounded tabular-nums">
              {eventsCount}
            </span>
          </button>
        </nav>

        {/* Zone 3: Single Large Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={onOpenFulfillModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition-all shadow-sm whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Fulfill Record</span>
          </button>
        </div>
      </div>
    </header>
  );
};
