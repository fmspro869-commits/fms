import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFarm } from '@/store/FarmContext';
import type { Field, FieldWorkSession, TrackPoint } from '@/types';
import {
  bearing,
  buildSwathQuads,
  classifyDeviation,
  crossTrackError,
  distanceMeters,
  distanceToLineEnd,
  estimateCoverage,
  generateABLines,
  linesWorked,
  nearestLine,
  polygonAreaHa,
  trackDistance,
  type GuidanceGeometry,
  type LL,
} from '@/geometry/guidance';
import { useDeviceHeading } from '@/hooks/useDeviceHeading';
import { useFieldGuidance } from '@/hooks/useFieldGuidance';
import { useSpeechAlerts } from '@/hooks/useSpeechAlerts';
import { useWakeLock } from '@/hooks/useWakeLock';
import { usePosition } from '@/precision/gnss/usePosition';
import { BAUD_RATES, useSerialNmea } from '@/precision/gnss/useSerialNmea';
import { positionToGpsFix, type GpsFix } from '@/precision/gnss/PositionData';
import { GuidanceBar } from '@/components/fieldpilot/GuidanceBar';
import { Compass } from '@/components/fieldpilot/Compass';
import { NavigationMap, type MapHandle, type MapLayer } from '@/components/fieldpilot/NavigationMap';
import { RealisticTerrainMap } from '@/components/terrain/RealisticTerrainMap';
import { SessionSummary } from '@/components/fieldpilot/SessionSummary';
import { SessionHistory } from '@/components/fieldpilot/SessionHistory';
import { StartConfig, type PilotConfig } from '@/components/fieldpilot/StartConfig';
import { Btn } from '@/components/common';

type Phase = 'config' | 'running' | 'summary' | 'history';

const ACTIVE_KEY = 'fms2-pilot-active';

