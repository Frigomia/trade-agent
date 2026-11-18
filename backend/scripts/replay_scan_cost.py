"""Dev-only replay: does the scan cost less and keep its evidence? (ticket #304)

Not part of the app. Run from backend/ with the dev Claude key (ANTHROPIC_API_KEY) and
TAVILY_API_KEY in .env:

  record  --set FILE --out DIR     on the OLD code (master): run each company in FILE (and the
                                   planted cases) through the real discovery graph against live
                                   Tavily and Claude, saving every search response to
                                   DIR/recording.json. The follow-up search is saved as one fixed
                                   bundle per candidate.
  run     --label old|new --recording DIR/recording.json --set FILE --out DIR
                                   run the same cases through the graph with the search boundary
                                   replayed from the recording (Claude is live) and write
                                   DIR/<label>.json. Run it once on master (old) and once on the
                                   branch (new). A lookup with no recording fails the run.
  compare --old FILE --new FILE    print the checks and PASS or FAIL for each acceptance bar.

Results contain third-party text: keep DIR out of git (backend/.replay/ is ignored).

Run JSON: {"label", "cases": {case_id: {"company", "calls": [{"step", "input_tokens",
"output_tokens", "seconds", "stop_reason"}], "attempted_claims", "accepted_claims", "claims",
"cited_urls", "developments", "catalysts", "exclusion"}}}. Steps: research, follow_up, thesis,
synthesis.
"""

import argparse
import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

PRICE_IN, PRICE_OUT = 2.0, 10.0  # Sonnet 5 list price, dollars per million tokens
OVERLAP_MIN = 0.8  # same URL and this token overlap of the verbatim excerpt = the same claim
ORDINARY_MIN = 0.90  # ordinary high-materiality trusted facts kept, retained over baseline
OUTPUT_DROP_MIN = 0.30  # research output tokens must fall by at least this much
TRUSTED_TIERS = {"official", "reliable_reporting"}
_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
_DATE_FORMS = (
    r"\d{4}-\d{2}-\d{2}",
    rf"\d{{1,2}} (?:{_MONTHS}) \d{{4}}",
    rf"(?:{_MONTHS}) \d{{1,2}}, \d{{4}}",
)
FULL_DATE = re.compile(r"\b(?:" + "|".join(_DATE_FORMS) + r")\b")


class ReplayMissing(RuntimeError):
    """A search had no recording: the replay fails instead of inventing or fetching a result."""


@dataclass
class Recording:
    searches: dict[tuple[str, str], list[dict[str, Any]]]  # (label, query text) -> results
    followups: dict[str, list[dict[str, Any]]]  # ticker -> fixed follow-up bundle
    planted: dict[str, dict[str, list[dict[str, Any]]]]  # ticker -> {"initial": results}

    def lookup(self, label: str, query: str, ticker: str) -> list[dict[str, Any]]:
        if label == "follow-up":  # the query is model-written and may differ between variants
            if ticker not in self.followups:
                raise ReplayMissing(f"no follow-up bundle recorded for {ticker}")
            return self.followups[ticker]
        if ticker in self.planted and "initial" in self.planted[ticker]:
            return self.planted[ticker]["initial"]  # never a live result for a fake company
        if (label, query) in self.searches:
            return self.searches[(label, query)]
        raise ReplayMissing(f"no recording for the {label} search: {query[:60]!r}")


@dataclass
class RetentionResult:
    protected_total: int
    protected_kept: int
    ordinary_total: int
    ordinary_kept: int

    @property
    def ordinary_pct(self) -> float:
        return 100.0 * self.ordinary_kept / self.ordinary_total if self.ordinary_total else 100.0

    @property
    def ok(self) -> bool:
        return (
            self.protected_kept == self.protected_total
            and self.ordinary_pct >= ORDINARY_MIN * 100 - 1e-9
        )

    @property
    def detail(self) -> str:
        return (
            f"protected {self.protected_kept}/{self.protected_total}, "
            f"ordinary {self.ordinary_kept}/{self.ordinary_total} ({self.ordinary_pct:.1f}%)"
        )


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"\w+", text.casefold()))


def _overlap(a: str, b: str) -> float:
    x, y = _tokens(a), _tokens(b)
    return len(x & y) / len(x | y) if x | y else 1.0


def _same_claim(old: dict[str, Any], new: dict[str, Any]) -> bool:
    return old["url"] == new["url"] and _overlap(old["text"], new["text"]) >= OVERLAP_MIN


