#![allow(clippy::missing_const_for_fn)]

use crate::error;
use std::{mem::MaybeUninit, path::PathBuf};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

//
// Non-Unix implementation
//

pub(crate) fn get_user_home_dir(username: &str) -> Option<PathBuf> {
    homedir::home(username).unwrap_or_default()
}

pub(crate) fn get_current_user_home_dir() -> Option<PathBuf> {
    homedir::my_home().unwrap_or_default()
}

pub(crate) fn is_root() -> bool {
    static IS_ROOT: OnceCell<bool> = OnceCell::new();
    IS_ROOT.get_or_init(|| {
        // SAFETY: Windows APIs are called with valid handles and buffers.
        unsafe {
            let mut elevation = MaybeUninit::<TOKEN_ELEVATION>::zeroed();
            let mut return_length = 0u32;
            let status = GetTokenInformation(
                (!3 as HANDLE), // GetCurrentProcessToken(),
                TokenElevation,
                elevation.as_mut_ptr().cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut return_length,
            );
            if status == 0 {
                return false;
            }
            elevation.assume_init().TokenIsElevated != 0
        }
    })
}

pub(crate) fn get_current_uid() -> Result<u32, error::Error> {
    Err(error::ErrorKind::NotSupportedOnThisPlatform("getting current uid").into())
}

pub(crate) fn get_current_gid() -> Result<u32, error::Error> {
    Err(error::ErrorKind::NotSupportedOnThisPlatform("getting current gid").into())
}

pub(crate) fn get_effective_uid() -> Result<u32, error::Error> {
    Err(error::ErrorKind::NotSupportedOnThisPlatform("getting effective uid").into())
}

pub(crate) fn get_effective_gid() -> Result<u32, error::Error> {
    Err(error::ErrorKind::NotSupportedOnThisPlatform("getting effective gid").into())
}

pub(crate) fn get_current_username() -> Result<String, error::Error> {
    let username = whoami::fallible::username()?;
    Ok(username)
}

#[allow(clippy::unnecessary_wraps)]
pub(crate) fn get_user_group_ids() -> Result<Vec<u32>, error::Error> {
    // TODO: implement some version of this for Windows
    Ok(vec![])
}

#[expect(clippy::unnecessary_wraps)]
pub(crate) fn get_all_users() -> Result<Vec<String>, error::Error> {
    // TODO: implement some version of this for Windows
    Ok(vec![])
}

#[expect(clippy::unnecessary_wraps)]
pub(crate) fn get_all_groups() -> Result<Vec<String>, error::Error> {
    // TODO: implement some version of this for Windows
    Ok(vec![])
}
