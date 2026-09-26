import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Sky } from '@react-three/drei';
import * as THREE from 'three';

const TilledSoilCoverage = ({ implementType, zPos }: { implementType: 'sprayer' | 'cultivator'; zPos: number }) => {
  const width = implementType === 'sprayer' ? 24.0 : 6.0;
  const length = Math.max(0.1, zPos - (-20));

  return (
    <mesh position={[0, 0.02, -20 + length / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, length, 1, 1]} />
      <meshStandardMaterial
        color={implementType === 'cultivator' ? '#271910' : '#0284c7'}
        roughness={0.9}
        transparent
        opacity={implementType === 'cultivator' ? 0.85 : 0.4}
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

const TractorUnit = ({ implementType, onPositionUpdate }: { implementType: 'sprayer' | 'cultivator'; onPositionUpdate: (z: number) => void; }) => {
  const tractorRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (tractorRef.current) {
      const z = (clock.getElapsedTime() * 3) % 40 - 20;
      const x = 0;
      tractorRef.current.position.set(x, 0.1, z);
      onPositionUpdate(z);
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
      {implementType === 'sprayer' ? <SprayerImplement /> : <CultivatorImplement />}
    </group>
  );
};

const FieldTerrain = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[200, 200, 32, 32]} />
      <meshStandardMaterial color="#3f6212" roughness={0.8} />
    </mesh>
  );
};

export const FieldPilot3DView = () => {
  const [machine, setMachine] = useState<'sprayer' | 'cultivator'>('cultivator');
  const [tractorZ, setTractorZ] = useState<number>(-20);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', background: '#090d16', color: '#fff' }}>
      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[0, 8, 16]} fov={55} />
        <OrbitControls target={[0, 1.2, 0]} maxPolarAngle={Math.PI / 2.02} minDistance={3} maxDistance={40} />
        <Sky sunPosition={[100, 40, 100]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[25, 45, 15]} intensity={1.2} castShadow />
        <FieldTerrain />
        <TilledSoilCoverage implementType={machine} zPos={tractorZ} />
        <TractorUnit implementType={machine} onPositionUpdate={setTractorZ} />
      </Canvas>
      <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: '10px' }}>
        <button
          onClick={() => setMachine('cultivator')}
          style={{ background: machine === 'cultivator' ? '#22c55e' : '#1e293b', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Agregat (6.0 m)
        </button>
        <button
          onClick={() => setMachine('sprayer')}
          style={{ background: machine === 'sprayer' ? '#22c55e' : '#1e293b', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Opryskiwacz (24.0 m)
        </button>
      </div>
    </div>
  );
};
