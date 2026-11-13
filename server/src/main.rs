mod catalogs;
mod csp;
mod plant;
mod radar;
mod renewable;
mod telemetry;

use std::{net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result, ensure};
use axum::{Json, Router, routing::get};
use catalogs::Catalogs;
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};

fn project_path(env: &str, default: &str) -> PathBuf {
    std::env::var_os(env).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(default)
    })
}

fn app(catalog: Catalogs, assets: PathBuf, dist: PathBuf) -> Router {
    let spa = ServeDir::new(&dist).fallback(ServeFile::new(dist.join("index.html")));
    Router::new()
        .route("/health", get(|| async { Json(json!({ "ok": true })) }))
        .route("/api/telemetry", get(telemetry::get))
        .route("/api/plant", get(catalogs::get))
        .nest_service("/assets", ServeDir::new(assets))
        .fallback_service(spa)
        .layer(axum::middleware::from_fn_with_state(
            radar::capture_config(),
            radar::capture_http,
        ))
        .with_state(catalog)
}

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::var("W_RADAR_CODE").is_ok_and(|value| !value.trim().is_empty()) {
        ensure!(
            std::env::var("W_RADAR_ENDPOINT").is_ok_and(|value| !value.trim().is_empty()),
            "W_RADAR_ENDPOINT is required when W_RADAR_CODE enables backend telemetry"
        );
    }
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let catalog_path = project_path("POWER_TWIN_PLANT_FILE", "data/plant.json");
    let raw = std::fs::read_to_string(&catalog_path)
        .with_context(|| format!("read {}", catalog_path.display()))?;
    let renewable_path = std::env::var_os("POWER_TWIN_RENEWABLES_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| catalog_path.with_file_name("renewables.json"));
    let renewable = std::fs::read_to_string(&renewable_path)
        .with_context(|| format!("read {}", renewable_path.display()))?;
    let catalog = Catalogs::load(&raw, &renewable)?;

    let bind: SocketAddr = std::env::var("POWER_TWIN_BIND")
        .unwrap_or_else(|_| "127.0.0.1:18470".into())
        .parse()
        .context("POWER_TWIN_BIND must be host:port")?;
    let router = app(
        catalog,
        project_path("POWER_TWIN_ASSETS_DIR", "assets"),
        project_path("POWER_TWIN_DIST_DIR", "frontend/dist"),
    );
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "w-power-twin listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use tower::ServiceExt;

    #[tokio::test]
    async fn scenes_and_faults_are_isolated_and_invalid_queries_are_rejected() {
        let catalogs = Catalogs::load(
            include_str!("../../data/plant.json"),
            include_str!("../../data/renewables.json"),
        )
        .unwrap();
        let router = app(catalogs, std::env::temp_dir(), std::env::temp_dir());
        for (path, status) in [
            ("/api/plant?scene=onshore", 200),
            ("/api/plant?scene=offshore", 200),
            ("/api/plant?scene=solar", 200),
            ("/api/plant?scene=csp", 200),
            ("/api/telemetry?scene=csp&scenario=night-discharge", 200),
            ("/api/telemetry?scene=csp&scenario=receiver-hotspot", 200),
            ("/api/telemetry?scene=csp&scenario=pv-hotspot", 400),
            ("/api/telemetry?scene=solar&scenario=night-discharge", 400),
            ("/api/plant?scene=unknown", 400),
            ("/api/telemetry?scene=unknown", 400),
            ("/api/telemetry?scene=solar&scenario=bearing-wear", 400),
            ("/api/telemetry?scene=offshore&scenario=pv-hotspot", 400),
            ("/api/telemetry?scene=onshore&scenario=bearing-wear", 200),
            ("/api/telemetry?scene=solar&scenario=normal", 200),
            ("/api/telemetry", 200),
        ] {
            let res = router
                .clone()
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(res.status(), status, "{path}");
            if status == 200 && path.contains("telemetry") {
                assert_eq!(res.headers()["cache-control"], "no-store");
                let body = axum::body::to_bytes(res.into_body(), usize::MAX)
                    .await
                    .unwrap();
                let data: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(
                    data["alarm_devices"].as_array().unwrap().len(),
                    usize::from(path.contains("bearing-wear") || path.contains("receiver-hotspot"))
                );
            }
        }
    }

    #[tokio::test]
    async fn serves_plant_catalog() {
        let catalog = Catalogs::load(
            include_str!("../../data/plant.json"),
            include_str!("../../data/renewables.json"),
        )
        .unwrap();
        let tmp = std::env::temp_dir();
        let res = app(catalog, tmp.clone(), tmp)
            .oneshot(Request::get("/api/plant").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["plant"]["rated"]["gross_output_mw"], 660);
    }

    #[tokio::test]
    async fn telemetry_is_uncached_and_scenarios_are_request_scoped() {
        let catalog = Catalogs::load(
            include_str!("../../data/plant.json"),
            include_str!("../../data/renewables.json"),
        )
        .unwrap();
        let router = app(catalog, std::env::temp_dir(), std::env::temp_dir());
        for scenario in ["xfmr-overheat", "normal"] {
            let response = router
                .clone()
                .oneshot(
                    Request::get(format!("/api/telemetry?scenario={scenario}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["cache-control"], "no-store");
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let value: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["scenario"], scenario);
            assert_eq!(value["source"], "synthetic");
            assert_eq!(
                value["alarm_devices"].as_array().unwrap().len(),
                usize::from(scenario != "normal")
            );
        }
        let response = router
            .oneshot(
                Request::get("/api/telemetry?scenario=unknown")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 400);
    }
}
