import { Box } from "@mui/material";

/** The mockups' round initials chip (two letters from the email's local part). */
export function Avatar({ email, size = 30 }: { email: string; size?: number }) {
  const letters = email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: size > 36 ? "0.9375rem" : "0.75rem",
        fontWeight: 700,
        bgcolor: "var(--field)",
        border: "1px solid var(--line)",
      }}
    >
      {letters}
    </Box>
  );
}
