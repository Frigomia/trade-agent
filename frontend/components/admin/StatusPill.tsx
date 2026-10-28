import { Ban, Check, Mail } from "lucide-react";
import { Box } from "@mui/material";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { Pill, type PillTone } from "@/components/ui/Pill";

const STATUS = {
  active: { Icon: Check, tone: "accent" },
  invited: { Icon: Mail, tone: "mute" },
  // Amber, not red: red stays for price moves.
  disabled: { Icon: Ban, tone: "warn" },
} as const satisfies Record<AdminUserOut["status"], { Icon: typeof Check; tone: PillTone }>;

/** The status as an icon and a word, never colour alone. */
export function StatusPill({ status }: { status: AdminUserOut["status"] }) {
  const { Icon, tone } = STATUS[status];
  return (
    <Pill tone={tone}>
      <Icon size={12} aria-hidden />
      <Box component="span" sx={{ textTransform: "capitalize" }}>
        {status}
      </Box>
    </Pill>
  );
}

export const RolePill = ({ role }: Pick<AdminUserOut, "role">) => (
  <Box
    component="span"
    sx={{ display: "inline-flex", alignItems: "center", minHeight: 26, px: 1.25, borderRadius: 999, border: "1px solid var(--line2)", color: "var(--text2)", fontSize: "0.75rem", textTransform: "capitalize" }}
  >
    {role}
  </Box>
);
