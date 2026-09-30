"use client";

import Link from "next/link";
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
  { href: "/more/track-record", label: "Track record" },
  { href: "/more/backtests", label: "Backtests" },
  { href: "/more/preferences", label: "Preferences" },
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
          <Panel sx={{ p: "16px 18px", display: "grid", gap: 1.5 }}>
            <Typography>
              Signed in as <strong>{me.email}</strong>
            </Typography>
            {usage && <UsageSummary usage={usage} />}
            {usageError && <Alert severity="error">Could not load your usage.</Alert>}
          </Panel>
          <Panel component="nav" sx={{ p: "14px 18px", display: "grid", gap: 1 }}>
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </Panel>
          <Panel sx={{ p: "16px 18px" }}>
            <ChangePasswordForm />
          </Panel>
          <Panel sx={{ p: "16px 18px", display: "grid", gap: 1.5 }}>
            <DataActions email={me.email} />
            <Box>
              <Button variant="outlined" onClick={handleSignOut} disabled={submitting}>
                Sign out
              </Button>
            </Box>
          </Panel>
          {error && <Alert severity="error">{error}</Alert>}
        </>
      )}
    </Box>
  );
}
