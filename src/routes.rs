use std::{io::SeekFrom, net::SocketAddr, path::PathBuf};

use axum::{
    Json, Router,
    body::Body,
    extract::{
        ConnectInfo, Extension, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{
            ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
            SET_COOKIE,
        },
    },
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
};
use serde::{Deserialize, Serialize};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tokio_util::io::ReaderStream;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

use crate::{
    AppState, auth,
    error::{AppError, AppResult},
    models::{Node, NodeDto, ROOT_ID, ShareDto, ShareLookup, node_to_dto},
    realtime::RealtimeEvent,
    storage,
};

const SHARE_TTL_SECONDS: i64 = 60 * 60;

pub fn build_router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/realtime", get(realtime_ws))
        .route("/folders/{id}", get(get_folder))
        .route("/folders/{parent_id}/folders", post(create_folder))
        .route("/folders/{parent_id}/files", post(upload_file))
        .route("/files", get(list_files))
        .route("/files/{id}", put(replace_file))
        .route("/search", get(search_nodes))
        .route(
            "/files/{id}/preview",
            put(upload_preview).get(download_preview),
        )
        .route("/files/{id}/download", get(download_file))
        .route("/files/{id}/inline", get(inline_file))
        .route("/files/{id}/shares", post(create_share).get(list_shares))
        .route("/nodes/{id}", patch(rename_node).delete(delete_node))
        .route("/shares/{id}", delete(revoke_share))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    let api = Router::new()
        .route("/auth/login", post(login))
        .route("/public/shares/{token}", get(public_share))
        .route("/public/shares/{token}/download", get(public_download))
        .route("/public/shares/{token}/preview", get(public_preview))
        .merge(protected);

    let spa = ServeDir::new("web/dist").not_found_service(ServeFile::new("web/dist/index.html"));

    Router::new()
        .nest("/api", api)
        .route("/", get(spa_index))
        .route("/folder/{*path}", get(spa_index))
        .route("/files", get(spa_index))
        .route("/share/{*path}", get(spa_index))
        .fallback_service(spa)
        .with_state(state)
}

async fn spa_index() -> AppResult<Response> {
    stream_path(
        PathBuf::from("web/dist/index.html"),
        "text/html; charset=utf-8",
        None,
        "inline",
        "index.html",
    )
    .await
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    expires_at: i64,
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> AppResult<Response> {
    let connect_info = ConnectInfo(addr);
    let key = auth::client_rate_key(&headers, &connect_info, state.config.trust_proxy_headers);
    if !state.login_limiter.check_and_record(&key) {
        return Err(AppError::RateLimited);
    }

    if !auth::password_matches(&state.config.login_password, &payload.password) {
        return Err(AppError::Unauthorized);
    }

    let token = auth::generate_token();
    let token_hash = auth::hash_token(&token);
    let session_id = Uuid::new_v4().to_string();
    let now = storage::now_ts();
    let expires_at = now + state.config.session_ttl_seconds;

    sqlx::query(
        r#"
        INSERT INTO sessions (id, token_hash, created_at, expires_at, last_used_at)
        VALUES (?1, ?2, ?3, ?4, ?3)
        "#,
    )
    .bind(session_id)
    .bind(token_hash)
    .bind(now)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    let mut response = Json(LoginResponse { expires_at }).into_response();
    append_set_cookie(
        &mut response,
        auth::session_cookie(
            &token,
            state.config.session_ttl_seconds,
            request_uses_https(&state, &headers),
        ),
    )?;
    Ok(response)
}

async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(session): Extension<auth::AuthenticatedSession>,
) -> AppResult<Response> {
    sqlx::query("DELETE FROM sessions WHERE id = ?1")
        .bind(session.id)
        .execute(&state.db)
        .await?;

    let mut response = StatusCode::NO_CONTENT.into_response();
    append_set_cookie(
        &mut response,
        auth::expired_session_cookie(request_uses_https(&state, &headers)),
    )?;
    Ok(response)
}

#[derive(Serialize)]
struct MeResponse {
    expires_at: i64,
}

async fn me(Extension(session): Extension<auth::AuthenticatedSession>) -> Json<MeResponse> {
    Json(MeResponse {
        expires_at: session.expires_at,
    })
}

fn append_set_cookie(response: &mut Response, cookie: String) -> AppResult<()> {
    let value = HeaderValue::from_str(&cookie)
        .map_err(|error| AppError::Internal(anyhow::anyhow!("invalid session cookie: {error}")))?;
    response.headers_mut().append(SET_COOKIE, value);
    Ok(())
}

