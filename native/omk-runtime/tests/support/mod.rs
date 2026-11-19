pub fn identity() -> String {
    format!(
        r#"{{"version":"omk.native-agent.v1","launchId":"launch","sessionId":"session","promptId":"prompt","toolCallId":"tool","scopeEpochId":"scope","generation":1,"attempt":1,"grantDigest":"{}"}}"#,
        "a".repeat(64)
    )
}

pub fn request(kind: &str, seq: u64, identity: &str) -> String {
    format!(r#"{{"type":"{kind}","data":{{"identity":{identity},"controlSeq":{seq}}}}}"#)
}