interface Snapshot {
  config: PilotConfig;
  isDemo: boolean;
  pointA: [number, number] | null;
  pointB: [number, number] | null;
  shift: number;
  offsetCorr: number;
  contour: [number, number][];
  track: TrackPoint[];
  startedAt: string;
  status: 'active' | 'paused';
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const defaultConfig: PilotConfig = { fieldId: '', treatmentType: 'siew', tractorId: '', machineId: '', width: 3, mode: 'AB', operator: '', passes: 1, accuracyPref: 'auto' };
const DEMO_FIELD_GEO: [number, number][] = [
  [51.00105, 17.1355],
  [51.0013, 17.13642],
  [51.00215, 17.13628],
  [51.00192, 17.13534],
];
const DEMO_FIELD: Field = {
  id: '__demo-sulimow-example__',
  name: 'DEMO — Sulimów (granica orientacyjna)',
  area: polygonAreaHa(DEMO_FIELD_GEO),
  parcelNo: 'DEMO',
  district: 'Sulimów',
  soilType: '—',
  pH: 0,
  P: '—',
  K: '—',
  Mg: '—',
  geo: DEMO_FIELD_GEO,
};

function isValidCoordinatePair(point: unknown): point is [number, number] {
  return Array.isArray(point)
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Math.abs(point[0]) <= 85.0511
    && Math.abs(point[1]) <= 180;
}

function isValidTrackPoint(point: unknown): point is TrackPoint {
  if (typeof point !== 'object' || point === null) return false;
  const trackPoint = point as Record<string, unknown>;
  return isValidCoordinatePair([trackPoint.lat, trackPoint.lng])
    && [trackPoint.t, trackPoint.speed, trackPoint.heading, trackPoint.accuracy, trackPoint.activeLine, trackPoint.xte]
      .every((value) => typeof value === 'number' && Number.isFinite(value));
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snapshot;
    if (s && s.config && typeof s.startedAt === 'string') {
      return {
        ...s,
        pointA: isValidCoordinatePair(s.pointA) ? s.pointA : null,
        pointB: isValidCoordinatePair(s.pointB) ? s.pointB : null,
        contour: Array.isArray(s.contour) ? s.contour.filter(isValidCoordinatePair) : [],
        track: Array.isArray(s.track) ? s.track.filter(isValidTrackPoint) : [],
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export default function FieldPilot({ initialFieldId }: { initialFieldId?: string } = {}) {
  const { state, addTreatment, addSession, notify } = useFarm();

  const [phase, setPhase] = useState<Phase>('config');
  const [config, setConfig] = useState<PilotConfig>(() => ({ ...defaultConfig, fieldId: initialFieldId ?? '' }));
  const [isDemo, setIsDemo] = useState(false);
  const [pointA, setPointA] = useState<[number, number] | null>(null);
  const [pointB, setPointB] = useState<[number, number] | null>(null);
  const [shift, setShift] = useState(0);
  const [offsetCorr, setOffsetCorr] = useState(0);
  const [contour, setContour] = useState<[number, number][]>([]);
  const [recordingContour, setRecordingContour] = useState(false);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [paused, setPaused] = useState(false);
  const [startedAt, setStartedAt] = useState('');
  const [night, setNight] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [voice, setVoice] = useState(true);
  const [vibrate, setVibrate] = useState(true);
  const [lightbar, setLightbar] = useState(true);
  const [follow, setFollow] = useState(true);
  const [keepScreen, setKeepScreen] = useState(false);
  const [coverage, setCoverage] = useState({ coveragePercent: 0, areaCoveredHa: 0 });
  const [lastSession, setLastSession] = useState<FieldWorkSession | null>(null);
  const [resume, setResume] = useState<Snapshot | null>(() => readSnapshot());
  const [layer, setLayer] = useState<MapLayer>('satellite');
  const [courseUp, setCourseUp] = useState(false);
  const [terrain3d, setTerrain3d] = useState(false);
  const [terrainCameraMode, setTerrainCameraMode] = useState<'follow' | 'free' | 'north-up' | 'course-up' | 'top-down'>('follow');
  const [terrainReadout, setTerrainReadout] = useState<{ elevation: number | null; slopePercent: number | null }>({ elevation: null, slopePercent: null });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [layerMenu, setLayerMenu] = useState(false);
  const [cameraMenu, setCameraMenu] = useState(false);
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const demoSimulationStartedRef = useRef(false);
  const mapApi = useRef<MapHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const serial = useSerialNmea();

  const field = isDemo ? DEMO_FIELD : state.fields.find((f) => f.id === config.fieldId);
  const device = useDeviceHeading(phase === 'running' && !isDemo);
  const speech = useSpeechAlerts(voice);
  const wake = useWakeLock();
  const { position, status: gnssStatus, demoProvider, error, retry: retryPosition } = usePosition({
    enabled: phase === 'running',
    preferredSource: isDemo ? 'DEMO' : serial.connected ? 'EXTERNAL_GNSS' : 'AUTO',
  });

  const fix: GpsFix | null = isDemo
    ? demoProvider?.getCurrent()
      ? positionToGpsFix(demoProvider.getCurrent()!)
      : null
    : position
      ? positionToGpsFix(position)
      : null;

  const polygon: [number, number][] = useMemo(
    () => (config.mode === 'kontur' && contour.length >= 3 ? contour : field?.geo || []),
    [config.mode, contour, field],
  );

  const geometry: GuidanceGeometry | null = useMemo(() => {
    if (!pointA || !pointB) return null;
    return generateABLines(
      { lat: pointA[0], lng: pointA[1] },
      { lat: pointB[0], lng: pointB[1] },
      config.width,
      shift,
      polygon,
    );
  }, [pointA, pointB, config.width, shift, polygon]);

  const info = useFieldGuidance(geometry, fix, offsetCorr);

  const computedBearing = useMemo(() => {
    if (track.length < 2) return null;
    const a = track[track.length - 2];
    const b = track[track.length - 1];
    if (distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) < 0.5) return null;
    return bearing({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  }, [track]);

  const headingFromCompass = device.granted && device.heading !== null;
  const heading: number | null = headingFromCompass
    ? device.heading
    : fix && !Number.isNaN(fix.heading)
      ? fix.heading
      : computedBearing;

  const speedKmh = useMemo(() => {
    if (fix && fix.speed >= 0) return fix.speed * 3.6;
    if (track.length >= 2) {
      const a = track[track.length - 2];
      const b = track[track.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0) return (distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) / dt) * 3.6;
    }
    return 0;
  }, [fix, track]);

  const nav = useMemo(() => {
    if (manualLabel && geometry && fix) {
      const line = geometry.lines.find((l) => l.label === manualLabel);
      if (line) {
        const xte = crossTrackError({ lat: fix.lat, lng: fix.lng }, geometry, line, offsetCorr);
        const steer: 'left' | 'right' | 'center' = Math.abs(xte) <= 0.05 ? 'center' : xte > 0 ? 'right' : 'left';
        return { activeLine: line, activeIndex: geometry.lines.indexOf(line) + 1, xte, steer, quality: classifyDeviation(xte), distanceToEnd: distanceToLineEnd({ lat: fix.lat, lng: fix.lng }, geometry, line) };
      }
    }
    return info;
  }, [manualLabel, geometry, fix, offsetCorr, info]);

  const swaths = useMemo(() => buildSwathQuads(track.map((p) => ({ lat: p.lat, lng: p.lng })), config.width), [track, config.width]);
  const trackCoordinates = useMemo(() => track.map((p) => [p.lat, p.lng] as [number, number]), [track]);

  const doneLabels = useMemo(() => {
    if (!geometry) return [];
    const idxs = new Set<number>();
    for (const p of track) if (p.activeLine > 0) idxs.add(p.activeLine);
    return Array.from(idxs).map((i) => geometry.lines[i - 1]?.label).filter(Boolean) as string[];
  }, [track, geometry]);

  const overlapPoints = useMemo(() => {
    const half = config.width / 2;
    const pts: [number, number][] = [];
    for (const p of track) if (Math.abs(p.xte) > half) pts.push([p.lat, p.lng]);
    const step = Math.max(1, Math.ceil(pts.length / 400));
    return pts.filter((_, i) => i % step === 0);
  }, [track, config.width]);

  const mapRotation = courseUp && heading !== null ? -heading : 0;

  const geoRef = useRef(geometry);
  const offRef = useRef(offsetCorr);
  const pausedRef = useRef(paused);
  const recContourRef = useRef(recordingContour);
  geoRef.current = geometry;
  offRef.current = offsetCorr;
  pausedRef.current = paused;
  recContourRef.current = recordingContour;

  useEffect(() => {
    if (phase !== 'running' || pausedRef.current || !fix) return;
    const pos: LL = { lat: fix.lat, lng: fix.lng };
    const g = geoRef.current;
    let activeIndex = 0;
    let xte = 0;
    if (g && g.lines.length) {
      const r = nearestLine(pos, g, offRef.current);
      activeIndex = r.line ? g.lines.indexOf(r.line) + 1 : 0;
      xte = r.xte;
    }
    setTrack((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        const d = distanceMeters({ lat: last.lat, lng: last.lng }, pos);
        if (d < 0.5 && fix.timestamp - last.t < 1000) return prev;
      }
      return [
        ...prev,
        {
          t: fix.timestamp,
          lat: fix.lat,
          lng: fix.lng,
          speed: fix.speed >= 0 ? fix.speed : 0,
          heading: Number.isNaN(fix.heading) ? 0 : fix.heading,
          accuracy: fix.accuracy,
          activeLine: activeIndex,
          xte,
        },
      ];
    });
    if (recContourRef.current) setContour((c) => [...c, [fix.lat, fix.lng]]);
  }, [fix, phase]);

  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    if (phase !== 'running') return;
    const compute = () => {
      const positions = trackRef.current.map((p) => ({ lat: p.lat, lng: p.lng }));
      const cov = estimateCoverage(positions, config.width, polygon);
      setCoverage({ coveragePercent: cov.coveragePercent, areaCoveredHa: cov.areaCoveredHa });
    };
    compute();
    const t = setInterval(compute, 3000);
    return () => clearInterval(t);
  }, [phase, config.width, polygon]);

  const lastLineRef = useRef(0);
  const lastVibRef = useRef(0);
  const lastAccWarnRef = useRef(0);
  useEffect(() => {
    if (phase !== 'running' || paused) return;
    if (info.activeIndex && info.activeIndex !== lastLineRef.current) {
      if (lastLineRef.current !== 0) speech.speak(`Przejdź na linię ${info.activeIndex}`, 'line');
      lastLineRef.current = info.activeIndex;
    }
    if (info.quality === 'correct' || info.quality === 'large') {
      const m = Math.abs(info.xte).toFixed(1).replace('.', ' przecinek ');
      speech.speak(`Odchylenie ${m} ${info.steer === 'right' ? 'w prawo' : 'w lewo'}`, 'dev');
    }
    if (info.distanceToEnd < 30 && info.distanceToEnd > 0) {
      speech.speak('Zbliżasz się do końca pola', 'end');
    }
    if (vibrate && Math.abs(info.xte) > 0.5 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      const now = Date.now();
      if (now - lastVibRef.current > 1500) {
        lastVibRef.current = now;
        try {
          navigator.vibrate(80);
        } catch {
          // brak wsparcia
        }
      }
    }
  }, [info, phase, paused, vibrate, speech]);

  useEffect(() => {
    if (phase !== 'running' || isDemo || !fix) return;
    if (fix.accuracy > 5) {
      const now = Date.now();
      if (now - lastAccWarnRef.current > 15000) {
        lastAccWarnRef.current = now;
        speech.speak('Dokładność GPS spadła', 'acc');
      }
    }
  }, [fix, phase, isDemo, speech]);

  useEffect(() => {
    if (phase !== 'running') return;
    const snap: Snapshot = { config, isDemo, pointA, pointB, shift, offsetCorr, contour, track, startedAt, status: paused ? 'paused' : 'active' };
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(snap));
    } catch {
      // quota
    }
  }, [phase, config, isDemo, pointA, pointB, shift, offsetCorr, contour, track, startedAt, paused]);

  useEffect(() => {
    if (keepScreen && phase === 'running') wake.enable();
    else wake.disable();
  }, [keepScreen, phase]);

  const stats = useMemo(() => {
    const positions = track.map((p) => ({ lat: p.lat, lng: p.lng }));
    const distance = trackDistance(positions);
    const elapsed = startedAt ? (Date.now() - new Date(startedAt).getTime()) / 1000 : 0;
    const avgSpeed = elapsed > 0 ? (distance / elapsed) * 3.6 : 0;
    const accs = track.filter((p) => p.accuracy > 0).map((p) => p.accuracy);
    const avgAccuracy = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
    const totalLines = geometry?.lines.length || 0;
    const linesDone = geometry ? linesWorked(positions, geometry) : 0;
    const fieldArea = polygonAreaHa(polygon);
    const remaining = Math.max(0, fieldArea - coverage.areaCoveredHa);
    const rate = elapsed > 0 ? coverage.areaCoveredHa / elapsed : 0;
    const etaSec = rate > 0 ? remaining / rate : 0;
    return { distance, elapsed, avgSpeed, avgAccuracy, totalLines, linesDone, fieldArea, etaSec };
  }, [track, startedAt, geometry, polygon, coverage]);

  const start = useCallback(
    (demo: boolean) => {
      setIsDemo(demo);
      setTerrain3d(true);
      demoSimulationStartedRef.current = false;
      setTrack([]);
      setContour([]);
      setPointA(null);
      setPointB(null);
      setShift(0);
      setOffsetCorr(0);
      demoProvider?.stopSimulation();
      setPaused(false);
      setCoverage({ coveragePercent: 0, areaCoveredHa: 0 });
      lastLineRef.current = 0;
      setStartedAt(new Date().toISOString());
      setPhase('running');
    },
    [demoProvider],
  );

  const setA = () => {
    if (fix) setPointA([fix.lat, fix.lng]);
  };
  const setB = () => {
    if (fix) setPointB([fix.lat, fix.lng]);
  };

  const buildDemoGeometry = useCallback((): GuidanceGeometry | null => {
    const poly = field?.geo || [];
    if (poly.length < 3) return null;
    let a: [number, number];
    let b: [number, number];
    if (pointA && pointB) {
      a = pointA;
      b = pointB;
    } else {
      let bi = 0;
      let best = -1;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const d = distanceMeters({ lat: p[0], lng: p[1] }, { lat: q[0], lng: q[1] });
        if (d > best) { best = d; bi = i; }
      }
      a = poly[bi];
      b = poly[(bi + 1) % poly.length];
      setPointA(a);
      setPointB(b);
    }
    return generateABLines({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }, config.width, shift, poly);
  }, [field, pointA, pointB, config.width, shift]);

  const startSimulation = useCallback(() => {
    const g = geometry || buildDemoGeometry();
    if (!g || g.lines.length === 0) {
      notify('Brak pola/geometrii do symulacji — wybierz pole z granicą', 'err');
      return;
    }
    const path: { lat: number; lng: number }[] = [];
    g.lines.forEach((line, i) => {
      const seg = line.segments[0];
      if (!seg) return;
      const p0 = { lat: seg[0][0], lng: seg[0][1] };
      const p1 = { lat: seg[seg.length - 1][0], lng: seg[seg.length - 1][1] };
      if (i % 2 === 0) path.push(p0, p1);
      else path.push(p1, p0);
    });
    if (path.length < 2) {
      notify('Nie udało się zbudować trasy symulacji', 'err');
      return;
    }
    demoProvider?.startSimulation(path, 2.3);
  }, [geometry, buildDemoGeometry, notify, demoProvider]);

  useEffect(() => {
    if (phase !== 'running' || !isDemo || paused || demoSimulationStartedRef.current) return;
    demoSimulationStartedRef.current = true;
    const timer = window.setTimeout(startSimulation, 150);
    return () => window.clearTimeout(timer);
  }, [isDemo, paused, phase, startSimulation]);

  const stopSimTimer = useCallback(() => {
    demoProvider?.stopSimulation();
  }, [demoProvider]);

  useEffect(() => stopSimTimer, [stopSimTimer]);

  useEffect(() => {
    if (!terminal) return;
    const exitTerminal = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTerminal(false);
    };
    window.addEventListener('keydown', exitTerminal);
    return () => window.removeEventListener('keydown', exitTerminal);
  }, [terminal]);

  const finishWork = useCallback(() => {
    stopSimTimer();
    const endedAt = new Date().toISOString();
    const positions = track.map((p) => ({ lat: p.lat, lng: p.lng }));
    const distance = trackDistance(positions);
    const elapsed = startedAt ? (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000 : 0;
    const avgSpeed = elapsed > 0 ? (distance / elapsed) * 3.6 : 0;
    const accs = track.filter((p) => p.accuracy > 0).map((p) => p.accuracy);
    const avgAccuracy = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
    const fc = isDemo ? undefined : state.fieldCrops.find((c) => c.fieldId === config.fieldId && c.season === 2026);
    const crop = isDemo ? '— (DEMO)' : fc?.cropName || '—';
    const session: FieldWorkSession = {
      id: uid(),
      fieldId: isDemo ? DEMO_FIELD.id : config.fieldId,
      fieldName: field?.name || '—',
      tractorId: config.tractorId || undefined,
      machineId: config.machineId || undefined,
      treatmentType: config.treatmentType,
      crop,
      operator: config.operator,
      implementWidth: config.width,
      mode: config.mode,
      pointA,
      pointB,
      shift,
      offsetCorr,
      contour,
      passes: config.passes,
      track,
      startedAt,
      endedAt,
      distance,
      areaCovered: coverage.areaCoveredHa,
      coveragePercent: coverage.coveragePercent,
      averageSpeed: avgSpeed,
      averageAccuracy: avgAccuracy,
      totalLines: geometry?.lines.length || 0,
      status: 'completed',
      isDemo,
    };
    if (!isDemo) addSession(session);
    if (!isDemo && config.fieldId) {
      const hhmm = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}`;
      addTreatment({
        date: startedAt.slice(0, 10),
        type: config.treatmentType,
        fieldId: config.fieldId,
        crop,
        machineId: config.tractorId || config.machineId || undefined,
        operator: config.operator || undefined,
        cost: 0,
        season: 2026,
        notes: `🚜 FMS Field Pilot${isDemo ? ' (DEMO)' : ''} — czas ${hhmm}, dystans ${(distance / 1000).toFixed(1)} km, powierzchnia ${coverage.areaCoveredHa.toFixed(1)} ha, pokrycie ${coverage.coveragePercent.toFixed(0)}%`,
      });
    }
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
    setLastSession(session);
    setPhase('summary');
    notify(isDemo ? 'Sesja DEMO zakończona — dane gospodarstwa nie zostały zmienione' : 'Praca zapisana w Dzienniku Polowym ✅');
  }, [track, startedAt, coverage, config, field, pointA, pointB, shift, offsetCorr, contour, geometry, isDemo, state.fieldCrops, addSession, addTreatment, notify, stopSimTimer]);

  const resumeSession = () => {
    if (!resume) return;
    setConfig(resume.config);
    setIsDemo(resume.isDemo);
    setPointA(resume.pointA);
    setPointB(resume.pointB);
    setShift(resume.shift);
    setOffsetCorr(resume.offsetCorr);
    setContour(resume.contour);
    setTrack(resume.track);
    setStartedAt(resume.startedAt);
    setPaused(resume.status === 'paused');
    setResume(null);
    setPhase('running');
  };
  const discardSession = () => {
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
    setResume(null);
  };

  if (phase === 'history') return <SessionHistory onBack={() => setPhase('config')} />;

  if (phase === 'summary' && lastSession)
    return <SessionSummary session={lastSession} onClose={() => setPhase('config')} onHistory={() => setPhase('history')} />;

  if (phase === 'config') {
    return (
      <div className="space-y-4">
        <div className="max-w-lg mx-auto rounded-xl border border-slate-700/60 bg-slate-800/40 p-4" data-testid="pilot-rtk-connect">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-100">📡 Odbiornik GNSS / RTK</div>
              <div className="text-xs text-slate-400">Połącz odbiornik NMEA przed rozpoczęciem pracy.</div>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${serial.connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
              {serial.connected ? (serial.snap?.quality === 'rtk-fixed' ? 'RTK FIX' : serial.snap?.quality === 'rtk-float' ? 'RTK FLOAT' : 'POŁĄCZONO') : 'ROZŁĄCZONO'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Prędkość portu szeregowego"
              disabled={serial.connected || !serial.supported}
              value={serial.baud}
              onChange={(event) => serial.setBaud(Number(event.target.value))}
              className="min-h-[40px] rounded-lg border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
            >
              {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate} baud</option>)}
            </select>
            {serial.connected
              ? <Btn variant="danger" onClick={() => { void serial.disconnect(); }}>Rozłącz odbiornik</Btn>
              : <Btn disabled={!serial.supported} onClick={() => { void serial.connect(); }}>🔌 Połącz USB / Serial</Btn>}
            {!serial.supported && <span className="text-xs text-amber-300">Wymagany Chrome/Edge na komputerze i HTTPS.</span>}
          </div>
          {serial.error && <p role="alert" className="mt-2 text-xs text-red-300">{serial.error}</p>}
        </div>
        {resume && (
          <div className="max-w-lg mx-auto rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" data-testid="resume-banner">
            <div className="font-bold text-amber-300">⏸ ZNALEZIONO NIEZAKOŃCZONĄ SESJĘ</div>
            <div className="text-xs text-amber-200/80 mt-1">{state.fields.find((f) => f.id === resume.config.fieldId)?.name || 'Pole'} · {resume.track.length} pkt śladu</div>
            <div className="flex gap-2 mt-3">
              <button data-testid="resume-btn" onClick={resumeSession} className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 text-white font-bold">WZNÓW</button>
              <button data-testid="discard-btn" onClick={discardSession} className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 font-bold">ODRZUĆ</button>
            </div>
          </div>
        )}
        <div className="flex justify-center gap-2">
          <button onClick={() => setPhase('history')} className="text-sm text-emerald-400" data-testid="open-history-btn">📋 Historia prac polowych →</button>
        </div>
        <StartConfig config={config} setConfig={setConfig} onStart={() => start(false)} />
        <div className="max-w-lg mx-auto">
          <button data-testid="start-demo-btn" onClick={() => start(true)} className="w-full min-h-[52px] rounded-2xl border border-sky-500/60 bg-sky-500/10 text-sky-300 font-bold">
            🧪 TRYB DEMO — uruchom bez GPS
          </button>
        </div>
      </div>
    );
  }

  const dark = night || terminal;
  const fieldCrop = isDemo ? undefined : state.fieldCrops.find((c) => c.fieldId === config.fieldId && c.season === 2026);
  const cropName = fieldCrop?.cropName || '';
  const noGps = !isDemo && !position;
  const nextLine = nav.activeLine && geometry ? geometry.lines[nav.activeIndex] : undefined;
  const acc = isDemo ? (fix?.accuracy ?? 1) : fix?.accuracy ?? 0;
  const gpsDot = noGps ? '🔴'
    : gnssStatus.fixType === 'RTK_FIX' ? '🟢'
    : gnssStatus.fixType === 'RTK_FLOAT' ? '🟡'
    : gnssStatus.fixType === 'GNSS' ? '🔵'
    : acc <= 5 ? '🟢' : acc <= 10 ? '🟡' : '🔴';
  const toggleCls = (on: boolean) => (on ? (dark ? 'bg-[#ff3b30]' : 'bg-emerald-500') : 'bg-slate-600');
  const rnd = `flex h-11 w-11 items-center justify-center rounded-xl border text-base font-bold shadow-sm backdrop-blur-md active:scale-90 transition-transform ${dark ? 'bg-black/65 border-[#ff3b30]/25' : 'bg-[rgba(5,10,15,0.72)] border-white/10'} text-white`;
  const hud = 'rounded-xl border border-white/10 bg-[rgba(5,10,15,0.68)] text-white shadow-sm backdrop-blur-md';
  const LAYERS: { id: MapLayer; label: string }[] = [
    { id: 'map', label: '🗺️ Mapa' },
    { id: 'satellite', label: '🛰️ Satelita' },
    { id: 'hybrid', label: '🛰️ Hybryda' },
    { id: 'terrain', label: '🌍 Teren' },
    { id: 'field', label: '🌾 Pole' },
  ];
  const toggleFs = () => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => undefined);
    else document.exitFullscreen?.().catch(() => undefined);
  };
  const setTerrainCamera = (mode: typeof terrainCameraMode) => {
    setTerrainCameraMode(mode);
    setFollow(mode !== 'free');
    setCourseUp(mode === 'course-up');
    setCameraMenu(false);
  };
  const fitCurrentField = () => {
    if (terrain3d) setTerrainCamera('free');
    else {
      setFollow(false);
      setCourseUp(false);
    }
    mapApi.current?.fitField();
  };

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[60] overflow-hidden ${terminal ? 'font-mono' : ''}`}
      style={{ background: '#000' }}
      data-testid="pilot-running"
    >
      <div className="absolute inset-0">
        {terrain3d ? (
          <RealisticTerrainMap
            ref={mapApi}
            field={field}
            fieldGeo={polygon}
            geometry={geometry}
            activeLabel={nav.activeLine?.label || null}
            doneLabels={doneLabels}
            position={fix ? { lat: fix.lat, lng: fix.lng, heading } : null}
            track={trackCoordinates}
            swaths={swaths}
            pointA={pointA}
            pointB={pointB}
            follow={terrainCameraMode !== 'free'}
            courseUp={terrainCameraMode === 'course-up'}
            cameraMode={terrainCameraMode}
            onTerrainReadout={(readout) => setTerrainReadout((current) =>
              current.elevation === readout.elevation && current.slopePercent === readout.slopePercent
                ? current
                : readout)}
            onMapClick={(la, ln) => {
              if (!pointA) { setPointA([la, ln]); notify('Punkt A ustawiony'); }
              else if (!pointB) { setPointB([la, ln]); notify('Punkt B ustawiony — linie wygenerowane'); }
            }}
            onLineClick={(lbl) => { setManualLabel(lbl); speech.speak(`Przejdź na linię ${lbl.replace('L', '')}`, 'line'); notify(`Aktywna linia ${lbl}`); }}
            fullscreen
            exaggeration={1.3}
          />
        ) : (
          <NavigationMap
            ref={mapApi}
            fieldGeo={polygon}
            geometry={geometry}
            activeLabel={nav.activeLine?.label || null}
            position={fix ? { lat: fix.lat, lng: fix.lng, heading: heading ?? 0 } : null}
            track={trackCoordinates}
            swaths={swaths}
            overlapPoints={overlapPoints}
            doneLabels={doneLabels}
            contour={contour}
            pointA={pointA}
            pointB={pointB}
            night={dark}
            layer={layer}
            rotation={mapRotation}
            follow={follow}
            height="100%"
            onMapClick={(la, ln) => {
              if (!pointA) { setPointA([la, ln]); notify('Punkt A ustawiony'); }
              else if (!pointB) { setPointB([la, ln]); notify('Punkt B ustawiony — linie wygenerowane'); }
            }}
            onLineClick={(lbl) => { setManualLabel(lbl); speech.speak(`Przejdź na linię ${lbl.replace('L', '')}`, 'line'); notify(`Aktywna linia ${lbl}`); }}
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
        <div className={`${hud} pointer-events-auto max-w-[190px] px-2.5 py-2 text-[10px] leading-tight sm:max-w-[210px]`} data-testid="gps-hud">
          <div className="flex items-center gap-1.5 font-black tracking-wide" data-testid="hud-gps">
            <span>{isDemo ? '🧪 DEMO' : `${gpsDot} ${gnssStatus.fixType === 'NONE' ? 'NO GPS' : gnssStatus.fixType}`}</span>
            {!isDemo && position?.accuracy != null && <span className="font-medium text-slate-300">±{position.accuracy.toFixed(1)} m</span>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-slate-300">
            <span>{isDemo ? 'SYMULACJA' : `${position?.satellites ?? '—'} SAT`}</span>
            <span>{speedKmh.toFixed(1)} km/h</span>
          </div>
          {noGps && error && <div className="mt-1 max-w-44 text-[9px] text-amber-200">{error}</div>}
          {noGps && <button onClick={retryPosition} className="pointer-events-auto mt-1.5 min-h-8 rounded-lg border border-white/15 px-2 text-[10px] font-bold text-white" data-testid="retry-gps-btn">GPS · PONÓW</button>}
          {isDemo && <span className="mt-1 block text-[9px] font-black text-sky-300" data-testid="demo-badge">🧪 DEMO — GPS SYMULOWANY</span>}
          {!isDemo && acc > 5 && !noGps && <span className="mt-1 block text-[9px] font-bold text-amber-300" data-testid="gps-warn">⚠ SŁABY GPS</span>}
          {!isDemo && gnssStatus.fixType === 'RTK_FIX' && <span className="mt-1 block text-[9px] font-black text-emerald-300" data-testid="rtk-fix-badge">🟢 RTK FIX</span>}
          {!isDemo && gnssStatus.fixType === 'RTK_FLOAT' && <span className="mt-1 block text-[9px] font-black text-amber-300" data-testid="rtk-float-badge">🟡 RTK FLOAT</span>}
          {!isDemo && gnssStatus.source === 'EXTERNAL_GNSS' && gnssStatus.fixType !== 'RTK_FIX' && gnssStatus.fixType !== 'RTK_FLOAT' && <span className="mt-1 block text-[9px] font-bold text-sky-300" data-testid="external-gnss-badge">📡 EXTERNAL</span>}
        </div>
        <div className={`${hud} pointer-events-auto max-w-[45%] px-2.5 py-2 text-right`} data-testid="field-hud">
          <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">{isDemo ? 'FIELD DEMO' : 'FIELD'}</div>
          <div className="max-w-44 truncate text-xs font-black" data-testid={isDemo ? 'demo-field-label' : undefined}>{field?.name || '—'}</div>
          <div className="max-w-44 truncate text-[9px] text-slate-300">{isDemo ? '🧪 GRANICA ORIENTACYJNA' : cropName || config.treatmentType}</div>
          <div className="text-[10px] font-bold text-amber-200">{nav.activeLine?.label ?? 'L--'}{stats.totalLines ? ` · ${stats.totalLines} L` : ''}</div>
        </div>
      </div>

      <div className="absolute right-2 top-1/2 z-[62] flex -translate-y-1/2 flex-col gap-1.5" data-testid="right-map-controls">
        <div className="relative">
          <button className={`${rnd} !text-[10px]`} onClick={() => setCameraMenu((value) => !value)} data-testid="terrain-camera-menu" aria-label="Tryby kamery">CAM</button>
          {cameraMenu && (
            <div className={`absolute right-14 top-0 ${hud} p-1 w-32`}>
              {([
                ['follow', 'FOLLOW'],
                ['north-up', 'NORTH UP'],
                ['course-up', 'COURSE UP'],
                ['free', 'FREE'],
                ['top-down', 'TOP DOWN'],
              ] as const).map(([mode, label]) => (
                <button key={mode} data-testid={`camera-${mode}`} onClick={() => setTerrainCamera(mode)} className={`w-full min-h-[44px] text-left text-[10px] font-semibold px-2 rounded-lg ${terrainCameraMode === mode ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-200 hover:bg-white/5'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button className={`${rnd} !text-[9px]`} onClick={() => setLayerMenu((value) => !value)} data-testid="map-layer-btn" aria-label="Warstwy mapy">LAYERS</button>
          {layerMenu && (
            <div className={`absolute right-14 top-0 ${hud} p-1 w-36`} data-testid="layers-drawer">
              {LAYERS.map((item) => (
                <button key={item.id} data-testid={`layer-${item.id}`} onClick={() => { setLayer(item.id); setLayerMenu(false); }} className={`w-full min-h-[44px] text-left text-xs font-semibold px-2 py-2 rounded-lg ${layer === item.id ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-200 hover:bg-white/5'}`}>
                  {item.label}
                </button>
              ))}
              <button onClick={() => { fitCurrentField(); setLayerMenu(false); }} className="w-full min-h-[44px] rounded-lg border-t border-white/10 px-2 text-left text-xs font-bold text-emerald-300" data-testid="map-fit-field">FIT FIELD</button>
            </div>
          )}
        </div>
        <button
          className={`${rnd} !text-xs ${terrain3d ? 'ring-2 ring-emerald-400' : ''}`}
          onClick={() => setTerrain3d((value) => !value)}
          data-testid="map-3d-toggle"
          title={terrain3d ? 'Przełącz na mapę 2D' : 'Przełącz na mapę terenu 3D'}
        >
          {terrain3d ? '2D' : '3D'}
        </button>
        <button className={rnd} onClick={() => mapApi.current?.zoomIn()} data-testid="map-zoom-in">+</button>
        <button className={rnd} onClick={() => mapApi.current?.zoomOut()} data-testid="map-zoom-out">−</button>
        <button className={`${rnd} !text-[9px] ${terminal ? 'ring-1 ring-emerald-400' : ''}`} onClick={() => setTerminal((value) => !value)} data-testid="terminal-toggle" aria-label={terminal ? 'Zamknij terminal' : 'Tryb terminala'} title={terminal ? 'Wyjdź z terminala' : 'Tryb terminala'}>{terminal ? 'EXIT' : 'TERM'}</button>
        <button className={rnd} onClick={toggleFs} data-testid="map-fullscreen" aria-label="Pełny ekran mapy">⛶</button>
      </div>

      <div className="absolute left-2 top-24 z-[62] flex flex-col gap-1.5" data-testid="left-map-controls">
        <button data-testid="set-a-btn" onClick={setA} disabled={!fix} className={`h-11 w-11 rounded-xl font-black text-white shadow-sm disabled:opacity-40 ${pointA ? 'bg-emerald-700/90' : 'border border-white/10 bg-[rgba(5,10,15,0.72)]'}`} title="Ustaw punkt A">A</button>
        <button data-testid="set-b-btn" onClick={setB} disabled={!fix || !pointA} className={`h-11 w-11 rounded-xl font-black text-white shadow-sm disabled:opacity-40 ${pointB ? 'bg-red-700/90' : 'border border-white/10 bg-[rgba(5,10,15,0.72)]'}`} title="Ustaw punkt B">B</button>
        {isDemo && (
          <button data-testid="simulate-btn" onClick={startSimulation} className="h-11 w-11 rounded-xl border border-white/10 bg-sky-700/90 text-xl font-black text-white shadow-sm" title="Symuluj przejazd">▶</button>
        )}
        {manualLabel && (
          <button onClick={() => setManualLabel(null)} className={`${rnd} !text-xs`} data-testid="auto-line-btn">AUTO</button>
        )}
      </div>

      {terrain3d && !terminal && (
        <div
          className={`${hud} pointer-events-none absolute right-[3.75rem] top-[38%] z-[61] w-32 p-2`}
          aria-label="Legenda nachylenia terenu wyliczonego z danych wysokościowych DEM"
          data-testid="terrain-slope-legend"
        >
          <div className="text-[10px] font-black uppercase tracking-wide">Nachylenie · DEM</div>
          <div className="mt-2 h-2 rounded-full" style={{ background: 'linear-gradient(90deg, #00be54 0%, #50d238 17%, #e4e418 34%, #ff8512 67%, #ef2e27 100%)' }} />
          <div className="mt-1 flex justify-between text-[9px] tabular-nums opacity-80">
            <span>0–2%</span><span>2–5%</span><span>5–10%</span><span>&gt;10%</span>
          </div>
          <div className="mt-1 text-[9px] leading-tight opacity-70">{terrainReadout.slopePercent === null ? 'SLOPE DATA UNAVAILABLE' : 'Wartość wyliczona z DEM'}</div>
        </div>
      )}

      {!terminal && <div className="pointer-events-none absolute left-2 bottom-28 z-[61] flex flex-col gap-1">
        {nav.activeLine && (
          <div className={`${hud} px-2 py-1`}>
            <span className="text-[9px] font-black">{nav.activeLine.label}</span>
            {nextLine && <span className="ml-2 text-[9px] opacity-70">NEXT {nextLine.label}</span>}
          </div>
        )}
        <div className={`${hud} pointer-events-auto p-1.5`}>
          <Compass heading={heading} speed={speedKmh} night={dark} fromGps={!headingFromCompass} />
        </div>
      </div>}

      {nav.distanceToEnd < 40 && nav.distanceToEnd > 0 && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-20 ${hud} px-3 py-1.5 text-sm font-bold`} data-testid="turn-warning">
          KONIEC LINII ZA {Math.round(nav.distanceToEnd)} m · ↶ NAWRÓT
        </div>
      )}

      {noGps && <button onClick={() => { stopSimTimer(); demoSimulationStartedRef.current = false; setIsDemo(true); }} className="absolute left-2 top-40 z-[62] min-h-9 rounded-xl border border-sky-300/30 bg-[rgba(5,10,15,0.78)] px-2.5 text-[10px] font-bold text-sky-200 backdrop-blur-md" data-testid="no-gps-demo-btn">🧪 DEMO</button>}
      {device.needsPermission && !device.granted && !isDemo && (
        <button onClick={device.requestPermission} className={`absolute left-1/2 -translate-x-1/2 top-32 ${hud} px-4 py-2 text-sm font-semibold`} data-testid="compass-permission-btn">
          🧭 Włącz kompas (iOS)
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[61]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {toolsOpen && !terminal && (
          <div className={`pointer-events-auto mx-2 mb-2 max-h-[55vh] overflow-y-auto ${hud} p-3 space-y-3`} data-testid="tools-drawer">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
              <span className="mr-auto text-xs font-semibold">📡 GNSS: {serial.connected ? (serial.snap?.quality === 'rtk-fixed' ? 'RTK FIX' : serial.snap?.quality === 'rtk-float' ? 'RTK FLOAT' : 'POŁĄCZONO') : 'ROZŁĄCZONO'}</span>
              <select
                aria-label="Prędkość portu szeregowego"
                disabled={serial.connected || !serial.supported}
                value={serial.baud}
                onChange={(event) => serial.setBaud(Number(event.target.value))}
                className="min-h-[36px] rounded-lg border border-white/20 bg-black/40 px-2 text-xs text-white"
              >
                {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate} baud</option>)}
              </select>
              {serial.connected
                ? <button onClick={() => { void serial.disconnect(); }} className="min-h-[36px] rounded-lg bg-red-600 px-3 text-xs font-bold">Rozłącz RTK</button>
                : <button disabled={!serial.supported} onClick={() => { void serial.connect(); }} className="min-h-[36px] rounded-lg bg-sky-600 px-3 text-xs font-bold disabled:opacity-40">Połącz RTK</button>}
              {serial.error && <span role="alert" className="w-full text-xs text-red-300">{serial.error}</span>}
            </div>
            {geometry && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase opacity-70">Offset korekta</div>
                  <div className="flex items-center gap-1 mt-1">
                    <button onClick={() => setOffsetCorr((o) => o - 0.1)} className="min-h-[40px] w-10 rounded-lg bg-white/10 font-bold">-</button>
                    <span className="flex-1 text-center text-sm font-bold tabular-nums">{offsetCorr >= 0 ? '+' : ''}{offsetCorr.toFixed(2)} m</span>
                    <button onClick={() => setOffsetCorr((o) => o + 0.1)} className="min-h-[40px] w-10 rounded-lg bg-white/10 font-bold">+</button>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase opacity-70">Przesunięcie linii</div>
                  <div className="flex items-center gap-1 mt-1">
                    <button onClick={() => setShift((s) => s - 0.1)} className="min-h-[40px] w-10 rounded-lg bg-white/10 font-bold">-</button>
                    <span className="flex-1 text-center text-sm font-bold tabular-nums">{shift >= 0 ? '+' : ''}{shift.toFixed(2)} m</span>
                    <button onClick={() => setShift((s) => s + 0.1)} className="min-h-[40px] w-10 rounded-lg bg-white/10 font-bold">+</button>
                  </div>
                </div>
              </div>
            )}
            {config.mode === 'kontur' && (
              !recordingContour ? (
                <button onClick={() => { setContour([]); setRecordingContour(true); notify('Przejedź pierwsze okrążenie pola'); }} className="w-full min-h-[44px] rounded-xl bg-sky-600 text-white font-bold">Zapisz kontur pola</button>
              ) : (
                <button onClick={() => { setRecordingContour(false); if (contour.length >= 3) { setPointA(contour[0]); setPointB(contour[1]); notify('Kontur zapisany — linie wygenerowane'); } else notify('Za mało punktów do zapisu konturu', 'err'); }} className="w-full min-h-[44px] rounded-xl bg-amber-600 text-white font-bold">Zakończ zapis konturu</button>
              )
            )}
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { l: '🔊 Głos', on: voice, set: () => setVoice((v) => !v), t: 'toggle-voice' },
                { l: '📳 Wibracje', on: vibrate, set: () => setVibrate((v) => !v), t: 'toggle-vibrate' },
                { l: '💡 Lightbar', on: lightbar, set: () => setLightbar((v) => !v), t: 'toggle-lightbar' },
                { l: '🌙 Noc', on: night, set: () => { setNight((v) => !v); setTerminal(false); }, t: 'toggle-night' },
                { l: '🖥️ Terminal', on: terminal, set: () => { setTerminal((v) => !v); setNight(false); }, t: 'toggle-terminal' },
                { l: '📍 Śledź', on: follow, set: () => { const enabled = !follow; setFollow(enabled); if (terrain3d) setTerrainCameraMode(enabled ? 'follow' : 'free'); }, t: 'toggle-follow' },
                { l: '💡 Ekran', on: keepScreen, set: () => setKeepScreen((v) => !v), t: 'toggle-wakelock' },
              ].map((s) => (
                <button key={s.l} data-testid={s.t} onClick={s.set} className="flex items-center justify-between gap-1 min-h-[40px] px-2 rounded-lg border border-white/10">
                  <span>{s.l}</span>
                  <span className={`w-8 h-4 rounded-full relative ${toggleCls(s.on)}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${s.on ? 'left-4' : 'left-0.5'}`} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-[5.75rem] left-1/2 w-[min(420px,calc(100vw-5rem))] -translate-x-1/2">
          {lightbar && (
            geometry ? (
              <div className={`${hud} px-2 py-1.5`}><GuidanceBar info={nav} night={dark} /></div>
            ) : (
              <div className={`${hud} px-2 py-1 text-center text-[10px] font-semibold opacity-80`}>Ustaw A i B — linie wygenerują się automatycznie</div>
            )
          )}
        </div>

        <div className="pointer-events-auto mx-2 mb-2 flex items-center justify-between gap-2">
          <button onClick={() => setToolsOpen((v) => !v)} data-testid="tools-btn" className={`${rnd} !h-10 !w-10 !text-sm`} aria-label="Ustawienia i narzędzia">⚙</button>
          <div className={`${hud} pointer-events-none flex min-w-0 flex-1 items-center justify-center gap-2 px-2 py-1 text-[9px] tabular-nums sm:max-w-[420px]`}>
            <span className="font-black">{nav.activeLine?.label ?? 'L--'}</span>
            <span>{Math.abs(nav.xte).toFixed(2)} m {nav.steer === 'left' ? '←' : nav.steer === 'right' ? '→' : '·'}</span>
            <span>{speedKmh.toFixed(1)} km/h</span>
            <span>{Math.round(coverage.coveragePercent)}%</span>
          </div>
          {!paused ? (
            <button data-testid="pause-btn" onClick={() => setPaused(true)} className="h-10 rounded-xl bg-amber-600 px-3 text-xs font-black text-white shadow-sm">⏸</button>
          ) : (
            <button data-testid="resume-work-btn-bar" onClick={() => setPaused(false)} className="h-10 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white shadow-sm">▶</button>
          )}
          <button data-testid="end-work-btn-2" onClick={finishWork} className="h-10 rounded-xl bg-red-600 px-3 text-xs font-black text-white shadow-sm">■</button>
        </div>
      </div>

      {paused && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm" data-testid="paused-overlay">
          <div className="text-center">
            <div className="text-2xl font-black text-amber-400 mb-4">⏸ PRACA WSTRZYMANA</div>
            <button data-testid="resume-work-btn" onClick={() => setPaused(false)} className="min-h-[56px] px-10 rounded-2xl bg-emerald-600 text-white text-lg font-black shadow-xl">▶ WZNÓW</button>
          </div>
        </div>
      )}
    </div>
  );
}
