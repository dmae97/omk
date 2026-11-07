# Kimi Code 로그인 404 디버깅과 수정 (2026-10-28)

## 1. 증상

`omk`에서 Kimi Code(Moonshot AI) 로그인 시:

```text
Error: Failed to login to Kimi Code (Moonshot AI):
Kimi device authorization failed: 404 <html><head><title>404 Not Found</title></head>...
<center><h1>404 Not Found</h1></center><hr><center>nginx</center>
```

기존 코드 경로: `packages/ai/src/utils/oauth/kimi.ts`가 `POST https://auth.kimi.com/oauth2/device/code`를 호출했다.

## 2. 조사

`auth.kimi.com`은 살아 있지만 `/`, `/health`, `/oauth2/*` 전부 nginx 404다. 호스트 폐기가 아니라 경로 이동으로 판단하고 표면을 넓혔다.

| 경로 | 결과 |
| --- | --- |
| `POST /oauth2/device/code` (기존) | 404 nginx |
| `POST /oauth2/device_authorization` | 404 nginx |
| `POST /api/oauth/device/code` | 404 page not found (Go mux) |
| `POST /api/oauth/token` | 400 `unsupported_grant_type` (엔드포인트 존재) |
| `POST /api/oauth/device_authorization` | **200**, `device_code` + `user_code` + `verification_uri` 발급 |

`/api/...` 404는 nginx가 아니라 Go `http.NotFound` 문구라서, 실제 서비스가 `/api/oauth/*`에 있음을 알 수 있었다.

## 3. scope 문제

경로만 바꾸면 되는 줄 알았지만, `scope`를 붙이면 거부된다.

| scope | 결과 |
| --- | --- |
| (없음) | 200 |
| `openid` | 400 `invalid_scope` |
| `openid profile` | 400 `invalid_scope` |
| `openid profile email` | 400 `invalid_scope` |
| `offline_access` | 400 `invalid_scope` |
| `openid offline_access` | 400 `invalid_scope` |

기존 코드의 `scope: "openid profile email offline_access"`를 그대로 두고 경로만 고쳤다면 두 번째 400을 만났을 것이다.

## 4. 확정 계약 (실서버 응답)

```text
POST https://auth.kimi.com/api/oauth/device_authorization
  client_id=<...>, device_id=<uuid>, device_model=<os release arch>   (scope 없음)
-> 200 {"device_code":"...","user_code":"7BK6-8IQC",
        "verification_uri":"https://www.kimi.com/code/authorize_device",
        "verification_uri_complete":"https://www.kimi.com/code/authorize_device?user_code=7BK6-8IQC",
        "expires_in":1800,"interval":5}

POST https://auth.kimi.com/api/oauth/token
  grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=<...>&device_code=<...>
-> 400 {"error":"authorization_pending"}   (승인 전 정상 상태)
```

`authorization_pending`은 기존 `pollKimiToken()`이 이미 처리하던 값이라 폴링 로직은 그대로 쓸 수 있었다.

## 5. 수정

`packages/ai/src/utils/oauth/kimi.ts` (+37/-11):

- `DEVICE_AUTHORIZATION_PATH = "/api/oauth/device_authorization"`, `TOKEN_PATH = "/api/oauth/token"` 상수 추가. 이동 이유를 주석으로 남겼다.
- 기기 인증 요청에서 `scope` 제거. 서버가 모든 scope를 거부한다는 사실을 주석으로 기록.
- `verification_uri_complete` 우선, 없으면 `verification_uri`, 둘 다 없으면 `${host}/code/authorize_device?user_code=...` 폴백.
- `parseTokenResponse()` 추가: 토큰 응답이 HTML이면 `SyntaxError: Unexpected token '<'` 대신 상태 코드와 본문 앞부분을 담은 오류를 던진다.
- 미사용 `_sleep` 제거 (같은 파일에서 린트가 잡던 죽은 코드).

`packages/ai/test/kimi-oauth.test.ts` (신규, 4 tests):

- 실서버 계약대로 `/api/oauth/device_authorization`에 POST하고 `scope`를 보내지 않는다.
- 404 HTML 응답이 `Kimi device authorization failed: 404`로 읽힌다.
- 토큰 응답이 HTML이면 `Kimi token polling failed: 502`로 읽힌다.
- refresh가 같은 `/api/oauth/token`을 쓴다.

## 6. 검증

| 명령 | 결과 |
| --- | --- |
| `npx vitest run packages/ai/test/kimi-oauth.test.ts` | 4 tests passed |
| `npx vitest run packages/ai/test/oauth` | 5 files, 29 tests passed |
| `npx biome check <두 파일>` | No fixes applied |
| `diagnostics` (kimi.ts) | No diagnostics |
| 실서버 device authorization (코드와 동일 body) | 200, `user_code` 발급 |
| 실서버 token 1회 폴링 | 400 `authorization_pending` (예상 상태) |

## 7. 남은 단계

- 설치된 엔진(`~/.omk/agent/lib/omk-canonical-launcher.cjs` 경유)은 1.5.10 빌드라 이 수정이 아직 들어가지 않았다. 재빌드 또는 업데이트 전까지 로그인은 같은 404를 낸다.
- 즉시 로그인하려면 둘 중 하나:
  1. 로컬 빌드 후 재설치 (예: `npm run build:binary`, 또는 `omk update self` 계열 명령으로 새 빌드 반영).
  2. 수동 device flow: 위 device authorization으로 받은 `verification_uri_complete`를 열어 승인한 뒤, `/api/oauth/token`으로 access/refresh 토큰을 받아 `~/.omk/agent/auth.json`의 `kimi-code` 항목에 저장. 자격증명을 쓰는 작업이므로 사용자 승인 후에만 수행한다.
- 참고: `kimi-coding`(API key) provider는 별개이며 이미 동작한다. OAuth 경로는 `kimi-code` 항목이다.
