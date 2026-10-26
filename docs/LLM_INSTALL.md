# 다른 컴퓨터의 LLM을 위한 설치 가이드

이 문서는 사용자를 대신해 이 저장소의 스킬과 Paseo 프로필을 설치하는 코딩 에이전트용이다. 명령을 설명하는 데 그치지 말고, 허용된 환경에서 점검·설치·검증을 수행하고 실제 결과를 보고한다. 사용자의 대상 컴퓨터·호스트·설치 위치 지시를 우선한다.

## 설치할 구성

저장소: `https://github.com/karais89/paseo-sol-deepseek-kit` — 비공개이므로 접근 권한이 필요하다.

| 구성 | 설치 결과 |
| --- | --- |
| Sol 프로필 | `sol61-orchestrator`: `codex/gpt-6.1-sol`, `auto-review`, 추론 `high`, `service_tier=default`, `plan_mode=false` |
| DeepSeek 프로필 | `deepseek41-worker`: `opencode/merge-gateway/deepseek/deepseek-v4.1-flash`, `build`, 추론 `max`, `auto_accept=false` |
| 스킬 | `paseo-sol-deepseek`와 그 아래 `references/research.md` |
| 운영 흐름 | Sol 계획·분할 → 필요하면 조사 워커 → DeepSeek 구현·검증 → 같은 Sol 대화의 최종 리뷰 |

설정의 정확한 원본은 [profiles.json](../profiles.json)과 [스킬 폴더](../skills/paseo-sol-deepseek/SKILL.md)다. 두 프로필 이외의 설정·스킬·인증·기존 작업물은 보존한다. 이 설치를 이유로 다른 프로필이나 lean 프로필을 삭제하지 않는다. 토큰 절감 실험이나 실제 개발 작업을 자동으로 시작하지 않는다.

## 1. 환경과 설치 대상 확인

다음 항목을 필요한 범위만 확인한다. 설정 파일 전체나 인증 값을 출력하지 않는다.

- OS, 현재 작업 위치, `node --version`, `git --version`.
- Node.js 22 이상과 설치·초기화된 Paseo. `paseo`가 PATH에 없으면 앱에 포함된 실제 CLI 경로를 찾는다.
- Sol이 실제 실행되는 호스트와 사용자 계정. 다른 컴퓨터에서 접속 중이라면 파일과 경로는 대상 호스트 기준이다.
- 현재 Paseo 설정 경로, 사용자 스킬 검색 경로, 같은 이름 스킬의 존재 여부.

기본 경로는 아래와 같다. 실제 환경의 설정·스킬 목록을 확인하고 기존 사용자 설정을 우선한다.

| 항목 | 기본 경로 | 조정 방법 |
| --- | --- | --- |
| 사용자 스킬 상위 폴더 | `~/.agents/skills` | 설치 도구의 `--skill-root` |
| Paseo 설정 파일 | `$PASEO_HOME/config.json`, 미설정이면 `~/.paseo/config.json` | 설치 도구의 `--config` |

기존 호스트가 `~/.codex/skills` 또는 별도 경로에서 스킬을 읽는다면 그 경로를 사용한다. `$CODEX_HOME`만 보고 현재 검색 경로를 단정하지 않는다. 같은 이름 스킬을 여러 검색 경로에 중복 설치하지 않는다. `--skill-root`에는 `paseo-sol-deepseek`를 포함하지 않은 상위 폴더를 준다. 현재 검색 경로의 근거는 [공식 문서](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)와 해당 호스트의 실제 스킬 목록으로 확인한다.

도구가 없다면 설치 상태를 보고한다. 요청과 실행 환경에서 허용된 일반 설치는 진행할 수 있지만, 인증 정보 입력·브라우저 로그인·조직 접근 권한은 사용자가 처리해야 한다. 모델·모드·추론 옵션을 임의로 대체하거나 권한을 완화해서 설치를 완성하지 않는다.

## 2. 저장소 가져오기

사용자가 지정한 작업 위치에 복제한다. 기존 폴더가 있으면 저장소와 수정 상태를 먼저 확인하고 덮어쓰지 않는다.

```sh
git clone https://github.com/karais89/paseo-sol-deepseek-kit.git
cd paseo-sol-deepseek-kit
git rev-parse HEAD
```

GitHub CLI를 사용할 수 있다면 `gh repo clone karais89/paseo-sol-deepseek-kit`도 가능하다. 기존 체크아웃은 원격 주소·브랜치·수정 상태를 확인한 뒤, 정리된 올바른 브랜치에서만 `git pull --ff-only`로 갱신한다. 사용자 변경을 stash/reset/delete해서 업데이트하지 않는다. 버전이나 커밋을 지정받았다면 그 버전을 사용하고 설치한 커밋을 기록한다.

비공개 저장소 접근이 실패하면 계정과 접근 권한을 확인한다. Windows의 제한된 실행 환경에서 `gh auth status`가 실패하더라도 바로 인증 만료로 단정하지 않는다. 허용된 실행 범위에서 OS 자격 증명 저장소 접근 여부를 먼저 확인한다. 실제 재인증이 필요하면 사용자가 `gh auth login -h github.com`으로 로그인하도록 안내한다. 비밀번호나 토큰을 대화·파일에 전달하도록 요구하지 않는다.

## 3. 사전 검사와 미리보기

저장소의 [README](../README.md), [설치 도구](../scripts/install.mjs), [프로필](../profiles.json)을 읽는다. npm 의존성 설치는 필요 없다.

```sh
node --test
node scripts/install.mjs
```

