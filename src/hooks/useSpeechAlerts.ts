import { useCallback, useEffect, useRef } from 'react';

export interface SpeechController {
  supported: boolean;
  speak: (text: string, key?: string) => void;
  cancel: () => void;
}

/**
 * Ostrzeżenia głosowe (window.speechSynthesis) z cooldownem i histerezą.
 * Nie mów przy każdej aktualizacji GPS — minimalny odstęp między komunikatami.
 */
export function useSpeechAlerts(enabled: boolean, cooldownMs = 4000): SpeechController {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const lastAt = useRef(0);
  const lastKey = useRef<string>('');
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const speak = useCallback(
    (text: string, key?: string) => {
      if (!supported || !enabledRef.current) return;
      const now = Date.now();
      const k = key ?? text;
      // ten sam komunikat nie częściej niż co cooldown; różne komunikaty też z odstępem
      if (now - lastAt.current < cooldownMs && k === lastKey.current) return;
      if (now - lastAt.current < cooldownMs / 2) return;
      lastAt.current = now;
      lastKey.current = k;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'pl-PL';
        u.rate = 1.05;
        u.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch {
        /* brak wsparcia — ignoruj */
      }
    },
    [supported, cooldownMs],
  );

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  useEffect(() => cancel, [cancel]);

  return { supported, speak, cancel };
}
