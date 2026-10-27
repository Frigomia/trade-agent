import { Clock } from "lucide-react";
import { Pill } from "@/components/ui/Pill";

/** "Pending" with a clock: a status is an icon and a word, never a colour alone. */
export function PendingPill() {
  return (
    <Pill tone="warn">
      <Clock size={13} aria-hidden />
      Pending
    </Pill>
  );
}
