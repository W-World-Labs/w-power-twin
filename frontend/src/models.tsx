import { Component, Suspense, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import sources from "../../data/sources.json";
import type { Plant, Vec3 } from "./types";

/**
 * Downloaded models placed in the scene. Each is fitted to a box (or a height) after rotation,
 * centred on x/z and set on the ground, so source units do not matter.
 * - `device` + `replace`: draws instead of that device's procedural shape; `when` limits it to
 *   the closed or cutaway view, otherwise the procedural shape is used for that view.
 * - `device` without `replace`: extra model next to the device, `offset` from its origin.
 * - no `device`: site prop at world `offset`.
 */
type Placement = {
  source: string;
  device?: string;
  replace?: boolean;
  when?: "closed" | "cut";
  offset?: Vec3;
  rotationY?: number;
  fit: { size: Vec3 } | { height: number };
};

const QUARTER = Math.PI / 2;

export const PLACEMENTS: Placement[] = [
  { source: "sf-3a033547", device: "main-transformer", replace: true, rotationY: QUARTER, fit: { size: [14, 10, 8] } },
  { source: "sf-8f8a6439", device: "generator", replace: true, when: "closed", rotationY: QUARTER, fit: { size: [14, 6, 6] } },
  { source: "sf-4e414db5", device: "generator", replace: true, when: "cut", rotationY: QUARTER, fit: { size: [14, 7, 7] } },
  { source: "sf-675553d3", device: "transmission-line", replace: true, fit: { height: 50 } },
  { source: "sf-4ec5347d", device: "feedwater-pump", replace: true, when: "closed", rotationY: QUARTER, fit: { size: [8, 4, 4] } },
  { source: "sf-e9554994", device: "coal-yard", replace: true, rotationY: QUARTER, fit: { size: [82, 12, 170] } },
  { source: "sf-34f215d9", device: "coal-yard", offset: [34, 0, -15], fit: { height: 14 } },
  { source: "sf-bd3ac970", fit: { size: [40, 35, 40] } },
  { source: "sf-5d114e1b", offset: [-210, 0, 50], rotationY: -QUARTER, fit: { height: 0.85 } },
  { source: "sf-3e5b8566", offset: [-100, 35, 90], fit: { size: [0.9, 0.3, 0.9] } },
];

type ModelSource = { id: string; title?: string; author?: string; page: string; licence: string; path: string };
const SOURCE_BY_ID = new Map((sources.models as ModelSource[]).map((m) => [m.id, m]));

/** Sources actually drawn by the scene, for the credits panel. */
export const USED_SOURCES: ModelSource[] = [...new Set(PLACEMENTS.map((p) => p.source))].map((id) => SOURCE_BY_ID.get(id)!);

export const modelUrl = (source: string) => `/assets/${SOURCE_BY_ID.get(source)!.path}/scene.glb`;
const url = (p: Placement) => modelUrl(p.source);
export function sourcesForScene(scene: string) {
  if (scene === "thermal") return USED_SOURCES;
  if (scene === "csp") return ["sf-8f8a6439", "sf-3a033547", "sf-675553d3"].map(id => SOURCE_BY_ID.get(id)!);
  return [scene === "solar" ? "sf-f441251b" : "sf-28503240", "sf-3a033547", "sf-675553d3"].map(id => SOURCE_BY_ID.get(id)!);
}

function Fitted({ p }: { p: Placement }) {
  const { scene } = useGLTF(url(p), false, true);
  const object = useMemo(() => {
    const model = cloneSkinned(scene);
    model.rotation.y = p.rotationY ?? 0;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, -box.min.y, -centre.z);
    model.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const wrapper = new THREE.Group();
    wrapper.add(model);
    const s = "height" in p.fit ? p.fit.height / size.y : Math.min(...p.fit.size.map((v, i) => v / size.getComponent(i)));
    wrapper.scale.setScalar(s);
    return wrapper;
  }, [scene, p]);
  return <primitive object={object} />;
}

/** Shows `fallback` while loading and when the model file is missing (assets not fetched or optimized). */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
  }
}

function Model({ p, fallback = null }: { p: Placement; fallback?: ReactNode }) {
  return (
    <Fallback key={p.source} fallback={fallback}>
      <group position={p.offset}>
        <Fitted p={p} />
      </group>
    </Fallback>
  );
}

/** Device visual: a downloaded model when one is placed for this view, else `procedural`. */
export function DeviceModels({ deviceId, cut, procedural }: { deviceId: string; cut: boolean; procedural: ReactNode }) {
  const view = cut ? "cut" : "closed";
  const main = PLACEMENTS.find((p) => p.device === deviceId && p.replace && (!p.when || p.when === view));
  const extras = PLACEMENTS.filter((p) => p.device === deviceId && !p.replace);
  return (
    <>
      {main ? <Model p={main} fallback={procedural} /> : procedural}
      {extras.map((p) => (
        <Model key={p.source} p={p} />
      ))}
    </>
  );
}

export function SiteProps({ site }: { site: Plant["site"] }) {
  const placements = useMemo(() => PLACEMENTS.filter(p => !p.device).flatMap(p => {
    if (p.source !== "sf-bd3ac970") return [p];
    return [-23, 23].flatMap(x => [-20, 20].map(z => ({ ...p,
      offset: [site.storage_tanks[0] + x, site.storage_tanks[1], site.storage_tanks[2] + z] as Vec3,
    })));
  }), [site]);
  return (
    <>
      {placements.map((p, i) => (
        <Model key={`${p.source}-${i}`} p={p} />
      ))}
    </>
  );
}
