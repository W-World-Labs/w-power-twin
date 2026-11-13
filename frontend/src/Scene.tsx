import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Html, OrbitControls, QuadraticBezierLine, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Device, Flow, Lang, Plant } from "./types";
import { label } from "./text";
import { CUTAWAY_KINDS, DeviceModel, TurbineDeck, type Materials } from "./devices";
import { DeviceModels, SiteProps } from "./models";
import { RenewableSite, RenewableDevice } from "./RenewableScene";
import type { Telemetry } from "./telemetry";
import { CspSite, CspDevice } from "./CspScene";
import { Site } from "./Site";

const MEDIUM_COLOR: Record<string, string> = {
  solar_heat: "#f5cd65", hot_salt: "#ec6a33", cold_salt: "#38b6c6",
  coal: "#44403c",
  air: "#7dd3fc",
  flue_gas: "#a8a29e",
  steam: "#f97316",
  water: "#2563eb",
  cooling_water: "#06b6d4",
  shaft: "#a855f7",
  power: "#eab308",
};

const SKY = "/assets/hdri/kloofendal_43d_clear_puresky_2k.hdr";

function pbr(name: string) {
  const base = `/assets/textures/${name}/${name}_1K-JPG_`;
  return { map: `${base}Color.jpg`, normalMap: `${base}NormalGL.jpg`, roughnessMap: `${base}Roughness.jpg` };
}

function usePbr(name: string, repeat: number, extra: THREE.MeshStandardMaterialParameters = {}, colorMap = true) {
  const maps = useTexture(pbr(name));
  return useMemo(() => {
    const tiled = (src: THREE.Texture) => {
      const t = src.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    };
    const map = colorMap ? tiled(maps.map) : null;
    if (map) map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map,
      normalMap: tiled(maps.normalMap),
      roughnessMap: tiled(maps.roughnessMap),
      ...extra,
    });
  }, [maps, repeat, extra, colorMap]);
}

