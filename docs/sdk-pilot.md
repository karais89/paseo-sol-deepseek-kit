# PR #2 — Paseo SDK 외부 실행기 파일럿

**목적:** PR #1에서 Sol의 직접 조회·검토·도구 대기가 530,217토큰(+125.77%)으로 증가하고 최종 수락 전 중단된 것을 계기로, 도구·검증 작업을 Sol 대화 바깥으로 옮기는 **검증용 작은 실행기**를 제안한다. 이는 과거 E 실험 실행기를 복제한 것이 아니다. 토큰 절감은 아직 실측되지 않았다.

## 구조 (1 Sol 세션, 1 DeepSeek 세션, 외부 실행기)

1. Node 스크립트가 **Paseo SDK**로 읽기 전용 Sol을 시작해 짧은 작업 계획을 받는다. Sol에 '도구를 쓰지 말라'고 요청하지만 모델 요청 수나 도구 사용을 기술적으로 강제하지는 못한다.
2. 같은 스크립트가 **Paseo/OpenCode DeepSeek** 워커 하나를 생성해 조사·구현·자체 검증을 맡긴다. SDK `waitForFinish`로 기다리는 동안 Sol에게 반복 프롬프트를 보내지 않는다.
3. 외부 스크립트가 사용자 지정 검증 명령을 직접 실행한다. 실패하면 **동일 워커 세션**에 단 한 번 수정 요청한다. 그래도 실패하면 자동 수락하지 않는다.
4. git 변경(신규·수정 파일)을 수집하고 **최대 12,000자 diff** 및 검사 증거를 동일 Sol 세션에 전달해 최종 판단만 요청한다. 변경량이 상한을 넘거나 보호 경로가 변경되면 수락 대신 수동 리뷰를 요구한다.
5. Sol 응답의 첫 줄이 정확히 `DECISION: APPROVE`이고 독립 검증이 통과한 경우에만 로컬 결과를 `accepted`로 표시한다. **커밋·PR 생성·머지·배포는 수행하지 않는다.**

다중 워커, 큐, 데몬 변경, 반복 폴링, 별도 검수 LLM은 추가하지 않았다. Sol 코디네이터의 턴은 계획과 검토 2단계이지만 **모델 내부 요청이 2회라는 뜻은 아니다.**

## 사전 준비

- Node 22+, Git, Paseo 0.13.0, 실행 가능한 Codex/OpenCode 로그인 및 모델 접근 권한.
- 로컬 호스트에서 `codex/gpt-6.1-sol` high/auto-review와 `opencode/merge-gateway/deepseek/deepseek-v4.1-flash` max/build이 동작하는지 직접 확인.
- 독립된 **깨끗한 Git worktree/체크아웃**을 준비한다. 중요한 프로젝트에서 실행하지 않는다.
- SDK 설치는 실기 실행이 필요할 때에만 수행: `npm install --no-save --package-lock=false @getpaseo/client@0.13.0`. 설치기 테스트나 dry-run에는 SDK가 필요 없다.
- 실험 과제와 검사 명령을 `templates/pilot-task.example.json`을 복사해 작성한다. `checks`는 문자열이 아닌 **argv 배열**이므로 shell 확장을 사용하지 않는다. 임의 검증 명령도 현재 사용자 권한으로 실행되므로 신뢰한 저장소에서만 사용한다.

## 미리보기와 실행

```sh
# 먼저 모델을 호출하지 않는 미리보기
node scripts/pilot-runner.mjs --cwd /path/to/clean-checkout --task /path/to/pilot-task.json

# 명시적 승인 후에만 실제 Paseo/모델을 호출한다.
node scripts/pilot-runner.mjs --execute \
  --cwd /path/to/clean-checkout \
  --task /path/to/pilot-task.json \
  --out /path/outside-checkout/pilot-result.json \
  --turn-timeout-ms 900000
```

별도 호스트를 쓰는 경우 `PASEO_URL=ws://127.0.0.1:6767/ws`를 설정한다. 비밀번호가 필요하면 환경 변수 `PASEO_PASSWORD`로 전달하되 Git 또는 로그에 넣지 않는다. 아웃풋은 테스트 체크아웃 **밖**에 저장한다.

`--execute`는 실제 유료 모델을 호출한다. `turn-timeout-ms`는 단일 SDK 응답 대기 상한이며 **토큰·과금 하드캡이 아니다.** 런타임의 `timeout` 응답에는 실행기 소유 에이전트에 중단/아카이브를 시도한다. 사용자 권한 대기·SDK 연결 실패·작업 검사 실패는 합격 처리하지 않는다. 성공 후 에이전트/세션은 Paseo에서 관찰 가능하게 남는다.

