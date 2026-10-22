import { Avatar } from "@mui/material";
import { monogram } from "@/lib/discovery";

/** Company logo with initials when the CDN is unavailable or has no matching ticker. */
export function Logo({ name, ticker, size = 40 }: { name: string; ticker?: string; size?: number }) {
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  const symbol = ticker?.trim().toUpperCase();
  const src = token && symbol
    ? `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(token)}&size=${size * 2}&fallback=404`
    : undefined;

  return (
    <Avatar
      aria-hidden
      alt=""
      src={src}
      slotProps={{ img: { referrerPolicy: "strict-origin-when-cross-origin" } }}
      sx={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        bgcolor: "var(--track)",
        color: "var(--text2)",
        fontWeight: 650,
        fontSize: `${(size * 0.34) / 16}rem`,
        "& .MuiAvatar-img": { objectFit: "contain" },
      }}
    >
      {monogram(name)}
    </Avatar>
  );
}
