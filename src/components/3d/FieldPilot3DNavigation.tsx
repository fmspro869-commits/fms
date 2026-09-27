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

interface FieldPilot3DProps {
  position: Position | null;
  track: [number, number][];
  geometry?: unknown;
  info?: GuidanceInfo;
  implementWidth?: number;
  heading?: number | null;
  speedKmh?: number;
  isDemo?: boolean;
}

const convertGpsToLocalMeters = (lat: number, lng: number, refLat: number, refLng: number) => {
  const metersPerLat = 111132.92;
  const metersPerLng = 111412.84 * Math.cos((refLat * Math.PI) / 180);
  return {
    x: (lng - refLng) * metersPerLng,
    z: -(lat - refLat) * metersPerLat,
  };
};

// Ostra, dynamiczna struktura gleby pola
const HighResFieldTerrain = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[500, 500]} />
      <meshStandardMaterial 
        color="#2d3a1e" 
        roughness={0.9} 
        metalness={0.1} 
      />
    </mesh>
  );
};

// Realistyczny model ciągnika 3D
const ProfessionalTractor = ({ implementWidth = 6 }: { implementWidth?: number }) => {
  return (
    <group>
      {/* Maska i silnik */}
      <mesh position={[0, 1.1, 0.8]} castShadow>
        <boxGeometry args={[1.8, 1.2, 2.4]} />
        <meshStandardMaterial color="#16a34a" roughness={0.3} />
      </mesh>
      {/* Kabina ze szkłem */}
      <mesh position={[0, 2.0, -0.2]}>
        <boxGeometry args={[1.5, 1.3, 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.1} transparent opacity={0.75} />
      </mesh>
      {/* Dwa duże tylne koła */}
      {[-1.0, 1.0].map((x, i) => (
        <mesh key={i} position={[x, 0.9, -0.5]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.85, 0.85, 0.5, 24]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      ))}
      {/* Dwa przednie koła */}
      {[-0.9, 0.9].map((x, i) => (
        <mesh key={i} position={[x, 0.55, 1.4]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.55, 0.55, 0.4, 20]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      ))}
      {/* Belka narzędzia / Maszyny z tyłu */}
      <mesh position={[0, 0.5, -2.2]}>
        <boxGeometry args={[implementWidth, 0.25, 0.4]} />
        <meshStandardMaterial color="#ef4444" metalness={0.5} />
      </mesh>
    </group>
  );
};

// Świecąca, trójwymiarowa linia przejazdu AB
const Guideline3D = ({ xte = 0 }: { xte?: number }) => {
  return (
    <mesh position={[xte, 0.05, -50]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.3, 200]} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} side={THREE.DoubleSide} />
    </mesh>
  );
};

export const FieldPilot3DNavigation: React.FC<FieldPilot3DProps> = ({
  position,
  track = [],
  info,
  implementWidth = 6,
  heading = 0,
  speedKmh = 0,
  isDemo = false,
}) => {
  const tractorGroupRef = useRef<THREE.Group>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  const refPos = useMemo(() => {
    if (position) return { lat: position.lat, lng: position.lng };
    if (track.length > 0) return { lat: track[0][0], lng: track[0][1] };
    return { lat: 52.2297, lng: 21.0122 };
  }, []);

  useFrame(() => {
    if (position && tractorGroupRef.current && cameraRef.current) {
      const { x, z } = convertGpsToLocalMeters(position.lat, position.lng, refPos.lat, refPos.lng);
      
      // Ustawienie pozycji ciągnika
      tractorGroupRef.current.position.set(x, 0, z);
      
      const radHeading = -((heading ?? 0) * Math.PI) / 180;
      tractorGroupRef.current.rotation.y = radHeading;

      // Dynamiczna kamera podążająca TUŻ ZA KABINĄ (Perspektywa TPV)
      const camOffsetDistance = 9; // Metry za ciągnikiem
      const camHeight = 4.5;       // Wysokość nad ziemią

      const camX = x + Math.sin(radHeading) * camOffsetDistance;
      const camZ = z + Math.cos(radHeading) * camOffsetDistance;

      cameraRef.current.position.set(camX, camHeight, camZ);
      cameraRef.current.lookAt(x, 1.2, z - Math.cos(radHeading) * 5);
    }
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020617' }}>
      <Canvas shadows>
        <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 5, 10]} fov={60} />
        <OrbitControls enablePan={false} maxPolarAngle={Math.PI / 2.1} minDistance={3} maxDistance={25} />
        
        {/* Realistyczne oświetlenie ze słońcem */}
        <Sky sunPosition={[100, 30, 100]} inclination={0.2} azimuth={0.25} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[50, 40, 20]} intensity={1.5} castShadow />

        {/* Podłoże pola */}
        <HighResFieldTerrain />

        {/* Aktywna linia AB w 3D */}
        <Guideline3D xte={info?.xte || 0} />

        {/* Ciągnik w podążającej grupie */}
        <group ref={tractorGroupRef}>
          <ProfessionalTractor implementWidth={implementWidth} />
        </group>
      </Canvas>
    </div>
  );
};
