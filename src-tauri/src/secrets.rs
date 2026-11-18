/// The only secrets Bulletin stores. The sidecar's `secret.*` methods use the same list (docs/SIDECAR.md, "Secrets").
pub(crate) const SECRET_NAMES: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "AWS_BEARER_TOKEN_BEDROCK",
    "BULLETIN_GITHUB_TOKEN",
];

/// Windows Credential Manager keeps a credential blob of at most 2560 bytes, which is 1280 UTF-16 characters.
const MAX_SECRET_CHARS: usize = 1280;

pub(crate) trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>, &'static str>;
    fn set(&self, name: &str, value: &str) -> Result<(), &'static str>;
}

fn check_name(name: &str) -> Result<(), &'static str> {
    if SECRET_NAMES.contains(&name) {
        Ok(())
    } else {
        Err("Unknown secret name")
    }
}

/// Reads one secret. Only names in `SECRET_NAMES` are accepted.
pub(crate) fn fetch(store: &dyn SecretStore, name: &str) -> Result<Option<String>, &'static str> {
    check_name(name)?;
    store.get(name)
}

/// Stores one secret, after checking the name and the value. Error messages never contain the value.
pub(crate) fn save(store: &dyn SecretStore, name: &str, value: &str) -> Result<(), &'static str> {
    check_name(name)?;
    if value.trim().is_empty() {
        return Err("A secret value cannot be empty");
    }
    if value.contains('\0') {
        return Err("Secret values cannot contain a null character");
    }
    if value.chars().count() > MAX_SECRET_CHARS {
        return Err("Secret value is too long for the system keychain");
    }
    store.set(name, value)
}

/// The stored secrets to pass to the sidecar as environment variables when it is launched. A variable that is
/// already set in Bulletin's own environment wins, and a secret that cannot be read is simply left out.
pub(crate) fn launch_environment(
    store: &dyn SecretStore,
    already_set: impl Fn(&str) -> bool,
) -> Vec<(&'static str, String)> {
    SECRET_NAMES
        .iter()
        .filter(|name| !already_set(name))
        .filter_map(|name| match store.get(name) {
            Ok(Some(value)) if !value.is_empty() => Some((*name, value)),
            _ => None,
        })
        .collect()
}

pub(crate) struct OsSecretStore;

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl OsSecretStore {
    fn entry(name: &str) -> Result<keyring::Entry, &'static str> {
        check_name(name)?;
        keyring::Entry::new("app.bulletin.desktop", name)
            .map_err(|_| "Could not open the system keychain")
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl SecretStore for OsSecretStore {
    fn get(&self, name: &str) -> Result<Option<String>, &'static str> {
        match Self::entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read the system keychain"),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), &'static str> {
        Self::entry(name)?
            .set_password(value)
            .map_err(|_| "Could not write the system keychain")
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl SecretStore for OsSecretStore {
    fn get(&self, _name: &str) -> Result<Option<String>, &'static str> {
        Err("The system keychain is unavailable on this platform")
    }

    fn set(&self, _name: &str, _value: &str) -> Result<(), &'static str> {
        Err("The system keychain is unavailable on this platform")
    }
}

#[cfg(test)]
mod tests;
