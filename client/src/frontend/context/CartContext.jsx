import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';

const CartCtx = createContext(null);
export const CART_TOKEN_KEY = 'kc_cart_token';
const TOKEN_KEY = CART_TOKEN_KEY;

function tokenHeader() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { 'X-Cart-Token': token } : {};
}

function persistToken(session_key) {
  if (session_key) localStorage.setItem(TOKEN_KEY, session_key);
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [], subtotal: 0 });
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/cart', { headers: tokenHeader() });
    persistToken(data.session_key);
    setCart(data);
    return data;
  }, []);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

  const addItem = useCallback(async (product_id, qty = 1) => {
    const { data } = await api.post('/cart/items', { product_id, qty }, { headers: tokenHeader() });
    persistToken(data.session_key);
    setCart(data);
    setDrawerOpen(true);
    return data;
  }, []);

  // Event tickets are a hold, not a confirmed sale — cart_items.hold_expires_at
  // is echoed back by the server on every add/update so the UI can show a
  // live countdown (see holdSecondsLeft below). Throws the same way addItem
  // does (e.g. "Only 3 ticket(s) left") — callers already handle addItem
  // rejections the same way.
  const addTicket = useCallback(async (ticket_type_id, qty = 1) => {
    const { data } = await api.post('/cart/items', { ticket_type_id, qty }, { headers: tokenHeader() });
    persistToken(data.session_key);
    setCart(data);
    setDrawerOpen(true);
    return data;
  }, []);

  const updateItem = useCallback(async (itemId, qty) => {
    const { data } = await api.put(`/cart/items/${itemId}`, { qty }, { headers: tokenHeader() });
    setCart(data);
    return data;
  }, []);

  const removeItem = useCallback(async (itemId) => {
    const { data } = await api.delete(`/cart/items/${itemId}`, { headers: tokenHeader() });
    setCart(data);
    return data;
  }, []);

  const clearCart = useCallback(async () => {
    const { data } = await api.delete('/cart', { headers: tokenHeader() });
    setCart(data);
    return data;
  }, []);

  const itemCount = cart.items.reduce((n, it) => n + it.qty, 0);

  // Seconds remaining on a ticket item's checkout hold, or null for
  // non-ticket items / items with no hold. Callers poll this each second to
  // render a countdown; once it hits 0 the next refresh() drops the item
  // (the server purges expired holds whenever the cart is fetched).
  const holdSecondsLeft = useCallback((item) => {
    if (!item?.hold_expires_at) return null;
    // The API returns MySQL DATETIME strings (server pool runs timezone: 'Z',
    // i.e. UTC) with no timezone marker — parse explicitly as UTC or every
    // browser not set to UTC mis-reads it as local time and the countdown is
    // off by the local UTC offset.
    const utcIso = `${item.hold_expires_at.replace(' ', 'T')}Z`;
    const ms = new Date(utcIso).getTime() - Date.now();
    return Math.max(0, Math.round(ms / 1000));
  }, []);

  return (
    <CartCtx.Provider value={{ cart, loading, itemCount, addItem, addTicket, updateItem, removeItem, clearCart, refresh, tokenHeader, holdSecondsLeft, drawerOpen, openDrawer, closeDrawer }}>
      {children}
    </CartCtx.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
