mod auth;
mod config;
mod db;
mod error;
mod models;
mod routes;
mod storage;

use std::net::SocketAddr;

use anyhow::Context;
use axum::Router;
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{auth::LoginRateLimiter, config::Config, db::init_db, routes::build_router};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: sqlx::SqlitePool,
    pub login_limiter: LoginRateLimiter,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nas=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    storage::ensure_data_dirs(&config).await?;
    let db = init_db(&config.database_url()).await?;

    let state = AppState {
        config: config.clone(),
        db,
        login_limiter: LoginRateLimiter::default(),
    };

    let app: Router = build_router(state).layer(TraceLayer::new_for_http());
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.bind))?;

    tracing::info!("listening on http://{}", config.bind);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
