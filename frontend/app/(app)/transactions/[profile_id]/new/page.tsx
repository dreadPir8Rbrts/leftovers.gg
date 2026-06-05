"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTransactionSeed } from "@/lib/stores/useTransactionSeed";
import {
  createTransaction,
  patchInventoryItem,
  searchCardsSmart,
  quickIdentifyCardV2,
  getCardPricing,
  getCardScrydexPrices,
  MARKETPLACE_OPTIONS,
  type TransactionType,
  type TransactionDirection,
  type TransactionCardIn,
  type Card,
  type EstimatedAcquiredPrice,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Live camera lifecycle states (used by CardPickerModal scan mode)
type CameraStatus =
  | "requesting"   // getUserMedia in progress
  | "live"         // stream active, viewfinder shown
  | "captured"     // frame grabbed, preview shown
  | "scanning"     // scan API call in progress
  | "denied"       // camera permission denied
  | "unavailable"  // getUserMedia not supported
  | "error";       // unexpected camera error

interface CardDraft {
  key: string;
  card: Card;
  direction: TransactionDirection;
  conditionType: "ungraded" | "graded";
  conditionUngraded: string;
  gradingCompany: string;
  grade: string;
  estimatedValue: string;
  quantity: number;
  inventoryItemId?: string;
}

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "HGA", "other"];
const HALF_GRADES = ["10","9.5","9","8.5","8","7.5","7","6.5","6","5.5","5","4.5","4","3.5","3","2.5","2","1.5","1"];
const GRADE_OPTIONS: Record<string, string[]> = {
  psa:   ["10","9","8","7","6","5","4","3","2","1"],
  bgs:   HALF_GRADES,
  cgc:   [...HALF_GRADES, "0.5"],
  other: ["10","9","8","7","6","5","4","3","2","1"],
};

async function compressImage(file: File, maxDimension = 1200, quality = 0.80): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(maxDimension / bitmap.width, maxDimension / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      },
      "image/jpeg",
      quality
    );
  });
}

// ---------------------------------------------------------------------------
// Pricing helper
// ---------------------------------------------------------------------------

