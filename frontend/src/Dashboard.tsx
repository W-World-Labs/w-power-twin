import { useEffect, useState } from "react";
import type { Lang, Plant, Text } from "./types";
import type { Feed, Telemetry } from "./telemetry";
import { SCENARIOS } from "./telemetry";
import { Bi, label } from "./text";

export const VIEWS: { id: View; name: Text }[] = [
  { id: "site", name: { zh: "三维厂区", en: "3D site" } },
  { id: "operations", name: { zh: "运行监测", en: "Operations" } },
  { id: "power", name: { zh: "能量与输电", en: "Energy & grid" } },
  { id: "inspection", name: { zh: "多模态巡检", en: "Multimodal inspection" } },
  { id: "transport", name: { zh: "数据传输", en: "Data transport" } },
];
export type View = "site" | "operations" | "power" | "inspection" | "transport";
export type LiveFeed = Feed & { scenario: string; setScenario: (id: string) => void };
const num = (value: number | undefined, digits = 1) => value === undefined ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function MetricStrip({ feed, lang, plant }: { feed: Feed; lang: Lang; plant: Plant }) {
  const s = feed.data?.summary;
  const renewable = plant.id && plant.id !== "thermal";
  const metrics: readonly (readonly [string, string, number | undefined, string])[] = plant.id === "csp" ? [
    ["发电出力", "Generator output", s?.power_mw, "MWe"], ["上网功率", "Grid export", s?.export_mw, "MWe"],
    ["太阳直射辐照", "Direct irradiance", s?.dni_wm2, "W/m²"], ["储热比例", "Storage SOC", s?.soc_pct, "%"],
    ["热盐温度", "Hot salt", s?.hot_salt_c, "°C"], ["融合告警", "Fused alarms", feed.data?.alarm_devices.length, ""],
  ] as const : renewable ? [
    ["场站出力", "Site power", s?.power_mw, "MW"], ["上网功率", "Grid export", s?.export_mw, "MW"],
    plant.id === "solar" ? ["辐照度", "Irradiance", s?.irradiance_wm2, "W/m²"] : ["风速", "Wind speed", s?.wind_ms, "m/s"],
    ["发电单元", "Generating units", s?.running_units, `/ ${plant.plant.rated?.unit_count}`],
    ["主变油温", "Transformer oil", s?.oil_c, "°C"], ["融合告警", "Fused alarms", feed.data?.alarm_devices.length, ""],
  ] as const : [
    ["机组出力", "Gross power", s?.power_mw, "MW"], ["上网功率", "Grid export", s?.export_mw, "MW"],
    ["汽轮机转速", "Turbine speed", s?.rpm, "rpm"], ["轴振动", "Shaft vibration", s?.shaft_vibration_um, "μm"],
    ["主变油温", "Transformer oil", s?.oil_c, "°C"], ["融合告警", "Fused alarms", feed.data?.alarm_devices.length, ""],
  ] as const;
  return <div className="metric-strip">{metrics.map(([zh, en, value, unit], i) => <div className={`metric ${i === 5 && value ? "metric-alarm" : ""}`} key={en}>
    <span>{label({ zh, en }, lang)}</span><strong>{num(value, (!renewable && i === 2) || (renewable && plant.id !== "csp" && i === 3) || i === 5 ? 0 : 1)} <small>{unit}</small></strong>
  </div>)}</div>;
}

export function FeedControls({ feed, lang, plant }: { feed: LiveFeed; lang: Lang; plant: Plant }) {
  return <div className="feed-controls">
    <span className={`connection ${feed.status}`} role="status">● {label(feed.status === "online" ? { zh: "数据已连接", en: "Data connected" } : feed.status === "offline" ? { zh: "连接中断 · 数据已冻结", en: "Disconnected · readings frozen" } : { zh: "连接中", en: "Connecting" }, lang)}</span>
    <span className="demo-source">{label(plant.id ? { zh: "场站合成数据 · 每秒采样", en: "Synthetic site data · 1 s sampling" } : { zh: "1号机组 · 合成演示数据 · 每秒采样", en: "Unit 1 · synthetic demo · 1 s sampling" }, lang)}</span>
    <label className="scenario-label">{label({ zh: "演示场景", en: "Demo scenario" }, lang)}
      <select value={feed.scenario} onChange={e => feed.setScenario(e.target.value)}>{(plant.scenarios ?? SCENARIOS).map(s => <option value={s.id} key={s.id}>{label(s.name, lang)}</option>)}</select>
    </label>
  </div>;
}

