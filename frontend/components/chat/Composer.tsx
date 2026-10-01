import { Box, IconButton, TextField } from "@mui/material";
import { ArrowUp } from "lucide-react";
import { MAX_MESSAGE } from "@/lib/chat";

/** The message box: Enter sends, Shift+Enter adds a line. */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  inputRef,
}: {
  inputRef?: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
      sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}
    >
      <TextField
        fullWidth
        multiline
        maxRows={5}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.slice(0, MAX_MESSAGE))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        slotProps={{ htmlInput: { "aria-label": "Message" } }}
        inputRef={inputRef}
      />
      <IconButton
        type="submit"
        aria-label="Send"
        disabled={disabled || value.trim() === ""}
        sx={{ width: 46, height: 46, bgcolor: "var(--accent-solid)", color: "var(--on-accent)", "&:hover": { bgcolor: "var(--accent-solid)" }, "&.Mui-disabled": { opacity: 0.45, bgcolor: "var(--accent-solid)", color: "var(--on-accent)" } }}
      >
        <ArrowUp size={20} />
      </IconButton>
    </Box>
  );
}
