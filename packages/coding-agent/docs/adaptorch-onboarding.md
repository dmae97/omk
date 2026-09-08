# OMK / WPL → AdaptOrch 안내

AdaptOrch는 OMK와 별개의 선택적 서비스입니다. OMK와 MIT 라이선스의
`omk-adaptorch-wpl` 사용에 가입이나 유료 플랜은 필요하지 않습니다.
이 경로는 웹사이트 방문을 돕는 CRM 유입 경로이며, 계정 생성이나 리드 저장을
대신 수행하는 CRM 클라이언트가 아닙니다.

## CLI에서 시작

```bash
omk doctor adaptorch --links
omk doctor adaptorch --links --json
```

`--links`는 API 키 없이 작동합니다. 환경의 API 키나 API URL을 읽거나 검증하지
않으며, HTTP 요청·브라우저 열기·파일 저장·run 제출을 하지 않습니다.
JSON 출력의 `mode: "links"`, `networkAccess: false`, `accountRequired: false`는
이 **로컬 안내 명령**의 상태입니다. 웹사이트의 요금이나 가입 조건을 뜻하지 않습니다.

| 행동 | 목적지 | 용도 |
| --- | --- | --- |
| Plans / local Starter | `https://adaptorch.com/#pricing` | 로컬 평가와 호스티드 플랜 비교 |
| Sign up | `https://adaptorch.com/app/signup` | 사용자가 직접 가입 |
| Team / private-runner contact | `https://adaptorch.com/#bookDemo` | 팀·사설 러너 상담 |
| Claim boundary | `https://adaptorch.com/claim-boundary` | 검증 범위와 한계 확인 |

실제 출력 URL에는 아래의 고정 UTM 태그가 붙습니다. 사용자가 링크를 열면 해당
태그가 웹사이트로 전달됩니다. OMK 자체는 클릭을 관찰하거나 추적 요청을 보내지 않습니다.

계정을 만든 뒤 API 연결을 확인하려면 키를 안전하게 설정하고 별도로 실행합니다.

```bash
omk doctor adaptorch
omk doctor adaptorch --json
```

이 명령은 설정된 API의 `GET /v1/whoami`에 인증 요청을 보냅니다.
종료 코드 `0`은 API 인증 성공, `1`은 미설정, `2`는 잘못된 설정이나 연결 실패입니다.
인증 성공은 코드 검증, WPL 자동 실행, 배포 승인을 뜻하지 않습니다.
`--links`의 성공 종료 코드는 API 연결 여부와 무관합니다.

## WPL 소비자에서 사용

```typescript
import { getAdaptOrchLinks } from "omk-adaptorch-wpl";

const links = getAdaptOrchLinks(); // 기본 표면: wpl
// 사용자가 요청한 도움말이나 별도 제품 안내 화면에서 렌더링합니다.
console.log(links.plans, links.signup, links.contact, links.claimBoundary);
```

`getAdaptOrchLinks("doctor")`는 CLI 유입용입니다. 함수는 매번 독립적인 링크 객체를
반환하고 네트워크·환경 변수·사용자 파일에 접근하지 않습니다.
링크를 판정 카드의 `next_actions`나 서명된 receipt에 삽입하지 마세요.
가입·결제 여부는 `canApply`, `shouldSubmit`, 사람 검토 요구를 바꾸지 않습니다.

## CRM 유입 구분과 개인정보 경계

- `utm_source=omk`
- `utm_campaign=omk-adaptorch-wpl`
- CLI: `utm_medium=cli`, `utm_content=doctor-{action}`
- WPL: `utm_medium=library`, `utm_content=wpl-{action}`
- `{action}`: `plans`, `signup`, `contact`, `claim-boundary`

허용된 값만 사용합니다. 이메일, API 키, 프롬프트, diff, 저장소 경로, 세션 ID,
run ID를 URL에 추가하지 않습니다. 가격은 코드에 고정하지 않고 웹사이트가 소유합니다.

사이트 운영 측에서는 사용자 동의와 개인정보 처리 정책에 따라 UTM 보존,
가입 완료·상담 제출·활성화 이벤트를 연결해야 합니다. 이 변경은 해당 서버의
CRM 저장, 이메일 발송, 결제, 전환율을 구현하거나 검증하지 않습니다.
단순 링크 생성 횟수를 방문자 수나 가입 전환으로 집계하면 안 됩니다.

## 검증과 관련 문서

- `test/adaptorch-onboarding.test.ts`: 키 미접근, HTTP 미호출, 옵션 순서, JSON 계약
- `test/adaptorch-doctor-cli.test.ts`: 기존 연결 검사와 종료 코드 회귀
- `packages/adaptorch-wpl/test/service-links.test.ts`: 공개 export, 고정 목적지·UTM, 임의 입력 거부
- [Correctness Wall](correctness-wall.md): 적용·제출 게이트
- [AdaptOrch Preview](adaptorch-preview.md): 계획과 실제 실행 구분
- [하네스 개선 우선순위](harness-improvements.md): 이번 점검 범위와 후속 과제
