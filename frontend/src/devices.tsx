import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Device } from "./types";

export type Materials = Record<
  "concrete" | "cladding" | "painted" | "metal" | "coal" | "blade" | "copper" | "dark" | "insulator" | "fire" | "ghost" | "water",
  THREE.Material
>;

const shadow = { castShadow: true, receiveShadow: true };
const HALF = Math.PI;
// Turbine-generator shaft centreline above the turbine deck, shared so the train lines up.
const AXIS = 4;
const SHAFT_SPEED = 2.5;
const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Rotates its children about the local x (default) or y axis. */
function Spin({ speed, axis = "x", children }: { speed: number; axis?: "x" | "y"; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && !reducedMotion) ref.current.rotation[axis] += speed * dt;
  });
  return <group ref={ref}>{children}</group>;
}

/** Ring of flat blades around the x axis; one merged geometry per ring. */
function useBladeRing(inner: number, outer: number, count: number, chord: number, twist = 0.5) {
  return useMemo(() => {
    const blades = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      const g = new THREE.BoxGeometry(chord, outer - inner, chord * 0.12);
      g.rotateY(twist);
      g.translate(0, (inner + outer) / 2, 0);
      g.rotateX(a);
      return g;
    });
    const merged = mergeGeometries(blades)!;
    blades.forEach((b) => b.dispose());
    return merged;
  }, [inner, outer, count, chord, twist]);
}

/** Cylinder lying along x. `cut` removes the upper half so the inside shows. */
function XCyl(props: { r: number; r2?: number; len: number; x?: number; y?: number; z?: number; m: THREE.Material; cut?: boolean; seg?: number }) {
  const { r, r2 = r, len, x = 0, y = 0, z = 0, m, cut, seg = 40 } = props;
  return (
    <mesh {...shadow} position={[x, y, z]} rotation-z={Math.PI / 2} material={m}>
      <cylinderGeometry args={[r2, r, len, seg, 1, !!cut, cut ? HALF : 0, cut ? HALF : Math.PI * 2]} />
    </mesh>
  );
}

/** Upright cylinder. `cut` removes the half facing the default camera (+z). */
function YCyl(props: { r: number; r2?: number; h: number; x?: number; y?: number; z?: number; m: THREE.Material; cut?: boolean; seg?: number }) {
  const { r, r2 = r, h, x = 0, y = 0, z = 0, m, cut, seg = 40 } = props;
  return (
    <mesh {...shadow} position={[x, y + h / 2, z]} material={m}>
      <cylinderGeometry args={[r2, r, h, seg, 1, !!cut, cut ? Math.PI / 2 : 0, cut ? HALF : Math.PI * 2]} />
    </mesh>
  );
}

function Box({ s, p, m, r }: { s: [number, number, number]; p: [number, number, number]; m: THREE.Material; r?: [number, number, number] }) {
  return (
    <mesh {...shadow} position={p} rotation={r} material={m}>
      <boxGeometry args={s} />
    </mesh>
  );
}

function Legs({ w, d, h, y = 0, m }: { w: number; d: number; h: number; y?: number; m: THREE.Material }) {
  return (
    <>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Box key={`${sx}${sz}`} s={[0.5, h, 0.5]} p={[(sx * w) / 2, y + h / 2, (sz * d) / 2]} m={m} />),
      )}
    </>
  );
}

function Rotor({ len, r, stages, m, doubleFlow }: { len: number; r: number; stages: number; m: Materials; doubleFlow?: boolean }) {
  // Blade height grows along the steam path: outward from the centre for double-flow LP, along +x otherwise.
  const rings = Array.from({ length: stages }, (_, i) => {
    const t = (i + 1) / stages;
    const x = doubleFlow ? (len / 2) * 0.85 * t : -len * 0.4 + len * 0.8 * t;
    return { x, outer: r * (0.45 + 0.45 * t) };
  });
  return (
    <group position-y={AXIS}>
      <Spin speed={SHAFT_SPEED}>
        <XCyl r={r * 0.14} len={len * 1.15} m={m.metal} seg={16} />
        {rings
          .flatMap((ring) => (doubleFlow ? [ring, { ...ring, x: -ring.x }] : [ring]))
          .map(({ x, outer }) => (
            <StageRing key={x} x={x} inner={r * 0.18} outer={outer} m={m.blade} />
          ))}
      </Spin>
    </group>
  );
}

