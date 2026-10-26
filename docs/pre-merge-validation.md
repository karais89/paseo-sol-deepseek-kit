# PR 병합 전 실제 검증 가이드

**주의:** 스킬/설치 유닛 테스트와 CI 성공은 실제 Paseo 알림, 모델 품질, 토큰 감소를 검증하지 않는다. 사용자가 실기 실행 결과를 검토하고 PR을 병합한다. 이 레포는 계측 플러그인이나 데몬 복구기를 포함하지 않는다.

## 1. 환경 확인 및 안전한 준비

```sh
node --version
node --test
node scripts/install.mjs
paseo --version
```

Node 22+를 사용한다. 설치는 **먼저 미리보기**로 확인하고, 두 프로필과 스킬만 적용한다. Paseo `list_profiles` 및 `inspect_provider`로 Sol `codex/gpt-6.1-sol` (high/auto-review)과 DeepSeek `opencode/merge-gateway/deepseek/deepseek-v4.1-flash` (max/build)이 실제로 선택 가능한지 확인한다. 다른 모델이나 reasoning 단계로 조용히 대체하지 않는다. 실제 개발용 레포가 아닌 격리된 샘플 저장소 또는 worktree를 사용한다. 비밀/프롬프트 본문/자격 증명은 PR에 포함하지 않는다.

## 2. 동일 조건 A/B 실행: 3개 작업 × 2회 = 총 6쌍

사용자 요청, 시작 커밋, 요구사항, 빌드/테스트 명령, 수락 기준, 사용 환경, Paseo 버전을 동일하게 둔다. 작업은 (1) 버그 수정 + 회귀 테스트, (2) 다중 파일 작은 기능, (3) 코드 조사 후 구현·검증으로 정한다. 실험 시작 전에 어떤 테스트가 통과해야 하는지 적는다. 각 쌍에서 A는 **Sol 단독**, B는 **동일 Sol 세션 + 지속 DeepSeek 워커**로 수행한다. 두 실행 모두 깨끗한 같은 시작 상태로 초기화한다. 순서와 캐시/네트워크 상태도 기록한다.

A와 B에서 `taskId`, `conditionsId`, `startRevision`을 같게 기록하되, **다른 반복 쌍에는 고유한 `conditionsId`**를 사용한다. 비교 결과를 보고 실패한 시도를 삭제하거나 합격 기준을 완화하지 않는다.

## 3. 수집할 실제 증거

| 축 | 반드시 확인할 것 |
|---|---|
| 품질 | 양쪽 모두 실제 검증 명령의 종료 코드 0, 요구사항 만족, 주요 회귀 미발생. 모델의 'PASS' 발언만으로 승인하지 않는다. |
| Sol 토큰 | 모든 Sol 모델 요청의 입력(캐시 포함)+출력 합. 캐시 입력은 별도로 기록; 출력에 포함된 reasoning 토큰 중복 산입 금지 |
| 워커 토큰 | 조사·구현·검수의 모든 워커 요청을 모델별로 합산. 누락 시 `usageComplete=false` |
| 속도 | 첫 요청부터 **최종 Sol 수락까지** 실제 wall-clock 시간; 기다림/후속 수정/권한 요청도 포함 |
| 알림 | 워커 완료 실제 증거, Sol이 알림을 받았는지, 동일 세션에서 최종 수락했는지, 대기 중 Sol 요청이 0인지 |
| 실패/비용 | 실패·타임아웃도 보관. 제공자별 가격·캐시 과금이 없으면 합산 토큰을 비용으로 바꾸지 않는다. |

`checkEvidence`, `usageEvidence`, `handoff.evidence`는 **민감정보를 제거한 증거의 위치**를 적는다. 집계기는 증거 **문자열이 비어 있지 않음**만 검사하며 로그 자체가 사실인지 자동 확인하지 못한다. 반드시 사람이 대조한다.

## 4. 결과 비교 및 병합 게이트

`templates/benchmark-baseline.template.json`과 `templates/benchmark-delegated.template.json`을 각각 복사해 **실제 계측값으로** 입력한다. 템플릿의 `null`·`false`는 의도적으로 비교 실패를 일으킨다.

```sh
node scripts/compare-runs.mjs --json results/solo-a1.json results/team-a1.json

node scripts/compare-runs.mjs --gate \
  results/solo-a1.json results/team-a1.json \
  results/solo-a2.json results/team-a2.json \
  results/solo-b1.json results/team-b1.json \
  results/solo-b2.json results/team-b2.json \
  results/solo-c1.json results/team-c1.json \
  results/solo-c2.json results/team-c2.json
```

**사전에 제안하는 합격 기준**: 6쌍/서로 다른 3개 작업, 모두 동일 기능·테스트 통과, Sol 총 토큰 절감률 중앙값 **30% 이상**, end-to-end 소요 시간 증가율 중앙값 **25% 이하**, 모든 B 실행의 대기 중 Sol 호출 **0회** 및 실제 알림·최종 수락 확인. `--gate`는 이 기본치를 적용하며 실패는 종료 코드 1, 데이터 누락/형식 불량은 코드 2, 성공은 코드 0이다. 다른 사전 합의 기준은 `--min-pairs=N`, `--min-tasks=N`, `--min-sol-reduction=N`, `--max-time-regression=N`으로 조정할 수 있다. 결과 확인 후 조정해서 통과시키면 안 된다.

## 5. 운영 장애 스모크 테스트

정상 완료 외에 (1) 권한 요청/거부 및 실제 실패 보고, (2) 동일 워커 세션으로 1회 후속 수정과 재알림, (3) 조기 `finished`/중간 idle에 최종 파일·테스트 증거가 없는 경우를 검사한다. 알림만으로 성공 처리하지 않는다. Paseo [#3875](https://github.com/getpaseo/paseo/issues/3875)에는 중간 idle 후 후속 완료 알림 누락 문제가 보고됐다. 본 스킬은 **주기적 Sol 폴링을 하지 않으며**, 외부 감시자나 사용자의 구체적인 재확인 신호가 없으면 누락된 알림을 자동 복구할 수 없다. 신호가 오면 동일 워커 상태/활동을 한 번 확인하고, 필요한 경우 같은 세션에 후속 프롬프트로 알림을 재설정한다.

## 6. 리뷰 체크리스트

- [ ] CI 및 `node --test` 통과 — 실제 모델 실험과 구별
- [ ] 모델/권한/reasoning 옵션 실제 호스트에서 확인
- [ ] 동일 시작 커밋에서 6쌍 실기 실행; 실패/누락도 기록
- [ ] 테스트 출력과 원시 요청별 토큰 기록(비밀 제거)을 사람이 확인
- [ ] 알림/후속 수정/권한 장애를 직접 검증
- [ ] 토큰 절감·품질·속도 기준 모두 만족, 사용자가 병합 승인

**실기 측정이 없으면 PR을 Draft로 유지하고 토큰 절감을 검증했다고 쓰지 않는다.**
