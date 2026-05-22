# OMK Web Bridge Chrome Extension

Manifest V3 companion extension for `omk web-bridge`.

## Install

1. Run `omk web-bridge install-host` for native-host instructions.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select this `templates/web-bridge/chrome-extension` directory.
4. Copy the extension ID and run `omk web-bridge install-host --extension-id <id> --write`.
5. Verify with `omk web-bridge doctor --json`.

## Security defaults

- Uses `activeTab`, `scripting`, and `nativeMessaging` only.
- Does not request cookies, history, bookmarks, downloads, webRequest, or broad host permissions.
- Does not read cookies, passwords, localStorage, sessionStorage, indexedDB, or request headers.
- Browser mutations such as clicking, form fill, downloads, uploads, posting, or navigation are out of scope for v1 and require explicit approval in future profiles.
