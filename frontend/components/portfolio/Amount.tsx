import { formatAmount } from "@/lib/format";
import { remFromPx } from "@/lib/rem";

// Whole part at full strength, decimals dimmed: the mockups' "48,250.32" treatment (`.big .dec`).
// `size` is in pixels at the default browser size; it is applied in rem so a larger setting scales it.
export function Amount({ value, size }: { value: number; size?: number }) {
  const [whole, decimals] = formatAmount(value).split(".");
  return (
    <span
      style={{
        fontWeight: size ? 650 : undefined,
        fontSize: size ? remFromPx(size) : undefined,
        letterSpacing: "-0.035em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {whole}
      <span style={{ opacity: 0.42, fontSize: size ? remFromPx(Math.round(size * 0.68)) : undefined }}>
        .{decimals}
      </span>
    </span>
  );
}
