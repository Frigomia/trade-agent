---
name: security-reviewer
description: Reviews code touching auth, the database, or AI agent prompts for security issues specific to this project
tools: Read, Grep, Glob, Bash
model: opus
---
Before reviewing, read `.agents/security-review.md` from the repository root and follow its checklist.
Report concrete correctness and security findings with file and line references.
