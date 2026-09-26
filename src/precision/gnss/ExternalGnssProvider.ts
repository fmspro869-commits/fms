// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// ExternalGnssProvider — zewnętrzny odbiornik GNSS (NMEA przez Serial/BT)
// Rzeczywiste dane z odbiornika — NIE symuluje RTK

import type { PositionProvider } from './PositionProvider';
import type { PositionData, GNSSStatus, PositionSource, GpsFix } from './PositionData';
import { gpsFixToPosition, accuracyToSignalQuality } from './PositionData';
import { externalGnss } from './externalGnss';
import type { GnssSnapshot, FixQuality } from './types';

export class ExternalGnssProvider implements PositionProvider {
  readonly source: PositionSource = 'EXTERNAL_GNSS';
  readonly isDemo = false;
  
  get isAvailable(): boolean {
    return externalGnss.isConnected();
  }

  private current: PositionData | null = null;
  private snapshot: GnssSnapshot | null = null;
  private listeners = new Set<(pos: PositionData) => void>();
  private statusListeners = new Set<(s: GNSSStatus) => void>();
  private unsubExternal: (() => void) | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;

    this.unsubExternal = externalGnss.subscribe((fix: GpsFix | null) => {
      if (fix) {
        this.current = gpsFixToPosition(fix, 'EXTERNAL_GNSS');
        // Wzbogać danymi z NMEA jeśli dostępne
        if (this.snapshot) {
          this.current = {
            ...this.current,
            fixType: this.mapQualityToFixType(this.snapshot.quality),
            satellites: this.snapshot.satellitesUsed,
            satellitesInView: this.snapshot.satellitesInView,
            hdop: this.snapshot.hdop,
            pdop: this.snapshot.pdop,
            altitude: this.snapshot.altitude ?? this.current.altitude,
          };
        }
        this.emit();
      } else {
        this.current = null;
      }
      this.emitStatus();
    });
  }

  stop(): void {
    this.unsubExternal?.();
    this.unsubExternal = null;
    this.running = false;
    this.current = null;
    this.emitStatus();
  }

  /** Aktualizacja snapshotu NMEA (wywoływane z useSerialNmea) */
  updateSnapshot(snap: GnssSnapshot): void {
    this.snapshot = snap;
    if (this.current) {
      this.current = {
        ...this.current,
        fixType: this.mapQualityToFixType(snap.quality),
        satellites: snap.satellitesUsed,
        satellitesInView: snap.satellitesInView,
        hdop: snap.hdop,
        pdop: snap.pdop,
        altitude: snap.altitude ?? this.current.altitude,
      };
      this.emit();
      this.emitStatus();
    }
  }

  private mapQualityToFixType(q: FixQuality): PositionData['fixType'] {
    switch (q) {
      case 'rtk-fixed': return 'RTK_FIX';
      case 'rtk-float': return 'RTK_FLOAT';
      case 'gps':
      case 'dgps':
      case 'pps': return 'GNSS';
      default: return 'NONE';
    }
  }

  getCurrent(): PositionData | null {
    return this.current;
  }

  getStatus(): GNSSStatus {
    if (!this.current) {
      return {
        fixType: 'NONE',
        signalQuality: 'none',
        correctionStatus: 'NONE',
        correctionAge: null,
        source: this.source,
        isDemo: false,
      };
    }

    const fixType = this.current.fixType;
    const acc = this.current.accuracy ?? 999;

    return {
      fixType,
      signalQuality: fixType === 'RTK_FIX' ? 'excellent'
        : fixType === 'RTK_FLOAT' ? 'good'
        : accuracyToSignalQuality(acc),
      correctionStatus: fixType === 'RTK_FIX' ? 'RTK_FIX'
        : fixType === 'RTK_FLOAT' ? 'RTK_FLOAT'
        : 'NONE',
      correctionAge: null,
      source: this.source,
      isDemo: false,
    };
  }

  subscribe(listener: (pos: PositionData) => void): () => void {
    this.listeners.add(listener);
    if (this.current) listener(this.current);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: (s: GNSSStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  private emit(): void {
    if (this.current) this.listeners.forEach((l) => l(this.current!));
  }

  private emitStatus(): void {
    const s = this.getStatus();
    this.statusListeners.forEach((l) => l(s));
  }
}
