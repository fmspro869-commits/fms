import { afterEach, describe, expect, it } from 'vitest';
import { ExternalGnssProvider } from './ExternalGnssProvider';
import { externalGnss } from './externalGnss';
import type { GnssSnapshot } from './types';

afterEach(() => {
  externalGnss.setConnected(false);
});

describe('ExternalGnssProvider', () => {
  it('preserves RTK fix quality and NMEA metadata for Field Pilot', () => {
    const provider = new ExternalGnssProvider();
    const snapshot: GnssSnapshot = {
      quality: 'rtk-fixed',
      satellitesUsed: 18,
      satellitesInView: 24,
      hdop: 0.7,
      pdop: 1.1,
      altitude: 132,
      lat: 52.1,
      lng: 19.1,
      speedKmh: 5.4,
      heading: 90,
      time: '120000',
    };

    provider.updateSnapshot(snapshot);
    externalGnss.setConnected(true);
    provider.start();
    externalGnss.set({
      lat: 52.1,
      lng: 19.1,
      accuracy: 1.4,
      speed: 1.5,
      heading: 90,
      altitude: 132,
      timestamp: 1,
    });

    expect(provider.getCurrent()?.fixType).toBe('RTK_FIX');
    expect(provider.getCurrent()?.satellites).toBe(18);
    expect(provider.getCurrent()?.hdop).toBe(0.7);
    expect(provider.getStatus().correctionStatus).toBe('RTK_FIX');
    provider.stop();
  });

  it('reports an RTK float fix distinctly from a fixed solution', () => {
    const provider = new ExternalGnssProvider();
    provider.updateSnapshot({
      quality: 'rtk-float',
      satellitesUsed: 12,
      satellitesInView: 16,
      hdop: 1.2,
      pdop: null,
      altitude: null,
      lat: 52.1,
      lng: 19.1,
      speedKmh: null,
      heading: null,
      time: '',
    });
    externalGnss.setConnected(true);
    provider.start();
    externalGnss.set({
      lat: 52.1,
      lng: 19.1,
      accuracy: 2.4,
      speed: -1,
      heading: Number.NaN,
      timestamp: 1,
    });

    expect(provider.getStatus().fixType).toBe('RTK_FLOAT');
    provider.stop();
  });
});
