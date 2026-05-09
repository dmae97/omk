use std::path::{Path, PathBuf};

pub const RUN_ID_MAX_LENGTH: usize = 128;
pub const RUN_ARTIFACT_PATH_MAX_LENGTH: usize = 256;
pub const RESERVED_RUN_IDS: [&str; 1] = ["latest"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetyErrorKind {
    EmptyRunId,
    RunIdTooLong,
    RunIdDotOnly,
    RunIdReserved,
    RunIdDisallowed,
    EmptyArtifactPath,
    ArtifactPathTooLong,
    ArtifactPathAbsolute,
    ArtifactPathBackslash,
    ArtifactPathEmptySegment,
    ArtifactPathDotOnly,
    ArtifactPathSegmentTooLong,
    ArtifactPathDisallowed,
    EmptyRunsDir,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SafetyError {
    pub kind: SafetyErrorKind,
    pub message: String,
}

impl SafetyError {
    fn new(kind: SafetyErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

pub fn validate_run_id(raw: &str) -> Result<&str, SafetyError> {
    if raw.is_empty() {
        return Err(SafetyError::new(
            SafetyErrorKind::EmptyRunId,
            "Invalid runId: empty or non-string value",
        ));
    }
    if raw.len() > RUN_ID_MAX_LENGTH {
        return Err(SafetyError::new(
            SafetyErrorKind::RunIdTooLong,
            format!("Invalid runId: exceeds {RUN_ID_MAX_LENGTH} characters"),
        ));
    }
    if raw == "." || raw == ".." {
        return Err(SafetyError::new(
            SafetyErrorKind::RunIdDotOnly,
            "Invalid runId: dot-only segment not allowed",
        ));
    }
    if RESERVED_RUN_IDS.contains(&raw) {
        return Err(SafetyError::new(
            SafetyErrorKind::RunIdReserved,
            format!("Invalid runId: \"{raw}\" is reserved"),
        ));
    }
    if raw
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        Ok(raw)
    } else {
        Err(SafetyError::new(
            SafetyErrorKind::RunIdDisallowed,
            format!("Invalid runId: \"{raw}\" contains disallowed characters"),
        ))
    }
}

pub fn sanitize_run_id(raw: &str, fallback_prefix: &str) -> String {
    if raw == "." || raw == ".." {
        return fallback_run_id(fallback_prefix);
    }

    let mut sanitized: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();

    while sanitized.contains("..") {
        sanitized = sanitized.replace("..", "-");
    }

    if sanitized.len() > RUN_ID_MAX_LENGTH {
        sanitized.truncate(RUN_ID_MAX_LENGTH);
    }

    if validate_run_id(&sanitized).is_ok() {
        return sanitized;
    }

    fallback_run_id(fallback_prefix)
}

pub fn validate_artifact_path(raw: &str) -> Result<String, SafetyError> {
    if raw.is_empty() {
        return Err(SafetyError::new(
            SafetyErrorKind::EmptyArtifactPath,
            "Invalid run artifact path: empty or non-string value",
        ));
    }
    if raw.len() > RUN_ARTIFACT_PATH_MAX_LENGTH {
        return Err(SafetyError::new(
            SafetyErrorKind::ArtifactPathTooLong,
            format!("Invalid run artifact path: exceeds {RUN_ARTIFACT_PATH_MAX_LENGTH} characters"),
        ));
    }
    if raw.starts_with('/') || raw.starts_with('\\') || has_windows_drive_prefix(raw) {
        return Err(SafetyError::new(
            SafetyErrorKind::ArtifactPathAbsolute,
            "Invalid run artifact path: absolute paths are not allowed",
        ));
    }
    if raw.contains('\\') {
        return Err(SafetyError::new(
            SafetyErrorKind::ArtifactPathBackslash,
            "Invalid run artifact path: backslash separators are not allowed",
        ));
    }

    let mut segments = Vec::new();
    for segment in raw.split('/') {
        if segment.is_empty() {
            return Err(SafetyError::new(
                SafetyErrorKind::ArtifactPathEmptySegment,
                "Invalid run artifact path: empty path segment not allowed",
            ));
        }
        if segment == "." || segment == ".." {
            return Err(SafetyError::new(
                SafetyErrorKind::ArtifactPathDotOnly,
                "Invalid run artifact path: dot-only segment not allowed",
            ));
        }
        if segment.len() > RUN_ID_MAX_LENGTH {
            return Err(SafetyError::new(
                SafetyErrorKind::ArtifactPathSegmentTooLong,
                format!(
                    "Invalid run artifact path: segment exceeds {RUN_ID_MAX_LENGTH} characters"
                ),
            ));
        }
        if !segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        {
            return Err(SafetyError::new(
                SafetyErrorKind::ArtifactPathDisallowed,
                format!("Invalid run artifact path: \"{raw}\" contains disallowed characters"),
            ));
        }
        segments.push(segment);
    }

    Ok(segments.join("/"))
}

pub fn validate_run_artifact<'a>(
    run_id: &'a str,
    artifact: &str,
) -> Result<(&'a str, String), SafetyError> {
    let valid_run_id = validate_run_id(run_id)?;
    let valid_artifact = validate_artifact_path(artifact)?;
    Ok((valid_run_id, valid_artifact))
}

pub fn resolve_run_artifact_path(
    runs_dir: &str,
    run_id: &str,
    artifact: &str,
) -> Result<PathBuf, SafetyError> {
    if runs_dir.is_empty() {
        return Err(SafetyError::new(
            SafetyErrorKind::EmptyRunsDir,
            "Invalid runs dir: empty value",
        ));
    }
    let (valid_run_id, valid_artifact) = validate_run_artifact(run_id, artifact)?;
    let mut path = Path::new(runs_dir).join(valid_run_id);
    for segment in valid_artifact.split('/') {
        path.push(segment);
    }
    Ok(path)
}

pub fn run_self_test() -> Result<usize, SafetyError> {
    validate_run_id("run-123")?;
    assert_rejected(validate_run_id("latest"))?;
    validate_artifact_path("logs/node-1.log")?;
    assert_rejected(validate_artifact_path("../state.json"))?;
    resolve_run_artifact_path(".omk/runs", "run-123", "logs/node-1.log")?;
    assert_rejected(resolve_run_artifact_path(
        ".omk/runs",
        "run-123",
        "../state.json",
    ))?;
    Ok(6)
}

fn assert_rejected<T>(result: Result<T, SafetyError>) -> Result<(), SafetyError> {
    if result.is_err() {
        Ok(())
    } else {
        Err(SafetyError::new(
            SafetyErrorKind::ArtifactPathDisallowed,
            "self-test failed: unsafe value was accepted",
        ))
    }
}

fn fallback_run_id(fallback_prefix: &str) -> String {
    let mut fallback: String = fallback_prefix
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    while fallback.contains("--") {
        fallback = fallback.replace("--", "-");
    }
    fallback = fallback.trim_matches('-').to_string();
    if fallback.is_empty() || fallback == "latest" {
        fallback = "run".to_string();
    }
    if fallback.len() > RUN_ID_MAX_LENGTH {
        fallback.truncate(RUN_ID_MAX_LENGTH);
    }
    if validate_run_id(&fallback).is_ok() {
        fallback
    } else {
        "run".to_string()
    }
}

fn has_windows_drive_prefix(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_known_good_run_ids() {
        for id in [
            "run-123",
            "chat_abc-1",
            "2026-05-01T06-31-49-303Z",
            "my.run.id",
        ] {
            assert_eq!(validate_run_id(id), Ok(id));
        }
    }

    #[test]
    fn rejects_traversal_and_reserved_values() {
        assert_eq!(
            validate_run_id("").unwrap_err().kind,
            SafetyErrorKind::EmptyRunId
        );
        assert_eq!(
            validate_run_id(".").unwrap_err().kind,
            SafetyErrorKind::RunIdDotOnly
        );
        assert_eq!(
            validate_run_id("..").unwrap_err().kind,
            SafetyErrorKind::RunIdDotOnly
        );
        assert_eq!(
            validate_run_id("latest").unwrap_err().kind,
            SafetyErrorKind::RunIdReserved
        );
        assert_eq!(
            validate_run_id("foo/bar").unwrap_err().kind,
            SafetyErrorKind::RunIdDisallowed
        );
        assert_eq!(
            validate_run_id("foo\\bar").unwrap_err().kind,
            SafetyErrorKind::RunIdDisallowed
        );
        assert_eq!(
            validate_run_id("C:\\tmp").unwrap_err().kind,
            SafetyErrorKind::RunIdDisallowed
        );
    }

    #[test]
    fn enforces_length_cap() {
        let valid = "a".repeat(RUN_ID_MAX_LENGTH);
        let invalid = "a".repeat(RUN_ID_MAX_LENGTH + 1);
        assert!(validate_run_id(&valid).is_ok());
        assert_eq!(
            validate_run_id(&invalid).unwrap_err().kind,
            SafetyErrorKind::RunIdTooLong
        );
    }

    #[test]
    fn sanitizes_to_valid_fallback_when_needed() {
        assert_eq!(sanitize_run_id("bad/id", "run"), "bad-id");
        assert_eq!(sanitize_run_id("..", "cron"), "cron");
        assert_eq!(sanitize_run_id("latest", "run"), "run");
        assert_eq!(sanitize_run_id("", "latest"), "run");
    }

    #[test]
    fn validates_artifact_paths() {
        assert_eq!(
            validate_artifact_path("logs/node-1.log"),
            Ok("logs/node-1.log".to_string())
        );
        assert_eq!(
            validate_artifact_path("evidence_v1/report.md"),
            Ok("evidence_v1/report.md".to_string())
        );
    }

    #[test]
    fn rejects_artifact_traversal_and_absolute_paths() {
        assert_eq!(
            validate_artifact_path("").unwrap_err().kind,
            SafetyErrorKind::EmptyArtifactPath
        );
        assert_eq!(
            validate_artifact_path("../state.json").unwrap_err().kind,
            SafetyErrorKind::ArtifactPathDotOnly
        );
        assert_eq!(
            validate_artifact_path("logs/../state.json")
                .unwrap_err()
                .kind,
            SafetyErrorKind::ArtifactPathDotOnly
        );
        assert_eq!(
            validate_artifact_path("/etc/passwd").unwrap_err().kind,
            SafetyErrorKind::ArtifactPathAbsolute
        );
        assert_eq!(
            validate_artifact_path("C:\\tmp").unwrap_err().kind,
            SafetyErrorKind::ArtifactPathAbsolute
        );
        assert_eq!(
            validate_artifact_path("logs\\state.json").unwrap_err().kind,
            SafetyErrorKind::ArtifactPathBackslash
        );
        assert_eq!(
            validate_artifact_path("logs//state.json").unwrap_err().kind,
            SafetyErrorKind::ArtifactPathEmptySegment
        );
        assert_eq!(
            validate_artifact_path("bad:name.json").unwrap_err().kind,
            SafetyErrorKind::ArtifactPathDisallowed
        );
    }

    #[test]
    fn resolves_run_artifact_paths_lexically_under_runs_dir() {
        let path =
            resolve_run_artifact_path("/repo/.omk/runs", "run-123", "logs/node-1.log").unwrap();
        assert!(path.ends_with(Path::new("run-123").join("logs").join("node-1.log")));
        assert_eq!(
            resolve_run_artifact_path("/repo/.omk/runs", "run-123", "../state.json")
                .unwrap_err()
                .kind,
            SafetyErrorKind::ArtifactPathDotOnly
        );
    }

    #[test]
    fn self_test_exercises_positive_and_negative_contracts() {
        assert_eq!(run_self_test(), Ok(6));
    }
}
