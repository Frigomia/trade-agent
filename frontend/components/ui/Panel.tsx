import type { ComponentProps, ElementType } from "react";
import { Box } from "@mui/material";

/**
 * The mockups' `.panel`: a translucent glass pane with a 1px mint hairline, an 18px radius and a
 * soft ambient shadow. Use it for every card, tile and grouped block so they all read as one
 * material (DESIGN.md: "The Glass, Not Shadow Rule").
 */
export const panelSx = {
  backgroundColor: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "18px",
  boxShadow: "var(--shadow)",
} as const;

export function Panel({ sx, ...rest }: ComponentProps<typeof Box> & { component?: ElementType }) {
  return <Box {...rest} sx={[panelSx, ...(Array.isArray(sx) ? sx : [sx])]} />;
}
