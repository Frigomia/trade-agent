# Cut the Claude cost and time of a scan without lowering its quality (short design)

Date: 2026-11-18. Status: draft for the owner's approval. Size: a small change plus a dev-only replay script that proves it.

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

- Run the follow-up search only for allegations that could matter, and the thesis check only when an exclusion is possible.
- Shrink the research and follow-up output (the number of claims and developments, the unused `mentions` list) so neither hits the 8,192-token limit.
- Prove, on a fixed set of companies, that the evidence the scan relies on does not get worse, and report the saving.

## Non-goals

- A cheaper model for the extraction steps, higher concurrency, parallel Tavily searches, changes to synthesis or the daily mentions batch, and prompt caching (it helps little here). Each is its own change, judged against the same replay.
- Changing any safety rule: verbatim excerpts, forum content never confirmed, untrusted-data handling, the exclusion rules in `exclusion_for`.
- Changing what the owner sees on a retained idea beyond what is stated under "What changes for the user".

## Anti-goals

- Fewer calls that quietly remove real risk flags: a confirmed, corroborated invalidating development must still be found and still lead to an exclusion.
- Savings measured only by guess: nothing merges without the replay numbers.

## Constraints

- Advisory only; nothing here touches orders. Backend rules in `backend/AGENTS.md`.
- An exclusion is only possible when a development is `confirmed`, `invalidates_thesis`, and supported by a trusted high-materiality fact claim (`exclusion_for`, `normalize_evidence`). The gates below are therefore derived from those preconditions, not invented.
- LangSmith content hiding is on in prod, so traces carry token counts and timings but not text; the quality proof therefore needs the local replay, not the traces.

## Approaches

1. **Gate the calls and trim the output, proved by a replay (chosen).** Smallest change, biggest saving (up to about $0.86 plus $0.15 to $0.25 per scan, and about 50 s per company; the gate saving depends on how many candidates still pass it, which the replay measures), no change to the safety rules.
2. **Swap in a cheaper model for the extraction steps.** Possibly the largest saving, but the price and the quality are unmeasured; better judged after approach 1 on the same replay.
3. **Only speed up (more concurrency, parallel searches).** Cuts wall time but not cost; a separate small change.

## Design

- **One definition of "worth following up"** (`app/discovery/thesis.py`): `pending_development` itself changes to return the first development that is not confirmed and cites at least one non-forum claim with materiality `medium` or `high` (low-materiality and forum-only allegations qualify for nothing). `_after_evidence` and `follow_up_search` both already call it, so the gate and the follow-up query always agree on which allegation is chased. Medium counts because the follow-up's fresh claims are re-rated by the model and the exclusion rules apply after it.
- **Thesis-check gate** (`thesis_check`, `app/agents/discovery_graph.py`): call the model only when some development is `confirmed`, has `invalidates_thesis`, and is supported by a trusted high-materiality fact claim, which is what `exclusion_for` needs. On the skip path `_retained_developments(evidence, None)` still runs, so a development left flagged as invalidating is still cleared, annotated "remains unverified" and noted in the gaps, exactly as when the call fails today.
- **Trimmed output, for both research and follow-up** (they share `RESEARCH_SYSTEM_PROMPT` and the schema, so both are trimmed and both are measured; `app/agents/research.py`):
  - `mentions`: remove it from the candidate extraction's tool schema and prompt, and set `mentions=[]` locally when the evidence is built, so the stored and API shape of `ResearchEvidence` is unchanged and the separate daily `discover_mentions()` schema is untouched. Deleting only the prompt instruction would leave the schema asking for the field. The prompt change is appended lines only, so the ETF prompt swap and its test keep matching: "The mentions field is not requested; name other companies only in competitors."
  - Claim cap with a stated priority. The prompt asks for at most `MAX_CLAIMS` ordinary claims, plus whatever is needed for two protected classes that are never dropped and do not count against the cap: (a) every claim cited by a negative development, and every trusted fact that supports one, and (b) every claim whose excerpt states an explicit full event date that a catalyst could use. The ordinary claims are ranked: trusted high-materiality facts first, keeping every distinct outlet for such an event, then the rest by materiality.
  - `MAX_DEVELOPMENTS` negative developments, ranked: confirmed and invalidating first, then by materiality, with all their cited evidence kept.
  - Quotes stay at the current 300-character limit, because dated catalysts need the full event date and the thesis check matches quotes. Starting values `MAX_CLAIMS = 15`, `MAX_DEVELOPMENTS = 5`; the replay may move them.
