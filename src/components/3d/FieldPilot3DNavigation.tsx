import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Sky } from '@react-three/drei';
import * as THREE from 'three';

interface GuidanceInfo {
  activeLine: { label: string } | null;
  activeIndex: number;
  xte: number;
  steer: 'left' | 'right' | 'center';
  quality: string;
  distanceToEnd: number;
}

interface Position {
  lat: number;
  lng: number;
  heading: number | null;
}

export interface FieldPilot3DProps {
  position?: Position | null;
  track?: [number, number][];
  geometry?: unknown;
  fieldGeo?: [number, number][];
  speed?: number;
  info?: GuidanceInfo;
  implementWidth?: number;
  heading?: number | null;
  speedKmh?: number;
  isDemo?: boolean;
}

const convertGpsToLocalMeters = (
  lat: number,
  lng: number,
  refLat: number,
  refLng: number
) => {
  const metersPerLat = 111132.92;
  const metersPerLng = 111412.84 * Math.cos((refLat * Math.PI) / 180);

  const x = (lng - refLng) * metersPerLng;
  const z = -(lat - refLat) * metersPerLat;
  return { x, z };
};

const TilledSoilCoverage = ({ width, length }: { width: number; length: number }) => {
  return (
    <mesh position={[0, 0.02, -length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, Math.max(1, length), 1, 1]} />
      <meshStandardMaterial
        color="#271910"
        roughness={0.95}
        metalness={0.05}
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

const CultivatorImplement = () => (
  <group position={[0, 0, -1.8]}>
    <mesh position={[0, 0.4, 0]}>
      <boxGeometry args={[6.0, 0.15, 1.8]} />
      <meshStandardMaterial color="#dc2626" roughness={0.4} />
    </mesh>
    {[-2.7, -1.8, -0.9, 0, 0.9, 1.8, 2.7].map((x, i) => (
      <group key={i} position={[x, 0.2, 0.3]}>
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <cylinderGeometry args={[0.25, 0.25, 0.05, 12]} />
          <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>
    ))}
  </group>
);

const SprayerImplement = () => (
  <group position={[0, 0.5, -1.8]}>
    <mesh position={[0, 0.6, 0.5]}>
      <cylinderGeometry args={[0.7, 0.7, 1.8, 16]} />
      <meshStandardMaterial color="#facc15" roughness={0.3} />
    </mesh>
    <mesh position={[0, 0.4, -0.6]}>
      <boxGeometry args={[24.0, 0.3, 0.2]} />
      <meshStandardMaterial color="#1e293b" />
    </mesh>
  </group>
);

const TractorUnit = ({
  position,
  heading,
  implementWidth = 6,
  refPos,
  onPositionUpdate,
}: {
  position: Position | null;
  heading: number | null;
  implementWidth?: number;
  refPos: { lat: number; lng: number };
  onPositionUpdate: (z: number, x: number) => void;
}) => {
  const tractorRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (tractorRef.current && position) {
      const { x, z } = convertGpsToLocalMeters(position.lat, position.lng, refPos.lat, refPos.lng);

      tractorRef.current.position.set(x, 0.1, z);

      if (heading !== null && Number.isFinite(heading)) {
        tractorRef.current.rotation.y = -(heading * Math.PI) / 180;
      }

      onPositionUpdate(z, x);
    }
  });

  return (
    <group ref={tractorRef}>
      <mesh position={[0, 0.9, 0.6]} castShadow>
        <boxGeometry args={[1.7, 1.3, 2.6]} />
        <meshStandardMaterial color="#15803d" roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.85, 0.3]}>
        <boxGeometry args={[1.35, 1.1, 1.2]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.8} />
      </mesh>
      {implementWidth > 15 ? <SprayerImplement /> : <CultivatorImplement />}
    </group>
  );
};

const FieldTerrain = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[300, 300, 32, 32]} />
      <meshStandardMaterial color="#3f6212" roughness={0.8} />
    </mesh>
  );
};