def retention(
    old_claims: list[dict[str, Any]], new_claims: list[dict[str, Any]], protected_urls: set[str]
) -> RetentionResult:
    """Per company. Protected claims (cited by a development, or stating a full event date) must
    all survive; ordinary high-materiality trusted facts are counted retained over baseline."""
    counts = {"protected": [0, 0], "ordinary": [0, 0]}
    for claim in old_claims:
        if claim["url"] in protected_urls or FULL_DATE.search(claim["text"]):
            kind = "protected"
        elif (
            claim.get("kind") == "fact"
            and claim.get("source_tier") in TRUSTED_TIERS
            and claim.get("materiality") == "high"
        ):
            kind = "ordinary"
        else:
            continue
        counts[kind][0] += 1
        counts[kind][1] += any(_same_claim(claim, new) for new in new_claims)
    return RetentionResult(*counts["protected"], *counts["ordinary"])


def acceptance_share(attempted: int, accepted: int) -> float:
    """The share of the model's claims the validators accepted; zero when nothing was attempted,
    so an empty or quant-only fallback is never counted as a successful extraction."""
    return accepted / attempted if attempted else 0.0


def _sum(run: dict[str, Any], step: str, field: str) -> int:
    return sum(
        c[field] for case in run["cases"].values() for c in case["calls"] if c["step"] == step
    )


def _cost(run: dict[str, Any]) -> float:
    calls = [c for case in run["cases"].values() for c in case["calls"]]
    return sum(c["input_tokens"] * PRICE_IN + c["output_tokens"] * PRICE_OUT for c in calls) / 1e6


def _expected(cid: str, expect: dict[str, Any], case: dict[str, Any]) -> Check:
    """A planted case must behave as the design states, so old == new can never pass vacuously."""
    steps = {c["step"] for c in case["calls"]}
    problems = []
    if "exclusion" in expect and case["exclusion"] != expect["exclusion"]:
        problems.append(f"exclusion {case['exclusion']} (expected {expect['exclusion']})")
    problems += [f"missing step {s}" for s in expect.get("require_steps", []) if s not in steps]
    problems += [f"unexpected step {s}" for s in expect.get("forbid_steps", []) if s in steps]
    urls = {c["url"] for c in case["claims"]}
    problems += [f"missing claim {u}" for u in expect.get("require_urls", []) if u not in urls]
    return Check(f"expect:{cid}", not problems, "; ".join(problems) or "as stated")


def compare_runs(old: dict[str, Any], new: dict[str, Any]) -> list[Check]:
    checks: list[Check] = []
    truncated_new = [
        cid
        for cid, case in new["cases"].items()
        for call in case["calls"]
        if call["stop_reason"] == "max_tokens"
    ]
    truncated_old = sum(
        1
        for case in old["cases"].values()
        for call in case["calls"]
        if call["stop_reason"] == "max_tokens"
    )
    checks.append(
        Check("truncation", not truncated_new, f"new {len(truncated_new)}, old {truncated_old}")
    )
    shares = {}
    for label, run in (("old", old), ("new", new)):
        attempted = sum(c["attempted_claims"] for c in run["cases"].values())
        accepted = sum(c["accepted_claims"] for c in run["cases"].values())
        shares[label] = acceptance_share(attempted, accepted)
    checks.append(
        Check(
            "acceptance",
            shares["new"] >= shares["old"] - 1e-9,
            f"accepted share new {shares['new']:.2f}, old {shares['old']:.2f}",
        )
    )
    for cid, old_case in old["cases"].items():
        new_case = new["cases"].get(cid)
        if new_case is None:
            checks.append(Check(f"case:{cid}", False, "missing from the new run"))
            continue
        result = retention(old_case["claims"], new_case["claims"], set(old_case["cited_urls"]))
        checks.append(Check(f"retention:{cid}", result.ok, result.detail))
        dated = [c for c in old_case["catalysts"] if c.get("occurs_on")]
        lost = [
            c
            for c in dated
            if not any(
                n.get("occurs_on") == c["occurs_on"] and _overlap(c["text"], n["text"]) >= 0.5
                for n in new_case["catalysts"]
            )
        ]
        checks.append(Check(f"catalysts:{cid}", not lost, f"{len(dated) - len(lost)}/{len(dated)}"))
        checks.append(
            Check(
                f"exclusion:{cid}",
                old_case["exclusion"] == new_case["exclusion"],
                f"old {old_case['exclusion']}, new {new_case['exclusion']}",
            )
        )
    expectations = {p["case_id"]: p["expect"] for p in planted_cases()}
    for cid, new_case in new["cases"].items():
        if cid in expectations:
            checks.append(_expected(cid, expectations[cid], new_case))
    old_out, new_out = (
        _sum(old, "research", "output_tokens"),
        _sum(new, "research", "output_tokens"),
    )
    drop = 1 - new_out / old_out if old_out else 0.0
    checks.append(
        Check(
            "output_tokens",
            old_out > 0 and drop >= OUTPUT_DROP_MIN - 1e-9,
            f"research output tokens {old_out} -> {new_out} ({100 * drop:.0f}% lower)",
        )
    )
    for label, run in (("old", old), ("new", new)):
        followups = sum(
            1 for c in run["cases"].values() if any(x["step"] == "follow_up" for x in c["calls"])
        )
        seconds = sum(x["seconds"] for c in run["cases"].values() for x in c["calls"])
        steps = {
            s: sum(1 for c in run["cases"].values() for x in c["calls"] if x["step"] == s)
            for s in ("research", "follow_up", "thesis", "synthesis")
        }
        checks.append(
            Check(
                f"info:{label}",
                True,
                f"calls {steps}, follow-up extractions in {followups}/{len(run['cases'])} cases, "
                f"cost ${_cost(run):.2f}, claude time {seconds:.0f}s",
            )
        )
    return checks


