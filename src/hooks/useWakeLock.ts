import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (t: string, cb: () => void) => void;
}

/** Screen Wake Lock API — utrzymuje ekran włączony. Brak wsparcia = ciche pominięcie. */
export function useWakeLock() {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [active, setActive] = useState(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const wantRef = useRef(false);

  const acquire = useCallback(async () => {
    if (!supported) return;
    try {
      const s = (await (navigator as unknown as {
        wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
      }).wakeLock.request('screen'));
      sentinel.current = s;
      setActive(true);
      s.addEventListener('release', () => setActive(false));
    } catch {
      setActive(false);
    }
  }, [supported]);

  const enable = useCallback(async () => {
    wantRef.current = true;
    await acquire();
  }, [acquire]);

  const disable = useCallback(async () => {
    wantRef.current = false;
    try {
      await sentinel.current?.release();
    } catch {
      /* ignore */
    }
    sentinel.current = null;
    setActive(false);
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && wantRef.current && !sentinel.current) acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      try {
        sentinel.current?.release();
      } catch {
        /* ignore */
      }
      sentinel.current = null;
    };
  }, [acquire]);

  return { supported, active, enable, disable };
}
