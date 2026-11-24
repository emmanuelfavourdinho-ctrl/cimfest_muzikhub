# MuzikHub — Project Instructions

## Project Vision
MuzikHub is a music-industry ecosystem connecting artists, music creators, fans, professionals, event organisers, talent scouts, sponsors, and brands.

It is not merely a music-streaming application or a generic social media platform.

The platform helps users showcase their work, discover talent, build relationships, collaborate, learn, access opportunities, and grow professionally.

## Product Philosophy
MuzikHub follows the SLC principle:

- Simple
- Lovable
- Complete

Build a coherent, polished, genuinely useful product with complete essential workflows.

Do not create fake features, non-functional buttons, placeholder dashboards presented as real functionality, or disconnected modules.

## Core User Journey
Create a profile → Showcase work → Discover talent → Connect and collaborate → Communicate → Learn and grow → Access opportunities → Promote work.

## Technology Stack
- Frontend: React, TypeScript, Vite
- Styling: Tailwind CSS and shadcn/ui
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Authentication: Better Auth
- Payments: Notch Pay
- Shared types and validation: packages/shared
- Testing: Vitest and Supertest

## Architecture
- Use a maintainable npm-workspaces monorepo.
- Keep frontend and backend separate.
- Use modular backend architecture.
- Use REST APIs under /api/v1.
- Keep business logic out of route handlers where practical.
- Validate incoming data.
- Enforce authentication and authorization on the server.
- Never trust frontend-only permission checks.

## Design Direction
MuzikHub uses a Deep Forest, Emerald, and Mint colour palette.

The interface must feel premium, distinctive, music-focused, and professionally designed.

Avoid generic AI-generated dashboard designs, excessive gradients, meaningless statistics, and unnecessary decorative elements.

If a visual prototype or design reference exists in the workspace, inspect it and treat it as the primary design reference.

## Security
- Never expose private API keys or secrets in frontend code.
- Never commit environment files containing secrets.
- Use environment variables for credentials.
- Verify payment status on the backend.
- Never activate paid services based only on a frontend callback.
- Protect user data and enforce role-based permissions.
- Use secure authentication and session handling.

## Development Rules
- Inspect the existing project before modifying it.
- Do not overwrite working code without understanding it.
- Do not introduce unnecessary dependencies.
- Explain important architectural decisions clearly.
- Prefer small, verifiable implementation steps.
- Run relevant tests after implementing functionality.
- Report what was implemented, what was tested, and what remains incomplete.
- Do not claim a feature works unless it has been verified.

## Collaboration
The project owner is a software engineering student who wants to understand the system, not blindly accept generated code.

Explain important implementation decisions in clear, practical language.

Prioritize a reliable, working product over unnecessary complexity.

## Intended Project Structure

The project uses an npm-workspaces monorepo with the following intended structure:

```text
muzikhub/
├── CLAUDE.md
├── README.md
├── package.json
├── .gitignore
├── apps/
│   ├── web/          # React + TypeScript + Vite frontend
│   └── api/          # Express + TypeScript backend
├── packages/
│   └── shared/       # Shared types, schemas, and utilities
└── docs/             # Product, architecture, and technical documentation
```

### Structure Rules
- The existing `muzikhub/` directory is the project root.
- Create all project files and directories directly inside this root.
- Do not create another nested `muzikhub/muzikhub/` directory.
- Keep frontend code inside `apps/web/`.
- Keep backend code inside `apps/api/`.
- Keep genuinely shared code inside `packages/shared/`.
- Keep project documentation inside `docs/`.
- Extend this structure only when there is a clear architectural reason.