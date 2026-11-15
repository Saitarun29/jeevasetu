# JEEVASETU (जीवसेतु) — Comprehensive System Architecture & Implementation Plan
> **Brand Promise:** A bridge between generations.  
> **Core Philosophy:** Technology should strengthen human care, dignity, independence, and continuity.  
> **Status:** Architecture Freeze & Execution Blueprint  
> **Target Deployment:** Google Cloud Run (Node.js/Next.js App Router) + Firebase + Resend

---

## Executive Summary & Document Navigation

This blueprint provides the definitive technical specification and solo hackathon execution roadmap for **JEEVASETU**. It details every component required to satisfy all **6 Mandatory Requirements** and all **8 Differentiating Capabilities** while maintaining strict boundaries around patient data isolation, offline resilience, and non-delegated clinical safety.

### Table of Contents
1. [Complete System Architecture](#1-complete-system-architecture)
2. [Project Folder Structure](#2-project-folder-structure)
3. [Database Schema and Relationships](#3-database-schema-and-relationships)
4. [User Roles and Authorization Matrix](#4-user-roles-and-authorization-matrix)
5. [Authentication and Passcode Invitation Flow](#5-authentication-and-passcode-invitation-flow)
6. [All Application Screens and User Journeys](#6-all-application-screens-and-user-journeys)
7. [API Endpoint Specifications](#7-api-endpoint-specifications)
8. [Medication Scheduling and Adherence Design](#8-medication-scheduling-and-adherence-design)
9. [Email Reminder Architecture and Retry Handling](#9-email-reminder-architecture-and-retry-handling)
10. [Offline Storage, Synchronization and Conflict Resolution](#10-offline-storage-synchronization-and-conflict-resolution)
11. [Care Timeline and Audit-Event Architecture](#11-care-timeline-and-audit-event-architecture)
12. [Caregiver Handover Workflow](#12-caregiver-handover-workflow)
13. [Security Threat Model](#13-security-threat-model)
14. [Testing Strategy](#14-testing-strategy)
15. [Google Cloud Run Deployment Strategy](#15-google-cloud-run-deployment-strategy)
16. [Environment Variables and Secrets Inventory](#16-environment-variables-and-secrets-inventory)
17. [Prioritized Implementation Roadmap with Dependencies](#17-prioritized-implementation-roadmap-with-dependencies)

---


---\n
JEEVASETU is an elderly-care coordination platform designed to bridge the communication and care gap between elderly individuals, their family members, and professional caregivers. Operating under the constraints of a rapid solo hackathon timeline, the architecture emphasizes high developer velocity, zero-maintenance managed infrastructure, edge-resilient offline operation, and dependable scheduled alerting. The following sections detail the end-to-end system topology, component interactions, runtime data flows, architectural trade-offs, and pragmatic risk mitigations tailored for hackathon execution.

---

## 1. High-Level Component Architecture

JEEVASETU employs a unified full-stack architecture powered by the Next.js App Router deployed as a single containerized service on Google Cloud Run, backed by Google Cloud managed serverless primitives.

```mermaid
flowchart TD
    subgraph Client ["Client Tier (Browser / PWA)"]
        UI["Next.js UI (React / App Router)"]
        SW["Service Worker (Fetch Interceptor & Cache)"]
        IDB[("IndexedDB (Offline Outbox & Local State)")]
        UI <--> SW
        SW <--> IDB
    end

    subgraph CDN_Edge ["Edge & Ingress Tier"]
        CDN["Cloud CDN / Cloud Armor"]
    end

    subgraph CloudRun ["Compute Tier (Google Cloud Run)"]
        subgraph NextServer ["Next.js Server (Node.js Runtime)"]
            RSC["Server Components (SSR/RSC)"]
            API["API Route Handlers (/api/*)"]
            AdminSDK["Firebase Admin SDK (Singleton)"]
            API --> AdminSDK
        end
    end

    subgraph External_Services ["Managed Cloud Services"]
        FirebaseAuth["Firebase Authentication"]
        Firestore[("Cloud Firestore (asia-south1)")]
        Scheduler["Google Cloud Scheduler"]
        ResendAPI["Resend Email Service"]
    end

    %% Client Interactions
    UI -- "Static Assets (Cached)" --> CDN
    CDN -- "Origin Shield" --> CloudRun
    UI -- "Direct Auth (OIDC / Phone / Email)" --> FirebaseAuth
    UI -- "Dynamic API Requests" --> API
    UI -. "Real-Time Listeners (Optional)" .-> Firestore

    %% Background & Cloud Scheduler Interactions
    Scheduler -- "POST /api/cron/reminders (OIDC Auth)" --> API
    API -- "Transactional Email Dispatch" --> ResendAPI
    AdminSDK -- "Read / Write Patient & Med Data" --> Firestore

    classDef primary fill:#2563eb,stroke:#1d4ed8,color:#ffffff;
    classDef secondary fill:#059669,stroke:#047857,color:#ffffff;
    classDef storage fill:#d97706,stroke:#b45309,color:#ffffff;
    classDef cloud fill:#4f46e5,stroke:#4338ca,color:#ffffff;

    class UI,RSC,API primary;
    class SW,IDB secondary;
    class Firestore,IDB storage;
    class CloudRun,FirebaseAuth,Scheduler,ResendAPI,CDN cloud;
```

### Component Breakdown and Responsibilities

1. **Client Application (Next.js App Router & PWA):**
   - **Presentation & Interaction:** Mobile-first, accessible interface tailored for elderly users (high-contrast, large touch targets, simplified typography) and comprehensive monitoring dashboards for caregivers.
   - **Client State & Cache:** React Query / SWR for server-state caching and synchronization with optimistic UI mutations.
   - **Firebase Client SDK:** Handles client-side identity authentication (Email/Password, Google Sign-In) and acquires OIDC JSON Web Tokens (JWTs).

2. **Offline Resilience Layer (Service Worker + IndexedDB):**
   - **Service Worker (`service-worker.ts`):** Intercepts network requests using a cache-first strategy for static runtime assets (HTML, CSS, JS, icons) and a network-first fallback strategy for API endpoints.
   - **IndexedDB (`idb` wrapper):** Serves as an offline write-ahead log (Outbox Queue) storing medication adherence actions, vital readings, and offline draft logs with local timestamps.

3. **Compute Tier (Google Cloud Run & Next.js API Routes):**
   - **Unified Backend:** Next.js Route Handlers (`/api/medications`, `/api/cron/*`, `/api/patients`) execute inside a lightweight Node.js 20 Docker container.
   - **Security Enforcement:** Middleware and route handlers verify Firebase ID tokens passed in the `Authorization: Bearer <token>` header, enforcing Role-Based Access Control (RBAC: `elderly`, `family_caregiver`, `medical_admin`).
   - **Firebase Admin SDK:** Runs inside Cloud Run with service account credentials to execute privileged queries, batch writes, and atomic transactions against Firestore.

4. **Persistence Tier (Cloud Firestore):**
   - **NoSQL Document Database:** Holds user profiles, elderly-caregiver relationships, medication schedules, audit trails, and notification logs.
   - **Data Partitioning:** Utilizes subcollections (`patients/{patientId}/medication_logs`) to avoid document write-rate bottlenecks.

5. **Automation & Ingestion Engine (Google Cloud Scheduler):**
   - **Cron Trigger:** Fires an HTTP POST request to `/api/cron/reminders` on an exact 1-minute schedule.
   - **Service-to-Service Security:** Authenticates requests via Google Cloud OIDC tokens signed by a dedicated Service Account, validated cryptographically by the Next.js API route.

6. **Transactional Notification Service (Resend):**
   - **Email Engine:** Dispatches low-latency, templated notification emails (missed doses, critical vital alerts, daily summary reports) to caregivers via Resend’s REST API over HTTPS.

7. **Test & Validation Harness (Vitest & Playwright):**
   - **Vitest:** Fast in-memory unit testing for reminder scheduling algorithms, time-window math, and offline queue state machines.
   - **Playwright:** End-to-end tests validating the critical paths: login flow, medication logging, and offline mutation reconciliation under simulated network disconnection.

---

## 2. End-to-End Data Flows for Key Operations

### 2.1 User Authentication and Session Initialization
```mermaid
sequenceDiagram
    autonumber
    actor User as Caregiver / Elderly User
    participant Client as Client Browser (Next.js)
    participant FBAuth as Firebase Auth Service
    participant API as Cloud Run (/api/auth/sync)
    participant FS as Cloud Firestore

    User->>Client: Enters credentials / Google Login
    Client->>FBAuth: signInWithEmailAndPassword() / signInWithPopup()
    FBAuth-->>Client: Firebase User Credential (ID Token + Refresh Token)
    Client->>API: POST /api/auth/sync (Header: Authorization: Bearer <ID_TOKEN>)
    API->>API: admin.auth().verifyIdToken(token)
    API->>FS: Check / Upsert `users/{uid}` profile
    FS-->>API: User profile & assigned patient IDs
    API-->>Client: HTTP 200 { role, permissions, assignedPatients }
    Client->>Client: Store session state in memory / React Context
```

1. The client signs in via the Firebase Auth Client SDK.
2. The client extracts the short-lived Firebase ID Token (JWT).
3. The token is sent to the `/api/auth/sync` Route Handler.
4. The server validates the token signature using the Firebase Admin SDK.
5. The user's role (`elderly` vs. `caregiver`) is fetched from Firestore; if the user is logging in for the first time, a base document is created.
6. The client hydrates local UI state with user role and active patient links.

### 2.2 Medication Adherence Logging (Online Path)
```mermaid
sequenceDiagram
    autonumber
    actor Elderly as Elderly User / Caregiver
    participant UI as Next.js React UI
    participant API as Cloud Run (/api/medications/log)
    participant FS as Cloud Firestore

    Elderly->>UI: Clicks "Mark Done" on Medication Schedule
    UI->>UI: Optimistic UI update (Checkmark displays immediately)
    UI->>API: POST /api/medications/log { scheduleId, status: "TAKEN", timestamp }
    API->>API: Verify Firebase Auth JWT & access rights
    API->>FS: Run Transaction:
    Note over API,FS: 1. Create `patients/{id}/medication_logs/{logId}`<br/>2. Update `patients/{id}/schedules/{scheduleId}` lastTaken timestamp
    FS-->>API: Transaction Committed
    API-->>UI: HTTP 201 Created { logId, recordedAt }
    UI->>UI: Confirm optimistic state (reconcile with server timestamp)
```

1. The user taps "Mark Done" on an active medication alert.
2. The UI immediately displays a completed status (optimistic update) to provide tactile responsiveness for elderly users.
3. An HTTP POST request is sent to `/api/medications/log` with the payload and user auth token.
4. Cloud Run executes an atomic Firestore transaction that creates a permanent log entry under the patient's subcollection and updates the schedule's `lastTakenAt` field.
5. On success, the client synchronizes the temporary client record with the finalized server timestamp.

### 2.3 Automated Reminder Dispatch
```mermaid
sequenceDiagram
    autonumber
    participant Scheduler as Cloud Scheduler (1-min cron)
    participant API as Cloud Run (/api/cron/reminders)
    participant FS as Cloud Firestore
    participant Resend as Resend API
    actor Caregiver as Caregiver (Email Client)

    Scheduler->>API: POST /api/cron/reminders (Authorization: Bearer <OIDC_TOKEN>)
    API->>API: Validate Google OIDC Token against Service Account email
    API->>FS: Query schedules where:<br/>enabled == true AND<br/>reminderTime <= (now + 2m) AND<br/>lastRemindedAt < todayWindow
    FS-->>API: List of due medication schedules & patient contacts
    loop For each due schedule
        API->>FS: Atomic Update: set `lastRemindedAt = now` (Claim lock)
        alt Claim successful
            API->>Resend: POST /emails { to: caregiver.email, subject, reactTemplate }
            Resend-->>API: 200 OK (Email Queued)
            API->>FS: Append to `patients/{id}/notifications` (status: "SENT")
            Resend->>Caregiver: Delivers transactional notification
        else Already claimed by concurrent worker
            API->>API: Skip schedule
        end
    end
    API-->>Scheduler: HTTP 200 OK { processedCount: N }
```

1. Cloud Scheduler triggers `/api/cron/reminders` every 60 seconds with a signed Google Cloud OIDC token.
2. The Route Handler cryptographically verifies that the caller is the authorized Cloud Scheduler service account.
3. The server executes a composite query against Firestore for all active schedules due within the current time slice that haven't been reminded yet.
4. For each due schedule, the server writes a lock timestamp `lastRemindedAt` atomically to prevent race conditions or duplicate alerts.
5. The server calls Resend's API with an HTML/text template indicating medication name, dose, and patient details.
6. A record of the dispatch is saved in Firestore for compliance and caregiver auditing.

### 2.4 Offline Operation and Synchronization
```mermaid
sequenceDiagram
    autonumber
    actor Elderly as Elderly User (Offline)
    participant UI as Next.js React UI
    participant IDB as IndexedDB (Outbox)
    participant SW as Service Worker
    participant API as Cloud Run (/api/sync/outbox)
    participant FS as Cloud Firestore

    Note over UI,SW: Device loses internet connectivity (navigator.onLine == false)
    Elderly->>UI: Clicks "Mark Done" (Medication taken)
    UI->>UI: Optimistic UI updates with "Pending Sync" badge
    UI->>IDB: Write mutation to outbox: { id, action: "LOG_MED", payload, clientTimestamp }
    
    Note over UI,SW: Device regains internet connection
    SW->>UI: Window receives 'online' event
    UI->>IDB: Read all pending outbox records ordered by timestamp
    IDB-->>UI: [ { mutation1 }, { mutation2 } ]
    UI->>API: POST /api/sync/outbox { mutations: [...] }
    API->>API: Verify Auth Token & validate mutation schemas
    loop Process each mutation
        API->>FS: Apply mutation with server timestamp + original client timestamp
    end
    FS-->>API: All operations committed
    API-->>UI: HTTP 200 OK { syncedIds: [id1, id2] }
    UI->>IDB: Delete synced records from Outbox
    UI->>UI: Remove "Pending Sync" badge (State confirmed)
```

1. When offline, network requests to write APIs fail or are intercepted.
2. The UI catches network errors and writes the pending mutation directly into an IndexedDB table named `outbox`.
3. The UI presents an amber "Saved offline — will sync when connected" badge.
4. When `window.addEventListener('online')` triggers, an Outbox Sync Engine drains the IndexedDB queue in chronological sequence.
5. The batch payload is transmitted to `/api/sync/outbox`.
6. The server applies idempotent writes into Firestore, recording both `clientRecordedAt` (when the senior took the pill) and `serverProcessedAt` (when it synced).
7. The client clears the synchronized items from IndexedDB.

---

## 3. Deployment Topology & Infrastructure

```
                                +-----------------------------+
                                |      End Users & PWAs       |
                                +--------------+--------------+
                                               |
                                     HTTPS (TLS 1.3)
                                               |
                                +--------------v--------------+
                                |      Google Cloud CDN       |
                                | (Origin Shield & Edge Cache)|
                                +--------------+--------------+
                                               |
                                        Proxy Backhaul
                                               |
+--------------------------+    +--------------v--------------+    +--------------------------+
|  Google Cloud Scheduler  |    |       Google Cloud Run      |    |  Resend Email Platform   |
| (Cron: * * * * *)        |--->|  Service: `jeevasetu-web`   |--->|  (smtp.resend.com:443)   |
| Service Account Auth     |    |  Region: asia-south1        |    +--------------------------+
+--------------------------+    |  Scale: 0-3 instances       |
                                +--------------+--------------+
                                               |
                                     GCP VPC / Internal API
                                               |
                                +--------------v--------------+
                                |   Google Cloud Firestore    |
                                |    Location: asia-south1    |
                                |     (Native NoSQL Mode)     |
                                +-----------------------------+
```

### 3.1 Google Cloud Run Service (`jeevasetu-web`)
- **Container Base:** Standalone Next.js multi-stage Docker build utilizing `node:20-alpine` with Next.js `output: 'standalone'`.
- **Region:** `asia-south1` (Mumbai) — selected for lowest round-trip latency to the primary target elderly demographic in India.
- **Resource Sizing:**
  - **Memory:** 512 MiB (sufficient for Next.js App Router standalone node process without memory leaks).
  - **vCPU:** 1.0 vCPU (throttled when not processing requests to conserve budget).
  - **Concurrency:** 80 requests per instance.
  - **Scaling Limits:**
    - `min-instances: 0` (Scale to zero during overnight inactive hours to prevent credit burn).
    - `max-instances: 3` (Strict ceiling to prevent runaway costs during the hackathon).
    - *Hackathon Evaluation Window Override:* Set `min-instances: 1` 30 minutes before demo/judging to eliminate cold starts.

### 3.2 Cloud Scheduler Configuration
- **Job Name:** `jeevasetu-reminder-cron`
- **Schedule:** `* * * * *` (Every minute, 24/7/365).
- **Target Type:** HTTP POST.
- **URL:** `https://jeevasetu-web-<hash>-el.a.run.app/api/cron/reminders`
- **Auth Header:** Google OIDC Token.
  - **Service Account:** `scheduler-invoker@jeevasetu.iam.gserviceaccount.com`
  - **Audience:** `https://jeevasetu-web-<hash>-el.a.run.app`
- **Retry Config:** Max retry attempts: 1; Min backoff: 5s. (Never queue redundant reminder runs if one run stalls).

### 3.3 Cloud Firestore
- **Type:** Firestore Native Mode.
- **Location:** `asia-south1` (Co-located in the identical GCP region as the Cloud Run container to achieve <2ms internal read/write latency).
- **Security Rules:** Enforce strict client-side blocking; all production mutations go through Next.js Route Handlers via the Firebase Admin SDK to guarantee schema enforcement and audit logging during the hackathon.

### 3.4 CDN & Edge Layer
- Cloud CDN sits in front of the Cloud Run origin to cache immutable assets (`/_next/static/*` with `Cache-Control: public, max-age=31536000, immutable`).
- Dynamic HTML pages and `/api/*` routes return `Cache-Control: private, no-cache, no-store` to prevent caching authenticated medical information.

---

## 4. Key Architectural Decisions and Trade-offs

| Decision | What We Chose | Alternatives Considered | Why This Choice Fits Hackathon Context | What We Gave Up (Trade-off) |
| :--- | :--- | :--- | :--- | :--- |
| **Full-Stack Framework** | **Next.js (App Router, TypeScript)** | Separate React SPA + Express / FastAPI backend | Single codebase, shared TypeScript types across frontend and backend, unified build and deployment pipeline. Zero API-drift between UI and server. | Heavy server container image, complex streaming/RSC mental model compared to a pure static SPA. |
| **Primary Database** | **Cloud Firestore** | PostgreSQL (Cloud SQL / Supabase) | Instant schema iterations without migration scripts; built-in real-time listener SDK if live caregiver dashboards are needed; effortless document nesting. | No relational joins, strict query limitations (composite index requirements), lack of atomic multi-collection foreign key constraints. |
| **Authentication** | **Firebase Auth** | Auth0, NextAuth / Auth.js with self-hosted DB | Ready-to-use client SDK with phone/SMS and social auth, robust session token refresh management, built-in user directory, zero maintenance. | Vendor lock-in, client SDK payload size (~30KB gzipped), cold-start initialization delay on server token verification. |
| **Compute Hosting** | **Google Cloud Run** | Vercel, VPS (DigitalOcean / EC2) | Native integration with GCP IAM and Cloud Scheduler, exact container control, cost-efficient scale-to-zero, co-located in region with Firestore. | Cold starts (3–5s on instance spin-up from 0), lacks Vercel’s automated preview deployment edge integration. |
| **Notification Engine**| **Resend** | SendGrid, AWS SES, Twilio SMS | Modern developer DX, React Email support (write email templates in TSX), instantaneous API key setup without complex compliance forms. | SMS/WhatsApp not natively covered (limited to email for hackathon), free tier sending limits (100 emails/day, 3,000/month). |
| **Offline Architecture**| **Custom Service Worker + IndexedDB (`idb`)** | PouchDB / CouchDB, Firebase Offline Persistence | Total control over offline state transitions; Firebase offline SDK has inconsistent persistence behavior inside iOS Safari PWA wrappers. | Requires manual queue management, outbox synchronization logic, and custom conflict resolution code. |

---

## 5. Implementation Risks & Mitigation Strategies

```
+-------------------------------------------------------------------------------------------------------+
|                                    RISK & MITIGATION MATRIX                                           |
+------------------------------------+------------+----------+------------------------------------------+
| Risk Description                   | Severity   | Priority | Primary Mitigation Approach              |
+------------------------------------+------------+----------+------------------------------------------+
| 1. Firebase Auth Cold Starts       | HIGH       | CRITICAL | Admin SDK Singleton + JWT Local Decode   |
| 2. Firestore Document Hot-Spots    | MEDIUM     | HIGH     | Subcollection Partitioning               |
| 3. Cloud Scheduler 1-Min Granularity| MEDIUM     | HIGH     | Sliding Window + Idempotency Locks       |
| 4. Service Worker Cache Invalidation| HIGH       | CRITICAL | Network-First Strategy + Simple Outbox   |
| 5. Email Deliverability & Spam     | MEDIUM     | MEDIUM   | SPF/DKIM Early Setup + In-App Fallback   |
+------------------------------------+------------+----------+------------------------------------------+
```

### Risk 1: Firebase Auth Cold-Start Latency on Cloud Run
- **The Problem:** Cloud Run instances scaling from zero take 2–4 seconds to boot. If the Next.js server also re-initializes the Firebase Admin SDK and performs an outbound network request to fetch Google's public x509 certs on the first request, the initial TTFB will exceed 6 seconds, leading to perceived platform failure during demo judging.
- **Concrete Mitigations:**
  1. **Singleton Initialization:** Keep the Admin SDK instance alive across warm container requests using a global cache pattern.
     ```typescript
     // lib/firebase-admin.ts
     import * as admin from 'firebase-admin';

     if (!admin.apps.length) {
       admin.initializeApp({
         credential: admin.credential.applicationDefault(),
       });
     }
     export const adminDb = admin.firestore();
     export const adminAuth = admin.auth();
     ```
  2. **Judging Warmer:** During the hackathon presentation window, configure Cloud Run with `--min-instances=1` via GCP CLI to eliminate scale-to-zero cold boots entirely.
  3. **Client-Side Token Refresh:** Ensure the client refreshes its token proactively prior to making large API calls via `getIdToken(false)`.

### Risk 2: Firestore Hot-Spotting on Patient Records
- **The Problem:** In Firestore, writing to a single document more than 1 time per second causes contention errors and latency spikes (503 Service Unavailable). If vitals, medication logs, caregiver notes, and alerts are appended into an array inside a single `patients/{patientId}` document, write bursts will fail.
- **Concrete Mitigations:**
  1. **Subcollection Partitioning:** Never store append-only data in arrays within the parent document. All high-frequency data is written to distinct subcollection documents:
     - `patients/{patientId}/medication_logs/{logId}`
     - `patients/{patientId}/vitals/{vitalId}`
  2. **Denormalized Schedule Caches:** The parent `patients/{patientId}` document contains only static profile fields and a minimal summary pointer (e.g., `lastUpdated: timestamp`).

### Risk 3: Cloud Scheduler Granularity (1-Minute Minimum)
- **The Problem:** Cloud Scheduler cannot trigger jobs sub-minute (e.g., exactly at 08:00:15). If an elderly person has a medication scheduled at 08:00:00, a cron running on the minute might process between 08:00:01 and 08:00:05. If a job fails or runs slightly late, medications could be double-alerted or skipped.
- **Concrete Mitigations:**
  1. **Sliding Lookahead Window:** The cron handler does not look for exact timestamps. Instead, it queries a sliding temporal window:
     $$\text{Window} = [\text{CurrentTime} - 60\text{s}, \text{CurrentTime} + 60\text{s}]$$
  2. **Distributed Idempotency Locking:** To guarantee zero duplicate emails, each schedule entry contains a `dispatchLocks` map keyed by date string (`YYYY-MM-DD-HH-mm`). The server updates this field via a Firestore precondition transaction before invoking Resend. If the field exists, the worker skips execution.

### Risk 4: Service Worker Cache Invalidation & iOS Safari Quirks
- **The Problem:** Aggressive service worker caching frequently serves stale JavaScript bundles after code updates during development. Furthermore, Safari on iOS strictly limits background sync APIs and clears IndexedDB storage if the device runs low on disk space or the PWA isn't opened for 7 days.
- **Concrete Mitigations:**
  1. **Network-First for HTML & API:** The service worker never caches HTML navigations or `/api/*` endpoints with cache-first. It uses **Network-First with Cache Fallback** exclusively for data viewing routes.
  2. **Cache-Busting Header Strategy:**
     ```typescript
     // public/sw.js
     self.addEventListener('fetch', (event) => {
       if (event.request.mode === 'navigate') {
         event.respondWith(
           fetch(event.request).catch(() => caches.match('/offline.html'))
         );
       }
     });
     ```
  3. **Visual Storage Indicator:** Display an explicit sync indicator on the dashboard so the elderly user or caregiver knows whether their data is stored locally or safely persisted in the cloud.

### Risk 5: Email Deliverability and Rate Limits (Resend)
- **The Problem:** Custom domain verification (SPF, DKIM, DMARC) via DNS records can take up to 24–48 hours to propagate. Emails sent from unverified domains land directly in spam, or the API rejects the request. Moreover, free-tier accounts have burst limits (2 requests per second).
- **Concrete Mitigations:**
  1. **Pre-Verified Test Domain:** For the hackathon demonstration, utilize Resend’s pre-verified onboarding sandbox (`onboarding@resend.dev`) sending directly to the developer's registered caregiver email account.
  2. **Dual-Channel In-App Fallback:** Never rely solely on email for the demo. Every generated reminder simultaneously writes to a `patients/{id}/notifications` Firestore document. The caregiver dashboard uses a real-time badge and notification drawer, proving the system triggered correctly even if an email is delayed in transit.

---

## 6. Hackathon Execution Scope & Deferrals

To ensure a functional, demo-ready application within the strict time limits of a solo hackathon, the following architectural boundaries are established:

```mermaid
quadrantChart
    title Hackathon Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Value for Demo --> High Value for Demo
    quadrant-1 Must Build (Core MVP)
    quadrant-2 High ROI Shortcuts
    quadrant-3 Defer Entirely
    quadrant-4 Nice to Have (If Time Permits)
    "Next.js App Router Core": [0.3, 0.95]
    "Firebase Auth (Email/Pass)": [0.2, 0.9]
    "Cloud Scheduler Reminder Cron": [0.25, 0.85]
    "Subcollection Firestore Design": [0.15, 0.8]
    "Resend Transactional Email": [0.2, 0.75]
    "Basic IndexedDB Outbox": [0.4, 0.7]
    "Twilio SMS / WhatsApp API": [0.8, 0.6]
    "Multi-Master Conflict Resolution": [0.9, 0.4]
    "Biometric WebAuthn Login": [0.7, 0.3]
    "Complex Role Hierarchies": [0.75, 0.2]
    "Automated DNS SPF/DKIM Propagation": [0.6, 0.35]
```

### In-Scope for Hackathon (Core MVP)
- **Single-Region Deployment:** Everything in `asia-south1` (Cloud Run + Firestore).
- **Unified Authentication:** Email/Password + Google OAuth via Firebase Auth. Simple role claim (`role: 'caregiver' | 'elderly'`) stored in the Firestore user profile.
- **Core Adherence Loop:** Daily medication schedule view, one-click "Mark Done" adherence logging, optimistic UI updates.
- **Automated Alerts:** 1-minute Cloud Scheduler cron checking due medications and sending templated alert emails via Resend.
- **Offline Outbox:** Basic IndexedDB queue capturing offline medication logs and replaying them on the browser's `online` event.
- **Automated Verification:** 3 Vitest test suites (schedule calculations, token verification, offline queue state) + 1 Playwright E2E spec (login $\to$ log medication $\to$ verify audit record).

### Explicitly Deferred to Post-Hackathon Phase
- **Multi-Region Database Replication:** Single-region Firestore is more than adequate for hackathon SLA (<99.9% uptime requirement during judging).
- **Two-Way SMS / WhatsApp Alerts:** Complex business verification and carrier registration requirements with Twilio or Meta WhatsApp Business API take days to approve. Deferred in favor of fast, reliable Resend emails.
- **Vector-Clock / Multi-Master Conflict Resolution:** Concurrent editing of the same medication schedule across multiple devices while offline is deferred; the system employs a pragmatic **Last-Write-Wins (LWW)** strategy using ISO server timestamps.
- **Fine-Grained Organization RBAC:** Hospital administrative tiers, multi-facility permissions, and complex legal guardian role delegation are deferred; authorization is scoped strictly to direct caregiver-to-patient pairings.
- **Background Periodic Sync API:** Background fetch sync when the browser tab is fully closed is inconsistent across iOS Safari. Offline sync is triggered when the application tab is active and regains network connectivity.


---\n
## 2. Project Folder Structure

A production-ready, highly maintainable directory structure for **JEEVASETU**—an elderly-care platform built with Next.js (App Router), TypeScript, Firebase, Vitest, and Playwright. The architecture is optimized for a solo developer: low cognitive overhead, strict type boundaries, fast navigation, and clear separation between client, server, and offline layers.

---

### 2.1 Complete Directory Tree

```text
jeevasetu/
├── app/                                        # Next.js App Router (pages, layouts, route handlers)
│   ├── (auth)/                                 # Route group: unauthenticated onboarding & login
│   │   ├── layout.tsx                          # Auth shell (centered card, calming branding)
│   │   ├── login/
│   │   │   └── page.tsx                        # Phone OTP & password login
│   │   ├── register/
│   │   │   └── page.tsx                        # Role selection: Elderly / Family / Caregiver
│   │   ├── forgot-password/
│   │   │   └── page.tsx                        # Password reset request
│   │   └── reset-password/
│   │       └── page.tsx                        # New password entry
│   ├── (dashboard)/                            # Route group: authenticated application hub
│   │   ├── layout.tsx                          # Dashboard shell (header, sidebar/bottom nav, accessibility bar)
│   │   ├── page.tsx                            # Dynamic role-based routing (Elderly view vs Caregiver view)
│   │   ├── patient/
│   │   │   ├── page.tsx                        # Senior profile overview & medical summary
│   │   │   ├── edit/
│   │   │   │   └── page.tsx                    # Edit personal, emergency, and allergy data
│   │   │   └── vitals/
│   │   │       ├── page.tsx                    # Historical vitals log & trend charts
│   │   │       └── new/
│   │   │           └── page.tsx                # Quick log: BP, Blood Sugar, SpO2, Pulse, Weight
│   │   ├── medication/
│   │   │   ├── page.tsx                        # Daily pill schedule & adherence log
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx                    # Medication details, dosage instructions, refill alert
│   │   │   └── new/
│   │   │       └── page.tsx                    # Add prescription or custom medication
│   │   ├── appointments/
│   │   │   ├── page.tsx                        # Calendar view: upcoming doctor visits & checkups
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx                    # Visit prep, clinic address, transport notes
│   │   │   └── new/
│   │   │       └── page.tsx                    # Schedule new doctor appointment
│   │   ├── timeline/
│   │   │   ├── page.tsx                        # Unified health feed (meds, vitals, incidents, meals)
│   │   │   └── [eventId]/
│   │   │       └── page.tsx                    # Single event detail & caregiver audit log
│   │   ├── caregiver/
│   │   │   ├── page.tsx                        # Caregiver roster, contact directory & shift notes
│   │   │   └── invites/
│   │   │       └── page.tsx                    # Manage family & visiting nurse invitations
│   │   └── settings/
│   │       ├── page.tsx                        # Notification channels (SMS/WhatsApp/Push) & UI scale
│   │       └── emergency-contacts/
│   │           └── page.tsx                    # Priority SOS contact chain management
│   ├── api/                                    # Server-only Route Handlers
│   │   ├── auth/
│   │   │   └── session/
│   │   │       └── route.ts                    # Firebase ID token validation -> HttpOnly session cookie
│   │   ├── notifications/
│   │   │   ├── push/
│   │   │   │   └── route.ts                    # Web Push / FCM reminder dispatcher
│   │   │   └── email/
│   │   │       └── route.ts                    # Transactional email dispatcher (Resend)
│   │   └── emergency/
│   │       └── trigger/
│   │           └── route.ts                    # Critical SOS: SMS/Voice/WhatsApp alerts via Twilio/FCM
│   ├── error.tsx                               # Route-level error boundary
│   ├── global-error.tsx                        # Root layout error boundary
│   ├── globals.css                             # Tailwind CSS v3/v4 & accessibility variables
│   ├── layout.tsx                              # Root layout (HTML, font loading, AuthProvider)
│   ├── loading.tsx                             # Global fallback loading skeleton
│   ├── manifest.ts                             # Web App Manifest for PWA installation
│   ├── not-found.tsx                           # 404 page with high-contrast return button
│   └── robots.ts                               # Search engine indexing directives
├── components/                                 # Reusable UI components
│   ├── ui/                                     # Primitives (Radix / Shadcn-style accessible components)
│   │   ├── alert-dialog.tsx
│   │   ├── avatar.tsx
│   │   ├── badge.tsx
│   │   ├── button.tsx                          # Oversized touch targets (minimum 48x48px)
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── input.tsx                           # High-contrast borders, large typography (18px+)
│   │   ├── label.tsx
│   │   ├── select.tsx
│   │   ├── skeleton.tsx
│   │   ├── switch.tsx
│   │   ├── tabs.tsx
│   │   ├── toast.tsx
│   │   └── index.ts                            # Selective barrel export for ui/ primitives only
│   ├── patient/                                # Patient domain components
│   │   ├── EmergencySosButton.tsx              # Large, fail-safe 1-tap SOS button with confirmation lock
│   │   ├── PatientCard.tsx                     # Senior bio summary with quick phone links
│   │   ├── PatientProfileForm.tsx              # Multi-step medical profile form
│   │   ├── VitalsSummaryCard.tsx               # Latest BP, Sugar, Heart Rate glance card
│   │   ├── VitalsEntryForm.tsx                 # Large numeric keypad input form for seniors
│   │   └── MedicalHistoryList.tsx              # Chronic conditions, allergies, baseline notes
│   ├── medication/                             # Medication domain components
│   │   ├── MedicationScheduleList.tsx          # Grouped by Morning, Afternoon, Evening, Bedtime
│   │   ├── MedicationCard.tsx                  # Pill image, instructions ("take with food"), dosage
│   │   ├── MedicationForm.tsx                  # Add/edit medicine form with schedule picker
│   │   ├── PillReminderModal.tsx               # Audio-visual recurring reminder alert modal
│   │   ├── AdherenceBadge.tsx                  # Taken / Missed / Skipped status badge
│   │   └── DoseLogger.tsx                      # One-tap "Mark Taken" button with timestamp
│   ├── appointments/                           # Appointments domain components
│   │   ├── AppointmentCalendar.tsx             # Accessible monthly/weekly list view
│   │   ├── AppointmentCard.tsx                 # Date, doctor specialty, map directions link
│   │   ├── AppointmentForm.tsx                 # Schedule form with reminder offset options
│   │   ├── DoctorContactCard.tsx               # Quick-dial physician card
│   │   └── TransportNotesModal.tsx             # Wheelchair / ambulance companion notes
│   ├── timeline/                               # Health timeline domain components
│   │   ├── TimelineFeed.tsx                    # Chronological infinite-scrolling audit list
│   │   ├── TimelineEventCard.tsx               # Event visualizer (med logged, vital recorded, alert)
│   │   ├── VitalsTrendChart.tsx                # Accessible charts (BP systolic/diastolic, glucose)
│   │   ├── DailySummaryCard.tsx                # Senior's daily wellness index score
│   │   └── TimelineFilter.tsx                  # Category filter (All, Medications, Vitals, Alerts)
│   ├── caregiver/                              # Caregiver & family network components
│   │   ├── CaregiverRoster.tsx                 # Active family members & visiting healthcare staff
│   │   ├── CaregiverInviteModal.tsx            # Invite via SMS or Email with role assignment
│   │   ├── HandoffNotesCard.tsx                # Nurse shift handoff message log
│   │   ├── PermissionToggle.tsx                # Granular permissions (view-only vs edit-prescriptions)
│   │   └── SosNotificationBanner.tsx           # Red blinking alert banner on active SOS
│   ├── layout/                                 # App-wide structural layout components
│   │   ├── Header.tsx                          # Branding, current patient selector, SOS status
│   │   ├── Sidebar.tsx                         # Desktop left-hand navigation
│   │   ├── BottomNav.tsx                       # Mobile fixed bottom bar (large icons for elderly)
│   │   ├── AccessibilityBar.tsx                # Font size stepper (A- / A+), high-contrast toggle
│   │   └── UserMenu.tsx                        # Profile switch, settings, logout
│   └── shared/                                 # Generic utility components
│       ├── ConfirmDialog.tsx                   # Critical action confirmation modal
│       ├── EmptyState.tsx                      # Clear illustrations and guidance for empty tabs
│       ├── LoadingSpinner.tsx                  # Accessible SVG spinner with aria-live="polite"
│       └── OfflineBanner.tsx                   # Top notification when offline; displays pending syncs
├── lib/                                        # Core utilities, API clients, and business logic
│   ├── firebase/                               # Firebase SDK wrappers
│   │   ├── client.ts                           # Client Firebase App, Auth, Firestore, Storage init
│   │   ├── admin.ts                            # Firebase Admin SDK (Node.js runtime only)
│   │   ├── auth.ts                             # Client auth wrappers (signInWithPhone, signOut)
│   │   ├── firestore.ts                        # Typed collection references & converter utilities
│   │   ├── storage.ts                          # Prescription & avatar upload/download utilities
│   │   └── config.ts                           # Client Firebase options validated via Zod
│   ├── auth/                                   # Authentication & Authorization utilities
│   │   ├── session.ts                          # Server cookie session management & JWT verification
│   │   ├── roles.ts                            # RBAC helpers: isCaregiver(), isPatient(), isDoctor()
│   │   └── guards.ts                           # Server component redirect guards
│   ├── email/                                  # Email delivery client
│   │   ├── client.ts                           # Resend / Nodemailer client singleton
│   │   └── templates/                          # React Email templates
│   │       ├── EmergencyAlertEmail.tsx
│   │       ├── CaregiverInviteEmail.tsx
│   │       └── MedicationReminderEmail.tsx
│   ├── offline/                                # PWA offline storage & background synchronization
│   │   ├── db.ts                               # Dexie.js (IndexedDB) schema for offline cache
│   │   ├── sync-queue.ts                       # Optimistic mutation queue & replay logic
│   │   └── network-status.ts                   # Online/offline event listener & reactive state
│   ├── validation/                             # Single source of truth for runtime validation (Zod)
│   │   ├── auth.schema.ts                      # Login, registration, password schemas
│   │   ├── patient.schema.ts                   # Senior profile & vitals input validation
│   │   ├── medication.schema.ts                # Dosage, timing frequency, pill name validation
│   │   ├── appointment.schema.ts               # Date, location, clinic validation
│   │   └── caregiver.schema.ts                 # Invitation & permission schemas
│   └── utils.ts                                # Tailwind `cn()`, date-fns formatting, phone formatters
├── types/                                      # TypeScript definitions & data models
│   ├── patient.ts                              # PatientProfile, VitalRecord, Allergy, BloodGroup
│   ├── medication.ts                           # Medication, DosageSchedule, AdherenceLog
│   ├── appointment.ts                          # Appointment, DoctorInfo, AppointmentStatus
│   ├── timeline.ts                             # TimelineEvent, EventCategory, SeverityLevel
│   ├── caregiver.ts                            # CaregiverMember, CareRole, ShiftHandoff
│   ├── auth.ts                                 # UserRole, AuthenticatedSession, AuthToken
│   ├── api.ts                                  # ApiResponse<T>, ApiError, PaginatedResult<T>
│   └── index.ts                                # Global type re-exports
├── hooks/                                      # Custom React hooks (state, subscriptions, events)
│   ├── useAuth.ts                              # Auth state, current user, role checking
│   ├── usePatient.ts                           # Active patient data and update operations
│   ├── useMedications.ts                       # Real-time Firestore query for daily medicines
│   ├── useVitals.ts                            # Real-time Firestore stream for vitals & new entries
│   ├── useAppointments.ts                     # Upcoming appointments & scheduling mutations
│   ├── useTimeline.ts                          # Paginated chronological events feed
│   ├── useCaregivers.ts                        # Care team roster & permission handlers
│   ├── useOfflineSync.ts                       # IndexedDB sync queue counter & manual sync trigger
│   ├── useEmergencySos.ts                      # Geolocation capture & instant SOS broadcast caller
│   └── useAccessibility.ts                     # Font scaling (default/large/xlarge) & contrast mode
├── service-worker/                             # Progressive Web App (PWA) worker logic
│   ├── sw.ts                                   # Service worker entrypoint (Serwist / Workbox)
│   ├── cache-strategies.ts                     # CacheFirst (static) & StaleWhileRevalidate (vitals)
│   └── push-handler.ts                         # Notification click router & audio reminder buzzer
├── tests/                                      # Automated testing suites
│   ├── unit/                                   # Vitest: pure functions, schemas, hooks, utility logic
│   │   ├── lib/
│   │   │   ├── validation.test.ts              # Zod validation schema edge-case tests
│   │   │   ├── sync-queue.test.ts              # Offline mutation replay & conflict resolution
│   │   │   └── utils.test.ts                   # Date calculations, dose timing tests
│   │   └── hooks/
│   │       ├── useOfflineSync.test.ts
│   │       └── useAccessibility.test.ts
│   ├── integration/                            # Vitest + React Testing Library: components + mocked Firebase
│   │   ├── components/
│   │   │   ├── EmergencySosButton.test.tsx     # SOS press-and-hold trigger & visual feedback
│   │   │   ├── DoseLogger.test.tsx             # Pill mark-taken action & optimistic updates
│   │   │   └── VitalsEntryForm.test.tsx        # High-contrast inputs & error state rendering
│   │   └── api/
│   │       ├── session-route.test.ts           # Cookie issuance & token verification
│   │       └── emergency-trigger.test.ts       # SOS payload validation & notification fan-out
│   ├── e2e/                                    # Playwright: complete multi-role user journeys
│   │   ├── auth.spec.ts                        # Login, role selection, session persistence
│   │   ├── medication-flow.spec.ts             # Senior views daily meds -> logs dose -> updates list
│   │   ├── vitals-logging.spec.ts              # Add BP record -> verify timeline reflection
│   │   └── sos-emergency.spec.ts               # Trigger SOS -> verify caregiver alert broadcast
│   ├── mocks/                                  # Test doubles & mock providers
│   │   ├── firebase-mock.ts                    # In-memory Firestore & Auth mock
│   │   └── handlers.ts                         # MSW (Mock Service Worker) handlers for network tests
│   └── setup.ts                                # Vitest environment setup (`@testing-library/jest-dom`)
├── middleware.ts                               # Next.js Edge middleware (session check & route guards)
├── .env.example                                # Complete template of all required environment variables
├── .env.local                                  # Local overrides & private keys (git-ignored)
├── firebase.json                               # Firebase Emulators (Auth, Firestore, Storage) config
├── firestore.indexes.json                      # Compound indexes for vitals & timeline queries
├── firestore.rules                             # Production security rules for Firestore
├── storage.rules                               # Production security rules for Cloud Storage
├── next.config.mjs                             # Next.js config (PWA setup, security headers, image domains)
├── package.json                                # Scripts and project dependencies
├── playwright.config.ts                        # Playwright configuration (Chromium, Firefox, Mobile Viewport)
├── tailwind.config.ts                          # Custom palette with high-contrast accessibility tokens
├── tsconfig.json                               # Strict TypeScript configuration with `@/*` path aliases
└── vitest.config.ts                            # Vitest config (JSDOM environment, alias resolution)
```

---

### 2.2 Top-Level Directory Annotations

| Directory | Purpose |
| :--- | :--- |
| **`app/`** | Contains the Next.js App Router routing tree. Uses route groups `(auth)` and `(dashboard)` to isolate layout trees without affecting public URLs. Route handlers under `app/api/` isolate server-only duties (e.g., verifying Firebase session cookies, sending SMS alerts, and dispatching Web Push notifications). |
| **`components/`** | All React presentation and interaction components. Subdivided into atomic `ui/` elements (buttons, inputs) and business feature domains (`patient/`, `medication/`, `appointments/`, `timeline/`, `caregiver/`). Keeps domain logic and UI co-located while preventing cross-domain bleed. |
| **`lib/`** | Non-UI application code, third-party library initializations, and pure business logic. Centralizes Firebase (client and admin SDKs), authentication session helpers, offline IndexedDB sync mechanics, transactional email dispatchers, and Zod validation schemas. |
| **`types/`** | Centralized TypeScript definitions, domain interfaces, and utility types. Acts as the static contract across the app, ensuring that Firestore documents, API responses, and form inputs conform to strict schemas. |
| **`hooks/`** | Custom React hooks that encapsulate real-time Firestore subscriptions, PWA synchronization logic, geolocation SOS tracking, and accessibility state (font scaling and contrast settings). Keeps UI components declarative. |
| **`service-worker/`** | Progressive Web App (PWA) service worker implementation. Handles offline caching strategies for vital metrics, medication schedules, and assets, as well as background sync and incoming push notifications for scheduled pill alarms. |
| **`tests/`** | Root testing directory separated by test level: `unit/` (fast Vitest tests for utilities and validation schemas), `integration/` (React Testing Library tests with Firebase mocks), and `e2e/` (Playwright end-to-end user journeys). |
| **Root Configuration Files** | Root-level files handle environment setup, tooling, and database rules: `middleware.ts` for Edge session security; `firebase.json`, `firestore.rules`, and `storage.rules` for database security and emulators; and config files for Vite, Playwright, Tailwind, and TypeScript. |

---

### 2.3 Architecture & Development Conventions

#### 1. File Naming Conventions
* **React Components**: `PascalCase.tsx` (e.g., `EmergencySosButton.tsx`, `MedicationCard.tsx`).
* **Next.js Route Files**: Lowercase standard convention enforced by App Router (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`).
* **Hooks**: `camelCase.ts` prefixed with `use` (e.g., `useMedications.ts`, `useOfflineSync.ts`).
* **Libraries, Schemas & Utilities**: `kebab-case.ts` (e.g., `sync-queue.ts`, `network-status.ts`, `auth.schema.ts`).
* **Type Files**: `kebab-case.ts` or domain noun (e.g., `patient.ts`, `medication.ts`).
* **Test Files**: Mirror target file with `.test.ts(x)` for Vitest or `.spec.ts` for Playwright (e.g., `DoseLogger.test.tsx`, `auth.spec.ts`).

#### 2. Component Organization Patterns
* **Co-location over Fragmentation**: For components unique to a specific domain, place them directly inside `components/<domain>/`. Do not create a separate folder per component unless it requires private sub-components (e.g., `components/medication/PillSchedule/` with its own `TimeSlotItem.tsx`).
* **Senior-Friendly Design Constraints**:
  * Touch targets in `components/ui/button.tsx` default to a minimum height and width of `48px` (`min-h-[48px] min-w-[48px]`).
  * Base text in inputs and buttons defaults to `text-lg` (18px) or scales reactively with the `useAccessibility` hook.
  * Contrast ratios must satisfy WCAG AAA standards (minimum 7:1 for normal text).
* **Smart vs. Dumb Separation**:
  * Presentational components (e.g., `MedicationCard.tsx`, `PatientCard.tsx`) receive data and callbacks via props only.
  * Container components or custom hooks (e.g., `MedicationScheduleList.tsx`, `useMedications.ts`) interact directly with Firestore, IndexedDB, or optimistic updates.

#### 3. Barrel Export Strategy
To prevent circular dependency chains, slow Turbopack builds, and bundle bloat:
* **Selective Barrel Exports Only**:
  * Allowed: `components/ui/index.ts` (convenient for standard primitives like `Button`, `Card`, `Input`).
  * Allowed: `types/index.ts` (re-exporting all domain models for frictionless importing).
* **Banned Across Domain Features**:
  * Avoid `components/medication/index.ts` or `components/patient/index.ts`. Import directly from the exact file:
    ```typescript
    // Good
    import { DoseLogger } from '@/components/medication/DoseLogger';
    import { Button } from '@/components/ui';
    
    // Avoid
    import { DoseLogger, MedicationCard } from '@/components/medication';
    ```

---

### 2.4 Environment Variables, Firebase Configuration & Secrets Management

#### 1. Environment File Hierarchy
```text
.env.example          # Tracked in Git: Complete variable template with placeholder values
.env.local            # Untracked: Local developer secrets and emulator toggles
.env.production       # Set in CI/CD deployment platform (Vercel / Cloud Run / Firebase App Hosting)
```

#### 2. Environment Variables Specification (`.env.example`)
```bash
# ==============================================================================
# CLIENT-SIDE ENVIRONMENT VARIABLES (Exposed to browser via NEXT_PUBLIC_)
# ==============================================================================
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Firebase Client Configuration (Safe to expose in client bundle)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyA_example_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=jeevasetu-dev.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=jeevasetu-dev
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=jeevasetu-dev.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-ABCDEF1234

# Firebase Local Emulator Toggle (Set to 'true' during local dev)
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://localhost:9099
NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST=localhost:8080
NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199

# Web Push / FCM Public Key
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BD8_example_public_vapid_key

# ==============================================================================
# SERVER-ONLY SECRETS (Never prefix with NEXT_PUBLIC_ - Never expose to client)
# ==============================================================================
# Firebase Admin SDK (Private Key Service Account)
FIREBASE_PROJECT_ID=jeevasetu-dev
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@jeevasetu-dev.iam.gserviceaccount.com
# Use escaped newlines (\n) when storing multi-line private keys
FIREBASE_PRIVATE_KEY="<REDACTED_PRIVATE_KEY>\n"

# Session Security
SESSION_COOKIE_SECRET=complex_random_entropy_secret_min_32_chars
SESSION_COOKIE_NAME=__session

# Communication & Emergency Services
RESEND_API_KEY=re_123456789_abcdef
TWILIO_ACCOUNT_SID=AC_example_twilio_account_sid
TWILIO_AUTH_TOKEN=example_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

#### 3. Firebase Client vs. Admin SDK Boundary

* **Client Initialization (`lib/firebase/client.ts`)**:
  Initializes Firebase as a singleton on the client. Automatically switches between local emulators and live GCP services based on `NEXT_PUBLIC_USE_FIREBASE_EMULATORS`:
  ```typescript
  import { initializeApp, getApps, getApp } from 'firebase/app';
  import { getAuth, connectAuthEmulator } from 'firebase/auth';
  import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
  import { getStorage, connectStorageEmulator } from 'firebase/storage';

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  export const auth = getAuth(app);
  export const db = getFirestore(app);
  export const storage = getStorage(app);

  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true' && typeof window !== 'undefined') {
    connectAuthEmulator(auth, process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL || 'http://localhost:9099');
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
  }
  ```

* **Server Initialization (`lib/firebase/admin.ts`)**:
  Restricted exclusively to Node.js environments (`app/api/` and Server Actions). Uses `server-only` to guarantee that server credentials cannot be bundled into client JavaScript:
  ```typescript
  import 'server-only';
  import { initializeApp, getApps, cert } from 'firebase-admin/app';
  import { getAuth } from 'firebase-admin/auth';
  import { getFirestore } from 'firebase-admin/firestore';

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }

  export const adminAuth = getAuth();
  export const adminDb = getFirestore();
  ```

#### 4. Solo Developer Pragmatism & Security Rules
* **Zero Cloud Costs During Development**: Run `npm run emulator` (`firebase emulators:start`) to execute Auth, Firestore, and Storage locally without touching the cloud or incurring costs.
* **Strict Runtime Validation**: Validate all incoming environment variables at build/boot time using Zod inside `lib/firebase/config.ts`. Missing keys throw actionable build errors rather than silent runtime failures.
* **HttpOnly Session Cookies**: Rather than saving raw Firebase ID tokens in `localStorage`, route authentication through `app/api/auth/session/route.ts` to issue a cryptographically signed, `HttpOnly`, `SameSite=Lax`, `Secure` cookie. This enables seamless authentication checks inside Next.js `middleware.ts` before rendering server components.
* **Security Rules as Code**: Keep `firestore.rules` and `storage.rules` at the repository root. Test them locally using the Firebase Rules Unit Testing library inside `tests/integration/` to guarantee that elders and caregivers can access only their authorized family documents.


---\n
## 3. Database Schema and Relationships

### 3.1 Architectural Overview & Collection Organization Strategy

In designing the cloud database architecture for **JEEVASETU**, Firestore was selected for its native real-time synchronization, multi-region high availability, and battle-tested offline cache capabilities—critical requirements when monitoring vulnerable elderly individuals in areas with variable network reliability.

```
                                  JEEVASETU FIRESTORE ARCHITECTURE
                                    (Flattened Root Collections)
 
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   GLOBAL / AUTH DOMAIN                                      │
 │                                                                                             │
 │   ┌───────────────────────────┐                     ┌───────────────────────────┐           │
 │   │           users           │                     │     access_invitations    │           │
 │   │  (Caregivers, Family, MD) │                     │ (Onboarding & Access Reg) │           │
 │   └─────────────┬─────────────┘                     └─────────────┬─────────────┘           │
 └─────────────────┼─────────────────────────────────────────────────┼─────────────────────────┘
                   │                                                 │
                   │            ┌───────────────────────────┐        │
                   └───────────►│   caregiver_assignments   │◄───────┘
                                │  (RBAC Bridge Document)   │
                                └─────────────┬─────────────┘
                                              │
 ┌────────────────────────────────────────────┼────────────────────────────────────────────────┐
 │                                            │   PATIENT CLINICAL & OPERATIONAL DOMAIN        │
 │                                            ▼   (Scoped by mandatory patientId)              │
 │                              ┌───────────────────────────┐                                  │
 │                              │         patients          │                                  │
 │                              │(Master Demographics & Med)│                                  │
 │                              └─────────────┬─────────────┘                                  │
 │                                            │                                                │
 │       ┌──────────────────┬─────────────────┼─────────────────┬──────────────────┐           │
 │       ▼                  ▼                 ▼                 ▼                  ▼           │
 │┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐      │
 ││ medications │   │ appointments│   │care_timeline│   │ med_schedules│  │ med_events  │      │
 ││ (Formulary) │   │  (Clinical) │   │   _events   │   │(Regimen Def)│  │ (Audit Log) │      │
 │└──────┬──────┘   └─────────────┘   └─────────────┘   └──────┬──────┘   └─────────────┘      │
 │       │                                                     │                               │
 │       ▼                                                     ▼                               │
 │┌───────────────────────────┐                         ┌─────────────┐                        │
 ││ medication_change_history │                         │ Idempotency │                        │
 ││      (Clinical Audit)     │                         │ Engine Docs │                        │
 │└───────────────────────────┘                         └─────────────┘                        │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Sub-collection Strategy vs. Root Collections: Architectural Justification

A classic dilemma in Firestore architecture is choosing between deeply nested sub-collections (e.g., `patients/{patientId}/medications/{medicationId}`) versus a **Flattened Root-Collection Pattern** with mandatory partition keys (`patientId`). 

JEEVASETU implements a **Flattened Root-Collection Architecture** across all entities. The architectural justifications are as follows:

1. **Multi-Patient Aggregated Querying for Caregivers:**
   Professional caregivers and family guardians frequently monitor multiple seniors simultaneously (e.g., an adult child managing two elderly parents; a home-nurse assigned to eight seniors across a residential community). 
   * *Sub-collection limitation:* Aggregating pending doses across multiple seniors using Collection Group Queries (`db.collectionGroup('medication_events')`) requires complex security rules, collection-group-scoped composite indexes, and cannot easily filter across a dynamic subset of parent documents without denormalizing `patientId` onto the document anyway.
   * *Root Collection benefit:* A simple parameterized array query (`collection('medication_events').where('patientId', 'in', assignedPatientIds).where('scheduledTime', '<=', endOfShift)`) delivers instant multi-patient dashboard streaming in a single query snapshot.

2. **Mitigation of Firestore Document Contention and Hierarchical Locking:**
   Sub-collections inherit hierarchical metadata trees in Firestore's underlying storage layers (Spanner/Megastore directory hierarchies). High-frequency writes (such as telemetry, vitals, timeline events, and medication confirmations) nested beneath a single document can run into tablet throughput bottlenecks. Root collections distribute writes across Firestore's keyspace evenly.

3. **Atomic Authorization with O(1) Security Rule Evaluation:**
   With sub-collections, validating deep security paths often necessitates traversing up the tree with `get(/databases/$(database)/documents/patients/$(patientId))`, rapidly consuming Firestore's hard limit of 10 cross-document rule evaluations per request. Root collections with explicit `patientId` attributes permit security rules to evaluate access against a single deterministic index document (`/caregiver_assignments/$(request.auth.uid + '_' + resource.data.patientId)`), guaranteeing an O(1) evaluation budget.

4. **Independent Document Archival and Lifecycle Automation:**
   Clinical audit events (`medication_events`, `care_timeline_events`) expand indefinitely. Managing data retention (e.g., streaming records older than 180 days to cold storage BigQuery tables) is substantially simpler when querying flat root collections without leaving behind dangling ancestor shells or incurring the overhead of recursive sub-collection deletion.

---

### 3.2 Collection Schemas and Document Specifications

#### 3.2.1 Collection: `patients`
Master profile document for the elderly individual receiving care. Contains baseline medical, cognitive, demographic, and residence data.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Unique Firestore document ID (`pat_` prefix or auto-generated UUID). |
| `fullName` | `string` | **Req** | Legal full name of the patient. |
| `preferredName` | `string` | **Req** | Preferred informal name/nickname used by voice alerts and caregivers. |
| `dateOfBirth` | `string` | **Req** | ISO format `YYYY-MM-DD` for age calculations. |
| `gender` | `string` | **Req** | Enum: `MALE`, `FEMALE`, `NON_BINARY`, `PREFER_NOT_TO_SAY`. |
| `bloodGroup` | `string` | **Req** | Blood group: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`, `UNKNOWN`. |
| `primaryLanguage` | `string` | **Req** | BCP 47 language code (e.g., `hi-IN`, `ta-IN`, `en-US`) for voice synthesis. |
| `photoUrl` | `string` | **Opt** | Secure Cloud Storage URL of the patient's current profile photo. |
| `address` | `map` | **Req** | Structured address object: `street`, `apartment`, `city`, `state`, `postalCode`, `country`, `geoPoint` (`GeoPoint`). |
| `homePhone` | `string` | **Opt** | Landline phone number of the residence. |
| `timezone` | `string` | **Req** | IANA timezone string (e.g., `Asia/Kolkata`, `America/New_York`). |
| `primaryDiagnoses` | `array<string>` | **Req** | List of chronic conditions (e.g., `["Type 2 Diabetes", "Hypertension", "Early Dementia"]`). |
| `allergies` | `array<map>` | **Req** | Array of maps: `{ allergen: string, severity: 'MILD'\|'MODERATE'\|'SEVERE'\|'LIFE_THREATENING', reaction: string }`. |
| `mobilityStatus` | `string` | **Req** | Enum: `INDEPENDENT`, `CANE_ASSISTED`, `WALKER_ASSISTED`, `WHEELCHAIR_BOUND`, `BEDRIDDEN`. |
| `cognitiveStatus` | `string` | **Req** | Enum: `NORMAL`, `MILD_COGNITIVE_IMPAIRMENT`, `MODERATE_DEMENTIA`, `SEVERE_DEMENTIA`. |
| `fallRiskLevel` | `string` | **Req** | Enum: `LOW`, `MEDIUM`, `HIGH`. |
| `emergencyNotes` | `string` | **Opt** | Critical instructions for EMS (e.g., "Pacemaker implanted 2024; Penicillin anaphylaxis"). |
| `advanceDirectiveOnFire`| `boolean` | **Req** | Indicates whether DNR or Medical Power of Attorney documents exist. |
| `advanceDirectiveDocUrl`| `string` | **Opt** | Cloud Storage link to encrypted advance directive PDF. |
| `primaryPhysician` | `map` | **Opt** | Map: `{ name: string, phone: string, clinic: string }`. |
| `isDeleted` | `boolean` | **Req** | Soft-delete flag (default: `false`). |
| `deletedAt` | `Timestamp` | **Opt** | Timestamp when record was soft-deleted. |
| `deletedBy` | `string` | **Opt** | User ID of the actor who deleted the patient profile. |
| `createdAt` | `Timestamp` | **Req** | Server timestamp of creation. |
| `updatedAt` | `Timestamp` | **Req** | Server timestamp of last modification. |

---

#### 3.2.2 Collection: `users`
Accounts for family guardians, professional caregivers, nurses, and attending physicians.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Firebase Authentication UID (`request.auth.uid`). |
| `displayName` | `string` | **Req** | Full name of the user. |
| `email` | `string` | **Req** | Primary authenticated email address. |
| `phoneNumber` | `string` | **Req** | E.164 formatted telephone number for SMS/WhatsApp dispatch. |
| `photoUrl` | `string` | **Opt** | Profile avatar URL. |
| `userType` | `string` | **Req** | Enum: `FAMILY_ADMIN`, `FAMILY_MEMBER`, `PROFESSIONAL_CAREGIVER`, `CLINICIAN`, `EMERGENCY_DISPATCHER`. |
| `notificationSettings` | `map` | **Req** | Push, SMS, WhatsApp, and automated IVR phone call alert preferences. |
| `fcmTokens` | `array<map>` | **Req** | Array of active devices: `{ token: string, platform: 'IOS'\|'ANDROID'\|'WEB', updatedAt: Timestamp }`. |
| `assignedPatientSummaries`| `array<map>` | **Req** | Denormalized summary array for high-speed UI switching: `{ patientId: string, patientName: string, role: string, avatarUrl: string }`. |
| `accountStatus` | `string` | **Req** | Enum: `ACTIVE`, `SUSPENDED`, `INVITED`, `DEACTIVATED`. |
| `lastActiveAt` | `Timestamp` | **Opt** | Timestamp of last user API/client interaction. |
| `createdAt` | `Timestamp` | **Req** | Server timestamp when the user account was provisioned. |
| `updatedAt` | `Timestamp` | **Req** | Server timestamp of profile updates. |

---

#### 3.2.3 Collection: `caregiver_assignments`
The relational bridge binding a `user` to a `patient`. Dictates Role-Based Access Control (RBAC) and permissions.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Deterministic ID: `{userId}_{patientId}` for O(1) rule lookups. |
| `patientId` | `string` | **Req** | Foreign key linking to `patients.id`. |
| `userId` | `string` | **Req** | Foreign key linking to `users.id`. |
| `role` | `string` | **Req** | Enum: `PRIMARY_FAMILY_ADMIN`, `SECONDARY_FAMILY`, `PAID_NURSE`, `ASSISTANT_CAREGIVER`, `DOCTOR`. |
| `relationshipToPatient`| `string` | **Req** | E.g., `"Daughter"`, `"Son"`, `"Private Duty Nurse"`, `"Cardiologist"`. |
| `permissions` | `array<string>` | **Req** | Granular scopes: `["medications:read", "medications:administer", "medications:modify", "timeline:write", "emergency:alert", "invites:manage"]`. |
| `isEmergencyContact` | `boolean` | **Req** | Whether this caregiver receives SOS/fall/critical escalation notifications. |
| `emergencyPriorityOrder`| `number` | **Opt** | Escalation order (1 = first responder, 2 = secondary, etc.). |
| `shiftSchedule` | `map` | **Opt** | Working hours for paid caregivers: `{ daysOfWeek: number[], startTime: string, endTime: string }`. |
| `assignmentStatus` | `string` | **Req** | Enum: `ACTIVE`, `PAUSED`, `REVOKED`. |
| `assignedBy` | `string` | **Req** | User ID who authorized this assignment. |
| `createdAt` | `Timestamp` | **Req** | Timestamp when access was granted. |
| `updatedAt` | `Timestamp` | **Req** | Timestamp of permissions modification. |

---

#### 3.2.4 Collection: `access_invitations`
Tracks invitations sent to onboard new family members or paid attendants into a patient's care circle.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Unique cryptographically secure token/hash string. |
| `patientId` | `string` | **Req** | ID of the patient being shared. |
| `patientName` | `string` | **Req** | Denormalized patient name for presentation in invitation links. |
| `invitedByUserId` | `string` | **Req** | User ID of the inviter. |
| `invitedByUserName` | `string` | **Req** | Denormalized full name of the inviter. |
| `inviteeEmail` | `string` | **Opt** | Target email address (required if inviteePhone is absent). |
| `inviteePhone` | `string` | **Opt** | Target phone number (required if inviteeEmail is absent). |
| `targetRole` | `string` | **Req** | Intended role: `SECONDARY_FAMILY`, `PAID_NURSE`, `ASSISTANT_CAREGIVER`, `DOCTOR`. |
| `targetPermissions` | `array<string>` | **Req** | Array of permission strings pre-allocated to the invitation. |
| `status` | `string` | **Req** | Enum: `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `CANCELLED`. |
| `expiresAt` | `Timestamp` | **Req** | Expiration timestamp (typically 72 hours from generation). |
| `acceptedByUserId` | `string` | **Opt** | User ID that claimed this invite. |
| `acceptedAt` | `Timestamp` | **Opt** | Timestamp when the claim occurred. |
| `createdAt` | `Timestamp` | **Req** | Timestamp when invitation was dispatched. |
| `updatedAt` | `Timestamp` | **Req** | Timestamp of last status change. |

---

#### 3.2.5 Collection: `medications`
The master pharmacological formulary for an individual patient. Describes what the medicine is, its visual appearance, and dispensing parameters.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Document ID (`med_` prefix or auto-UUID). |
| `patientId` | `string` | **Req** | Mandatory tenant boundary key. |
| `name` | `string` | **Req** | Commercial/Brand name (e.g., `"Glucophage"` or `"Ecosprin"`). |
| `genericName` | `string` | **Req** | Active pharmaceutical ingredient (e.g., `"Metformin HCl"`). |
| `rxNormCode` | `string` | **Opt** | Standardized medical RxNorm or NDC code. |
| `dosageForm` | `string` | **Req** | Enum: `TABLET`, `CAPSULE`, `LIQUID`, `INJECTION`, `PATCH`, `INHALER`, `DROPS`, `TOPICAL`. |
| `strength` | `string` | **Req** | Potency specification (e.g., `"500 mg"`, `"10 mcg/hr"`, `"5 ml"`). |
| `route` | `string` | **Req** | Enum: `ORAL`, `SUBLINGUAL`, `TOPICAL`, `SUBCUTANEOUS`, `INHALATION`, `OPHTHALMIC`. |
| `visualDescription` | `map` | **Req** | Elderly recognition features: `{ pillColor: string, pillShape: string, pillImprint: string, photoUrl: string }`. |
| `foodRelation` | `string` | **Req** | Enum: `BEFORE_FOOD`, `WITH_FOOD`, `AFTER_FOOD`, `EMPTY_STOMACH`, `IRRELEVANT`. |
| `specialInstructions`| `string` | **Opt** | Specific warnings (e.g., "Do not crush. Take with full glass of water."). |
| `prescribingDoctor` | `map` | **Opt** | Details: `{ name: string, clinic: string, contactPhone: string, prescriptionNum: string }`. |
| `currentInventory` | `number` | **Req** | Count of remaining doses/units in stock. |
| `refillThreshold` | `number` | **Req** | Minimum quantity trigger for restocking alerts. |
| `isPRN` | `boolean` | **Req** | If `true`, medication is taken "as needed" (pro re nata) rather than on fixed schedules. |
| `isHighRisk` | `boolean` | **Req** | High-alert flag (e.g., Insulin, Anticoagulants, Opioids) requiring photo verification. |
| `status` | `string` | **Req** | Enum: `ACTIVE`, `PAUSED`, `DISCONTINUED`. |
| `isDeleted` | `boolean` | **Req** | Soft delete flag (default: `false`). |
| `deletedAt` | `Timestamp` | **Opt** | Soft delete timestamp. |
| `deletedBy` | `string` | **Opt** | User who soft-deleted this record. |
| `createdAt` | `Timestamp` | **Req** | Creation timestamp. |
| `createdBy` | `string` | **Req** | User ID who registered the medication. |
| `updatedAt` | `Timestamp` | **Req** | Last update timestamp. |
| `updatedBy` | `string` | **Req** | User ID of last editor. |

---

#### 3.2.6 Collection: `medication_schedules`
Defines the recurrence rules and timing regimen governing when a medication must be administered.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Unique schedule ID (`sch_` prefix). |
| `patientId` | `string` | **Req** | Mandatory tenant boundary key. |
| `medicationId` | `string` | **Req** | Foreign key linking to `medications.id`. |
| `medicationSummary` | `map` | **Req** | Denormalized: `{ name: string, strength: string, dosageForm: string, photoUrl: string }`. |
| `scheduleType` | `string` | **Req** | Enum: `DAILY`, `SPECIFIC_DAYS`, `INTERVAL_HOURS`, `CYCLICAL`, `PRN_ONLY`. |
| `timesOfDay` | `array<string>` | **Req** | Array of 24h local time strings (e.g., `["08:00", "14:00", "20:00"]`). |
| `daysOfWeek` | `array<number>` | **Req** | Days applicable: `0` (Sun) to `6` (Sat). Empty if `DAILY`. |
| `intervalHours` | `number` | **Opt** | Specified if `scheduleType == 'INTERVAL_HOURS'` (e.g., every 8 hours). |
| `startDate` | `string` | **Req** | ISO date string `YYYY-MM-DD` when the regimen starts. |
| `endDate` | `string` | **Opt** | ISO date string `YYYY-MM-DD` when regimen concludes (null for continuous chronic). |
| `doseQuantity` | `string` | **Req** | Measure per administration (e.g., `"1 Tablet"`, `"2 Puffs"`, `"10 ml"`). |
| `gracePeriodMinutes` | `number` | **Req** | Minutes allowed past schedule before alerting (default: `45`). |
| `escalationRules` | `map` | **Req** | Configuration: `{ unconfirmedThresholdMin: number, notifyCaregiverRoles: string[] }`. |
| `isActive` | `boolean` | **Req** | Regimen toggle switch (default: `true`). |
| `timezone` | `string` | **Req** | Anchor timezone for local time calculation (e.g., `Asia/Kolkata`). |
| `isDeleted` | `boolean` | **Req** | Soft delete flag. |
| `deletedAt` | `Timestamp` | **Opt** | Soft delete timestamp. |
| `createdAt` | `Timestamp` | **Req** | Creation timestamp. |
| `createdBy` | `string` | **Req** | User ID who configured this schedule. |
| `updatedAt` | `Timestamp` | **Req** | Last update timestamp. |
| `updatedBy` | `string` | **Req** | User ID of modifier. |

---

#### 3.2.7 Collection: `medication_events`
Individual transaction ledger of scheduled doses and PRN ingestions. Serves as the primary adherence and compliance audit trail.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | **Deterministic Idempotency Key** (see Section 3.5). |
| `patientId` | `string` | **Req** | Mandatory tenant boundary key. |
| `scheduleId` | `string` | **Opt** | Ref to `medication_schedules.id` (null if spontaneous PRN dose). |
| `medicationId` | `string` | **Req** | Ref to `medications.id`. |
| `medicationSummary` | `map` | **Req** | Denormalized: `{ name: string, strength: string, dosageForm: string, photoUrl: string }`. |
| `status` | `string` | **Req** | Enum: `UNCONFIRMED`, `TAKEN`, `SKIPPED`, `MISSED`. |
| `scheduledTime` | `Timestamp` | **Req** | Planned wall-clock time in UTC. |
| `actualTimeClient` | `Timestamp` | **Opt** | Device clock timestamp recorded when caregiver or senior logged the action. |
| `syncedAtServer` | `Timestamp` | **Req** | Server timestamp assigned upon ingestion into Google Cloud Firestore. |
| `doseAdministered` | `string` | **Req** | Physical amount taken (e.g., `"1 Tablet"`). |
| `recordedBy` | `map` | **Opt** | Administering actor: `{ userId: string, userName: string, role: string }`. |
| `skipReason` | `string` | **Opt** | Enum: `PATIENT_REFUSED`, `ADVERSE_REACTION`, `MEDICATION_UNAVAILABLE`, `PHYSICIAN_ORDER`, `FASTING`, `OTHER`. |
| `skipNotes` | `string` | **Opt** | Contextual explanation if skipped or missed. |
| `verificationMethod`| `string` | **Req** | Enum: `MANUAL_TAP`, `PHOTO_PROOF`, `NFC_PILLBOX`, `SMART_BLISTER_BLE`. |
| `verificationProofUrl`|`string` | **Opt** | Encrypted Cloud Storage URL of the ingestion photo (if photo proof required). |
| `isEscalated` | `boolean` | **Req** | Indicates whether alerts were fired to family/emergency contacts. |
| `escalatedAt` | `Timestamp` | **Opt** | Timestamp when escalation notifications fired. |
| `idempotencyKey` | `string` | **Req** | Explicit hash key matching the document ID. |
| `createdAt` | `Timestamp` | **Req** | Document generation timestamp. |
| `updatedAt` | `Timestamp` | **Req** | Last document modification timestamp. |

---

#### 3.2.8 Collection: `medication_change_history`
Append-only legal audit log capturing all modifications to a patient's pharmacological therapy.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Auto-generated ID (`chg_` prefix). |
| `patientId` | `string` | **Req** | Mandatory tenant boundary key. |
| `medicationId` | `string` | **Req** | Target medication document ID. |
| `medicationName` | `string` | **Req** | Denormalized name of the medication at the moment of change. |
| `changeType` | `string` | **Req** | Enum: `CREATED`, `DOSAGE_MODIFIED`, `SCHEDULE_CHANGED`, `PAUSED`, `RESUMED`, `DISCONTINUED`. |
| `reasonForChange` | `string` | **Req** | Clinical or practical justification (e.g., "Physician adjusted Metformin post HbA1c test"). |
| `changedBy` | `map` | **Req** | Actor context: `{ userId: string, userName: string, role: string }`. |
| `authorizingDoctor` | `map` | **Opt** | Context: `{ doctorName: string, clinic: string, consultationDate: string }`. |
| `snapshotBefore` | `map` | **Req** | Full serialized state of `medications` and `medication_schedules` before mutation. |
| `snapshotAfter` | `map` | **Req** | Full serialized state of `medications` and `medication_schedules` after mutation. |
| `effectiveDate` | `Timestamp` | **Req** | Clinical start timestamp of the updated regimen. |
| `createdAt` | `Timestamp` | **Req** | Server timestamp when the audit entry was written. |

---

#### 3.2.9 Collection: `appointments`
Tracks medical consultations, lab diagnostics, physical therapy, and telemedicine check-ins.

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Unique appointment ID (`apt_` prefix). |
| `patientId` | `string` | **Req** | Mandatory tenant boundary key. |
| `title` | `string` | **Req** | Human-readable title (e.g., `"Geriatric Cardiology Review"`). |
| `specialty` | `string` | **Req** | Medical field (e.g., `"Cardiology"`, `"Ophthalmology"`, `"Physiotherapy"`). |
| `doctorName` | `string` | **Req** | Name of the examining specialist. |
| `facilityName` | `string` | **Req** | Clinic, hospital, or diagnostic center name. |
| `location` | `map` | **Opt** | Coordinates & navigation: `{ address: string, room: string, geoPoint: GeoPoint, mapsUrl: string }`. |
| `isTelehealth` | `boolean` | **Req** | Flag indicating if this is an online appointment. |
| `telehealthUrl` | `string` | **Opt** | Encrypted video conference or meeting link. |
| `scheduledStartTime`| `Timestamp` | **Req** | Starting timestamp in UTC. |
| `scheduledEndTime` | `Timestamp` | **Req** | Expected completion timestamp in UTC. |
| `reminderOffsets` | `array<number>` | **Req** | Notification alerts prior to event in minutes (e.g., `[1440, 120, 30]`). |
| `escortUserId` | `string` | **Opt** | User ID of caregiver designated to physically accompany senior. |
| `transportationStatus`| `string`| **Req** | Enum: `NOT_REQUIRED`, `ARRANGED`, `PENDING_BOOKING`, `AMBULANCE_SCHEDULED`. |
| `prepInstructions` | `string` | **Opt** | Pre-visit preparation (e.g., "12-hour fasting for lipid profile"). |
| `status` | `string` | **Req** | Enum: `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `RESCHEDULED`. |
| `clinicalSummary` | `string` | **Opt** | Post-visit observations, diagnosis updates, and physician recommendations. |
| `prescriptionUrls` | `array<string>` | **Req** | Storage URLs of scanned physical prescriptions or doctor slips. |
| `isDeleted` | `boolean` | **Req** | Soft delete flag (default: `false`). |
| `deletedAt` | `Timestamp` | **Opt** | Soft delete timestamp. |
| `createdAt` | `Timestamp` | **Req** | Creation timestamp. |
| `createdBy` | `string` | **Req** | User ID of creator. |
| `updatedAt` | `Timestamp` | **Req** | Last update timestamp. |
| `updatedBy` | `string` | **Req** | Modifier user ID. |

---

#### 3.2.10 Collection: `care_timeline_events`
Chronological, consolidated activity feed combining all care domains (medications, falls, vitals, nutrition, doctor visits, mood observations).

| Field Name | Type | Req/Opt | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Req** | Unique timeline event ID (`tle_` prefix). |
| `patientId` | `string` | **Req** | Mandatory tenant boundary key. |
| `category` | `string` | **Req** | Enum: `MEDICATION`, `APPOINTMENT`, `VITALS`, `INCIDENT_FALL`, `NUTRITION`, `MOOD_COGNITION`, `NOTE`, `SYSTEM_ALERT`. |
| `eventType` | `string` | **Req** | Granular event key (e.g., `"MED_TAKEN"`, `"FALL_DETECTED"`, `"BP_HIGH"`, `"MEAL_EATEN"`, `"MOOD_AGITATED"`). |
| `severity` | `string` | **Req** | Enum: `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. |
| `title` | `string` | **Req** | One-line headline (e.g., `"Morning Blood Pressure Logged: 145/92 mmHg"`). |
| `summary` | `string` | **Req** | Narrative description displayed in the feed. |
| `eventTimestamp` | `Timestamp` | **Req** | The point in time when the physical event occurred. |
| `payload` | `map` | **Opt** | Structured contextual metrics (e.g., `{ systolic: 145, diastolic: 92, pulse: 78 }`). |
| `relatedEntityRef` | `map` | **Opt** | Traceability pointer: `{ collection: string, id: string }`. |
| `mediaUrls` | `array<string>` | **Req** | Array of attached photo or audio recording URLs. |
| `loggedBy` | `map` | **Req** | Author metadata: `{ userId: string, userName: string, role: string, avatarUrl: string }`. |
| `requiresAcknowledgement`|`boolean`| **Req** | If `true`, family admins must tap to acknowledge. |
| `acknowledgedBy` | `array<map>` | **Req** | Acknowledging users: `[{ userId: string, userName: string, timestamp: Timestamp }]`. |
| `isDeleted` | `boolean` | **Req** | Soft delete flag. |
| `createdAt` | `Timestamp` | **Req** | Document creation server timestamp. |

---

### 3.3 Relationships and Denormalization Strategy

#### 3.3.1 Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ caregiver_assignments : "holds"
    patients ||--o{ caregiver_assignments : "governs"
    patients ||--o{ access_invitations : "issues"
    users ||--o{ access_invitations : "creates"
    
    patients ||--o{ medications : "owns"
    medications ||--o{ medication_schedules : "schedules"
    patients ||--o{ medication_schedules : "regulates"
    
    medication_schedules ||--o{ medication_events : "generates"
    medications ||--o{ medication_events : "dispenses"
    patients ||--o{ medication_events : "records"
    
    medications ||--o{ medication_change_history : "tracks"
    patients ||--o{ medication_change_history : "logs"
    
    patients ||--o{ appointments : "books"
    patients ||--o{ care_timeline_events : "streams"
```

#### 3.3.2 Strategic Denormalization Guidelines

In Firestore, document reads scale linearly with cost and UI latency. Mobile elderly-care apps display high read-to-write ratios (~20:1); anxious family members refresh their mobile applications repeatedly to check if doses were taken or vitals are stable. Performing SQL-like joins across five collections at 60 frames per second introduces latency spikes and drains mobile battery life.

JEEVASETU applies a strict, intentional denormalization protocol:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DENORMALIZATION TAXONOMY                                       │
├─────────────────────────┬──────────────────────────┬─────────────────────────────────────────────┤
│ Source Document         │ Target Document          │ Denormalized Fields                         │
├─────────────────────────┼──────────────────────────┼─────────────────────────────────────────────┤
│ patients                │ access_invitations       │ patientName                                 │
│ patients                │ users                    │ assignedPatientSummaries                    │
│                         │                          │ (id, fullName, preferredName, photoUrl)     │
│ medications             │ medication_schedules     │ medicationSummary                           │
│                         │                          │ (name, strength, dosageForm, photoUrl)      │
│ medications             │ medication_events        │ medicationSummary                           │
│                         │                          │ (name, strength, dosageForm, photoUrl)      │
│ users                   │ medication_events        │ recordedBy (userId, userName, role)         │
│ users                   │ care_timeline_events     │ loggedBy (userId, userName, role, avatar)   │
└─────────────────────────┴──────────────────────────┴─────────────────────────────────────────────┘
```

#### 3.3.3 Clinical Audit Immutability vs. Asynchronous Consistency

A critical distinction in medical software architecture is **Snapshot Immutability** versus **Mutable State Synchronization**:

1. **Medico-Legal Snapshot Immutability in Events:**
   When an elderly patient takes a 500 mg Metformin tablet on October 1st, and the doctor later switches the patient to 850 mg on November 15th, past `medication_events` records **must never be retroactively updated**. Denormalizing `medicationSummary` into `medication_events` preserves the historical reality of what medication and physical pill appearance was administered at that historical instant.

2. **Propagated State Synchronization via Cloud Functions:**
   For non-clinical metadata updates (e.g., a patient changes their `preferredName` or profile photo), an asynchronous Firebase Cloud Function (`onPatientProfileUpdated`) performs targeted background fan-out batches to refresh the `assignedPatientSummaries` array inside the respective caregiver `users` documents. This ensures caregiver switchers remain in sync without blocking the client.

---

### 3.4 Indexing Requirements

Firestore automatically provisions single-field indexes on all non-array/map primitives. However, compound filtering, temporal range constraints, and multi-tenant isolation require composite indexes.

The following composite indexes must be defined in `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "medication_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "scheduledTime", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "medication_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "scheduledTime", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "medication_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "scheduledTime", "order": "ASCENDING" },
        { "fieldPath": "isEscalated", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "medication_schedules",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isDeleted", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "medications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "isDeleted", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "care_timeline_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "eventTimestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "care_timeline_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "eventTimestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "appointments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "scheduledStartTime", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "appointments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "scheduledStartTime", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "caregiver_assignments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "assignmentStatus", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "caregiver_assignments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "isEmergencyContact", "order": "ASCENDING" },
        { "fieldPath": "emergencyPriorityOrder", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "medication_change_history",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "patientId", "order": "ASCENDING" },
        { "fieldPath": "effectiveDate", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

### 3.5 Security: Patient-Level Data Isolation Design

Multi-tenant security in JEEVASETU is predicated upon **Strict Patient Isolation**. Because health data carries sensitive protected health information (PHI) liabilities, no query must ever execute without explicit tenant boundary enforcement.

```
                                  SECURITY RULE EVALUATION FLOW
 
  Client Mutation Request
  (e.g., Update Medication Event)
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. Is Request Authenticated? (request.auth != null)        │
  └──────────────────────────────┬──────────────────────────────┘
                                 │ Yes
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 2. Does Resource Contain Mandatory patientId?               │
  │    (request.resource.data.patientId != null)                │
  └──────────────────────────────┬──────────────────────────────┘
                                 │ Yes
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 3. Resolve Caregiver Assignment Document:                   │
  │    /caregiver_assignments/{userId}_{patientId}              │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
    Assignment Exists?                         Not Found / Revoked
            │                                         │
            ▼ Yes                                     ▼
  ┌──────────────────────────────┐              ┌───────────┐
  │ 4. Check Granular Scope &    │              │  REJECT   │
  │    Role Permissions          │              │  (403)    │
  │    (e.g. 'medications:admin')│              └───────────┘
  └──────────────┬───────────────┘
                 │ Granted
                 ▼
          ┌─────────────┐
          │ ALLOW WRITE │
          └─────────────┘
```

#### 3.5.1 The `patientId` Ubiquity Mandate
Every clinical and operational collection document (`medications`, `medication_schedules`, `medication_events`, `appointments`, `care_timeline_events`, `medication_change_history`, `caregiver_assignments`) **must** include a non-nullable `patientId` field at the root level of the document payload. 

#### 3.5.2 Deterministic RBAC Bridge Pattern
Rather than scanning dynamic permissions arrays inside the `patients` document, Firestore Security Rules verify access by reading the deterministic bridge document located at `/caregiver_assignments/{userId}_{patientId}`. 

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper: Verify user authentication
    function isAuthenticated() {
      return request.auth != null && request.auth.uid != null;
    }

    // Helper: Load caregiver assignment document in O(1)
    function getAssignment(patientId) {
      return get(/databases/$(database)/documents/caregiver_assignments/$(request.auth.uid + '_' + patientId)).data;
    }

    // Helper: Check if active assignment exists
    function isAssignedToPatient(patientId) {
      let assignment = getAssignment(patientId);
      return assignment != null && assignment.assignmentStatus == 'ACTIVE';
    }

    // Helper: Check if caregiver possesses a specific permission scope
    function hasPermission(patientId, scope) {
      let assignment = getAssignment(patientId);
      return isAssignedToPatient(patientId) && (scope in assignment.permissions);
    }

    // --- PATIENTS COLLECTION ---
    match /patients/{patientId} {
      allow read: if isAuthenticated() && isAssignedToPatient(patientId);
      allow create: if isAuthenticated(); // Controlled via Cloud Function or Family Admin
      allow update: if isAuthenticated() && hasPermission(patientId, 'patient:write');
      allow delete: if false; // Hard deletes strictly disallowed; enforce soft-delete via update
    }

    // --- MEDICATIONS & SCHEDULES ---
    match /medications/{medicationId} {
      allow read: if isAuthenticated() && isAssignedToPatient(resource.data.patientId);
      allow write: if isAuthenticated() && hasPermission(request.resource.data.patientId, 'medications:modify');
    }

    match /medication_schedules/{scheduleId} {
      allow read: if isAuthenticated() && isAssignedToPatient(resource.data.patientId);
      allow write: if isAuthenticated() && hasPermission(request.resource.data.patientId, 'medications:modify');
    }

    // --- MEDICATION EVENTS ---
    match /medication_events/{eventId} {
      allow read: if isAuthenticated() && isAssignedToPatient(resource.data.patientId);
      allow create: if isAuthenticated() && hasPermission(request.resource.data.patientId, 'medications:administer');
      allow update: if isAuthenticated() && 
                    hasPermission(resource.data.patientId, 'medications:administer') &&
                    request.resource.data.patientId == resource.data.patientId; // Immutable tenant key
      allow delete: if false;
    }

    // --- CARE TIMELINE EVENTS ---
    match /care_timeline_events/{timelineId} {
      allow read: if isAuthenticated() && isAssignedToPatient(resource.data.patientId);
      allow create: if isAuthenticated() && hasPermission(request.resource.data.patientId, 'timeline:write');
      allow update: if isAuthenticated() && hasPermission(resource.data.patientId, 'timeline:write');
      allow delete: if false;
    }

    // --- APPOINTMENTS ---
    match /appointments/{appointmentId} {
      allow read: if isAuthenticated() && isAssignedToPatient(resource.data.patientId);
      allow write: if isAuthenticated() && hasPermission(request.resource.data.patientId, 'appointments:manage');
    }

    // --- CAREGIVER ASSIGNMENTS ---
    match /caregiver_assignments/{assignmentId} {
      allow read: if isAuthenticated() && (
        resource.data.userId == request.auth.uid || 
        hasPermission(resource.data.patientId, 'invites:manage')
      );
      allow write: if isAuthenticated() && hasPermission(request.resource.data.patientId, 'invites:manage');
    }
  }
}
```

---

### 3.6 Distributed Idempotency and Deduplication Engine

In an elderly-care environment, two caregivers or family members often attempt to confirm a medication dose simultaneously (e.g., a visiting nurse hands the pill to the senior, while a daughter in another room logs the dose on her phone). Furthermore, cellular reconnects frequently replay write mutations. 

To eliminate duplicate logging and data corruption, JEEVASETU enforces **Deterministic Idempotency Keys** for document IDs.

#### 3.6.1 Key Synthesis Formulation

```
Scheduled Event Document ID:
  id = SHA-256( patientId + "_" + scheduleId + "_" + scheduledTimeUTC_ISO )
  Example:
  patientId: "pat_8819"
  scheduleId: "sch_metformin_0800"
  scheduledTime: "2026-11-15T08:00:00Z"
  Deterministic ID: "pat_8819_sch_metformin_0800_20261115T080000Z"

PRN (As-Needed) Event Document ID:
  id = "prn_" + patientId + "_" + clientGeneratedUUID
```

#### 3.6.2 State Machine for Idempotent Dose Confirmation

```
                    ┌─────────────────────────┐
                    │       UNCONFIRMED       │
                    │ (Synthesized by Engine) │
                    └────────────┬────────────┘
                                 │
             ┌───────────────────┼───────────────────┐
             ▼                   ▼                   ▼
      Caregiver Tap       Caregiver Action    Grace Period Elapsed
     [TAKEN Action]      [SKIPPED Action]      [No Caregiver Tap]
             │                   │                   │
             ▼                   ▼                   ▼
      ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
      │    TAKEN    │     │   SKIPPED   │     │   MISSED    │
      │  (Terminal) │     │  (Terminal) │     │ (Escalated) │
      └─────────────┘     └─────────────┘     └─────────────┘
```

#### 3.6.3 Atomic Firestore Transaction for Idempotent Writes

When a caregiver logs a dose on mobile or web, the client executes a Firestore transaction rather than a direct write:

```typescript
import { runTransaction, doc, serverTimestamp, Timestamp } from 'firebase/firestore';

async function confirmMedicationDose(
  db: Firestore,
  patientId: string,
  scheduleId: string,
  scheduledTimeIso: string,
  actor: { userId: string; userName: string; role: string },
  proofUrl?: string
): Promise<{ success: boolean; message: string }> {
  // Synthesize deterministic document key
  const deterministicKey = `${patientId}_${scheduleId}_${scheduledTimeIso.replace(/[-:]/g, '')}`;
  const eventDocRef = doc(db, 'medication_events', deterministicKey);

  return runTransaction(db, async (transaction) => {
    const eventSnapshot = await transaction.get(eventDocRef);

    if (eventSnapshot.exists()) {
      const currentStatus = eventSnapshot.data().status;
      if (currentStatus === 'TAKEN') {
        // Idempotent no-op: already logged by another caregiver
        return {
          success: true,
          message: `Dose was already recorded as TAKEN by ${eventSnapshot.data().recordedBy?.userName || 'another caregiver'}.`
        };
      }
    }

    // Atomic update or initial registration
    transaction.set(
      eventDocRef,
      {
        patientId,
        scheduleId,
        idempotencyKey: deterministicKey,
        status: 'TAKEN',
        actualTimeClient: Timestamp.now(),
        syncedAtServer: serverTimestamp(),
        recordedBy: actor,
        verificationMethod: proofUrl ? 'PHOTO_PROOF' : 'MANUAL_TAP',
        verificationProofUrl: proofUrl || null,
        isEscalated: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true, message: 'Dose logged successfully.' };
  });
}
```

---

### 3.7 Bi-Temporal Timestamp and Timezone Strategy

Elderly care spans disparate geographic environments, spotty connectivity in nursing homes, and seniors who travel across time zones. Miscalculating dose timing can lead to accidental double-dosing or dangerous medication withdrawal.

#### 3.7.1 The Tri-Timestamp Clinical Model
To ensure legal and clinical veracity, JEEVASETU captures three distinct temporal dimensions on every clinical transaction:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TRI-TIMESTAMP TAXONOMY                                         │
├─────────────────────┬──────────────────┬─────────────────────────────────────────────────────────┤
│ Timestamp Field     │ Origin Source    │ Architectural & Clinical Purpose                        │
├─────────────────────┼──────────────────┼─────────────────────────────────────────────────────────┤
│ `scheduledTime`     │ Regimen Engine   │ Canonical planned wall-clock time represented in UTC.   │
│                     │                  │ Determines adherence variance and grace periods.        │
├─────────────────────┼──────────────────┼─────────────────────────────────────────────────────────┤
│ `actualTimeClient`  │ Local Device OS  │ Real-world physical time when the tablet was swallowed   │
│                     │                  │ or administered, preserving accuracy despite offline    │
│                     │                  │ caching lasting hours or days.                          │
├─────────────────────┼──────────────────┼─────────────────────────────────────────────────────────┤
│ `syncedAtServer`    │ Cloud Firestore  │ Absolute truth (`FieldValue.serverTimestamp()`) when the│
│                     │ (Google Spanner) │ packet reached the cloud. Disregards device clock drift │
│                     │                  │ and orchestrates real-time broadcast fan-out.           │
└─────────────────────┴──────────────────┴─────────────────────────────────────────────────────────┘
```

#### 3.7.2 Offline Operation and Clock-Drift Correction
If a caregiver logs an event in an offline rural setting:
1. The client captures `actualTimeClient = Timestamp.now()` from local device hardware.
2. The client records `deviceClockOffsetMs` (calculated via NTP heartbeat when previously online).
3. Upon network reconnection, Firestore sets `syncedAtServer = serverTimestamp()`.
4. Clinical audit views display `actualTimeClient` as the primary clinical ingestion time, while system diagnostic logs review `syncedAtServer` to detect synchronization latency.

#### 3.7.3 Timezone Localization
Schedules store time strings as **Local Wall-Clock Strings** (`"08:00"`) paired with the patient’s home IANA timezone (`"Asia/Kolkata"`). 
* When daylight saving shifts occur, or when calculating daily adherence windows, timestamps are parsed relative to the patient's geographic home base rather than the caregiver's current viewing device.
* The mobile frontend translates all stored UTC timestamps to the active patient profile's local time zone using standard Luxon / date-fns libraries.

---

### 3.8 Data Lifecycle: Soft Deletes and Long-Term Archival

#### 3.8.1 Soft-Delete Architecture
To comply with medical record retention regulations and prevent catastrophic accidental deletions by exhausted caregivers:
1. **Zero Hard Deletes:** No client role possesses permissions to execute `delete()` on any document in Firestore.
2. **Soft-Delete Mutation Protocol:** Documents are flagged using:
   * `isDeleted: true`
   * `deletedAt: Timestamp.now()`
   * `deletedBy: request.auth.uid`
   * `deletionReason: string`
3. **Query Guardrails:** All application read queries incorporate `.where('isDeleted', '==', false)`. The composite indexes specified in Section 3.4 explicitly index `isDeleted` to ensure zero performance degradation.

#### 3.8.2 Three-Tier Storage and Archival Pipeline

```
                                  DATA LIFECYCLE PIPELINE
 
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │ TIER 1: HOT STORAGE (Cloud Firestore)                                                       │
 │ • Retention: 0 - 180 Days                                                                   │
 │ • Real-time live snapshots, offline mobile caching, sub-second query latency.               │
 └──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                │
                                                ▼ Automatic Real-Time Streaming
                                  (Firebase BigQuery Extension)
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │ TIER 2: WARM STORAGE (Google BigQuery)                                                      │
 │ • Retention: 180 Days - 7 Years                                                             │
 │ • Partitioned by `patientId` and ingested `_PARTITIONDATE`.                                 │
 │ • Adherence trend analysis, physician longitudinal reports, AI health predictions.          │
 └──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                │
                                                ▼ Scheduled Cloud Function
                                             (Purge Event from Firestore > 180d)
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │ TIER 3: COLD COMPLIANT ARCHIVE (Cloud Storage Parquet + Coldline)                           │
 │ • Retention: 7+ Years (Statutory Requirement)                                               │
 │ • GCS Buckets encrypted with customer-managed keys (CMEK). Immutable Object Lock enabled.   │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Automated Streaming to BigQuery:** The official Firebase Extension *Stream Collections to BigQuery* continuously mirrors `medication_events`, `care_timeline_events`, and `medication_change_history` into BigQuery dataset `jeevasetu_analytics`.
2. **Firestore Eviction Engine:** A daily Cloud Run / Cloud Scheduler cron job scans for `medication_events` with `scheduledTime < now() - 180 days`. It verifies the record exists in BigQuery, creates a compressed Parquet backup in GCS, and purges the Firestore record to maintain high performance and low storage costs.

---

### 3.9 TypeScript Interfaces and Domain Types

Below is the complete, strictly-typed domain model providing end-to-end type safety across the Web, Cloud Functions, and React Native / Flutter clients.

```typescript
/**
 * JEEVASETU ELDERLY-CARE PLATFORM
 * Section 3: Data Foundation & Database Domain Models
 */

import { Timestamp, GeoPoint } from 'firebase/firestore';

// ============================================================================
// 1. ENUMS & CONSTANTS
// ============================================================================

export type Gender = 'MALE' | 'FEMALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY';

export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'UNKNOWN';

export type MobilityLevel = 
  | 'INDEPENDENT' 
  | 'CANE_ASSISTED' 
  | 'WALKER_ASSISTED' 
  | 'WHEELCHAIR_BOUND' 
  | 'BEDRIDDEN';

export type CognitiveStatus = 
  | 'NORMAL' 
  | 'MILD_COGNITIVE_IMPAIRMENT' 
  | 'MODERATE_DEMENTIA' 
  | 'SEVERE_DEMENTIA';

export type FallRiskScore = 'LOW' | 'MEDIUM' | 'HIGH';

export type UserType = 
  | 'FAMILY_ADMIN' 
  | 'FAMILY_MEMBER' 
  | 'PROFESSIONAL_CAREGIVER' 
  | 'CLINICIAN' 
  | 'EMERGENCY_DISPATCHER';

export type CaregiverRole = 
  | 'PRIMARY_FAMILY_ADMIN' 
  | 'SECONDARY_FAMILY' 
  | 'PAID_NURSE' 
  | 'ASSISTANT_CAREGIVER' 
  | 'DOCTOR';

export type AssignmentStatus = 'ACTIVE' | 'PAUSED' | 'REVOKED';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';

export type DosageForm = 
  | 'TABLET' 
  | 'CAPSULE' 
  | 'LIQUID' 
  | 'INJECTION' 
  | 'PATCH' 
  | 'INHALER' 
  | 'DROPS' 
  | 'TOPICAL';

export type RouteOfAdministration = 
  | 'ORAL' 
  | 'SUBLINGUAL' 
  | 'TOPICAL' 
  | 'SUBCUTANEOUS' 
  | 'INTRAMUSCULAR' 
  | 'INHALATION' 
  | 'OPHTHALMIC';

export type FoodIntakeRelation = 
  | 'BEFORE_FOOD' 
  | 'WITH_FOOD' 
  | 'AFTER_FOOD' 
  | 'EMPTY_STOMACH' 
  | 'IRRELEVANT';

export type MedicationStatus = 'ACTIVE' | 'PAUSED' | 'DISCONTINUED';

export type ScheduleFrequencyType = 
  | 'DAILY' 
  | 'SPECIFIC_DAYS' 
  | 'INTERVAL_HOURS' 
  | 'CYCLICAL' 
  | 'PRN_ONLY';

export type MedicationEventStatus = 'UNCONFIRMED' | 'TAKEN' | 'SKIPPED' | 'MISSED';

export type VerificationMethod = 
  | 'MANUAL_TAP' 
  | 'PHOTO_PROOF' 
  | 'NFC_PILLBOX' 
  | 'SMART_BLISTER_BLE';

export type SkipReason = 
  | 'PATIENT_REFUSED' 
  | 'ADVERSE_REACTION' 
  | 'MEDICATION_UNAVAILABLE' 
  | 'PHYSICIAN_ORDER' 
  | 'FASTING' 
  | 'OTHER';

export type MedicationChangeType = 
  | 'CREATED' 
  | 'DOSAGE_MODIFIED' 
  | 'SCHEDULE_CHANGED' 
  | 'PAUSED' 
  | 'RESUMED' 
  | 'DISCONTINUED';

export type AppointmentStatus = 
  | 'SCHEDULED' 
  | 'CONFIRMED' 
  | 'IN_PROGRESS' 
  | 'COMPLETED' 
  | 'CANCELLED' 
  | 'RESCHEDULED';

export type TimelineCategory = 
  | 'MEDICATION' 
  | 'APPOINTMENT' 
  | 'VITALS' 
  | 'INCIDENT_FALL' 
  | 'NUTRITION' 
  | 'MOOD_COGNITION' 
  | 'NOTE' 
  | 'SYSTEM_ALERT';

export type EventSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ============================================================================
// 2. SUB-MAP MODELS & VALUE OBJECTS
// ============================================================================

export interface Address {
  street: string;
  apartment?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  geoPoint?: GeoPoint;
}

export interface AllergyEntry {
  allergen: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING';
  reaction: string;
}

export interface VisualPillDescription {
  pillColor: string;
  pillShape: string;
  pillImprint?: string;
  photoUrl: string;
}

export interface MedicationSummary {
  name: string;
  strength: string;
  dosageForm: DosageForm;
  photoUrl: string;
}

export interface UserSummary {
  userId: string;
  userName: string;
  role: string;
  avatarUrl?: string;
}

export interface NotificationSettings {
  pushEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  automatedPhoneCallAlert: boolean;
  quietHoursStart?: string; // "22:00"
  quietHoursEnd?: string;   // "07:00"
}

export interface FcmTokenEntry {
  token: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  updatedAt: Timestamp;
}

export interface AssignedPatientSummary {
  patientId: string;
  patientName: string;
  role: CaregiverRole;
  avatarUrl?: string;
}

// ============================================================================
// 3. CORE DOCUMENT INTERFACES
// ============================================================================

/** Collection: patients */
export interface PatientDocument {
  id: string;
  fullName: string;
  preferredName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: Gender;
  bloodGroup: BloodGroup;
  primaryLanguage: string;
  photoUrl?: string;
  address: Address;
  homePhone?: string;
  timezone: string; // e.g. "Asia/Kolkata"
  primaryDiagnoses: string[];
  allergies: AllergyEntry[];
  mobilityStatus: MobilityLevel;
  cognitiveStatus: CognitiveStatus;
  fallRiskLevel: FallRiskScore;
  emergencyNotes?: string;
  advanceDirectiveOnFire: boolean;
  advanceDirectiveDocUrl?: string;
  primaryPhysician?: {
    name: string;
    phone: string;
    clinic: string;
  };
  isDeleted: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Collection: users */
export interface UserDocument {
  id: string; // Matches Firebase Auth UID
  displayName: string;
  email: string;
  phoneNumber: string;
  photoUrl?: string;
  userType: UserType;
  notificationSettings: NotificationSettings;
  fcmTokens: FcmTokenEntry[];
  assignedPatientSummaries: AssignedPatientSummary[];
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'DEACTIVATED';
  lastActiveAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Collection: caregiver_assignments */
export interface CaregiverAssignmentDocument {
  id: string; // Pattern: `${userId}_${patientId}`
  patientId: string;
  userId: string;
  role: CaregiverRole;
  relationshipToPatient: string;
  permissions: string[];
  isEmergencyContact: boolean;
  emergencyPriorityOrder?: number;
  shiftSchedule?: {
    daysOfWeek: number[];
    startTime: string; // "08:00"
    endTime: string;   // "17:00"
  };
  assignmentStatus: AssignmentStatus;
  assignedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Collection: access_invitations */
export interface AccessInvitationDocument {
  id: string; // Secure token
  patientId: string;
  patientName: string;
  invitedByUserId: string;
  invitedByUserName: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  targetRole: CaregiverRole;
  targetPermissions: string[];
  status: InvitationStatus;
  expiresAt: Timestamp;
  acceptedByUserId?: string;
  acceptedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Collection: medications */
export interface MedicationDocument {
  id: string;
  patientId: string;
  name: string;
  genericName: string;
  rxNormCode?: string;
  dosageForm: DosageForm;
  strength: string;
  route: RouteOfAdministration;
  visualDescription: VisualPillDescription;
  foodRelation: FoodIntakeRelation;
  specialInstructions?: string;
  prescribingDoctor?: {
    name: string;
    clinic: string;
    contactPhone: string;
    prescriptionNum: string;
  };
  currentInventory: number;
  refillThreshold: number;
  isPRN: boolean;
  isHighRisk: boolean;
  status: MedicationStatus;
  isDeleted: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** Collection: medication_schedules */
export interface MedicationScheduleDocument {
  id: string;
  patientId: string;
  medicationId: string;
  medicationSummary: MedicationSummary;
  scheduleType: ScheduleFrequencyType;
  timesOfDay: string[]; // ["08:00", "14:00", "20:00"]
  daysOfWeek: number[]; // 0 = Sun, 6 = Sat
  intervalHours?: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD (null for ongoing)
  doseQuantity: string; // "1 Tablet"
  gracePeriodMinutes: number;
  escalationRules: {
    unconfirmedThresholdMin: number;
    notifyCaregiverRoles: string[];
  };
  isActive: boolean;
  timezone: string;
  isDeleted: boolean;
  deletedAt?: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** Collection: medication_events */
export interface MedicationEventDocument {
  id: string; // Deterministic Idempotency Key
  patientId: string;
  scheduleId?: string;
  medicationId: string;
  medicationSummary: MedicationSummary;
  status: MedicationEventStatus;
  scheduledTime: Timestamp;
  actualTimeClient?: Timestamp;
  syncedAtServer: Timestamp;
  doseAdministered: string;
  recordedBy?: UserSummary;
  skipReason?: SkipReason;
  skipNotes?: string;
  verificationMethod: VerificationMethod;
  verificationProofUrl?: string;
  isEscalated: boolean;
  escalatedAt?: Timestamp;
  idempotencyKey: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Collection: medication_change_history */
export interface MedicationChangeHistoryDocument {
  id: string;
  patientId: string;
  medicationId: string;
  medicationName: string;
  changeType: MedicationChangeType;
  reasonForChange: string;
  changedBy: UserSummary;
  authorizingDoctor?: {
    doctorName: string;
    clinic: string;
    consultationDate: string;
  };
  snapshotBefore: Record<string, unknown>;
  snapshotAfter: Record<string, unknown>;
  effectiveDate: Timestamp;
  createdAt: Timestamp;
}

/** Collection: appointments */
export interface AppointmentDocument {
  id: string;
  patientId: string;
  title: string;
  specialty: string;
  doctorName: string;
  facilityName: string;
  location?: {
    address: string;
    room?: string;
    geoPoint?: GeoPoint;
    mapsUrl?: string;
  };
  isTelehealth: boolean;
  telehealthUrl?: string;
  scheduledStartTime: Timestamp;
  scheduledEndTime: Timestamp;
  reminderOffsets: number[]; // e.g., [1440, 120, 30] in minutes
  escortUserId?: string;
  transportationStatus: 'NOT_REQUIRED' | 'ARRANGED' | 'PENDING_BOOKING' | 'AMBULANCE_SCHEDULED';
  prepInstructions?: string;
  status: AppointmentStatus;
  clinicalSummary?: string;
  prescriptionUrls: string[];
  isDeleted: boolean;
  deletedAt?: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** Collection: care_timeline_events */
export interface CareTimelineEventDocument {
  id: string;
  patientId: string;
  category: TimelineCategory;
  eventType: string; // e.g., "MED_TAKEN", "FALL_DETECTED", "BP_HIGH"
  severity: EventSeverity;
  title: string;
  summary: string;
  eventTimestamp: Timestamp;
  payload?: Record<string, unknown>;
  relatedEntityRef?: {
    collection: string;
    id: string;
  };
  mediaUrls: string[];
  loggedBy: UserSummary;
  requiresAcknowledgement: boolean;
  acknowledgedBy: Array<{
    userId: string;
    userName: string;
    timestamp: Timestamp;
  }>;
  isDeleted: boolean;
  createdAt: Timestamp;
}
```

---

### Summary Checklist for Implementation

| Design Dimension | Architectural Decision | Primary Benefit |
| :--- | :--- | :--- |
| **Collection Topology** | Flattened root collections with mandatory `patientId` | Rapid multi-patient dashboard aggregation; no hierarchical locking. |
| **Security Architecture** | O(1) Bridge document `/caregiver_assignments/{userId}_{patientId}` | Fast security rule checks that stay well within Firestore read limits. |
| **Adherence Reliability** | Deterministic SHA-256 IDs for scheduled medication events | Eliminates race-condition duplicate logging across multiple family members. |
| **Offline Synchronization** | Bi-Temporal Triad (`scheduledTime`, `actualTimeClient`, `syncedAtServer`) | True clinical compliance timelines regardless of connectivity loss. |
| **Compliance & Storage** | Soft-deletes + 180-day TTL via Firebase Extension to BigQuery | Satisfies legal audit retention without ballooning hot Firestore storage. |


---\n
## 4. User Roles and Authorization Matrix

### 4.1 Role Definitions and Identity Architecture

The JEEVASETU platform implements a scoped, multi-tenant Role-Based Access Control (RBAC) model tailored to elderly care. Because caregiving involves vulnerable individuals, distributed family custodians, and professional external staff, identity and authorization must guarantee strict patient isolation while facilitating legitimate collaborative care.

```
                          +------------------------+
                          |   Firebase Auth User   |
                          | (UID, Verified Phone)  |
                          +-----------+------------+
                                      |
                     +----------------+----------------+
                     | Context Switch                  | Context Switch
                     v                                 v
        +-------------------------+       +-------------------------+
        |  Patient Tenancy (P-01) |       |  Patient Tenancy (P-02) |
        |  Role: primary_family   |       |  Role: caregiver        |
        +-------------------------+       +-------------------------+
```

#### 4.1.1 Role Definitions
*   **`patient`**: The elderly individual receiving care. The patient has access to their own health schedule, daily timeline, personal profile, and care cards. To safeguard cognitively impaired or vulnerable elders against coercion, social engineering, or accidental account lockout, administrative powers (such as inviting external users or modifying clinical prescriptions) are restricted from this role.
*   **`primary_family`**: The legal or designated primary family custodian (e.g., adult child, healthcare proxy). This is the elevated administrative authority for a specific patient. The `primary_family` manages access grants, invites family members, contracts and assigns caregivers, updates clinical profiles, configures emergency contacts, exports longitudinal health records, and oversees patient data custody.
*   **`family_member`**: Non-administrative relatives (e.g., secondary children, grandchildren, siblings). Members in this role have read access to the care plan, medications, vital trends, and appointments to maintain emotional and logistical connection. They can record ad-hoc wellness observations and log medication adherence when assisting, but cannot alter prescribed regimens or manage user access.
*   **`caregiver`**: Professional in-home nurses, healthcare aides, or shift attendants. Caregivers hold operational permissions focused on immediate, day-to-day care delivery: viewing prescribed medications, logging real-time administration events, logging vitals, executing shift handovers, and viewing emergency care cards. Caregivers are strictly barred from profile reconfigurations, data exports, access management, and cross-patient visibility.

---

#### 4.1.2 Storage Architecture: Custom Claims vs. Document Fields

In a healthcare environment where users frequently manage or provide care for multiple elderly individuals, the mechanism chosen to store roles has direct consequences on security, token payload limits, and revocation latency.

```
+--------------------------------------------------------------------------------------------------+
| COMPARISON DIMENSION    | FIREBASE AUTH CUSTOM CLAIMS       | FIRESTORE MEMBERSHIP DOCUMENTS     |
+-------------------------+-----------------------------------+------------------------------------+
| Storage Location        | JWT Payload (request.auth.token)  | /patients/{pId}/members/{userId}   |
| Size Constraint         | Hard cap of 1,000 bytes for token | 1 MB per document (effectively unl)|
| Revocation Latency      | High (Requires token refresh or   | Zero (Instantaneous on next rule   |
|                         | session revocation; up to 1 hour) | evaluation or database read)       |
| Multi-Patient Scale     | O(N) token growth; breaks at ~8-12| Arbitrary scale; each patient is a |
|                         | patient associations              | distinct isolated sub-document     |
| Security Rule Query     | In-memory lookup:                 | Document lookup:                   |
| Overhead                | request.auth.token.role           | get() / exists() evaluation        |
+--------------------------------------------------------------------------------------------------+
```

##### Architectural Decision: Dual-Tier Scoped Storage Model
JEEVASETU strictly rejects storing patient-specific roles inside Firebase Auth Custom Claims due to the **1,000-byte token limit**, **inability to perform instant revocation**, and **stale token vulnerabilities** when a caregiver is dismissed. 

Instead, JEEVASETU employs a **Hybrid Identity Architecture**:

1.  **Firebase Auth Custom Claims (Global Identity Claims Only)**:
    Custom claims are reserved exclusively for immutable or system-level identity flags:
    ```json
    {
      "uid": "usr_94a8f2c1",
      "phone_verified": true,
      "is_service_account": false,
      "account_disabled": false
    }
    ```
2.  **Firestore Relationship Documents (Patient-Scoped Roles)**:
    Patient authorizations are stored inside a dedicated subcollection under each patient record:
    `/patients/{patientId}/members/{userId}`
    ```json
    {
      "userId": "usr_94a8f2c1",
      "role": "caregiver",
      "status": "active",
      "assignedAt": "2026-11-15T08:00:00Z",
      "assignedBy": "usr_primary_fam_01",
      "expiresAt": "2026-12-31T23:59:59Z",
      "permissionsOverride": []
    }
    ```
3.  **Inverted User-to-Patient Index**:
    For rapid client-side tenant discovery and routing, an inverted reference index is maintained at:
    `/users/{userId}/patientAccess/{patientId}`
    ```json
    {
      "patientId": "pat_88192f",
      "role": "caregiver",
      "status": "active",
      "linkedAt": "2026-11-15T08:00:00Z"
    }
    ```

**Security Benefits**:
*   **Immediate Revocation**: If a caregiver is terminated, the `primary_family` updates `/patients/{patientId}/members/{caregiverId}` to `"status": "revoked"`. Subsequent API calls and Firestore operations are rejected instantly without waiting for JWT expiry.
*   **Unbounded Multi-Tenancy**: Caregivers can be associated with dozens of patients across their career without causing JWT header bloat.

---

### 4.2 Complete Authorization Matrix

The matrix below defines permissions for all operational capabilities within the platform.

#### Cell Definition Key:
*   **`allowed`**: The role is unconditionally authorized to perform this operation within the boundary of any patient record where they hold this active membership.
*   **`own-patient-only`**: The operation is strictly restricted to self-subject access—meaning the authenticated user **is** the patient (`request.auth.uid == patientId`). A user holding this role cannot perform the action on behalf of other individuals.
*   **`denied`**: The operation is forbidden under all circumstances for this role. Any attempt returns HTTP 403 Forbidden or a Firestore rule permission denial.

| Operation | `patient` | `family_member` | `caregiver` | `primary_family` |
| :--- | :---: | :---: | :---: | :---: |
| **view profile** | `own-patient-only` | `allowed` | `allowed` | `allowed` |
| **edit profile** | `own-patient-only`* | `denied` | `denied` | `allowed` |
| **view medications** | `own-patient-only` | `allowed` | `allowed` | `allowed` |
| **create medication** | `denied` | `denied` | `denied` | `allowed` |
| **log medication event** | `own-patient-only` | `allowed` | `allowed` | `allowed` |
| **view appointments** | `own-patient-only` | `allowed` | `allowed` | `allowed` |
| **create appointment** | `own-patient-only` | `allowed` | `denied` | `allowed` |
| **view timeline** | `own-patient-only` | `allowed` | `allowed` | `allowed` |
| **manage access/invitations** | `denied` | `denied` | `denied` | `allowed` |
| **assign caregiver** | `denied` | `denied` | `denied` | `allowed` |
| **acknowledge handover** | `denied` | `denied` | `allowed` | `allowed` |
| **view care gaps** | `own-patient-only` | `allowed` | `allowed` | `allowed` |
| **export data** | `own-patient-only` | `denied` | `denied` | `allowed` |
| **print care card** | `own-patient-only` | `allowed` | `allowed` | `allowed` |

*\*Note on `edit profile` for `patient`: The patient is permitted to update non-clinical personal preferences (preferred name, preferred language, theme). Clinical emergency details, chronic condition listings, and guardian contacts can only be modified by the `primary_family`.*

---

### 4.3 Defense-in-Depth Enforcement Model

To prevent authorization bypasses, JEEVASETU rejects reliance on a single security layer. Client-side checks are treated strictly as UX conveniences. Real-time data streams and administrative transactions are guarded by two independent, synchronized policy barriers:

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT APPLICATION                                |
|  - Active Patient Context (State)                                                 |
|  - UI Visibility Filters (Optimistic Rendering)                                   |
+-----------------------------------------+-----------------------------------------+
                                          |
                      +-------------------+-------------------+
                      |                                       |
                      v                                       v
        [ DIRECT FIRESTORE SDK ]                     [ BACKEND REST / RPC API ]
                      |                                       |
                      v                                       v
         +--------------------------+            +--------------------------+
         |  FIRESTORE SECURITY      |            |  SERVER-SIDE MIDDLEWARE  |
         |  RULES (DATA TIER)       |            |  (LOGIC TIER)            |
         |                          |            |                          |
         | - Path-based containment |            | - Header vs Param check  |
         | - Membership check       |            | - Strict Schema check    |
         | - Immutability locks     |            | - Cryptographic Auditing |
         | - Role-permission map    |            | - Revocation validation  |
         +------------+-------------+            +------------+-------------+
                      |                                       |
                      +-------------------+-------------------+
                                          |
                                          v
                              +-----------------------+
                              | SECURE FIRESTORE DATA |
                              | (Patient Partition)   |
                              +-----------------------+
```

1.  **Layer 1: Edge & Network Security**:
    *   API Gateway / Cloud Armor enforces rate limiting (100 req/min per IP, 300 req/min per authenticated UID), TLS 1.3 termination, and CORS origin whitelisting.
2.  **Layer 2: Server-Side Authorization Middleware (Compute Tier)**:
    *   Applies to all HTTP REST endpoints, Cloud Run microservices, and callable Cloud Functions.
    *   Verifies identity via Firebase Admin Auth, checks token revocation, extracts target patient identifiers, resolves the caller's membership from Firestore, verifies expiration, and enforces the permission matrix before business logic executes.
    *   Executes sensitive side-effects: writing immutable audit logs, generating signed export packages, and dispatching emergency SMS/Push notifications.
3.  **Layer 3: Firestore Security Rules (Data Tier)**:
    *   Applies to all direct client interactions using the Firebase Web/Mobile SDK (e.g., real-time listeners on `/medications` or `/timeline`).
    *   Enforces isolation at the database engine level. Even if an attacker executes raw SDK commands in their browser console, Firestore rules reject any read or write where the authenticated UID does not possess an active membership record in that patient's tenancy.
4.  **Layer 4: Immutable Audit Logging**:
    *   Administrative changes (member invitations, caregiver assignment, access revocations, data exports) are written to an append-only audit ledger (`/patients/{patientId}/audit_logs`) accessible only via Admin SDK bypass on trusted backend workers.

---

### 4.4 Firestore Security Rules Architecture (Patient Data Isolation)

The rules enforce complete data partitioning under the `/patients/{patientId}` hierarchy. Direct client queries must be path-scoped; collection-group queries without patient context filters are rejected.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // =========================================================================
    // SECURITY HELPER FUNCTIONS
    // =========================================================================

    function isAuthenticated() {
      return request.auth != null && request.auth.uid != null;
    }

    // Resolves the caller's membership record for the requested patient
    function getMembership(patientId) {
      return get(/databases/$(database)/documents/patients/$(patientId)/members/$(request.auth.uid)).data;
    }

    // Validates that caller has an active, non-expired membership
    function isActiveMember(patientId) {
      let member = getMembership(patientId);
      return isAuthenticated() &&
             member != null &&
             member.status == 'active' &&
             (member.expiresAt == null || member.expiresAt > request.time);
    }

    // Role verification helpers
    function getRole(patientId) {
      return getMembership(patientId).role;
    }

    function isPatient(patientId) {
      return isAuthenticated() && request.auth.uid == patientId;
    }

    function isPrimaryFamily(patientId) {
      return isActiveMember(patientId) && getRole(patientId) == 'primary_family';
    }

    function isFamilyMember(patientId) {
      return isActiveMember(patientId) && getRole(patientId) == 'family_member';
    }

    function isCaregiver(patientId) {
      return isActiveMember(patientId) && getRole(patientId) == 'caregiver';
    }

    // Any authorized user linked to the patient
    function hasAnyPatientAccess(patientId) {
      return isPatient(patientId) || isActiveMember(patientId);
    }

    // =========================================================================
    // PATIENT ROOT & SUBCOLLECTIONS
    // =========================================================================

    match /patients/{patientId} {
      // Profile viewing: Any linked member or the patient themselves
      allow get: if hasAnyPatientAccess(patientId);
      allow list: if false; // Disallow broad enumeration of all patient records

      // Profile editing: Primary family has full edit; Patient can update personal preferences only
      allow update: if isPrimaryFamily(patientId) ||
                       (isPatient(patientId) && 
                        !request.resource.data.diff(resource.data).affectedKeys()
                          .hasAny(['primaryFamilyId', 'medicalConditions', 'emergencyContacts', 'isActive']));
      allow create, delete: if false; // Provisioned exclusively via trusted backend service

      // -----------------------------------------------------------------------
      // Tenancy Members: Manages who has access to this patient
      // -----------------------------------------------------------------------
      match /members/{memberId} {
        allow read: if hasAnyPatientAccess(patientId);
        
        // Strict privilege escalation lock:
        // Only primary_family can create or alter members; cannot escalate own permissions
        allow write: if isPrimaryFamily(patientId) && 
                        request.auth.uid != memberId && // Cannot modify own member record directly
                        request.resource.data.role != 'primary_family'; // Transfers require backend flow
      }

      // -----------------------------------------------------------------------
      // Medications: Clinical prescriptions and schedules
      // -----------------------------------------------------------------------
      match /medications/{medicationId} {
        allow read: if hasAnyPatientAccess(patientId);
        // Only primary_family can prescribe or update clinical regimens
        allow create, update, delete: if isPrimaryFamily(patientId);
      }

      // -----------------------------------------------------------------------
      // Medication Events: Administration logs (adherence verification)
      // -----------------------------------------------------------------------
      match /medication_events/{eventId} {
        allow read: if hasAnyPatientAccess(patientId);
        
        // Patients, caregivers, and family can log adherence events
        allow create: if hasAnyPatientAccess(patientId) &&
                         request.resource.data.loggedBy == request.auth.uid &&
                         request.resource.data.timestamp <= request.time &&
                         request.resource.data.patientId == patientId;

        // Append-only audit integrity: Medical events cannot be modified or erased
        allow update, delete: if false;
      }

      // -----------------------------------------------------------------------
      // Appointments: Medical consultations and visits
      // -----------------------------------------------------------------------
      match /appointments/{appointmentId} {
        allow read: if hasAnyPatientAccess(patientId);
        // Caregivers cannot book appointments; patient and family can
        allow create, update: if isPatient(patientId) || isPrimaryFamily(patientId) || isFamilyMember(patientId);
        allow delete: if isPrimaryFamily(patientId);
      }

      // -----------------------------------------------------------------------
      // Caregiver Handovers: Shift transition briefings
      // -----------------------------------------------------------------------
      match /handovers/{handoverId} {
        allow read: if isCaregiver(patientId) || isPrimaryFamily(patientId);
        allow create: if isCaregiver(patientId) && 
                         request.resource.data.outgoingCaregiverId == request.auth.uid;
        allow update: if (isCaregiver(patientId) && 
                          request.resource.data.incomingCaregiverId == request.auth.uid) ||
                         isPrimaryFamily(patientId);
        allow delete: if false;
      }

      // -----------------------------------------------------------------------
      // Care Gaps & Clinical Insights: Read-only for clients
      // -----------------------------------------------------------------------
      match /care_gaps/{gapId} {
        allow read: if hasAnyPatientAccess(patientId);
        allow write: if false; // Generated exclusively by backend analytics engine
      }

      // -----------------------------------------------------------------------
      // Audit Logs: Read-only for primary_family; writeable by backend only
      // -----------------------------------------------------------------------
      match /audit_logs/{logId} {
        allow read: if isPrimaryFamily(patientId);
        allow write: if false;
      }
    }

    // =========================================================================
    // INVERTED USER ACCESS DIRECTORY
    // =========================================================================
    match /users/{userId}/patientAccess/{patientId} {
      // Users can only read their own linked patient directory
      allow read: if isAuthenticated() && request.auth.uid == userId;
      allow write: if false; // Maintained exclusively by backend synchronization hooks
    }
  }
}
```

---

### 4.5 Server-Side Authorization Middleware Design

The backend API (implemented in TypeScript/Express or Cloud Run microservices) enforces authorization before any business controller executes. The middleware intercepts the request, validates cryptographic proofs, enforces tenant integrity, checks for conflicting headers, and verifies membership statuses against low-latency caches.

```
                              HTTP Request
                                   |
                                   v
             +-------------------------------------------+
             |        authenticateBearerToken            |
             | - Validates Firebase JWT                  |
             | - Checks token revocation flag            |
             +---------------------+---------------------+
                                   |
                                   v
             +-------------------------------------------+
             |         resolvePatientContext             |
             | - Extracts patientId from path param      |
             | - Compares with 'x-active-patient-id'     |
             | - Rejects conflicting tenant indicators   |
             +---------------------+---------------------+
                                   |
                                   v
             +-------------------------------------------+
             |         requirePatientRole(...)           |
             | - Reads /patients/{pId}/members/{uid}     |
             |   (Redis Cache -> Firestore Fallback)     |
             | - Evaluates active status & expiration    |
             | - Compares user role against AllowedRoles |
             +---------------------+---------------------+
                                   |
                     +-------------+-------------+
                     |                           |
             Pass    v                   Fail    v
         +-----------------------+   +-----------------------+
         | Attach req.tenant     |   | 403 Forbidden /       |
         | Next() -> Controller  |   | Security Audit Alert  |
         +-----------------------+   +-----------------------+
```

#### 4.5.1 Middleware Implementation

```typescript
import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const db = admin.firestore();

export type PlatformRole = 'patient' | 'primary_family' | 'family_member' | 'caregiver';

export interface PatientMembership {
  patientId: string;
  userId: string;
  role: PlatformRole;
  status: 'active' | 'revoked' | 'suspended';
  expiresAt: FirebaseFirestore.Timestamp | null;
}

export interface AuthenticatedTenantRequest extends Request {
  user: admin.auth.DecodedIdToken;
  tenant: {
    patientId: string;
    role: PlatformRole;
    membership: PatientMembership;
  };
}

/**
 * 1. Authenticate Token Middleware
 * Validates the Firebase ID Token and verifies revocation status.
 */
export async function authenticateBearerToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header.' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // checkRevoked = true guarantees rejected access immediately if session is invalidated
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    (req as any).user = decodedToken;
    next();
  } catch (err: any) {
    res.status(401).json({ error: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
    return;
  }
}

/**
 * 2. Confused Deputy Protection Middleware
 * Verifies that the route param :patientId matches the 'x-active-patient-id' header.
 */
export function validateTenantBinding(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const paramPatientId = req.params.patientId;
  const headerPatientId = req.headers['x-active-patient-id'] as string;

  if (!paramPatientId) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'Target patient context is missing from request path.' });
    return;
  }

  if (headerPatientId && headerPatientId !== paramPatientId) {
    // Potential Confused Deputy or UI desynchronization attempt
    res.status(400).json({
      error: 'TENANT_MISMATCH',
      message: 'Route patient ID does not match active workspace header.'
    });
    return;
  }

  next();
}

/**
 * 3. Role-Based Access Enforcement Factory
 * Validates active membership and ensures the role is permitted for the action.
 */
export function requirePatientRole(allowedRoles: PlatformRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user as admin.auth.DecodedIdToken;
    const patientId = req.params.patientId;

    if (!user || !patientId) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Security pipeline misconfiguration.' });
      return;
    }

    // Direct Patient Self-Access Check
    if (user.uid === patientId) {
      if (allowedRoles.includes('patient')) {
        (req as AuthenticatedTenantRequest).tenant = {
          patientId,
          role: 'patient',
          membership: {
            patientId,
            userId: user.uid,
            role: 'patient',
            status: 'active',
            expiresAt: null
          }
        };
        next();
        return;
      } else {
        res.status(403).json({ error: 'INSUFFICIENT_PRIVILEGES', message: 'Operation not permitted for patient role.' });
        return;
      }
    }

    // Retrieve Membership (Layered Redis Cache -> Firestore)
    const cacheKey = `tenant:${patientId}:member:${user.uid}`;
    let membership: PatientMembership | null = null;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        membership = JSON.parse(cached);
      } else {
        const memberDoc = await db
          .collection('patients')
          .doc(patientId)
          .collection('members')
          .doc(user.uid)
          .get();

        if (memberDoc.exists) {
          membership = memberDoc.data() as PatientMembership;
          // Cache for 60 seconds (bounded TTL ensures swift propagation of revocations)
          await redis.setex(cacheKey, 60, JSON.stringify(membership));
        }
      }
    } catch (dbError) {
      res.status(500).json({ error: 'DATABASE_ERROR', message: 'Failed to verify tenancy permissions.' });
      return;
    }

    // Verify Active Status
    if (!membership || membership.status !== 'active') {
      res.status(403).json({ error: 'ACCESS_DENIED', message: 'No active membership found for this patient context.' });
      return;
    }

    // Verify Time-Bounded Access (e.g., temporary shift caregiver)
    if (membership.expiresAt) {
      const expirationMillis = membership.expiresAt.toMillis ? membership.expiresAt.toMillis() : (membership.expiresAt as any);
      if (Date.now() > expirationMillis) {
        res.status(403).json({ error: 'ACCESS_EXPIRED', message: 'Assigned caregiving authorization has expired.' });
        return;
      }
    }

    // Role Matrix Verification
    if (!allowedRoles.includes(membership.role)) {
      res.status(403).json({
        error: 'INSUFFICIENT_ROLE',
        message: `Action requires one of the following roles: [${allowedRoles.join(', ')}]. Current role: ${membership.role}`
      });
      return;
    }

    // Inject validated tenant context into request
    (req as AuthenticatedTenantRequest).tenant = {
      patientId,
      role: membership.role,
      membership
    };

    next();
  };
}
```

---

### 4.6 Privilege Escalation Prevention

To satisfy healthcare compliance and prevent adversarial lateral movement, JEEVASETU implements strict privilege ceiling controls.

```
                    PRIVILEGE ESCALATION ATTACK SURFACE
                                     |
       +-----------------------------+-----------------------------+
       |                             |                             |
       v                             v                             v
[ ATTACK VECTOR 1 ]           [ ATTACK VECTOR 2 ]           [ ATTACK VECTOR 3 ]
Self-Promotion via            Horizontal Account Takeover   Audit Record Tampering
Document Mutation             via Compromised Caregiver     or Adherence Deletion
       |                             |                             |
       v                             v                             v
[ DEFENSE CONTROL ]           [ DEFENSE CONTROL ]           [ DEFENSE CONTROL ]
- Rules ban writing to        - Time-bounded leases         - Firestore rules set
  own membership doc          - Cryptographic inviter ceiling update/delete: false
- Roles provisioned via       - Max 1 Primary Family lock   - Write-only via Server
  Admin SDK endpoints only    - Automated revoke on expiry    Admin SDK
```

#### 4.6.1 Self-Promotion Prevention
*   **The Threat**: An authenticated `caregiver` or `family_member` submits a direct Firestore SDK payload modifying their document at `/patients/{patientId}/members/{ownUid}` to `"role": "primary_family"`.
*   **Mitigation**:
    1.  Firestore security rules explicitly forbid a user from writing to their own member record:
        `allow write: if isPrimaryFamily(patientId) && request.auth.uid != memberId;`
    2.  Promotion of another user to `primary_family` cannot be executed via client SDKs. It requires an elevated Cloud Function endpoint executing a strict ownership transfer protocol (requiring re-authentication via SMS OTP sent to the existing `primary_family`).

#### 4.6.2 Inviter Privilege Ceiling
*   **The Threat**: An invited `family_member` generates an invitation link to onboard an external collaborator as `primary_family`.
*   **Mitigation**:
    1.  Only users verified as `primary_family` can invoke the invitation service.
    2.  The backend invitation engine enforces a privilege ceiling: an inviter cannot grant a role higher than their own, and `primary_family` creation is blocked in standard invitation flows.
    3.  Invitations are cryptographically signed HMAC tokens containing `{ patientId, role, targetEmail, nonce }` valid for 48 hours.

#### 4.6.3 Demotion & Orphan Tenancy Protection
*   **The Threat**: A rogue primary family member demotes themselves or leaves the patient account, leaving the elder's record in an unmanageable orphaned state.
*   **Mitigation**: The system enforces an invariant: **Every active patient must have exactly one active `primary_family`**. The database schema enforces that deleting or demoting a primary family member is rejected unless an active successor has accepted custodial transfer.

#### 4.6.4 Immutable Clinical Audit Trails
*   **The Threat**: A caregiver fails to administer critical insulin, realizes the mistake, and modifies or deletes the previous shift’s adherence log.
*   **Mitigation**:
    1.  The `/patients/{patientId}/medication_events` collection is **append-only**.
    2.  Firestore rules explicitly specify `allow update, delete: if false;`.
    3.  Late entries or corrections must be entered as distinct counter-records (`type: "amendment"`), preserving the full, unaltered history for clinical review and medicolegal accountability.

---

### 4.7 Multi-Patient Tenancy and Scoped Delegation Model

In elderly care, 1:1 user-to-patient mapping fails real-world requirements. A daughter (`family_member` or `primary_family`) may oversee care for both her father and mother. A professional in-home `caregiver` may serve four different elderly clients across a weekly shift roster.

```
       USER: Sarah Jenkins (Professional Caregiver / Daughter)
                            UID: usr_8820f1
                                   |
         +-------------------------+-------------------------+
         |                         |                         |
         v                         v                         v
+------------------+      +------------------+      +------------------+
| Patient: Mom     |      | Patient: Client A|      | Patient: Client B|
| Tenancy: P-101   |      | Tenancy: P-202   |      | Tenancy: P-303   |
| Role:            |      | Role:            |      | Role:            |
| primary_family   |      | caregiver        |      | caregiver        |
| Scope:           |      | Scope:           |      | Scope:           |
| Full Custodial   |      | Mon/Wed 08-16:00 |      | Tue/Thu 12-20:00 |
+------------------+      +------------------+      +------------------+
```

#### 4.7.1 Tenancy Data Model: Double-Indexed Scoping
To deliver instantaneous dashboard loading without executing expensive cross-collection scans, JEEVASETU maintains a dual-indexed relationship architecture:

1.  **Patient-Centric Partition (The Authority Partition)**:
    *   Path: `/patients/{patientId}/members/{userId}`
    *   Authority: Source of truth for all security rules and authorization evaluations.
2.  **User-Centric Index (The Routing Partition)**:
    *   Path: `/users/{userId}/patientAccess/{patientId}`
    *   Authority: Used exclusively by client applications upon login to populate the "Select Patient Workspace" dropdown.
    *   Consistency Guarantee: Maintained by an automated Firestore Cloud Function (`onWrite` trigger on `/patients/{patientId}/members/{userId}`) ensuring absolute synchronization.

#### 4.7.2 Workspace Context Switching & Request Flow
Multi-patient access requires absolute partition isolation to prevent accidental cross-contamination of health records (e.g., logging Client A's blood glucose to Client B's chart).

1.  **Client-Side Active Patient State**:
    *   The frontend application persists an `activePatientId` state variable.
    *   When the user switches from "Mom" to "Client A", the frontend clears all cached timeline items, medications, and notification streams from memory.
2.  **Enforced Request Scoping**:
    *   Every outbound HTTP call must include the header:
        `x-active-patient-id: <patientId>`
    *   Every Firestore real-time listener must be explicitly scoped to:
        `/patients/${activePatientId}/[subcollection]`
3.  **Confused Deputy Neutralization**:
    *   If a malicious client sends a request to `/api/v1/patients/patient_MOM/medications` but sets `x-active-patient-id: patient_CLIENT_A`, the `validateTenantBinding` middleware detects the contradiction and aborts the request with `HTTP 400 TENANT_MISMATCH`.

#### 4.7.3 Time-Bounded Delegation for Shift Caregivers
Caregivers frequently operate on rotational shifts or temporary agency contracts. JEEVASETU prevents stale permission risks via automatic time-bounding:

```json
{
  "userId": "usr_caregiver_55a",
  "role": "caregiver",
  "status": "active",
  "assignedAt": "2026-11-15T06:00:00Z",
  "expiresAt": "2026-11-15T18:00:00Z",
  "shiftId": "shf_morning_20261115"
}
```

*   **Rule Enforcement**: Security rules enforce `member.expiresAt > request.time`.
*   **Automatic Invalidation**: The moment 18:00:00Z arrives, the caregiver's access to `/patients/{patientId}/*` ceases immediately. The caregiver cannot inspect historical records or log further events unless a new shift assignment document is provisioned by the `primary_family`.
*   **Anomaly Detection**: The API Gateway tracks request distribution across multiple patient tenancies. If a single caregiver token attempts to query more than 10 distinct patient records within a 60-second window, the token is flagged for scraping behavior, blocked at the gateway level, and an alert is dispatched to platform security operations.


---\n
## 5. Authentication and Passcode Invitation Flow

---

### 5.1 Architectural Overview & User Persona Model

JEEVASETU is an elderly-care monitoring and assistance platform designed to connect vulnerable elderly individuals with family members, professional caregivers, and medical providers. The authentication subsystem balances **high-assurance medical/emergency access controls** with **cognitive accessibility for non-technical or elderly users**.

The platform categorizes users into three distinct operational personas:

1. **Primary Family Member (Care Coordinator)**: Digitally proficient relative who provisions the initial patient profile, controls administrative settings, manages care schedules, and issues access invitations.
2. **Invited Caregiver / Secondary Family Member**: Doctors, nurses, paid aids, or extended family members who access the patient's vitals, medical logs, and daily alerts based on assigned Least-Privilege access tiers.
3. **Elderly Patient**: End-user receiving care, requiring minimal authentication friction (e.g., dedicated kiosk view, biometric/PIN unlock on companion devices, or pre-authenticated tablet interfaces supervised by the primary coordinator).

To enforce zero-trust isolation, JEEVASETU pairs **Firebase Authentication** (identity layer) with **Google Cloud Functions / Cloud Run (Firebase Admin SDK)** and **Cloud Firestore** (role management, cryptographic validation, and access control).

```
+----------------------------------------------------------------------------------------------------+
|                                      JEEVASETU IDENTITY BOUNDARY                                   |
|                                                                                                    |
|  +---------------------------+       HTTPS Callable        +------------------------------------+  |
|  |     Client Application    | --------------------------> |    Cloud Functions / Cloud Run     |  |
|  | (Web / Android / iOS)     |                             |      (Node.js Admin SDK)           |  |
|  +---------------------------+                             +------------------------------------+  |
|       |               ^                                        |                 |                 |
|       | Credentials   | ID Token (JWT) + Custom Claims         | Verify / Revoke | Read / Write    |
|       v               |                                        v                 v                 |
|  +---------------------------+                             +---------------+  +-----------------+  |
|  |    Firebase Auth Core     |                             | Firebase Auth |  | Cloud Firestore |  |
|  | (Email/Password, Tokens)  |                             | Admin Backend |  | (Hashed Codes,  |  |
|  +---------------------------+                             +---------------+  |  Patient RBAC)  |  |
+----------------------------------------------------------------------------------------------------+
```

---

### 5.2 Registration Flow: First User (Primary Family Member & Patient Profile Setup)

The primary family member initiates the platform ecosystem by simultaneously establishing their authenticated identity and creating the root patient record.

#### 5.2.1 Registration Sequence & Security Guarantees
1. **Credential Validation & Account Provisioning**:
   - The user submits their email address and strong password through the client SDK (`createUserWithEmailAndPassword`).
   - The client verifies password strength locally (minimum 12 characters, checking against known breached passwords via zxcvbn) prior to hitting Firebase Auth.
2. **Atomic Initialization Handshake**:
   - Upon successful client credential generation, the client invokes an authenticated Cloud Function HTTPS Callable: `initializePrimaryCoordinator`.
   - The function executes an atomic Firestore transaction creating:
     - The `users/{primaryUid}` document containing identity metadata and communication preferences.
     - The `patients/{patientId}` record containing the elderly individual's demographic, clinical, and emergency baselines.
     - The `patient_memberships/{membershipId}` mapping defining the primary coordinator's administrative ownership.
3. **Role Minting (Custom Claims)**:
   - The Cloud Function injects security claims into the user's Firebase Auth account via `admin.auth().setCustomUserClaims(uid, claims)`.
   - Claims format:
     ```json
     {
       "roles": {
         "PATIENT_6782": "PRIMARY_COORDINATOR"
       },
       "activePatientId": "PATIENT_6782",
       "securityVersion": 1
     }
     ```
4. **Token Refresh Synchronization**:
   - The client forces a token refresh via `user.getIdToken(true)` to pull down the newly minted claims before granting navigation access to the dashboard.

```
[Primary User]                [Client App]             [Firebase Auth]       [Backend / Admin SDK]     [Cloud Firestore]
       |                            |                         |                        |                       |
       |--- 1. Enters Email/Pass -->|                         |                        |                       |
       |    & Patient Details       |--- 2. createUser(...) ->|                        |                       |
       |                            |<-- 3. Returns UserCred -|                        |                       |
       |                            |                                                  |                       |
       |                            |--- 4. Callable: initializePrimaryCoordinator --->|                       |
       |                            |       (Auth Bearer: ID Token)                    |                       |
       |                            |                                                  |--- 5. Transaction: -->|
       |                            |                                                  |    - Create User Doc  |
       |                            |                                                  |    - Create Patient   |
       |                            |                                                  |    - Link Member      |
       |                            |                                                  |<-- 6. Commit OK ------|
       |                            |                                                  |                       |
       |                            |                         |<-- 7. setCustomClaims -|                       |
       |                            |                         |    (Role: PRIMARY)     |                       |
       |                            |<-- 8. Returns Success --|------------------------|                       |
       |                            |                                                  |                       |
       |                            |--- 9. getIdToken(force=true) ------------------->|                       |
       |                            |<-- 10. Minted JWT with Custom Claims ------------|                       |
       |<-- 11. Navigate Dashboard -|                                                  |                       |
```

---

### 5.3 Passcode-Based Invitation System Architecture

To avoid forcing elderly relatives or home health aides to navigate complex OIDC flows or multi-step email confirmation redirects, JEEVASETU implements a **cryptographically peppered, short-lived, single-use alphanumeric passcode**.

#### 5.3.1 Passcode Structure & Usability Rules
- **Length & Alphabet**: 8 characters utilizing Crockford's Base32 alphabet (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`).
  - *Accessibility Optimization*: Excludes confusing glyphs (`I`, `L`, `O`, `U`) to prevent readability errors for elderly users and eliminates unintended offensive words.
  - *Visual Presentation*: Formatted with a hyphen into two 4-character blocks (e.g., `7K4W-9M2X`) with large font sizing ($24\text{pt}+$) and text-to-speech phonetic readout.
- **Keyspace Entropy**:
  $$\text{Entropy} = \log_2(32^8) = \log_2(2^{40}) = 40 \text{ bits of entropy } (1,099,511,627,776 \text{ combinations})$$
  Given a 24-hour expiration window and strict attempt-throttling (5 attempts per code), 40 bits provides impenetrable defense against online guessing while remaining easy to read over phone or WhatsApp.

#### 5.3.2 Passcode Storage Schema in Cloud Firestore
Passcodes are **never stored in plaintext**. The server applies a per-invitation cryptographically random salt and an environment-isolated application pepper (managed in Google Cloud Secret Manager) before computing a SHA-256 HMAC digest.

```
Collection: `patient_invitations/{invitationId}`
{
  "invitationId": "INV_b8e2f9d4-8931-4a5e-b24e-0a5d2146f901",
  "patientId": "PATIENT_6782",
  "createdByUid": "usr_primary_88319a",
  
  // Cryptographic Verification Fields
  "codeSalt": "e81d7f46b8a34bc699cfad6593a1c8b2",
  "codeHash": "4a7d3298a2862d352b217036c641154563a6a427f71b9c9f4935e4e83719b0aa", // HMAC-SHA256(pepper, salt + rawCode)
  
  // Authorization & Scope
  "intendedRole": "CAREGIVER", // Options: 'FAMILY_VIEWER', 'CAREGIVER', 'DOCTOR', 'EMERGENCY_PROXY'
  "recipientNote": "Nurse Sunita (Day Shift)",
  "restrictedToEmail": null,   // Optional: Enforces that redemption must match this email if pre-specified
  
  // Temporal and Usage Controls
  "createdAt": Timestamp(2026-11-15 10:30:00 UTC),
  "expiresAt": Timestamp(2026-11-16 10:30:00 UTC), // 24-hour default TTL
  "usageLimit": 1,                                  // Strictly single-use
  "usageCount": 0,
  "status": "ACTIVE",                               // 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED' | 'LOCKED'
  
  // Brute-force Prevention
  "failedAttempts": 0,
  "maxAttempts": 5,
  "lastAttemptAt": null,
  
  // Redemption Metadata
  "redeemedByUid": null,
  "redeemedAt": null
}
```

---

### 5.4 Step-by-Step Flow Diagrams (Textual & Sequence)

#### 5.4.1 Flow 1: Passcode Generation & Distribution
1. Primary Family Member selects "Add Caregiver" in the JEEVASETU app.
2. Selects role: `CAREGIVER` (grants write access to daily logs, read access to vitals and prescriptions; denies billing and invitation rights).
3. Primary Member's app invokes `generatePatientInvitation(patientId, intendedRole)`.
4. Cloud Function verifies the caller holds `PRIMARY_COORDINATOR` role on `patientId` via Custom Claims.
5. Cloud Function generates raw 8-character code via `crypto.randomBytes(5)` mapped to Crockford Base32.
6. Generates 16-byte random salt; fetches pepper from Google Secret Manager.
7. Hashes the code: `HMAC-SHA256(pepper, salt + rawCode)`.
8. Persists document in `patient_invitations/{invitationId}`.
9. Writes an immutable audit entry to `audit_logs`.
10. Returns the raw passcode to the Primary Family Member's UI.
11. UI presents the passcode alongside one-tap options: "Share via WhatsApp", "Send SMS", and "Copy Code".

```
[Primary Coordinator]             [Client App]            [Backend Cloud Function]        [Secret Mgr & Firestore]
        |                              |                             |                              |
        |--- 1. Selects 'Add Nurse' -->|                             |                              |
        |    (Role: CAREGIVER)         |--- 2. Call: generateCode -->|                              |
        |                              |       (Bearer ID Token)     |--- 3. Verify Primary Role -->|
        |                              |                             |<-- 4. Role Verified ---------|
        |                              |                             |                              |
        |                              |                             |--- 5. Fetch App Pepper ----->|
        |                              |                             |    Generate CSPRNG Code      |
        |                              |                             |    HMAC-SHA256(Salt+Code)    |
        |                              |                             |                              |
        |                              |                             |--- 6. Save Invitation Doc -->|
        |                              |                             |    Write Audit Log           |
        |                              |                             |<-- 7. Write Confirmed -------|
        |                              |<-- 8. Return Raw Code ------|                              |
        |                                  ("7K4W-9M2X")             |                              |
        |<-- 9. Display Large Code ----|                             |                              |
        |    + WhatsApp/SMS Share Link |                             |                              |
```

#### 5.4.2 Flow 2: Invitee Redemption, Account Creation, & Patient Association
1. Invitee receives code `7K4W-9M2X` and opens the JEEVASETU application.
2. Selects **"I have an Invitation Code"**.
3. Inputs `7K4W-9M2X` alongside their chosen credentials (Email & Password).
4. Client SDK registers the user in Firebase Auth (`createUserWithEmailAndPassword`).
5. Client immediately calls `redeemInvitationCode({ passcode: "7K4W-9M2X" })` passing the fresh ID Token.
6. The Cloud Function executes in an atomic transaction:
   - Queries candidate invitation records where `status == 'ACTIVE'` and `expiresAt > now`.
   - Iterates candidate records, recreating HMAC-SHA256 using the record's salt and pepper.
   - If no match or code is locked: increments `failedAttempts`. If `failedAttempts >= 5`, sets `status = 'LOCKED'`.
   - If match found: checks if user is already linked. If linked, throws error.
   - Marks invitation: `status = 'USED'`, `usageCount = 1`, `redeemedByUid = callerUid`.
   - Creates `patient_memberships` record linking `callerUid` to `patientId` with role `CAREGIVER`.
7. Backend assigns Custom Claims to `callerUid`.
8. Client SDK forces token refresh (`getIdToken(true)`).
9. Dashboard opens displaying the linked elderly patient's care feed.

```
[Invitee (Nurse)]              [Client App]             [Firebase Auth]       [Backend / Cloud Function]   [Cloud Firestore]
       |                            |                         |                           |                       |
       |--- 1. Enters Code -------->|                         |                           |                       |
       |    & New Email/Pass        |--- 2. createUser(...) ->|                           |                       |
       |                            |<-- 3. Return UserCred --|                           |                       |
       |                            |                                                     |                       |
       |                            |--- 4. Callable: redeemInvitationCode -------------->|                       |
       |                            |       (Code: "7K4W-9M2X", Auth: Bearer Token)       |                       |
       |                            |                                                     |--- 5. Transaction: -->|
       |                            |                                                     |    Find Matching Hash |
       |                            |                                                     |    Verify Not Expired |
       |                            |                                                     |    Mark Status='USED' |
       |                            |                                                     |    Create Membership  |
       |                            |                                                     |<-- 6. Commit Success -|
       |                            |                                                     |                       |
       |                            |                         |<-- 7. setCustomClaims ----|                       |
       |                            |                         |    (Role: CAREGIVER)      |                       |
       |                            |<-- 8. Return Linked OK -|---------------------------|                       |
       |                            |                                                     |                       |
       |                            |--- 9. getIdToken(force=true) ---------------------->|                       |
       |                            |<-- 10. Minted Token with CAREGIVER Claim -----------|                       |
       |<-- 11. Render Care View ---|                                                     |                       |
```

---

### 5.5 Firebase Authentication Integration & Custom Claims Architecture

#### 5.5.1 Custom Claims Specification
Firebase ID Tokens are cryptographically signed JSON Web Tokens (JWT). Authorization decisions in Firestore Security Rules and backend microservices are decoupled from database lookups by packing user permissions directly into JWT Custom Claims.

```json
{
  "iss": "https://securetoken.google.com/jeevasetu-prod",
  "aud": "jeevasetu-prod",
  "auth_time": 1731666600,
  "user_id": "usr_nurse_49201a",
  "sub": "usr_nurse_49201a",
  "iat": 1731666600,
  "exp": 1731670200,
  "email": "sunita.nurse@example.com",
  "email_verified": true,
  "firebase": {
    "identities": {
      "email": ["sunita.nurse@example.com"]
    },
    "sign_in_provider": "password"
  },
  
  // JEEVASETU RBAC Custom Claims Payload (Under 1000-byte JWT claim limit)
  "jeevasetu": {
    "v": 1, // Claims schema version for breaking migrations
    "memberships": {
      "PATIENT_6782": "CAREGIVER"
    },
    "activePatientId": "PATIENT_6782"
  }
}
```

#### 5.5.2 Firestore Security Rules Enforcement
With Custom Claims directly embedded in `request.auth.token`, security rules evaluate access without billable or high-latency `get()` document reads:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper Functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function getMembershipRole(patientId) {
      return request.auth.token.jeevasetu.memberships[patientId];
    }
    
    function isPrimaryCoordinator(patientId) {
      return isAuthenticated() && getMembershipRole(patientId) == 'PRIMARY_COORDINATOR';
    }
    
    function isCaregiverOrHigher(patientId) {
      return isAuthenticated() && (
        getMembershipRole(patientId) in ['PRIMARY_COORDINATOR', 'CAREGIVER']
      );
    }

    // Patient Root Document
    match /patients/{patientId} {
      allow read: if isAuthenticated() && getMembershipRole(patientId) != null;
      allow update, delete: if isPrimaryCoordinator(patientId);
      allow create: if false; // Only provisioned via Cloud Function
    }
    
    // Patient Vitals & Medication Logs
    match /patients/{patientId}/vitals/{vitalId} {
      allow read: if isAuthenticated() && getMembershipRole(patientId) != null;
      allow create, update: if isCaregiverOrHigher(patientId);
      allow delete: if isPrimaryCoordinator(patientId);
    }
    
    // Passcode Invitations: Strictly No Direct Client Read/Write
    match /patient_invitations/{invitationId} {
      allow read, write: if false; // All interactions managed via Admin SDK
    }
  }
}
```

---

### 5.6 Session Management & Server-Side Verification

#### 5.6.1 ID Token Lifecycle & Administrative Verification
- **Token Validity**: Firebase ID tokens are valid for exactly 1 hour ($3600\text{ seconds}$).
- **Client Storage**:
  - *Mobile (Flutter/React Native)*: Stored in OS-level hardware keystores (iOS Keychain, Android KeyStore via EncryptedSharedPreferences).
  - *Web (Dashboard)*: Kept in memory or isolated IndexedDB managed natively by the Firebase Web SDK. Tokens are never stored in `localStorage` or `sessionStorage` to mitigate Cross-Site Scripting (XSS) exfiltration.
- **Server-Side API Verification**:
  All backend services (Express/Cloud Run endpoints) pass client bearer tokens through a strict validation middleware utilizing `admin.auth().verifyIdToken`:

```typescript
import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header.' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // checkRevoked: true forces verification against revocation timestamp in Firebase Auth
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    req.user = decodedToken;
    next();
  } catch (error: any) {
    if (error.code === 'auth/id-token-revoked') {
      res.status(401).json({ error: 'SESSION_REVOKED', message: 'Session has been invalidated. Please log in again.' });
      return;
    }
    if (error.code === 'auth/id-token-expired') {
      res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Authentication expired. Refresh token required.' });
      return;
    }
    res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid identity credentials.' });
  }
}
```

---

### 5.7 Token Refresh Strategy

Because Firebase Auth Custom Claims are baked directly into the signed ID token at issuance time, changes to user roles (such as redeeming a new patient invitation or having privileges modified) will not naturally reflect until the next hourly token rollover.

JEEVASETU implements a proactive **Dual Token-Refresh Strategy**:

```
+---------------------------------------------------------------------------------------------------+
|                                      TOKEN REFRESH STRATEGY                                       |
|                                                                                                   |
|  [Standard Path]                                                                                  |
|  Automatic Background Loop: Client SDK triggers Refresh Token exchange at ~55 minutes.            |
|                                                                                                   |
|  [Security/Event-Driven Path]                                                                     |
|  1. Critical Event (Passcode Redeemed / Role Changed / Access Revoked)                            |
|  2. Server updates Custom Claims via Admin SDK                                                    |
|  3. Client triggers: `await firebase.auth().currentUser.getIdToken(true)`                         |
|  4. Fresh JWT received containing updated claims within < 200ms                                   |
+---------------------------------------------------------------------------------------------------+
```

1. **Automatic Silent Refresh**: The client Firebase SDK maintains a background loop running every 55 minutes, silently exchanging the long-lived Refresh Token for a fresh ID token.
2. **Immediate Event-Driven Refresh**:
   - Immediately following successful execution of `redeemInvitationCode`, the client triggers `getIdToken(true)`. The `true` argument bypasses the cached token and forces a round-trip to the Google Identity backend, instantly updating local custom claims.
   - For real-time updates while active (e.g., Primary Coordinator promotes an in-home nurse to emergency proxy), the server publishes a lightweight Firestore notification ping to `users/{uid}/meta/notifications`. A client Firestore snapshot listener receives this event and transparently runs `getIdToken(true)`.

---

### 5.8 Logout and Session Revocation

Securing an elderly-care platform requires immediate, deterministic kill-switch capabilities if an unauthorized caregiver is terminated or a companion device is misplaced.

#### 5.8.1 Standard Client Logout
The client executes `auth.signOut()`, which clears in-memory credentials, terminates local session timers, and deletes device keystore tokens.

#### 5.8.2 Cryptographic Revocation (Kill-Switch)
Because standard JWTs are stateless and remain valid until their 1-hour expiration timestamp, `auth.signOut()` alone does not invalidate a stolen token on backend microservices.

To neutralize active tokens immediately:
1. When a user changes their password, or when a Primary Coordinator removes an individual's access, the server calls `admin.auth().revokeRefreshTokens(targetUid)`.
2. This operation updates the target user's `validSince` metadata property in Firebase Auth to the current epoch timestamp.
3. Every critical server-side verification middleware running `verifyIdToken(token, true)` checks the token's issuance timestamp (`iat`) against `validSince`. If `iat < validSince`, the request is immediately rejected with `auth/id-token-revoked`.

```typescript
// Administrative revocation Cloud Function
export const revokeUserAccess = functions.https.onCall(async (data, context) => {
  const callerUid = context.auth?.uid;
  const { targetUid, patientId } = data;

  // 1. Verify caller is Primary Coordinator for this patient
  const callerRole = context.auth?.token.jeevasetu?.memberships?.[patientId];
  if (callerRole !== 'PRIMARY_COORDINATOR') {
    throw new functions.https.HttpsError('permission-denied', 'Only Primary Coordinators can revoke access.');
  }

  // 2. Remove patient membership from Firestore
  await db.doc(`patients/${patientId}/memberships/${targetUid}`).delete();

  // 3. Update target user's Custom Claims
  const targetUser = await admin.auth().getUser(targetUid);
  const existingClaims = targetUser.customClaims || { jeevasetu: { memberships: {} } };
  delete existingClaims.jeevasetu.memberships[patientId];
  await admin.auth().setCustomUserClaims(targetUid, existingClaims);

  // 4. Invalidate all active refresh tokens & force ID token rejection
  await admin.auth().revokeRefreshTokens(targetUid);

  // 5. Append to security audit log
  await db.collection('audit_logs').add({
    action: 'MEMBERSHIP_REVOKED',
    actorUid: callerUid,
    targetUid: targetUid,
    patientId: patientId,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});
```

---

### 5.9 Security Considerations & Threat Modeling

#### 5.9.1 Passcode Brute-Force Protection Matrix
Short passcodes are vulnerable to online enumeration unless protected by layered rate limiting:

```
+----------------------------------------------------------------------------------------------------+
|                                    LAYERED BRUTE-FORCE DEFENSE                                     |
|                                                                                                    |
|  [Tier 1: Perimeter / Network]                                                                     |
|  Cloudflare / Google Cloud Armor: WAF rules block requests exceeding 20 req/min per IP.           |
|                                                                                                    |
|  [Tier 2: Application Integrity]                                                                   |
|  Firebase App Check (Play Integrity on Android / DeviceCheck on iOS / reCAPTCHA v3 Enterprise on   |
|  Web) guarantees that redemption requests originate exclusively from genuine JEEVASETU apps.      |
|                                                                                                    |
|  [Tier 3: Distributed State Rate Limiting]                                                         |
|  Cloud Function checks Redis Token Bucket: max 5 redemption attempts / min per IP.                 |
|                                                                                                    |
|  [Tier 4: Record-Level Auto-Lockout]                                                               |
|  Firestore atomic counter increments `failedAttempts`. On 5th failed attempt, status -> 'LOCKED'.  |
+----------------------------------------------------------------------------------------------------+
```

- **Perimeter & App Check**: Firebase App Check attests app integrity before requests hit backend functions. Scripted bots and emulators fail at the gateway.
- **Lockout Mechanics**: When 5 incorrect redemption attempts occur against a code, the database flags it as `LOCKED`. An automated alert notification is dispatched to the Primary Coordinator:
  > *"Notice: An invitation code generated for your care group has been disabled due to multiple incorrect attempts. Please verify with your invitee and generate a new code."*

#### 5.9.2 Passcode Length vs. Entropy Evaluation
| Length | Alphabet | Keyspace Combinations | Online Attack Vulnerability (Max 5 attempts) | Usability Assessment |
| :--- | :--- | :--- | :--- | :--- |
| 4 Digits | $0-9$ | $10,000$ | **Critical** (0.05% chance of guessing per targeted code) | Too insecure for clinical context |
| 6 Digits | $0-9$ | $1,000,000$ | Moderate (Feasible if attacker targets across many active codes) | Usable, but insufficient collision margin |
| **8 Chars (JEEVASETU)** | **Crockford 32** | $\mathbf{1.099 \times 10^{12}}$ | **Negligible** ($4.5 \times 10^{-10}$ probability of guessing) | **Optimal balance of security & legibility** |

#### 5.9.3 Invitation Audit Trail Specification
To maintain regulatory compliance (HIPAA / GDPR / India DPDP Act), all lifecycle transitions are written to an append-only collection `audit_logs`:

```json
{
  "logId": "log_78192a_9012",
  "eventType": "INVITATION_REDEEMED",
  "patientId": "PATIENT_6782",
  "invitationId": "INV_b8e2f9d4-8931-4a5e-b24e-0a5d2146f901",
  "actorUid": "usr_nurse_49201a",
  "ipHash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069", // SHA-256(ip + daily_salt)
  "userAgent": "Jeevasetu-Android/2.4.1 (Samsung SM-A536B; Android 14)",
  "assignedRole": "CAREGIVER",
  "timestamp": "2026-11-15T10:45:12.182Z"
}
```

---

### 5.10 Edge Cases, Race Conditions & Failure Recovery

| Edge Case Scenario | Threat / Failure Vector | System Defense & Recovery Mechanism | User-Facing Message |
| :--- | :--- | :--- | :--- |
| **Expired Passcode** | Attacker or user attempts redemption after TTL has elapsed. | Evaluated in atomic transaction: `if (now > record.expiresAt)`. Code status marked as `EXPIRED`. Transaction aborts. | *"This invitation code expired on [Date]. Please ask your family coordinator to generate a new code."* |
| **Already-Used Passcode (Replay)** | Attacker intercepts a valid code from messaging chat and attempts reuse. | Single-use invariant enforced via `usageLimit: 1` and status transition `ACTIVE -> USED`. Subsequent attempts find `status !== 'ACTIVE'`. | *"This invitation code has already been redeemed. Each code can only be used once."* |
| **Code Locked (Brute Force)** | Attacker generates automated guesses against an invitation. | `failedAttempts` reaches 5. Status transitions to `LOCKED`. All future verification attempts immediately short-circuit. | *"This code has been locked due to too many invalid attempts. Contact the family coordinator."* |
| **User Already Linked to Patient** | Invitee enters a new code for a patient profile they already have access to. | Transaction checks `patient_memberships` for `(patientId, callerUid)`. If already present, transaction aborts without consuming code. | *"You are already connected to this patient profile."* |
| **Concurrent Redemption (Race Condition)** | Two users (or duplicate network retries) submit the same code simultaneously. | Firestore Document Transaction locks the invitation record. The first transaction commits and sets `status = 'USED'`; the second fails precondition check. | *"This invitation code is currently being processed or was already used."* |
| **Orphaned Auth User** | User creates Firebase Auth account, but network fails before Cloud Function completes linkage. | Client wrapper handles network drop with idempotent retry of `redeemInvitationCode`. If unredeemed, user re-submits code on next app launch. | *"Completing setup for your care circle... Reconnecting..."* |
| **Revoked by Coordinator** | Coordinator mistakenly invites someone and clicks "Cancel Invitation". | Cloud Function sets `status = 'REVOKED'` immediately. Any in-flight redemptions fail validation. | *"This invitation was canceled by the primary family member."* |

---

### 5.11 Elderly-Centric Usability & Accessibility Safeguards

While standard enterprise authentication prioritizes complex multi-factor interactions, an elderly-care platform must prevent cognitive lockouts while preserving backend integrity.

```
+---------------------------------------------------------------------------------------------------+
|                                  ELDERLY USABILITY SAFEGUARDS                                     |
|                                                                                                   |
|  [1. High-Legibility Visuals]                                                                     |
|  - Passcode presented in 32pt monospace bold font with unambiguous characters.                    |
|  - High-contrast visual cards (WCAG AAA compliant: minimum 7:1 contrast ratio).                   |
|                                                                                                   |
|  [2. One-Tap Deep Linking]                                                                        |
|  - Share links formatted as: `https://app.jeevasetu.org/join?code=7K4W-9M2X`                    |
|  - Auto-fills the passcode field upon app opening, requiring only name/password entry.           |
|                                                                                                   |
|  [3. QR Code Onboarding]                                                                          |
|  - Primary Coordinator can display an in-person QR code on their screen.                          |
|  - Secondary relative simply points their phone camera to bypass manual typing entirely.          |
|                                                                                                   |
|  [4. Plain-Language Guidance]                                                                     |
|  - Replaces error codes (e.g., "Error 403 Forbidden") with actionable human assistance:           |
|    "Code not recognized. Would you like to call [Coordinator Name] for help?"                    |
+---------------------------------------------------------------------------------------------------+
```

1. **Assisted Passcode Ingestion**:
   - Invitation links generated by the coordinator embed the passcode directly into a Universal Link / Android App Link: `https://jeevasetu.org/join?code=7K4W-9M2X`.
   - When tapped on a smartphone, the JEEVASETU application launches, automatically populates the 8-character input field, and speaks the verification prompt aloud.
2. **Physical / In-Person QR Code Scanning**:
   - When a visiting nurse or relative is physically present with the primary coordinator, the coordinator's app displays an encrypted QR code containing the invitation payload. The invitee scans it directly from screen to screen, eliminating all typing errors.
3. **Emergency Caregiver Fail-Safe**:
   - In urgent clinical situations where a doctor or emergency responder needs temporary access, Primary Coordinators can issue an **"Immediate Kiosk Access"** code valid for only 2 hours with read-only emergency medical telemetry, bypassable via SMS confirmation to the primary coordinator's phone.
4. **Phonetic and Audio Readout**:
   - For visually impaired elderly family members, the UI includes a speaker icon that reads the passcode phonetically (e.g., *"Seven - Kilo - Four - Whiskey - Nine - Mike - Two - X-ray"*), matching universal aviation and emergency accessibility standards.


---\n
## 6. All Application Screens and User Journeys

The **JEEVASETU** platform is designed to bridge the gap between elderly patients, family members, and professional/informal caregivers. Because cognitive abilities, digital literacy, motor skills, and operational contexts vary dramatically across these three user groups, JEEVASETU adopts a multi-modal, adaptive interface strategy:

*   **Elderly Patients (Elderly Mode):** Hyper-focused, high-contrast, large-format UI with zero jargon, low cognitive friction, and dual sensory cues (visual + audio).
*   **Family Members (Overview Mode):** Remote peace-of-mind dashboard, adherence trend analytics, push notification triggers, and care-team governance.
*   **Caregivers (Shift Mode):** Task-driven, thumb-optimized mobile UI designed for rapid logging, real-time handovers, and offline field-reliability.

---

### 6.1 Complete Screen Inventory & Architectural Sitemap

The table below catalogs every screen across the 8 functional operational zones of JEEVASETU, defining access control permissions (Role-Based Access Control: **P** = Patient, **F** = Family, **C** = Caregiver, **A** = System Administrator) and the core user problem solved.

| Zone | Screen Name | URL Path | Accessible By | Primary Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Onboarding / Auth** | Splash & Language Picker | `/auth/welcome` | P, F, C | Language selection (English, Hindi, Regional), app setup, role detection. |
| | Phone / OTP Login | `/auth/login` | P, F, C | Passwordless telephone authentication with SMS/WhatsApp OTP and voice fallback. |
| | Role & Profile Setup | `/onboarding/role-select` | F, C | Select account type (Family Guardian vs. Professional Caregiver). |
| | Patient Profile Builder | `/onboarding/patient-profile` | F, A | Step-by-step setup of elderly patient vitals, medical history, and emergency contacts. |
| | Care Team Invitation Hub | `/onboarding/invite-team` | F, A | Invite co-guardians, doctors, and paid caregivers via SMS/WhatsApp links. |
| **Patient Dashboard** | Simplified Home (Elderly) | `/dashboard/patient` | P | Giant glanceable cards: Next Medicine, Call Family, Emergency SOS, Daily Health Check. |
| | Family Command Center | `/dashboard/family` | F | Real-time care stream, daily adherence index, vitals alerts, caregiver status. |
| | Caregiver Shift Workspace | `/dashboard/caregiver` | C | Sequential task list, active patient timeline, medication delivery checklist. |
| **Medications** | Today's Action Schedule | `/medications/today` | P, F, C | Chronological dose list (Morning, Afternoon, Evening, Night) with visual pill cards. |
| | Medication Intake Modal | `/medications/take/:id` | P, C | High-contrast confirmation modal with pill photo, sound cue, and single-action log. |
| | Medicine Cabinet (Inventory) | `/medications/cabinet` | F, C | Comprehensive list of current prescriptions, dosages, refills, and expiry tracking. |
| | Add / Edit Prescription | `/medications/manage` | F, A | Prescription photo scanning (OCR), doctor linkage, schedule setup. |
| | Adherence Analytics & Log | `/medications/adherence` | F, C | 7/30-day adherence heatmaps, missed-dose root causes, and trend graphs. |
| **Appointments & Visits** | Appointments Overview | `/appointments` | P, F, C | Upcoming clinical visits, lab tests, physiotherapy sessions, and home nurse visits. |
| | Schedule New Visit | `/appointments/book` | F, C | Booking wizard for doctor consultations, lab pickups, and transport assistance. |
| | Visit Detail & Preparation | `/appointments/detail/:id` | P, F, C | Transport directions, fasting requirements, questions for doctor, document locker. |
| | Teleconsultation Waiting Room| `/appointments/call/:id` | P, F, C | Simplified one-tap video room with multi-party support (Patient + Family + Doctor). |
| **Care Timeline & Vitals** | Unified Activity Stream | `/timeline` | F, C | Consolidated reverse-chronological log of doses, meals, vitals, sleep, and notes. |
| | Vitals Quick-Log | `/timeline/log-vitals` | P, F, C | Large keypad input for Blood Pressure, Blood Glucose, SpO2, Weight, and Pulse. |
| | Incident / Observation Report | `/timeline/report-incident`| C, F | Log unusual symptoms, falls, mood changes, appetite loss with photo/voice note. |
| | Daily Care Summary | `/timeline/daily-summary` | F, C | End-of-day digest showing completion rates, vitals trends, and caregiver sign-off. |
| **Caregiver Management** | Shift Roster & Allocation | `/caregivers/roster` | F, A | Calendar showing assigned caregivers, shift timings, and coverage gaps. |
| | Handover Protocol Screen | `/caregivers/handover` | C, F | Shift-end checklist: pending doses, observations, inventory handoff, e-signature. |
| | Caregiver Profile & Verification| `/caregivers/profile/:id`| F, A | ID verification, contact info, emergency backup numbers, performance feedback. |
| **Settings & Profile** | Patient Accessibility Settings| `/settings/accessibility`| P, F | Text size (100%–200%), high contrast toggle, screen reader voice, haptics. |
| | Emergency SOS Config | `/settings/emergency` | F, A | Primary contact chain (Police, Ambulance, Doctor, Relatives), automatic SMS triggers. |
| | Role & Device Linking | `/settings/devices` | F, C | Pairing BLE blood pressure cuffs, glucometers, pillbox sensors, and tablet kiosks. |
| **Offline & Print** | Offline Cache Status | `/offline/status` | P, C | Queue of un-synced logs, offline indicators, and manual force-sync trigger. |
| | Refrigerator Schedule Sheet | `/print/schedule-sheet` | P, F, C | Formatted A4/Letter printable weekly chart with pill images, check-boxes, and emergency numbers. |
| | Emergency Wallet Card | `/print/emergency-card` | P, F | Printable trifold card containing patient blood group, conditions, allergies, and ICE contacts. |

---

### 6.2 Key Screen UI Layouts & Deep-Dive Specifications

#### SCR-01: Simplified Patient Dashboard (`/dashboard/patient`)
Designed specifically for elderly users experiencing presbyopia, tremors, or early cognitive fatigue. This screen acts as a zero-confusion glanceable home base, optimized for 8"–11" tablets kept on bedside stands or mobile phones running in Elderly Mode.

```
+-------------------------------------------------------------------+
|  [JEEVASETU]                     10:30 AM  |  Wednesday, Nov 15   |
+-------------------------------------------------------------------+
|                                                                   |
|   +-----------------------------------------------------------+   |
|   |  NEXT MEDICINE IN 30 MINUTES                              |   |
|   |                                                           |   |
|   |  [PILL PHOTO]  1x White Round Tablet (Morning BP Pill)    |   |
|   |                Take with warm water after breakfast       |   |
|   |                                                           |   |
|   |  +-----------------------------------------------------+  |   |
|   |  |   [ ✓ ]   I HAVE TAKEN THIS MEDICINE                |  |   |
|   |  +-----------------------------------------------------+  |   |
|   +-----------------------------------------------------------+   |
|                                                                   |
|   +-----------------------------+ +---------------------------+   |
|   |  CALL FAMILY                | |  CALL CAREGIVER           |   |
|   |                             | |                           |   |
|   |  [PHOTO] Ramesh (Son)       | |  [PHOTO] Sunita (Nurse)   |   |
|   |  [ TAP TO CALL ]            | |  [ TAP TO CALL ]          |   |
|   +-----------------------------+ +---------------------------+   |
|                                                                   |
|   +-----------------------------------------------------------+   |
|   |  [ ! ]  EMERGENCY HELP (SOS)                              |   |
|   |         Press and hold for 3 seconds to alert family      |   |
|   +-----------------------------------------------------------+   |
+-------------------------------------------------------------------+
```

*   **Layout Summary:** Single-column vertical stack with clear semantic blocks. Zero scroll required on standard viewports (100vh locked). High visual hierarchy prioritizing immediate time-sensitive action at the top.
*   **Key UI Elements:**
    *   *Hero Time & Date Banner:* High-contrast black text on soft cream background (`#FDFBF7`), 28px bold font, showing local time, day of the week, and current greeting ("Good Morning, Dadaji").
    *   *Active Medication Hero Card:* 12px rounded container with a high-contrast 3px navy border (`#1A365D`). Includes a 120x120px real-world photo of the pill with color and shape labels ("White round tablet").
    *   *Take Medicine CTA:* Giant green button (`#1B8754`), minimum height 72px, bold 24px white text with a large checkmark icon.
    *   *Direct Contact Speed-Dials:* Dual high-contrast cards with 80x80px circular avatars of primary contacts, avoiding phone dialpad complexities.
    *   *Persistent Emergency SOS Strip:* Deep crimson (`#DC3545`) full-width button with tactile haptic and visual progress fill on press-and-hold (preventing accidental touches).
*   **Primary Actions:**
    *   Confirm intake of immediate dose (`I HAVE TAKEN THIS MEDICINE`).
    *   One-touch audio/video call to designated family guardian.
    *   One-touch audio call to on-duty nurse/caregiver.
    *   3-second press-and-hold Emergency SOS.
*   **Data Displayed:** Current time/date, upcoming dose name (in plain terms: "Morning BP Pill"), pill visual identification, instructions ("After breakfast"), caregiver on-duty name, connection status icon (cloud with checkmark).

---

#### SCR-02: Family Health Command Center (`/dashboard/family`)
Designed for adult children or designated family guardians managing care remotely from their smartphones or laptops. Emphasizes peace of mind, immediate status at a glance, and deep auditing capabilities.

```
+-------------------------------------------------------------------+
|  [ < ]  Papa's Care Hub                     [Alerts (1)]  [Menu]  |
+-------------------------------------------------------------------+
|  PATIENT STATUS                                                   |
|  Kishore Kumar (76 yrs) • At Home (New Delhi)                     |
|  Caregiver on duty: Sunita Sharma (Shift ends 6:00 PM)            |
+-------------------------------------------------------------------+
|  TODAY'S ADHERENCE                           LATEST VITALS (8 AM) |
|  [██████████░░░░] 75% (3/4 Done)             BP: 128/82 mmHg (OK) |
|  Next: 8:00 PM Night Heart Pill              Sugar (F): 112 mg/dL |
+-------------------------------------------------------------------+
|  ACTIVE ALERTS                                                    |
|  [!] Missed Dose: Calcium 500mg was scheduled at 2:00 PM.        |
|      Caregiver noted: "Patient was sleeping, will give at tea."   |
|      [ CALL CAREGIVER ]             [ ACKNOWLEDGE ]               |
+-------------------------------------------------------------------+
|  CARE TIMELINE (TODAY)                                            |
|  • 08:30 AM  [✓] BP Pill logged by Sunita (Caregiver)             |
|  • 09:15 AM  [♥] Blood Pressure logged: 128/82 mmHg               |
|  • 01:00 PM  [✓] Lunch logged: 2 Rotis + Dal + Salad              |
|  • 02:00 PM  [!] Calcium 500mg marked Delayed                     |
+-------------------------------------------------------------------+
|  [ Dashboard ]     [ Meds ]     [ Timeline ]     [ Team ]         |
+-------------------------------------------------------------------+
```

*   **Layout Summary:** Fluid card-based dashboard with top-level status bar, summary analytics widgets, an escalated exception alert panel, and a live chronological micro-feed. Bottom navigation tab bar (4 items) for quick thumb switching.
*   **Key UI Elements:**
    *   *Caregiver Presence Pill:* Real-time chip showing who is currently present at the home, their clock-in time, and emergency call icon.
    *   *Radial/Bar Adherence Gauge:* Dynamic color-coded bar (Green > 90%, Amber 70-89%, Red < 70%) with dose fraction (e.g., "3 of 4 doses taken").
    *   *Alert Intervention Card:* High-visibility yellow banner (`#FFF3CD`) that surfaces caregiver notes explaining any deviation from the care plan.
    *   *Live Care Stream:* Chronological feed with iconographic categorization (Pills, Vitals, Nutrition, Incidents).
*   **Primary Actions:**
    *   One-click call/message to active caregiver.
    *   Acknowledge and clear active alerts.
    *   Export 7-day care report as PDF for physician consults.
    *   Switch between multiple elderly family members via top dropdown.
*   **Data Displayed:** Patient name/location, real-time caregiver shift status, adherence percentage, latest clinical vitals with normal-range badges, missed dose exceptions, and recent timeline timestamps.

---

#### SCR-03: Caregiver Active Shift & Task Execution (`/dashboard/caregiver`)
Built for paid home health aides and nurses who work under mobile-first, fast-paced conditions. Features large thumb targets, high-contrast states, and quick-logging shortcuts.

```
+-------------------------------------------------------------------+
|  [ = ]  Shift: Kishore Kumar (08:00 - 18:00)       [Sync: OK ✓]   |
+-------------------------------------------------------------------+
|  UPCOMING TASK (DUE NOW)                                          |
|  +-------------------------------------------------------------+  |
|  |  2:00 PM - Afternoon Medication                            |  |
|  |  • Calcium Carbonate (Shelcal 500) - 1 Tablet               |  |
|  |  • Multivitamin (Becosules) - 1 Capsule                     |  |
|  |  Instructions: Give with 1 glass of water after lunch       |  |
|  |                                                             |  |
|  |  [ ✓ LOG ALL GIVEN ]      [ EXCEPTION / NOT TAKEN ]         |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  REMAINING SHIFT TASKS                                            |
|  [ ] 04:00 PM  Evening Vitals Check (BP & Pulse)                  |
|  [ ] 05:00 PM  Assist with 15-min Balcony Walk                     |
|  [ ] 05:45 PM  Prepare Evening Shift Handover                      |
|                                                                   |
|  QUICK ACTIONS                                                    |
|  [ + Log Vitals ]  [ + Meal Note ]  [ ! Report Fall/Issue ]       |
+-------------------------------------------------------------------+
|  [ Tasks ]         [ Patients ]         [ Handover ]              |
+-------------------------------------------------------------------+
```

*   **Layout Summary:** Vertical timeline focused strictly on the *Current Action Window* (Current hour ± 1 hour), minimizing forward scrolling. Sticky bottom bar for one-handed thumb interaction.
*   **Key UI Elements:**
    *   *Shift Status Bar:* Shows assigned patient name, remaining shift hours, and offline synchronization indicator (`Sync: OK` or `3 Logs Pending`).
    *   *Hero Task Box:* Prominently highlighted card with high-contrast border and dual action buttons: Primary Success (Green) and Exception/Delayed (Amber).
    *   *Quick Log Drawer:* Floating segmented buttons to log spontaneous events (e.g., glass of water, bathroom assistance, pain complaint).
*   **Primary Actions:**
    *   `LOG ALL GIVEN` (one-tap bulk confirmation for concurrent medications).
    *   `EXCEPTION / NOT TAKEN` (opens a single-step dialog: Patient Refused, Patient Sleeping, Nauseous, Out of Stock).
    *   Quick-entry for vitals and qualitative observations.
    *   Initiate Handover checklist at shift completion.
*   **Data Displayed:** Prescribed medications for the hour, exact clinical brand and generic names, intake caveats ("After food"), remaining checklist tasks, and network sync state.

---

#### SCR-04: Today's Medication Action Card & Intake Confirmation (`/medications/today` & `/medications/take/:id`)
Optimized for the elderly patient with large pill imagery and tactile confirmation dialogs that completely prevent accidental double-dosing.

```
+-------------------------------------------------------------------+
|  [ < Back ]             TODAY'S MEDICINES           [ 🔊 Listen ] |
+-------------------------------------------------------------------+
|                                                                   |
|  MORNING (8:00 AM - 10:00 AM)                       [ DONE ✓ ]    |
|  ==============================================================   |
|  [✓] Blood Pressure Tablet (Telma 40) - Taken at 8:15 AM          |
|                                                                   |
|  AFTERNOON (1:00 PM - 3:00 PM)                      [ DUE NOW ]   |
|  ==============================================================   |
|  +-------------------------------------------------------------+  |
|  |  Calcium Tablet (Shelcal 500)                               |  |
|  |  1 Large White Pill • Take with water after lunch           |  |
|  |                                                             |  |
|  |  +-------------------------------------------------------+  |  |
|  |  |           [ TAKE THIS MEDICINE NOW ]                  |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  NIGHT (8:00 PM - 10:00 PM)                         [ UPCOMING ]  |
|  ==============================================================   |
|  [ ] Heart & Cholesterol Tablet (Atorva 10)                       |
|  [ ] Sleep Aid Tablet (Melatonin 3mg)                             |
|                                                                   |
+-------------------------------------------------------------------+
```

*   **Intake Confirmation Dialog (Modal overlay upon tapping "Take This Medicine Now"):**
    *   *Screen Dimmer:* 80% opacity dark overlay to eliminate background distractions.
    *   *Modal Dimensions:* 90% screen width, centered vertically.
    *   *Pill Details:* High-res photographic pill image (150x150px) alongside an illustrated glass of water.
    *   *Plain Language Question:* "Did you swallow 1 Calcium Tablet just now?"
    *   *Buttons:*
        *   `YES, I TOOK IT` (Giant Green, min height 64px, 22px bold).
        *   `NOT YET / CANCEL` (High-contrast Neutral Gray outline, min height 56px).
    *   *Post-Action Feedback:* Immediate screen-wide audio chime ("Ding!"), green banner stating "Recorded! Good job, Kishore ji", and an automatic 10-second "Undo" toast at the bottom.

---

#### SCR-05: Weekly Adherence & Trend Matrix (`/medications/adherence`)
Designed for family members and attending doctors to identify patterns of non-compliance and medication barriers.

```
+-------------------------------------------------------------------+
|  [ < ]  Weekly Adherence: Nov 08 - Nov 14           [ Share PDF ] |
+-------------------------------------------------------------------+
|  7-DAY COMPLIANCE RATE: 93% (26 of 28 Doses Taken On Time)        |
+-------------------------------------------------------------------+
|  DOSE BREAKDOWN MATRIX                                            |
|             Wed   Thu   Fri   Sat   Sun   Mon   Tue               |
|  Morning     ✓     ✓     ✓     ✓     ✓     ✓     ✓                |
|  Afternoon   ✓     ✓     ✓     !     ✓     ✓     ✓                |
|  Evening     ✓     ✓     ✓     ✓     ✓     ✓     ✓                |
|  Night       ✓     ✓     X     ✓     ✓     ✓     ✓                |
|                                                                   |
|  Legend: [✓] Taken On Time   [!] Delayed (>1hr)   [X] Missed      |
+-------------------------------------------------------------------+
|  PATTERNS & OBSERVATIONS                                          |
|  • Friday Night (Nov 10): Missed Atorva 10mg.                     |
|    Reason recorded: Family dinner outside, medicine box omitted.   |
|  • Saturday Afternoon (Nov 11): Delayed Shelcal by 2 hours.       |
|    Reason recorded: Patient afternoon nap.                        |
+-------------------------------------------------------------------+
|  [ Export Doctor Summary ]              [ Adjust Dose Timers ]    |
+-------------------------------------------------------------------+
```

*   **Layout Summary:** Analytical grid featuring high-contrast calendar cells (Green check, Amber exclamation mark, Red X), supported by automated root-cause summaries compiled from caregiver and family logs.
*   **Key UI Elements:**
    *   *Adherence Percentage Card:* Large numerical score with benchmark coloring.
    *   *7x4 Dose Matrix:* Matrix mapping the 4 daily slots against 7 days. Tapping any cell opens the exact timestamp, logging user, and associated note.
    *   *Clinical Export Bar:* Persistent footer CTA to produce a clean, printer-friendly PDF for outpatient appointments.

---

#### SCR-06: Unified Care Timeline & Vitals Stream (`/timeline`)
The continuous clinical and observational audit log of the patient's daily life.

```
+-------------------------------------------------------------------+
|  [ < ]  Care Timeline: Wednesday, Nov 15            [ Filter ]    |
+-------------------------------------------------------------------+
|  • 02:15 PM  [ MEDICATION LOGGED ]                                |
|              Calcium Carbonate 500mg taken.                       |
|              Logged by: Sunita Sharma (Caregiver)                 |
|                                                                   |
|  • 01:10 PM  [ MEAL & NUTRITION ]                                 |
|              Lunch: 2 Phulkas, Moong Dal, Lauki Sabzi.            |
|              Appetite: Finished all. Drank 250ml water.           |
|              Logged by: Sunita Sharma (Caregiver)                 |
|                                                                   |
|  • 09:30 AM  [ CLINICAL VITAL ]                                   |
|              Blood Pressure: 128 / 82 mmHg (Normal)               |
|              Pulse: 74 bpm                                        |
|              Attached Photo: [BP Monitor Screen Photo]            |
|              Logged by: Kishore Kumar (Patient via BLE Cuff)      |
|                                                                   |
|  • 08:00 AM  [ SHIFT START ]                                      |
|              Sunita Sharma clocked in at Residence.               |
+-------------------------------------------------------------------+
|  [ + Add Event ]                                 [ Jump to Date ] |
+-------------------------------------------------------------------+
```

*   **Layout Summary:** Vertical timeline with chronological connector lines and color-coded event nodes.
*   **Key UI Elements:**
    *   *Event Category Chips:* Blue for Meds, Teal for Vitals, Amber for Meals, Purple for Therapy/Walks, Red for Incidents.
    *   *Media Attachments:* Inline thumbnail previews of blood pressure monitors, glucometer screens, or meal plates, supporting visual verification.
    *   *Attribution Metadata:* Explicit indication of who logged each entry (Patient self-report, Caregiver, Family member, or automated Bluetooth sensor).

---

#### SCR-07: Caregiver Shift Handover & Observations Report (`/caregivers/handover`)
The mission-critical transition screen used by home nurses and caregivers at shift departure to ensure seamless continuity of care.

```
+-------------------------------------------------------------------+
|  [ Close ]           SHIFT HANDOVER SUMMARY                       |
+-------------------------------------------------------------------+
|  Shift: Day Shift (08:00 - 18:00) | Patient: Kishore Kumar        |
|  Departing: Sunita Sharma (Nurse) | Incoming: Family (Ramesh)     |
+-------------------------------------------------------------------+
|  1. MEDICATION STATUS (CHECKLIST)                                 |
|  [✓] All Day Doses Administered                                   |
|  [!] Note: Night Dose (Atorva + Melatonin) is pending for 9:00 PM.|
|      Tablets kept on dining table medicine tray.                  |
+-------------------------------------------------------------------+
|  2. PHYSICAL & MENTAL OBSERVATIONS                                |
|  • Mobility: Walked 400 steps with walker in balcony. No unsteadiness.
|  • Pain/Discomfort: Mild knee stiffness noted at 11 AM. Applied gel.
|  • Mood: Cheerful, spoke with granddaughter on phone.             |
+-------------------------------------------------------------------+
|  3. INVENTORY CHECK                                               |
|  • BP Pill (Telma 40): 4 strips remaining (Sufficient).          |
|  • Adult Diapers: 2 pieces remaining. [ REFILL NEEDED ]           |
+-------------------------------------------------------------------+
|  SIGN-OFF & TRANSFER                                              |
|  Caregiver Digital Signature: [ Sunita Sharma - Verified PIN ]    |
|                                                                   |
|  [ COMPLETE HANDOVER & NOTIFY FAMILY ]                            |
+-------------------------------------------------------------------+
```

*   **Layout Summary:** High-density, step-by-step audit form grouped into three mandatory sections: Medication Status, Clinical Observations, and Medical Inventory.
*   **Key UI Elements:**
    *   *Pending Item Alert Box:* Bright amber callout identifying medications or tasks that fall directly into the next shift or family member's watch.
    *   *Voice-to-Text Input:* Caregivers can tap a microphone icon to dictate qualitative observations in their native dialect (Hindi, Marathi, Tamil, etc.).
    *   *Refill Threshold Toggle:* One-tap tagging of low supplies that automatically pings the family member's Amazon/PharmEasy cart.
*   **Primary Actions:** Complete digital sign-off, trigger push notifications to family members, and clock out.

---

#### SCR-08: Printable Refrigerator Schedule & Emergency Wallet Kit (`/print/schedule-sheet`)
A high-utility offline bridge for households where internet is intermittent, or where elderly patients prefer physical tactile aids stuck to their refrigerator.

```
+========================================================================================+
|  JEEVASETU WEEKLY CARE SHEET  | Patient: Kishore Kumar (Age 76) | Blood Group: B+     |
|  Emergency Contact: Ramesh (Son) +91 98765-43210 | Doctor: Dr. Mehta +91 91234-56780   |
+========================================================================================+
| TIME SLOT    | MEDICINE NAME       | WHAT IT LOOKS LIKE | INSTRUCTIONS   | MON TUE WED |
+--------------+---------------------+--------------------+----------------+-------------+
| MORNING      | Telma 40            | [O] White Round    | 1 Tab after    | [ ] [ ] [ ] |
| (08:00 AM)   | (Telmisartan 40mg)  | Small Tablet       | breakfast      |             |
+--------------+---------------------+--------------------+----------------+-------------+
| AFTERNOON    | Shelcal 500         | [ ] White Oblong   | 1 Tab after    | [ ] [ ] [ ] |
| (02:00 PM)   | (Calcium + Vit D3)  | Large Tablet       | lunch          |             |
+--------------+---------------------+--------------------+----------------+-------------+
| NIGHT        | Atorva 10           | [O] Yellow Round   | 1 Tab before   | [ ] [ ] [ ] |
| (09:00 PM)   | (Atorvastatin 10mg) | Tiny Tablet        | bedtime        |             |
+========================================================================================+
| IN CASE OF FALL OR FAINTING: 1. Keep patient flat. 2. Call Ambulance (108).            |
| 3. Call Ramesh immediately. DO NOT GIVE WATER IF UNCONSCIOUS.                          |
+========================================================================================+
```

*   **Layout Summary:** Monochrome-optimized, high-contrast, large-font tabular layout engineered for black-and-white home printers on standard A4 paper.
*   **Key Elements:**
    *   High-contrast physical checkboxes for pen/pencil marking.
    *   Visual pill silhouettes (Round, Oval, Capsule, Oblong) paired with color names.
    *   Bolded, standardized first-aid emergency protocol box at the bottom.

---

### 6.3 End-to-End User Journey Maps

#### Journey 1: New Family Member Onboarding → Create Patient Profile → Invite Care Team
*   **Persona:** Rahul (38, Software Engineer living in Bengaluru, caring for his 74-year-old mother Saroj in Pune).
*   **Emotional State:** Anxious, pressed for time, seeking structure and peace of mind.

```
[ Download App / Open Web Link ]
             |
             v
 [ Step 1: Phone + OTP Login ] ----(Voice OTP fallback)
             |
             v
 [ Step 2: Role Selection ] --------> Selected: "Family Guardian"
             |
             v
 [ Step 3: Patient Profile Builder ]
   - Name: Saroj Sharma (74)
   - Conditions: Hypertension, Type-2 Diabetes
   - Upload prescription photo (OCR auto-populates Telma 40 & Metformin)
             |
             v
 [ Step 4: Emergency Escalation Chain ]
   - Primary: Rahul (Son)
   - Secondary: Sunita (Local Home Care Nurse)
   - Tertiary: Dr. Joshi (Family Physician)
             |
             v
 [ Step 5: Invite Care Team Hub ]
   - Generates WhatsApp invite link for Mother (Installs "Elderly Simple Mode")
   - Generates SMS invite link for Nurse Sunita ("Caregiver Shift Mode")
             |
             v
 [ Step 6: Confirmation & Initial Dashboard Live ]
```

*   **Interaction Detail & UI State:**
    *   *Prescription Scan:* Camera capture triggers real-time OCR. The UI presents recognized medications in an editable review card: "We detected *Telma 40mg*. Is this correct?" with one-tap confirmation.
    *   *Role-Specific Deep Linking:* The WhatsApp invitation sent to the mother opens directly into the ultra-simplified, pre-authenticated Elderly Tablet Mode with zero password entry required.
*   **Edge Case & Fail-Safe:** If OCR fails or prescription is handwritten, the app allows skipping medication entry and offers: *"Request our clinical concierge to digitize this prescription within 2 hours."*

---

#### Journey 2: Patient Views Today's Medications → Confirms Taking One
*   **Persona:** Kishore (76, retired civil servant, mild hand tremor, wears reading glasses).
*   **Emotional State:** Desires independence, wary of complex technology, fears taking the wrong pill.

```
[ Tablet on stand chimes gently at 08:30 AM ]
             |
             v
 [ Screen wakes up automatically to SCR-01 (Elderly Dashboard) ]
             |
             v
 [ Hero Card highlights in Amber: "MORNING MEDICINE DUE" ]
   - Audio prompt reads aloud: "Kishore ji, it is time for your Morning BP Tablet."
             |
             v
 [ Patient touches large card / "TAKE THIS MEDICINE" ]
             |
             v
 [ Intake Confirmation Modal (SCR-04) opens ]
   - Displays 150px photo of Telma 40 (Red/White blister, round white pill)
   - Simple text: "Take 1 pill with water after food."
             |
             v
 [ Patient swallows pill, taps giant green "YES, I TOOK IT" button ]
             |
             v
 [ Delight & Positive Reinforcement ]
   - Cheerful confirmation chime.
   - Large green tick icon animates: "Recorded! Good job, Kishore ji."
   - Screen returns to idle dashboard after 6 seconds.
             |
             v
 [ Real-time Cloud Sync -> Family App updates to 100% Morning Adherence ]
```

*   **Interaction Detail & UI State:**
    *   *Slip Protection:* The "YES, I TOOK IT" button requires a deliberate single tap, followed by a non-blocking 10-second banner at the bottom: *"Tapped by mistake? [ Undo ]"*.
    *   *Sensory Feedback:* Visual (screen flash / green check), auditory (soft positive bell), and haptic (short device vibration on supported tablets/phones).
*   **Edge Case & Fail-Safe:** If the patient does not interact with the screen within 45 minutes of the scheduled dose, the system transitions to an escalation alert: a friendly automated voice phone call is placed to the landline/mobile, and a notification is dispatched to the family member's dashboard.

---

#### Journey 3: Family Member Reviews Weekly Adherence → Notices Missed Dose → Explores Care Timeline
*   **Persona:** Ananya (42, lives in London, monitoring her father in Mumbai).
*   **Emotional State:** Hyper-vigilant, worried when routines break, needs factual context without causing unnecessary panic.

```
[ Push Notification: "Alert: Afternoon Calcium dose was not logged for Papa." ]
             |
             v
 [ Ananya taps notification -> Directly opens SCR-02 (Family Command Center) ]
             |
             v
 [ Views "Active Alerts" banner ]
   - Alert details: "Calcium 500mg (2:00 PM) marked Delayed by Caregiver Priya."
             |
             v
 [ Ananya taps "View Timeline Details" -> Navigates to SCR-06 (Care Timeline) ]
             |
             v
 [ Timeline reveals context: ]
   - 01:30 PM: Lunch logged (Papa had a heavy lunch, complained of fullness).
   - 02:05 PM: Caregiver Note: "Patient requested to rest. Pill kept for 4:30 PM tea time."
             |
             v
 [ Ananya taps "Weekly Adherence Matrix" (SCR-05) ]
   - Reviews 14-day history: Notes Calcium has been delayed 3 times this week after lunch.
             |
             v
 [ Action Taken ]:
   - Ananya taps "Message Caregiver": "Hi Priya, let's shift Calcium permanently to 5 PM with tea."
   - Taps "Update Schedule" -> Adjusts dose time in Prescription settings.
```

*   **Interaction Detail & UI State:**
    *   *Deep Linking:* Tapping the push notification navigates straight to the context of the issue rather than a generic home screen.
    *   *Root-Cause Visibility:* The timeline links medication non-compliance directly with circumstantial data (lunch logs, qualitative caregiver notes).
*   **Edge Case & Fail-Safe:** If the caregiver had not entered a note for the missed dose, the alert panel displays a prominent red button: `[ Request Immediate Callback from Caregiver ]`.

---

#### Journey 4: Caregiver Receives Assignment → Acknowledges → Logs Medication → Shift Handover
*   **Persona:** Sunita (29, Certified Home Health Aide working for a home healthcare agency).
*   **Emotional State:** Busy, managing multiple tasks, needs fast data entry with zero administrative overhead.

```
[ Notification: "New Shift Assigned: Kishore Kumar (08:00 - 18:00 Today)" ]
             |
             v
 [ Opens Caregiver App -> Taps "Acknowledge & Accept Shift" ]
             |
             v
 [ 08:00 AM: Arrives at patient residence -> Taps "Clock-In (At Residence)" ]
   - GPS geotag confirms arrival within 50m of home address.
             |
             v
 [ App unlocks SCR-03 (Shift Workspace) ]
   - Displays immediate task: "08:30 AM Morning Vitals & BP Medication."
             |
             v
 [ 08:30 AM: Measures BP (128/82) -> Taps "+ Log Vitals" -> Enters digits -> Saves ]
 [ Prepares Telma 40 -> Administers with breakfast -> Taps "[✓] LOG GIVEN" ]
             |
             v
 [ Throughout the day: Completes lunch assistance, hydration logs, afternoon walk ]
             |
             v
 [ 17:45 PM: Shift End Approaches -> Taps "Initiate Shift Handover" (SCR-07) ]
   - Verifies all daily doses checked off.
   - Flags: "Diaper packet has only 2 pieces left."
   - Uses voice-dictation to leave note: "Kishore ji was active today, walked 15 mins."
   - Enters 4-digit PIN for digital signature.
             |
             v
 [ Family receives instant "Shift Summary & Handover Approved" WhatsApp digest ]
```

*   **Interaction Detail & UI State:**
    *   *One-Handed Thumb Zone:* All logging triggers (`Log Vitals`, `Log Given`, `Handover`) are positioned in the bottom 40% of the phone screen.
    *   *Failsafe Pill Checklist:* When logging medication, checkboxes are accompanied by pill reference photos to protect the caregiver against medication administration errors.

---

#### Journey 5: Offline Field Scenario: User Loses Connection → Views Cached Schedule → Logs Event → Reconnects → Syncs
*   **Persona:** Sunita (Caregiver) or Kishore (Patient) in an apartment basement or during an internet service disruption in New Delhi.
*   **Emotional State:** Unfazed, confident that the application will not freeze or lose vital medical entries.

```
[ Home Wi-Fi drops / Mobile 4G shows "No Service" ]
             |
             v
 [ App detects offline state via Service Worker / Native Network Listener ]
   - Persistent, non-intrusive status pill appears at top:
     "Working Offline (Changes Saved Locally)" in subtle gray/slate blue.
             |
             v
 [ User navigates to "/medications/today" ]
   - Screen renders instantaneously from local IndexedDB cache.
   - Full pill photos, dosage guidelines, and patient instructions are visible.
             |
             v
 [ User taps "[✓] LOG ALL GIVEN" for 2:00 PM Dose ]
   - UI provides immediate visual and audio success confirmation without network delay.
   - Log is written to local IndexedDB "Outbox Queue" with ISO timestamp & cryptographic UUID.
   - Badge on top updates: "Sync: 1 action queued".
             |
             v
 [ User logs Blood Glucose: "118 mg/dL" -> Queued in Outbox (2 actions pending) ]
             |
             v
 [ 3 hours later: Cellular connection restores ]
   - Background Sync worker detects online event.
   - Automatically replays queued events to JEEVASETU cloud in chronological order.
   - Idempotent API endpoints resolve conflicts using timestamp precedence.
             |
             v
 [ Top status pill smoothly animates to Green: "All Changes Synced ✓" for 4 seconds, then hides ]
```

*   **Interaction Detail & UI State:**
    *   *Optimistic UI Updates:* The interface never blocks user interaction with spinning loaders during offline states. Actions reflect as completed immediately.
    *   *Conflict Resolution Strategy:* Timestamp-based Last-Write-Wins (LWW) with server-side reconciliation; manual caregiver logs take clinical priority over automated client-side defaults.

---

### 6.4 Elderly-Centric Design System & Accessibility Principles

To accommodate natural age-related degradation in visual acuity, contrast sensitivity, fine motor coordination, and short-term memory, the following concrete design standards are enforced across all patient-facing surfaces:

```
+-------------------------------------------------------------------------+
|                  ELDERLY TOUCH TARGET & ERGONOMIC SPEC                  |
|                                                                         |
|        Minimum Height: 56px (Standard CTA) / 64-72px (Primary)          |
|    <--------------------------------------------------------------->    |
|    +---------------------------------------------------------------+ ^  |
|    |                                                               | |  |
|    |    [ ✓ ]   I HAVE TAKEN THIS MEDICINE (22px Bold)             | |  |
|    |                                                               | 72px
|    +---------------------------------------------------------------+ v  |
|    <---------------------- Minimum Width: 100% -------------------->    |
|                                                                         |
|    Margin / Safety Cushion: 16px min between adjacent touch targets     |
+-------------------------------------------------------------------------+
```

#### 1. Touch Targets & Motor Ergonomics
*   **Absolute Minimums:** While WCAG 2.1 AA mandates 24x24px and AAA specifies 44x44px, JEEVASETU enforces a **strict minimum of 48x48px** for secondary utility icons and **56px to 72px** for all core action buttons.
*   **Safety Buffers:** A minimum of 16px margin is enforced between clickable targets to eliminate unintended clicks caused by physiological tremors or arthritis.
*   **No Precision Gestures:** Zero swipe-to-delete, multi-finger pinches, long-press combos (except deliberate 3-second SOS), or small dropdown carousels. All interactions are based on simple, unambiguous single-tap targets.

#### 2. Visual Hierarchy, Typography & Contrast Standards
*   **Contrast Compliance:** All text and critical UI boundaries achieve a **minimum contrast ratio of 7:1** against their background (exceeding WCAG AAA standards).
*   **Color Palette Specification:**
    *   *Primary Canvas:* Warm Cream (`#FDFBF7`) instead of stark blue-light white (`#FFFFFF`) to reduce glare and visual fatigue.
    *   *Core Text:* Deep Charcoal/Black (`#1A202C`) to provide maximum contrast without harshness.
    *   *Affirmative / Success:* Forest Green (`#146C43`) with white text (Contrast 8.2:1).
    *   *Cautionary Alert:* Deep Ochre/Amber (`#997404`) on light yellow background.
    *   *Emergency SOS:* Deep Crimson (`#B02A37`) with stark white text (Contrast 7.4:1).
*   **Typography:** Accessible sans-serif typefaces with distinct letterforms (e.g., clear distinctions between `I`, `l`, and `1`), such as Atkinson Hyperlegible or Inter. Base font size for elderly mode is **20px**, with headers scaling from **24px to 32px**. Line-height is locked to at least **1.5x font size**.

#### 3. Navigation Architecture: Maximum 2-Level Depth
*   **Flat Tree Structure:** Elderly users never navigate deeper than 2 levels (Home $\rightarrow$ Action Modal $\rightarrow$ Home). Nested menus, hamburger navigation drawers, and floating contextual popovers are entirely banned in Elderly Mode.
*   **Persistent Return Anchor:** Every sub-screen features an unmistakable, full-width `[ < GO BACK TO HOME ]` banner button at the top left. Breadcrumbs are omitted in favor of explicit conversational headers ("Back to Medicine List").

#### 4. Error Prevention & Slip Management
*   **Two-Step Confirmation for Critical Actions:** High-consequence actions (e.g., logging medication, calling an ambulance) use a two-step confirmation or a hold-to-activate mechanism to protect against slips.
*   **10-Second Forgiving Undo Banner:** Any logged action triggers a floating bottom toast with a high-contrast `[ UNDO ]` button that remains visible for 10 full seconds before committing permanently to the cloud database.

#### 5. Plain Language & Jargon Elimination
Medical terminology is translated into colloquial, human-centric descriptions across all patient interfaces:

| Clinical / Pharmacological Term | JEEVASETU Plain Language Replacement | Visual Pill Descriptor |
| :--- | :--- | :--- |
| *Antihypertensive (Amlodipine 5mg)* | **Morning Blood Pressure Pill** | Small white round pill |
| *Oral Hypoglycemic (Metformin 500mg)* | **Sugar Control Tablet (After Food)** | White oblong tablet with center line |
| *Lipid-lowering Agent (Atorvastatin)* | **Night Heart & Cholesterol Pill** | Tiny pale yellow pill |
| *Post-prandial Blood Glucose* | **Sugar Check (2 Hours After Lunch)** | Finger-prick icon with blue strip |
| *PRN / Pro Re Nata* | **Take Only When Needed for Pain** | Amber pill bottle with hand icon |
| *Hypertension Stage 1* | **Blood Pressure is Slightly High** | Yellow heart indicator |

#### 6. Multi-Sensory Feedback
*   Every button tap triggers immediate visual confirmation (button darkens and shifts state).
*   Critical alerts and intake confirmations are paired with pleasant, recognizable audio frequencies (400Hz - 800Hz, avoiding ultra-high pitches that age-related presbycusis obscures).
*   A "Read Out Loud" (`[ 🔊 Listen ]`) speaker button is present beside all medical instructions, reading content in clear, natural speech in the patient's selected dialect.

---

### 6.5 Responsive Platform Strategy & Form-Factor Adaptations

JEEVASETU adapts its layout engine to match the physical contexts of its three user personas:

```
+---------------------------------------------------------------------------------------+
|                       CROSS-DEVICE RESPONSIVE STRATEGY                                |
+---------------------------+-------------------------------+---------------------------+
| CAREGIVER: MOBILE-FIRST   | ELDERLY: TABLET STAND / KIOSK | FAMILY: DESKTOP / WEB HUB |
| (5.5" - 6.7" Viewports)   | (8.0" - 11.0" Touchscreens)   | (13" Laptop to 27" Ultra) |
+---------------------------+-------------------------------+---------------------------+
| • Thumb-zone execution    | • Landscape/Portrait locked   | • Multi-column data grid  |
| • 1-Handed Bottom Nav     | • Large glanceable hero cards | • Adherence trend charts  |
| • Barcode / Camera OCR    | • Ambient auto-wake display   | • PDF clinical exports    |
| • Voice notes dictation   | • Integrated speed-dial calls | • Caregiver team roster   |
| • Resilient offline sync  | • Always-on clock & SOS strip | • Multi-patient switcher  |
+---------------------------+-------------------------------+---------------------------+
```

#### 1. Caregivers: Mobile-First Single-Handed Operation (Handheld Smart Devices)
*   **Ergonomic Thumb-Zone Mapping:** Critical execution buttons (`Log Dose`, `Emergency Call`, `Next Task`) are anchored within the lower 35% "Natural Thumb Reach Zone" of standard mobile displays.
*   **Field Optimization:** Lightweight DOM tree, aggressive asset caching, support for low-light night shifts (OLED dark mode for night nurses), and native camera integration for photo proof of medication administration and wound healing tracking.
*   **Voice-to-Text Input:** Native speech recognition integration allowing caregivers to dictate observations in Hindi, Hinglish, Marathi, Kannada, or English without typing on tiny on-screen keyboards.

#### 2. Elderly Patients: Tablet-Friendly "Bedside Stand / Kitchen Counter" Mode
*   **Form Factor:** Optimized for 8"–11" Android tablets and iPads resting in fixed charging stands or magnetic wall mounts.
*   **Ambient Kiosk State:** When unused for 2 minutes, the tablet transitions into a high-contrast, large-font "Care Clock" showing the time, date, weather, and a gentle countdown to the next meal or medicine.
*   **Orientation Lock:** The interface locks into the user's preferred orientation (landscape or portrait) and completely suppresses complex split-screen or multi-tasking OS gestures.

#### 3. Family Members: Multi-Column Desktop & Responsive Web Portal
*   **Wide-Screen Layout:** On viewports $\ge$ 1024px, the family dashboard unfolds into a 3-column command center:
    *   *Column 1 (Left 25%):* Patient profile card, vital stats summary, caregiver shift status, and device battery levels.
    *   *Column 2 (Center 50%):* Live Care Timeline stream with image/audio player and interactive filter controls.
    *   *Column 3 (Right 25%):* 30-day adherence heatmaps, prescription refill tracker, and emergency escalation hierarchy controls.
*   **Export Engine:** Direct vector generation of PDF clinical care dossiers, formatted for outpatient consultations with geriatricians and cardiologists.

#### 4. Resilient Offline-First Architecture & Service Worker Sync Strategy
*   **Client Data Store:** High-capacity IndexedDB managed via a custom lightweight PWA service worker layer. Stores the full 30-day medication schedule, emergency contact directory, local voice audio files, and the pending outbox queue.
*   **Sync Engine:** Employs exponential backoff background synchronization (`BackgroundSync` API) that triggers when network connectivity transitions from offline to online.
*   **Conflict-Free Data Types (CRDT):** Timestamped event-sourcing ensures that logs recorded by a caregiver offline in a basement apartment correctly merge with family observations without overwriting clinical histories.
*   **Visual Network Transparency:** A persistent, micro-status indicator keeps users informed of cloud connectivity status without blocking interaction, ensuring trust and predictability at all times.

---

This section provides the complete blueprint for the JEEVASETU user interface, guaranteeing accessibility for aging seniors, operational velocity for field caregivers, and continuous visibility for remote family members. All specifications are ready for direct translation into design tokens, Figma wireframes, and front-end component implementations.


---\n
## 7. API Endpoint Specifications

This section defines the backend RESTful Route Handlers for the **JEEVASETU** elderly-care platform, implemented using the Next.js App Router paradigm (`app/api/.../route.ts`). All routes follow strict zero-trust validation, granular Role-Based Access Control (RBAC), RFC 7807-compliant structured error envelopes, distributed rate limiting, and cryptographic idempotency guarantees for clinical safety.

---

### 7.1 Architecture Standards & Conventions

#### 7.1.1 Next.js App Router Route Handler Pattern
Every endpoint is executed as an isolated Next.js Serverless Route Handler conforming to the standard `Request` and `Response` Web APIs:
```ts
// Example: app/api/medications/[id]/events/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // 1. Session & Auth Check
  // 2. Idempotency Validation
  // 3. Zod Payload Schema Parsing
  // 4. Domain Service Execution & Transaction
  // 5. Audit Logging
  // 6. Return Structured Envelope
}
```

#### 7.1.2 Standard Response Envelopes
To ensure client consistency across web, mobile, and third-party integrations, all endpoints return a uniform envelope.

**Success Envelope (`ApiResponse<T>`):**
```ts
interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: {
    pagination?: {
      total: number;
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    timestamp: string; // ISO 8601 UTC
    requestId: string;
  };
}
```

**Error Envelope (`ApiErrorEnvelope`):**
```ts
interface ApiErrorDetail {
  field?: string;
  code: string;
  message: string;
}

interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string; // Machine-readable uppercase snake_case
    message: string; // Human-readable clinical/system context
    target?: string;
    details?: ApiErrorDetail[];
    requestId: string;
    timestamp: string;
    path: string;
  };
}
```

#### 7.1.3 Standard Error Codes
| HTTP Status | Error Code | Description / Context |
| :--- | :--- | :--- |
| `400` | `INVALID_REQUEST_PAYLOAD` | Request body or query parameters failed Zod schema parsing. |
| `400` | `INVALID_PASSCODE_FORMAT` | Passcode does not adhere to required entropy/character rules. |
| `401` | `AUTHENTICATION_REQUIRED` | Missing, malformed, or expired Bearer JWT token. |
| `401` | `OIDC_TOKEN_INVALID` | Cloud Scheduler OIDC identity token verification failed. |
| `403` | `FORBIDDEN_INSUFFICIENT_ROLE` | Authenticated user lacks required RBAC role. |
| `403` | `CAREGIVER_NOT_ASSIGNED` | Caregiver is not assigned to the specified patient. |
| `404` | `RESOURCE_NOT_FOUND` | The specified resource ID does not exist in the tenant scope. |
| `409` | `IDEMPOTENCY_CONFLICT` | An operation with the same `Idempotency-Key` is currently processing. |
| `409` | `PASSCODE_ALREADY_REDEEMED` | One-time passcode was previously claimed. |
| `410` | `PASSCODE_EXPIRED` | Invitation passcode exceeded TTL without redemption. |
| `422` | `CLINICAL_VALIDATION_ERROR` | Conflicting medical schedule, dose mismatch, or invalid state change. |
| `429` | `RATE_LIMIT_EXCEEDED` | Request threshold breached for IP, client, or identity. |
| `500` | `INTERNAL_SERVER_ERROR` | Unhandled runtime exception; correlation logged to monitoring. |
| `503` | `DEPENDENCY_UNAVAILABLE` | External downstream (SMS gateway, Redis, DB connection pool) offline. |

#### 7.1.4 Idempotency Framework
For state-mutating endpoints (notably `POST /api/medications/[id]/events`, `POST /api/invitations`, and `POST /api/reminders/process`), requests must supply a unique UUIDv4 string via the `Idempotency-Key` HTTP header.
1. **Cache Layer**: Upstash/Redis acts as the distributed idempotency store.
2. **Key Format**: `idemp:{userId}:{endpoint}:{idempotencyKey}`.
3. **Execution Semantics**:
   - Check if key exists. If status is `PROCESSING`, return HTTP `409 IDEMPOTENCY_CONFLICT`.
   - If key exists and status is `COMPLETED`, replay stored HTTP status code, headers, and payload directly from cache without executing business logic.
   - If key does not exist, set key with state `PROCESSING` and a 60-second execution lock. Upon handler completion, overwrite value with `{ statusCode, responseBody }` and set TTL = 86,400 seconds (24 hours).

#### 7.1.5 Rate Limiting Strategy
All Route Handlers are protected via a distributed sliding-window counter implemented in Redis:
- **Public / Unauthenticated Routes** (`POST /api/invitations/redeem`): **5 requests / 15 minutes** per client IP. Prevents automated brute-forcing of 6-digit passcodes.
- **Authenticated Clinical Events** (`POST /api/medications/[id]/events`, `POST /api/patients/[id]/vitals`): **60 requests / minute** per authenticated user ID.
- **Standard Patient & Family Queries** (`GET /api/patients/...`): **120 requests / minute** per user ID.
- **Internal / Scheduled Jobs** (`POST /api/reminders/process`): **10 requests / minute**, restricted to Google Cloud Scheduler Service Account IPs and OIDC identity validation.
- **Standard Response Headers**:
  - `X-RateLimit-Limit`: Maximum requests permitted in window.
  - `X-RateLimit-Remaining`: Remaining allowable requests in active window.
  - `X-RateLimit-Reset`: Unix epoch timestamp when active window refreshes.
  - `Retry-After`: Seconds to wait before retrying (sent on `429`).

#### 7.1.6 Role-Based Access Control (RBAC) Matrix
The platform recognizes seven distinct roles:
1. `SUPER_ADMIN`: System-level maintenance, platform telemetry, compliance auditing.
2. `FAMILY_ADMIN`: Primary account owner (typically adult child), full management of elderly parent profile, medical prescriptions, invitations, caregiver assignments, billing.
3. `PRIMARY_CAREGIVER`: Designee managing daily living tasks, medical adherence, and communications.
4. `SECONDARY_CAREGIVER`: Extended family or helper with read access and limited note logging.
5. `NURSE_ATTENDANT`: Professional home care attendant; manages vitals logging, shift handovers, medication event recording. Restricted from editing core prescriptions or financial records.
6. `DOCTOR`: Healthcare professional with prescribing rights, clinical note authoring, and read-only adherence audit access.
7. `PATIENT`: The senior; simplified high-contrast interface for one-touch medication check-offs and emergency calling.
8. `SYSTEM_CRON`: Cloud Scheduler automated service account (Google OIDC authenticated).

---

### 7.2 Complete Master API Endpoint Directory

| Method | Path | Domain | Description | Auth Required | Authorized Roles | Idempotency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/invitations` | Auth / Invitations | Create time-bound passcode invitation for caregiver/family. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | Header Required |
| `POST` | `/api/invitations/redeem` | Auth / Invitations | Redeem 6-digit passcode to claim caregiver/family access. | Optional | Public / Authenticated User | Header Optional |
| `GET` | `/api/invitations` | Auth / Invitations | List active/pending invitations for a patient. | Yes | `FAMILY_ADMIN`, `PRIMARY_CAREGIVER` | None |
| `DELETE`| `/api/invitations/[id]` | Auth / Invitations | Revoke an outstanding invitation before expiry. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | None |
| `GET` | `/api/auth/me` | Auth / Invitations | Return authenticated profile, roles, and assigned patients. | Yes | All Roles | None |
| `GET` | `/api/patients` | Patients | List all elderly patients accessible to caller. | Yes | All Roles | None |
| `POST` | `/api/patients` | Patients | Register a new elderly patient profile. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | Header Required |
| `GET` | `/api/patients/[id]` | Patients | Retrieve full patient profile, allergies, and contacts. | Yes | All Assigned Roles | None |
| `PATCH` | `/api/patients/[id]` | Patients | Update patient profile, address, or emergency contacts. | Yes | `FAMILY_ADMIN`, `PRIMARY_CAREGIVER` | None |
| `GET` | `/api/patients/[id]/adherence` | Patients | Calculate aggregate medication adherence & streak stats. | Yes | All Assigned Roles | None |
| `GET` | `/api/patients/[id]/vitals` | Patients | Query historical vital sign readings with filters. | Yes | All Assigned Roles | None |
| `POST` | `/api/patients/[id]/vitals` | Patients | Record new vital sign reading (BP, glucose, SpO2, temp). | Yes | `FAMILY_ADMIN`, `CAREGIVER`, `NURSE`, `PATIENT` | Header Optional |
| `GET` | `/api/patients/[id]/medications` | Medications | List all active and archived medications for patient. | Yes | All Assigned Roles | None |
| `POST` | `/api/patients/[id]/medications` | Medications | Add a new medication regimen & inventory profile. | Yes | `FAMILY_ADMIN`, `DOCTOR` | Header Required |
| `GET` | `/api/medications/[id]` | Medications | Retrieve medication metadata, stock count, and instructions.| Yes | All Assigned Roles | None |
| `PATCH` | `/api/medications/[id]` | Medications | Update dosage, instructions, stock, or warning tags. | Yes | `FAMILY_ADMIN`, `DOCTOR` | None |
| `DELETE`| `/api/medications/[id]` | Medications | Discontinue/archive medication regimen. | Yes | `FAMILY_ADMIN`, `DOCTOR` | None |
| `POST` | `/api/medications/[id]/refill`| Medications | Log pill inventory refill and update remaining supply. | Yes | `FAMILY_ADMIN`, `PRIMARY_CAREGIVER` | Header Required |
| `GET` | `/api/medications/[id]/schedules` | Schedules | Retrieve active schedule intervals for a medication. | Yes | All Assigned Roles | None |
| `POST` | `/api/medications/[id]/schedules` | Schedules | Create a time-slot/recurrence rule for medication. | Yes | `FAMILY_ADMIN`, `DOCTOR` | Header Required |
| `PATCH` | `/api/schedules/[id]` | Schedules | Modify schedule time, meal association, or active days. | Yes | `FAMILY_ADMIN`, `DOCTOR` | None |
| `DELETE`| `/api/schedules/[id]` | Schedules | Delete or deactivate a schedule recurrence rule. | Yes | `FAMILY_ADMIN`, `DOCTOR` | None |
| `GET` | `/api/patients/[id]/schedules/today` | Schedules | Consolidated daily medication checklist for patient. | Yes | All Assigned Roles | None |
| `POST` | `/api/medications/[id]/events` | Medication Events | Record dose taken, skipped, snoozed, or missed. | Yes | `PATIENT`, `CAREGIVERS`, `NURSE`, `ADMIN` | Header Required |
| `GET` | `/api/medications/[id]/events` | Medication Events | Retrieve chronological event log for specific medication. | Yes | All Assigned Roles | None |
| `GET` | `/api/patients/[id]/medication-events`| Medication Events | Query all patient medication events within date window. | Yes | All Assigned Roles | None |
| `PATCH` | `/api/medication-events/[id]`| Medication Events | Amend mislogged event (requires audit justification). | Yes | `FAMILY_ADMIN`, `DOCTOR` | None |
| `GET` | `/api/patients/[id]/appointments` | Appointments | List upcoming and past medical consultations. | Yes | All Assigned Roles | None |
| `POST` | `/api/patients/[id]/appointments` | Appointments | Schedule a doctor consultation or lab screening. | Yes | `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `DOCTOR` | Header Required |
| `GET` | `/api/appointments/[id]` | Appointments | Fetch appointment details, location, and transport. | Yes | All Assigned Roles | None |
| `PATCH` | `/api/appointments/[id]` | Appointments | Reschedule, update clinic notes, or transport info. | Yes | `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `DOCTOR` | None |
| `POST` | `/api/appointments/[id]/status` | Appointments | Transition state (`CONFIRMED`, `COMPLETED`, `CANCELLED`).| Yes | `FAMILY_ADMIN`, `CAREGIVER`, `DOCTOR` | None |
| `POST` | `/api/appointments/[id]/notes`| Appointments | Attach post-visit discharge summary or clinical memo. | Yes | `DOCTOR`, `FAMILY_ADMIN`, `NURSE` | None |
| `GET` | `/api/patients/[id]/timeline` | Care Timeline | Paginated unified chronological feed of all care actions. | Yes | All Assigned Roles | None |
| `POST` | `/api/patients/[id]/timeline/notes`| Care Timeline | Create incident report, observational note, or update. | Yes | `CAREGIVERS`, `NURSE`, `DOCTOR`, `ADMIN` | Header Optional |
| `GET` | `/api/patients/[id]/caregivers` | Caregiver Assign | List all active/inactive caregivers assigned to patient. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | None |
| `POST` | `/api/patients/[id]/caregivers` | Caregiver Assign | Assign existing platform user as caregiver to patient. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | Header Required |
| `PATCH` | `/api/patients/[id]/caregivers/[caregiverId]`| Caregiver Assign | Update caregiver shift hours, role, or permissions. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | None |
| `DELETE`| `/api/patients/[id]/caregivers/[caregiverId]`| Caregiver Assign | Revoke caregiver assignment from patient profile. | Yes | `FAMILY_ADMIN`, `SUPER_ADMIN` | None |
| `POST` | `/api/caregivers/shifts/clock-in` | Caregiver Assign | Attendant logs arrival and shift start. | Yes | `NURSE_ATTENDANT`, `PRIMARY_CAREGIVER` | Header Required |
| `POST` | `/api/caregivers/shifts/clock-out` | Caregiver Assign | Attendant logs departure with clinical handover memo. | Yes | `NURSE_ATTENDANT`, `PRIMARY_CAREGIVER` | Header Required |
| `POST` | `/api/reminders/process` | Reminders (Internal) | Batch evaluate pending reminder windows & trigger alerts. | Yes | `SYSTEM_CRON` (OIDC Service Acc) | Header Required |
| `GET` | `/api/reminders/pending` | Reminders (Internal) | Inspect in-flight notification queue for monitoring. | Yes | `SUPER_ADMIN`, `SYSTEM_CRON` | None |
| `POST` | `/api/reminders/send-adhoc` | Reminders | Trigger immediate manual push/WhatsApp buzz to senior. | Yes | `FAMILY_ADMIN`, `PRIMARY_CAREGIVER` | Header Required |
| `POST` | `/api/reminders/[id]/ack` | Reminders | Record senior or attendant acknowledgement of reminder. | Yes | All Assigned Roles | None |
| `GET` | `/api/health` | System Health | Liveness probe returning HTTP 200 and timestamp. | No | Public / Load Balancer | None |
| `GET` | `/api/health/ready` | System Health | Deep readiness probe checking DB, Redis, and SMS APIs. | No | Public / Monitoring Systems | None |
| `GET` | `/api/health/metrics` | System Health | Operational metrics (queue latency, active workers). | Yes | `SUPER_ADMIN` | None |

---

### 7.3 Detailed Endpoint Specifications by Domain

```
       +-------------------------------------------------------------------------+
       |                           JEEVASETU DOMAIN MAP                          |
       +-------------------------------------------------------------------------+
       |  [Auth/Invitations] <---> [Patients] <----------> [Care Timeline]       |
       |         |                     ^                         ^               |
       |         v                     |                         |               |
       |  [Caregiver Assign]           +---> [Medications] ------+               |
       |                               |          |                              |
       |                               v          v                              |
       |                        [Appointments]  [Schedules]                      |
       |                                          |                              |
       |                                          v                              |
       |                                   [Medication Events]                   |
       |                                          ^                              |
       |                                          |                              |
       |  [Cloud Scheduler] ---> [POST /api/reminders/process]                   |
       +-------------------------------------------------------------------------+
```

---

#### 7.3.1 Domain 1: Auth / Invitations

##### KEY ENDPOINT: Create Passcode Invitation
- **Route**: `POST /api/invitations`
- **File**: `app/api/invitations/route.ts`
- **Description**: Generates a high-entropy, human-friendly 6-character alphanumeric or 6-digit numeric passcode and an associated cryptographic JWT redemption URL (with QR payload). The invitation links a designated caregiver or family member to a specific elderly patient profile upon redemption.
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Authorized Roles**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Idempotency**: **Header Required** (`Idempotency-Key: <UUIDv4>`). Prevents issuing duplicate invitations or consuming SMS quotas on retry.

**Headers:**
```http
POST /api/invitations HTTP/1.1
Host: api.jeevasetu.care
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: a4c89cf0-15ef-4d37-8f55-1f95be67822a
Content-Type: application/json
```

**Request Body Shape (TypeScript):**
```ts
interface CreateInvitationRequestBody {
  patientId: string; // UUIDv4 of elderly patient
  assignedRole: 'PRIMARY_CAREGIVER' | 'SECONDARY_CAREGIVER' | 'NURSE_ATTENDANT' | 'DOCTOR';
  inviteeName: string;
  inviteePhone?: string; // E.164 formatted (+919876543210)
  inviteeEmail?: string;
  relationshipDescription: string; // e.g. "Day Shift Attendant - Nightingales Care"
  permissions: {
    canLogMedication: boolean;
    canLogVitals: boolean;
    canViewTimeline: boolean;
    canManageSchedules: boolean;
    canViewMedicalDocuments: boolean;
  };
  expiresInHours?: number; // Default 48, Max 168 (7 days)
  deliveryMethod: 'SMS' | 'WHATSAPP' | 'MANUAL_SHARE';
}
```

**Response Shape (TypeScript):**
```ts
interface CreateInvitationResponseBody {
  success: true;
  data: {
    invitationId: string; // UUIDv4
    patientId: string;
    patientName: string;
    passcode: string; // Formatted display e.g. "JS-849204"
    qrCodeDataUri: string; // Base64 PNG QR code
    deepLinkUrl: string; // https://app.jeevasetu.care/invite/claim?token=...
    assignedRole: string;
    deliveryStatus: 'SENT' | 'PENDING' | 'MANUAL_ONLY';
    expiresAt: string; // ISO 8601 UTC
    maxRedemptionAttempts: number; // 5
    createdAt: string;
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}
```

**Concrete JSON Response (HTTP 201 Created):**
```json
{
  "success": true,
  "data": {
    "invitationId": "c928e44b-5be7-48b8-b80c-78d1033230b4",
    "patientId": "e30e7ef0-3be2-4464-9b24-9b0d6368d4d1",
    "patientName": "Ramesh Chandra Sharma",
    "passcode": "JS-849204",
    "qrCodeDataUri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6e...",
    "deepLinkUrl": "https://app.jeevasetu.care/invite/claim?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "assignedRole": "NURSE_ATTENDANT",
    "deliveryStatus": "SENT",
    "expiresAt": "2026-11-17T10:30:00.000Z",
    "maxRedemptionAttempts": 5,
    "createdAt": "2026-11-15T10:30:00.000Z"
  },
  "meta": {
    "timestamp": "2026-11-15T10:30:00.125Z",
    "requestId": "req_01HC1XF9X8GZQMN3C5F3K7M2AB"
  }
}
```

**Error Codes:**
- `400 INVALID_REQUEST_PAYLOAD`: Validation error on phone number or invalid permission combination.
- `403 FORBIDDEN_INSUFFICIENT_ROLE`: User is not a verified `FAMILY_ADMIN` of the specified patient.
- `404 RESOURCE_NOT_FOUND`: `patientId` does not exist or has been soft-deleted.
- `409 IDEMPOTENCY_CONFLICT`: Concurrent invitation generation in flight with matching key.

---

##### KEY ENDPOINT: Redeem Passcode Invitation
- **Route**: `POST /api/invitations/redeem`
- **File**: `app/api/invitations/redeem/route.ts`
- **Description**: Validates the 6-digit passcode or redemption token. Upon successful matching and validation against expiration and maximum failed attempts, creates the `CaregiverAssignment` relational record and generates/updates the caller's session context with access to the elderly patient.
- **Auth Required**: Optional (If user already has an account, Bearer token binds their identity; if anonymous, payload accepts registration data to provision the account simultaneously).
- **Authorized Roles**: Public / Authenticated Caller
- **Idempotency**: Header Optional (`Idempotency-Key`).
- **Rate Limit**: **5 requests / 15 minutes** per IP address.

**Request Body Shape (TypeScript):**
```ts
interface RedeemInvitationRequestBody {
  passcode: string; // Regex: /^(JS-)?[A-Z0-9]{6}$/i
  token?: string; // Optional JWT token if redeemed via deep link / QR scan
  userContext?: {
    fullName: string;
    phoneNumber: string; // E.164 format
    deviceToken?: string; // FCM registration token for mobile alerts
  };
}
```

**Response Shape (TypeScript):**
```ts
interface RedeemInvitationResponseBody {
  success: true;
  data: {
    membershipId: string;
    patient: {
      id: string;
      fullName: string;
      dateOfBirth: string;
      preferredLanguage: string;
      primaryEmergencyContact: {
        name: string;
        phone: string;
        relationship: string;
      };
    };
    grantedRole: 'PRIMARY_CAREGIVER' | 'SECONDARY_CAREGIVER' | 'NURSE_ATTENDANT' | 'DOCTOR';
    permissions: Record<string, boolean>;
    session: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}
```

**Error Codes:**
- `400 INVALID_PASSCODE_FORMAT`: Passcode contains illegal characters or incorrect length.
- `404 RESOURCE_NOT_FOUND`: Passcode does not match any known active invitation.
- `409 PASSCODE_ALREADY_REDEEMED`: The invitation was previously claimed and revoked for single-use.
- `410 PASSCODE_EXPIRED`: Invitation exceeded its validity window.
- `423 PASSCODE_LOCKED_ATTEMPTS_EXCEEDED`: Exceeded 5 failed attempts; invitation is revoked for security.
- `429 RATE_LIMIT_EXCEEDED`: IP blocked due to brute-force throttling.

---

##### Additional Endpoints in Auth/Invitations Domain

###### `GET /api/invitations`
- **Description**: Lists pending, redeemed, and expired invitations for a specific patient.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Query Params**: `patientId` (UUID, required), `status` (`PENDING | REDEEMED | EXPIRED | REVOKED`).
- **Response**: `ApiSuccessEnvelope<InvitationListItem[]>`.

###### `DELETE /api/invitations/[id]`
- **Description**: Revokes an outstanding invitation.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Response**: `ApiSuccessEnvelope<{ revoked: true; invitationId: string }>`

###### `GET /api/auth/me`
- **Description**: Fetches current user profile, device associations, and patient delegations.
- **Auth**: All authenticated roles.
- **Response**: `ApiSuccessEnvelope<CurrentUserProfile>`

---

#### 7.3.2 Domain 2: Patients

##### KEY ENDPOINT: Adherence Summary
- **Route**: `GET /api/patients/[id]/adherence`
- **File**: `app/api/patients/[id]/adherence/route.ts`
- **Description**: Computes clinical medication adherence metrics over a selectable timeframe (7 days, 30 days, 90 days, or custom window). Aggregates total scheduled doses, doses taken on time (within ±60 minutes of schedule), doses taken late, doses skipped, and doses unrecorded (missed). Calculates current adherence percentage, consecutive day streak, and broken-down scores per medication.
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Authorized Roles**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `SECONDARY_CAREGIVER`, `NURSE_ATTENDANT`, `DOCTOR`, `SUPER_ADMIN`
- **Idempotency**: None (Safe idempotent `GET` query)

**Query Parameters:**
- `startDate` (ISO 8601 string, e.g. `2026-10-15T00:00:00Z` - optional, defaults to 30 days prior).
- `endDate` (ISO 8601 string, e.g. `2026-11-15T00:00:00Z` - optional, defaults to UTC now).
- `medicationId` (UUID string, optional - filter by specific drug).

**Request URL Example:**
```http
GET /api/patients/e30e7ef0-3be2-4464-9b24-9b0d6368d4d1/adherence?startDate=2026-10-16T00:00:00Z&endDate=2026-11-15T23:59:59Z HTTP/1.1
Host: api.jeevasetu.care
Authorization: Bearer eyJhbGciOi...
```

**Response Shape (TypeScript):**
```ts
interface MedicationAdherenceBreakdown {
  medicationId: string;
  medicationName: string;
  strength: string;
  dosageForm: string;
  scheduledDoseCount: number;
  takenOnTimeCount: number;
  takenLateCount: number;
  skippedCount: number;
  missedCount: number;
  adherencePercentage: number; // e.g. 94.5
}

interface PatientAdherenceSummaryResponseBody {
  success: true;
  data: {
    patientId: string;
    period: {
      startDate: string;
      endDate: string;
      totalDays: number;
    };
    overallScore: {
      adherencePercentage: number; // (takenOnTime + takenLate) / scheduledTotal * 100
      onTimePercentage: number; // takenOnTime / scheduledTotal * 100
      grade: 'EXCELLENT' | 'GOOD' | 'NEEDS_ATTENTION' | 'CRITICAL';
      currentStreakDays: number; // Consecutive days with 100% adherence
      longestStreakDays: number;
    };
    aggregates: {
      totalScheduledDoses: number;
      totalTakenOnTime: number;
      totalTakenLate: number;
      totalSkipped: number;
      totalMissed: number;
    };
    medicationBreakdown: MedicationAdherenceBreakdown[];
    trendsByWeek: Array<{
      weekStartDate: string;
      scheduledCount: number;
      takenCount: number;
      adherencePercentage: number;
    }>;
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}
```

**Concrete JSON Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "patientId": "e30e7ef0-3be2-4464-9b24-9b0d6368d4d1",
    "period": {
      "startDate": "2026-10-16T00:00:00Z",
      "endDate": "2026-11-15T23:59:59Z",
      "totalDays": 31
    },
    "overallScore": {
      "adherencePercentage": 93.55,
      "onTimePercentage": 87.10,
      "grade": "EXCELLENT",
      "currentStreakDays": 14,
      "longestStreakDays": 19
    },
    "aggregates": {
      "totalScheduledDoses": 124,
      "totalTakenOnTime": 108,
      "totalTakenLate": 8,
      "totalSkipped": 4,
      "totalMissed": 4
    },
    "medicationBreakdown": [
      {
        "medicationId": "f7d54b8a-3625-45a7-96a1-a0f5ea5bc531",
        "medicationName": "Telmisartan",
        "strength": "40mg",
        "dosageForm": "TABLET",
        "scheduledDoseCount": 31,
        "takenOnTimeCount": 29,
        "takenLateCount": 2,
        "skippedCount": 0,
        "missedCount": 0,
        "adherencePercentage": 100.00
      },
      {
        "medicationId": "b1b61c28-d3c2-4dc2-b342-995c25603b87",
        "medicationName": "Metformin Extended Release",
        "strength": "500mg",
        "dosageForm": "TABLET",
        "scheduledDoseCount": 62,
        "takenOnTimeCount": 54,
        "takenLateCount": 4,
        "skippedCount": 2,
        "missedCount": 2,
        "adherencePercentage": 93.55
      }
    ],
    "trendsByWeek": [
      {
        "weekStartDate": "2026-10-16",
        "scheduledCount": 28,
        "takenCount": 26,
        "adherencePercentage": 92.85
      },
      {
        "weekStartDate": "2026-10-23",
        "scheduledCount": 28,
        "takenCount": 27,
        "adherencePercentage": 96.42
      }
    ]
  },
  "meta": {
    "timestamp": "2026-11-15T10:31:12.441Z",
    "requestId": "req_01HC1XFA38MZQK3C6V5B2C1X4A"
  }
}
```

**Error Codes:**
- `400 INVALID_REQUEST_PAYLOAD`: Invalid date bounds (e.g. `startDate` > `endDate` or date exceeds 365 days).
- `403 FORBIDDEN_INSUFFICIENT_ROLE`: Caller is not assigned to this patient.
- `404 RESOURCE_NOT_FOUND`: Patient ID does not exist.

---

##### Additional Endpoints in Patients Domain

###### `GET /api/patients`
- **Description**: Returns all elder profiles that the authenticated user is authorized to manage or view.
- **Auth**: All roles.
- **Response**: `ApiSuccessEnvelope<PatientSummary[]>`

###### `POST /api/patients`
- **Description**: Provisions an elderly patient record with medical history, baseline vitals, and primary contacts.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body Shape**:
  ```ts
  interface CreatePatientRequestBody {
    fullName: string;
    dateOfBirth: string; // YYYY-MM-DD
    gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';
    bloodGroup?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
    allergies: string[];
    chronicConditions: string[]; // e.g. ["Hypertension", "Type 2 Diabetes"]
    primaryAddress: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      landmark?: string;
    };
    emergencyContacts: Array<{
      name: string;
      relationship: string;
      phone: string;
      isPrimary: boolean;
    }>;
    dnrOrderOnFile: boolean;
  }
  ```

###### `GET /api/patients/[id]`
- **Description**: Fetches detailed clinical profile and assigned care team.
- **Auth**: All assigned roles.
- **Response**: `ApiSuccessEnvelope<PatientDetailedProfile>`

###### `PATCH /api/patients/[id]`
- **Description**: Mutates demographic, emergency contact, or baseline care configurations.
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`
- **Response**: `ApiSuccessEnvelope<PatientDetailedProfile>`

###### `GET /api/patients/[id]/vitals`
- **Description**: Historical vitals query (blood pressure, heart rate, blood glucose, SpO2, body temperature).
- **Query Params**: `type` (`BLOOD_PRESSURE | GLUCOSE | SPO2 | HEART_RATE | TEMPERATURE`), `startDate`, `endDate`, `limit`.
- **Response**: `ApiSuccessEnvelope<VitalLogEntry[]>`

###### `POST /api/patients/[id]/vitals`
- **Description**: Ingests point-in-time vital readings with contextual meal/activity tags.
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `NURSE_ATTENDANT`, `PATIENT`
- **Request Body Shape**:
  ```ts
  interface RecordVitalRequestBody {
    measuredAt: string; // ISO 8601
    bloodPressure?: {
      systolic: number; // mmHg (e.g. 120)
      diastolic: number; // mmHg (e.g. 80)
      pulse?: number; // bpm
    };
    bloodGlucose?: {
      value: number; // mg/dL
      mealContext: 'FASTING' | 'BEFORE_MEAL' | 'POST_PRANDIAL' | 'BEDTIME' | 'RANDOM';
    };
    oxygenSaturation?: {
      spo2Percentage: number; // % e.g. 98
      onSupplementalOxygen: boolean;
    };
    bodyTemperature?: {
      value: number; // Celsius or Fahrenheit
      unit: 'CELSIUS' | 'FAHRENHEIT';
    };
    notes?: string;
  }
  ```

---

#### 7.3.3 Domain 3: Medications

##### Endpoints in Medications Domain

###### `GET /api/patients/[id]/medications`
- **Description**: Lists all active, paused, and historical medications prescribed to the patient.
- **Auth**: All assigned roles.
- **Query Params**: `status` (`ACTIVE | PAUSED | DISCONTINUED | ALL`), `limit`, `cursor`.
- **Response**: `ApiSuccessEnvelope<MedicationWithSchedule[]>`

###### `POST /api/patients/[id]/medications`
- **Description**: Registers a new drug to the patient's care regimen, with inventory threshold alerting.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body Shape (TypeScript):**
```ts
interface CreateMedicationRequestBody {
  name: string; // e.g. "Amlodipine Besylate"
  genericName?: string;
  rxNumber?: string;
  dosageForm: 'TABLET' | 'CAPSULE' | 'SYRUP_LIQUID' | 'INJECTION' | 'INHALER' | 'TOPICAL' | 'DROPS';
  strength: string; // e.g. "5mg"
  prescribingDoctor?: {
    name: string;
    clinicOrHospital?: string;
    contactNumber?: string;
  };
  instructions: string; // e.g. "Take once daily in morning with water"
  cautionNotes?: string[]; // e.g. ["May cause lightheadedness on standing"]
  currentInventoryCount: number; // e.g. 60 pills
  refillAlertThreshold: number; // Alert when stock <= 10 pills
  isCritical: boolean; // Flag if missing dose requires high-priority escalate
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}
```

###### `GET /api/medications/[id]`
- **Description**: Fetches single medication dossier including remaining pill count and pharmacy refill details.
- **Auth**: All assigned roles.
- **Response**: `ApiSuccessEnvelope<MedicationDetail>`

###### `PATCH /api/medications/[id]`
- **Description**: Updates prescribing attributes, instructions, or inventory counts.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Response**: `ApiSuccessEnvelope<MedicationDetail>`

###### `DELETE /api/medications/[id]`
- **Description**: Safely discontinues a medication, deactivating future recurring reminders.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Response**: `ApiSuccessEnvelope<{ discontinued: true; medicationId: string }>`

###### `POST /api/medications/[id]/refill`
- **Description**: Records a newly purchased supply batch and increments active inventory.
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body Shape (TypeScript):**
```ts
interface RefillMedicationRequestBody {
  unitsAdded: number; // e.g. 30
  refillDate: string; // ISO 8601
  pharmacyName?: string;
  cost?: {
    amount: number;
    currency: 'INR' | 'USD';
  };
  notes?: string;
}
```

---

#### 7.3.4 Domain 4: Medication Schedules

##### Endpoints in Medication Schedules Domain

###### `GET /api/medications/[id]/schedules`
- **Description**: Returns all scheduled dosage times for a given medication.
- **Auth**: All assigned roles.
- **Response**: `ApiSuccessEnvelope<ScheduleRule[]>`

###### `POST /api/medications/[id]/schedules`
- **Description**: Establishes recurring daily or weekly intake timings.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body Shape (TypeScript):**
```ts
interface CreateMedicationScheduleRequestBody {
  medicationId: string;
  dosageQuantity: number; // e.g. 1.0 (one tablet), 5.0 (5ml syrup)
  timeOfDay: string; // HH:mm format e.g. "08:30" (in patient's local timezone)
  mealTiming: 'BEFORE_MEAL' | 'AFTER_MEAL' | 'WITH_FOOD' | 'EMPTY_STOMACH' | 'NO_RESTRICTION';
  daysOfWeek: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>; // Empty = Daily
  reminderLeadTimeMinutes: number; // e.g. 15 minutes before
  voicePromptText?: string; // Text to synthesize for IVR or smart speaker
  isActive: boolean;
}
```

###### `PATCH /api/schedules/[id]`
- **Description**: Modifies the schedule time or meal association.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Response**: `ApiSuccessEnvelope<ScheduleRule>`

###### `DELETE /api/schedules/[id]`
- **Description**: Removes or disables a scheduled recurrence slot.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Response**: `ApiSuccessEnvelope<{ deleted: true; scheduleId: string }>`

###### `GET /api/patients/[id]/schedules/today`
- **Description**: Computes the daily checklist of all medication doses due for the senior on the current calendar day, cross-referenced with already recorded medication events.
- **Auth**: All assigned roles.
- **Response Shape (TypeScript):**
```ts
interface TodayMedicationDoseItem {
  scheduleId: string;
  medicationId: string;
  medicationName: string;
  dosageForm: string;
  strength: string;
  doseQuantity: number;
  scheduledTime: string; // "08:00"
  mealTiming: string;
  status: 'PENDING' | 'TAKEN' | 'SKIPPED' | 'SNOOZED' | 'MISSED';
  event?: {
    eventId: string;
    recordedAt: string;
    recordedByName: string;
  };
}
```

---

#### 7.3.5 Domain 5: Medication Events

##### KEY ENDPOINT: Log Medication Event
- **Route**: `POST /api/medications/[id]/events`
- **File**: `app/api/medications/[id]/events/route.ts`
- **Description**: Records that a scheduled or PRN (as-needed) medication dose was taken, skipped, snoozed, or missed. Automatically updates remaining medication inventory when marked as `TAKEN`. Deduplicates repeated clicks through atomic database transactions and strict `Idempotency-Key` checking. Automatically appends an entry to the unified Patient Care Timeline.
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Authorized Roles**: `PATIENT`, `PRIMARY_CAREGIVER`, `SECONDARY_CAREGIVER`, `NURSE_ATTENDANT`, `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Idempotency**: **Header Required** (`Idempotency-Key: <UUIDv4>`). Clinical safety imperative to prevent accidental double-dosing in records.

**Headers:**
```http
POST /api/medications/f7d54b8a-3625-45a7-96a1-a0f5ea5bc531/events HTTP/1.1
Host: api.jeevasetu.care
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: b7f81850-2490-41e9-91a5-3d5f0e13284f
Content-Type: application/json
```

**Request Body Shape (TypeScript):**
```ts
interface LogMedicationEventRequestBody {
  patientId: string; // UUIDv4
  scheduleId?: string; // Optional if PRN / unscheduled intake
  scheduledTime?: string; // ISO 8601 (The theoretical time slot due, e.g. "2026-11-15T08:00:00Z")
  action: 'TAKEN' | 'SKIPPED' | 'SNOOZED' | 'MISSED';
  recordedAt: string; // ISO 8601 (Actual timestamp of intake/action)
  quantityTaken?: number; // Defaults to schedule dose quantity (e.g. 1)
  reasonForSkipOrMiss?: 'SIDE_EFFECTS' | 'PATIENT_REFUSED' | 'OUT_OF_STOCK' | 'FASTING_TEST' | 'DOCTOR_ADVISED' | 'OTHER';
  snoozeDurationMinutes?: number; // Only valid if action === 'SNOOZED' (e.g. 15, 30, 60)
  caregiverNotes?: string; // Free-text notes (e.g. "Taken with warm milk")
  photoProofUrl?: string; // Cloud Storage URI for pill-in-hand verification
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
  };
}
```

**Response Shape (TypeScript):**
```ts
interface LogMedicationEventResponseBody {
  success: true;
  data: {
    eventId: string; // UUIDv4
    medicationId: string;
    patientId: string;
    action: 'TAKEN' | 'SKIPPED' | 'SNOOZED' | 'MISSED';
    scheduledTime: string | null;
    recordedAt: string;
    recordedBy: {
      userId: string;
      fullName: string;
      role: string;
    };
    timingStatus: 'ON_TIME' | 'LATE' | 'EARLY' | 'UNSCHEDULED';
    remainingInventoryCount: number | null;
    lowInventoryAlertTriggered: boolean;
    timelineEventId: string;
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}
```

**Concrete JSON Response (HTTP 201 Created):**
```json
{
  "success": true,
  "data": {
    "eventId": "3c77d91e-3663-4ce4-82a9-7b3bc3ff6bb3",
    "medicationId": "f7d54b8a-3625-45a7-96a1-a0f5ea5bc531",
    "patientId": "e30e7ef0-3be2-4464-9b24-9b0d6368d4d1",
    "action": "TAKEN",
    "scheduledTime": "2026-11-15T08:00:00.000Z",
    "recordedAt": "2026-11-15T08:14:22.000Z",
    "recordedBy": {
      "userId": "93821034-7a1a-4d29-a3b0-68a8dc415812",
      "fullName": "Sunita Devi",
      "role": "NURSE_ATTENDANT"
    },
    "timingStatus": "ON_TIME",
    "remainingInventoryCount": 42,
    "lowInventoryAlertTriggered": false,
    "timelineEventId": "tl_01HC1XF9X8GZQMN3C5F3K7M299"
  },
  "meta": {
    "timestamp": "2026-11-15T08:14:22.450Z",
    "requestId": "req_01HC1XFA00ABC999ZX4M5P2D"
  }
}
```

**Error Codes:**
- `400 INVALID_REQUEST_PAYLOAD`: Missing required fields (e.g. `action === 'SKIPPED'` without `reasonForSkipOrMiss`).
- `403 FORBIDDEN_INSUFFICIENT_ROLE`: User not assigned to patient.
- `404 RESOURCE_NOT_FOUND`: `medicationId` or `scheduleId` does not exist.
- `409 IDEMPOTENCY_CONFLICT`: Another event for this dose slot is currently processing or key collision.
- `422 CLINICAL_VALIDATION_ERROR`: Attempting to record `TAKEN` on an already completed dose slot without an override reason.

---

##### Additional Endpoints in Medication Events Domain

###### `GET /api/medications/[id]/events`
- **Description**: Queries historical intake logs for a specific medication.
- **Auth**: All assigned roles.
- **Query Params**: `startDate`, `endDate`, `limit`, `cursor`.
- **Response**: `ApiSuccessEnvelope<MedicationEventItem[]>`

###### `GET /api/patients/[id]/medication-events`
- **Description**: Returns all medication activity across all prescribed drugs for a patient.
- **Auth**: All assigned roles.
- **Response**: `ApiSuccessEnvelope<MedicationEventItem[]>`

###### `PATCH /api/medication-events/[id]`
- **Description**: Corrects a mistaken entry (e.g. marked skipped by mistake). Requires clinical audit memo.
- **Auth**: `FAMILY_ADMIN`, `DOCTOR`
- **Request Body**:
  ```ts
  interface AmendMedicationEventRequestBody {
    correctedAction: 'TAKEN' | 'SKIPPED';
    amendmentReason: string; // e.g. "Senior took pill 10 mins later, nurse misclicked"
  }
  ```

---

#### 7.3.6 Domain 6: Appointments

##### Endpoints in Appointments Domain

###### `GET /api/patients/[id]/appointments`
- **Description**: Retrieves clinical doctor consultations, physiotherapy sessions, and diagnostic test bookings.
- **Auth**: All assigned roles.
- **Query Params**: `filter` (`UPCOMING | PAST | ALL`), `limit`, `cursor`.
- **Response**: `ApiSuccessEnvelope<AppointmentListItem[]>`

###### `POST /api/patients/[id]/appointments`
- **Description**: Creates a new scheduled doctor visit or clinic check-up.
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `DOCTOR`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body Shape (TypeScript):**
```ts
interface CreateAppointmentRequestBody {
  patientId: string;
  title: string; // e.g. "Quarterly Cardiology Checkup"
  doctorName: string;
  specialty?: string; // e.g. "Cardiologist"
  clinicOrHospitalName: string;
  appointmentDateTime: string; // ISO 8601
  durationMinutes: number; // e.g. 45
  locationType: 'IN_PERSON' | 'TELECONSULTATION' | 'HOME_VISIT';
  addressOrMeetingLink: string;
  transportationRequired: boolean;
  notes?: string;
  reminderAlertHoursBefore: number[]; // e.g. [24, 2]
}
```

###### `GET /api/appointments/[id]`
- **Description**: Details of specific appointment including clinic address, documents, and contacts.
- **Auth**: All assigned roles.
- **Response**: `ApiSuccessEnvelope<AppointmentDetailed>`

###### `PATCH /api/appointments/[id]`
- **Description**: Reschedules appointment or updates clinic notes.
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `DOCTOR`
- **Response**: `ApiSuccessEnvelope<AppointmentDetailed>`

###### `POST /api/appointments/[id]/status`
- **Description**: Transitions status (`CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `DOCTOR`
- **Request Body**: `{ status: 'COMPLETED' | 'CANCELLED'; cancelReason?: string }`

###### `POST /api/appointments/[id]/notes`
- **Description**: Attaches discharge summary, doctor prescription scan, or follow-up orders.
- **Auth**: `DOCTOR`, `FAMILY_ADMIN`, `NURSE_ATTENDANT`
- **Request Body**:
  ```ts
  interface AppointmentNotesRequestBody {
    doctorSummary: string;
    prescriptionsIssued?: string[];
    followUpRequiredInDays?: number;
    documentAttachmentUrls?: string[];
  }
  ```

---

#### 7.3.7 Domain 7: Care Timeline

##### KEY ENDPOINT: Paginated Care Timeline
- **Route**: `GET /api/patients/[id]/timeline`
- **File**: `app/api/patients/[id]/timeline/route.ts`
- **Description**: Returns a unified, chronological, cursor-paginated activity feed of all caregiving events occurring for the elderly patient. Aggregates medication intakes, vital measurements, care notes, incident reports (falls, confusion), appointment updates, and caregiver shift changes into a single normalized stream.
- **Auth Required**: Yes (`Bearer <JWT>`)
- **Authorized Roles**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`, `SECONDARY_CAREGIVER`, `NURSE_ATTENDANT`, `DOCTOR`, `SUPER_ADMIN`
- **Idempotency**: None (Safe idempotent `GET` query)

**Query Parameters:**
- `cursor` (Opaque base64 string containing timestamp and UUID for stable cursor pagination).
- `limit` (Integer, default `20`, max `50`).
- `categories` (Comma-separated enum: `MEDICATION,VITALS,INCIDENT,NOTE,APPOINTMENT,SHIFT`).
- `startDate` (ISO 8601 string, optional).
- `endDate` (ISO 8601 string, optional).
- `severity` (`ALL | NORMAL | ALERT | CRITICAL` - filter by urgency).

**Request URL Example:**
```http
GET /api/patients/e30e7ef0-3be2-4464-9b24-9b0d6368d4d1/timeline?limit=20&categories=MEDICATION,VITALS,INCIDENT HTTP/1.1
Host: api.jeevasetu.care
Authorization: Bearer eyJhbGciOi...
```

**Response Shape (TypeScript):**
```ts
type TimelineCategory = 'MEDICATION' | 'VITALS' | 'INCIDENT' | 'NOTE' | 'APPOINTMENT' | 'SHIFT';
type SeverityLevel = 'INFO' | 'NORMAL' | 'WARNING' | 'CRITICAL';

interface TimelineEventItem {
  id: string; // Unique timeline entry ID
  patientId: string;
  category: TimelineCategory;
  severity: SeverityLevel;
  timestamp: string; // ISO 8601
  title: string; // e.g. "Blood Pressure Alert", "Morning Medication Taken"
  summary: string;
  actor: {
    userId: string | null;
    fullName: string;
    role: string;
    avatarUrl?: string;
  };
  payload: {
    medicationEvent?: {
      medicationName: string;
      dose: string;
      action: 'TAKEN' | 'SKIPPED' | 'MISSED';
    };
    vitalReading?: {
      type: string;
      valueDisplay: string;
      isOutOfRange: boolean;
    };
    incidentReport?: {
      type: 'FALL' | 'DIZZINESS' | 'DISORIENTATION' | 'PAIN' | 'OTHER';
      emergencyServicesContacted: boolean;
    };
    attachmentUrls?: string[];
  };
}

interface TimelineResponseBody {
  success: true;
  data: TimelineEventItem[];
  meta: {
    pagination: {
      total: number;
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    timestamp: string;
    requestId: string;
  };
}
```

**Concrete JSON Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "tl_01HC1XF9X8GZQMN3C5F3K7M299",
      "patientId": "e30e7ef0-3be2-4464-9b24-9b0d6368d4d1",
      "category": "MEDICATION",
      "severity": "NORMAL",
      "timestamp": "2026-11-15T08:14:22.000Z",
      "title": "Telmisartan 40mg Taken",
      "summary": "Morning dose recorded on time by Sunita Devi.",
      "actor": {
        "userId": "93821034-7a1a-4d29-a3b0-68a8dc415812",
        "fullName": "Sunita Devi",
        "role": "NURSE_ATTENDANT"
      },
      "payload": {
        "medicationEvent": {
          "medicationName": "Telmisartan",
          "dose": "40mg (1 Tablet)",
          "action": "TAKEN"
        }
      }
    },
    {
      "id": "tl_01HC1XE874ABCKD992147ZMM12",
      "patientId": "e30e7ef0-3be2-4464-9b24-9b0d6368d4d1",
      "category": "VITALS",
      "severity": "WARNING",
      "timestamp": "2026-11-15T07:45:00.000Z",
      "title": "Elevated Blood Pressure",
      "summary": "148/92 mmHg recorded. Patient reported slight headache.",
      "actor": {
        "userId": "93821034-7a1a-4d29-a3b0-68a8dc415812",
        "fullName": "Sunita Devi",
        "role": "NURSE_ATTENDANT"
      },
      "payload": {
        "vitalReading": {
          "type": "BLOOD_PRESSURE",
          "valueDisplay": "148/92 mmHg",
          "isOutOfRange": true
        }
      }
    }
  ],
  "meta": {
    "pagination": {
      "total": 452,
      "limit": 20,
      "hasMore": true,
      "nextCursor": "ZXlKaGJHY2lPaUpTVXpVeUlpd2laWG..."
    },
    "timestamp": "2026-11-15T10:32:00.000Z",
    "requestId": "req_01HC1XFA88MNBB442211997788"
  }
}
```

**Error Codes:**
- `400 INVALID_REQUEST_PAYLOAD`: Malformed cursor or invalid category filters.
- `403 FORBIDDEN_INSUFFICIENT_ROLE`: Caller unauthorized for patient.
- `404 RESOURCE_NOT_FOUND`: Patient ID not found.

---

##### Additional Endpoints in Care Timeline Domain

###### `POST /api/patients/[id]/timeline/notes`
- **Description**: Publishes an observational care note or unexpected incident report to the patient's timeline.
- **Auth**: `CAREGIVERS`, `NURSE_ATTENDANT`, `DOCTOR`, `FAMILY_ADMIN`
- **Request Body Shape (TypeScript):**
```ts
interface CreateTimelineNoteRequestBody {
  patientId: string;
  category: 'NOTE' | 'INCIDENT';
  severity: 'INFO' | 'NORMAL' | 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  incidentType?: 'FALL' | 'DIZZINESS' | 'DISORIENTATION' | 'PAIN' | 'OTHER';
  vitalSignsAtTime?: {
    systolic?: number;
    diastolic?: number;
    pulse?: number;
    spo2?: number;
  };
  actionsTaken?: string; // e.g. "Helped to bed, provided electrolyte water"
  notifyDoctorImmediately: boolean;
  photoAttachments?: string[];
}
```

---

#### 7.3.8 Domain 8: Caregiver Assignments

##### Endpoints in Caregiver Assignments Domain

###### `GET /api/patients/[id]/caregivers`
- **Description**: Lists all active attendants, visiting nurses, and family members assigned to the elder.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Response**: `ApiSuccessEnvelope<CaregiverAssignmentItem[]>`

###### `POST /api/patients/[id]/caregivers`
- **Description**: Assigns an existing registered platform user directly to a patient.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body**:
  ```ts
  interface AssignCaregiverRequestBody {
    userId: string;
    role: 'PRIMARY_CAREGIVER' | 'SECONDARY_CAREGIVER' | 'NURSE_ATTENDANT';
    shiftDetails?: {
      daysOfWeek: string[];
      startTime: string; // HH:mm
      endTime: string; // HH:mm
    };
    permissions: Record<string, boolean>;
  }
  ```

###### `PATCH /api/patients/[id]/caregivers/[caregiverId]`
- **Description**: Modifies shift timings or granular permissions.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Response**: `ApiSuccessEnvelope<CaregiverAssignmentItem>`

###### `DELETE /api/patients/[id]/caregivers/[caregiverId]`
- **Description**: Immediately detaches a caregiver's access to the patient's records.
- **Auth**: `FAMILY_ADMIN`, `SUPER_ADMIN`
- **Response**: `ApiSuccessEnvelope<{ revoked: true; unassignedAt: string }>`

###### `POST /api/caregivers/shifts/clock-in`
- **Description**: Home nurse logs arrival at senior's home with GPS check.
- **Auth**: `NURSE_ATTENDANT`, `PRIMARY_CAREGIVER`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body**: `{ patientId: string; location: { latitude: number; longitude: number } }`

###### `POST /api/caregivers/shifts/clock-out`
- **Description**: Home nurse clocks out at end of shift with handover summary.
- **Auth**: `NURSE_ATTENDANT`, `PRIMARY_CAREGIVER`
- **Idempotency**: `Idempotency-Key` required.
- **Request Body**:
  ```ts
  interface ShiftClockOutRequestBody {
    patientId: string;
    handoverSummary: string;
    concernsToFlag: string[];
    patientStatusAtHandover: 'RESTING_COMFORTABLY' | 'AWAKE_ALERT' | 'DISTRESSED';
  }
  ```

---

#### 7.3.9 Domain 9: Reminders (Internal & Dispatch)

##### KEY ENDPOINT: Process Scheduled Reminders
- **Route**: `POST /api/reminders/process`
- **File**: `app/api/reminders/process/route.ts`
- **Description**: **Internal secured trigger executed every 1 minute by Google Cloud Scheduler**. Scans active medication schedules across all patients in their respective timezones, identifies upcoming doses due in the next 15 minutes that have not been taken or alerted, groups multi-drug schedules into combined reminders, and dispatches multi-channel alerts (Push notification, WhatsApp message via Twilio/Meta Business API, automated IVR voice call). Also detects overdue doses (> 60 minutes) and sends escalation alerts to Family Admins.
- **Auth Required**: Yes (`Authorization: Bearer <Google_OIDC_Token>`)
- **Authorized Roles**: `SYSTEM_CRON` (Verified Google Cloud Scheduler Service Account OIDC audience)
- **Idempotency**: **Header Required** (`Idempotency-Key: cron-reminders-<timestamp_bucket>`)
- **Execution Timeout**: 60 seconds (Route handler optimized with bulk fetching and asynchronous worker dispatch).

**Headers:**
```http
POST /api/reminders/process HTTP/1.1
Host: api.jeevasetu.care
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjRiOW... (Google OIDC Service Account Token)
Idempotency-Key: cron-reminders-2026-11-15T10:30:00Z
Content-Type: application/json
```

**Request Body Shape (TypeScript):**
```ts
interface ProcessRemindersRequestBody {
  windowStart: string; // ISO 8601 (e.g. "2026-11-15T10:30:00Z")
  windowEnd: string; // ISO 8601 (e.g. "2026-11-15T10:45:00Z")
  forceEvaluation?: boolean;
  batchSizeLimit?: number; // Default 500
}
```

**Response Shape (TypeScript):**
```ts
interface ProcessRemindersResponseBody {
  success: true;
  data: {
    executionId: string; // UUIDv4
    evaluatedPatientsCount: number;
    dispatches: {
      pushNotificationsSent: number;
      whatsAppMessagesSent: number;
      voiceCallsQueued: number;
      escalationsSent: number;
    };
    skippedCount: {
      alreadyTaken: number;
      recentlySnoozed: number;
      mutedByCaregiver: number;
    };
    failuresCount: number;
    executionDurationMs: number;
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}
```

**Concrete JSON Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "executionId": "8f8b8390-348e-4a67-96a8-f7eb4faad371",
    "evaluatedPatientsCount": 312,
    "dispatches": {
      "pushNotificationsSent": 184,
      "whatsAppMessagesSent": 76,
      "voiceCallsQueued": 12,
      "escalationsSent": 3
    },
    "skippedCount": {
      "alreadyTaken": 64,
      "recentlySnoozed": 9,
      "mutedByCaregiver": 0
    },
    "failuresCount": 0,
    "executionDurationMs": 1420
  },
  "meta": {
    "timestamp": "2026-11-15T10:30:01.420Z",
    "requestId": "req_01HC1XF9X8GZQMN3C5F3K7M999"
  }
}
```

**Security & Auth Implementation Detail for Next.js Route Handler:**
```ts
// Verification of Google Cloud Scheduler OIDC Token
import { OAuth2Client } from 'google-auth-library';
const client = new OAuth2Client();

async function verifyCloudSchedulerOIDC(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  
  const token = authHeader.substring(7);
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.CLOUD_SCHEDULER_AUDIENCE_URL! // e.g. "https://api.jeevasetu.care/api/reminders/process"
    });
    const payload = ticket.getPayload();
    return payload?.email === process.env.CLOUD_SCHEDULER_SERVICE_ACCOUNT_EMAIL;
  } catch (error) {
    return false;
  }
}
```

**Error Codes:**
- `401 OIDC_TOKEN_INVALID`: Missing or forged Google OIDC bearer token.
- `403 FORBIDDEN_INSUFFICIENT_ROLE`: Service account email does not match authorized cloud scheduler principal.
- `409 IDEMPOTENCY_CONFLICT`: Reminder run for this specific time window has already completed.
- `503 DEPENDENCY_UNAVAILABLE`: Upstream dispatch provider (Twilio / Firebase Cloud Messaging) unavailable.

---

##### Additional Endpoints in Reminders Domain

###### `GET /api/reminders/pending`
- **Description**: System debugging route to inspect queued reminder jobs.
- **Auth**: `SUPER_ADMIN`, `SYSTEM_CRON`
- **Response**: `ApiSuccessEnvelope<QueuedReminder[]>`

###### `POST /api/reminders/send-adhoc`
- **Description**: Family member triggers an instant alert ("Time for your tablets, Grandpa!") via SMS/app buzz.
- **Auth**: `FAMILY_ADMIN`, `PRIMARY_CAREGIVER`
- **Request Body**:
  ```ts
  interface SendAdhocReminderRequestBody {
    patientId: string;
    messageText: string;
    channel: 'PUSH' | 'WHATSAPP' | 'VOICE_CALL' | 'ALL';
  }
  ```

###### `POST /api/reminders/[id]/ack`
- **Description**: Senior or nurse marks that a received push/call notification was heard/seen.
- **Auth**: All assigned roles.
- **Response**: `ApiSuccessEnvelope<{ acknowledged: true; ackTime: string }>`

---

#### 7.3.10 Domain 10: System Health & Monitoring

##### Endpoints in System Health Domain

###### `GET /api/health`
- **Description**: Basic liveness probe. Fast 200 OK for Docker / Kubernetes / Cloud Run health-checks.
- **Auth**: None (Public)
- **Response Shape (HTTP 200 OK):**
```json
{
  "status": "UP",
  "service": "jeevasetu-api",
  "version": "1.4.0",
  "timestamp": "2026-11-15T10:33:00.000Z"
}
```

###### `GET /api/health/ready`
- **Description**: Deep readiness probe verifying database connectivity, Redis cluster ping, Twilio SMS balance, and Firebase Cloud Messaging gateway reachability.
- **Auth**: None (Public / Monitoring agent)
- **Response Shape (HTTP 200 OK / 503 Service Unavailable):**
```json
{
  "status": "READY",
  "dependencies": {
    "primaryDatabase": {
      "status": "HEALTHY",
      "latencyMs": 4
    },
    "redisCache": {
      "status": "HEALTHY",
      "latencyMs": 1
    },
    "fcmPushService": {
      "status": "HEALTHY"
    },
    "whatsappGateway": {
      "status": "HEALTHY"
    }
  },
  "timestamp": "2026-11-15T10:33:00.000Z"
}
```

###### `GET /api/health/metrics`
- **Description**: Operational telemetry exposing API response times, active WebSocket caregiver sessions, and adherence sync backlog.
- **Auth**: `SUPER_ADMIN`
- **Response**: `ApiSuccessEnvelope<SystemMetrics>`

---

### 7.4 Server-Side Validation Strategy (Zod Schemas)

All Next.js Route Handlers strictly parse input bodies, query parameters, and path slugs using **Zod** schemas before executing any domain logic.

#### 7.4.1 Shared Validation Helper
```ts
// lib/api/validator.ts
import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createErrorResponse } from './error-handler';

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>
): Promise<{ data: T } | { errorResponse: NextResponse }> {
  try {
    const raw = await request.json();
    const data = await schema.parseAsync(raw);
    return { data };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((err) => ({
        field: err.path.join('.'),
        code: err.code,
        message: err.message,
      }));
      return {
        errorResponse: createErrorResponse(
          'INVALID_REQUEST_PAYLOAD',
          'Request payload failed server-side clinical validation',
          400,
          details,
          request.nextUrl.pathname
        ),
      };
    }
    return {
      errorResponse: createErrorResponse(
        'INVALID_REQUEST_PAYLOAD',
        'Malformed JSON syntax in request body',
        400,
        undefined,
        request.nextUrl.pathname
      ),
    };
  }
}
```

#### 7.4.2 Core Zod Schema Definitions
```ts
// lib/validations/api-schemas.ts
import { z } from 'zod';

// ==========================================
// 1. INVITATIONS DOMAIN
// ==========================================
export const createInvitationSchema = z.object({
  patientId: z.string().uuid({ message: 'Valid Patient UUID is required' }),
  assignedRole: z.enum([
    'PRIMARY_CAREGIVER',
    'SECONDARY_CAREGIVER',
    'NURSE_ATTENDANT',
    'DOCTOR',
  ], { required_error: 'Assigned role must be specified' }),
  inviteeName: z.string().min(2).max(100),
  inviteePhone: z.string().regex(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone must be valid E.164 format (e.g. +919876543210)',
  }).optional(),
  inviteeEmail: z.string().email().optional(),
  relationshipDescription: z.string().min(2).max(120),
  permissions: z.object({
    canLogMedication: z.boolean().default(true),
    canLogVitals: z.boolean().default(true),
    canViewTimeline: z.boolean().default(true),
    canManageSchedules: z.boolean().default(false),
    canViewMedicalDocuments: z.boolean().default(false),
  }),
  expiresInHours: z.number().int().min(1).max(168).default(48),
  deliveryMethod: z.enum(['SMS', 'WHATSAPP', 'MANUAL_SHARE']).default('MANUAL_SHARE'),
});

export const redeemInvitationSchema = z.object({
  passcode: z
    .string()
    .trim()
    .transform((val) => val.toUpperCase().replace(/^JS-/, ''))
    .pipe(z.string().regex(/^[A-Z0-9]{6}$/, { message: 'Passcode must be 6 alphanumeric characters' })),
  token: z.string().optional(),
  userContext: z.object({
    fullName: z.string().min(2).max(100),
    phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/),
    deviceToken: z.string().optional(),
  }).optional(),
});

// ==========================================
// 2. MEDICATION EVENTS DOMAIN
// ==========================================
export const logMedicationEventSchema = z.object({
  patientId: z.string().uuid(),
  scheduleId: z.string().uuid().optional(),
  scheduledTime: z.string().datetime({ message: 'Must be ISO 8601 timestamp' }).optional(),
  action: z.enum(['TAKEN', 'SKIPPED', 'SNOOZED', 'MISSED']),
  recordedAt: z.string().datetime({ message: 'Recorded timestamp must be valid ISO 8601' }),
  quantityTaken: z.number().positive().max(10).optional().default(1),
  reasonForSkipOrMiss: z.enum([
    'SIDE_EFFECTS',
    'PATIENT_REFUSED',
    'OUT_OF_STOCK',
    'FASTING_TEST',
    'DOCTOR_ADVISED',
    'OTHER',
  ]).optional(),
  snoozeDurationMinutes: z.number().int().min(5).max(180).optional(),
  caregiverNotes: z.string().max(500).optional(),
  photoProofUrl: z.string().url().optional(),
  geolocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().positive().optional(),
  }).optional(),
}).refine((data) => {
  if ((data.action === 'SKIPPED' || data.action === 'MISSED') && !data.reasonForSkipOrMiss) {
    return false;
  }
  return true;
}, {
  message: 'reasonForSkipOrMiss is mandatory when marking a dose as SKIPPED or MISSED',
  path: ['reasonForSkipOrMiss'],
}).refine((data) => {
  if (data.action === 'SNOOZED' && !data.snoozeDurationMinutes) {
    return false;
  }
  return true;
}, {
  message: 'snoozeDurationMinutes is required when action is SNOOZED',
  path: ['snoozeDurationMinutes'],
});

// ==========================================
// 3. ADHERENCE & TIMELINE QUERIES
// ==========================================
export const adherenceQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  medicationId: z.string().uuid().optional(),
}).refine((data) => {
  if (data.startDate && data.endDate) {
    return new Date(data.startDate) <= new Date(data.endDate);
  }
  return true;
}, {
  message: 'startDate must be before or equal to endDate',
  path: ['startDate'],
});

export const careTimelineQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  categories: z.string().optional().transform((val) => val ? val.split(',') : undefined),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  severity: z.enum(['ALL', 'NORMAL', 'WARNING', 'CRITICAL']).default('ALL'),
});

// ==========================================
// 4. CLOUD SCHEDULER REMINDERS TRIGGER
// ==========================================
export const processRemindersSchema = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  forceEvaluation: z.boolean().default(false),
  batchSizeLimit: z.number().int().min(10).max(2000).default(500),
});
```

---

### 7.5 Consistent Error Envelope & Handler

To comply with enterprise healthcare security standards and ensure zero leakage of database internals or stack traces in production, all errors are mapped through a single utility.

#### 7.5.1 TypeScript Response Utility
```ts
// lib/api/error-handler.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export interface ApiErrorDetail {
  field?: string;
  code: string;
  message: string;
}

export function createErrorResponse(
  code: string,
  message: string,
  statusCode: number,
  details?: ApiErrorDetail[],
  path: string = ''
): NextResponse {
  const requestId = `req_${randomUUID().replace(/-/g, '').substring(0, 24)}`;
  
  // Structured log for Cloud Logging / Datadog
  console.error(JSON.stringify({
    severity: statusCode >= 500 ? 'ERROR' : 'WARN',
    requestId,
    code,
    message,
    statusCode,
    path,
    details,
    timestamp: new Date().toISOString(),
  }));

  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details: details && details.length > 0 ? details : undefined,
        requestId,
        timestamp: new Date().toISOString(),
        path,
      },
    },
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    }
  );
}
```

#### 7.5.2 Error Response Payload Examples

**Validation Failure (`400 Bad Request`):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST_PAYLOAD",
    "message": "Request payload failed server-side clinical validation",
    "details": [
      {
        "field": "reasonForSkipOrMiss",
        "code": "custom",
        "message": "reasonForSkipOrMiss is mandatory when marking a dose as SKIPPED or MISSED"
      }
    ],
    "requestId": "req_01HC1XF9X8GZQMN3C5F3K7M2AB",
    "timestamp": "2026-11-15T10:33:00.100Z",
    "path": "/api/medications/f7d54b8a-3625-45a7-96a1-a0f5ea5bc531/events"
  }
}
```

**Brute-Force Passcode Throttling (`429 Too Many Requests`):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many failed attempts. Passcode verification temporarily locked for 15 minutes.",
    "requestId": "req_01HC1XF9X8GZQMN3C5F3K7M299",
    "timestamp": "2026-11-15T10:33:05.215Z",
    "path": "/api/invitations/redeem"
  }
}
```

---

### 7.6 Distributed Rate Limiting Implementation

Rate limiting uses Upstash Redis sliding window counters to provide sub-millisecond edge inspection.

```ts
// lib/api/rate-limiter.ts
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from './error-handler';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

export async function checkRateLimit(
  request: NextRequest,
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; errorResponse?: NextResponse; remaining: number; reset: number }> {
  const now = Math.floor(Date.now() / 1000);
  const key = `ratelimit:${identifier}:${Math.floor(now / config.windowSeconds)}`;

  const currentCount = await redis.incr(key);
  if (currentCount === 1) {
    await redis.expire(key, config.windowSeconds);
  }

  const remaining = Math.max(0, config.limit - currentCount);
  const reset = (Math.floor(now / config.windowSeconds) + 1) * config.windowSeconds;

  if (currentCount > config.limit) {
    const errorResponse = createErrorResponse(
      'RATE_LIMIT_EXCEEDED',
      `Rate limit exceeded. Allowed: ${config.limit} requests per ${config.windowSeconds} seconds.`,
      429,
      undefined,
      request.nextUrl.pathname
    );
    
    errorResponse.headers.set('X-RateLimit-Limit', config.limit.toString());
    errorResponse.headers.set('X-RateLimit-Remaining', '0');
    errorResponse.headers.set('X-RateLimit-Reset', reset.toString());
    errorResponse.headers.set('Retry-After', (reset - now).toString());
    
    return { allowed: false, errorResponse, remaining: 0, reset };
  }

  return { allowed: true, remaining, reset };
}
```

---

### 7.7 Idempotency Middleware Execution Flow

```
+---------------------------------------------------------------------------------------------------+
|                                     IDEMPOTENCY EXECUTION FLOW                                    |
+---------------------------------------------------------------------------------------------------+
|  Client Request                                                                                   |
|  [POST /api/medications/:id/events]                                                               |
|  [Headers: Idempotency-Key: UUIDv4]                                                               |
|         |                                                                                         |
|         v                                                                                         |
|  Redis Check: Key exists?                                                                         |
|         |                                                                                         |
|         +----> YES (Status === 'COMPLETED')   ---> Replay Cached Response (No re-run)             |
|         |                                                                                         |
|         +----> YES (Status === 'PROCESSING')  ---> Return HTTP 409 Conflict ("In-flight")         |
|         |                                                                                         |
|         v NO                                                                                      |
|  SET Redis key with 'PROCESSING' (TTL: 60s)                                                       |
|         |                                                                                         |
|         v                                                                                         |
|  Execute Route Handler & DB Transaction (Prisma/Kysely)                                           |
|         |                                                                                         |
|         +----> Succeeded: OVERWRITE Key with Status 'COMPLETED' + Response JSON (TTL: 86400s)     |
|         |                                                                                         |
|         +----> Failed: DELETE Redis Key (Allow clean retry)                                       |
|         |                                                                                         |
|         v                                                                                         |
|  Return HTTP 201 Response                                                                         |
+---------------------------------------------------------------------------------------------------+
```

---

### 7.8 Summary of Endpoint Architectural Directives

1. **Strict Zero-Trust RBAC**: Every Route Handler verifies both tenant membership and role authorization for the target patient ID before database query execution.
2. **Clinical Double-Dose Protection**: Medication event logging requires an `Idempotency-Key` and performs a database conditional check to guarantee no two doses are marked taken for the same schedule slot within an 8-hour window without explicit medical override.
3. **Optimized Pagination**: High-frequency feeds (such as the Care Timeline) utilize opaque cursor keys (timestamp + UUID) instead of offset-based queries, guaranteeing linear $O(1)$ database execution index performance even when scrolling through thousands of entries.
4. **Resilient Notification Processing**: The internal reminder engine executes on an isolated OIDC-authenticated schedule, partitioning notifications into asynchronous queues to ensure runtime execution remains under 5 seconds even with thousands of concurrent elder reminders.


---\n
# 8. Medication Scheduling and Adherence Design

## 8.1 Medication Schedule Data Model

The JEEVASETU medication architecture manages pharmacotherapy schedules for vulnerable geriatric patients. The data model is engineered to be mathematically deterministic, clinically safe, auditable, and resilient to multi-actor concurrent modifications (e.g., family caregivers, visiting nurses, primary care physicians, and the elder patient).

The schema enforces strict separation between:
1. **Medication Catalog Reference (`Medication`)**: The master pharmaceutical entity (name, form, strength, contraindications, food requirements).
2. **Prescription Directive (`Prescription`)**: The clinical authority issued by an authorized prescriber (physician/geriatrician), including start/end dates, refills, and clinical indications.
3. **Operational Schedule (`MedicationSchedule`)**: The chronologically expanded execution plan specifying exact dosing windows, intake frequencies, titration rules, and status lifecycle.
4. **Adherence Event (`MedicationEvent`)**: The immutable historical log entry tracking every dose attempt, confirmation, skip, or miss.

### TypeScript Interfaces

```typescript
/**
 * Medication Administration Route
 */
export type AdministrationRoute = 
  | 'ORAL'
  | 'SUBLINGUAL'
  | 'TRANSDERMAL'
  | 'INHALATION'
  | 'INJECTION_SUBCUTANEOUS'
  | 'INJECTION_INTRAMUSCULAR'
  | 'OPHTHALMIC'
  | 'OTIC'
  | 'TOPICAL';

/**
 * Dosage Form Category
 */
export type DosageForm = 
  | 'TABLET'
  | 'CAPSULE'
  | 'LIQUID_ML'
  | 'DROPS'
  | 'PATCH'
  | 'INHALER_PUFF'
  | 'POWDER_SACHET'
  | 'CREAM_OINTMENT';

/**
 * Meal Correlation Timing Constraint
 */
export type FoodRelation = 
  | 'BEFORE_FOOD'       // 30-60 mins prior to meal
  | 'WITH_FOOD'         // During or immediately after meal (<15 min)
  | 'AFTER_FOOD'        // 30-60 mins after meal
  | 'EMPTY_STOMACH'     // >2 hours pre or post meal
  | 'INDEPENDENT';      // No dietary restriction

/**
 * Recurrence Cadence Specification
 */
export type FrequencyType =
  | 'DAILY'             // Every day at fixed DosingTime slots
  | 'EVERY_X_DAYS'      // Interval of N days (e.g., every 2 days)
  | 'DAYS_OF_WEEK'      // Specific weekdays (e.g., MON, WED, FRI)
  | 'MONTHLY_DATE'      // Specific day of month (e.g., 1st and 15th)
  | 'CYCLIC'            // Active days followed by off days (e.g., 21 on, 7 off)
  | 'PRN';              // Pro re nata / As-needed with maximum daily caps

/**
 * Verification & Operational Lifecycle Status of Schedule
 */
export type ScheduleStatus = 
  | 'DRAFT'             // Created by family/caregiver, awaiting verification
  | 'PENDING_REVIEW'    // Submitted, waiting for clinical/doctor approval
  | 'ACTIVE'            // Verified, currently producing dosing events
  | 'SUSPENDED'         // Temporarily paused (e.g., hospitalization, adverse reaction)
  | 'DISCONTINUED'      // Permanently stopped prior to planned completion
  | 'EXPIRED';          // Reached completion date without renewal

/**
 * Master Medication Reference Record
 */
export interface Medication {
  id: string;                          // Global UUID / FDA NDC code / RxNorm CUI
  brandName: string;                   // Commercial label (e.g., "Glucophage XR")
  genericName: string;                 // Active chemical entity (e.g., "Metformin Hydrochloride")
  strength: {
    value: number;                     // e.g., 500
    unit: 'MG' | 'MCG' | 'G' | 'ML' | 'IU' | 'PUFF';
  };
  dosageForm: DosageForm;
  route: AdministrationRoute;
  appearanceDescription?: {
    color: string;                     // e.g., "White"
    shape: string;                     // e.g., "Oval / Oblong"
    imprint?: string;                  // e.g., "M 500"
    imageUrl?: string;                 // High-res reference photo for elder recognition
  };
  blackBoxWarning?: string;            // Critical FDA / clinical safety warnings
  foodInteractions?: string[];         // e.g., ["Grapefruit juice", "Dairy"]
  defaultFoodRelation: FoodRelation;
  isHighRiskGeriatric: boolean;        // Beers Criteria flag (e.g., anticholinergic, sedative)
  createdAt: string;                   // ISO 8601 UTC
  updatedAt: string;                   // ISO 8601 UTC
}

/**
 * Clinical Prescription Directive
 */
export interface Prescription {
  id: string;                          // Unique prescription entity ID
  patientId: string;                   // JEEVASETU Elder Patient ID
  medicationId: string;                // Reference to Medication
  prescriber: {
    physicianId?: string;              // Physician user ID if on JEEVASETU platform
    name: string;                      // Dr. John Doe, MD
    registrationNumber: string;        // State Medical Council Registration No.
    contactPhone: string;
    clinicHospitalName: string;
  };
  diagnosisCode?: string;              // ICD-10 or clinical indication (e.g., "E11.9 - Type 2 Diabetes")
  prescribedQuantity: number;          // Total units dispensed/authorized
  refillsAuthorized: number;           // Remaining refills allowed
  issuedDate: string;                  // ISO 8601 YYYY-MM-DD
  validUntil: string;                  // Expiry date of the legal prescription
  documentScanUrl?: string;            // Verified scan/photo of handwritten Rx
  prescriberNotes?: string;            // Freeform clinical instructions
}

/**
 * Discrete Daily Dosing Slot Definition
 */
export interface DosingTime {
  slotId: string;                      // Unique ID within schedule (e.g., "SLOT_MORNING")
  name: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'BEDTIME' | 'CUSTOM';
  targetTimeLocal: string;             // HH:mm in patient's primary timezone (e.g., "08:00")
  doseQuantity: number;                // Number of units (e.g., 1.5 tablets, 5 ml)
  foodRelation: FoodRelation;          // Specific override if different from default
  gracePeriodMinutes: number;          // Window before/after target time (default: 60)
  instructionNotes?: string;           // e.g., "Drink full glass of water"
}

/**
 * Recurrence Configuration Pattern
 */
export interface RecurrenceRule {
  frequencyType: FrequencyType;
  intervalDays?: number;               // For EVERY_X_DAYS: e.g., 2 = every other day
  daysOfWeek?: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]; // 0=Sun, 1=Mon, ..., 6=Sat
  monthlyDayNumber?: number;           // For MONTHLY_DATE (1-31)
  cyclicPattern?: {
    activeDays: number;                // e.g., 21
    offDays: number;                   // e.g., 7
    cycleStartDate: string;            // Reference anchor date YYYY-MM-DD
  };
  prnConfig?: {
    minimumIntervalHours: number;      // e.g., 4 (must wait 4h between PRN doses)
    maxDosesPer24Hours: number;        // e.g., 3 doses maximum
    indication: string;                // e.g., "For acute breakthrough joint pain > 6/10"
  };
}

/**
 * The Master Medication Schedule Entity
 */
export interface MedicationSchedule {
  id: string;                          // Unique Schedule ID (UUIDv4)
  patientId: string;                   // JEEVASETU Elder ID
  medicationId: string;                // Linked Medication ID
  prescriptionId?: string;             // Linked Prescription ID
  status: ScheduleStatus;
  
  // Temporal Boundaries
  startDate: string;                   // YYYY-MM-DD (first eligible calendar day)
  endDate?: string;                    // YYYY-MM-DD (null for indefinite chronic regimens)
  timezone: string;                    // IANA Timezone string (e.g., "Asia/Kolkata", "America/New_York")
  
  // Execution Profile
  recurrence: RecurrenceRule;
  dosingTimes: DosingTime[];
  
  // Clinical Guardrail Flags
  requiresSupervision: boolean;        // If true, elder cannot self-confirm; requires caregiver/nurse
  requiresVitalsCheckPreDose?: {
    vitalType: 'BLOOD_PRESSURE' | 'HEART_RATE' | 'BLOOD_GLUCOSE';
    minThreshold?: number;
    maxThreshold?: number;
  };

  // Versioning and Verification Control
  version: number;                     // Monotonically increasing version integer
  activeChangeRequestId?: string;      // ID of pending MedicationChangeRecord, if under review
  createdBy: {
    userId: string;
    role: 'ELDER' | 'PRIMARY_CAREGIVER' | 'VISITING_NURSE' | 'DOCTOR' | 'SYSTEM_ADMIN';
    timestamp: string;
  };
  verifiedBy?: {
    userId: string;
    role: 'DOCTOR' | 'PRIMARY_CAREGIVER';
    licenseNumber?: string;
    timestamp: string;
    verificationMethod: 'OTP' | 'DIGITAL_SIGNATURE' | 'PORTAL_ACTION';
  };
  createdAt: string;                   // ISO 8601 UTC
  updatedAt: string;                   // ISO 8601 UTC
}
```

---

## 8.2 Schedule Expansion Algorithm

The Schedule Expansion Algorithm is the deterministic engine responsible for computing concrete daily dosing slots from high-level recurrence rules. 

### Core Deterministic Constraints
1. **Timezone Disambiguation**: Schedules are authored with reference to the elder patient's current physical timezone (e.g., `Asia/Kolkata` / UTC+05:30). Calculation of daily boundaries must occur in the patient's local wall-clock time, and subsequently projected into exact UTC timestamps. Daylight saving time (DST) shifts or clock adjustments never drop or duplicate doses.
2. **Mid-Day Schedule Alterations**: When an active schedule is edited mid-day (e.g., at 14:00 local time, afternoon dose changed from 500mg to 250mg):
   - Any slots prior to the modification timestamp that have already attained terminal state (`TAKEN`, `SKIPPED`, `MISSED`) remain completely unmodified.
   - Any pending `UNCONFIRMED` slots scheduled prior to the modification time are invalidated or evaluated against the previous version.
   - Future slots from 14:01 onwards are generated from the newly verified schedule version.
3. **PRN (As-Needed) Doses**: PRN medications do not produce static pre-scheduled slots in the daily plan. Instead, they produce a dynamic floating quota showing remaining available doses in the rolling 24-hour window and elapsed time since the previous administration.

### Mathematical Expansion Algorithm (Pseudocode)

```typescript
interface ExpandedDoseInstance {
  instanceKey: string;           // Deterministic: `${scheduleId}_${medicationId}_${date}_${timeSlot}`
  scheduleId: string;
  medicationId: string;
  scheduleVersion: number;
  patientId: string;
  scheduledTimeLocal: string;    // "2026-11-15T08:00:00"
  scheduledTimeUtc: string;      // "2026-11-15T02:30:00Z"
  targetTimeSlot: string;        // "08:00"
  graceWindow: {
    startUtc: string;            // scheduledTimeUtc - gracePeriodMinutes
    endUtc: string;              // scheduledTimeUtc + gracePeriodMinutes
  };
  doseQuantity: number;
  foodRelation: FoodRelation;
  requiresSupervision: boolean;
  status: 'UNCONFIRMED' | 'TAKEN' | 'SKIPPED' | 'MISSED';
}

export function expandDailySchedule(
  schedule: MedicationSchedule,
  targetDateLocal: string,      // "YYYY-MM-DD"
  patientTimezone: string,
  nowUtc: Date = new Date()
): ExpandedDoseInstance[] {
  // 1. Validate Schedule Lifecycle
  if (schedule.status !== 'ACTIVE') {
    return [];
  }

  // 2. Validate Boundary Dates
  if (targetDateLocal < schedule.startDate) {
    return [];
  }
  if (schedule.endDate && targetDateLocal > schedule.endDate) {
    return [];
  }

  // 3. Evaluate Recurrence Criteria
  const targetDayJs = parseLocalDate(targetDateLocal, patientTimezone);
  const dayOfWeek = targetDayJs.day(); // 0 = Sunday, 1 = Monday, ...
  const dayOfMonth = targetDayJs.date(); // 1 - 31

  let isScheduledDay = false;

  switch (schedule.recurrence.frequencyType) {
    case 'DAILY':
      isScheduledDay = true;
      break;

    case 'EVERY_X_DAYS': {
      const interval = schedule.recurrence.intervalDays || 1;
      const startDayJs = parseLocalDate(schedule.startDate, patientTimezone);
      const diffDays = targetDayJs.diff(startDayJs, 'day');
      isScheduledDay = diffDays >= 0 && diffDays % interval === 0;
      break;
    }

    case 'DAYS_OF_WEEK':
      isScheduledDay = (schedule.recurrence.daysOfWeek || []).includes(dayOfWeek as any);
      break;

    case 'MONTHLY_DATE':
      isScheduledDay = dayOfMonth === schedule.recurrence.monthlyDayNumber;
      break;

    case 'CYCLIC': {
      const { activeDays, offDays, cycleStartDate } = schedule.recurrence.cyclicPattern!;
      const cycleStartJs = parseLocalDate(cycleStartDate, patientTimezone);
      const cycleLength = activeDays + offDays;
      const daysSinceCycleStart = targetDayJs.diff(cycleStartJs, 'day');
      if (daysSinceCycleStart >= 0) {
        const offset = daysSinceCycleStart % cycleLength;
        isScheduledDay = offset < activeDays;
      }
      break;
    }

    case 'PRN':
      // PRN does not generate predetermined daily time slots
      return [];
  }

  if (!isScheduledDay) {
    return [];
  }

  // 4. Generate Slot Instances
  return schedule.dosingTimes.map((slot) => {
    // Construct local ISO string: "2026-11-15T08:00:00"
    const localDateTimeStr = `${targetDateLocal}T${slot.targetTimeLocal}:00`;
    const localDateTimeJs = parseLocalTimeToUtc(localDateTimeStr, patientTimezone);
    const utcIso = localDateTimeJs.toISOString();

    const graceMins = slot.gracePeriodMinutes ?? 60;
    const graceStartUtc = new Date(localDateTimeJs.valueOf() - graceMins * 60000).toISOString();
    const graceEndUtc = new Date(localDateTimeJs.valueOf() + graceMins * 60000).toISOString();

    // Deterministic unique instance key: scheduleId_medId_date_time
    const instanceKey = `${schedule.id}_${schedule.medicationId}_${targetDateLocal}_${slot.targetTimeLocal.replace(':', '')}`;

    return {
      instanceKey,
      scheduleId: schedule.id,
      medicationId: schedule.medicationId,
      scheduleVersion: schedule.version,
      patientId: schedule.patientId,
      scheduledTimeLocal: localDateTimeStr,
      scheduledTimeUtc: utcIso,
      targetTimeSlot: slot.targetTimeLocal,
      graceWindow: {
        startUtc: graceStartUtc,
        endUtc: graceEndUtc,
      },
      doseQuantity: slot.doseQuantity,
      foodRelation: slot.foodRelation,
      requiresSupervision: schedule.requiresSupervision,
      status: 'UNCONFIRMED',
    };
  });
}
```

---

## 8.3 Adherence State Machine

Medication adherence cannot be treated as a binary (yes/no) flag. In clinical elderly care, tracking ambiguity is vital. The system models adherence via a four-state machine with deterministic transitions, role-based authorization, and audited overrides.

### The Four Certainty States
1. **`UNCONFIRMED` (Default Future State)**: The dose has been expanded into the day's timeline. The target dosing window has not elapsed, or the elder has not yet reported action.
2. **`TAKEN` (Positive Confirmation)**: Confirmed as ingested by the patient, verified by a caregiver, recorded via smart pillbox sensor, or witnessed by a healthcare professional.
3. **`SKIPPED` (Explicit Clinical Decision)**: The patient or caregiver consciously omitted the dose due to adverse symptoms (e.g., nausea, hypotension), medical procedure, fasting, or explicit physician instruction. A mandatory clinical reason must accompany this state.
4. **`MISSED` (Automatic Window Expiry or Non-Response)**: The scheduled time plus the configured grace period (e.g., +60 minutes) has elapsed without confirmation. No affirmative action was registered.

```
       +----------------------------------------------------------+
       |                                                          |
       v                                                          |
+---------------+   Elder/Caregiver Confirms Ingestion   +-----------------+
|               | -------------------------------------> |      TAKEN      |
|  UNCONFIRMED  |                                        +-----------------+
|   (Pending)   |   Explicit Reason Recorded             |                 |
|               | -------------------------------------> |     SKIPPED     |
+---------------+                                        +-----------------+
       |                                                          ^
       | Grace Period Elapsed (+60 mins)                          | Caregiver
       v                                                          | Retroactive
+---------------+    Caregiver Override with Reason               | Correction
|    MISSED     | ------------------------------------------------+
+---------------+
```

### Transition Matrix and Actor Permissions

| Current State | Target State | Triggering Event | Authorized Actors | Required Payload |
|---|---|---|---|---|
| `UNCONFIRMED` | `TAKEN` | Manual check-in, Smart blister click, IVR prompt response | Elder (if supervision=false), Caregiver, Nurse | `actualTimeUtc`, `recordedByRole`, `method` |
| `UNCONFIRMED` | `SKIPPED` | Conscious omission by elder or caregiver | Elder, Caregiver, Nurse, Doctor | `reasonCode` (e.g., `SIDE_EFFECTS`, `FASTING`), `notes` |
| `UNCONFIRMED` | `MISSED` | Time exceeds `scheduledTimeUtc + gracePeriodMinutes` | Automated Chron Engine (System) | `evaluatedAtUtc` |
| `MISSED` | `TAKEN` | Retroactive caregiver verification | Primary Caregiver, Nurse, Doctor | `overrideReason`, `actualTimeUtc`, `auditSignOff` |
| `MISSED` | `SKIPPED`| Retroactive recording of omitted dose | Primary Caregiver, Nurse, Doctor | `overrideReason`, `reasonCode` |
| `TAKEN` | `SKIPPED` | Ingestion reported in error (e.g., wrong pill) | Primary Caregiver, Doctor | `auditCorrectionNote`, `incidentReportId` |
| `SKIPPED` | `TAKEN` | Elder reported skipped, but nurse observed ingestion | Nurse, Doctor | `auditCorrectionNote`, `witnessName` |

### TypeScript `MedicationEvent` Schema

```typescript
export type AdherenceCertaintyState = 'UNCONFIRMED' | 'TAKEN' | 'SKIPPED' | 'MISSED';

export type SkipReasonCode =
  | 'ADVERSE_SYMPTOM'          // e.g., Nausea, dizziness, vomiting
  | 'DOCTOR_INSTRUCTED'        // Physician verbally told patient to hold dose
  | 'FASTING_OR_PROCEDURE'     // Fasting for diagnostic test or surgery
  | 'MEDICATION_UNAVAILABLE'   // Run out of stock / pharmacy delay
  | 'PATIENT_REFUSED'          // Elder resistance or behavioral objection
  | 'CONTRAINDICATION_VITALS'  // Blood pressure or heart rate outside safety bounds
  | 'OTHER';

export interface AdherenceAuditTrailEntry {
  auditId: string;
  fromState: AdherenceCertaintyState;
  toState: AdherenceCertaintyState;
  changedBy: {
    userId: string;
    role: 'ELDER' | 'PRIMARY_CAREGIVER' | 'VISITING_NURSE' | 'DOCTOR' | 'SYSTEM';
  };
  timestamp: string;           // ISO 8601 UTC
  overrideReason?: string;     // Justification for retroactive correction
}

export interface MedicationEvent {
  id: string;                          // Unique Event ID (UUIDv4)
  instanceKey: string;                 // Deterministic idempotency key: `${scheduleId}_${medicationId}_${date}_${timeSlot}`
  patientId: string;
  scheduleId: string;
  medicationId: string;
  scheduleVersion: number;
  
  // Timing
  targetDate: string;                  // YYYY-MM-DD in patient timezone
  scheduledTimeUtc: string;            // ISO 8601 UTC
  gracePeriodMinutes: number;          // Default 60 mins
  
  // State
  state: AdherenceCertaintyState;
  actualTakenTimeUtc?: string;         // Present only when TAKEN
  
  // Ingestion Attribution
  recordedBy?: {
    userId: string;
    role: 'ELDER' | 'PRIMARY_CAREGIVER' | 'VISITING_NURSE' | 'DOCTOR' | 'SYSTEM';
    channel: 'APP_BUTTON' | 'VOICE_ASSISTANT' | 'SMART_PILLBOX' | 'SMS_REPLY' | 'CARE_CALL';
  };
  
  // Omission Attributes
  skipDetails?: {
    reasonCode: SkipReasonCode;
    notes?: string;
    reportedByUserId: string;
  };
  
  // Vitals Context (if dose required pre-ingestion vitals)
  vitalsCaptured?: {
    vitalType: 'BLOOD_PRESSURE' | 'HEART_RATE' | 'BLOOD_GLUCOSE';
    value: string;
    verifiedWithinSafeBounds: boolean;
  };

  // Full Audit Trail
  auditTrail: AdherenceAuditTrailEntry[];
  
  createdAt: string;                   // ISO 8601 UTC
  updatedAt: string;                   // ISO 8601 UTC
}
```

---

## 8.4 Adherence Calculation & Metrics Engine

Adherence calculations in JEEVASETU serve two core purposes:
1. **Real-time Clinical Triaging**: Detecting deteriorating regimens (e.g., 3 consecutive missed antihypertensive doses).
2. **Longitudinal Health Outcomes**: Computing daily, 7-day rolling, and 30-day rolling adherence percentages for physician consultations.

### Standard Adherence Formula

The adherence rate $\mathcal{A}$ over an observation window $T$ is calculated strictly over **actionable scheduled doses**. Suspended days and `UNCONFIRMED` future slots are strictly omitted from the denominator to prevent metric skew.

$$\mathcal{A}_{T} = \frac{N_{\text{TAKEN}}}{N_{\text{SCHEDULED}} - N_{\text{EXCLUDED}}} \times 100\%$$

Where:
- $N_{\text{TAKEN}}$: Total doses with verified state `TAKEN`.
- $N_{\text{SCHEDULED}}$: Total scheduled dose instances falling within window $T$.
- $N_{\text{EXCLUDED}}$: Doses occurring during dates when the schedule was `SUSPENDED` or patient was marked as `HOSPITALIZED`, plus `UNCONFIRMED` doses whose grace period has not yet expired.
- **Handling of `SKIPPED`**: In the primary clinical adherence score, `SKIPPED` is counted in the denominator as non-adherent (as the body did not receive the medication), but is separated in the analytics breakdown to differentiate deliberate omissions from neglect (`MISSED`).
- **PRN Adherence**: PRN medications are excluded from percentage adherence scoring; they are tracked via **Utilization Intensity** (Doses consumed / 24-hr period).

```typescript
export interface AdherenceSummaryMetrics {
  patientId: string;
  medicationId?: string;               // Omitted if composite across all medications
  window: 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
  totalDosesScheduled: number;
  totalTaken: number;
  totalSkipped: number;
  totalMissed: number;
  totalUnconfirmed: number;            // Pending future doses
  adherenceRatePercent: number;        // (totalTaken / (totalScheduled - totalUnconfirmed)) * 100
  clinicalBreakdown: {
    takingComplianceRate: number;      // Taken / Evaluated
    deliberateSkipRate: number;        // Skipped / Evaluated
    unattendedMissRate: number;        // Missed / Evaluated
  };
  consecutiveMissedDosesCurrent: number;
  criticalAlertFlag: boolean;          // True if consecutiveMissedDoses >= 2 for high-risk medication
}

export function computeAdherenceMetrics(
  events: MedicationEvent[],
  windowDays: number,
  highRiskMedicationIds: Set<string>
): AdherenceSummaryMetrics {
  const evaluatedEvents = events.filter(e => e.state !== 'UNCONFIRMED');
  const totalScheduled = evaluatedEvents.length;

  if (totalScheduled === 0) {
    return {
      patientId: events[0]?.patientId || '',
      window: windowDays === 1 ? 'TODAY' : windowDays === 7 ? 'LAST_7_DAYS' : 'LAST_30_DAYS',
      totalDosesScheduled: 0,
      totalTaken: 0,
      totalSkipped: 0,
      totalMissed: 0,
      totalUnconfirmed: events.filter(e => e.state === 'UNCONFIRMED').length,
      adherenceRatePercent: 100,
      clinicalBreakdown: { takingComplianceRate: 100, deliberateSkipRate: 0, unattendedMissRate: 0 },
      consecutiveMissedDosesCurrent: 0,
      criticalAlertFlag: false,
    };
  }

  let taken = 0;
  let skipped = 0;
  let missed = 0;

  // Chronologically sort to find streak
  const sorted = [...evaluatedEvents].sort(
    (a, b) => new Date(a.scheduledTimeUtc).getTime() - new Date(b.scheduledTimeUtc).getTime()
  );

  let consecutiveMisses = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].state === 'MISSED') {
      consecutiveMisses++;
    } else {
      break;
    }
  }

  for (const ev of evaluatedEvents) {
    if (ev.state === 'TAKEN') taken++;
    else if (ev.state === 'SKIPPED') skipped++;
    else if (ev.state === 'MISSED') missed++;
  }

  const adherenceRate = Math.round((taken / totalScheduled) * 1000) / 10;
  const isHighRisk = events.some(e => highRiskMedicationIds.has(e.medicationId));
  const criticalAlert = (consecutiveMisses >= 2 && isHighRisk) || consecutiveMisses >= 3;

  return {
    patientId: events[0]?.patientId || '',
    window: windowDays === 1 ? 'TODAY' : windowDays === 7 ? 'LAST_7_DAYS' : 'LAST_30_DAYS',
    totalDosesScheduled: totalScheduled,
    totalTaken: taken,
    totalSkipped: skipped,
    totalMissed: missed,
    totalUnconfirmed: events.filter(e => e.state === 'UNCONFIRMED').length,
    adherenceRatePercent: adherenceRate,
    clinicalBreakdown: {
      takingComplianceRate: Math.round((taken / totalScheduled) * 1000) / 10,
      deliberateSkipRate: Math.round((skipped / totalScheduled) * 1000) / 10,
      unattendedMissRate: Math.round((missed / totalScheduled) * 1000) / 10,
    },
    consecutiveMissedDosesCurrent: consecutiveMisses,
    criticalAlertFlag: criticalAlert,
  };
}
```

---

## 8.5 Medication Change Workflow & Verification Guardrails

### Core Clinical Directives
1. **Strict No-Silent-Activation Rule**: Under no circumstances can a medication schedule change (dosage update, timing change, drug substitution, or discontinuation) take immediate effect on a patient's active daily execution plan without explicit, dual-custody verification.
2. **Never Make Automatic Medical or Dosage Decisions**: AI components, family caregivers, or junior aides are prohibited from unilaterally recalculating clinical dosages or altering regimens. AI may only transcribe prescriptions, flag potential conflicts, or draft change requests for human clinical sign-off.
3. **Pending Status Banner & Continuity of Care**: During the review period of a change request:
   - The user interface displays a prominent amber banner: *"Medication change request pending doctor verification. Continue taking the current dosage until authorized."*
   - The existing active schedule continues running without interruption.
   - If the change is an urgent discontinuation (e.g., severe allergy alert), a specialized emergency hold can be placed by a verified doctor, shifting the schedule to `SUSPENDED` immediately.

```
+---------------------------------------------------------------------------------------------------+
|  [!] PENDING VERIFICATION: Metformin dosage increase (500mg -> 1000mg) requested by Caregiver.     |
|      Awaiting Dr. Rajesh Sharma's clinical sign-off. Current 500mg schedule remains active.       |
+---------------------------------------------------------------------------------------------------+
```

### TypeScript `MedicationChangeRecord`

```typescript
export type ChangeRequestType = 
  | 'NEW_MEDICATION'
  | 'DOSAGE_ADJUSTMENT'
  | 'TIMING_MODIFICATION'
  | 'FREQUENCY_CHANGE'
  | 'DISCONTINUATION';

export type ChangeRequestStatus =
  | 'DRAFT'
  | 'AWAITING_VERIFICATION'
  | 'APPROVED_AND_ACTIVATED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'CANCELLED';

export interface MedicationChangeRecord {
  changeRequestId: string;             // UUIDv4
  patientId: string;
  scheduleId?: string;                 // Existing schedule (null for NEW_MEDICATION)
  medicationId: string;
  requestType: ChangeRequestType;
  status: ChangeRequestStatus;
  
  // Proposed Delta
  previousScheduleSnapshot?: MedicationSchedule;
  proposedSchedulePayload: Partial<MedicationSchedule>;
  
  // Clinical Rationale
  clinicalReason: string;              // e.g., "HbA1c remained > 8.5%; adjusting titration"
  supportingPrescriptionDocumentUrl?: string; // Digital prescription image / PDF
  
  // Originator
  requestedBy: {
    userId: string;
    role: 'ELDER' | 'PRIMARY_CAREGIVER' | 'VISITING_NURSE' | 'DOCTOR';
    timestamp: string;                 // ISO 8601 UTC
  };
  
  // Dual-Custody Verification
  verificationRequirement: {
    requiredRole: 'DOCTOR' | 'PRIMARY_CAREGIVER';
    secondaryApprovalRequired: boolean; // True if Beers criteria drug or high-risk dose change
  };
  
  resolutionDetails?: {
    resolvedByUserId: string;
    resolvedByRole: 'DOCTOR' | 'PRIMARY_CAREGIVER';
    licenseOrCredential?: string;
    resolution: 'APPROVED' | 'REJECTED';
    resolutionTimestamp: string;
    rejectionReason?: string;
    activationEffectiveDateLocal: string; // YYYY-MM-DD when transition takes effect
  };
  
  createdAt: string;
  updatedAt: string;
}
```

### Verification Flow Architecture

```
1. Initiator (Caregiver/Elder/Nurse)
   |
   | Submits Change Request (e.g. increase dose from 1 tab to 2 tabs)
   v
2. System Validation Engine
   | - Generates MedicationChangeRecord with status 'AWAITING_VERIFICATION'
   | - Keeps existing MedicationSchedule at version V with status 'ACTIVE'
   | - Flags UI with persistent PENDING_REVIEW warning banner
   v
3. Physician / Authorized Reviewer Portal
   | - Receives high-priority push notification / SMS dispatch
   | - Reviews side-by-side delta view (Current vs Proposed)
   | - Validates prescription scan & cross-checks Beers criteria interactions
   |
   +---> [Action: REJECT] ---> Record marked 'REJECTED', Caregiver notified with reason.
   |                           Existing schedule continues unchanged.
   |
   +---> [Action: APPROVE]
         v
4. Atomic Transaction Engine
   - Increments schedule version: V -> V + 1
   - Archives previous schedule snapshot to `medication_schedule_history`
   - Sets activationEffectiveDate
   - Updates status of MedicationChangeRecord to 'APPROVED_AND_ACTIVATED'
   - Clears UI pending banner
   - Triggers Schedule Expansion Algorithm for target effective date forward
```

---

## 8.6 Idempotency Engine & Concurrency Control

In elderly care apps, users frequently press check-off buttons multiple times due to slow network connections, tremors, or screen delays. Multiple caregivers may also attempt to mark the same dose simultaneously. The platform guarantees strict idempotency and concurrency control.

### Deterministic Key Formula
Every medication dose instance is identified by an immutable, mathematically deterministic key:

$$\text{InstanceKey} = \texttt{\{scheduleId\}\_\{medicationId\}\_\{date\}\_\{timeSlot\}}$$

**Example**:  
- `scheduleId`: `sch_9b1deb4d`
- `medicationId`: `med_metformin_500`
- `date`: `2026-11-15`
- `timeSlot`: `0800`  
$$\to \mathbf{sch\_9b1deb4d\_med\_metformin\_500\_20261115\_0800}$$

This key is used as the document ID in Firestore:
`patients/{patientId}/medicationEvents/{instanceKey}`

### Firestore Concurrency Transaction Implementation

```typescript
import { getFirestore, Transaction } from 'firebase-admin/firestore';

export interface ConfirmDoseRequest {
  patientId: string;
  instanceKey: string;
  action: 'TAKEN' | 'SKIPPED';
  actorUserId: string;
  actorRole: 'ELDER' | 'PRIMARY_CAREGIVER' | 'VISITING_NURSE' | 'DOCTOR';
  channel: 'APP_BUTTON' | 'VOICE_ASSISTANT' | 'SMART_PILLBOX';
  actualTakenTimeUtc?: string;
  skipReason?: SkipReasonCode;
  skipNotes?: string;
}

export async function processDoseAdherenceTransaction(
  req: ConfirmDoseRequest
): Promise<{ success: boolean; event: MedicationEvent; wasIdempotentNoop: boolean }> {
  const db = getFirestore();
  const eventRef = db
    .collection('patients')
    .doc(req.patientId)
    .collection('medicationEvents')
    .doc(req.instanceKey);

  return await db.runTransaction(async (transaction: Transaction) => {
    const docSnap = await transaction.get(eventRef);
    const nowUtc = new Date().toISOString();

    if (!docSnap.exists) {
      throw new Error(`Medication instance ${req.instanceKey} does not exist. Expansion required.`);
    }

    const currentEvent = docSnap.data() as MedicationEvent;

    // 1. Idempotency Check: Same action re-submitted
    if (currentEvent.state === req.action) {
      return {
        success: true,
        event: currentEvent,
        wasIdempotentNoop: true, // No-op, safely absorbed duplicate request
      };
    }

    // 2. Strict State Transition Checks
    if (currentEvent.state === 'TAKEN' && req.action === 'SKIPPED') {
      // Reversing TAKEN requires verified caregiver/doctor role
      if (req.actorRole !== 'PRIMARY_CAREGIVER' && req.actorRole !== 'DOCTOR') {
        throw new Error('Only a primary caregiver or doctor can reverse a confirmed TAKEN dose.');
      }
    }

    // 3. Create Audit Trail Entry
    const auditEntry: AdherenceAuditTrailEntry = {
      auditId: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fromState: currentEvent.state,
      toState: req.action,
      changedBy: {
        userId: req.actorUserId,
        role: req.actorRole,
      },
      timestamp: nowUtc,
      overrideReason: currentEvent.state !== 'UNCONFIRMED' ? 'State transition override' : undefined,
    };

    // 4. Build Updated Record
    const updatedEvent: MedicationEvent = {
      ...currentEvent,
      state: req.action,
      actualTakenTimeUtc: req.action === 'TAKEN' ? (req.actualTakenTimeUtc || nowUtc) : undefined,
      recordedBy: {
        userId: req.actorUserId,
        role: req.actorRole,
        channel: req.channel,
      },
      skipDetails: req.action === 'SKIPPED' ? {
        reasonCode: req.skipReason || 'OTHER',
        notes: req.skipNotes,
        reportedByUserId: req.actorUserId,
      } : undefined,
      auditTrail: [...currentEvent.auditTrail, auditEntry],
      updatedAt: nowUtc,
    };

    // 5. Commit within Atomic Transaction
    transaction.set(eventRef, updatedEvent, { merge: true });

    return {
      success: true,
      event: updatedEvent,
      wasIdempotentNoop: false,
    };
  });
}
```

---

## 8.7 Real-World Clinical & Edge Cases

### Edge Case 1: Timezone Crossings (Elder Traveling)
*Scenario*: An elder travels from Mumbai (`Asia/Kolkata`, UTC+05:30) to London (`Europe/London`, UTC+00:00).
*Hazard*: Directly taking morning medication based on local wall clock time could result in doses being administered 5.5 hours too early, causing drug toxicity (e.g., antidiabetics, antiarrhythmics).
*Solution Guardrail*:
- The schedule tracks interval pharmacology: critical medications with narrow therapeutic indices (e.g., Warfarin, Digoxin, Lithium) are flagged with `enforceMinimumSpacingHours`.
- When a timezone update is detected via the device or caregiver app, the expansion algorithm does not abruptly snap dosing times. It calculates the elapsed time since the previous administration. If the time difference is less than the minimum safe spacing interval, the morning dose slot is shifted forward in the local timezone with an advisory alert to the caregiver.

### Edge Case 2: Mid-Day Dosage Modification
*Scenario*: At 14:30, Dr. Sharma reviews morning lab results and orders Metformin reduced from 1000mg to 500mg, effective immediately.
*Resolution*:
- 08:00 morning dose (1000mg, status `TAKEN`): Remains immutable in the historical audit ledger.
- 13:00 afternoon dose: If already `TAKEN` or `MISSED`, preserved as-is under Schedule Version 1.
- 20:00 bedtime dose: The Schedule Expansion Engine invalidates the pending `UNCONFIRMED` 1000mg slot and generates the new 500mg slot under Schedule Version 2.
- The daily adherence view renders both schedule versions with clear annotations: morning under v1, evening under v2.

### Edge Case 3: Overlapping Regimens and Duplicate Class Warnings
*Scenario*: A patient is prescribed Amlodipine 5mg by a cardiologist, while a general practitioner previously prescribed Nifedipine (both dihydropyridine calcium channel blockers).
*Resolution*:
- During schedule authoring, the system executes an automated therapeutic class collision check.
- When two medications share the same active pharmacologic class or ATC level 4 code, the system halts the draft with a clinical advisory warning:
  `"Duplicate Class Detected: Both medications are Calcium Channel Blockers. Risk of severe hypotension. Doctor verification required."`
- The system refuses to activate the new schedule without explicit confirmation that the previous medication is intentionally replaced or co-prescribed.

### Edge Case 4: Discontinuation Lifecycle
*Scenario*: An adverse reaction occurs, and Aspirin must be discontinued immediately.
*Resolution*:
- Schedule status transitions from `ACTIVE` to `DISCONTINUED`.
- All future `UNCONFIRMED` slots across all future calendar days are permanently pruned or marked `EXPIRED`.
- Historical `TAKEN` and `SKIPPED` records remain fully accessible in the patient's long-term health record for retrospective analysis and mortality/morbidity audits.

---

## 8.8 Hackathon Prioritization Matrix

To deliver high clinical safety during rapid development cycles while remaining deployable for a hackathon demonstration, features are categorized into **Mandatory Core (MVP)** and **Deferred Advanced (Post-Hackathon)**.

| Feature Area | Hackathon MVP (Mandatory Core) | Deferred Post-Hackathon (V2 / Production) |
|---|---|---|
| **Data Model** | Standard `MedicationSchedule`, `DosingTime`, `MedicationEvent` in Firestore. | Multi-tier prescription refill counters, complex cyclic chemotherapy schedules. |
| **Recurrence Rules** | `DAILY`, `DAYS_OF_WEEK`, and simple interval `EVERY_X_DAYS`. | Multi-month cyclic rotations, complex non-standard PRN algorithms. |
| **Adherence States** | Full 4-state implementation: `UNCONFIRMED`, `TAKEN`, `SKIPPED`, `MISSED`. | Voice biometric confirmation, photo-proof computer vision ingestion verification. |
| **Guardrails & Verification** | Strict No-Silent-Activation rule, Caregiver OTP/Button approval, UI Amber Banner. | Multi-hospital EHR HL7/FHIR bidirectional sync, Beers criteria auto-query via RxNorm API. |
| **Concurrency & Idempotency** | Deterministic key `scheduleId_medId_date_time` + Firestore atomic transaction. | Distributed Redis token bucket rate limiting, high-frequency offline reconciliation. |
| **Metrics Engine** | Daily & 7-day adherence %, consecutive missed dose counter with high-risk alert. | Predictive adherence AI forecasting, non-compliance risk stratification scores. |
| **Edge Cases** | Mid-day schedule version increments, basic grace period timeout chron job. | Cross-continental dynamic flight timezone shifting algorithms. |


---\n
## 9.1 Architectural Overview & Core Objectives

The JEEVASETU Email Reminder Architecture is a resilient, event-driven notification subsystem designed to deliver proactive transactional reminders to elderly patients, their families, and designated caregivers. Built on Google Cloud Platform (GCP) and integrated with the Resend transactional email platform, the system balances time-sensitive clinical communication with fault-tolerant operational safeguards.

```mermaid
flowchart TD
    CS["GCP Cloud Scheduler (Cron: */5)"] -->|OIDC Authenticated POST| CR["Cloud Run: Reminder Dispatcher Service"]
    CR -->|1. Query Active Windows| FS[("Cloud Firestore (Schedules & Logs)")]
    CR -->|2. Evaluate Rules & Recipients| RE["Evaluation Engine"]
    RE -->|3. Atomic Check & Lock| RS[("reminders_sent Collection")]
    RE -->|4. Batch Send via HTTPS| RSND["Resend Transactional Email API"]
    RSND -->|200 OK: Message IDs| CR
    RSND -->|429/5xx: Transient Error| CR
    CR -->|5. Update Record State| RS
    CR -->|Attempts Exhausted (3)| DLQ[("reminders_failed / Pub/Sub DLQ")]
    DLQ --> ALERT["PagerDuty / Slack Alerting"]
    RSND -.->|Webhooks: delivered/bounced| WH["Cloud Run: Webhook Ingestion"]
    WH -->|Update Delivery State| RS
    RS --> DASH["System Health Dashboard"]
```

### The Core Clinical Safety Invariant: Delivery $\neq$ Consumption

> [!CAUTION]
> **Fundamental Healthcare Communication Axiom**: Delivering or opening an electronic notification **must never** be interpreted by the platform, caregivers, or clinical staff as proof that the patient consumed their medication. In geriatric care, passive reminders only confirm that an electronic transmission reached an inbox. Actual clinical compliance requires active, verifiable confirmation (e.g., in-app confirmation button tap, smart dispenser sensor telemetry, or direct caregiver sign-off). Every email generated by JEEVASETU strictly communicates this boundary to prevent dangerous assumptions of adherence.

---

## 9.2 Cloud Scheduler Configuration & Security

Cloud Scheduler acts as the heartbeat of the reminder subsystem, emitting time-based polling signals at deterministic intervals to evaluate pending notification windows.

### 9.2.1 Scheduling Cadence & Windowing

* **Cron Expression:** `*/5 * * * *` (Every 5 minutes, 24 hours a day, UTC).
* **Evaluation Window Buffer:** Each execution evaluates an overlapping 5-minute slice with a 2-minute lookback buffer to prevent edge-case dropouts caused by scheduler initialization latency ($[T_{\text{target}} - 7\text{ min}, T_{\text{target}}]$).
* **Deadline & Timeout:** HTTP request deadline is set to `180s`. If the dispatch pipeline exceeds 180 seconds, Cloud Run returns a 504 deadline exceeded, preventing runaway execution overlap.
* **Scheduler Retry Policy:** Cloud Scheduler retries are capped at `maxRetryAttempts: 1` with a `minBackoffDuration: 10s`. The scheduler itself does not manage fine-grained notification retries; retries are delegated to the internal pipeline state machine.

### 9.2.2 Secured Endpoint Authentication Architecture

The reminder processing endpoint (`/v1/internal/reminders/dispatch`) is protected through a defense-in-depth security model combining Google Cloud IAM OIDC token verification with an application-layer shared secret.

```mermaid
sequenceDiagram
    autonumber
    participant CS as GCP Cloud Scheduler
    participant IAM as Google IAM Token Service
    participant EP as Cloud Run Ingestion Endpoint
    participant SM as GCP Secret Manager

    CS->>IAM: Request OIDC Token (Audience = https://api.jeevasetu.care)
    IAM-->>CS: Signed JWT OIDC Token
    CS->>EP: POST /v1/internal/reminders/dispatch<br/>Header: Authorization: Bearer <JWT><br/>Header: X-Internal-Secret: <SECRET>
    EP->>EP: Verify Google Public Keys, aud, and iss
    EP->>SM: Validate X-Internal-Secret matches active secret
    alt Auth Valid
        EP-->>CS: 200 OK (Dispatch Triggered)
    else Auth Failed
        EP-->>CS: 401 Unauthorized / 403 Forbidden
    end
```

1. **Google OIDC Token (Primary Layer):**
   * Cloud Scheduler executes under a dedicated Google Service Account: `cloud-scheduler-reminder-runner@jeevasetu-prod.iam.gserviceaccount.com`.
   * Cloud Scheduler generates an OpenID Connect (OIDC) JWT signed by Google (`https://accounts.google.com`), passing the Cloud Run service URL as the target `audience`.
   * The Cloud Run ingress enforces IAM authentication (`roles/run.invoker`). The application middleware verifies the token signature, issuer, and expiration.
2. **Shared Secret Header (Application Layer):**
   * A high-entropy 256-bit token (`X-Internal-Secret`) is stored in Google Secret Manager (`SCHEDULER_SHARED_SECRET`) and validated by the endpoint middleware to protect against misconfigured internal routing.
3. **Ingress Restriction:**
   * Cloud Run service is configured with `Ingress: Internal and Cloud Load Balancing only`, blocking public internet traversal.

#### Infrastructure as Code: Terraform Cloud Scheduler Definition

```hcl
resource "google_cloud_scheduler_job" "reminder_dispatcher_job" {
  name             = "jeevasetu-reminder-dispatcher"
  description      = "Triggers JEEVASETU medication and appointment reminder evaluation"
  schedule         = "*/5 * * * *"
  time_zone        = "UTC"
  attempt_deadline = "180s"

  retry_config {
    retry_count          = 1
    min_backoff_duration = "10s"
    max_backoff_duration = "30s"
  }

  http_target {
    http_method = "POST"
    uri         = "https://api.jeevasetu.care/v1/internal/reminders/dispatch"
    
    headers = {
      "Content-Type"      = "application/json"
      "X-Internal-Secret" = data.google_secret_manager_secret_version.scheduler_secret.secret_data
    }

    body = base64encode(jsonencode({
      source      = "cloud-scheduler"
      windowSizeM = 5
    }))

    oidc_token {
      service_account_email = google_service_account.scheduler_sa.email
      audience              = "https://api.jeevasetu.care"
    }
  }
}
```

---

## 9.3 Notification Trigger Rules & Time Windows

JEEVASETU defines three primary time-delimited reminder classes. All evaluation queries normalize patient schedule times to UTC while maintaining the patient's local wall-clock timezone offset.

| Reminder Class | Trigger Offset ($T_{\text{target}}$) | Evaluation Window Formula ($t_{\text{now}}$) | Escalation Threshold | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Upcoming Dose** | 30 minutes before dose | $[t_{\text{now}} + 25\text{m}, t_{\text{now}} + 30\text{m}]$ | None (Informational) | Allows patient to prepare medication, water, or food requirements. |
| **Missed Medication** | $X$ hours post-schedule ($X \in [1, 3]$, default $1\text{h}$) | $[t_{\text{now}} - X\text{h} - 5\text{m}, t_{\text{now}} - X\text{h}]$ | Adherence unconfirmed at $t_{\text{schedule}} + X\text{h}$ | Alerts support network to verify safety and prevent skipped regimens. |
| **Appointment (24h)** | 24 hours prior to appointment | $[t_{\text{now}} + 23\text{h }55\text{m}, t_{\text{now}} + 24\text{h}]$ | None (Preparation) | Travel preparation, fasting guidelines, document checklists. |
| **Appointment (2h)** | 2 hours prior to appointment | $[t_{\text{now}} + 1\text{h }55\text{m}, t_{\text{now}} + 2\text{h}]$ | None (Imminent Departure) | Real-time transit reminder, caregiver escort readiness. |

### Missed Medication Evaluation Logic
A dose is evaluated as "Missed" if and only if:
1. Current time $t_{\text{now}} \ge t_{\text{scheduled}} + X\text{ hours}$.
2. Query to `dose_confirmations` collection for `{patientId, prescriptionId, scheduledTime, date}` returns **no record** or a record with status `SKIPPED`.
3. The prescription status is `ACTIVE` (not paused, completed, or discontinued by a physician).
4. No prior `MISSED_MED` reminder key exists in `reminders_sent` for this schedule event.

---

## 9.4 Recipient Resolution & Escalation Matrix

Elderly patients often depend on family members and professional caregivers to maintain medication adherence. The notification engine resolves recipients dynamically based on the reminder type, patient autonomy tier, and escalation state.

```mermaid
flowchart LR
    RT{"Reminder Type"} -->|Upcoming Dose| P1["Patient (Direct)"]
    RT -->|Missed Medication| P2["Patient (Reminder)"]
    RT -->|Missed Medication| F2["Family Caregiver (Escalation)"]
    RT -->|Missed Medication| C2["Assigned Nurse / Caregiver"]
    RT -->|Appointment 24h| P3["Patient"]
    RT -->|Appointment 24h| F3["Family Caregiver"]
    RT -->|Appointment 2h| P4["Patient"]
    RT -->|Appointment 2h| F4["Family Caregiver / Transport Contact"]
```

### 9.4.1 Recipient Role Matrix

| Reminder Type | Patient | Family Member / Guardian | Assigned Caregiver / Nurse | Resolution Rule |
| :--- | :--- | :--- | :--- | :--- |
| **Upcoming Dose (30m)** | **Primary (TO)** | Optional (CC if configured) | Excluded | Sent directly to the patient to respect dignity and autonomy. |
| **Missed Medication (+Xh)** | **Included (TO)** | **Mandatory (CC / Escalation)** | **Mandatory (TO / Alert)** | Triaged to patient and immediate care circle for prompt intervention. |
| **Appointment (24h)** | **Primary (TO)** | **Mandatory (CC)** | Optional (Based on assigned clinic escort) | Sent to all coordinators to confirm logistics and transport. |
| **Appointment (2h)** | **Primary (TO)** | **Mandatory (CC)** | **Included (If escort active)** | Imminent departure alert to prevent clinic no-shows. |

### 9.4.2 Preference Management & Non-Suppression Guardrails
* **Transactional Exemption:** Medication reminders are classified as critical healthcare operational transmissions. While patients may customize delivery channels, **missed medication escalations to designated family guardians cannot be silenced or unsubscribed** unless a replacement guardian is verified.
* **Recipient Profile Resolution:** Prior to dispatch, the engine verifies the recipient's `emailVerified: true` flag and checks that the profile is not marked as `BOUNCED_SUPPRESSED`.

---

## 9.5 End-to-End Processing Pipeline

The reminder processing pipeline executes deterministically across five sequential stages.

```mermaid
sequenceDiagram
    autonumber
    participant CS as Cloud Scheduler
    participant RW as Cloud Run Worker
    participant FS as Cloud Firestore
    participant RS as reminders_sent
    participant RA as Resend Email API
    participant DLQ as reminders_failed / DLQ

    CS->>RW: POST /dispatch (5-min Window)
    RW->>FS: 1. Query pending regimens & appointments
    FS-->>RW: Candidate records
    loop For Each Candidate Reminder
        RW->>RW: 2. Evaluate rules & resolve recipient list
        RW->>RS: 3. Atomic reservation: create(reminderKey, PENDING)
        alt Key Exists (ALREADY_EXISTS)
            RS-->>RW: Conflict / Duplicate
            RW->>RW: Skip event (Idempotency preserved)
        else Reservation Successful
            RS-->>RW: Lock Acquired
            RW->>RA: 4. POST /emails/batch (Resend API)
            alt Resend HTTP 200 OK
                RA-->>RW: Array of message IDs
                RW->>RS: 5a. Update status = SENT, resendIds, sentAt
            else Resend HTTP 429 / 5xx (Transient)
                RA-->>RW: Error Code
                RW->>RS: 5b. Update status = RETRYING, attempt = 1, nextRetryAt
            else Resend HTTP 4xx or Max Retries (Fatal)
                RA-->>RW: Fatal Error
                RW->>RS: 5c. Update status = DEAD_LETTER
                RW->>DLQ: Write to reminders_failed & publish alert
            end
        end
    end
    RW-->>CS: 200 OK (Batch Execution Summary)
```

### Stage 1: Window Query Execution
The dispatcher queries Firestore for schedules due within the target interval using composite indexes:
```typescript
// Query upcoming medication doses
const upcomingDosesSnapshot = await db.collection('medication_schedules')
  .where('status', '==', 'ACTIVE')
  .where('nextDoseUtc', '>=', windowStartUtc)
  .where('nextDoseUtc', '<=', windowEndUtc)
  .limit(500)
  .get();
```

### Stage 2: Business Rule & Recipient Resolution
The engine inspects patient status (excluding active hospital admissions or physician holds), evaluates caregiver association records, and structures the payload.

### Stage 3: Atomic Idempotency Check & Claim
Before making any external API call, the dispatcher executes a transactional write into `reminders_sent` using a deterministic key. If the document already exists, the item is immediately discarded.

### Stage 4: Resend API Dispatch
The dispatcher constructs the email message object and calls Resend's batch or single endpoint, passing custom telemetry headers (`X-Entity-Ref-ID`, `X-Jeevasetu-Type`).

### Stage 5: State Persistence & Result Recording
The pipeline writes the final execution outcome back to Firestore:
* On Success: Transitions status from `PENDING` to `SENT`, storing Resend message IDs.
* On Failure: Transitions status to `RETRYING` or `DEAD_LETTER`, logging error metadata.

---

## 9.6 Idempotency Engine & Data Schema

To guarantee that duplicate notifications are never sent—even under Cloud Scheduler retries, network timeouts, or concurrent Cloud Run instances—the system enforces strict document-level idempotency in Firestore.

### 9.6.1 Deterministic Idempotency Key Specification

Every reminder generates a canonical composite string formatted as:

$$\text{Key} = \texttt{\{type\}\_\{targetId\}\_\{scheduledTime\}\_\{date\}}$$

#### Structure Rules:
* `type`: Enum `UPCOMING_DOSE` | `MISSED_MED` | `APPT_24H` | `APPT_2H`.
* `targetId`: Unique identifier of the `prescriptionId` or `appointmentId`.
* `scheduledTime`: 4-digit 24-hour military format (`HHmm`), e.g., `0800`, `1430`.
* `date`: ISO calendar date (`YYYY-MM-DD`), e.g., `2026-11-15`.

#### Concrete Key Examples:
* `UPCOMING_DOSE_rx_88129a_0800_2026-11-15`
* `MISSED_MED_rx_88129a_0800_2026-11-15`
* `APPT_24H_apt_9921bc_1030_2026-11-16`
* `APPT_2H_apt_9921bc_1030_2026-11-16`

### 9.6.2 Firestore Collection Schema: `reminders_sent`

The document ID in `reminders_sent` is set directly to the deterministic key, leveraging Firestore's native ACID write consistency.

```json
{
  "_id": "UPCOMING_DOSE_rx_88129a_0800_2026-11-15",
  "reminderKey": "UPCOMING_DOSE_rx_88129a_0800_2026-11-15",
  "reminderType": "UPCOMING_DOSE",
  "targetId": "rx_88129a",
  "patientId": "pat_55410e",
  "scheduledTime": "08:00",
  "scheduledDate": "2026-11-15",
  "status": "SENT",
  "attemptCount": 1,
  "recipients": [
    {
      "email": "sharma.ramesh@gmail.com",
      "role": "PATIENT",
      "resendMessageId": "msg_01HZX876ABC"
    },
    {
      "email": "vikram.sharma@outlook.com",
      "role": "FAMILY_GUARDIAN",
      "resendMessageId": "msg_01HZX876ABD"
    }
  ],
  "dispatchedAt": "2026-11-15T07:30:02.124Z",
  "createdAt": "2026-11-15T07:30:01.890Z",
  "updatedAt": "2026-11-15T07:30:02.450Z",
  "ttlTimestamp": "2027-02-13T07:30:00.000Z"
}
```

### 9.6.3 Atomic Pre-Send Reservation Implementation

```typescript
import { Firestore, Timestamp } from '@google-cloud/firestore';

export async function claimReminderLock(
  db: Firestore,
  reminderKey: string,
  metadata: ReminderMetadata
): Promise<boolean> {
  const docRef = db.collection('reminders_sent').doc(reminderKey);

  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (doc.exists) {
        throw new Error('DUPLICATE_CLAIM');
      }

      // 90-day retention TTL
      const ttl = Timestamp.fromDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));

      transaction.create(docRef, {
        reminderKey,
        ...metadata,
        status: 'PENDING',
        attemptCount: 1,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ttlTimestamp: ttl,
      });
    });

    return true; // Lock acquired, safe to dispatch via Resend
  } catch (error: any) {
    if (error.message === 'DUPLICATE_CLAIM' || error.code === 6) { // 6 = ALREADY_EXISTS
      return false; // Already claimed or sent
    }
    throw error;
  }
}
```

---

## 9.7 Resend API Integration, Rate Limiting & Batching

Resend serves as the transactional delivery gateway. The integration adheres to strict throughput boundaries to prevent rate-limit throttling and ensure high domain reputation.

### 9.7.1 API Configuration & Authentication
* **Secret Storage:** The Resend API key (`re_prod_xxxxxxxxxxxx`) is mounted into the Cloud Run environment via Google Secret Manager (`RESEND_API_KEY`).
* **Domain Security:** Reminders originate from `notifications@mail.jeevasetu.care`. The domain enforces SPF (`v=spf1 include:resend.com ~all`), DKIM (2048-bit key), and DMARC (`v=DMARC1; p=reject; rua=mailto:dmarc-reports@jeevasetu.care`).

### 9.7.2 Batching Strategy
Rather than dispatching individual HTTP requests per recipient, the worker groups outbound notifications using Resend’s Batch API endpoint (`POST https://api.resend.com/emails/batch`), which accepts up to **100 emails per request**.

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendReminderBatch(emailPayloads: EmailPayload[]) {
  // Chunk into sub-batches of 100
  const CHUNK_SIZE = 100;
  for (let i = 0; i < emailPayloads.length; i += CHUNK_SIZE) {
    const chunk = emailPayloads.slice(i, i + CHUNK_SIZE);
    
    const response = await resend.batch.send(chunk.map(payload => ({
      from: 'JEEVASETU Care <notifications@mail.jeevasetu.care>',
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      headers: {
        'X-Entity-Ref-ID': payload.reminderKey,
        'List-Unsubscribe': '<https://app.jeevasetu.care/notifications/preferences>',
      },
    })));

    if (response.error) {
      throw new ResendDeliveryError(response.error.message, response.error.name);
    }
  }
}
```

### 9.7.3 Rate Limiting Safeguards
* **Account Rate Limits:** Resend enterprise and growth tiers enforce rate limits (typically 10 to 100 requests per second).
* **Token Bucket Throttler:** The Cloud Run dispatcher runs an internal token bucket rate limiter capped at 40 requests/sec, maintaining headroom for concurrent platform operations.
* **HTTP 429 Handling:** When a `429 Too Many Requests` is encountered, the worker reads the `Retry-After` header, pauses outbound queue consumption, and schedules exponential backoff.

---

## 9.8 Retry Strategy, Exponential Backoff & Dead-Letter Handling

Failures are segregated into **transient** (recoverable) and **permanent** (fatal) classes to prevent unproductive retries.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Scheduler Identifies Due Reminder
    PENDING --> DISPATCHING: Atomic Lock Acquired
    DISPATCHING --> SENT: Resend 200 OK
    SENT --> DELIVERED: Webhook email.delivered
    SENT --> BOUNCED: Webhook email.bounced
    DISPATCHING --> RETRYING: Resend 429/5xx (Attempt < 3)
    RETRYING --> DISPATCHING: Backoff Timer Fires
    DISPATCHING --> DEAD_LETTER: Attempt 3 Failed OR Fatal 4xx
    DEAD_LETTER --> ALERTED: Write to reminders_failed & Trigger Alert
    DEAD_LETTER --> [*]
    DELIVERED --> [*]
    BOUNCED --> [*]
```

### 9.8.1 Error Classification

| Error Class | HTTP Status / Codes | Examples | Handling Strategy |
| :--- | :--- | :--- | :--- |
| **Transient** | `429`, `500`, `502`, `503`, `504`, `ECONNRESET`, `ETIMEDOUT` | Resend server blip, rate limit burst, network timeout | Retry up to 3 times with exponential backoff and jitter. |
| **Permanent** | `400`, `401`, `403`, `422` | Invalid recipient email format, unverified domain, sender account restricted | Fail immediately. Mark as `DEAD_LETTER`. No retry. |

### 9.8.2 Exponential Backoff Algorithm

Retries are scheduled according to truncated exponential backoff with full jitter:

$$T_{\text{backoff}} = \min\left(T_{\text{max}}, T_{\text{base}} \times 2^{\text{attempt} - 1}\right) + \text{random}(0, \text{jitter})$$

* **Base Delay ($T_{\text{base}}$):** 30 seconds
* **Maximum Delay ($T_{\text{max}}$):** 600 seconds (10 minutes)
* **Maximum Attempts:** 3

```typescript
export function calculateNextRetry(attemptCount: number): Date {
  const baseDelayMs = 30 * 1000;
  const maxDelayMs = 600 * 1000;
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attemptCount - 1));
  const jitter = Math.floor(Math.random() * (exponential * 0.2)); // 20% jitter
  return new Date(Date.now() + exponential + jitter);
}
```

### 9.8.3 Dead-Letter Queue (DLQ) & Alerting Pipeline

When an item exceeds 3 failed attempts:
1. The document in `reminders_sent` is marked `status: 'DEAD_LETTER'`.
2. A structured failure record is written to the `reminders_failed` collection.
3. A message is published to the Cloud Pub/Sub topic `reminder-dead-letter-events`.
4. Cloud Functions triggers an automated alert to the On-Call Platform Team (PagerDuty P2 / Slack `#alerts-notifications`) and flags the patient’s profile in the Jeevasetu Caregiver Dashboard.

#### Schema: `reminders_failed`
```json
{
  "_id": "DLQ_UPCOMING_DOSE_rx_88129a_0800_2026-11-15",
  "reminderKey": "UPCOMING_DOSE_rx_88129a_0800_2026-11-15",
  "patientId": "pat_55410e",
  "failureReason": "RESEND_HTTP_500_SERVICE_UNAVAILABLE",
  "lastHttpCode": 500,
  "attemptHistory": [
    { "attempt": 1, "timestamp": "2026-11-15T07:30:02Z", "error": "ETIMEDOUT" },
    { "attempt": 2, "timestamp": "2026-11-15T07:31:05Z", "error": "500 Internal Server Error" },
    { "attempt": 3, "timestamp": "2026-11-15T07:33:12Z", "error": "500 Internal Server Error" }
  ],
  "resolved": false,
  "createdAt": "2026-11-15T07:33:13.100Z"
}
```

---

## 9.9 System Observability & Health Monitoring

The reminder subsystem provides continuous operational visibility into notification pipeline performance, gateway latency, and delivery health.

```mermaid
flowchart TD
    subgraph Execution Metrics
        M1["Query Duration (p95)"]
        M2["Evaluated Reminders / Run"]
        M3["Resend API Latency"]
    end
    subgraph Delivery Metrics
        D1["Send Success Rate (%)"]
        D2["Bounce Rate (%)"]
        D3["Active Retry Queue Depth"]
    end
    ExecutionMetrics --> OPS["Cloud Monitoring & OpenTelemetry"]
    DeliveryMetrics --> OPS
    OPS --> DASH["Jeevasetu System Health Console"]
    OPS --> ALARM{"Alert Evaluator"}
    ALARM -->|Failure Rate > 5%| P1["PagerDuty P1 Incident"]
    ALARM -->|DLQ Rate > 10 / hr| P2["Slack #care-ops-alerts"]
```

### 9.9.1 Core Telemetry Metrics

| Metric Key | Target SLO | Warning Threshold | Critical Threshold | Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| `reminders.send.success_rate` | $\ge 99.5\%$ | $< 98.0\%$ | $< 95.0\%$ | Check Resend service status, inspect egress DNS. |
| `reminders.query.latency_p95` | $< 800\text{ms}$ | $> 2000\text{ms}$ | $> 5000\text{ms}$ | Optimize Firestore indexes, review partition sizing. |
| `reminders.resend_api.latency_p95` | $< 400\text{ms}$ | $> 1200\text{ms}$ | $> 3000\text{ms}$ | Check external Resend network connectivity. |
| `reminders.dlq.count_15m` | $0$ | $\ge 3$ | $\ge 10$ | Trigger PagerDuty on-call dispatch; notify care staff. |
| `reminders.bounce_rate` | $< 0.5\%$ | $> 1.5\%$ | $> 3.0\%$ | Suppress invalid emails; prompt patient profile update. |

### 9.9.2 Resend Webhook Ingestion Pipeline

To track downstream delivery events beyond API handoff, JEEVASETU exposes an edge endpoint: `POST /v1/webhooks/resend`.

* **Signature Verification:** The webhook endpoint verifies the `svix-id`, `svix-timestamp`, and `svix-signature` headers using the Resend webhook signing secret.
* **State Updates:**
  * `email.delivered`: Updates the recipient record in `reminders_sent` to `DELIVERED`.
  * `email.bounced`: Updates status to `BOUNCED`, logs bounce classification (hard vs soft), and sets `emailVerified: false` on the patient/caregiver profile to halt future wasted attempts.
  * `email.complained`: Flags the email address for immediate human administrative review.

---

## 9.10 Elderly-Centric Email Design & Clinical Templates

Elderly recipients often experience reduced visual acuity, tremors, and cognitive fatigue. Email templates in JEEVASETU prioritize legibility, clear visual hierarchy, and high contrast, complying with **WCAG 2.1 AAA** standards.

### 9.10.1 UI/UX Design Standards
* **Typography:** System sans-serif stack (`Helvetica Neue, Arial, sans-serif`). Body text is minimum **18px** with a **1.6 line-height**. Heading text is **26px bold**.
* **Color Contrast:** Deep charcoal text (`#1E293B`) against pure white (`#FFFFFF`) or soft off-white (`#F8FAFC`), achieving contrast ratios $\ge 7:1$.
* **Action Targets:** All interactive buttons have a minimum vertical height of **54px** with clear borders and unmistakable labels.
* **Clutter Elimination:** No marketing banners, promotional links, or complex multi-column grids.

---

### 9.10.2 Template 1: Upcoming Dose Reminder (30 Min Before)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upcoming Medication Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F1F5F9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; border: 2px solid #CBD5E1; padding: 32px 24px;">
          
          <!-- Clinical Safety Notice Banner -->
          <tr>
            <td>
              <div style="background-color: #FEF3C7; border: 2px solid #F59E0B; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
                <p style="margin: 0; color: #92400E; font-size: 15px; line-height: 1.5; font-weight: bold;">
                  &#9888; CLINICAL NOTICE: This email is a reminder only. Receiving or opening this email does NOT confirm that medication has been taken.
                </p>
              </div>
            </td>
          </tr>

          <!-- Header -->
          <tr>
            <td>
              <p style="margin: 0 0 6px 0; font-size: 16px; color: #64748B; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">JEEVASETU Medication Care</p>
              <h1 style="margin: 0 0 20px 0; font-size: 28px; color: #0F172A; line-height: 1.3;">Upcoming Dose in 30 Minutes</h1>
              <p style="margin: 0 0 24px 0; font-size: 18px; color: #334155; line-height: 1.6;">Hello <strong>Ramesh Sharma</strong>, it is almost time for your scheduled medication.</p>
            </td>
          </tr>

          <!-- Medication Detail Box -->
          <tr>
            <td>
              <table role="presentation" width="100%" style="background-color: #F8FAFC; border: 2px solid #E2E8F0; border-radius: 10px; padding: 20px; margin-bottom: 28px;">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <span style="font-size: 15px; color: #64748B; text-transform: uppercase;">Medication:</span><br>
                    <strong style="font-size: 24px; color: #0F172A;">Metformin 500mg</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 12px;">
                    <span style="font-size: 15px; color: #64748B; text-transform: uppercase;">Scheduled Time:</span><br>
                    <strong style="font-size: 22px; color: #0F172A;">08:00 AM (Today)</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span style="font-size: 15px; color: #64748B; text-transform: uppercase;">Instructions:</span><br>
                    <strong style="font-size: 18px; color: #1E293B;">Take 1 tablet with a full glass of water after breakfast.</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <a href="https://app.jeevasetu.care/doses/confirm?rx=rx_88129a&date=2026-11-15" style="display: block; width: 85%; background-color: #166534; color: #FFFFFF; font-size: 20px; font-weight: bold; text-align: center; text-decoration: none; padding: 18px 0; border-radius: 8px;">
                I Have Taken This Dose
              </a>
            </td>
          </tr>

          <!-- Secondary Contact -->
          <tr>
            <td style="border-top: 1px solid #E2E8F0; padding-top: 20px;">
              <p style="margin: 0; font-size: 16px; color: #64748B; line-height: 1.5;">
                Need help? Call your assigned caregiver at <strong style="color: #0F172A;">+91 98765 43210</strong>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

### 9.10.3 Template 2: Missed Medication Alert (+1 Hour Unconfirmed)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Required: Missed Medication Alert</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FEF2F2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #FEF2F2; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; border: 2px solid #EF4444; padding: 32px 24px;">
          
          <!-- Mandatory Clinical Notice -->
          <tr>
            <td>
              <div style="background-color: #FEE2E2; border: 2px solid #B91C1C; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
                <p style="margin: 0; color: #991B1B; font-size: 15px; line-height: 1.5; font-weight: bold;">
                  &#9888; CRITICAL NOTICE: No dose confirmation has been recorded. This notice has been copied to designated family contacts.
                </p>
              </div>
            </td>
          </tr>

          <!-- Header -->
          <tr>
            <td>
              <p style="margin: 0 0 6px 0; font-size: 16px; color: #DC2626; font-weight: bold; text-transform: uppercase;">Adherence Alert &bull; 1 Hour Overdue</p>
              <h1 style="margin: 0 0 20px 0; font-size: 26px; color: #991B1B; line-height: 1.3;">Unconfirmed Medication Dose</h1>
              <p style="margin: 0 0 24px 0; font-size: 18px; color: #334155; line-height: 1.6;">
                The scheduled morning dose for <strong>Ramesh Sharma</strong> has not been confirmed.
              </p>
            </td>
          </tr>

          <!-- Dose Spec -->
          <tr>
            <td>
              <table role="presentation" width="100%" style="background-color: #FFF1F2; border: 2px solid #FECDD3; border-radius: 10px; padding: 20px; margin-bottom: 28px;">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <span style="font-size: 15px; color: #9F1239; text-transform: uppercase;">Medication:</span><br>
                    <strong style="font-size: 24px; color: #881337;">Amlodipine 5mg</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 12px;">
                    <span style="font-size: 15px; color: #9F1239; text-transform: uppercase;">Was Due At:</span><br>
                    <strong style="font-size: 22px; color: #881337;">08:00 AM (Overdue by 60 mins)</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span style="font-size: 15px; color: #9F1239; text-transform: uppercase;">Patient Contact:</span><br>
                    <strong style="font-size: 18px; color: #0F172A;">Ramesh Sharma (+91 91234 56789)</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action Buttons -->
          <tr>
            <td>
              <table role="presentation" width="100%">
                <tr>
                  <td align="center" style="padding-bottom: 16px;">
                    <a href="https://app.jeevasetu.care/doses/confirm?rx=rx_77218b&date=2026-11-15" style="display: block; width: 85%; background-color: #1E293B; color: #FFFFFF; font-size: 18px; font-weight: bold; text-align: center; text-decoration: none; padding: 16px 0; border-radius: 8px;">
                      Confirm Dose Taken Now
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <a href="tel:+919123456789" style="display: block; width: 85%; background-color: #DC2626; color: #FFFFFF; font-size: 18px; font-weight: bold; text-align: center; text-decoration: none; padding: 16px 0; border-radius: 8px;">
                      Call Patient Directly
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer Disclaimer -->
          <tr>
            <td style="border-top: 1px solid #FECDD3; padding-top: 18px;">
              <p style="margin: 0; font-size: 14px; color: #64748B; line-height: 1.5;">
                This automated safety alert was dispatched to the patient and verified family guardians. Never double doses unless advised by a doctor.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

### 9.10.4 Template 3: Clinic Appointment Reminder (24h / 2h Before)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upcoming Medical Appointment</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; border: 2px solid #CBD5E1; padding: 32px 24px;">
          
          <!-- Header -->
          <tr>
            <td>
              <p style="margin: 0 0 6px 0; font-size: 16px; color: #0369A1; font-weight: bold; text-transform: uppercase;">Appointment Reminder</p>
              <h1 style="margin: 0 0 16px 0; font-size: 26px; color: #0F172A; line-height: 1.3;">Tomorrow at 10:30 AM</h1>
              <p style="margin: 0 0 24px 0; font-size: 18px; color: #334155; line-height: 1.6;">
                Reminder for <strong>Ramesh Sharma</strong> regarding your scheduled specialist visit.
              </p>
            </td>
          </tr>

          <!-- Appointment Details Table -->
          <tr>
            <td>
              <table role="presentation" width="100%" style="background-color: #F0F9FF; border: 2px solid #BAE6FD; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <span style="font-size: 14px; color: #0369A1; text-transform: uppercase;">Doctor & Specialty:</span><br>
                    <strong style="font-size: 22px; color: #0C4A6E;">Dr. Ananya Rao (Cardiology)</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 12px;">
                    <span style="font-size: 14px; color: #0369A1; text-transform: uppercase;">Location:</span><br>
                    <strong style="font-size: 18px; color: #0F172A;">Apollo Medical Centre, Clinic 4B, Indiranagar, Bengaluru</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span style="font-size: 14px; color: #0369A1; text-transform: uppercase;">Preparation Checklist:</span><br>
                    <ul style="margin: 6px 0 0 0; padding-left: 20px; font-size: 16px; color: #1E293B; line-height: 1.5;">
                      <li>Bring all current medication boxes or prescriptions.</li>
                      <li>Carry past blood pressure log sheets.</li>
                      <li>Fasting is <strong>NOT</strong> required for this visit.</li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action Buttons -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <a href="https://maps.google.com/?q=Apollo+Indiranagar" style="display: block; width: 85%; background-color: #0284C7; color: #FFFFFF; font-size: 19px; font-weight: bold; text-align: center; text-decoration: none; padding: 16px 0; border-radius: 8px;">
                Get Driving Directions
              </a>
            </td>
          </tr>

          <!-- Footer Notice -->
          <tr>
            <td style="border-top: 1px solid #E2E8F0; padding-top: 16px;">
              <p style="margin: 0; font-size: 14px; color: #64748B; line-height: 1.5;">
                Need to reschedule? Please contact the clinic at least 4 hours in advance at <strong>080 2345 6789</strong>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 9.11 Architectural Boundaries & Deferred Features (Roadmap)

To maintain extreme reliability and simplicity during the initial production phase (v1), specific notification modalities and scheduling complexities are deliberately deferred.

| Deferred Capability | Technical Rationale for Deferral | Target Horizon | Planned Migration Path |
| :--- | :--- | :--- | :--- |
| **SMS Notifications (Twilio / Gupshup / AWS SNS)** | SMS exhibits high recurring per-message costs, strict regional telecom regulatory burdens (e.g., India DLT template registration), and character count limitations that degrade clinical clarity for elderly readers. | **v1.2** | Integrate after email delivery baselines and template adoption stabilize, using SMS strictly as a fallback for missed medication escalations. |
| **Push Notifications (Firebase Cloud Messaging / FCM)** | Elderly demographic shows low native app notification retention, high frequency of disabling system notifications, and aggressive Android OS background battery-killer process kills. | **v1.3** | Introduce FCM once the dedicated Android/iOS companion application reaches active adoption milestones. |
| **WhatsApp Business API** | High template review latency, strict WhatsApp conversational window pricing policies, and complex webhook authentication requirements. | **v2.0** | WhatsApp will be introduced as an interactive two-way channel allowing elderly users to reply with "TAKEN" or a photo of the medication. |
| **Dynamic Cloud Tasks / Per-Dose Crons** | Creating individual Cloud Tasks or Cloud Scheduler instances per individual dose introduces scheduling management overhead, potential task leakages on regimen modifications, and high API configuration churn. | **Architectural Decision (Retain Polling Engine)** | The unified 5-minute Cloud Scheduler polling engine provides constant $O(1)$ infrastructure overhead and decoupled database-driven scheduling. |
| **Automated Smart IVR Voice Calls** | High implementation complexity; requires telephony integration and voice synthesis capable of multi-dialect Indian English and regional languages. | **v2.0** | Reserved for critical Tier-3 escalation when missed medication exceeds 3 hours and family members fail to acknowledge email alerts. |

---

## 9.12 Summary of Operational Configurations

| Component | Technology | Parameter / Setting | Value |
| :--- | :--- | :--- | :--- |
| **Trigger Engine** | Google Cloud Scheduler | Cadence | `*/5 * * * *` (UTC) |
| **Worker Ingress** | Google Cloud Run | Auth Verification | Google OIDC JWT + `X-Internal-Secret` |
| **Transactional Email** | Resend REST / SDK | Batch Size | 100 emails / request |
| **Database** | Google Cloud Firestore | Collection | `reminders_sent` |
| **Idempotency** | Document Lock | Key Format | `{type}_{targetId}_{scheduledTime}_{date}` |
| **Retry Policy** | In-Worker Backoff | Max Attempts | 3 attempts ($30\text{s}, 120\text{s}, 480\text{s} + \text{jitter}$) |
| **Dead-Letter Storage** | Firestore / PubSub | Collection | `reminders_failed` |
| **Clinical Invariant** | Human / Care Protocol | Axiom | **Delivery $\neq$ Medication Intake** |


---\n
## 10. Offline Storage, Synchronization and Conflict Resolution

The JEEVASETU web platform employs an offline-first architecture to guarantee uninterrupted bedside and in-transit clinical workflows. In community health environments, rural clinics, and ambulatory settings, network availability is intermittent or high-latency. Clinicians, caregivers, and patients must be empowered to record medication adherence, verify schedules, and review critical profile summaries without blocking on network round-trips.

This section specifies the offline data boundaries, service worker caching strategies, IndexedDB schemas, transactional mutation logging, reconnection synchronization pipelines, domain-specific conflict resolution rules, and browser engine mitigation strategies.

---

### 10.1 Data Caching Scope and Boundaries

Offline storage operates on a strict principle of least-privilege caching. Due to device storage constraints, sensitive health data compliance, and the risk of stale clinical data, client-side persistence is restricted to operational data required for immediate care within a 24-to-72-hour window.

```
+-------------------------------------------------------------------------+
|                        OFFLINE DATA BOUNDARIES                          |
+-------------------------------------------------------------------------+
|  [WHITELISTED: CACHED IN INDEXEDDB]                                     |
|  * Today's Medication Schedule (active doses, timing, instructions)     |
|  * Recent Medication Events (last 24-48 hours for adherence context)   |
|  * Patient Profile Summary (demographics, blood group, allergies)       |
|  * Recent & Upcoming Appointments (next 72 hours / nearest encounter)   |
+-------------------------------------------------------------------------+
|  [BLACKLISTED: EXCLUDED FROM CLIENT STORAGE - NETWORK REQUIRED]         |
|  x Full Historical Medical & Diagnostic Records                         |
|  x Administrative & Formulary Configuration Operations                  |
|  x Patient / Caregiver Invitation & Identity Management                 |
|  x Real-Time Telehealth Video Signaling & Billing Pipelines             |
+-------------------------------------------------------------------------+
```

#### 10.1.1 Whitelisted Cache Entities
* **Today's Medication Schedule:** Complete metadata for all doses scheduled for the current calendar day (00:00 to 23:59 local time), including drug entity IDs, brand/generic names, dosages, routes, planned administration windows, special food/fluid instructions, and prescribing clinician IDs.
* **Recent Medication Events:** Administration logs created or updated within the preceding 24–48 hours. This provides the user with visual confirmation of previously logged doses and prevents duplicate administrations.
* **Patient Profile Summary:** Demographic baseline, emergency contacts, primary caregiver references, blood group, and high-severity clinical alerts (e.g., active drug allergies and anaphylaxis warnings).
* **Recent & Upcoming Appointments:** Encounters occurring within the past 24 hours or scheduled within the upcoming 72 hours, including clinic location, provider name, and appointment status.

#### 10.1.2 Blacklisted Operations (Strict Network Required)
* **Full Historical Records:** Multi-month longitudinal charts, historical laboratory panels, and historical discharge summaries are excluded. These heavy payloads invite security exposure and storage quota exhaustion.
* **Admin & Formulary Operations:** Role reassignments, permission changes, clinical protocol modifications, and enterprise tenant configurations require immediate server-side authorization and are disabled when offline.
* **Invitation & Identity Management:** Creating caregiver invitations, revoking credentials, resetting multi-factor authentication (MFA), and signing consent documents require live audit trails and cannot be queued offline.
* **Financial & Telehealth Signaling:** Payment gateway interactions, insurance claims validation, and WebRTC signaling sessions demand live network transport.

---

### 10.2 Service Worker Caching Strategies

JEEVASETU implements a dual-layer caching strategy orchestrated through the Service Worker `fetch` event pipeline. Static application infrastructure uses a **Cache-First** strategy, while dynamic clinical data routes use a **Network-First with IndexedDB Fallback** strategy.

```mermaid
flowchart TD
    Req[Incoming HTTP Request] --> CheckType{Request Type}
    
    %% Static Asset Path
    CheckType -->|Static Asset: JS/CSS/HTML/Img| CF_Cache[(Cache Storage)]
    CF_Cache -->|Cache Hit| RetStatic[Return Cached Asset]
    CF_Cache -->|Cache Miss| NetStatic[Fetch from Network]
    NetStatic --> SaveStatic[Write to Cache Storage]
    SaveStatic --> RetStatic

    %% API Data Path
    CheckType -->|API Route: /api/v1/*| NF_Net[Fetch from Network]
    NF_Net -->|Success 200 OK| UpdIDB[Update IndexedDB Store]
    UpdIDB --> RetAPI[Return Fresh Server Response]
    NF_Net -->|Network Failure / Timeout| IDBFallback[(IndexedDB Storage)]
    IDBFallback -->|Record Exists| SynOff[Synthesize Offline Response + Header]
    IDBFallback -->|Record Missing| Ret404[Return Offline 503 / Empty State]
```

#### 10.2.1 Cache-First Strategy for Static Application Assets
Static shell assets—versioned JavaScript bundles, scoped CSS stylesheets, web fonts, vector iconography, and localized static microcopy—are immutable between deployments.
1. The Service Worker matches the request against the versioned `CacheStorage` (`jeevasetu-static-vX.Y.Z`).
2. If matched, the cached response is returned immediately, bypassing the network.
3. If not cached, the asset is fetched over the network, placed into `CacheStorage`, and returned.

#### 10.2.2 Network-First with IndexedDB Fallback for Clinical Data
For REST API endpoints returning clinical state (`/api/v1/patients/:id/schedule/today`, `/api/v1/patients/:id/summary`, `/api/v1/appointments/recent`):
1. **Network Attempt:** The Service Worker attempts an immediate network fetch with a strict 3500ms timeout.
2. **Network Success:** The fresh JSON payload is cloned: one copy is returned to the client application, while an asynchronous task serializes the payload into the appropriate IndexedDB object store (e.g., updating `cached_schedules`).
3. **Network Failure / Timeout:** If the network request fails (e.g., DNS resolution failure, connection drop, HTTP 504) or exceeds the timeout threshold, the Service Worker intercepts the failure, queries the local IndexedDB instance, and synthesizes an HTTP `200 OK` response with a custom header:
   ```http
   X-Jeevasetu-Offline-Source: indexed-db
   X-Jeevasetu-Cached-At: 2026-11-15T08:14:02.000Z
   ```
4. If no cached record exists in IndexedDB, the Service Worker returns an HTTP `503 Service Unavailable` with a structured payload: `{"code": "OFFLINE_NO_CACHE", "message": "Clinical data unavailable offline"}`.

#### 10.2.3 Service Worker Fetch Implementation
```typescript
// sw.ts - Service Worker Fetch Interceptor
const STATIC_CACHE_NAME = 'jeevasetu-static-v1.4.2';
const API_TIMEOUT_MS = 3500;

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // 1. Static Assets: Cache-First
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.woff2'))
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(STATIC_CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        });
      })
    );
    return;
  }

  // 2. Clinical API Queries: Network-First with Client-Side Fallback
  if (url.pathname.startsWith('/api/v1/patients/') && event.request.method === 'GET') {
    event.respondWith(
      timeoutPromise(fetch(event.request), API_TIMEOUT_MS)
        .then((networkResponse) => {
          // If valid response, pass through (application data layer updates IndexedDB)
          return networkResponse;
        })
        .catch(async () => {
          // Network failed or timed out: Let application-level data hook fall back to IndexedDB
          // or return synthetic fallback from Service Worker if pre-cached
          return new Response(
            JSON.stringify({
              error: 'NETWORK_UNAVAILABLE',
              offlineFallback: true,
              timestamp: new Date().toISOString()
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Jeevasetu-Offline': 'true'
              }
            }
          );
        })
    );
  }
});

function timeoutPromise<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), ms);
    promise.then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
```

---

### 10.3 IndexedDB Schema and Storage Architecture

IndexedDB acts as the client-side single source of truth during offline operation. The database is initialized under the identifier `JeevasetuOfflineDB` using an explicit version migration schema.

#### 10.3.1 Database Topology
* **Database Name:** `JeevasetuOfflineDB`
* **Current Version:** `3`
* **Object Stores:**
  1. `cached_schedules`: Read-through cache of medication regimes.
  2. `recent_events`: Recent historical doses for timeline continuity.
  3. `pending_events`: Unsynced offline logs and mutations.
  4. `sync_queue`: Operational orchestration queue managing retry schedules, exponential backoff state, and sequence priority.
  5. `patient_profile_summary`: Cached demographic and allergy data.
  6. `recent_appointments`: Cached upcoming consultations.

```mermaid
erDiagram
    CACHED_SCHEDULES ||--o{ RECENT_EVENTS : references
    CACHED_SCHEDULES ||--o{ PENDING_EVENTS : queues_mutation
    PENDING_EVENTS ||--|| SYNC_QUEUE : tracks_synchronization

    CACHED_SCHEDULES {
        string scheduleId PK
        string patientId FK
        string medicationName
        string dosage
        string route
        string scheduledTime
        string date
        boolean isActive
    }

    PENDING_EVENTS {
        string localEventId PK
        string idempotencyKey UK
        string scheduleId FK
        string patientId FK
        string action
        string clientTimestamp
        string syncStatus
        int retryCount
    }

    SYNC_QUEUE {
        string queueId PK
        string localEventId FK
        string endpoint
        string method
        int priority
        int attempts
        string nextRetryAt
    }
```

#### 10.3.2 Object Store Definitions and Schema Migration
```typescript
// idb-schema.ts
export interface CachedSchedule {
  scheduleId: string;       // PK: Unique schedule identifier
  patientId: string;        // Index: Patient GUID
  medicationId: string;
  medicationName: string;
  dosage: string;
  route: string;            // 'ORAL', 'IV', 'SUBCUTANEOUS', etc.
  scheduledTime: string;    // '08:00', '14:00', '20:00'
  date: string;             // 'YYYY-MM-DD'
  instructions?: string;
  updatedAt: string;        // ISO 8601 server timestamp
}

export interface MedicationEvent {
  eventId: string;          // Server GUID or Local UUID
  scheduleId: string;
  patientId: string;
  medicationId: string;
  action: 'TAKEN' | 'SKIPPED' | 'DELAYED';
  takenAt: string;          // ISO 8601 timestamp of administration
  recordedAt: string;       // ISO 8601 timestamp of record entry
  recordedByUserId: string;
  dosageGiven: string;
  notes?: string;
}

export interface PendingEvent {
  localEventId: string;     // PK: Client UUIDv4
  idempotencyKey: string;   // Unique composite: client UUID + scheduleId + scheduledTime
  scheduleId: string;
  patientId: string;
  medicationId: string;
  action: 'TAKEN' | 'SKIPPED' | 'DELAYED';
  clientTimestamp: string;  // ISO 8601 client time
  recordedByUserId: string;
  notes?: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'FAILED_RETRYABLE' | 'CONFLICT';
  lastError?: string;
  createdAt: number;        // Epoch ms for strict FIFO sorting
}

export interface SyncQueueItem {
  queueId: string;          // PK: Auto-increment or UUID
  localEventId: string;     // FK to pending_events
  operation: 'POST_MEDICATION_LOG' | 'UPDATE_EVENT_NOTE';
  payloadJson: string;
  idempotencyKey: string;
  priority: number;         // Lower number = higher priority
  attempts: number;
  lastAttemptAt?: number;
  nextRetryAt: number;
  status: 'QUEUED' | 'PROCESSING' | 'FAILED';
}

export function openJeevasetuDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('JeevasetuOfflineDB', 3);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. cached_schedules
      if (!db.objectStoreNames.contains('cached_schedules')) {
        const scheduleStore = db.createObjectStore('cached_schedules', { keyPath: 'scheduleId' });
        scheduleStore.createIndex('by_patient_and_date', ['patientId', 'date'], { unique: false });
        scheduleStore.createIndex('by_patient', 'patientId', { unique: false });
      }

      // 2. recent_events
      if (!db.objectStoreNames.contains('recent_events')) {
        const eventsStore = db.createObjectStore('recent_events', { keyPath: 'eventId' });
        eventsStore.createIndex('by_patient_and_time', ['patientId', 'takenAt'], { unique: false });
        eventsStore.createIndex('by_schedule', 'scheduleId', { unique: false });
      }

      // 3. pending_events (Offline mutations)
      if (!db.objectStoreNames.contains('pending_events')) {
        const pendingStore = db.createObjectStore('pending_events', { keyPath: 'localEventId' });
        pendingStore.createIndex('by_idempotency_key', 'idempotencyKey', { unique: true });
        pendingStore.createIndex('by_sync_status', 'syncStatus', { unique: false });
        pendingStore.createIndex('by_created_at', 'createdAt', { unique: false });
      }

      // 4. sync_queue
      if (!db.objectStoreNames.contains('sync_queue')) {
        const queueStore = db.createObjectStore('sync_queue', { keyPath: 'queueId' });
        queueStore.createIndex('by_status_and_retry', ['status', 'nextRetryAt'], { unique: false });
        queueStore.createIndex('by_priority', 'priority', { unique: false });
      }

      // 5. patient_profile_summary
      if (!db.objectStoreNames.contains('patient_profile_summary')) {
        db.createObjectStore('patient_profile_summary', { keyPath: 'patientId' });
      }

      // 6. recent_appointments
      if (!db.objectStoreNames.contains('recent_appointments')) {
        const aptStore = db.createObjectStore('recent_appointments', { keyPath: 'appointmentId' });
        aptStore.createIndex('by_patient', 'patientId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

---

### 10.4 Offline Event Logging and Optimistic UI Mutations

When a user marks a medication as "Taken", "Skipped", or "Delayed" while disconnected, the system must not block. It performs an atomic, optimistic local transaction that updates the user interface instantly while safely persisting the payload into the synchronization queue.

```mermaid
sequenceDiagram
    autonumber
    actor User as Patient / Caregiver
    participant UI as React UI Component
    participant State as Application State
    participant IDB as IndexedDB (Atomic TX)
    
    User->>UI: Clicks "Mark as Taken"
    UI->>UI: Generate UUIDv4 + Idempotency Key
    UI->>State: Apply Optimistic State (Badge: "Pending Sync")
    State-->>UI: Re-render Card with Amber Status Pill
    
    UI->>IDB: Begin Transaction ['pending_events', 'sync_queue', 'recent_events']
    IDB->>IDB: Put to 'pending_events' (status: PENDING)
    IDB->>IDB: Put to 'sync_queue' (status: QUEUED)
    IDB->>IDB: Put to 'recent_events' (optimistic record)
    IDB-->>UI: Transaction Complete
    UI->>User: Display Toast ("Dose logged offline. Queued for sync.")
```

#### 10.4.1 Logging Execution Flow
1. **Idempotency Key Synthesis:** The client constructs a deterministic UUIDv4 along with a semantic idempotency key:
   $$\text{IdempotencyKey} = \text{MD5}(\text{patientId} + \text{"\_"} + \text{scheduleId} + \text{"\_"} + \text{scheduledDate} + \text{"\_"} + \text{scheduledTime}) + \text{"\_"} + \text{UUIDv4}$$
2. **Local Timestamp Capture:** The device records two distinct timestamps:
   - `clientTimestamp`: The local device time at which the patient actually swallowed or administered the medication.
   - `recordedAt`: The system clock time at which the button was clicked.
3. **Atomic Transaction Write:**
   An IndexedDB transaction spanning `pending_events`, `sync_queue`, and `recent_events` is opened. All entries are committed together:
   - A `PendingEvent` record is written with `syncStatus: 'PENDING'`.
   - A `SyncQueueItem` is enqueued with `priority: 1` and `attempts: 0`.
   - The `recent_events` table receives an optimistic duplicate marked with an `isLocalOptimistic: true` flag.
4. **Optimistic UI Transition:**
   The UI immediately reflects the medication as taken, applying an amber "Offline Pending Sync" badge, and increments the global pending sync counter.

#### 10.4.2 Optimistic Mutation Implementation
```typescript
// medication-logger.ts
import { openJeevasetuDB, PendingEvent, SyncQueueItem } from './idb-schema';

export async function logMedicationTakenOffline(params: {
  scheduleId: string;
  patientId: string;
  medicationId: string;
  userId: string;
  notes?: string;
}): Promise<string> {
  const db = await openJeevasetuDB();
  const localEventId = crypto.randomUUID();
  const clientTimestamp = new Date().toISOString();
  
  // Create unique idempotency key
  const idempotencyKey = `idem_${params.patientId}_${params.scheduleId}_${Date.now()}_${localEventId}`;

  const pendingEvent: PendingEvent = {
    localEventId,
    idempotencyKey,
    scheduleId: params.scheduleId,
    patientId: params.patientId,
    medicationId: params.medicationId,
    action: 'TAKEN',
    clientTimestamp,
    recordedByUserId: params.userId,
    notes: params.notes,
    syncStatus: 'PENDING',
    createdAt: Date.now()
  };

  const queueItem: SyncQueueItem = {
    queueId: crypto.randomUUID(),
    localEventId,
    operation: 'POST_MEDICATION_LOG',
    payloadJson: JSON.stringify(pendingEvent),
    idempotencyKey,
    priority: 1,
    attempts: 0,
    nextRetryAt: Date.now(),
    status: 'QUEUED'
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending_events', 'sync_queue'], 'readwrite');
    const pendingStore = tx.objectStore('pending_events');
    const queueStore = tx.objectStore('sync_queue');

    pendingStore.add(pendingEvent);
    queueStore.add(queueItem);

    tx.oncomplete = () => {
      // Dispatch custom window event to notify UI badge listeners
      window.dispatchEvent(new CustomEvent('jeevasetu:pending-sync-updated'));
      resolve(localEventId);
    };

    tx.onerror = () => reject(tx.error);
  });
}
```

---

### 10.5 Deterministic Reconnect Synchronization Pipeline

Synchronization is triggered automatically upon reconnection. Because raw browser network events can be misleading, the system executes a multi-stage validation sequence before replaying mutations.

```mermaid
flowchart TD
    OnlineEvent[navigator.onLine Event] --> ProbeCheck{Active HTTP Ping Probe}
    ProbeCheck -->|Timeout / Fails| RemainOffline[Retain Offline State]
    ProbeCheck -->|204 No Content OK| AcquireLock{Acquire Web Lock}
    
    AcquireLock -->|Contended| AbortRun[Abort: Another Tab Syncing]
    AcquireLock -->|Granted| FetchQueue[Fetch Pending Queue: FIFO Order]
    
    FetchQueue --> HasItems{Queue Empty?}
    HasItems -->|Yes| ReleaseLock[Release Lock & Emit Idle]
    HasItems -->|No| ProcessItem[Read Top Item]
    
    ProcessItem --> PostServer[POST /api/v1/sync/events with Idempotency Key]
    PostServer --> ResponseCheck{Server Response}
    
    ResponseCheck -->|200 / 201 Success| PurgeLocal[Purge from Pending & Queue]
    PurgeLocal --> UpdateLocalSnapshot[Update Cached Schedules]
    UpdateLocalSnapshot --> ProcessItem
    
    ResponseCheck -->|409 Conflict| RouteConflict[Trigger Conflict Handler]
    RouteConflict --> ProcessItem
    
    ResponseCheck -->|5xx / Net Drop| Backoff[Apply Exponential Backoff + Stop]
    Backoff --> ReleaseLock
```

#### 10.5.1 The Four-Stage Sync Lifecycle

##### Stage 1: Connectivity Detection (Dual-Verification)
1. The client registers listeners for `window.addEventListener('online', ...)`.
2. To eliminate false positives (e.g., captive Wi-Fi portals or zero-bandwidth links), the browser executes an active **Heartbeat Probe**:
   ```typescript
   async function verifyLiveConnectivity(): Promise<boolean> {
     if (!navigator.onLine) return false;
     try {
       const response = await fetch('/api/v1/health/ping', {
         method: 'HEAD',
         cache: 'no-store',
         signal: AbortSignal.timeout(2500)
       });
       return response.status === 200 || response.status === 204;
     } catch {
       return false;
     }
   }
   ```

##### Stage 2: Mutual Exclusion & Concurrency Control
To prevent concurrent sync loops across multiple browser tabs, the client acquires a cross-tab mutex via the **Web Locks API**:
```typescript
await navigator.locks.request('jeevasetu_sync_lock', { ifAvailable: true }, async (lock) => {
  if (!lock) {
    console.warn('[Sync] Another browser tab is executing synchronization.');
    return;
  }
  await executeQueueReplay();
});
```

##### Stage 3: Strict FIFO Queue Processing with Idempotency Keys
1. Items in `sync_queue` with status `'QUEUED'` are retrieved, sorted strictly by `createdAt` ascending.
2. For each pending item, an HTTP `POST` is dispatched to `/api/v1/sync/medication-events` accompanied by the `X-Idempotency-Key` header:
   ```http
   POST /api/v1/sync/medication-events HTTP/1.1
   Host: api.jeevasetu.org
   Authorization: Bearer <jwt>
   Content-Type: application/json
   X-Idempotency-Key: idem_pat901_sch102_1731647400000_c5a1a14b
   
   {
     "localEventId": "c5a1a14b-7411-447f-85eb-92cbf5443901",
     "patientId": "pat-901",
     "scheduleId": "sch-102",
     "medicationId": "med-554",
     "action": "TAKEN",
     "clientTimestamp": "2026-11-15T08:05:12.000Z",
     "recordedByUserId": "usr-caregiver-42",
     "notes": "Administered with warm water"
   }
   ```

##### Stage 4: Server Evaluation and State Reconciliation
The server receives the request and executes the following deterministic logic:
* **Duplicate Submission Check:** If the `X-Idempotency-Key` is already present in the server's processed transaction table, the server bypasses re-execution and responds with HTTP `200 OK`, returning the canonical persisted record.
* **No Conflict:** If no conflicting log exists for that schedule time slot, the event is committed to PostgreSQL/CockroachDB. The server responds with HTTP `201 Created`.
* **Conflict Encountered:** If another log already exists for that scheduled dose, the server invokes the clinical domain resolution engine (Section 10.6).
* **Local Purge:** Upon receiving HTTP 200/201, the client deletes the item from `sync_queue` and `pending_events`, updates `cached_schedules`, and broadcasts state changes to the UI.

#### 10.5.2 Reconnection Sync Engine Implementation
```typescript
// sync-engine.ts
import { openJeevasetuDB, PendingEvent, SyncQueueItem } from './idb-schema';

export class SyncEngine {
  private isRunning = false;

  public init() {
    window.addEventListener('online', () => this.triggerSync());
    // Fallback polling check every 60 seconds
    setInterval(() => this.triggerSync(), 60000);
  }

  public async triggerSync(): Promise<void> {
    if (this.isRunning) return;

    const isConnected = await this.verifyConnection();
    if (!isConnected) return;

    if ('locks' in navigator) {
      await navigator.locks.request('jeevasetu_sync_lock', { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        await this.processQueue();
      });
    } else {
      await this.processQueue();
    }
  }

  private async verifyConnection(): Promise<boolean> {
    if (!navigator.onLine) return false;
    try {
      const res = await fetch('/api/v1/health/ping', {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(3000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async processQueue(): Promise<void> {
    this.isRunning = true;
    window.dispatchEvent(new CustomEvent('jeevasetu:sync-status-changed', { detail: { state: 'SYNCING' } }));

    const db = await openJeevasetuDB();

    try {
      const items = await this.getQueuedItems(db);

      for (const item of items) {
        try {
          const payload: PendingEvent = JSON.parse(item.payloadJson);

          const response = await fetch('/api/v1/sync/medication-events', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Idempotency-Key': item.idempotencyKey
            },
            body: item.payloadJson
          });

          if (response.ok || response.status === 409) {
            const result = await response.json();
            
            if (response.status === 409 || result.conflict) {
              await this.handleServerConflict(db, item, result);
            } else {
              await this.purgeQueueItem(db, item.queueId, item.localEventId);
            }
          } else if (response.status >= 500) {
            // Server error: halt processing, apply exponential backoff
            await this.markRetry(db, item);
            break;
          }
        } catch (err) {
          console.error('[SyncEngine] Network transport failure during replay', err);
          break; // Stop loop until connectivity is re-established
        }
      }
    } finally {
      this.isRunning = false;
      window.dispatchEvent(new CustomEvent('jeevasetu:sync-status-changed', { detail: { state: 'IDLE' } }));
      window.dispatchEvent(new CustomEvent('jeevasetu:pending-sync-updated'));
    }
  }

  private getQueuedItems(db: IDBDatabase): Promise<SyncQueueItem[]> {
    return new Promise((resolve) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result as SyncQueueItem[]).sort((a, b) => a.priority - b.priority);
        resolve(sorted);
      };
    });
  }

  private purgeQueueItem(db: IDBDatabase, queueId: string, localEventId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sync_queue', 'pending_events'], 'readwrite');
      tx.objectStore('sync_queue').delete(queueId);
      tx.objectStore('pending_events').delete(localEventId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private markRetry(db: IDBDatabase, item: SyncQueueItem): Promise<void> {
    return new Promise((resolve) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      item.attempts += 1;
      item.nextRetryAt = Date.now() + Math.min(300000, 1000 * Math.pow(2, item.attempts));
      store.put(item);
      tx.oncomplete = () => resolve();
    });
  }

  private async handleServerConflict(db: IDBDatabase, item: SyncQueueItem, conflictPayload: any) {
    // Notify UI via event bus and purge pending mutation to avoid replay loops
    window.dispatchEvent(new CustomEvent('jeevasetu:sync-conflict', { detail: conflictPayload }));
    await this.purgeQueueItem(db, item.queueId, item.localEventId);
  }
}
```

---

### 10.6 Conflict Detection, Scenarios, and Domain Resolution Rules

In collaborative healthcare settings, multiple actors (e.g., patient, family caregiver, visiting nurse) interact with the same medication schedules across disconnected devices. JEEVASETU rejects naive last-write-wins (LWW) timestamp overwriting when safety is at stake, instead applying deterministic domain-specific resolution rules.

```
+----------------------------------------------------------------------------------------------------+
|                                    CONFLICT RESOLUTION MATRIX                                     |
+------------------------------------+-----------------------------------+---------------------------+
| Scenario                           | Resolution Strategy               | User Experience Outcome   |
+------------------------------------+-----------------------------------+---------------------------+
| Two users record "taken" for the   | First-Recorded Wins               | First record committed;   |
| exact same dose while offline      | (Earliest Valid Server Timestamp) | second user notified of   |
|                                    | Secondary event tagged DUPLICATE  | existing timestamp.       |
+------------------------------------+-----------------------------------+---------------------------+
| Schedule updated by clinician      | Historical Action Preserved       | Dose log preserved;       |
| while client was offline           | (Dose logged against Old Version);| "Schedule Updated" banner |
|                                    | Force cache refresh on reconnect  | prompts user to review.   |
+------------------------------------+-----------------------------------+---------------------------+
| User records "Taken" offline, but  | Safety-First Resolution:          | Action paused in Review   |
| server shows dose marked "Skipped" | Marked for Clinical Review;       | Drawer; Caregiver selects |
| by physician                       | Both logs recorded in audit trail | prevailing status.        |
+------------------------------------+-----------------------------------+---------------------------+
```

#### 10.6.1 Scenario A: Dual Offline Dose Logging (Patient & Caregiver)
* **The Context:** A patient logs their 08:00 AM Atorvastatin dose as "Taken" on their phone at 08:05 AM while disconnected. Concurrently, the visiting caregiver—unaware the patient took the dose—records the 08:00 AM Atorvastatin dose as "Taken" on a tablet at 08:12 AM while also disconnected.
* **The Server-Side Resolution:**
  1. The patient's device syncs first. The server creates the canonical event record: `Status: TAKEN, AdministeredAt: 08:05 AM, RecordedBy: Patient`.
  2. The caregiver's device reconnects and transmits its pending event for the same `scheduleId` and `scheduledDate`.
  3. The server detects that an administration event already exists for that schedule window.
  4. **Rule Applied: First-Recorded Wins with Non-Destructive Audit Retention.**
  5. The server flags the caregiver's submission as `SUPERSEDED_DUPLICATE`. The primary dose record remains attributed to the patient at 08:05 AM. The caregiver's log is archived into the historical audit log with status `NOTED_DUPLICATE` to ensure transparency.
  6. The server responds with HTTP `409 Conflict`:
     ```json
     {
       "conflict": "DOSE_ALREADY_RECORDED",
       "scheduleId": "sch-102",
       "existingEvent": {
         "recordedBy": "Patient (Ramesh Kumar)",
         "takenAt": "2026-11-15T08:05:00.000Z",
         "status": "TAKEN"
       },
       "message": "This dose was already logged as taken by Ramesh Kumar at 8:05 AM."
     }
     ```
* **Client UI Feedback:**
  The caregiver's client displays a non-blocking reconciliation modal:
  > **Dose Already Logged**  
  > *Atorvastatin 20mg (08:00 AM) was already marked as taken by Ramesh Kumar at 08:05 AM. Your entry has been merged into the audit trail.*

#### 10.6.2 Scenario B: Clinical Schedule Changed While Offline
* **The Context:** At 09:00 AM, the treating cardiologist updates the patient's schedule: Metformin is increased from 500mg to 1000mg, and the timing is adjusted from 01:00 PM to 02:00 PM. Meanwhile, the patient's phone is offline. At 01:05 PM, the patient takes the previously cached 500mg tablet and marks it as "Taken".
* **The Server-Side Resolution:**
  1. When the patient's phone reconnects at 02:30 PM, it transmits the pending event referencing `scheduleVersion: 1` (500mg at 01:00 PM).
  2. The server compares the payload's `scheduleVersion` against the active schedule (`scheduleVersion: 2`).
  3. **Rule Applied: Clinical Fact Preservation & Cache Invalidation.**
  4. The server accepts the mutation: it records that the patient ingested 500mg of Metformin at 01:05 PM against the historical schedule version. Physical drug ingestion cannot be retroactively erased.
  5. The server marks the administration log as `TAKEN_DEPRECATED_REGIMEN`.
  6. The response includes an updated snapshot of the schedule along with an invalidation directive:
     ```json
     {
       "status": "ACCEPTED_WITH_WARNING",
       "warningCode": "SCHEDULE_SUPERSEDED",
       "updatedSchedule": {
         "scheduleVersion": 2,
         "medicationName": "Metformin",
         "newDosage": "1000mg",
         "newScheduledTime": "14:00"
       }
     }
     ```
* **Client UI Feedback:**
  The client replaces its cached schedule in IndexedDB with Version 2 and immediately renders a prominent, persistent banner across the top of the dashboard:
  > ⚠️ **Prescription Schedule Updated**  
  > *Dr. Ananya Sharma modified this medication plan today. The dose taken at 1:05 PM was recorded under the previous 500mg instructions. Your active schedule is now updated to 1000mg at 2:00 PM.*

---

### 10.7 UI Indicators, Status Badges, and Error Surfaces

Offline operation demands continuous, unambiguous feedback. The user must always know:
1. Current connectivity status.
2. How many mutations are pending synchronization.
3. Whether synchronization is in progress.
4. Any conflicts requiring attention.

```
+-------------------------------------------------------------------------+
| [!] Offline Mode (3 actions pending)                       [Sync Now]   |
+-------------------------------------------------------------------------+
| TODAY'S MEDICATIONS                                                     |
|                                                                         |
| [✓] Metformin 500mg - 08:00 AM                                         |
|     Status: Taken at 08:04 AM  [ (●) Pending Sync ]                     |
|                                                                         |
| [ ] Amlodipine 5mg - 02:00 PM                                          |
|     Scheduled for 02:00 PM                                              |
+-------------------------------------------------------------------------+
```

#### 10.7.1 Status Indicator Specifications

| Visual Indicator | Placement | Trigger Condition | Visual Appearance |
| :--- | :--- | :--- | :--- |
| **Global Offline Banner** | Top of viewport (Sticky) | `!navigator.onLine` or active ping probe fails | Solid amber background (`#D97706`), white text, `CloudOff` icon, text: *"Working Offline — Changes saved locally"*. |
| **Syncing Active Pill** | Navigation header | `SyncEngine` actively executing replay | Blue background (`#2563EB`), rotating spinner icon, text: *"Syncing X offline records..."*. |
| **Pending Counter Badge** | Bottom navigation bar / Profile avatar | Count of items in `pending_events` $> 0$ | High-contrast pill badge with pending count (`Badge count={pendingCount}`). |
| **Item-Level Status Pill** | Individual medication card | Dose marked offline, awaiting sync | Amber outlined badge with a clock icon: `Pending Sync`. Replaced with green check `Synced` upon resolution. |
| **Conflict Alert Drawer** | Bottom slide-up sheet / Modal | Server returns `409 Conflict` on replay | Red warning banner with side-by-side comparison of local vs. server values and an *"Acknowledge"* button. |

#### 10.7.2 UI State Subscription Hook (React Example)
```typescript
// useOfflineSyncStatus.ts
import { useState, useEffect } from 'react';
import { openJeevasetuDB } from './idb-schema';

export interface OfflineStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
}

export function useOfflineSyncStatus(): OfflineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);

  const refreshPendingCount = async () => {
    try {
      const db = await openJeevasetuDB();
      const tx = db.transaction('pending_events', 'readonly');
      const countReq = tx.objectStore('pending_events').count();
      countReq.onsuccess = () => setPendingCount(countReq.result);
    } catch (e) {
      console.warn('Could not read pending count', e);
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    const handleSyncStatus = (e: Event) => {
      const customEvent = e as CustomEvent<{ state: 'SYNCING' | 'IDLE' }>;
      setIsSyncing(customEvent.detail.state === 'SYNCING');
      refreshPendingCount();
    };

    const handlePendingUpdated = () => refreshPendingCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('jeevasetu:sync-status-changed', handleSyncStatus);
    window.addEventListener('jeevasetu:pending-sync-updated', handlePendingUpdated);

    refreshPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('jeevasetu:sync-status-changed', handleSyncStatus);
      window.removeEventListener('jeevasetu:pending-sync-updated', handlePendingUpdated);
    };
  }, []);

  return { isOnline, isSyncing, pendingCount };
}
```

---

### 10.8 Service Worker Registration, Lifecycle, and Update Strategy

Deploying updates to healthcare PWAs requires caution. An automatic, unannounced page reload can interrupt a caregiver in the middle of logging critical medication doses, causing data loss or confusion.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application Core
    participant SW as Service Worker (New Version)
    participant UI as Update Banner UI
    actor User as Clinician
    
    App->>SW: Detect new sw.js on server during background check
    SW->>SW: Install Phase: Download new static shell assets
    SW->>SW: Transition to WAITING state (waiting worker)
    SW-->>App: Broadcast 'waiting' worker available
    App->>UI: Show Toast: "Update available. Reload to apply."
    User->>UI: Clicks "Update Now"
    UI->>SW: postMessage({ type: 'SKIP_WAITING' })
    SW->>SW: Activate Phase: Evict old caches
    SW-->>App: 'controllerchange' event fired
    App->>App: window.location.reload()
```

#### 10.8.1 Service Worker Registration and Update Cycle
1. **Registration:** The Service Worker is registered in the main bundle after window load to avoid contending with initial page paint bandwidth:
   ```typescript
   // register-sw.ts
   export async function registerServiceWorker() {
     if (!('serviceWorker' in navigator)) return;

     const registration = await navigator.serviceWorker.register('/sw.js', {
       scope: '/'
     });

     // Check for updates every 45 minutes
     setInterval(() => registration.update(), 45 * 60 * 1000);

     // Check for updates on tab focus / visibility return
     document.addEventListener('visibilitychange', () => {
       if (document.visibilityState === 'visible') {
         registration.update();
       }
     });

     listenForWaitingWorker(registration);
   }
   ```
2. **The Update Prompt Flow:**
   When a new `sw.js` is pushed to production, the browser downloads and installs it. The worker transitions to the `installed`/`waiting` state, blocked from activating because older tabs remain open.
3. **Safe Skip-Waiting Handshake:**
   The client UI listens for the waiting worker and displays a persistent, non-intrusive notification:
   > **System Update Available**  
   > *A new version of JEEVASETU is ready. Save current tasks and click to update.*  
   > `[Update Now]`
4. Upon clicking `[Update Now]`, the application transmits a postMessage:
   ```typescript
   waitingWorker.postMessage({ type: 'SKIP_WAITING' });
   ```
5. In `sw.js`, the worker handles the message:
   ```typescript
   self.addEventListener('message', (event) => {
     if (event.data && event.data.type === 'SKIP_WAITING') {
       self.skipWaiting();
     }
   });
   ```
6. The client listens for `navigator.serviceWorker.addEventListener('controllerchange')` and triggers a single, clean `window.location.reload()`.

#### 10.8.2 Atomic Cache Pruning on Activation
When the new Service Worker activates, it iterates through `caches.keys()` and purges all legacy caches that do not match the current version string:
```typescript
self.addEventListener('activate', (event: ExtendableEvent) => {
  const CURRENT_CACHES = ['jeevasetu-static-v1.4.2'];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!CURRENT_CACHES.includes(cacheName)) {
            console.info('[SW] Evicting deprecated cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
```

---

### 10.9 Architectural Deferrals and Strategic Trade-offs

To preserve software reliability and minimize maintenance overhead, specific advanced offline features are intentionally deferred from this implementation phase.

```
+----------------------------------------------------------------------------------------------------+
|                                    DEFERRED CAPABILITIES MATRIX                                    |
+------------------------------+----------------------------------+----------------------------------+
| Feature / Technology         | Deferral Rationale               | Planned Alternative / Mitigation |
+------------------------------+----------------------------------+----------------------------------+
| Full Offline App Shell       | Deep reporting modules, lab      | Targeted route caching for       |
| (All routes & analytics)     | charts, and video conferencing   | Schedule, Patient Dashboard,     |
|                              | bloat local storage footprints.  | and Medication Log cards only.   |
+------------------------------+----------------------------------+----------------------------------+
| Background Sync API          | Zero support in Apple WebKit     | Foreground reactive sync         |
| (SyncManager interface)      | (iOS Safari); non-standard       | engine triggered on resume,      |
|                              | across Android non-Chromium.     | heartbeat, and page focus.       |
+------------------------------+----------------------------------+----------------------------------+
| Web Push-Driven Sync         | Requires constant connectivity;  | Local schedule alarms powered by |
| (Silent Wakeup Notifications)| iOS battery-saver constraints    | client IndexedDB timers and      |
|                              | terminate background handlers.   | scheduled calendar sync.         |
+------------------------------+----------------------------------+----------------------------------+
```

#### 10.9.1 Deferral Rationale Details
1. **Full Offline App Shell:**
   Caching the entire JEEVASETU application bundle—including complex administrative panels, historical graphical charts, billing modules, and export engines—would push client storage footprints beyond 120MB. Caching is strictly limited to the core patient schedule and bedside logging shell (~4.5MB).
2. **Background Sync API (`SyncManager`):**
   While supported in Chromium-based desktop and Android browsers, `SyncManager` is completely absent from WebKit (iOS Safari) and Firefox. Architecting the primary sync pipeline around `SyncManager` would introduce severe platform fragmentation. Synchronization is instead driven by the cross-platform Foreground Sync Engine (`navigator.onLine` + visibility change + active heartbeat probes).
3. **Web Push-Driven Synchronization:**
   Relying on silent push notifications to trigger background client data fetches is fragile in mobile browsers, where aggressive OS battery management (e.g., iOS Low Power Mode, Xiaomi MIUI battery saver) silences or delays silent background messages. Dynamic client-side IndexedDB timers serve as the reliable alternative for local dose reminders.

---

### 10.10 Cross-Browser Compatibility and Platform Constraints (Safari/WebKit)

WebKit and iOS Safari introduce specific architectural limitations that directly impact offline-first web applications. The JEEVASETU platform implements tailored guardrails to address these platform constraints.

#### 10.10.1 Safari 7-Day Storage Eviction Policy (ITP)
Under Apple's Intelligent Tracking Prevention (ITP), if a user does not interact with a website within a seven-day window, Safari automatically deletes all client-side writable storage—including IndexedDB, Web SQL, and CacheStorage.

```
                    SAFARI STORAGE RETENTION RISK
 [Standard Safari Tab]  ──────>  Inactive for 7 Days  ──────>  [STORAGE PURGED]
 
 [Added to Home Screen (PWA)] ──────────────────────────────>  [STORAGE PERSISTED]
 [navigator.storage.persist()] ─────────────────────────────>  [STORAGE PERSISTED]
```

* **Mitigation 1: Persistent Storage Request:**
  Upon user login, the application invokes the StorageManager API to request persistent storage exemption:
  ```typescript
  async function requestPersistentStorage(): Promise<boolean> {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.info(`[Storage] Persistent quota granted: ${isPersisted}`);
      return isPersisted;
    }
    return false;
  }
  ```
* **Mitigation 2: PWA Installation Guidance:**
  When Safari is detected (`/iPad|iPhone|iPod/.test(navigator.userAgent)`), the UI presents an instructional banner prompting the user to **"Add to Home Screen"**. Standalone web applications installed on iOS are treated as independent applications and are exempt from standard ITP 7-day storage purges.
* **Mitigation 3: Re-Hydration Check on Initialization:**
  If the application detects that `cached_schedules` is unexpectedly empty despite a valid authorization token, it flags an eviction event and prioritizes a complete cold re-hydration fetch from the server.

#### 10.10.2 WebKit Service Worker Thread Termination
On iOS, the operating system aggressively terminates Service Worker threads when the browser tab is moved to the background or when device RAM pressure spikes.
* **Mitigation:** The application does not rely on long-running in-memory timers within the Service Worker. All queue state, retry counters, and timestamps are persisted to IndexedDB before any asynchronous task is initiated. If the thread is terminated mid-flight, the `SyncEngine` re-reads the persisted state from IndexedDB upon the next user resume.

#### 10.10.3 Safari IndexedDB Stability Constraints
* In iOS Safari private browsing modes (prior to iOS 17), IndexedDB operations would throw `QuotaExceededError` or have an effective quota of 0MB.
* **Mitigation:** The application wraps all IndexedDB initialization logic in try-catch blocks. If IndexedDB access is denied or unavailable, the application falls back gracefully to a transient in-memory storage adapter and renders a persistent warning informing the user that offline mutations cannot be retained across tab reloads while in private browsing mode.

---

### Summary Architectural Checklist for Engineering Implementation

| Implementation Area | Primary Technology / Standard | Production Verification Criteria |
| :--- | :--- | :--- |
| **Asset Shell Caching** | Service Worker `CacheStorage` | Core static assets load in $< 200\text{ ms}$ under simulated network disconnection. |
| **Clinical Fallback** | IndexedDB (`cached_schedules`) | Active day schedule renders reliably during airplane mode. |
| **Mutation Integrity** | IndexedDB (`pending_events`) | Doses logged offline persist across browser restarts and device reboots. |
| **Sync Deduplication** | `X-Idempotency-Key` (UUIDv4) | Replaying the same mutation payload 5 times generates exactly 1 server record. |
| **Concurrency Lock** | Web Locks API (`navigator.locks`) | Multiple open tabs do not trigger duplicate network sync requests. |
| **Apple WebKit Guard** | `navigator.storage.persist()` | Storage persistence requested on login; PWA installation flow surfaced on iOS. |


---\n
## 11. Care Timeline and Audit-Event Architecture

### 11.1 Architectural Overview & Core Tenets

The **Care Timeline and Audit-Event Subsystem** serves as the central nervous system for JEEVASETU's collaborative care delivery. In chronic and elder care ecosystems, care delivery is inherently distributed across multiple human actors (patients, primary family caregivers, secondary kin, home nurses, clinicians, and pharmacists) and automated agents (medication adherence engines, IoT device bridges, and clinical alert dispatchers).

The primary architectural mandate of this subsystem is to maintain a unified, tamper-resistant, chronological activity ledger that provides transparent situational awareness while satisfying stringent medical auditability requirements (e.g., DISHA, HIPAA, and ISO 27799).

```mermaid
flowchart TD
    subgraph EventProducers ["Event Producers"]
        UI_Manual["Caregiver / Patient App\n(Manual Action)"]
        Offline_Sync["Offline-Sync Engine\n(Background Reconciler)"]
        Cloud_Workers["Cloud Functions / Workers\n(Automation Engine)"]
    end

    subgraph SecurityBoundary ["Security & Ingestion Boundary"]
        SecRules["Firestore Security Rules\n• Immutability (create-only)\n• Actor Attribution Check\n• Role & Access Verification"]
    end

    subgraph StorageLayer ["Firestore Persistence Layer"]
        SubColl["/patients/{patientId}/care_events/{eventId}\n(Isolated Sub-Collection)"]
        Snapshots["Self-Contained Snapshots\n(Survives Entity Deletion)"]
    end

    subgraph TimelineConsumers ["Timeline Consumers"]
        MobileFeed["Mobile Care Feed\n(Day-Grouped, Color-Coded)"]
        AuditConsole["Clinical Audit View\n(Paginated, Filterable)"]
        RealtimeSync["Realtime Cross-Caregiver\nListener"]
    end

    UI_Manual -->|Write: source=manual| SecRules
    Offline_Sync -->|Flush: source=offline-sync| SecRules
    Cloud_Workers -->|Admin SDK: source=system| SecRules
    SecRules --> SubColl
    SubColl --- Snapshots
    SubColl -->|Cursor Queries: orderBy desc| MobileFeed
    SubColl -->|Filtered Queries: type/actor| AuditConsole
    SubColl -->|Snapshot Listener| RealtimeSync
```

#### Core Architectural Tenets
1. **Append-Only Immutability**: Care events represent historical reality at a point in time. Once written, events can never be edited, overwritten, or deleted by any user or administrator. Compensating events (e.g., a retraction or corrective note) are written as new ledger entries.
2. **Zero-Trust Actor Attribution**: Every event deterministically binds **WHO** performed the action (authenticated UID and verified role) and **HOW** it entered the system (manual touchpoint, automated cron/cloud trigger, or local offline-sync queue).
3. **Contextual Self-Containment (Entity Snapshotting)**: Events must not rely solely on foreign key lookups. If a medication schedule, appointment, or caregiver account is modified or deleted in the future, historical care events must retain an immutable snapshot of the entity's state at the moment the event occurred.
4. **Offline First with Reconciled Lineage**: Given intermittent network connectivity in home and rural care environments, events recorded offline retain both the client-recorded local timestamp and the authoritative server ingestion timestamp, tagged explicitly with the `offline-sync` provenance source.

---

### 11.2 Care Event Taxonomy & Classification Matrix

The platform classifies all care activities into a standardized, closed taxonomy comprising 18 distinct event types spanning five operational domains:

| Event Type | Domain | Description & Clinical Trigger | Primary Actor Roles | Default Severity / UI Priority |
| :--- | :--- | :--- | :--- | :--- |
| `medication_taken` | Medication Adherence | Dose explicitly marked as consumed by patient or caregiver. | `patient`, `primary_caregiver`, `secondary_caregiver` | Normal (Success / Green) |
| `medication_skipped` | Medication Adherence | Dose explicitly bypassed by user with a mandatory clinical reason. | `patient`, `primary_caregiver`, `clinician` | Warning (Amber) |
| `medication_missed` | Medication Adherence | Intake window lapsed without acknowledgment; flagged by adherence worker. | `system_worker` | Critical (Crimson) |
| `medication_created` | Medication Regimen | New prescription or schedule configured in the patient record. | `clinician`, `primary_caregiver` | Informational (Slate) |
| `medication_updated` | Medication Regimen | Dosage, timing, frequency, or instructions modified. | `clinician`, `primary_caregiver` | Warning (Amber) |
| `medication_verified` | Medication Regimen | Regimen cross-checked and approved by an attending clinician or pharmacist. | `clinician`, `pharmacist` | Normal (Success / Green) |
| `appointment_created` | Care Encounters | New teleconsultation or hospital visit booked. | `patient`, `primary_caregiver`, `clinician` | Informational (Cobalt) |
| `appointment_updated` | Care Encounters | Appointment rescheduled, provider reassigned, or location modified. | `patient`, `primary_caregiver`, `clinician` | Warning (Amber) |
| `appointment_completed`| Care Encounters | Encounter concluded; consultation summary and instructions attached. | `clinician` | Normal (Success / Green) |
| `caregiver_assigned` | Access & Team | New caregiver invited and linked to the patient's care circle. | `patient`, `primary_caregiver`, `admin` | Informational (Violet) |
| `caregiver_handover` | Access & Team | Active shift or primary care responsibility transferred between caregivers. | `primary_caregiver`, `secondary_caregiver` | High (Purple) |
| `access_granted` | Access & Team | Explicit clinical or viewing permissions authorized for a third party. | `patient`, `primary_caregiver`, `admin` | High (Security / Amber) |
| `access_revoked` | Access & Team | Third-party access revoked or revoked due to authorization lapse. | `patient`, `primary_caregiver`, `admin` | Critical (Security / Red) |
| `profile_updated` | Patient Identity | Vital profile data (allergies, emergency contacts, blood group) modified. | `patient`, `primary_caregiver`, `clinician` | Warning (Amber) |
| `reminder_sent` | Notifications | Notification successfully dispatched to patient/caregiver device. | `system_worker` | Low (Subtle / Slate) |
| `reminder_failed` | Notifications | Notification dispatch failed (FCM token expired, SMS gateway reject). | `system_worker` | Warning (Amber) |
| `schedule_changed` | Routine Management| Overall patient routine, care shift, or recurring reminder window shifted. | `primary_caregiver`, `clinician` | Informational (Slate) |
| `care_gap_detected` | Clinical Safety | System detection of protocol non-compliance, drug interaction, or lapse. | `system_worker` | Urgent / Critical (Red) |

---

### 11.3 Canonical Event Document Schema

All events are stored as schema-validated documents adhering to a strict discriminated union pattern.

#### 11.3.1 TypeScript Schema Specification

```typescript
export type CareEventType =
  | 'medication_taken'
  | 'medication_skipped'
  | 'medication_missed'
  | 'medication_created'
  | 'medication_updated'
  | 'medication_verified'
  | 'appointment_created'
  | 'appointment_updated'
  | 'appointment_completed'
  | 'caregiver_assigned'
  | 'caregiver_handover'
  | 'access_granted'
  | 'access_revoked'
  | 'profile_updated'
  | 'reminder_sent'
  | 'reminder_failed'
  | 'schedule_changed'
  | 'care_gap_detected';

export type ActorRole =
  | 'patient'
  | 'primary_caregiver'
  | 'secondary_caregiver'
  | 'clinician'
  | 'pharmacist'
  | 'system_worker'
  | 'admin';

export type EventSource = 'manual' | 'system' | 'offline-sync';

export interface CareEventDocument<TMetadata = Record<string, any>> {
  /** Globally unique, time-ordered identifier (UUIDv7 or deterministic hash) */
  eventId: string;

  /** Patient partition key */
  patientId: string;

  /** Discriminated taxonomy type */
  eventType: CareEventType;

  /** Canonical UID of the acting entity (User UID or System Worker ID) */
  actorId: string;

  /** Role assumed by the actor at the exact instant of event creation */
  actorRole: ActorRole;

  /** Authoritative server timestamp (Firestore FieldValue.serverTimestamp()) */
  timestamp: FirebaseFirestore.Timestamp;

  /** Provenance channel indicating how the event reached the backend */
  source: EventSource;

  /** Domain-specific payload containing immutable snapshots of related entities */
  metadata: TMetadata;
}
```

#### 11.3.2 Concrete Document Payloads

##### Example 1: `medication_taken` (Captured Offline, Reconciled Online)
```json
{
  "eventId": "018f4a2d-7c3b-7000-84a2-e67c8234ab01",
  "patientId": "pt_99214_blr",
  "eventType": "medication_taken",
  "actorId": "usr_cg_88120",
  "actorRole": "primary_caregiver",
  "timestamp": "2026-11-15T03:32:15.000Z",
  "source": "offline-sync",
  "metadata": {
    "scheduleId": "sch_metformin_morning_8am",
    "medicationId": "med_metformin_500",
    "entitySnapshot": {
      "drugName": "Metformin Hydrochloride",
      "dosage": "500 mg",
      "route": "oral",
      "instructions": "Take with breakfast"
    },
    "scheduledTime": "2026-11-15T02:30:00.000Z",
    "actualTakenTime": "2026-11-15T02:45:00.000Z",
    "clientReportedTimestamp": "2026-11-15T02:45:12.110Z",
    "offlineSyncId": "sync_batch_9921_uuid4",
    "verificationPhotoUrl": "gs://jeevasetu-vault/verification/pt_99214/dose_snap_8812.jpg",
    "verificationMethod": "caregiver_administered"
  }
}
```

##### Example 2: `caregiver_handover` (Active Duty Shift Transition)
```json
{
  "eventId": "018f4a30-8a1c-7000-91bc-341e9821ef99",
  "patientId": "pt_99214_blr",
  "eventType": "caregiver_handover",
  "actorId": "usr_cg_88120",
  "actorRole": "primary_caregiver",
  "timestamp": "2026-11-15T08:00:00.000Z",
  "source": "manual",
  "metadata": {
    "outgoingCaregiverId": "usr_cg_88120",
    "incomingCaregiverId": "usr_cg_55412",
    "incomingCaregiverName": "Lakshmi Narayanan",
    "shiftDurationHours": 8,
    "handoverNotes": "Morning vitals stable (BP 124/82). Metformin administered at 8:15 AM. Patient complained of mild knee stiffness after walking.",
    "pendingTasks": [
      "Prepare low-sodium lunch by 1:00 PM",
      "Assist with 3:00 PM physiotherapy session"
    ],
    "ackToken": "ack_88120_55412_20261115"
  }
}
```

##### Example 3: `care_gap_detected` (Rule Engine Detection)
```json
{
  "eventId": "018f4a35-4f21-7000-a20d-773a912bb011",
  "patientId": "pt_99214_blr",
  "eventType": "care_gap_detected",
  "actorId": "worker_clinical_rule_engine",
  "actorRole": "system_worker",
  "timestamp": "2026-11-15T10:00:00.000Z",
  "source": "system",
  "metadata": {
    "ruleId": "RULE_DIABETES_CONSECUTIVE_MISSED_DOSES",
    "severity": "critical",
    "careGapType": "adherence_breakdown",
    "triggerCondition": "3 consecutive missed or skipped doses of anti-glycemic medication within 48 hours",
    "affectedMedication": {
      "medicationId": "med_metformin_500",
      "drugName": "Metformin Hydrochloride"
    },
    "missedEventIds": [
      "018f4900-1111-7000-84a2-e67c82340001",
      "018f4980-2222-7000-84a2-e67c82340002",
      "018f4a00-3333-7000-84a2-e67c82340003"
    ],
    "recommendedAction": "Immediate primary caregiver phone outreach and alert escalation to Dr. R. Verma."
  }
}
```

---

### 11.4 Storage Architecture & Hierarchy Justification

A fundamental architectural choice in Firestore is deciding between a **Root-Level Collection** with `patientId` attribute segregation versus a **Dedicated Sub-Collection** nested under each patient document.

#### 11.4.1 Architectural Trade-Off Analysis

| Architectural Dimension | Option A: Root Collection (`/care_events/{eventId}`) | Option B: Patient Sub-Collection (`/patients/{patientId}/care_events/{eventId}`) |
| :--- | :--- | :--- |
| **Security Rules Overhead** | High complexity. Every read/query requires validating `request.auth.uid` against a cross-document lookup (`get(/databases/.../patients/$(resource.data.patientId))`) or embedding large caregiver authorization arrays inside every event. | Low complexity. Security rules evaluate authorization at the path level: `match /patients/{patientId}/care_events/{eventId}` inherits parent access directly without document re-evaluation. |
| **Tenant Isolation & Partitioning**| Risk of accidental multi-tenant data leaks if a query omits the mandatory `where('patientId', '==', x)` clause. | Hard isolation guaranteed by storage hierarchy. Accidental cross-patient data exposure is impossible in standard path queries. |
| **Index Footprint & Write Cost** | Massive index table. Every composite index must include `patientId ASC` as its leading equality field, increasing index write amplification across all tenants. | Scoped indexes. Indexes are built per sub-collection, drastically reducing composite index storage and per-write latency overhead. |
| **Entity Deletion Survivability** | High isolation from patient record lifecycle. | **Identical survivability in Firestore**. Firestore sub-collections are distinct physical documents. Deleting `/patients/{patientId}` does **not** delete nested sub-collections. |
| **Cross-Patient Caregiver Views** | Native support. Querying events across all patients assigned to a single nurse is straightforward: `where('actorId', '==', nurseId)`. | Supported with zero compromise via **Collection Group Queries** (`db.collectionGroup('care_events').where('actorId', '==', nurseId)`). |
| **Offline Cache Footprint** | Offline SQLite/IndexedDB stores a monolithic table; selective client cache pruning requires complex predicate filters. | Offline cache neatly partitions data by sub-collection path, allowing easy evictions and synchronization boundaries per patient. |

#### 11.4.2 Architectural Decision: Sub-Collection Pattern
**Selected Pattern**: **Dedicated Sub-Collection** (`/patients/{patientId}/care_events/{eventId}`).

**Justification**:
1. **Zero-Trust Security & Rule Performance**: In JEEVASETU, role-based access to a patient’s health record changes dynamically (e.g., shifts end, family revokes access). Evaluating permissions at `/patients/{patientId}/care_events/{eventId}` allows security rules to check authorization once per path using cached patient metadata. Root-level collections would require security rules to re-fetch or decode patient context on every document read, inflating read latency and billing costs.
2. **Deterministic Partitioning**: Chronic eldercare generates hundreds of events per patient monthly. Sub-collections ensure that query results are structurally constrained to a single patient partition at the engine level.
3. **Audit Record Preservation**: In Firestore's document-store model, sub-collections are entirely decoupled from parent document lifecycles. Even if a patient record is soft-deleted or marked inactive, all documents under `/patients/{patientId}/care_events` remain physically preserved and cryptographically intact.
4. **Collection Group Flexibility**: For platform auditors, clinic managers, or multi-patient caregivers, Firestore's `collectionGroup('care_events')` query index provides unified cross-patient querying without sacrificing partition boundaries.

---

### 11.5 Write Patterns, Immutability & Audit Integrity

#### 11.5.1 The Immutable Ledger Pattern
The care timeline operates strictly under an **append-only ledger paradigm**. 
- **No Document Edits (`update`)**: Existing events are frozen in perpetuity.
- **No Document Deletes (`delete`)**: Neither patients, family members, nor administrators possess delete rights.
- **Compensating Events**: If a caregiver mistakenly logs a `medication_taken` event, they cannot modify or remove it. Instead, they log a `medication_skipped` or an administrative correction event with explicit reference in `metadata.supersedesEventId = "018f..."` explaining the mistake. The UI visualizes both the error and the correction, maintaining transparent accountability.

#### 11.5.2 Production Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper function: Verify if user is an authorized caregiver or patient
    function isAuthorizedMember(patientId) {
      let patientDoc = get(/databases/$(database)/documents/patients/$(patientId));
      return request.auth != null && (
        request.auth.uid == patientId ||
        request.auth.uid in patientDoc.data.authorizedCaregiverIds ||
        request.auth.token.role == 'clinician'
      );
    }

    match /patients/{patientId}/care_events/{eventId} {

      // ALLOW READ: Authorized circle members only
      allow read: if isAuthorizedMember(patientId);

      // ALLOW CREATE: Strict validation of immutability and attribution
      allow create: if isAuthorizedMember(patientId)
        // 1. Enforce payload binding
        && request.resource.data.patientId == patientId
        && request.resource.data.eventId == eventId
        
        // 2. Enforce authentic actor attribution (caller must not spoof actorId)
        && (
          (request.resource.data.source == 'manual' && request.resource.data.actorId == request.auth.uid) ||
          (request.resource.data.source == 'offline-sync' && request.resource.data.actorId == request.auth.uid) ||
          (request.resource.data.source == 'system' && request.auth.token.admin == true)
        )
        
        // 3. Enforce Server Authoritative Timestamp
        && request.resource.data.timestamp == request.time
        
        // 4. Validate closed event taxonomy
        && request.resource.data.eventType in [
          'medication_taken', 'medication_skipped', 'medication_missed',
          'medication_created', 'medication_updated', 'medication_verified',
          'appointment_created', 'appointment_updated', 'appointment_completed',
          'caregiver_assigned', 'caregiver_handover', 'access_granted',
          'access_revoked', 'profile_updated', 'reminder_sent',
          'reminder_failed', 'schedule_changed', 'care_gap_detected'
        ]
        
        // 5. Source validation
        && request.resource.data.source in ['manual', 'system', 'offline-sync'];

      // STRICTLY DISALLOW UPDATES AND DELETES: Audit Ledger is Immutable
      allow update: if false;
      allow delete: if false;
    }
  }
}
```

#### 11.5.3 Entity Deletion Survivability (Self-Contained Snapshots)
A major vulnerability in naive audit architectures is storing relational foreign keys (e.g., `medicationId: "med_123"`). If a clinician deletes "Metformin 500mg" from the patient's active prescriptions, historical audit entries reading `Medication med_123 taken` become meaningless or break UI rendering.

To solve this, JEEVASETU mandates **Denormalized Snapshotting**:
- Every event writing to `care_events` embeds a frozen `entitySnapshot` within its `metadata`.
- For medications: includes drug name, formulation, dosage, prescribing doctor, and instruction strings at the moment of intake.
- For appointments: includes clinic name, doctor name, specialization, and scheduled slot.
- For caregiver interactions: records caregiver display name, verified phone number, and relationship badge.
- As a result, the care timeline can render historic records with 100% fidelity even if the parent patient profile, prescriptions, and caregiver accounts are soft-deleted or permanently archived.

#### 11.5.4 Idempotency & Offline Sync Reconciliation
Mobile devices running in low-connectivity environments queue write operations in a local persistent SQLite queue. To prevent duplicate events during network retries:
1. **Client-Deterministic Event IDs**: The client generates `eventId` using UUIDv7 (time-ordered) or a SHA-256 hash of `(patientId + eventType + scheduleId + scheduledDoseTime)`.
2. **Idempotent Upsert Guard**: Writing to Firestore via `.doc(eventId).create()` ensures that retried network packets result in an immediate `ALREADY_EXISTS` no-op rather than duplicate timeline entries.
3. **Timestamp Integrity**: The document preserves both:
   - `metadata.clientReportedTimestamp`: When the user physically pressed the button offline.
   - `timestamp`: When the Firestore ingestion node accepted and committed the transaction.

---

### 11.6 Query Patterns, Cursor Pagination & Indexing Strategy

#### 11.6.1 Query Access Patterns
The Care Timeline UI requires four primary query profiles:
1. **Standard Chronological Feed**: Reverse-chronological timeline of all patient events.
2. **Filtered by Event Type**: Isolating clinical adherence (e.g., only show `medication_*`), appointments, or security events.
3. **Filtered by Actor**: Auditing actions performed by a specific home nurse or family member.
4. **Date-Bounded Auditing**: Clinical consultations reviewing events between two dates.

#### 11.6.2 Indexing Configuration (`firestore.indexes.json`)
Because all timeline queries run within the sub-collection `/patients/{patientId}/care_events`, composite indexes do not require `patientId` as an explicit field. The following indexes are deployed:

```json
{
  "indexes": [
    {
      "collectionGroup": "care_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "care_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "eventType", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "care_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "actorRole", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "care_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "actorId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "care_events",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "actorId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ]
}
```

*Note: The final `COLLECTION_GROUP` index enables enterprise clinic dashboards to query all actions performed by a single clinician across all patient boundaries.*

#### 11.6.3 Cursor-Based Pagination Implementation
Offset-based pagination (`offset(50)`) is strictly forbidden due to linear $O(N)$ read billing and performance degradation in Firestore. All timeline feeds utilize document cursor pagination (`startAfter`).

```typescript
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  where,
  DocumentSnapshot
} from 'firebase/firestore';

const PAGE_SIZE = 25;

export async function fetchCareTimelinePage(
  patientId: string,
  lastVisibleDoc: DocumentSnapshot | null = null,
  filterType: CareEventType | null = null,
  filterActorRole: ActorRole | null = null
) {
  const eventsRef = collection(db, `patients/${patientId}/care_events`);
  
  let q = query(eventsRef, orderBy('timestamp', 'desc'));

  if (filterType) {
    q = query(q, where('eventType', '==', filterType));
  } else if (filterActorRole) {
    q = query(q, where('actorRole', '==', filterActorRole));
  }

  if (lastVisibleDoc) {
    q = query(q, startAfter(lastVisibleDoc));
  }

  q = query(q, limit(PAGE_SIZE));

  const querySnapshot = await getDocs(q);
  const events = querySnapshot.docs.map(doc => doc.data() as CareEventDocument);
  const nextCursor = querySnapshot.docs.length === PAGE_SIZE 
    ? querySnapshot.docs[querySnapshot.docs.length - 1] 
    : null;

  return { events, nextCursor };
}
```

---

### 11.7 Care Timeline User Interface Architecture

The Care Timeline UI translates raw audit documents into an intuitive, stress-free interface for elderly users and multi-generational caregivers.

```
+-----------------------------------------------------------------------+
|  TODAY - 15 NOVEMBER 2026                                            |
+-----------------------------------------------------------------------+
| [10:00 AM] [CRITICAL] CARE GAP DETECTED                        [ v ]  |
|   * Alert: 3 Consecutive Missed Doses of Metformin 500mg              |
|   * Triggered by: Automated Adherence Safety Worker                   |
+-----------------------------------------------------------------------+
| [08:15 AM] [NORMAL]   MEDICATION TAKEN                         [ ^ ]  |
|   * Metformin 500mg - 1 Tablet (Oral)                                 |
|   * Administered by: Sunita Sharma (Primary Caregiver)                |
|   -----------------------------------------------------------------   |
|   Expanded Details:                                                   |
|   - Scheduled Time: 08:00 AM | Taken At: 08:15 AM (15 min delay)      |
|   - Ingestion Channel: Offline-Sync (Reconciled at 08:32 AM)          |
|   - Verification: Photo Verified [View Image]                         |
|   - Event ID: 018f4a2d-7c3b-7000-84a2-e67c8234ab01                   |
+-----------------------------------------------------------------------+
| [08:00 AM] [INFO]     CAREGIVER HANDOVER                       [ v ]  |
|   * Shift transition from Sunita Sharma to Lakshmi Narayanan          |
+-----------------------------------------------------------------------+
|  YESTERDAY - 14 NOVEMBER 2026                                         |
+-----------------------------------------------------------------------+
| [06:30 PM] [WARNING]  MEDICATION SKIPPED                       [ v ]  |
|   * Amlodipine 5mg (Patient reported mild nausea)                     |
+-----------------------------------------------------------------------+
```

#### 11.7.1 Day-Grouped Bucketing
- Events are partitioned into temporal buckets: **Today**, **Yesterday**, and localized date headers (e.g., "12 November 2026") based on the client's local timezone.
- Grouping occurs client-side using the `timestamp` field, ensuring identical grouping across web and mobile.

#### 11.7.2 Semantic Color-Coding & Iconography Matrix
Every card in the timeline displays a distinct color border, background tint, and semantic icon:
- **Emerald Green (`#10B981`)**: Positive adherence and verified completions (`medication_taken`, `appointment_completed`, `medication_verified`).
- **Amber Warning (`#F59E0B`)**: Deviations requiring attention (`medication_skipped`, `medication_updated`, `appointment_updated`, `profile_updated`).
- **Crimson Critical (`#EF4444`)**: Unresolved adherence lapses and clinical safety alerts (`medication_missed`, `care_gap_detected`, `access_revoked`, `reminder_failed`).
- **Cobalt Blue (`#3B82F6`)**: Clinical encounters and logistics (`appointment_created`).
- **Royal Violet (`#8B5CF6`)**: Care team governance and transitions (`caregiver_assigned`, `caregiver_handover`, `access_granted`).
- **Cool Slate (`#64748B`)**: Administrative reminders and background operations (`reminder_sent`, `schedule_changed`).

#### 11.7.3 Progressive Disclosure (Expandable Accordion View)
1. **Collapsed Summary Card**: Displays time, color badge, title, concise entity string (e.g., "Metformin 500mg"), and primary actor attribution pill (`By Sunita (Caregiver)`).
2. **Expanded Audit Detail Tray**: Touching the card reveals the underlying audit record:
   - **Exact Temporal Coordinates**: Difference between scheduled time and actual execution time.
   - **Ingestion Provenance**: `manual`, `system`, or `offline-sync` with batch transmission ID.
   - **Clinical Snapshots**: Full dosage, drug strength, doctor instructions, and photo verification links.
   - **System Audit Metadata**: Immutable `eventId` and cryptographic receipt token.

---

### 11.8 Performance, Scalability & Caching

1. **Sub-Collection Write Distribution**: Firestore guarantees up to 10,000 writes/second across an entire database instance, but restricts writes to any single document to 1 write/second. Storing events as individual documents within sub-collections distributes writes evenly, avoiding write-rate bottlenecking during simultaneous caregiver check-ins.
2. **Page-Size Constraint**: Query limit is locked at `PAGE_SIZE = 25`. This preserves client memory, guarantees sub-100ms render speeds on budget mobile devices, and caps network payload sizes below 35 KB per page.
3. **Local Cache Persistence**: Both Flutter and React Native mobile clients configure Firestore persistent offline caching:
   - Enables instant rendering of the timeline feed from disk before hitting the network.
   - Pending offline actions render optimistically with a subtle "Pending Sync" spinner icon, transitioning to "Synced" as soon as the offline queue is committed.
4. **Read Quota Optimization**: Timeline feeds do not attach unbounded real-time snapshot listeners to historical queries. A real-time listener is attached exclusively to the **top 10 events of "Today"**, while older records are fetched on-demand via cursor-based scrolling.

---

### 11.9 Deferred Capabilities (Strategic Phasing)

To deliver a reliable core ledger while minimizing architectural complexity in the initial rollout, specific non-critical event features are explicitly deferred:

```mermaid
flowchart LR
    subgraph Phase1 ["Phase 1: Core System (Now)"]
        Ledger["Append-Only Ledger\n(Sub-Collections)"]
        Attribution["Actor Attribution\n(WHO & HOW)"]
        CursorUI["Paginated Timeline UI\n(Day-Grouped)"]
    end

    subgraph Phase2 ["Phase 2: Aggregation & Intelligence"]
        Rollups["Adherence Rollups\n(Daily / Weekly Streaks)"]
        BigQuery["BigQuery Streaming\n(OLAP & Cohort Analytics)"]
    end

    subgraph Phase3 ["Phase 3: Formal Interoperability"]
        FHIR["FHIR R4 Provenance\n& Export Engine"]
        PDF["Legal PDF Audit Exporter"]
    end

    Phase1 -.-> Phase2 -.-> Phase3
```

1. **Pre-Computed Event Aggregation & Daily Rollups (Deferred to Phase 2)**:
   - *Rationale*: Calculating metrics like "Current Adherence Streak: 14 Days" or "Monthly Care Compliance: 94%" directly over raw audit streams at runtime is expensive. In Phase 2, a Cloud Function trigger will maintain a separate `patients/{patientId}/metrics/adherence_summary` document updated asynchronously on event writes.
2. **Downstream Analytics & OLAP Streaming (Deferred to Phase 2)**:
   - *Rationale*: Firestore is an operational OLTP datastore, not an analytical engine. Cohort adherence trends, demographic health patterns, and predictive risk modeling will be handled by streaming events via Firebase Extensions into Google BigQuery in Phase 2.
3. **Regulatory Audit Export Engine (Deferred to Phase 2.5)**:
   - *Rationale*: Formal generation of signed PDF clinical logs, CSV exports for insurance claims, and FHIR R4 `Provenance` / `DiagnosticReport` bundle serializations will be decoupled into a dedicated asynchronous export service. The Phase 1 ledger document structure is intentionally designed with full snapshotting so it can feed this export pipeline without retroactive schema migrations.


---\n
# 12. Caregiver Handover Workflow

The **Caregiver Handover Workflow** is the clinical and operational backbone of JEEVASETU's non-stationary care coordination architecture. In geriatric care, fragmented transitions between family members, professional home nurses, and assisted-living aides represent the highest risk factor for adverse drug events, missed clinical deteriorations, and critical care gaps. 

This section establishes an end-to-end, deterministic specification for caregiver responsibility assignment, stateful shift handovers, automated clinical shift summarization, real-time care gap detection, and failure mitigation.

---

## 12.1 Caregiver Responsibility & Assignment Data Model

The JEEVASETU care assignment data model guarantees explicit accountability, chronological immutability, and auditable lineage across multi-stakeholder care teams.

### 12.1.1 Core TypeScript Interfaces & Enums

```typescript
// types/caregiver-assignment.ts

export type AssignmentStatus =
  | 'PENDING'         // Created by Family/Coordinator; awaiting caregiver confirmation
  | 'ACKNOWLEDGED'    // Caregiver accepted terms and schedule; shift not yet started
  | 'ACTIVE'          // Caregiver checked in; actively responsible for the elder
  | 'HANDOVER_INIT'   // Outgoing caregiver drafted handover summary; waiting for incoming sign-off
  | 'HANDED_OVER'     // Handover validated and accepted by incoming caregiver
  | 'COMPLETED'       // Shift concluded without requiring incoming successor (e.g., family resumed custody)
  | 'DECLINED'        // Assigned caregiver rejected the assignment
  | 'CANCELLED';      // Revoked by primary family member or coordinator prior to activation

export type ResponsibilityType =
  | 'MEDICATION_ADMINISTRATION'  // High-risk: Requires medication pass verification
  | 'VITAL_MONITORING'           // BP, SpO2, Blood Glucose, Pulse, Temperature
  | 'MOBILITY_ASSISTANCE'        // Ambulation, transfers, fall prevention
  | 'ADL_SUPPORT'                // Activities of Daily Living (bathing, toileting, hygiene)
  | 'NUTRITION_HYDRATION'        // Meal prep, dietary restriction enforcement, fluid balance
  | 'COGNITIVE_ENGAGEMENT'       // Dementia redirection, companionship, memory exercises
  | 'SPECIALIZED_CLINICAL_CARE'  // Wound dressing, catheter care, insulin injection (requires RN/LPN)
  | 'EMERGENCY_STANDBY';         // Overnight passive monitoring with active alert response

export type CaregiverType = 
  | 'PRIMARY_FAMILY'             // Kin with full administrative privileges
  | 'SECONDARY_FAMILY'           // Auxiliary family member / relative
  | 'PROFESSIONAL_NURSE'         // Certified clinical nurse (GNM/BSc Nursing)
  | 'CERTIFIED_AIDE'             // General duty assistant / home health aide
  | 'COMMUNITY_VOLUNTEER';       // Community welfare worker

export interface ResponsibilityItem {
  type: ResponsibilityType;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  instructions?: string;
  mandatoryProtocols: string[];   // e.g., ["VERIFY_5_RIGHTS_OF_MEDICATION", "FALL_RISK_GAIT_BELT"]
  estimatedDurationMinutes?: number;
}

export interface ShiftWindow {
  scheduledStart: string;         // ISO 8601 UTC timestamp
  scheduledEnd: string;           // ISO 8601 UTC timestamp
  actualCheckIn?: string;         // ISO 8601 UTC timestamp
  actualCheckOut?: string;        // ISO 8601 UTC timestamp
  gracePeriodMinutes: number;     // Tolerance before flagging no-show (default: 15)
}

export interface CaregiverAssignment {
  id: string;                     // UUIDv4
  elderId: string;                // Reference to Elderly Profile
  caregiverId: string;            // Reference to User/Caregiver entity
  assignedByUserId: string;       // Family member or care coordinator initiating assignment
  status: AssignmentStatus;
  caregiverType: CaregiverType;
  shift: ShiftWindow;
  responsibilities: ResponsibilityItem[];
  specialInstructions?: string;
  declineReason?: string;
  declinedAt?: string;
  predecessorAssignmentId?: string; // Links continuity chain
  successorAssignmentId?: string;   // Links continuity chain
  activeHandoverId?: string;        // Reference to HandoverRecord
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
  version: number;                // Optimistic concurrency control lock
}
```

### 12.1.2 State Transition Lifecycle

The state machine prohibits unacknowledged transitions or silent drop-offs. Every transition emits a domain event to the append-only audit log.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Assignment Created (Family/Coordinator)
    
    PENDING --> ACKNOWLEDGED: Caregiver Accepts
    PENDING --> DECLINED: Caregiver Declines (Requires Reason)
    PENDING --> CANCELLED: Family/Coordinator Cancels
    
    ACKNOWLEDGED --> ACTIVE: Check-in / Shift Start (Geo/Biometric/App)
    ACKNOWLEDGED --> CANCELLED: Revoked before Shift Start
    ACKNOWLEDGED --> DECLINED: Late Resignation (Triggers Immediate Care Gap)
    
    ACTIVE --> HANDOVER_INIT: Outgoing Caregiver Submits Handover Digest
    ACTIVE --> COMPLETED: Final Shift (Family Resumes Direct Care, No Handover)
    ACTIVE --> CANCELLED: Emergency Administrative Override
    
    HANDOVER_INIT --> HANDED_OVER: Incoming Caregiver Signs Off & Accepts
    HANDOVER_INIT --> ACTIVE: Incoming Caregiver Rejects Handover / Requests Fix
    
    HANDED_OVER --> [*]
    COMPLETED --> [*]
    DECLINED --> [*]
    CANCELLED --> [*]
```

### 12.1.3 State Guard Matrix

| Transition From | Transition To | Authorized Actor | Guard Conditions |
| :--- | :--- | :--- | :--- |
| `PENDING` | `ACKNOWLEDGED` | Assigned Caregiver | Caregiver identity matches `caregiverId`; current time < `shift.scheduledEnd`. |
| `PENDING` | `DECLINED` | Assigned Caregiver | Valid reason code provided; notification sent to assigner. |
| `PENDING` / `ACKNOWLEDGED` | `CANCELLED` | Assigner / Admin | Valid cancellation audit justification supplied. |
| `ACKNOWLEDGED` | `ACTIVE` | Assigned Caregiver | Current time within `[scheduledStart - 30m, scheduledStart + gracePeriod]`. |
| `ACTIVE` | `HANDOVER_INIT` | Outgoing Caregiver | All critical medications logged; vitals check-in completed; uncompleted tasks annotated. |
| `HANDOVER_INIT` | `HANDED_OVER` | Incoming Caregiver | Incoming caregiver has verified digest, completed physical reconciliation, and authenticated sign-off. |
| `ACTIVE` | `COMPLETED` | Outgoing Caregiver / Primary Family | Explicit confirmation that no external successor is needed (primary family taking over). |

---

## 12.2 Assignment Creation Flow

The assignment creation workflow enables primary family members or clinical coordinators to schedule care coverage while enforcing strict authorization, scheduling conflict detection, and delivery of actionable notifications.

```mermaid
sequenceDiagram
    autonumber
    actor Family as Primary Family / Coordinator
    participant API as JEEVASETU Gateway / API
    participant Auth as RBAC & Auth Engine
    participant Sched as Scheduling & Conflict Validator
    participant DB as Postgres / Timescale Store
    participant Push as Notification Bus (SMS / WhatsApp / FCM)
    participant Audit as Immutable Audit Logger

    Family->>API: POST /api/v1/care/assignments (elderId, caregiverId, shift, responsibilities)
    API->>Auth: Verify Token & Elder Relationship (PRIMARY_FAMILY, CARE_COORDINATOR)
    Auth-->>API: Authorized
    
    API->>Sched: Validate Shift Overlap & Caregiver Availability
    alt Overlap Detected or Incompatible Credentials
        Sched-->>API: Error: Caregiver double-booked or lacks specialized license
        API-->>Family: 409 Conflict / 422 Unprocessable Entity
    else Schedule Valid
        Sched-->>API: Schedule Cleared
        API->>DB: INSERT CaregiverAssignment (Status: PENDING, Version: 1)
        DB-->>API: Assignment Record Created (UUID)
        
        API->>Audit: AppendEvent(ASSIGNMENT_CREATED, actorId, elderId, payload)
        Audit-->>API: Event Persisted
        
        API->>Push: Enqueue Dispatch (caregiverId, type: PENDING_ASSIGNMENT_ALERT)
        Push-->>API: Notification Dispatched (FCM + WhatsApp fallback)
        
        API-->>Family: 201 Created (AssignmentPayload, Status: PENDING)
    end
```

### 12.2.1 Operational Rules for Assignment Creation
1. **Server-Side Authorization Check**: Only accounts bound to the elder with `RELATION_ROLE IN ['PRIMARY_FAMILY', 'CARE_COORDINATOR', 'PLATFORM_ADMIN']` can dispatch assignments.
2. **Clinical Competency Verification**: If `responsibilities` include `SPECIALIZED_CLINICAL_CARE`, the target caregiver profile must possess verified credentials (`licenseVerified: true`, `qualificationLevel: 'REGISTERED_NURSE' | 'LPN'`).
3. **Double-Booking Prevention**: The caregiver cannot have an overlapping assignment across any elder in JEEVASETU within the window `[shift.scheduledStart, shift.scheduledEnd]`.
4. **Audit Trail Event**:
   ```json
   {
     "eventType": "ASSIGNMENT_CREATED",
     "assignmentId": "a8047970-d7a8-442b-98f9-4673bbce4db1",
     "elderId": "e1029384-8842-4211-9a72-f192b0c3d4e5",
     "actorUserId": "u9981223-1122-3344-5566-778899aabbcc",
     "timestamp": "2026-11-15T06:00:00.000Z",
     "ipAddress": "103.21.124.8",
     "payload": {
       "caregiverId": "c4422331-5566-7788-9900-aabbccddeeff",
       "shiftStart": "2026-11-15T08:00:00.000Z",
       "shiftEnd": "2026-11-15T16:00:00.000Z",
       "responsibilities": ["MEDICATION_ADMINISTRATION", "VITAL_MONITORING"]
     }
   }
   ```

---

## 12.3 Caregiver Acknowledgement Flow

A caregiver assigned to a shift must explicitly acknowledge or decline within an operational response window (default: 4 hours from assignment, or within 30 minutes if the shift starts in under 2 hours).

```mermaid
sequenceDiagram
    autonumber
    actor Caregiver as Assigned Caregiver
    participant App as Caregiver Mobile/Web PWA
    participant API as JEEVASETU API
    participant DB as System Storage
    participant Esc as Escalation & Care Gap Monitor
    participant Notify as Notification Bus

    Caregiver->>App: Opens Pending Assignment Alert
    App->>API: GET /api/v1/care/assignments/{id}/details
    API->>DB: Fetch Assignment + Elder Profile (Vitals Baseline, Care Protocols, Allergies)
    DB-->>API: Aggregated Care Dossier
    API-->>App: Display Shift Scope & Special Needs
    
    alt Caregiver Accepts Assignment
        Caregiver->>App: Clicks "Accept Assignment"
        App->>API: POST /api/v1/care/assignments/{id}/acknowledge { action: "ACCEPT" }
        API->>DB: UPDATE CaregiverAssignment SET status = 'ACKNOWLEDGED'
        API->>Esc: Cancel Pending Acknowledgement Timeout Watchdog
        API->>Notify: Notify Primary Family ("Shift confirmed by Nurse Priya")
        API-->>App: 200 OK (Status: ACKNOWLEDGED, Shift Calendar Updated)
    else Caregiver Declines Assignment
        Caregiver->>App: Clicks "Decline Assignment" + Selects Reason Code
        App->>API: POST /api/v1/care/assignments/{id}/acknowledge { action: "DECLINE", reason: "SCHEDULING_CONFLICT", note: "Family emergency" }
        API->>DB: UPDATE CaregiverAssignment SET status = 'DECLINED', declineReason = ...
        API->>Esc: Trigger Urgent Care Gap Event (SEVERITY: HIGH)
        API->>Notify: CRITICAL ALERT to Primary Family / Care Coordinator (Push + SMS)
        API-->>App: 200 OK (Status: DECLINED)
    end
```

### 12.3.1 Pre-Shift Elder Dossier Visibility
When reviewing a pending assignment, the caregiver receives a scoped, HIPAA/DPDP-compliant pre-shift dossier containing:
- **Elder Baseline Status**: Age, mobility grade (independent, walker, wheelchair, bedbound), dietary restrictions.
- **Active Allergies & Critical Contraindications**: E.g., Penicillin allergy, aspiration risk.
- **Scheduled Care Interventions**: Scheduled medication administration timestamps, prescribed vitals checks.
- **Emergency Protocols**: Hospital preference, attending physician contact, DNR/POLST status.

---

## 12.4 Handover Workflow & Continuity Protocol

Care transitions are high-friction touchpoints where communication failures cause harm. The JEEVASETU Handover Workflow automates clinical synthesis, mandates structured reviews, and requires dual digital verification.

```mermaid
sequenceDiagram
    autonumber
    actor OutCare as Outgoing Caregiver
    actor InCare as Incoming Caregiver
    participant App as JEEVASETU Frontend
    participant API as Handover Controller
    participant Engine as Shift Synthesis Engine
    participant DB as Database
    participant Audit as Audit Store

    Note over OutCare, InCare: Shift Change Approaching (T - 30 minutes)
    
    OutCare->>App: Initiates Handover ("Start Shift Handover")
    App->>API: POST /api/v1/care/handovers/initiate { assignmentId }
    API->>Engine: Generate Shift Synthesis (assignmentId, elderId)
    Engine->>DB: Query Vitals, Med Adherence, Incidents, Uncompleted Tasks
    DB-->>Engine: Raw Shift Event Stream
    Engine-->>API: HandoverDigest (Calculated Statistics, Missed Meds, Flags)
    API-->>App: Pre-populated Handover Form
    
    OutCare->>App: Adds Qualitative Shift Notes, Flags Pending Follow-ups
    OutCare->>App: Clicks "Submit for Incoming Sign-off"
    App->>API: POST /api/v1/care/handovers/{id}/submit-digest { observations, pendingTasks }
    API->>DB: UPDATE HandoverRecord SET status = 'AWAITING_INCOMING_SIGN_OFF'
    API->>InCare: Push Notification: "Shift Handover Ready for Verification"
    
    InCare->>App: Opens Incoming Handover Verification Screen
    InCare->>App: Performs Physical Elder Check & Reconciles Med Count
    InCare->>App: Clicks "Accept & Sign Handover" (Enters PIN / Biometric Auth)
    App->>API: POST /api/v1/care/handovers/{id}/sign-off { signatureToken, acceptanceNote }
    
    API->>DB: Transaction:
    Note over API, DB: 1. UPDATE HandoverRecord -> SIGNED<br/>2. UPDATE OutgoingAssignment -> HANDED_OVER<br/>3. UPDATE IncomingAssignment -> ACTIVE
    
    API->>Audit: Log Handover Completed with cryptographic dual hashes
    API-->>App: 200 OK (Handover Completed)
    App-->>InCare: Display Active Shift Dashboard
```

### 12.4.1 HandoverRecord Schema

```typescript
// types/handover-record.ts

export interface MedicationPassSummary {
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  administeredTime?: string;
  status: 'GIVEN' | 'MISSED' | 'REFUSED' | 'HELD';
  exceptionReason?: string;
}

export interface VitalCheckSummary {
  vitalType: 'BLOOD_PRESSURE' | 'SPO2' | 'PULSE' | 'BLOOD_GLUCOSE' | 'TEMPERATURE';
  value: string;
  recordedAt: string;
  isAbnormal: boolean;
  alertLevel: 'NORMAL' | 'WARNING' | 'CRITICAL';
}

export interface CarriedForwardTask {
  taskId: string;
  description: string;
  dueBy: string;
  reasonUnfinished: string;
}

export interface HandoverRecord {
  id: string;                     // UUIDv4
  elderId: string;
  outgoingAssignmentId: string;
  incomingAssignmentId: string;
  outgoingCaregiverId: string;
  incomingCaregiverId: string;
  shiftWindow: {
    start: string;
    end: string;
  };
  
  // Synthesized Shift Data
  clinicalSummary: {
    medicationPasses: MedicationPassSummary[];
    vitalsRecorded: VitalCheckSummary[];
    incidentReportsCount: number;
    incidentIds: string[];
    bowelMovementLogged: boolean;
    fluidIntakeMl: number;
    mealsCompletedPercent: number;
  };
  
  // Outgoing Input
  outgoingObservations: string;   // Qualitative summary of elder's mood, pain, behavior
  carriedForwardTasks: CarriedForwardTask[];
  outgoingSubmittedAt: string;
  
  // Incoming Sign-off
  incomingVerification: {
    physicalCheckCompleted: boolean;
    medicationStockReconciled: boolean;
    elderCurrentStatus: 'STABLE' | 'DISTRESSED' | 'ASLEEP' | 'REQUIRING_IMMEDIATE_ATTENTION';
    incomingNotes?: string;
    signedAt: string;
    verificationMethod: 'PIN' | 'BIOMETRIC_PASSKEY' | 'SESSION_TOKEN';
    incomingSignerSignatureHash: string; // SHA-256 HMAC of verification payload
  };
  
  status: 'DRAFT' | 'AWAITING_INCOMING_SIGN_OFF' | 'SIGNED' | 'REJECTED' | 'SYSTEM_ESCALATED';
  createdAt: string;
  updatedAt: string;
}
```

---

## 12.5 Care Gap Detection Engine

The Care Gap Detection Engine runs continuously to detect temporal voids in care, late check-ins, unacknowledged handovers, and unprotected critical interventions.

```mermaid
flowchart TD
    Start([Engine Tick: Runs Every 5 Minutes]) --> FetchElders[Query Active Elderly Profiles]
    FetchElders --> CheckLoop[Iterate Through Each Elder]
    
    CheckLoop --> Check1{Is there an ACTIVE<br/>or ACKNOWLEDGED<br/>shift right now?}
    Check1 -- Yes --> CheckLateCheckIn{Caregiver checked in<br/>within Grace Period?}
    Check1 -- No --> CheckNeeds{Are high-risk needs<br/>scheduled within 2 hours?}
    
    %% Branch: Active shift check-in audit
    CheckLateCheckIn -- Yes --> CheckHandover{Shift within 30m<br/>of ending?}
    CheckLateCheckIn -- No --> FlagLate[Flag: CAREGIVER_NO_SHOW<br/>Severity: HIGH]
    
    CheckHandover -- Yes --> CheckSuccessor{Is successor assignment<br/>ACKNOWLEDGED?}
    CheckHandover -- No --> NextElder[Next Elder]
    CheckSuccessor -- Yes --> NextElder
    CheckSuccessor -- No --> FlagUncoveredHandover[Flag: UNCOVERED_HANDOVER<br/>Severity: MEDIUM]
    
    %% Branch: No active shift
    CheckNeeds -- Yes (Critical Meds/Vitals) --> FlagCriticalGap[Flag: CRITICAL_CARE_GAP<br/>Severity: CRITICAL]
    CheckNeeds -- No (Standard monitoring) --> FlagUnattended[Flag: UNATTENDED_INTERVAL<br/>Severity: LOW]
    
    %% Aggregation & Alerting
    FlagLate --> AlertDispatcher[Dispatch Multi-Channel Escalation Matrix]
    FlagUncoveredHandover --> AlertDispatcher
    FlagCriticalGap --> AlertDispatcher
    FlagUnattended --> AlertDispatcher
    NextElder --> LoopComplete{All Elders Checked?}
    LoopComplete -- No --> CheckLoop
    LoopComplete -- Yes --> End([Sleep Until Next Tick])
```

### 12.5.1 Severity Hierarchy and Escalation Rules

| Gap Code | Condition | Severity | Escalation Path | Actions Taken |
| :--- | :--- | :--- | :--- | :--- |
| `CRITICAL_CARE_GAP` | No caregiver scheduled during scheduled high-risk medication (e.g., Insulin, Anticoagulant, Cardiotropic) or for bedridden elder. | **CRITICAL** | Automated voice call + SMS to Primary Family; Push to Care Coordinator; App Banner alert. | Highlights red on dashboard; auto-prompts on-demand caregiver dispatch pool. |
| `CAREGIVER_NO_SHOW` | Current time > `shift.scheduledStart + 15 mins` and assignment is still `ACKNOWLEDGED` (no check-in). | **HIGH** | Push to assigned Caregiver (warning); SMS to Primary Family at T+20 min. | Begins continuous tracking; requests acknowledgement from caregiver; prepares standby alert. |
| `UNCOVERED_HANDOVER` | Active shift ends within 30 minutes, but incoming assignment is either nonexistent or still `PENDING` (not accepted). | **MEDIUM** | In-app alert to Outgoing Caregiver; WhatsApp alert to Primary Family. | Outgoing caregiver prompted to extend shift or arrange family handover. |
| `UNRESOLVED_HANDOVER` | Shift ended > 15 minutes ago, but incoming caregiver has not signed off on the Handover Digest. | **MEDIUM** | Push alert to Incoming Caregiver; warning to Outgoing Caregiver. | Flags handover as stalled; prevents automatic shift closure. |
| `UNSCHEDULED_INTERVAL` | Planned empty window > 4 hours during daytime hours (08:00–20:00) for elder with moderate dementia. | **LOW** | Email/In-app digest to Primary Family. | Informational reminder in family weekly view. |

---

## 12.6 Edge Cases & Failure Recovery

### 12.6.1 Edge Case 1: Caregiver No-Show / Late Check-In Escalation
1. **T + 5 Minutes**: Soft push reminder sent to caregiver mobile application: *"Your shift for [Elder Name] began 5 minutes ago. Please check in."*
2. **T + 15 Minutes (Grace Period Expired)**: Assignment status marked `FLAGGED_LATE`. Care gap event emitted. SMS dispatched to caregiver.
3. **T + 25 Minutes**: Escalation tier activated: Primary family receives high-priority notification: *"Caregiver [Name] has not checked in for [Elder Name]. Attempting emergency outreach."*
4. **T + 35 Minutes**: If still unresponsive, assignment transition to `NO_SHOW_CANCELLED`. The system activates the "Emergency Standby Roster" or prompts the primary family to assume care.

### 12.6.2 Edge Case 2: Delayed Handover Sign-Off (Incoming Caregiver Delayed)
- **Protocol**: The outgoing caregiver cannot abandon a vulnerable elder (Duty of Care rule).
- **Compensation & Shift Extension**: If the incoming caregiver is delayed by > 30 minutes, the outgoing caregiver taps *"Extend Shift Due to Delay"*. The system automatically:
  - Generates an approved overtime shift block in 30-minute increments.
  - Updates the active shift end time.
  - Re-calculates caregiver pay/billing rates.
  - Alerts the incoming caregiver that their delay is logged against their punctuality score.

### 12.6.3 Edge Case 3: Emergency Rapid Handover (Outgoing Caregiver Medical Event)
- **Scenario**: Outgoing caregiver experiences acute illness or an emergency requires immediate departure before normal handover synthesis.
- **Bypass Procedure**:
  - Outgoing caregiver or family member activates *"Emergency Handover Release"*.
  - A bypass code or coordinator token unlocks immediate transition of outgoing assignment to `COMPLETED_EMERGENCY`.
  - The elder's profile immediately enters `EMERGENCY_GAP` mode, dispatching location-based SOS alerts to all nearby verified family members and emergency services.

### 12.6.4 Edge Case 4: Multiple Simultaneous Caregivers
- **Scenario**: A specialized nurse handles clinical procedures (IV antibiotic, catheterization) while a general aide assists with mobility and feeding during the same 4-hour window.
- **Handling**:
  - JEEVASETU supports concurrent active assignments for the same `elderId`, provided the `responsibilityTypes` do not conflict.
  - Each caregiver manages their own independent check-in, execution log, and handover.
  - Medication handover is strictly bound to the caregiver assigned `MEDICATION_ADMINISTRATION`.

---

## 12.7 Hackathon Pragmatic Implementation & Deferral List

To ensure a functional, demo-ready delivery within hackathon constraints, features are prioritized between the immediate MVP and production enterprise extensions:

| Dimension | Hackathon MVP Scope (Implemented) | Production Enterprise Scope (Deferred) |
| :--- | :--- | :--- |
| **Storage & State** | PostgreSQL / Supabase with clean transactional updates and JSONB columns for flexible digests. | Event-sourced ledger (Kafka + EventStoreDB) with verifiable cryptographic state chains. |
| **Authentication** | JWT Bearer tokens with Role-Based Access Control (`role: 'FAMILY' \| 'CAREGIVER' \| 'ADMIN'`). | Multi-factor WebAuthn / FIDO2 biometric sign-offs with hardware key validation. |
| **Handover Synthesis** | Automated query pulling vitals, logged medications, and uncompleted tasks from shift window into a structured digest. | LLM-powered multi-modal voice debriefing: Caregiver dictates audio shift notes, translated and summarized via Gemini 1.5 Pro. |
| **Gap Detection** | Node.js `setInterval` or cron worker polling `/api/v1/care/gaps` every 60 seconds across active elders. | Distributed streaming engine (Apache Flink / Temporal.io) monitoring real-time IoT vital telemetry and geofences. |
| **Notification Engine** | Mock notification broker with console logging, simulated in-app notification state, and optional Twilio test SMS. | Multi-tier omnichannel routing (Twilio Voice IVR, WhatsApp Business API, Firebase Cloud Messaging, APNs). |
| **Location Verification** | Manual "Check In" button with optional browser `navigator.geolocation` coordinate capture. | Ultra-wideband (UWB) indoor room positioning and geofenced Bluetooth Low Energy (BLE) beacons in elder residence. |

---

## 12.8 Backend API Specifications for Handover

All API routes follow REST conventions with JSON payloads, standard HTTP response codes, and strict Zod runtime schema validation.

### 12.8.1 Route Endpoints Summary

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/care/assignments` | Create a new caregiver assignment | Primary Family / Coordinator |
| `GET` | `/api/v1/care/assignments/pending` | Fetch pending assignments for the authenticated caregiver | Caregiver |
| `POST` | `/api/v1/care/assignments/:id/acknowledge` | Accept or decline a pending assignment | Caregiver |
| `POST` | `/api/v1/care/assignments/:id/check-in` | Check in to start shift (transitions to `ACTIVE`) | Caregiver |
| `POST` | `/api/v1/care/handovers/initiate` | Generate shift synthesis and initiate handover | Outgoing Caregiver |
| `POST` | `/api/v1/care/handovers/:id/sign-off` | Incoming caregiver reviews and signs off handover | Incoming Caregiver |
| `GET` | `/api/v1/care/gaps` | Query current care gaps and late check-in anomalies | Family / Coordinator / Admin |

---

### 12.8.2 Zod Validation Schemas

```typescript
// schemas/handover-api-schemas.ts
import { z } from 'zod';

export const CreateAssignmentSchema = z.object({
  elderId: z.string().uuid(),
  caregiverId: z.string().uuid(),
  caregiverType: z.enum([
    'PRIMARY_FAMILY',
    'SECONDARY_FAMILY',
    'PROFESSIONAL_NURSE',
    'CERTIFIED_AIDE',
    'COMMUNITY_VOLUNTEER'
  ]),
  shiftStart: z.string().datetime(),
  shiftEnd: z.string().datetime(),
  gracePeriodMinutes: z.number().int().min(5).max(60).default(15),
  responsibilities: z.array(z.object({
    type: z.enum([
      'MEDICATION_ADMINISTRATION',
      'VITAL_MONITORING',
      'MOBILITY_ASSISTANCE',
      'ADL_SUPPORT',
      'NUTRITION_HYDRATION',
      'COGNITIVE_ENGAGEMENT',
      'SPECIALIZED_CLINICAL_CARE',
      'EMERGENCY_STANDBY'
    ]),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    description: z.string().min(3),
    mandatoryProtocols: z.array(z.string()).default([])
  })).min(1, "At least one responsibility is required"),
  specialInstructions: z.string().optional()
}).refine(data => new Date(data.shiftEnd) > new Date(data.shiftStart), {
  message: "shiftEnd must be after shiftStart",
  path: ["shiftEnd"]
});

export const AcknowledgeAssignmentSchema = z.object({
  action: z.enum(['ACCEPT', 'DECLINE']),
  reasonCode: z.enum([
    'ACCEPTED',
    'SCHEDULING_CONFLICT',
    'ILLNESS_UNAVAILABLE',
    'DISTANCE_TRANSPORT_ISSUE',
    'LACK_SPECIALIZED_COMPETENCY',
    'OTHER'
  ]),
  declineNote: z.string().optional()
}).refine(data => {
  if (data.action === 'DECLINE') {
    return data.reasonCode !== 'ACCEPTED';
  }
  return true;
}, {
  message: "A decline reason must be specified when rejecting an assignment",
  path: ["reasonCode"]
});

export const CheckInSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  checkInNotes: z.string().max(500).optional()
});

export const InitiateHandoverSchema = z.object({
  assignmentId: z.string().uuid(),
  outgoingObservations: z.string().min(10, "Please provide clinical observations of the shift"),
  carriedForwardTasks: z.array(z.object({
    taskId: z.string(),
    description: z.string(),
    dueBy: z.string(),
    reasonUnfinished: z.string()
  })).default([])
});

export const SignOffHandoverSchema = z.object({
  physicalCheckCompleted: z.boolean().refine(val => val === true, {
    message: "Physical check of elder must be confirmed"
  }),
  medicationStockReconciled: z.boolean().refine(val => val === true, {
    message: "Medication reconciliation must be confirmed"
  }),
  elderCurrentStatus: z.enum(['STABLE', 'DISTRESSED', 'ASLEEP', 'REQUIRING_IMMEDIATE_ATTENTION']),
  incomingNotes: z.string().optional(),
  verificationToken: z.string().min(4, "Sign-off verification code/token required")
});
```

---

### 12.8.3 Request and Response Contracts

#### 1. POST `/api/v1/care/assignments`
- **Request Body**:
  ```json
  {
    "elderId": "8f307dfb-12d9-4822-9214-41d7e891ec23",
    "caregiverId": "5a41bfce-5e7b-4d40-8480-1a766c5d18d4",
    "caregiverType": "PROFESSIONAL_NURSE",
    "shiftStart": "2026-11-15T08:00:00Z",
    "shiftEnd": "2026-11-15T16:00:00Z",
    "gracePeriodMinutes": 15,
    "responsibilities": [
      {
        "type": "MEDICATION_ADMINISTRATION",
        "priority": "CRITICAL",
        "description": "Administer morning antihypertensive and insulin at 08:30",
        "mandatoryProtocols": ["GLUCOSE_CHECK_BEFORE_INSULIN", "DOUBLE_CHECK_UNITS"]
      },
      {
        "type": "VITAL_MONITORING",
        "priority": "HIGH",
        "description": "Log BP, Heart Rate, SpO2 three times per shift",
        "mandatoryProtocols": ["POST_PRANDIAL_BP"]
      }
    ],
    "specialInstructions": "Elder experienced mild dizziness yesterday morning; check sitting vs standing BP."
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "assignmentId": "b11a5b48-18e0-47b1-9b16-cdbf7b270725",
      "elderId": "8f307dfb-12d9-4822-9214-41d7e891ec23",
      "caregiverId": "5a41bfce-5e7b-4d40-8480-1a766c5d18d4",
      "status": "PENDING",
      "shift": {
        "scheduledStart": "2026-11-15T08:00:00Z",
        "scheduledEnd": "2026-11-15T16:00:00Z",
        "gracePeriodMinutes": 15
      },
      "createdAt": "2026-11-15T06:15:00.000Z",
      "version": 1
    }
  }
  ```

#### 2. POST `/api/v1/care/assignments/:id/acknowledge`
- **Request Body (Accept)**:
  ```json
  {
    "action": "ACCEPT",
    "reasonCode": "ACCEPTED"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Assignment successfully acknowledged.",
    "data": {
      "assignmentId": "b11a5b48-18e0-47b1-9b16-cdbf7b270725",
      "status": "ACKNOWLEDGED",
      "acknowledgedAt": "2026-11-15T06:22:15.112Z"
    }
  }
  ```

#### 3. POST `/api/v1/care/handovers/initiate`
- **Request Body**:
  ```json
  {
    "assignmentId": "b11a5b48-18e0-47b1-9b16-cdbf7b270725",
    "outgoingObservations": "Elder was alert throughout shift. Consumed 85% of lunch. Blood pressure spike (148/92) noted at 13:00; normalized to 128/82 by 15:00 post-rest.",
    "carriedForwardTasks": [
      {
        "taskId": "task-99",
        "description": "Assist with evening leg elevation and compression stockings",
        "dueBy": "2026-11-15T18:00:00Z",
        "reasonUnfinished": "Scheduled for evening shift"
      }
    ]
  }
  ```
- **Response `200 OK` (Auto-synthesized digest)**:
  ```json
  {
    "success": true,
    "data": {
      "handoverId": "h7722991-33aa-44bb-88cc-ddff11223344",
      "outgoingAssignmentId": "b11a5b48-18e0-47b1-9b16-cdbf7b270725",
      "incomingCaregiverId": "c9988776-6655-4433-2211-00aabbccddee",
      "status": "AWAITING_INCOMING_SIGN_OFF",
      "clinicalSummary": {
        "medicationPasses": [
          {
            "medicationId": "med-1",
            "medicationName": "Amlodipine 5mg",
            "dosage": "1 tablet",
            "scheduledTime": "2026-11-15T08:30:00Z",
            "administeredTime": "2026-11-15T08:32:00Z",
            "status": "GIVEN"
          },
          {
            "medicationId": "med-2",
            "medicationName": "Insulin Glargine",
            "dosage": "12 units",
            "scheduledTime": "2026-11-15T08:30:00Z",
            "administeredTime": "2026-11-15T08:35:00Z",
            "status": "GIVEN"
          }
        ],
        "vitalsRecorded": [
          {
            "vitalType": "BLOOD_PRESSURE",
            "value": "128/82 mmHg",
            "recordedAt": "2026-11-15T15:00:00Z",
            "isAbnormal": false,
            "alertLevel": "NORMAL"
          },
          {
            "vitalType": "BLOOD_GLUCOSE",
            "value": "142 mg/dL",
            "recordedAt": "2026-11-15T08:20:00Z",
            "isAbnormal": false,
            "alertLevel": "NORMAL"
          }
        ],
        "incidentReportsCount": 0,
        "bowelMovementLogged": true,
        "fluidIntakeMl": 1450,
        "mealsCompletedPercent": 85
      },
      "outgoingObservations": "Elder was alert throughout shift. Consumed 85% of lunch. Blood pressure spike (148/92) noted at 13:00; normalized to 128/82 by 15:00 post-rest.",
      "carriedForwardTasks": [
        {
          "taskId": "task-99",
          "description": "Assist with evening leg elevation and compression stockings",
          "dueBy": "2026-11-15T18:00:00Z",
          "reasonUnfinished": "Scheduled for evening shift"
        }
      ]
    }
  }
  ```

#### 4. POST `/api/v1/care/handovers/:id/sign-off`
- **Request Body**:
  ```json
  {
    "physicalCheckCompleted": true,
    "medicationStockReconciled": true,
    "elderCurrentStatus": "STABLE",
    "incomingNotes": "Elder is awake in living room. Reconciled insulin cartridge and daily pill organizer. Everything in order.",
    "verificationToken": "SECURE-PIN-8819"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Handover accepted and verified. Care responsibility transferred.",
    "data": {
      "handoverId": "h7722991-33aa-44bb-88cc-ddff11223344",
      "status": "SIGNED",
      "outgoingAssignmentStatus": "HANDED_OVER",
      "incomingAssignmentStatus": "ACTIVE",
      "completedAt": "2026-11-15T16:04:12.894Z",
      "auditSignatureHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
  ```

#### 5. GET `/api/v1/care/gaps`
- **Query Params**: `?elderId=8f307dfb-12d9-4822-9214-41d7e891ec23&windowHours=24`
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "elderId": "8f307dfb-12d9-4822-9214-41d7e891ec23",
      "generatedAt": "2026-11-15T16:10:00Z",
      "totalGapsFound": 1,
      "gaps": [
        {
          "gapId": "gap-20261115-01",
          "gapType": "UNCOVERED_HANDOVER",
          "severity": "MEDIUM",
          "windowStart": "2026-11-16T00:00:00Z",
          "windowEnd": "2026-11-16T08:00:00Z",
          "description": "Overnight shift (00:00 to 08:00) has no assigned caregiver. Elder is classified as high fall-risk.",
          "scheduledInterventionsAtRisk": [
            {
              "type": "MEDICATION",
              "name": "Clonazepam 0.5mg",
              "scheduledTime": "2026-11-16T06:00:00Z"
            }
          ],
          "recommendedAction": "Assign secondary family member or request emergency night aide."
        }
      ]
    }
  }
  ```

---

## 12.9 Architectural Summary & Guarantees

Section 12 ensures that JEEVASETU meets the clinical safety standard expected of high-reliability health systems:
1. **Zero Silent Drop-offs**: Assignments cannot transition to `COMPLETED` without successor verification unless the primary family explicitly confirms physical resumption of custody.
2. **Clinical Auditability**: Automated compilation of medication adherence and vitals records removes human reporting bias from handovers.
3. **Deterministic Gap Mitigation**: The Care Gap Detection Engine continuously protects against omissions, no-shows, and scheduling oversights before patient harm occurs.
4. **Hackathon Feasibility**: Built with modern TypeScript, Zod, and clear transactional state changes, the architecture is directly implementable in an MVP while remaining forward-compatible with production enterprise EHR integrations.


---\n
## 13. Security Threat Model

### 13.1 Overview and Security Posture

JEEVASETU is an elderly-care digital health platform designed to coordinate medication schedules, monitor vital signs, dispatch care reminders, and facilitate communication among elderly patients, designated family caregivers, and healthcare providers. 

Given the vulnerability of elderly users and the sensitivity of personal health data, JEEVASETU adopts a **Defense-in-Depth (DiD)** and **Zero-Trust** security architecture. Security boundaries are established across client applications (mobile/web), the API gateway and application runtime (Google Cloud Run), backend database engines (Cloud Firestore), and external notification gateways (FCM/Twilio).

```
+---------------------------------------------------------------------------------------------------+
|                                       CLIENT ENTRYPOINTS                                          |
|   +---------------------------------------+       +-------------------------------------------+   |
|   | Elder Portal (Simple PIN / Biometric) |       | Caregiver / Clinician Portal (Web/Mobile) |   |
|   +---------------------------------------+       +-------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
                                                  | (HTTPS / TLS 1.3 + Firebase Auth JWT)
                                                  v
+---------------------------------------------------------------------------------------------------+
|                              CLOUD RUN API LAYER (Next.js / Node.js)                              |
|  - Edge Rate Limiting & Helmet HSTS                                                               |
|  - Token Verification (Firebase Admin SDK)                                                        |
|  - Zod Request Schema Validation & Sanitization                                                   |
|  - Server-Side Authorization (Role-Based & Patient-Access-List Check)                             |
|  - Audit Log Emitter (Immutable Stream)                                                           |
+---------------------------------------------------------------------------------------------------+
                                                  | (Scoped IAM Service Account)
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                     CLOUD FIRESTORE DATABASE                                      |
|  - Firestore Security Rules (Defense-in-Depth fallback)                                           |
|  - Strict Partitioning by `patientId`                                                             |
|  - Append-Only Care Event Audit Logs (`/patients/{patientId}/audit_logs`)                         |
|  - AES-256 Encryption-at-Rest (Google-Managed Customer Keys)                                      |
+---------------------------------------------------------------------------------------------------+
```

---

### 13.2 STRIDE-Based Threat Analysis

The system components are analyzed using Microsoft's STRIDE methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, and Elevation of Privilege) with specific focus on elderly-care failure modes.

#### 1. Spoofing (Identity Deception)
* **Threat S1: Elderly PIN / Kiosk Passcode Brute-Force**
  * *Vector:* Attackers or unauthorized persons within physical proximity attempt automated or manual dictionary attacks on simplified numeric PINs used by elderly individuals on dedicated tablet kiosks.
  * *Likelihood:* Medium | *Impact:* High
  * *Mitigation:* PIN entropy minimum of 6 digits, progressive rate limiting (exponential backoff after 3 failed attempts, lockout after 5 attempts), geo-fenced session anomalies, and silent SMS alerts to the primary caregiver upon consecutive failed logins.
* **Threat S2: Caregiver Account Takeover via Stolen Credentials or Compromised Magic Links**
  * *Vector:* Phishing attacks targeting caregiver emails or interception of passwordless magic links/invitation links sent via unencrypted SMS or email.
  * *Likelihood:* Medium | *Impact:* Critical
  * *Mitigation:* Enforce Firebase Auth password complexity rules, single-use cryptographically random invitation tokens with a 15-minute TTL, device binding, and mandatory MFA for administrative and clinical accounts.

#### 2. Tampering (Data Integrity Violation)
* **Threat T1: Falsification of Medication Administration Records**
  * *Vector:* Malicious actors or overwhelmed caregivers falsify medication event logs, recording doses as "administered" when they were skipped, or modifying historical administration timestamps.
  * *Likelihood:* Medium | *Impact:* High (Clinical Risk)
  * *Mitigation:* Medication events are structured as write-once append-only documents. Historical records are cryptographically hashed and cannot be updated or deleted via client APIs; edits can only be appended as compensating correction entries containing operator metadata and mandatory justification reasons.
* **Threat T2: Medication Schedule & Dosage Manipulation**
  * *Vector:* Unauthorized alteration of dosage frequencies, pill counts, or alarm thresholds in Firestore.
  * *Likelihood:* Low | *Impact:* Critical (Physical Harm / Overdose)
  * *Mitigation:* Strict schema validation (Zod) enforcing bounded ranges (e.g., maximum dosage limits per 24 hours), dual-custody verification (doctor or primary caregiver approval required for schedule changes), and server-side RBAC validation rejecting direct client Firestore writes.

#### 3. Repudiation (Denial of Action)
* **Threat R1: Denying Medication Dispensation or Emergency Alert Response**
  * *Vector:* A caregiver fails to administer critical medication or ignores a high-priority fall/emergency notification, later claiming the notification was never received or that another party handled it.
  * *Likelihood:* High | *Impact:* High
  * *Mitigation:* Comprehensive immutable audit trail (`/patients/{patientId}/audit_logs`) recording user ID, IP address, user-agent, precise UTC timestamp, and notification delivery receipts from FCM/Twilio with correlation IDs.

#### 4. Information Disclosure (Confidentiality Breach)
* **Threat I1: Patient Protected Health Data & Vitals Leakage**
  * *Vector:* Sensitive medical conditions, blood pressure logs, or prescription details leaking through verbose API error responses, unauthenticated endpoints, or third-party tracking scripts.
  * *Likelihood:* Medium | *Impact:* High
  * *Mitigation:* Zero-leak API design with global error interceptors stripping internal stack traces; removal of all third-party marketing SDKs/pixels; strict Content Security Policy (CSP); field-level redaction on public logs.
* **Threat I2: Multi-Tenant Insecure Direct Object References (IDOR)**
  * *Vector:* Caregiver assigned to Patient A modifies the query parameter to `patientId=PatientB` to harvest vitals, care notes, and personal identifiers.
  * *Likelihood:* High | *Impact:* Critical
  * *Mitigation:* Server-side authorization middleware inspecting claims in the validated Firebase JWT against an explicit membership sub-collection (`/patients/{patientId}/authorized_users/{uid}`); database queries scoped unconditionally to verified patient IDs.

#### 5. Denial of Service (System Availability Disruption)
* **Threat D1: Notification and Reminder Pipeline Exhaustion**
  * *Vector:* Attackers repeatedly trigger notification schedules or webhook callbacks, flooding the queue worker and saturating Twilio SMS or Cloud Tasks quotas, causing elderly patients to miss critical medication alerts.
  * *Likelihood:* Medium | *Impact:* Critical (Life Safety)
  * *Mitigation:* Rate limiting on reminder generation endpoints; sliding-window throttling per patient; dead-letter queues (DLQ) with automated failover alerting; decoupled Cloud Tasks with priority queue reservation for emergency alerts.
* **Threat D2: Cloud Firestore Document Read/Write Quota Starvation**
  * *Vector:* Unbounded queries (e.g., fetching entire historical vitals logs without pagination) or infinite listener loops triggering excessive billable reads/writes and throttling legitimate traffic.
  * *Likelihood:* Medium | *Impact:* High
  * *Mitigation:* Mandatory pagination (`limit(50)`), required composite indexes blocking full collection scans, write batch limits, and Cloud Monitoring alerting at 70% project quota thresholds.

#### 6. Elevation of Privilege (Access Boundary Breach)
* **Threat E1: Role Escalation from Read-Only Viewer to Admin / Caregiver**
  * *Vector:* A family member with read-only observer permissions manipulates client payload flags (e.g., `role: "admin"`) on profile update endpoints.
  * *Likelihood:* Low | *Impact:* High
  * *Mitigation:* Strict Zod schema stripping extraneous fields (`strip()`); roles stored exclusively in custom Firebase Auth claims and backend `/patient_permissions` collections, mutable only via authorized administrative server endpoints.
* **Threat E2: Firestore Security Rule Bypass via Direct Client SDK**
  * *Vector:* An attacker uses extracted Firebase client configurations to directly read or write root collections through the client Firestore SDK, bypassing application server checks.
  * *Likelihood:* High | *Impact:* Critical
  * *Mitigation:* Rigorous Firestore Security Rules acting as defense-in-depth: `allow read, write: if false` on sensitive collections by default; explicit patient-access rule evaluation enforcing ownership for any client-facing paths.

---

### 13.3 STRIDE Threat Matrix

| Threat | Category | Likelihood | Impact | Mitigation |
| :--- | :--- | :---: | :---: | :--- |
| **Elderly PIN Brute-Force** | Spoofing | Medium | High | 6-digit minimum entropy, exponential backoff, account lockout after 5 consecutive failed attempts, caregiver alert notifications. |
| **Caregiver Account Hijacking** | Spoofing | Medium | Critical | Firebase Auth password complexity enforcement, single-use invite tokens (15-min TTL), mandatory MFA for care managers and clinicians. |
| **Medication Administration Falsification** | Tampering | Medium | High | Append-only immutable event streams. No document updates/deletions allowed; corrections logged as new compensating transactions. |
| **Dosage & Schedule Modification** | Tampering | Low | Critical | Zod bounds validation, dual-custody verification (caregiver/doctor approval workflow), backend-only schema enforcement. |
| **Repudiation of Care / Missed Doses** | Repudiation | High | High | Cryptographically timestamped audit logging of all dispensation confirmations and notification delivery callbacks with correlation IDs. |
| **Patient Health Data (PHI) Leakage** | Information Disclosure | Medium | High | Centralized API error handling (stack trace sanitization), strict CSP, field-level redaction, zero external advertising/tracking dependencies. |
| **Cross-Patient Data Access (IDOR)** | Information Disclosure | High | Critical | Server-side authorization verifying `patientId` against user session access list; all database queries scoped strictly to validated `patientId`. |
| **Notification Pipeline Flood** | Denial of Service | Medium | Critical | Rate limiting on dispatch triggers, Cloud Tasks priority isolation (emergency vs. routine reminders), SMS gateway rate-capping. |
| **Firestore Quota Exhaustion** | Denial of Service | Medium | High | Enforced query pagination (`limit <= 50`), mandatory composite indexes, caching hot data, GCP budget and quota anomaly alerts. |
| **Role Escalation via Payload Injection** | Elevation of Privilege | Low | High | Zod schema sanitation (`strip`), separation of user profile data from authorization claims, backend verification of admin privileges. |
| **Direct Firestore Client Exploitation** | Elevation of Privilege | High | Critical | Defense-in-depth Firestore Security Rules requiring authenticated session validation and explicit tenant membership matching. |

---

### 13.4 Key Security Controls

```
+-------------------------------------------------------------------------------------------------+
|                                    10 KEY SECURITY CONTROLS                                     |
+-------------------------------------------------------------------------------------------------+
| 1. Firebase Auth Hardening        | 5. Zod Input Validation          | 8. HTTPS & Transport HSTS|
| 2. Server-Side Route Guarding     | 6. Tiered Rate Limiting          | 9. Immutable Audit Trail |
| 3. Firestore Rules In-Depth       | 7. Secret Manager Isolation      | 10. Passcode Lifecycle   |
| 4. Patient Tenant Scoping         |                                  |                          |
+-------------------------------------------------------------------------------------------------+
```

#### 1. Firebase Auth with Secure Password Requirements
* **Password Policy:** Enforced via Firebase Auth console and client-side pre-validation: minimum 10 characters, requiring uppercase, lowercase, numbers, and special characters. Checked against common breached password lists.
* **Token Handling:** Short-lived Firebase ID tokens (60-minute expiry) verified on the server side using the Firebase Admin SDK. Refresh tokens revoked immediately upon password change or account compromise.
* **Session Integrity:** Re-authentication required for sensitive actions (changing emergency contact phone numbers, updating medication dosages).

#### 2. Server-Side Authorization on Every API Route
* **Zero Client Trust:** Client claims are never accepted blindly. Middleware decodes the Firebase session cookie or Bearer token, extracts the user UID, and queries the user's role and patient assignment list in memory/cache.
* **RBAC & ABAC Model:**
  * `PrimaryCaregiver`: Full read/write for assigned patient.
  * `SecondaryCaregiver` / `FamilyViewer`: Read-only access to adherence logs and vitals; cannot alter schedules.
  * `Clinician`: Read access to medical history; write access to prescription and dosage recommendations.
  * `Patient`: Simplified view, confirmation-only actions for reminders.

```typescript
// Example: Server-side route authorization middleware
export async function authorizePatientAccess(req: AuthenticatedRequest, targetPatientId: string, requiredRole: Role) {
  const { uid } = req.user;
  const accessDoc = await firestore
    .collection('patients')
    .doc(targetPatientId)
    .collection('authorized_users')
    .doc(uid)
    .get();

  if (!accessDoc.exists) {
    throw new ForbiddenError('Access denied: User is not linked to this patient record.');
  }

  const { role, status } = accessDoc.data()!;
  if (status !== 'ACTIVE' || !hasSufficientRole(role, requiredRole)) {
    throw new ForbiddenError('Insufficient permissions to perform this operation.');
  }
}
```

#### 3. Firestore Security Rules for Defense-in-Depth
Even though operations flow through the Next.js/Cloud Run API layer, Firestore Security Rules are maintained to prevent unauthorized access in the event of misconfigured API routes or exposed client API keys:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default deny all access
    match /{document=**} {
      allow read, write: if false;
    }

    // Patient isolation rules
    match /patients/{patientId} {
      function isAssignedCaregiver() {
        return request.auth != null && 
          exists(/databases/$(database)/documents/patients/$(patientId)/authorized_users/$(request.auth.uid));
      }

      allow read: if isAssignedCaregiver();
      allow write: if false; // All writes must proceed through Server API

      match /medication_events/{eventId} {
        allow read: if isAssignedCaregiver();
        // Client cannot update or delete existing events (Immutable)
        allow update, delete: if false;
      }

      match /authorized_users/{userId} {
        allow read: if request.auth != null && request.auth.uid == userId;
        allow write: if false;
      }
    }
  }
}
```

#### 4. Patient-Level Data Isolation
* **Explicit Query Scoping:** Every database read and write requires a validated `patientId`. Root-level collections containing multi-patient records without tenant partitioning are prohibited.
* **Sub-collection Architecture:** Sensitive sub-entities are stored hierarchically under `/patients/{patientId}/medications`, `/patients/{patientId}/vitals`, and `/patients/{patientId}/adherence_logs`.
* **Zero Cross-Querying:** Multi-tenant list queries are forbidden; APIs cannot fetch cross-patient summaries unless executed by a platform administrator via a restricted, audited pipeline.

#### 5. Input Validation via Zod on All Endpoints
* All incoming JSON payloads, URL search parameters, and route parameters are validated against strict Zod schemas before reaching business logic.
* **Type Stripping:** `.strict()` or `.strip()` is invoked on all object schemas to block parameter pollution and mass-assignment vulnerabilities.

```typescript
// Example: Strict Zod validation schema for medication log entry
export const RecordMedicationEventSchema = z.object({
  patientId: z.string().cuid2(),
  medicationId: z.string().cuid2(),
  doseScheduledTime: z.string().datetime(),
  doseAdministeredTime: z.string().datetime(),
  status: z.enum(['TAKEN', 'SKIPPED', 'RESCHEDULED', 'MISSED']),
  administeredByUid: z.string().min(1),
  notes: z.string().max(500).trim().optional(),
}).strict();
```

#### 6. Rate Limiting on Auth and Invitation Endpoints
* **API Gateway & Middleware Throttling:** Configured via an in-memory or Redis-backed leaky bucket algorithm.
* **Threshold Specifications:**
  * `/api/auth/login-pin`: 5 attempts per 15 minutes per IP + Patient ID pair.
  * `/api/invitations/verify`: 3 attempts per hour per token/IP.
  * `/api/reminders/send-sms`: Maximum 1 dispatch per 3 minutes per patient to prevent SMS bombing.
  * Global API routes: 100 requests per minute per authenticated user.

#### 7. Secrets Management
* **Environment Segregation:** Secrets (Firebase Private Keys, Twilio Auth Tokens, Encryption Salts) are injected strictly through **Google Cloud Secret Manager** into Cloud Run environment variables at runtime.
* **No Client Leakage:** Continuous integration pipelines incorporate automated static scanning (`trufflehog`, `git-secrets`) to reject commits containing secrets or configuration strings prefixed with `PRIVATE_KEY` or `SECRET`.
* **Client Environment Cleanliness:** Only non-sensitive parameters (Firebase public Project ID, Auth domain, Cloud Run base URL) are prefixed with `NEXT_PUBLIC_`.

#### 8. HTTPS Everywhere & Cloud Run Defaults
* **Transport Security:** Cloud Run terminates TLS using Google-managed certificates with TLS 1.3 preferred (TLS 1.2 minimum). Plain HTTP requests are automatically redirected to HTTPS.
* **HSTS Header:** Strict-Transport-Security enforced: `max-age=31536000; includeSubDomains; preload`.
* **Security Headers:** Managed via Next.js middleware using `helmet`:
  * `X-Content-Type-Options: nosniff`
  * `X-Frame-Options: DENY`
  * `Referrer-Policy: strict-origin-when-cross-origin`
  * `Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://*.firebaseio.com https://identitytoolkit.googleapis.com;`

#### 9. Audit Trail (Immutable Care Events)
* **Append-Only Store:** All state-changing care events (dispensing medicine, changing dosages, acknowledging alerts) generate an immutable audit log record stored in `/patients/{patientId}/audit_logs/{logId}`.
* **Payload Verification:** Every log document contains:
  * `actorUid`: ID of user or system process triggering the event.
  * `action`: Standardized verb (`MEDICATION_LOGGED`, `SCHEDULE_ALTERED`, `SOS_TRIGGERED`).
  * `targetEntityId`: Affected resource identifier.
  * `timestamp`: Verified Cloud Firestore server timestamp (`FieldValue.serverTimestamp()`).
  * `deviceInfo`: IP hash, User-Agent, and client version.
* **Tamper Prevention:** Security rules enforce `allow update, delete: if false` on all audit collections.

#### 10. Passcode Entropy and Expiry
* **Caregiver / Family Invites:** 32-character cryptographically secure pseudo-random hex tokens (`crypto.randomBytes(16)`), stored as SHA-256 hashes in the database. TTL of 24 hours. Single-use only; immediately invalidated upon redemption.
* **Elderly Simple Access PINs:** 6-digit numeric passcodes (avoiding common patterns such as `123456`, `000000`, or matching birth years). Salted and hashed using `bcrypt` (work factor 12) before storage. Automatic expiration every 90 days requiring caregiver-assisted reset.

---

### 13.5 Data Classification and Handling

Data handled by JEEVASETU is classified into three tiers to dictate appropriate storage, transmission, and access boundaries:

```
+---------------------------------------------------------------------------------------------------+
|                                     DATA CLASSIFICATION TIERS                                     |
+-----------------------------+-------------------------------+-------------------------------------+
| TIER 1: HIGHLY SENSITIVE    | TIER 2: INTERNAL OPERATIONAL  | TIER 3: NON-SENSITIVE / PUBLIC      |
| (PHI & Direct PII)          | (Operational & System State)  | (Open Platform Metadata)            |
+-----------------------------+-------------------------------+-------------------------------------+
| - Medical conditions        | - Audit logs                  | - Generic medication database       |
| - Medication regimens & logs| - Caregiver assignment maps   | - Public UI assets & icons          |
| - Biometrics & vital signs  | - Invitation tokens (hashed)  | - Generic health reminder templates |
| - Doctor notes & diagnoses  | - Device tokens (FCM)         | - Privacy policy & terms of service |
| - Full name, DOB, phone,    | - Notification preferences    | - Application version manifest      |
|   home address, ID numbers  | - Telemetry & latency metrics |                                     |
+-----------------------------+-------------------------------+-------------------------------------+
```

#### Data Handling Guidelines by Tier

| Dimension | Tier 1: Highly Sensitive (PHI / PII) | Tier 2: Internal Operational | Tier 3: Non-Sensitive / Public |
| :--- | :--- | :--- | :--- |
| **Storage** | Encrypted at rest (AES-256). Stored in dedicated, restricted patient sub-collections. | Encrypted at rest. Hashed tokens; stripped of direct patient identity. | Standard cloud storage / CDN distribution. |
| **Transmission** | TLS 1.3 mandatory. Field-level redaction on client transit. | TLS 1.3 mandatory. | TLS 1.3 standard. Cachable at edge. |
| **Masking & Logs** | **NEVER** logged in plain text. Redacted in Cloud Logging/Datadog (`[REDACTED]`). | Sanitized. UIDs and correlation IDs retained; PII omitted. | Fully loggable for debugging and metrics. |
| **Access Control** | Strict RBAC + explicit patient delegation verification. | Authenticated system service accounts and admins. | Publicly readable. |
| **Retention Policy** | Retained for care lifecycle + regulatory archival; purgeable upon verified deletion request. | 90 days hot storage, rolling transition to cold archive. | Retained indefinitely or refreshed with build deployments. |

---

### 13.6 Compliance & Regulatory Considerations

JEEVASETU is not initially certified as a HIPAA-covered entity or CE-marked medical device; however, it deals with sensitive elder health metrics and care events. The architecture intentionally mirrors core baseline standards from the **HIPAA Security Rule (45 CFR Part 160 and Part 164, Subparts A and C)** and modern privacy principles (such as GDPR and India's Digital Personal Data Protection Act):

```
+---------------------------------------------------------------------------------------------------+
|                               PRAGMATIC COMPLIANCE ALIGNMENT                                      |
+-------------------------------------+-------------------------------------------------------------+
| Standard / Principle                | JEEVASETU Engineering Implementation                        |
+-------------------------------------+-------------------------------------------------------------+
| Access Control (164.312(a)(1))      | Unique user identification, emergency "break-glass" access, |
|                                     | multi-factor authentication, automatic session timeout.     |
| Audit Controls (164.312(b))         | Immutable event streams logging access and modification to  |
|                                     | all patient medical records and reminder transactions.      |
| Integrity Controls (164.312(c)(1))  | Cryptographic validation, Zod boundary checking, write-once  |
|                                     | adherence logs preventing unauthorized alterations.         |
| Transmission Security (164.312(e))  | Strict HTTPS/TLS 1.3, HSTS header pinning, elimination of   |
|                                     | unencrypted communication channels (no PHI via open SMS).   |
| Minimum Necessary Principle         | View-only family roles limit access strictly to adherence   |
|                                     | summaries rather than full clinical history.                |
| Explicit Informed Consent           | Patient onboarding includes digital consent workflow for    |
|                                     | caregiver access delegation with revokable permissions.     |
+-------------------------------------+-------------------------------------------------------------+
```

> **Important Operational Note:** SMS reminders sent to elderly users or family members must never contain explicit prescription names or medical condition diagnoses (e.g., send *"Time to take your 10:00 AM scheduled dose"* rather than *"Take 20mg Lisinopril for Hypertension"*), thereby neutralizing privacy leaks over unencrypted cellular networks.

---

### 13.7 Security Verification and Testing Checklist

The following verification checklist must be passed prior to deploying any production release of JEEVASETU:

#### 1. Authentication & Session Security
- [ ] Firebase Auth email verification active for all caregiver registrations.
- [ ] Failed PIN attempts trigger exponential rate-limiting lockout after 5 tries.
- [ ] Passwordless invitation links expire after 24 hours and fail on second use.
- [ ] Session tokens expire after 60 minutes of inactivity; re-authentication requested for critical actions.
- [ ] No session tokens or secret keys stored in `localStorage` or `sessionStorage` (use secure, `HttpOnly`, `SameSite=Strict` cookies).

#### 2. Authorization & Tenant Isolation
- [ ] Direct Object Reference (IDOR) tests confirm Patient A cannot access Patient B's data via `/api/patients/{id}`.
- [ ] Read-only family role cannot trigger medication schedule modifications (returns `403 Forbidden`).
- [ ] Direct Firestore write attempts via client SDK are rejected by Firestore Security Rules.
- [ ] Unauthenticated API requests receive clean `401 Unauthorized` without leaking stack traces.

#### 3. Input Validation & Data Sanitization
- [ ] All API routes validate input bodies, query parameters, and route parameters against Zod schemas.
- [ ] Zod schemas strip unlisted keys, preventing object injection or prototype pollution.
- [ ] Rich text or string inputs (e.g., care notes) sanitized against Cross-Site Scripting (XSS).
- [ ] Date-time fields validated against ISO-8601 formatting and boundary-checked (no timestamps in distant past or future).

#### 4. Cryptographic Hygiene & Secrets Management
- [ ] No secrets, keys, or passwords committed to Git repository (verified via `trufflehog` pre-commit hooks).
- [ ] All third-party API keys (Twilio, Firebase Admin) loaded exclusively via Cloud Secret Manager.
- [ ] Passcodes and PINs stored hashed via `bcrypt` (cost factor 12), never in clear text.
- [ ] HTTPS enforced across all endpoints; plain HTTP requests automatically upgrade or reject.

#### 5. Audit Logging & System Reliability
- [ ] All medication taken/skipped actions generate a corresponding record in the audit log sub-collection.
- [ ] Audit records cannot be modified or deleted by any user role (verified via unit test against Firestore rules).
- [ ] Reminder triggers fail gracefully when third-party gateways (e.g., Twilio) are unreachable, logging failure without blocking the event queue.
- [ ] Rate limits prevent denial of service on notification and authentication routes.


---\n
## 14. Testing Strategy

### 14.1 Testing Architecture & Hackathon Pyramid

The JEEVASETU quality assurance framework is engineered around a risk-weighted test pyramid designed specifically for a fast-paced hackathon lifecycle. In a digital healthcare application handling medication schedules, caregiver linkages, and patient adherence records, bugs in business logic can lead to missed doses or corrupted health data. Conversely, brittle and slow end-to-end tests can derail rapid prototyping.

To strike an optimal balance between execution speed, confidence, and implementation velocity, test distribution is partitioned into a **65 / 25 / 10** ratio:

```
                  ┌──────────────────────┐
                  │       E2E Tests      │
                  │         (10%)        │  Playwright
                  │ Critical Demo Paths  │  (Multi-tab, Offline, Auth)
                  ├──────────────────────┴─────┐
                  │     Integration Tests      │
                  │           (25%)            │  Vitest + Firebase Emulators
                  │ Security Rules, API Routes │  (Contracts, Atomic Transactions)
                  ├────────────────────────────┴────────┐
                  │              Unit Tests             │
                  │                (65%)                │  Vitest (In-Memory)
                  │ Core Calculations, State Machines,  │  (Zero-latency, Pure Logic)
                  │ Schemas, Schedule Generators        │
                  └─────────────────────────────────────┘
```

#### Test Distribution Matrix

| Layer | Proportion | Tooling | Scope & Target | Target Execution Time |
| :--- | :--- | :--- | :--- | :--- |
| **Unit** | 65% | Vitest (In-memory, Node/Happy-DOM) | Pure business logic, math calculations, Zod schemas, state transitions, idempotency hashing. | `< 5 seconds` (entire suite) |
| **Integration** | 25% | Vitest + Local Firebase Emulators | Firestore security rules, multi-step transaction pipelines, API route contracts, invite codes. | `< 25 seconds` |
| **E2E** | 10% | Playwright (Chromium Headless) | Core user journeys: Patient registration, drug scheduling, dose logging, offline catchup. | `< 90 seconds` |

---

### 14.2 Unit Testing Strategy (Vitest)

Unit tests target critical, deterministic logic with no external network or database dependencies. Vitest is configured with `threads` and `isolate: true` for maximum parallelism and zero cross-test state leakage.

#### Vitest Base Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'src/**/*.e2e.test.ts', 'node_modules'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/core/**/*.ts', 'src/lib/**/*.ts'],
    },
    mockReset: true,
    restoreMocks: true,
  },
});
```

---

#### 14.2.1 Medication Schedule Expansion Logic

The expansion engine translates recurrence rules (e.g., BID — twice daily, TID — three times daily, specific days of week, PRN) into concrete timestamped dose instances within a queried date range.

##### Target Test Cases
- Expanding standard BID (`08:00`, `20:00`) over a 7-day window yields exactly 14 slots.
- Handling timezone offsets and Daylight Saving Time (DST) shifts without moving dose times.
- Handling complex taper schedules (e.g., Prednisone 20mg for 3 days, 10mg for 3 days).
- Clamping generated instances within medication `startDate` and `endDate`.

##### Test Implementation (`src/core/scheduler/schedule-expander.spec.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandScheduleToDoseSlots } from './schedule-expander';
import { MedicationSchedule, DoseSlot } from '../types/medication';

describe('Schedule Expander Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
  });

  it('correctly expands a BID (twice daily) regimen over a 3-day query range', () => {
    const schedule: MedicationSchedule = {
      medicationId: 'med-metformin-500',
      patientId: 'patient-101',
      frequencyType: 'DAILY',
      timesOfDay: ['08:00', '20:00'],
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-11-10T23:59:59.999Z',
      dosage: { amount: 500, unit: 'mg' },
      timezone: 'Asia/Kolkata',
    };

    const rangeStart = new Date('2026-11-01T00:00:00.000Z');
    const rangeEnd = new Date('2026-11-03T23:59:59.999Z');

    const slots: DoseSlot[] = expandScheduleToDoseSlots(schedule, rangeStart, rangeEnd);

    expect(slots).toHaveLength(6);
    expect(slots[0]).toMatchObject({
      medicationId: 'med-metformin-500',
      scheduledTime: '2026-11-01T02:30:00.000Z', // 08:00 IST in UTC (+05:30)
      status: 'SCHEDULED',
    });
    expect(slots[1].scheduledTime).toBe('2026-11-01T14:30:00.000Z'); // 20:00 IST in UTC
  });

  it('respects end date boundaries and omits slots past the course completion', () => {
    const shortCourse: MedicationSchedule = {
      medicationId: 'med-azithromycin',
      patientId: 'patient-101',
      frequencyType: 'DAILY',
      timesOfDay: ['09:00'],
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-11-03T23:59:59.999Z',
      dosage: { amount: 250, unit: 'mg' },
      timezone: 'UTC',
    };

    const broadRangeStart = new Date('2026-11-01T00:00:00.000Z');
    const broadRangeEnd = new Date('2026-11-10T23:59:59.999Z');

    const slots = expandScheduleToDoseSlots(shortCourse, broadRangeStart, broadRangeEnd);
    expect(slots).toHaveLength(3);
    const generatedDates = slots.map((s) => s.scheduledTime.split('T')[0]);
    expect(generatedDates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('returns empty array when query range is completely outside medication effective window', () => {
    const futureSchedule: MedicationSchedule = {
      medicationId: 'med-atorvastatin',
      patientId: 'patient-101',
      frequencyType: 'DAILY',
      timesOfDay: ['21:00'],
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.999Z',
      dosage: { amount: 20, unit: 'mg' },
      timezone: 'UTC',
    };

    const slots = expandScheduleToDoseSlots(
      futureSchedule,
      new Date('2026-11-01T00:00:00.000Z'),
      new Date('2026-11-05T00:00:00.000Z')
    );
    expect(slots).toHaveLength(0);
  });
});
```

---

#### 14.2.2 Adherence Calculation Engine

Calculates Proportion of Days Covered (PDC), Medication Possession Ratio (MPR), and real-time intake streak metrics.

##### Target Test Cases
- Calculating exact percentage with mixed statuses (`TAKEN`, `MISSED`, `SKIPPED`, `SNOOZED`).
- Evaluating adherence windows: doses taken within $\pm 120$ minutes of scheduled time classify as `ON_TIME`; doses taken $> 120$ minutes late classify as `LATE`.
- Active streak increments on `ON_TIME` or `LATE`, breaks to zero on `MISSED`.

##### Test Implementation (`src/core/analytics/adherence.spec.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { calculatePDC, calculateStreak, classifyDoseTiming } from './adherence';
import { MedicationEvent } from '../types/medication';

describe('Adherence Calculation Engine', () => {
  it('correctly calculates PDC percentage ignoring future scheduled doses', () => {
    const events: Partial<MedicationEvent>[] = [
      { status: 'TAKEN', scheduledTime: '2026-11-01T08:00:00Z' },
      { status: 'TAKEN', scheduledTime: '2026-11-02T08:00:00Z' },
      { status: 'MISSED', scheduledTime: '2026-11-03T08:00:00Z' },
      { status: 'TAKEN', scheduledTime: '2026-11-04T08:00:00Z' },
    ];

    const result = calculatePDC(events as MedicationEvent[]);
    // 3 taken out of 4 elapsed events = 75.0%
    expect(result.scorePercentage).toBe(75);
    expect(result.totalEligibleDoses).toBe(4);
    expect(result.adherentDoses).toBe(3);
  });

  it('classifies dose timing relative to scheduled tolerance window', () => {
    const scheduled = '2026-11-01T08:00:00.000Z';

    // 15 mins late -> ON_TIME (Window: +/- 120 min)
    expect(classifyDoseTiming(scheduled, '2026-11-01T08:15:00.000Z')).toBe('ON_TIME');

    // 150 mins late -> LATE
    expect(classifyDoseTiming(scheduled, '2026-11-01T10:30:00.000Z')).toBe('LATE');

    // 4 hours early -> EARLY
    expect(classifyDoseTiming(scheduled, '2026-11-01T04:00:00.000Z')).toBe('EARLY');
  });

  it('resets streak to 0 upon encountering a MISSED dose', () => {
    const timeline: Partial<MedicationEvent>[] = [
      { status: 'TAKEN', scheduledTime: '2026-11-01T08:00:00Z' },
      { status: 'TAKEN', scheduledTime: '2026-11-02T08:00:00Z' },
      { status: 'MISSED', scheduledTime: '2026-11-03T08:00:00Z' },
      { status: 'TAKEN', scheduledTime: '2026-11-04T08:00:00Z' },
      { status: 'TAKEN', scheduledTime: '2026-11-05T08:00:00Z' },
    ];

    const streak = calculateStreak(timeline as MedicationEvent[]);
    expect(streak).toBe(2); // Doses on 4th and 5th
  });
});
```

---

#### 14.2.3 Authorization Checks (Pure Domain Policies)

Tests in-memory attribute-based and role-based authorization guards decoupled from database contexts.

##### Target Test Cases
- Primary Caregivers have `READ` and `WRITE` permissions on linked Patient regimens.
- Secondary Caregivers have `READ`-only access unless explicitly granted `MEDICATION_LOG` permission.
- Patients cannot modify or delete audit logs created by Caregivers.

##### Test Implementation (`src/core/auth/permissions.spec.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { canPerformAction } from './permissions';
import { UserRole, DomainAction, AuthContext } from '../types/auth';

describe('Authorization Check Rules', () => {
  const patientContext: AuthContext = {
    userId: 'user-pat-01',
    role: UserRole.PATIENT,
    linkedPatientIds: ['user-pat-01'],
  };

  const caregiverContext: AuthContext = {
    userId: 'user-cg-01',
    role: UserRole.CAREGIVER,
    linkedPatientIds: ['user-pat-01'],
    permissions: ['VIEW_DOSES', 'LOG_DOSE'],
  };

  const strangerCaregiver: AuthContext = {
    userId: 'user-cg-99',
    role: UserRole.CAREGIVER,
    linkedPatientIds: ['user-pat-99'],
    permissions: ['VIEW_DOSES', 'LOG_DOSE'],
  };

  it('permits patients to log their own medication intake', () => {
    const allowed = canPerformAction(
      patientContext,
      DomainAction.LOG_DOSE,
      { patientId: 'user-pat-01' }
    );
    expect(allowed).toBe(true);
  });

  it('permits authorized caregivers to log medication for linked patients', () => {
    const allowed = canPerformAction(
      caregiverContext,
      DomainAction.LOG_DOSE,
      { patientId: 'user-pat-01' }
    );
    expect(allowed).toBe(true);
  });

  it('denies access if caregiver attempts action on unlinked patient', () => {
    const allowed = canPerformAction(
      strangerCaregiver,
      DomainAction.LOG_DOSE,
      { patientId: 'user-pat-01' }
    );
    expect(allowed).toBe(false);
  });
});
```

---

#### 14.2.4 Input Validation Schemas (Zod)

Guarantees data integrity at API boundaries, offline queue payloads, and form submissions.

##### Test Implementation (`src/core/validation/schemas.spec.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { createMedicationSchema, logDoseEventSchema } from './schemas';

describe('Zod Input Validation Schemas', () => {
  it('passes on valid medication creation payload', () => {
    const validPayload = {
      name: 'Amoxicillin',
      dosage: { amount: 500, unit: 'mg' },
      frequencyType: 'DAILY',
      timesOfDay: ['09:00', '21:00'],
      startDate: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
    };

    const parsed = createMedicationSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid dose times formatted outside HH:MM 24-hour specification', () => {
    const invalidPayload = {
      name: 'Amoxicillin',
      dosage: { amount: 500, unit: 'mg' },
      frequencyType: 'DAILY',
      timesOfDay: ['9:00 AM', '25:00'], // Invalid strings
      startDate: new Date().toISOString(),
      timezone: 'UTC',
    };

    const parsed = createMedicationSchema.safeParse(invalidPayload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.timesOfDay).toBeDefined();
    }
  });

  it('enforces non-negative dose amounts', () => {
    const invalidDose = {
      name: 'Insulin',
      dosage: { amount: -5, unit: 'units' },
      frequencyType: 'DAILY',
      timesOfDay: ['08:00'],
      startDate: new Date().toISOString(),
      timezone: 'UTC',
    };

    const parsed = createMedicationSchema.safeParse(invalidDose);
    expect(parsed.success).toBe(false);
  });
});
```

---

#### 14.2.5 Idempotency Key Generation

Ensures duplicate network submissions or offline replay attempts do not generate duplicate event logs in Firestore.

##### Target Test Cases
- Same payload + same scheduled timestamp = identical idempotency key.
- Different status (e.g. `TAKEN` vs `SKIPPED`) produces distinct hashes.
- Sanitizes leading/trailing whitespaces and key ordering before hashing.

##### Test Implementation (`src/core/sync/idempotency.spec.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey } from './idempotency';

describe('Idempotency Key Generator', () => {
  it('generates identical SHA-256 hash regardless of object key order', () => {
    const payloadA = {
      patientId: 'pat-1',
      medicationId: 'med-1',
      scheduledTime: '2026-11-15T08:00:00Z',
      action: 'TAKEN',
    };

    const payloadB = {
      action: 'TAKEN',
      scheduledTime: '2026-11-15T08:00:00Z',
      medicationId: 'med-1',
      patientId: 'pat-1',
    };

    const keyA = generateIdempotencyKey(payloadA);
    const keyB = generateIdempotencyKey(payloadB);

    expect(keyA).toBe(keyB);
    expect(keyA).toMatch(/^idem_[a-f0-9]{64}$/);
  });

  it('produces distinct keys when action timestamp differs', () => {
    const base = {
      patientId: 'pat-1',
      medicationId: 'med-1',
      action: 'TAKEN',
    };

    const key1 = generateIdempotencyKey({ ...base, scheduledTime: '2026-11-15T08:00:00Z' });
    const key2 = generateIdempotencyKey({ ...base, scheduledTime: '2026-11-15T20:00:00Z' });

    expect(key1).not.toBe(key2);
  });
});
```

---

#### 14.2.6 Offline Sync Queue Processing

Tests local action queue consolidation, retry policies, and Last-Write-Wins (LWW) resolution before sending payloads to Firestore.

##### Test Implementation (`src/core/sync/queue-processor.spec.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { processSyncQueue, QueueItem } from './queue-processor';

describe('Offline Sync Queue Processing', () => {
  it('collapses redundant dose events for the same scheduled slot into latest state', () => {
    const queue: QueueItem[] = [
      {
        id: 'q-1',
        idempotencyKey: 'idem-dose-1',
        action: 'DOSE_LOG',
        payload: { slotId: 'slot-1', status: 'SNOOZED', timestamp: '2026-11-15T08:05:00Z' },
        clientSequence: 1,
      },
      {
        id: 'q-2',
        idempotencyKey: 'idem-dose-1',
        action: 'DOSE_LOG',
        payload: { slotId: 'slot-1', status: 'TAKEN', timestamp: '2026-11-15T08:25:00Z' },
        clientSequence: 2,
      },
    ];

    const deduplicated = processSyncQueue.deduplicate(queue);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].payload.status).toBe('TAKEN');
    expect(deduplicated[0].id).toBe('q-2');
  });

  it('moves failed items to Dead-Letter Queue (DLQ) after exceeding 3 retries', () => {
    const expiredItem: QueueItem = {
      id: 'q-failed',
      idempotencyKey: 'idem-err',
      action: 'DOSE_LOG',
      payload: {},
      retryCount: 3,
      clientSequence: 10,
    };

    const outcome = processSyncQueue.evaluateRetry(expiredItem, new Error('Network Timeout'));
    expect(outcome.shouldRetry).toBe(false);
    expect(outcome.target).toBe('DEAD_LETTER_QUEUE');
  });
});
```

---

### 14.3 Integration Testing Strategy (Vitest + Firebase Emulators)

Integration tests validate API contract integrity, atomic multi-document writes, and security boundaries executing against running **Firestore & Auth Local Emulators**.

#### Integration Setup & Environment Configuration

```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

---

#### 14.3.1 API Route Handlers with Emulated Firebase

Tests Next.js / Express route handlers with authenticated Firebase context headers.

##### Test Implementation (`src/pages/api/medications/log.integration.test.ts`)

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createServer } from 'http';
import request from 'supertest';
import { apiHandler } from '@/server/api-handler';
import { clearFirestoreData, createAuthUserRecord } from '@/test/emulator-utils';

describe('POST /api/medications/log Integration', () => {
  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  });

  afterEach(async () => {
    await clearFirestoreData();
  });

  it('logs dose and returns 201 when called with valid token and payload', async () => {
    const patientToken = await createAuthUserRecord({
      uid: 'pat-integration-01',
      email: 'patient@jeevasetu.org',
    });

    const response = await request(apiHandler)
      .post('/api/medications/log')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        medicationId: 'med-aspirin-100',
        patientId: 'pat-integration-01',
        scheduledTime: '2026-11-15T08:00:00.000Z',
        actualTime: '2026-11-15T08:10:00.000Z',
        status: 'TAKEN',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.event.idempotencyKey).toBeDefined();
  });

  it('rejects with 403 Forbidden when patient attempts to log for another user', async () => {
    const patientToken = await createAuthUserRecord({
      uid: 'pat-attacker',
      email: 'attacker@jeevasetu.org',
    });

    const response = await request(apiHandler)
      .post('/api/medications/log')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        medicationId: 'med-aspirin-100',
        patientId: 'pat-victim-99', // Mismatched patientId
        scheduledTime: '2026-11-15T08:00:00.000Z',
        status: 'TAKEN',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Forbidden: Access Denied');
  });
});
```

---

#### 14.3.2 Firestore Security Rules Testing

Uses `@firebase/rules-unit-testing` to verify security isolation defined in `firestore.rules`.

##### Test Implementation (`src/test/security-rules.integration.test.ts`)

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules Verification', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'jeevasetu-test-rules',
      firestore: {
        rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('allows a patient to read and write their own medication documents', async () => {
    const patientAuth = testEnv.authenticatedContext('patient_123', {
      email: 'patient@jeevasetu.org',
      role: 'PATIENT',
    });

    const docRef = patientAuth.firestore().collection('patients').doc('patient_123');

    await assertSucceeds(docRef.set({ name: 'Ramesh Patel', active: true }));
    await assertSucceeds(docRef.get());
  });

  it('prevents an unlinked user from reading another patient medication list', async () => {
    // Seed target record as admin
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('patients/patient_123/medications/med_1').set({
        name: 'Metformin',
        dosage: '500mg',
      });
    });

    const unauthorizedUser = testEnv.authenticatedContext('stranger_456');
    const targetDoc = unauthorizedUser
      .firestore()
      .doc('patients/patient_123/medications/med_1');

    await assertFails(targetDoc.get());
  });

  it('allows a caregiver to read medication list if a verified link exists', async () => {
    // Seed verified caregiver link
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('caregiver_links/link_caregiver_to_patient').set({
        caregiverId: 'caregiver_789',
        patientId: 'patient_123',
        status: 'ACTIVE',
      });
      await context.firestore().doc('patients/patient_123/medications/med_1').set({
        name: 'Metformin',
      });
    });

    const caregiverAuth = testEnv.authenticatedContext('caregiver_789', {
      email: 'caregiver@jeevasetu.org',
      role: 'CAREGIVER',
    });

    const targetDoc = caregiverAuth
      .firestore()
      .doc('patients/patient_123/medications/med_1');

    await assertSucceeds(targetDoc.get());
  });
});
```

---

#### 14.3.3 Caregiver Invitation Passcode Flow

Validates generation, expiration, atomic claiming, and role-binding using Firestore transactions.

##### Target Test Cases
- Generating 6-digit passcode with a 15-minute Time-To-Live (TTL).
- Claiming an unused code binds `patientId` to `caregiverId` atomically.
- Attempting to redeem an expired or already claimed code throws `400 / 410 Gone`.

##### Test Implementation (`src/core/invitations/invitation-flow.integration.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { generateInvitation, claimInvitationPasscode } from './invitation-service';
import { getTestFirestoreInstance, clearFirestoreData } from '@/test/emulator-utils';

describe('Invitation Passcode Flow Integration', () => {
  const db = getTestFirestoreInstance();

  beforeEach(async () => {
    await clearFirestoreData();
  });

  it('completes the full generate -> claim lifecycle atomically', async () => {
    // 1. Patient generates invitation code
    const invitation = await generateInvitation({
      patientId: 'pat-100',
      createdBy: 'pat-100',
      ttlMinutes: 15,
    });

    expect(invitation.passcode).toMatch(/^[A-Z0-9]{6}$/);
    expect(invitation.status).toBe('PENDING');

    // 2. Caregiver claims passcode
    const claimResult = await claimInvitationPasscode({
      passcode: invitation.passcode,
      caregiverId: 'cg-200',
    });

    expect(claimResult.success).toBe(true);
    expect(claimResult.patientId).toBe('pat-100');

    // 3. Verify status update in Firestore
    const updatedDoc = await db.collection('invitations').doc(invitation.id).get();
    expect(updatedDoc.data()?.status).toBe('CLAIMED');
    expect(updatedDoc.data()?.claimedBy).toBe('cg-200');

    // 4. Verify caregiver link doc created
    const linkQuery = await db
      .collection('caregiver_links')
      .where('patientId', '==', 'pat-100')
      .where('caregiverId', '==', 'cg-200')
      .get();

    expect(linkQuery.empty).toBe(false);
    expect(linkQuery.docs[0].data().status).toBe('ACTIVE');
  });

  it('rejects double-redemption of identical invitation code', async () => {
    const invitation = await generateInvitation({
      patientId: 'pat-100',
      createdBy: 'pat-100',
      ttlMinutes: 15,
    });

    // First claim succeeds
    await claimInvitationPasscode({
      passcode: invitation.passcode,
      caregiverId: 'cg-200',
    });

    // Second claim fails
    await expect(
      claimInvitationPasscode({
        passcode: invitation.passcode,
        caregiverId: 'cg-999',
      })
    ).rejects.toThrow('Invitation already claimed or expired');
  });
});
```

---

#### 14.3.4 Reminder Processing Pipeline

Tests background queue processing, finding due medication doses in the current 10-minute window, and dispatching notification triggers without duplicates.

##### Test Implementation (`src/server/reminders/reminder-pipeline.integration.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runReminderWorker } from './reminder-worker';
import { getTestFirestoreInstance, clearFirestoreData } from '@/test/emulator-utils';

describe('Reminder Processing Pipeline', () => {
  const db = getTestFirestoreInstance();

  beforeEach(async () => {
    await clearFirestoreData();
  });

  it('queries due doses, dispatches alerts, and sets reminderSent flag', async () => {
    const fixedNow = '2026-11-15T08:05:00.000Z';
    vi.setSystemTime(new Date(fixedNow));

    // Seed a due dose slot (08:00 UTC) with reminderSent = false
    await db.collection('dose_slots').doc('slot-due-1').set({
      patientId: 'patient-abc',
      medicationName: 'Metformin',
      scheduledTime: '2026-11-15T08:00:00.000Z',
      status: 'SCHEDULED',
      reminderSent: false,
    });

    // Seed a future dose slot (12:00 UTC)
    await db.collection('dose_slots').doc('slot-future-2').set({
      patientId: 'patient-abc',
      medicationName: 'Metformin',
      scheduledTime: '2026-11-15T12:00:00.000Z',
      status: 'SCHEDULED',
      reminderSent: false,
    });

    const mockDispatcher = vi.fn().mockResolvedValue({ delivered: true });

    const summary = await runReminderWorker({
      currentTime: new Date(fixedNow),
      dispatcher: mockDispatcher,
    });

    expect(summary.processedCount).toBe(1);
    expect(mockDispatcher).toHaveBeenCalledTimes(1);
    expect(mockDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient-abc',
        medicationName: 'Metformin',
      })
    );

    // Verify slot updated in database to prevent double dispatch
    const updatedSlot = await db.collection('dose_slots').doc('slot-due-1').get();
    expect(updatedSlot.data()?.reminderSent).toBe(true);
  });
});
```

---

### 14.4 End-to-End Testing Strategy (Playwright)

E2E tests validate complete multi-persona user journeys in real Chromium browser contexts against the frontend application and local Firebase emulators.

#### Playwright Configuration (`playwright.config.ts`)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Maintain deterministic auth states in hackathon
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

---

#### 14.4.1 User Registration and Authentication Flow

```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication Journey', () => {
  test('allows new user to sign up as Patient and redirects to onboarding', async ({ page }) => {
    const testEmail = `test_pat_${Date.now()}@jeevasetu.org`;

    await page.goto('/auth/register');
    await page.fill('input[name="name"]', 'Aarav Sharma');
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', 'Password@123');
    await page.selectOption('select[name="role"]', 'PATIENT');

    await page.click('button[type="submit"]');

    // Should redirect to patient onboarding profile creation
    await expect(page).toHaveURL(/\/onboarding\/patient/);
    await expect(page.locator('h1')).toContainText('Complete Your Health Profile');
  });
});
```

---

#### 14.4.2 Create Patient Profile

```typescript
import { test, expect } from '@playwright/test';
import { authenticateTestUser } from './helpers/auth-helper';

test.describe('Patient Profile Setup', () => {
  test('creates patient medical baseline information', async ({ page }) => {
    await authenticateTestUser(page, { role: 'PATIENT' });

    await page.goto('/onboarding/patient');
    await page.fill('input[name="dateOfBirth"]', '1985-05-15');
    await page.selectOption('select[name="bloodGroup"]', 'O_POSITIVE');
    await page.fill('input[name="emergencyContactName"]', 'Sunita Sharma');
    await page.fill('input[name="emergencyContactPhone"]', '+919876543210');

    await page.click('button:has-text("Save Profile")');

    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('[data-testid="welcome-banner"]')).toContainText('Welcome back');
  });
});
```

---

#### 14.4.3 Add Medication and Daily Schedule

```typescript
import { test, expect } from '@playwright/test';
import { authenticateTestUser } from './helpers/auth-helper';

test.describe('Medication Management', () => {
  test('adds a new prescription schedule with multi-dose timings', async ({ page }) => {
    await authenticateTestUser(page, { role: 'PATIENT' });

    await page.goto('/medications/new');
    await page.fill('[data-testid="med-name-input"]', 'Metformin');
    await page.fill('[data-testid="med-dosage-amount"]', '500');
    await page.selectOption('[data-testid="med-dosage-unit"]', 'mg');

    // Frequency: Twice a day
    await page.selectOption('[data-testid="frequency-select"]', 'DAILY');
    await page.fill('[data-testid="dose-time-0"]', '08:00');
    await page.click('button:has-text("Add Dose Time")');
    await page.fill('[data-testid="dose-time-1"]', '20:00');

    await page.click('button:has-text("Save Medication")');

    await expect(page).toHaveURL('/medications');
    await expect(page.locator('[data-testid="med-card-Metformin"]')).toBeVisible();
    await expect(page.locator('[data-testid="dose-pills"]')).toContainText('08:00');
    await expect(page.locator('[data-testid="dose-pills"]')).toContainText('20:00');
  });
});
```

---

#### 14.4.4 Log Medication Event (Take / Snooze / Skip)

```typescript
import { test, expect } from '@playwright/test';
import { authenticateTestUser } from './helpers/auth-helper';

test.describe('Dose Logging Action', () => {
  test('marks today due dose as TAKEN and updates adherence chip in UI', async ({ page }) => {
    await authenticateTestUser(page, { role: 'PATIENT' });

    await page.goto('/dashboard');
    const firstDueCard = page.locator('[data-testid="dose-card"]').first();
    await expect(firstDueCard).toBeVisible();

    // Click "Take Dose"
    await firstDueCard.locator('button[data-action="TAKE"]').click();

    // Confirm visual status update to TAKEN
    await expect(firstDueCard.locator('[data-testid="status-badge"]')).toContainText('TAKEN');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText('Dose recorded');
  });
});
```

---

#### 14.4.5 View Adherence Dashboard

```typescript
import { test, expect } from '@playwright/test';
import { authenticateTestUser } from './helpers/auth-helper';

test.describe('Adherence Dashboard', () => {
  test('displays adherence score percentage and streak metrics', async ({ page }) => {
    await authenticateTestUser(page, { role: 'PATIENT' });

    await page.goto('/dashboard/adherence');

    await expect(page.locator('[data-testid="adherence-gauge"]')).toBeVisible();
    await expect(page.locator('[data-testid="current-streak-count"]')).toContainText(/\d+ Days/);
    await expect(page.locator('[data-testid="history-calendar"]')).toBeVisible();
  });
});
```

---

#### 14.4.6 Caregiver Invitation Flow (Multi-Persona Cross-Journey)

```typescript
import { test, expect } from '@playwright/test';
import { authenticateTestUser } from './helpers/auth-helper';

test.describe('Caregiver Invitation Flow', () => {
  test('patient generates invitation passcode and caregiver claims it in second browser context', async ({
    browser,
  }) => {
    // Context A: Patient
    const patientContext = await browser.newContext();
    const patientPage = await patientContext.newPage();
    await authenticateTestUser(patientPage, { role: 'PATIENT', uid: 'pat-invite-src' });

    await patientPage.goto('/settings/caregivers');
    await patientPage.click('button:has-text("Invite Caregiver")');

    const codeLocator = patientPage.locator('[data-testid="invitation-passcode"]');
    await expect(codeLocator).toBeVisible();
    const passcode = (await codeLocator.textContent())?.trim();
    expect(passcode).toHaveLength(6);

    // Context B: Caregiver
    const caregiverContext = await browser.newContext();
    const caregiverPage = await caregiverContext.newPage();
    await authenticateTestUser(caregiverPage, { role: 'CAREGIVER', uid: 'cg-invite-target' });

    await caregiverPage.goto('/caregiver/connect');
    await caregiverPage.fill('input[name="passcode"]', passcode!);
    await caregiverPage.click('button:has-text("Connect Patient")');

    await expect(caregiverPage.locator('[data-testid="toast-success"]')).toContainText(
      'Successfully connected to patient'
    );
    await expect(caregiverPage.locator('[data-testid="linked-patient-list"]')).toContainText(
      'pat-invite-src'
    );

    // Cleanup
    await patientContext.close();
    await caregiverContext.close();
  });
});
```

---

#### 14.4.7 Offline Mode & Sync Recovery

```typescript
import { test, expect } from '@playwright/test';
import { authenticateTestUser } from './helpers/auth-helper';

test.describe('Offline Mode Recovery Journey', () => {
  test('queues dose intake while disconnected and synchronizes when online restored', async ({
    page,
    context,
  }) => {
    await authenticateTestUser(page, { role: 'PATIENT' });
    await page.goto('/dashboard');

    // Simulate going offline
    await context.setOffline(true);
    await expect(page.locator('[data-testid="offline-banner"]')).toBeVisible();

    // Log dose in offline mode
    const doseCard = page.locator('[data-testid="dose-card"]').first();
    await doseCard.locator('button[data-action="TAKE"]').click();

    // Verify optimistic UI update and pending sync badge
    await expect(doseCard.locator('[data-testid="sync-pending-badge"]')).toBeVisible();

    // Restore network connectivity
    await context.setOffline(false);
    await expect(page.locator('[data-testid="offline-banner"]')).toBeHidden({ timeout: 10000 });

    // Pending sync indicator resolves to synced state
    await expect(doseCard.locator('[data-testid="sync-pending-badge"]')).toBeHidden({
      timeout: 10000,
    });
    await expect(doseCard.locator('[data-testid="status-badge"]')).toContainText('TAKEN');
  });
});
```

---

### 14.5 Test Data Strategy (Factories & Fixtures)

To prevent brittle hardcoded JSON fixtures, test records are produced dynamically using TypeScript factories powered by `@faker-js/faker`.

#### Factory Architecture (`src/test/factories/index.ts`)

```typescript
import { faker } from '@faker-js/faker';
import { Patient, MedicationSchedule, MedicationEvent } from '@/core/types';

export const patientFactory = (overrides: Partial<Patient> = {}): Patient => ({
  id: overrides.id || `pat_${faker.string.nanoid(10)}`,
  name: overrides.name || faker.person.fullName(),
  email: overrides.email || faker.internet.email().toLowerCase(),
  dateOfBirth: overrides.dateOfBirth || '1980-01-01',
  bloodGroup: overrides.bloodGroup || 'A_POSITIVE',
  emergencyContact: overrides.emergencyContact || {
    name: faker.person.fullName(),
    phone: faker.phone.number(),
  },
  createdAt: overrides.createdAt || new Date().toISOString(),
  ...overrides,
});

export const medicationScheduleFactory = (
  overrides: Partial<MedicationSchedule> = {}
): MedicationSchedule => ({
  id: overrides.id || `med_${faker.string.nanoid(8)}`,
  patientId: overrides.patientId || `pat_${faker.string.nanoid(10)}`,
  medicationName: overrides.medicationName || faker.helpers.arrayElement([
    'Metformin',
    'Amlodipine',
    'Atorvastatin',
    'Lisinopril',
  ]),
  dosage: overrides.dosage || {
    amount: faker.helpers.arrayElement([10, 20, 500, 1000]),
    unit: 'mg',
  },
  frequencyType: overrides.frequencyType || 'DAILY',
  timesOfDay: overrides.timesOfDay || ['08:00', '20:00'],
  startDate: overrides.startDate || '2026-11-01T00:00:00.000Z',
  endDate: overrides.endDate || '2026-12-31T23:59:59.999Z',
  timezone: overrides.timezone || 'Asia/Kolkata',
  ...overrides,
});

export const medicationEventFactory = (
  overrides: Partial<MedicationEvent> = {}
): MedicationEvent => {
  const scheduled = overrides.scheduledTime || new Date().toISOString();
  return {
    id: overrides.id || `evt_${faker.string.nanoid(12)}`,
    patientId: overrides.patientId || `pat_${faker.string.nanoid(10)}`,
    medicationId: overrides.medicationId || `med_${faker.string.nanoid(8)}`,
    scheduledTime: scheduled,
    actualTime: overrides.actualTime || scheduled,
    status: overrides.status || 'TAKEN',
    idempotencyKey: overrides.idempotencyKey || `idem_${faker.string.hexadecimal({ length: 64 })}`,
    loggedBy: overrides.loggedBy || 'PATIENT',
    ...overrides,
  };
};
```

---

### 14.6 Firebase Emulator Setup for Testing

The Firebase Emulator Suite provides high-fidelity local emulation of Auth, Firestore, and Cloud Functions with zero cloud network overhead and instant state teardowns.

#### 14.6.1 Configuration (`firebase.json`)

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": {
      "port": 9099,
      "host": "127.0.0.1"
    },
    "firestore": {
      "port": 8080,
      "host": "127.0.0.1"
    },
    "functions": {
      "port": 5001,
      "host": "127.0.0.1"
    },
    "ui": {
      "enabled": true,
      "port": 4000,
      "host": "127.0.0.1"
    }
  }
}
```

#### 14.6.2 Emulator Helper Utilities (`src/test/emulator-utils.ts`)

```typescript
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const testConfig = {
  projectId: 'jeevasetu-hackathon-test',
  apiKey: 'fake-api-key',
};

export function getTestFirebaseApp() {
  if (getApps().length === 0) {
    const app = initializeApp(testConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099');
    return { app, db, auth };
  }
  return {
    app: getApps()[0],
    db: getFirestore(getApps()[0]),
    auth: getAuth(getApps()[0]),
  };
}

export function getTestFirestoreInstance() {
  return getTestFirebaseApp().db;
}

/**
 * Resets Firestore database state between integration tests using Emulator REST endpoint
 */
export async function clearFirestoreData() {
  const res = await fetch(
    `http://127.0.0.1:8080/emulator/v1/projects/jeevasetu-hackathon-test/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error('Failed to flush Firestore emulator data');
  }
}

/**
 * Generates an emulated JWT token for authorization headers
 */
export async function createAuthUserRecord({ uid, email }: { uid: string; email: string }) {
  // In emulators, minting or mock verification can be performed directly
  return `mock-token-${uid}-${email}`;
}
```

#### 14.6.3 Package Scripts (`package.json`)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:integration": "firebase emulators:exec --only auth,firestore \"vitest run --config vitest.integration.config.ts\"",
    "test:e2e": "firebase emulators:exec --only auth,firestore \"playwright test\"",
    "test:e2e:ui": "playwright test --ui",
    "ci:verify": "pnpm run test && pnpm run test:integration && pnpm run test:e2e"
  }
}
```

---

### 14.7 CI/CD Integration (Pre-Deploy Verification)

All automated tests run via GitHub Actions prior to staging or production deployment. A build gate strictly blocks pull requests and branch merges if any test stage or security audit fails.

#### GitHub Actions Workflow (`.github/workflows/test.yml`)

```yaml
name: JEEVASETU Test Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-and-typecheck:
    name: Lint & Type Validation
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: TypeScript Check
        run: pnpm run typecheck

      - name: ESLint
        run: pnpm run lint

  unit-tests:
    name: Vitest Unit Suite
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: Run Unit Tests with Coverage
        run: pnpm run test:coverage

  integration-tests:
    name: Firebase Emulated Integration Suite
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Setup Java JRE for Firebase Emulators
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - run: pnpm install --frozen-lockfile

      - name: Install Firebase CLI
        run: pnpm add -g firebase-tools

      - name: Run Integration Tests in Emulators
        run: pnpm run test:integration

  e2e-tests:
    name: Playwright Critical User Journeys
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - run: pnpm install --frozen-lockfile

      - name: Cache Playwright Browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ hashFiles('**/pnpm-lock.yaml') }}

      - name: Install Playwright Chromium Only (Fast Hackathon Build)
        run: pnpm exec playwright install chromium --with-deps

      - name: Run Playwright Tests with Emulators
        run: pnpm run test:e2e

      - name: Upload Test Artifacts on Failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-failure-traces
          path: |
            playwright-report/
            test-results/
          retention-days: 7

  deploy-gate:
    name: Deployment Gatekeeper
    runs-on: ubuntu-latest
    needs: [lint-and-typecheck, unit-tests, integration-tests, e2e-tests]
    steps:
      - name: Confirm Verification Succeeded
        run: echo "All test suites passed successfully. Safe to proceed with deployment."
```

---

### 14.8 Hackathon Prioritization Matrix

In a time-constrained hackathon, attempting 100% test coverage across peripheral UI screens creates counter-productive friction. The team focuses test engineering strictly on **high-stakes business logic** and **live demo paths**, while deferring non-critical audits.

#### Testing Scope Triage

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       HACKATHON PRIORITIZATION QUADRANT                     │
│                                                                             │
│   High Impact                                                               │
│       ▲                                                                     │
│       │  [P0] Auth & Session Flow           [P0] Adherence Calculation      │
│       │  [P0] Dose Logging & UI Sync        [P0] Schedule Expander (Math)   │
│       │  [P0] Firestore Security Rules      [P1] Invitation Passcode Flow   │
│       │                                                                     │
│       │  ─────────────────────────────────────────────────────────────────  │
│       │                                                                     │
│       │  [P2] Visual Regression (Percy)     [P2] Load/Stress Testing (k6)   │
│       │  [P2] WCAG AA Accessibility Audits  [P2] Cross-Browser Safari/FF    │
│       │  [P3] Full Branch Coverage (80%+)   [P3] Complex Taper Prescriptions│
│       ▼                                                                     │
│   Low Impact                                                                │
│       └────────────────────────────────────────────────────────────────►    │
│         Low Complexity / Fast                          High Complexity      │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Detailed Priority & Deferral Breakdown

| Component / Test Domain | Level | Priority | Hackathon In-Scope Actions | Post-Hackathon Deferral Justification |
| :--- | :--- | :---: | :--- | :--- |
| **Authentication & Tokens** | E2E + Integration | **P0** | Sign up, login, route protection, token refresh. | Zero tolerance: broken auth blocks the entire live demo. |
| **Medication Event Logging** | Unit + E2E | **P0** | Happy-path take/snooze/skip, instant UI state refresh, idempotency hashing. | Core value proposition of the product. |
| **Adherence Calculation Engine** | Unit | **P0** | PDC score calculation, streak increment/reset, late/on-time tolerance windowing. | Algorithmic logic must be 100% accurate; unit tests run in milliseconds. |
| **Firestore Security Isolation** | Integration | **P0** | Ensure Patient A cannot access Patient B records. | Fundamental requirement for healthcare data privacy. |
| **Caregiver Invitation Flow** | Integration + E2E | **P1** | Single-use 6-digit passcode creation and redemption. | Secondary demo flow; tested on happy path only. |
| **Offline Sync Queue** | Unit + Partial E2E | **P1** | Deduplication, conflict resolution, offline queueing. | Demonstrates resilience to judges; edge-case network partitions deferred. |
| **Comprehensive Code Coverage** | Overall Metric | **P2** | Maintain $>70\%$ on `/core` algorithms only. | Enforcing $85\%+$ on UI boilerplate waste hours during rapid design iterations. |
| **Performance & Load Testing** | Non-Functional | **P2** | Defer k6 / Artillery scripts; manually test with 50 mock items. | Hackathon demo runs on single-digit concurrent users. |
| **Automated Accessibility (a11y)** | Non-Functional | **P2** | Adhere to semantic HTML manually. Defer `@axe-core/playwright` CI pipeline. | Focus on user experience and core judging criteria first. |
| **Multi-Browser Engine Matrix** | E2E Matrix | **P2** | Test on Chromium / Mobile Chrome only. Defer WebKit and Firefox CI runners. | Cuts CI runtime by $66\%$; demo is conducted on controlled Chromium devices. |
| **Visual Regression Tests** | Visual CI | **P3** | Visual inspection during demo rehearsal; defer Percy / Chromatic. | UI components shift frequently during hackathon styling adjustments. |


---\n
## 15.1 Deployment Architecture & Topology

The JEEVASETU platform is architected as an event-driven, serverless full-stack application deployed on **Google Cloud Run**. Designed specifically for a hackathon environment with a solo developer constraint, this deployment topology balances zero-maintenance operational overhead, extreme cost efficiency (\$0 baseline within Google Cloud Free Tier), and high availability for emergency healthcare/blood donor matching.

```
                                 [ DNS / Custom Domain ]
                                            │
                                            ▼ (HTTPS / TLS Termination)
[ Cloud Scheduler ] ───────────► [ Google Cloud Run Service ] ◄─────────── [ Web/Mobile Clients ]
 (OIDC Auth Cron)                 (Next.js 14/15 Standalone)
                                            │
                     ┌──────────────────────┼──────────────────────┐
                     ▼                      ▼                      ▼
           [ Secret Manager ]     [ Firebase Auth ]       [ Cloud Firestore ]
         - Service Account Key   - Email/Password Provider - Regional Native Mode
         - Resend API Key        - Security Token Issuance - Emergency Requests
         - Scheduler Token                                 - Donor Registries
```

---

## 15.2 Next.js Standalone Build Configuration & Dockerfile

Next.js standalone output extracts only the production `node_modules` and compiled server code required to execute `server.js`, slashing final container image size from **~1.2 GB down to < 170 MB**. This directly accelerates Cloud Run cold starts.

### 1. Next.js Configuration (`next.config.mjs` or `next.config.js`)

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Optimizes package bundling in production
    optimizePackageImports: ['lucide-react', 'date-fns', 'firebase-admin'],
  },
};

export default nextConfig;
```

### 2. Multi-Stage Production Dockerfile (`Dockerfile`)

```dockerfile
# ==============================================================================
# Stage 1: Dependency Resolver
# ==============================================================================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Cache package installation layers
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --prefer-offline

# ==============================================================================
# Stage 2: Application Builder
# ==============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Invalidate Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Public environment variables needed at bundle/compile time
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_APP_URL

ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN npm run build

# ==============================================================================
# Stage 3: Minimal Production Runtime
# ==============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Non-root least-privilege security posture
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy static assets and compiled standalone server
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
```

### 3. Docker Ignore File (`.dockerignore`)

```text
.git
.github
.next
node_modules
Dockerfile*
.dockerignore
npm-debug.log
yarn-error.log
.env*.local
README.md
.vscode
```

---

## 15.3 Google Cloud Run Service Configuration

### Service Parameters Matrix

| Setting | Recommended Value | Hackathon & Technical Justification |
| :--- | :--- | :--- |
| **Region** | `asia-south1` (Mumbai) | Lowest latency for India-based healthcare emergency response. Alternative: `us-central1` if maximizing default GCP free tier credits. |
| **CPU / vCPU** | `1 vCPU` | Standard container allocation for Next.js SSR and API route processing. |
| **Memory** | `1 GiB` (1024 MiB) | Safely accommodates Next.js in-memory page caching without triggering OOM crashes. |
| **Min Instances** | `0` (or `1` if budget permits) | `0` guarantees \$0 idle cost; scale-to-zero when unvisited. `1` prevents cold starts. |
| **Max Instances** | `5` | Strict ceiling against runaway billing or accidental load loops. |
| **Concurrency** | `80` | Handles up to 80 concurrent async I/O connections per instance before auto-scaling. |
| **Execution Environment**| `Second Generation` (`gen2`) | Full Linux kernel compatibility, faster fast-path network I/O. |
| **CPU Allocation** | CPU allocated during request processing | Cost-efficient; CPU throttled to 0 between requests. |
| **Startup CPU Boost** | `Enabled` (`--cpu-boost`) | Temporarily doubles CPU during container boot to cut cold starts by ~50%. |

### Declarative Service Specification (`cloudrun-service.yaml`)

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: jeevasetu-web
  labels:
    cloud.googleapis.com/location: asia-south1
    app: jeevasetu
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"
        autoscaling.knative.dev/maxScale: "5"
        run.googleapis.com/cpu-throttling: "true"
        run.googleapis.com/startup-cpu-boost: "true"
        run.googleapis.com/execution-environment: "gen2"
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
        - image: asia-south1-docker.pkg.dev/PROJECT_ID/jeevasetu-repo/web:latest
          ports:
            - name: http1
              containerPort: 8080
          resources:
            limits:
              cpu: "1000m"
              memory: "1024Mi"
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "8080"
            - name: NEXT_PUBLIC_APP_URL
              value: "https://jeevasetu-web-xyz-el.a.run.app"
            - name: NEXT_PUBLIC_FIREBASE_PROJECT_ID
              value: "jeevasetu-prod"
            # Injected directly from Secret Manager
            - name: RESEND_API_KEY
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: resend-api-key
            - name: FIREBASE_SERVICE_ACCOUNT_KEY
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: firebase-service-account-key
            - name: SCHEDULER_AUTH_TOKEN
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: scheduler-auth-token
          startupProbe:
            httpGet:
              path: /api/health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 6
            timeoutSeconds: 3
          livenessProbe:
            httpGet:
              path: /api/health
              port: 8080
            periodSeconds: 15
            timeoutSeconds: 3
```

---

## 15.4 Environment Variables & Google Secret Manager

### 1. Non-Secret Environment Variables

Non-sensitive configuration is injected via container runtime environment variables:

```bash
gcloud run services update jeevasetu-web \
  --region asia-south1 \
  --update-env-vars="\
NODE_ENV=production,\
PORT=8080,\
NEXT_PUBLIC_APP_URL=https://jeevasetu.org,\
NEXT_PUBLIC_FIREBASE_PROJECT_ID=jeevasetu-prod,\
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=jeevasetu-prod.firebaseapp.com,\
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=jeevasetu-prod.appspot.com,\
LOG_LEVEL=info"
```

### 2. Secret Management via Google Secret Manager

All sensitive API keys and cryptographic service account credentials are stored in Google Secret Manager and automatically mounted as environment variables at runtime.

#### Step A: Enable API & Create Secrets

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# 1. Resend API Key for emergency email alerts
gcloud secrets create resend-api-key --replication-policy="automatic"
echo -n "re_EXAMPLE_REPLACE_ME" | \
  gcloud secrets versions add resend-api-key --data-file=-

# 2. Cloud Scheduler shared bearer token
gcloud secrets create scheduler-auth-token --replication-policy="automatic"
openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets versions add scheduler-auth-token --data-file=-

# 3. Firebase Admin Service Account Key JSON
gcloud secrets create firebase-service-account-key --replication-policy="automatic"
gcloud secrets versions add firebase-service-account-key --data-file="./service-account.json"
```

#### Step B: Grant IAM Access to Cloud Run Service Account

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant Secret Accessor role to the Cloud Run runtime identity
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

#### Step C: Attach Secrets to Cloud Run

```bash
gcloud run services update jeevasetu-web \
  --region asia-south1 \
  --update-secrets="\
RESEND_API_KEY=resend-api-key:latest,\
FIREBASE_SERVICE_ACCOUNT_KEY=firebase-service-account-key:latest,\
SCHEDULER_AUTH_TOKEN=scheduler-auth-token:latest"
```

### 3. Server-Side Firebase Admin Initialization (`lib/firebase-admin.ts`)

```typescript
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let adminApp: App;

if (!getApps().length) {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountRaw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment secret');
  }

  const serviceAccount = JSON.parse(serviceAccountRaw);

  adminApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
} else {
  adminApp = getApps()[0]!;
}

export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
```

---

## 15.5 Cloud Scheduler Setup (Automated Cron Jobs)

JEEVASETU requires automated recurring jobs to:
1. Expire outdated emergency requests (e.g. unfulfilled blood units after 24 hours).
2. Trigger automated donor match sweeps and notifications.

### Strategy Comparison: OIDC Token vs. Shared Secret

| Strategy | Security Rating | Setup Complexity | Recommendation |
| :--- | :--- | :--- | :--- |
| **OIDC Identity Token** | Enterprise (Google Managed IAM) | Medium (Dedicated SA required) | **Recommended for Production** |
| **Shared Header Secret** | High (Bearer Token in Secret Manager) | Low (Single header check) | **Pragmatic Hackathon Fallback** |

### Implementation: Production OIDC Cloud Scheduler

```bash
# 1. Create dedicated Service Account for Cloud Scheduler
gcloud iam service-accounts create jeevasetu-scheduler-sa \
  --display-name="Jeevasetu Scheduler Runner"

SCHEDULER_SA="jeevasetu-scheduler-sa@$(gcloud config get-value project).iam.gserviceaccount.com"

# 2. Grant Invoker role on the Cloud Run service to this Service Account
gcloud run services add-iam-policy-binding jeevasetu-web \
  --region asia-south1 \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker"

# 3. Create Cron Job (Runs every 15 minutes)
SERVICE_URL=$(gcloud run services describe jeevasetu-web --region asia-south1 --format="value(status.url)")

gcloud scheduler jobs create http jeevasetu-emergency-sweep \
  --location asia-south1 \
  --schedule="*/15 * * * *" \
  --time-zone="Asia/Kolkata" \
  --uri="${SERVICE_URL}/api/cron/emergency-sweep" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${SERVICE_URL}" \
  --description="Expires lapsed emergency requests and dispatches batch alerts"
```

### Next.js Cron Route Handler (`app/api/cron/emergency-sweep/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req: NextRequest) {
  // 1. Verify Authorization (Supports either Google OIDC token or Shared Secret)
  const authHeader = req.headers.get('authorization') || '';
  const sharedSecret = process.env.SCHEDULER_AUTH_TOKEN;

  const isBearerValid = sharedSecret && authHeader === `Bearer ${sharedSecret}`;
  const isGoogleOidcPresent = authHeader.startsWith('Bearer eyJ'); // Standard Google JWT prefix

  if (!isBearerValid && !isGoogleOidcPresent) {
    return NextResponse.json({ error: 'Unauthorized invocation' }, { status: 401 });
  }

  try {
    const now = new Date();
    const emergencyRef = adminDb.collection('emergency_requests');
    
    // Find unfulfilled requests older than 24h
    const snapshot = await emergencyRef
      .where('status', '==', 'PENDING')
      .where('expiresAt', '<=', now)
      .get();

    const batch = adminDb.batch();
    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'EXPIRED',
        updatedAt: now,
      });
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      processed: snapshot.size,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[CRON_SWEEP_ERROR]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

---

## 15.6 Firestore & Firebase Auth Infrastructure Setup

### 1. Firestore Database Provisioning

- **Mode**: Native Mode.
- **Region**: `asia-south1` (Mumbai) to co-locate database compute with Cloud Run, reducing intra-cloud network latency to < 5ms.

```bash
# Provision Cloud Firestore in Native mode
gcloud firestore databases create \
  --location=asia-south1 \
  --type=firestore-native
```

### 2. Initial Security Rules (`firestore.rules`)

Deploy declarative security rules to enforce role-based access for Donors, Hospitals, and Requesters:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    function isAdmin() {
      return isAuthenticated() && request.auth.token.role == 'ADMIN';
    }

    // User Profiles
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow write: if isOwner(userId) || isAdmin();
    }

    // Emergency Requests (Public reads for immediate fulfillment)
    match /emergency_requests/{requestId} {
      allow read: if true;
      allow create: if isAuthenticated();
      allow update, delete: if isAuthenticated() && (
        resource.data.requesterId == request.auth.uid || isAdmin()
      );
    }

    // Donor Registry (Read access restricted to authenticated patients/hospitals)
    match /donors/{donorId} {
      allow read: if isAuthenticated();
      allow write: if isOwner(donorId) || isAdmin();
    }

    // Deny all other unmapped paths
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Deploy via Firebase CLI:
```bash
firebase deploy --only firestore:rules --project $(gcloud config get-value project)
```

### 3. Firebase Auth: Email/Password Provider Setup

1. Open **Firebase Console** -> **Build** -> **Authentication** -> **Sign-in method**.
2. Click **Email/Password** -> Enable **Email/Password** -> Save (Keep Email link/passwordless optional).
3. Under **Authorized Domains**, verify the following domains are registered:
   - `localhost`
   - `[PROJECT_ID].firebaseapp.com`
   - `[SERVICE_NAME]-[HASH]-[REGION].a.run.app` (Your Cloud Run default domain)
   - `jeevasetu.org` (Your custom domain)

---

## 15.7 Custom Domain & Default HTTPS

Cloud Run terminates TLS/HTTPS automatically without manual certbot or NGINX configurations.

### 1. Default HTTPS Endpoint
Every Cloud Run service immediately receives a Google-managed certificate and URL:
```
https://jeevasetu-web-[random-hash]-[region].a.run.app
```
- TLS 1.3 enabled by default.
- HTTP requests are automatically redirected to HTTPS.

### 2. Custom Domain Mapping (`gcloud beta run domain-mappings`)

```bash
# Add custom domain mapping
gcloud beta run domain-mappings create \
  --service jeevasetu-web \
  --domain jeevasetu.org \
  --region asia-south1
```

*DNS Configuration at your Registrar (Namecheap, GoDaddy, Cloudflare):*
- Add an `A` record pointing to the IP addresses returned by the command.
- Add `AAAA` records for IPv6.
- Google automatically provisions an SSL certificate via Let's Encrypt / Google Trust Services within 15–30 minutes of DNS propagation.

---

## 15.8 Health Check Endpoint & Cold Start Mitigation

### 1. Health Check Route (`app/api/health/route.ts`)

```typescript
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  let dbStatus = 'healthy';

  try {
    // Lightweight ping to Firestore verifying active connectivity
    await adminDb.collection('_health').doc('ping').get();
  } catch (error) {
    dbStatus = 'degraded';
  }

  const durationMs = Date.now() - startTime;

  return NextResponse.json(
    {
      status: 'UP',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: dbStatus,
      latencyMs: durationMs,
      environment: process.env.NODE_ENV,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
```

### 2. Cold Start Mitigation Strategies

Cold starts occur when Cloud Run provisions a new container instance from 0. For Next.js, cold starts typically take **2.5 to 4.5 seconds**. The following mitigations minimize this impact:

1. **Standalone Build Stripping**: Reduces filesystem extraction time from disk images by eliminating unused `node_modules` (>85% size reduction).
2. **Startup CPU Boost (`--cpu-boost`)**: Allocates double the vCPU quota during container boot sequence, cutting initial Node.js engine compilation and boot time by ~50%.
3. **Singleton SDK Caching**: Firebase Admin instances and Resend clients are instantiated once outside request lifecycles (module scope).
4. **Min-Instances vs. Cost Decision**:
   - **Hackathon Demo Mode (`--min-instances=1`)**: For live presentations and judge evaluations, spin up 1 instance 15 minutes before the demo to guarantee instant 0ms latency.
   - **Baseline Mode (`--min-instances=0`)**: Keep at zero instances during development to preserve free tier hours.

```bash
# Toggle to Demo Mode (Zero cold starts for judges)
gcloud run services update jeevasetu-web --min-instances=1 --region asia-south1

# Toggle back to Strict Free Tier Mode
gcloud run services update jeevasetu-web --min-instances=0 --region asia-south1
```

---

## 15.9 CI/CD Pipeline (Solo Developer Optimized)

### Fast-Track Iteration: Instant Cloud Build (`gcloud run deploy --source`)

During rapid hackathon hacking, bypass complex CI/CD setups and deploy in under 90 seconds directly from your local terminal:

```bash
gcloud run deploy jeevasetu-web \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --cpu-boost
```

### Production GitHub Actions Workflow (`.github/workflows/deploy.yml`)

For team collaboration or clean git pushes, use this lightweight 4-step pipeline:

```yaml
name: Deploy JEEVASETU to Cloud Run

on:
  push:
    branches:
      - main

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: asia-south1
  GAR_REPOSITORY: jeevasetu-docker
  SERVICE_NAME: jeevasetu-web

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js & Run Tests
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test --if-present

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build & Push Container Image
        run: |
          IMAGE_TAG="${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.GAR_REPOSITORY }}/${{ env.SERVICE_NAME }}:${{ github.sha }}"
          LATEST_TAG="${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.GAR_REPOSITORY }}/${{ env.SERVICE_NAME }}:latest"
          
          docker build \
            --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="${{ secrets.NEXT_PUBLIC_FIREBASE_PROJECT_ID }}" \
            --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="${{ secrets.NEXT_PUBLIC_FIREBASE_API_KEY }}" \
            --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${{ secrets.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN }}" \
            -t $IMAGE_TAG \
            -t $LATEST_TAG .
            
          docker push $IMAGE_TAG
          docker push $LATEST_TAG

      - name: Deploy Revision to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE_NAME }}
          region: ${{ env.REGION }}
          image: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.GAR_REPOSITORY }}/${{ env.SERVICE_NAME }}:${{ github.sha }}
          flags: |
            --cpu-boost
            --allow-unauthenticated
```

---

## 15.10 Logging, Observability & Error Alerting

### 1. Structured JSON Logging

Cloud Run automatically parses structured JSON logs written to `stdout`. Standard `console.log` and `console.error` produce categorized entries in Cloud Logging:

```typescript
// lib/logger.ts
export const logger = {
  info: (message: string, context?: Record<string, any>) => {
    console.log(JSON.stringify({
      severity: 'INFO',
      message,
      component: 'jeevasetu-backend',
      ...context,
    }));
  },
  error: (message: string, error?: any, context?: Record<string, any>) => {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message,
      error: error?.stack || error?.message || error,
      component: 'jeevasetu-backend',
      ...context,
    }));
  },
};
```

### 2. Inspecting Logs in Terminal

```bash
# Stream live production errors
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=jeevasetu-web AND severity>=ERROR"

# Read last 50 entries
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=jeevasetu-web" \
  --limit 50 \
  --format="table(timestamp,severity,textPayload,jsonPayload.message)"
```

### 3. Rapid Email Alerting for 5xx Server Errors

Set up an automated alert channel that notifies your inbox if emergency requests fail:

```bash
# 1. Create Email Notification Channel
gcloud beta monitoring channels create \
  --display-name="Solo DevOps Alert Email" \
  --type=email \
  --channel-labels=email_address="developer@jeevasetu.org"

CHANNEL_ID=$(gcloud beta monitoring channels list --filter="displayName='Solo DevOps Alert Email'" --format="value(name)")

# 2. Create Alert Policy for High HTTP 5xx Error Counts
gcloud alpha monitoring policies create --policy-from-dictionary='{
  "displayName": "Jeevasetu Cloud Run 5xx Errors",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Cloud Run 5xx rate > 5 per min",
    "conditionThreshold": {
      "filter": "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 5,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  }],
  "notificationChannels": ["'${CHANNEL_ID}'"]
}'
```

---

## 15.11 Rollback Strategy & Traffic Management

Cloud Run maintains an immutable history of every deployed revision. In the event of a breaking bug or corrupted dependency:

### 1. Instant 1-Command Instant Rollback

```bash
# List previous revisions
gcloud run revisions list --service jeevasetu-web --region asia-south1

# Rollback 100% of traffic to a verified stable revision in < 2 seconds
gcloud run services update-traffic jeevasetu-web \
  --region asia-south1 \
  --to-revisions=jeevasetu-web-00012-abc=100
```

### 2. Canary Deployment / Blue-Green Split Testing

Before routing all emergency traffic to a newly deployed feature:

```bash
# Direct 10% traffic to candidate revision, 90% to current stable
gcloud run services update-traffic jeevasetu-web \
  --region asia-south1 \
  --to-revisions=jeevasetu-web-00013-new=10,jeevasetu-web-00012-abc=90
```

---

## 15.12 Hackathon Budget & Free Tier Audit (\$0 Strategy)

By aligning configuration with Google Cloud Always Free tier allowances, the entire JEEVASETU application runs at **\$0.00 cost** throughout development and demo judging:

| Google Cloud Service | Always Free Monthly Quota | JEEVASETU Expected Usage | Net Cost |
| :--- | :--- | :--- | :--- |
| **Cloud Run** | 2,000,000 requests<br>360,000 GB-seconds memory<br>180,000 vCPU-seconds | ~35,000 requests<br>~25,000 GB-sec | **\$0.00** |
| **Cloud Firestore** | 1 GiB storage<br>50,000 reads/day<br>20,000 writes/day | ~150 MiB<br>~4,000 reads/day<br>~1,200 writes/day | **\$0.00** |
| **Firebase Auth** | 50,000 Monthly Active Users | < 200 hackathon test accounts | **\$0.00** |
| **Secret Manager** | 6 active secret versions<br>10,000 API operations/mo | 3 secret versions<br>~150 access calls | **\$0.00** |
| **Cloud Scheduler** | 3 jobs per billing account | 1 active job | **\$0.00** |
| **Artifact Registry**| 0.5 GB storage per month | ~350 MB active images | **\$0.00** |
| **Cloud Logging** | 50 GB log ingestion/month | < 150 MB total logs | **\$0.00** |

### Budget Safety Cap
Run this command to create a hard billing alert at \$1.00:
```bash
gcloud billing budgets create \
  --billing-account=$(gcloud beta billing accounts list --format="value(name)" | head -n1) \
  --display-name="Jeevasetu Hackathon Safety Cap" \
  --budget-amount=1.00USD \
  --threshold-rule=percent=0.8 \
  --threshold-rule=percent=1.0
```

---

## 15.13 Solo Developer Runbook: Bootstrap in 10 Minutes

Execute this end-to-end script from the root of the repository to provision and deploy the entire JEEVASETU Cloud Run infrastructure from scratch:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="jeevasetu-prod"
REGION="asia-south1"
SERVICE_NAME="jeevasetu-web"

echo "=== [1/5] Configuring Project & APIs ==="
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com

echo "=== [2/5] Creating Artifact Registry ==="
gcloud artifacts repositories create jeevasetu-docker \
  --repository-format=docker \
  --location="$REGION" \
  --description="Jeevasetu Container Registry" || true

echo "=== [3/5] Setting Up Secrets ==="
gcloud secrets create resend-api-key --replication-policy="automatic" || true
gcloud secrets create firebase-service-account-key --replication-policy="automatic" || true
gcloud secrets create scheduler-auth-token --replication-policy="automatic" || true

# Grant access to Cloud Run compute identity
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

echo "=== [4/5] Deploying Cloud Run Service ==="
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 1024Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --concurrency 80 \
  --cpu-boost \
  --set-env-vars="NODE_ENV=production,PORT=8080" \
  --set-secrets="RESEND_API_KEY=resend-api-key:latest,FIREBASE_SERVICE_ACCOUNT_KEY=firebase-service-account-key:latest,SCHEDULER_AUTH_TOKEN=scheduler-auth-token:latest"

echo "=== [5/5] Deployment Finished Successfully ==="
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format="value(status.url)"
```


---\n
## 16. Environment Variables and Secrets Inventory

The **JEEVASETU** platform operates a mission-critical healthcare and emergency coordination workflow. Because it orchestrates real-time patient-donor matching, automated emergency reminders, critical dispatch notifications, and secure clinical records, strict segregation between public configuration values and server-side cryptographic secrets is foundational to system integrity, HIPAA/DISHA regulatory compliance, and patient data safety.

This section defines the exhaustive inventory of all environment variables, their architectural execution scopes, development and production secrets lifecycle, runtime injection strategies, and zero-trust verification checklists.

---

### 16.1 Comprehensive Environment Variables Inventory

The following table catalogues every environment variable utilized across the JEEVASETU Next.js application, background workers, and Cloud Run execution runtimes.

| Variable Name | Description & Purpose | Scope / Target | Secret? | Example / Default Value |
| :--- | :--- | :--- | :--- | :--- |
| **`NEXT_PUBLIC_FIREBASE_API_KEY`** | Client-side identifier for Google Firebase backend services. Identifies the web project to Firebase APIs. | Client & Server | **NO** (Public) | `AIzaSyEXAMPLE_REPLACE_ME` |
| **`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`** | Firebase Authentication domain used for OAuth redirects and token validation. | Client & Server | **NO** (Public) | `jeevasetu-prod.firebaseapp.com` |
| **`NEXT_PUBLIC_FIREBASE_PROJECT_ID`** | GCP/Firebase Project identifier used across client SDKs to bind Firestore and Auth. | Client & Server | **NO** (Public) | `jeevasetu-prod` |
| **`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`** | Google Cloud Storage default bucket for user-uploaded triage assets and documents. | Client & Server | **NO** (Public) | `jeevasetu-prod.appspot.com` |
| **`NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`** | Unique numerical identifier assigned by GCP for Firebase Cloud Messaging (FCM) push notifications. | Client & Server | **NO** (Public) | `849201948201` |
| **`NEXT_PUBLIC_FIREBASE_APP_ID`** | Unique client application identifier generated by Firebase for the web application bundle. | Client & Server | **NO** (Public) | `1:849201948201:web:9f4082ac840dfa12` |
| **`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`** | Optional Google Analytics for Firebase tracking ID for client telemetries. | Client & Server | **NO** (Public) | `G-K893JLM09P` |
| **`FIREBASE_PROJECT_ID`** | GCP Project ID dedicated to the privileged server-side Firebase Admin SDK instance. | Server Only | **NO** (Config) | `jeevasetu-prod` |
| **`FIREBASE_CLIENT_EMAIL`** | Dedicated IAM Service Account email possessing Admin SDK privileges. | Server Only | **NO** (Identity) | `firebase-adminsdk@jeevasetu-prod.iam.gserviceaccount.com` |
| **`FIREBASE_PRIVATE_KEY`** | RSA private key (PEM format) authorizing the Firebase Admin SDK to bypass client security rules. | Server Only | **YES** (Secret) | `"<REDACTED_PRIVATE_KEY>\n"` |
| **`FIREBASE_DATABASE_URL`** | Realtime Database instance URL (when synchronizing real-time emergency dispatch telemetry). | Server Only | **NO** (Config) | `https://jeevasetu-prod-default-rtdb.firebaseio.com` |
| **`FIREBASE_STORAGE_BUCKET`** | Server-side reference for secure signed URL generation and bucket administration. | Server Only | **NO** (Config) | `jeevasetu-prod.appspot.com` |
| **`RESEND_API_KEY`** | Secret bearer API key for authenticating with the Resend transactional email delivery engine. | Server Only | **YES** (Secret) | `re_EXAMPLE_REPLACE_ME` |
| **`RESEND_FROM_EMAIL`** | Standardized `From:` header address with verified domain reputation for system transactional dispatches. | Server Only | **NO** (Config) | `JEEVASETU Healthcare <notifications@jeevasetu.org>` |
| **`RESEND_REPLY_TO_EMAIL`** | Verified support address for handling email bounces and patient inquiries. | Server Only | **NO** (Config) | `support@jeevasetu.org` |
| **`CRON_SECRET`** | High-entropy shared secret used by Cloud Scheduler to authenticate calls to internal `/api/cron/*` endpoints. | Server Only | **YES** (Secret) | `sec_cron_7f849b28a1c904e5bf67d81203e4981a` |
| **`SCHEDULER_INVOKER_EMAIL`** | GCP Service Account email authorized to invoke Cloud Run endpoints via OIDC tokens. | Server Only | **NO** (Identity) | `jeevasetu-cron-invoker@jeevasetu-prod.iam.gserviceaccount.com` |
| **`NEXT_PUBLIC_APP_URL`** | Canonical public origin URL used for client navigation, asset resolution, and social metadata. | Client & Server | **NO** (Config) | `https://jeevasetu.org` |
| **`APP_BASE_URL`** | Internal or external base URL used by server-side notification templates and callback generators. | Server Only | **NO** (Config) | `https://jeevasetu.org` |
| **`REMINDER_LEAD_TIME_HOURS`** | Default advance notification window in hours prior to scheduled medical/donor appointments. | Server Only | **NO** (Config) | `24` |
| **`REMINDER_DEFAULT_OFFSET_MINUTES`** | Granular secondary reminder offset in minutes (e.g. final SMS/email alert before appointment). | Server Only | **NO** (Config) | `60` |
| **`REMINDER_MAX_ATTEMPTS`** | Maximum retry attempts for failed reminder dispatches before flagging for manual operator triage. | Server Only | **NO** (Config) | `3` |
| **`PASSCODE_LENGTH`** | Length of numerical one-time passcodes (OTP) generated for emergency verification and sign-in. | Server Only | **NO** (Config) | `6` |
| **`PASSCODE_EXPIRY_MINUTES`** | Cryptographic lifespan of generated verification passcodes before automatic invalidation. | Server Only | **NO** (Config) | `10` |
| **`PASSCODE_MAX_ATTEMPTS`** | Threshold for consecutive failed passcode entries before temporary account lockout. | Server Only | **NO** (Config) | `5` |
| **`RATE_LIMIT_MAX_REQUESTS`** | Rate limiting threshold: maximum allowed incoming requests per client IP within the configured window. | Server Only | **NO** (Config) | `100` |
| **`RATE_LIMIT_WINDOW_SECONDS`** | Rate limiting window duration in seconds for API request throttling. | Server Only | **NO** (Config) | `60` |
| **`EMERGENCY_DISPATCH_TIMEOUT_SECONDS`** | Maximum wait duration before escalating unacknowledged emergency requests to backup responders. | Server Only | **NO** (Config) | `180` |
| **`NODE_ENV`** | Node.js runtime environment flag controlling bundling optimizations, error stacks, and caching. | Client & Server | **NO** (System) | `production` (or `development`, `test`) |
| **`PORT`** | TCP port on which the Next.js standalone Node.js HTTP server listens inside containers. | Server Only | **NO** (System) | `8080` (GCP default) or `3000` |
| **`NEXT_TELEMETRY_DISABLED`** | Opt-out flag preventing Next.js from transmitting anonymous framework telemetry to Vercel. | Build & Server | **NO** (System) | `1` |
| **`TZ`** | System timezone specification ensuring deterministic timestamp operations across logs and scheduling. | Server Only | **NO** (System) | `Asia/Kolkata` |

---

### 16.2 Categorical Architecture & Security Posture

#### 16.2.1 Firebase Client Configuration (`NEXT_PUBLIC_*`)
All environment variables prefixed with `NEXT_PUBLIC_` are statically inlined into the client-side JavaScript bundle during `next build`.
- **Classification**: **NOT Secret**. In Firebase’s serverless security model, client API keys do not grant administrative access; they merely identify the GCP project to Google's backends.
- **Threat Model & Abuse Vectors**: While not confidential, exposed keys can be abused by malicious third parties to consume project quotas, trigger denial-of-wallet through unauthorized Firebase Auth user creation, or read/write open Firestore collections.
- **Required Defense-in-Depth**:
  1. **Firebase Security Rules**: Write rigid declarative rules for Cloud Firestore and Cloud Storage based on `request.auth.uid`. Never rely on client obfuscation.
  2. **GCP API Key Restrictions**: In the Google Cloud Console, restrict `NEXT_PUBLIC_FIREBASE_API_KEY` to:
     - **Application Restrictions**: HTTP Referrers limited strictly to `jeevasetu.org/*`, `*.jeevasetu.org/*`, and `localhost:3000/*` (development key only).
     - **API Restrictions**: Limit the key exclusively to *Identity Toolkit API*, *Token Service API*, *Cloud Firestore API*, *Firebase Cloud Messaging*, and *Firebase Storage*.
  3. **Firebase App Check**: Enforce App Check via reCAPTCHA Enterprise (web) to verify that incoming requests originate genuine JEEVASETU web clients rather than automated scraper scripts.

#### 16.2.2 Firebase Admin SDK (Privileged Infrastructure)
- **Classification**: **STRICTLY CONFIDENTIAL / CRITICAL SECRET**.
- **Role**: The Admin SDK initializes server-side administrative access within Next.js API Routes, Server Actions, and Cloud Run background services. It operates with full service-agent authority, completely bypassing Firestore and Storage security rules.
- **Handling Rules**:
  - The `FIREBASE_PRIVATE_KEY` must never be checked into version control, embedded in Docker images, or exposed via any client-reachable RPC.
  - In `.env.local`, the PEM key requires escaped newlines (`\n`). In production (Google Secret Manager), the multiline PEM is preserved natively or injected as a parsed string.

#### 16.2.3 Resend Transactional Email Engine
- **Classification**: `RESEND_API_KEY` is **STRICTLY CONFIDENTIAL / HIGH SEVERITY SECRET**.
- **Role**: Used exclusively in server environments (API routes, email triggers, notification services) to send transactional emails (emergency match alerts, OTP passcodes, donor reminders).
- **Abuse Impact**: Exposure permits adversaries to send arbitrary phishing or spoofing emails from `@jeevasetu.org`, permanently destroying domain reputation, blacklisting DNS MX/SPF records, and leaking sensitive notification logs.
- **Configuration Controls**: Domain verification (`DKIM`, `SPF`, `DMARC`) must be locked down in Resend. The API key should be scoped with minimal permissions (`Sending only` if available).

#### 16.2.4 Cloud Scheduler & Cron Authorization
- **Classification**: `CRON_SECRET` is **STRICTLY CONFIDENTIAL / HIGH SEVERITY SECRET**.
- **Role**: Protects automated background maintenance endpoints (e.g., `/api/cron/reminders`, `/api/cron/cleanup-expired-passcodes`).
- **Enforcement Pattern**:
  - Incoming HTTP requests from Google Cloud Scheduler must include an `Authorization: Bearer <CRON_SECRET>` header or a verified Google OIDC identity token.
  - Verification must utilize constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks against the secret string.

#### 16.2.5 Application Logic & Business Configuration
- **Classification**: **Non-Secret Configuration**.
- **Role**: Tunes platform behavior, security thresholds, and business rules without requiring code recompilation.
- **Key Parameters**:
  - `PASSCODE_LENGTH` (6) and `PASSCODE_EXPIRY_MINUTES` (10) define the ephemeral lifespan of verification codes.
  - `REMINDER_LEAD_TIME_HOURS` (24) controls the cron batch lookahead query for patient appointment reminders.
  - `RATE_LIMIT_*` mitigates automated credential stuffing and endpoint flooding at the edge.

#### 16.2.6 Next.js Runtime & Node System Configuration
- **Classification**: **Runtime Environment Variables**.
- **Role**: Dictates framework performance optimizations. `NODE_ENV=production` triggers minified bundles, stripped error messages, and server component caching. `TZ=Asia/Kolkata` aligns system datetime operations with Indian Standard Time (IST) for regional healthcare operations.

---

### 16.3 Local Environment Configuration Template (`.env.local`)

Developers must place this file at the repository root as `.env.local`. This file is gitignored and contains configuration for local development against either the Firebase Local Emulator Suite or dedicated cloud staging resources.

```bash
# ==============================================================================
# JEEVASETU PLATFORM - LOCAL DEVELOPMENT CONFIGURATION (.env.local)
# DO NOT COMMIT THIS FILE TO REPOSITORY VERSION CONTROL.
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. NEXT.JS RUNTIME & INFRASTRUCTURE
# ------------------------------------------------------------------------------
NODE_ENV=development
PORT=3000
NEXT_TELEMETRY_DISABLED=1
TZ=Asia/Kolkata

# ------------------------------------------------------------------------------
# 2. APPLICATION CORE SETTINGS
# ------------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_BASE_URL=http://localhost:3000

# ------------------------------------------------------------------------------
# 3. FIREBASE CLIENT CONFIGURATION (NEXT_PUBLIC_*)
# Safe for client bundling. Ensure GCP API key is referrer-restricted.
# ------------------------------------------------------------------------------
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyEXAMPLE_REPLACE_ME
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=jeevasetu-dev.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=jeevasetu-dev
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=jeevasetu-dev.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=109283746501
NEXT_PUBLIC_FIREBASE_APP_ID=1:109283746501:web:dev74839201948271
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-DEVMEASURE01

# Optional: Point to local Firebase Emulator suite when running 'firebase emulators:start'
# FIRESTORE_EMULATOR_HOST=localhost:8080
# FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
# FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199

# ------------------------------------------------------------------------------
# 4. FIREBASE ADMIN SDK (SERVER ONLY - NEVER EXPOSE TO CLIENT)
# ------------------------------------------------------------------------------
FIREBASE_PROJECT_ID=jeevasetu-dev
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-dev@jeevasetu-dev.iam.gserviceaccount.com
# For local .env.local, ensure newlines in the private key are represented as \n
FIREBASE_PRIVATE_KEY="<REDACTED_PRIVATE_KEY>\n"
FIREBASE_DATABASE_URL=https://jeevasetu-dev-default-rtdb.firebaseio.com
FIREBASE_STORAGE_BUCKET=jeevasetu-dev.appspot.com

# ------------------------------------------------------------------------------
# 5. RESEND TRANSACTIONAL EMAIL ENGINE (SERVER ONLY)
# ------------------------------------------------------------------------------
# Obtain from https://resend.com/api-keys
RESEND_API_KEY=re_EXAMPLE_REPLACE_ME
RESEND_FROM_EMAIL=JEEVASETU Dev Alerts <onboarding@resend.dev>
RESEND_REPLY_TO_EMAIL=dev-support@jeevasetu.org

# ------------------------------------------------------------------------------
# 6. CLOUD SCHEDULER & CRON SECURITY (SERVER ONLY)
# ------------------------------------------------------------------------------
CRON_SECRET=local_dev_cron_secret_high_entropy_override_minimum_32_chars
SCHEDULER_INVOKER_EMAIL=jeevasetu-cron-invoker@jeevasetu-dev.iam.gserviceaccount.com

# ------------------------------------------------------------------------------
# 7. BUSINESS LOGIC & THRESHOLD DEFAULTS
# ------------------------------------------------------------------------------
REMINDER_LEAD_TIME_HOURS=24
REMINDER_DEFAULT_OFFSET_MINUTES=60
REMINDER_MAX_ATTEMPTS=3
PASSCODE_LENGTH=6
PASSCODE_EXPIRY_MINUTES=10
PASSCODE_MAX_ATTEMPTS=5
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60
EMERGENCY_DISPATCH_TIMEOUT_SECONDS=180
```

---

### 16.4 Committed Repository Template (`.env.example`)

The `.env.example` file is tracked in git. It establishes the contractual baseline for all required variables without containing any real values or working secrets.

```bash
# ==============================================================================
# JEEVASETU PLATFORM - ENVIRONMENT VARIABLES TEMPLATE (.env.example)
# This file is committed to git. Copy to .env.local and populate with valid values.
# ==============================================================================

# Next.js Runtime
NODE_ENV=
PORT=
NEXT_TELEMETRY_DISABLED=
TZ=

# Application URL
NEXT_PUBLIC_APP_URL=
APP_BASE_URL=

# Firebase Client Configuration (NEXT_PUBLIC_*)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# Firebase Admin SDK (Server-Side Only)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_DATABASE_URL=
FIREBASE_STORAGE_BUCKET=

# Resend Email Service (Server-Side Only)
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_REPLY_TO_EMAIL=

# Cloud Scheduler & Cron Authorization (Server-Side Only)
CRON_SECRET=
SCHEDULER_INVOKER_EMAIL=

# Business Logic Configuration
REMINDER_LEAD_TIME_HOURS=
REMINDER_DEFAULT_OFFSET_MINUTES=
REMINDER_MAX_ATTEMPTS=
PASSCODE_LENGTH=
PASSCODE_EXPIRY_MINUTES=
PASSCODE_MAX_ATTEMPTS=
RATE_LIMIT_MAX_REQUESTS=
RATE_LIMIT_WINDOW_SECONDS=
EMERGENCY_DISPATCH_TIMEOUT_SECONDS=
```

---

### 16.5 Secrets Management Lifecycle: Development vs. Production

```
+----------------------------------------------------------------------------------------------------+
|                                    SECRETS LIFECYCLE TOPOLOGY                                      |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ LOCAL DEVELOPMENT ]                                                                             |
|  Engineer Machine / CI Runner                                                                      |
|  +---------------------------+       .gitignore                                                    |
|  |       .env.local          | -----------------------> [ Blocked from Version Control ]           |
|  +---------------------------+                                                                     |
|                |                                                                                   |
|                v (Local Process)                                                                   |
|  [ Next.js Dev Server (localhost:3000) ]                                                           |
|                                                                                                    |
| ================================================================================================== |
|                                                                                                    |
|  [ PRODUCTION DEPLOYMENT (GCP) ]                                                                   |
|                                                                                                    |
|  +-----------------------------------+       IAM Role: roles/secretmanager.secretAccessor          |
|  |      Google Secret Manager        | ------------------------------------+                       |
|  |   - FIREBASE_PRIVATE_KEY          |                                     |                       |
|  |   - RESEND_API_KEY                |                                     |                       |
|  |   - CRON_SECRET                   |                                     v                       |
|  +-----------------------------------+                       +----------------------------------+  |
|                                                              |        Cloud Run Service         |  |
|  +-----------------------------------+                       |      (jeevasetu-web-prod)        |  |
|  |   Cloud Build / GitHub Actions    |                       |                                  |  |
|  |   (Injects NEXT_PUBLIC_* at       | --------------------> | Dedicated Service Account:       |  |
|  |    Docker Build Phase)            |                       | jeevasetu-runner@*.iam...        |  |
|  +-----------------------------------+                       |                                  |  |
|                                                              | Secrets mounted as env vars      |  |
|                                                              | in memory at container runtime   |  |
|                                                              +----------------------------------+  |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

#### 16.5.1 Development Environment Safeguards
1. **File Hierarchy & Precedence**:
   Next.js evaluates environment configuration in the following order (first match wins):
   $$\text{.env.development.local} \succ \text{.env.local} \succ \text{.env.development} \succ \text{.env}$$
   Development secrets must reside strictly within `.env.local`.
2. **Repository Exclusion**:
   The project `.gitignore` file enforces absolute exclusion of local secret targets:
   ```gitignore
   # Core environment files
   .env*.local
   .env
   .env.production
   .env.staging

   # Credentials and certificates
   *.pem
   *.key
   service-account*.json
   credentials.json
   ```
3. **Local Emulators Preferred**:
   Engineers should utilize the Firebase Local Emulator Suite whenever possible rather than using live cloud service account credentials, eliminating the risk of accidental production mutation.

#### 16.5.2 Production Environment Architecture (Google Secret Manager & Cloud Run)
In production, JEEVASETU is deployed as a containerized Next.js standalone application running on **Google Cloud Run**. Under no circumstances are `.env` or `.env.local` files baked into container images or checked into source code.

1. **Storage in Google Secret Manager (GSM)**:
   All high-severity secrets (`FIREBASE_PRIVATE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`) are provisioned within Google Secret Manager:
   - Secret path: `projects/jeevasetu-prod/secrets/<SECRET_NAME>/versions/<VERSION>`
   - Secret versions are pinned or referenced via automatic alias `latest` (with controlled rotation).

2. **Least Privilege Identity & Access Management (IAM)**:
   The Cloud Run service executes under a dedicated runtime Service Account:
   `jeevasetu-runner@jeevasetu-prod.iam.gserviceaccount.com`.
   - The runner is granted the specific role: `roles/secretmanager.secretAccessor`.
   - Permissions are restricted per secret resource (resource-level IAM bindings), ensuring the runner cannot access unrelated GCP project secrets.

3. **Runtime Secret Injection (Cloud Run `--set-secrets`)**:
   Secrets are bound to the container runtime via Cloud Run environment variable secret references:
   ```bash
   gcloud run deploy jeevasetu-web-prod \
     --image gcr.io/jeevasetu-prod/web:v1.4.2 \
     --region asia-south1 \
     --service-account jeevasetu-runner@jeevasetu-prod.iam.gserviceaccount.com \
     --set-env-vars NODE_ENV=production,TZ=Asia/Kolkata,NEXT_TELEMETRY_DISABLED=1 \
     --set-secrets="FIREBASE_PRIVATE_KEY=projects/jeevasetu-prod/secrets/FIREBASE_PRIVATE_KEY:latest" \
     --set-secrets="RESEND_API_KEY=projects/jeevasetu-prod/secrets/RESEND_API_KEY:latest" \
     --set-secrets="CRON_SECRET=projects/jeevasetu-prod/secrets/CRON_SECRET:latest"
   ```
   *Alternative*: For large keys, secrets can be mounted as read-only files in an in-memory volume at `/secrets/firebase-key.pem` to avoid escaping issues in shell environment variables.

4. **Build-Time vs. Runtime Decoupling**:
   - `NEXT_PUBLIC_*` variables must be available **at container build time** (`docker build`) because Next.js inlines them during static compilation.
   - Server-side secrets (`FIREBASE_PRIVATE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`) must **NEVER** be provided as Docker `ARG` or build-time environment variables. They are injected exclusively at runtime by Cloud Run.

5. **Cryptographic Key Rotation Protocol**:
   - `RESEND_API_KEY` and `CRON_SECRET`: Rotated quarterly (every 90 days) via zero-downtime dual-version overlap.
   - `FIREBASE_PRIVATE_KEY`: Service account keys are rotated bi-annually, with audit logging enabled via Cloud Audit Logs (`cloudaudit.googleapis.com`) to track access spikes.

---

### 16.6 What MUST NOT Be in Client-Side Code

In Next.js App Router applications, the boundary between Server Components (`app/**/page.tsx` default) and Client Components (`'use client'`) is enforced at the Webpack/Turbopack bundler level.

> [!CAUTION]
> **Zero-Tolerance Client Leaks**:
> Any variable lacking the `NEXT_PUBLIC_` prefix is stripped from the client bundle by Next.js. However, if a developer explicitly imports server modules, references server variables inside client-side callbacks, or serializes secret values into props passed to Client Components, those values **will be leaked** in plain text to the browser.

#### 16.6.1 Strictly Forbidden Artifacts in Client Code
The following items must never appear in client-side bundles, React components, public utilities, or client network payloads:

1. **`FIREBASE_PRIVATE_KEY` / Service Account JSON**:
   - **Blast Radius**: Complete platform compromise. An attacker possessing this key assumes the `Firebase Admin` role, granting unrestricted read, write, and deletion privileges across all Cloud Firestore collections (bypassing all security rules), direct access to Firebase Auth user databases, and full storage bucket manipulation. This constitutes a catastrophic HIPAA/DISHA breach.
2. **`RESEND_API_KEY`**:
   - **Blast Radius**: Hijacking of verified domain email sending capability. Attackers can dispatch phishing lures from `notifications@jeevasetu.org`, harvest user credentials, exfiltrate recipient contact histories, and trigger severe operational reputation damage.
3. **`CRON_SECRET`**:
   - **Blast Radius**: Unauthorized invocation of recurring automation endpoints. Malicious actors could trigger infinite reminder dispatch loops, exhaust external SMS/email provider quotas, create denial-of-service conditions, or force premature deletion of unverified medical records.
4. **Internal Microservice Tokens & Database Admin Credentials**:
   - **Blast Radius**: Lateral privilege escalation across private GCP network segments and VPC subnets.

#### 16.6.2 Dangerous Anti-Patterns to Prevent
```typescript
// ❌ CRITICAL SECURITY VULNERABILITY: Leaking server secret through a client prop or API response
// app/api/auth-helper/route.ts
export async function GET() {
  return Response.json({
    // NEVER DO THIS: Leaks administrative secret to the network tab
    key: process.env.FIREBASE_PRIVATE_KEY 
  });
}

// ❌ CRITICAL SECURITY VULNERABILITY: Importing Firebase Admin into a Client Component
// components/DonorCard.tsx
'use client';
import { adminDb } from '@/lib/firebase-admin'; // BUNDLER ERROR OR FATAL RUNTIME SECRET LEAK

export function DonorCard() {
  // Client code executing with server admin privileges
}
```

```typescript
// ✅ SECURE ARCHITECTURAL PATTERN: Strict Server Isolation
// app/actions/reminders.ts
'use server';

import { verifyCronToken } from '@/lib/auth/security';
import { sendReminderEmail } from '@/lib/email/resend';

export async function triggerScheduledReminder(authHeader: string, appointmentId: string) {
  // Server-only execution. Secrets remain inside the server runtime environment.
  verifyCronToken(authHeader);
  await sendReminderEmail(appointmentId);
}
```

---

### 16.7 Verification Checklist & Automated Guardrails

To guarantee zero secret leakage into client bundles or version control, the JEEVASETU engineering workflow enforces the following five-stage verification pipeline.

```
[ Pre-Commit: Gitleaks ] 
       │
       ▼
[ Build Phase: Zod Type Validation ] 
       │
       ▼
[ Bundle Analysis: Static Chunk Regex Scan ] 
       │
       ▼
[ CI/CD Pipeline: GitHub Actions Audit Gate ] 
       │
       ▼
[ GCP Runtime: Cloud Key Restrictions & Audit Logs ]
```

#### 16.7.1 Stage 1: Pre-Commit & Local Repository Scans
1. **Husky & Gitleaks Integration**:
   Every developer workstation executes a pre-commit hook that audits staged diffs against known secret patterns before allowing a commit:
   ```bash
   # .husky/pre-commit
   #!/usr/bin/env sh
   . "$(dirname -- "$0")/_/husky.sh"

   echo "==> Running Gitleaks credential scanner..."
   gitleaks protect --staged --verbose --config .gitleaks.toml
   ```
2. **Gitleaks Configuration (`.gitleaks.toml`)**:
   Custom rules specifically targeted at JEEVASETU secrets:
   ```toml
   [extend]
   useDefault = true

   [[rules]]
   description = "Resend API Key Detection"
   id = "resend-api-key"
   regex = '''re_[a-zA-Z0-9]{8}_[a-zA-Z0-9]{24}'''
   secretGroup = 0
   entropy = 3.5

   [[rules]]
   description = "Firebase / GCP Private Key Detection"
   id = "firebase-private-key"
   regex = '''-----BEGIN (RSA )?PRIVATE KEY-----'''
   secretGroup = 0

   [[rules]]
   description = "Cron Secret Detection"
   id = "jeevasetu-cron-secret"
   regex = '''sec_cron_[a-zA-Z0-9]{32,}'''
   secretGroup = 0
   ```

#### 16.7.2 Stage 2: Build-Time Schema Validation (Fail-Fast with Zod)
Environment variables are strictly validated using a typed schema module (`src/env.ts`) executed at the start of `next build`. If an essential secret is missing or a server-only variable is prefixed incorrectly, the build immediately terminates with a non-zero exit code:

```typescript
// src/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.string().email(),
    FIREBASE_PRIVATE_KEY: z.string().min(100),
    RESEND_API_KEY: z.string().startsWith("re_"),
    RESEND_FROM_EMAIL: z.string().min(3),
    CRON_SECRET: z.string().min(32),
    PASSCODE_LENGTH: z.coerce.number().default(6),
    PASSCODE_EXPIRY_MINUTES: z.coerce.number().default(10),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(10),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(5),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(3),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(5),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(5),
    NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(10),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  },
});
```

#### 16.7.3 Stage 3: Client Bundle Post-Build Inspection Script
Following `next build`, an automated bash/Node.js script scans every static chunk in `.next/static/**/*.js` to verify that no server secrets were inadvertently bundled into client assets:

```bash
#!/usr/bin/env bash
# scripts/verify-bundle-secrets.sh
set -eo pipefail

echo "==> Auditing .next/static client JavaScript bundles for leaked secrets..."

# 1. Search for Private Key headers
if grep -rn "BEGIN PRIVATE KEY" .next/static/; then
  echo "❌ CRITICAL SECURITY ERROR: Firebase Private Key detected in client bundle!"
  exit 1
fi

# 2. Search for Resend API key pattern
if grep -E -rn "re_[a-zA-Z0-9]{8}_" .next/static/; then
  echo "❌ CRITICAL SECURITY ERROR: Resend API Key detected in client bundle!"
  exit 1
fi

# 3. Search for Service Account email addresses
if grep -E -rn "iam\.gserviceaccount\.com" .next/static/; then
  echo "❌ CRITICAL SECURITY ERROR: Google Service Account identity found in client bundle!"
  exit 1
fi

# 4. Search for Cron Secret prefix
if grep -E -rn "sec_cron_" .next/static/; then
  echo "❌ CRITICAL SECURITY ERROR: Cron Secret detected in client bundle!"
  exit 1
fi

echo "✅ PASS: No forbidden secret patterns detected in client bundles."
```

#### 16.7.4 Stage 4: Continuous Integration & Deployment (CI/CD) Gates
In GitHub Actions / Cloud Build, automated quality checks run against all Pull Requests targeting `main`:
1. **Secret Scanning Step**: Runs `gitleaks detect --source . --verbose`.
2. **Build Verification**: Runs `npm run build` with test environment variables injected.
3. **Static Bundle Audit**: Executes `scripts/verify-bundle-secrets.sh`.
4. **Diff Inspection**: Blocks any PR that modifies `.env.example` without matching updates to `src/env.ts` and documentation in Section 16.

#### 16.7.5 Stage 5: Runtime Browser & Network Auditing
Before promoting any release to production:
1. Open the JEEVASETU web application in an incognito browser window with Developer Tools active.
2. Filter the **Sources** tab for `_next/static/chunks/`. Run a global search for `FIREBASE_PRIVATE_KEY`, `RESEND_API_KEY`, and `CRON_SECRET`. The search result count must be strictly `0`.
3. Inspect `window.__NEXT_DATA__` and React Server Component streaming payloads (`_rsc`) in the **Network** tab to confirm that no administrative credentials or unmasked tokens are serialized in server-rendered props.
4. Verify in the GCP Console that `NEXT_PUBLIC_FIREBASE_API_KEY` is strictly bound to approved HTTP referrers (`https://jeevasetu.org/*`) and authorized API services.


---\n
## 17. Prioritized Implementation Roadmap with Dependencies

### 17.1 Strategic Execution Framework & Hackathon Reality

As a solo developer in a time-boxed hackathon window, the failure mode is **scope creep and context switching**. Architectural perfection, multi-tier microservices, and speculative abstractions must be ruthlessly discarded in favor of a **linear critical path**.

The build order follows a strict rule: **Zero differentiators until all six mandatory requirements are deployed, tested, and verifiable in production on Cloud Run.**

```
                                  TIME ALLOCATION BUDGET
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 0: Setup & Pipeline (10%)                                                        │
│ █ 10%                                                                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 1: Auth + Profile + Passcode (20%)                                               │
│ ██ 20%                                                                                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 2: Medication CRUD + Scheduling + Adherence (25%) [CORE ENGINE]                   │
│ ██▌ 25%                                                                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 3: Appointments Management (10%)                                                 │
│ █ 10%                                                                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Proactive Email Reminders (15%)                                               │
│ █▌ 15%                                                                                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 5: UI Polish, Demo Seeding & Live Deployment (15%)                               │
│ █▌ 15%                                                                                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 6: Stretch Differentiators (5%+ buffer remaining)                                │
│ ▌ 5%+                                                                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 17.2 Phase-by-Phase Implementation Plan

```mermaid
flowchart TD
    P0["Phase 0: Setup & Pipeline (10%)<br/>Next.js + Firebase + Cloud Run + Resend"] --> P1["Phase 1: Auth & Shared Profile (20%)<br/>Passcode Sharing & Care Circle Access"]
    P1 --> P2["Phase 2: Medication Engine (25%)<br/>CRUD + Scheduling + Adherence Tracking"]
    P1 --> P3["Phase 3: Appointments (10%)<br/>Doctor Visits & Consultations"]
    P2 --> P4["Phase 4: Proactive Reminders (15%)<br/>Cron & Instant Dispatch via Resend"]
    P3 --> P4
    P4 --> P5["Phase 5: Polish & Deployment (15%)<br/>E2E Flow, Seed Script, Cloud Run Live"]
    P5 --> P6["Phase 6: Stretch Differentiators (5%+)<br/>Certainty States & Care Timeline"]

    classDef core fill:#e0f2fe,stroke:#0284c7,stroke-width:2px;
    classDef critical fill:#fef3c7,stroke:#d97706,stroke-width:2px;
    classDef stretch fill:#f3e8ff,stroke:#9333ea,stroke-width:2px;
    class P0,P1,P3,P4,P5 core;
    class P2 critical;
    class P6 stretch;
```

---

#### Phase 0: Project Setup, Firebase Config & Deployment Pipeline
- **Time Allocation:** 10% of total hackathon budget
- **Mandatory Requirements Addressed:** Foundational infrastructure for all requirements
- **Specific Tasks:**
  1. Initialize Next.js 14+ (App Router, TypeScript, Tailwind CSS, Lucide icons, `shadcn/ui` base primitives: Button, Card, Dialog, Input, Badge).
  2. Configure Firebase Client SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`) and Firebase Admin SDK (`firebase-admin`) inside Next.js API routes.
  3. Define baseline Firestore collection paths: `users`, `patients`, `memberships`, `passcodes`, `medications`, `adherence_logs`, `appointments`.
  4. Integrate Resend SDK (`npm install resend`) and configure test API key with verified sender address.
  5. Containerize with a production-optimized multi-stage `Dockerfile` and configure a zero-friction deployment to Google Cloud Run (`gcloud run deploy` or automated via GitHub Actions).
  6. Verify environment variables in Cloud Run early: `FIREBASE_CLIENT_CONFIG`, `FIREBASE_ADMIN_KEY`, `RESEND_API_KEY`, `APP_BASE_URL`.
- **Dependencies:** None.
- **Deliverables:**
  - Running Next.js application deployed live on Cloud Run with valid HTTPS URL.
  - Initialized Firebase Auth and Firestore instances with read/write test pass.
  - Successful "Hello World" email dispatch verified via Resend sandbox/live dashboard.
- **Definition of Done (DoD):**
  - A commit pushed to `main` builds and deploys to Cloud Run in under 3 minutes.
  - Direct read/write to Firestore via Admin SDK succeeds in Cloud Run production runtime.
  - Zero deployment blocking issues remaining before functional code is written.

---

#### Phase 1: Auth + Patient Profile + Passcode-Based Access
- **Time Allocation:** 20% of total hackathon budget
- **Mandatory Requirements Addressed:**
  - Requirement 1: Shared elderly healthcare profile
  - Requirement 2: Secure passcode-based access
- **Specific Tasks:**
  1. **Firebase Auth Integration:** Email/Password and Google Sign-In wrapper (`useAuth` hook) storing user profile in `/users/{userId}`.
  2. **Elderly Patient Profile Schema & CRUD:**
     - Collection `/patients/{patientId}`:
       ```typescript
       interface PatientProfile {
         id: string;
         fullName: string;
         dateOfBirth: string; // YYYY-MM-DD
         bloodGroup: string;
         emergencyContact: { name: string; phone: string; relation: string };
         primaryDoctor: { name: string; phone: string; hospital: string };
         chronicConditions: string[];
         allergies: string[];
         createdBy: string; // primary caregiver userId
         createdAt: string;
       }
       ```
  3. **Passcode-Based Invitation System:**
     - Primary caregiver creates a patient profile; system generates a secure 6-character alphanumeric room passcode stored in `/passcodes/{code}` pointing to `{ patientId, createdAt, expiresAt, active: true }`.
     - Care Circle Membership collection `/memberships`: composite key `{userId}_{patientId}` storing `{ role: 'primary' | 'caregiver', joinedAt }`.
     - "Join Patient Care Circle" view: Secondary caregiver enters the 6-character passcode; API route `/api/care-circle/join` verifies passcode, creates the `membership` document, and grants immediate read/write access.
  4. **Security & Context:** Implement client-side `PatientContext` that loads active patient data based on current user memberships.
- **Dependencies:** Phase 0 (Firebase Auth & Firestore configured).
- **Deliverables:**
  - User registration and login flow.
  - "Create Elderly Profile" form with emergency contacts, blood group, and medical flags.
  - "Generate Care Circle Passcode" modal with copy-to-clipboard functionality.
  - "Join with Passcode" screen that associates a secondary caregiver with the elderly patient.
  - Shared Profile View showing unified patient summary.
- **Definition of Done (DoD):**
  - User A signs up, registers 78-year-old "Ramachandra Rao", and copies a 6-character passcode (e.g., `JS-7842`).
  - User B registers on a separate incognito browser, enters `JS-7842`, and immediately sees Ramachandra Rao's shared medical card and emergency contacts.
  - Access is enforced: unauthorized users cannot query the patient record.

---

#### Phase 2: Medication CRUD + Scheduling + Adherence Tracking
- **Time Allocation:** 25% of total hackathon budget (Core Clinical Heart)
- **Mandatory Requirements Addressed:**
  - Requirement 3: Medication schedule CRUD
  - Requirement 4: Medication adherence tracking
- **Specific Tasks:**
  1. **Medication Catalog Schema (`/medications/{medicationId}`):**
     ```typescript
     interface Medication {
       id: string;
       patientId: string;
       name: string;
       dosage: string; // e.g. "500 mg"
       form: 'tablet' | 'syrup' | 'injection' | 'drops';
       timingSlots: ('morning' | 'afternoon' | 'evening' | 'night')[];
       slotTimes: string[]; // ['08:00', '13:00', '19:00', '21:30']
       foodRelation: 'before_food' | 'after_food' | 'with_food';
       instructions: string;
       startDate: string;
       endDate?: string;
       active: boolean;
     }
     ```
  2. **Medication Management UI:**
     - Modal to add/edit medications with intuitive time-of-day selector and food relationship badges.
     - List view grouped by active/archived with dosage and timing clearly displayed in high contrast.
  3. **Daily Pillbox & Schedule Generator:**
     - Real-time client view computing today’s doses based on `timingSlots`.
     - Visual daily timeline divided into Morning, Afternoon, Evening, and Night buckets.
  4. **Adherence Action Engine (`/adherence_logs/{logId}`):**
     - Schema:
       ```typescript
       interface AdherenceLog {
         id: string;
         patientId: string;
         medicationId: string;
         scheduledDate: string; // YYYY-MM-DD
         slot: string; // 'morning' | 'night'
         status: 'TAKEN' | 'MISSED' | 'SKIPPED' | 'PENDING';
         loggedAt: string;
         loggedBy: string; // Caregiver userId or 'elderly_direct'
         notes?: string;
       }
       ```
     - Large touch-target action buttons for caregivers or seniors: "Mark Taken" (Green), "Skip" (Neutral), "Missed" (Red).
     - Daily adherence summary card displaying real-time percentage: `[ Taken / Total Scheduled ] * 100`.
- **Dependencies:** Phase 1 (Patient Profile & Care Circle Context).
- **Deliverables:**
  - Complete Medication CRUD interface (Add, Edit, Deactivate).
  - Daily "Today's Pillbox" dashboard.
  - Real-time adherence logger updating Firestore on every click.
  - Real-time adherence score widget for the current 24-hour cycle.
- **Definition of Done (DoD):**
  - Caregiver creates "Metformin 500mg, Morning & Night, After Food".
  - The daily pillbox immediately populates two dosage cards for today.
  - Caregiver clicks "Mark Taken" on the Morning dose; the pillbox immediately updates to a green badge with timestamp and caregiver name.
  - Reflected in real time on the secondary caregiver's connected screen via Firestore snapshot listener.

---

#### Phase 3: Doctor Appointment Management
- **Time Allocation:** 10% of total hackathon budget
- **Mandatory Requirements Addressed:**
  - Requirement 5: Doctor appointment management
- **Specific Tasks:**
  1. **Appointments Schema (`/appointments/{appointmentId}`):**
     ```typescript
     interface Appointment {
       id: string;
       patientId: string;
       doctorName: string;
       specialty: string; // Cardiology, Geriatrics, etc.
       hospitalClinic: string;
       appointmentDateTime: string; // ISO 8601
       locationAddress: string;
       contactPhone?: string;
       notes: string; // e.g. "Bring fasting blood sugar reports"
       status: 'UPCOMING' | 'COMPLETED' | 'CANCELLED';
       createdAt: string;
       createdBy: string;
     }
     ```
  2. **Appointment Scheduling UI:**
     - Simple modal with Doctor Name, Specialty dropdown, Hospital/Clinic, Date, Time, and special instructions.
  3. **Dashboard Appointment Widgets:**
     - "Next Scheduled Visit" hero banner at top of patient dashboard with countdown badge (`In 2 days`, `Tomorrow`, `Today at 10:30 AM`).
     - Chronological list of upcoming visits with quick links (call clinic, copy address).
     - "Mark as Completed" or "Cancel" quick actions.
- **Dependencies:** Phase 1 (Patient Profile context).
- **Deliverables:**
  - Appointment creation modal and edit flow.
  - Upcoming appointments list with relative countdown badges.
  - Historic appointments archive tab.
- **Definition of Done (DoD):**
  - Caregiver schedules an appointment: "Dr. K. Srinivas (Cardiology), Apollo Hospital, [Tomorrow at 10:00 AM]".
  - The patient dashboard prominently displays the appointment with an urgent "Tomorrow at 10:00 AM" pill.
  - Caregiver can click "Mark as Completed", which moves it to the past appointments archive without page refresh.

---

#### Phase 4: Proactive Email Reminders
- **Time Allocation:** 15% of total hackathon budget
- **Mandatory Requirements Addressed:**
  - Requirement 6: Proactive email reminders
- **Specific Tasks:**
  1. **Email Service Foundation with Resend:**
     - Modular transactional email utility (`lib/email.ts`) using Resend API.
     - Responsive, clean HTML email templates:
       - **Template A:** *Upcoming Doctor Visit Alert* (Doctor, Specialty, Time, Checklist).
       - **Template B:** *Medication Due / Missed Dose Warning* (Patient name, Pending medication, Scheduled time, Care circle contact).
  2. **Automated Dispatch Architecture (Solo-Hackathon Pragmatism):**
     - Build secure endpoint `/api/cron/reminders` protected by `Bearer ${CRON_SECRET}`.
     - Query Firestore for:
       - Appointments occurring within the next 24 to 48 hours.
       - Pending medication slots scheduled for the current window where `status === 'PENDING'`.
     - Trigger dispatch to all registered emails in the patient's care circle via Resend batch API.
     - Deploy lightweight Cloud Scheduler job (or free external ping service like `cron-job.org` calling `/api/cron/reminders` every 30 minutes).
  3. **Judging & Demo Fallback Trigger (Crucial Hackathon Guardrail):**
     - Add an explicit **"Trigger Live Reminder Email"** button in the dashboard settings/debug toolbar.
     - Allows instant on-demand email dispatch during live judging to avoid waiting for a 30-minute cron interval.
- **Dependencies:** Phase 2 (Medication schedule) & Phase 3 (Appointments).
- **Deliverables:**
  - Working `/api/cron/reminders` endpoint that scans schedule and dispatches emails.
  - Two polished HTML email templates rendered with dynamic patient data.
  - Live "Dispatch Reminder Now" demo action button on dashboard.
- **Definition of Done (DoD):**
  - Clicking "Dispatch Reminder Now" (or hitting the cron endpoint) results in an email delivered to the logged-in caregiver's actual inbox within 5 seconds.
  - The email contains the actual patient name ("Ramachandra Rao"), the exact pending medications, and the next appointment details.

---

#### Phase 5: UI Polish, Testing & Deployment Hardening
- **Time Allocation:** 15% of total hackathon budget
- **Mandatory Requirements Addressed:** End-to-end stability for all 6 requirements
- **Specific Tasks:**
  1. **Elderly-Care UX Optimization:**
     - High contrast text (WCAG AAA for critical labels).
     - Font size scaling toggle (`Normal` / `Large` text) for elder readability.
     - Minimum 48px touch targets for buttons.
     - Unmistakable status indicators: Green (Taken), Amber (Pending), Red (Missed).
  2. **Defensive Error Handling:**
     - Graceful offline/network reconnection alerts (`toast` via Sonner).
     - Validation feedback for invalid passcodes, empty medication fields, or past appointment dates.
  3. **One-Click Demo Seeder Script (`/api/dev/seed`):**
     - Creates a deterministic, rich demo scenario in 1 second:
       - Patient: "Anasuya Devi (Age 74, Type-2 Diabetes, Hypertension)".
       - Pre-configured medications: Metformin (Taken this morning), Telmisartan (Pending tonight), Vitamin D3 (Weekly).
       - Pre-configured appointment: "Dr. Arvind Rao (Nephrology) Tomorrow at 11:30 AM".
       - Active 6-digit passcode: `JEEVA1`.
  4. **Production Hardening on Cloud Run:**
     - Final environment variable verification, cold-start warmup route, and HTTPS certificate validation.
- **Dependencies:** Phases 0 through 4 complete.
- **Deliverables:**
  - High-polish, bug-free, mobile-responsive web app running on live Cloud Run URL.
  - Instant demo seeder button to reset state between judge presentations.
  - Verified end-to-end user journey with zero console errors.
- **Definition of Done (DoD):**
  - The complete 6-requirement flow can be demonstrated flawlessly on a live smartphone and laptop in under 3 minutes without a single reload or glitch.

---

#### Phase 6 (Stretch): High-ROI Differentiators
- **Time Allocation:** 5%+ (Strictly contingent on remaining time buffer)
- **Rules of Engagement:** Do NOT start Phase 6 until Phase 5 is fully signed off.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                       DIFFERENTIATOR TRIAGE MATRIX                                │
├───────────────────────────────────┬──────────────┬──────────────┬─────────────────┤
│ Differentiator                    │ Effort       │ Demo Value   │ Triage Action   │
├───────────────────────────────────┼──────────────┼──────────────┼─────────────────┤
│ 1. Medication Certainty (4 States)│ Very Low     │ High         │ PRIORITY 1      │
│ 2. Shared Care Timeline           │ Medium       │ Very High    │ PRIORITY 2      │
│ 8. Printable Care Card            │ Low          │ High         │ PRIORITY 3      │
│ 5. Care Gap Detection             │ Medium-High  │ Medium       │ DEFERRED        │
│ 6. Medication Change Audit        │ Medium       │ Low-Medium   │ DEFERRED        │
│ 3. Caregiver Handover / Shifts    │ High         │ Medium       │ DEFERRED        │
│ 7. System Health Monitoring       │ Medium       │ Low          │ DEFERRED        │
│ 4. Full Offline PWA Sync          │ Very High    │ High         │ DEFERRED        │
└───────────────────────────────────┴──────────────┴──────────────┴─────────────────┘
```

##### Stretch Task 6.1: Medication Certainty (4 States) [Effort: ~1 hour]
- **Concept:** In elderly care, caregivers frequently face ambiguity ("Did Dad take his pills or did he just say he did?"). Standard boolean `taken: true/false` is insufficient.
- **Implementation:**
  - Expand `adherence_logs.status` from binary to a 4-state certainty enum:
    1. `CONFIRMED_TAKEN` (Caregiver witnessed or pillbox sensor/photo verified).
    2. `REPORTED_TAKEN` (Elderly reported taking it verbally over phone).
    3. `SUSPECTED_MISSED` (Unacknowledged 60 minutes past scheduled window).
    4. `CONFIRMED_MISSED` (Caregiver verified pills remained in tray).
  - Update pillbox UI with a 4-way dropdown/badge selector.
- **Why it fits:** 90% of the UI and database schema was already built in Phase 2. This is purely an enum expansion with badge color adjustments, yielding massive clinical credibility for negligible effort.

##### Stretch Task 6.2: Shared Care Timeline [Effort: ~2 hours]
- **Concept:** A single, chronological activity feed giving all family members peace of mind about who did what and when.
- **Implementation:**
  - Collection `/patients/{patientId}/timeline_events`.
  - Automatic event emission whenever:
    - Passcode is claimed by a new family member ("Rajesh joined the care circle").
    - Medication is logged ("Priya marked Evening Metformin as Confirmed Taken").
    - Doctor visit is booked or updated.
  - Clean visual vertical timeline component with avatar badges, relative timestamps ("15 mins ago"), and icon categorization.
- **Why it fits:** Judges love visual feeds showing multi-user collaboration; it ties together Auth, Meds, and Appointments into one cohesive screen.

---

### 17.3 Textual Dependency Graph

The execution order and blocking paths are mapped below. Note the strict gating:

```
[Phase 0: Next.js + Firebase + Cloud Run + Resend Setup]
   │
   ▼
[Phase 1: Firebase Auth + Patient Profile + Passcode Room Access]
   │
   ├─────────────────────────────────────────┐
   ▼                                         ▼
[Phase 2: Medication CRUD + Adherence]    [Phase 3: Appointments Management]
   │                                         │
   └────────────────────┬────────────────────┘
                        ▼
       [Phase 4: Proactive Email Reminders (Resend)]
                        │
                        ▼
       [Phase 5: UI Polish + Seed Script + Cloud Run Hardening]
                        │
            ════════════╧════════════
            MANDATORY MVP GATE (100%)
            ════════════╤════════════
                        ▼
       [Phase 6: High-ROI Differentiators (Certainty + Timeline)]
```

#### Blocking Analysis:
1. **Phase 0 blocks Phase 1:** No UI work can proceed without authenticated user context and Firestore bindings.
2. **Phase 1 blocks Phase 2 & Phase 3:** All medications and appointments require a foreign key `patientId` and a valid care-circle membership.
3. **Phase 2 & Phase 3 block Phase 4:** The proactive reminder engine cannot generate meaningful emails without active medications and scheduled appointments to query.
4. **Phases 0–4 block Phase 5:** Polishing and end-to-end testing cannot begin until all data conduits are connected.
5. **Phase 5 blocks Phase 6:** **HARD GATE.** If the core 6 requirements are not rock-solid, working on differentiators will cause a demo disaster.

---

### 17.4 Risk Items & Mitigation Strategies

| Risk Item | Impact | Likelihood | Root Cause | Solo Developer Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **1. Resend Sender Domain Verification Delay** | Critical | High | Custom domain DNS propagation (SPF, DKIM) taking hours. | **Zero-DNS Fallback:** In development/hackathon, send from `onboarding@resend.dev` to the developer's registered email address. Demo using your verified email address or use an already active personal domain. Do not wait for DNS records at 2 AM. |
| **2. Timezone Mismatches in Medication Times** | High | High | UTC vs. Local Time (IST) skewing scheduled slots and calendar dates. | Store all medication times as simple 24-hour local strings (e.g., `"08:00"`, `"20:00"`) and dates as local `YYYY-MM-DD`. Avoid complex UTC conversions; calculate daily pillboxes against the user's browser local time. |
| **3. Cloud Scheduler Cron Invocations Blocked** | Medium | Medium | Cloud Scheduler authentication / IAM permissions on Cloud Run. | **The "Judge Button" Safeguard:** Implement the scheduled API `/api/cron/reminders`, but also wire an explicit "Trigger Test Reminder" button in the UI. If Cloud Scheduler fails during judging, click the button to demo the live email arrival. |
| **4. Firestore Security Rules Debugging Quagmire** | High | Medium | Overly complex recursive rules checking memberships blocking reads. | Start with simplified rule: `allow read, write: if request.auth != null;` for local development. Only apply strict tenant isolation rules once endpoints are functionally proven. Never lose 3 hours to Firestore `PERMISSION_DENIED` errors during a hackathon. |
| **5. Cloud Run Cold Starts During Demo** | Medium | Low | Cloud Run scaling to zero instances causing 8-second delay when opening app. | Set `--min-instances 1` on Cloud Run during the final judging window. Ping the URL 2 minutes prior to pitching to ensure hot container state. |

---

### 17.5 Deferral List: Explicitly Deferred Features & Technical Justification

To guarantee delivery of all 6 mandatory requirements, the following differentiators are **explicitly cut from the core sprint**:

1. **Differentiator 4: Offline Access (PWA & Local Cache Sync)**
   - *Reason for Deferral:* Implementing bi-directional offline synchronization with conflict resolution for multi-caregiver environments creates race conditions. A flaky offline PWA during judging is worse than a clean web app requiring internet.
2. **Differentiator 3: Caregiver Assignment / Shift Handover System**
   - *Reason for Deferral:* Requires complex role-based state machines, shift scheduling, and escalation logic. The shared care circle with transparent real-time logs satisfies 80% of the collaboration need without the state overhead.
3. **Differentiator 5: Care Gap Detection**
   - *Reason for Deferral:* Algorithmic heuristic analysis across adherence history requires statistical edge-case handling (e.g., distinguishing between missed doses and intentional doctor-ordered pauses). High engineering cost with low visual impact during a short pitch.
4. **Differentiator 6: Medication Change History / Verification**
   - *Reason for Deferral:* Formal multi-signature change verification (requiring two caregivers to approve a dosage change) slows down the demo walkthrough and introduces friction in a 3-minute presentation.
5. **Differentiator 7: System Health Monitoring Dashboard**
   - *Reason for Deferral:* Judges evaluate patient and caregiver value, not internal devops APM screens. A simple healthcheck endpoint (`/api/health`) suffices; building an administrative observability UI is a distraction.
6. **Differentiator 8: Printable Care Card (Deferred unless Phase 6 reached)**
   - *Reason for Deferral:* While simple, CSS print stylesheets (`@media print`) frequently suffer from unpredictable pagination and layout clipping across browsers. Kept as lowest priority stretch only.

---

### 17.6 The MVP Cut: Absolute Minimum Viable Demo Flow

The MVP Cut is the **bulletproof 3-minute live presentation script** that guarantees all 6 mandatory requirements are proven before the judges:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              THE 3-MINUTE JUDGING SCRIPT                               │
├────────┬───────────────────────────────────────┬───────────────────────────────────────┤
│ Minute │ Screen / Action                       │ Mandatory Requirement Validated       │
├────────┼───────────────────────────────────────┼───────────────────────────────────────┤
│ 00:00  │ Caregiver A logs in, clicks "Seed     │ Req 1: Shared Elderly Profile         │
│        │ Demo Family" -> Profile for "Ramachandra│                                       │
│        │ Rao (78, Diabetic)" loads instantly.  │                                       │
├────────┼───────────────────────────────────────┼───────────────────────────────────────┤
│ 00:45  │ Caregiver A generates Passcode "JS-78"│ Req 2: Secure Passcode Access         │
│        │ Caregiver B on mobile browser enters  │                                       │
│        │ "JS-78" -> Instant care circle access!│                                       │
├────────┼───────────────────────────────────────┼───────────────────────────────────────┤
│ 01:30  │ Caregiver B adds new medication       │ Req 3: Medication Schedule CRUD       │
│        │ "Amlodipine 5mg, Morning, After Food".│                                       │
│        │ Today's Pillbox updates immediately.  │                                       │
├────────┼───────────────────────────────────────┼───────────────────────────────────────┤
│ 02:00  │ Caregiver A marks morning Metformin as│ Req 4: Medication Adherence Tracking  │
│        │ "TAKEN". Screen B reflects green tick │                                       │
│        │ in real time via Firestore listener.  │                                       │
├────────┼───────────────────────────────────────┼───────────────────────────────────────┤
│ 02:30  │ Caregiver A views upcoming visit:     │ Req 5: Doctor Appointment Management  │
│        │ "Dr. Sharma (Cardiology) Tomorrow".   │                                       │
├────────┼───────────────────────────────────────┼───────────────────────────────────────┤
│ 02:50  │ Caregiver clicks "Dispatch Reminder" ->│ Req 6: Proactive Email Reminders      │
│        │ Caregiver phone buzzes on stage with  │                                       │
│        │ dynamic Resend HTML email alert!      │                                       │
└────────┴───────────────────────────────────────┴───────────────────────────────────────┘
```

---

### 17.7 Decision: Which Differentiators to Attempt

#### Recommended Decision Tree Based on Remaining Time:

```mermaid
flowchart TD
    Gate{"All 6 Mandatory Req's<br/>Deployed & Tested on Cloud Run?"}
    Gate -- NO --> Stop["HALT: Do NOT touch differentiators.<br/>Fix bugs, polish UI, test seed script."]
    Gate -- YES --> TimeCheck{"Time Remaining<br/>Before Submission?"}
    
    TimeCheck -- "< 2 Hours" --> P5Polish["Stop development.<br/>Rehearse 3-minute pitch 3 times."]
    TimeCheck -- "2 to 4 Hours" --> Diff1["Implement Differentiator 1:<br/>Medication Certainty (4 States)<br/>(Effort: ~45 mins)"]
    Diff1 --> Diff2Check{"Buffer still left?"}
    Diff2Check -- YES --> Diff2["Implement Differentiator 2:<br/>Shared Care Timeline Feed<br/>(Effort: ~90 mins)"]
    Diff2Check -- NO --> P5Polish
    TimeCheck -- "> 4 Hours" --> Diff1
    Diff2 --> FinalPolish["Lock code. Cloud Run warm-up.<br/>Ready for submission."]
```

#### Final Recommendation Summary:
1. **Medication Certainty (4 States):** **MANDATORY TO ATTEMPT FIRST.** It costs virtually zero net architectural time because the database table (`adherence_logs`) and UI buttons already exist from Phase 2. Changing the status from a boolean to a 4-state enum demonstrates deep healthcare domain expertise to hackathon judges with less than 60 lines of code.
2. **Shared Care Timeline:** **ATTEMPT SECOND.** If 2 hours remain, build this component. It visually aggregates medications, appointments, and caregiver join events into a modern social-style feed, instantly giving judges the emotional feeling of a connected family caring for their elder.
3. **All other differentiators remain strictly frozen.** Any extra minutes beyond this must be spent rehearsing the live demo and verifying the Resend inbox delivery. Reliability under presentation pressure wins hackathons.
