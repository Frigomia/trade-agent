# Discover company overview and single-company research

Approved by the owner on 2026-10-26: **"Use the proposed layout and policies"** in response to
the explicit #193/#194 question covering layout, charging, refunds, saved outcomes and retries.
The reviewed mock and proposal were merged in [PR #224](https://github.com/Frigomia/trade-agent/pull/224).

- Use the existing desktop and phone layout in [overview.html](overview.html), in light and dark.
- Completed research costs one shared monthly run, including a researched non-opportunity.
- Eligibility refusals and failures cost zero. Refund a reservation once, in its original month.
- Save outcomes durably. Unchanged refusals and completed outcomes have no paid repeat action.
  Refreshing relevant data/preferences can make a refused company eligible again.
- Opening a page is free. Research starts only through an explicit Analyze click.

The implementation branch `feature/discover-company-analysis` covers the free overview/history
APIs, basic page, candidate preparation, shared lock, durable outcomes and explicit research action.
See [SPEC.md](SPEC.md) for the contract and acceptance checks. Approval never places a trade.
