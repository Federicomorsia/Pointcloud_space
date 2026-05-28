import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig, supabaseClient } from '../lib/supabaseClient';

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

type ParsedQrPayload = {
  raw: string;
  userId: string | null;
  ticketToken: string | null;
  qrCode: string | null;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const SCAN_REPEAT_WINDOW_MS = 4200;

function cleanValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseQrPayload(rawValue: string): ParsedQrPayload {
  const raw = rawValue.trim();
  const fallback: ParsedQrPayload = {
    raw,
    userId: null,
    ticketToken: raw || null,
    qrCode: raw || null
  };

  if (!raw) {
    return fallback;
  }

  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const userId = cleanValue(
      String(json.user_id ?? json.userId ?? json.scanned_by ?? '')
    );
    const ticketToken = cleanValue(
      String(json.ticket_token ?? json.ticketToken ?? json.token ?? json.code ?? '')
    );
    const qrCode = cleanValue(String(json.qr_code ?? json.qrCode ?? raw));

    return {
      raw,
      userId,
      ticketToken: ticketToken ?? qrCode ?? raw,
      qrCode
    };
  } catch {
    // Non JSON: continua con URL o testo semplice.
  }

  try {
    const url = new URL(raw);
    const params = url.searchParams;
    const userId = cleanValue(
      params.get('user_id') ??
        params.get('userId') ??
        params.get('uid') ??
        params.get('scanned_by')
    );
    const ticketToken = cleanValue(
      params.get('ticket_token') ?? params.get('ticketToken') ?? params.get('token')
    );
    const qrCode = cleanValue(params.get('qr_code') ?? params.get('code') ?? raw);

    return {
      raw,
      userId,
      ticketToken: ticketToken ?? qrCode ?? raw,
      qrCode
    };
  } catch {
    // Non URL: gestisci prefissi testuali.
  }

  const keyValueMatch = raw.match(/^(user_id|user|uid|scanned_by)[:=](.+)$/i);
  if (keyValueMatch) {
    const userId = cleanValue(keyValueMatch[2]);
    return {
      raw,
      userId,
      ticketToken: raw,
      qrCode: raw
    };
  }

  const uuidMatch = raw.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );

  return {
    ...fallback,
    userId: uuidMatch ? raw : null
  };
}

export function QrScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const [manualValue, setManualValue] = useState('');
  const [status, setStatus] = useState('Pronto a leggere un QR.');
  const [isScanning, setIsScanning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [lastPayload, setLastPayload] = useState<ParsedQrPayload | null>(null);

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsScanning(false);
  }, []);

  const submitScan = useCallback(async (rawCode: string) => {
    const payload = parseQrPayload(rawCode);
    setLastPayload(payload);

    if (!payload.raw) {
      setStatus('Codice vuoto.');
      return;
    }

    if (!payload.userId) {
      setStatus('QR letto, ma manca user_id. Inserisci un QR con user_id o UUID.');
      return;
    }

    if (!hasSupabaseConfig || !supabaseClient) {
      setStatus('Supabase non configurato: aggiungi VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setIsSending(true);
    const { error } = await supabaseClient.from('qr_scan_events').insert({
      scanned_by: payload.userId,
      qr_code: payload.qrCode ?? payload.ticketToken ?? payload.raw,
      model_key: '__bloom__',
      model_url: '__bloom__',
      source: 'garden-bloom-scanner'
    });

    setIsSending(false);

    if (error) {
      setStatus(`Errore Supabase: ${error.message}`);
      return;
    }

    setStatus(`Bloom inviato per user_id ${payload.userId}.`);
  }, []);

  const startCamera = useCallback(async () => {
    if (!window.BarcodeDetector) {
      setStatus('Scanner camera non supportato da questo browser. Usa inserimento manuale.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      setIsScanning(true);
      setStatus('Scanner attivo.');

      const scanFrame = async () => {
        const video = videoRef.current;

        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const codes = await detector.detect(video);
          const rawCode = codes[0]?.rawValue?.trim();

          if (rawCode) {
            const now = Date.now();
            const lastScan = lastScanRef.current;
            const isRepeated =
              lastScan?.value === rawCode && now - lastScan.at < SCAN_REPEAT_WINDOW_MS;

            if (!isRepeated) {
              lastScanRef.current = { value: rawCode, at: now };
              void submitScan(rawCode);
            }
          }
        }

        frameRef.current = requestAnimationFrame(scanFrame);
      };

      frameRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Permesso camera non disponibile.';
      setStatus(message);
      stopCamera();
    }
  }, [stopCamera, submitScan]);

  useEffect(() => stopCamera, [stopCamera]);

  const handleManualSubmit = () => {
    void submitScan(manualValue);
  };

  return (
    <main className="qr-page">
      <section className="qr-shell" aria-label="Lettore QR Giardino collettivo">
        <header className="qr-header">
          <a href="/" className="qr-back">Giardino</a>
          <div>
            <h1>QR Bloom</h1>
            <p>Leggi il biglietto e attiva il bloom sulle piante dell'utente.</p>
          </div>
        </header>

        <div className="qr-camera">
          <video ref={videoRef} playsInline muted />
          {!isScanning && <div className="qr-camera-placeholder">QR</div>}
        </div>

        <div className="qr-actions">
          <button type="button" onClick={startCamera} disabled={isScanning || isSending}>
            Avvia camera
          </button>
          <button type="button" onClick={stopCamera} disabled={!isScanning}>
            Stop
          </button>
        </div>

        <label className="qr-manual">
          <span>Codice manuale</span>
          <textarea
            value={manualValue}
            onChange={(event) => setManualValue(event.currentTarget.value)}
            placeholder="user_id:..."
            rows={4}
          />
        </label>

        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={!manualValue.trim() || isSending}
        >
          Invia bloom
        </button>

        <div className="qr-status" role="status" aria-live="polite">
          <span>{status}</span>
          {lastPayload && (
            <small>
              Ultimo QR: {lastPayload.userId ?? lastPayload.ticketToken ?? lastPayload.raw}
            </small>
          )}
        </div>
      </section>
    </main>
  );
}
