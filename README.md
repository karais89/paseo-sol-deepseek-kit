# Paseo Sol + DeepSeek kit

이 브랜치는 Sol의 불필요한 도구 호출을 줄이는 실험 실행기를 포함한다. 호스트 실행기가 DeepSeek 워커의 준비·완료 대기·독립 검증을 처리하고, 실행 도구가 없는 전용 Sol 검토기가 승인·수정 요청·실패를 판단한다. 수정은 같은 워커에 한 번만 전달한다.

스킬·프로필·설치 도구·호스트 실행기를 배포한다. 인증과 실험 원시 로그는 포함하지 않는다. 전용 검토기의 도구 제한은 일반 Paseo 대화를 제한하지 않는다. 전체 경로 실험은 기능 검사를 통과했지만 Sol 30회·1,009,722토큰으로 절감에 실패했다. 워커 입력 사용량도 누락돼 팀 총량은 미완전하다. [실험 기록](docs/gated-experiment.md)을 확인하고 비용 절감용 기본 배포로 취급하지 않는다.

## 다른 컴퓨터의 LLM에게 설치 맡기기

아래 요청을 해당 컴퓨터에서 실행되는 코딩 에이전트에게 전달한다. 비공개 저장소에 접근할 수 있는 GitHub 계정이 필요하다.

```text
https://github.com/karais89/paseo-sol-deepseek-kit 저장소의
docs/LLM_INSTALL.md를 읽고 이 컴퓨터에 설치해줘.
Sol 6.1은 high, DeepSeek V4.1 Flash는 max로 설정하고,
기존의 다른 스킬·프로필·인증 설정은 보존해줘.
미리보기, 설치, Paseo reload와 설치 검증까지 진행하고
설치 경로·커밋·백업·미확인 항목을 보고해줘.
```

실행 절차와 완료 기준은 [LLM 설치 가이드](docs/LLM_INSTALL.md)에 있다. 로컬로 복제한 뒤 이 파일 경로를 직접 전달해도 된다.

## 준비

- Node.js 22 이상, Git, 설치·초기화된 Paseo.
- 제한 실행 경로는 Python 3.11 이상, POSIX 로컬 호스트와 검사된 native Codex CLI가 필요하다. 현재 도구 목록 검사는 macOS의 `codex-cli 0.162.1` 바이너리 해시에 묶여 있다. 다른 바이너리에서는 워커 생성 전에 중단하며, 이 브랜치를 범용 배포 완료로 취급하지 않는다.
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

작업 계약에 필수 검사 명령과 보호 경로가 명시돼 있으면 스킬의 제한 실행기를 사용한다. 호스트 실행기와 같은 전용 검토 스레드를 끝까지 유지한다. 스킬이 나타나지 않으면 새 세션을 열고 설치 경로를 확인한다.

제한 경로는 **실행기 준비·위임 → DeepSeek 구현·검증 → 도구 없는 Sol 검토 → 필요하면 같은 워커 수정 → 같은 Sol 재검토**다. 준비·대기·검증은 하나의 대기 중 도구 실행에서 처리한다. 기존 일반 Sol 대화 방식은 사용자가 선택할 때 [inline 방식](skills/paseo-sol-deepseek/references/inline-flow.md) 또는 [알림 방식](skills/paseo-sol-deepseek/references/notification-flow.md)으로 사용하며, 제한 경로 실패 시 자동 전환하지 않는다.

추가 조사나 병렬 작업은 해당 작업에서 허용된 경우에만 별도로 사용한다. 제한 실행기는 기본 워커 하나와 검토 스레드 하나를 사용한다.

큰 코드·문서 조사, 출처 수집, 대안 비교에는 조사 전용 워커를 먼저 또는 병렬로 사용한다. Sol은 조사 목표·판단 기준을 정하고 결과를 검토한다. 같은 `deepseek41-worker` 프로필로 조사 세션과 구현 세션을 각각 만들 수 있다. 조사 전용 계약에는 편집 금지와 실제 사용 가능한 도구를 명시하되, 지시문만으로 읽기 전용 권한이 강제된다고 간주하지 않는다. [조사 워커 지침](skills/paseo-sol-deepseek/references/research.md), [운영 스킬](skills/paseo-sol-deepseek/SKILL.md), [계약 양식](templates/task-contract.md)을 참고한다.

## 검증과 한계

```sh
node --test
PYTHONDONTWRITEBYTECODE=1 python3 test/sol-judge.test.py
PYTHONDONTWRITEBYTECODE=1 python3 test/review-after-worker.test.py
PYTHONDONTWRITEBYTECODE=1 python3 test/team-context.test.py
```

오프라인 검사는 임시 폴더와 가짜 실행 응답을 사용한다. macOS의 직접 실행 1회와 새 시작 대화를 포함한 전체 경로 1회를 측정했다. 후자는 사용자 승인 뒤 재개한 실행이며 전체 절감에 실패했다. Windows/Linux의 제한 실행은 검증하지 않았다. 과거 운영안의 비교는 [검증 근거](docs/evidence.md), 새 실행기의 결과는 [실험 기록](docs/gated-experiment.md)을 참고한다.

업데이트는 새 버전을 내려받고 설치 미리보기부터 다시 실행한다. 롤백하려면 작업을 멈춘 뒤 생성된 백업을 검토해 원래 경로로 복원하고 Paseo 설정을 다시 로드한다. 개인 백업·인증 파일은 이 저장소에 커밋하지 않는다.
