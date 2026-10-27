import { Box, IconButton, TextField } from "@mui/material";
import { ArrowUp } from "lucide-react";
import { MAX_MESSAGE } from "@/lib/chat";

/** The message box: one rounded field with the round Send inside it. Enter sends, Shift+Enter adds a line. */
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
      // The whole rounded field is the target: a click on its padding goes to the text.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.querySelector("textarea")?.focus();
      }}
      sx={{
        display: "flex",
        gap: 1,
        alignItems: "flex-end",
        p: "6px 6px 6px 18px",
        borderRadius: "26px",
        border: "1px solid var(--line2)",
        bgcolor: disabled ? "var(--track)" : "var(--panel)",
        boxShadow: disabled ? "none" : "var(--shadow)",
        "&:focus-within": { outline: "2px solid var(--accent)", outlineOffset: 2 },
      }}
    >
      <TextField
        variant="standard"
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
        slotProps={{ htmlInput: { "aria-label": "Message" }, input: { disableUnderline: true } }}
        sx={{ "& .MuiInputBase-root": { p: 0, fontSize: "0.9375rem" }, "& .MuiInputBase-input": { py: "11px" } }}
        inputRef={inputRef}
      />
      <IconButton
        type="submit"
        aria-label="Send"
        disabled={disabled || value.trim() === ""}
        sx={{ width: 44, height: 44, flex: "none", bgcolor: "var(--accent-solid)", color: "var(--on-accent)", boxShadow: "var(--btn-shadow)", "&:hover": { bgcolor: "var(--accent-solid)" }, "&.Mui-disabled": { boxShadow: "none", opacity: 0.45, bgcolor: "var(--accent-solid)", color: "var(--on-accent)" } }}
      >
        <ArrowUp size={20} />
      </IconButton>
    </Box>
  );
}
