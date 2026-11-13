//! Deterministic educational renewable model: shared resource, per-unit state and closed AC balance.
//! Capacity, curve breakpoints, PV temperature coefficient and alarm limits are catalog inputs.
use crate::telemetry::{limit, nominal};
use serde_json::{Value, json};

pub fn wind_fraction(v: f64, cut_in: f64, rated: f64, cut_out: f64) -> f64 {
    if v < cut_in || v >= cut_out {
        0.0
    } else {
        ((v.powi(3) - cut_in.powi(3)) / (rated.powi(3) - cut_in.powi(3))).clamp(0.0, 1.0)
    }
}

pub fn snapshot(catalog: &Value, scenario: &str, t: f64) -> Value {
    let scene = catalog["id"].as_str().unwrap();
    let solar = scene == "solar";
    let offshore = scene == "offshore";
    let rated = &catalog["plant"]["rated"];
    let r = |key: &str| rated[key].as_f64().unwrap();
    let severity = 0.94 + 0.06 * (t / 23.0).sin();
    let fault = |id| if scenario == id { severity } else { 0.0 };
    let bearing = fault("bearing-wear");
    let icing = fault("blade-icing");
    let hotspot = fault("pv-hotspot");
    let inverter_fault = fault("inverter-fault");
    let transformer_heat = fault("xfmr-overheat");
    let cable_heat = fault("export-cable-hot");
    let wind = if scenario == "high-wind" {
        28.0
    } else {
        (if offshore { 11.0 } else { 9.5 }) + 0.8 * (t / 31.0).sin()
    };
    let irradiance =
        (820.0 + 100.0 * (t / 43.0).sin()) * if scenario == "cloud-front" { 0.22 } else { 1.0 };
    let ambient = r("ambient_c");
    let mut devices = serde_json::Map::new();
    for d in catalog["devices"].as_array().unwrap() {
        let values = d["params"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p["key"].as_str().unwrap().to_owned(), p["nominal"].clone()))
            .collect();
        devices.insert(d["id"].as_str().unwrap().to_owned(), Value::Object(values));
    }
    let generators: Vec<_> = catalog["devices"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| d["stage"] == "generation")
        .collect();
    let mut input = 0.0;
    let mut gross = 0.0;
    let mut running = 0;
    let mut max_temperature: f64 = 0.0;
    let mut max_vibration: f64 = 0.0;
    for (i, d) in generators.iter().enumerate() {
        let id = d["id"].as_str().unwrap();
        let first = f64::from(i == 0);
        let values = &mut devices.get_mut(id).unwrap();
        let power = if solar {
            // Each catalog block has one inverter. Clouds and temperature act on the same irradiance state.
            let g = irradiance * (0.97 + 0.03 * ((t / 37.0) + i as f64 * 0.2).sin());
            let cell = ambient + 0.035 * g + 52.0 * hotspot * first;
            let healthy_cell = ambient + 0.035 * g;
            let dc = r("unit_mw") * r("dc_ac_ratio") * g / 1000.0
                * (1.0 + r("pv_temp_coefficient") * (healthy_cell - 25.0)).max(0.0);
            let efficiency = r("inverter_efficiency") - 0.23 * inverter_fault * first;
            let ac = (dc * (1.0 - 0.18 * hotspot * first) * efficiency).min(r("unit_mw"));
            input += dc;
            values["irradiance_wm2"] = json!(g);
            values["cell_c"] = json!(cell);
            values["mismatch_pct"] = json!(1.0 + 22.0 * hotspot * first);
            let inv = devices.get_mut(&format!("inverter-{:02}", i + 1)).unwrap();
            inv["efficiency_pct"] = json!(efficiency * 100.0);
            inv["loss_pct"] = json!((1.0 - efficiency) * 100.0);
            inv["temperature_c"] = json!(ambient + g * 0.03 + 50.0 * inverter_fault * first);
            inv["active_power_mw"] = json!(ac);
            max_temperature = max_temperature.max(cell);
            ac
        } else {
            let v = wind * (1.0 - 0.025 * (i / 4) as f64);
            let fraction = wind_fraction(v, r("cut_in_ms"), r("rated_wind_ms"), r("cut_out_ms"));
            let available = r("unit_mw") * fraction;
            input += available;
            let ac = available * (1.0 - first * (0.12 * bearing + 0.42 * icing));
            let rpm = if fraction == 0.0 {
                0.0
            } else {
                (6.0 + 6.0 * (v / r("rated_wind_ms")).min(1.0)) * if offshore { 0.79 } else { 1.0 }
            };
            let temperature = ambient + 35.0 * fraction.powi(2) + 65.0 * bearing * first;
            let vibration = 1.5 + fraction * 0.7 + 8.0 * (bearing + icing) * first;
            values["wind_ms"] = json!(v);
            values["rpm"] = json!(rpm);
            values["pitch_deg"] = json!(if fraction == 0.0 {
                90.0
            } else {
                ((v - 11.0) * 2.2).max(0.0)
            });
            values["bearing_c"] = json!(temperature);
            values["vibration_mm_s"] = json!(vibration);
            values["deficit_pct"] = json!(first * (12.0 * bearing + 42.0 * icing));
            max_temperature = max_temperature.max(temperature);
            max_vibration = max_vibration.max(vibration);
            ac
        };
        devices.get_mut(id).unwrap()["active_power_mw"] = json!(power);
        gross += power;
        if power > 0.001 {
            running += 1;
        }
    }
    let auxiliary = gross * 0.008;
    let collection_loss = gross * 0.012;
    let transformer_loss =
        (gross - auxiliary - collection_loss) * (0.006 + 0.004 * transformer_heat);
    let cable_loss_pct = if offshore {
        1.6 + 3.5 * cable_heat
    } else {
        0.0
    };
    let cable_loss =
        (gross - auxiliary - collection_loss - transformer_loss) * cable_loss_pct / 100.0;
    let export = gross - auxiliary - collection_loss - transformer_loss - cable_loss;
    let current = export * 1000.0 / (3.0_f64.sqrt() * r("grid_kv") * 0.98);
    let oil = ambient
        + (nominal(catalog, "main-transformer", "top_oil_c") - ambient)
            * (gross / r("capacity_mw")).powi(2)
        + 70.0 * transformer_heat;
    let h2 = nominal(catalog, "main-transformer", "h2_ppm") + 185.0 * transformer_heat;
    devices.get_mut("main-transformer").unwrap()["top_oil_c"] = json!(oil);
    devices.get_mut("main-transformer").unwrap()["h2_ppm"] = json!(h2);
    devices.get_mut("main-transformer").unwrap()["load_mva"] = json!(gross / 0.98);
    devices.get_mut("collector").unwrap()["active_power_mw"] = json!(gross);
    devices.get_mut("transmission-line").unwrap()["line_current_a"] = json!(current);
    let cable_temperature = ambient + 25.0 * (gross / r("capacity_mw")).powi(2) + 65.0 * cable_heat;
    if offshore {
        devices.get_mut("export-cable").unwrap()["temperature_c"] = json!(cable_temperature);
        devices.get_mut("export-cable").unwrap()["loss_pct"] = json!(cable_loss_pct);
    }
    let mut detections = Vec::new();
    for d in catalog["devices"].as_array().unwrap() {
        let id = d["id"].as_str().unwrap();
        let v = &devices[id];
        for f in d["failure_modes"].as_array().unwrap() {
            let fault_id = f["id"].as_str().unwrap();
            let e = |modality: &str, value: f64, threshold: f64, unit: &str| json!({"modality":modality,"value":value,"threshold":threshold,"unit":unit,"exceeded":value > threshold});
            let reading = |key: &str| v[key].as_f64().unwrap();
            let evidence = match fault_id {
                "bearing-wear" => vec![
                    e(
                        "vibration",
                        reading("vibration_mm_s"),
                        limit(catalog, id, "vibration_mm_s"),
                        "mm/s",
                    ),
                    e(
                        "infrared",
                        reading("bearing_c"),
                        limit(catalog, id, "bearing_c"),
                        "°C",
                    ),
                    e("acoustic", 42.0 + 23.0 * bearing, 55.0, "dB (demo)"),
                ],
                "blade-icing" => vec![
                    e(
                        "process",
                        reading("deficit_pct"),
                        limit(catalog, id, "deficit_pct"),
                        "%",
                    ),
                    e(
                        "vibration",
                        reading("vibration_mm_s"),
                        limit(catalog, id, "vibration_mm_s"),
                        "mm/s",
                    ),
                ],
                "pv-hotspot" => vec![
                    e(
                        "infrared",
                        reading("cell_c"),
                        limit(catalog, id, "cell_c"),
                        "°C",
                    ),
                    e(
                        "process",
                        reading("mismatch_pct"),
                        limit(catalog, id, "mismatch_pct"),
                        "%",
                    ),
                ],
                "inverter-fault" => vec![
                    e(
                        "infrared",
                        reading("temperature_c"),
                        limit(catalog, id, "temperature_c"),
                        "°C",
                    ),
                    e(
                        "process",
                        reading("loss_pct"),
                        limit(catalog, id, "loss_pct"),
                        "%",
                    ),
                ],
                "export-cable-hot" => vec![
                    e(
                        "infrared",
                        cable_temperature,
                        limit(catalog, id, "temperature_c"),
                        "°C",
                    ),
                    e(
                        "process",
                        cable_loss_pct,
                        limit(catalog, id, "loss_pct"),
                        "%",
                    ),
                ],
                "xfmr-overheat" => vec![
                    e("process", oil, limit(catalog, id, "top_oil_c"), "°C"),
                    e(
                        "infrared",
                        oil + 8.0,
                        limit(catalog, id, "top_oil_c") + 8.0,
                        "°C",
                    ),
                    e("dga", h2, limit(catalog, id, "h2_ppm"), "μL/L"),
                ],
                _ => unreachable!("validated catalog rule"),
            };
            let votes = evidence.iter().filter(|e| e["exceeded"] == true).count();
            detections.push(json!({"device":id,"fault":fault_id,"votes":votes,"active":votes>=2,"evidence":evidence}));
        }
    }
    let alarm_devices: Vec<_> = detections
        .iter()
        .filter(|d| d["active"] == true)
        .map(|d| d["device"].clone())
        .collect();
    json!({"timestamp_ms":(t*1000.0) as u64,"sequence":t as u64,"scene":scene,"scenario":scenario,"source":"synthetic","model":"renewable-reduced-v1",
        "devices":devices,"summary":{"power_mw":gross,"export_mw":export,"capacity_mw":r("capacity_mw"),"load_pct":gross/r("capacity_mw")*100.0,"wind_ms":wind,"irradiance_wm2":irradiance,"condition_c":max_temperature,"bearing_vibration_mm_s":max_vibration,"oil_c":oil,"line_current_a":current,"frequency_hz":50.0,"running_units":running,"unit_count":generators.len()},
        "energy":{"input_mw":input,"gross_mw":gross,"conversion_loss_mw":input-gross,"auxiliary_mw":auxiliary,"collection_loss_mw":collection_loss,"transformer_loss_mw":transformer_loss,"cable_loss_mw":cable_loss,"export_mw":export,"generator_kv":r("collection_kv"),"grid_kv":r("grid_kv"),"power_factor":0.98},
        "detections":detections,"alarm_devices":alarm_devices,
        "modalities":{"process":"synthetic","infrared":"synthetic","vibration":if solar {"not_connected"} else {"synthetic"},"acoustic":if solar {"not_connected"} else {"synthetic"},"dga":"synthetic","partial_discharge":"not_connected","visible":"not_connected","gas":"not_connected"}
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn catalogs() -> Value {
        serde_json::from_str(include_str!("../../data/renewables.json")).unwrap()
    }
    #[test]
    fn curve_respects_cut_in_rated_and_storm_cut_out() {
        assert_eq!(wind_fraction(2.0, 3.0, 12.0, 25.0), 0.0);
        assert_eq!(wind_fraction(12.0, 3.0, 12.0, 25.0), 1.0);
        assert_eq!(wind_fraction(26.0, 3.0, 12.0, 25.0), 0.0);
    }
    #[test]
    fn every_scene_closes_balance_and_unit_sum_for_every_scenario() {
        for scene in ["onshore", "offshore", "solar"] {
            let catalogs = catalogs();
            let catalog = &catalogs[scene];
            for option in catalog["scenarios"].as_array().unwrap() {
                let scenario = option["id"].as_str().unwrap();
                for t in [0.0, 1000.0, 100000.0] {
                    let s = snapshot(catalog, scenario, t);
                    let e = &s["energy"];
                    let sum: f64 = [
                        "export_mw",
                        "auxiliary_mw",
                        "collection_loss_mw",
                        "transformer_loss_mw",
                        "cable_loss_mw",
                        "conversion_loss_mw",
                    ]
                    .iter()
                    .map(|k| e[k].as_f64().unwrap())
                    .sum();
                    assert!(
                        (sum - e["input_mw"].as_f64().unwrap()).abs() < 1e-8,
                        "{scene}/{scenario}"
                    );
                    let unit_sum: f64 = catalog["devices"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|d| d["stage"] == "generation")
                        .map(|d| {
                            s["devices"][d["id"].as_str().unwrap()]["active_power_mw"]
                                .as_f64()
                                .unwrap()
                        })
                        .sum();
                    assert!((unit_sum - e["gross_mw"].as_f64().unwrap()).abs() < 1e-8);
                    let alarms = s["detections"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|d| d["active"] == true)
                        .collect::<Vec<_>>();
                    let is_fault = !matches!(scenario, "normal" | "high-wind" | "cloud-front");
                    assert_eq!(
                        alarms.len(),
                        usize::from(is_fault),
                        "{scene}/{scenario}/{t}"
                    );
                    if is_fault {
                        assert_eq!(alarms[0]["fault"], scenario);
                    }
                    let current = s["summary"]["line_current_a"].as_f64().unwrap();
                    assert!(
                        (current * 3.0_f64.sqrt() * 220.0 * 0.98 / 1000.0
                            - e["export_mw"].as_f64().unwrap())
                        .abs()
                            < 1e-8
                    );
                    if scenario == "high-wind" {
                        assert_eq!(s["summary"]["running_units"], 0);
                        assert_eq!(e["gross_mw"], 0.0);
                    }
                }
            }
        }
    }
    #[test]
    fn clouds_lower_output_without_a_false_fault() {
        let c = catalogs();
        let normal = snapshot(&c["solar"], "normal", 1000.0);
        let cloudy = snapshot(&c["solar"], "cloud-front", 1000.0);
        assert!(
            cloudy["summary"]["power_mw"].as_f64().unwrap()
                < normal["summary"]["power_mw"].as_f64().unwrap() * 0.3
        );
        assert!(cloudy["alarm_devices"].as_array().unwrap().is_empty());
    }

    #[test]
    fn transformer_fault_remains_detectable_through_low_resource_periods() {
        let c = catalogs();
        for scene in ["onshore", "offshore", "solar"] {
            for step in 0..400 {
                let s = snapshot(&c[scene], "xfmr-overheat", f64::from(step) * 10.0);
                assert_eq!(
                    s["alarm_devices"],
                    json!(["main-transformer"]),
                    "{scene}/{step}"
                );
            }
        }
    }
}
