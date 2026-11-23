import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Database, FileText, Layers, CheckCircle, AlertCircle } from 'lucide-react';
import {
  StorageLocation,
  SalesRecord,
  ReplicationEvent,
  ProductCatalogItem,
  StoreCityOption,
} from '../types/sales.ts';

interface FulfillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (
    createdRecord?: SalesRecord,
    targetStore?: StorageLocation,
    event?: ReplicationEvent
  ) => void | Promise<void>;
}

const FALLBACK_PRODUCTS: ProductCatalogItem[] = [
  {
    Product_ID: 'PRD-ELEC-01',
    Product_Name: 'Quantum UltraBook X15',
    Product_Category: 'Electronics',
    Product_Subcategory: 'Laptops',
    Unit_Price: 1299.99,
  },
];

const FALLBACK_STORES: StoreCityOption[] = [
  {
    Store_ID: 'STR-NY-01',
    Store_Name: 'Manhattan Tech Hub',
    City: 'New York',
    Region: 'North America',
    Country: 'United States',
  },
];

const ALL_CITIES_VALUE = '__ALL__';

export const FulfillModal: React.FC<FulfillModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [targetStore, setTargetStore] = useState<StorageLocation>('BOTH');
  const [customerName, setCustomerName] = useState('Elena Rostova');
  const [customerAge] = useState(34);
  const [customerGender] = useState('Female');
  const [customerSegment, setCustomerSegment] = useState('Corporate');

  const [catalogProducts, setCatalogProducts] = useState<ProductCatalogItem[]>(FALLBACK_PRODUCTS);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  const [storeOptions, setStoreOptions] = useState<StoreCityOption[]>(FALLBACK_STORES);
  const [cityOptions, setCityOptions] = useState<string[]>(['New York']);
  const [cityFilter, setCityFilter] = useState<string>('New York');
  const [isLoadingStores, setIsLoadingStores] = useState(false);

  const [productId, setProductId] = useState('PRD-ELEC-01');
  const [productName, setProductName] = useState('Quantum UltraBook X15');
  const [productCategory, setProductCategory] = useState('Electronics');
  const [productSubcategory, setProductSubcategory] = useState('Laptops');
  const [storeId, setStoreId] = useState('STR-NY-01');
  const [storeName, setStoreName] = useState('Manhattan Tech Hub');
  const [city, setCity] = useState('New York');
  const [region, setRegion] = useState('North America');
  const [country, setCountry] = useState('United States');
  const [salesChannel, setSalesChannel] = useState('Direct Sales');
  const [quantity, setQuantity] = useState(2);
  const [unitPrice, setUnitPrice] = useState(1299.99);
  const [discount, setDiscount] = useState(0);
  const [orderStatus, setOrderStatus] = useState('Processing');
  const [paymentMethod] = useState('Corporate Card');
  const [shippingMethod] = useState('Express Freight');
  const [salesRep] = useState('Marcus Vance');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const applyProductSelection = (item: ProductCatalogItem) => {
    setProductId(item.Product_ID);
    setProductName(item.Product_Name);
    setProductCategory(item.Product_Category);
    setProductSubcategory(item.Product_Subcategory);
    setUnitPrice(item.Unit_Price);
  };

  const applyStoreSelection = (option: StoreCityOption, syncCityFilter = true) => {
    setStoreId(option.Store_ID);
    setStoreName(option.Store_Name);
    setCity(option.City);
    setRegion(option.Region);
    setCountry(option.Country);
    if (syncCityFilter) {
      setCityFilter(option.City);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return () => {
        if (closeTimerRef.current) {
          window.clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      };
    }

    setResultMessage(null);
    setErrorMessage(null);

    let cancelled = false;
    setIsLoadingProducts(true);
    setIsLoadingStores(true);

    fetch('/api/products', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.products) || data.products.length === 0) {
          return;
        }
        const items: ProductCatalogItem[] = data.products;
        setCatalogProducts(items);
        setProductName((currentName) => {
          const match = items.find((p) => p.Product_Name === currentName) || items[0];
          if (match) {
            setProductId(match.Product_ID);
            setProductCategory(match.Product_Category);
            setProductSubcategory(match.Product_Subcategory);
            setUnitPrice(match.Unit_Price);
            return match.Product_Name;
          }
          return currentName;
        });
      })
      .catch(() => {
        // Keep fallback catalog silently
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProducts(false);
      });

    fetch('/api/stores', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.stores) || data.stores.length === 0) {
          return;
        }
        const pairs: StoreCityOption[] = data.stores;
        const cities: string[] = Array.isArray(data.cities)
          ? data.cities
          : Array.from(new Set(pairs.map((s) => s.City))).sort();

        setStoreOptions(pairs);
        setCityOptions(cities);

        const match =
          pairs.find((s) => s.Store_Name === storeName && s.City === city) ||
          pairs.find((s) => s.Store_Name === storeName) ||
          pairs[0];

        if (match) {
          setStoreId(match.Store_ID);
          setStoreName(match.Store_Name);
          setCity(match.City);
          setRegion(match.Region);
          setCountry(match.Country);
          setCityFilter((prev) => (prev === ALL_CITIES_VALUE ? ALL_CITIES_VALUE : match.City));
        }
      })
      .catch(() => {
        // Keep fallback store silently
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStores(false);
      });

    return () => {
      cancelled = true;
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const getPairKey = (opt: Pick<StoreCityOption, 'Store_Name' | 'City'>) =>
    `${opt.Store_Name}::${opt.City}`;

  const filteredStores =
    cityFilter === ALL_CITIES_VALUE
      ? storeOptions
      : storeOptions.filter(
          (s) => s.City.trim().toLowerCase() === cityFilter.trim().toLowerCase()
        );

  const selectedStorePairKey = getPairKey({ Store_Name: storeName, City: city });
  const effectiveSelectedPairKey = filteredStores.some(
    (s) => getPairKey(s) === selectedStorePairKey
  )
    ? selectedStorePairKey
    : filteredStores[0]
    ? getPairKey(filteredStores[0])
    : selectedStorePairKey;

  const handleCityFilterChange = (nextCity: string) => {
    setCityFilter(nextCity);
    if (nextCity === ALL_CITIES_VALUE) {
      return;
    }
    const matchingStores = storeOptions.filter(
      (s) => s.City.trim().toLowerCase() === nextCity.trim().toLowerCase()
    );
    if (matchingStores.length > 0) {
      applyStoreSelection(matchingStores[0], false);
    }
  };

  const handleStoreSelect = (pairKey: string) => {
    const selected = storeOptions.find((s) => getPairKey(s) === pairKey);
    if (selected) {
      applyStoreSelection(selected, true);
    }
  };

  const handleProductSelect = (selectedName: string) => {
    const selected = catalogProducts.find((p) => p.Product_Name === selectedName);
    if (selected) {
      applyProductSelection(selected);
    } else {
      setProductName(selectedName);
    }
  };

  // Live financials
  const gross = quantity * unitPrice;
  const salesAmount = Number((gross * (1 - discount)).toFixed(2));
  const costAmount = Number((salesAmount * 0.65).toFixed(2));
  const profit = Number((salesAmount - costAmount).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResultMessage(null);
    setErrorMessage(null);

    try {
      const payload: Partial<SalesRecord> & { targetStore: StorageLocation } = {
        targetStore,
        Customer_Name: customerName,
        Customer_Age: Number(customerAge),
        Customer_Gender: customerGender,
        Customer_Segment: customerSegment,
        Product_ID: productId,
        Product_Name: productName,
        Product_Category: productCategory,
        Product_Subcategory: productSubcategory,
        Store_ID: storeId,
        Store_Name: storeName,
        City: city,
        Region: region,
        Country: country,
        Sales_Channel: salesChannel,
        Quantity: Number(quantity),
        Unit_Price: Number(unitPrice),
        Discount_Percentage: Number(discount),
        Sales_Amount: salesAmount,
        Cost_Amount: costAmount,
        Profit: profit,
        Order_Status: orderStatus,
        Payment_Method: paymentMethod,
        Shipping_Method: shippingMethod,
        Sales_Representative: salesRep,
      };

      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fulfill record');

      setResultMessage(`Record ${data.record.Transaction_ID} successfully fulfilled to ${targetStore}!`);
      await onSuccess(data.record, targetStore, data.event);
      closeTimerRef.current = window.setTimeout(() => {
        onClose();
      }, 650);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fulfill record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';
  const readonlyInputClass =
    'w-full px-3 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-slate-700 font-medium focus:outline-none cursor-default';
  const monoInputClass = `${inputClass} font-mono tabular-nums`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-[2px] overflow-y-auto">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A]">Fulfill New Sales Record</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Route transaction directly into SQLite, NeDB, or synchronized across BOTH.
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
          {/* Target Store Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Destination Database Storage
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setTargetStore('SQL_ONLY')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  targetStore === 'SQL_ONLY'
                    ? 'bg-sky-50/90 border-sky-400 text-[#0F172A] ring-1 ring-sky-400'
                    : 'bg-white border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC] hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-sky-700 mb-1">
                  <Database className="w-3.5 h-3.5" />
                  <span>SQL ONLY</span>
                </div>
                <div className="text-[11px] text-slate-500">Writes directly to SQLite</div>
              </button>

              <button
                type="button"
                onClick={() => setTargetStore('NOSQL_ONLY')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  targetStore === 'NOSQL_ONLY'
                    ? 'bg-violet-50/90 border-violet-400 text-[#0F172A] ring-1 ring-violet-400'
                    : 'bg-white border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC] hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  <span>NoSQL ONLY</span>
                </div>
                <div className="text-[11px] text-slate-500">Writes directly to NeDB</div>
              </button>

              <button
                type="button"
                onClick={() => setTargetStore('BOTH')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  targetStore === 'BOTH'
                    ? 'bg-indigo-50/90 border-indigo-400 text-[#0F172A] ring-1 ring-indigo-400'
                    : 'bg-white border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC] hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 mb-1">
                  <Layers className="w-3.5 h-3.5" />
                  <span>BOTH (Shared)</span>
                </div>
                <div className="text-[11px] text-slate-500">Writes to SQLite & NeDB</div>
              </button>
            </div>
          </div>

          {/* Form Fields Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
            {/* Customer Name */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            {/* Customer Segment */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Customer Segment</label>
              <select
                value={customerSegment}
                onChange={(e) => setCustomerSegment(e.target.value)}
                className={inputClass}
              >
                <option value="Corporate">Corporate</option>
                <option value="Enterprise">Enterprise</option>
                <option value="Small Business">Small Business</option>
                <option value="Consumer">Consumer</option>
                <option value="Government">Government</option>
              </select>
            </div>

            {/* Order Status */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Order Status</label>
              <select
                value={orderStatus}
                onChange={(e) => setOrderStatus(e.target.value)}
                className={inputClass}
              >
                <option value="Processing">Processing</option>
                <option value="Shipped">Shipped</option>
                <option value="Completed">Completed</option>
                <option value="In Transit">In Transit</option>
              </select>
            </div>

            {/* Product Name (Dynamic Catalog Select) */}
            <div>
              <label className="flex items-center justify-between text-slate-600 font-medium mb-1">
                <span>Product Name</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {isLoadingProducts ? 'Loading...' : `${catalogProducts.length}`}
                </span>
              </label>
              <select
                value={productName}
                onChange={(e) => handleProductSelect(e.target.value)}
                className={inputClass}
                required
              >
                {catalogProducts.map((p) => (
                  <option key={p.Product_Name} value={p.Product_Name}>
                    {p.Product_Name}
                  </option>
                ))}
              </select>
            </div>

            {/* Product Category (Auto-synced) */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Category</label>
              <input
                type="text"
                value={productCategory}
                readOnly
                className={readonlyInputClass}
                title="Automatically populated from selected product"
              />
            </div>

            {/* Product Subcategory (Auto-synced) */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Subcategory</label>
              <input
                type="text"
                value={productSubcategory}
                readOnly
                className={readonlyInputClass}
                title="Automatically populated from selected product"
              />
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={monoInputClass}
                required
              />
            </div>

            {/* Unit Price (Auto-populated default, editable) */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Unit Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(Number(e.target.value))}
                className={monoInputClass}
                required
              />
            </div>

            {/* Discount Percentage */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Discount (%)</label>
              <select
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
                className={monoInputClass}
              >
                <option value={0}>0%</option>
                <option value={0.05}>5%</option>
                <option value={0.1}>10%</option>
                <option value={0.15}>15%</option>
                <option value={0.2}>20%</option>
              </select>
            </div>

            {/* City (Linked Filter Dropdown - Left) */}
            <div>
              <label className="flex items-center justify-between text-slate-600 font-medium mb-1">
                <span>City</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {isLoadingStores ? 'Loading...' : `${cityOptions.length} cities`}
                </span>
              </label>
              <select
                value={cityFilter}
                onChange={(e) => handleCityFilterChange(e.target.value)}
                className={inputClass}
              >
                <option value={ALL_CITIES_VALUE}>All Cities</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Store Name (Linked Dropdown - Middle) */}
            <div>
              <label className="flex items-center justify-between text-slate-600 font-medium mb-1">
                <span>Store Name</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {storeId}
                </span>
              </label>
              <select
                value={effectiveSelectedPairKey}
                onChange={(e) => handleStoreSelect(e.target.value)}
                className={inputClass}
                required
              >
                {filteredStores.map((s) => {
                  const key = getPairKey(s);
                  return (
                    <option key={key} value={key}>
                      {cityFilter === ALL_CITIES_VALUE ? `${s.Store_Name} (${s.City})` : s.Store_Name}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Sales Channel (Right) */}
            <div>
              <label className="block text-slate-600 font-medium mb-1">Sales Channel</label>
              <select
                value={salesChannel}
                onChange={(e) => setSalesChannel(e.target.value)}
                className={inputClass}
              >
                <option value="Direct Sales">Direct Sales</option>
                <option value="Online Store">Online Store</option>
                <option value="Retail Store">Retail Store</option>
                <option value="Distributor Portal">Distributor Portal</option>
                <option value="Enterprise Sales">Enterprise Sales</option>
                <option value="Mobile App">Mobile App</option>
              </select>
            </div>
          </div>

          {/* Linked Location Context */}
          <div className="px-3.5 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
            <div>
              <span className="text-slate-500">Fulfillment Store: </span>
              <span className="font-medium text-[#0F172A]">{storeName}</span>
              <span className="text-slate-400"> · </span>
              <span className="font-mono text-indigo-700">{storeId}</span>
            </div>
            <div>
              <span className="text-slate-500">Location: </span>
              <span className="font-medium text-[#0F172A]">
                {city}, {country}
              </span>
              <span className="text-slate-400"> ({region})</span>
            </div>
          </div>

          {/* Computed summary bar */}
          <div className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 font-sans font-medium">Net Sales:</span>
              <span className="font-semibold text-[#0F172A]">${salesAmount.toFixed(2)}</span>
              <span className="text-[11px] text-slate-500">
                ({quantity} × ${Number(unitPrice).toFixed(2)} × (1 − {Math.round(discount * 100)}%))
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-sans font-medium">Estimated Profit: </span>
              <span className="font-semibold text-emerald-700">${profit.toFixed(2)}</span>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {resultMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{resultMessage}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 hover:text-[#0F172A] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Fulfilling...' : 'Fulfill to Database'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