function Trend({ values, color, title, unit, limit }: { values: number[]; color: string; title: string; unit: string; limit?: number }) {
  const lo = Math.min(...values, limit ?? Infinity) * 0.9;
  const hi = Math.max(...values, limit ?? -Infinity) * 1.08;
  const y = (v: number) => 88 - (v - lo) / Math.max(hi - lo, 1) * 70;
  const path = values.map((v, i) => `${i ? "L" : "M"}${12 + i / Math.max(values.length - 1, 1) * 336},${y(v)}`).join(" ");
  return <article className="data-card trend"><h3>{title}</h3><strong>{num(values.at(-1))} <small>{unit}</small></strong>
    <svg viewBox="0 0 360 108" role="img" aria-label={`${title}, ${values.length} samples`}>
      {[25, 55, 85].map(v => <path key={v} d={`M12 ${v}H348`} stroke="#dce7ee" />)}
      {limit !== undefined && <path d={`M12 ${y(limit)}H348`} stroke="#e05252" strokeDasharray="5 4" />}
      {values.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2.5" />}
      <text x="12" y="105" fill="#64748b" fontSize="10">{values.length} / 60 samples</text>
    </svg>
  </article>;
}

function DeviceTable({ plant, data, lang, ids, onLocate }: { plant: Plant; data: Telemetry; lang: Lang; ids: string[]; onLocate: (id: string) => void }) {
  return <div className="table-wrap"><table className="live-table"><thead><tr>
    <th>{label({ zh: "设备 / 测点", en: "Device / signal" }, lang)}</th><th>{label({ zh: "当前演示值", en: "Current demo reading" }, lang)}</th>
    <th>{label({ zh: "额定 / 报警", en: "Nominal / alarm" }, lang)}</th><th>{label({ zh: "状态", en: "Status" }, lang)}</th>
  </tr></thead><tbody>{ids.flatMap(id => {
    const d = plant.devices.find(x => x.id === id)!;
    return d.params.map((p, i) => {
      const v = data.devices[id]?.[p.key];
      const alarm = v !== undefined && ((p.alarm_high !== undefined && v > p.alarm_high) || (p.alarm_low !== undefined && v < p.alarm_low));
      return <tr key={`${id}-${p.key}`} className={alarm ? "reading-alarm" : ""}><td>
        {i === 0 && <button className="locate-link" onClick={() => onLocate(id)}>{label(d.name, lang)} ↗</button>}
        <span className="signal-name">{label(p.name, lang)}</span></td>
        <td className="num">{num(v)} {p.unit}</td><td>{num(p.nominal)} / {p.alarm_high !== undefined ? `> ${p.alarm_high}` : p.alarm_low !== undefined ? `< ${p.alarm_low}` : "—"}</td>
        <td><span className={`state-pill ${alarm ? "alarm" : "normal"}`}>{label(alarm ? { zh: "越限", en: "Over limit" } : { zh: "正常", en: "Normal" }, lang)}</span></td></tr>;
    });
  })}</tbody></table></div>;
}

function Inspection({ plant, data, lang, onLocate }: { plant: Plant; data: Telemetry; lang: Lang; onLocate: (id: string) => void }) {
  const name = (id: string) => plant.modalities.find(m => m.id === id)!.name;
  const [selected, setSelected] = useState("xfmr-overheat");
  const rule = data.detections.find(r => r.fault === selected) ?? data.detections[0];
  const infrared = rule.evidence.find(e => e.modality === "infrared");
  const acoustic = rule.evidence.find(e => e.modality === "acoustic");
  const heat = infrared ? Math.min(1, Math.max(0, (infrared.value - 35) / 80)) : 0;
  return <>
    <div className="modality-grid">{plant.modalities.map(m => <article className="data-card modality" key={m.id}>
      <h3><Bi t={m.name} lang={lang} /></h3><span className={`state-pill ${data.modalities[m.id] === "synthetic" ? "demo" : "unavailable"}`}>{label(data.modalities[m.id] === "synthetic" ? { zh: "合成特征 · 规则检测", en: "Synthetic features · rules" } : { zh: "未接入", en: "Not connected" }, lang)}</span>
    </article>)}</div>
    <div className="inspection-layout"><section className="data-card"><h3>{label({ zh: "设备融合检测", en: "Device fusion results" }, lang)}</h3>
      {data.detections.map(r => {
        const d = plant.devices.find(d => d.id === r.device)!;
        const f = d.failure_modes.find(f => f.id === r.fault)!;
        return <button key={r.fault} className={`detection-row ${r.active ? "detected" : ""} ${rule.fault === r.fault ? "chosen" : ""}`} onClick={() => setSelected(r.fault)} aria-pressed={rule.fault === r.fault}>
          <span><strong>{label(d.name, lang)}</strong><span>{label(f.name, lang)}</span></span><span>{r.votes}/{r.evidence.length} {label({ zh: "模态越限", en: "modalities over limit" }, lang)}<b>{label(r.active ? { zh: "疑似异常", en: "Suspected fault" } : { zh: "未触发", en: "Not triggered" }, lang)}</b></span>
        </button>;
      })}</section>
      <section className="data-card evidence-card"><h3>{label({ zh: "证据与规则解释", en: "Evidence & rule explanation" }, lang)}</h3>
        <p>{label({ zh: "至少两种模态同时越限才触发融合告警；这些是演示规则，没有调用远程 AI 模型。", en: "A fused alarm requires at least two modalities over their thresholds. Demo rules; no remote AI inference." }, lang)}</p>
        <div className="evidence-list">{rule.evidence.map(e => <div key={e.modality} className={e.exceeded ? "reading-alarm" : ""}>
          <span>{label(name(e.modality), lang)}</span><strong>{num(e.value)} {e.unit}</strong><small>{label({ zh: "阈值", en: "Threshold" }, lang)} &gt; {num(e.threshold)} {e.unit}</small>
        </div>)}</div>
        {infrared && <figure className="feature-preview"><svg viewBox="0 0 300 110" role="img" aria-label="Synthetic thermal schematic">
          <defs><radialGradient id="thermal-demo"><stop stopColor={heat > 0.6 ? "#fff291" : "#5fdac5"} /><stop offset="0.4" stopColor={heat > 0.6 ? "#ff7137" : "#3984c9"} /><stop offset="1" stopColor="#24336a" /></radialGradient></defs>
          <rect x="0" y="0" width="300" height="110" rx="8" fill="#14243e" /><rect x="45" y="15" width="210" height="80" rx="10" fill="url(#thermal-demo)" />
          <text x="150" y="61" textAnchor="middle" fill="white" fontSize="20">{num(infrared.value)} °C</text>
        </svg><figcaption>{label({ zh: "合成热场示意 · 非实拍热像", en: "Synthetic thermal schematic · not a captured image" }, lang)}</figcaption></figure>}
        {acoustic && <figure className="feature-preview"><svg viewBox="0 0 300 80" role="img" aria-label="Synthetic acoustic feature waveform">
          <rect width="300" height="80" rx="8" fill="#14243e" /><path fill="none" stroke="#68d6c7" strokeWidth="1.4" d={Array.from({ length: 240 }, (_, i) => `${i ? "L" : "M"}${i * 1.25},${40 + Math.sin(i * 0.7) * Math.sin(i * 0.083) * (acoustic.value - 25) * 0.55}`).join(" ")} />
        </svg><figcaption>{label({ zh: "合成声学特征示意 · 非录音检测", en: "Synthetic acoustic feature · not recorded audio inference" }, lang)}</figcaption></figure>}
        <button className="primary-button" onClick={() => onLocate(rule.device)}>{label({ zh: "定位三维设备", en: "Locate in 3D" }, lang)} ↗</button>
      </section></div>
    <p className="dashboard-note">{label({ zh: "可见光视频、气体传感器、真实音视频推理和 VLM 根因分析尚未接入。标注为合成特征的模态来自同一简化演示模型；附加阈值为演示设定。", en: "Visible video, gas sensors, real audiovisual inference and VLM root-cause analysis are not connected. Modalities marked synthetic share one reduced demo model; additional thresholds are illustrative." }, lang)}</p>
  </>;
}

function RenewableOperations({ plant, feed, data, lang, onLocate }: { plant: Plant; feed: Feed; data: Telemetry; lang: Lang; onLocate: (id: string) => void }) {
  const solar = plant.id === "solar";
  const generators = plant.devices.filter(d => d.stage === "generation");
  return <>
    <div className="chart-grid">
      <Trend values={feed.history.map(s => s.power)} color="#228a9f" title={label({ zh: "场站出力", en: "Site output" }, lang)} unit="MW" />
      <Trend values={feed.history.map(s => s.resource)} color="#b6953b" title={label(solar ? { zh: "辐照度", en: "Irradiance" } : { zh: "来流风速", en: "Incoming wind" }, lang)} unit={solar ? "W/m²" : "m/s"} />
      <Trend values={feed.history.map(s => s.condition)} color="#b97748" title={label(solar ? { zh: "最高组件温度", en: "Maximum cell temperature" } : { zh: "最高轴承温度", en: "Maximum bearing temperature" }, lang)} unit="°C" limit={85} />
    </div>
    <div className="operation-summary"><span>{label({ zh: "示意装机", en: "Illustrative capacity" }, lang)} <b>{plant.plant.rated?.capacity_mw} MW{solar ? "ac" : ""}</b></span>
      {solar && <span>{label({ zh: "直流装机", en: "DC capacity" }, lang)} <b>{plant.plant.rated?.dc_capacity_mwp} MWp</b></span>}
      <span>{label({ zh: "发电单元", en: "Generating units" }, lang)} <b>{data.summary.running_units} / {data.summary.unit_count}</b></span>
      <span>{label({ zh: "并网频率", en: "Grid frequency" }, lang)} <b>{num(data.summary.frequency_hz)} Hz</b></span></div>
    <div className="unit-grid">{generators.map(d => <button className={`unit-card ${data.alarm_devices.includes(d.id) ? "fault" : ""}`} key={d.id} onClick={() => onLocate(d.id)}>
      <span>{label(d.name, lang)} ↗</span><strong>{num(data.devices[d.id]?.active_power_mw, 2)} <small>MW</small></strong>
      <small>{solar ? `${num(data.devices[d.id]?.cell_c)} °C · ${num(data.devices[d.id]?.mismatch_pct)} % ΔI` : `${num(data.devices[d.id]?.rpm)} rpm · ${num(data.devices[d.id]?.vibration_mm_s)} mm/s`}</small>
    </button>)}</div>
    <section className="data-card"><h3>{label({ zh: "设备运行测点", en: "Equipment signals" }, lang)}</h3><DeviceTable plant={plant} data={data} lang={lang} ids={plant.devices.filter(d => d.kind !== "line").map(d => d.id)} onLocate={onLocate} /></section>
    <p className="dashboard-note">{label(solar ? { zh: "辐照、温度修正和逆变效率共同决定出力；阵列为代表性布置，容量为演示配置。", en: "Irradiance, temperature correction and inverter efficiency determine output. Arrays are representative; capacity is illustrative." } : { zh: "风速经简化功率曲线及尾流折减驱动各机组；低于切入或达到切出风速时出力与叶轮转速归零。", en: "A reduced power curve and wake factors drive each turbine. Below cut-in or at cut-out, output and rotor RPM are zero." }, lang)}</p>
  </>;
}

function RenewablePower({ plant, data, lang, onLocate }: { plant: Plant; data: Telemetry; lang: Lang; onLocate: (id: string) => void }) {
  const e = data.energy, solar = plant.id === "solar", offshore = plant.id === "offshore";
  const first = plant.devices.find(d => d.stage === "generation")!;
  const nodes: [Text, number, string, string][] = [
    [solar ? { zh: "组件直流", en: "Array DC" } : { zh: "可用风机出力", en: "Available turbine output" }, e.input_mw, "MW", first.id],
    [solar ? { zh: "逆变器交流", en: "Inverter AC" } : { zh: "风机汇总", en: "Turbine total" }, e.gross_mw, "MW", solar ? "inverter-01" : first.id],
    [{ zh: "集电母线", en: "Collector bus" }, e.gross_mw - e.auxiliary_mw - e.collection_loss_mw, `${plant.plant.rated?.collection_kv} kV`, "collector"],
    [{ zh: offshore ? "海上升压 / 海缆" : "主变升压", en: offshore ? "Offshore step-up / cable" : "Step-up transformer" }, e.export_mw + e.cable_loss_mw, `${e.generator_kv} → ${e.grid_kv} kV`, offshore ? "export-cable" : "main-transformer"],
    [{ zh: "电网送出", en: "Grid export" }, e.export_mw, `${e.grid_kv} kV`, "transmission-line"],
  ];
  return <>
    <div className="power-chain">{nodes.map(([name, value, unit, id], i) => <button key={i} className="power-node" onClick={() => onLocate(id)}><span>{label(name, lang)}</span><strong>{num(value, 2)}</strong><small>{unit}</small><span className="chain-arrow">→</span></button>)}</div>
    <div className="energy-balance">{[
      ["转换 / 降额", "Conversion / derating", e.conversion_loss_mw], ["站用电", "Auxiliary power", e.auxiliary_mw],
      ["集电损耗", "Collection loss", e.collection_loss_mw], ["主变损耗", "Transformer loss", e.transformer_loss_mw], ["海缆损耗", "Export cable loss", e.cable_loss_mw],
    ].map(([zh, en, value]) => <article className="data-card" key={String(en)}><h3>{label({ zh: String(zh), en: String(en) }, lang)}</h3><strong>{num(Number(value), 2)} <small>MW</small></strong></article>)}</div>
    <div className="operation-summary"><span>{label({ zh: "线路电流", en: "Line current" }, lang)} <b>{num(data.summary.line_current_a)} A</b></span><span>{label({ zh: "功率因数", en: "Power factor" }, lang)} <b>{e.power_factor}</b></span><span>{label({ zh: "收支残差", en: "Balance residual" }, lang)} <b>{num(e.input_mw - e.export_mw - e.conversion_loss_mw - e.auxiliary_mw - e.collection_loss_mw - e.transformer_loss_mw - e.cable_loss_mw, 6)} MW</b></span></div>
    <section className="data-card"><h3>{label({ zh: "集电与送出设备", en: "Collection & export equipment" }, lang)}</h3><DeviceTable plant={plant} data={data} lang={lang} ids={plant.devices.filter(d => ["collector", "main-transformer", "export-cable", "transmission-line"].includes(d.id)).map(d => d.id)} onLocate={onLocate} /></section>
    <p className="dashboard-note">{label({ zh: "电功率收支来自同一合成状态：输入 = 净上网功率 + 转换降额 + 站用电 + 集电、主变与送出损耗。场站容量与路径为教学示意。", en: "One synthetic state closes the balance: input = net export + conversion / derating + auxiliaries + collection, transformer and export losses. Capacities and routes are illustrative." }, lang)}</p>
  </>;
}

function CspOperations({ plant, feed, data, lang, onLocate }: { plant: Plant; feed: Feed; data: Telemetry; lang: Lang; onLocate: (id: string) => void }) {
  const s = data.summary, e = data.energy;
  return <>
    <div className="chart-grid">
      <Trend values={feed.history.map(s => s.power)} color="#228a9f" title={label({ zh: "汽轮发电出力", en: "Turbine-generator output" }, lang)} unit="MWe" />
      <Trend values={feed.history.map(s => s.resource)} color="#c99b38" title={label({ zh: "太阳直射辐照", en: "Direct normal irradiance" }, lang)} unit="W/m²" />
      <Trend values={feed.history.map(s => s.storage)} color="#d66e43" title={label({ zh: "储热余量", en: "Stored thermal energy" }, lang)} unit="MWhth" />
    </div>
    <section className="data-card storage-overview"><div><p className="eyebrow">THERMAL ENERGY STORAGE</p><h3>{label({ zh: "熔盐双罐储热", en: "Two-tank molten-salt storage" }, lang)}</h3><p>{label({ zh: "白天把多余热量存起来，夜间继续驱动汽轮发电机。", en: "Store surplus heat by day; dispatch the turbine-generator at night." }, lang)}</p></div>
      <div className="storage-tanks">
        <button className="storage-vessel hot" onClick={() => onLocate("hot-tank")}><span>{label({ zh: "热盐罐", en: "Hot salt tank" }, lang)} ↗</span><strong>{num(s.hot_salt_c, 0)} °C</strong><div className="storage-level"><i style={{ height: `${s.soc_pct}%` }} /></div><b>{num(s.stored_mwhth)} / {plant.plant.rated?.storage_capacity_mwhth} MWhth</b></button>
        <div className="storage-dispatch"><strong>{num(s.soc_pct)} % SOC</strong><span>{label({ zh: "充热", en: "Charge" }, lang)} +{num(e.charge_mwth)} MWth</span><span>{label({ zh: "放热", en: "Discharge" }, lang)} −{num(e.discharge_mwth)} MWth</span><span>{label({ zh: "储能变化率", en: "Storage rate" }, lang)} {num(e.storage_rate_mwth)} MWth</span><small>{label({ zh: "保温损耗", en: "Standing loss" }, lang)} {num(e.storage_loss_mwth, 3)} MWth</small></div>
        <button className="storage-vessel cold" onClick={() => onLocate("cold-tank")}><span>{label({ zh: "冷盐罐", en: "Cold salt tank" }, lang)} ↗</span><strong>{num(s.cold_salt_c, 0)} °C</strong><div className="storage-level"><i style={{ height: `${100 - s.soc_pct}%` }} /></div><b>{label({ zh: "冷盐库存示意", en: "Cold salt inventory" }, lang)} {num(100 - s.soc_pct)} %</b></button>
      </div>
    </section>
    <div className="operation-summary"><span>{label({ zh: "合成太阳时", en: "Synthetic solar time" }, lang)} <b>{Math.floor(s.solar_hour).toString().padStart(2, "0")}:{Math.floor((s.solar_hour % 1) * 60).toString().padStart(2, "0")}</b></span><span>{label({ zh: "汽轮机转速", en: "Turbine speed" }, lang)} <b>{num(data.devices.generator.rpm, 0)} rpm</b></span><span>{label({ zh: "热 / 电额定容量", en: "Storage / electrical rating" }, lang)} <b>{plant.plant.rated?.storage_capacity_mwhth} MWhth / {plant.plant.rated?.capacity_mw} MWe</b></span></div>
    <section className="data-card"><h3>{label({ zh: "聚光、吸热、储热与发电测点", en: "Concentration, receiver, storage & power signals" }, lang)}</h3><DeviceTable plant={plant} data={data} lang={lang} ids={plant.devices.map(d => d.id)} onLocate={onLocate} /></section>
    <p className="dashboard-note">{label({ zh: "熔盐储存的是热量，MWhth 不能直接等同于电能 MWh。昼夜及白天、夜间片段均以 60 倍时间循环演示，重播时趋势重新采样；冷罐盐仍为液态。镜场仅展示代表性镜位，额定配置为 11250 面 × 120 m²。储罐保温、换热和汽轮循环采用简化教学模型。", en: "MWhth measures heat, not electrical MWh. The daily cycle and day/night excerpts loop at 60× time; trends restart when an excerpt replays. Cold-tank salt remains liquid. Mirror positions are representative of a configured 11,250 × 120 m² field. Storage, heat exchange and the steam cycle are reduced educational models." }, lang)}</p>
  </>;
}
function CspPower({ plant, data, lang, onLocate }: { plant: Plant; data: Telemetry; lang: Lang; onLocate: (id: string) => void }) {
  const e = data.energy;
  const residual = e.input_mw - e.optical_loss_mw - e.receiver_loss_mw - e.spill_mwth - e.storage_rate_mwth - e.storage_loss_mwth - e.rejected_mw - e.auxiliary_mw - e.transformer_loss_mw - e.export_mw;
  const nodes: [Text, number, string, string][] = [
    [{ zh: "镜面太阳输入", en: "Incident sunlight" }, e.input_mw, "MWth", "heliostat-field"],
    [{ zh: "吸热器输出", en: "Receiver heat" }, e.absorbed_mwth, "MWth", "receiver"],
    [{ zh: "蒸汽循环输入", en: "Steam-cycle heat" }, e.cycle_mwth, "MWth", "steam-generator"],
    [{ zh: "汽轮发电", en: "Generator" }, e.gross_mw, "MWe", "generator"],
    [{ zh: "净上网", en: "Net grid export" }, e.export_mw, "MWe · 220 kV", "transmission-line"],
  ];
  return <>
    <div className="power-chain">{nodes.map(([name, value, unit, id]) => <button className="power-node" key={id} onClick={() => onLocate(id)}><span>{label(name, lang)}</span><strong>{num(value, 2)}</strong><small>{unit}</small><span className="chain-arrow">→</span></button>)}</div>
    <section className="data-card storage-flow"><h3>{label({ zh: "储热是能量链中的缓冲", en: "Storage buffers the energy chain" }, lang)}</h3><p>{label({ zh: "吸热 + 放热 = 蒸汽循环 + 充热 + 弃热；夜间太阳输入为零时，循环热量全部来自储罐。", en: "Receiver + discharge = cycle + charge + curtailment. At night, storage supplies all cycle heat." }, lang)}</p>
      <div className="operation-summary"><span>{label({ zh: "充热", en: "Charging" }, lang)} <b>{num(e.charge_mwth)} MWth</b></span><span>{label({ zh: "放热", en: "Discharging" }, lang)} <b>{num(e.discharge_mwth)} MWth</b></span><span>{label({ zh: "储热余量", en: "Stored heat" }, lang)} <b>{num(data.summary.stored_mwhth)} MWhth</b></span><span>{label({ zh: "储能变化率", en: "Storage rate" }, lang)} <b>{num(e.storage_rate_mwth)} MWth</b></span></div>
    </section>
    <div className="energy-balance">{[
      ["光学损失", "Optical losses", e.optical_loss_mw], ["吸热器损失", "Receiver losses", e.receiver_loss_mw], ["满罐弃热", "Storage curtailment", e.spill_mwth], ["储罐保温损耗", "Storage standing loss", e.storage_loss_mwth], ["冷端排热", "Cycle rejected heat", e.rejected_mw], ["厂用电", "Auxiliary power", e.auxiliary_mw], ["主变损耗", "Transformer loss", e.transformer_loss_mw],
    ].map(([zh, en, value]) => <article className="data-card" key={String(en)}><h3>{label({ zh: String(zh), en: String(en) }, lang)}</h3><strong>{num(Number(value), 2)} <small>MW</small></strong></article>)}</div>
    <div className="operation-summary"><span>{label({ zh: "全链收支残差", en: "Whole-chain balance residual" }, lang)} <b>{num(Math.abs(residual) < 1e-8 ? 0 : residual, 6)} MW</b></span><span>{label({ zh: "电网电流", en: "Grid current" }, lang)} <b>{num(data.summary.line_current_a)} A</b></span><span>{label({ zh: "演示循环效率", en: "Demo cycle efficiency" }, lang)} <b>{(plant.plant.rated?.cycle_efficiency ?? 0) * 100} %</b></span></div>
    <section className="data-card"><h3>{label({ zh: "汽轮机与输变电", en: "Power block & grid" }, lang)}</h3><DeviceTable plant={plant} data={data} lang={lang} ids={["steam-generator", "generator", "air-cooler", "main-transformer", "transmission-line"]} onLocate={onLocate} /></section>
    <p className="dashboard-note">{label({ zh: "全链守恒：太阳输入 = 储能变化率 + 光学、吸热、弃热、保温损失 + 冷端排热 + 厂用电 + 主变损耗 + 净上网电力。储能变化率在放热时为负。容量与效率均为演示设定，未接入真实电站或天气数据。", en: "Incident solar heat = storage rate + optical, receiver, curtailment and storage losses + rejected heat + auxiliaries + transformer loss + net export. Storage rate is negative during dispatch. Capacities and efficiencies are illustrative; no real plant or weather feed." }, lang)}</p>
  </>;
}

export function Dashboard({ view, plant, feed, lang, onLocate }: { view: Exclude<View, "site">; plant: Plant; feed: LiveFeed; lang: Lang; onLocate: (id: string) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const d = feed.data;
  return <div className="dashboard" aria-label={label(VIEWS.find(v => v.id === view)!.name, lang)}>
    <header className="dashboard-heading"><div><p className="eyebrow">{plant.id ? `${plant.id.toUpperCase()} / W-POWERTWIN` : "UNIT 01 / W-POWERTWIN"}</p><h2>{label(VIEWS.find(v => v.id === view)!.name, lang)}</h2></div>
      <span className="sample-time">{d ? new Date(d.timestamp_ms).toLocaleTimeString() : "—"}</span></header>
    {feed.status === "offline" && <p className="feed-warning" role="alert">{label({ zh: "数据连接中断，下方保留最后一次样本；恢复连接后自动更新。", en: "Data disconnected. Last sample retained; updates resume automatically." }, lang)}</p>}
    {!d ? <p className="status">{label({ zh: "等待过程模型数据…", en: "Waiting for process model data…" }, lang)}</p> : <>
      {view === "operations" && !plant.id && <>
        <div className="chart-grid"><Trend values={feed.history.map(s => s.power)} color="#228a9f" title={label({ zh: "机组出力趋势", en: "Unit power trend" }, lang)} unit="MW" />
          <Trend values={feed.history.map(s => s.vibration)} color="#7465bb" title={label({ zh: "汽轮机轴振动", en: "Turbine shaft vibration" }, lang)} unit="μm" limit={125} />
          <Trend values={feed.history.map(s => s.oil)} color="#c28239" title={label({ zh: "主变油温趋势", en: "Transformer oil temperature" }, lang)} unit="°C" limit={85} /></div>
        <div className="operation-summary"><span>{label({ zh: "并网转速", en: "Synchronous speed" }, lang)} <b>{num(d.summary.rpm, 0)} rpm</b></span><span>{label({ zh: "主汽压力 / 温度", en: "Main steam pressure / temperature" }, lang)} <b>{num(d.summary.steam_mpa, 2)} MPa / {num(d.summary.steam_c)} °C</b></span><span>{label({ zh: "频率", en: "Frequency" }, lang)} <b>{num(d.summary.frequency_hz)} Hz</b></span></div>
        <section className="data-card"><h3>{label({ zh: "汽轮发电机组与辅机测点", en: "Turbine-generator and auxiliary signals" }, lang)}</h3>
          <DeviceTable plant={plant} data={d} lang={lang} ids={["hp-turbine", "ip-turbine", "lp-turbine", "generator", "boiler", "feedwater-pump", "condenser"]} onLocate={onLocate} /></section>
      </>}
      {view === "power" && !plant.id && <>
        <div className="power-chain">{[
          ["锅炉输入", "Boiler input", d.energy.thermal_mw, "MWth", "boiler"], ["汽轮机轴功", "Turbine shaft", d.energy.shaft_mw, "MW", "hp-turbine"],
          ["发电机", "Generator", d.energy.gross_mw, `${d.energy.generator_kv} kV`, "generator"], ["主变升压", "Step-up transformer", d.energy.gross_mw - d.energy.auxiliary_mw, `${d.energy.generator_kv} → ${d.energy.grid_kv} kV`, "main-transformer"],
          ["开关站 / 上网", "Switchyard / export", d.energy.export_mw, `${d.energy.grid_kv} kV`, "switchyard"],
        ].map(([zh, en, v, unit, id]) => <button key={String(id)} className="power-node" onClick={() => onLocate(String(id))}><span>{label({ zh: String(zh), en: String(en) }, lang)}</span><strong>{num(Number(v))}</strong><small>{unit}</small><span className="chain-arrow">→</span></button>)}</div>
        <div className="energy-balance">{[
          ["厂用电", "Auxiliary power", d.energy.auxiliary_mw], ["主变损耗", "Transformer loss", d.energy.transformer_loss_mw],
          ["发电机损耗", "Generator loss", d.energy.generator_loss_mw], ["冷端排热", "Rejected heat", d.energy.rejected_mw], ["锅炉损耗", "Boiler loss", d.energy.boiler_loss_mw],
        ].map(([zh, en, v]) => <article className="data-card" key={String(en)}><h3>{label({ zh: String(zh), en: String(en) }, lang)}</h3><strong>{num(Number(v))} <small>MW</small></strong></article>)}</div>
        <div className="operation-summary"><span>{label({ zh: "线路电流", en: "Line current" }, lang)} <b>{num(d.summary.line_current_a)} A</b></span><span>{label({ zh: "演示功率因数", en: "Demo power factor" }, lang)} <b>{d.energy.power_factor}</b></span><span>{label({ zh: "质量流量：蒸汽 / 给水", en: "Mass flow: steam / feedwater" }, lang)} <b>{num(d.summary.steam_flow_kg_s)} / {num(d.summary.feedwater_flow_kg_s)} kg/s</b></span></div>
        <section className="data-card"><h3>{label({ zh: "输变电设备状态", en: "Transmission equipment state" }, lang)}</h3><DeviceTable plant={plant} data={d} lang={lang} ids={["main-transformer", "switchyard", "transmission-line"]} onLocate={onLocate} /></section>
        <p className="dashboard-note">{label({ zh: "能量收支按同一状态守恒计算：热输入 = 上网电力 + 厂用电 + 各项损耗与排热。当前为简化教学模型，尚未接入 IAPWS-IF97 和真实电网数据。", en: "One state closes the energy balance: thermal input = grid export + auxiliary power + losses and rejected heat. Reduced educational model; IAPWS-IF97 and real grid feeds are not connected." }, lang)}</p>
      </>}
      {view === "operations" && plant.id && plant.id !== "csp" && <RenewableOperations plant={plant} feed={feed} data={d} lang={lang} onLocate={onLocate} />}
      {view === "power" && plant.id && plant.id !== "csp" && <RenewablePower plant={plant} data={d} lang={lang} onLocate={onLocate} />}
      {view === "operations" && plant.id === "csp" && <CspOperations plant={plant} feed={feed} data={d} lang={lang} onLocate={onLocate} />}
      {view === "power" && plant.id === "csp" && <CspPower plant={plant} data={d} lang={lang} onLocate={onLocate} />}
      {view === "inspection" && <Inspection plant={plant} data={d} lang={lang} onLocate={onLocate} />}
      {view === "transport" && <>
        <div className="chart-grid">{[
          ["成功样本", "Received samples", String(feed.received)], ["最新请求延迟", "Latest request latency", `${num(feed.latency, 0)} ms`],
          ["已接收 JSON", "Received JSON", `${num(feed.bytes / 1024)} KB`], ["失败请求", "Failed requests", String(feed.failed)],
          ["样本序列号", "Sample sequence", String(d.sequence)], ["距上次接收", "Since last response", `${num(Math.max(0, now - (feed.receivedAt ?? now)) / 1000)} s`],
        ].map(([zh, en, value]) => <article className="data-card" key={en}><h3>{label({ zh, en }, lang)}</h3><strong>{value}</strong></article>)}</div>
        <section className="data-card"><h3>{label({ zh: "数据路径与来源", en: "Data path & provenance" }, lang)}</h3><div className="data-path"><span>{label({ zh: "服务端过程模型", en: "Server process model" }, lang)}</span> → <code>HTTPS /api/telemetry?scene={plant.id ?? "thermal"}</code> → <span>HTTP JSON / 1 s</span> → <span>{label({ zh: "趋势 / 规则融合 / 三维告警", en: "Trends / rule fusion / 3D alarms" }, lang)}</span></div>
          <dl className="transport-details"><dt>{label({ zh: "模型", en: "Model" }, lang)}</dt><dd>{d.model}</dd><dt>{label({ zh: "测点数", en: "Signal count" }, lang)}</dt><dd>{Object.values(d.devices).reduce((n, v) => n + Object.keys(v).length, 0)}</dd><dt>{label({ zh: "采样时间", en: "Sample time" }, lang)}</dt><dd>{new Date(d.timestamp_ms).toISOString()}</dd><dt>{label({ zh: "传输方式", en: "Transport" }, lang)}</dt><dd>{label({ zh: "浏览器每秒请求，实际响应统计；非 MQTT / WebSocket", en: "One HTTP request per second, measured responses; MQTT / WebSocket not connected" }, lang)}</dd></dl>
        </section>
        <p className="dashboard-note">{label({ zh: "统计仅覆盖当前浏览器、本次场景。延迟为请求到完整 JSON 接收耗时，流量为未压缩 JSON 字节；异常时冻结最后数据并显示断线。", en: "Metrics cover this browser and scenario. Latency measures complete JSON receipt; bytes count uncompressed JSON. Disconnection freezes the last data and shows an offline state." }, lang)}</p>
      </>}
    </>}
  </div>;
}
