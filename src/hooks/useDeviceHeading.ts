import { useCallback, useEffect, useRef, useState } from 'react';

interface DOE extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

export interface HeadingState {
  heading: number | null; // deg z kompasu urządzenia (null = brak)
  supported: boolean;
  needsPermission: boolean;
  granted: boolean;
  requestPermission: () => Promise<void>;
}

/** Kierunek z kompasu urządzenia (DeviceOrientation). iOS wymaga requestPermission(). */
export function useDeviceHeading(active: boolean): HeadingState {
  const [heading, setHeading] = useState<number | null>(null);
  const [granted, setGranted] = useState(false);
  const supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  const needsPermission =
    supported &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
  const listening = useRef(false);

  const onOrient = useCallback((e: Event) => {
    const ev = e as DOE;
    if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
      setHeading(ev.webkitCompassHeading);
    } else if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
      // alpha rośnie przeciwnie do wskazań kompasu
      setHeading((360 - ev.alpha) % 360);
    }
  }, []);

  const attach = useCallback(() => {
    if (listening.current) return;
    listening.current = true;
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  }, [onOrient]);

  const requestPermission = useCallback(async () => {
    if (!supported) return;
    try {
      if (needsPermission) {
        const res = await (
          DeviceOrientationEvent as unknown as { requestPermission: () => Promise<'granted' | 'denied'> }
        ).requestPermission();
        if (res === 'granted') {
          setGranted(true);
          attach();
        }
      } else {
        setGranted(true);
        attach();
      }
    } catch {
      /* brak kompasu — kierunek z ruchu GPS */
    }
  }, [supported, needsPermission, attach]);

  useEffect(() => {
    if (!active || !supported) return;
    if (!needsPermission) {
      setGranted(true);
      attach();
    }
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrient, true);
      window.removeEventListener('deviceorientation', onOrient, true);
      listening.current = false;
    };
  }, [active, supported, needsPermission, attach, onOrient]);

  return { heading, supported, needsPermission, granted, requestPermission };
}
