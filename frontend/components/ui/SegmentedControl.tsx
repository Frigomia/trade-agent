"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Box, ButtonBase, type SxProps, type Theme } from "@mui/material";

export interface Segment<K extends string = string> {
  key: K;
  label: string;
  /** Shown instead of `label` below md, so the accessible name is always the visible text. */
  short?: string;
  /** A small round chip after the label. */
  count?: number | string;
  /** An attention chip: accent-tinted, solid when this segment is the chosen one. Hidden from assistive tech, so pass `ariaLabel` with it. */
  alert?: boolean;
  /** Replaces the accessible name when the visible text is not enough (for example "Orders, 2 open orders"). */
  ariaLabel?: string;
  /** Makes the segment a link. Give every segment one or none: the control is then a `nav`, the chosen one `aria-current="page"`. */
  href?: string;
}

interface Props<K extends string> {
  segments: readonly Segment<K>[];
  value: K;
  /** Called with the key of a button segment; not used for links. */
  onChange?: (key: K) => void;
  /** The control's accessible name. */
  label: string;
  /** `compact` is the small range control inside a chart header. */
  size?: "regular" | "compact";
  /** On a phone the segments share the full width in equal columns. */
  fill?: boolean;
  sx?: SxProps<Theme>;
}

// The approved segmented control: a rounded --track tray, the chosen segment a raised --panel pill.
const HEIGHT = { regular: { xs: 44, md: 36 }, compact: { xs: 44, md: 28 } } as const;

function Chip({ children, on, alert, hidden }: { children: ReactNode; on: boolean; alert?: boolean; hidden: boolean }) {
  const [bg, color] = alert
    ? on ? ["var(--accent-solid)", "var(--on-accent)"] : ["var(--accent-wash)", "var(--accent)"]
    : on ? ["var(--accent-wash)", "var(--accent)"] : ["var(--track)", "var(--text2)"];
  return (
    <Box
      component="span"
      data-chip
      aria-hidden={hidden || undefined}
      sx={{ display: "inline-grid", placeItems: "center", minWidth: { xs: 18, md: 22 }, px: { xs: "5px", md: "7px" }, py: "1px", borderRadius: 999, fontSize: "0.75rem", fontWeight: alert ? 650 : 500, lineHeight: 1.3, fontVariantNumeric: "tabular-nums", bgcolor: bg, color }}
    >
      {children}
    </Box>
  );
}

/** Pill-track tabs or filters. A control whose segments have an `href` is a set of links, any other a set of `aria-pressed` buttons. */
export function SegmentedControl<K extends string>({ segments, value, onChange, label, size = "regular", fill = false, sx }: Props<K>) {
  const asNav = segments.every((s) => s.href);
  const compact = size === "compact";
  return (
    <Box
      component={asNav ? "nav" : "div"}
      role={asNav ? undefined : "group"}
      aria-label={label}
      sx={[
        {
          display: fill ? { xs: "grid", md: "flex" } : "inline-flex",
          gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))`,
          gap: "2px",
          p: "3px",
          width: fill ? { xs: "100%", md: "max-content" } : "max-content",
          maxWidth: "100%",
          borderRadius: 999,
          bgcolor: "var(--track)",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {segments.map((s) => {
        const on = s.key === value;
        const body = (
          <>
            {s.short ? (
              <>
                <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>{s.label}</Box>
                <Box component="span" sx={{ display: { xs: "inline", md: "none" } }}>{s.short}</Box>
              </>
            ) : (
              s.label
            )}
            {s.count !== undefined && <Chip on={on} alert={s.alert} hidden={Boolean(s.alert && s.ariaLabel)}>{s.count}</Chip>}
          </>
        );
        const sxSegment = {
          minWidth: compact ? 36 : 0,
          minHeight: HEIGHT[size],
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: { xs: "4px", md: "8px" },
          // A filling control has wide columns on a phone; a loose one needs room around its label.
          px: compact ? 1 : fill ? { xs: "4px", md: "16px" } : { xs: "12px", md: "16px" },
          borderRadius: 999,
          fontSize: compact ? "0.75rem" : { xs: "0.75rem", md: "0.875rem" },
          fontWeight: on ? 650 : 500,
          whiteSpace: "nowrap",
          textDecoration: "none",
          // A link marks the current page in the accent; a filter button keeps the ink colour.
          color: on ? (asNav ? "var(--accent)" : "var(--text)") : "var(--text2)",
          bgcolor: on ? "var(--panel)" : "transparent",
          boxShadow: on ? "var(--shadow)" : "none",
          // ButtonBase sets outline: 0 on its own class, which ties with the global :focus-visible rule.
          "&:focus-visible": { outline: "2px solid var(--focus)", outlineOffset: 2 },
        } as const;
        return s.href ? (
          <ButtonBase key={s.key} component={Link} href={s.href} aria-current={on ? "page" : undefined} aria-label={s.ariaLabel} sx={sxSegment}>
            {body}
          </ButtonBase>
        ) : (
          <ButtonBase key={s.key} aria-pressed={on} aria-label={s.ariaLabel} onClick={() => onChange?.(s.key)} sx={sxSegment}>
            {body}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
