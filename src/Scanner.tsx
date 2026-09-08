import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Props = { onScan: (text: string) => void; paused: boolean };

export function Scanner({ onScan, paused }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let stream: MediaStream | null = null;
    let raf = 0;
    let last = "";
    let lastAt = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current || video.readyState < video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (!code?.data) return;
      const now = Date.now();
      if (code.data === last && now - lastAt < 3000) return; // same code, ignore repeats
      last = code.data;
      lastAt = now;
      onScanRef.current(code.data);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        raf = requestAnimationFrame(tick);
      })
      .catch((e: Error) => setError(e.message));

    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={videoRef} muted playsInline />
      {error && <p className="err">Camera: {error}</p>}
      {paused && <div className="overlay">Paused</div>}
    </div>
  );
}
