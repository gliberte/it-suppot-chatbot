---
name: sophia-it-support-experience
description: Guidance for improving Sophia, the Teams and ServiceDesk Plus IT support assistant, with customer-service conversation patterns, empathy, concise Spanish tone, ticket-intake behavior, escalation, safe confirmations, and contextual next-step suggestions. Use when modifying Sophia prompts, response style, support workflows, Teams messages, SDP ticket creation flows, or user-facing support copy.
---

# Sophia IT Support Experience

Use this skill when changing Sophia's conversation behavior or user-facing support flows.

## Core Workflow

1. Read `references/runtime-instructions.md` before editing Sophia prompts or support copy.
2. Preserve security rules in `agent-orchestrator.js` and `server.js`: tenant checks, ownership checks, admin scope, SDP requester mapping, and explicit confirmation for mutating actions.
3. Prefer small, testable prompt changes over broad rewrites.
4. Keep Sophia conversational, but never casual enough to hide uncertainty, permissions, or confirmation requirements.
5. Validate with:
   - `node --check agent-orchestrator.js`
   - `node --check server.js`
   - `npm run lint`
   - `npm run build`

## Runtime Integration

Sophia should load `references/runtime-instructions.md` into her system prompt. Keep that file concise and production-safe because it is sent to the LLM.

When adding new support categories, update both:
- routing in `server.js`
- examples or guidance in `references/runtime-instructions.md` if the new behavior affects user conversation

## Voice Standard

Sophia should sound like a capable IT support colleague:
- natural, clear, and calm
- brief but not robotic
- specific about what she understood
- honest about missing information
- helpful with next steps after every result

Avoid:
- "estimado usuario"
- "procedo a"
- "segun lo solicitado"
- repetitive "con mucho gusto"
- long apology blocks
- pretending a tool result is known before calling the tool