fn request_uses_https(state: &AppState, headers: &HeaderMap) -> bool {
    state
        .config
        .public_base_url
        .as_deref()
        .is_some_and(|base_url| base_url.starts_with("https://"))
        || (state.config.trust_proxy_headers
            && headers
                .get("x-forwarded-proto")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(',').next())
                .map(str::trim)
                .is_some_and(|value| value.eq_ignore_ascii_case("https")))
}

#[derive(Deserialize)]
struct RealtimeQuery {
    client_id: Option<String>,
}

async fn realtime_ws(
    State(state): State<AppState>,
    Query(query): Query<RealtimeQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let client_id = query.client_id.unwrap_or_default();
    let receiver = state.realtime_tx.subscribe();
    ws.on_upgrade(move |socket| realtime_socket(socket, receiver, client_id))
}

async fn realtime_socket(
    mut socket: WebSocket,
    mut receiver: tokio::sync::broadcast::Receiver<RealtimeEvent>,
    client_id: String,
) {
    loop {
        let event = match receiver.recv().await {
            Ok(event) => event,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        };

        if event
            .source_client_id()
            .is_some_and(|source_client_id| source_client_id == client_id)
        {
            continue;
        }

        let Ok(payload) = serde_json::to_string(&event) else {
            continue;
        };

        if socket.send(Message::Text(payload.into())).await.is_err() {
            break;
        }
    }
}

fn request_client_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-nas-client-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .map(ToOwned::to_owned)
}

fn broadcast_node_upsert(state: &AppState, headers: &HeaderMap, node: NodeDto) {
    let _ = state.realtime_tx.send(RealtimeEvent::NodeUpsert {
        node,
        source_client_id: request_client_id(headers),
    });
}

fn broadcast_node_deleted(
    state: &AppState,
    headers: &HeaderMap,
    id: String,
    parent_id: Option<String>,
) {
    let _ = state.realtime_tx.send(RealtimeEvent::NodeDeleted {
        id,
        parent_id,
        source_client_id: request_client_id(headers),
    });
}

#[derive(Serialize)]
struct FolderResponse {
    folder: NodeDto,
    breadcrumbs: Vec<NodeDto>,
    children: Vec<NodeDto>,
}

#[derive(Serialize)]
struct FilesResponse {
    files: Vec<NodeDto>,
}

#[derive(Serialize)]
struct SearchResponse {
    nodes: Vec<NodeDto>,
}

/// Clause SQL de filtre par type de media (image/video), appliquee cote serveur.
/// `keep_folders` conserve les dossiers dans la liste (pour la navigation).
fn media_filter_clause(media: Option<&str>, keep_folders: bool) -> AppResult<&'static str> {
    Ok(match media {
        Some("image") => {
            if keep_folders {
                " AND (kind = 'folder' OR mime_type LIKE 'image/%')"
            } else {
                " AND mime_type LIKE 'image/%'"
            }
        }
        Some("video") => {
            if keep_folders {
                " AND (kind = 'folder' OR mime_type LIKE 'video/%')"
            } else {
                " AND mime_type LIKE 'video/%'"
            }
        }
        None | Some("all") | Some("") => "",
        Some(_) => return Err(AppError::BadRequest("unsupported media filter".into())),
    })
}

#[derive(Default, Deserialize)]
struct FolderQuery {
    sort: Option<String>,
    media: Option<String>,
}

async fn get_folder(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<FolderQuery>,
) -> AppResult<Json<FolderResponse>> {
    let folder = fetch_node(&state, &id).await?;
    if !folder.is_folder() {
        return Err(AppError::BadRequest("node is not a folder".into()));
    }

    let order_by = match query.sort.as_deref() {
        Some("date") => {
            r#"
        ORDER BY COALESCE(file_date_at, created_at) DESC, lower(name)
        "#
        }
        Some("name") | None => {
            r#"
        ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END, lower(name)
        "#
        }
        Some(_) => return Err(AppError::BadRequest("unsupported sort mode".into())),
    };

    // Filtre type de media : on garde toujours les dossiers pour pouvoir naviguer.
    let media_clause = media_filter_clause(query.media.as_deref(), true)?;

    let sql = format!(
        r#"
        SELECT *
        FROM nodes
        WHERE parent_id = ?1
        {media_clause}
        {order_by}
        "#
    );

    let children = sqlx::query_as::<_, Node>(&sql)
        .bind(&folder.id)
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(node_to_dto)
        .collect();

    let breadcrumbs = breadcrumbs(&state, &folder).await?;

    Ok(Json(FolderResponse {
        folder: node_to_dto(folder),
        breadcrumbs,
        children,
    }))
}

#[derive(Default, Deserialize)]
struct FilesQuery {
    sort: Option<String>,
    q: Option<String>,
    media: Option<String>,
}

