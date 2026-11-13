import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Plant, Vec3 } from "./types";
import { DeviceModel, type Materials } from "./devices";

const WHITE = "#e2e7e4";
const BLUE = "#448ea8";

function Block({ at, size, color }: { at: Vec3; size: Vec3; color: string }) {
  return <mesh position={at} castShadow receiveShadow>
    <boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.85} />
  </mesh>;
}

/** Simple architectural envelopes; the detailed process equipment belongs to Unit 1. */
function Unit({ unit, open, onSelect }: { unit: Plant["site"]["units"][number]; open: boolean; onSelect: (id: string) => void }) {
  return <>
    <group position={unit.hall} onClick={!open && unit.detailed ? e => { e.stopPropagation(); onSelect("generator"); } : undefined}>
      <Block at={[0, 0.3, 0]} size={[103, 0.6, 60]} color="#c4c9c4" />
      {!open && <>
        <Block at={[0, 20, 0]} size={[102, 40, 58]} color={WHITE} />
        <Block at={[0, 41, 0]} size={[104, 2, 60]} color={BLUE} />
        <Block at={[0, 44, 0]} size={[88, 5, 12]} color="#a5bfc3" />
        <Block at={[0, 28, 29.1]} size={[99, 7, 0.3]} color="#527683" />
        <Block at={[0, 9, 29.3]} size={[101, 2, 0.4]} color={BLUE} />
        {[-40, -20, 0, 20, 40].map(x => <Block key={x} at={[x, 12, 29.6]} size={[1.2, 24, 1]} color="#f0f1e8" />)}
      </>}
    </group>
    <group position={unit.boiler} onClick={!open && unit.detailed ? e => { e.stopPropagation(); onSelect("boiler"); } : undefined}>
      {!open && <>
        <Block at={[0, 57, 0]} size={[59, 70, 50]} color={WHITE} />
        <Block at={[0, 96, 0]} size={[63, 8, 54]} color={BLUE} />
        <Block at={[0, 51, 25.2]} size={[59, 12, 0.5]} color={BLUE} />
        {[-28, 28].flatMap(x => [-23, 23].map(z => <Block key={`${x}-${z}`} at={[x, 47, z]} size={[3, 94, 3]} color="#b8c1bc" />))}
        <Block at={[0, 11, -61]} size={[49, 22, 26]} color="#adb7b8" />
        <Block at={[23, 17, -101]} size={[22, 34, 22]} color="#b3c1c3" />
      </>}
      <Block at={[0, 0.2, -40]} size={[86, 0.4, 145]} color="#b9c0b7" />
    </group>
  </>;
}

function Trees({ bounds }: { bounds: [number, number] }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const points = useMemo(() => {
    const [w, d] = bounds;
    const result: Vec3[] = [];
    for (let x = -w / 2 + 15; x < w / 2; x += 19) {
      result.push([x, 0, -d / 2 + 12], [x, 0, d / 2 - 12]);
    }
    for (let z = -d / 2 + 32; z < d / 2 - 20; z += 19) {
      result.push([-w / 2 + 12, 0, z], [w / 2 - 12, 0, z]);
    }
    for (let x = -340; x <= 340; x += 22) result.push([x, 0, 99]);
    return result;
  }, [bounds]);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    points.forEach(([x, , z], i) => {
      const h = 8 + (i % 5) * 0.6;
      dummy.position.set(x, 2.3, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      trunks.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, h, z); dummy.scale.set(4.5, h * 0.65, 4.5); dummy.updateMatrix();
      crowns.current!.setMatrixAt(i, dummy.matrix);
      crowns.current!.setColorAt(i, new THREE.Color(i % 3 ? "#4c7950" : "#73935c"));
    });
    trunks.current!.instanceMatrix.needsUpdate = true;
    crowns.current!.instanceMatrix.needsUpdate = true;
    crowns.current!.instanceColor!.needsUpdate = true;
  }, [points]);
  return <>
    <instancedMesh ref={trunks} args={[undefined, undefined, points.length]} castShadow>
      <cylinderGeometry args={[0.7, 1, 4.6, 6]} /><meshStandardMaterial color="#77634b" />
    </instancedMesh>
    <instancedMesh ref={crowns} args={[undefined, undefined, points.length]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 1]} /><meshStandardMaterial roughness={1} />
    </instancedMesh>
  </>;
}