function StageRing({ x, inner, outer, m }: { x: number; inner: number; outer: number; m: THREE.Material }) {
  const g = useBladeRing(inner, outer, 18, Math.max(0.25, outer * 0.18));
  return <mesh geometry={g} position-x={x} material={m} castShadow />;
}

function Turbine({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  const lp = d.id === "lp-turbine";
  const r = Math.min(h, depth) / 2;
  return (
    <group>
      {[-1, 1].map((s) => (
        <Box key={s} s={[1.2, AXIS, depth * 0.7]} p={[(s * w) / 2, AXIS / 2, 0]} m={m.painted} />
      ))}
      {lp ? (
        <>
          <Box s={[w * 0.9, AXIS, depth]} p={[0, AXIS / 2, 0]} m={m.painted} />
          {!cut && <XCyl r={depth / 2} len={w * 0.9} y={AXIS} m={m.painted} />}
        </>
      ) : (
        <XCyl r={r} r2={r * 0.85} len={w * 0.9} y={AXIS} m={m.metal} cut={cut} />
      )}
      {cut && <Rotor len={w * 0.85} r={lp ? depth / 2 : r} stages={lp ? 5 : 7} m={m} doubleFlow={lp} />}
      {!cut && (
        <group position-y={AXIS}>
          <Spin speed={SHAFT_SPEED}>
            <XCyl r={0.35} len={w * 1.05} m={m.metal} seg={12} />
          </Spin>
        </group>
      )}
    </group>
  );
}

function Generator({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h] = d.size;
  const r = h / 2;
  const rotorR = r * 0.45;
  return (
    <group>
      <Box s={[w * 0.95, 1.4, r * 1.6]} p={[0, 0.7, 0]} m={m.concrete} />
      <XCyl r={r} len={w * 0.75} y={AXIS} m={m.painted} cut={cut} />
      {[-1, 1].map((s) => (
        <XCyl key={s} r={r * 0.92} r2={r * 0.6} len={w * 0.06} x={s * w * 0.4} y={AXIS} m={m.painted} />
      ))}
      {cut && <XCyl r={r * 0.82} len={w * 0.72} y={AXIS} m={m.dark} cut />}
      <XCyl r={r * 0.4} len={w * 0.12} x={w * 0.47} y={AXIS} m={m.metal} />
      <group position-y={AXIS}>
        <Spin speed={SHAFT_SPEED}>
          <XCyl r={0.35} len={w} m={m.metal} seg={12} />
          {cut && (
            <>
              <XCyl r={rotorR} len={w * 0.62} m={m.copper} seg={8} />
              {[0, 1, 2, 3].map((i) => (
                <Box key={i} s={[w * 0.62, 0.2, rotorR * 0.5]} p={[0, 0, 0]} r={[(i * Math.PI) / 2, 0, 0]} m={m.dark} />
              ))}
            </>
          )}
        </Spin>
      </group>
    </group>
  );
}

function Boiler({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  const shell = cut ? m.ghost : m.cladding;
  // Π-type layout: furnace on the -z side, rear convection pass on +z towards the precipitator.
  const fz = -depth * 0.2;
  const fd = depth * 0.6;
  const rz = depth * 0.35;
  const rd = depth * 0.3;
  return (
    <group>
      <Box s={[w, h * 0.9, fd]} p={[0, h * 0.45, fz]} m={shell} />
      <Box s={[w, h * 0.65, rd]} p={[0, h * 0.475, rz]} m={shell} />
      <Box s={[w, h * 0.12, depth]} p={[0, h * 0.86, 0]} m={shell} />
      <Box s={[w * 1.05, h * 0.06, depth * 1.05]} p={[0, h * 0.95, 0]} m={m.metal} />
      <Legs w={w * 1.04} d={depth * 1.04} h={h * 0.98} m={m.metal} />
      {cut && (
        <>
          <Box s={[w * 0.92, h * 0.85, 0.4]} p={[0, h * 0.44, fz - fd * 0.45]} m={m.dark} />
          <mesh position={[0, h * 0.28, fz]} scale={[w * 0.32, h * 0.14, fd * 0.32]} material={m.fire}>
            <sphereGeometry args={[1, 24, 16]} />
          </mesh>
          {[0.18, 0.23, 0.28, 0.33].flatMap((ly) =>
            [-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <XCyl key={`${ly}${sx}${sz}`} r={0.6} len={3} x={(sx * w) / 2} y={h * ly} z={fz + (sz * fd) / 2} m={m.metal} seg={10} />
              )),
            ),
          )}
          {Array.from({ length: 8 }, (_, i) => (
            <Box key={i} s={[0.3, h * 0.14, fd * 0.6]} p={[-w * 0.35 + (i * w * 0.7) / 7, h * 0.76, fz]} m={m.blade} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <Box key={i} s={[w * 0.85, 1.2, rd * 0.8]} p={[0, h * 0.25 + i * h * 0.08, rz]} m={m.blade} />
          ))}
        </>
      )}
    </group>
  );
}

