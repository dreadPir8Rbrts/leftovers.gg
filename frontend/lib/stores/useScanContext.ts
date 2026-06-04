import { create } from "zustand";

interface ScanContextState {
  q: string | null;
  confidence: number | null;
  setScanContext: (q: string, confidence?: number | null) => void;
  clearScanContext: () => void;
}

export const useScanContext = create<ScanContextState>((set) => ({
  q: null,
  confidence: null,
  setScanContext: (q, confidence = null) => set({ q, confidence }),
  clearScanContext: () => set({ q: null, confidence: null }),
}));
