// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// NTRIPProvider — architektoniczny stub pod przyszłe korekty RTK
// 
// ⚠️ NIE implementuje prawdziwego połączenia NTRIP (wymaga backendu proxy)
// Przygotowuje interfejs dla przyszłej integracji
//
// Status zawsze: NOT CONNECTED (uczciwie)

import type { PositionProvider } from './PositionProvider';
import type { PositionData, GNSSStatus, PositionSource } from './PositionData';

export interface NTRIPConfig {
  caster: string;        // np. "rtk2go.com"
  port: number;          // np. 2101
  mountpoint: string;    // np. "MP01"
  username: string;
  password: string;
  protocol: 'NTRIP v1' | 'NTRIP v2';
}

export type NTRIPConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface NTRIPStatus {
  connection: NTRIPConnectionState;
  lastError: string | null;
  bytesReceived: number;
  correctionAge: number | null;
  config: NTRIPConfig | null;
}

export class NTRIPProvider implements PositionProvider {
  readonly source: PositionSource = 'NTRIP';
  readonly isDemo = false;
  
  get isAvailable(): boolean {
    return false; // NTRIP nie jest jeszcze zaimplementowany
  }

  private config: NTRIPConfig | null = null;
  private status: NTRIPStatus = {
    connection: 'DISCONNECTED',
    lastError: null,
    bytesReceived: 0,
    correctionAge: null,
    config: null,
  };

  private statusListeners = new Set<(s: GNSSStatus) => void>();
  private ntripListeners = new Set<(s: NTRIPStatus) => void>();

  // ============================================
  // KONFIGURACJA
  // ============================================

  configure(config: NTRIPConfig): void {
    this.config = config;
    this.status = { ...this.status, config };
    this.emitNtripStatus();
  }

  getConfig(): NTRIPConfig | null {
    return this.config;
  }

  // ============================================
  // POŁĄCZENIE — STUB
  // ============================================

  connect(): void {
    // STUB: Prawdziwe NTRIP wymaga WebSocket/backend proxy
    // Przeglądarka nie może bezpośrednio połączyć się z casterem NTRIP (TCP)
    this.status = {
      ...this.status,
      connection: 'DISCONNECTED',
      lastError: 'NTRIP wymaga backendu proxy — nie zaimplementowano',
    };
    this.emitNtripStatus();
  }

  disconnect(): void {
    this.status = {
      ...this.status,
      connection: 'DISCONNECTED',
      lastError: null,
    };
    this.emitNtripStatus();
  }

  // ============================================
  // PositionProvider interface
  // ============================================

  start(): void {
    // NTRIP nie dostarcza pozycji bezpośrednio — tylko korekty
    this.emitStatus();
  }

  stop(): void {
    this.disconnect();
  }

  getCurrent(): PositionData | null {
    return null; // NTRIP nie jest źródłem pozycji
  }

  getStatus(): GNSSStatus {
    return {
      fixType: 'NONE',
      signalQuality: 'none',
      correctionStatus: 'UNKNOWN',
      correctionAge: null,
      source: this.source,
      isDemo: false,
    };
  }

  getNTRIPStatus(): NTRIPStatus {
    return { ...this.status };
  }

  subscribe(_listener: (pos: PositionData) => void): () => void {
    // NTRIP nie emituje pozycji
    return () => {};
  }

  subscribeStatus(listener: (s: GNSSStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  subscribeNTRIP(listener: (s: NTRIPStatus) => void): () => void {
    this.ntripListeners.add(listener);
    listener(this.status);
    return () => this.ntripListeners.delete(listener);
  }

  private emitNtripStatus(): void {
    this.ntripListeners.forEach((l) => l(this.status));
  }

  private emitStatus(): void {
    const s = this.getStatus();
    this.statusListeners.forEach((l) => l(s));
  }
}

// Singleton
let ntripProvider: NTRIPProvider | null = null;

export function getNTRIPProvider(): NTRIPProvider {
  if (!ntripProvider) {
    ntripProvider = new NTRIPProvider();
  }
  return ntripProvider;
}
