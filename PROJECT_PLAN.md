# ASI-Portal Complete Build & Deployment Plan

## Current State Analysis

### ✅ What Exists
- Next.js 15 App Router structure
- Basic UI components (shadcn/ui with Radix)
- Dashboard layout with sidebar navigation
- Mock data for leads, jobs, users
- Firebase & Firebase Admin packages installed
- Genkit AI framework setup
- Basic TypeScript types
- Placeholder dashboard pages

### ❌ What's Missing
- **No Firebase client SDK initialization**
- **No Firebase Authentication implementation**
- **No Firestore database setup or collections**
- **No API routes for server-side operations**
- **No environment variables configuration**
- **No Google Calendar API integration**
- **No role-based access control**
- **No protected routes/middleware**
- **No image upload functionality**
- **No Relevance AI integration**
- **All data is hardcoded mock data**
- **No Firebase Security Rules**
- **No email notifications**
- **No PWA configuration**

---

## 🎯 PHASED IMPLEMENTATION PLAN

### **PHASE 1: Foundation & Infrastructure** (Days 1-2)
**Goal**: Set up core authentication, database, and environment configuration

#### 1.1 Environment & Firebase Configuration
- [ ] Create comprehensive `.env.local` template
- [ ] Set up Firebase project credentials
- [ ] Configure Firebase client SDK (`firebaseClient.ts`)
- [ ] Test Firebase Admin SDK connection
- [ ] Set up environment variable validation

#### 1.2 Firebase Collections Schema
- [ ] Create Firestore data model documentation
- [ ] Define all collection structures (users, jobs, leads, etc.)
- [ ] Create TypeScript interfaces for all Firebase documents
- [ ] Set up initial Firebase Security Rules (restrictive)

#### 1.3 Authentication System
- [ ] Implement Firebase Auth client-side hooks
- [ ] Create authentication context provider
- [ ] Build login/signup pages with email/password
- [ ] Implement auto-role assignment logic (@asi-australia.com.au = technician)
- [ ] Set admin emails (joshua@, jaydan@, bobby@)
- [ ] Create user profile creation on first sign-up
- [ ] Build logout functionality

#### 1.4 Route Protection & Middleware
- [ ] Create Next.js middleware for auth checking
- [ ] Implement role-based route guards
- [ ] Set up redirect logic (client → /client/dashboard, technician → /technician/dashboard, admin → /dashboard)
- [ ] Create unauthorized/forbidden pages

**Deliverable**: Working authentication with role-based routing

---

### **PHASE 2: Core API Layer** (Days 3-4)
**Goal**: Build server-side API routes for all major operations

#### 2.1 User Management APIs
- [ ] `POST /api/auth/register` - User registration
- [ ] `GET /api/users/me` - Get current user profile
- [ ] `PATCH /api/users/[id]` - Update user profile
- [ ] `GET /api/users` - List users (admin only)

#### 2.2 Job Lifecycle APIs
- [ ] `POST /api/jobs` - Create new job
- [ ] `GET /api/jobs` - List jobs (filtered by role)
- [ ] `GET /api/jobs/[id]` - Get job details
- [ ] `PATCH /api/jobs/[id]` - Update job
- [ ] `POST /api/jobs/[id]/status` - Update job status
- [ ] `POST /api/jobs/[id]/assign` - Assign technicians
- [ ] Generate auto-increment job numbers

#### 2.3 Inspection APIs
- [ ] `POST /api/inspections` - Create inspection
- [ ] `GET /api/inspections` - List inspections
- [ ] `GET /api/inspections/[id]` - Get inspection details
- [ ] `PATCH /api/inspections/[id]` - Update inspection
- [ ] `POST /api/inspections/[id]/convert` - Convert to job

#### 2.4 CRM/Sales APIs
- [ ] `POST /api/leads` - Create lead
- [ ] `GET /api/leads` - List leads (with pipeline filtering)
- [ ] `PATCH /api/leads/[id]` - Update lead
- [ ] `PATCH /api/leads/[id]/stage` - Move lead stage
- [ ] `POST /api/leads/[id]/notes` - Add activity note
- [ ] `POST /api/leads/[id]/tasks` - Create task
- [ ] `POST /api/leads/import` - CSV bulk import

