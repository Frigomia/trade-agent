import { formatAmount } from "@/lib/format";

// Whole part at full strength, decimals dimmed: the mockups' "48,250.32" treatment (`.big .dec`).
export function Amount({ value, size }: { value: number; size?: number }) {
  const [whole, decimals] = formatAmount(value).split(".");
  return (
    <span
      style={{
        fontWeight: size ? 650 : undefined,
        fontSize: size,
        letterSpacing: "-0.035em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {whole}
      <span style={{ opacity: 0.42, fontSize: size ? Math.round(size * 0.68) : undefined }}>
        .{decimals}
      </span>
    </span>
  );
}