// Fetches the current estimated value for a card at the given condition/grade,
// then calls the setter to patch that draft in state.
// Ungraded → TCGPlayer condition estimate. Graded → Scrydex market price.
// Fails silently so the user can always enter the value manually.
async function fetchEstimatedValue(
  key: string,
  cardId: string,
  conditionType: "ungraded" | "graded",
  conditionUngraded: string,
  gradingCompany: string,
  grade: string,
  setCards: React.Dispatch<React.SetStateAction<CardDraft[]>>,
): Promise<void> {
  try {
    let value = "";

    if (conditionType === "ungraded" && conditionUngraded) {
      const { data } = await getCardPricing(cardId);
      if (data.status === "ready") {
        const est = data.condition_estimates.find(
          (e) => e.condition.toUpperCase() === conditionUngraded.toUpperCase()
        );
        if (est?.estimated_price != null) {
          value = est.estimated_price.toFixed(2);
        }
      }
    } else if (conditionType === "graded" && gradingCompany && grade) {
      const { prices } = await getCardScrydexPrices(cardId);
      const entry = prices.find(
        (p) =>
          p.type === "graded" &&
          p.company?.toUpperCase() === gradingCompany.toUpperCase() &&
          p.grade === grade &&
          !p.is_signed &&
          !p.is_error
      );
      if (entry?.market != null) {
        value = entry.market.toFixed(2);
      }
    }

    if (value) {
      setCards((prev) =>
        prev.map((c) => c.key === key ? { ...c, estimatedValue: value } : c)
      );
    }
  } catch {
    // silently fail — user can enter value manually via card chip edit
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferTxType(cards: CardDraft[], cashLost: string, cashGained: string): TransactionType {
  const giving = cards.filter((c) => c.direction === "lost");
  const receiving = cards.filter((c) => c.direction === "gained");
  const hasCashLost = parseFloat(cashLost) > 0;
  const hasCashGained = parseFloat(cashGained) > 0;
  if (giving.length === 0 && hasCashLost && receiving.length > 0 && !hasCashGained) return "buy";
  if (giving.length > 0 && !hasCashLost && receiving.length === 0 && hasCashGained) return "sell";
  return "trade";
}

function computeValue(cashGained: string, cashLost: string, cards: CardDraft[]): number {
  const cg = parseFloat(cashGained) || 0;
  const cl = parseFloat(cashLost) || 0;
  const gained = cards.filter((c) => c.direction === "gained").reduce((s, c) => s + (parseFloat(c.estimatedValue) || 0) * c.quantity, 0);
  const lost = cards.filter((c) => c.direction === "lost").reduce((s, c) => s + (parseFloat(c.estimatedValue) || 0) * c.quantity, 0);
  return Math.round((cg + gained - cl - lost) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Card chip
// ---------------------------------------------------------------------------

function CardChip({
  draft,
  onEdit,
  onRemove,
}: {
  draft: CardDraft;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const condLabel =
    draft.conditionType === "ungraded"
      ? draft.conditionUngraded || "—"
      : `${draft.gradingCompany.toUpperCase()} ${draft.grade}`.trim() || "—";

  return (
    <div className="relative w-16 flex-shrink-0">
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center leading-none hover:bg-black/80 transition-colors"
      >
        ×
      </button>
      <button type="button" onClick={onEdit} className="w-full text-left">
        <div className="aspect-[3/4] rounded-lg bg-muted overflow-hidden relative border border-black/10">
          {draft.card.image_url ? (
            <Image src={draft.card.image_url} alt={draft.card.name} fill sizes="64px" className="object-contain p-0.5" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/30">?</div>
          )}
        </div>
        <p className="text-[9px] leading-tight mt-1 line-clamp-2 text-muted-foreground">{draft.card.name}</p>
        <p className="text-[9px] font-semibold">{condLabel}</p>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash chip
// ---------------------------------------------------------------------------

function CashChip({
  amount,
  onEdit,
  onRemove,
}: {
  amount: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative flex-shrink-0 self-center">
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center leading-none hover:bg-black/80 transition-colors"
      >
        ×
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="px-3 py-2 rounded-lg border border-black/20 bg-muted/30 text-sm font-semibold min-w-[4.5rem] text-center hover:bg-muted/60 transition-colors"
      >
        ${parseFloat(amount).toFixed(2)}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person row
// ---------------------------------------------------------------------------

function PersonRow({
  label,
  cards,
  cashValue,
  menuOpen,
  onMenuToggle,
  onAddCard,
  onAddCash,
  onEditCard,
  onRemoveCard,
  onEditCash,
  onRemoveCash,
}: {
  label: string;
  cards: CardDraft[];
  cashValue: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onAddCard: () => void;
  onAddCash: () => void;
  onEditCard: (draft: CardDraft) => void;
  onRemoveCard: (key: string) => void;
  onEditCash: () => void;
  onRemoveCash: () => void;
}) {
  const hasCash = !!cashValue && parseFloat(cashValue) > 0;
  const isEmpty = cards.length === 0 && !hasCash;

  const cardTotal = cards.reduce((sum, d) => sum + (parseFloat(d.estimatedValue) || 0) * d.quantity, 0);
  const cashTotal = parseFloat(cashValue) || 0;
  const sideTotal = cardTotal + cashTotal;

  return (
    <div className="rounded-xl border border-black/20 p-4 min-h-[7rem]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        {sideTotal > 0 && (
          <p className="text-xs text-muted-foreground">
            ~<span className="font-medium text-foreground">${sideTotal.toFixed(2)}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        {cards.map((draft) => (
          <CardChip
            key={draft.key}
            draft={draft}
            onEdit={() => onEditCard(draft)}
            onRemove={() => onRemoveCard(draft.key)}
          />
        ))}
        {hasCash && (
          <CashChip amount={cashValue} onEdit={onEditCash} onRemove={onRemoveCash} />
        )}
        {isEmpty && (
          <p className="text-xs text-muted-foreground/40 self-center mr-2">Nothing yet</p>
        )}
        {/* + menu */}
        <div className="relative z-20 self-center">
          <button
            type="button"
            onClick={onMenuToggle}
            className="w-12 h-12 rounded-lg border-2 border-dashed border-black/20 flex items-center justify-center text-4xl text-muted-foreground hover:text-foreground hover:border-black/40 transition-colors"
            aria-label="Add item"
          >
            +
          </button>
          {menuOpen && (
            <div className="absolute left-0 bottom-12 bg-background border border-black/20 rounded-lg shadow-lg min-w-[10rem] overflow-hidden">
              <button
                type="button"
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted"
                onClick={onAddCard}
              >
                Add a card
              </button>
              <button
                type="button"
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted border-t border-black/10"
                onClick={onAddCash}
              >
                Add cash
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card edit modal
// ---------------------------------------------------------------------------

function CardEditModal({
  draft,
  onSave,
  onClose,
}: {
  draft: CardDraft;
  onSave: (patch: Partial<CardDraft>) => void;
  onClose: () => void;
}) {
  const getGradeOpts = (company: string) =>
    GRADE_OPTIONS[company.toLowerCase()] ?? GRADE_OPTIONS.other;

  const [conditionType, setConditionType] = useState<"ungraded" | "graded">(draft.conditionType);
  const [conditionUngraded, setConditionUngraded] = useState(draft.conditionUngraded);
  const [gradingCompany, setGradingCompany] = useState(draft.gradingCompany);
  const [grade, setGrade] = useState(() => {
    const opts = getGradeOpts(draft.gradingCompany);
    return opts.includes(draft.grade) ? draft.grade : opts[0];
  });
  const [estimatedValue, setEstimatedValue] = useState(draft.estimatedValue);
  const [quantity, setQuantity] = useState(draft.quantity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b">
          {draft.card.image_url && (
            <div className="relative w-10 h-[3.2rem] rounded overflow-hidden bg-muted shrink-0">
              <Image src={draft.card.image_url} alt={draft.card.name} fill sizes="40px" className="object-contain" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{draft.card.name}</p>
            <p className="text-xs text-muted-foreground truncate">{draft.card.set_name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl text-muted-foreground hover:text-foreground shrink-0">×</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Condition</label>
              <select
                value={conditionType}
                onChange={(e) => setConditionType(e.target.value as "ungraded" | "graded")}
                className="w-full border rounded px-2 py-1.5 text-sm bg-background mt-1"
              >
                <option value="ungraded">Ungraded</option>
                <option value="graded">Graded</option>
              </select>
            </div>
            {conditionType === "ungraded" ? (
              <div>
                <label className="text-xs text-muted-foreground">Grade</label>
                <select
                  value={conditionUngraded}
                  onChange={(e) => setConditionUngraded(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm bg-background mt-1"
                >
                  <option value="">—</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground">Company</label>
                <select
                  value={gradingCompany}
                  onChange={(e) => {
                    const co = e.target.value;
                    setGradingCompany(co);
                    setGrade(getGradeOpts(co)[0]);
                  }}
                  className="w-full border rounded px-2 py-1.5 text-sm bg-background mt-1"
                >
                  <option value="">—</option>
                  {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
            )}
          </div>
          {conditionType === "graded" && (
            <div>
              <label className="text-xs text-muted-foreground">Grade</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm bg-background mt-1"
              >
                {getGradeOpts(gradingCompany).map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Est. value</label>
              <div className="relative mt-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  placeholder="0.00"
                  className="w-full border rounded pl-5 pr-2 py-1.5 text-sm bg-background"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Qty</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full border rounded px-2 py-1.5 text-sm bg-background mt-1"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => onSave({ conditionType, conditionUngraded, gradingCompany, grade, estimatedValue, quantity })}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash modal
// ---------------------------------------------------------------------------

function CashModal({
  initialAmount,
  label,
  onSave,
  onClose,
}: {
  initialAmount: string;
  label: string;
  onSave: (amount: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(initialAmount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-xs overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4">
          <p className="font-semibold text-sm mb-3">{label}</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border rounded-md pl-7 pr-3 py-2 text-sm bg-background"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1" onClick={() => onSave(amount)}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card picker modal
// ---------------------------------------------------------------------------

function CardPickerModal({
  direction,
  onSelect,
  onClose,
}: {
  direction: TransactionDirection;
  onSelect: (card: Card, direction: TransactionDirection) => void;
  onClose: () => void;
}) {
  // ── Search state ──────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Mirrors parseSearchQuery in GlobalSearch — extracts card_num and language_code tokens
  function parseSearchQuery(raw: string) {
    const LANG: Record<string, string> = { en: "en", english: "en", ja: "ja", japanese: "ja" };
    const tokens = raw.trim().split(/\s+/);
    let card_num: string | undefined;
    let language_code: string | undefined;
    const rest: string[] = [];
    for (const t of tokens) {
      if (/^\d+(?:\/\d+)?$/.test(t) && !card_num) card_num = t;
      else if (t.toLowerCase() in LANG && !language_code) language_code = LANG[t.toLowerCase()];
      else rest.push(t);
    }
    return {
      ...(rest.length > 0 ? { q: rest.join(" ") } : {}),
      ...(card_num ? { card_num } : {}),
      ...(language_code ? { language_code } : {}),
    };
  }

  // ── Camera state ──────────────────────────────────────────
  const [cameraMode, setCameraMode] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("requesting");
  const [cameraError, setCameraError] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Stop stream whenever the modal closes or camera mode exits
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Wire stream → video element after "live" transition
  useEffect(() => {
    if (cameraStatus === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraStatus]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unavailable");
      return;
    }
    setCameraStatus("requesting");
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCameraStatus("live");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCameraStatus("denied");
      } else {
        setCameraStatus("error");
        setCameraError(err instanceof Error ? err.message : "Camera unavailable.");
      }
    }
  }, []);

  function openCameraMode() {
    setCameraMode(true);
    setScanError(null);
    setCapturedFile(null);
    setCapturedPreview(null);
    startCamera();
  }

  function exitCameraMode() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraMode(false);
    setCapturedFile(null);
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedPreview(null);
    setScanError(null);
  }

  // Crop the captured frame to the guide rectangle (same math as /scan page)
  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const V_w = video.videoWidth;
    const V_h = video.videoHeight;
    const { width: C_w, height: C_h } = video.getBoundingClientRect();

    const s = Math.max(C_w / V_w, C_h / V_h);
    const offset_x = (C_w - V_w * s) / 2;
    const offset_y = (C_h - V_h * s) / 2;

    const gw = 0.62 * C_w;
    const gh = gw * (7 / 5);
    const g_x = (C_w - gw) / 2;
    const g_y = (C_h - gh) / 2;

    const crop_x = Math.round((g_x - offset_x) / s);
    const crop_y = Math.round((g_y - offset_y) / s);
    const crop_w = Math.round(gw / s);
    const crop_h = Math.round(gh / s);

    const sx = Math.max(0, crop_x);
    const sy = Math.max(0, crop_y);
    const sw = Math.min(crop_w, V_w - sx);
    const sh = Math.min(crop_h, V_h - sy);

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    streamRef.current?.getTracks().forEach((t) => t.stop());

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const f = new File([blob], "scan.jpg", { type: "image/jpeg" });
        setCapturedFile(f);
        setCapturedPreview(URL.createObjectURL(blob));
        setCameraStatus("captured");
      },
      "image/jpeg",
      0.95
    );
  }

  function resetCapture() {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedFile(null);
    setCapturedPreview(null);
    setScanError(null);
    setCameraError("");
    startCamera();
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const params = parseSearchQuery(query);
      const res = await searchCardsSmart({ ...params, broad: true, limit: 15 });
      setResults(res);
      if (res.length === 0) setSearchError("No cards found — try a different name.");
    } catch {
      setSearchError("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleScanCapture() {
    if (!capturedFile) return;
    setCameraStatus("scanning");
    setScanError(null);
    try {
      const compressed = await compressImage(capturedFile);
      const result = await quickIdentifyCardV2(compressed);
      if (result.matched && result.card_id) {
        const card: Card = {
          id: result.card_id,
          name: result.name ?? "",
          card_num: result.card_num,
          rarity: result.rarity,
          image_url: result.image_url,
          set_name: result.set_name ?? "",
          release_date: result.release_date,
          series_name: result.series_name,
          game: result.game ?? "",
          language_code: result.language_code ?? "en",
        };
        onSelect(card, direction);
        onClose();
      } else {
        setScanError("Card not recognised — retake or search by name.");
        setCameraStatus("captured");
      }
    } catch {
      setScanError("Scan failed. Try again or search by name.");
      setCameraStatus("captured");
    }
  }

  // ── Camera mode — full-screen viewfinder ──────────────────
  if (cameraMode) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <button
            onClick={exitCameraMode}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
          <h2 className="text-sm font-semibold">
            Scan card — {direction === "lost" ? "You give" : "Other party gives"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
        </div>

        {/* Viewfinder */}
        {(cameraStatus === "requesting" || cameraStatus === "live") && (
          <>
            <div
              className="relative flex-1 bg-black overflow-hidden"
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="relative"
                  style={{
                    width: "62%",
                    aspectRatio: "5/7",
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                  }}
                >
                  <span className="absolute top-0 left-0 block w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-sm" />
                  <span className="absolute top-0 right-0 block w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-sm" />
                  <span className="absolute bottom-0 left-0 block w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-sm" />
                  <span className="absolute bottom-0 right-0 block w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-sm" />
                </div>
              </div>
              <p className="absolute bottom-4 inset-x-0 text-center text-white/90 text-sm drop-shadow">
                Line up the card within the guides
              </p>
              {cameraStatus === "requesting" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <p className="text-white/80 text-sm">Opening camera…</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-center py-6 bg-black shrink-0">
              <button
                onClick={captureFrame}
                disabled={cameraStatus !== "live"}
                aria-label="Capture photo"
                className="w-16 h-16 rounded-full bg-white border-4 border-primary shadow-lg disabled:opacity-40 active:scale-95 transition-transform"
              />
            </div>
          </>
        )}

        {/* Captured / scanning */}
        {(cameraStatus === "captured" || cameraStatus === "scanning") && capturedPreview && (
          <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
            <div
              className="relative w-full rounded-xl overflow-hidden border bg-black"
              style={{ aspectRatio: "3/4", maxHeight: "60vh" }}
            >
              <Image
                src={capturedPreview}
                alt="Captured card"
                fill
                unoptimized
                sizes="100vw"
                className="object-contain"
              />
              {cameraStatus === "scanning" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                  <p className="text-white text-sm font-medium">Scanning…</p>
                </div>
              )}
            </div>
            {scanError && <p className="text-sm text-destructive">{scanError}</p>}
            {cameraStatus === "captured" && (
              <div className="flex flex-col gap-2">
                <Button onClick={handleScanCapture} className="w-full">Scan card</Button>
                <Button variant="outline" onClick={resetCapture} className="w-full">Retake photo</Button>
              </div>
            )}
          </div>
        )}

        {/* Denied */}
        {cameraStatus === "denied" && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 gap-4 text-center">
            <p className="text-sm text-muted-foreground">
              Camera access was denied. Allow camera access in your browser settings and try again.
            </p>
            <Button variant="outline" onClick={startCamera}>Try again</Button>
          </div>
        )}

        {/* Error / unavailable */}
        {(cameraStatus === "error" || cameraStatus === "unavailable") && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 gap-4 text-center">
            <p className="text-sm text-muted-foreground">
              {cameraStatus === "unavailable"
                ? "Live camera isn't available in this browser."
                : (cameraError || "Camera error — please try again.")}
            </p>
            {cameraStatus === "error" && (
              <Button variant="outline" onClick={startCamera}>Try again</Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Search mode (default) ─────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-md mx-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Add card — {direction === "lost" ? "You give" : "Other party gives"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by card name…"
            className="flex-1 border rounded-md px-3 py-2 text-base sm:text-sm bg-background"
            autoFocus
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching}
            className="px-3 py-2 text-sm rounded-md bg-foreground text-background hover:bg-foreground/80 disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
        </div>

        <button
          type="button"
          onClick={openCameraMode}
          className="w-full border rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          📷 Scan card instead
        </button>

        {searchError && <p className="text-xs text-destructive">{searchError}</p>}

        {results.length > 0 && (
          <ul className="divide-y border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {results.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => { onSelect(card, direction); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted text-left"
                >
                  {card.image_url && (
                    <div className="w-8 aspect-[3/4] flex-shrink-0 rounded overflow-hidden border relative">
                      <Image src={card.image_url} alt={card.name} fill sizes="32px" className="object-contain" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{card.name}</p>
                    <p className="text-xs text-muted-foreground">{card.set_name} · #{card.card_num}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acquired price dialog (post-save)
// ---------------------------------------------------------------------------

interface AcquiredPriceDraft extends EstimatedAcquiredPrice {
  editedValue: string;
  include: boolean;
}

function AcquiredPriceDialog({
  items,
  onConfirm,
  onSkip,
}: {
  items: AcquiredPriceDraft[];
  onConfirm: (drafts: AcquiredPriceDraft[]) => void;
  onSkip: () => void;
}) {
  const [drafts, setDrafts] = useState<AcquiredPriceDraft[]>(items);

  function toggle(id: string) {
    setDrafts((prev) => prev.map((d) => d.inventory_item_id === id ? { ...d, include: !d.include } : d));
  }

  function setValue(id: string, val: string) {
    setDrafts((prev) => prev.map((d) => d.inventory_item_id === id ? { ...d, editedValue: val } : d));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-lg mx-4 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Set acquired price?</h2>
          <p className="text-xs text-muted-foreground mt-1">Set the cost basis for cards you gained. Uncheck any you want to skip.</p>
        </div>
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {drafts.map((d) => (
            <div key={d.inventory_item_id} className="flex items-center gap-3 py-1">
              <input
                type="checkbox"
                id={`ap-${d.inventory_item_id}`}
                checked={d.include}
                onChange={() => toggle(d.inventory_item_id)}
                className="h-4 w-4 shrink-0"
              />
              <label htmlFor={`ap-${d.inventory_item_id}`} className="flex-1 min-w-0 text-sm truncate cursor-pointer">
                {d.card_name ?? "Card"}
              </label>
              <div className="relative shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.editedValue}
                  onChange={(e) => setValue(d.inventory_item_id, e.target.value)}
                  disabled={!d.include}
                  className="border rounded px-2 pl-5 py-1 text-xs bg-background w-24 disabled:opacity-40"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onConfirm(drafts)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewTransactionPage() {
  const router = useRouter();
  const params = useParams<{ profile_id: string }>();

  const seed = useTransactionSeed((s) => s.seed);
  const clearSeed = useTransactionSeed((s) => s.clear);

  const [cards, setCards] = useState<CardDraft[]>([]);
  const [cashLost, setCashLost] = useState("");
  const [cashGained, setCashGained] = useState("");

  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [marketplace, setMarketplace] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [notes, setNotes] = useState("");

  const [pickerDirection, setPickerDirection] = useState<TransactionDirection | null>(null);
  const [editingDraft, setEditingDraft] = useState<CardDraft | null>(null);
  const [cashModalDirection, setCashModalDirection] = useState<TransactionDirection | null>(null);
  const [menuOpen, setMenuOpen] = useState<TransactionDirection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [acquiredPriceDrafts, setAcquiredPriceDrafts] = useState<AcquiredPriceDraft[] | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // Read and consume seed on mount
  useEffect(() => {
    if (seed) {
      const key = `seed-${Date.now()}`;
      setCards([{
        key,
        card: seed.card,
        direction: "lost",
        conditionType: seed.conditionType,
        conditionUngraded: seed.conditionUngraded,
        gradingCompany: seed.gradingCompany,
        grade: seed.grade,
        estimatedValue: "",
        quantity: 1,
      }]);
      fetchEstimatedValue(
        key, seed.card.id,
        seed.conditionType, seed.conditionUngraded ?? "",
        seed.gradingCompany ?? "", seed.grade ?? "",
        setCards,
      );
      clearSeed();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const txType = useMemo(() => inferTxType(cards, cashLost, cashGained), [cards, cashLost, cashGained]);
  const autoValue = computeValue(cashGained, cashLost, cards);

  const addCard = useCallback((card: Card, direction: TransactionDirection) => {
    const key = `${card.id}-${Date.now()}`;
    setCards((prev) => [...prev, {
      key,
      card,
      direction,
      conditionType: "ungraded",
      conditionUngraded: "NM",
      gradingCompany: "",
      grade: "",
      estimatedValue: "",
      quantity: 1,
    }]);
    // Default condition is NM ungraded — fetch TCGPlayer NM estimate immediately
    fetchEstimatedValue(key, card.id, "ungraded", "NM", "", "", setCards);
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const cardPayload: TransactionCardIn[] = cards.map((c) => ({
        direction: c.direction,
        card_v2_id: c.card.id,
        inventory_item_id: c.inventoryItemId,
        condition_type: c.conditionType,
        condition_ungraded: c.conditionType === "ungraded" ? c.conditionUngraded || undefined : undefined,
        grading_company: c.conditionType === "graded" ? c.gradingCompany || undefined : undefined,
        grade: c.conditionType === "graded" ? c.grade || undefined : undefined,
        estimated_value: parseFloat(c.estimatedValue) || undefined,
        quantity: c.quantity,
      }));

      const result = await createTransaction({
        transaction_type: txType,
        transaction_date: txDate,
        marketplace: marketplace || undefined,
        counterparty_name: counterpartyName || undefined,
        cash_gained: txType !== "buy" ? (parseFloat(cashGained) || undefined) : undefined,
        cash_lost: txType !== "sell" ? (parseFloat(cashLost) || undefined) : undefined,
        notes: notes || undefined,
        cards: cardPayload,
      });

      const estimates = result.estimated_acquired_prices;
      if (estimates && estimates.length > 0) {
        setAcquiredPriceDrafts(
          estimates.map((e) => ({
            ...e,
            editedValue: e.estimated_value != null ? String(e.estimated_value) : "",
            include: true,
          }))
        );
      } else {
        router.push(`/transactions/${params.profile_id}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save transaction.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAcquiredPriceConfirm(drafts: AcquiredPriceDraft[]) {
    const included = drafts.filter((d) => d.include && d.editedValue);
    await Promise.all(
      included.map((d) =>
        patchInventoryItem(d.inventory_item_id, {
          acquired_price: parseFloat(d.editedValue) || undefined,
        }).catch(() => {})
      )
    );
    router.push(`/transactions/${params.profile_id}`);
  }

  function handleAcquiredPriceSkip() {
    router.push(`/transactions/${params.profile_id}`);
  }

  const txTypeLabel: Record<TransactionType, string> = { buy: "BUY", sell: "SELL", trade: "TRADE" };

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {step === 1 ? (
          <Link href={`/transactions/${params.profile_id}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </Link>
        ) : (
          <button type="button" onClick={() => setStep(1)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="text-xl font-bold">New Transaction</h1>
      </div>

      {/* ── Step 1: Transaction rows ── */}
      {step === 1 && (
        <div className="flex flex-col" style={{ minHeight: "calc(100svh - 8rem)" }}>
          <div className="flex-1 space-y-4">
            <PersonRow
              label="You"
              cards={cards.filter((c) => c.direction === "lost")}
              cashValue={cashLost}
              menuOpen={menuOpen === "lost"}
              onMenuToggle={() => setMenuOpen((prev) => prev === "lost" ? null : "lost")}
              onAddCard={() => { setMenuOpen(null); setPickerDirection("lost"); }}
              onAddCash={() => { setMenuOpen(null); setCashModalDirection("lost"); }}
              onEditCard={setEditingDraft}
              onRemoveCard={(key) => setCards((prev) => prev.filter((c) => c.key !== key))}
              onEditCash={() => setCashModalDirection("lost")}
              onRemoveCash={() => setCashLost("")}
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground border border-black/20 rounded-full px-2.5 py-0.5">
                {txTypeLabel[txType]}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <PersonRow
              label="Other party"
              cards={cards.filter((c) => c.direction === "gained")}
              cashValue={cashGained}
              menuOpen={menuOpen === "gained"}
              onMenuToggle={() => setMenuOpen((prev) => prev === "gained" ? null : "gained")}
              onAddCard={() => { setMenuOpen(null); setPickerDirection("gained"); }}
              onAddCash={() => { setMenuOpen(null); setCashModalDirection("gained"); }}
              onEditCard={setEditingDraft}
              onRemoveCard={(key) => setCards((prev) => prev.filter((c) => c.key !== key))}
              onEditCash={() => setCashModalDirection("gained")}
              onRemoveCash={() => setCashGained("")}
            />
          </div>

          <div className="pt-6 pb-8">
            <Button className="w-full" onClick={() => setStep(2)}>Next</Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Details + save ── */}
      {step === 2 && (
        <div className="space-y-3 pb-24">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full h-10 border rounded-md px-3 text-sm bg-background mt-1"
              />
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground">Marketplace</label>
              <select
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value)}
                className="w-full h-10 border rounded-md px-3 text-sm bg-background mt-1"
              >
                <option value="">Select…</option>
                {MARKETPLACE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Other party name</label>
            <input
              type="text"
              value={counterpartyName}
              onChange={(e) => setCounterpartyName(e.target.value)}
              placeholder="Optional"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none mt-1"
            />
          </div>

          <div className="border border-black/20 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Your est. gain/loss</span>
            <span className={`text-sm font-semibold ${autoValue >= 0 ? "text-green-600 dark:text-green-400" : "text-[#BF40BF]"}`}>
              {autoValue >= 0 ? "+" : ""}${Math.abs(autoValue).toFixed(2)}
            </span>
          </div>

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}

          <div className="flex gap-3 pt-1">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "Saving…" : "Save transaction"}
            </Button>
            <Link href={`/transactions/${params.profile_id}`}>
              <Button variant="outline">Cancel</Button>
            </Link>
          </div>
        </div>
      )}

      {/* Backdrop to close menus */}
      {menuOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
      )}

      {pickerDirection && (
        <CardPickerModal
          direction={pickerDirection}
          onSelect={(card, direction) => { addCard(card, direction); setPickerDirection(null); }}
          onClose={() => setPickerDirection(null)}
        />
      )}
      {editingDraft && (
        <CardEditModal
          draft={editingDraft}
          onSave={(patch) => {
            setCards((prev) => prev.map((c) => c.key === editingDraft.key ? { ...c, ...patch } : c));
            setEditingDraft(null);
          }}
          onClose={() => setEditingDraft(null)}
        />
      )}
      {cashModalDirection && (
        <CashModal
          initialAmount={cashModalDirection === "lost" ? cashLost : cashGained}
          label={cashModalDirection === "lost" ? "Cash you're giving" : "Cash you're receiving"}
          onSave={(amount) => {
            if (cashModalDirection === "lost") setCashLost(amount);
            else setCashGained(amount);
            setCashModalDirection(null);
          }}
          onClose={() => setCashModalDirection(null)}
        />
      )}
      {acquiredPriceDrafts && (
        <AcquiredPriceDialog
          items={acquiredPriceDrafts}
          onConfirm={handleAcquiredPriceConfirm}
          onSkip={handleAcquiredPriceSkip}
        />
      )}
    </div>
  );
}
