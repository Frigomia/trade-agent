"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import Image from "next/image";
import { Box, Link, Typography } from "@mui/material";
import { Lock, Sparkles } from "lucide-react";
import { Meter } from "@/components/ui/Meter";
import { panelSx } from "@/components/ui/Panel";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <Image
      src="/los_trading_hermanos_logo.svg"
      alt=""
      width={size}
      height={size}
      style={{ objectFit: "contain", flex: "none" }}
    />
  );
}

const PROMISE = "It shows its work, remembers how past calls turned out, and never places a trade.";
const PARTNER = "An advisory-only reasoning partner. You stay the decision-maker.";
const ADVISORY = "Advisory information only, not investment advice.";

/** The soft field behind every signed-out screen: two faint rings and two low waves (docs/design/auth-redesign). */
function AuthBackdrop() {
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        background: "linear-gradient(135deg, var(--auth-f2) 0%, var(--auth-f1) 100%)",
      }}
    >
      <svg viewBox="0 0 1440 900" preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <circle cx="1240" cy="-120" r="560" fill="none" stroke="var(--auth-ring)" strokeWidth="1.5" />
        <circle cx="1240" cy="-120" r="760" fill="none" stroke="var(--auth-ring)" strokeWidth="1.5" />
        <path d="M0 610 C 260 540 430 740 720 790 S 1120 880 1440 790 L1440 900 L0 900 Z" fill="var(--auth-curve1)" />
        <path d="M0 740 C 300 690 520 860 830 900 L0 900 Z" fill="var(--auth-curve2)" />
      </svg>
    </Box>
  );
}

const pill = {
  display: "inline-flex",
  alignItems: "center",
  gap: 1,
  minHeight: 28,
  px: 1.5,
  borderRadius: 999,
  bgcolor: "var(--track)",
  color: "var(--text2)",
  fontSize: "0.75rem",
  fontWeight: 500,
} as const;

/**
 * An illustrative research card, in the app's own anatomy (the two meters, the dashed AI box, the risk
 * to the thesis, the cited sources) over a track-record strip. It is a picture of the product, not
 * data: the company and the figure are made up, and the card says so.
 */
