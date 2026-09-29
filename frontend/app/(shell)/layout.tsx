import { Box } from "@mui/material";
import { getCurrentRole } from "@/lib/auth/role-stub";
import { Sidebar } from "@/components/shell/Sidebar";
import { TabBar } from "@/components/shell/TabBar";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const role = getCurrentRole();

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar role={role} />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 2 }}>
          <ThemeToggle />
        </Box>
        <Box component="main" sx={{ flex: 1, p: 2 }}>
          {children}
        </Box>
        <TabBar role={role} />
      </Box>
    </Box>
  );
}