/** Yard infrastructure follows the catalog origin; the coal itself is a credited scan. */
function CoalYard({ device }: { device: Plant["devices"][number] }) {
  const [w, , d] = device.size;
  return <group position={device.position}>
    <Block at={[0, -0.04, 0]} size={[w, 0.18, d]} color="#666b65" />
    {/* Reclaimer travel rails and the longitudinal yard conveyor. */}
    {[39, 44].map(x => <Block key={x} at={[x, 0.3, 0]} size={[0.35, 0.35, d - 10]} color="#919a9b" />)}
    {Array.from({ length: 31 }, (_, i) => -75 + i * 5).map(z =>
      <Block key={z} at={[41.5, 0.15, z]} size={[8, 0.2, 0.6]} color="#b4b8ad" />)}
    <Block at={[48, 2.7, 0]} size={[2.8, 0.7, d - 12]} color="#4e595b" />
    <Block at={[48, 3.1, 0]} size={[1.8, 0.1, d - 12]} color="#282c2d" />
    {[-72, -48, -24, 0, 24, 48, 72].map(z => <Block key={z} at={[48, 1.3, z]} size={[0.5, 2.6, 0.5]} color="#8e999b" />)}
    {/* Transfer tower meets the elevated conveyor feeding the mill. */}
    <Block at={[44, 6.5, 40]} size={[8, 13, 8]} color="#c1cbc6" />
    <Block at={[44, 13.5, 40]} size={[9, 1, 9]} color={BLUE} />
    {[-1, 1].map(s => <Block key={s} at={[s * (w / 2 - 1), 0.6, 0]} size={[0.7, 1.2, d]} color="#a4aba4" />)}
    <Block at={[0, 0.6, -d / 2]} size={[w, 1.2, 0.7]} color="#a4aba4" />
  </group>;
}

export function Site({ plant, m, openUnit, onSelect }: { plant: Plant; m: Materials; openUnit: boolean; onSelect: (id: string) => void }) {
  const { site } = plant;
  const tower = plant.devices.find(d => d.kind === "cooling_tower")!;
  const stack = plant.devices.find(d => d.kind === "chimney")!;
  const [w, d] = site.bounds;
  return <group>
    <Block at={[0, -1.1, 0]} size={[w, 2, d]} color="#81956c" />
    <Block at={[-10, -0.3, -95]} size={[700, 0.5, 350]} color="#b8bfb3" />
    <Block at={[0, -0.25, 186]} size={[152, 0.6, 112]} color="#a1aaa0" />
    <CoalYard device={plant.devices.find(device => device.id === "coal-yard")!} />
    {/* Perimeter and service roads, with narrow painted centre lines. */}
    {[-d / 2 + 35, 82, d / 2 - 35].map(z => <group key={z}>
      <Block at={[0, 0.1, z]} size={[w - 64, 0.25, 12]} color="#717a79" />
      <Block at={[0, 0.25, z]} size={[w - 64, 0.04, 0.35]} color="#d3d1b6" />
    </group>)}
    {[-w / 2 + 35, -228, 225, w / 2 - 35].map(x => <group key={x}>
      <Block at={[x, 0.1, 0]} size={[12, 0.25, d - 64]} color="#717a79" />
      <Block at={[x, 0.25, 0]} size={[0.35, 0.04, d - 64]} color="#d3d1b6" />
    </group>)}
    {site.units.map(unit => <group key={unit.id}>
      <Unit unit={unit} open={unit.detailed && openUnit} onSelect={onSelect} />
      {!unit.detailed && <group position={unit.cooling_tower}><DeviceModel d={tower} m={m} cut={false} /></group>}
      {!unit.detailed && <group position={[unit.hall[0], 0, 62]}>
        <Block at={[0, 4, 0]} size={[12, 8, 8]} color="#808a87" />
        {[-4, 0, 4].map(x => <mesh key={x} position={[x, 10, 0]} material={m.insulator} castShadow><cylinderGeometry args={[0.6, 0.6, 5, 8]} /></mesh>)}
      </group>}
    </group>)}
    <group position={site.secondary_stack}><DeviceModel d={stack} m={m} cut={false} /></group>
    {/* Administration and maintenance buildings along the eastern service road. */}
    {[[-285, 10, 20], [302, 11, -96], [302, 8, -25], [296, 5, 53]].map((p, i) => <group key={i}>
      <Block at={p as Vec3} size={[i ? 66 : 64, p[1] * 2, 36]} color={WHITE} />
      <Block at={[p[0], p[1] * 2 + 0.8, p[2]]} size={[i ? 68 : 66, 1.6, 38]} color={BLUE} />
      <Block at={[p[0], p[1] * 1.4, p[2] + 18.2]} size={[i ? 60 : 58, 3, 0.5]} color="#5f828d" />
    </group>)}
    {/* Low boundary wall leaves the aerial layout readable. */}
    {[-1, 1].map(s => <group key={s}>
      <Block at={[s * (w / 2 - 3), 1.2, 0]} size={[1.2, 2.4, d]} color="#c1c7b9" />
      <Block at={[0, 1.2, s * (d / 2 - 3)]} size={[w, 2.4, 1.2]} color="#c1c7b9" />
    </group>)}
    <Trees bounds={site.bounds} />
  </group>;
}
