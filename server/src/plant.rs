use std::collections::HashSet;

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Catalog {
    stages: Vec<Id>,
    modalities: Vec<Id>,
    devices: Vec<Device>,
    flows: Vec<Flow>,
}

#[derive(Deserialize)]
struct Id {
    id: String,
}

#[derive(Deserialize)]
struct Device {
    id: String,
    stage: String,
    position: [f64; 3],
    size: [f64; 3],
    failure_modes: Vec<FailureMode>,
}

#[derive(Deserialize)]
struct FailureMode {
    id: String,
    modalities: Vec<String>,
}

#[derive(Deserialize)]
struct Flow {
    from: String,
    to: String,
}

/// Parses the plant catalog and rejects dangling references so the 3D scene,
/// inspection routes and anomaly rules can trust every id they look up.
pub fn load(raw: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(raw).context("plant catalog is not valid JSON")?;
    let catalog: Catalog =
        serde_json::from_value(value.clone()).context("plant catalog shape is invalid")?;

    let stages: HashSet<&str> = catalog.stages.iter().map(|s| s.id.as_str()).collect();
    let modalities: HashSet<&str> = catalog.modalities.iter().map(|m| m.id.as_str()).collect();
    let mut devices = HashSet::new();
    let mut failure_modes = HashSet::new();

    for d in &catalog.devices {
        if !devices.insert(d.id.as_str()) {
            bail!("duplicate device id `{}`", d.id);
        }
        if !stages.contains(d.stage.as_str()) {
            bail!("device `{}` has unknown stage `{}`", d.id, d.stage);
        }
        if d.size.iter().any(|v| *v <= 0.0) || d.position.iter().any(|v| !v.is_finite()) {
            bail!("device `{}` has invalid position or size", d.id);
        }
        for f in &d.failure_modes {
            if !failure_modes.insert(f.id.as_str()) {
                bail!("duplicate failure mode id `{}`", f.id);
            }
            if let Some(m) = f
                .modalities
                .iter()
                .find(|m| !modalities.contains(m.as_str()))
            {
                bail!("failure mode `{}` has unknown modality `{m}`", f.id);
            }
        }
    }
    for f in &catalog.flows {
        for end in [&f.from, &f.to] {
            if !devices.contains(end.as_str()) {
                bail!(
                    "flow {} -> {} references unknown device `{end}`",
                    f.from,
                    f.to
                );
            }
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CATALOG: &str = include_str!("../../data/plant.json");

    #[test]
    fn shipped_catalog_is_consistent() {
        let v = load(CATALOG).unwrap();
        assert!(v["devices"].as_array().unwrap().len() >= 20);
    }

    #[test]
    fn rejects_dangling_flow() {
        let mut v: Value = serde_json::from_str(CATALOG).unwrap();
        v["flows"][0]["to"] = "nowhere".into();
        let err = load(&v.to_string()).unwrap_err().to_string();
        assert!(err.contains("unknown device `nowhere`"), "{err}");
    }

    #[test]
    fn rejects_unknown_modality() {
        let mut v: Value = serde_json::from_str(CATALOG).unwrap();
        v["devices"][0]["failure_modes"][0]["modalities"][0] = "smell".into();
        let err = load(&v.to_string()).unwrap_err().to_string();
        assert!(err.contains("unknown modality `smell`"), "{err}");
    }
}
