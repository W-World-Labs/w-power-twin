//! Educational reduced process model, not an IAPWS cycle solver or plant feed.
//! One operating state drives electrical balance, equipment and modality features.
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCENARIOS: [&str; 6] = [
    "normal",
    "xfmr-overheat",
    "fwp-bearing-wear",
    "tube-leak",
    "gis-pd",
    "rotor-rub",
];

#[derive(Default, Deserialize)]
pub struct Options {
    scenario: Option<String>,
    scene: Option<String>,
}

pub async fn get(
    State(catalogs): State<crate::catalogs::Catalogs>,
    Query(options): Query<Options>,
) -> Result<impl axum::response::IntoResponse, (StatusCode, Json<Value>)> {
    let scenario = options.scenario.as_deref().unwrap_or("normal");
    let scene = options.scene.as_deref().unwrap_or("thermal");
    let catalog = catalogs.select(scene).ok_or((
        StatusCode::BAD_REQUEST,
        Json(json!({"error":"unknown scene"})),
    ))?;
    let valid = if scene == "thermal" {
        SCENARIOS.contains(&scenario)
    } else {
        catalog["scenarios"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["id"] == scenario)
    };
    if !valid {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "unknown demo scenario"})),
        ));
    }
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    Ok((
        [("cache-control", "no-store")],
        Json(if scene == "thermal" {
            snapshot(catalog, scenario, t)
        } else if scene == "csp" {
            crate::csp::snapshot(catalog, scenario, t)
        } else {
            crate::renewable::snapshot(catalog, scenario, t)
        }),
    ))
}

