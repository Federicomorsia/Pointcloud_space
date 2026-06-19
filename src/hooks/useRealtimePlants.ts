import { useEffect, useRef, useState } from 'react';
import { LOCAL_MODEL_FILES, resolveLocalModelUrl } from '../config/modelRegistry';
import { hasSupabaseConfig, supabaseClient } from '../lib/supabaseClient';
import type { EngineNotice } from './usePointcloudEngine';

const BLOOM_DURATION_MS = 6500;

type QrScanEvent = {
  id?: string;
  qr_code?: string;
  model_key?: string | null;
  model_url?: string | null;
  scanned_by?: string | null;
  source?: string;
  created_at?: string;
};

function normalizeProfileId(profileId?: string | null): string | null {
  const normalized = profileId?.trim().toLowerCase();
  return normalized || null;
}

function getPlantProfileId(event: QrScanEvent): string | null {
  return normalizeProfileId(event.scanned_by);
}

function getBloomProfileId(event: QrScanEvent): string | null {
  return normalizeProfileId(event.scanned_by ?? event.qr_code);
}

export type RealtimePlant = {
  eventId: string;
  modelKey: string;
  modelUrl: string;
  modelId: string;
  userId: string | null;
  qrCode: string | null;
  createdAt: string | null;
};

interface UseRealtimePlantsArgs {
  isReady: boolean;
  onAddUrl: (url: string, animationDuration?: number) => Promise<string | null>;
  onTriggerBloom: (modelIds: string[], durationMs?: number) => boolean;
  onNotice: (notice: EngineNotice | null) => void;
}

export function useRealtimePlants({
  isReady,
  onAddUrl,
  onTriggerBloom,
  onNotice
}: UseRealtimePlantsArgs) {
  const loadedEventIdsRef = useRef(new Set<string>());
  const plantsByUserIdRef = useRef(new Map<string, string[]>());
  const plantLoadQueueRef = useRef(Promise.resolve());
  const [plants, setPlants] = useState<RealtimePlant[]>([]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      console.info('[Piantala realtime] Supabase env non configurate.');
    }
  }, []);

  useEffect(() => {
    if (!isReady || !hasSupabaseConfig || !supabaseClient) {
      return;
    }

    const client = supabaseClient;

    const handlePlantEvent = async (event: QrScanEvent, eventId: string) => {
      if (loadedEventIdsRef.current.has(eventId)) {
        return;
      }

      const modelUrl = resolveLocalModelUrl(event.model_key, event.model_url);
      console.info('[Piantala realtime] Evento ricevuto', {
        eventId,
        qrCode: event.qr_code,
        modelKey: event.model_key,
        modelUrl,
        userId: getPlantProfileId(event),
        scannedBy: event.scanned_by,
        localModels: LOCAL_MODEL_FILES
      });

      if (!modelUrl) {
        onNotice({
          type: 'error',
          text: `Modello realtime non trovato per QR ${event.qr_code ?? '-'}`
        });
        return;
      }

      loadedEventIdsRef.current.add(eventId);
      let modelId: string | null = null;
      try {
        modelId = await onAddUrl(modelUrl, 600);
        if (!modelId) {
          return;
        }

        const userId = getPlantProfileId(event);
        if (userId) {
          const userPlants = plantsByUserIdRef.current.get(userId) ?? [];
          plantsByUserIdRef.current.set(userId, [...userPlants, modelId]);
        }

        console.info('[Piantala realtime] Modello caricato', {
          eventId,
          modelId,
          modelUrl,
          userId,
          scannedBy: event.scanned_by,
          linkedPlantsByUser: Object.fromEntries(plantsByUserIdRef.current.entries())
        });
      } catch (error) {
        console.error('[Piantala realtime] Caricamento modello fallito', {
          eventId,
          modelUrl,
          error
        });
        loadedEventIdsRef.current.delete(eventId);
        return;
      }

      setPlants((current) => [
        ...current,
        {
          eventId,
          modelKey: event.model_key ?? '',
          modelUrl,
          modelId,
          userId: getPlantProfileId(event),
          qrCode: event.qr_code ?? null,
          createdAt: event.created_at ?? null
        }
      ]);
    };

    const enqueuePlantEvent = (event: QrScanEvent, eventId: string) => {
      const next = plantLoadQueueRef.current.then(() => handlePlantEvent(event, eventId));
      plantLoadQueueRef.current = next.catch(() => undefined);
      return next;
    };

    const handleScanEvent = async (event: QrScanEvent) => {
      const eventId = event.id ?? `${event.qr_code ?? 'qr'}-${event.created_at ?? Date.now()}`;

      if (event.source === 'garden-bloom-scanner') {
        const userId = getBloomProfileId(event);
        if (!userId) {
          onNotice({
            type: 'error',
            text: 'QR letto, ma manca scanned_by per associare il bloom.'
          });
          return;
        }

        await plantLoadQueueRef.current;
        const modelIds = plantsByUserIdRef.current.get(userId) ?? [];
        console.info('[Piantala realtime] Bloom richiesto', {
          userId,
          modelIds,
          knownUsers: Array.from(plantsByUserIdRef.current.keys())
        });
        onTriggerBloom(modelIds, BLOOM_DURATION_MS);
        return;
      }

      await enqueuePlantEvent(event, eventId);
    };

    client
      .from('qr_scan_events')
      .select('id,qr_code,model_key,model_url,scanned_by,source,created_at')
      .or('source.is.null,source.neq.garden-bloom-scanner')
      .order('created_at', { ascending: false })
      .limit(80)
      .then(async ({ data, error }) => {
        if (error) {
          console.error('[Piantala realtime] Errore caricamento eventi iniziali', error);
          return;
        }

        for (const event of data?.reverse() ?? []) {
          await handleScanEvent(event as QrScanEvent);
        }
      });

    const channel = client
      .channel('piantala-qr-scan-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'qr_scan_events'
        },
        async (payload) => {
          await handleScanEvent(payload.new as QrScanEvent);
        }
      )
      .subscribe((status) => {
        console.info('[Piantala realtime] Stato canale', status);
        if (status === 'SUBSCRIBED') {
          onNotice({ type: 'info', text: 'Realtime Supabase attivo.' });
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [isReady, onAddUrl, onNotice, onTriggerBloom]);

  return {
    plants,
    isRealtimeEnabled: hasSupabaseConfig
  };
}
