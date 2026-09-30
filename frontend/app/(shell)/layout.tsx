import { redirect } from "next/navigation";
import { Box } from "@mui/material";
import { resolveSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/Sidebar";
import { TabBar } from "@/components/shell/TabBar";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession();
  if (!session) {
    redirect("/login");
  }
  if (session.status === "invited") {
    redirect("/accept-invitation");
  }
  if (session.status !== "active") {
    redirect("/login");
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar role={session.role} />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Box component="main" sx={{ flex: 1, p: { xs: "16px 16px 8px", md: "22px 24px" } }}>
          {children}
        </Box>
        <TabBar role={session.role} />
      </Box>
    </Box>
  );
}