const METAL = { color: "#8d99a8", metalness: 0.7 };
const PAINTED = { color: "#5b8db8", metalness: 0.2 };
const SOLID = {
  coal: new THREE.MeshStandardMaterial({ color: "#1c1917", roughness: 1 }),
  blade: new THREE.MeshStandardMaterial({ color: "#c8a165", metalness: 0.85, roughness: 0.35 }),
  copper: new THREE.MeshStandardMaterial({ color: "#b4693a", metalness: 0.8, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: "#3f3f46", metalness: 0.4, roughness: 0.7, side: THREE.DoubleSide }),
  insulator: new THREE.MeshStandardMaterial({ color: "#7c4a2d", roughness: 0.35 }),
  fire: new THREE.MeshStandardMaterial({ color: "#f97316", emissive: "#f97316", emissiveIntensity: 2.5, transparent: true, opacity: 0.8 }),
  ghost: new THREE.MeshStandardMaterial({ color: "#cbd5e1", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  water: new THREE.MeshStandardMaterial({ color: "#2563eb", transparent: true, opacity: 0.75, roughness: 0.15 }),
};

function useMaterials(): Materials {
  const metal = usePbr("Metal029", 1, METAL, false);
  const painted = usePbr("PaintedMetal004", 1, PAINTED, false);
  return {
    concrete: usePbr("Concrete034", 2),
    cladding: usePbr("CorrugatedSteel007A", 3),
    // Cut casings are seen from inside, so these render both faces.
    painted: useMemo(() => Object.assign(painted.clone(), { side: THREE.DoubleSide }), [painted]),
    metal: useMemo(() => Object.assign(metal.clone(), { side: THREE.DoubleSide }), [metal]),
    ...SOLID,
  };
}

function DeviceNode(props: {
  d: Device;
  live: RefObject<Telemetry | null>;
  m: Materials;
  lang: Lang;
  selected: boolean;
  alarm: boolean;
  dimmed: boolean;
  cutaway: boolean;
  onSelect: (id: string) => void;
}) {
  const { d, m, lang, selected, alarm, dimmed, cutaway, onSelect } = props;
  const [hover, setHover] = useState(false);
  const cut = cutaway && CUTAWAY_KINDS.has(d.kind);
  const [w, h, depth] = d.size;
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(d.id);
  };
  return (
    <group
      position={d.position}
      onClick={click}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
      visible={!dimmed || selected}
    >
      {(d.kind.startsWith("csp-") || d.kind === "heliostat-field") ? <CspDevice d={d} live={props.live} /> : ["wind-turbine", "offshore-turbine", "pv-array", "inverter", "collector", "offshore-substation", "export-cable"].includes(d.kind) ? <RenewableDevice d={d} live={props.live} /> : <DeviceModels deviceId={d.id} cut={cut} procedural={<DeviceModel d={d} m={m} cut={cut} />} />}
      {(selected || hover || alarm) && (
        <>
          <mesh position-y={d.kind === "export-cable" ? 9 : h / 2}>
            <boxGeometry args={[w * 1.08 + 1, h * 1.04 + 1, depth * 1.08 + 1]} />
            <meshBasicMaterial color={alarm ? "#e64545" : selected ? "#2563eb" : "#93c5fd"} wireframe />
          </mesh>
          <Html position={[0, h + 4, 0]} center className={`scene-label${alarm ? " alarm-label" : ""}`} pointerEvents="none">
            {label(d.name, lang)}
          </Html>
        </>
      )}
    </group>
  );
}

function FlowLine({ flow, from, to, index, live }: { flow: Flow; from: Device; to: Device; index: number; live: RefObject<Telemetry | null> }) {
  const ref = useRef<THREE.Object3D & { material: { dashOffset: number } }>(null);
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.material.dashOffset -= dt * 4;
      const data = live.current;
      if (data?.scene === "csp") {
        const e = data.energy;
        ref.current.visible = flow.medium === "solar_heat" ? data.summary.dni_wm2 > 0 :
          (flow.from === "receiver" || flow.from === "cold-tank" || flow.from === "salt-pump") ? e.absorbed_mwth > 0 : e.cycle_mwth > 0;
      }
    }
  });
  const top = (d: Device): [number, number, number] => [d.position[0], d.position[1] + (d.kind === "csp-receiver" ? 174 : Math.min(d.size[1], 30) * 0.6), d.position[2]];
  const a = top(from);
  const b = top(to);
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 10 + (index % 3) * 6, (a[2] + b[2]) / 2];
  return (
    <QuadraticBezierLine
      ref={ref as never}
      start={a}
      end={b}
      mid={mid}
      color={MEDIUM_COLOR[flow.medium] ?? "#64748b"}
      lineWidth={3}
      dashed
      dashSize={3}
      gapSize={2}
    />
  );
}

type Controls = THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update: () => void };
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Flies the camera to the selected device, keeping the current viewing direction. User input cancels the flight. */
function CameraRig({ plant, focusId, overview }: { plant: Plant; focusId: string | null; overview: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as Controls | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    // Keep the selected equipment in the area beside the detail panel.
    if (focusId && window.innerWidth > 760) {
      camera.setViewOffset(size.width, size.height, 210, 0, size.width, size.height);
    } else {
      camera.clearViewOffset();
    }
    return () => camera.clearViewOffset();
  }, [camera, focusId, size.width, size.height]);

  useEffect(() => {
    goal.current = { pos: new THREE.Vector3(...plant.site.camera.position), target: new THREE.Vector3(...plant.site.camera.target) };
  }, [plant, overview]);

  useEffect(() => {
    const d = plant.devices.find((x) => x.id === focusId);
    if (!d || !controls) return;
    const target = new THREE.Vector3(d.position[0], d.position[1] + d.size[1] / 2, d.position[2]);
    const dir = camera.position.clone().sub(controls.target).normalize();
    dir.y = Math.max(dir.y, 0.35);
    dir.normalize();
    goal.current = { target, pos: target.clone().addScaledVector(dir, Math.max(...d.size) * 1.6 + 25) };
  }, [plant, focusId, controls, camera]);

  useEffect(() => {
    if (!controls) return;
    const cancel = () => (goal.current = null);
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controls]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.target, k);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.5) goal.current = null;
  });
  return null;
}

