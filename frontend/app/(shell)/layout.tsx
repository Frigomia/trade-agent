import { redirect } from "next/navigation";
import { Box } from "@mui/material";
import { resolveSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/Sidebar";
import { TabBar } from "@/components/shell/TabBar";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

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
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 2 }}>
          <ThemeToggle />
        </Box>
        <Box component="main" sx={{ flex: 1, p: 2 }}>
          {children}
        </Box>
        <TabBar role={session.role} />
      </Box>
    </Box>
  );
}
