from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from app import plans, telegram, usage
from app.admin import service
from app.auth.deps import CurrentUser, get_current_user, get_known_user, get_user_db
from app.db import get_session_factory
from app.http_headers import no_store
from app.models import (
    AppUser,
    BacktestResult,
    ChatMessage,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    Recommendation,
    TelegramLink,
    Trade,
    WatchlistItem,
)
from app.schemas import (
    AcceptIn,
    BacktestResultOut,
    ChatMessageOut,
    DataDeleteIn,
    ExportOut,
    ExportProfileOut,
    HoldingOut,
    MeOut,
    PortfolioSnapshotOut,
    PreferencesOut,
    RecommendationOut,
    TelegramExportOut,
    TradeOut,
    UsageDetail,
    UsageOut,
    WatchlistItemOut,
)
from app.user_data import delete_user_data

# Invited or active: an invitee finishing signup can reach only these two routes.
router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_known_user)])

# Active only: usage, export, and self-service delete are not part of signing up.
active_router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=MeOut)
def get_me(
    user: CurrentUser = Depends(get_known_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> MeOut:
    with factory() as db:
        row = db.get(AppUser, user.id)
        return MeOut.model_validate(row)


@router.post("/accept", response_model=MeOut)
def accept(
    payload: AcceptIn,
    user: CurrentUser = Depends(get_known_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> MeOut:
    with factory() as db:
        return MeOut.model_validate(service.accept_terms(db, user.id))


@active_router.get("/usage", response_model=UsageOut)
async def get_usage_summary(
    user: CurrentUser = Depends(get_current_user),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> UsageOut:
    analysis_used = await usage.get_usage("analysis_run", str(user.id))
    chat_used = await usage.get_usage("chat", str(user.id))
    return UsageOut(
        analysis_runs=UsageDetail(
            used=analysis_used, limit=usage.effective_limit(user, "analysis_run", defaults)
        ),
        chat_messages=UsageDetail(
            used=chat_used, limit=usage.effective_limit(user, "chat", defaults)
        ),
    )


@active_router.get("/export", response_model=ExportOut, dependencies=[Depends(no_store)])
def export_data(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> ExportOut:
    profile = db.get(AppUser, user.id)
    preferences = db.query(InvestmentPreferences).filter_by(user_id=user.id).one_or_none()
    link = db.query(TelegramLink).filter_by(user_id=user.id).one_or_none()
    return ExportOut(
        profile=ExportProfileOut.model_validate(profile),
        holdings=[
            HoldingOut.model_validate(h) for h in db.query(Holding).filter_by(user_id=user.id)
        ],
        watchlist_items=[
            WatchlistItemOut.model_validate(w)
            for w in db.query(WatchlistItem).filter_by(user_id=user.id)
        ],
        trades=[TradeOut.model_validate(t) for t in db.query(Trade).filter_by(user_id=user.id)],
        recommendations=[
            RecommendationOut.model_validate(r)
            for r in db.query(Recommendation).filter_by(user_id=user.id)
        ],
        chat_messages=[
            ChatMessageOut.model_validate(c)
            for c in db.query(ChatMessage).filter_by(user_id=user.id)
        ],
        backtest_results=[
            BacktestResultOut.model_validate(b)
            for b in db.query(BacktestResult).filter_by(user_id=user.id)
        ],
        investment_preferences=(
            PreferencesOut.model_validate(preferences) if preferences is not None else None
        ),
        portfolio_snapshots=[
            PortfolioSnapshotOut.model_validate(p)
            for p in db.query(PortfolioSnapshot).filter_by(user_id=user.id)
        ],
        contribution_plans=plans.load_all(db, user.id),
        # The settings only: the chat id is never exported.
        telegram=(
            TelegramExportOut(
                status=link.status,
                digest_enabled=link.digest_enabled,
                moves_enabled=link.moves_enabled,
                plan_reminder_enabled=link.plan_reminder_enabled,
                move_threshold_pct=float(link.move_threshold_pct),
            )
            if link is not None
            else None
        ),
    )


@active_router.delete("/data", status_code=204)
async def delete_my_data(
    payload: DataDeleteIn,
    user: CurrentUser = Depends(get_current_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> Response:
    chat_id = await run_in_threadpool(delete_user_data, factory, user.id)
    # After the data is gone; a Redis failure here must not fail the deletion.
    await telegram.forget_chat_quietly(chat_id)
    return Response(status_code=204)
