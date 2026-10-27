"use client";

import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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
    <SegmentedControl
      label="Appearance"
      value={choice}
      onChange={(next) => {
        applyThemeChoice(next);
        setChoice(next);
      }}
      segments={CHOICES.map(({ value, label }) => ({ key: value, label }))}
      sx={{ width: "100%", "& > *": { flex: 1 } }}
    />
  );
}