**실기 통합 실행은 아직 수행하지 않았다.** SDK 진입점은 Paseo v0.13.0 공식 문서의 `createPaseoClient`, `agents.create`, `waitForFinish`, `agent.run`을 따르지만 실제 호스트 권한, 모드 및 반환값은 확인이 필요하다. PR 코드 리뷰 단계는 dry-run, mock SDK 단위 테스트, GitHub Actions까지로 제한한다.

## 합격 및 성능 검증 순서

1. **가짜 SDK 단위 테스트:** `node --test`. 실패 상태, 동일 세션 재사용, git diff, 읽기 전용 Sol 옵션, 불완전 최종 답변 처리 점검.
2. **하나의 독립 코딩 과제 파일럿:** Sol 단독(A)과 PR #2 실행기 방식(B)을 같은 시작 커밋·요구사항·외부 독립 검사로 각각 독립 세션에서 실행. 최대 모델 호출 예산을 실험 전에 합의하고 관측자에서 별도 감시한다. 한도는 후행 요청 사용량 때문에 초과할 수 있다.
3. **원시 사용량:** 모든 Sol 고유 `response_id`의 `input_tokens + output_tokens`를 합산(입력에 캐시 포함). reasoning output 재산입 금지. OpenCode 워커/보조 usage는 별도 기록. 모델 내부 요청, Sol 도구 실행, retries, 최종 수락까지 전부 기록한다. **이 도구는 사용량을 자동 계측하지 않는다.** Paseo `lastUsage` 마지막 스냅샷을 전체 사용량으로 쓰면 안 된다.
4. **품질·속도:** A/B 모두 동일한 숨김/독립 테스트와 결과 검토. 시작→최종 Sol 수락 시간, 제한/실패도 보존. B가 마무리하지 못하면 검사만 통과해도 파일럿 실패다.
5. **PR 자체의 효과:** 이 파일럿 결과는 새 외부 실행 구조의 효과를 본다. PR #1의 자율 운영 스킬이나 과거 E 실행기와 동등하다고 주장하지 말고, 필요하면 정확히 같은 작업으로 별도 비교한다.
6. **정식 판정:** 단일 파일럿이 정상 완료하고 사용량 추적이 충분할 때만 추가 승인을 받아 3작업×2회 총 6쌍을 실행한다. [기존 개선된 비교 게이트](../scripts/compare-runs.mjs) 사용 시 전체 토큰 합계·시간 합계·작업별 지연도 확인한다. **관측 실패는 삭제하거나 통과로 바꾸지 않는다.**

## 알려진 위험 / 리뷰 질문

- Sol 프롬프트의 '도구 사용 금지'는 절대적인 도구 차단이 아니다. 읽기 전용 Codex sandbox 옵션도 읽기 도구 호출까지 막지는 않는다. **원시 로그로 Sol 모델 요청·도구 호출·실제 총 토큰을 확인해야 한다.**
- SDK `waitForFinish()`의 `idle`은 전체 요구사항 수락이 아니다. 외부 검증과 명시적 Sol 판단이 필수다. 현재 PoC는 호스트/네트워크 오류 및 프로세스 강제 종료 뒤 완전한 자동 복구를 제공하지 않는다.
- 변경 diff 12,000자 초과, 바이너리 신규 파일, 보호 경로 변경, 수락할 파일 없음은 수동 리뷰로 돌린다. 이것은 품질 보장의 범위를 의도적으로 좁히는 정책이다.
- 작업 측정 실패, 담당 모델 오류, 권한 팝업, 추가 예산 요청이 있으면 **실험을 확장하지 말고** 보고한다.
- 현재 모델 설정은 Sol high, DeepSeek max다. 과거 E의 DeepSeek high와 다르므로 과거 70% 절감을 재현했다고 주장할 수 없다.

**참고:** [PR #1 파일럿 원본 보고서](https://github.com/karais89/paseo-sol-deepseek-kit/pull/1#issuecomment-6410089329), [Paseo 0.13.0 SDK quickstart](https://github.com/getpaseo/paseo/blob/v0.13.0/public-docs/sdk/quickstart.md), [SDK agent/permission 문서](https://github.com/getpaseo/paseo/blob/v0.13.0/public-docs/sdk/agents.md).