사용자 지정 경로가 필요하면 미리보기와 실제 설치에 같은 인자를 사용한다. 아래 경로는 실제 절대 경로로 바꾼다.

```sh
node scripts/install.mjs --skill-root /actual/skills --config /actual/paseo/config.json
```

공백이 있는 경로는 해당 셸의 규칙에 맞춰 인용한다. PowerShell에서는 예를 들어 `--skill-root 'D:/Agent Tools/skills'`처럼 전달할 수 있다.

미리보기의 `changes`, `replacementRequired`, `updatedProfileIds`를 확인한다. 기본 미리보기는 파일을 쓰지 않는다. 전체 구성 설치에는 초기화된 Paseo 설정이 필요하므로 없는 설정 파일을 임의의 빈 JSON으로 만들지 않는다.

Paseo MCP가 연결돼 있으면 `list_providers`, `inspect_provider` 등으로 제공자와 모드를 확인한다. 모델별 추론 옵션을 확인할 때는 결과에서 해당 모델만 추려 출력한다. 필요한 정확한 모델에 Sol `high`와 DeepSeek `max`가 제공되는지 확인한다. 단순히 프로필을 저장한 것으로 모델 접근까지 검증됐다고 하지 않는다.

## 4. 적용과 설정 다시 로드

사용자가 요청한 이 스킬·두 프로필 설치 범위에서 진행한다. 다시 일반적인 설치 승인을 묻지 말고 실행 환경의 승인 규칙을 따른다.

```sh
node scripts/install.mjs --apply
paseo reload --json
```

경로를 명시했다면 적용에도 같은 경로를 전달한다.

```sh
node scripts/install.mjs --skill-root /actual/skills --config /actual/paseo/config.json --apply
```

기존 스킬과 충돌하면 차이를 읽는다. 요청된 배포본으로 교체할 범위가 확인되면 `--replace-skill`을 추가해 백업 후 교체한다. 보존해야 할 개인 지침과 충돌해 판단할 수 없다면 그 차이만 설명하고 필요한 결정을 요청한다. 설치 도구를 우회해 폴더 전체를 삭제하지 않는다.

다른 Paseo home을 사용하면 해당 `config.json`이 있는 home의 데몬을 다시 로드한다. CLI의 실제 옵션을 먼저 확인한다.

```sh
paseo reload --home /actual/paseo --json
```

CLI가 PATH에 없다면 찾은 실행 파일의 절대 경로를 사용한다. `restartRequiredPaths`가 비어 있으면 불필요하게 데몬을 재시작하지 않는다. 다른 호스트나 home을 실수로 다시 로드하지 않는다.

사용자가 스킬만 원하거나 프로필을 따로 관리하는 경우에만 `--skill-only --apply`를 사용한다. 이 경우 전체 팀 설치가 끝났다고 보고하지 않는다.

## 5. 설치 검증

같은 인자로 설치 도구를 **`--apply` 없이** 다시 실행한다. 배포 파일과 두 프로필이 일치하면 `changes`가 빈 배열이고 `replacementRequired`는 `false`여야 한다. 차이가 남으면 원인을 확인한다.

다음 세 범주를 구분해 확인한다.

1. **파일:** 대상 스킬 폴더의 `SKILL.md`와 `references/research.md`가 배포본과 일치한다. 다른 스킬과 개인 파일이 유지됐다.
2. **Paseo 반영:** MCP `list_profiles` 또는 해당 호스트의 지원 CLI에서 두 프로필과 정확한 모델·모드·추론·기능 값을 확인한다. 다른 프로필이 유지됐고 설정 reload가 성공했다.
3. **발견·접근:** Sol이 실제 사용하는 스킬 목록에서 `paseo-sol-deepseek`가 보이고, Paseo 에이전트 생성·완료 알림 도구에 접근할 수 있다. 스킬이 갱신되지 않았다면 새 Sol 세션에서 확인한다. 제공자·모델 접근을 확인하지 못했다면 그 부분은 미확인으로 남긴다.

설치 검사에 모델 호출은 필요 없다. 실제 워커 생성·완료 알림까지 확인하는 기능 검사를 수행했다면 그 결과를 별도로 기록한다. 수행하지 않은 모델 실행이나 토큰·비용 절감을 성공으로 주장하지 않는다.

실패 시 오류 단계와 백업 위치를 보고한다. 복원이 필요하면 설치 후의 다른 변경이 없는지 확인하고, 해당 파일의 백업만 원래 위치로 되돌린 뒤 같은 Paseo home을 다시 로드한다. 설정·백업 원문을 로그로 출력하지 않는다.

## 6. 사용자에게 전달할 결과

아래 항목을 실제로 확인한 내용으로 간결하게 보고한다.

- 설치한 버전·커밋, 대상 호스트, 스킬·Paseo 설정 경로.
- Sol `high`, DeepSeek `max`와 정확한 두 프로필의 반영 여부.
- 백업 위치와 기존 설정 보존 여부.
- 파일/프로필 검사, 스킬 발견, 제공자 접근, 실제 모델 기능 검사 각각의 완료·미확인 상태.
- 미해결 사항과 사용 시작 방법.

사용 시작: `sol61-orchestrator` 프로필의 Sol에서 다음처럼 요청한다. 프로필만 선택해서는 스킬 지침이 주입되지 않는다.

```text
$paseo-sol-deepseek [실제 작업]
```

계획·최종 리뷰는 같은 Sol 대화를 유지한다. 상세 조사와 구현은 워커가 수행하며 독립된 범위는 병렬로 위임할 수 있다. 기본적으로 별도의 리뷰 워커를 추가하지 않는다.