#### 2.5 File Upload API
- [ ] `POST /api/upload` - Image upload to Firebase Storage
- [ ] Configure storage buckets for damage photos, inspection images
- [ ] Set up image compression/optimization

**Deliverable**: Complete REST API for all core features

---

### **PHASE 3: Frontend Integration** (Days 5-7)
**Goal**: Replace all mock data with real Firebase calls

#### 3.1 Dashboard Pages Conversion
- [ ] Convert `/dashboard` to use real user data & metrics
- [ ] Convert `/dashboard/bookings` to fetch from Firestore
- [ ] Convert `/dashboard/inspections` to real data
- [ ] Convert `/dashboard/films` to real data
- [ ] Add loading states and error handling
- [ ] Implement real-time listeners where appropriate

#### 3.2 Job Lifecycle Module (JLM)
- [ ] Build job creation form with multi-vehicle support
- [ ] Implement damage documentation with photo upload
- [ ] Create quote generation interface
- [ ] Build technician assignment UI
- [ ] Status tracking component with StatusLog
- [ ] Job permissions logic (edit vs read-only)

#### 3.3 Booking Hub
- [ ] Create public booking form (unauthenticated)
- [ ] Build inspection report submission flow
- [ ] Manufacturing/PDI booking form
- [ ] Film installation booking form
- [ ] Auto-job creation on submission
- [ ] Confirmation emails/notifications

#### 3.4 CRM Pipeline Board
- [ ] Build drag-and-drop pipeline board (use dnd-kit or similar)
- [ ] Lead card components with real-time updates
- [ ] Lead detail modal/drawer
- [ ] Notes and activities timeline
- [ ] Task management interface
- [ ] Lead to customer conversion workflow

#### 3.5 Inspection System
- [ ] Multi-vehicle inspection form
- [ ] Damage item entry with photos per vehicle
- [ ] Client approval workflow UI
- [ ] Inspection to job conversion interface
- [ ] Status tracking dashboard

**Deliverable**: Fully functional frontend with Firebase integration

---

### **PHASE 4: Google Calendar Integration** (Days 8-9)
**Goal**: Bidirectional sync with Google Calendar

#### 4.1 OAuth Setup
- [ ] Configure Google Cloud Project
- [ ] Enable Google Calendar API
- [ ] Set up OAuth 2.0 credentials
- [ ] Create consent screen
- [ ] Add redirect URIs

#### 4.2 Calendar Integration
- [ ] `POST /api/calendar/auth` - Initialize OAuth flow
- [ ] `GET /api/calendar/callback` - Handle OAuth callback
- [ ] Store refresh tokens securely in Firestore
- [ ] `POST /api/calendar/events` - Create calendar event
- [ ] `PATCH /api/calendar/events/[id]` - Update event
- [ ] `DELETE /api/calendar/events/[id]` - Delete event

#### 4.3 Calendar UI
- [ ] Build calendar view (Day/Week/Month)
- [ ] Job to calendar event creation
- [ ] Display pending/accepted events
- [ ] Technician availability checking
- [ ] Event sync status indicators

**Deliverable**: Working Google Calendar bidirectional sync

---

### **PHASE 5: Advanced Features** (Days 10-12)
**Goal**: Implement remaining specialized modules

#### 5.1 Asset & Vehicle Tracking
- [ ] Vehicle database with registration lookup
- [ ] Fleet management for multi-vehicle customers
- [ ] Service history tracking per vehicle
- [ ] Vehicle-specific damage reports

#### 5.2 Film Management (APEAX)
- [ ] Film installation tracking
- [ ] 5-year warranty management
- [ ] Service reminders system
- [ ] Claims processing workflow

#### 5.3 Works Register (ISO Compliance)
- [ ] Comprehensive job logging
- [ ] Quality assurance forms
- [ ] ISO 9001/14001/45001 compliance tracking
- [ ] Audit trail reports
- [ ] Service completion documentation

#### 5.4 Customer Portal
- [ ] `/client/dashboard` - Client-specific view
- [ ] Job tracking and history
- [ ] Request new quote interface
- [ ] Inspection review and approval
- [ ] Film warranty lookup
- [ ] Real-time status updates

