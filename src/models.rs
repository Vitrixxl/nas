use serde::Serialize;

pub const ROOT_ID: &str = "00000000-0000-0000-0000-000000000000";

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct Node {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub relative_path: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub file_date_at: Option<i64>,
    pub preview_path: Option<String>,
    pub preview_mime: Option<String>,
    pub preview_size_bytes: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct NodeDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub relative_path: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub file_date_at: Option<i64>,
    pub display_date_at: i64,
    pub has_preview: bool,
    pub preview_url: Option<String>,
    pub download_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Node {
    pub fn is_file(&self) -> bool {
        self.kind == "file"
    }

    pub fn is_folder(&self) -> bool {
        self.kind == "folder"
    }
}

pub fn node_to_dto(node: Node) -> NodeDto {
    let is_file = node.kind == "file";
    let has_preview = node.preview_path.is_some();
    let display_date_at = node.file_date_at.unwrap_or(node.created_at);
    NodeDto {
        preview_url: (is_file && has_preview).then(|| format!("/api/files/{}/preview", node.id)),
        download_url: is_file.then(|| format!("/api/files/{}/download", node.id)),
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

#[derive(Debug, sqlx::FromRow)]
pub struct SessionRow {
    pub id: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ShareDto {
    pub id: String,
    pub file_id: String,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    pub download_count: i64,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ShareLookup {
    pub id: String,
    pub file_id: String,
}
