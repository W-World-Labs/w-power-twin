//! Reduced two-tank CSP model. A deterministic, accelerated daily heat balance,
//! not a real weather feed, detailed salt hydraulic model or steam-table solver.
use crate::telemetry::limit;
use serde_json::{Value, json};

struct Model {
    area: f64,
    optical: f64,
    receiver: f64,
    peak: f64,
    demand: f64,
    capacity: f64,
    loss: f64,
}
#[derive(Default)]
struct Heat {
    dni: f64,
    incident: f64,
    absorbed: f64,
    charge: f64,
    discharge: f64,
    spill: f64,
    standing: f64,
    cycle: f64,
}
impl Model {
    fn heat(&self, hour: f64, stored: f64, dt: f64, cloud: f64, wear: f64, hotspot: f64) -> Heat {
        let dni = self.peak * (((hour - 6.0) / 12.0 * std::f64::consts::PI).sin()).max(0.0) * cloud;
        let incident = dni * self.area / 1e6;
        let absorbed =
            incident * self.optical * self.receiver * (1.0 - 0.2 * wear - 0.08 * hotspot);
        let standing = (stored * self.loss).min(stored / dt);
        let available = (stored - standing * dt).max(0.0);
        let direct = absorbed.min(self.demand);
        let charge =
            (absorbed - direct).min((self.capacity - stored + standing * dt).max(0.0) / dt);
        let discharge = (self.demand - direct).min(available / dt);
        Heat {
            dni,
            incident,
            absorbed,
            charge,
            discharge,
            spill: (absorbed - direct - charge).max(0.0),
            standing,
            cycle: direct + discharge,
        }
    }
    fn step(&self, e: f64, hour: f64, dt: f64, cloud: f64, wear: f64, hotspot: f64) -> f64 {
        let h = self.heat(hour, e, dt, cloud, wear, hotspot);
        (e + (h.charge - h.discharge - h.standing) * dt).clamp(0.0, self.capacity)
    }
    fn stored_at(&self, hour: f64, cloud: f64, wear: f64, hotspot: f64) -> f64 {
        // Settle the repeating day to its periodic storage state, then integrate
        // from midnight to the displayed hour. One-minute synthetic time steps.
        let dt = 1.0 / 60.0;
        let mut e = 0.0;
        for _ in 0..12 {
            let start = e;
            for i in 0..1440 {
                e = self.step(e, (i as f64 + 0.5) * dt, dt, cloud, wear, hotspot);
            }
            if (e - start).abs() < 1e-7 {
                break;
            }
        }
        let steps = (hour / dt).floor() as usize;
        for i in 0..steps {
            e = self.step(e, (i as f64 + 0.5) * dt, dt, cloud, wear, hotspot);
        }
        let remainder = hour - steps as f64 * dt;
        if remainder > 1e-10 {
            e = self.step(
                e,
                steps as f64 * dt + remainder / 2.0,
                remainder,
                cloud,
                wear,
                hotspot,
            );
        }
        e
    }
}