#### 5.5 Contact Organizations
- [ ] Organization CRUD operations
- [ ] Contact management within organizations
- [ ] ABN/market stream tracking
- [ ] Organization-specific roles

**Deliverable**: All specialized modules operational

---

### **PHASE 6: AI Integration** (Days 13-14)
**Goal**: Connect Relevance AI agents

#### 6.1 Relevance AI Setup
- [ ] Configure Relevance AI API credentials
- [ ] Set up Firebase REST API endpoints for agents
- [ ] Create agent-specific system prompts

#### 6.2 HECTOR (Sales Agent)
- [ ] CRM data access integration
- [ ] Lead qualification automation
- [ ] Pipeline management actions
- [ ] Sales activity logging

#### 6.3 ATLAS (Project Manager)
- [ ] Booking automation workflows
- [ ] Scheduling optimization
- [ ] Job coordination logic
- [ ] Cross-module data aggregation

#### 6.4 Genkit AI Flows
- [ ] Enhance existing flows (summarize-lead-notes, generate-job-descriptions)
- [ ] Create new flows for document generation
- [ ] Quote generation assistance
- [ ] Report summarization

**Deliverable**: AI assistants actively managing workflows

---

### **PHASE 7: Reporting & Analytics** (Days 15-16)
**Goal**: Build comprehensive reporting dashboard

#### 7.1 Financial Reports
- [ ] Revenue tracking by period
- [ ] Job completion statistics
- [ ] Service type breakdown
- [ ] Payment status tracking

#### 7.2 Performance Metrics
- [ ] Technician performance dashboard
- [ ] Job completion rates
- [ ] Average completion times
- [ ] Customer satisfaction scores

#### 7.3 Sales Analytics
- [ ] Pipeline conversion rates
- [ ] Stage velocity metrics
- [ ] Lead source tracking
- [ ] Win/loss analysis

#### 7.4 Compliance Reports
- [ ] ISO audit reports
- [ ] Quality assurance metrics
- [ ] Safety compliance tracking
- [ ] Document export (PDF/CSV)

**Deliverable**: Complete analytics and reporting system

---

### **PHASE 8: Security, Testing & Optimization** (Days 17-18)
**Goal**: Harden security and optimize performance

#### 8.1 Firebase Security Rules
- [ ] Write comprehensive Firestore security rules
- [ ] Storage bucket security rules
- [ ] Role-based read/write permissions
- [ ] Field-level validation rules
- [ ] Test rules thoroughly

#### 8.2 Security Hardening
- [ ] Input validation and sanitization
- [ ] XSS prevention
- [ ] CSRF protection
- [ ] Rate limiting on API routes
- [ ] Secret management audit

#### 8.3 Performance Optimization
- [ ] Implement proper data pagination
- [ ] Add database indexes
- [ ] Optimize image loading (next/image)
- [ ] Code splitting and lazy loading
- [ ] Bundle size optimization

#### 8.4 Error Handling
- [ ] Global error boundary
- [ ] API error standardization
- [ ] User-friendly error messages
- [ ] Error logging and monitoring
- [ ] Fallback UI states

#### 8.5 Testing
- [ ] Manual testing of all workflows
- [ ] Cross-browser testing
- [ ] Mobile responsive testing
- [ ] Role-based access testing
- [ ] Edge case handling

**Deliverable**: Production-ready, secure application

---

### **PHASE 9: Mobile PWA & Polish** (Days 19-20)
**Goal**: Mobile optimization and final touches

#### 9.1 PWA Configuration
- [ ] Create `manifest.json` for PWA
- [ ] Configure service worker for offline capability
- [ ] Add install prompt
- [ ] Configure caching strategies
- [ ] Test offline functionality

#### 9.2 Mobile Optimization
- [ ] Touch-optimized interfaces
- [ ] Mobile navigation improvements
- [ ] Responsive image optimization
- [ ] Mobile form UX improvements
- [ ] Gesture support where appropriate

#### 9.3 Notifications
- [ ] Email notification system (Firebase Functions)
- [ ] Job status update notifications
- [ ] Booking confirmations
- [ ] Assignment notifications for technicians
- [ ] Admin alerts

#### 9.4 Final Polish
- [ ] Design system consistency check
- [ ] Loading states for all async operations
- [ ] Empty states for all lists
- [ ] Success/error toast messages
- [ ] Accessibility improvements (ARIA labels, keyboard nav)

