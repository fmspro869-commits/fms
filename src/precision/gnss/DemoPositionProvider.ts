// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// DemoPositionProvider — wyłącznie do testowania
// 🧪 KAŻDY ekran używający demo MUSI pokazywać badge DEMO
// NIE udaje RTK — demo ma zawsze fixType: GNSS

import type { PositionProvider } from './PositionProvider';
import type { PositionData, GNSSStatus, PositionSource } from './PositionData';

interface DemoPathPoint {
  lat: number;
  lng: number;
}

interface DemoPathState {
  points: DemoPathPoint[];
  cumDist: number[];
  totalDist: number;
  currentDist: number;
  speed: number; // m/s
}

export class DemoPositionProvider implements PositionProvider {
  readonly source: PositionSource = 'DEMO';
  readonly isDemo = true;
  
  get isAvailable(): boolean {
    return true; // Demo zawsze dostępne
  }

  private current: PositionData | null = null;
  private listeners = new Set<(pos: PositionData) => void>();
  private statusListeners = new Set<(s: GNSSStatus) => void>();
  private timer: number | null = null;
  private path: DemoPathState | null = null;

  start(): void {
    this.emitStatus();
  }

  stop(): void {
    this.stopSimulation();
  }

  // ============================================
  // SYMULACJA — tylko dla trybu DEMO
  // ============================================

  startSimulation(path: DemoPathPoint[], speed = 2.3): boolean {
    if (path.length < 2) return false;

    this.stopSimulation();

    // Oblicz skumulowane odległości
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      cum.push(cum[i - 1] + this.haversine(path[i - 1], path[i]));
    }

    this.path = {
      points: path,
      cumDist: cum,
      totalDist: cum[cum.length - 1],
      currentDist: 0,
      speed,
    };

    const dt = 0.25; // 4 Hz — płynna aktualizacja
    this.timer = window.setInterval(() => {
      if (!this.path) return;

      this.path.currentDist += this.path.speed * dt;

      if (this.path.currentDist >= this.path.totalDist) {
        this.path.currentDist = this.path.totalDist;
        this.stopSimulation();
      }

      const pos = this.interpolate(this.path.points, this.path.cumDist, this.path.currentDist);
      const heading = this.computeHeading(this.path.points, this.path.cumDist, this.path.currentDist);

      // Symulowany błąd boczny — sinusoidalny, realistyczny
      const noise = Math.sin(this.path.currentDist / 6) * 0.35;

      // Oblicz pozycję z szumem (prostopadle do kierunku)
      const noisyPos = this.addLateralNoise(pos, heading, noise);

      this.current = {
        latitude: noisyPos.lat,
        longitude: noisyPos.lng,
        timestamp: Date.now(),
        altitude: null,
        accuracy: 0.8 + Math.random() * 0.6, // Symulowana dokładność sub-meter
        speed: this.path.speed,
        heading,
        fixType: 'GNSS', // 🧪 DEMO — NIE RTK!
        satellites: 12,
        satellitesInView: 18,
        hdop: 0.9,
        vdop: null,
        pdop: null,
        ageOfCorrection: null,
        source: 'DEMO',
        isDemo: true,
      };

      this.emit();
      this.emitStatus();
    }, dt * 1000);

    return true;
  }

  stopSimulation(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.path = null;
    // Nie zerujemy current — ostatnia pozycja zostaje widoczna
  }

  isSimulating(): boolean {
    return this.timer !== null;
  }

  // ============================================
  // GEOMETRIA POMOCNICZA
  // ============================================

  private haversine(a: DemoPathPoint, b: DemoPathPoint): number {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const la1 = a.lat * Math.PI / 180;
    const la2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  private interpolate(points: DemoPathPoint[], cum: number[], dist: number): DemoPathPoint {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < dist) i++;

    const segStart = points[i];
    const segEnd = points[Math.min(i + 1, points.length - 1)];
    const segLen = cum[i + 1] - cum[i];
    const t = segLen > 0 ? (dist - cum[i]) / segLen : 0;

    return {
      lat: segStart.lat + (segEnd.lat - segStart.lat) * t,
      lng: segStart.lng + (segEnd.lng - segStart.lng) * t,
    };
  }

  private computeHeading(points: DemoPathPoint[], cum: number[], dist: number): number {
    const pos = this.interpolate(points, cum, dist);
    const ahead = this.interpolate(points, cum, Math.min(dist + 5, cum[cum.length - 1]));

    const dx = (ahead.lng - pos.lng) * 111320 * Math.cos(pos.lat * Math.PI / 180);
    const dy = (ahead.lat - pos.lat) * 111320;

    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }

  private addLateralNoise(pos: DemoPathPoint, heading: number, noise: number): DemoPathPoint {
    // Przesuń prostopadle do kierunku jazdy
    const headingRad = heading * Math.PI / 180;
    const perpHeading = headingRad + Math.PI / 2;

    const dLat = (noise * Math.cos(perpHeading)) / 111320;
    const dLng = (noise * Math.sin(perpHeading)) / (111320 * Math.cos(pos.lat * Math.PI / 180));

    return {
      lat: pos.lat + dLat,
      lng: pos.lng + dLng,
    };
  }

  // ============================================
  // PositionProvider interface
  // ============================================

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
        isDemo: true,
      };
    }

    return {
      fixType: 'GNSS', // 🧪 DEMO — zawsze GNSS, nigdy RTK
      signalQuality: 'good',
      correctionStatus: 'NONE',
      correctionAge: null,
      source: this.source,
      isDemo: true,
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
