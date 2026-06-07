# OMK Codex 인증 가이드

OMK는 Codex 로그인을 직접 보관하거나 토큰 파일을 출력하지 않습니다. Codex 인증은 공식 Codex CLI가 관리하고, OMK는 상태 확인과 안전한 MCP 설정 가져오기만 제공합니다.

## 권장 흐름

1. 공식 Codex CLI 설치/확인
   ```bash
   codex --version
   ```
2. 공식 로그인 실행
   ```bash
   codex login
   ```
3. OMK에서 인증 안내/상태 확인
   ```bash
   omk codex auth --choice plus-pro
   omk provider doctor codex --soft
   ```
4. Codex MCP 서버 설정만 프로젝트로 가져오기
   ```bash
   omk mcp import-codex
   ```

## 저장소 정책

- OMK의 프로젝트 설정 표준 위치는 `.omk/`입니다.
- Codex CLI 고유 설정은 공식 CLI의 홈 설정을 따릅니다. OMK는 OAuth 토큰 값을 읽거나 출력하지 않습니다.
- 프로젝트 로컬 MCP 설정은 `.kimi/mcp.json` 또는 `.omk/mcp.json`에 저장되며, secret-bearing `headers`, `env`, bearer 값은 가져오지 않습니다.
- 인증 확인을 위해 토큰 파일을 `cat` 하거나 로그에 남기지 마세요.

## OpenAI Platform API 키와의 구분

Codex/ChatGPT 로그인은 Codex CLI 세션을 위한 인증입니다. `omk image generate/edit` 같은 OpenAI Platform API 기능에는 별도의 프로젝트 API 키가 필요합니다.

```bash
omk openai setup
```

API 키는 프로젝트 파일에 직접 저장하지 말고 환경 변수나 사용자 로컬 secret store를 사용하세요.

## 문제 해결

- `codex` 명령을 찾을 수 없으면 PATH에 공식 Codex CLI를 추가하세요.
- 로그인 상태가 불명확하면 `codex login`을 다시 실행한 뒤 `omk provider doctor codex --soft`를 실행하세요.
- MCP 가져오기 결과가 비어 있으면 Codex CLI 설정에 import 가능한 MCP 서버가 있는지 확인하세요.

## 보안 원칙

- 토큰/세션 파일을 출력하지 않습니다.
- OMK는 Codex OAuth 값을 OpenAI API bearer 키로 재사용하지 않습니다.
- 공유 환경에서는 provider별 인증과 프로젝트 설정을 분리하세요.
