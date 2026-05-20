use std::{
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::body::Body;
use http_body_util::BodyExt;
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};
use uuid::Uuid;

use crate::{
    config::Config,
    error::{AppError, AppResult},
};

pub async fn ensure_data_dirs(config: &Config) -> anyhow::Result<()> {
    fs::create_dir_all(&config.files_dir).await?;
    fs::create_dir_all(&config.preview_dir).await?;
    fs::create_dir_all(&config.tmp_dir).await?;
    fs::create_dir_all(&config.trash_dir).await?;
    Ok(())
}

pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn validate_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }

    if trimmed == "." || trimmed == ".." {
        return Err(AppError::BadRequest("name is not allowed".into()));
    }

    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(AppError::BadRequest(
            "name cannot contain path separators".into(),
        ));
    }

    Ok(trimmed.to_string())
}

pub fn child_relative_path(parent_relative_path: &str, name: &str) -> String {
    if parent_relative_path.is_empty() {
        name.to_string()
    } else {
        format!("{parent_relative_path}/{name}")
    }
}

pub fn safe_join(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let mut path = root.to_path_buf();
    if relative_path.is_empty() {
        return Ok(path);
    }

    for component in Path::new(relative_path).components() {
        match component {
            Component::Normal(value) => path.push(value),
            _ => return Err(AppError::BadRequest("invalid stored path".into())),
        }
    }

    Ok(path)
}

pub fn preview_extension(content_type: Option<&str>) -> Option<&'static str> {
    match content_type.unwrap_or_default().split(';').next()?.trim() {
        "image/webp" => Some("webp"),
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        _ => None,
    }
}

pub fn media_mime_type(content_type: Option<&str>, name: &str) -> Option<String> {
    let from_header = content_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| is_allowed_media_mime(value))
        .map(ToString::to_string);

    from_header.or_else(|| {
        mime_guess::from_path(name)
            .first_raw()
            .filter(|value| is_allowed_media_mime(value))
            .map(ToString::to_string)
    })
}

pub fn is_allowed_media_mime(value: &str) -> bool {
    value.starts_with("image/") || value.starts_with("video/")
}

pub fn tmp_path(config: &Config, extension: &str) -> PathBuf {
    config.tmp_dir.join(format!(
        "{}.{}",
        Uuid::new_v4(),
        extension.trim_start_matches('.')
    ))
}

pub fn quoted_filename(name: &str) -> String {
    name.chars()
        .map(|ch| match ch {
            '"' | '\\' | '\r' | '\n' => '_',
            _ => ch,
        })
        .collect()
}

pub async fn write_body_to_file(mut body: Body, path: &Path) -> AppResult<i64> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .await?;
    let mut written = 0_i64;

    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|error| AppError::BadRequest(error.to_string()))?;
        if let Some(chunk) = frame.data_ref() {
            file.write_all(chunk).await?;
            written += i64::try_from(chunk.len())
                .map_err(|_| AppError::BadRequest("request body is too large".into()))?;
        }
    }

    file.flush().await?;
    Ok(written)
}

pub async fn remove_file_if_exists(path: &Path) -> AppResult<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_file_names() {
        assert!(validate_name("photo.jpg").is_ok());
        assert!(validate_name("nested/photo.jpg").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name(" ").is_err());
    }

    #[test]
    fn joins_relative_paths_safely() {
        let root = PathBuf::from("/tmp/root");
        assert_eq!(
            safe_join(&root, "a/b.txt").unwrap(),
            PathBuf::from("/tmp/root/a/b.txt")
        );
        assert!(safe_join(&root, "../b.txt").is_err());
        assert!(safe_join(&root, "/b.txt").is_err());
    }

    #[test]
    fn accepts_only_image_and_video_mime_types() {
        assert_eq!(
            media_mime_type(Some("image/jpeg; charset=binary"), "photo.jpg").as_deref(),
            Some("image/jpeg")
        );
        assert_eq!(
            media_mime_type(Some("application/octet-stream"), "clip.mp4").as_deref(),
            Some("video/mp4")
        );
        assert!(media_mime_type(Some("application/pdf"), "doc.pdf").is_none());
    }
}