async fn list_files(
    State(state): State<AppState>,
    Query(query): Query<FilesQuery>,
) -> AppResult<Json<FilesResponse>> {
    let order_by = match query.sort.as_deref() {
        Some("date") => {
            r#"
        ORDER BY COALESCE(file_date_at, created_at) DESC, lower(relative_path)
        "#
        }
        Some("name") | None => {
            r#"
        ORDER BY lower(name), lower(relative_path)
        "#
        }
        Some(_) => return Err(AppError::BadRequest("unsupported sort mode".into())),
    };

    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.to_lowercase()));

    let media_clause = media_filter_clause(query.media.as_deref(), false)?;

    let sql = if search.is_some() {
        format!(
            r#"
            SELECT *
            FROM nodes
            WHERE kind = 'file'
              AND (lower(name) LIKE ?1 OR lower(relative_path) LIKE ?1)
            {media_clause}
            {order_by}
            "#
        )
    } else {
        format!(
            r#"
            SELECT *
            FROM nodes
            WHERE kind = 'file'
            {media_clause}
            {order_by}
            "#
        )
    };

    let mut query_builder = sqlx::query_as::<_, Node>(&sql);
    if let Some(search) = search {
        query_builder = query_builder.bind(search);
    }

    let files = query_builder
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(node_to_dto)
        .collect();

    Ok(Json(FilesResponse { files }))
}

#[derive(Default, Deserialize)]
struct SearchQuery {
    sort: Option<String>,
    q: Option<String>,
    scope: Option<String>,
    folder_id: Option<String>,
}

async fn search_nodes(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<SearchResponse>> {
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::BadRequest("search query cannot be empty".into()))?;

    let order_by = match query.sort.as_deref() {
        Some("date") => {
            r#"
        ORDER BY COALESCE(file_date_at, created_at) DESC, lower(relative_path)
        "#
        }
        Some("name") | None => {
            r#"
        ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END, lower(name), lower(relative_path)
        "#
        }
        Some(_) => return Err(AppError::BadRequest("unsupported sort mode".into())),
    };

    let search = format!("%{}%", search.to_lowercase());
    let nodes = match query.scope.as_deref() {
        Some("all") => {
            let sql = format!(
                r#"
                SELECT *
                FROM nodes
                WHERE parent_id IS NOT NULL
                  AND (lower(name) LIKE ?1 OR lower(relative_path) LIKE ?1)
                {order_by}
                "#
            );
            sqlx::query_as::<_, Node>(&sql)
                .bind(search)
                .fetch_all(&state.db)
                .await?
        }
        Some("current") | None => {
            let folder_id = query.folder_id.as_deref().unwrap_or(ROOT_ID);
            let folder = fetch_folder(&state, folder_id).await?;
            let sql = format!(
                r#"
                WITH RECURSIVE subtree(id) AS (
                    SELECT id FROM nodes WHERE parent_id = ?1
                    UNION ALL
                    SELECT nodes.id FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
                )
                SELECT *
                FROM nodes
                WHERE id IN (SELECT id FROM subtree)
                  AND (lower(name) LIKE ?2 OR lower(relative_path) LIKE ?2)
                {order_by}
                "#
            );
            sqlx::query_as::<_, Node>(&sql)
                .bind(folder.id)
                .bind(search)
                .fetch_all(&state.db)
                .await?
        }
        Some(_) => return Err(AppError::BadRequest("unsupported search scope".into())),
    };

    Ok(Json(SearchResponse {
        nodes: nodes.into_iter().map(node_to_dto).collect(),
    }))
}

#[derive(Deserialize)]
struct CreateFolderRequest {
    name: String,
}

