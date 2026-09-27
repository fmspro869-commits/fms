// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// usePosition — główny hook do pozycjonowania
// Field Pilot używa WYŁĄCZNIE tego hooka — nie bezpośrednio useGps

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PositionData, GNSSStatus, PositionSource } from './PositionData';
import { getPhoneProvider, getDemoProvider, getExternalProvider, type PositionProvider } from './PositionProvider';

export type ActiveSource = 'AUTO' | PositionSource;

interface UsePositionOptions {
  enabled: boolean;
  preferredSource?: ActiveSource;
}

interface UsePositionReturn {
  position: PositionData | null;
  status: GNSSStatus;
  source: PositionSource;
  isDemo: boolean;
  error: string | null;
  retry: () => void;
  // Provider access dla specyficznych operacji (np. demo.startSimulation)
  demoProvider: ReturnType<typeof getDemoProvider> | null;
  externalProvider: ReturnType<typeof getExternalProvider> | null;
}

const DEFAULT_STATUS: GNSSStatus = {
  fixType: 'NONE',
  signalQuality: 'none',
  correctionStatus: 'NONE',
  correctionAge: null,
  source: 'PHONE',
  isDemo: false,
};

export function usePosition({ enabled, preferredSource = 'AUTO' }: UsePositionOptions): UsePositionReturn {
  const [position, setPosition] = useState<PositionData | null>(null);
  const [status, setStatus] = useState<GNSSStatus>(DEFAULT_STATUS);
  const [error, setError] = useState<string | null>(null);

  const unsubPosRef = useRef<(() => void) | null>(null);
  const unsubStatusRef = useRef<(() => void) | null>(null);
  const cleanup = useCallback(() => {
    unsubPosRef.current?.();
    unsubStatusRef.current?.();
    unsubPosRef.current = null;
    unsubStatusRef.current = null;
  }, []);

  const switchToProvider = useCallback((source: PositionSource) => {
    cleanup();

    let provider: PositionProvider;
    switch (source) {
      case 'PHONE':
        provider = getPhoneProvider();
        break;
      case 'EXTERNAL_GNSS':
        provider = getExternalProvider();
        break;
      case 'DEMO':
        provider = getDemoProvider();
        break;
      default:
        provider = getPhoneProvider();
    }

    unsubPosRef.current = provider.subscribe((pos) => {
      setPosition(pos);
      setError(null);
    });

    unsubStatusRef.current = provider.subscribeStatus((s) => {
      setStatus(s);
      setError(provider.getError?.() ?? null);
    });

    provider.start();
  }, [cleanup]);

  const retry = useCallback(() => {
    if (!enabled) return;
    const source = preferredSource === 'AUTO'
      ? getExternalProvider().isAvailable ? 'EXTERNAL_GNSS' : 'PHONE'
      : preferredSource;
    const provider = source === 'PHONE'
      ? getPhoneProvider()
      : source === 'EXTERNAL_GNSS'
        ? getExternalProvider()
        : getDemoProvider();
    provider.stop();
    setPosition(null);
    setError(null);
    switchToProvider(source);
  }, [enabled, preferredSource, switchToProvider]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      setPosition(null);
      setStatus(DEFAULT_STATUS);
      setError(null);
      return;
    }

    if (preferredSource === 'AUTO') {
      // AUTO: preferuj zewnętrzny GNSS jeśli podłączony, inaczej telefon
      const ext = getExternalProvider();
      if (ext.isAvailable) {
        switchToProvider('EXTERNAL_GNSS');
      } else {
        switchToProvider('PHONE');
      }
    } else {
      switchToProvider(preferredSource);
    }

    return cleanup;
  }, [enabled, preferredSource, switchToProvider, cleanup]);

  return {
    position,
    status,
    source: status.source,
    isDemo: status.isDemo,
    error,
    retry,
    demoProvider: getDemoProvider(),
    externalProvider: getExternalProvider(),
  };
}

// ============================================
// HOOK DLA DEMO — wygodny dostęp do symulacji
// ============================================

export function useDemoPosition(enabled: boolean) {
  return usePosition({ enabled, preferredSource: 'DEMO' });
}

// ============================================
// HOOK DLA ZEWNĘTRZNEGO GNSS
// ============================================

export function useExternalPosition(enabled: boolean) {
  return usePosition({ enabled, preferredSource: 'EXTERNAL_GNSS' });
}