const TrackLine = ({ track, refPos }: { track: [number, number][]; refPos: { lat: number; lng: number } }) => {
  const points = useMemo(() => {
    return track.map(([lat, lng]) => {
      const { x, z } = convertGpsToLocalMeters(lat, lng, refPos.lat, refPos.lng);
      return new THREE.Vector3(x, 0.15, z);
    });
  }, [track, refPos]);

  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const lineObject = useMemo(() => {
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#10b981', linewidth: 3 }));
  }, [geometry]);

  if (points.length < 2) return null;

  return <primitive object={lineObject} />;
};

export const FieldPilot3DNavigation: React.FC<FieldPilot3DProps> = ({
  position = null,
  track = [],
  info,
  implementWidth = 6,
  heading = null,
  speedKmh = 0,
  isDemo = false,
}) => {
  const [tractorZ, setTractorZ] = useState(0);
  const [tractorX, setTractorX] = useState(0);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  const refPos = useMemo(() => {
    if (position) return { lat: position.lat, lng: position.lng };
    if (track.length > 0) return { lat: track[0][0], lng: track[0][1] };
    return { lat: 52.2297, lng: 21.0122 };
  }, []);

  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.position.set(tractorX + 5, 12, tractorZ + 15);
      cameraRef.current.lookAt(tractorX, 2, tractorZ);
    }
  }, [tractorX, tractorZ]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <Canvas shadows>
        <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 12, 15]} fov={55} />
        <OrbitControls target={[tractorX, 2, tractorZ]} maxPolarAngle={Math.PI / 2.2} minDistance={5} maxDistance={40} />
        <Sky sunPosition={[100, 40, 100]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[25, 45, 15]} intensity={1.4} castShadow />

        <FieldTerrain />

        {track.length > 0 && <TrackLine track={track} refPos={refPos} />}

        {track.length > 0 && (
          <TilledSoilCoverage width={implementWidth} length={Math.max(1, Math.sqrt(track.length) * 0.5)} />
        )}

        <TractorUnit
          position={position}
          heading={heading}
          implementWidth={implementWidth}
          refPos={refPos}
          onPositionUpdate={(z, x) => {
            setTractorZ(z);
            setTractorX(x);
          }}
        />
      </Canvas>

      {/* HUD Overlay */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: 20,
        background: 'rgba(0,0,0,0.7)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '12px',
        padding: '16px',
        color: '#fff',
        fontSize: '14px',
        fontFamily: 'monospace',
        maxWidth: '300px',
        backdropFilter: 'blur(10px)',
        zIndex: 10,
      }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#22c55e' }}>
          🚜 NAWIGACJA 3D
        </div>
        <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '6px' }}>
          {`${speedKmh.toFixed(1)} km/h`}
        </div>
        {info?.activeLine && (
          <div style={{ 
            color: info.xte > 0 ? '#ef4444' : '#3b82f6',
            marginBottom: '6px'
          }}>
            {`Linia: ${info.activeLine.label}`}
            <br />
            {`Odchylenie: ${Math.abs(info.xte).toFixed(2)} m ${info.steer}`}
          </div>
        )}
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          {isDemo ? '🧪 DEMO MODE' : '📍 GPS'}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        background: 'rgba(0,0,0,0.7)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '12px',
        padding: '16px',
        color: '#fff',
        fontSize: '12px',
        fontFamily: 'monospace',
        backdropFilter: 'blur(10px)',
        zIndex: 10,
      }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#60a5fa' }}>
          📊 INFORMACJE
        </div>
        <div style={{ marginBottom: '4px' }}>
          Rozstaw: {implementWidth.toFixed(1)} m
        </div>
        <div style={{ marginBottom: '4px' }}>
          Ścieżek: {track.length}
        </div>
        {info?.distanceToEnd && info.distanceToEnd > 0 && (
          <div style={{ color: '#fbbf24' }}>
            Do końca: {info.distanceToEnd.toFixed(0)} m
          </div>
        )}
      </div>
    </div>
  );
};
