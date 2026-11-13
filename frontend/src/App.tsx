import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene, MEDIUM_COLOR } from "./Scene";
import { sourcesForScene } from "./models";
import { SCENES, isSceneId, type SceneId } from "./scenes";
import { Bi, label } from "./text";
import type { Device, Lang, Plant } from "./types";
import { Dashboard, FeedControls, MetricStrip, VIEWS, type View } from "./Dashboard";
import { useTelemetry, type Telemetry } from "./telemetry";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; plant: Plant };

const LANGS: { id: Lang; text: string }[] = [
  { id: "zh", text: "中文" },
  { id: "en", text: "EN" },
  { id: "both", text: "中 / EN" },
];

const MEDIUM_NAME: Record<string, { zh: string; en: string }> = {
  solar_heat: { zh: "聚光", en: "Concentrated sunlight" },
  hot_salt: { zh: "热盐", en: "Hot salt" },
  cold_salt: { zh: "冷盐", en: "Cold salt" },
  coal: { zh: "煤", en: "Coal" },
  air: { zh: "空气", en: "Air" },
  flue_gas: { zh: "烟气", en: "Flue gas" },
  steam: { zh: "蒸汽", en: "Steam" },
  water: { zh: "给水/凝结水", en: "Feed/condensate" },
  cooling_water: { zh: "循环水", en: "Cooling water" },
  shaft: { zh: "轴功", en: "Shaft power" },
  power: { zh: "电能", en: "Electric power" },
};

