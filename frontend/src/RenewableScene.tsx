import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Line } from "@react-three/drei";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { modelUrl } from "./models";
import type { Device, Plant, Vec3 } from "./types";
import type { Telemetry } from "./telemetry";

function Box({ at, size, color = "#d8dfda" }: { at: Vec3; size: Vec3; color?: string }) {
  return <mesh position={at} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>;
}

function WindModel({ d, live }: { d: Device; live: RefObject<Telemetry | null> }) {
  const { scene } = useGLTF(modelUrl("sf-28503240"), false, true);
  const fitted = useMemo(() => {
    const object = clone(scene);
    const rotor = object.getObjectByProperty("name", "Windturbine_Blades_1");
    if (!rotor) throw new Error("Reviewed wind model is missing its blade pivot");
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    object.position.set(-centre.x, -box.min.y, -centre.z);
    object.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
    const group = new THREE.Group(); group.add(object); group.scale.setScalar(d.size[1] / size.y);
    group.rotation.y = Math.PI / 6;
    rotor.rotation.z += Number(d.id.slice(-2)) * 0.35;
    return { group, rotor };
  }, [scene, d]);
  useFrame((_, dt) => {
    // Follow this turbine's server state; freeze when the last received RPM is zero.
    const rpm = live.current?.devices[d.id]?.rpm ?? 0;
    fitted.rotor.rotation.z += Math.min(dt, 0.1) * rpm * Math.PI / 30;
  });
  return <>
    <primitive object={fitted.group} />
    {d.kind === "offshore-turbine" ? <>
      <mesh position={[0, -3, 0]} castShadow><cylinderGeometry args={[5, 6, 34, 16]} /><meshStandardMaterial color="#e9ba31" roughness={0.6} /></mesh>
      <mesh position={[0, 12, 0]} castShadow><cylinderGeometry args={[9, 9, 1.3, 20]} /><meshStandardMaterial color="#e9ba31" /></mesh>
      <Box at={[7, 4, 0]} size={[1.5, 10, 2]} color="#d2a42f" />
    </> : <>
      <mesh position-y={0.5} receiveShadow><cylinderGeometry args={[9, 10, 1, 24]} /><meshStandardMaterial color="#bfc5bd" /></mesh>
      <Box at={[12, 2.2, 0]} size={[5, 4.4, 4]} color="#bac9c3" />
    </>}
  </>;
}

/** Repeat the reviewed module geometry with GPU instancing; shared textures stay shared. */
function SolarArray() {
  const { scene } = useGLTF(modelUrl("sf-f441251b"), false, true);
  const meshes = useMemo(() => {
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene), center = bounds.getCenter(new THREE.Vector3());
    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
    scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const geometry = o.geometry.clone();
        // Meshopt stores normalized integer positions; transform in floating point to avoid overflow.
        const position = geometry.getAttribute("position");
        const unpacked = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) unpacked.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
        geometry.setAttribute("position", new THREE.BufferAttribute(unpacked, 3));
        geometry.applyMatrix4(o.matrixWorld);
        geometry.translate(-center.x, -bounds.min.y, -center.z);
        geometry.scale(3.65, 3.65, 3.65); geometry.rotateX(0.36);
        const materials = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const copy = m.clone(); if (copy instanceof THREE.MeshStandardMaterial) { copy.color.set("#5a86a9"); copy.metalness = 0.15; copy.roughness = 0.42; } return copy; });
        parts.push({ geometry, material: Array.isArray(o.material) ? materials : materials[0] });
      }
    });
    return parts;
  }, [scene]);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const supports = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const transform = new THREE.Object3D();
    for (let i = 0; i < 560; i++) {
      transform.position.set((i % 28 - 13.5) * 9.5, 3, (Math.floor(i / 28) - 9.5) * 9);
      transform.updateMatrix();
      refs.current.forEach(mesh => mesh?.setMatrixAt(i, transform.matrix));
      transform.position.y = 1.5; transform.updateMatrix(); supports.current!.setMatrixAt(i, transform.matrix);
    }
    refs.current.forEach(mesh => { if (mesh) mesh.instanceMatrix.needsUpdate = true; });
    supports.current!.instanceMatrix.needsUpdate = true;
  }, [meshes]);
  return <>
    {meshes.map((part, i) => <instancedMesh key={i} ref={mesh => { refs.current[i] = mesh; }} args={[part.geometry, part.material, 560]} receiveShadow />)}
    <instancedMesh ref={supports} args={[undefined, undefined, 560]}><boxGeometry args={[0.22, 3, 0.22]} /><meshStandardMaterial color="#9aa6aa" metalness={0.4} roughness={0.65} /></instancedMesh>
  </>;
}