# ---------------------------------------------------------------- live part (needs the keys)


def planted_cases() -> list[dict[str, Any]]:
    """Clearly labelled test sources for a fake company: the events the owner has never had."""

    def src(url: str, text: str) -> dict[str, Any]:
        return {
            "url": url,
            "title": "TEST SOURCE (planted, not real)",
            "content": "TEST SOURCE (planted, not real). " + text,
            "published_date": "2026-10-12",
        }

    licence = "The regulator revoked the company's sole operating licence on 10 October 2026."
    return [
        {
            "expect": {"exclusion": "thesis_invalidated", "require_steps": ["thesis"]},
            "case_id": "planted:starts_confirmed",
            "entry": {"ticker": "PLANT1.TEST", "name": "Planted One (TEST)"},
            "initial": [src("https://www.sec.gov/planted/1", licence)],
            "followup": [],
        },
        {
            "expect": {"exclusion": "thesis_invalidated", "require_steps": ["follow_up", "thesis"]},
            "case_id": "planted:forum_led_confirmed_by_followup",
            "entry": {"ticker": "PLANT2.TEST", "name": "Planted Two (TEST)"},
            "initial": [src("https://www.reddit.com/r/stocks/planted2", "People say " + licence)],
            "followup": [src("https://www.sec.gov/planted/2", licence)],
        },
        {
            "expect": {"exclusion": None, "forbid_steps": ["follow_up", "thesis"]},
            "case_id": "planted:unconfirmed_no_authoritative_source",
            "entry": {"ticker": "PLANT3.TEST", "name": "Planted Three (TEST)"},
            "initial": [src("https://www.reddit.com/r/stocks/planted3", "People say " + licence)],
            "followup": [
                src("https://www.reddit.com/r/stocks/planted3b", "More talk about the licence."),
                src("https://unknown-blog.example/planted3", "A blog repeats the rumour."),
            ],
        },
        {
            "expect": {"require_steps": ["follow_up"]},
            "case_id": "planted:medium_allegation_trusted_bundle",
            "entry": {"ticker": "PLANT4.TEST", "name": "Planted Four (TEST)"},
            "initial": [
                src(
                    "https://www.reuters.com/planted/4a",
                    "A competitor may file a minor complaint about a supplier contract.",
                )
            ],
            "followup": [src("https://www.reuters.com/planted/4b", "The complaint was filed.")],
        },
        {
            "expect": {
                "exclusion": "thesis_invalidated",
                "require_urls": [
                    "https://www.sec.gov/planted/5a",
                    "https://www.reuters.com/planted/5b",
                ],
            },
            "case_id": "planted:supporting_evidence_after_cap",
            "entry": {"ticker": "PLANT5.TEST", "name": "Planted Five (TEST)"},
            "initial": [
                src("https://www.sec.gov/planted/5a", licence),
                src("https://www.reuters.com/planted/5b", licence + " Reuters confirmed it."),
            ],
            "followup": [],
        },
    ]