async fn create_folder(
    State(state): State<AppState>,
    Path(parent_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateFolderRequest>,
) -> AppResult<Json<NodeDto>> {
    let name = storage::validate_name(&payload.name)?;
    let parent = fetch_folder(&state, &parent_id).await?;
    ensure_unique_child(&state, &parent.id, &name, None).await?;

    let id = Uuid::new_v4().to_string();
    let relative_path = storage::child_relative_path(&parent.relative_path, &name);
    let path = storage::safe_join(&state.config.files_dir, &relative_path)?;

    fs::create_dir(&path).await?;

    let now = storage::now_ts();
    let result = sqlx::query(
        r#"
        INSERT INTO nodes
            (id, parent_id, kind, name, relative_path, created_at, updated_at)
        VALUES (?1, ?2, 'folder', ?3, ?4, ?5, ?5)
        "#,
    )
    .bind(&id)
    .bind(&parent.id)
    .bind(&name)
    .bind(&relative_path)
    .bind(now)
    .execute(&state.db)
    .await;

    if let Err(error) = result {
        let _ = fs::remove_dir(&path).await;
        return Err(error.into());
    }

    let node = node_to_dto(fetch_node(&state, &id).await?);
    broadcast_node_upsert(&state, &headers, node.clone());
    Ok(Json(node))
}

#[derive(Deserialize)]
struct UploadQuery {
    name: String,
    file_date_at: Option<i64>,
}

async fn upload_file(
    State(state): State<AppState>,
    Path(parent_id): Path<String>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Json<NodeDto>> {
    let name = storage::validate_name(&query.name)?;
    let parent = fetch_folder(&state, &parent_id).await?;
    ensure_unique_child(&state, &parent.id, &name, None).await?;
    let mime_type = storage::media_mime_type(
        headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        &name,
    )
    .ok_or_else(|| AppError::BadRequest("only image and video files are allowed".into()))?;

    let tmp_path = storage::tmp_path(&state.config, "part");
    let size = match storage::write_body_to_file(body, &tmp_path).await {
        Ok(size) => size,
        Err(error) => {
            let _ = storage::remove_file_if_exists(&tmp_path).await;
            return Err(error);
        }
    };

    let id = Uuid::new_v4().to_string();
    let relative_path = storage::child_relative_path(&parent.relative_path, &name);
    let target_path = storage::safe_join(&state.config.files_dir, &relative_path)?;

    let mut tx = state.db.begin().await?;
    let conflict = child_exists_in_tx(&mut tx, &parent.id, &name, None).await?;
    if conflict {
        tx.rollback().await?;
        let _ = storage::remove_file_if_exists(&tmp_path).await;
        return Err(AppError::Conflict(
            "a node with this name already exists".into(),
        ));
    }

    if fs::try_exists(&target_path).await? {
        tx.rollback().await?;
        let _ = storage::remove_file_if_exists(&tmp_path).await;
        return Err(AppError::Conflict(
            "target file already exists on disk".into(),
        ));
    }

    fs::rename(&tmp_path, &target_path).await?;

    let now = storage::now_ts();
    let file_date_at = query.file_date_at.filter(|value| *value > 0);
    let insert_result = sqlx::query(
        r#"
        INSERT INTO nodes
            (id, parent_id, kind, name, relative_path, mime_type, size_bytes, file_date_at, created_at, updated_at)
        VALUES (?1, ?2, 'file', ?3, ?4, ?5, ?6, ?7, ?8, ?8)
        "#,
    )
    .bind(&id)
    .bind(&parent.id)
    .bind(&name)
    .bind(&relative_path)
    .bind(mime_type)
    .bind(size)
    .bind(file_date_at)
    .bind(now)
    .execute(&mut *tx)
    .await;

    if let Err(error) = insert_result {
        let _ = storage::remove_file_if_exists(&target_path).await;
        tx.rollback().await?;
        return Err(error.into());
    }

    tx.commit().await?;

    let node = node_to_dto(fetch_node(&state, &id).await?);
    broadcast_node_upsert(&state, &headers, node.clone());
    Ok(Json(node))
}

#[derive(Deserialize)]
struct ReplaceFileQuery {
    file_date_at: Option<i64>,
}

async fn replace_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ReplaceFileQuery>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Json<NodeDto>> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }

    let mime_type = storage::media_mime_type(
        headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        &node.name,
    )
    .ok_or_else(|| AppError::BadRequest("only image and video files are allowed".into()))?;

    let tmp_path = storage::tmp_path(&state.config, "part");
    let size = match storage::write_body_to_file(body, &tmp_path).await {
        Ok(size) => size,
        Err(error) => {
            let _ = storage::remove_file_if_exists(&tmp_path).await;
            return Err(error);
        }
    };

    let target_path = storage::safe_join(&state.config.files_dir, &node.relative_path)?;
    let backup_path = storage::tmp_path(&state.config, "replace-old");
    let mut had_backup = false;

    match fs::rename(&target_path, &backup_path).await {
        Ok(()) => had_backup = true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            let _ = storage::remove_file_if_exists(&tmp_path).await;
            return Err(error.into());
        }
    }

    if let Err(error) = fs::rename(&tmp_path, &target_path).await {
        if had_backup {
            let _ = fs::rename(&backup_path, &target_path).await;
        }
        let _ = storage::remove_file_if_exists(&tmp_path).await;
        return Err(error.into());
    }

    let now = storage::now_ts();
    let file_date_at = query.file_date_at.filter(|value| *value > 0);
    let mut tx = state.db.begin().await?;
    let update_result = sqlx::query(
        r#"
        UPDATE nodes
        SET mime_type = ?1,
            size_bytes = ?2,
            file_date_at = ?3,
            preview_path = NULL,
            preview_mime = NULL,
            preview_size_bytes = NULL,
            updated_at = ?4
        WHERE id = ?5
        "#,
    )
    .bind(mime_type)
    .bind(size)
    .bind(file_date_at)
    .bind(now)
    .bind(&node.id)
    .execute(&mut *tx)
    .await;

    if let Err(error) = update_result {
        let _ = storage::remove_file_if_exists(&target_path).await;
        if had_backup {
            let _ = fs::rename(&backup_path, &target_path).await;
        }
        tx.rollback().await?;
        return Err(error.into());
    }

    tx.commit().await?;

    if had_backup {
        let _ = storage::remove_file_if_exists(&backup_path).await;
    }
    if let Some(preview_path) = node.preview_path {
        let _ = storage::remove_file_if_exists(&state.config.preview_dir.join(preview_path)).await;
    }

    let node = node_to_dto(fetch_node(&state, &id).await?);
    broadcast_node_upsert(&state, &headers, node.clone());
    Ok(Json(node))
}

