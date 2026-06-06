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
import jsQR from "jsqr";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import {
  quickIdentifyCard,
  quickIdentifyCardV2,
  lookupCertCard,
  type QuickScanResult,
  type ScanCandidate,
} from "@/lib/api";
import { useScanContext } from "@/lib/stores/useScanContext";

// Resize + compress an image client-side before upload.
// Quick Scan OCR: 1200px, 0.70 — text is readable at lower quality
// Smart Scan v2:  1200px, 0.80
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

// V2 camera lifecycle states
type CameraStatus =
  | "requesting"   // getUserMedia in progress
  | "live"         // stream active, viewfinder shown
  | "captured"     // frame grabbed, preview shown, ready to scan
  | "scanning"     // OCR/Claude scan API call in progress
  | "cert_lookup"  // QR cert number detected, fetching card from PSA/BGS/CGC
  | "denied"       // camera permission denied by user
  | "unavailable"  // getUserMedia not supported — fall back to file input
  | "error";       // unexpected camera error

export default function ScanPage() {
  const router = useRouter();

  // ── V2 camera refs + state ────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("requesting");
  const [cameraError, setCameraError] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  // ── QR scanning refs ──────────────────────────────────────
  // qrIntervalRef: polls the live video frame every 300ms with jsQR
  // certLookupInProgressRef: guard to prevent firing multiple lookups from consecutive QR detections
  // qrCanvasRef: offscreen canvas reused across QR scan frames (avoids re-allocation)
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const certLookupInProgressRef = useRef(false);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── [V1 STATE] ─────────────────────────────────────────────
  // const fileRef = useRef<HTMLInputElement>(null);
  // const [preview, setPreview] = useState<string | null>(null);
  // const [file, setFile] = useState<File | null>(null);
  // const [state, setState] = useState<ScanState>({ step: "idle" });
  // ───────────────────────────────────────────────────────────

  // Fallback file input for "unavailable" (getUserMedia not in browser)
  const fallbackFileRef = useRef<HTMLInputElement>(null);

  // Scan result state — shared between V1 and V2
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [smartScanLoading, setSmartScanLoading] = useState(false);
  const [noMatchResult, setNoMatchResult] = useState<QuickScanResult | null>(null);
  const [noMatchMethod, setNoMatchMethod] = useState<"quick" | "smart" | "qr" | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[] | null>(null);

  const { setScanContext } = useScanContext();

  // Auth guard (AppShell also redirects, this is belt-and-suspenders)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, [router]);

  // Start the rear camera stream
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
      setCameraStatus("live"); // triggers the wire-up effect below
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

  // Mount: start camera; unmount: stop all tracks
  useEffect(() => {
    startCamera();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [startCamera]);

  // Wire stream → video element after "live" transition (ensures DOM is ready)
  useEffect(() => {
    if (cameraStatus === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {/* muted autoplay blocked — unlikely */});
    }
  }, [cameraStatus]);

  // QR cert detection — polls every 300ms while the camera is live.
  // Scans the full video frame (not just the guide region) because the QR code
  // on a graded slab is typically near the bottom/back, not centred.
  useEffect(() => {
    if (cameraStatus !== "live") return;

    if (!qrCanvasRef.current) {
      qrCanvasRef.current = document.createElement("canvas");
    }

    qrIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || certLookupInProgressRef.current) return;

      const canvas = qrCanvasRef.current!;
      // Downscale to max 640px wide for jsQR performance; QR codes read fine at this res
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code?.data) {
        const certInfo = parseCertUrl(code.data);
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
  }, [cameraStatus]);

  // Parse a QR code URL to extract a cert number + grading company.
  // PSA: https://www.psacard.com/cert/{certNumber} or .../cert/{certNumber}/psa
  // Returns null for non-cert QR codes (e.g. generic URLs, WiFi QRs, etc.)
  function parseCertUrl(url: string): { certNumber: string; company: string } | null {
    const psaMatch = url.match(/psacard\.com\/cert\/(\d+)/i);
    if (psaMatch) return { certNumber: psaMatch[1], company: "psa" };
    // BGS and CGC support can be added here when their QR URL patterns are confirmed
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
      setCameraError(
        err instanceof Error ? err.message : "QR cert lookup failed — please try again."
      );
      certLookupInProgressRef.current = false;
      startCamera();
    }
  }

  // Grab a single frame from the video, cropped to exactly the guide rectangle.
  //
  // The video uses object-cover inside its container, so the native frame is
  // larger than what's displayed — we must reverse that transform to find which
  // native pixels sit behind the guide box before cropping.
  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const V_w = video.videoWidth;
    const V_h = video.videoHeight;

    // Rendered size of the video element (same as the container with object-cover)
    const { width: C_w, height: C_h } = video.getBoundingClientRect();

    // object-cover scale: the larger factor fills the container; the other axis overflows
    const s = Math.max(C_w / V_w, C_h / V_h);
    // How many display-pixels the scaled video is offset from the container edge
    // (negative = the video extends beyond the container on that axis)
    const offset_x = (C_w - V_w * s) / 2;
    const offset_y = (C_h - V_h * s) / 2;

    // Guide rectangle in display coords — must exactly match the CSS values
    const gw = 0.62 * C_w;       // width: "62%"
    const gh = gw * (7 / 5);     // aspectRatio: "5/7"  → h = w * 7/5
    const g_x = (C_w - gw) / 2;  // centered horizontally
    const g_y = (C_h - gh) / 2;  // centered vertically

    // Map guide rectangle to native video pixel coordinates
    const crop_x = Math.round((g_x - offset_x) / s);
    const crop_y = Math.round((g_y - offset_y) / s);
    const crop_w = Math.round(gw / s);
    const crop_h = Math.round(gh / s);

    // Clamp to video bounds
    const sx = Math.max(0, crop_x);
    const sy = Math.max(0, crop_y);
    const sw = Math.min(crop_w, V_w - sx);
    const sh = Math.min(crop_h, V_h - sy);

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    // Stop stream to save battery while user decides on scan method
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

  // Reset all state and restart the camera viewfinder
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
    startCamera();
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
      const compressed = await compressImage(capturedFile, 1200, 0.70);
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
      const compressed = await compressImage(capturedFile, 1200, 0.80);
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

  const isScanning = quickScanLoading || smartScanLoading;

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

      {/* ── VIEWFINDER (requesting + live) ─────────────────── */}
      {(cameraStatus === "requesting" || cameraStatus === "live") && (
        <>
          {/* Camera viewport — 3:4 aspect, capped so it fits on small screens */}
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

            {/* Semi-transparent overlay with card-shaped cutout.
                The box-shadow extends outside the guide div, masked by
                overflow-hidden on the parent → dark surround, clear centre. */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="relative"
                style={{
                  width: "62%",
                  aspectRatio: "5/7",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
              >
                {/* Corner bracket — top left */}
                <span className="absolute top-0 left-0 block w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-sm" />
                {/* Corner bracket — top right */}
                <span className="absolute top-0 right-0 block w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-sm" />
                {/* Corner bracket — bottom left */}
                <span className="absolute bottom-0 left-0 block w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-sm" />
                {/* Corner bracket — bottom right */}
                <span className="absolute bottom-0 right-0 block w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-sm" />
              </div>
            </div>

            {/* Instruction hint */}
            <p className="absolute bottom-4 inset-x-0 text-center text-white/90 text-sm drop-shadow">
              Line up the card — or scan the cert QR code on the slab
            </p>

            {/* "Opening camera…" overlay while getUserMedia resolves */}
            {cameraStatus === "requesting" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <p className="text-white/80 text-sm">Opening camera…</p>
              </div>
            )}
          </div>

          {/* Shutter button */}
          <div className="flex items-center justify-center py-6 bg-black">
            <button
              onClick={captureFrame}
              disabled={cameraStatus !== "live"}
              aria-label="Capture photo"
              className="w-16 h-16 rounded-full bg-white border-4 border-primary shadow-lg disabled:opacity-40 active:scale-95 transition-transform"
            />
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
      {(cameraStatus === "captured" || cameraStatus === "scanning") && capturedPreview && (
        <div className="flex flex-col gap-4 p-4">
          {/* Captured frame preview */}
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

          {/* Scan buttons — hidden while a scan is running */}
          {cameraStatus === "captured" && !scanCandidates && (
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
                className="flex-1"
                onClick={handleSmartScan}
                disabled={isScanning}
              >
                {smartScanLoading ? "Scanning…" : "Smart Scan (v2)"}
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
                {noMatchMethod === "smart"
                  ? "Smart Scan (v2)"
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
              {noMatchMethod === "quick" && (
                <p className="text-xs text-muted-foreground">
                  Try &ldquo;Smart Scan (v2)&rdquo; for better identification.
                </p>
              )}
            </div>
          )}

          {/* Scan/camera error */}
          {cameraError && (
            <p className="text-sm text-destructive">{cameraError}</p>
          )}

          {/* Retake — restarts the live viewfinder */}
          <Button variant="outline" onClick={resetScan} className="w-full">
            Retake photo
          </Button>
        </div>
      )}

      {/* ── PERMISSION DENIED ──────────────────────────────── */}
      {cameraStatus === "denied" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 gap-4 text-center">
          <Camera className="w-12 h-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Camera access was denied. Allow camera access in your browser settings and try again.
          </p>
          <Button variant="outline" onClick={startCamera}>Try again</Button>
        </div>
      )}

      {/* ── UNAVAILABLE — file input fallback ──────────────── */}
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

      {/* ── CAMERA ERROR ───────────────────────────────────── */}
      {cameraStatus === "error" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 gap-4 text-center">
          <Camera className="w-12 h-12 text-muted-foreground" />
          <p className="text-sm text-destructive">{cameraError || "Camera error — please try again."}</p>
          <Button variant="outline" onClick={startCamera}>Try again</Button>
        </div>
      )}
    </div>
  );
}
