"use client";

import Link from "next/link";
import { ChevronRight, History, ListChecks, LogOut, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { Alert, Box, Button, Typography } from "@mui/material";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
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

export default function AccountPage() {
  const router = useRouter();
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
    <Box sx={{ display: "grid", gap: 2, maxWidth: 560 }}>
      <PageHeader title="Account" />
      {meError && <Alert severity="error">Could not load your account.</Alert>}
      {!meError && me?.email && (
        <>
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
          <Panel component="nav" sx={{ p: "4px 18px" }}>
            {LINKS.map((l) => (
              <Box
                key={l.href}
                component={Link}
                href={l.href}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  py: 1.5,
                  color: "var(--text)",
                  textDecoration: "none",
                  borderBottom: "1px solid var(--line)",
                  "&:last-of-type": { borderBottom: 0 },
                }}
              >
                <l.icon size={18} color="var(--muted)" />
                <Box component="span" sx={{ flex: 1, color: "var(--text)" }}>
                  {l.label}
                </Box>
                <ChevronRight size={18} color="var(--muted)" />
              </Box>
            ))}
          </Panel>
          <Panel sx={{ p: "16px 18px" }}>
            <ChangePasswordForm />
          </Panel>
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
        </>
      )}
    </Box>
  );
}
