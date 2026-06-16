use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::{Context, bail};

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub files_dir: PathBuf,
    pub preview_dir: PathBuf,
    pub tmp_dir: PathBuf,
    pub trash_dir: PathBuf,
    pub login_password: String,
    pub session_ttl_seconds: i64,
    pub public_base_url: Option<String>,
    pub trust_proxy_headers: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind = env::var("NAS_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_string())
            .parse::<SocketAddr>()
            .context("NAS_BIND must be a valid socket address")?;

        let data_dir = PathBuf::from(env::var("NAS_DATA_DIR").unwrap_or_else(|_| "data".into()));
        let files_dir = env::var("NAS_FILES_DIR")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| data_dir.join("files"));
        let login_password = env::var("NAS_LOGIN_PASSWORD")
            .context("NAS_LOGIN_PASSWORD is required to start the server")?;

        if login_password.len() < 8 {
            bail!("NAS_LOGIN_PASSWORD must contain at least 8 characters");
        }

        let ttl_hours = env::var("NAS_SESSION_TTL_HOURS")
            .ok()
            .map(|value| value.parse::<i64>())
            .transpose()
            .context("NAS_SESSION_TTL_HOURS must be an integer")?
            .unwrap_or(12);

        let public_base_url = env::var("NAS_PUBLIC_BASE_URL")
            .ok()
            .map(|value| value.trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty());

        let trust_proxy_headers = env::var("NAS_TRUST_PROXY_HEADERS")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);

        Ok(Self {
            bind,
            files_dir,
            preview_dir: data_dir.join("preview"),
            tmp_dir: data_dir.join("tmp"),
            trash_dir: data_dir.join("trash"),
            data_dir,
            login_password,
            session_ttl_seconds: ttl_hours * 60 * 60,
            public_base_url,
            trust_proxy_headers,
        })
    }

    pub fn database_url(&self) -> String {
        format!("sqlite://{}", self.data_dir.join("nas.sqlite").display())
    }
}