function ProofCard() {
  return (
    <Box sx={{ position: "relative", width: "100%", maxWidth: 500, pb: 7 }}>
      <Box
        component="article"
        aria-label="An illustrative research card"
        sx={{ ...panelSx, position: "relative", zIndex: 2, p: 2.5, display: "grid", gap: 1.75, boxShadow: "var(--auth-card-shadow)" }}
      >
        <Box component="span" sx={{ justifySelf: "start", display: "inline-flex", alignItems: "center", minHeight: 24, px: 1.375, border: "1px dashed var(--line2)", borderRadius: 999, fontSize: "0.75rem", color: "var(--muted)" }}>
          Illustrative example, not a real recommendation
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box aria-hidden sx={{ width: 44, height: 44, borderRadius: "50%", bgcolor: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 650, fontSize: "0.8125rem", flex: "none" }}>
            HS
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="b" sx={{ display: "block", fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.015em", lineHeight: 1.2 }}>
              Halden Systems
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>HLDN · NASDAQ</Typography>
          </Box>
          <Box sx={{ ml: "auto", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            <Typography component="b" sx={{ display: "block", fontSize: "1.125rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
              USD 184.20
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Scan quote · 20 Oct</Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Box component="span" sx={pill}>
            <Meter fill={3} label="High confidence" />
          </Box>
          <Box component="span" sx={pill}>
            <Meter fill={2} label="Medium risk" />
          </Box>
        </Box>
        <Box sx={{ border: "1px dashed var(--line2)", borderRadius: "14px", p: "14px 16px", display: "grid", gap: 1 }}>
          <Typography sx={{ fontSize: "0.9375rem", lineHeight: 1.5 }}>Recurring revenue priced below peers.</Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>
            <Sparkles size={14} aria-hidden color="var(--accent)" style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
            <b>Why now.</b> Q3 results on 6 Nov
          </Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>
            <b>Risk to the thesis.</b> Top customers are 38% of revenue.
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>AI research summary · 2 cited sources</Typography>
        </Box>
      </Box>
      <Box
        sx={{
          ...panelSx,
          position: "absolute",
          zIndex: 1,
          left: "9%",
          right: "-5%",
          bottom: 0,
          height: 96,
          borderRadius: "18px",
          boxShadow: "var(--auth-card-shadow)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 1.5,
          px: 2.25,
          pb: 2,
          fontSize: "0.875rem",
          color: "var(--text2)",
        }}
      >
        <span>Checked 20 trading days later</span>
        <span>
          <Box component="b" sx={{ color: "var(--up)", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
            +3.1%
          </Box>{" "}
          · illustrative
        </span>
      </Box>
    </Box>
  );
}

/**
 * The frame every signed-out screen shares (sign in, reset, accept invitation): a soft field, the
 * brand and the theme toggle, the promise as a headline, and the form in one white card. From md the
 * illustrative research card sits under the headline; on a phone the headline and the card stay
 * together at the top (docs/design/auth-redesign, D1).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "grid", gridTemplateRows: "auto 1fr auto", px: { xs: 2.5, md: "clamp(20px, 4vw, 64px)" }, pt: 3.5, pb: 3 }}>
      <AuthBackdrop />
      <Box component="header" sx={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <BrandMark />
          <Typography sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>trade-agent</Typography>
        </Box>
        <ThemeToggle size={44} />
      </Box>
      <Box
        component="main"
        sx={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 1280,
          mx: "auto",
          py: { xs: 1.5, md: 2.5 },
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) minmax(0, 460px)" },
          gap: { xs: 3.5, md: "clamp(40px, 7vw, 120px)" },
          alignItems: { xs: "start", md: "center" },
          alignContent: { xs: "start", md: "center" },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: "clamp(28px, 5vh, 52px)", minWidth: 0 }}>
          <Box>
            <Typography
              component="p"
              sx={{ fontSize: { xs: "1.875rem", md: "clamp(2rem, 3.9vw, 3.375rem)" }, fontWeight: 650, letterSpacing: "-0.045em", lineHeight: 1.06, maxWidth: { md: "15ch" }, textWrap: "balance" }}
            >
              {PROMISE}
            </Typography>
            <Typography sx={{ color: "var(--text2)", mt: 2, maxWidth: "36ch", fontSize: { xs: "0.9375rem", md: "1.0625rem" }, lineHeight: 1.5 }}>{PARTNER}</Typography>
          </Box>
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <ProofCard />
          </Box>
        </Box>
        <Box
          sx={{
            ...panelSx,
            justifySelf: { md: "end" },
            width: "100%",
            maxWidth: 460,
            minWidth: 0,
            borderRadius: "24px",
            boxShadow: "var(--auth-card-shadow)",
            p: { xs: 3, md: 5 },
            // A little taller than the app's 44px fields, and a larger submit button: this is the front door.
            "& .MuiOutlinedInput-root": { minHeight: 52 },
            "& .MuiInputLabel-root": { fontSize: "0.875rem", fontWeight: 500, color: "var(--text)" },
            "& button[type='submit']": { minHeight: 52, fontSize: "1rem" },
          }}
        >
          {children}
        </Box>
      </Box>
      <Typography component="footer" sx={{ position: "relative", zIndex: 1, maxWidth: 1280, width: "100%", mx: "auto", fontSize: "0.75rem", color: "var(--muted)" }}>
        {ADVISORY}
      </Typography>
    </Box>
  );
}

/** The form heading: the title (the page's one h1) and an optional line under it. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontSize: { xs: "1.625rem", md: "1.875rem" }, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
        {title}
      </Typography>
      {subtitle && <Typography sx={{ color: "var(--muted)", mt: 1, fontSize: "0.9375rem", lineHeight: 1.5 }}>{subtitle}</Typography>}
    </Box>
  );
}

/** The form's fields and button, stacked under the heading inside the card. */
export function AuthPanel({ children }: { children: ReactNode }) {
  return <Box sx={{ mt: 3.5, display: "grid", gap: 2.25, minWidth: 0 }}>{children}</Box>;
}

/** A quiet note at the foot of the card, under a hairline, with a lock: the invitation-only line. */
export function AuthNote({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ mt: 3, pt: 2.5, borderTop: "1px solid var(--line)", display: "flex", gap: 1.5, fontSize: "0.8125rem", lineHeight: 1.5, color: "var(--muted)" }}>
      <Lock size={17} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <span>{children}</span>
    </Box>
  );
}

/** The way out of a screen that has no form: a link back to sign in, at a 44px target. */
export function BackToSignIn() {
  return (
    <Link component={NextLink} href="/login" sx={{ mt: 1.5, display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "0.875rem", fontWeight: 500 }}>
      Back to sign in
    </Link>
  );
}
