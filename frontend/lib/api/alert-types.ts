// Mirrors PortfolioAlertOut and PortfolioAlertsOut in backend/app/schemas.py (GET /portfolio/alerts).
export type AlertKind = "new_recommendation" | "earnings_upcoming" | "move_since_purchase";

export interface PortfolioAlert {
  ticker: string;
  name: string | null;
  kind: AlertKind;
  text: string; // a fact or a prior call, never an amount
  when: string | null; // the earnings date (YYYY-MM-DD), for earnings_upcoming
  direction: "up" | "down" | null; // for move_since_purchase
  recommendation_id: number | null; // for new_recommendation
}

export interface PortfolioAlerts {
  alerts: PortfolioAlert[];
  // What could not be looked up, so an absent alert is not read as "nothing to report".
  missing: ("earnings" | "prices")[];
}
