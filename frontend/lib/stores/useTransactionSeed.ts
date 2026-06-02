import { create } from "zustand";
import type { Card } from "@/lib/api";

export interface TransactionSeed {
  card: Card;
  conditionType: "ungraded" | "graded";
  conditionUngraded: string;
  gradingCompany: string;
  grade: string;
}

interface TransactionSeedStore {
  seed: TransactionSeed | null;
  setSeed: (seed: TransactionSeed) => void;
  clear: () => void;
}

export const useTransactionSeed = create<TransactionSeedStore>((set) => ({
  seed: null,
  setSeed: (seed) => set({ seed }),
  clear: () => set({ seed: null }),
}));
