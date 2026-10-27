import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { isLevel } from "@/lib/backtest";
import { Pill } from "@/components/ui/Pill";

/**
 * A run's result against buy-and-hold: a pill with an arrow and the words or the signed number, so it
 * is never colour alone. Green and red because it is a return; a result level with buy-and-hold is quiet.
 * `fraction` is the excess return as a fraction (0.048 for +4.8%).
 */
export function EdgePill({ fraction, children }: { fraction: number; children: string }) {
  const level = isLevel(fraction);
  const Icon = fraction < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <Pill tone={level ? "mute" : fraction < 0 ? "down" : "up"}>
      {!level && <Icon size={13} aria-hidden />}
      {children}
    </Pill>
  );
}
