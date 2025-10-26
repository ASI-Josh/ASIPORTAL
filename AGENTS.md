# ASI-Portal Development Guide

## Commands
- `npm run dev` - Start development server on port 9002 with Turbopack
- `npm run build` - Production build
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run typecheck` - Type-check without emitting files
- `npm run genkit:dev` - Start Genkit AI flows
- `npm run genkit:watch` - Start Genkit with watch mode
- **No test suite configured**

## Architecture
- **Framework**: Next.js 15.3.3 with App Router (`src/app/`)
- **AI**: Firebase Genkit for AI flows (`src/ai/`)
- **UI**: Radix UI + Tailwind CSS + shadcn/ui components (`src/components/ui/`)
- **Deployment**: Firebase App Hosting (configured via `apphosting.yaml`)
- **Path Alias**: `@/*` maps to `src/*`

## Code Style
- **TypeScript**: Strict mode enabled, target ES2017
- **Imports**: Use `@/` alias for all internal imports (e.g., `@/lib/utils`, `@/components/ui/button`)
- **Styling**: Use `cn()` utility from `@/lib/utils` for className merging
- **Components**: React.forwardRef pattern for UI components with `displayName` set
- **Types**: Explicit typing with TypeScript, use `React.ComponentProps<>` for prop extension