function World({ plant, lang, selectedId, stage, cutaway, showFlows, alarmIds, onSelect, live }: SceneProps) {
  const m = useMaterials();
  const sunlight = useRef<THREE.DirectionalLight>(null);
  const worldScene = useThree(s => s.scene);
  useFrame(() => {
    if (plant.id !== "csp") return;
    const daylight = Math.min(1, (live.current?.summary.dni_wm2 ?? 950) / 350);
    worldScene.backgroundIntensity = 0.08 + 0.92 * daylight;
    worldScene.environmentIntensity = 0.15 + 0.65 * daylight;
    if (sunlight.current) sunlight.current.intensity = 0.08 + 1.32 * daylight;
  });
  const renewable = plant.id && plant.id !== "thermal";
  const extent = Math.max(...plant.site.bounds) / 2;
  const byId = useMemo(() => new Map(plant.devices.map((d) => [d.id, d])), [plant]);
  return (
    <>
      <Environment files={SKY} background environmentIntensity={0.8} />
      <directionalLight
        ref={sunlight}
        position={[-350, 600, 300]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-far={4000}
        shadow-bias={-0.0004}
      />
      {plant.id !== "offshore" && <mesh rotation-x={-Math.PI / 2} position-y={-2.2} receiveShadow onClick={() => onSelect(null)}>
        <planeGeometry args={[20000, 20000]} />
        <meshStandardMaterial color={plant.id === "solar" || plant.id === "csp" ? "#b0aa89" : renewable ? "#697e51" : "#82966e"} roughness={1} />
      </mesh>}
      {plant.id === "csp" ? <CspSite live={live} showFlows={showFlows} /> : renewable ? <RenewableSite plant={plant} /> : <Site plant={plant} m={m} openUnit={cutaway || selectedId !== null || stage !== null} onSelect={onSelect} />}
      {plant.devices.map((d) => (
        <DeviceNode
          key={d.id}
          d={d}
          live={live}
          m={m}
          lang={lang}
          selected={d.id === selectedId}
          alarm={alarmIds.includes(d.id)}
          dimmed={stage !== null && d.stage !== stage}
          cutaway={cutaway}
          onSelect={onSelect}
        />
      ))}
      {!renewable && stage === null && <SiteProps site={plant.site} />}
      {!renewable && (stage === null || stage === "expansion" || stage === "generation") && <TurbineDeck devices={plant.devices} m={m} />}
      {showFlows && plant.flows.map((f, i) => {
        const from = byId.get(f.from);
        const to = byId.get(f.to);
        if (!from || !to) return null;
        if (stage !== null && from.stage !== stage && to.stage !== stage) return null;
        return <FlowLine key={`${f.from}-${f.to}-${i}`} flow={f} from={from} to={to} index={i} live={live} />;
      })}
    </>
  );
}

type SceneProps = {
  active: boolean;
  live: RefObject<Telemetry | null>;
  plant: Plant;
  lang: Lang;
  selectedId: string | null;
  stage: string | null;
  cutaway: boolean;
  showFlows: boolean;
  overview: number;
  alarmIds: string[];
  onSelect: (id: string | null) => void;
};

export const Scene = memo(function Scene(props: SceneProps) {
  const camera = useMemo(() => ({ position: props.plant.site.camera.position, fov: 45, near: 0.5, far: 8000 }), [props.plant]);
  return (
    <Canvas
      shadows
      frameloop={props.active ? "always" : "demand"}
      camera={camera}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <World {...props} />
      <OrbitControls makeDefault target={props.plant.site.camera.target} maxPolarAngle={Math.PI / 2.05} minDistance={15} maxDistance={Math.max(...props.plant.site.bounds) * 2.8} />
      <CameraRig plant={props.plant} focusId={props.selectedId} overview={props.overview} />
    </Canvas>
  );
});

export { MEDIUM_COLOR };
