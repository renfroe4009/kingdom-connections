import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';

// Shared camera-based QR scanner used by both the staff check-in page
// (EventCheckIn.jsx) and the public PIN-link scanner (EventCheckinScanner.jsx)
// — one scanning UI, two auth paths call the same onScan(token) callback.
// Falls back to manual token entry when the camera isn't available/allowed
// (older phones, denied permission, desktop testing).
export default function TicketScanner({ onScan, disabled = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastScanRef = useRef({ token: null, at: 0 });
  const [cameraError, setCameraError] = useState('');
  const [manualToken, setManualToken] = useState('');

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        const now = Date.now();
        // Ignore the same code re-scanned within 3s (camera still pointed at
        // it) — real re-scans of a *different* ticket always get through.
        const isRepeat = lastScanRef.current.token === code.data && (now - lastScanRef.current.at) < 3000;
        if (!isRepeat && !disabled) {
          lastScanRef.current = { token: code.data, at: now };
          onScan(code.data);
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onScan, disabled]);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia?.({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => setCameraError('Camera unavailable — use manual entry below.'));

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [tick]);

  function submitManual(e) {
    e.preventDefault();
    const token = manualToken.trim();
    if (token) onScan(token);
    setManualToken('');
  }

  return (
    <div>
      {!cameraError && (
        <div style={{ position: 'relative', width: '100%', maxWidth: 420, margin: '0 auto', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', display: 'block' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(255,255,255,0.6)', margin: 40, borderRadius: 12, pointerEvents: 'none' }} />
        </div>
      )}
      {cameraError && <div className="alert alert-warning small">{cameraError}</div>}
      <form onSubmit={submitManual} className="d-flex gap-2 mt-3" style={{ maxWidth: 420, margin: '0.75rem auto 0' }}>
        <input
          className="form-control"
          placeholder="Or type/paste ticket code"
          value={manualToken}
          onChange={e => setManualToken(e.target.value)}
          disabled={disabled}
        />
        <button className="btn btn-outline-secondary" type="submit" disabled={disabled || !manualToken.trim()}>Check</button>
      </form>
    </div>
  );
}
