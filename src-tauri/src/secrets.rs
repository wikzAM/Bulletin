pub(crate) trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>, &'static str>;
    fn set(&self, name: &str, value: &str) -> Result<(), &'static str>;
}

pub(crate) struct OsSecretStore;

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl OsSecretStore {
    fn entry(name: &str) -> Result<keyring::Entry, &'static str> {
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err("Invalid secret name");
        }
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
        if value.as_bytes().contains(&0) {
            return Err("Secret values cannot contain a null character");
        }
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
