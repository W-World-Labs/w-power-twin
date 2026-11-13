import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Device } from "./types";
import type { Telemetry } from "./telemetry";

type Live = RefObject<Telemetry | null>;
const RECEIVER = new THREE.Vector3(0, 174, 0);
const MIRRORS: THREE.Vector3[] = [];
for (let ring = 0; ring < 20; ring++) {
  const radius = 90 + ring * 31;
  const count = Math.floor(2 * Math.PI * radius / 31);
  for (let i = 0; i < count; i++) {
    const a = (i + (ring % 2) * 0.5) / count * Math.PI * 2;
    // Service corridor toward the power block.
    if (Math.sin(a) > 0.98) continue;
    MIRRORS.push(new THREE.Vector3(Math.cos(a) * radius, 5.8, Math.sin(a) * radius));
  }
}
function sun(hour: number) {
  const angle = (hour - 6) / 12 * Math.PI;
  return new THREE.Vector3(-Math.cos(angle), Math.max(0.12, Math.sin(angle)), 0.22).normalize();
}
function Heliostats({ live }: { live: Live }) {
  const mirrors = useRef<THREE.InstancedMesh>(null), poles = useRef<THREE.InstancedMesh>(null);
  const last = useRef(-1);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  useFrame(() => {
    const data = live.current;
    if (!mirrors.current || !poles.current || (data && last.current === data.timestamp_ms)) return;
    last.current = data?.timestamp_ms ?? -1;
    const direction = sun(data?.summary.solar_hour ?? 12);
    const daylight = (data?.summary.dni_wm2 ?? 950) > 0;
    MIRRORS.forEach((pos, i) => {
      const normal = daylight ? RECEIVER.clone().sub(pos).normalize().add(direction).normalize() : up;
      dummy.position.copy(pos); dummy.quaternion.setFromUnitVectors(up, normal); dummy.updateMatrix();
      mirrors.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(pos.x, 2.4, pos.z); dummy.quaternion.identity(); dummy.updateMatrix();
      poles.current!.setMatrixAt(i, dummy.matrix);
    });
    mirrors.current.instanceMatrix.needsUpdate = true; mirrors.current.computeBoundingSphere();
    poles.current.instanceMatrix.needsUpdate = true; poles.current.computeBoundingSphere();
  });
  return <>
    <instancedMesh ref={mirrors} args={[undefined, undefined, MIRRORS.length]} castShadow receiveShadow>
      <boxGeometry args={[12, 0.22, 10]} /><meshStandardMaterial color="#c3d8e1" metalness={0.92} roughness={0.18} />
    </instancedMesh>
    <instancedMesh ref={poles} args={[undefined, undefined, MIRRORS.length]} castShadow>
      <cylinderGeometry args={[0.32, 0.48, 4.8, 5]} /><meshStandardMaterial color="#7b858a" metalness={0.5} roughness={0.7} />
    </instancedMesh>
  </>;
}
function Receiver({ live }: { live: Live }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => { if (glow.current) glow.current.emissiveIntensity = (live.current?.summary.dni_wm2 ?? 950) / 950 * 3; });
  return <>
    <mesh position-y={77} castShadow receiveShadow><cylinderGeometry args={[7, 13, 154, 24]} /><meshStandardMaterial color="#ddd7c9" roughness={0.85} /></mesh>
    <mesh position-y={172} castShadow><cylinderGeometry args={[10, 10, 28, 32]} /><meshStandardMaterial ref={glow} color="#49423c" emissive="#ffb24b" emissiveIntensity={3} roughness={0.65} /></mesh>
    {[156, 188].map(y => <mesh key={y} position-y={y}><cylinderGeometry args={[14, 14, 2, 32]} /><meshStandardMaterial color="#8c969c" metalness={0.7} roughness={0.4} /></mesh>)}
    {[-2, 2].map(x => <mesh key={x} position={[x, 78, 10]}><cylinderGeometry args={[0.7, 0.7, 156, 8]} /><meshStandardMaterial color={x < 0 ? "#e16d45" : "#5d9da5"} metalness={0.6} roughness={0.5} /></mesh>)}
  </>;
}
function Tank({ hot }: { hot: boolean }) {
  const color = hot ? "#d77646" : "#4f9ca8";
  return <>
    <mesh position-y={1}><cylinderGeometry args={[26, 26, 2, 48]} /><meshStandardMaterial color="#b3b0a7" /></mesh>
    <mesh position-y={14} castShadow receiveShadow><cylinderGeometry args={[24, 24, 26, 48]} /><meshStandardMaterial color="#d0d1cc" metalness={0.55} roughness={0.45} /></mesh>
    <mesh position-y={27.5}><coneGeometry args={[24.2, 2, 48]} /><meshStandardMaterial color="#b6bec1" metalness={0.7} roughness={0.4} /></mesh>
    {[3, 24].map(y => <mesh key={y} position-y={y}><cylinderGeometry args={[24.1, 24.1, 1.2, 48]} /><meshStandardMaterial color={color} /></mesh>)}
    <mesh position={[0, 14, 24.4]}><boxGeometry args={[1.2, 26, 0.5]} /><meshStandardMaterial color="#666f76" /></mesh>
    {Array.from({ length: 18 }, (_, i) => <mesh key={i} position={[0, 2 + i * 1.4, 24.8]}><boxGeometry args={[1.7, 0.14, 0.5]} /><meshStandardMaterial color="#666f76" /></mesh>)}
  </>;
}
export function CspDevice({ d, live }: { d: Device; live: Live }) {
  if (d.kind === "heliostat-field") return <Heliostats live={live} />;
  if (d.kind === "csp-receiver") return <Receiver live={live} />;
  if (d.kind === "csp-hot-tank" || d.kind === "csp-cold-tank") return <Tank hot={d.kind === "csp-hot-tank"} />;
  if (d.kind === "csp-pump") return <>
    <mesh position-y={0.7}><boxGeometry args={[12, 1.4, 12]} /><meshStandardMaterial color="#b5b8b2" /></mesh>
    <mesh position-y={4} castShadow><cylinderGeometry args={[2, 2, 5, 16]} /><meshStandardMaterial color="#477f92" metalness={0.5} roughness={0.5} /></mesh>
    <mesh position={[3, 2, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.8, 0.8, 6, 12]} /><meshStandardMaterial color="#c2c7c5" metalness={0.7} roughness={0.3} /></mesh>
  </>;
  if (d.kind === "csp-steam") return <>
    {[-6, 6].map(x => <mesh key={x} position={[x, 17, 0]} castShadow><cylinderGeometry args={[4, 4, 34, 20]} /><meshStandardMaterial color="#c1c8c6" metalness={0.5} roughness={0.5} /></mesh>)}
    {[8, 24, 34].map(y => <mesh key={y} position-y={y}><boxGeometry args={[24, 0.8, 20]} /><meshStandardMaterial color="#6c7477" /></mesh>)}
  </>;
  if (d.kind === "csp-cooler") return <>
    <mesh position-y={12} castShadow><boxGeometry args={[80, 7, 40]} /><meshStandardMaterial color="#aab8bc" metalness={0.5} roughness={0.6} /></mesh>
    {[-30, -10, 10, 30].flatMap(x => [-10, 10].map(z => <mesh key={`${x}/${z}`} position={[x, 16, z]}><cylinderGeometry args={[7, 7, 1, 20]} /><meshStandardMaterial color="#4f6169" /></mesh>))}
    {[-34, 0, 34].flatMap(x => [-15, 15].map(z => <mesh key={`${x}/${z}`} position={[x, 5, z]}><boxGeometry args={[1.4, 10, 1.4]} /><meshStandardMaterial color="#869393" /></mesh>))}
  </>;
  return null;
}
function Beams({ live }: { live: Live }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => { if (group.current) group.current.visible = (live.current?.summary.dni_wm2 ?? 950) > 20; });
  const positions = MIRRORS.filter((_, i) => i % 53 === 0);
  return <group ref={group}>{positions.map((p, i) => <Line key={i} points={[p, RECEIVER]} color="#ffd076" lineWidth={1.4} transparent opacity={0.35} depthWrite={false} />)}</group>;
}
export function CspSite({ live, showFlows }: { live: Live; showFlows: boolean }) {
  return <>
    <mesh rotation-x={-Math.PI / 2} position-y={-0.1} receiveShadow><circleGeometry args={[745, 100]} /><meshStandardMaterial color="#b6ab8c" roughness={1} /></mesh>
    {[80, 300, 520, 730].map(r => <mesh key={r} rotation-x={-Math.PI / 2} position-y={0}><ringGeometry args={[r - 3, r + 3, 100]} /><meshStandardMaterial color="#a49980" roughness={1} /></mesh>)}
    <mesh position={[-70, 0, 755]} receiveShadow><boxGeometry args={[530, 0.5, 180]} /><meshStandardMaterial color="#c0b9a6" roughness={1} /></mesh>
    <mesh position={[0, 0.1, 370]}><boxGeometry args={[12, 0.4, 720]} /><meshStandardMaterial color="#888b85" roughness={1} /></mesh>
    <mesh position={[-120, 0.7, 730]}><boxGeometry args={[70, 1.4, 35]} /><meshStandardMaterial color="#a1a39b" /></mesh>
    <Line points={[[0, 4, 12], [0, 4, 685], [90, 4, 685], [90, 4, 720]]} color="#cc784c" lineWidth={5} />
    <Line points={[[155, 4, 720], [155, 4, 670], [8, 4, 670], [8, 4, 12]]} color="#568d94" lineWidth={5} />
    <Line points={[[90, 4, 720], [90, 4, 755], [-45, 4, 755], [-45, 4, 720]]} color="#cc784c" lineWidth={5} />
    <Line points={[[-45, 4, 720], [-45, 4, 780], [155, 4, 780], [155, 4, 720]]} color="#568d94" lineWidth={5} />
    <pointLight position={[90, 36, 720]} color="#ffcb88" intensity={1500} distance={230} decay={1.6} />
    {showFlows && <Beams live={live} />}
  </>;
}
