import { formatAmount } from "@/lib/format";

// Whole part at full strength, decimals dimmed — the mockups' "10,204.10" treatment.
export function Amount({ value, size }: { value: number; size?: number }) {
  const [whole, decimals] = formatAmount(value).split(".");
  return (
    <span style={size ? { fontSize: size, fontWeight: 650 } : undefined}>
      {whole}
      <span style={{ opacity: 0.5 }}>.{decimals}</span>
    </span>
  );
}