export function RenewableDevice({ d, live }: { d: Device; live: RefObject<Telemetry | null> }) {
  if (d.kind === "wind-turbine" || d.kind === "offshore-turbine") return <WindModel d={d} live={live} />;
  if (d.kind === "pv-array") return <SolarArray />;
  if (d.kind === "inverter") return <>
    <Box at={[0, 0.3, 0]} size={[11, 0.6, 7]} color="#bfc4b9" />
    <Box at={[0, 2.2, 0]} size={[9, 4, 5]} color="#e7e9df" />
    <Box at={[0, 4.3, 0]} size={[9.5, 0.4, 5.5]} color="#5795a4" />
    {[-3, 0, 3].map(x => <Box key={x} at={[x, 2.2, 2.55]} size={[0.15, 3.2, 0.12]} color="#809294" />)}
  </>;
  if (d.kind === "collector" || d.kind === "offshore-substation") {
    const offshore = d.kind === "offshore-substation";
    return <>
      {offshore && [-38, 38].flatMap(x => [-29, 29].map(z => <mesh key={`${x}-${z}`} position={[x, -5, z]} castShadow><cylinderGeometry args={[3.5, 3.5, 52, 12]} /><meshStandardMaterial color="#e1ad29" /></mesh>))}
      <Box at={[0, offshore ? 20 : 0.3, 0]} size={[d.size[0], offshore ? 4 : 0.6, d.size[2]]} color={offshore ? "#d9aa32" : "#c2c8bf"} />
      <Box at={[-15, offshore ? 29 : 5, -15]} size={[45, 14, 26]} color="#e2e6dd" />
      <Box at={[-15, offshore ? 36.5 : 12.5, -15]} size={[47, 1, 28]} color="#538ea0" />
      {[-16, -4, 8, 20].map(x => <group key={x} position={[x, offshore ? 23 : 1, 24]}>
        <Box at={[0, 2, 0]} size={[5, 4, 6]} color="#9aaead" />
        <mesh position-y={6}><cylinderGeometry args={[0.7, 0.7, 4, 12]} /><meshStandardMaterial color="#806455" /></mesh>
      </group>)}
    </>;
  }
  if (d.kind === "export-cable") return <>
    {/* Diagram overlay above the sea; no surveyed cable depth is implied. */}
    <Line points={[[-100, 8, -200], [-50, 8, -100], [40, 8, 50], [90, 8, 190]]} color="#f5c344" lineWidth={5} dashed dashSize={12} gapSize={6} />
    {[-1, 1].map(s => <mesh key={s} position={[s * 90, 5, s * 110]}><cylinderGeometry args={[2, 3, 10, 12]} /><meshStandardMaterial color="#e4b22c" /></mesh>)}
  </>;
  return null;
}

function Sea() {
  const time = useMemo(() => ({ value: 0 }), []);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: "#247d98", metalness: 0.35, roughness: 0.32 });
    m.onBeforeCompile = shader => {
      shader.uniforms.waveTime = time;
      shader.vertexShader = "uniform float waveTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.z += sin(position.x * 0.018 + waveTime * 0.45) * 1.8 + cos(position.y * 0.025 + waveTime * 0.35) * 1.2;");
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.98 + 0.02 * sin(vViewPosition.x * 0.018) * cos(vViewPosition.z * 0.025);");
    };
    return m;
  }, [time]);
  useFrame((_, dt) => { time.value += Math.min(dt, 0.1); });
  return <mesh rotation-x={-Math.PI / 2} position-y={-2} material={material} receiveShadow><planeGeometry args={[10000, 10000, 120, 120]} /></mesh>;
}

export function RenewableSite({ plant }: { plant: Plant }) {
  const offshore = plant.id === "offshore", solar = plant.id === "solar";
  const [w, depth] = plant.site.bounds;
  const generators = plant.devices.filter(d => d.stage === "generation");
  return <>
    {offshore ? <>
      <Sea />
      <Box at={[0, 0, 1620]} size={[12000, 8, 1000]} color="#97a485" />
      <Box at={[1020, 4.5, 1220]} size={[220, 1, 190]} color="#bfc8bd" />
      <Box at={[0, 1, 1120]} size={[12000, 6, 8]} color="#b4b19b" />
      <Box at={[1080, 4.6, 1300]} size={[10, 1, 260]} color="#7f8c88" />
      {generators.map(d => <Line key={d.id} points={[[d.position[0], 1, d.position[2]], [d.position[0], 1, 830], [850, 1, 830]]} color="#7fc9ca" lineWidth={1} transparent opacity={0.42} />)}
    </> : <>
      <Box at={[0, -0.6, 0]} size={[w, 1, depth]} color={solar ? "#b5ac8c" : "#64834e"} />
      {!solar && [-1, 0, 1].flatMap(row => [-2, -1, 0, 1, 2].map(col => <Box key={`${row}-${col}`} at={[col * 280, -0.03, row * 340]} size={[260, 0.08, 310]} color={(row + col) % 2 ? "#7e9858" : "#597942"} />))}
      {generators.map(d => <Box key={d.id} at={[d.position[0], 0.05, d.position[2]]} size={solar ? [d.size[0] + 12, 0.1, d.size[2] + 8] : [30, 0.2, 28]} color={solar ? "#c5bda2" : "#b9b5a0"} />)}
      {[...new Set(generators.map(d => d.position[2]))].map(z => <Box key={z} at={[0, 0.1, z + (solar ? 110 : 28)]} size={[w - 90, 0.2, solar ? 8 : 9]} color="#a5a693" />)}
      <Box at={[solar ? 680 : 580, 0.1, 20]} size={[10, 0.2, depth - 70]} color="#9d9f90" />
      {solar && [-1, 1].map(s => <group key={s}>
        <Box at={[s * (w / 2 - 8), 1, 0]} size={[0.5, 2, depth - 16]} color="#929d92" />
        <Box at={[0, 1, s * (depth / 2 - 8)]} size={[w - 16, 2, 0.5]} color="#929d92" />
      </group>)}
    </>}
  </>;
}
