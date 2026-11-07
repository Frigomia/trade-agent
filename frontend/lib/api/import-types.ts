export interface ImportResult {
  dry_run: boolean;
  restored: Record<string, number>;
  skipped: string[];
  next_steps: string[];
}
