import { useEffect, useState } from "react";
import type { SceneId } from "./scenes";
import type { Text } from "./types";

export const SCENARIOS: { id: string; name: Text }[] = [
  { id: "normal", name: { zh: "正常运行", en: "Normal operation" } },
  { id: "xfmr-overheat", name: { zh: "主变过热", en: "Transformer overheating" } },
  { id: "fwp-bearing-wear", name: { zh: "给水泵轴承磨损", en: "Feed-pump bearing wear" } },
  { id: "tube-leak", name: { zh: "锅炉管泄漏", en: "Boiler tube leak" } },
  { id: "gis-pd", name: { zh: "GIS 局部放电", en: "GIS partial discharge" } },
  { id: "rotor-rub", name: { zh: "汽轮机转子碰摩", en: "Turbine rotor rub" } },
];

export type Evidence = { modality: string; value: number; threshold: number; unit: string; exceeded: boolean };
export type Detection = { device: string; fault: string; votes: number; active: boolean; evidence: Evidence[] };
export type Telemetry = {
  scene: SceneId; timestamp_ms: number; sequence: number; scenario: string; source: string; model: string;
  devices: Record<string, Record<string, number>>;
  summary: Record<string, number>;
  energy: Record<string, number>;
  detections: Detection[]; alarm_devices: string[];
  modalities: Record<string, "synthetic" | "not_connected">;
};
export type Sample = { time: number; power: number; vibration: number; oil: number; resource: number; condition: number; storage: number };
export type Feed = {
  data: Telemetry | null; history: Sample[]; status: "connecting" | "online" | "offline";
  received: number; failed: number; bytes: number; latency: number; receivedAt: number | null;
};
const EMPTY: Feed = { data: null, history: [], status: "connecting", received: 0, failed: 0, bytes: 0, latency: 0, receivedAt: null };

/** Serial, abortable HTTP sampling: no fabricated transport metrics or local random readings. */
export function useTelemetry(scene: SceneId) {
  const [scenario, setScenario] = useState(scene === "csp" ? "day-charge" : "normal");
  const [feed, setFeed] = useState<Feed>(EMPTY);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setFeed(EMPTY);
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const started = performance.now();
      try {
        const response = await fetch(`/api/telemetry?scenario=${encodeURIComponent(scenario)}&scene=${scene}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const body = await response.text();
        const data: Telemetry = JSON.parse(body);
        if (data.scene !== scene || data.scenario !== scenario || !data.summary || !Array.isArray(data.detections)) throw Error("Invalid telemetry response");
        if (stopped) return;
        const latency = performance.now() - started;
        const bytes = new TextEncoder().encode(body).byteLength;
        setFeed(previous => ({ data, status: "online", received: previous.received + 1, failed: previous.failed,
          bytes: previous.bytes + bytes, latency, receivedAt: Date.now(),
          history: [...(scene === "csp" && previous.data?.summary.simulation_cycle !== data.summary.simulation_cycle ? [] : previous.history), { time: data.timestamp_ms, power: data.summary.power_mw,
            vibration: data.summary.shaft_vibration_um ?? data.summary.bearing_vibration_mm_s ?? 0, oil: data.summary.oil_c, resource: scene === "solar" || scene === "csp" ? data.summary.irradiance_wm2 : data.summary.wind_ms, condition: data.summary.condition_c, storage: data.summary.stored_mwhth ?? 0 }].slice(-60),
        }));
      } catch {
        if (!stopped) setFeed(previous => ({ ...previous, status: "offline", failed: previous.failed + 1 }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, Math.max(50, 1000 - (performance.now() - started)));
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [scenario, scene]);
  return { ...feed, scenario, setScenario };
}