**Deliverable**: Polished, mobile-ready PWA

---

### **PHASE 10: Deployment & Launch** (Days 21-22)
**Goal**: Production deployment and go-live

#### 10.1 Firebase Hosting Setup
- [ ] Configure Firebase App Hosting (per apphosting.yaml)
- [ ] Set production environment variables
- [ ] Configure custom domain
- [ ] SSL certificate setup

#### 10.2 Production Build
- [ ] Run `npm run build` and fix any errors
- [ ] Run `npm run lint` and fix warnings
- [ ] Run `npm run typecheck` and fix type errors
- [ ] Optimize production bundle

#### 10.3 Data Migration
- [ ] Export data from old system (if applicable)
- [ ] Import initial data to Firebase
- [ ] Seed necessary reference data
- [ ] Verify data integrity

#### 10.4 Go-Live Checklist
- [ ] Final security audit
- [ ] Backup strategy confirmation
- [ ] Monitoring and logging setup
- [ ] Performance baseline measurement
- [ ] User documentation/training materials
- [ ] Support process for initial issues

#### 10.5 Launch
- [ ] Deploy to production
- [ ] DNS cutover (if replacing old domain)
- [ ] Monitor initial usage
- [ ] Gather early feedback
- [ ] Address critical issues immediately

**Deliverable**: Live production application

---

## 📦 DEPENDENCIES TO ADD

```bash
# Authentication & Database
npm install firebase-admin firebase

# Google Calendar Integration
npm install googleapis @google-cloud/local-auth

# Drag & Drop for CRM Pipeline
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Date Handling (already have date-fns)
# Form Validation (already have zod, react-hook-form)

# PDF Generation for Reports
npm install jspdf jspdf-autotable

# CSV Export/Import
npm install papaparse
npm install -D @types/papaparse

# Image Optimization
# (Next.js built-in via next/image)

# Environment Variable Validation
npm install envalid
```

---

## 🔧 CRITICAL FILES TO CREATE

1. **`src/lib/firebaseClient.ts`** - Client SDK initialization
2. **`src/lib/firestore.ts`** - Firestore helper functions
3. **`src/lib/auth.ts`** - Auth helper functions
4. **`src/contexts/AuthContext.tsx`** - Auth provider
5. **`src/middleware.ts`** - Route protection
6. **`src/app/login/page.tsx`** - Login page
7. **`src/app/api/auth/*`** - Auth API routes
8. **`src/app/api/jobs/*`** - Job API routes
9. **`src/app/api/leads/*`** - CRM API routes
10. **`firestore.rules`** - Security rules
11. **`storage.rules`** - Storage security rules
12. **`.env.local.example`** - Environment template

---

## ⚠️ CRITICAL PATH ITEMS (Must Complete First)

1. **Firebase Configuration** - Nothing works without this
2. **Authentication** - Required for all protected features
3. **User Management** - Role assignment is core to routing
4. **API Layer** - Frontend needs backend to replace mock data
5. **Firestore Collections** - Data persistence foundation

---

## 🚀 RECOMMENDED WORK ORDER

**Week 1 (Days 1-7)**: Foundation
- Phases 1-3: Auth, APIs, Basic Frontend Integration

**Week 2 (Days 8-14)**: Features
- Phases 4-6: Calendar, Advanced Features, AI Integration

**Week 3 (Days 15-22)**: Polish & Deploy
- Phases 7-10: Reporting, Security, PWA, Deployment

---

## 📊 SUCCESS METRICS

- [ ] All 12 core modules functional
- [ ] Zero hardcoded mock data
- [ ] All users can authenticate and access role-appropriate views
- [ ] Jobs can be created, assigned, tracked, and completed
- [ ] Google Calendar sync works bidirectionally
- [ ] CRM pipeline is fully operational
- [ ] Mobile responsive on all pages
- [ ] Production deployment successful
- [ ] Old app can be decommissioned

---

## NEXT STEPS

**Let's begin with Phase 1.1 - Environment & Firebase Configuration**

This is the foundation everything else builds on. Once we have Firebase properly configured, we can rapidly progress through authentication, APIs, and frontend integration.

Would you like to proceed with Phase 1.1 now?