async fn upload_preview(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Json<NodeDto>> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }

    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let extension = storage::preview_extension(content_type)
        .ok_or_else(|| AppError::BadRequest("preview must be webp, jpeg or png".into()))?;
    let mime = content_type
        .and_then(|value| value.split(';').next())
        .unwrap_or("image/webp")
        .trim()
        .to_string();

    let tmp_path = storage::tmp_path(&state.config, extension);
    let size = match storage::write_body_to_file(body, &tmp_path).await {
        Ok(size) => size,
        Err(error) => {
            let _ = storage::remove_file_if_exists(&tmp_path).await;
            return Err(error);
        }
    };

    let file_name = format!("{id}.{extension}");
    let final_path = state.config.preview_dir.join(&file_name);
    fs::rename(&tmp_path, &final_path).await?;

    if let Some(old_preview) = node.preview_path.filter(|old| old != &file_name) {
        let _ = storage::remove_file_if_exists(&state.config.preview_dir.join(old_preview)).await;
    }

    let now = storage::now_ts();
    sqlx::query(
        r#"
        UPDATE nodes
        SET preview_path = ?1, preview_mime = ?2, preview_size_bytes = ?3, updated_at = ?4
        WHERE id = ?5
        "#,
    )
    .bind(&file_name)
    .bind(&mime)
    .bind(size)
    .bind(now)
    .bind(&id)
    .execute(&state.db)
    .await?;

    let node = node_to_dto(fetch_node(&state, &id).await?);
    broadcast_node_upsert(&state, &headers, node.clone());
    Ok(Json(node))
}

async fn download_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }
    stream_stored_file(&state, &node, false).await
}

async fn inline_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }
    stream_stored_file_with_range(&state, &node, true, headers.get(RANGE)).await
}

async fn download_preview(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }
    stream_preview(&state, &node).await
}

#[derive(Deserialize)]
struct RenameRequest {
    name: String,
}

async fn rename_node(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<RenameRequest>,
) -> AppResult<Json<NodeDto>> {
    if id == ROOT_ID {
        return Err(AppError::Forbidden);
    }

    let node = fetch_node(&state, &id).await?;
    let parent_id = node.parent_id.clone().ok_or(AppError::Forbidden)?;
    let parent = fetch_folder(&state, &parent_id).await?;
    let name = storage::validate_name(&payload.name)?;
    ensure_unique_child(&state, &parent.id, &name, Some(&node.id)).await?;

    let old_relative_path = node.relative_path.clone();
    let new_relative_path = storage::child_relative_path(&parent.relative_path, &name);
    let old_path = storage::safe_join(&state.config.files_dir, &old_relative_path)?;
    let new_path = storage::safe_join(&state.config.files_dir, &new_relative_path)?;

    fs::rename(&old_path, &new_path).await?;

    let mut tx = state.db.begin().await?;
    let update_result = update_renamed_paths(
        &mut tx,
        &node,
        &name,
        &old_relative_path,
        &new_relative_path,
    )
    .await;

    if let Err(error) = update_result {
        let _ = fs::rename(&new_path, &old_path).await;
        tx.rollback().await?;
        return Err(error);
    }

    tx.commit().await?;
    let node = node_to_dto(fetch_node(&state, &id).await?);
    broadcast_node_upsert(&state, &headers, node.clone());
    Ok(Json(node))
}

