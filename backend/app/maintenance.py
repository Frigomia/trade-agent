"""One-off maintenance commands, run by hand: ``python -m app.maintenance <command>``.

clean-analyses: strips the model's working notes from web second opinions stored before
``news._final_text`` kept only the closing answer. A dry run by default; ``--apply`` writes.
"""

import argparse
import logging
import re
import sys

from app import db as app_db
from app.models import Recommendation
from app.scheduled import active_user_ids

logger = logging.getLogger(__name__)

# A heading line, as the final answer's markdown starts with one.
_HEADING = re.compile(r"^#{1,6} ", re.MULTILINE)
# First-person working language the model used between searches ("Let me retry...", "Now I have
# enough to write..."). The words before the first heading are only dropped when they read like
# this, so a genuine introduction is never removed.
_WORKING_NOTES = re.compile(
    r"\b(let me|i'll|i will|i need to|i have enough|now i have|that worked|retry|retrying)\b",
    re.IGNORECASE,
)
# The trailing "no instructions found" remark the old prompt provoked, optionally in *italics*.
_SOURCING_NOTE = re.compile(r"\n+\*?\s*note on sourcing:[^\n]*\*?\s*$", re.IGNORECASE)


def strip_narration(text: str) -> str:
    """The stored analysis without its leading working notes and trailing sourcing remark."""
    heading = _HEADING.search(text)
    if heading and heading.start() > 0 and _WORKING_NOTES.search(text[: heading.start()]):
        text = text[heading.start() :]
    return _SOURCING_NOTE.sub("", text).strip()


def clean_analyses(apply: bool) -> tuple[int, int]:
    """(rows changed, rows looked at) across every active user. Each user is read through their
    own row-level-security scope, the same way the scheduled jobs do."""
    changed = 0
    seen = 0
    for user_id in active_user_ids():
        with app_db.scoped_session(user_id) as db:
            rows = db.query(Recommendation).filter(Recommendation.ai_analysis.isnot(None)).all()
            for row in rows:
                seen += 1
                assert row.ai_analysis is not None  # filtered above; narrows the type for mypy
                cleaned = strip_narration(row.ai_analysis)
                if cleaned == row.ai_analysis:
                    continue
                changed += 1
                preview = row.ai_analysis[:70].replace("\n", " ")
                logger.info("%s #%s: %r -> %r", row.ticker, row.id, preview, cleaned[:70])
                if apply:
                    row.ai_analysis = cleaned
            if apply:
                db.commit()
    return changed, seen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.maintenance")
    sub = parser.add_subparsers(dest="command", required=True)
    clean = sub.add_parser("clean-analyses", help="strip working notes from stored analyses")
    clean.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    changed, seen = clean_analyses(apply=args.apply)
    verb = "updated" if args.apply else "would update"
    print(f"{verb} {changed} of {seen} analyses" + ("" if args.apply else " (dry run)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
