"use client";

import { useEffect, useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from "@/lib/theme/applyTheme";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSetting() {
  // Reads localStorage, which the server render cannot, so it syncs after mount (same pattern as
  // ThemeToggle) instead of in the initializer, avoiding a hydration mismatch.
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    const sync = () => setChoice(readThemeChoice());
    sync();
  }, []);

  return (
    <ToggleButtonGroup
      exclusive
      value={choice}
      aria-label="Appearance"
      onChange={(_, next: ThemeChoice | null) => {
        if (!next) return;
        applyThemeChoice(next);
        setChoice(next);
      }}
    >
      {CHOICES.map(({ value, label }) => (
        <ToggleButton key={value} value={value} aria-pressed={choice === value}>
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
