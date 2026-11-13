use std::sync::{LazyLock, OnceLock};

use axum::{
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
};
use serde_json::Value;
use tokio::sync::mpsc;
use xradar::{
    HttpCaptureConfig, HttpCaptureCtx, HttpSpanCapture, http_error_payload, http_span_payload,
};

static HTTP_CAPTURE: LazyLock<HttpCaptureConfig> =
    LazyLock::new(|| HttpCaptureConfig::new("w-power-twin", env!("CARGO_PKG_VERSION")));
const TELEMETRY_QUEUE_CAPACITY: usize = 128;
static TELEMETRY_QUEUE: OnceLock<mpsc::Sender<CapturePayloads>> = OnceLock::new();

struct CapturePayloads {
    endpoint: String,
    span: Value,
    error: Option<Value>,
}

pub fn capture_config() -> HttpCaptureConfig {
    HTTP_CAPTURE.clone()
}

fn route_template<B>(request: &axum::http::Request<B>) -> String {
    request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned())
        .unwrap_or_else(|| match request.uri().path() {
            path if path.starts_with("/assets/") => "/assets/*".to_owned(),
            path if path.starts_with("/static/") => "/static/*".to_owned(),
            _ => "/*".to_owned(),
        })
}

/// Record only the method, route template, status, and duration. Query strings,
/// concrete paths, headers, and bodies never enter the capture payload.
pub async fn capture_http(
    State(config): State<HttpCaptureConfig>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().as_str().to_owned();
    let route = route_template(&request);
    let started_at_ms = now_ms();
    let started = std::time::Instant::now();
    let context = HttpCaptureCtx::begin(&config, &method, &route, &route, request.headers());
    let mut response = next.run(request).await;

    if let Some(context) = context {
        if let Ok(value) = axum::http::HeaderValue::from_str(context.traceparent()) {
            response
                .headers_mut()
                .insert(axum::http::HeaderName::from_static("traceparent"), value);
        }
        let Some(code) = config.resolve_code() else {
            return response;
        };
        let capture = HttpSpanCapture {
            code,
            endpoint: config.resolve_endpoint(),
            service_name: config.resolve_service_name(),
            release: Some(config.resolve_release()),
            environment: Some(config.resolve_environment()),
            slow_trace_ms: config.resolve_slow_trace_ms(),
            method,
            route: context.route().to_owned(),
            target: context.route().to_owned(),
            status_code: response.status().as_u16(),
            duration_ms: started.elapsed().as_millis() as u64,
            trace_id: context.trace_id().to_owned(),
            span_id: context.span_id().to_owned(),
            parent_span_id: context.parent_span_id().map(str::to_owned),
            traceparent: context.traceparent().to_owned(),
            started_at_ms,
            finished_at_ms: now_ms(),
            auth_scheme: None,
            auth_key_prefix: None,
        };
        let payloads = CapturePayloads {
            endpoint: capture.endpoint.clone(),
            span: http_span_payload(&capture),
            error: http_error_payload(&capture),
        };
        let _ = telemetry_queue().try_send(payloads);
    }
    response
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn telemetry_queue() -> &'static mpsc::Sender<CapturePayloads> {
    TELEMETRY_QUEUE.get_or_init(|| {
        let (sender, mut receiver) = mpsc::channel::<CapturePayloads>(TELEMETRY_QUEUE_CAPACITY);
        tokio::spawn(async move {
            xradar::install_rustls_ring_provider();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .build()
                .ok();
            while let Some(payloads) = receiver.recv().await {
                let Some(client) = client.as_ref() else {
                    continue;
                };
                let _ = client
                    .post(format!("{}/collect", payloads.endpoint))
                    .json(&payloads.span)
                    .send()
                    .await;
                if let Some(error) = payloads.error {
                    let _ = client
                        .post(format!("{}/errors/capture", payloads.endpoint))
                        .json(&error)
                        .send()
                        .await;
                }
            }
        });
        sender
    })
}

#[cfg(test)]
mod tests {
    use super::route_template;
    use axum::http::Request;

    #[test]
    fn unmatched_routes_and_assets_use_fixed_templates() {
        for (uri, expected) in [
            ("/private-user/token-value?secret=query-value", "/*"),
            ("/assets/private-model.glb?token=query-value", "/assets/*"),
            ("/static/private-chunk.js", "/static/*"),
        ] {
            let request = Request::builder().uri(uri).body(()).unwrap();
            assert_eq!(route_template(&request), expected);
        }
    }
}