def _load_app() -> tuple[Any, Any, Any]:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    try:  # a dev-only shim for machines whose antivirus intercepts TLS
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    from app.agents import discovery_graph, research
    from app.config import settings

    return discovery_graph, research, settings


def _candidate(entry: dict[str, Any]) -> Any:
    from tests.discovery_fixtures import sample_candidate

    fields = {k: v for k, v in entry.items() if k != "official_hosts"}
    return sample_candidate().model_copy(update=fields)


class _Meter:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.attempted = 0
        self.accepted = 0
        self.final: Any = None  # the evidence after the follow-up (if any)
        self.research: Any = None  # the evidence the research step produced
        self.missing: list[str] = []  # lookups with no recording; the case fails if any


def _install(mode: str, recording: Recording | None, store: Recording, meter: _Meter) -> dict:
    """Patch the search boundary, the Claude call, and the evidence builders for one process."""
    discovery_graph, research, settings = _load_app()
    settings.tavily_api_key = settings.tavily_api_key or "replay"
    current: dict[str, Any] = {"label": None, "ticker": None}
    real_search, real_gather = research._search, research._gather

    async def budget() -> bool:
        return True

    async def search(http: Any, query: dict[str, Any], key: str) -> list[Any]:
        text, label, ticker = query["query"], current["label"], current["ticker"]
        if mode == "record":
            if ticker in store.planted:  # a fake company: serve its planted sources, no live search
                if label == "follow-up":
                    return store.followups.get(ticker, [])
                return store.planted[ticker]["initial"]
            results = await real_search(http, query, key)
            if label == "follow-up":
                store.followups.setdefault(ticker, results)
            else:
                store.searches[(label, text)] = results
            return results
        assert recording is not None
        try:
            return recording.lookup(label, text, ticker)
        except ReplayMissing as exc:
            meter.missing.append(str(exc))  # the app's _gather swallows search errors
            raise

    async def gather(queries: Any, key: str, origin: Any) -> Any:
        sources: dict[str, Any] = {}
        gaps: list[str] = []
        completed = True
        for label, query in queries:  # one query at a time, so the search knows its label
            current["label"] = label
            found, more, done = await real_gather([(label, query)], key, origin)
            for url, source in found.items():
                sources.setdefault(url, source)
            gaps += more
            completed = completed and done
        return sources, gaps, completed

    prompts = {
        discovery_graph.THESIS_SYSTEM_PROMPT: "thesis",
        discovery_graph.ETF_THESIS_SYSTEM_PROMPT: "thesis",
        discovery_graph.SYNTHESIS_SYSTEM_PROMPT: "synthesis",
        discovery_graph.ETF_SYNTHESIS_SYSTEM_PROMPT: "synthesis",
    }

    def trace(client: Any) -> Any:
        real_create = client.messages.create

        def create(**kwargs: Any) -> Any:
            step = prompts.get(kwargs["system"])
            if step is None:
                data = json.loads(kwargs["messages"][0]["content"])
                step = "follow_up" if "question" in data else "research"
            started = time.monotonic()
            response = real_create(**kwargs)
            meter.calls.append(
                {
                    "step": step,
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "seconds": round(time.monotonic() - started, 1),
                    "stop_reason": response.stop_reason,
                }
            )
            return response

        return SimpleNamespace(messages=SimpleNamespace(create=create))

    real_evidence = research._evidence

    def evidence(ticker: str, name: str, data: Any, sources: Any, gaps: Any, **kw: Any) -> Any:
        result = real_evidence(ticker, name, data, sources, gaps, **kw)
        if isinstance(data, dict):
            meter.attempted += len(data.get("claims") or [])
        meter.accepted += len(result.claims)
        return result

    real_research, real_followup = research.research_candidate, research.follow_up_candidate

    async def research_candidate(*args: Any, **kwargs: Any) -> Any:
        meter.research = meter.final = await real_research(*args, **kwargs)
        return meter.final

    async def follow_up_candidate(*args: Any, **kwargs: Any) -> Any:
        meter.final = await real_followup(*args, **kwargs)
        return meter.final

    research._search, research._gather, research._claim_search_budget = search, gather, budget
    research.trace_anthropic, research._evidence = trace, evidence
    research.research_candidate, research.follow_up_candidate = (
        research_candidate,
        follow_up_candidate,
    )
    return current


