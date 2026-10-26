"""Single-company research with durable outcomes and idempotent quota settlement."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from anthropic import Anthropic
from sqlalchemy.orm import Session

from app import usage
from app.agents.research import ResearchKeyRejected
from app.analysis.discovery_score import is_opportunity
from app.background import make_task_tracker
from app.claude_keys import mark_needs_attention
from app.config import settings
from app.db import lock_and_check_active, scoped_session
from app.discovery import jobs
from app.discovery.company import PreparedCompany, prepare_company
from app.discovery.runner import SCAN_TIMEOUT_SECONDS, _user_inputs, evaluate_candidate
from app.models import CompanyAnalysis, Recommendation, WatchlistItem
from app.portfolio_analytics import load_fit_context
from app.redis_client import _RELEASE_IF_MINE, _RENEW_IF_MINE, get_redis
from app.schemas import CompanyAnalysisOut
from app.schemas_discovery import Exclusion, IdeaOut

logger = logging.getLogger(__name__)
_track = make_task_tracker("company_research")


class CompanyUnavailable(Exception):
    """Company removed, account disabled or usage settlement still pending."""


def _latest(user_id: UUID, ticker: str, job_id: str | None = None) -> CompanyAnalysis | None:
    with scoped_session(user_id) as db:
        if not db.query(WatchlistItem.id).filter_by(user_id=user_id, ticker=ticker).first():
            return None
        query = db.query(CompanyAnalysis).filter_by(user_id=user_id, ticker=ticker)
        if job_id is not None:
            query = query.filter_by(job_id=job_id)
        row = query.order_by(CompanyAnalysis.id.desc()).first()
        if row is not None:
            db.expunge(row)
        return row


def _insert(user_id: UUID, ticker: str, job_id: str, prepared: PreparedCompany) -> CompanyAnalysis:
    with scoped_session(user_id) as db:
        try:
            if (
                not lock_and_check_active(db, user_id)
                or not db.query(WatchlistItem.id).filter_by(user_id=user_id, ticker=ticker).first()
            ):
                raise CompanyUnavailable
            eligible = prepared.candidate is not None
            row = CompanyAnalysis(
                user_id=user_id,
                ticker=ticker,
                job_id=job_id,
                status="running" if eligible else "ineligible",
                researched=False,
                reason="Researching sources." if eligible else prepared.reason[:1000],
                fingerprint=prepared.fingerprint,
                charge_state="reserved" if eligible else "none",
                usage_key=usage._usage_key("analysis_run", str(user_id)) if eligible else None,
                finished_at=None if eligible else datetime.now(UTC).replace(tzinfo=None),
            )
            db.add(row)
            db.flush()
            db.expunge(row)
            db.commit()
            return row
        except Exception:
            db.rollback()
            raise


def _failure(user_id: UUID, job_id: str, reason: str, settled: bool = False) -> bool:
    with scoped_session(user_id) as db:
        try:
            if not lock_and_check_active(db, user_id):
                return True  # only quota settlement remains for a disabled/deleted account
            row = db.query(CompanyAnalysis).filter_by(user_id=user_id, job_id=job_id).first()
            if row is None or row.status not in ("running", "failed"):
                return row is None
            row.status = "failed"
            row.reason = reason
            row.finished_at = datetime.now(UTC).replace(tzinfo=None)
            row.charge_state = "refunded" if settled else "pending"
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise


async def _refund(user_id: UUID, row: CompanyAnalysis, reason: str) -> None:
    if not await asyncio.to_thread(_failure, user_id, row.job_id, reason):
        return  # a concurrent successful commit must never be refunded
    if row.usage_key is not None:
        await usage.refund_company_usage(row.job_id, row.usage_key)
    await asyncio.to_thread(_failure, user_id, row.job_id, reason, True)


async def company_state(
    user_id: UUID, ticker: str, job_id: str | None = None
) -> CompanyAnalysisOut | None:
    row = await asyncio.to_thread(_latest, user_id, ticker, job_id)
    if row is None:
        return None
    if row.status == "running" and await get_redis().get(jobs._active_key(user_id)) != row.job_id:
        # Re-read after the marker: completion commits before releasing it.
        original_id = row.job_id
        row = await asyncio.to_thread(_latest, user_id, ticker, original_id)
        if (
            row is not None
            and row.status == "running"
            and await get_redis().get(jobs._active_key(user_id)) != original_id
        ):
            await _refund(user_id, row, "Research was interrupted.")
        row = await asyncio.to_thread(_latest, user_id, ticker, job_id)
    if row is None:
        return None
    if row.charge_state == "pending":
        try:
            await _refund(user_id, row, row.reason)
            row = await asyncio.to_thread(_latest, user_id, ticker, job_id)
        except Exception as exc:
            logger.warning("Company usage settlement unavailable (%s)", type(exc).__name__)
    if row is None:
        return None
    out = CompanyAnalysisOut.model_validate(row)
    out.can_analyze = row.status == "failed" and row.charge_state == "refunded"
    if row.status == "ineligible":
        try:
            prepared = await prepare_company(user_id, ticker)
            out.can_analyze = prepared.fingerprint != row.fingerprint
        except Exception as exc:
            logger.warning("Company eligibility refresh unavailable (%s)", type(exc).__name__)
    return out


def _save_result(user_id: UUID, job_id: str, result: IdeaOut | Exclusion) -> None:
    with scoped_session(user_id) as db:
        try:
            if not lock_and_check_active(db, user_id):
                raise CompanyUnavailable
            row = db.query(CompanyAnalysis).filter_by(user_id=user_id, job_id=job_id).first()
            if (
                row is None
                or row.status != "running"
                or not db.query(WatchlistItem.id)
                .filter_by(user_id=user_id, ticker=row.ticker)
                .first()
            ):
                raise CompanyUnavailable
            if result.ticker != row.ticker:
                raise ValueError("Company research identity mismatch")
            if isinstance(result, IdeaOut):
                result = IdeaOut.model_validate(result.model_dump())
                row.idea = result.model_dump(mode="json")
                row.reason = result.conclusion[:1000]
            else:
                row.reason = result.explanation[:1000]
            row.status = "no_opportunity"
            if isinstance(result, IdeaOut) and is_opportunity(result):
                db.query(Recommendation).filter_by(
                    user_id=user_id, ticker=row.ticker, source="discovery", status="PENDING"
                ).update({"status": "SUPERSEDED"})
                rec = Recommendation(
                    user_id=user_id,
                    ticker=row.ticker,
                    asset_type=result.asset_type,
                    action="BUY",
                    source="discovery",
                    status="PENDING",
                    reasoning=[result.conclusion],
                    ai_analysis=result.thesis,
                    suggested_position_pct=settings.max_single_position_pct / 2,
                    idea=result.model_dump(mode="json"),
                )
                db.add(rec)
                db.flush()
                row.report_id = rec.id
                row.status = "report"
            row.researched = True
            row.charge_state = "charged"
            row.finished_at = datetime.now(UTC).replace(tzinfo=None)
            db.commit()
        except Exception:
            db.rollback()
            raise


async def run_company(
    user_id: UUID,
    row: CompanyAnalysis,
    prepared: PreparedCompany,
    client: Anthropic,
    uses_saved_key: bool,
) -> None:
    completed = False
    try:
        if prepared.candidate is None:
            raise ValueError("An eligible candidate is required")
        async with asyncio.timeout(SCAN_TIMEOUT_SECONDS):
            holdings, _ = await asyncio.to_thread(_user_inputs, user_id)
            exposure, histories = await load_fit_context(holdings)
            result = await evaluate_candidate(
                prepared.candidate,
                client,
                exposure,
                histories,
                datetime.now(UTC).date(),
                require_research=True,
            )
        if not await get_redis().eval(
            _RENEW_IF_MINE, 1, jobs._active_key(user_id), row.job_id, jobs.ACTIVE_TTL_SECONDS
        ):
            raise CompanyUnavailable

        async def persist() -> None:
            nonlocal completed
            await asyncio.to_thread(_save_result, user_id, row.job_id, result)
            completed = True

        write = asyncio.create_task(persist())
        try:
            await asyncio.shield(write)
        except asyncio.CancelledError:
            await write
            raise
    except (Exception, asyncio.CancelledError) as exc:
        if not completed:
            if isinstance(exc, ResearchKeyRejected) and uses_saved_key:
                try:
                    await asyncio.to_thread(
                        mark_needs_attention, user_id, expected_api_key=client.api_key
                    )
                except Exception as flag_error:
                    logger.warning("Company key status unavailable (%s)", type(flag_error).__name__)
            reason = "Research could not finish."
            if isinstance(exc, ResearchKeyRejected):
                reason = "Your Claude key needs attention."
            try:
                await _refund(user_id, row, reason)
            except Exception as settle_error:
                logger.warning("Company usage settlement pending (%s)", type(settle_error).__name__)
            logger.warning("Company research unavailable (%s)", type(exc).__name__)
        if isinstance(exc, asyncio.CancelledError):
            raise
    finally:
        try:
            await get_redis().eval(_RELEASE_IF_MINE, 1, jobs._active_key(user_id), row.job_id)
        except Exception as release_error:
            logger.warning("Company marker release unavailable (%s)", type(release_error).__name__)


async def _claim_company(user_id: UUID) -> str:
    # Durable company jobs need no temporary scan hash; only the shared atomic claim.
    job_id = str(uuid4())
    if not await get_redis().set(
        jobs._active_key(user_id), job_id, nx=True, ex=jobs.ACTIVE_TTL_SECONDS
    ):
        raise jobs.DiscoveryAlreadyRunning
    return job_id


async def start_company(
    user_id: UUID,
    ticker: str,
    client: Anthropic,
    limit: int,
    uses_saved_key: bool,
) -> CompanyAnalysisOut:
    current = await company_state(user_id, ticker)
    if current is not None and current.status in ("running", "report", "no_opportunity"):
        return current
    if current is not None and current.charge_state == "pending":
        raise CompanyUnavailable
    try:
        job_id = await _claim_company(user_id)
    except jobs.DiscoveryAlreadyRunning:
        current = await company_state(user_id, ticker)
        if current is not None and current.status == "running":
            return current
        raise
    launched = False
    row = None
    try:
        # The earlier read may predate another request's completion and marker release.
        current = await company_state(user_id, ticker)
        if current is not None and current.status in ("running", "report", "no_opportunity"):
            return current
        if current is not None and current.charge_state == "pending":
            raise CompanyUnavailable
        async with asyncio.timeout(120):
            prepared = await prepare_company(user_id, ticker)
        if current is not None and current.status == "ineligible":
            previous = await asyncio.to_thread(_latest, user_id, ticker)
            if previous is not None and previous.fingerprint == prepared.fingerprint:
                return current
        row = await asyncio.to_thread(_insert, user_id, ticker, job_id, prepared)
        out = CompanyAnalysisOut.model_validate(row)
        if prepared.candidate is not None:
            assert row.usage_key is not None
            if not await get_redis().eval(
                _RENEW_IF_MINE, 1, jobs._active_key(user_id), job_id, jobs.ACTIVE_TTL_SECONDS
            ):
                raise CompanyUnavailable
            await usage.reserve_company_usage(
                job_id, row.usage_key, limit, jobs._active_key(user_id)
            )
            _track(asyncio.create_task(run_company(user_id, row, prepared, client, uses_saved_key)))
            launched = True
        return out
    except Exception:
        if row is not None and row.usage_key is not None:
            await _refund(user_id, row, "Research could not start.")
        raise
    finally:
        if not launched:
            await get_redis().eval(_RELEASE_IF_MINE, 1, jobs._active_key(user_id), job_id)


async def company_job_status(user_id: UUID, job_id: str, db: Session) -> dict[str, Any] | None:
    row = db.query(CompanyAnalysis).filter_by(user_id=user_id, job_id=job_id).first()
    ticker = row.ticker if row else None
    db.close()
    if ticker is None:
        return None
    state = await company_state(user_id, ticker, job_id)
    if state is None or state.job_id != job_id:
        return None
    return {
        "status": "RUNNING"
        if state.status == "running"
        else "FAILED"
        if state.status == "failed"
        else "DONE",
        "stage": "researching" if state.status == "running" else state.status,
        "total": 1,
        "done": 0 if state.status == "running" else 1,
        "results": [],
        "scan": None,
        "error": state.reason if state.status == "failed" else None,
        "company": state.model_dump(mode="json"),
    }