function usePlant(scene: SceneId): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    let unmounted = false;
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), 10_000);
    fetch(`/api/plant?scene=${scene}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((plant: Plant) => { if (!unmounted) setLoad({ state: "ready", plant }); })
      .catch((e: Error) => {
        if (!unmounted) setLoad({ state: "error", message: e.message });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      unmounted = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [scene]);
  return load;
}

function DeviceDetail({ d, plant, lang, live, onClose }: { d: Device; plant: Plant; lang: Lang; live: Telemetry | null; onClose: () => void }) {
  const stage = plant.stages.find((s) => s.id === d.stage);
  const modality = (id: string) => plant.modalities.find((m) => m.id === id)?.name ?? { zh: id, en: id };
  return (
    <aside className="panel detail" aria-labelledby="detail-title">
      <header className="detail-head">
        <div>
          <p className="kks">{d.kks}</p>
          <h2 id="detail-title">
            <Bi t={d.name} lang={lang} />
          </h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭 / Close">
          ×
        </button>
      </header>
      {stage && (
        <p className="conversion">
          <Bi t={stage.conversion} lang={lang} />
        </p>
      )}
      <section>
        <h3>{label({ zh: "工作原理", en: "How it works" }, lang)}</h3>
        <p className="prose">
          <Bi t={d.principle} lang={lang} />
        </p>
      </section>
      {d.params.length > 0 && (
        <section>
          <h3>{label({ zh: "额定参数", en: "Rated parameters" }, lang)}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{label({ zh: "测点", en: "Signal" }, lang)}</th>
                  <th>{label({ zh: "额定", en: "Nominal" }, lang)}</th>
                  <th>{label({ zh: "当前演示值", en: "Demo reading" }, lang)}</th>
                  <th>{label({ zh: "报警", en: "Alarm" }, lang)}</th>
                </tr>
              </thead>
              <tbody>
                {d.params.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <Bi t={p.name} lang={lang} />
                    </td>
                    <td className="num">
                      {p.nominal.toLocaleString()} {p.unit}
                    </td>
                    <td className="num">{live?.devices[d.id]?.[p.key]?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"} {p.unit}</td>
                    <td className="num">
                      {p.alarm_high !== undefined ? `> ${p.alarm_high}` : p.alarm_low !== undefined ? `< ${p.alarm_low}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {d.failure_modes.length > 0 && (
        <section>
          <h3>{label({ zh: "典型故障与巡检模态", en: "Failure modes and inspection modalities" }, lang)}</h3>
          <ul className="faults">
            {d.failure_modes.map((f) => (
              <li key={f.id}>
                <strong>
                  <Bi t={f.name} lang={lang} />
                </strong>
                <p>
                  <Bi t={f.signature} lang={lang} />
                </p>
                <p className="chips">
                  {f.modalities.map((m) => (
                    <span key={m} className="chip">
                      {label(modality(m), lang === "both" ? "zh" : lang)}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {live?.alarm_devices.includes(d.id) && <p className="feed-warning">{label({ zh: "合成场景融合告警：至少两种模态越限。证据详情见「多模态巡检」。", en: "Synthetic fused alarm: at least two modalities over limit. See Multimodal inspection for evidence." }, lang)}</p>}
    </aside>
  );
}

const TOUR_STEP_MS = 9000;

function Credits({ lang, scene, onClose }: { lang: Lang; scene: SceneId; onClose: () => void }) {
  return (
    <aside className="panel credits" aria-labelledby="credits-title">
      <header className="detail-head">
        <h2 id="credits-title">{label({ zh: "模型来源", en: "Model credits" }, lang)}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭 / Close">
          ×
        </button>
      </header>
      <ul className="credit-list">
        {sourcesForScene(scene).map((s) => (
          <li key={s.id}>
            <a href={s.page} target="_blank" rel="noreferrer">
              {s.title ?? s.id}
            </a>{" "}
            · {s.author} · {s.licence === "CC-BY-4.0" ? <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">{s.licence}</a> : s.licence}
          </li>
        ))}
      </ul>
      <p className="prose">
        {label(
          {
            zh: "通过 Allen AI Objaverse 镜像下载自 Sketchfab。模型经旋转、缩放和压缩适配，部分模型另经减面或材质调色，光伏组件按阵列重复布置。HDRI 与材质来自 Poly Haven、ambientCG（CC0）。其余设备为程序化建模。",
            en: "Downloaded from Sketchfab via the Allen AI Objaverse mirror. Models rotated, scaled and compressed; some also simplified or recolored; PV modules repeated as arrays. HDRI and textures from Poly Haven and ambientCG (CC0). Other devices are procedural.",
          },
          lang,
        )}
      </p>
    </aside>
  );
}

function TourBar(props: {
  plant: Plant;
  steps: Device[];
  index: number;
  lang: Lang;
  playing: boolean;
  onIndex: (i: number) => void;
  onPlaying: (p: boolean) => void;
  onExit: () => void;
}) {
  const { plant, steps, index, lang, playing, onIndex, onPlaying, onExit } = props;
  const d = steps[index];
  const stage = plant.stages.find((s) => s.id === d.stage);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => (index + 1 < steps.length ? onIndex(index + 1) : onPlaying(false)), TOUR_STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, steps.length, onIndex, onPlaying]);
  return (
    <div className="tour" role="region" aria-label={label({ zh: "能量链导览", en: "Energy-chain tour" }, lang)}>
      <p className="tour-step" aria-live="polite">
        <span className="tour-count">
          {index + 1} / {steps.length}
          {stage && ` · ${label(stage.conversion, lang === "both" ? "zh" : lang)}`}
        </span>
        <strong>{label(d.name, lang)}</strong>
      </p>
      <div className="tour-actions">
        <button type="button" className="icon-btn" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="上一步 / Previous">
          ‹
        </button>
        <button type="button" className="icon-btn" onClick={() => onPlaying(!playing)} aria-label={playing ? "暂停 / Pause" : "播放 / Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={index + 1 >= steps.length}
          onClick={() => onIndex(index + 1)}
          aria-label="下一步 / Next"
        >
          ›
        </button>
        <button type="button" className="icon-btn" onClick={onExit} aria-label="退出导览 / Exit tour">
          ×
        </button>
      </div>
    </div>
  );
}

export function App() {
  const initial = new URLSearchParams(window.location.search).get("scene");
  const [scene, setScene] = useState<SceneId>(isSceneId(initial) ? initial : "thermal");
  const [lang, setLang] = useState<Lang>("both");
  const changeScene = (id: SceneId) => {
    const url = new URL(window.location.href); url.searchParams.set("scene", id);
    window.history.replaceState(null, "", url); setScene(id);
  };
  return <PlantApp key={scene} scene={scene} onScene={changeScene} lang={lang} onLang={setLang} />;
}

function PlantApp({ scene, onScene, lang, onLang }: { scene: SceneId; onScene: (id: SceneId) => void; lang: Lang; onLang: (lang: Lang) => void }) {
  const load = usePlant(scene);
  const feed = useTelemetry(scene);
  const liveRef = useRef<Telemetry | null>(null);
  liveRef.current = feed.data;
  const alarmKey = feed.data?.alarm_devices.join(",") ?? "";
  const alarmIds = useMemo(() => alarmKey ? alarmKey.split(",") : [], [alarmKey]);
  const [view, setView] = useState<View>("site");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [cutaway, setCutaway] = useState(false);
  const [showFlows, setShowFlows] = useState(scene === "csp");
  const [overview, setOverview] = useState(0);
  const [credits, setCredits] = useState(false);
  const [tour, setTour] = useState<{ index: number; playing: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setTour(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const plant = load.state === "ready" ? load.plant : null;
  const stages = useMemo(() => (plant ? [...plant.stages].sort((a, b) => a.order - b.order) : []), [plant]);
  const selected = plant?.devices.find((d) => d.id === selectedId) ?? null;
  // Tour follows the energy chain: stage order, then catalog order within a stage.
  const tourSteps = useMemo(() => stages.flatMap((s) => plant?.devices.filter((d) => d.stage === s.id) ?? []), [plant, stages]);

  const goTour = useCallback(
    (index: number, playing: boolean) => {
      const d = tourSteps[index];
      setView("site");
      setTour({ index, playing });
      setSelectedId(d.id);
      setStage(d.stage);
    },
    [tourSteps],
  );
  const exitTour = () => {
    setTour(null);
    setStage(null);
  };
  const showOverview = () => {
    setView("site");
    setTour(null);
    setSelectedId(null);
    setStage(null);
    setCutaway(false);
    setOverview(n => n + 1);
  };
  const locate = (id: string) => {
    setView("site");
    setTour(null);
    setStage(null);
    setSelectedId(id);
  };

  return (
    <div className="app">
      <a className="skip" href="#main">
        跳到主内容 / Skip to content
      </a>
      <header className="topbar">
        <h1>{plant ? label(plant.plant.name, lang) : "W-PowerTwin 电厂数字孪生 · Power Plant Digital Twin"}</h1>
        <div className="lang" role="group" aria-label="语言 / Language">
          {LANGS.map((l) => (
            <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => onLang(l.id)}>
              {l.text}
            </button>
          ))}
        </div>
      </header>

      <nav className="scene-nav" aria-label={label({ zh: "发电场景", en: "Generation scenes" }, lang)}>
        {SCENES.map(s => <button type="button" key={s.id} aria-current={scene === s.id ? "page" : undefined} onClick={() => onScene(s.id as SceneId)}>{label(s.name, lang)}</button>)}
        <span>{label({ zh: "示意场站 · 合成数据", en: "Illustrative sites · synthetic data" }, lang)}</span>
      </nav>
      {load.state === "loading" && <p className="status">加载电厂模型… / Loading plant…</p>}
      {load.state === "error" && (
        <p className="status error" role="alert">
          无法加载电厂数据 / Could not load plant data: {load.message}. 请确认后端已启动 / Check that the server is running.
        </p>
      )}

      {plant && (
        <main id="main" className="workspace">
          <nav className="panel stages" aria-label={label({ zh: "能量转换链", en: "Energy conversion chain" }, lang)}>
            <p className="prose summary">
              <Bi t={plant.plant.summary} lang={lang} />
            </p>
            <button type="button" className="stage-btn" aria-pressed={stage === null} onClick={showOverview}>
              {label({ zh: "全厂", en: "Whole plant" }, lang)}
            </button>
            <ol>
              {stages.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="stage-btn"
                    aria-pressed={stage === s.id}
                    onClick={() => { setView("site"); setStage(stage === s.id ? null : s.id); }}
                  >
                    <span className="stage-name">
                      {s.order}. <Bi t={s.name} lang={lang} />
                    </span>
                    <span className="stage-conv">{label(s.conversion, lang === "both" ? "zh" : lang)}</span>
                  </button>
                  {stage === s.id && (
                    <ul className="device-list">
                      {plant.devices
                        .filter((d) => d.stage === s.id)
                        .map((d) => (
                          <li key={d.id}>
                            <button type="button" aria-current={d.id === selectedId} onClick={() => { setView("site"); setSelectedId(d.id); }}>
                              {label(d.name, lang === "both" ? "zh" : lang)}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            <h2 className="legend-title">{label({ zh: "介质图例", en: "Flow legend" }, lang)}</h2>
            <ul className="legend">
              {Object.entries(MEDIUM_NAME).filter(([id]) => scene === "thermal" || (scene === "csp" ? ["solar_heat", "hot_salt", "cold_salt", "steam", "water", "power"].includes(id) : id === "power")).map(([id, name]) => (
                <li key={id}>
                  <span className="swatch" style={{ background: MEDIUM_COLOR[id] }} aria-hidden />
                  {label(name, lang === "both" ? "zh" : lang)}
                </li>
              ))}
            </ul>
          </nav>

          <div className="console">
            <nav className="view-nav" aria-label={label({ zh: "工作台视图", en: "Console views" }, lang)}>
              {VIEWS.map(v => <button type="button" key={v.id} aria-current={view === v.id ? "page" : undefined} onClick={() => { setView(v.id); if (v.id !== "site") setTour(null); }}>{label(v.name, lang)}</button>)}
            </nav>
            <FeedControls feed={feed} plant={plant} lang={lang} />
            <MetricStrip feed={feed} plant={plant} lang={lang} />
          </div>
          <section className="viewport" aria-label={label(VIEWS.find(v => v.id === view)!.name, lang)}>
            <div className={`scene-surface${view !== "site" ? " scene-hidden" : ""}`} aria-hidden={view !== "site"}>
            <Suspense fallback={<p className="status">加载材质与光照… / Loading materials…</p>}>
              <Scene key={scene} live={liveRef} active={view === "site"} plant={plant} lang={lang} selectedId={selectedId} stage={stage} cutaway={cutaway} showFlows={showFlows || tour !== null} overview={overview} alarmIds={alarmIds} onSelect={setSelectedId} />
            </Suspense>
            </div>
            {view === "site" ? <>
            <div className={`toolbar${selected ? " with-detail" : ""}`}>
              <button type="button" onClick={showOverview}>
                {label({ zh: "厂区总览", en: "Site overview" }, lang)}
              </button>
              <button type="button" hidden={scene !== "thermal"} aria-pressed={cutaway} onClick={() => setCutaway(!cutaway)}>
                {label({ zh: "剖视", en: "Cutaway" }, lang)}
              </button>
              <button type="button" aria-pressed={tour !== null} onClick={() => (tour ? exitTour() : goTour(0, true))}>
                {label({ zh: "能量链导览", en: "Guided tour" }, lang)}
              </button>
              <button type="button" aria-pressed={showFlows} onClick={() => setShowFlows(!showFlows)}>
                {label({ zh: "能量流", en: "Energy flow" }, lang)}
              </button>
              <button type="button" aria-pressed={credits} onClick={() => setCredits(!credits)}>
                {label({ zh: "模型来源", en: "Credits" }, lang)}
              </button>
            </div>
            {scene !== "thermal" && !tour && <div className="site-badge">{label({ zh: "示意装机", en: "Illustrative capacity" }, lang)} {plant.plant.rated?.capacity_mw} MW{scene === "csp" ? "e · " + plant.plant.rated?.storage_capacity_mwhth + " MWhth" : scene === "solar" ? "ac · " + plant.plant.rated?.dc_capacity_mwp + " MWp" : " · " + plant.plant.rated?.unit_count + " WTG"}</div>}
            {credits && <Credits scene={scene} lang={lang} onClose={() => setCredits(false)} />}
            {tour && (
              <TourBar
                plant={plant}
                steps={tourSteps}
                index={tour.index}
                lang={lang}
                playing={tour.playing}
                onIndex={(i) => goTour(i, tour.playing)}
                onPlaying={(p) => setTour({ ...tour, playing: p })}
                onExit={exitTour}
              />
            )}
            </> : <Dashboard view={view} plant={plant} feed={feed} lang={lang} onLocate={locate} />}
            {selected && view === "site" && <DeviceDetail d={selected} plant={plant} lang={lang} live={feed.data} onClose={() => setSelectedId(null)} />}
          </section>
        </main>
      )}
    </div>
  );
}
