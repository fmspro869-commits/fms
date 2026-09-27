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
  const [leftControlsOpen, setLeftControlsOpen] = useState(true);
  const [rightControlsOpen, setRightControlsOpen] = useState(true);
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const demoSimulationStartedRef = useRef(false);
  const mapApi = useRef<MapHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const serial = useSerialNmea();

  const field = isDemo ? DEMO_FIELD : state.fields.find((f) => f.id === config.fieldId);
  const device = useDeviceHeading(phase === 'running' && !isDemo);
  const speech = useSpeechAlerts(voice);
  const wake = useWakeLock();
  const { position, status: gnssStatus, demoProvider, error } = usePosition({
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

  const overlap = useMemo(() => {
    const half = config.width / 2;
    const a = Math.abs(nav.xte);
    return geometry && a > half ? a - half : 0;
  }, [geometry, nav, config.width]);

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
  const progressPct = stats.totalLines > 0 ? Math.min(100, (stats.linesDone / stats.totalLines) * 100) : coverage.coveragePercent;
  const acc = isDemo ? (fix?.accuracy ?? 1) : fix?.accuracy ?? 0;
  const gpsDot = noGps ? '🔴'
    : gnssStatus.fixType === 'RTK_FIX' ? '🟢'
    : gnssStatus.fixType === 'RTK_FLOAT' ? '🟡'
    : gnssStatus.fixType === 'GNSS' ? '🔵'
    : acc <= 5 ? '🟢' : acc <= 10 ? '🟡' : '🔴';
  const toggleCls = (on: boolean) => (on ? (dark ? 'bg-[#ff3b30]' : 'bg-emerald-500') : 'bg-slate-600');
  const rnd = `w-10 h-10 flex items-center justify-center rounded-xl backdrop-blur-md border text-lg font-bold shadow-lg active:scale-90 transition-transform ${dark ? 'bg-black/60 border-[#ff3b30]/30' : 'bg-slate-900/60 border-white/10'}`;
  const hud = `rounded-2xl border backdrop-blur-md shadow-xl ${dark ? 'bg-black/70 border-[#ff3b30]/30 text-[#ff5a52]' : 'bg-slate-900/65 border-white/10 text-white'}`;
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

      <div className="absolute left-0 right-0 top-0 flex items-start justify-between gap-2 p-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
        <div className={`${hud} px-3 py-2 max-w-[52%]`}>
          <div className={`text-[11px] font-black tracking-wide ${dark ? 'text-[#ff5a52]' : 'text-emerald-400'}`}>🚜 FMS FIELD PILOT</div>
          <div className="text-sm font-bold leading-tight truncate" data-testid={isDemo ? 'demo-field-label' : undefined}>{field?.name || '—'}</div>
          <div className={`text-[10px] ${dark ? 'text-[#ff5a52]/70' : 'text-slate-300'}`}>{isDemo ? '🧪 GRANICA ORIENTACYJNA · ' : cropName ? `${cropName}${fieldCrop ? ` · BBCH ${fieldCrop.bbch}` : ''} · ` : ''}{config.treatmentType} · {config.width.toFixed(2)} m</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`${hud} px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1`}>
            <span className="text-[10px] font-bold tabular-nums" data-testid="hud-gps">{isDemo ? '🧪 DEMO' : `${gpsDot} ${gnssStatus.fixType === 'NONE' ? 'NO GPS' : gnssStatus.fixType}`} · {position?.accuracy != null ? `±${position.accuracy.toFixed(1)} m` : '±—'}</span>
            <span className="text-[10px] font-bold tabular-nums">SAT {position?.satellites ?? '—'} · {speedKmh.toFixed(1)} km/h</span>
            <span className="text-[10px] font-bold tabular-nums">HEADING {heading !== null ? `${Math.round(heading)}°` : '—'}</span>
            <span className="text-[10px] font-bold tabular-nums">ELEV {terrainReadout.elevation !== null ? `${terrainReadout.elevation.toFixed(0)} m DEM` : 'DATA UNAVAILABLE'}</span>
            <span className="text-[10px] font-bold tabular-nums">SLOPE {terrainReadout.slopePercent !== null ? `${terrainReadout.slopePercent >= 0 ? '+' : ''}${terrainReadout.slopePercent.toFixed(1)}%` : 'DATA UNAVAILABLE'}</span>
            <span className={`text-[10px] font-black tabular-nums ${dark ? 'text-[#ff5a52]' : 'text-amber-300'}`}>{nav.activeLine ? `${nav.activeLine.label} ACTIVE` : 'L--'} / {stats.totalLines || '--'}</span>
            <button data-testid="end-work-btn" onClick={finishWork} className="col-span-2 ml-auto min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold">🛑 ZAKOŃCZ</button>
          </div>
          {isDemo && <span className="rounded-full bg-sky-500/90 text-white text-[10px] font-black px-2 py-0.5 animate-pulse shadow-lg" data-testid="demo-badge">🧪 DEMO — SYMULACJA GPS</span>}
          {!isDemo && acc > 5 && !noGps && <span className="rounded-full bg-amber-500/90 text-black text-[10px] font-black px-2 py-0.5" data-testid="gps-warn">⚠ NISKA DOKŁADNOŚĆ GPS</span>}
          {!isDemo && gnssStatus.fixType === 'RTK_FIX' && <span className="rounded-full bg-emerald-500/90 text-black text-[10px] font-black px-2 py-0.5" data-testid="rtk-fix-badge">🟢 RTK FIX</span>}
          {!isDemo && gnssStatus.fixType === 'RTK_FLOAT' && <span className="rounded-full bg-amber-500/90 text-black text-[10px] font-black px-2 py-0.5" data-testid="rtk-float-badge">🟡 RTK FLOAT</span>}
          {!isDemo && gnssStatus.source === 'EXTERNAL_GNSS' && gnssStatus.fixType !== 'RTK_FIX' && gnssStatus.fixType !== 'RTK_FLOAT' && <span className="rounded-full bg-sky-500/90 text-black text-[10px] font-black px-2 py-0.5" data-testid="external-gnss-badge">📡 EXTERNAL</span>}
        </div>
      </div>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-[62]" data-testid="right-map-controls">
        <button className={`${rnd} !text-xs`} onClick={() => setRightControlsOpen((open) => !open)} aria-label={rightControlsOpen ? 'Zwiń prawe kontrolki mapy' : 'Rozwiń prawe kontrolki mapy'} aria-expanded={rightControlsOpen} title={rightControlsOpen ? 'Zwiń kontrolki mapy' : 'Rozwiń kontrolki mapy'} data-testid="toggle-right-map-controls">
          {rightControlsOpen ? '×' : '⋮'}
        </button>
        {rightControlsOpen && <>
        {terrain3d && <div className="relative">
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
        </div>}
        {!terrain3d && <div className="relative">
          <button className={rnd} onClick={() => setLayerMenu((v) => !v)} data-testid="map-layer-btn">🗺️</button>
          {layerMenu && (
            <div className={`absolute right-14 top-0 ${hud} p-1 w-32`}>
              {LAYERS.map((l) => (
                <button key={l.id} data-testid={`layer-${l.id}`} onClick={() => { setLayer(l.id); setLayerMenu(false); }} className={`w-full text-left text-xs font-semibold px-2 py-2 rounded-lg ${layer === l.id ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-200 hover:bg-white/5'}`}>
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>}
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
        <button className={`${rnd} !text-xs`} onClick={fitCurrentField} data-testid="map-fit-field" title="Dopasuj widok do pola" aria-label="Dopasuj widok do pola">FIT</button>
        <button className={rnd} onClick={() => mapApi.current?.center()} data-testid="map-center">◎</button>
        <button className={`${rnd} ${courseUp ? (dark ? 'ring-2 ring-[#ff3b30]' : 'ring-2 ring-emerald-400') : ''}`} onClick={() => terrain3d ? setTerrainCamera(terrainCameraMode === 'course-up' ? 'north-up' : 'course-up') : setCourseUp((v) => !v)} data-testid="map-rotate">🧭</button>
        <button className={rnd} onClick={toggleFs} data-testid="map-fullscreen">⛶</button>
        </>}
      </div>

      <div className="absolute left-2 top-24 flex flex-col gap-1.5 z-[62]" data-testid="left-map-controls">
        <button className={`${rnd} !text-xs`} onClick={() => setLeftControlsOpen((open) => !open)} aria-label={leftControlsOpen ? 'Zwiń lewe kontrolki mapy' : 'Rozwiń lewe kontrolki mapy'} aria-expanded={leftControlsOpen} title={leftControlsOpen ? 'Zwiń kontrolki mapy' : 'Rozwiń kontrolki mapy'} data-testid="toggle-left-map-controls">
          {leftControlsOpen ? '×' : '⋮'}
        </button>
        {leftControlsOpen && <>
        <button data-testid="set-a-btn" onClick={setA} disabled={!fix} className={`w-10 h-10 rounded-xl font-black text-white shadow-lg disabled:opacity-40 ${pointA ? 'bg-emerald-700' : 'bg-emerald-600'}`} title="Ustaw punkt A">A</button>
        <button data-testid="set-b-btn" onClick={setB} disabled={!fix || !pointA} className={`w-10 h-10 rounded-xl font-black text-white shadow-lg disabled:opacity-40 ${pointB ? 'bg-red-700' : 'bg-red-600'}`} title="Ustaw punkt B">B</button>
        {isDemo && (
          <button data-testid="simulate-btn" onClick={startSimulation} className="w-10 h-10 rounded-xl bg-sky-600 text-white text-xl font-black shadow-lg" title="Symuluj przejazd">▶</button>
        )}
        {manualLabel && (
          <button onClick={() => setManualLabel(null)} className={`${rnd} !text-xs`} data-testid="auto-line-btn">AUTO</button>
        )}
        </>}
      </div>

      {terrain3d && (
        <div
          className={`${hud} pointer-events-none absolute right-16 top-[38%] z-[61] w-36 p-2.5`}
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

      <div className="absolute left-2 bottom-40 flex flex-col gap-2 z-[61]">
        {nav.activeLine && (
          <div className={`${hud} px-3 py-1.5`}>
            <span className="text-[10px] uppercase opacity-70">Aktywna linia</span>
            <div className="flex items-center gap-2">
              <span className={`text-base font-black ${dark ? 'text-[#ff5a52]' : 'text-amber-300'}`}>{nav.activeLine.label}</span>
              <span className="text-xs tabular-nums">{Math.abs(nav.xte).toFixed(2)} m</span>
              <span className="text-sm">{nav.steer === 'left' ? '↶' : nav.steer === 'right' ? '↷' : '•'}</span>
            </div>
            {nextLine && <div className="text-[10px] opacity-70">NEXT {nextLine.label}</div>}
          </div>
        )}
        <div className={`${hud} p-2`}>
          <Compass heading={heading} speed={speedKmh} night={dark} fromGps={!headingFromCompass} />
        </div>
      </div>

      {nav.distanceToEnd < 40 && nav.distanceToEnd > 0 && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-20 ${hud} px-3 py-1.5 text-sm font-bold`} data-testid="turn-warning">
          KONIEC LINII ZA {Math.round(nav.distanceToEnd)} m · ↶ NAWRÓT
        </div>
      )}

      {noGps && (
        <div className={`absolute left-1/2 top-1/3 -translate-x-1/2 ${hud} p-4 text-center w-72`} data-testid="no-gps">
          <div className="font-bold text-red-400">🔴 GPS niedostępny</div>
          {error && <div className="text-xs opacity-80 mt-1">{error}</div>}
          <button onClick={() => { stopSimTimer(); demoSimulationStartedRef.current = false; setIsDemo(true); }} className="mt-3 min-h-[44px] px-4 rounded-xl bg-sky-600 text-white font-bold w-full">🧪 DEMO</button>
        </div>
      )}
      {device.needsPermission && !device.granted && !isDemo && (
        <button onClick={device.requestPermission} className={`absolute left-1/2 -translate-x-1/2 top-32 ${hud} px-4 py-2 text-sm font-semibold`} data-testid="compass-permission-btn">
          🧭 Włącz kompas (iOS)
        </button>
      )}

      <div className="absolute left-0 right-0 bottom-0 z-[61]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {toolsOpen && (
          <div className={`mx-2 mb-2 ${hud} p-3 space-y-3`} data-testid="tools-drawer">
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

        <div className={`mx-2 mb-2 ${hud} p-3`}>
          {lightbar && (
            geometry ? (
              <>
                <GuidanceBar info={nav} night={dark} />
                <div className={`flex justify-between text-[9px] mt-1 px-1 tabular-nums ${dark ? 'text-[#ff5a52]/60' : 'text-slate-400'}`}>
                  <span>-2</span><span>-1</span><span>-0.5</span><span className="font-black opacity-100">0</span><span>+0.5</span><span>+1</span><span>+2</span>
                </div>
              </>
            ) : (
              <div className="text-center py-2 text-sm font-bold opacity-80">Ustaw A i B (klik na mapie lub przyciski) — linie wygenerują się automatycznie</div>
            )
          )}
          <div className={`h-2 rounded-full overflow-hidden mt-2 ${dark ? 'bg-[#2a0808]' : 'bg-white/10'}`}>
            <div className="h-full transition-all" style={{ width: `${progressPct}%`, background: dark ? '#ff3b30' : '#10b981' }} />
          </div>
          <div className="flex justify-between text-[10px] mt-1 tabular-nums">
            <span>Pokrycie {Math.round(coverage.coveragePercent)}%{overlap > 0.05 ? ` · ⚠️ NAKŁADKA ${overlap.toFixed(2)} m` : ''}</span>
            <span>{coverage.areaCoveredHa.toFixed(1)} / {stats.fieldArea.toFixed(1)} ha · {(stats.distance / 1000).toFixed(1)} km</span>
          </div>
          {geometry && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] mt-1.5 opacity-80">
              <span className="flex items-center gap-1"><i className={`inline-block w-3 h-1 rounded ${dark ? 'bg-[#ff3b30]' : 'bg-yellow-400'}`} />aktywna</span>
              <span className="flex items-center gap-1"><i className="inline-block w-3 h-1 rounded" style={{ background: dark ? '#6b7280' : '#94a3b8' }} />wykonane</span>
              <span className="flex items-center gap-1"><i className="inline-block w-3 h-1 rounded" style={{ background: dark ? '#ff8a80' : '#34d399' }} />pozostałe</span>
              <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#f97316' }} />nakładka</span>
            </div>
          )}
        </div>

        <div className="mx-2 mb-3 flex gap-2">
          <button onClick={() => setToolsOpen((v) => !v)} data-testid="tools-btn" className={`${hud} w-14 flex items-center justify-center text-xl`}>⚙</button>
          {!paused ? (
            <button data-testid="pause-btn" onClick={() => setPaused(true)} className="flex-1 min-h-[56px] rounded-2xl bg-amber-600 text-white text-base font-black shadow-lg">⏸ PAUZA</button>
          ) : (
            <button data-testid="resume-work-btn-bar" onClick={() => setPaused(false)} className="flex-1 min-h-[56px] rounded-2xl bg-emerald-600 text-white text-base font-black shadow-lg">▶ WZNÓW</button>
          )}
          <button data-testid="end-work-btn-2" onClick={finishWork} className="flex-1 min-h-[56px] rounded-2xl bg-red-600 text-white text-base font-black shadow-lg">🛑 ZAKOŃCZ</button>
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
