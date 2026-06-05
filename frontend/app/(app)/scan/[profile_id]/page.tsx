"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  quickIdentifyCard,
  quickIdentifyCardV2,
  type QuickScanResult,
  type ScanCandidate,
} from "@/lib/api";
import { useScanContext } from "@/lib/stores/useScanContext";

// Resize + compress an image client-side before upload.
// maxDimension and quality can be tuned per scan mode:
//   Quick Scan OCR: 800px, 0.70 quality — text is readable at lower res/quality
//   Smart Scan v2: 1200px, 0.80 quality
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
  | { step: "error"; message: string };

export default function ScanPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ScanState>({ step: "idle" });
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [smartScanLoading, setSmartScanLoading] = useState(false);
  const [noMatchResult, setNoMatchResult] = useState<QuickScanResult | null>(null);
  const [noMatchMethod, setNoMatchMethod] = useState<"quick" | "smart" | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[] | null>(null);

  const { setScanContext } = useScanContext();

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

  async function handleQuickScan() {
    if (!file) return;
    setQuickScanLoading(true);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setState({ step: "idle" });
    try {
      const compressed = await compressImage(file, 1200, 0.70);
      setPreview(URL.createObjectURL(compressed));
      const result = await quickIdentifyCard(compressed);
      if (result.matched && result.card_id) {
        setScanContext(result.ocr?.name ?? result.name ?? "", result.confidence ?? null);
        router.push(`/cards/${result.card_id}`);
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
      } else {
        setNoMatchResult(result);
        setNoMatchMethod("quick");
      }
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Quick Scan failed — please try again." });
    } finally {
      setQuickScanLoading(false);
    }
  }

  async function handleSmartScan() {
    if (!file) return;
    setSmartScanLoading(true);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setState({ step: "idle" });
    try {
      const compressed = await compressImage(file, 1200, 0.80);
      setPreview(URL.createObjectURL(compressed));
      const result = await quickIdentifyCardV2(compressed);
      if (result.matched && result.card_id) {
        setScanContext(result.ocr?.name ?? result.name ?? "", result.confidence ?? null);
        router.push(`/cards/${result.card_id}`);
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
      } else {
        setNoMatchResult(result);
        setNoMatchMethod("smart");
      }
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Smart Scan failed — please try again." });
    } finally {
      setSmartScanLoading(false);
    }
  }

  function handleReset() {
    setState({ step: "idle" });
    setPreview(null);
    setFile(null);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setSmartScanLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-background p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Scan Card</h1>

      {/* File picker */}
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

      {/* Scan buttons */}
      {file && state.step === "idle" && (
        <div className="flex gap-2 mb-4">
          <Button variant="secondary" className="flex-1" onClick={handleQuickScan} disabled={quickScanLoading}>
            {quickScanLoading ? "Scanning..." : "Quick Scan"}
          </Button>
          <Button className="flex-1" onClick={handleSmartScan} disabled={smartScanLoading}>
            {smartScanLoading ? "Scanning..." : "Smart Scan (v2)"}
          </Button>
        </div>
      )}

      {/* Ambiguous — let user pick the right card */}
      {scanCandidates && scanCandidates.length > 0 && (
        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm font-medium">Multiple matches found — which card is this?</p>
            <div className="flex flex-col gap-2">
              {scanCandidates.map((c) => (
                <button
                  key={c.card_id}
                  onClick={() => router.push(`/cards/${c.card_id}`)}
                  className="flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                >
                  {c.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.image_url} alt={c.name} className="h-16 w-11 rounded object-cover shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.set_name}{c.card_num ? ` · #${c.card_num}` : ""}</div>
                    <div className="text-xs text-muted-foreground">{c.language_code === "JA" ? "Japanese" : "English"}</div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No match feedback */}
      {noMatchResult && !noMatchResult.matched && (
        <Card className="mb-4 border-muted">
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm font-medium">
              {noMatchMethod === "smart" ? "Smart Scan (v2)" : "Quick Scan"} — no match found
            </p>
            {noMatchResult.ocr.name && (
              <p className="text-xs text-muted-foreground">OCR detected: &ldquo;{noMatchResult.ocr.name}&rdquo;{noMatchResult.ocr.set_number ? ` · ${noMatchResult.ocr.set_number}` : ""}</p>
            )}
            {(noMatchResult.ocr.ocr_num1 || noMatchResult.ocr.ocr_num2) && (
              <p className="text-xs text-muted-foreground">Numbers: num1={noMatchResult.ocr.ocr_num1 ?? "—"} · num2={noMatchResult.ocr.ocr_num2 ?? "—"}</p>
            )}
            {noMatchMethod === "quick" && (
              <p className="text-xs text-muted-foreground">Try &ldquo;Smart Scan (v2)&rdquo; for better identification.</p>
            )}
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
