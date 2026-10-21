import type { ComponentProps, ElementType } from "react";
import { Box } from "@mui/material";

/**
 * The Soft `.panel`: a white (navy in dark) pane with a 1px hairline, a 22px radius and one soft
 * shadow. Use it for every card, tile and grouped block so they all read as one material
 * (DESIGN.md: "The Quiet Lift Rule").
 */
export const panelSx = {
  backgroundColor: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "22px",
  boxShadow: "var(--shadow)",
} as const;

export function Panel({ sx, ...rest }: ComponentProps<typeof Box> & { component?: ElementType }) {
  return <Box {...rest} sx={[panelSx, ...(Array.isArray(sx) ? sx : [sx])]} />;
}
