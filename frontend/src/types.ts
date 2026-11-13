export type Text = { zh: string; en: string };
export type Lang = "zh" | "en" | "both";
export type Vec3 = [number, number, number];

export type Param = {
  key: string;
  name: Text;
  unit: string;
  nominal: number;
  alarm_high?: number;
  alarm_low?: number;
};

export type FailureMode = {
  id: string;
  name: Text;
  modalities: string[];
  signature: Text;
};

export type Device = {
  id: string;
  kks: string;
  kind: string;
  stage: string;
  name: Text;
  principle: Text;
  position: Vec3;
  size: Vec3;
  params: Param[];
  failure_modes: FailureMode[];
};

export type Stage = { id: string; order: number; name: Text; conversion: Text };
export type Flow = { from: string; to: string; medium: string; note?: string };
export type Modality = { id: string; name: Text };

export type Plant = {
  id?: import("./scenes").SceneId;
  scenarios?: { id: string; name: Text }[];
  plant: { name: Text; summary: Text; rated?: Record<string, number> };
  site: {
    bounds: [number, number];
    units: { id: string; name: Text; hall: Vec3; boiler: Vec3; cooling_tower: Vec3; detailed: boolean }[];
    secondary_stack: Vec3;
    storage_tanks: Vec3;
    camera: { position: Vec3; target: Vec3 };
  };
  stages: Stage[];
  devices: Device[];
  flows: Flow[];
  modalities: Modality[];
};
