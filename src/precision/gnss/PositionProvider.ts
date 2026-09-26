// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// Uniwersalny interfejs PositionProvider
// Field Pilot NIE zależy bezpośrednio od GPS telefonu

import type { PositionData, GNSSStatus, PositionSource } from './PositionData';
import { PhoneGpsProvider } from './PhoneGpsProvider';
import { DemoPositionProvider } from './DemoPositionProvider';
import { ExternalGnssProvider } from './ExternalGnssProvider';

export interface PositionProvider {
  readonly source: PositionSource;
  readonly isDemo: boolean;
  readonly isAvailable: boolean;

  start(): void;
  stop(): void;

  getCurrent(): PositionData | null;
  getStatus(): GNSSStatus;

  subscribe(listener: (pos: PositionData) => void): () => void;
  subscribeStatus(listener: (status: GNSSStatus) => void): () => void;
}

// ============================================
// SINGLETON PROVIDERS (współdzielone)
// ============================================

let phoneProvider: PhoneGpsProvider | null = null;
let demoProvider: DemoPositionProvider | null = null;
let externalProvider: ExternalGnssProvider | null = null;

export function getPhoneProvider(): PhoneGpsProvider {
  if (!phoneProvider) phoneProvider = new PhoneGpsProvider();
  return phoneProvider;
}

export function getDemoProvider(): DemoPositionProvider {
  if (!demoProvider) demoProvider = new DemoPositionProvider();
  return demoProvider;
}

export function getExternalProvider(): ExternalGnssProvider {
  if (!externalProvider) externalProvider = new ExternalGnssProvider();
  return externalProvider;
}
