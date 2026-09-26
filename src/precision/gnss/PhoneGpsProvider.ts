// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// PhoneGpsProvider — rzeczywisty GPS urządzenia przez Geolocation API
// Nie symuluje danych — zwraca null gdy parametr niedostępny

import type { PositionProvider } from './PositionProvider';
import type { PositionData, GNSSStatus, PositionSource, GpsFix } from './PositionData';
import { gpsFixToPosition, accuracyToSignalQuality } from './PositionData';

const ERR_MESSAGES: Record<number, string> = {
  1: 'Brak zgody na dostęp do lokalizacji. Włącz lokalizację dla tej strony.',
  2: 'Pozycja GPS niedostępna. Sprawdź sygnał / ustawienia lokalizacji.',
  3: 'Przekroczono czas oczekiwania na pozycję GPS.',
};

export class PhoneGpsProvider implements PositionProvider {
  readonly source: PositionSource = 'PHONE';
  readonly isDemo = false;
  
  get isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  private watchId: number | null = null;
  private current: PositionData | null = null;
  private listeners = new Set<(pos: PositionData) => void>();
  private statusListeners = new Set<(s: GNSSStatus) => void>();
  private error: string | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    if (!this.isAvailable) {
      this.error = 'Geolocation API niedostępne w tej przeglądarce';
      this.emitStatus();
      return;
    }

    this.running = true;
    this.error = null;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: GpsFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 999,
          speed: typeof pos.coords.speed === 'number' && pos.coords.speed >= 0 ? pos.coords.speed : -1,
          heading: typeof pos.coords.heading === 'number' && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : NaN,
          altitude: typeof pos.coords.altitude === 'number' && !Number.isNaN(pos.coords.altitude) ? pos.coords.altitude : null,
          timestamp: pos.timestamp,
        };
        this.current = gpsFixToPosition(fix, 'PHONE');
        this.error = null;
        this.emit();
        this.emitStatus();
      },
      (err) => {
        this.error = ERR_MESSAGES[err.code] || err.message || 'Nieznany błąd GPS';
        this.current = null;
        this.emitStatus();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.running = false;
    this.current = null;
    this.emitStatus();
  }

  getCurrent(): PositionData | null {
    return this.current;
  }

  getStatus(): GNSSStatus {
    if (this.error || !this.current) {
      return {
        fixType: 'NONE',
        signalQuality: 'none',
        correctionStatus: 'NONE',
        correctionAge: null,
        source: this.source,
        isDemo: false,
      };
    }
    const acc = this.current.accuracy ?? 999;
    return {
      fixType: 'GPS',
      signalQuality: accuracyToSignalQuality(acc),
      correctionStatus: 'NONE',
      correctionAge: null,
      source: this.source,
      isDemo: false,
    };
  }

  getError(): string | null {
    return this.error;
  }

  subscribe(listener: (pos: PositionData) => void): () => void {
    this.listeners.add(listener);
    // Jeśli mamy już pozycję, wyślij ją natychmiast
    if (this.current) listener(this.current);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: (s: GNSSStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  private emit(): void {
    if (this.current) {
      this.listeners.forEach((l) => l(this.current!));
    }
  }

  private emitStatus(): void {
    const s = this.getStatus();
    this.statusListeners.forEach((l) => l(s));
  }
}
