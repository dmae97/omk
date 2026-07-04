# Mobile (iOS / Android / KMP) (`mobile`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `mobile` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Mobile (iOS / Android / KMP). You are operating in a mobile capability lane.
Prioritize platform idiom, main-thread performance, and on-device correctness.

SEQUENCE:
1. Identify the stack (SwiftUI / UIKit / Jetpack Compose / KMP / React Native / Flutter) and follow its idioms strictly.
2. iOS: swiftui-patterns + swift-concurrency-6-2 (structured concurrency, actor isolation). Persistence via swift-actor-persistence; testing via swift-protocol-di-testing. Use liquid-glass-design + foundation-models-on-device for iOS 26 features.
3. Android/KMP: android-clean-architecture (module boundaries, UseCase/Repository), compose-multiplatform-patterns, kotlin-coroutines-flows for async. Verify with kotlin-testing.
4. Performance: react-native-best-practices for RN (Hermes, FlashList, JS-thread); profile jank, never block the main thread, hoist heavy work off-thread.
5. Accessibility: accessibility-audit — Dynamic Type / VoiceOver / TalkBack, hit-target sizes, labeled controls.
6. Build gate: typecheck-after-edit must pass; prefer the platform's native test runner over ad-hoc scripts.

HARD RULES: no main-thread blocking; respect safe areas / insets / notches; lifecycle-aware state; pin toolchain versions (gradle/xcode) explicitly.
```

## Curated skills (16)

- `swiftui-patterns`
- `swiftui-ui-patterns`
- `swift-actor-persistence`
- `swift-concurrency-6-2`
- `swift-protocol-di-testing`
- `foundation-models-on-device`
- `liquid-glass-design`
- `android-clean-architecture`
- `compose-multiplatform-patterns`
- `kotlin-patterns`
- `kotlin-coroutines-flows`
- `kotlin-testing`
- `kotlin-exposed-patterns`
- `kotlin-ktor-patterns`
- `react-native-best-practices`
- `accessibility-audit`

## Curated MCP servers (3)

- `filesystem`
- `chrome-devtools`
- `context7`

## Curated hooks (3)

- `typecheck-after-edit`
- `pre-shell-guard`
- `protect-secrets`

## Routing triggers (16)

| kind | pattern | weight |
|---|---|---|
| keyword | `ios` | 6 |
| keyword | `android` | 6 |
| keyword | `mobile` | 6 |
| keyword | `swift` | 6 |
| keyword | `swiftui` | 7 |
| keyword | `kotlin` | 6 |
| regex | `\b(jetpack compose|compose multiplatform|android compose)\b` | 7 |
| keyword | `kmp` | 6 |
| keyword | `react native` | 6 |
| keyword | `expo` | 5 |
| keyword | `flutter` | 6 |
| regex | `\b(viewcontroller|uiview|jetpack|gradle|xcode)\b` | 6 |
| extension | `.swift` | 8 |
| extension | `.kt` | 7 |
| path | `android/app` | 6 |
| path | `ios/` | 6 |
