use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result, ensure};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone)]
pub struct Catalogs(Arc<HashMap<String, Value>>);

impl Catalogs {
    pub fn load(thermal: &str, renewables: &str) -> Result<Self> {
        let mut catalogs = HashMap::from([("thermal".into(), crate::plant::load(thermal)?)]);
        let renewable: HashMap<String, Value> =
            serde_json::from_str(renewables).context("renewable catalogs")?;
        for id in ["onshore", "offshore", "solar", "csp"] {
            let value = renewable
                .get(id)
                .with_context(|| format!("missing scene {id}"))?;
            let catalog = crate::plant::load(&value.to_string())?;
            ensure!(catalog["id"] == id, "scene identity mismatch {id}");
            let rated = &catalog["plant"]["rated"];
            for key in [
                "capacity_mw",
                "unit_count",
                "unit_mw",
                "grid_kv",
                "collection_kv",
            ] {
                ensure!(
                    rated[key].as_f64().is_some_and(|v| v > 0.0),
                    "invalid {id} rated {key}"
                );
            }
            let generators: Vec<_> = catalog["devices"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|d| d["stage"] == "generation")
                .collect();
            ensure!(
                Some(generators.len() as u64) == rated["unit_count"].as_u64(),
                "unit count mismatch {id}"
            );
            ensure!(
                (rated["capacity_mw"].as_f64().unwrap()
                    - rated["unit_mw"].as_f64().unwrap() * generators.len() as f64)
                    .abs()
                    < 1e-8,
                "capacity mismatch {id}"
            );
            if id == "csp" {
                for key in [
                    "heliostat_count",
                    "mirror_area_m2",
                    "storage_capacity_mwhth",
                    "salt_cp_kj_kg_k",
                    "dni_peak_wm2",
                ] {
                    ensure!(
                        rated[key].as_f64().is_some_and(|v| v > 0.0),
                        "invalid CSP parameter {key}"
                    );
                }
                for key in [
                    "optical_efficiency",
                    "receiver_efficiency",
                    "cycle_efficiency",
                ] {
                    ensure!(
                        rated[key].as_f64().is_some_and(|v| v > 0.0 && v <= 1.0),
                        "invalid CSP efficiency {key}"
                    );
                }
                ensure!(
                    rated["hot_salt_c"]
                        .as_f64()
                        .zip(rated["cold_salt_c"].as_f64())
                        .is_some_and(|(hot, cold)| hot > cold && cold > 0.0),
                    "invalid salt temperatures"
                );
                ensure!(
                    rated["storage_loss_per_hour"]
                        .as_f64()
                        .is_some_and(|v| (0.0..1.0).contains(&v)),
                    "invalid storage loss"
                );
                ensure!(
                    rated["ambient_c"].as_f64().is_some(),
                    "missing ambient temperature"
                );
                catalogs.insert(id.into(), catalog);
                continue;
            }
            for key in [
                "ambient_c",
                "cut_in_ms",
                "rated_wind_ms",
                "cut_out_ms",
                "dc_ac_ratio",
                "inverter_efficiency",
                "pv_temp_coefficient",
            ] {
                ensure!(
                    rated[key].as_f64().is_some(),
                    "missing model parameter {id}/{key}"
                );
            }
            let r = |key: &str| rated[key].as_f64().unwrap();
            ensure!(
                r("cut_in_ms") > 0.0
                    && r("cut_in_ms") < r("rated_wind_ms")
                    && r("rated_wind_ms") < r("cut_out_ms"),
                "invalid wind breakpoints {id}"
            );
            ensure!(
                r("inverter_efficiency") > 0.0
                    && r("inverter_efficiency") <= 1.0
                    && r("dc_ac_ratio") > 0.0
                    && r("pv_temp_coefficient") < 0.0,
                "invalid PV coefficients {id}"
            );
            catalogs.insert(id.into(), catalog);
        }
        Ok(Self(Arc::new(catalogs)))
    }
    pub fn select(&self, scene: &str) -> Option<&Value> {
        self.0.get(scene)
    }
}

#[derive(Default, Deserialize)]
pub struct SceneQuery {
    pub scene: Option<String>,
}

pub async fn get(
    State(catalogs): State<Catalogs>,
    Query(query): Query<SceneQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    catalogs
        .select(query.scene.as_deref().unwrap_or("thermal"))
        .cloned()
        .map(Json)
        .ok_or((
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"unknown scene"})),
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_csp_storage_parameters() {
        for (key, value) in [
            ("storage_capacity_mwhth", json!(0)),
            ("cycle_efficiency", json!(1.5)),
            ("cold_salt_c", json!(600)),
            ("storage_loss_per_hour", json!(-0.1)),
            ("salt_cp_kj_kg_k", Value::Null),
        ] {
            let mut catalogs: Value =
                serde_json::from_str(include_str!("../../data/renewables.json")).unwrap();
            catalogs["csp"]["plant"]["rated"][key] = value;
            assert!(
                Catalogs::load(include_str!("../../data/plant.json"), &catalogs.to_string())
                    .is_err(),
                "{key}"
            );
        }
    }
}