pub fn snapshot(catalog: &Value, scenario: &str, t: f64) -> Value {
    let rated = &catalog["plant"]["rated"];
    let r = |key: &str| rated[key].as_f64().unwrap();
    let severity = 1.0;
    let fault = |id| if scenario == id { severity } else { 0.0 };
    let wear = fault("salt-pump-wear");
    let hotspot = fault("receiver-hotspot");
    let xfmr = fault("xfmr-overheat");
    // Presets replay monotonic daytime/nighttime windows, rather than making
    // solar time oscillate backwards while the dashboard claims to charge.
    let span = match scenario {
        "normal" => 24.0,
        "night-discharge" => 3.0,
        _ => 2.0,
    };
    let phase = (t / 60.0).rem_euclid(span);
    let hour = match scenario {
        "normal" => phase,
        "night-discharge" => 19.0 + phase,
        "storage-empty" => 3.0,
        _ => 10.0 + phase,
    };
    let simulation_cycle = (t / (span * 60.0)).floor() as u64;
    let cloud = if scenario == "cloud-front" { 0.22 } else { 1.0 };
    let model = Model {
        area: r("heliostat_count") * r("mirror_area_m2"),
        optical: r("optical_efficiency"),
        receiver: r("receiver_efficiency"),
        peak: r("dni_peak_wm2"),
        demand: r("capacity_mw") / r("cycle_efficiency"),
        capacity: r("storage_capacity_mwhth"),
        loss: r("storage_loss_per_hour"),
    };
    let stored = if scenario == "storage-empty" {
        0.0
    } else {
        model.stored_at(hour, cloud, wear, hotspot)
    };
    let h = model.heat(hour, stored, 1.0 / 3600.0, cloud, wear, hotspot);
    let gross = h.cycle * r("cycle_efficiency");
    let auxiliary = gross * 0.065;
    let transformer_loss = (gross - auxiliary) * (0.006 + 0.004 * xfmr);
    let export = gross - auxiliary - transformer_loss;
    let oil = r("ambient_c") + 35.0 * (gross / r("capacity_mw")).powi(2) + 70.0 * xfmr;
    let h2 = 20.0 + 185.0 * xfmr;
    let hot = r("hot_salt_c");
    let cold = r("cold_salt_c");
    let flow = h.absorbed * 1000.0 / (r("salt_cp_kj_kg_k") * (hot - cold));
    let surface = if h.absorbed > 0.0 {
        hot + 25.0 + 100.0 * hotspot
    } else {
        cold
    };
    let imbalance = 3.0 + 30.0 * hotspot;
    let vibration = 2.0 + 6.0 * wear;
    let bearing = r("ambient_c") + 27.0 * (h.absorbed / 808.0) + 65.0 * wear;
    let acoustic = 52.0 + 28.0 * wear;
    let soc = stored / model.capacity * 100.0;
    let current = export * 1000.0 / (3.0_f64.sqrt() * r("grid_kv") * 0.98);
    let devices = json!({
        "heliostat-field":{"dni_wm2":h.dni,"optical_efficiency_pct":model.optical*100.0,"incident_mw":h.incident},
        "receiver":{"thermal_mw":h.absorbed,"outlet_c":if h.absorbed>0.0 {hot} else {cold},"surface_c":surface,"flux_imbalance_pct":imbalance,"flow_kg_s":flow},
        "hot-tank":{"temperature_c":hot,"stored_mwhth":stored,"soc_pct":soc,"charge_mwth":h.charge,"discharge_mwth":h.discharge},
        "cold-tank":{"temperature_c":cold,"inventory_pct":100.0-soc},
        "salt-pump":{"flow_kg_s":flow,"vibration_mm_s":vibration,"bearing_c":bearing,"acoustic_db":acoustic},
        "steam-generator":{"thermal_mw":h.cycle,"steam_c":if gross>0.0 {540.0} else {25.0},"steam_mpa":if gross>0.0 {13.0} else {0.0}},
        "generator":{"active_power_mw":gross,"rpm":if gross>0.0 {3000.0} else {0.0}},
        "air-cooler":{"rejected_mw":h.cycle-gross},
        "main-transformer":{"top_oil_c":oil,"h2_ppm":h2},
        "transmission-line":{"voltage_kv":r("grid_kv"),"current_a":current}
    });
    let evidence = |modality: &str, value: f64, threshold: f64, unit: &str| json!({"modality":modality,"value":value,"threshold":threshold,"unit":unit,"exceeded":value>threshold});
    let mut detections = Vec::new();
    for d in catalog["devices"].as_array().unwrap() {
        let id = d["id"].as_str().unwrap();
        for f in d["failure_modes"].as_array().unwrap() {
            let fault_id = f["id"].as_str().unwrap();
            let e = match fault_id {
                "receiver-hotspot" => vec![
                    evidence("infrared", surface, limit(catalog, id, "surface_c"), "°C"),
                    evidence(
                        "process",
                        imbalance,
                        limit(catalog, id, "flux_imbalance_pct"),
                        "%",
                    ),
                ],
                "salt-pump-wear" => vec![
                    evidence(
                        "vibration",
                        vibration,
                        limit(catalog, id, "vibration_mm_s"),
                        "mm/s",
                    ),
                    evidence("infrared", bearing, limit(catalog, id, "bearing_c"), "°C"),
                    evidence(
                        "acoustic",
                        acoustic,
                        limit(catalog, id, "acoustic_db"),
                        "dB",
                    ),
                ],
                "xfmr-overheat" => vec![
                    evidence("process", oil, limit(catalog, id, "top_oil_c"), "°C"),
                    evidence(
                        "infrared",
                        oil + 8.0,
                        limit(catalog, id, "top_oil_c") + 8.0,
                        "°C",
                    ),
                    evidence("dga", h2, limit(catalog, id, "h2_ppm"), "μL/L"),
                ],
                _ => unreachable!("catalog rule"),
            };
            let votes = e.iter().filter(|e| e["exceeded"] == true).count();
            detections.push(
                json!({"device":id,"fault":fault_id,"votes":votes,"active":votes>=2,"evidence":e}),
            );
        }
    }
    let alarms: Vec<_> = detections
        .iter()
        .filter(|d| d["active"] == true)
        .map(|d| d["device"].clone())
        .collect();
    json!({"timestamp_ms":(t*1000.0) as u64,"sequence":t as u64,"scene":"csp","scenario":scenario,"source":"synthetic","model":"csp-two-tank-reduced-v1","devices":devices,
        "summary":{"power_mw":gross,"export_mw":export,"capacity_mw":r("capacity_mw"),"load_pct":gross/r("capacity_mw")*100.0,"dni_wm2":h.dni,"irradiance_wm2":h.dni,"stored_mwhth":stored,"soc_pct":soc,"hot_salt_c":hot,"cold_salt_c":cold,"solar_hour":hour,"simulation_cycle":simulation_cycle,"condition_c":surface,"oil_c":oil,"bearing_vibration_mm_s":vibration,"line_current_a":current,"frequency_hz":50.0,"running_units":usize::from(gross>0.0),"unit_count":1},
        "energy":{"input_mw":h.incident,"absorbed_mwth":h.absorbed,"optical_loss_mw":h.incident*(1.0-model.optical),"receiver_loss_mw":h.incident*model.optical-h.absorbed,"charge_mwth":h.charge,"discharge_mwth":h.discharge,"storage_loss_mwth":h.standing,"storage_rate_mwth":h.charge-h.discharge-h.standing,"spill_mwth":h.spill,"cycle_mwth":h.cycle,"gross_mw":gross,"rejected_mw":h.cycle-gross,"auxiliary_mw":auxiliary,"transformer_loss_mw":transformer_loss,"export_mw":export,"generator_kv":r("collection_kv"),"grid_kv":r("grid_kv"),"power_factor":0.98},
        "detections":detections,"alarm_devices":alarms,"modalities":{"process":"synthetic","infrared":"synthetic","vibration":"synthetic","acoustic":"synthetic","dga":"synthetic","partial_discharge":"not_connected","visible":"not_connected","gas":"not_connected"}
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn catalog() -> Value {
        serde_json::from_str::<Value>(include_str!("../../data/renewables.json")).unwrap()["csp"]
            .clone()
    }
    #[test]
    fn day_charges_night_dispatches_and_empty_storage_stops() {
        let c = catalog();
        for t in [0.0, 1000.0, 100000.0] {
            let day = snapshot(&c, "day-charge", t);
            let night = snapshot(&c, "night-discharge", t);
            let empty = snapshot(&c, "storage-empty", t);
            assert!(day["energy"]["charge_mwth"].as_f64().unwrap() > 0.0);
            assert_eq!(night["energy"]["input_mw"], 0.0);
            assert!(night["energy"]["discharge_mwth"].as_f64().unwrap() > 0.0);
            assert!(night["summary"]["export_mw"].as_f64().unwrap() > 0.0);
            assert_eq!(empty["summary"]["power_mw"], 0.0);
            assert_eq!(empty["devices"]["generator"]["rpm"], 0.0);
        }
    }
    #[test]
    fn all_scenarios_close_thermal_electrical_and_storage_balances_and_faults() {
        let c = catalog();
        for option in c["scenarios"].as_array().unwrap() {
            let id = option["id"].as_str().unwrap();
            for t in (0..1440).step_by(37) {
                let s = snapshot(&c, id, t as f64);
                let e = &s["energy"];
                let v = |k: &str| e[k].as_f64().unwrap();
                let loss = v("optical_loss_mw")
                    + v("receiver_loss_mw")
                    + v("spill_mwth")
                    + v("storage_rate_mwth")
                    + v("storage_loss_mwth")
                    + v("rejected_mw")
                    + v("auxiliary_mw")
                    + v("transformer_loss_mw")
                    + v("export_mw");
                assert!((v("input_mw") - loss).abs() < 1e-8, "{id}/{t}");
                assert!(
                    (v("absorbed_mwth") + v("discharge_mwth")
                        - v("cycle_mwth")
                        - v("charge_mwth")
                        - v("spill_mwth"))
                    .abs()
                        < 1e-8
                );
                assert!((0.0..=100.0).contains(&s["summary"]["soc_pct"].as_f64().unwrap()));
                assert!(v("charge_mwth") == 0.0 || v("discharge_mwth") == 0.0);
                assert_eq!(s["devices"]["generator"]["active_power_mw"], e["gross_mw"]);
                let alarms = s["detections"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|d| d["active"] == true)
                    .collect::<Vec<_>>();
                let is_fault =
                    matches!(id, "receiver-hotspot" | "salt-pump-wear" | "xfmr-overheat");
                assert_eq!(alarms.len(), usize::from(is_fault), "{id}/{t}");
                if is_fault {
                    assert_eq!(alarms[0]["fault"], id);
                }
            }
        }
    }
    #[test]
    fn storage_derivative_tracks_charge_discharge_and_loss() {
        let c = catalog();
        // All nonempty presets advance monotonically at 60x within a replay.
        for scenario in [
            "normal",
            "day-charge",
            "night-discharge",
            "cloud-front",
            "receiver-hotspot",
            "salt-pump-wear",
            "xfmr-overheat",
        ] {
            for t in [610.0, 660.0, 1100.0, 1200.0] {
                let a = snapshot(&c, scenario, t);
                let b = snapshot(&c, scenario, t + 0.001);
                let derivative = (b["summary"]["stored_mwhth"].as_f64().unwrap()
                    - a["summary"]["stored_mwhth"].as_f64().unwrap())
                    / (0.001 / 60.0);
                let expected = a["energy"]["storage_rate_mwth"].as_f64().unwrap();
                assert!(
                    (derivative - expected).abs() < 1.0,
                    "{scenario}/{t}: {derivative} vs {expected}"
                );
            }
        }
    }
}
