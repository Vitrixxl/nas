use std::str::FromStr;

use sqlx::{
    Executor, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use crate::{models::ROOT_ID, storage::now_ts};

pub async fn init_db(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    pool.execute("PRAGMA journal_mode = WAL;").await?;
    pool.execute("PRAGMA synchronous = NORMAL;").await?;

    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
            name TEXT NOT NULL,
            relative_path TEXT NOT NULL UNIQUE,
            mime_type TEXT,
            size_bytes INTEGER,
            file_date_at INTEGER,
            preview_path TEXT,
            preview_mime TEXT,
            preview_size_bytes INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            CHECK ((kind = 'folder' AND size_bytes IS NULL) OR kind = 'file')
        );
        "#,
    )
    .await?;

    ensure_nodes_file_date_column(&pool).await?;

    pool.execute(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_unique_child
        ON nodes(parent_id, name);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_nodes_parent_kind_name
        ON nodes(parent_id, kind, name);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_nodes_parent_file_date
        ON nodes(parent_id, file_date_at, created_at);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_nodes_kind_file_date
        ON nodes(kind, file_date_at, created_at);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_nodes_kind_name
        ON nodes(kind, name);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_nodes_relative_path
        ON nodes(relative_path);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL
        );
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
        ON sessions(token_hash);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS shares (
            id TEXT PRIMARY KEY,
            file_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            revoked_at INTEGER,
            download_count INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .await?;

    ensure_shares_expires_at_column(&pool).await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_shares_file_id
        ON shares(file_id);
        "#,
    )
    .await?;

    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS idx_shares_token_hash
        ON shares(token_hash);
        "#,
    )
    .await?;

    let now = now_ts();
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO nodes
            (id, parent_id, kind, name, relative_path, created_at, updated_at)
        VALUES (?1, NULL, 'folder', '', '', ?2, ?2);
        "#,
    )
    .bind(ROOT_ID)
    .bind(now)
    .execute(&pool)
    .await?;

    Ok(pool)
}

async fn ensure_nodes_file_date_column(pool: &SqlitePool) -> anyhow::Result<()> {
    let exists = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM pragma_table_info('nodes')
        WHERE name = 'file_date_at'
        "#,
    )
    .fetch_one(pool)
    .await?;

    if exists == 0 {
        pool.execute("ALTER TABLE nodes ADD COLUMN file_date_at INTEGER;")
            .await?;
    }

    Ok(())
}

async fn ensure_shares_expires_at_column(pool: &SqlitePool) -> anyhow::Result<()> {
    let exists = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM pragma_table_info('shares')
        WHERE name = 'expires_at'
        "#,
    )
    .fetch_one(pool)
    .await?;

    if exists == 0 {
        pool.execute("ALTER TABLE shares ADD COLUMN expires_at INTEGER;")
            .await?;
        pool.execute("UPDATE shares SET expires_at = created_at + 3600 WHERE expires_at IS NULL;")
            .await?;
    }

    Ok(())
}