async fn delete_node(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> AppResult<StatusCode> {
    if id == ROOT_ID {
        return Err(AppError::Forbidden);
    }

    let node = fetch_node(&state, &id).await?;
    let parent_id = node.parent_id.clone();
    let cleanup_rows = preview_cleanup_rows(&state, &id).await?;
    let source_path = storage::safe_join(&state.config.files_dir, &node.relative_path)?;
    let trash_path = state
        .config
        .trash_dir
        .join(format!("{}-{}", id, storage::now_ts()));

    match fs::rename(&source_path, &trash_path).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    sqlx::query("DELETE FROM nodes WHERE id = ?1")
        .bind(&id)
        .execute(&state.db)
        .await?;

    for row in cleanup_rows {
        if let Some(preview_path) = row.preview_path {
            let _ =
                storage::remove_file_if_exists(&state.config.preview_dir.join(preview_path)).await;
        }
    }

    if fs::try_exists(&trash_path).await? {
        let metadata = fs::metadata(&trash_path).await?;
        if metadata.is_dir() {
            fs::remove_dir_all(&trash_path).await?;
        } else {
            fs::remove_file(&trash_path).await?;
        }
    }

    broadcast_node_deleted(&state, &headers, id, parent_id);

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct CreateShareResponse {
    share: ShareDto,
    token: String,
    public_url: String,
}

async fn create_share(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<CreateShareResponse>> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }

    let token = auth::generate_token();
    let token_hash = auth::hash_token(&token);
    let share_id = Uuid::new_v4().to_string();
    let now = storage::now_ts();
    let expires_at = now + SHARE_TTL_SECONDS;

    sqlx::query(
        r#"
        INSERT INTO shares (id, file_id, token_hash, created_at, expires_at, download_count)
        VALUES (?1, ?2, ?3, ?4, ?5, 0)
        "#,
    )
    .bind(&share_id)
    .bind(&id)
    .bind(token_hash)
    .bind(now)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    let share = fetch_share_dto(&state, &share_id).await?;
    let path = format!("/share/{token}");
    let public_url = state
        .config
        .public_base_url
        .as_ref()
        .map(|base_url| format!("{base_url}{path}"))
        .unwrap_or(path);

    Ok(Json(CreateShareResponse {
        share,
        token,
        public_url,
    }))
}

#[derive(Serialize)]
struct SharesResponse {
    shares: Vec<ShareDto>,
}

async fn list_shares(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<SharesResponse>> {
    let node = fetch_node(&state, &id).await?;
    if !node.is_file() {
        return Err(AppError::BadRequest("node is not a file".into()));
    }

    let shares = sqlx::query_as::<_, ShareDto>(
        r#"
        SELECT id, file_id, created_at, expires_at, revoked_at, download_count
        FROM shares
        WHERE file_id = ?1
        ORDER BY created_at DESC
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(SharesResponse { shares }))
}

async fn revoke_share(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let now = storage::now_ts();
    let result = sqlx::query(
        r#"
        UPDATE shares
        SET revoked_at = ?1
        WHERE id = ?2 AND revoked_at IS NULL
        "#,
    )
    .bind(now)
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct PublicShareResponse {
    file: NodeDto,
}

async fn public_share(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Json<PublicShareResponse>> {
    let (_, node) = lookup_public_share(&state, &token).await?;
    Ok(Json(PublicShareResponse {
        file: public_node_to_dto(node, &token),
    }))
}

async fn public_download(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Response> {
    let (share, node) = lookup_public_share(&state, &token).await?;
    sqlx::query("UPDATE shares SET download_count = download_count + 1 WHERE id = ?1")
        .bind(share.id)
        .execute(&state.db)
        .await?;

    stream_stored_file(&state, &node, false).await
}

async fn public_preview(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Response> {
    let (_, node) = lookup_public_share(&state, &token).await?;
    stream_preview(&state, &node).await
}

async fn stream_stored_file(state: &AppState, node: &Node, inline: bool) -> AppResult<Response> {
    stream_stored_file_with_range(state, node, inline, None).await
}

async fn stream_stored_file_with_range(
    state: &AppState,
    node: &Node,
    inline: bool,
    range_header: Option<&axum::http::HeaderValue>,
) -> AppResult<Response> {
    let path = storage::safe_join(&state.config.files_dir, &node.relative_path)?;
    let content_type = node
        .mime_type
        .as_deref()
        .unwrap_or("application/octet-stream");
    let disposition = if inline { "inline" } else { "attachment" };

    if let (Some(size), Some(range_header)) = (node.size_bytes, range_header) {
        if let Some((start, end)) = range_header
            .to_str()
            .ok()
            .and_then(|value| parse_byte_range(value, size))
        {
            return stream_path_range(
                path,
                content_type,
                size,
                start,
                end,
                disposition,
                &node.name,
            )
            .await;
        }
    }

    stream_path(path, content_type, node.size_bytes, disposition, &node.name).await
}

async fn stream_preview(state: &AppState, node: &Node) -> AppResult<Response> {
    let preview_path = node.preview_path.as_ref().ok_or(AppError::NotFound)?;
    let path = state.config.preview_dir.join(preview_path);
    stream_path(
        path,
        node.preview_mime.as_deref().unwrap_or("image/webp"),
        node.preview_size_bytes,
        "inline",
        &node.name,
    )
    .await
}

async fn stream_path(
    path: PathBuf,
    content_type: &str,
    content_length: Option<i64>,
    disposition: &str,
    filename: &str,
) -> AppResult<Response> {
    let file = fs::File::open(path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(error)
        }
    })?;

    let stream = ReaderStream::new(file);
    let mut response = Body::from_stream(stream).into_response();
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );
    if let Some(length) = content_length {
        headers.insert(
            CONTENT_LENGTH,
            length
                .to_string()
                .parse()
                .map_err(|_| AppError::BadRequest("invalid stored file size".into()))?,
        );
        headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
    }
    headers.insert(
        CONTENT_DISPOSITION,
        format!(
            r#"{disposition}; filename="{}""#,
            storage::quoted_filename(filename)
        )
        .parse()
        .map_err(|_| AppError::BadRequest("invalid filename".into()))?,
    );

    Ok(response)
}

async fn stream_path_range(
    path: PathBuf,
    content_type: &str,
    total_length: i64,
    start: u64,
    end: u64,
    disposition: &str,
    filename: &str,
) -> AppResult<Response> {
    let mut file = fs::File::open(path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(error)
        }
    })?;

    file.seek(SeekFrom::Start(start)).await?;
    let length = end - start + 1;
    let stream = ReaderStream::new(file.take(length));
    let mut response = (StatusCode::PARTIAL_CONTENT, Body::from_stream(stream)).into_response();
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );
    headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
    headers.insert(
        CONTENT_LENGTH,
        length
            .to_string()
            .parse()
            .map_err(|_| AppError::BadRequest("invalid stored file size".into()))?,
    );
    headers.insert(
        CONTENT_RANGE,
        format!("bytes {start}-{end}/{total_length}")
            .parse()
            .map_err(|_| AppError::BadRequest("invalid byte range".into()))?,
    );
    headers.insert(
        CONTENT_DISPOSITION,
        format!(
            r#"{disposition}; filename="{}""#,
            storage::quoted_filename(filename)
        )
        .parse()
        .map_err(|_| AppError::BadRequest("invalid filename".into()))?,
    );

    Ok(response)
}

