"use client";

import { Suspense } from "react";
import { ConnectClaudeGuide } from "@/components/claude/ConnectClaudeGuide";
import { PageHeader } from "@/components/shell/PageHeader";

export default function ConnectClaudePage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <>
      <PageHeader title="Connect Claude" />
      <Suspense>
        <ConnectClaudeGuide />
      </Suspense>
    </>
  );
}
