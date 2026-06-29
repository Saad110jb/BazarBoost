"use client";
import React, { createContext, useContext, useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export interface CartItem {
  productId: string;
  quantity: number;
  title?: string;
  price?: number;
  image?: string;
  storeId?: string;
  storeName?: string;
  storeSlug?: string;
}

interface CartContextType {
  cart: CartItem[];
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  addToCart: (productId: string, productDetails?: { title: string, price: number, image: string, storeId?: string, storeName?: string, storeSlug?: string }) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  syncCartWithDB: () => Promise<void>;
  loading: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // 1. Load cart state from localStorage on startup
  useEffect(() => {
    const local = localStorage.getItem("bazaar_cart");
    if (local) {
      try {
        setCart(JSON.parse(local));
      } catch (e) {
        console.error("Failed to parse local cart storage:", e);
      }
    }
    setLoading(false);
  }, []);

  // 2. Persist cart to localStorage on changes, and sync to DB if user is logged in
  useEffect(() => {
    if (!loading) {
      localStorage.setItem("bazaar_cart", JSON.stringify(cart));
      const token = localStorage.getItem("bazaar_token");
      if (token) {
        syncCartWithServer(cart, token);
      }
    }
  }, [cart, loading]);

  // 3. Helper function to PUT cart array to backend
  const syncCartWithServer = async (cartItems: CartItem[], token: string) => {
    try {
      const payload = cartItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }));

      await fetch(`${API}/api/auth/cart`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ cart: payload })
      });
    } catch (error) {
      console.warn("[Cart Sync] Sync to server deferred: connection lost.", error);
    }
  };

  // 4. Fetch and merge backend cart items on demand (e.g. on login or refresh)
  const syncCartWithDB = async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    try {
      const res = await fetch(`${API}/api/auth/cart`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.cart) {
        const serverCart: CartItem[] = data.cart.map((item: any) => ({
          productId: item.productId?._id || item.productId,
          quantity: item.quantity,
          title: item.productId?.title || "Product",
          price: item.productId?.price || 0,
          image: item.productId?.images?.[0]?.url || "",
          storeId: item.productId?.storeId?._id || item.productId?.storeId || "",
          storeName: item.productId?.storeId?.name || "Local Store",
          storeSlug: item.productId?.storeId?.slug || "store"
        }));

        setCart(prev => {
          const merged = [...prev];
          serverCart.forEach(serverItem => {
            const index = merged.findIndex(i => i.productId === serverItem.productId);
            if (index > -1) {
              // Resolve item conflict by taking the higher quantity
              merged[index].quantity = Math.max(merged[index].quantity, serverItem.quantity);
            } else {
              merged.push(serverItem);
            }
          });
          return merged;
        });
      }
    } catch (error) {
      console.warn("[Cart Sync] Sync from server database failed:", error);
    }
  };

  // Run initial sync on mount
  useEffect(() => {
    const token = localStorage.getItem("bazaar_token");
    if (token) {
      syncCartWithDB();
    }
  }, []);

  const addToCart = (
    productId: string, 
    details?: { title: string, price: number, image: string, storeId?: string, storeName?: string, storeSlug?: string }
  ) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (existing) {
        return prev.map(item =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, {
        productId,
        quantity: 1,
        title: details?.title || "Product",
        price: details?.price || 0,
        image: details?.image || "",
        storeId: details?.storeId || "",
        storeName: details?.storeName || "Local Store",
        storeSlug: details?.storeSlug || "store"
      }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(prev =>
      prev.map(item =>
        item.productId === productId ? { ...item, quantity } : item
      )
    );
  };

  const clearCart = () => {
    setCart([]);
  };

  return (
    <CartContext.Provider value={{ cart, isCartOpen, setIsCartOpen, addToCart, removeFromCart, updateQuantity, clearCart, syncCartWithDB, loading }}>
      {children}
    </CartContext.Provider>
  );
};
