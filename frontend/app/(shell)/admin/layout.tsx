import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession();
  if (!session || session.role !== "admin") {
    redirect("/today");
  }

  return <>{children}</>;
}
