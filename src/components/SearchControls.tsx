import React from 'react';
import { Search, Layers, Database, FileText, X } from 'lucide-react';

interface SearchControlsProps {
  searchMode: 'ALL' | 'SQL' | 'NOSQL';
  setSearchMode: (mode: 'ALL' | 'SQL' | 'NOSQL') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  selectedStatus: string;
  setSelectedStatus: (s: string) => void;
  availableCategories: string[];
  availableStatuses: string[];
  totalRecords: number;
}

export const SearchControls: React.FC<SearchControlsProps> = ({
  searchMode,
  setSearchMode,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  selectedStatus,
  setSelectedStatus,
  availableCategories,
  availableStatuses,
  totalRecords,
}) => {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 mb-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      {/* Row 1: Mode Selector segmented controls & Result Count */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-2.5">
        <div className="flex items-center gap-1 p-1 bg-slate-100/80 border border-[#E2E8F0] rounded-lg overflow-x-auto">
          <button
            onClick={() => setSearchMode('ALL')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              searchMode === 'ALL'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A] hover:bg-white/70'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Search ALL (Deduplicated)</span>
          </button>

          <button
            onClick={() => setSearchMode('SQL')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              searchMode === 'SQL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A] hover:bg-white/70'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Search SQL Only</span>
          </button>

          <button
            onClick={() => setSearchMode('NOSQL')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              searchMode === 'NOSQL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-[#0F172A] hover:bg-white/70'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Search NoSQL Only</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-2 shrink-0">
          <span>Matching records:</span>
          <span className="font-mono font-semibold text-[#0F172A] tabular-nums bg-slate-100 px-2 py-0.5 rounded border border-[#E2E8F0]">
            {totalRecords.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Row 2: Search input & dynamic filter dropdowns */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
        {/* Text Search */}
        <div className="md:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Transaction ID, Order, Customer, Product, City..."
            className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dynamic Category Filter */}
        <div className="md:col-span-3">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500 transition-all"
          >
            <option value="">All Categories</option>
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Dynamic Status Filter */}
        <div className="md:col-span-3">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500 transition-all"
          >
            <option value="">All Statuses</option>
            {availableStatuses.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
