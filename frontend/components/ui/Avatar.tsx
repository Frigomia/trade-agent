import { Box } from "@mui/material";

/** The mockups' round initials chip (two letters from the email's local part). */
export function Avatar({ email }: { email: string }) {
  const letters = email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return (
    <Box
      aria-hidden
      sx={{
        width: 30,
        height: 30,
        flex: "none",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: 11,
        fontWeight: 700,
        bgcolor: "var(--field)",
        border: "1px solid var(--line)",
      }}
    >
      {letters}
    </Box>
  );
}
