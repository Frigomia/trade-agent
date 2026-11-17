# Inspecting the agent in LangSmith

LangSmith tracing is optional and off by default. It covers holdings analysis, discovery scans,
single-company research, chat and scheduled commands. Graph nodes nest under named operations;
Claude calls include model and token usage, while Tavily searches show queries and evidence.
Calls made in worker threads and parallel candidate/ticker tasks retain their parent trace.

## Setup

1. Choose your LangSmith workspace and create a tracing API key.
2. For a project-based workspace, choose a project name, for example
   `trade-agent-development`. For an agent-based workspace, register the external agent once
   in LangSmith, choose its environment, and use that environment's **tracer_session_name**
   as `LANGSMITH_PROJECT`. This is LangSmith's documented compatibility route for project-based
   integrations and works with our locked SDK. Do not substitute the agent's display name.
3. Add the following to `backend/.env` (local) or your backend and scheduler's runtime secrets
   (production). Keep the key out of Git and the frontend:

   ```dotenv
   LANGSMITH_TRACING=true
   LANGSMITH_API_KEY=<your tracing key>
   LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
   LANGSMITH_PROJECT=<project name or environment tracer_session_name>
   LANGSMITH_WORKSPACE_ID=<workspace ID if your key spans multiple workspaces>
   ```

   The endpoint must match the account's region. US accounts use
   `https://api.smith.langchain.com`. These are SDK endpoints: do not append `/otel`.
   This integration explicitly uses `LANGSMITH_PROJECT`; it does not use the newer
   `LANGSMITH_AGENT_ID` / `LANGSMITH_AGENT_ENVIRONMENT` addressing API.
4. Restart the backend. Trigger an analysis, scan, company research or chat in the app, then
   open the chosen project/environment in LangSmith. Expand `analysis.job`, `discovery.job`,
   `discovery.company_job` or `chat.turn`. Scheduled runs start with `scheduled.command`;
   daily theme research appears under `research.daily_mentions`.

The backend reads these settings through Pydantic, so `.env` works without shell exports.
Production web and scheduler processes must both receive the configuration. No LangSmith-hosted
deployment, Claude Agent SDK or frontend integration is required.

## What is exported

Enabling full tracing sends financial holdings, cost bases, preferences, chat text, research
sources, model prompts and responses to your LangSmith workspace. Only enable it in a workspace
whose access and retention settings are appropriate for those users' financial data.

SDK clients, database sessions, key material and user IDs are excluded from structured payloads.
Configured secrets and common credential formats are scrubbed. Raw exception messages and
tracebacks are replaced with `[error details omitted]`; the failed span remains visible.
Job IDs and chat session IDs remain available for correlation. This is credential filtering,
not general anonymization of financial or personal information written in free text.

To keep timing and graph structure while hiding inputs and outputs, set:

```dotenv
LANGSMITH_HIDE_INPUTS=true
LANGSMITH_HIDE_OUTPUTS=true
```

Traces describe executed steps and observable model inputs/outputs, not hidden model reasoning.
Token usage is provided by the SDK; cost display depends on LangSmith's model pricing support.
Provider billing, web-search charges and our monthly application allowance remain separate.

## Reliability and verification

Tracing uses the SDK's background exporter. Missing configuration disables tracing with a
warning; exporter failures do not retry or rerun agent work. Graceful web shutdown and scheduler
exit flush pending traces with a bounded wait. A forced process kill can lose queued traces.
Set `LANGSMITH_TRACING=false` and restart to disable it.

If traces do not appear, check the key, region, workspace, destination and backend logs. The
automated tests use a recording transport and mocked providers; they do not contact LangSmith
or spend Claude/Tavily credit. A real app run is the final delivery check.

References: [LangGraph](https://docs.langchain.com/langsmith/trace-with-langgraph),
[Anthropic](https://docs.langchain.com/langsmith/trace-anthropic),
[privacy controls](https://docs.langchain.com/langsmith/mask-inputs-outputs),
[agent environment compatibility](https://docs.langchain.com/langsmith/create-an-agent#use-an-environment-project).
