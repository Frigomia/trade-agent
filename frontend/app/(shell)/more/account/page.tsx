"use client";

import { useState, type ElementType } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ChevronRight, History, ListChecks, Lock, LogOut, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { Alert, Box, Button, Typography, useMediaQuery, useTheme } from "@mui/material";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { ClaudeKeyPanel } from "@/components/account/ClaudeKeyPanel";
import { DataActions } from "@/components/account/DataActions";
import { UsageSummary } from "@/components/account/UsageSummary";
import { apiFetch } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";
import type { Usage } from "@/lib/usage";
import { useAction } from "@/lib/useAction";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/shell/PageHeader";

const LINKS = [
  { href: "/more/track-record", label: "Track record", icon: ListChecks },
  { href: "/more/backtests", label: "Backtests", icon: History },
  { href: "/more/preferences", label: "Preferences", icon: SlidersHorizontal },
];

// A settings-list row: muted icon, label, chevron. Renders as a link or a button via `component`.
function SettingsRow({
  icon: Icon,
  label,
  open,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  open?: boolean;
  component: ElementType;
  href?: string;
  type?: "button";
  onClick?: () => void;
  "aria-expanded"?: boolean;
}) {
  return (
    <Box
      {...rest}
      sx={{
        all: "unset",
        boxSizing: "border-box",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1.5,
        cursor: "pointer",
        color: "var(--text)",
        borderBottom: "1px solid var(--line)",
        "&:last-of-type": { borderBottom: 0 },
      }}
    >
      <Icon size={18} color="var(--muted)" />
      <Box component="span" sx={{ flex: 1, color: "var(--text)" }}>
        {label}
      </Box>
      <ChevronRight size={18} color="var(--muted)" style={{ transform: open ? "rotate(90deg)" : undefined }} />
    </Box>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { run, submitting, error } = useAction();
  const { data: me, error: meError } = useSWR<{ email: string }>("/me", apiFetch);
  const { data: usage, error: usageError } = useSWR<Usage>("/me/usage", apiFetch);

  function handleSignOut() {
    void run(async () => {
      await mutate(() => true, undefined, { revalidate: false });
      await createClient().auth.signOut();
      router.push("/login");
    });
  }

  return (
    <Box>
      <PageHeader title="Account" />
      {meError && <Alert severity="error">Could not load your account.</Alert>}
      {!meError && me?.email && (
        <Box sx={{ display: "grid", gap: 2, maxWidth: 680 }}>
          <Box sx={{ display: "grid", gap: 2 }}>
          <Panel sx={{ p: "16px 18px" }}>
            <Typography sx={{ fontSize: 12.5, color: "var(--muted)" }}>Signed in as</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 650, mt: 0.25 }}>{me.email}</Typography>
          </Panel>
          {usage && (
            <Panel sx={{ p: "16px 18px" }}>
              <UsageSummary usage={usage} />
            </Panel>
          )}
          {usageError && <Alert severity="error">Could not load your usage.</Alert>}
          <ClaudeKeyPanel />
          <Panel component="nav" sx={{ p: "4px 18px" }}>
            {LINKS.map((l) => (
              <SettingsRow key={l.href} icon={l.icon} label={l.label} component={Link} href={l.href} />
            ))}
          </Panel>
          </Box>
          <Box sx={{ display: "grid", gap: 2 }}>
          {isDesktop ? (
            <Panel sx={{ p: "16px 18px" }}>
              <ChangePasswordForm />
            </Panel>
          ) : (
            <Panel sx={{ p: "4px 18px" }}>
              <SettingsRow
                icon={Lock}
                label="Change password"
                component="button"
                type="button"
                aria-expanded={passwordOpen}
                onClick={() => setPasswordOpen((open) => !open)}
                open={passwordOpen}
              />
              {passwordOpen && (
                <Box sx={{ pb: 2 }}>
                  <ChangePasswordForm />
                </Box>
              )}
            </Panel>
          )}
          <Panel sx={{ p: "8px 12px" }}>
            <DataActions email={me.email} />
          </Panel>
          <Button
            variant="outlined"
            fullWidth
            startIcon={<LogOut size={18} />}
            onClick={handleSignOut}
            disabled={submitting}
          >
            Sign out
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
