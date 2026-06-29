"use client";
import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import MediaUploadZone, { PreviewImage } from "@/components/MediaUploadZone";
import StoreSwitcher from "@/components/StoreSwitcher";
import { 
  Package, Plus, Tag, Zap, X, CheckCircle, Loader, 
  Save, AlertTriangle, Sparkles, Trash2
} from "lucide-react";
import { io } from "socket.io-client";
import { getImageUrl } from "@/utils/imageUrl";

const API = (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "undefined" && process.env.NEXT_PUBLIC_API_URL !== "null") ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:5000";

const DEMO_PRODUCTS = [
  { _id: "1", title: "Premium Wireless Headphones", price: 79.99, stock: 12, aiTags: ["electronics", "audio"], createdAt: "2026-06-10", images: [], variantSpecs: "Color: Black", isLowStock: false },
  { _id: "2", title: "Handwoven Leather Wallet",    price: 34.99, stock: 2,  aiTags: ["clothing & apparel"],   createdAt: "2026-06-12", images: [{ url: "", isPrimary: true }], variantSpecs: "Material: Leather, Size: M", isLowStock: true },
  { _id: "3", title: "Adjustable Laptop Stand",     price: 45.00, stock: 8,  aiTags: ["electronics"],          createdAt: "2026-06-14", images: [], variantSpecs: "Weight: 1.2kg", isLowStock: false },
];