function Pump({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  if (h >= w * 1.2) {
    const r = w * 0.3;
    return (
      <group>
        <Box s={[w, h * 0.08, depth]} p={[0, h * 0.04, 0]} m={m.concrete} />
        <YCyl r={r} h={h * 0.4} y={h * 0.08} m={m.painted} cut={cut} />
        {cut && (
          <group position-y={h * 0.25}>
            <Spin speed={SHAFT_SPEED * 2} axis="y">
              <group rotation-z={Math.PI / 2}>
                <PumpImpeller r={r * 0.85} m={m} />
              </group>
            </Spin>
          </group>
        )}
        <YCyl r={r * 0.5} h={h * 0.1} y={h * 0.48} m={m.metal} />
        <YCyl r={w * 0.38} h={h * 0.38} y={h * 0.58} m={m.painted} />
        <YCyl r={w * 0.28} h={h * 0.04} y={h * 0.96} m={m.metal} />
      </group>
    );
  }
  const r = Math.min(h, depth) * 0.32;
  return (
    <group>
      <Box s={[w, h * 0.12, depth * 0.8]} p={[0, h * 0.06, 0]} m={m.concrete} />
      <XCyl r={r} len={w * 0.38} x={w * 0.27} y={h * 0.5} m={m.painted} cut={cut} />
      <XCyl r={r * 1.1} len={w * 0.42} x={-w * 0.27} y={h * 0.5} m={m.metal} />
      <group position={[0, h * 0.5, 0]}>
        <Spin speed={SHAFT_SPEED * 2}>
          <XCyl r={r * 0.25} len={w * 0.3} m={m.metal} seg={6} />
          {cut && (
            <group position-x={w * 0.27}>
              <PumpImpeller r={r * 0.85} m={m} />
            </group>
          )}
        </Spin>
      </group>
    </group>
  );
}

function PumpImpeller({ r, m }: { r: number; m: Materials }) {
  const g = useBladeRing(r * 0.2, r, 7, r * 0.5, 1.1);
  return <mesh geometry={g} material={m.blade} castShadow />;
}

function Fan({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  const r = Math.min(h, depth) * 0.42;
  const y = h * 0.5;
  const blades = useBladeRing(r * 0.35, r * 0.95, 14, r * 0.35, 0.7);
  return (
    <group>
      <Box s={[w, 0.6, depth * 0.7]} p={[0, 0.3, 0]} m={m.concrete} />
      <Box s={[w * 0.25, h * 0.9, depth * 0.9]} p={[-w * 0.35, h * 0.45 + 0.3, 0]} m={m.painted} />
      <XCyl r={r} len={w * 0.3} x={-w * 0.07} y={y} m={m.painted} cut={cut} />
      <XCyl r={r} r2={r * 1.15} len={w * 0.32} x={w * 0.24} y={y} m={m.painted} />
      <XCyl r={r * 0.5} len={w * 0.16} x={-w * 0.56} y={y} m={m.metal} />
      {cut && (
        <group position={[-w * 0.07, y, 0]}>
          <Spin speed={SHAFT_SPEED * 2}>
            <XCyl r={r * 0.35} len={w * 0.12} m={m.metal} seg={16} />
            <mesh geometry={blades} material={m.blade} castShadow />
          </Spin>
        </group>
      )}
    </group>
  );
}

function Mill({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  const r = w * 0.42;
  return (
    <group>
      <Box s={[w * 0.8, h * 0.15, depth * 0.8]} p={[0, h * 0.075, 0]} m={m.painted} />
      <YCyl r={r} h={h * 0.45} y={h * 0.15} m={m.painted} cut={cut} />
      <YCyl r={r} r2={r * 0.45} h={h * 0.25} y={h * 0.6} m={m.painted} cut={cut} />
      <YCyl r={r * 0.3} h={h * 0.06} y={h * 0.85} m={m.metal} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return <YCyl key={i} r={0.35} h={h * 0.12} x={Math.cos(a) * r * 0.2} y={h * 0.88} z={Math.sin(a) * r * 0.2} m={m.metal} seg={10} />;
      })}
      {cut && (
        <group position-y={h * 0.2}>
          <Spin speed={1.2} axis="y">
            <YCyl r={r * 0.85} h={h * 0.05} m={m.metal} />
            {[0, 1, 2].map((i) => {
              const a = (i * Math.PI * 2) / 3;
              return (
                <mesh key={i} position={[Math.cos(a) * r * 0.5, h * 0.1, Math.sin(a) * r * 0.5]} rotation={[0, -a, Math.PI / 2.6]} material={m.dark} castShadow>
                  <cylinderGeometry args={[r * 0.28, r * 0.28, r * 0.25, 20]} />
                </mesh>
              );
            })}
          </Spin>
        </group>
      )}
    </group>
  );
}

