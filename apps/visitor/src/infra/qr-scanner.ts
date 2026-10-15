/**
 * In-app QR scanning with the browser's built-in BarcodeDetector (Chrome on Android).
 * Loaded on demand so it never weighs on the app shell. Where unsupported (iPhone Safari),
 * visitors scan with their normal camera app — the sticker's link reopens this app.
 */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** Opens the camera inside `container`; resolves with the QR content, or null if cancelled. */
export async function scanQr(container: HTMLElement, signal: AbortSignal): Promise<string | null> {
  const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
  const detector = new Detector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  });
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  container.appendChild(video);
  await video.play();

  try {
    while (!signal.aborted) {
      const codes = await detector.detect(video).catch(() => []);
      const value = codes[0]?.rawValue;
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.remove();
  }
}
