import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Database,
  FileText,
  SkipForward,
  Clock,
  XCircle,
} from 'lucide-react';
import type {
  SalesRecord,
  SyncStatus,
  StorageLocation,
  ProtocolStep,
  ChangedFieldDiff,
  ReplicationEvent,
  ReplicationResponse,
} from '../types/sales.ts';

interface EditReplicateModalProps {
  record: SalesRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedRecord?: SalesRecord, event?: ReplicationEvent) => void | Promise<void>;
}

type EditorTab = 'order' | 'product' | 'customer' | 'logistics';

export const EditReplicateModal: React.FC<EditReplicateModalProps> = ({
  record,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('order');
  const [formState, setFormState] = useState<Partial<SalesRecord>>({});
  const hasEditedRef = useRef(false);
  const [promoteToBoth, setPromoteToBoth] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [protocolResult, setProtocolResult] = useState<{
    success: boolean;
    status: SyncStatus;
    fromVersion: number;
    version: number;
    storageLocation: StorageLocation;
    message: string;
    steps: ProtocolStep[];
    changedFields?: ChangedFieldDiff[];
    syncSummary?: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !record) return;

    setFormState({ ...record });
    hasEditedRef.current = false;
    setPromoteToBoth(false);
    setSimulateFailure(false);
    setProtocolResult(null);
    setConflictError(null);
    setActiveTab('order');

    let cancelled = false;
    fetch(`/api/records/${record.Transaction_ID}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const latest = data.sqlRecord || data.nosqlRecord;
        if (latest) {
          setFormState((prev) => {
            if (hasEditedRef.current) {
              return {
                ...prev,
                storage_location: data.storage_location || prev.storage_location,
                version: latest.version ?? prev.version ?? 1,
              };
            }
            return {
              ...latest,
              storage_location: data.storage_location || record.storage_location,
              version: latest.version ?? record.version ?? 1,
            };
          });
        }
      })
      .catch(() => {
        // Fallback silently to row snapshot
      });

    return () => {
      cancelled = true;
    };
  }, [record?.Transaction_ID, isOpen]);

  if (!isOpen || !record) return null;

  const updateField = <K extends keyof SalesRecord>(key: K, value: SalesRecord[K]) => {
    hasEditedRef.current = true;
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const qty = Number(formState.Quantity) || 1;
  const unitPrice = Number(formState.Unit_Price) || 0;
  const discount = Number(formState.Discount_Percentage) || 0;
  const gross = qty * unitPrice;
  const salesAmount = Number((gross * (1 - discount)).toFixed(2));
  const costAmount = Number((salesAmount * 0.65).toFixed(2));
  const profit = Number((salesAmount - costAmount).toFixed(2));

  const currentPartition: StorageLocation =
    protocolResult?.storageLocation ||
    (formState.storage_location as StorageLocation | undefined) ||
    record.storage_location ||
    'BOTH';
  const currentVersion = protocolResult?.version ?? formState.version ?? record.version ?? 1;
  const willReplicateBoth = currentPartition === 'BOTH' || promoteToBoth;

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setConflictError(null);

    try {
      const payload = {
        ...formState,
        Quantity: qty,
        Unit_Price: unitPrice,
        Discount_Percentage: discount,
        Sales_Amount: salesAmount,
        Cost_Amount: costAmount,
        Profit: profit,
        expectedVersion: currentVersion,
        promoteToBoth,
        simulateFailure: willReplicateBoth ? simulateFailure : false,
      };

      const res = await fetch(`/api/records/${record.Transaction_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.status === 409) {
        setConflictError(data.error || 'Version conflict detected.');
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Modification failed');
      }

      const typed: ReplicationResponse = data;
      setProtocolResult({
        success: typed.success,
        status: typed.status,
        fromVersion: currentVersion,
        version: typed.version,
        storageLocation: typed.storageLocation,
        message: typed.message,
        steps: typed.steps || [],
        changedFields: typed.event?.changedFields,
        syncSummary: typed.event?.syncSummary,
      });

      // Sync local state to latest saved record and version
      setFormState({ ...typed.record });
      hasEditedRef.current = false;
      if (typed.storageLocation === 'BOTH') {
        setPromoteToBoth(false);
      }

      await onSuccess(typed.record, typed.event);
    } catch (err: any) {
      setConflictError(err.message || 'Failed to modify record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepIcon = (status: ProtocolStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
      case 'failed':
        return <XCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      case 'pending':
        return <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      case 'skipped':
      default:
        return <SkipForward className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  const renderPartitionIcon = () => {
    if (currentPartition === 'SQL_ONLY') return <Database className="w-4 h-4 text-sky-600" />;
    if (currentPartition === 'NOSQL_ONLY') return <FileText className="w-4 h-4 text-violet-600" />;
    return <Layers className="w-4 h-4 text-indigo-600" />;
  };

  const partitionIconContainer =
    currentPartition === 'SQL_ONLY'
      ? 'bg-sky-50 border-sky-200'
      : currentPartition === 'NOSQL_ONLY'
      ? 'bg-violet-50 border-violet-200'
      : 'bg-indigo-50 border-indigo-200';

  const inputClass =
    'w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';
  const monoInputClass = `${inputClass} font-mono tabular-nums`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-[2px] overflow-y-auto">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-3xl shadow-xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC] shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${partitionIconContainer}`}>
              {renderPartitionIcon()}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
                <span>Modify Record & Replication Protocol</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-white text-[#0F172A] border border-[#E2E8F0]">
                  {record.Transaction_ID}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Partition: <span className="font-mono font-semibold text-[#0F172A]">{currentPartition}</span>
                {' · '}
                Version: <span className="font-mono font-semibold text-indigo-600">v{currentVersion}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F172A] hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Grouped Schema Tabs */}
        <div className="px-6 pt-2 border-b border-[#E2E8F0] bg-[#F8FAFC]/60 flex items-center gap-1 overflow-x-auto shrink-0">
          {(
            [
              { id: 'order', label: 'Order & Financials' },
              { id: 'product', label: 'Product & Inventory' },
              { id: 'customer', label: 'Customer' },
              { id: 'logistics', label: 'Store & Logistics' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'border-indigo-600 text-[#0F172A] font-semibold'
                  : 'border-transparent text-slate-500 hover:text-[#0F172A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleExecute} className="flex-1 overflow-y-auto p-6 space-y-5 bg-white">
          {activeTab === 'order' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Order ID</label>
                  <input
                    type="text"
                    value={formState.Order_ID || ''}
                    onChange={(e) => updateField('Order_ID', e.target.value)}
                    className={monoInputClass}
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Order Date</label>
                  <input
                    type="date"
                    value={formState.Order_Date || ''}
                    onChange={(e) => updateField('Order_Date', e.target.value)}
                    className={monoInputClass}
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Order Time</label>
                  <input
                    type="text"
                    value={formState.Order_Time || ''}
                    onChange={(e) => updateField('Order_Time', e.target.value)}
                    className={monoInputClass}
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Quantity (Units)</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={formState.Quantity ?? 1}
                    onChange={(e) => updateField('Quantity', Number(e.target.value))}
                    className={monoInputClass}
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Unit Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formState.Unit_Price ?? 0}
                    onChange={(e) => updateField('Unit_Price', Number(e.target.value))}
                    className={monoInputClass}
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Discount (0.0 - 0.8)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="0.8"
                    value={formState.Discount_Percentage ?? 0}
                    onChange={(e) => updateField('Discount_Percentage', Number(e.target.value))}
                    className={monoInputClass}
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Order Status</label>
                  <select
                    value={formState.Order_Status || 'Processing'}
                    onChange={(e) => updateField('Order_Status', e.target.value)}
                    className={inputClass}
                  >
                    <option value="Completed">Completed</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Shipped">Shipped</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Processing">Processing</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Payment Method</label>
                  <select
                    value={formState.Payment_Method || 'Corporate Card'}
                    onChange={(e) => updateField('Payment_Method', e.target.value)}
                    className={inputClass}
                  >
                    <option value="Corporate Card">Corporate Card</option>
                    <option value="ACH Wire Transfer">ACH Wire Transfer</option>
                    <option value="Purchase Order">Purchase Order</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Apple Pay">Apple Pay</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1">Promotion Code</label>
                  <input
                    type="text"
                    value={formState.Promotion_Code || ''}
                    onChange={(e) => updateField('Promotion_Code', e.target.value)}
                    className={monoInputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-mono tabular-nums">
                <div>
                  <div className="text-slate-500 text-[10px] font-sans font-medium uppercase tracking-wider">Order Year</div>
                  <input
                    type="number"
                    value={formState.Order_Year ?? 2024}
                    onChange={(e) => updateField('Order_Year', Number(e.target.value))}
                    className="w-full bg-transparent text-[#0F172A] font-semibold mt-0.5 focus:outline-none"
                  />
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] font-sans font-medium uppercase tracking-wider">Sales Amount</div>
                  <div className="font-semibold text-[#0F172A] mt-0.5">${salesAmount.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] font-sans font-medium uppercase tracking-wider">Cost Amount</div>
                  <div className="font-semibold text-slate-700 mt-0.5">${costAmount.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] font-sans font-medium uppercase tracking-wider">Profit</div>
                  <div className="font-semibold text-emerald-700 mt-0.5">${profit.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'product' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Product ID</label>
                <input
                  type="text"
                  value={formState.Product_ID || ''}
                  onChange={(e) => updateField('Product_ID', e.target.value)}
                  className={monoInputClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-600 font-medium mb-1">Product Name</label>
                <input
                  type="text"
                  value={formState.Product_Name || ''}
                  onChange={(e) => updateField('Product_Name', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Category</label>
                <select
                  value={formState.Product_Category || 'Electronics'}
                  onChange={(e) => updateField('Product_Category', e.target.value)}
                  className={inputClass}
                >
                  <option value="Electronics">Electronics</option>
                  <option value="Office Supplies">Office Supplies</option>
                  <option value="Furniture">Furniture</option>
                  <option value="Accessories">Accessories</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Subcategory</label>
                <input
                  type="text"
                  value={formState.Product_Subcategory || ''}
                  onChange={(e) => updateField('Product_Subcategory', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Inventory Level</label>
                <input
                  type="number"
                  min="0"
                  value={formState.Inventory_Level ?? 0}
                  onChange={(e) => updateField('Inventory_Level', Number(e.target.value))}
                  className={monoInputClass}
                />
              </div>
            </div>
          )}

          {activeTab === 'customer' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Customer ID</label>
                <input
                  type="text"
                  value={formState.Customer_ID || ''}
                  onChange={(e) => updateField('Customer_ID', e.target.value)}
                  className={monoInputClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-600 font-medium mb-1">Customer Name</label>
                <input
                  type="text"
                  value={formState.Customer_Name || ''}
                  onChange={(e) => updateField('Customer_Name', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Customer Age</label>
                <input
                  type="number"
                  min="18"
                  max="120"
                  value={formState.Customer_Age ?? 30}
                  onChange={(e) => updateField('Customer_Age', Number(e.target.value))}
                  className={monoInputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Gender</label>
                <select
                  value={formState.Customer_Gender || 'Female'}
                  onChange={(e) => updateField('Customer_Gender', e.target.value)}
                  className={inputClass}
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-Binary">Non-Binary</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Segment</label>
                <select
                  value={formState.Customer_Segment || 'Corporate'}
                  onChange={(e) => updateField('Customer_Segment', e.target.value)}
                  className={inputClass}
                >
                  <option value="Corporate">Corporate</option>
                  <option value="Enterprise">Enterprise</option>
                  <option value="Small Business">Small Business</option>
                  <option value="Consumer">Consumer</option>
                  <option value="Government">Government</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Customer Rating (1 - 5)</label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  value={formState.Customer_Rating ?? 5}
                  onChange={(e) => updateField('Customer_Rating', Number(e.target.value))}
                  className={monoInputClass}
                />
              </div>
            </div>
          )}

          {activeTab === 'logistics' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Store ID</label>
                <input
                  type="text"
                  value={formState.Store_ID || ''}
                  onChange={(e) => updateField('Store_ID', e.target.value)}
                  className={monoInputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Store Name</label>
                <input
                  type="text"
                  value={formState.Store_Name || ''}
                  onChange={(e) => updateField('Store_Name', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Sales Channel</label>
                <select
                  value={formState.Sales_Channel || 'Online Store'}
                  onChange={(e) => updateField('Sales_Channel', e.target.value)}
                  className={inputClass}
                >
                  <option value="Online Store">Online Store</option>
                  <option value="Retail Store">Retail Store</option>
                  <option value="Distributor Portal">Distributor Portal</option>
                  <option value="Enterprise Sales">Enterprise Sales</option>
                  <option value="Mobile App">Mobile App</option>
                  <option value="Direct Sales">Direct Sales</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Sales Representative</label>
                <input
                  type="text"
                  value={formState.Sales_Representative || ''}
                  onChange={(e) => updateField('Sales_Representative', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">City</label>
                <input
                  type="text"
                  value={formState.City || ''}
                  onChange={(e) => updateField('City', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Region</label>
                <input
                  type="text"
                  value={formState.Region || ''}
                  onChange={(e) => updateField('Region', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Country</label>
                <input
                  type="text"
                  value={formState.Country || ''}
                  onChange={(e) => updateField('Country', e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Shipping Method</label>
                <select
                  value={formState.Shipping_Method || 'Standard Ground'}
                  onChange={(e) => updateField('Shipping_Method', e.target.value)}
                  className={inputClass}
                >
                  <option value="Standard Ground">Standard Ground</option>
                  <option value="Overnight Air">Overnight Air</option>
                  <option value="Express Freight">Express Freight</option>
                  <option value="Same-Day Courier">Same-Day Courier</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Delivery Days</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={formState.Delivery_Days ?? 3}
                  onChange={(e) => updateField('Delivery_Days', Number(e.target.value))}
                  className={monoInputClass}
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Return Flag</label>
                <select
                  value={formState.Return_Flag || 'No'}
                  onChange={(e) => {
                    updateField('Return_Flag', e.target.value);
                    if (e.target.value === 'No') updateField('Return_Reason', 'None');
                  }}
                  className={inputClass}
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-600 font-medium mb-1">Return Reason</label>
                <input
                  type="text"
                  disabled={(formState.Return_Flag || 'No') === 'No'}
                  value={formState.Return_Reason || 'None'}
                  onChange={(e) => updateField('Return_Reason', e.target.value)}
                  className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
                />
              </div>
            </div>
          )}

          {/* Protocol Options */}
          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              {currentPartition !== 'BOTH' && (
                <label className="flex items-center gap-2 text-slate-700 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={promoteToBoth}
                    onChange={(e) => setPromoteToBoth(e.target.checked)}
                    className="rounded border-slate-300 bg-white text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Promote to BOTH (replicate across SQLite & NeDB)</span>
                </label>
              )}

              {willReplicateBoth && (
                <label className="flex items-center gap-2 text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={simulateFailure}
                    onChange={(e) => setSimulateFailure(e.target.checked)}
                    className="rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-500"
                  />
                  <span>Simulate replica offline for this save</span>
                </label>
              )}

              {!willReplicateBoth && (
                <span className="text-slate-500">
                  Direct commit to{' '}
                  <span className="font-mono font-semibold text-[#0F172A]">
                    {currentPartition === 'SQL_ONLY' ? 'SQLite' : 'NeDB'}
                  </span>
                </span>
              )}
            </div>

            <span className="font-mono tabular-nums text-[11px] font-medium text-slate-600 px-2 py-0.5 rounded bg-white border border-[#E2E8F0]">
              Lock: v{currentVersion} → v{currentVersion + 1}
            </span>
          </div>

          {/* Conflict or Error Banner */}
          {conflictError && (
            <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Update Blocked</div>
                <div className="mt-0.5 text-rose-700">{conflictError}</div>
              </div>
            </div>
          )}

          {/* Step-by-Step Protocol Execution Tracker */}
          {protocolResult && (
            <div
              className={`p-4 rounded-xl border text-xs space-y-3 ${
                protocolResult.status === 'PENDING_RETRY'
                  ? 'bg-amber-50/70 border-amber-200'
                  : 'bg-emerald-50/70 border-emerald-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-[#0F172A] flex items-center gap-2">
                  {protocolResult.status === 'PENDING_RETRY' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  )}
                  <span>{protocolResult.message}</span>
                </div>
                <span className="font-mono tabular-nums text-[11px] font-medium px-2 py-0.5 rounded-md bg-white text-[#0F172A] border border-[#E2E8F0] whitespace-nowrap">
                  {protocolResult.status} · v{protocolResult.fromVersion} → v{protocolResult.version}
                </span>
              </div>

              {protocolResult.changedFields && protocolResult.changedFields.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-medium text-slate-600 mr-1">Changed fields:</span>
                  {protocolResult.changedFields.map((diff) => (
                    <span
                      key={diff.field}
                      className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-slate-700"
                    >
                      <span className="font-semibold text-indigo-700">{diff.field}</span>:{' '}
                      <span className="text-slate-500">{String(diff.from)}</span> →{' '}
                      <span className="font-semibold text-emerald-700">{String(diff.to)}</span>
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                {protocolResult.steps.map((s) => (
                  <div
                    key={s.step}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-[#E2E8F0]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {renderStepIcon(s.status)}
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        0{s.step}
                      </span>
                      <span className="font-semibold text-[#0F172A] whitespace-nowrap">
                        {s.name}
                      </span>
                      <span className="text-slate-500 truncate">{s.detail}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                      <span>{s.store}</span>
                      <span>·</span>
                      <span>{s.durationMs}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 hover:text-[#0F172A] transition-colors"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>
                {isSubmitting
                  ? 'Executing Protocol...'
                  : willReplicateBoth
                  ? 'Save & Replicate'
                  : 'Save Changes'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
