import { create } from "zustand";
import type { Card } from "@/lib/api";

export interface CartItem {
  cartId: string;
  card: Card;
  condition_type: "ungraded" | "graded";
  condition_ungraded?: string;
  grading_company?: string;
  grade?: string;
  quantity: number;
}

interface TransactionCartStore {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "cartId">) => void;
  updateItem: (cartId: string, patch: Partial<Omit<CartItem, "cartId" | "card">>) => void;
  removeItem: (cartId: string) => void;
  clear: () => void;
}

export const useTransactionCart = create<TransactionCartStore>((set) => ({
  items: [],
  addItem: (item) =>
    set((state) => ({
      items: [...state.items, { ...item, cartId: crypto.randomUUID() }],
    })),
  updateItem: (cartId, patch) =>
    set((state) => ({
      items: state.items.map((it) => (it.cartId === cartId ? { ...it, ...patch } : it)),
    })),
  removeItem: (cartId) =>
    set((state) => ({ items: state.items.filter((it) => it.cartId !== cartId) })),
  clear: () => set({ items: [] }),
}));
