# Cut the Claude cost and time of a scan without lowering its quality (short design)

Date: 2026-11-18. Status: revised after the ticket review; for the owner's approval. Size: a small change plus a dev-only replay script that proves it.

## Intent

The New-ideas scan and the Discover company analysis use up the Claude budget. The owner wants to spend fewer tokens and finish faster without worse analysis. LangSmith traces from prod (PR #303) now show where the spend is.

What the traces show (Sonnet 5 at $2 per million input tokens and $10 per million output tokens; one prod scan of 8 candidates, one company analysis):

- A scan cost about $2.02 and took 448 s; a company analysis about $0.26 and 148 s. Both run the same four Claude calls per company: research, follow-up, synthesis, thesis check.
- Output tokens are about 63% of the cost and nearly all of the wait: about 6.2k output tokens for research, 5.2k for the follow-up, 3.4k for synthesis, 1.1k for the thesis check. Tavily searches are about 2.4 s each and not a bottleneck.
- The follow-up and the thesis check ran for all 9 of 9 companies (scan and company analysis together). Together they are about 43% of a scan's cost (about $0.86) and about 52 s of a company's roughly 134 s of Claude time.
- Two of the 8 follow-ups used or nearly used the 8,192-token output limit, and one extraction failed on it: that spend bought nothing.
- The candidate research asks the model for a `mentions` list that nothing in the scan reads (it is only merged); the daily mentions batch is a separate call.
- The owner reports that no candidate has ever been excluded as "thesis no longer holds".

Why the follow-up and thesis check fire for everyone: `pending_development` selects any negative development whose status is not `confirmed`, and the research prompt asks the model to list bear and forum allegations, which are unverified by definition. The thesis check then runs for any candidate with any negative development.

## Goals

- Spend the follow-up's Claude call only when its search found a source that could support an exclusion, and the thesis check only when an exclusion is possible. The searches themselves keep running as today.
- Shrink the research and follow-up output (the number of claims and developments, the unused `mentions` list) so neither hits the 8,192-token limit.
- Prove, on a fixed set of companies, that the evidence the scan relies on does not get worse, and report the saving.

## Non-goals

- A cheaper model for the extraction steps, higher concurrency, parallel Tavily searches, changes to synthesis or the daily mentions batch, and prompt caching (it helps little here). Each is its own change, judged against the same replay.
- Changing any safety rule: verbatim excerpts, forum content never confirmed, untrusted-data handling, the exclusion rules in `exclusion_for`.
- Changing what the owner sees on a retained idea beyond what is stated under "What changes for the user".

## Anti-goals

- Fewer calls that quietly remove real risk flags: a confirmed, corroborated invalidating development must still be found and still lead to an exclusion.
- Losing a discovery path: a forum-led allegation whose follow-up search finds authoritative evidence must still end in the same exclusion as today.
- Savings measured only by guess: nothing merges without the replay numbers.

## Constraints

- Advisory only; nothing here touches orders. Backend rules in `backend/AGENTS.md`.
- An exclusion is only possible when a development is `confirmed`, `invalidates_thesis`, and supported by a trusted high-materiality fact claim (`exclusion_for`, `normalize_evidence`). The gates below are therefore derived from those preconditions, not invented. A claim is trusted only through `source_tier(url, official_hosts)`, which looks at the URL's host and nothing else, so "could a trusted claim come out of these search results" can be answered before any model call.
- LangSmith content hiding is on in prod, so traces carry token counts and timings but not text; the quality proof therefore needs the local replay, not the traces.

## Approaches

1. **Gate the Claude calls on what can change an exclusion, trim the output, proved by a replay (chosen).** About $0.26 per scan from the thesis-check gate, plus up to about $0.60 from the follow-up gate (only as often as a follow-up search returns no trusted source, which the replay measures), plus about $0.15 to $0.25 from the trim, and up to about 50 s per company. No change to the safety rules and no change to which events can be excluded.
2. **Swap in a cheaper model for the extraction steps.** Possibly the largest saving, but the price and the quality are unmeasured; better judged after approach 1 on the same replay.
3. **Only speed up (more concurrency, parallel searches).** Cuts wall time but not cost; a separate small change.

## Design

- **Follow-up: search first, then decide whether to call Claude** (`follow_up_candidate`, `app/agents/research.py`): `pending_development` and the follow-up search stay exactly as today (the first unconfirmed development, one search of at most 500 characters), so a forum-led allegation is still searched. After the search, the extraction call is made only if at least one returned URL has `source_tier(url, official_hosts)` of `official` or `reliable_reporting`, the same function and the same `official_hosts` that `normalize_evidence` applies. Only claims from such sources can become the trusted facts that `exclusion_for` requires, so skipping the call when none appear cannot change an exclusion. When it is skipped, the evidence is returned unchanged with the gap "The follow-up search found no authoritative source; the allegation remains unverified."
- **Thesis-check gate** (`thesis_check`, `app/agents/discovery_graph.py`): call the model only when some development is `confirmed`, has `invalidates_thesis`, and is supported by a trusted high-materiality fact claim, which is what `exclusion_for` needs. On the skip path `_retained_developments(evidence, None)` still runs, so a development left flagged as invalidating is still cleared, annotated "remains unverified" and noted in the gaps, exactly as when the call fails today.
- **Trimmed output, for both research and follow-up** (they share `RESEARCH_SYSTEM_PROMPT` and the schema, so both are trimmed and both are measured; `app/agents/research.py`):
  - `mentions`: remove it from the candidate extraction's tool schema and prompt, and set `mentions=[]` locally when the evidence is built, so the stored and API shape of `ResearchEvidence` is unchanged and the separate daily `discover_mentions()` schema is untouched. Deleting only the prompt instruction would leave the schema asking for the field. The prompt change is appended lines only, so the ETF prompt swap and its test keep matching: "The mentions field is not requested; name other companies only in competitors."
  - Claim cap with a stated priority. The prompt asks for at most `MAX_CLAIMS` ordinary claims, plus whatever is needed for two protected classes that are never dropped and do not count against the cap: (a) every claim cited by a negative development, and every trusted fact that supports one, and (b) every claim whose excerpt states an explicit full event date that a catalyst could use. The ordinary claims are ranked: trusted high-materiality facts first, keeping every distinct outlet for such an event, then the rest by materiality.
  - `MAX_DEVELOPMENTS` negative developments, ranked: confirmed and invalidating first, then by materiality, with all their cited evidence kept.
  - Quotes stay at the current 300-character limit, because dated catalysts need the full event date and the thesis check matches quotes. Starting values `MAX_CLAIMS = 15`, `MAX_DEVELOPMENTS = 5`; the replay may move them.
- **Replay** (dev-only script, not part of the app, no new dependency): for a fixed list of about 10 companies (stocks across regions, one or two ETFs), freeze everything the model sees. The initial searches are keyed by their query, which is built from the candidate and not by the model. The follow-up search is different: its query comes from a model-written summary and can differ between the old and the new code, so the follow-up search boundary is stubbed with a **fixed bundle per candidate**, recorded once from the baseline's actual follow-up query and served to both variants whatever query they send. A missing or unmatched lookup **fails the replay**; it never turns into an empty result, an unavailable-research note or a live search. Run the old and the new code through the real discovery graph (`run_discovery_graph`) with the dev Claude key, with the candidate and portfolio inputs and the model settings fixed, and record per run: the actual number of Claude calls, input and output tokens, estimated cost, elapsed time, `stop_reason` per step, the validators' result per attempted claim (the share of the model's claims accepted, so an empty or quant-only fallback is never counted as a success), and the final exclusions, retained developments and dated catalysts. Results stay local and uncommitted; the PR description carries the summary.
- **Planted cases** (clearly labelled test sources and a fake company, added to the replay set because the owner has never had a confirmed invalidating event). In every case the new code's exclusion outcome must equal the old code's:
  1. *Starts confirmed:* an authoritative, high-materiality, confirmed negative event. The new code must extract it, pass the thesis-check gate and end in the same `Exclusion`.
  2. *Forum-led, confirmed through the follow-up:* a forum-only allegation whose frozen follow-up bundle contains a trusted high-materiality fact (the shape of `test_follow_up_confirmation_is_rechecked_before_single_reassessment`). Exactly one follow-up extraction and one reassessment, ending in the same `Exclusion` as the old code. This is the case the earlier gate would have broken.
  3. *Unconfirmed allegation, no authoritative source in the bundle:* the bundle holds only forum or `other` sources. No follow-up extraction and no thesis check run, the old code's result has no exclusion either, and the allegation and its uncertainty (the gap above) stay visible on the retained idea.
  4. *A medium or low-materiality allegation with a trusted bundle* still gets its follow-up, so the new code spends the call exactly where the old code could have excluded.
  5. *Supporting evidence:* every claim that supports a planted invalidation is still present after the cap.
- **Deterministic tests** (no model): the skip path of `thesis_check` calls `_retained_developments(evidence, None)`, keeps the facts and clears unsupported invalidation flags; the follow-up gate returns the evidence with the gap and makes no extraction call when no result URL is official or reliable reporting, and makes the call when one is (including a verified issuer host from `official_hosts`); which development `pending_development` selects and the 500-character cut of the query (a separate check from the replay, because the replay stubs the search boundary).
- **What the replay must show before merge:**
  - no truncation in research or follow-up, and validators accepting at least as large a share of attempted claims;
  - retention measured per company, as counts and percentages, by validated semantic match (the same cited URL and a high overlap of the verbatim excerpt), not by model-written `event_id` and not by identical excerpts: protected classes (a) and (b) are retained 100%, and the other high-materiality trusted facts are retained at least 90% of the baseline count (retained over baseline, with no allowance for the cap). A company that cannot meet it is handled by tuning `MAX_CLAIMS` up, or by reporting that the cap is too low for that company; the threshold is not reduced. The baseline's dated catalysts are all kept. The cap is a cap on ordinary claims only, not a bound on total output: the measured token and truncation gate below is the only guarantee against reaching 8,192 tokens;
  - all planted cases behave as stated, the new code's exclusion outcome equals the old code's in every case, and every baseline confirmed and invalidating development ends in the same exclusion;
  - research output tokens down at least 30%, and the measured call counts, tokens, cost and time per company, with the share of candidates whose follow-up search returned a trusted source and so still reached the extraction. The saving is quoted from those measurements: if most still pass that gate, the follow-up saving is the trim alone and the design says so.
- **After merge:** compare the next prod scan in LangSmith (`research.extract` tokens and time, the number of follow-up and thesis spans, cost per scan) with the baseline above.
- **Docs:** `docs/ARCHITECTURE.md` (the follow-up and thesis-check gates, the trimmed output).

## What changes for the user

Events are excluded exactly as before. When a follow-up search returns nothing from an official or reliable-reporting source, the allegation stays an unverified risk and no Claude call is spent on it, and a note in the evidence gaps says so. The thesis-impact line that the thesis check wrote for unconfirmed allegations is no longer produced for them.

## Calls I made (open to correction)

- Gate on the preconditions of `exclusion_for`, so no Claude call is skipped whose answer could change an exclusion.
- Gate the follow-up's Claude call on the search results' source tiers, after the search, instead of on the initial claims: this keeps the forum-led path an earlier draft of this design would have removed (found in the ticket review), keeps `pending_development` unchanged and makes the equivalence of exclusion outcomes checkable.
- Keep the quotes at 300 characters and cap the number of claims and developments instead, with an explicit ranking, so dates, corroboration and confirmed events survive.
- `MAX_CLAIMS = 15` and `MAX_DEVELOPMENTS = 5` as starting values, tuned by the replay.
- Replay results stay out of the repo (they contain third-party text); only the summary goes in the PR.
- The protected classes (claims supporting a development, claims with an explicit event date) sit outside the claim cap, so the cap can never remove an exclusion's support or a catalyst's date.
- Which step failed on the 8,192-token limit in the prod scan is unknown (the traces carry no text), so both research and follow-up are trimmed and measured.

## Left to the builder

Exact function names, how the trimmed tool schema is built from `ResearchEvidence`, how the semantic match for retention is computed, the replay script's location and arguments, the choice of the 10 companies (stocks across regions, one or two ETFs) and the wording of the planted sources, and tests (both gates, the skip path still running `_retained_developments`, the trimmed schema accepted by `_evidence`, a missing `mentions` read as empty, the prompt appends keeping the ETF swap test green).
