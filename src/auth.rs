use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{
        HeaderMap,
        header::{AUTHORIZATION, COOKIE},
    },
    middleware::Next,
    response::Response,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::SessionRow,
    storage::now_ts,
};

pub const SESSION_COOKIE_NAME: &str = "nas_session";

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub id: String,
    pub expires_at: i64,
}

#[derive(Clone, Default)]
pub struct LoginRateLimiter {
    attempts: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
}

impl LoginRateLimiter {
    pub fn check_and_record(&self, key: &str) -> bool {
        let mut attempts = self.attempts.lock().expect("rate limiter lock poisoned");
        let now = Instant::now();
        let window = Duration::from_secs(60);
        let entries = attempts.entry(key.to_string()).or_default();

        while entries
            .front()
            .is_some_and(|instant| now.duration_since(*instant) > window)
        {
            entries.pop_front();
        }

        if entries.len() >= 3 {
            return false;
        }

        entries.push_back(now);
        true
    }
}

pub fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn session_cookie(token: &str, max_age_seconds: i64, secure: bool) -> String {
    let secure_attr = if secure { "; Secure" } else { "" };
    format!(
        "{SESSION_COOKIE_NAME}={token}; Path=/api; Max-Age={}; HttpOnly; SameSite=Strict{secure_attr}",
        max_age_seconds.max(0)
    )
}

pub fn expired_session_cookie(secure: bool) -> String {
    let secure_attr = if secure { "; Secure" } else { "" };
    format!("{SESSION_COOKIE_NAME}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict{secure_attr}")
}

pub fn password_matches(expected: &str, received: &str) -> bool {
    let expected = expected.as_bytes();
    let received = received.as_bytes();
    let max_len = expected.len().max(received.len());
    let mut diff = expected.len() ^ received.len();

    for index in 0..max_len {
        let left = *expected.get(index).unwrap_or(&0);
        let right = *received.get(index).unwrap_or(&0);
        diff |= usize::from(left ^ right);
    }

    diff == 0
}

pub fn client_rate_key(
    headers: &HeaderMap,
    ConnectInfo(addr): &ConnectInfo<SocketAddr>,
    trust_proxy_headers: bool,
) -> String {
    if trust_proxy_headers {
        if let Some(value) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return value.to_string();
        }
    }

    addr.ip().to_string()
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> AppResult<Response> {
    let token = request_token(&request).ok_or(AppError::Unauthorized)?;
    let token_hash = hash_token(token);
    let now = now_ts();

    let session = sqlx::query_as::<_, SessionRow>(
        r#"
        SELECT id, expires_at
        FROM sessions
        WHERE token_hash = ?1 AND expires_at > ?2
        "#,
    )
    .bind(token_hash)
    .bind(now)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    sqlx::query("UPDATE sessions SET last_used_at = ?1 WHERE id = ?2")
        .bind(now)
        .bind(&session.id)
        .execute(&state.db)
        .await?;

    request.extensions_mut().insert(AuthenticatedSession {
        id: session.id,
        expires_at: session.expires_at,
    });

    Ok(next.run(request).await)
}

fn request_token(request: &Request) -> Option<&str> {
    bearer_token(request.headers()).or_else(|| cookie_token(request.headers()))
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    value.strip_prefix("Bearer ")
}

fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(COOKIE)?.to_str().ok()?;
    value.split(';').find_map(|pair| {
        let (key, value) = pair.trim().split_once('=')?;
        (key == SESSION_COOKIE_NAME && !value.is_empty()).then_some(value)
    })
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, str::FromStr};

    use axum::http::HeaderValue;

    use super::*;

    #[test]
    fn password_check_matches_values() {
        assert!(password_matches("correct horse", "correct horse"));
        assert!(!password_matches("correct horse", "wrong"));
    }

    #[test]
    fn rate_limiter_allows_only_three_attempts_per_minute() {
        let limiter = LoginRateLimiter::default();
        assert!(limiter.check_and_record("127.0.0.1"));
        assert!(limiter.check_and_record("127.0.0.1"));
        assert!(limiter.check_and_record("127.0.0.1"));
        assert!(!limiter.check_and_record("127.0.0.1"));
        assert!(limiter.check_and_record("127.0.0.2"));
    }

    #[test]
    fn client_key_uses_forwarded_for_when_enabled() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.4, 10.0.0.1"),
        );
        let connect = ConnectInfo(SocketAddr::from_str("127.0.0.1:3000").unwrap());
        assert_eq!(client_rate_key(&headers, &connect, true), "203.0.113.4");
        assert_eq!(client_rate_key(&headers, &connect, false), "127.0.0.1");
    }

    #[test]
    fn reads_session_token_from_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_static("theme=dark; nas_session=abc-123; other=value"),
        );
        assert_eq!(cookie_token(&headers), Some("abc-123"));
    }

    #[test]
    fn builds_http_only_session_cookie() {
        let cookie = session_cookie("abc-123", 3600, true);
        assert!(cookie.contains("nas_session=abc-123"));
        assert!(cookie.contains("Max-Age=3600"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));
        assert!(cookie.contains("Secure"));
    }

    #[test]
    fn clears_session_cookie() {
        assert_eq!(
            expired_session_cookie(false),
            "nas_session=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict"
        );
    }
}
