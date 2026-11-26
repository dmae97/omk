//! Frozen public Node catalog plus explicit host-supplied models.json overlay.
use crate::catalog_overlay::{apply, merge, normalize, parse, strings};
use serde_json::{Value, json};
pub struct Catalog {
    models: Vec<Value>,
    config: Value,
    invalid: bool,
}
impl Catalog {
    /// No ambient files, OAuth mutation or network refresh. Invalid overlays retain builtins.
    pub fn load(overlay: Option<&str>) -> Self {
        let data: Value =
            serde_json::from_str(include_str!("../catalog.json")).expect("bundled catalog");
        let mut models = data["models"].as_array().expect("bundled models").clone();
        for model in &mut models {
            normalize(model);
        }
        let parsed = overlay.map(parse).transpose();
        let (config, order, mut invalid) = match parsed {
            Ok(Some((config, order))) => (config, order, false),
            Ok(None) => (json!({}), vec![], false),
            Err(()) => (json!({"visibility":{"providers":[]}}), vec![], true),
        };
        // Validate inheritance before applying anything: a bad provider invalidates the entire overlay.
        for name in &order {
            if name == "grok-oauth-proxy" {
                continue;
            }
            let p = &config["providers"][name];
            let defs = p["models"].as_array().map(Vec::as_slice).unwrap_or(&[]);
            let builtin = models.iter().find(|m| m["provider"] == *name);
            if defs.is_empty()
                && !["baseUrl", "headers", "compat", "modelOverrides"]
                    .iter()
                    .any(|k| p.get(k).is_some())
            {
                invalid = true;
            }
            if !defs.is_empty()
                && builtin.is_none()
                && (p["baseUrl"].as_str().is_none()
                    || p["apiKey"].as_str().is_none()
                    || defs
                        .iter()
                        .any(|m| m["api"].as_str().or(p["api"].as_str()).is_none()))
            {
                invalid = true;
            }
        }
        if invalid {
            // Node blocks an explicit malformed visibility filter, but otherwise retains builtin availability.
            let explicit = overlay.is_some_and(crate::catalog_overlay::has_visibility);
            return Self {
                models,
                config: if explicit {
                    json!({"visibility":{"providers":[]}})
                } else {
                    json!({})
                },
                invalid,
            };
        }
        let originals = models.clone();
        for model in &mut models {
            let provider = &config["providers"][model["provider"].as_str().unwrap()];
            if let Some(url) = provider.get("baseUrl") {
                model["baseUrl"] = url.clone();
            }
            if provider.get("compat").is_some() {
                model["compat"] = merge(&model["compat"], &provider["compat"]);
            }
            let override_ = &provider["modelOverrides"][model["id"].as_str().unwrap()];
            apply(model, override_);
            normalize(model);
        }
        for name in &order {
            if name == "grok-oauth-proxy" {
                continue;
            }
            let provider = &config["providers"][name];
            let default = originals.iter().find(|m| m["provider"] == *name);
            for def in provider["models"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                let pick = |key: &str| {
                    def.get(key)
                        .or_else(|| provider.get(key))
                        .or_else(|| default.and_then(|m| m.get(key)))
                        .cloned()
                };
                let (Some(api), Some(url)) = (pick("api"), pick("baseUrl")) else {
                    continue;
                };
                let mut model = json!({"id":def["id"],"name":def.get("name").unwrap_or(&def["id"]),"provider":name,"api":api,"baseUrl":url,"reasoning":def.get("reasoning").unwrap_or(&json!(false)),"input":def.get("input").unwrap_or(&json!(["text"])),"cost":def.get("cost").unwrap_or(&json!({"input":0,"output":0,"cacheRead":0,"cacheWrite":0})),"contextWindow":def.get("contextWindow").unwrap_or(&json!(128000)),"maxTokens":def.get("maxTokens").unwrap_or(&json!(16384))});
                if let Some(map) = def.get("thinkingLevelMap") {
                    model["thinkingLevelMap"] = map.clone();
                }
                if provider.get("compat").is_some() || def.get("compat").is_some() {
                    model["compat"] = merge(&provider["compat"], &def["compat"]);
                }
                normalize(&mut model);
                if let Some(index) = models
                    .iter()
                    .position(|m| m["provider"] == *name && m["id"] == def["id"])
                {
                    models[index] = model;
                } else {
                    models.push(model);
                }
            }
        }
        Self {
            models,
            config,
            invalid,
        }
    }
    pub fn find(&self, provider: &str, id: &str) -> Option<&Value> {
        self.models
            .iter()
            .find(|m| m["provider"] == provider && m["id"] == id)
    }
    pub fn is_invalid(&self) -> bool {
        self.invalid
    }
    pub(crate) fn provider_config(&self, provider: &str) -> &Value {
        &self.config["providers"][provider]
    }
    pub(crate) fn model_headers(&self, provider: &str, id: &str) -> Option<&Value> {
        let config = self.provider_config(provider);
        if let Some(model) = config["models"]
            .as_array()
            .and_then(|models| models.iter().rev().find(|m| m["id"] == id))
        {
            return model.get("headers");
        }
        config["modelOverrides"][id].get("headers")
    }
    fn visible(&self, m: &Value) -> bool {
        let v = &self.config["visibility"];
        v["providers"]
            .as_array()
            .is_none_or(|ps| ps.contains(&m["provider"]))
            && v["models"][m["provider"].as_str().unwrap()]
                .as_array()
                .is_none_or(|ids| ids.contains(&m["id"]))
    }
    /// Authenticated provider IDs are supplied by the host, not inferred from credential text.
    pub fn view(&self, providers: &[String], authenticated: &[String]) -> Value {
        let models: Vec<_> = self
            .models
            .iter()
            .filter(|m| providers.is_empty() || providers.iter().any(|p| m["provider"] == *p))
            .collect();
        let available: Vec<_> = models
            .iter()
            .filter(|m| self.visible(m) && authenticated.iter().any(|p| m["provider"] == *p))
            .map(|m| json!([m["provider"], m["id"]]))
            .collect();
        json!({"invalid":self.invalid,"total":self.models.len(),"models":models,"available":available})
    }
}
pub(crate) fn validate_provider(p: &Value) -> Result<(), ()> {
    p.as_object().ok_or(())?;
    validate_fields(p, true)?;
    if let Some(models) = p.get("models") {
        let models = models.as_array().ok_or(())?;
        if models.len() > 4096 {
            return Err(());
        }
        for model in models {
            if model["id"].as_str().is_none_or(str::is_empty) {
                return Err(());
            }
            validate_fields(model, false)?;
            if let Some(cost) = model.get("cost")
                && ["input", "output", "cacheRead", "cacheWrite"]
                    .iter()
                    .any(|key| !cost[key].is_number())
            {
                return Err(());
            }
        }
    }
    if let Some(overrides) = p.get("modelOverrides") {
        for m in overrides.as_object().ok_or(())?.values() {
            validate_fields(m, false)?;
        }
    }
    Ok(())
}
fn validate_fields(v: &Value, provider: bool) -> Result<(), ()> {
    v.as_object().ok_or(())?;
    for key in ["name", "api", "apiKey", "baseUrl"] {
        if let Some(s) = v.get(key)
            && s.as_str().is_none_or(str::is_empty)
        {
            return Err(());
        }
    }
    for key in ["reasoning", "authHeader"] {
        if v.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(());
        }
    }
    for key in ["contextWindow", "maxTokens"] {
        if let Some(n) = v.get(key)
            && n.as_f64().is_none_or(|n| n <= 0.0)
        {
            return Err(());
        }
    }
    if let Some(input) = v.get("input") {
        strings(input)?;
        if input
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s != "text" && s != "image")
        {
            return Err(());
        }
    }
    if let Some(headers) = v.get("headers")
        && headers
            .as_object()
            .ok_or(())?
            .values()
            .any(|v| !v.is_string())
    {
        return Err(());
    }
    if let Some(cost) = v.get("cost")
        && cost.as_object().ok_or(())?.values().any(|n| !n.is_number())
    {
        return Err(());
    }
    if let Some(map) = v.get("thinkingLevelMap")
        && map
            .as_object()
            .ok_or(())?
            .values()
            .any(|s| !s.is_string() && !s.is_null())
    {
        return Err(());
    }
    if let Some(compat) = v.get("compat") {
        compat.as_object().ok_or(())?;
    }
    if !provider
        && v.get("id")
            .is_some_and(|s| s.as_str().is_none_or(str::is_empty))
    {
        return Err(());
    }
    Ok(())
}
