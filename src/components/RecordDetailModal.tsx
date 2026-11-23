import React, { useEffect, useState } from 'react';
import { X, Database, FileText, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { SalesRecord, StorageLocation } from '../types/sales.ts';

interface RecordDetailModalProps {
  record: SalesRecord | null;
  isOpen: boolean;
  onClose: () => void;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({ record, isOpen, onClose }) => {
  const [dualData, setDualData] = useState<{
    transactionId: string;
    storage_location: StorageLocation;
    sqlRecord: SalesRecord | null;
    nosqlRecord: SalesRecord | null;
    isSynchronized: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !record) return;
    let isMounted = true;

    fetch(`/api/records/${record.Transaction_ID}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          setDualData(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load dual snapshot:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, record?.Transaction_ID]);

  if (!isOpen || !record) return null;

  const activeRecord = dualData?.sqlRecord || dualData?.nosqlRecord || record;

  const fields = [
    { label: 'Transaction ID', val: activeRecord.Transaction_ID, mono: true },
    { label: 'Order ID', val: activeRecord.Order_ID, mono: true },
    { label: 'Customer ID', val: activeRecord.Customer_ID, mono: true },
    { label: 'Customer Name', val: activeRecord.Customer_Name },
    { label: 'Customer Age', val: activeRecord.Customer_Age },
    { label: 'Customer Gender', val: activeRecord.Customer_Gender },
    { label: 'Customer Segment', val: activeRecord.Customer_Segment },
    { label: 'Order Date', val: activeRecord.Order_Date },
    { label: 'Order Time', val: activeRecord.Order_Time },
    { label: 'Sales Channel', val: activeRecord.Sales_Channel },
    { label: 'Store ID', val: activeRecord.Store_ID, mono: true },
    { label: 'Store Name', val: activeRecord.Store_Name },
    { label: 'Country', val: activeRecord.Country },
    { label: 'Region', val: activeRecord.Region },
    { label: 'City', val: activeRecord.City },
    { label: 'Product ID', val: activeRecord.Product_ID, mono: true },
    { label: 'Product Name', val: activeRecord.Product_Name },
    { label: 'Product Category', val: activeRecord.Product_Category },
    { label: 'Product Subcategory', val: activeRecord.Product_Subcategory },
    { label: 'Quantity', val: activeRecord.Quantity, mono: true },
    { label: 'Unit Price', val: `$${activeRecord.Unit_Price}`, mono: true },
    { label: 'Discount %', val: `${(activeRecord.Discount_Percentage * 100).toFixed(0)}%`, mono: true },
    { label: 'Sales Amount', val: `$${activeRecord.Sales_Amount.toFixed(2)}`, mono: true },
    { label: 'Cost Amount', val: `$${activeRecord.Cost_Amount.toFixed(2)}`, mono: true },
    { label: 'Profit', val: `$${activeRecord.Profit.toFixed(2)}`, mono: true },
    { label: 'Payment Method', val: activeRecord.Payment_Method },
    { label: 'Order Status', val: activeRecord.Order_Status },
    { label: 'Shipping Method', val: activeRecord.Shipping_Method },
    { label: 'Delivery Days', val: `${activeRecord.Delivery_Days} days` },
    { label: 'Return Flag', val: activeRecord.Return_Flag },
    { label: 'Return Reason', val: activeRecord.Return_Reason },
    { label: 'Sales Representative', val: activeRecord.Sales_Representative },
    { label: 'Promotion Code', val: activeRecord.Promotion_Code, mono: true },
    { label: 'Customer Rating', val: `${activeRecord.Customer_Rating} ★`, mono: true },
    { label: 'Inventory Level', val: `${activeRecord.Inventory_Level} units`, mono: true },
    { label: 'Order Year', val: activeRecord.Order_Year, mono: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-[2px] overflow-y-auto">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-3xl shadow-xl overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <span>Data Dictionary Inspector</span>
              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                {record.Transaction_ID}
              </span>
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-[#0F172A] hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dual Presence Status Banner */}
        <div className="p-4 bg-slate-50/70 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-50 border border-sky-200 text-sky-800 font-medium">
              <Database className="w-3.5 h-3.5 text-sky-600" />
              <span>SQLite: {dualData?.sqlRecord ? `Present (v${dualData.sqlRecord.version || 1})` : 'Not in SQL'}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-800 font-medium">
              <FileText className="w-3.5 h-3.5 text-violet-600" />
              <span>NeDB: {dualData?.nosqlRecord ? `Present (v${dualData.nosqlRecord.version || 1})` : 'Not in NoSQL'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono">
            {dualData?.isSynchronized ? (
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Stores in Parity</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-700 font-medium">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Replication Divergence</span>
              </span>
            )}
          </div>
        </div>

        {/* 36 Schema Fields Grid */}
        <div className="p-6 max-h-[60vh] overflow-y-auto bg-white">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Full 36 Data Dictionary Attributes
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            {fields.map((f, idx) => (
              <div key={idx} className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="text-[10px] text-slate-500 font-medium">{f.label}</div>
                <div className={`mt-0.5 text-[#0F172A] font-medium truncate ${f.mono ? 'font-mono tabular-nums' : ''}`}>
                  {f.val !== undefined && f.val !== null ? String(f.val) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E2E8F0] flex justify-end bg-[#F8FAFC]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] hover:bg-slate-100 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