fn parse_byte_range(value: &str, size: i64) -> Option<(u64, u64)> {
    if size <= 0 {
        return None;
    }

    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    let total = u64::try_from(size).ok()?;

    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(total);
        if suffix == 0 {
            return None;
        }
        return Some((total - suffix, total - 1));
    }

    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>().ok()?.min(total - 1)
    };

    (start <= end && start < total).then_some((start, end))
}

async fn fetch_node(state: &AppState, id: &str) -> AppResult<Node> {
    sqlx::query_as::<_, Node>("SELECT * FROM nodes WHERE id = ?1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)
}

async fn fetch_folder(state: &AppState, id: &str) -> AppResult<Node> {
    let node = fetch_node(state, id).await?;
    if node.is_folder() {
        Ok(node)
    } else {
        Err(AppError::BadRequest("node is not a folder".into()))
    }
}

async fn ensure_unique_child(
    state: &AppState,
    parent_id: &str,
    name: &str,
    exclude_id: Option<&str>,
) -> AppResult<()> {
    let exists = if let Some(exclude_id) = exclude_id {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM nodes WHERE parent_id = ?1 AND name = ?2 AND id <> ?3",
        )
        .bind(parent_id)
        .bind(name)
        .bind(exclude_id)
        .fetch_one(&state.db)
        .await?
    } else {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM nodes WHERE parent_id = ?1 AND name = ?2",
        )
        .bind(parent_id)
        .bind(name)
        .fetch_one(&state.db)
        .await?
    };

    if exists > 0 {
        Err(AppError::Conflict(
            "a node with this name already exists".into(),
        ))
    } else {
        Ok(())
    }
}

async fn child_exists_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    parent_id: &str,
    name: &str,
    exclude_id: Option<&str>,
) -> AppResult<bool> {
    let count = if let Some(exclude_id) = exclude_id {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM nodes WHERE parent_id = ?1 AND name = ?2 AND id <> ?3",
        )
        .bind(parent_id)
        .bind(name)
        .bind(exclude_id)
        .fetch_one(&mut **tx)
        .await?
    } else {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM nodes WHERE parent_id = ?1 AND name = ?2",
        )
        .bind(parent_id)
        .bind(name)
        .fetch_one(&mut **tx)
        .await?
    };

    Ok(count > 0)
}

