import { Button } from "@mui/material";
import { Bookmark } from "lucide-react";

/**
 * Save to Discover is part of the approved design, but the Discover screen is not built yet, so the
 * button is shown and disabled. Enable it when Discover exists.
 */
export function SaveToDiscover({ name, label = "Save to Discover" }: { name: string; label?: string }) {
  return (
    <Button
      size="small"
      variant="text"
      disabled
      startIcon={<Bookmark size={14} aria-hidden />}
      aria-label={`${label} ${name}: coming soon`}
      title="Coming soon"
      sx={{ color: "var(--muted)", minHeight: { xs: 44, md: 36 } }}
    >
      {label}
    </Button>
  );
}
