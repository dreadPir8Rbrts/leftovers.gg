"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  identifyCard,
  quickIdentifyCard,
  addInventoryItem,
  type Card as TCGCard,
  type QuickScanResult,
} from "@/lib/api";

// Resize + compress an image client-side before upload.
// maxDimension and quality can be tuned per scan mode:
//   Claude Vision: 1400px, 0.85 quality (default)
//   Quick Scan OCR: 800px, 0.70 quality — text is readable at lower res/quality
async function compressImage(file: File, maxDimension = 1400, quality = 0.85): Promise<File> {
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

type ScanState =
  | { step: "idle" }
  | { step: "uploading"; progress: number }
  | { step: "scanning" }
  | { step: "confirm"; card: TCGCard; confidence: number; scanJobId: string; claudeName?: string }
  | { step: "done" }
  | { step: "error"; message: string };

const CONDITION_OPTIONS = [
  { value: "raw_nm", label: "NM (Raw)" },
  { value: "raw_lp", label: "LP (Raw)" },
  { value: "raw_mp", label: "MP (Raw)" },
  { value: "raw_hp", label: "HP (Raw)" },
  { value: "raw_dmg", label: "DMG (Raw)" },
  { value: "psa_10", label: "PSA 10" },
  { value: "psa_9", label: "PSA 9" },
  { value: "psa_8", label: "PSA 8" },
  { value: "bgs_10", label: "BGS 10" },
  { value: "bgs_9", label: "BGS 9" },
];

export default function ScanPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ScanState>({ step: "idle" });
  const [condition, setCondition] = useState("raw_nm");
  const [askingPrice, setAskingPrice] = useState("");
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [quickScanNoMatch, setQuickScanNoMatch] = useState<QuickScanResult | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, [router]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setState({ step: "idle" });
  }

  async function handleScan() {
    if (!file) return;
    try {
      // Step 1: compress client-side
      setState({ step: "uploading", progress: 20 });
      const compressed = await compressImage(file);
      setPreview(URL.createObjectURL(compressed));

      // Step 2: identify — single POST to FastAPI → Claude, returns full card data
      setState({ step: "scanning" });
      const result = await identifyCard(compressed);
      setState({ step: "confirm", card: result, confidence: result.confidence, scanJobId: result.card_id, claudeName: result.claude_card_name ?? undefined });
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Could not identify card — please search manually." });
    }
  }

  async function handleQuickScan() {
    if (!file) return;
    setQuickScanLoading(true);
    setQuickScanNoMatch(null);
    setState({ step: "idle" });
    try {
      const compressed = await compressImage(file, 1200, 0.70);
      setPreview(URL.createObjectURL(compressed));
      const result = await quickIdentifyCard(compressed);
      if (result.matched && result.card_id && result.name && result.card_num && result.set_name && result.series_name && result.category) {
        // Route matched result into the existing confirm flow
        const card: TCGCard = {
          id: result.card_id,
          name: result.name,
          card_num: result.card_num,
          category: result.category,
          rarity: result.rarity,
          illustrator: result.illustrator,
          image_url: result.image_url,
          variants: result.variants,
          set_name: result.set_name,
          release_date: result.release_date,
          series_name: result.series_name,
          series_logo_url: result.series_logo_url,
        };
        setState({ step: "confirm", card, confidence: result.confidence ?? 0, scanJobId: result.card_id });
      } else {
        setQuickScanNoMatch(result);
      }
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Quick Scan failed — please try again." });
    } finally {
      setQuickScanLoading(false);
    }
  }

  async function handleConfirm() {
    if (state.step !== "confirm") return;
    try {
      await addInventoryItem({
        card_id: state.card.id,
        condition,
        asking_price: askingPrice || undefined,
        is_for_sale: true,
        is_for_trade: false,
        quantity: 1,
      });
      setState({ step: "done" });
      setPreview(null);
      setFile(null);
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Failed to add to inventory" });
    }
  }

  function handleReset() {
    setState({ step: "idle" });
    setPreview(null);
    setFile(null);
    setAskingPrice("");
    setCondition("raw_nm");
    setQuickScanNoMatch(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-background p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Scan Card</h1>

      {/* File picker */}
      {state.step !== "done" && (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              {preview ? "Choose different photo" : "Take photo or choose file"}
            </Button>
            {preview && (
              <div className="mt-4 relative w-full aspect-[3/4] rounded-lg overflow-hidden border">
                <Image src={preview} alt="Card preview" fill sizes="100vw" className="object-contain" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload / scan progress */}
      {state.step === "uploading" && (
        <Card className="mb-4">
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm text-muted-foreground">Uploading...</p>
            <Progress value={state.progress} />
          </CardContent>
        </Card>
      )}

      {state.step === "scanning" && (
        <Card className="mb-4">
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm text-muted-foreground">Identifying card with Claude Vision...</p>
            <Progress value={100} className="animate-pulse" />
          </CardContent>
        </Card>
      )}

      {/* Scan buttons */}
      {file && state.step === "idle" && (
        <div className="flex gap-3 mb-4">
          <Button className="flex-1" onClick={handleScan}>
            Identify Card
          </Button>
          <Button variant="secondary" className="flex-1" onClick={handleQuickScan} disabled={quickScanLoading}>
            {quickScanLoading ? "Scanning..." : "Quick Scan"}
          </Button>
        </div>
      )}

      {/* Quick Scan — no match feedback */}
      {quickScanNoMatch && !quickScanNoMatch.matched && (
        <Card className="mb-4 border-muted">
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm font-medium">Quick Scan — no match found</p>
            {quickScanNoMatch.ocr.name && (
              <p className="text-xs text-muted-foreground">OCR detected: &ldquo;{quickScanNoMatch.ocr.name}&rdquo;{quickScanNoMatch.ocr.set_number ? ` · ${quickScanNoMatch.ocr.set_number}` : ""}</p>
            )}
            {(quickScanNoMatch.ocr.ocr_num1 || quickScanNoMatch.ocr.ocr_num2) && (
              <p className="text-xs text-muted-foreground">Numbers: num1={quickScanNoMatch.ocr.ocr_num1 ?? "—"} · num2={quickScanNoMatch.ocr.ocr_num2 ?? "—"}</p>
            )}
            <p className="text-xs text-muted-foreground">Try &ldquo;Identify Card&rdquo; for Claude Vision analysis.</p>
          </CardContent>
        </Card>
      )}

      {/* Confirmation UI */}
      {state.step === "confirm" && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{state.card.name}</span>
              <Badge variant={state.confidence >= 0.9 ? "default" : "secondary"}>
                {Math.round(state.confidence * 100)}% confidence
              </Badge>
            </CardTitle>
            {state.claudeName && state.claudeName.toLowerCase() !== state.card.name.toLowerCase() && (
              <p className="text-xs text-muted-foreground">Claude read: &ldquo;{state.claudeName}&rdquo;</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              {preview && (
                <div className="relative w-32 aspect-[3/4] rounded border overflow-hidden flex-shrink-0">
                  <Image src={preview} alt="Your photo" fill sizes="128px" className="object-contain" />
                </div>
              )}
              {state.card.image_url && (
                <div className="relative w-32 aspect-[3/4] rounded border overflow-hidden flex-shrink-0">
                  <Image
                    src={state.card.image_url}
                    alt={state.card.name}
                    fill
                    sizes="128px"
                    className="object-contain"
                  />
                </div>
              )}
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Set:</span> {state.card.set_name}</p>
                <p><span className="text-muted-foreground">Number:</span> {state.card.card_num}</p>
                <p><span className="text-muted-foreground">Series:</span> {state.card.series_name}</p>
                {state.card.rarity && <p><span className="text-muted-foreground">Rarity:</span> {state.card.rarity}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                {CONDITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Asking price (optional)</label>
              <input
                type="number"
                placeholder="e.g. 450.00"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={handleConfirm}>
                Add to Inventory
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Rescan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success */}
      {state.step === "done" && (
        <Card className="mb-4">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-lg font-medium">Added to inventory!</p>
            <Button onClick={handleReset}>Scan another card</Button>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {state.step === "error" && (
        <Card className="mb-4 border-destructive">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" onClick={handleReset}>Try again</Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
