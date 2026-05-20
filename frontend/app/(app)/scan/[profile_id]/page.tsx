"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  identifyCard,
  quickIdentifyCard,
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
  | { step: "error"; message: string };

export default function ScanPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ScanState>({ step: "idle" });
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
      router.push(`/cards/${result.id}`);
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
      if (result.matched && result.card_id) {
        router.push(`/cards/${result.card_id}`);
      } else {
        setQuickScanNoMatch(result);
      }
    } catch (err) {
      setState({ step: "error", message: err instanceof Error ? err.message : "Quick Scan failed — please try again." });
    } finally {
      setQuickScanLoading(false);
    }
  }

  function handleReset() {
    setState({ step: "idle" });
    setPreview(null);
    setFile(null);
    setQuickScanNoMatch(null);
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
