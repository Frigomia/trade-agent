# Cut the Claude cost and time of the scan: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spend fewer Claude tokens and less time per scan and company analysis, without changing which events lead to an exclusion, and prove it with a replay.

**Architecture:** Two gates keep Claude calls that cannot change an exclusion from being made (the follow-up extraction after its search, the thesis check), the candidate research and follow-up output is trimmed (no `mentions`, capped and ranked claims and developments), and a dev-only replay script runs the old and the new code through the real discovery graph on frozen sources and compares them against the acceptance bar.

**Tech Stack:** Python, LangGraph, Anthropic SDK, pytest, ruff, mypy.

**Spec:** `docs/superpowers/specs/2026-11-18-scan-token-cuts-design.md` (ticket #304). Work on branch `feature/scan-token-cuts`; the design and this plan are committed first.

## Global Constraints

- Advisory only; nothing here touches orders. Backend rules in `backend/AGENTS.md` (run ruff by hand from `backend/` with `.venv/Scripts/ruff.exe`, `mypy.exe app`, `python -m pytest`; run the full suite alone, never two pytest runs at once, they share one test database).
- An exclusion needs a development that is `confirmed`, has `invalidates_thesis`, and is supported by a trusted high-materiality fact claim (`exclusion_for`, `normalize_evidence`). Trust is `source_tier(url, official_hosts)` of `official` or `reliable_reporting` (`app/discovery/sources.py`), host-based only. No change to `exclusion_for`, `normalize_evidence`, `source_tier`, or any safety clause of the prompts (verbatim excerpts, forum never confirmed, untrusted data).
- **Follow-up:** the first unconfirmed development is still searched exactly as today (`pending_development`, one search, query cut at 500 characters). The extraction call is made only if at least one returned URL is `official` or `reliable_reporting` for the same `official_hosts`; otherwise the evidence is returned unchanged with the gap `The follow-up search found no authoritative source; the allegation remains unverified.` and no Claude call.
- **Thesis check:** the Claude call is made only when some development is `confirmed`, has `invalidates_thesis`, and is supported by a trusted high-materiality fact claim. When it is not called, `_retained_developments(evidence, None)` still runs.
- **Trim, research and follow-up both:** `mentions` is removed from the candidate extraction's tool schema and prompt and read as `[]` locally; `ResearchEvidence` and its JSON schema, the stored and API shape, and the daily `discover_mentions()` schema do not change. Prompt changes are appended lines only (the ETF prompt swap and its test keep matching). Quotes stay at 300 characters. `MAX_CLAIMS = 15`, `MAX_DEVELOPMENTS = 5` as starting values, tuned by the replay. Protected claims (cited by or supporting a development, or stating an explicit full event date) are never dropped and sit outside the claim cap.
- Replay acceptance bar (design): no truncation; validators accept at least the same share of attempted claims; protected claims 100% retained; ordinary high-materiality trusted facts at least 90% of the baseline count retained (retained over baseline, the threshold is never lowered; tune `MAX_CLAIMS` up instead); all baseline dated catalysts kept; the new exclusion outcome equals the old in every case; research output tokens down at least 30%.
- The replay is a dev-only script: no new dependency, results stay local and uncommitted (they hold third-party text), the PR description carries the summary. A missing or unmatched search lookup fails the replay: never an empty result, an "unavailable" note or a live search.
- Conventional Commits with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer, GPG-signed, no push until the owner says.

## Review Focus

1. A forum-led allegation whose follow-up returns a trusted source still ends in the same `Exclusion` as before: the existing `test_follow_up_confirmation_is_rechecked_before_single_reassessment` passes unchanged (Task 1).
2. A follow-up whose results are only forum or `other` sources makes no `_extract` call, raises nothing and keeps the evidence with the gap; a verified issuer host from `official_hosts` counts as trusted (Task 1).
3. The thesis-check skip path runs `_retained_developments(evidence, None)`; quant-only (`client is None`) behaviour is unchanged (Task 1).
4. The trimmed schema is accepted by `_evidence` with `mentions` missing; the full `ResearchEvidence` schema and the `discover_mentions` schema still contain `mentions`; the ETF prompt swap test stays green (Task 2).
5. The replay fails on an unmatched lookup and never counts an empty or quant-only fallback as a successful extraction (Task 3).

---

### Task 1: The two gates

**Files:**
- Modify: `backend/app/agents/research.py` (`follow_up_candidate`), `backend/app/discovery/thesis.py`, `backend/app/agents/discovery_graph.py` (`thesis_check`)
- Test: `backend/tests/test_discovery_follow_up.py`, `backend/tests/test_discovery_thesis.py`, `backend/tests/test_discovery_graph.py` (and any existing test the new gates make wrong, see Step 5)

**Interfaces:**
- Produces in `app/discovery/thesis.py`: `exclusion_possible(evidence: ResearchEvidence) -> bool`: true when some development has `status == "confirmed"`, `invalidates_thesis`, and some claim with `claim.url in development.evidence` that is `_trusted_fact` with `materiality == "high"` (the same support check `exclusion_for` uses). Call it with normalized evidence.
- Produces in `app/agents/research.py`: `NO_AUTHORITY_GAP: str` (the gap text in Global Constraints) and `_has_trusted_source(urls: Iterable[str], official_hosts: Collection[str]) -> bool` (any URL whose `source_tier(url, official_hosts)` is `official` or `reliable_reporting`).
- Consumes: `source_tier`, `_trusted_fact`, `_retained_developments`.

- [ ] **Step 1: Write the failing tests.**
  - `test_discovery_thesis.py`: `test_exclusion_possible_needs_confirmed_invalidating_and_a_trusted_high_fact` (true for confirmed + invalidating + trusted high-materiality fact cited; false for each missing part in turn: unconfirmed, not invalidating, supporting claim medium, supporting claim not a fact, supporting claim from `other` tier, supporting claim not cited by the development; false with no developments).
  - `test_discovery_follow_up.py`: `test_follow_up_makes_no_claude_call_when_no_result_is_authoritative` (patch `_gather` to return only reddit and an unknown host, `_extract` as an `AsyncMock`: result equals the input evidence plus the gap `NO_AUTHORITY_GAP` and any search gaps, `_extract` not awaited, nothing raised); `test_follow_up_extracts_when_a_result_is_reliable_reporting` and `..._official` (a known reporting host and an `OFFICIAL_HOSTS` host: `_extract` awaited once); `test_follow_up_extracts_for_a_verified_issuer_host` (an otherwise unknown host passed in `official_hosts`); the existing follow-up tests still pass unchanged.
  - `test_discovery_graph.py`: `test_forum_led_allegation_confirmed_by_a_trusted_follow_up_still_excludes` (the existing confirmation test is the proof; add an assertion that `follow_up` was awaited once and the thesis extraction once); `test_thesis_check_makes_no_call_for_an_unconfirmed_allegation` (unconfirmed development with a trusted claim: extraction not awaited for the thesis step, `_retained_developments(evidence, None)` ran: any development still flagged invalidating is cleared with `thesis_impact` "The event's effect on the thesis remains unverified." and the gap "Thesis invalidation was not verified; retained for further human review." is present); `test_thesis_check_still_runs_for_a_confirmed_invalidating_development` (one thesis call); a client-less (`client=None`) run is unchanged.
- [ ] **Step 2: Run them and see them fail** (`cd backend && .venv/Scripts/python.exe -m pytest tests/test_discovery_thesis.py tests/test_discovery_follow_up.py tests/test_discovery_graph.py -q`): the new tests fail for the missing helpers and the missing gates.
- [ ] **Step 3: Implement.** `exclusion_possible` and `_has_trusted_source` per the Interfaces. In `follow_up_candidate`, after the existing `if not sources:` return, add: if not `_has_trusted_source(sources, official_hosts)` return `evidence.model_copy(update={"gaps": [*evidence.gaps, *gaps, NO_AUTHORITY_GAP]})` before any `_extract`. In `thesis_check`, call the model only when `client is not None and exclusion_possible(evidence)`; after that (whether the call was made, skipped or failed) keep the existing `if exclusion is None: evidence = _retained_developments(evidence, reassessment)` when `evidence.negative_developments` is non-empty.
- [ ] **Step 4: Run the three test files and see the new tests pass.**
- [ ] **Step 5: Run the full discovery and research tests** (`python -m pytest tests -q -k "discovery or research or thesis or scheduled or company"`). Existing tests that assumed the thesis check runs for any negative development (for example `test_unresolved_dispute_never_loops` and the `reassessment` stage of the provider-failure test) must be updated to the new behaviour: a disputed or unconfirmed development no longer triggers the thesis call, so the failure and call-count tests need a confirmed invalidating development to reach it. Change only the fixtures and counts, say so in the report, and keep what each test protects.
- [ ] **Step 6: ruff (check and format) on the changed files and `mypy.exe app`; commit** `feat: skip Claude calls that cannot change an exclusion`.

---

### Task 2: Trim the research and follow-up output

**Files:**
- Modify: `backend/app/agents/research.py`
- Test: `backend/tests/test_agents_research.py`, `backend/tests/test_discovery_follow_up.py`

**Interfaces:**
- Produces in `app/agents/research.py`: `MAX_CLAIMS = 15`, `MAX_DEVELOPMENTS = 5`, and `candidate_evidence_schema() -> dict[str, Any]`: `ResearchEvidence.model_json_schema()` with `mentions` removed from `properties` and from `required`. The stock prompt `RESEARCH_SYSTEM_PROMPT` gains these appended lines (the ETF prompt is derived from it and keeps matching):
  1. `The mentions field is not requested; name other companies only in competitors.`
  2. `Return at most {MAX_CLAIMS} ordinary claims, plus every claim cited by a negative development, every trusted fact that supports one, and every claim whose excerpt states an explicit full event date a catalyst could use: those are never dropped and do not count against the limit. Rank ordinary claims: trusted high-materiality facts first, keeping every distinct outlet for such an event, then the rest by materiality.`
  3. `Return at most {MAX_DEVELOPMENTS} negative developments, ranked: confirmed and invalidating first, then by materiality, with all their cited evidence kept.`
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests.** `test_candidate_evidence_schema_drops_only_mentions` (no `mentions` in `properties` or `required`, every other property and requirement of `ResearchEvidence.model_json_schema()` is present, and the full `ResearchEvidence.model_json_schema()` still has `mentions`); `test_discover_mentions_schema_is_unchanged` (the schema `discover_mentions` sends still has `mentions` required, checked by patching `_extract` and calling it with the existing daily-mentions fixture); `test_evidence_is_built_without_mentions` (`_evidence(...)` with data that has no `mentions` key gives `mentions == []`); `test_research_and_follow_up_send_the_trimmed_schema` (patch `_extract`; `research_candidate` and `follow_up_candidate` both pass `candidate_evidence_schema()` as the fourth argument); `test_prompts_carry_the_output_rules` (both `RESEARCH_SYSTEM_PROMPT` and `ETF_RESEARCH_SYSTEM_PROMPT` contain the three lines with the numbers 15 and 5, and the existing ETF swap test, `tests/test_agents_research.py` around line 926, passes unchanged).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the constants, `candidate_evidence_schema()` (deep-copy the schema, delete `mentions`), the appended prompt lines (build the strings with the constants), and pass `candidate_evidence_schema()` instead of `ResearchEvidence.model_json_schema()` in the two candidate `_extract` calls (`research_candidate`, `follow_up_candidate`). `_evidence` already reads a missing `mentions` as empty (`_mentions` returns `[]` for a non-list); confirm, do not change `_evidence`'s contract.
- [ ] **Step 4: Run the new tests and the full `tests/test_agents_research.py` and `tests/test_discovery_follow_up.py`; ruff and `mypy.exe app`; commit** `feat: trim the candidate research and follow-up output`.

---

### Task 3: The replay script

**Files:**
- Create: `backend/scripts/replay_scan_cost.py`, `backend/tests/test_replay_scan_cost.py`
- Modify: `.gitignore` (add `backend/.replay/`)

**Interfaces:**
- Produces: a command line `python scripts/replay_scan_cost.py record|run|compare` run from `backend/`:
  - `record --set FILE --out DIR`: for each company in the JSON list (`ticker`, `name`, `asset_type`, `country`, `sector`, optional `official_hosts`), build a `CandidateMetrics`, run the **old** research once against live Tavily and Claude, and save under `DIR` the initial search responses (keyed by query) and the baseline's actual follow-up search response as that candidate's **fixed follow-up bundle**.
  - `run --label old|new --out DIR`: run each company and each planted case through `run_discovery_graph(candidate, client, fit=None, official_hosts=...)` with `research._gather` patched to serve the recording (initial searches by query; the `"follow-up"` search returns the candidate's fixed bundle whatever query is sent) and with `research.trace_anthropic` patched to an instrumenting wrapper, and write `DIR/<label>.json`. A lookup with no matching recording raises and fails the run.
  - `compare --old FILE --new FILE`: prints the per-company table and PASS or FAIL for each bar in Global Constraints.
- Produces pure, importable functions the tests cover: `retention(old_claims, new_claims, protected_urls) -> RetentionResult` (a claim is retained when the same URL and the token overlap of the verbatim excerpt is at least 0.8; counts and percentages for protected and ordinary classes), `compare_runs(old: dict, new: dict) -> list[Check]`, `acceptance_share(attempted: int, accepted: int) -> float` (0.0 when nothing was attempted, so a fallback is never a success).
- Planted cases (labelled test sources, a fake company, defined in the script): the five of the design (starts confirmed; forum-led and confirmed through a trusted follow-up bundle; unconfirmed with only forum or `other` bundle; a medium or low-materiality allegation with a trusted bundle; supporting evidence kept after the cap), each with the expected exclusion outcome of the old code.
- Consumes: Task 1 and Task 2 code for the `new` label; the master code (a second checkout or worktree) for the `old` label.

- [ ] **Step 1: Write the failing tests** for the pure functions only (no network): `test_retention_counts_protected_and_ordinary_claims_separately`, `test_retention_matches_by_url_and_excerpt_overlap_not_event_id`, `test_a_company_over_the_cap_is_reported_not_silently_passed` (30 ordinary baseline facts, 14 retained: FAIL at 46.7%, the formula is retained over baseline), `test_acceptance_share_is_zero_when_nothing_was_attempted`, `test_compare_fails_on_any_truncation`, `test_compare_fails_when_an_exclusion_outcome_differs`, `test_compare_fails_when_output_tokens_do_not_fall_by_thirty_percent`, `test_a_replay_lookup_without_a_recording_raises` (the stub for `_gather` raises, never returns an empty result).
- [ ] **Step 2: Run them and see them fail** (`python -m pytest tests/test_replay_scan_cost.py -q`; load the script module with `importlib.util.spec_from_file_location`, the script directory is not a package).
- [ ] **Step 3: Implement the script.** Keep it one file, standard library plus what the app already depends on. The instrumenting wrapper records, per `messages.create`: step (from the system prompt: research, thesis, synthesis), input and output tokens, seconds, `stop_reason`. Wrap `research._evidence` to record attempted claims (`len(data["claims"])`) against accepted (`len(result.claims)`). Cost is `input * 2 + output * 10` per million tokens (Sonnet 5 list price). Add `backend/.replay/` to `.gitignore`.
- [ ] **Step 4: Run the tests, ruff (check and format) on the script and the test, and `mypy.exe app`; commit** `feat: add a replay script that compares the old and new scan cost and evidence`.

---

### Task 4: Run the replay, tune, document

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the discovery section: the follow-up gate after its search, the thesis-check gate, the trimmed output and its protected claims); `backend/app/agents/research.py` (`MAX_CLAIMS` only if the replay requires it)

**Interfaces:**
- Consumes: Tasks 1 to 3. Needs `ANTHROPIC_API_KEY` (the dev key) and `TAVILY_API_KEY` in `backend/.env`; a replay costs roughly a few dollars of Claude and about 50 Tavily searches. If a key is missing, or Avast blocks the TLS connection (use `truststore.inject_into_ssl()` as a local, uncommitted shim), stop and ask the owner; do not work around a missing key.

- [ ] **Step 1:** Choose the replay set with the owner's agreement (about 10 companies across regions, one or two ETFs) and write it to a local JSON file outside the repo. `record` it on the master checkout (old code), then `run --label old` there and `run --label new` on this branch with the same recordings.
- [ ] **Step 2:** `compare` the two files. If a bar fails, change only what the design allows (raise `MAX_CLAIMS`, never lower a threshold), rerun `new`, and say what changed. If the follow-up gate still lets most candidates through, report that the saving is the trim alone.
- [ ] **Step 3:** Update `docs/ARCHITECTURE.md` as described above. Write the replay summary (per-company table, the bars, call counts, tokens, cost and time old versus new, the share of follow-ups still made) for the PR description; keep the raw results out of the repo.
- [ ] **Step 4:** Run the full backend suite once (`docker compose up -d` from `backend/` if Postgres and Redis are not up; nothing else may use the test database), ruff and `mypy.exe app`; see them pass. **Commit** `docs: describe the scan cost gates and record the replay result`.
- [ ] **Step 5 (after merge, by the owner):** run one prod scan and compare `research.extract` tokens and time, the number of follow-up and thesis spans and the cost per scan in LangSmith with the baseline in the design.

---

## Self-review

- **Spec coverage:** follow-up gate after the search, thesis-check gate with the skip-path cleanup, trimmed schema with `mentions=[]` locally, appended prompt rules with protected classes, replay through the graph with a fixed follow-up bundle and fail-on-miss, planted cases, retention and acceptance bars, docs and the after-merge comparison. `pending_development` is unchanged by design.
- **Types:** `exclusion_possible`, `_has_trusted_source`, `NO_AUTHORITY_GAP`, `candidate_evidence_schema`, `MAX_CLAIMS`, `MAX_DEVELOPMENTS`, `retention`, `compare_runs`, `acceptance_share` are named the same wherever used.
- **Proportion:** four tasks; Task 3's script is the largest unit, kept to pure tested functions plus the glue that needs live keys.
