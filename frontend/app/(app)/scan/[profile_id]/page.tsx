"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { RotateCcw, Search, LayoutList, Flag, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  quickIdentifyCard,
  quickIdentifyCardV2,
  searchCardsSmart,
  type QuickScanResult,
  type ScanCandidate,
  type Card as CardData,
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
  | { step: "result" }
  | { step: "error"; message: string };

export default function ScanPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ScanState>({ step: "idle" });
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [smartScanLoading, setSmartScanLoading] = useState(false);
  const [quickScanNoMatch, setQuickScanNoMatch] = useState<QuickScanResult | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[] | null>(null);

  // Result step state
  const [scanResult, setScanResult] = useState<QuickScanResult | null>(null);
  const [notRightOpen, setNotRightOpen] = useState(false);
  const [similarCards, setSimilarCards] = useState<CardData[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [reported, setReported] = useState(false);

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
    setQuickScanNoMatch(null);
    setScanCandidates(null);
    setScanResult(null);
    setState({ step: "idle" });
    try {
      const compressed = await compressImage(file, 1200, 0.70);
      setPreview(URL.createObjectURL(compressed));
      const result = await quickIdentifyCard(compressed);
      if (result.matched && result.card_id) {
        setScanResult(result);
        setNotRightOpen(false);
        setSimilarCards(null);
        setReported(false);
        setState({ step: "result" });
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
      } else {
        setQuickScanNoMatch(result);
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
    setQuickScanNoMatch(null);
    setScanCandidates(null);
    setScanResult(null);
    setState({ step: "idle" });
    try {
      const compressed = await compressImage(file, 1200, 0.80);
      setPreview(URL.createObjectURL(compressed));
      const result = await quickIdentifyCardV2(compressed);
      if (result.matched && result.card_id) {
        setScanResult(result);
        setNotRightOpen(false);
        setSimilarCards(null);
        setReported(false);
        setState({ step: "result" });
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
      } else {
        setQuickScanNoMatch(result);
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
    setQuickScanNoMatch(null);
    setScanCandidates(null);
    setSmartScanLoading(false);
    setScanResult(null);
    setNotRightOpen(false);
    setSimilarCards(null);
    setReported(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleViewSimilar() {
    if (!scanResult) return;
    const q = scanResult.ocr?.name ?? scanResult.name ?? "";
    if (!q) return;
    setLoadingSimilar(true);
    setSimilarCards(null);
    try {
      const data = await searchCardsSmart({ q, broad: true, limit: 15 });
      setSimilarCards(data);
    } catch {
      setSimilarCards([]);
    } finally {
      setLoadingSimilar(false);
    }
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
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={handleQuickScan} disabled={quickScanLoading}>
              {quickScanLoading ? "Scanning..." : "Quick Scan"}
            </Button>
            <Button className="flex-1" onClick={handleSmartScan} disabled={smartScanLoading}>
              {smartScanLoading ? "Scanning..." : "Smart Scan (v2)"}
            </Button>
          </div>
        </div>
      )}

      {/* Scan result — card identified */}
      {state.step === "result" && scanResult && (
        <div className="space-y-3 mb-4">
          {/* Identified card */}
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex gap-4">
                {scanResult.image_url && (
                  <div className="relative w-20 shrink-0 rounded overflow-hidden border" style={{ aspectRatio: "3/4" }}>
                    <Image
                      src={scanResult.image_url}
                      alt={scanResult.name ?? ""}
                      fill
                      sizes="80px"
                      className="object-contain"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-semibold text-sm leading-snug">{scanResult.name}</p>
                  {scanResult.card_num && (
                    <p className="text-xs text-muted-foreground">#{scanResult.card_num}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{scanResult.set_name}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {scanResult.language_code && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {scanResult.language_code === "JA" ? "Japanese" : "English"}
                      </span>
                    )}
                    {scanResult.confidence != null && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        scanResult.confidence >= 0.85
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : scanResult.confidence >= 0.60
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}>
                        {Math.round(scanResult.confidence * 100)}% match
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                className="w-full mt-4"
                onClick={() => router.push(`/cards/${scanResult.card_id}`)}
              >
                Go to card →
              </Button>
            </CardContent>
          </Card>

          {/* Not the right card? */}
          <div>
            <button
              type="button"
              onClick={() => {
                setNotRightOpen((o) => !o);
                setSimilarCards(null);
                setReported(false);
              }}
              className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-2 transition-colors"
            >
              Not the right card?
              {notRightOpen
                ? <ChevronUp className="h-3 w-3" />
                : <ChevronDown className="h-3 w-3" />
              }
            </button>

            {notRightOpen && (
              <Card>
                <CardContent className="pt-4 pb-4 space-y-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                  >
                    <RotateCcw className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Try again</p>
                      <p className="text-xs text-muted-foreground">Take another photo and rescan</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/vendor/card-search")}
                    className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                  >
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Manual search</p>
                      <p className="text-xs text-muted-foreground">Search by name, set, or card number</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleViewSimilar}
                    disabled={loadingSimilar}
                    className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors disabled:opacity-50"
                  >
                    {loadingSimilar
                      ? <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
                      : <LayoutList className="h-4 w-4 text-muted-foreground shrink-0" />
                    }
                    <div>
                      <p className="text-sm font-medium">View similar results</p>
                      <p className="text-xs text-muted-foreground">Browse cards that match the scan data</p>
                    </div>
                  </button>

                  {reported ? (
                    <p className="text-xs text-muted-foreground text-center py-2">Thanks — we&apos;ll review this scan.</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReported(true)}
                      className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                    >
                      <Flag className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Report unidentifiable card</p>
                        <p className="text-xs text-muted-foreground">Let us know this card couldn&apos;t be identified</p>
                      </div>
                    </button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Similar results */}
          {(loadingSimilar || similarCards !== null) && (
            <Card>
              <CardContent className="pt-5 pb-5 space-y-3">
                {loadingSimilar && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!loadingSimilar && similarCards !== null && (
                  <>
                    <p className="text-sm font-medium">
                      {similarCards.length > 0
                        ? `${similarCards.length} similar card${similarCards.length !== 1 ? "s" : ""}`
                        : "No similar cards found"}
                    </p>
                    {similarCards.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {similarCards.map((card) => (
                          <button
                            key={card.id}
                            onClick={() => router.push(`/cards/${card.id}`)}
                            className="flex items-center gap-3 rounded-lg border p-3 text-left hover:border-foreground/50 transition-colors"
                          >
                            {card.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={card.image_url}
                                alt={card.name}
                                className="h-16 w-11 rounded object-cover shrink-0"
                              />
                            ) : (
                              <div className="h-16 w-11 rounded bg-muted shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{card.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {card.set_name}{card.card_num ? ` · #${card.card_num}` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {card.language_code === "JA" ? "Japanese" : "English"}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
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