pub(crate) fn nominal(catalog: &Value, device: &str, key: &str) -> f64 {
    catalog["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == device)
        .unwrap()["params"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["key"] == key)
        .unwrap()["nominal"]
        .as_f64()
        .unwrap()
}

pub(crate) fn limit(catalog: &Value, device: &str, key: &str) -> f64 {
    catalog["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == device)
        .unwrap()["params"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["key"] == key)
        .unwrap()["alarm_high"]
        .as_f64()
        .unwrap()
}

pub fn snapshot(catalog: &Value, scenario: &str, t: f64) -> Value {
    let load = 0.90 + 0.025 * (t / 17.0).sin();
    let severity = 0.94 + 0.06 * (t / 25.0).sin();
    let fault = |id| if scenario == id { severity } else { 0.0 };
    let leak = fault("tube-leak");
    let wear = fault("fwp-bearing-wear");
    let heat = fault("xfmr-overheat");
    let pd = fault("gis-pd");
    let rub = fault("rotor-rub");
    let rated = &catalog["plant"]["rated"];
    let base_power = nominal(catalog, "generator", "active_power_mw") * load;
    let power = base_power * (1.0 - 0.08 * leak - 0.025 * wear - 0.04 * rub);
    let thermal = base_power / (rated["gross_efficiency_pct"].as_f64().unwrap() / 100.0);
    let boiler_loss = thermal * 0.08;
    let shaft = power / 0.985;
    let rejected = thermal - boiler_loss - shaft;
    let auxiliary = power * 0.055;
    let transformer_loss = (power - auxiliary) * (0.006 + 0.004 * heat);
    let export = power - auxiliary - transformer_loss;
    let grid_kv = rated["grid_kv"].as_f64().unwrap();
    let current = export * 1000.0 / (3.0_f64.sqrt() * grid_kv * 0.96);
    let oil = 25.0
        + (nominal(catalog, "main-transformer", "top_oil_c") - 25.0) * load * load
        + 40.0 * heat;
    let h2 = nominal(catalog, "main-transformer", "h2_ppm") + 180.0 * heat;
    let pump_vibration = nominal(catalog, "feedwater-pump", "vibration_mm_s") + 6.0 * wear;
    let pump_temperature = 25.0 + 35.0 * load + 35.0 * wear;
    let shaft_vibration = nominal(catalog, "hp-turbine", "shaft_vibration_um") + 140.0 * rub;
    let steam_pressure =
        nominal(catalog, "boiler", "main_steam_mpa") * (0.98 + 0.02 * load) - 0.8 * leak;
    let steam_temperature = nominal(catalog, "boiler", "main_steam_c") - 7.0 * leak;
    let discharge = nominal(catalog, "switchyard", "pd_dbm") + 40.0 * pd;
    let mut devices = serde_json::Map::new();
    for d in catalog["devices"].as_array().unwrap() {
        let mut values = serde_json::Map::new();
        for p in d["params"].as_array().unwrap() {
            values.insert(p["key"].as_str().unwrap().into(), p["nominal"].clone());
        }
        devices.insert(d["id"].as_str().unwrap().into(), Value::Object(values));
    }
    let updates = [
        ("generator", "active_power_mw", power),
        ("generator", "stator_temp_c", 25.0 + 50.0 * load * load),
        ("main-transformer", "top_oil_c", oil),
        ("main-transformer", "h2_ppm", h2),
        ("main-transformer", "load_mva", (power - auxiliary) / 0.96),
        ("feedwater-pump", "vibration_mm_s", pump_vibration),
        ("feedwater-pump", "bearing_temp_c", pump_temperature),
        ("hp-turbine", "shaft_vibration_um", shaft_vibration),
        ("hp-turbine", "inlet_mpa", steam_pressure),
        ("boiler", "main_steam_mpa", steam_pressure),
        ("boiler", "main_steam_c", steam_temperature),
        ("ip-turbine", "inlet_c", steam_temperature),
        ("switchyard", "pd_dbm", discharge),
        ("transmission-line", "line_current_a", current),
    ];
    for (device, key, value) in updates {
        devices.get_mut(device).unwrap()[key] = json!(value);
    }

    let evidence = |modality: &str, value: f64, threshold: f64, unit: &str| {
        json!({
            "modality": modality, "value": value, "threshold": threshold, "unit": unit, "exceeded": value > threshold,
        })
    };
    // Added acoustic/IR/flow thresholds are illustrative demo rules, not safety limits.
    // Process, vibration, DGA and PD limits derive from the equipment catalog.
    let rules = [
        (
            "main-transformer",
            "xfmr-overheat",
            vec![
                evidence(
                    "process",
                    oil,
                    limit(catalog, "main-transformer", "top_oil_c"),
                    "°C",
                ),
                evidence(
                    "infrared",
                    oil + 8.0 + 15.0 * heat,
                    limit(catalog, "main-transformer", "top_oil_c") + 8.0,
                    "°C",
                ),
                evidence(
                    "dga",
                    h2,
                    limit(catalog, "main-transformer", "h2_ppm"),
                    "μL/L",
                ),
            ],
        ),
        (
            "feedwater-pump",
            "fwp-bearing-wear",
            vec![
                evidence(
                    "vibration",
                    pump_vibration,
                    limit(catalog, "feedwater-pump", "vibration_mm_s"),
                    "mm/s",
                ),
                evidence("acoustic", 42.0 + 20.0 * wear, 55.0, "dB (demo)"),
                evidence(
                    "infrared",
                    pump_temperature + 5.0,
                    limit(catalog, "feedwater-pump", "bearing_temp_c") + 5.0,
                    "°C",
                ),
            ],
        ),
        (
            "boiler",
            "tube-leak",
            vec![
                evidence("process", 8.0 * leak, 3.0, "% Δflow"),
                evidence("acoustic", 44.0 + 35.0 * leak, 65.0, "dB (demo)"),
            ],
        ),
        (
            "switchyard",
            "gis-pd",
            vec![
                evidence(
                    "partial_discharge",
                    discharge,
                    limit(catalog, "switchyard", "pd_dbm"),
                    "dBm",
                ),
                evidence("acoustic", 38.0 + 24.0 * pd, 55.0, "dB (demo)"),
            ],
        ),
        (
            "hp-turbine",
            "rotor-rub",
            vec![
                evidence(
                    "vibration",
                    shaft_vibration,
                    limit(catalog, "hp-turbine", "shaft_vibration_um"),
                    "μm",
                ),
                evidence("acoustic", 42.0 + 22.0 * rub, 55.0, "dB (demo)"),
            ],
        ),
    ];
    let detections: Vec<Value> = rules.into_iter().map(|(device, id, evidence)| {
        let votes = evidence.iter().filter(|e| e["exceeded"] == true).count();
        json!({"device": device, "fault": id, "votes": votes, "active": votes >= 2, "evidence": evidence})
    }).collect();
    let alarm_devices: Vec<&str> = detections
        .iter()
        .filter(|r| r["active"] == true)
        .map(|r| r["device"].as_str().unwrap())
        .collect();
    json!({
        "timestamp_ms": (t * 1000.0) as u64, "sequence": t as u64, "scenario": scenario,
        "scene": "thermal", "source": "synthetic", "model": "reduced-process-v1", "devices": devices,
        "summary": {"load_pct": power / 660.0 * 100.0, "power_mw": power, "export_mw": export,
            "rpm": rated["speed_rpm"], "frequency_hz": rated["frequency_hz"],
            "steam_mpa": steam_pressure, "steam_c": steam_temperature,
            "shaft_vibration_um": shaft_vibration, "oil_c": oil, "line_current_a": current,
            "steam_flow_kg_s": power / 1.15, "feedwater_flow_kg_s": power / 1.15 / (1.0 - 0.08 * leak)},
        "energy": {"thermal_mw": thermal, "boiler_loss_mw": boiler_loss, "shaft_mw": shaft,
            "generator_loss_mw": shaft - power, "rejected_mw": rejected, "gross_mw": power,
            "auxiliary_mw": auxiliary, "transformer_loss_mw": transformer_loss, "export_mw": export,
            "generator_kv": rated["generator_kv"], "grid_kv": grid_kv, "power_factor": 0.96},
        "detections": detections, "alarm_devices": alarm_devices,
        "modalities": {"process": "synthetic", "infrared": "synthetic", "vibration": "synthetic",
            "acoustic": "synthetic", "dga": "synthetic", "partial_discharge": "synthetic",
            "visible": "not_connected", "gas": "not_connected"},
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn catalog() -> Value {
        serde_json::from_str(include_str!("../../data/plant.json")).unwrap()
    }
    #[test]
    fn energy_balance_closes_for_every_scenario() {
        for scenario in SCENARIOS {
            let s = snapshot(&catalog(), scenario, 1000.0);
            let e = &s["energy"];
            let sum: f64 = [
                "export_mw",
                "auxiliary_mw",
                "transformer_loss_mw",
                "generator_loss_mw",
                "rejected_mw",
                "boiler_loss_mw",
            ]
            .iter()
            .map(|k| e[k].as_f64().unwrap())
            .sum();
            assert!((sum - e["thermal_mw"].as_f64().unwrap()).abs() < 1e-8);
            assert!(e["export_mw"].as_f64().unwrap() > 0.0);
        }
    }
    #[test]
    fn faults_require_agreeing_modalities_and_normal_has_no_alarm() {
        for scenario in SCENARIOS {
            let s = snapshot(&catalog(), scenario, 1000.0);
            let active: Vec<_> = s["detections"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["active"] == true)
                .collect();
            assert_eq!(
                active.len(),
                usize::from(scenario != "normal"),
                "{scenario}"
            );
            if let Some(rule) = active.first() {
                assert_eq!(rule["fault"], scenario);
                assert!(rule["votes"].as_u64().unwrap() >= 2);
            }
        }
    }
    #[test]
    fn electrical_current_matches_export_and_heat_matches_dga() {
        let s = snapshot(&catalog(), "xfmr-overheat", 1000.0);
        let e = &s["energy"];
        let current = s["devices"]["transmission-line"]["line_current_a"]
            .as_f64()
            .unwrap();
        assert!(
            (current * 3.0_f64.sqrt() * 500.0 * 0.96 / 1000.0 - e["export_mw"].as_f64().unwrap())
                .abs()
                < 1e-8
        );
        assert!(
            s["devices"]["main-transformer"]["top_oil_c"]
                .as_f64()
                .unwrap()
                > 85.0
        );
        assert!(s["devices"]["main-transformer"]["h2_ppm"].as_f64().unwrap() > 150.0);
        assert_eq!(s["modalities"]["visible"], "not_connected");
    }
}