- **Replay** (dev-only script, not part of the app, no new dependency): for a fixed list of about 10 companies (stocks across regions, one or two ETFs), freeze everything the model sees: the Tavily responses for the initial and the follow-up searches (recorded once, keyed by query, so no variant does a fresh search), the candidate and portfolio inputs, and the model settings. Run the old and the new code through the real discovery graph (`run_discovery_graph`), not extraction alone, with the dev Claude key, and record per run: the actual number of Claude calls, input and output tokens, estimated cost, elapsed time, `stop_reason` per step, the validators' result per attempted claim (the share of the model's claims accepted, so an empty or quant-only fallback is never counted as a success), and the final exclusions, retained developments and dated catalysts. Results stay local and uncommitted; the PR description carries the summary.
- **Planted cases** (clearly labelled test sources and a fake company, added to the replay set because the owner has never had a confirmed invalidating event):
  1. *Starts confirmed:* an authoritative, high-materiality, confirmed negative event. The new code must extract it, pass the thesis-check gate and end in the same `Exclusion`.
  2. *Confirmed through the follow-up:* an unconfirmed allegation that cites a non-forum claim of medium or high materiality, whose frozen follow-up response contains a trusted high-materiality fact. The new code must run exactly one follow-up and one reassessment and end in `Exclusion`. This is the case that fails if the new follow-up gate rejects every allegation.
  3. *Forum-only allegation:* neither paid step runs, and the allegation and its uncertainty stay visible on the retained idea.
  4. *Skip cases:* an allegation that cites only low-materiality claims, or no eligible citation, runs neither step; and a company whose first development is ineligible and a later one is eligible follows up the later one.
  5. *Supporting evidence:* every claim that supports a planted invalidation is still present after the cap.
- **Deterministic tests** (no model): the skip path of `thesis_check` calls `_retained_developments(evidence, None)`, keeps the facts and clears unsupported invalidation flags; `pending_development` returns the first qualifying development (first ineligible, later eligible; forum-only; low materiality; no citation).
- **What the replay must show before merge:**
  - no truncation in research or follow-up, and validators accepting at least as large a share of attempted claims;
  - retention measured per company, as counts and percentages, by validated semantic match (the same cited URL and a high overlap of the verbatim excerpt), not by model-written `event_id` and not by identical excerpts: protected classes (a) and (b) are retained 100%; the other high-materiality trusted facts are retained at least 90% of the lesser of the baseline count and `MAX_CLAIMS`, and the baseline's dated catalysts are all kept. A company whose baseline exceeds the cap is reported explicitly rather than silently passing or failing the 90% rule;
  - all planted cases above behave as stated, and every baseline confirmed and invalidating development ends in the same exclusion;
  - research output tokens down at least 30%, and the measured call counts, tokens, cost and time per company, with the share of candidates that still reach the follow-up. The saving is quoted from those measurements: if most candidates still pass the gate, the saving is the trim alone and the design says so.
- **After merge:** compare the next prod scan in LangSmith (`research.extract` tokens and time, the number of follow-up and thesis spans, cost per scan) with the baseline above.
- **Docs:** `docs/ARCHITECTURE.md` (the follow-up and thesis-check gates, the trimmed output).

## What changes for the user

Forum-only allegations no longer receive an independent confirmation search. This is an intentional trade-off: under the existing rules a forum-only allegation can never confirm or invalidate a thesis, so the search could only have added context.

A retained idea may show a minor or forum-only allegation as an unverified risk, instead of one that a follow-up search tried to confirm or dispute, and the thesis-impact line that the thesis check wrote for unconfirmed allegations is no longer produced for them. Confirmed, corroborated invalidating events still lead to the same exclusion.

## Calls I made (open to correction)

- Gate on the preconditions of `exclusion_for`, so no call is skipped whose answer could change an exclusion.
- Medium or high materiality and a non-forum source as the follow-up gate, with one shared definition in `pending_development`.
- Keep the quotes at 300 characters and cap the number of claims and developments instead, with an explicit ranking, so dates, corroboration and confirmed events survive.
- `MAX_CLAIMS = 15` and `MAX_DEVELOPMENTS = 5` as starting values, tuned by the replay.
- Replay results stay out of the repo (they contain third-party text); only the summary goes in the PR.
- The protected classes (claims supporting a development, claims with an explicit event date) sit outside the claim cap, so the cap can never remove an exclusion's support or a catalyst's date.
- Which step failed on the 8,192-token limit in the prod scan is unknown (the traces carry no text), so both research and follow-up are trimmed and measured.

## Left to the builder

Exact function names, how the trimmed tool schema is built from `ResearchEvidence`, how the semantic match for retention is computed, the replay script's location and arguments, the choice of the 10 companies (stocks across regions, one or two ETFs) and the wording of the planted source, and tests (both gates and the shared `pending_development`, the skip path still running `_retained_developments`, the trimmed schema accepted by `_evidence`, a missing `mentions` read as empty, the prompt appends keeping the ETF swap test green).
