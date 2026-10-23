import { createElement } from "react";
import type { LucideProps } from "lucide-react";
import { getSectorIcon } from "@/lib/sectors";

/** Decorative sector icon; callers keep the sector name visible beside it. */
export function SectorIcon({ sector, ...props }: LucideProps & { sector: string | null | undefined }) {
  return createElement(getSectorIcon(sector), { ...props, "aria-hidden": true });
}
