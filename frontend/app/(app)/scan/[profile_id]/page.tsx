"use client";

/*
 * ============================================================
 * V1 CAMERA APPROACH — FILE INPUT (disabled, not deleted)
 * ============================================================
 * The original scan page used <input type="file" capture="environment">.
 * Tapping the button opened the OS native camera app (or file picker).
 * After selecting/taking a photo, the user returned to the page with a
 * preview and manually chose "Quick Scan" or "Smart Scan (v2)".
 *
 * To restore V1, look for the blocks labelled:
 *   [V1 TYPES]    — ScanState discriminated union
 *   [V1 STATE]    — fileRef, preview, file, state vars
 *   [V1 HANDLERS] — handleFileChange, handleReset
 *   [V1 RETURN]   — the original JSX tree
 *
 * Steps to revert:
 *   1. Restore the imports (no getUserMedia-related hooks needed)
 *   2. Uncomment the [V1 STATE] and [V1 HANDLERS] blocks
 *   3. Replace the current return statement with the [V1 RETURN] block
 *   4. Remove the V2 camera state, refs, and effects below
 * ============================================================
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  HTMLCanvasElementLuminanceSource,
  InvertedLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  MultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
} from "@zxing/library";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import {
  quickIdentifyCard,
  quickIdentifyCardV2,
  quickIdentifyCardV3,
  lookupCertCard,
  type QuickScanResult,
  type ScanCandidate,
} from "@/lib/api";
import { useScanContext } from "@/lib/stores/useScanContext";

// Resize + compress an image client-side before upload.
// Quick Scan OCR: 800px, 0.70 — text is readable at lower quality
// Smart Scan v2:  800px, 0.70
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

// ── [V1 TYPES] ─────────────────────────────────────────────
// type ScanState =
//   | { step: "idle" }
//   | { step: "error"; message: string };
// ───────────────────────────────────────────────────────────

// Camera lifecycle states.
// "photo_idle" is the default — shows a static card guide, no camera stream needed.
// Tapping the shutter opens the native OS camera directly via <input capture>.
// "requesting", "live", "denied", "unavailable", "error" are QR-mode-only states.
type CameraStatus =
  | "photo_idle"    // photo mode — static guide, waiting for shutter tap
  | "requesting"    // getUserMedia in progress (QR mode)
  | "live"          // stream active, viewfinder shown (QR mode)
  | "captured"      // photo obtained, scan options shown
  | "scanning"      // OCR/Claude scan API call in progress
  | "cert_lookup"   // QR cert number detected, fetching card from PSA/BGS/CGC
  | "denied"        // camera permission denied (QR mode)
  | "unavailable"   // getUserMedia not supported (QR mode)
  | "error";        // unexpected camera error (QR mode)

export default function ScanPage() {
  const router = useRouter();

  // ── Camera refs + state ───────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("photo_idle");
  const [cameraError, setCameraError] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  // ── Scan mode toggle ──────────────────────────────────────
  // "photo" — static card guide + native OS camera (full quality, no stream needed)
  // "qr"    — live video viewfinder + auto-detect PSA cert QR code
  const [scanMode, setScanMode] = useState<"photo" | "qr">("photo");

  const [dailyLimitReached, setDailyLimitReached] = useState(false);

  // ── QR scanning refs ──────────────────────────────────────
  // qrIntervalRef: polls the live video frame every 300ms with jsQR
  // certLookupInProgressRef: guard to prevent firing multiple lookups from consecutive QR detections
  // qrCanvasRef: offscreen canvas reused across QR scan frames (avoids re-allocation)
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const certLookupInProgressRef = useRef(false);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrDecodingRef = useRef(false); // prevents re-entrant async BarcodeDetector calls
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);

  // ── [V1 STATE] ─────────────────────────────────────────────
  // const fileRef = useRef<HTMLInputElement>(null);
  // const [preview, setPreview] = useState<string | null>(null);
  // const [file, setFile] = useState<File | null>(null);
  // const [state, setState] = useState<ScanState>({ step: "idle" });
  // ───────────────────────────────────────────────────────────

  // File input refs
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fallbackFileRef = useRef<HTMLInputElement>(null);

  // Scan result state — shared between photo and QR modes
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [smartScanLoading, setSmartScanLoading] = useState(false);
  const [v3ScanLoading, setV3ScanLoading] = useState(false);
  const [noMatchResult, setNoMatchResult] = useState<QuickScanResult | null>(null);
  const [noMatchMethod, setNoMatchMethod] = useState<"quick" | "smart" | "v3" | "qr" | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[] | null>(null);

  const { setScanContext } = useScanContext();

  // Auth guard (AppShell also redirects, this is belt-and-suspenders)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, [router]);

  // Start the rear camera stream (QR mode only)
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

  // Default mode is photo — no camera stream needed on mount. Cleanup on unmount.
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Wire stream → video element after "live" transition (ensures DOM is ready)
  useEffect(() => {
    if (cameraStatus === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {/* muted autoplay blocked — unlikely */});
    }
  }, [cameraStatus]);

  // QR cert detection — polls every 300ms while in QR mode with live camera.
  // Scans the full video frame (not just the guide region) because the QR code
  // on a graded slab is typically near the bottom/back, not centred.
  useEffect(() => {
    if (cameraStatus !== "live" || scanMode !== "qr") return;

    if (!qrCanvasRef.current) {
      qrCanvasRef.current = document.createElement("canvas");
    }

    // Initialise ZXing MultiFormatReader once with TRY_HARDER — reused every frame.
    if (!zxingReaderRef.current) {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const r = new MultiFormatReader();
      r.setHints(hints);
      zxingReaderRef.current = r;
    }

    qrIntervalRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || certLookupInProgressRef.current || qrDecodingRef.current) return;

      const canvas = qrCanvasRef.current!;
      // Cap at 1280px — logo QR codes (e.g. TAG) need higher resolution to decode.
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let qrText: string | null = null;

      // Path 1: native BarcodeDetector (Chrome/Android) — handles logo QR codes natively.
      if ("BarcodeDetector" in window) {
        qrDecodingRef.current = true;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
          const codes = await detector.detect(canvas);
          if (codes.length > 0) qrText = codes[0].rawValue as string;
        } catch { /* not supported or no code found */ } finally {
          qrDecodingRef.current = false;
        }
      }

      // Path 2: ZXing MultiFormatReader with TRY_HARDER + inverted luminance fallback.
      if (!qrText) {
        try {
          const reader = zxingReaderRef.current!;
          const luminance = new HTMLCanvasElementLuminanceSource(canvas);
          for (const src of [luminance, new InvertedLuminanceSource(luminance)]) {
            try {
              qrText = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(src))).getText();
              if (qrText) break;
            } catch { /* try next */ }
          }
        } catch { /* no QR in frame */ }
      }

      if (qrText) {
        const certInfo = parseCertUrl(qrText);
        if (certInfo) {
          certLookupInProgressRef.current = true;
          handleCertQr(certInfo);
        }
      }
    }, 300);

    return () => {
      if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraStatus, scanMode]);

  // Parse a QR code URL to extract a cert number + grading company.
  // PSA: https://www.psacard.com/cert/{certNumber} or .../cert/{certNumber}/psa
  // TAG: https://my.taggrading.com/card/{certNumber}
  // Returns null for non-cert QR codes (e.g. generic URLs, WiFi QRs, etc.)
  function parseCertUrl(url: string): { certNumber: string; company: string } | null {
    const psaMatch = url.match(/psacard\.com\/cert\/(\w+)/i);
    if (psaMatch) return { certNumber: psaMatch[1], company: "psa" };
    const tagMatch = url.match(/taggrading\.com\/card\/(\w+)/i);
    if (tagMatch) return { certNumber: tagMatch[1], company: "tag" };
    return null;
  }

  async function handleCertQr({ certNumber, company }: { certNumber: string; company: string }) {
    if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraStatus("cert_lookup");
    setCameraError("");

    try {
      const result = await lookupCertCard(certNumber, company);
      if (result.matched && result.card_id) {
        setScanContext(result.ocr?.name ?? result.name ?? "", result.confidence ?? null);
        router.push(`/cards/${result.card_id}`);
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
        setCameraStatus("captured");
      } else {
        setNoMatchResult(result);
        setNoMatchMethod("qr");
        setCameraStatus("captured");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Daily request limit reached") {
        setDailyLimitReached(true);
        certLookupInProgressRef.current = false;
        startCamera();
      } else {
        setCameraError(msg || "QR cert lookup failed — please try again.");
        certLookupInProgressRef.current = false;
        startCamera();
      }
    }
  }

  // Photo returned from the native OS camera — go straight to scan options.
  // The native camera already provides its own "Retake" / "Use Photo" UI,
  // so there is no separate review step here.
  function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCapturedFile(f);
    setCapturedPreview(URL.createObjectURL(f));
    setScanCandidates(null);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setCameraStatus("captured");
    // Reset so the same photo can be retaken after a retake
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  // Switch between photo and QR modes.
  // Photo → QR: start camera stream.
  // QR → Photo: stop stream, return to static guide.
  function handleSetScanMode(mode: "photo" | "qr") {
    if (mode === scanMode) return;
    setScanMode(mode);
    certLookupInProgressRef.current = false;
    if (mode === "qr") {
      startCamera();
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraStatus("photo_idle");
    }
  }

  // Reset all state and return to the idle state for the current mode
  function resetScan() {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedFile(null);
    setCapturedPreview(null);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setQuickScanLoading(false);
    setSmartScanLoading(false);
    setCameraError("");
    certLookupInProgressRef.current = false;
    if (scanMode === "qr") {
      startCamera();
    } else {
      setCameraStatus("photo_idle");
    }
  }

  // File input change handler for the "unavailable" fallback path
  function handleFallbackFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCapturedFile(f);
    setCapturedPreview(URL.createObjectURL(f));
    setScanCandidates(null);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setCameraStatus("captured");
  }

  // ── [V1 HANDLERS] ──────────────────────────────────────────
  // function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  //   const f = e.target.files?.[0];
  //   if (!f) return;
  //   setFile(f);
  //   setPreview(URL.createObjectURL(f));
  //   setState({ step: "idle" });
  // }
  //
  // function handleReset() {
  //   setState({ step: "idle" });
  //   setPreview(null);
  //   setFile(null);
  //   setNoMatchResult(null);
  //   setNoMatchMethod(null);
  //   setScanCandidates(null);
  //   setSmartScanLoading(false);
  //   if (fileRef.current) fileRef.current.value = "";
  // }
  // ───────────────────────────────────────────────────────────

  async function handleQuickScan() {
    if (!capturedFile) return;
    setQuickScanLoading(true);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setCameraError("");
    setCameraStatus("scanning");
    try {
      const compressed = await compressImage(capturedFile, 800, 0.70);
      const result = await quickIdentifyCard(compressed);
      if (result.matched && result.card_id) {
        setScanContext(result.ocr?.name ?? result.name ?? "", result.confidence ?? null);
        router.push(`/cards/${result.card_id}`);
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
        setCameraStatus("captured");
      } else {
        setNoMatchResult(result);
        setNoMatchMethod("quick");
        setCameraStatus("captured");
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Quick Scan failed — please try again.");
      setCameraStatus("captured");
    } finally {
      setQuickScanLoading(false);
    }
  }

  async function handleSmartScan() {
    if (!capturedFile) return;
    setSmartScanLoading(true);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setCameraError("");
    setCameraStatus("scanning");
    try {
      const compressed = await compressImage(capturedFile, 800, 0.70);
      const result = await quickIdentifyCardV2(compressed);
      if (result.matched && result.card_id) {
        setScanContext(result.ocr?.name ?? result.name ?? "", result.confidence ?? null);
        router.push(`/cards/${result.card_id}`);
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
        setCameraStatus("captured");
      } else {
        setNoMatchResult(result);
        setNoMatchMethod("smart");
        setCameraStatus("captured");
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Smart Scan failed — please try again.");
      setCameraStatus("captured");
    } finally {
      setSmartScanLoading(false);
    }
  }

  async function handleV3Scan() {
    if (!capturedFile) return;
    setV3ScanLoading(true);
    setNoMatchResult(null);
    setNoMatchMethod(null);
    setScanCandidates(null);
    setCameraError("");
    setCameraStatus("scanning");
    try {
      const compressed = await compressImage(capturedFile, 800, 0.70);
      const result = await quickIdentifyCardV3(compressed);
      if (result.matched && result.card_id) {
        setScanContext(result.ocr?.name ?? result.name ?? "", result.confidence ?? null);
        router.push(`/cards/${result.card_id}`);
      } else if (result.ambiguous && result.candidates?.length) {
        setScanCandidates(result.candidates);
        setCameraStatus("captured");
      } else {
        setNoMatchResult(result);
        setNoMatchMethod("v3");
        setCameraStatus("captured");
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Quick Scan v3 failed — please try again.");
      setCameraStatus("captured");
    } finally {
      setV3ScanLoading(false);
    }
  }

  const isScanning = quickScanLoading || smartScanLoading || v3ScanLoading;

  // ── Shared JSX fragments ──────────────────────────────────

  // Mode toggle pill — shown in both photo_idle and QR viewfinder viewports
  const modeToggle = (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex rounded-full bg-black/60 p-0.5 backdrop-blur-sm">
      <button
        onClick={() => handleSetScanMode("photo")}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
          scanMode === "photo" ? "bg-white text-black" : "text-white/70"
        }`}
      >
        Photo
      </button>
      <button
        onClick={() => handleSetScanMode("qr")}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
          scanMode === "qr" ? "bg-white text-black" : "text-white/70"
        }`}
      >
        QR Code
      </button>
    </div>
  );

  // Corner brackets used in both guide overlays
  const cornerBrackets = (
    <>
      <span className="absolute top-0 left-0 block w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-sm" />
      <span className="absolute top-0 right-0 block w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-sm" />
      <span className="absolute bottom-0 left-0 block w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-sm" />
      <span className="absolute bottom-0 right-0 block w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-sm" />
    </>
  );

  // ── [V1 RETURN] ────────────────────────────────────────────
  // return (
  //   <main className="min-h-screen bg-background p-6 max-w-2xl mx-auto">
  //     <h1 className="text-2xl font-bold mb-6">Scan Card</h1>
  //     <Card className="mb-4">
  //       <CardContent className="pt-6">
  //         <input ref={fileRef} type="file" accept="image/*" capture="environment"
  //           onChange={handleFileChange} className="hidden" />
  //         <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
  //           {preview ? "Choose different photo" : "Take photo or choose file"}
  //         </Button>
  //         {preview && (
  //           <div className="mt-4 relative w-full aspect-[3/4] rounded-lg overflow-hidden border">
  //             <Image src={preview} alt="Card preview" fill sizes="100vw" className="object-contain" />
  //           </div>
  //         )}
  //       </CardContent>
  //     </Card>
  //     {file && state.step === "idle" && (
  //       <div className="flex gap-2 mb-4">
  //         <Button variant="secondary" className="flex-1" onClick={handleQuickScan} disabled={quickScanLoading}>
  //           {quickScanLoading ? "Scanning..." : "Quick Scan"}
  //         </Button>
  //         <Button className="flex-1" onClick={handleSmartScan} disabled={smartScanLoading}>
  //           {smartScanLoading ? "Scanning..." : "Smart Scan (v2)"}
  //         </Button>
  //       </div>
  //     )}
  //     {/* ambiguous candidates, no-match feedback, and error card were also here */}
  //   </main>
  // );
  // ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col bg-background">

      {/* ── PHOTO MODE IDLE ────────────────────────────────── */}
      {cameraStatus === "photo_idle" && (
        <div className="flex flex-col items-center gap-6 p-8 flex-1">
          {/* Mode toggle — inline (not absolute) in this simple layout */}
          <div className="flex rounded-full bg-muted p-0.5">
            <button
              onClick={() => handleSetScanMode("photo")}
              className="px-4 py-1.5 rounded-full text-sm font-medium bg-background shadow text-foreground"
            >
              Photo
            </button>
            <button
              onClick={() => handleSetScanMode("qr")}
              className="px-4 py-1.5 rounded-full text-sm font-medium text-muted-foreground"
            >
              QR Code
            </button>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCapture}
            className="hidden"
          />
          <Button
            onClick={() => photoInputRef.current?.click()}
            className="w-full max-w-xs"
          >
            Open camera to take photo
          </Button>
        </div>
      )}

      {/* ── QR VIEWFINDER (requesting + live) ──────────────── */}
      {(cameraStatus === "requesting" || cameraStatus === "live") && (
        <>
          <div
            className="relative w-full bg-black overflow-hidden"
            style={{ aspectRatio: "3/4", maxHeight: "65vh" }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {modeToggle}

            {/* Square guide for QR code sticker */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="relative"
                style={{
                  width: "55%",
                  aspectRatio: "1/1",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
              >
                {cornerBrackets}
              </div>
            </div>

            <p className="absolute bottom-4 inset-x-0 text-center text-white/90 text-sm drop-shadow">
              Point at the cert QR code on the slab
            </p>

            {/* "Opening camera…" overlay while getUserMedia resolves */}
            {cameraStatus === "requesting" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <p className="text-white/80 text-sm">Opening camera…</p>
              </div>
            )}
          </div>

          {/* Scanning indicator */}
          <div className="flex flex-col items-center justify-center py-4 bg-black gap-2">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              <p className="text-sm text-white/70">
                {cameraStatus === "live" ? "Scanning for QR code…" : "Opening camera…"}
              </p>
            </div>
            <p className="text-xs text-white/40">PSA graded cards only</p>
          </div>
        </>
      )}

      {/* ── CERT LOOKUP (QR detected, fetching card) ──────── */}
      {cameraStatus === "cert_lookup" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 gap-4 text-center">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-white/80">QR code detected — looking up card…</p>
        </div>
      )}

      {/* ── CAPTURED / SCANNING ────────────────────────────── */}
      {(cameraStatus === "captured" || cameraStatus === "scanning") && (
        <div className="flex flex-col gap-4 p-4">
          {/* Photo preview — present in photo mode, absent for QR no-match */}
          {capturedPreview && (
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
                  <p className="text-white text-sm font-medium tracking-wide">Scanning…</p>
                </div>
              )}
            </div>
          )}

          {/* Scan buttons — shown when we have a photo to scan */}
          {cameraStatus === "captured" && !scanCandidates && capturedFile && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleQuickScan}
                disabled={isScanning}
              >
                {quickScanLoading ? "Scanning…" : "Quick Scan"}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleSmartScan}
                disabled={isScanning}
              >
                {smartScanLoading ? "Scanning…" : "Quick Scan v2"}
              </Button>
              <Button
                className="flex-1"
                onClick={handleV3Scan}
                disabled={isScanning}
              >
                {v3ScanLoading ? "Scanning…" : "Quick Scan v3"}
              </Button>
            </div>
          )}

          {/* Ambiguous — let user pick the right card */}
          {scanCandidates && scanCandidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Multiple matches — which card is this?</p>
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
                      <div className="text-xs text-muted-foreground">
                        {c.set_name}{c.card_num ? ` · #${c.card_num}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.language_code === "JA" ? "Japanese" : "English"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No match feedback */}
          {noMatchResult && !noMatchResult.matched && (
            <div className="rounded-lg border border-muted p-4 space-y-1">
              <p className="text-sm font-medium">
                {noMatchMethod === "v3"
                  ? "Quick Scan v3"
                  : noMatchMethod === "smart"
                  ? "Quick Scan v2"
                  : noMatchMethod === "qr"
                  ? "QR Cert Lookup"
                  : "Quick Scan"}{" "}
                — no match found
              </p>
              {noMatchResult.ocr.name && (
                <p className="text-xs text-muted-foreground">
                  OCR: &ldquo;{noMatchResult.ocr.name}&rdquo;
                  {noMatchResult.ocr.set_number ? ` · ${noMatchResult.ocr.set_number}` : ""}
                </p>
              )}
              {(noMatchResult.ocr.ocr_num1 || noMatchResult.ocr.ocr_num2) && (
                <p className="text-xs text-muted-foreground">
                  Numbers: num1={noMatchResult.ocr.ocr_num1 ?? "—"} · num2={noMatchResult.ocr.ocr_num2 ?? "—"}
                </p>
              )}
              {(noMatchMethod === "quick" || noMatchMethod === "smart") && (
                <p className="text-xs text-muted-foreground">
                  Try &ldquo;Quick Scan v3&rdquo; for better identification.
                </p>
              )}
            </div>
          )}

          {/* Scan/camera error */}
          {cameraError && (
            <p className="text-sm text-destructive">{cameraError}</p>
          )}

          {/* Retake — returns to photo_idle or restarts QR viewfinder */}
          <Button variant="outline" onClick={resetScan} className="w-full">
            {scanMode === "qr" ? "Scan again" : "Retake photo"}
          </Button>
        </div>
      )}

      {/* ── PERMISSION DENIED (QR mode) ────────────────────── */}
      {cameraStatus === "denied" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 gap-4 text-center">
          <Camera className="w-12 h-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Camera access was denied. Allow camera access in your browser settings and try again.
          </p>
          <Button variant="outline" onClick={startCamera}>Try again</Button>
        </div>
      )}

      {/* ── UNAVAILABLE — file input fallback (QR mode) ────── */}
      {/* getUserMedia not supported (older browser/WebView). Falls back to the
          V1 file-input approach: OS camera or file picker, then same scan flow. */}
      {cameraStatus === "unavailable" && (
        <div className="flex flex-col gap-4 p-6 max-w-2xl mx-auto w-full">
          <p className="text-sm text-muted-foreground text-center">
            Live camera isn&apos;t available in this browser. Use the file picker instead.
          </p>
          <input
            ref={fallbackFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFallbackFileChange}
            className="hidden"
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fallbackFileRef.current?.click()}
          >
            Take photo or choose file
          </Button>
        </div>
      )}

      {/* ── CAMERA ERROR (QR mode) ─────────────────────────── */}
      {cameraStatus === "error" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 gap-4 text-center">
          <Camera className="w-12 h-12 text-muted-foreground" />
          <p className="text-sm text-destructive">{cameraError || "Camera error — please try again."}</p>
          <Button variant="outline" onClick={startCamera}>Try again</Button>
        </div>
      )}

      {/* ── DAILY LIMIT POPUP ──────────────────────────────── */}
      {dailyLimitReached && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-xs flex flex-col gap-4 text-center">
            <p className="text-base font-semibold">Daily Request Limit Reached</p>
            <p className="text-sm text-muted-foreground">
              The PSA cert lookup limit of 100 requests per day has been reached. Try again after midnight UTC.
            </p>
            <Button onClick={() => setDailyLimitReached(false)}>OK</Button>
          </div>
        </div>
      )}
    </div>
  );
}
