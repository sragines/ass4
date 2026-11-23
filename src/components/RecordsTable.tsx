import React from 'react';
import {
  RefreshCw,
  Database,
  FileText,
  Layers,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit3,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import type { SalesRecord, SortField, SortDirection } from '../types/sales.ts';

interface RecordsTableProps {
  records: SalesRecord[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  sortBy: SortField;
  sortDir: SortDirection;
  onSortChange: (field: SortField) => void;
  onPageChange: (newPage: number) => void;
  onEditReplicate: (record: SalesRecord) => void;
  onViewDetails: (record: SalesRecord) => void;
}

export const RecordsTable: React.FC<RecordsTableProps> = ({
  records,
  isLoading,
  page,
  totalPages,
  totalCount,
  limit,
  sortBy,
  sortDir,
  onSortChange,
  onPageChange,
  onEditReplicate,
  onViewDetails,
}) => {
  const renderSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition-colors shrink-0" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-indigo-600 shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-indigo-600 shrink-0" />
    );
  };

  const renderSortableHeader = (field: SortField, label: string, align: 'left' | 'right' = 'left') => {
    const isActive = sortBy === field;
    return (
      <button
        type="button"
        onClick={() => onSortChange(field)}
        className={`inline-flex items-center gap-1.5 group/th transition-colors select-none ${
          align === 'right' ? 'justify-end ml-auto' : 'justify-start'
        } ${isActive ? 'text-[#0F172A] font-semibold' : 'text-slate-600 hover:text-[#0F172A]'}`}
      >
        <span>{label}</span>
        {renderSortIcon(field)}
      </button>
    );
  };

  const renderPartitionSyncBadge = (record: SalesRecord) => {
    const version = record.version ?? 1;

    if (record.storage_location === 'SQL_ONLY') {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-sky-50 border border-sky-200 text-sky-800 whitespace-nowrap">
            <Database className="w-3 h-3 text-sky-600" />
            <span>SQL Only · Isolated</span>
          </span>
          <span className="text-[10px] font-mono text-slate-500 tabular-nums pl-0.5">v{version}</span>
        </div>
      );
    }

    if (record.storage_location === 'NOSQL_ONLY') {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-violet-50 border border-violet-200 text-violet-800 whitespace-nowrap">
            <FileText className="w-3 h-3 text-violet-600" />
            <span>NoSQL Only · Isolated</span>
          </span>
          <span className="text-[10px] font-mono text-slate-500 tabular-nums pl-0.5">v{version}</span>
        </div>
      );
    }

    // BOTH
    if (record.sync_status === 'PENDING_RETRY') {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-amber-50 border border-amber-200 text-amber-800 whitespace-nowrap">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            <span>SQL + NoSQL · Pending Retry</span>
          </span>
          <span className="text-[10px] font-mono text-amber-700 tabular-nums pl-0.5">v{version}</span>
        </div>
      );
    }

    if (record.sync_status === 'REPLICATING') {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-indigo-50 border border-indigo-200 text-indigo-800 whitespace-nowrap">
            <RefreshCw className="w-3 h-3 text-indigo-600 animate-spin" />
            <span>SQL + NoSQL · Replicating</span>
          </span>
          <span className="text-[10px] font-mono text-slate-500 tabular-nums pl-0.5">v{version}</span>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 whitespace-nowrap">
          <Layers className="w-3 h-3 text-emerald-600" />
          <span>SQL + NoSQL · Synced</span>
        </span>
        <span className="text-[10px] font-mono text-slate-500 tabular-nums pl-0.5">v{version}</span>
      </div>
    );
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)] mb-6">
      <div className="overflow-x-auto min-h-[360px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-slate-600 font-medium tracking-wider">
              <th className="py-2.5 px-3.5 whitespace-nowrap">
                {renderSortableHeader('Transaction_ID', 'Transaction ID')}
              </th>
              <th className="py-2.5 px-3 whitespace-nowrap">
                {renderSortableHeader('Order_Date', 'Date & Channel')}
              </th>
              <th className="py-2.5 px-3 whitespace-nowrap">
                {renderSortableHeader('Customer_Name', 'Customer')}
              </th>
              <th className="py-2.5 px-3 whitespace-nowrap text-slate-600">Product / Category</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">
                {renderSortableHeader('Sales_Amount', 'Qty & Amount', 'right')}
              </th>
              <th className="py-2.5 px-3 whitespace-nowrap">
                {renderSortableHeader('Order_Status', 'Order Status')}
              </th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap text-slate-600">Actions</th>
              <th className="py-2.5 px-3.5 whitespace-nowrap">
                {renderSortableHeader('Partition_Sync', 'Partition & Sync')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0] font-normal text-slate-700">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                    <span className="text-xs">Querying SQLite and NeDB stores...</span>
                  </div>
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <p className="text-sm font-medium text-[#0F172A]">No matching sales records found</p>
                    <p className="text-xs text-slate-500">Try adjusting your search criteria or switch search mode.</p>
                  </div>
                </td>
              </tr>
            ) : (
              records.map((record) => {
                const discountPct = Math.round((record.Discount_Percentage || 0) * 100);
                const unitLabel = record.Quantity === 1 ? 'unit' : 'units';

                return (
                  <tr
                    key={record.Transaction_ID}
                    className="hover:bg-slate-50/90 transition-colors group cursor-pointer"
                    onClick={() => onEditReplicate(record)}
                  >
                    {/* Transaction ID */}
                    <td className="py-2.5 px-3.5 font-mono font-semibold text-[#0F172A] whitespace-nowrap">
                      <span>{record.Transaction_ID}</span>
                    </td>

                    {/* Date & Channel */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-mono tabular-nums text-[#0F172A]">{record.Order_Date}</div>
                      <div className="text-[11px] text-slate-500">{record.Sales_Channel}</div>
                    </td>

                    {/* Customer */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-[#0F172A]">{record.Customer_Name}</div>
                      <div className="text-[11px] text-slate-500">{record.Customer_Segment} · {record.City}</div>
                    </td>

                    {/* Product / Category */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-[#0F172A]">{record.Product_Name}</div>
                      <div className="text-[11px] text-slate-500">{record.Product_Category} · {record.Product_Subcategory}</div>
                    </td>

                    {/* Qty & Amount */}
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="font-semibold text-[#0F172A]">${record.Sales_Amount.toFixed(2)}</div>
                      <div className="text-[11px] text-slate-500">
                        {record.Quantity} {unitLabel} @ ${record.Unit_Price.toFixed(2)} · {discountPct}% off
                      </div>
                    </td>

                    {/* Order Status */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-md border ${
                          record.Order_Status === 'Completed' || record.Order_Status === 'Delivered'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : record.Order_Status === 'Processing'
                            ? 'bg-sky-50 text-sky-800 border-sky-200'
                            : record.Order_Status === 'Shipped' || record.Order_Status === 'In Transit'
                            ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                            : record.Order_Status === 'Cancelled'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {record.Order_Status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td
                      className="py-2.5 px-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onViewDetails(record)}
                          title="Inspect all 36 schema fields"
                          className="p-1.5 text-slate-500 hover:text-[#0F172A] hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onEditReplicate(record)}
                          title="Edit fields, increment version, and run replication protocol"
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit & Replicate</span>
                        </button>
                      </div>
                    </td>

                    {/* Merged Partition & Sync Status Badge (Rightmost Column) */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {renderPartitionSyncBadge(record)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="border-t border-[#E2E8F0] px-4 py-2.5 bg-[#F8FAFC] flex items-center justify-between text-xs text-slate-600">
        <div>
          Showing{' '}
          <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
            {totalCount > 0 ? (page - 1) * limit + 1 : 0}
          </span>{' '}
          to{' '}
          <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
            {Math.min(page * limit, totalCount)}
          </span>{' '}
          of <span className="font-mono font-semibold text-[#0F172A] tabular-nums">{totalCount}</span> records
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            className="p-1 rounded-md bg-white border border-[#E2E8F0] text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-[#0F172A] text-xs tabular-nums">
            Page {page} of {Math.max(1, totalPages)}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="p-1 rounded-md bg-white border border-[#E2E8F0] text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