function Precipitator({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  const hopperH = h * 0.3;
  const body = depth * 0.7;
  const nx = 4;
  const cell = w / nx;
  return (
    <group>
      {Array.from({ length: nx }, (_, i) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${i}${sz}`}
            {...shadow}
            position={[-w / 2 + cell * (i + 0.5), hopperH * 0.6, (sz * body) / 4]}
            rotation={[Math.PI, Math.PI / 4, 0]}
            material={m.metal}
          >
            <coneGeometry args={[(cell / 2) * Math.SQRT2, hopperH * 0.8, 4]} />
          </mesh>
        )),
      )}
      <Legs w={w * 0.98} d={body * 0.98} h={hopperH} m={m.metal} />
      <Box s={[w, h * 0.55, body]} p={[0, hopperH + h * 0.275, 0]} m={cut ? m.ghost : m.cladding} />
      {[-1, 1].map((sz) => (
        <mesh key={sz} {...shadow} position={[0, hopperH + h * 0.275, (sz * (body + depth * 0.15)) / 2]} rotation={[(sz * Math.PI) / 2, Math.PI / 4, 0]} material={m.metal}>
          <cylinderGeometry args={[w * 0.25, w * 0.68, depth * 0.15, 4, 1, true]} />
        </mesh>
      ))}
      {Array.from({ length: nx }, (_, i) => (
        <Box key={i} s={[cell * 0.4, h * 0.08, body * 0.3]} p={[-w / 2 + cell * (i + 0.5), hopperH + h * 0.59, 0]} m={m.painted} />
      ))}
      {cut &&
        Array.from({ length: 14 }, (_, i) => (
          <Box key={i} s={[0.12, h * 0.5, body * 0.94]} p={[-w * 0.46 + (i * w * 0.92) / 13, hopperH + h * 0.275, 0]} m={m.metal} />
        ))}
    </group>
  );
}

function Absorber({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h] = d.size;
  const r = w * 0.45;
  const shell = cut ? m.ghost : m.metal;
  const sprays = [0.5, 0.57, 0.64];
  return (
    <group>
      <YCyl r={r} h={h * 0.8} m={shell} />
      <YCyl r={r} r2={r * 0.4} h={h * 0.1} y={h * 0.8} m={shell} />
      <XCyl r={r * 0.4} len={w * 0.6} x={w * 0.3} y={h * 0.86} m={m.metal} />
      <Box s={[w * 0.4, h * 0.12, w * 0.5]} p={[0, h * 0.3, -r - w * 0.2]} m={m.metal} />
      {sprays.map((ly, i) => {
        const a = Math.PI * 0.15 + i * 0.35;
        const px = Math.cos(a) * (r + 1.5);
        const pz = Math.sin(a) * (r + 1.5);
        return (
          <group key={ly}>
            <YCyl r={0.9} h={1.6} x={px * 1.2} z={pz * 1.2} m={m.painted} seg={16} />
            <YCyl r={0.35} h={h * ly} x={px} z={pz} m={m.painted} seg={10} />
          </group>
        );
      })}
      {cut && (
        <>
          <YCyl r={r * 0.97} h={h * 0.18} m={SLURRY} />
          {sprays.map((ly) => (
            <group key={ly}>
              <YCyl r={r * 0.9} h={0.3} y={h * ly} m={m.painted} seg={24} />
              <mesh position-y={h * ly - h * 0.035} material={SPRAY}>
                <coneGeometry args={[r * 0.9, h * 0.07, 24, 1, true]} />
              </mesh>
            </group>
          ))}
          {[0.72, 0.76].map((ly) => (
            <YCyl key={ly} r={r * 0.97} h={0.6} y={h * ly} m={m.blade} seg={24} />
          ))}
        </>
      )}
    </group>
  );
}

const SLURRY = new THREE.MeshStandardMaterial({ color: "#d6c7a1", roughness: 0.6 });
const SPRAY = new THREE.MeshStandardMaterial({ color: "#e2e8f0", transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });

function Deaerator({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h] = d.size;
  const r = h / 2;
  const base = d.position[1];
  return (
    <group>
      <XCyl r={r} len={w * 0.9} y={r} m={cut ? m.ghost : m.metal} />
      {[-1, 1].map((s) => (
        <mesh key={s} {...shadow} position={[s * w * 0.45, r, 0]} scale={[0.4, 1, 1]} material={m.metal}>
          <sphereGeometry args={[r, 24, 16]} />
        </mesh>
      ))}
      {cut && <XCyl r={r * 0.96} len={w * 0.88} y={r} m={m.water} cut />}
      <YCyl r={r * 0.4} h={1.2} x={-w * 0.3} y={h - 0.2} m={m.metal} seg={16} />
      {[-0.3, 0, 0.3].map((t) => (
        <group key={t}>
          <Box s={[1, 0.8, h * 0.9]} p={[t * w, 0.4, 0]} m={m.painted} />
          {base > 0 && <Legs w={0.6} d={h * 0.8} h={base} y={-base} m={m.metal} />}
        </group>
      ))}
    </group>
  );
}

function Switchyard({ d, m }: { d: Device; m: Materials }) {
  const [w, h, depth] = d.size;
  const bays = 4;
  const pitch = w / bays;
  const bushing = useMemo(() => {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(0.45, 0)];
    const sheds = 14;
    for (let i = 0; i < sheds; i++) {
      const y = 0.4 + (i / sheds) * (h * 0.62);
      pts.push(new THREE.Vector2(0.3, y), new THREE.Vector2(0.65, y + 0.12), new THREE.Vector2(0.3, y + 0.3));
    }
    pts.push(new THREE.Vector2(0.25, h * 0.68), new THREE.Vector2(0, h * 0.7));
    return new THREE.LatheGeometry(pts, 16);
  }, [h]);
  return (
    <group>
      <Box s={[w, 0.4, depth]} p={[0, 0.2, 0]} m={m.concrete} />
      {[-0.4, -0.28].flatMap((zf) =>
        [-1, 0, 1].map((ph) => <XCyl key={`${zf}${ph}`} r={0.45} len={w * 0.96} y={2.4} z={depth * zf + ph * 1.1} m={m.metal} seg={16} />),
      )}
      {Array.from({ length: bays }, (_, b) => {
        const x = -w / 2 + pitch * (b + 0.5);
        return [-1, 0, 1].map((ph) => {
          const px = x + ph * pitch * 0.25;
          return (
            <group key={`${b}${ph}`}>
              <mesh {...shadow} position={[px, 2.4, 0]} rotation-x={Math.PI / 2} material={m.metal}>
                <cylinderGeometry args={[0.9, 0.9, depth * 0.36, 20]} />
              </mesh>
              <YCyl r={0.5} h={2.4} x={px} y={0.4} z={depth * 0.2} m={m.metal} seg={12} />
              <mesh {...shadow} geometry={bushing} position={[px, 2.6, depth * 0.24]} material={m.insulator} />
            </group>
          );
        });
      })}
      {[-1, 1].map((s) => (
        <Box key={s} s={[0.8, h, 0.8]} p={[(s * w) / 2, h / 2, depth * 0.42]} m={m.metal} />
      ))}
      <Box s={[w, 0.8, 0.8]} p={[0, h - 0.4, depth * 0.42]} m={m.metal} />
    </group>
  );
}

function Conveyor({ d, m }: { d: Device; m: Materials }) {
  const [w, h, depth] = d.size;
  const base = d.position[1];
  const bents = Math.max(2, Math.round(w / 15));
  return (
    <group>
      <Box s={[w, h, depth]} p={[0, h / 2, 0]} m={m.cladding} />
      {base > 0 &&
        Array.from({ length: bents }, (_, i) => (
          <group key={i} position-x={-w / 2 + (w * (i + 0.5)) / bents}>
            <Legs w={depth * 0.8} d={depth * 0.8} h={base} y={-base} m={m.metal} />
          </group>
        ))}
    </group>
  );
}

function towerProfile(width: number, height: number) {
  const base = width / 2;
  const throat = base * 0.58;
  const top = base * 0.66;
  const throatY = height * 0.78;
  return Array.from({ length: 33 }, (_, i) => {
    const y = (height * i) / 32;
    const r =
      y < throatY
        ? throat + (base - throat) * ((throatY - y) / throatY) ** 2
        : throat + (top - throat) * ((y - throatY) / (height - throatY)) ** 2;
    return new THREE.Vector2(r, y);
  });
}

/** Kinds whose internals can be shown with the cutaway toggle. */
export const CUTAWAY_KINDS = new Set(["turbine", "generator", "boiler", "pump", "fan", "mill", "precipitator", "absorber", "tank"]);

export function DeviceModel({ d, m, cut }: { d: Device; m: Materials; cut: boolean }) {
  const [w, h, depth] = d.size;
  switch (d.kind) {
    case "turbine":
      return <Turbine d={d} m={m} cut={cut} />;
    case "generator":
      return <Generator d={d} m={m} cut={cut} />;
    case "boiler":
      return <Boiler d={d} m={m} cut={cut} />;
    case "pump":
      return <Pump d={d} m={m} cut={cut} />;
    case "fan":
      return <Fan d={d} m={m} cut={cut} />;
    case "mill":
      return <Mill d={d} m={m} cut={cut} />;
    case "precipitator":
      return <Precipitator d={d} m={m} cut={cut} />;
    case "absorber":
      return <Absorber d={d} m={m} cut={cut} />;
    case "tank":
      return <Deaerator d={d} m={m} cut={cut} />;
    case "switchyard":
      return <Switchyard d={d} m={m} />;
    case "conveyor":
      return <Conveyor d={d} m={m} />;
    case "cooling_tower":
      return (
        <group>
          <mesh {...shadow} position-y={6}>
            <latheGeometry args={[towerProfile(w, h - 6), 64]} />
            <meshStandardMaterial color="#d4d6ce" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.6} material={m.water}>
            <circleGeometry args={[w * 0.47, 64]} />
          </mesh>
          <mesh rotation-x={Math.PI / 2} position-y={h} material={m.concrete} {...shadow}>
            <torusGeometry args={[w * 0.33, 0.7, 6, 64]} />
          </mesh>
          {Array.from({ length: 40 }, (_, i) => {
            const a = i * Math.PI / 20;
            return <mesh key={i} position={[Math.cos(a) * w * 0.47, 3, Math.sin(a) * w * 0.47]} material={m.concrete} {...shadow}>
              <cylinderGeometry args={[0.8, 1.1, 6, 6]} />
            </mesh>;
          })}
        </group>
      );
    case "chimney":
      return (
        <group>
          {Array.from({ length: 12 }, (_, i) => {
            const bottom = w * (0.5 - 0.2 * i / 12);
            const top = w * (0.5 - 0.2 * (i + 1) / 12);
            return <mesh key={i} {...shadow} position-y={h * (i + 0.5) / 12}>
              <cylinderGeometry args={[top, bottom, h / 12, 32, 1, true]} />
              <meshStandardMaterial color={i > 5 && i % 2 ? "#a94d42" : "#d9d8cd"} roughness={0.9} side={THREE.DoubleSide} />
            </mesh>;
          })}
        </group>
      );
    case "heater": {
      const r = Math.min(h, depth) / 2;
      return (
        <mesh {...shadow} position-y={r} rotation-z={Math.PI / 2} material={m.metal}>
          <capsuleGeometry args={[r, w - 2 * r, 8, 32]} />
        </mesh>
      );
    }
    case "yard":
      return (
        <mesh {...shadow} position-y={h / 2} scale={[w / 2, h, depth / 2]} material={m.coal}>
          <coneGeometry args={[1, 1, 4, 1]} />
        </mesh>
      );
    case "line":
      return (
        <group>
          <mesh {...shadow} position-y={h / 2} material={m.metal}>
            <cylinderGeometry args={[0.6, w / 2, h, 4, 1, true]} />
          </mesh>
          <mesh {...shadow} position-y={h * 0.82} material={m.metal}>
            <boxGeometry args={[1, 1, depth * 2.5]} />
          </mesh>
        </group>
      );
    case "transformer":
      return (
        <group>
          <mesh {...shadow} position-y={h * 0.35} material={m.painted}>
            <boxGeometry args={[w * 0.6, h * 0.7, depth * 0.7]} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} {...shadow} position={[side * w * 0.4, h * 0.35, 0]} material={m.metal}>
              <boxGeometry args={[w * 0.18, h * 0.6, depth * 0.9]} />
            </mesh>
          ))}
          {[-0.2, 0, 0.2].map((x) => (
            <mesh key={x} {...shadow} position={[x * w, h * 0.85, 0]} material={m.insulator}>
              <cylinderGeometry args={[0.35, 0.6, h * 0.3, 12]} />
            </mesh>
          ))}
        </group>
      );
    default: {
      const mat = d.kind === "building" ? m.cladding : m.metal;
      return (
        <mesh {...shadow} position-y={h / 2} material={mat}>
          <boxGeometry args={[w, h, depth]} />
        </mesh>
      );
    }
  }
}

/** Table-top concrete foundation under the raised turbine-generator train. */
export function TurbineDeck({ devices, m }: { devices: Device[]; m: Materials }) {
  const train = devices.filter((d) => (d.kind === "turbine" || d.kind === "generator") && d.position[1] > 0);
  if (train.length === 0) return null;
  const x0 = Math.min(...train.map((d) => d.position[0] - d.size[0] / 2)) - 1;
  const x1 = Math.max(...train.map((d) => d.position[0] + d.size[0] / 2)) + 1;
  const top = train[0].position[1];
  const z = train[0].position[2];
  const depth = Math.max(...train.map((d) => d.size[2])) + 2;
  const bents = Math.max(2, Math.round((x1 - x0) / 9));
  return (
    <group>
      <Box s={[x1 - x0, 1.6, depth]} p={[(x0 + x1) / 2, top - 0.8, z]} m={m.concrete} />
      {Array.from({ length: bents }, (_, i) => {
        const x = x0 + 1 + ((x1 - x0 - 2) * i) / (bents - 1);
        return [-1, 1].map((s) => <Box key={`${i}${s}`} s={[1.4, top - 1.6, 1.4]} p={[x, (top - 1.6) / 2, z + (s * (depth - 1.4)) / 2]} m={m.concrete} />);
      })}
    </group>
  );
}
