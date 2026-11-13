import type { Text } from "./types";
export const SCENES = [
  { id: "thermal", name: { zh: "燃煤电厂", en: "Thermal plant" } },
  { id: "onshore", name: { zh: "陆上风电", en: "Onshore wind" } },
  { id: "offshore", name: { zh: "海上风电", en: "Offshore wind" } },
  { id: "solar", name: { zh: "光伏电站", en: "Solar farm" } },
  { id: "csp", name: { zh: "塔式光热", en: "Solar tower CSP" } },
] satisfies { id: string; name: Text }[];
export type SceneId = "thermal" | "onshore" | "offshore" | "solar" | "csp";
export const isSceneId = (id: string | null): id is SceneId => SCENES.some(s => s.id === id);
