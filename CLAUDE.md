# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup       # First-time setup: install deps, generate Prisma client, run migrations
npm run dev         # Start dev server with Turbopack (http://localhost:3000)
npm run build       # Production build
npm run lint        # ESLint
npm test            # Run all Vitest tests
npx vitest run src/lib/__tests__/file-system.test.ts  # Run a single test file
npm run db:reset    # Reset and re-seed the SQLite database
```

Set `ANTHROPIC_API_KEY` in `.env` to use Claude for generation. Without it, a `MockLanguageModel` is used that returns hardcoded static components.

## Architecture

### Core Concept: Virtual File System

Generated React components live entirely in an in-memory `VirtualFileSystem` (`src/lib/file-system.ts`). Nothing is written to disk. The VFS serializes to JSON and is persisted in the `Project.data` column in SQLite for authenticated users.

### AI Generation Flow

1. User sends a chat message → POST `/api/chat`
2. The route reconstructs a `VirtualFileSystem` from the serialized `files` payload
3. `streamText` (Vercel AI SDK) runs with two tools:
   - `str_replace_editor` — create files, str_replace, insert, view
   - `file_manager` — rename and delete files
4. The model (Claude Haiku via `@ai-sdk/anthropic`, or `MockLanguageModel`) calls these tools to build/edit JSX files in the VFS
5. On finish, the updated VFS and full message history are saved to the `Project` record if the user is authenticated
6. The response is a streaming data stream consumed client-side by Vercel AI SDK's `useChat`

### Client-Side State

- **`FileSystemContext`** (`src/lib/contexts/file-system-context.tsx`): Owns the client-side VFS instance. Intercepts tool calls from the AI stream (`handleToolCall`) to apply VFS mutations in real time as the AI streams.
- **`ChatContext`** (`src/lib/contexts/chat-context.tsx`): Wraps Vercel AI SDK's `useChat`, sends files from the VFS with each message, and routes tool calls to `FileSystemContext`.

### Preview

`PreviewFrame` (`src/components/preview/PreviewFrame.tsx`) renders the virtual files in a sandboxed `<iframe>`. The `jsx-transformer.ts` (`src/lib/transform/jsx-transformer.ts`) uses `@babel/standalone` in the browser to transpile JSX/TSX to plain JS at runtime. Missing imports between virtual files are resolved via the VFS; unresolvable external imports get stub placeholder components.

### Auth

JWT sessions stored in httpOnly cookies (`auth-token`). `src/lib/auth.ts` handles sign/verify using `jose`. `src/middleware.ts` protects `/api/projects` and `/api/filesystem` routes. Server actions for sign up/sign in/sign out are in `src/actions/index.ts`.

### Database

Prisma with SQLite (`prisma/dev.db`). Schema is defined in `src/generated/prisma/schema.prisma`. Two models:
- `User`: email + bcrypt-hashed password
- `Project`: belongs to optional `User`, stores `messages` (JSON array) and `data` (serialized VFS JSON)

Anonymous users can use the app without an account; their projects are not persisted.

### Key File Locations

| Path | Purpose |
|------|---------|
| `src/lib/file-system.ts` | `VirtualFileSystem` class |
| `src/lib/provider.ts` | Model selection: real Claude vs. `MockLanguageModel` |
| `src/lib/transform/jsx-transformer.ts` | Browser-side Babel JSX transform |
| `src/app/api/chat/route.ts` | Main streaming chat endpoint |
| `src/lib/tools/` | AI tool definitions (`str_replace_editor`, `file_manager`) |
| `src/lib/prompts/generation.tsx` | System prompt for component generation |
| `src/lib/contexts/` | React contexts for file system and chat state |
| `src/components/preview/PreviewFrame.tsx` | Iframe-based live preview |
| `src/components/editor/` | Monaco-based code editor + file tree |
| `src/generated/prisma/schema.prisma` | Database schema |

### Path Alias

`@/` maps to `src/` (configured in `tsconfig.json`).

## Code Style

Use comments sparingly. Only comment complex code.
