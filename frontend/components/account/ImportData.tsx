"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { mutate } from "swr";
import { Upload } from "lucide-react";
import { Alert, Box, Button, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { ImportResult } from "@/lib/api/import-types";
import { describeCounts, readImportFile } from "@/lib/importFile";
import { useAction } from "@/lib/useAction";

function CountList({ result }: { result: ImportResult }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: "0.875rem", lineHeight: 1.6 }}>
      {describeCounts(result.restored).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </Box>
  );
}

function Notes({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line) => (
        <Typography key={line} sx={{ color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.55 }}>
          {line}
        </Typography>
      ))}
    </>
  );
}

export function ImportData() {
  const { run, submitting, error, setError } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleChoose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreview(null);
    setResult(null);
    void run(async () => {
      let body: string;
      try {
        body = await readImportFile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        return;
      }
      setPreview(await apiFetch<ImportResult>("/me/import?dry_run=true", { method: "POST", body }));
      setText(body);
    });
  }

  function handleRestore() {
    void run(async () => {
      try {
        setResult(await apiFetch<ImportResult>("/me/import", { method: "POST", body: text }));
      } finally {
        setPreview(null); // a refusal leaves no Restore button; a success moves on to the result
        setText(""); // the file is not kept in memory once it has been sent
      }
      await mutate(() => true, undefined, { revalidate: true });
    });
  }

  function handleCancel() {
    setPreview(null);
    setText("");
    setError(null);
  }

  return (
    <Box sx={{ display: "grid", gap: 1.5 }}>
      <input
        ref={inputRef}
        data-testid="import-file"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleChoose}
      />
      <Button
        variant="text"
        startIcon={<Upload size={18} />}
        onClick={() => inputRef.current?.click()}
        disabled={submitting}
        sx={{ justifyContent: "flex-start", "&.MuiButton-colorPrimary": { color: "var(--text)" } }}
      >
        Import my data
      </Button>
      {preview && (
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <Typography sx={{ fontSize: "0.875rem" }}>This file will restore:</Typography>
          <CountList result={preview} />
          <Notes lines={preview.skipped} />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="contained" onClick={handleRestore} disabled={submitting}>
              Restore
            </Button>
            <Button onClick={handleCancel} disabled={submitting}>
              Cancel
            </Button>
          </Box>
        </Box>
      )}
      {result && (
        <Box sx={{ display: "grid", gap: 1 }}>
          <Typography sx={{ fontSize: "0.875rem" }}>Restored:</Typography>
          <CountList result={result} />
          <Notes lines={[...result.skipped, ...result.next_steps]} />
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
