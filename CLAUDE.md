# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on port 9002 (with Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript type check (no emit)
npm run genkit:dev   # Start Genkit AI dev server
npm run genkit:watch # Start Genkit AI dev server with file watching
```

There are no automated tests in this project.

## Architecture

**ASI Portal** is a Next.js 15 (App Router) business operations platform for ASI Australia — a vehicle services company. It covers job lifecycle management, bookings, CRM, inspections, IMS (Incident Management System), and AI-agent tooling.

### Tech Stack
- **Framework**: Next.js 15 App Router with Turbopack
- **Database & Auth**: Firebase (Firestore + Firebase Auth + Firebase Storage)
- **UI**: shadcn/ui components (Radix UI primitives) + Tailwind CSS
- **Forms**: react-hook-form + Zod validation
- **AI**: Genkit with Google Gemini 2.5 Flash (`src/ai/genkit.ts`); OpenAI Agents SDK also present (`@openai/agents`)
- **Google APIs**: Google Calendar (OAuth2), Google Drive

### Route Structure

The `(app)` route group (`src/app/(app)/`) wraps all authenticated routes in a layout that enforces auth via `ProtectedRoute` and sets up providers. Routes are role-gated:

| Path prefix | Roles |
|-------------|-------|
| `/admin` | admin only |
| `/dashboard/*` | admin (most), technician (jobs, calendar, inspections, prestart, IMS library/incidents) |
| `/client/*` | client |
| `/contractor/*` | contractor |
| `/technician/*` | technician |

Role assignment lives in `src/lib/auth.ts`: `@asi-australia.com.au` emails → technician; a hardcoded list of emails → admin; everything else → client/contractor.

### Key Directories

- `src/app/(app)/dashboard/` — Main admin/staff dashboard pages (jobs, bookings, CRM, calendar, IMS, reports, agent hub)
- `src/app/(app)/client/` — Client portal (bookings, inspections, jobs, contacts)
- `src/app/api/` — Next.js Route Handlers (Google Calendar OAuth, admin user management, AI knowledge assistant, agent community, IMS)
- `src/app/actions/` — Next.js Server Actions (AI flows for IMS doc manager and auditor)
- `src/components/` — Shared UI components; `src/components/ui/` is shadcn/ui primitives
- `src/contexts/` — React context providers: `AuthContext`, `JobsContext`, `NotificationsContext`
- `src/lib/` — Shared utilities, types, and data access helpers
- `src/ai/` — Genkit AI configuration and flows

### Firebase Setup

Two Firebase SDKs are used:
- **Client SDK** (`src/lib/firebaseClient.ts`): exports `auth`, `db`, `storage` — used in client components
- **Admin SDK** (`src/lib/firebaseAdmin.ts`): initialized with `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY_B64` (base64-encoded), `FIREBASE_PROJECT_ID` — used only in API routes/server actions

All Firestore collection names are centralised in `src/lib/collections.ts` as the `COLLECTIONS` constant. Generic CRUD helpers are in `src/lib/firestore.ts`.

### Data Types

All shared TypeScript types are in `src/lib/types.ts`. Key domain types:
- `User` / `UserRole` (`admin` | `technician` | `client` | `contractor`)
- `Job`, `Booking`, `Inspection` — core operational entities
- `ContactOrganization` / `OrganizationContact` — CRM entities
- `ImsDocument`, `ImsIncident`, `ImsCorrectiveAction` — IMS entities

### Context Providers (Provider Tree)

Mounted in `src/app/(app)/layout.tsx`:
```
ProtectedRoute → JobsProvider → NotificationsProvider → SidebarProvider
```

`AuthContext` is mounted higher up in `src/app/layout.tsx` (root layout).

### Authentication Flow

1. Firebase Auth handles sign-in (email/password or Google)
2. On auth state change, `AuthContext` fetches the user doc from Firestore `users` collection
3. If no user doc exists, the `/api/auth/accept-invite` route is called to redeem a pending invite
4. Users without an invite are rejected and their Firebase account is deleted
5. Staff profiles (admin/technician) are automatically synced to the `organizationContacts` collection

### Environment Variables

Client-side (prefixed `NEXT_PUBLIC_`):
- `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`

Server-side:
- `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY_B64`, `FIREBASE_PROJECT_ID` — Firebase Admin
- `GOOGLE_GENAI_API_KEY` or `GOOGLE_API_KEY` — Genkit/Gemini
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google Calendar OAuth
- `RELEVANCE_AI_API_KEY` — External Relevance AI agents (HECTOR, ATLAS)
- `OPENAI_API_KEY` — OpenAI Agents SDK

### Style Guidelines

- Dark theme: background `#262633` (dark grayish violet), primary `#8000FF` (violet), accent `#0080FF` (blue)
- Fonts: Inter (body), Space Grotesk (headlines), Source Code Pro (code)
- Card-based layouts with glass morphism
- Toast notifications via `useToast` hook; modal dialogs via shadcn Dialog