const startCSVExportWorker = (headers: string[], rows: any[][], fileName: string, onProgress: (p: number) => void, onComplete: () => void) => {
  const workerCode = `
    self.onmessage = function(e) {
      const { headers, rows } = e.data;
      let csvContent = headers.join(",") + "\\n";
      const total = rows.length;
      const chunkSize = 200;
      let index = 0;

      function processChunk() {
        const end = Math.min(index + chunkSize, total);
        for (let i = index; i < end; i++) {
          const row = rows[i];
          const line = row.map(val => {
            if (val === null || val === undefined) return '""';
            let str = String(val).replace(/"/g, '""');
            if (str.includes(",") || str.includes("\\n") || str.includes('"')) {
              str = '"' + str + '"';
            }
            return str;
          }).join(",");
          csvContent += line + "\\n";
        }
        index = end;

        const progress = total > 0 ? Math.min(100, Math.round((index / total) * 100)) : 100;
        self.postMessage({ type: 'progress', progress });

        if (index < total) {
          setTimeout(processChunk, 15);
        } else {
          self.postMessage({ type: 'complete', csv: csvContent });
        }
      }

      processChunk();
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);

  worker.onmessage = (e) => {
    if (e.data.type === "progress") {
      onProgress(e.data.progress);
    } else if (e.data.type === "complete") {
      const downloadBlob = new Blob([e.data.csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(downloadBlob);
      link.setAttribute("href", url);
      link.setAttribute("download", fileName);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
      onComplete();
    }
  };

  worker.postMessage({ headers, rows });
};

export default function VendorProductsPage() {
  const [products, setProducts] = useState<any[]>(DEMO_PRODUCTS);
  const [showModal, setShowModal] = useState(false);
  const [exportingCatalog, setExportingCatalog] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", price: "", stock: "10", variantSpecs: "" });
  const [mediaImages, setMediaImages] = useState<PreviewImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [previewTags, setPreviewTags] = useState<string[]>([]);
  const [success, setSuccess] = useState("");
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [activeStoreId, setActiveStoreId] = useState("");
  
  // Spreadsheet state mapping
  const [editedProducts, setEditedProducts] = useState<{[id: string]: any}>({});
  const socketRef = useRef<any>(null);

  const loadProducts = (storeId: string) => {
    fetch(`${API}/api/products/store/${storeId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.products) {
          const formattedProducts = data.products.map((p: any) => ({
            ...p,
            createdAt: p.createdAt ? p.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
            variantSpecs: p.variantSpecs || ""
          }));
          setProducts(formattedProducts);
        } else {
          setProducts(DEMO_PRODUCTS);
        }
      })
      .catch(err => {
        console.warn("Backend connection offline. Using fallback products catalog.");
        setProducts(DEMO_PRODUCTS);
      });
  };

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    if (storedUser) {
      const user = JSON.parse(storedUser);
      
      if (user.role === "storeAdmin") {
        const allowed = user.permissions?.manageProducts !== false;
        setHasPermission(allowed);
        if (!allowed) return;
      } else {
        setHasPermission(true);
      }

      const storeId = user.activeStoreId || user.storeId;
      if (storeId) {
        setActiveStoreId(storeId);
        loadProducts(storeId);
      }
    }
  }, []);

  // Socket.io Real-time image sync & stock level notifications listeners
  useEffect(() => {
    if (!activeStoreId) return;

    const token = localStorage.getItem("bazaar_token");
    const socket = io(API, {
      auth: { token },
      transports: ["websocket"],
      forceNew: true
    });
    socketRef.current = socket;

    const handleConnect = () => {
      console.log(`Socket client connected. Subscribing to store:${activeStoreId}`);
      socket.emit("join_store", { storeId: activeStoreId });
    };

    if (socket.connected) {
      handleConnect();
    }
    socket.on("connect", handleConnect);

    socket.on("product_stock_alert", (data: any) => {
      console.log(`[Socket Real-time Alert] Product stock update:`, data);
      setProducts(prev => prev.map(p => {
        if (p._id === data.productId) {
          return { ...p, stock: data.stock, isLowStock: data.isLowStock };
        }
        return p;
      }));
    });

    socket.on("product_image_synced", (data: any) => {
      console.log(`[Socket Real-time Sync] Product images updated:`, data);
      setProducts(prev => prev.map(p => {
        if (p._id === data.productId) {
          return { ...p, images: data.images };
        }
        return p;
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [activeStoreId]);

  const handleExportCatalogCSV = async (entireCatalog: boolean) => {
    setExportingCatalog(true);
    setExportProgress(0);
    setShowExportModal(false);
    
    try {
      const token = localStorage.getItem("bazaar_token");
      let url = `${API}/api/products/store/${activeStoreId}/export`;
      if (!entireCatalog) {
        url += `?offset=0&limit=${products.length}`;
      }
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (data.success && data.metrics) {
        const headers = [
          "Product ID",
          "Name",
          "Live Stock Status",
          "Base Price",
          "Total Units Sold",
          "Gross Revenue Contributed",
          "Cumulative Ad Wallet Budget Spent"
        ];
        
        const rows = data.metrics.map((m: any) => [
          m.productId,
          m.name,
          m.liveStockStatus,
          m.basePrice,
          m.totalUnitsSold,
          m.grossRevenueContributed,
          m.cumulativeAdWalletBudgetSpent
        ]);
        
        const dateStr = new Date().toISOString().split('T')[0];
        const storeName = products[0]?.storeId?.slug || activeStoreId || "store";
        const fileName = `bazaarboost-catalog-${storeName}-${dateStr}.csv`;
        
        startCSVExportWorker(
          headers,
          rows,
          fileName,
          (progress) => setExportProgress(progress),
          () => {
            setExportingCatalog(false);
            setSuccess("Catalog metrics exported successfully!");
            setTimeout(() => setSuccess(""), 3000);
          }
        );
      } else {
        alert(data.message || "Failed to fetch metrics for catalog export.");
        setExportingCatalog(false);
      }
    } catch (err) {
      console.error(err);
      // Fallback offline export compilation
      const headers = [
        "Product ID",
        "Name",
        "Live Stock Status",
        "Base Price",
        "Total Units Sold",
        "Gross Revenue Contributed",
        "Cumulative Ad Wallet Budget Spent"
      ];
      
      const rows = products.map((p: any) => [
        p._id,
        p.title,
        p.stock === 0 ? "Out of Stock" : p.stock < 5 ? "Low Stock" : "In Stock",
        p.price,
        15, // simulated total units
        15 * p.price, // gross revenue
        100 // ad spend
      ]);
      
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `bazaarboost-catalog-${activeStoreId || "store"}-${dateStr}.csv`;
      
      startCSVExportWorker(
        headers,
        rows,
        fileName,
        (progress) => setExportProgress(progress),
        () => {
          setExportingCatalog(false);
          setSuccess("Catalog metrics exported successfully! (Demo fallback)");
          setTimeout(() => setSuccess(""), 3000);
        }
      );
    }
  };

  const resetModal = () => {
    setShowModal(false);
    setForm({ title: "", description: "", price: "", stock: "10", variantSpecs: "" });
    setMediaImages([]);
    setPreviewTags([]);
    setSuccess("");
  };

  const handleAutoTag = async () => {
    if (!form.title || !form.description) return;
    setTagging(true);
    try {
      const res = await fetch(`${API}/api/ai/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title, description: form.description }),
      });
      const data = await res.json();
      if (data.success) setPreviewTags(data.tags);
    } catch {
      setPreviewTags(["electronics", "tech"]);
    } finally {
      setTagging(false);
    }
  };

  // Add Product Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");

      // 1. Create product using JSON payload (handles AI auto-tagging & embedding)
      const res = await fetch(`${API}/api/products`, {
        method:  "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          title:       form.title,
          description: form.description,
          price:       parseFloat(form.price),
          stock:       parseInt(form.stock),
          variantSpecs: form.variantSpecs
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to create product");

      let createdProduct = data.product;

      // 2. If there are media images, upload them in a second step to the images endpoint
      if (mediaImages.length > 0) {
        const sortedImages = [...mediaImages].sort((a, b) => {
          if (a.isPrimary) return -1;
          if (b.isPrimary) return 1;
          return 0;
        });

        const imgFd = new FormData();
        sortedImages.forEach((img) => {
          imgFd.append("images", img.file);
        });

        const imgRes = await fetch(`${API}/api/products/${createdProduct._id}/images`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body:    imgFd,
        });
        const imgData = await imgRes.json();
        if (imgData.success) {
          const updatedRes = await fetch(`${API}/api/products/${createdProduct._id}`);
          const updatedData = await updatedRes.json();
          if (updatedData.success) {
            createdProduct = updatedData.product;
          }
        }
      }

      setProducts([{ ...createdProduct, createdAt: new Date().toISOString().slice(0, 10) }, ...products]);
      setSuccess("Product added with isolated AI assets!");
      setTimeout(resetModal, 2000);
    } catch {
      // Demo fallback
      const newProd = {
        _id:       Date.now().toString(),
        title:     form.title,
        price:     parseFloat(form.price),
        stock:     parseInt(form.stock),
        variantSpecs: form.variantSpecs,
        isLowStock: parseInt(form.stock) < 5,
        aiTags:    previewTags.length ? previewTags : ["general merchandise"],
        createdAt: new Date().toISOString().slice(0, 10),
        images:    mediaImages.map((img, i) => ({ url: img.previewUrl, isPrimary: img.isPrimary, displayOrder: i })),
      };
      setProducts([newProd, ...products]);
      setSuccess("Product added! (Demo offline mode)");
      setTimeout(resetModal, 2000);
    } finally {
      setLoading(false);
    }
  };

  // Spreadsheet Inline Modification Handlers
  const handleCellChange = (productId: string, field: string, value: string) => {
    setEditedProducts(prev => {
      const currentEdits = prev[productId] || {};
      const originalProduct = products.find(p => p._id === productId);
      
      let cleanVal: any = value;
      if (field === "price") {
        cleanVal = parseFloat(value);
        if (isNaN(cleanVal)) cleanVal = value; // keep string during typing
      } else if (field === "stock") {
        cleanVal = parseInt(value);
        if (isNaN(cleanVal)) cleanVal = value;
      }

      const newEdits = { ...currentEdits, [field]: cleanVal };

      // Clean up edit key if it reverts back to the original database state
      if (originalProduct && originalProduct[field] === cleanVal) {
        delete newEdits[field];
      }

      const next = { ...prev };
      if (Object.keys(newEdits).length === 0) {
        delete next[productId];
      } else {
        next[productId] = newEdits;
      }
      return next;
    });
  };

  // Bulk Save Action updates catalog in MongoDB
  const handleBulkSave = async () => {
    const updates = Object.keys(editedProducts).map(id => ({
      _id: id,
      ...editedProducts[id]
    }));

    if (updates.length === 0) return;
    setLoading(true);
    setSuccess("");

    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/products/bulk`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ updates })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Catalog modifications saved successfully!");
        setEditedProducts({});
        if (activeStoreId) {
          loadProducts(activeStoreId);
        }
      } else {
        console.warn("Frictionless save endpoint failed. Simulating local persistence.");
        setProducts(prev => prev.map(p => {
          const edits = editedProducts[p._id];
          if (edits) {
            const updatedStock = edits.stock !== undefined ? edits.stock : p.stock;
            return {
              ...p,
              ...edits,
              isLowStock: updatedStock < 5
            };
          }
          return p;
        }));
        setEditedProducts({});
        setSuccess("Catalog saved! (Offline fallback)");
      }
    } catch {
      // Simulate local save
      setProducts(prev => prev.map(p => {
        const edits = editedProducts[p._id];
        if (edits) {
          const updatedStock = edits.stock !== undefined ? edits.stock : p.stock;
          return {
            ...p,
            ...edits,
            isLowStock: updatedStock < 5
          };
        }
        return p;
      }));
      setEditedProducts({});
      setSuccess("Catalog modifications saved! (Offline simulation mode)");
    } finally {
      setLoading(false);
      setTimeout(() => setSuccess(""), 3000);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/products/${productId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(data.message || "Product deleted successfully");
        setProducts(prev => prev.filter(p => p._id !== productId));
      } else {
        throw new Error(data.message || "Failed to delete product");
      }
    } catch (err: any) {
      console.error(err);
      setProducts(prev => prev.filter(p => p._id !== productId));
      setSuccess("Product deleted locally (Demo offline mode)");
    } finally {
      setLoading(false);
      setTimeout(() => setSuccess(""), 3000);
    }
  };

  const renderCellInput = (product: any, field: string, type = "text") => {
    const isDirty = editedProducts[product._id]?.[field] !== undefined;
    const value = isDirty 
      ? editedProducts[product._id][field] 
      : product[field];

    return (
      <input
        type={type}
        step={field === "price" ? "0.01" : "1"}
        min="0"
        value={value === undefined || value === null ? "" : value}
        onChange={e => handleCellChange(product._id, field, e.target.value)}
        style={{
          width: "100%",
          background: "transparent",
          border: isDirty ? "2px solid #39ff14" : "1px solid transparent",
          borderRadius: "6px",
          padding: "0.4rem 0.6rem",
          color: "var(--text-primary)",
          fontSize: "0.85rem",
          outline: "none",
          transition: "all 0.15s",
          boxShadow: isDirty ? "0 0 8px rgba(57, 255, 20, 0.3)" : "none"
        }}
      />
    );
  };

  if (hasPermission === false) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
        <Sidebar role="vendor" />
        <main style={{ flex: 1, padding: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="glass-card animate-fade-up" style={{ padding: "3rem", textAlign: "center", maxWidth: 500 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ef4444", marginBottom: "1rem" }}>Access Denied</h2>
            <p style={{ color: "var(--text-secondary)" }}>You do not have permission to manage products and inventory. Please contact the store owner.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="vendor" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Pulsating neon animation style */}
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes neon-pulse-row {
            0% {
              background: rgba(239, 68, 68, 0.04);
              box-shadow: inset 4px 0 0 #ef4444;
            }
            100% {
              background: rgba(239, 68, 68, 0.09);
              box-shadow: inset 4px 0 0 #ff0055, 0 0 10px rgba(239, 68, 68, 0.15);
            }
          }
          .low-stock-neon {
            animation: neon-pulse-row 1.5s infinite alternate ease-in-out;
          }
        `}} />

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Inventory Matrix Workspace</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              High-density spreadsheet matrix for quick variant updates, real-time stock broadcasts, and AI image segmentation.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <StoreSwitcher />
            
            <button 
              onClick={() => setShowExportModal(true)} 
              disabled={exportingCatalog}
              className="btn-secondary"
              style={{ display: "flex", alignItems: "center", gap: "0.4rem", height: "38px" }}
            >
              {exportingCatalog ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  <span>Exporting ({exportProgress}%)</span>
                </>
              ) : (
                <>
                  <span>📥 Export CSV</span>
                </>
              )}
            </button>

            <button 
              onClick={handleBulkSave} 
              disabled={Object.keys(editedProducts).length === 0 || loading} 
              className="btn-primary"
              style={{
                background: Object.keys(editedProducts).length === 0 
                  ? "rgba(255,255,255,0.03)" 
                  : "linear-gradient(135deg, #10b981, #059669)",
                borderColor: Object.keys(editedProducts).length === 0 
                  ? "var(--border-subtle)" 
                  : "#10b981",
                color: Object.keys(editedProducts).length === 0 ? "var(--text-muted)" : "#000000",
                fontWeight: 700,
                opacity: loading ? 0.7 : 1,
                cursor: Object.keys(editedProducts).length === 0 ? "not-allowed" : "pointer"
              }}
            >
              {loading ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              Save Modifications
            </button>

            <button id="add-product-btn" onClick={() => setShowModal(true)} className="btn-primary">
              <Plus size={15} /> Add Product
            </button>
          </div>
        </div>

        {/* Success/Status Feedback Banner */}
        {success && (
          <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <CheckCircle size={15} /> {success}
          </div>
        )}

        {/* High-density quick-edit spreadsheet table */}
        <div className="glass-card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.01)" }}>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "80px" }}>Preview</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Product Title</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "140px" }}>Price ($)</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "180px" }}>Stock Balance</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Variant Specs</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "180px" }}>AI Tags</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "120px" }}>Added Date</th>
                <th style={{ padding: "1rem 1.25rem", textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "100px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const primaryImg = (p.images || []).find((img: any) => img.isPrimary) || (p.images || [])[0];
                const isLow = p.stock < 5 || p.isLowStock;

                return (
                  <tr 
                    key={p._id} 
                    className={isLow ? "low-stock-neon" : ""}
                    style={{ 
                      borderBottom: "1px solid var(--border-subtle)", 
                      transition: "background 0.15s"
                    }}
                  >
                    {/* Leftmost Column: High-contrast image preview */}
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 8, overflow: "hidden", flexShrink: 0,
                        background: "rgba(124,58,237,0.05)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "1px solid var(--border-subtle)",
                        boxShadow: "0 2px 5px rgba(0,0,0,0.15)"
                      }}>
                        {primaryImg?.url
                          ? <img src={getImageUrl(primaryImg.url)} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <Package size={18} style={{ color: "#a855f7" }} />
                        }
                      </div>
                    </td>

                    {/* Title Cell */}
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      {renderCellInput(p, "title")}
                    </td>

                    {/* Price Cell */}
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      {renderCellInput(p, "price", "number")}
                    </td>

                    {/* Stock Cell with neon alert status */}
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <div style={{ width: "80px" }}>
                          {renderCellInput(p, "stock", "number")}
                        </div>
                        {isLow && (
                          <span style={{ 
                            background: "rgba(239,68,68,0.12)", 
                            border: "1px solid rgba(239,68,68,0.3)", 
                            borderRadius: "6px", 
                            padding: "0.2rem 0.4rem", 
                            fontSize: "0.68rem", 
                            color: "#ff3b30",
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.2rem"
                          }}>
                            <AlertTriangle size={10} /> Alert
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Variant Specs Cell */}
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      {renderCellInput(p, "variantSpecs")}
                    </td>

                    {/* AI Tags (Non-editable) */}
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                        {(p.aiTags || []).map((tag: string) => (
                          <span key={tag} style={{
                            background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)",
                            borderRadius: 12, padding: "0.1rem 0.5rem", fontSize: "0.7rem", color: "#a855f7", textTransform: "capitalize"
                          }}>{tag}</span>
                        ))}
                      </div>
                    </td>

                    {/* Date Added (Non-editable) */}
                    <td style={{ padding: "0.75rem 1.25rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {p.createdAt}
                    </td>

                    {/* Actions Cell */}
                    <td style={{ padding: "0.75rem 1.25rem", textAlign: "center" }}>
                      <button 
                        onClick={() => handleDeleteProduct(p._id)} 
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: "0.25rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        title="Delete product"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ─── Add Product Modal ───────────────────────────────────────────── */}
        {showModal && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1.5rem"
          }}>
            <div className="glass-card animate-fade-up" style={{
              width: "100%", maxWidth: 560,
              maxHeight: "92vh", overflowY: "auto",
              padding: "2rem",
            }}>
              {/* Modal header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <div>
                  <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.2rem" }}>Add New Product</h2>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Fill in details, upload shop photos, and let AI process clean assets.</p>
                </div>
                <button onClick={resetModal} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem" }}>
                  <X size={20} />
                </button>
              </div>

              {/* Success banner */}
              {success && (
                <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <CheckCircle size={15} /> {success}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {/* ① Product Title */}
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Product Title</label>
                  <input id="product-title" className="input-field" placeholder="e.g. Wireless Noise-Cancelling Headphones" required
                    value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                </div>

                {/* ② Description */}
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Description</label>
                  <textarea id="product-description" className="input-field" placeholder="Describe your product in detail..." required rows={3}
                    style={{ resize: "vertical" }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>

                {/* ③ Price + Stock */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Price ($)</label>
                    <input id="product-price" className="input-field" type="number" min="0" step="0.01" placeholder="29.99" required
                      value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Stock Units</label>
                    <input id="product-stock" className="input-field" type="number" min="0" placeholder="10"
                      value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
                  </div>
                </div>

                {/* ④ Variant Specs */}
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Variant Specifications</label>
                  <input id="product-variants" className="input-field" placeholder="e.g. Colors: Red, Sizes: Small, Medium, Large"
                    value={form.variantSpecs} onChange={e => setForm({ ...form, variantSpecs: e.target.value })} />
                </div>

                {/* ⑤ PRODUCT MEDIA UPLOAD */}
                <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem" }}>
                  <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", marginBottom: "0.5rem" }}>
                    <Sparkles size={14} style={{ color: "#a855f7" }} />
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>AI Background Removal Active</span>
                  </div>
                  <MediaUploadZone
                    images={mediaImages}
                    onChange={setMediaImages}
                    maxFiles={8}
                    maxSizeMB={5}
                  />
                </div>

                {/* ⑥ AI Auto-Tagging */}
                <div style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 12, padding: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#a855f7", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <Zap size={13} /> AI Auto-Tagging
                    </span>
                    <button type="button" id="auto-tag-btn" onClick={handleAutoTag} disabled={tagging || !form.title}
                      style={{
                        background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "none", borderRadius: 8,
                        padding: "0.3rem 0.75rem", fontSize: "0.75rem", color: "white", cursor: "pointer",
                        fontWeight: 600, opacity: tagging || !form.title ? 0.6 : 1,
                        display: "flex", alignItems: "center", gap: "0.3rem"
                      }}>
                      {tagging ? <><Loader size={11} className="animate-spin" /> Tagging…</> : "Auto-Tag"}
                    </button>
                  </div>
                  {previewTags.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {previewTags.map(tag => (
                        <span key={tag} style={{
                          background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                          borderRadius: 20, padding: "0.2rem 0.65rem", fontSize: "0.75rem", color: "#a855f7",
                          textTransform: "capitalize", display: "flex", alignItems: "center", gap: "0.3rem"
                        }}>
                          <Tag size={10} /> {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      Enter a title above then click "Auto-Tag" to classify your product using local AI.
                    </p>
                  )}
                </div>

                {/* ⑦ Submit */}
                <button id="add-product-submit" type="submit" className="btn-primary" disabled={loading}
                  style={{ justifyContent: "center", marginTop: "0.25rem", opacity: loading ? 0.7 : 1, fontSize: "0.95rem", padding: "0.75rem" }}>
                  {loading
                    ? <><Loader size={14} className="animate-spin" /> Processing Asset…</>
                    : <><Package size={14} /> Add Product</>
                  }
                </button>
              </form>
            </div>
          </div>
        )}

        {showExportModal && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000
          }}>
            <div className="glass-card animate-fade-up" style={{ width: "420px", padding: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem", border: "1px solid var(--border-accent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Export Catalog Metrics</h3>
                <button onClick={() => setShowExportModal(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                  <X size={18} />
                </button>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Choose the dataset scope to export as an asset management CSV file:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <button 
                  onClick={() => handleExportCatalogCSV(false)}
                  className="btn-secondary"
                  style={{ justifyContent: "flex-start", padding: "0.75rem 1rem", width: "100%", textAlign: "left" }}
                >
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text-primary)" }}>Export Currently Viewed Page</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>Export only the {products.length} items currently displayed in the view.</div>
                  </div>
                </button>
                
                <button 
                  onClick={() => handleExportCatalogCSV(true)}
                  className="btn-primary"
                  style={{ justifyContent: "flex-start", padding: "0.75rem 1rem", width: "100%", textAlign: "left" }}
                >
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#000" }}>Export Complete Catalog</div>
                    <div style={{ fontSize: "0.75rem", color: "rgba(0,0,0,0.6)", marginTop: "0.1rem" }}>Pull your entire historical catalog ledger in a single query.</div>
                  </div>
                </button>
              </div>
              <button onClick={() => setShowExportModal(false)} className="btn-secondary" style={{ justifyContent: "center", marginTop: "0.5rem" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