async fn breadcrumbs(state: &AppState, folder: &Node) -> AppResult<Vec<NodeDto>> {
    let mut current = Some(folder.clone());
    let mut nodes = Vec::new();

    while let Some(node) = current {
        current = if let Some(parent_id) = &node.parent_id {
            Some(fetch_node(state, parent_id).await?)
        } else {
            None
        };
        nodes.push(node_to_dto(node));
    }

    nodes.reverse();
    Ok(nodes)
}

async fn update_renamed_paths(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    node: &Node,
    name: &str,
    old_relative_path: &str,
    new_relative_path: &str,
) -> AppResult<()> {
    let now = storage::now_ts();
    sqlx::query("UPDATE nodes SET name = ?1, relative_path = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(name)
        .bind(new_relative_path)
        .bind(now)
        .bind(&node.id)
        .execute(&mut **tx)
        .await?;

    if node.is_folder() {
        let descendants = sqlx::query_as::<_, DescendantPath>(
            r#"
            WITH RECURSIVE subtree(id) AS (
                SELECT id FROM nodes WHERE parent_id = ?1
                UNION ALL
                SELECT nodes.id FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
            )
            SELECT id, relative_path FROM nodes WHERE id IN (SELECT id FROM subtree)
            "#,
        )
        .bind(&node.id)
        .fetch_all(&mut **tx)
        .await?;

        let old_prefix = format!("{old_relative_path}/");
        for descendant in descendants {
            if let Some(suffix) = descendant.relative_path.strip_prefix(&old_prefix) {
                let rewritten = format!("{new_relative_path}/{suffix}");
                sqlx::query("UPDATE nodes SET relative_path = ?1, updated_at = ?2 WHERE id = ?3")
                    .bind(rewritten)
                    .bind(now)
                    .bind(descendant.id)
                    .execute(&mut **tx)
                    .await?;
            }
        }
    }

    Ok(())
}

#[derive(sqlx::FromRow)]
struct DescendantPath {
    id: String,
    relative_path: String,
}

#[derive(sqlx::FromRow)]
struct PreviewCleanup {
    preview_path: Option<String>,
}

async fn preview_cleanup_rows(state: &AppState, id: &str) -> AppResult<Vec<PreviewCleanup>> {
    Ok(sqlx::query_as::<_, PreviewCleanup>(
        r#"
        WITH RECURSIVE subtree(id) AS (
            SELECT id FROM nodes WHERE id = ?1
            UNION ALL
            SELECT nodes.id FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
        )
        SELECT preview_path FROM nodes WHERE id IN (SELECT id FROM subtree)
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?)
}

async fn fetch_share_dto(state: &AppState, id: &str) -> AppResult<ShareDto> {
    sqlx::query_as::<_, ShareDto>(
        r#"
        SELECT id, file_id, created_at, expires_at, revoked_at, download_count
        FROM shares
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}

async fn lookup_public_share(state: &AppState, token: &str) -> AppResult<(ShareLookup, Node)> {
    let token_hash = auth::hash_token(token);
    let now = storage::now_ts();
    let share = sqlx::query_as::<_, ShareLookup>(
        r#"
        SELECT id, file_id
        FROM shares
        WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2
        "#,
    )
    .bind(token_hash)
    .bind(now)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let node = fetch_node(state, &share.file_id).await?;
    if !node.is_file() {
        return Err(AppError::NotFound);
    }

    Ok((share, node))
}

fn public_node_to_dto(node: Node, token: &str) -> NodeDto {
    let has_preview = node.preview_path.is_some();
    let display_date_at = node.file_date_at.unwrap_or(node.created_at);
    NodeDto {
        preview_url: has_preview.then(|| format!("/api/public/shares/{token}/preview")),
        download_url: Some(format!("/api/public/shares/{token}/download")),
        has_preview,
        id: node.id,
        parent_id: node.parent_id,
        kind: node.kind,
        name: node.name,
        relative_path: node.relative_path,
        mime_type: node.mime_type,
        size_bytes: node.size_bytes,
        file_date_at: node.file_date_at,
        display_date_at,
        created_at: node.created_at,
        updated_at: node.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_byte_range;

    #[test]
    fn parses_byte_ranges_for_video_streaming() {
        assert_eq!(parse_byte_range("bytes=0-99", 1_000), Some((0, 99)));
        assert_eq!(parse_byte_range("bytes=500-", 1_000), Some((500, 999)));
        assert_eq!(parse_byte_range("bytes=-200", 1_000), Some((800, 999)));
        assert_eq!(parse_byte_range("bytes=1000-1200", 1_000), None);
        assert_eq!(parse_byte_range("items=0-99", 1_000), None);
    }
}
