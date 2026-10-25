# Paseo Sol + DeepSeek kit

Sol이 작업을 이해·계획·분할하고, DeepSeek가 조사·구현·테스트·자체 수정을 수행한 뒤, 처음 Sol 대화에서 최종 검토하는 운영 지침이다. 기본 워커는 하나이며, 독립된 범위에는 병렬 워커를 사용할 수 있다. 별도 리뷰 워커는 기본으로 추가하지 않는다.

이 저장소는 스킬·프로필·설치 도구를 배포한다. 자동 실행 제어기, 제공자 인증, 계측 플러그인과 실험 원시 로그는 포함하지 않는다. 다른 PC에서도 같은 역할과 절차를 사용할 수 있지만, 도구·모델 접근 권한과 실제 사용량은 환경별로 확인해야 한다.

## 준비

- Node.js 22 이상, Git, 설치·초기화된 Paseo.
- Paseo에서 사용할 수 있는 Codex와 OpenCode 제공자, 두 프로필의 정확한 모델과 모드.
- Sol이 접근할 수 있는 Paseo 에이전트 관리 도구와 완료 알림.
- 워커의 웹 조사가 필요하면 실제 검색·열람 도구 또는 범위에 맞는 조사 수단.

| 역할 | 프로필 | 모델 | 모드 | 추론 |
| --- | --- | --- | --- | --- |
| 계획·위임·최종 수락 | sol61-orchestrator | codex/gpt-6.1-sol | auto-review | high |
| 조사·구현·테스트·자체 수정 | deepseek41-worker | opencode/merge-gateway/deepseek/deepseek-v4.1-flash | build | max |

모델을 사용할 수 없는 환경에서는 임의 대체하지 않는다. 필요한 접근 권한을 먼저 준비한다. 프로필 선택은 역할 지침을 자동 주입하지 않으므로 스킬도 호출해야 한다.

## 설치

이 저장소를 clone하거나 ZIP으로 내려받고 해당 폴더에서 실행한다. 패키지 의존성 설치는 필요 없다.

```sh
node scripts/install.mjs
```

기본은 미리보기이며 아무 파일도 쓰지 않는다. 기본 스킬 경로는 `~/.agents/skills`, Paseo 설정은 `$PASEO_HOME/config.json` 또는 `~/.paseo/config.json`이다. 사용자 스킬 검색 경로는 [공식 문서](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)를 기준으로 한다. 기존 환경에서 `~/.codex/skills` 등 다른 경로를 사용하면 `--skill-root`로 해당 경로를 명시하고 중복 설치를 피한다.

준비 결과를 확인한 뒤 적용한다.

```sh
node scripts/install.mjs --apply
paseo reload --json
```

설치 도구는 배포 스킬 파일과 정확히 두 프로필만 갱신한다. 다른 프로필·호스트 지침·인증 설정 및 배포본에 없는 개인 스킬 파일은 보존하고 변경 전 파일을 같은 폴더에 백업한다. Paseo를 자동 재시작하거나 제공자 인증을 수행하지 않는다. 기존 스킬 내용이 다르면 기본적으로 중단한다. 기존 내용을 검토한 후 교체하려면 `--replace-skill`을 추가한다.

경로가 다른 환경에서는 다음처럼 지정한다. 실제 경로를 넣는다.

```sh
node scripts/install.mjs --skill-root /path/to/skills --config /path/to/paseo/config.json
node scripts/install.mjs --skill-root /path/to/skills --config /path/to/paseo/config.json --apply --replace-skill
```

Paseo 설정을 직접 관리하려면 스킬만 설치하고 [profiles.json](profiles.json)의 두 프로필을 Paseo에 별도로 등록한다.

```sh
node scripts/install.mjs --skill-only --apply
```

`--skill-root`는 `paseo-sol-deepseek` 폴더가 들어갈 상위 디렉터리다. 다른 호스트에서 조율한다면 Sol이 실제 실행되는 호스트에 설치한다. DeepSeek 워커는 작업 계약으로 관련 지침을 전달받으므로 스킬을 따로 설치할 필요는 없다.

## 사용

`sol61-orchestrator` 프로필로 Sol을 시작한 뒤 요청한다.

```text
$paseo-sol-deepseek [실제 작업]
```

계획과 최종 검토는 같은 Sol 대화에서 진행한다. 스킬이 나타나지 않으면 새 세션을 열고 설치 경로를 확인한다. 기존 같은 이름 스킬과 중복되지 않았는지도 확인한다.

일반 흐름은 **Sol 계획 → DeepSeek 조사·구현·검증 → 같은 Sol 최종 검토**다. 정상 진행 중 Sol의 주기적 폴링은 하지 않는다. 수정이 필요하면 같은 워커에 기본 한 차례 후속 수정을 맡기고 재검토한다. 실패나 근거 부족을 성공으로 처리하지 않는다.

작업 분할은 에이전트 수와 다르다. 독립된 소스 범위나 조사 질문은 여러 워커에 병렬로 맡길 수 있다. 같은 파일을 경쟁 수정하거나 조사 결론에 의존하는 구현을 성급하게 병렬화하지 않는다. 필요한 경우 worktree로 격리하고 Sol이 통합 책임을 갖는다.

큰 코드·문서 조사, 출처 수집, 대안 비교에는 조사 전용 워커를 먼저 또는 병렬로 사용한다. Sol은 조사 목표·판단 기준을 정하고 결과를 검토한다. 같은 `deepseek41-worker` 프로필로 조사 세션과 구현 세션을 각각 만들 수 있다. 조사 전용 계약에는 편집 금지와 실제 사용 가능한 도구를 명시하되, 지시문만으로 읽기 전용 권한이 강제된다고 간주하지 않는다. [조사 워커 지침](skills/paseo-sol-deepseek/references/research.md), [운영 스킬](skills/paseo-sol-deepseek/SKILL.md), [계약 양식](templates/task-contract.md)을 참고한다.

## 검증과 한계

```sh
node --test
```

설치 동작 검사는 임시 폴더에서 실행하며 실제 사용자 설정과 모델을 사용하지 않는다. Windows에서 검사했고, macOS/Linux 실기 검증은 별도로 필요하다. 토큰·비용 절감이나 실제 에이전트 협업 성공을 설치 검사만으로 보장하지 않는다. 과거 비교의 범위와 한계는 [검증 근거](docs/evidence.md)에 기록했다.

업데이트는 새 버전을 내려받고 설치 미리보기부터 다시 실행한다. 롤백하려면 작업을 멈춘 뒤 생성된 백업을 검토해 원래 경로로 복원하고 Paseo 설정을 다시 로드한다. 개인 백업·인증 파일은 이 저장소에 커밋하지 않는다.