def _dump(research_evidence: Any, final: Any, result: Any) -> dict[str, Any]:
    """Retention is measured on the research step's evidence, so the trim is compared on the same
    inputs even where the follow-up gate skips an extraction; the merged evidence is kept apart."""
    claims = (
        [c.model_dump(mode="json") for c in research_evidence.claims] if research_evidence else []
    )
    developments = (
        [d.model_dump(mode="json") for d in research_evidence.negative_developments]
        if research_evidence
        else []
    )
    followup_claims = [c.model_dump(mode="json") for c in final.claims] if final else []
    catalysts = [c.model_dump(mode="json") for c in getattr(result, "catalysts", [])]
    exclusion = (
        getattr(result, "reason", None) if result.__class__.__name__ == "Exclusion" else None
    )
    cited = sorted({u for d in developments for u in d["evidence"]})
    return {
        "claims": claims,
        "followup_claims": followup_claims,
        "developments": developments,
        "catalysts": catalysts,
        "exclusion": exclusion,
        "cited_urls": cited,
    }


async def _run_all(mode: str, args: argparse.Namespace) -> dict[str, Any]:
    from anthropic import Anthropic

    discovery_graph, _research, settings = _load_app()
    recording = None
    store = Recording({}, {}, {})
    if mode != "record":
        raw = json.loads(Path(args.recording).read_text(encoding="utf-8"))
        recording = Recording(
            {(a, b): r for a, b, r in raw["searches"]}, raw["followups"], raw["planted"]
        )
    meter = _Meter()
    planted = {p["entry"]["ticker"]: {"initial": p["initial"]} for p in planted_cases()}
    if mode == "record":
        store.planted = planted
        store.followups.update({p["entry"]["ticker"]: p["followup"] for p in planted_cases()})
    elif recording is not None:
        recording.planted = planted
    current = _install(mode, recording, store, meter)
    client = Anthropic(api_key=settings.anthropic_api_key)
    entries = json.loads(Path(args.set).read_text(encoding="utf-8")) if args.set else []
    cases = [(e["ticker"], e) for e in entries] + [(p["case_id"], p) for p in planted_cases()]
    out: dict[str, Any] = {"label": args.label if mode == "run" else "record", "cases": {}}
    for case_id, entry in cases:
        meter.reset()
        entry = entry.get("entry", entry)
        candidate = _candidate(entry)
        current["ticker"] = candidate.ticker
        hosts = tuple(entry.get("official_hosts", ()))
        try:
            result = await discovery_graph.run_discovery_graph(
                candidate, client, official_hosts=hosts
            )
        except Exception as exc:
            out["cases"][case_id] = {"company": candidate.name, "error": type(exc).__name__}
            continue
        if meter.missing:  # never an empty result, an unavailable note or a live search
            raise ReplayMissing(f"{case_id}: {'; '.join(meter.missing)}")
        out["cases"][case_id] = {
            "company": candidate.name,
            "calls": meter.calls,
            "attempted_claims": meter.attempted,
            "accepted_claims": meter.accepted,
            **_dump(meter.research, meter.final, result),
        }
    if mode == "record":
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "searches": [[a, b, r] for (a, b), r in store.searches.items()],
            "followups": store.followups,
            "planted": planted,
        }
        (out_dir / "recording.json").write_text(json.dumps(payload), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("record", "run"):
        p = sub.add_parser(name)
        p.add_argument("--set", help="JSON list of companies")
        p.add_argument("--out", required=True)
        if name == "run":
            p.add_argument("--label", choices=("old", "new"), required=True)
            p.add_argument("--recording", required=True)
    c = sub.add_parser("compare")
    c.add_argument("--old", required=True)
    c.add_argument("--new", required=True)
    args = parser.parse_args(argv)
    if args.command == "compare":
        old = json.loads(Path(args.old).read_text(encoding="utf-8"))
        new = json.loads(Path(args.new).read_text(encoding="utf-8"))
        checks = compare_runs(old, new)
        for check in checks:
            print(f"{'PASS' if check.ok else 'FAIL'}  {check.name}: {check.detail}")
        return 0 if all(c.ok for c in checks) else 1
    result = asyncio.run(_run_all(args.command, args))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = "record-run.json" if args.command == "record" else f"{args.label}.json"
    (out_dir / name).write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"wrote {out_dir / name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
