import { Avatar } from "@mui/material";
import { monogram } from "@/lib/discovery";
import { remFromPx } from "@/lib/rem";

/**
 * Company logo with initials when the CDN is unavailable or has no matching ticker. It loads from
 * this app's own /api/logo route, not from Logo.dev, so the ticker and the person's IP stay here.
 */
export function Logo({ name, ticker, size = 40 }: { name: string; ticker?: string; size?: number }) {
  // The token only switches logos on; the route holds the request to Logo.dev.
  const enabled = Boolean(process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN);
  const symbol = ticker?.trim().toUpperCase();
  const src = enabled && symbol ? `/api/logo/${encodeURIComponent(symbol)}?size=${size * 2}` : undefined;

  return (
    <Avatar
      aria-hidden
      alt=""
      src={src}
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
        fontSize: remFromPx(size * 0.34),
        "& .MuiAvatar-img": { objectFit: "contain" },
      }}
    >
      {monogram(name)}
    </Avatar>
  );
}
