# Security Checklist

**Version:** 1.1  
**Date:** January 23, 2026 (architecture revision June 14, 2026)  
**Purpose:** Security requirements for BookSharez Phase 1 MVP

> **Architecture note (June 12, 2026):** BookSharez is **vanilla HTML/CSS/JS +
> Supabase Edge Functions**, not Next.js. The original code samples below were
> Next.js (`middleware.ts`, `app/api/*` route handlers, `next.config.js`) and
> have been replaced with their Edge Function / static-hosting equivalents.
> Two consequences run through this whole document:
> 1. **There is no server-side middleware.** All client JS is fully visible, so
>    client-side auth checks are **UX only**. Real authorization comes from
>    **RLS** (primary layer) and **JWT verification inside Edge Functions**.
> 2. Secrets live as **Supabase Edge Function secrets**, never in client code.

---

## Authentication & Authorization

### Supabase Auth Setup
- [ ] Email verification enabled in Supabase dashboard
- [ ] Password requirements: minimum 8 characters
- [ ] Rate limiting on auth endpoints (prevent brute force)
- [ ] Session timeout configured (default: 1 hour idle, 24 hour absolute)
- [ ] Secure password reset flow implemented
- [ ] No passwords stored in code or logs

### Protected Routes
- [ ] All write operations (create/edit/delete listing) require authentication
- [ ] Edge Functions validate the JWT on every privileged request (real security)
- [ ] Client-side auth checks gate the UI only (a hidden "Sell" view is NOT security)
- [ ] RLS enforces ownership even if a request bypasses the UI
- [ ] Unauthenticated users sent to the login modal

**Implementation — client-side UI gate (UX only, vanilla JS):**
```javascript
// Hide/redirect away from the dashboard view if there's no session.
// This is cosmetic — it stops the page rendering, NOT the data access.
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showView('home');
    openLoginModal();
    return null;
  }
  return session;
}
```

**Implementation — real check inside an Edge Function (security):**
```javascript
// supabase/functions/create-listing/index.ts  (Deno runtime)
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization'); // "Bearer <jwt>"
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Validate the caller's JWT by passing their token through.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Authenticated. RLS will also enforce auth.uid() = user_id on the insert.
  // ... process request ...
});
```

---

## Row Level Security (RLS)

### Critical Policies
- [ ] All tables have RLS enabled
- [ ] Users can only read their own data
- [ ] Users can only modify their own listings
- [ ] Public read access only for active listings
- [ ] No direct access to user table from client

**Required Policies (see PHASE_1_MVP_SPEC.md for SQL):**
1. Users can insert their own listings
2. Users can view all active listings
3. Users can update their own listings
4. Users can delete their own listings
5. Anyone can view photos for active listings
6. Users can insert photos for their listings

### Testing RLS
- [ ] Test accessing another user's listing (should fail)
- [ ] Test modifying another user's listing (should fail)
- [ ] Test viewing own removed/sold listings (should work)
- [ ] Test anonymous access to listings (should work for active only)

---

## API Security

### Environment Variables / Secrets
- [ ] Third-party secrets stored as Supabase Edge Function secrets (`supabase secrets set`)
- [ ] Only the Supabase URL + publishable/anon key appear in client JS (js/supabase-config.js)
- [ ] Service-role key used ONLY inside Edge Functions, never shipped to the browser
- [ ] .env (local reference) in .gitignore; no real secrets committed
- [ ] No API keys in client-side code

### Edge Function Protection
- [ ] All external API calls (ISBNdb, Google Books, AI) go through Edge Functions — never direct from the browser
- [ ] Rate limiting per user/IP enforced server-side in the Edge Function (see ISBN caching strategy)
- [ ] Input validation on every function
- [ ] CORS headers restricted to the site origin
- [ ] Each privileged function verifies the caller's JWT

**Example Protected Edge Function:**
```javascript
// supabase/functions/create-listing/index.ts  (Deno runtime)
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Process authenticated request (secrets via Deno.env.get(...)) ...
});
```

### Third-Party API Keys
- [ ] ISBNdb key never exposed to client
- [ ] Google Books key never exposed to client
- [ ] OpenAI/Claude key never exposed to client
- [ ] All external API calls from server routes only

---

## Input Validation

### User Input
- [ ] ISBN format validation (10 or 13 digits)
- [ ] Price validation (min $0.01, max $9999.99)
- [ ] Description length limit (500 chars)
- [ ] Condition must be one of allowed values
- [ ] Email format validation on signup
- [ ] Password strength requirements

**Validation with Zod:**
```typescript
import { z } from 'zod';

const listingSchema = z.object({
  isbn: z.string()
    .regex(/^(\d{10}|\d{13})$/, 'Invalid ISBN'),
  price: z.number()
    .min(0.01, 'Price must be at least $0.01')
    .max(9999.99, 'Price cannot exceed $9999.99'),
  condition: z.enum(['like_new', 'very_good', 'good', 'acceptable']),
  description: z.string()
    .max(500, 'Description cannot exceed 500 characters')
    .optional()
});
```

### File Uploads
- [ ] Maximum file size enforced (5MB)
- [ ] Allowed file types validated (JPG, PNG, WEBP only)
- [ ] File name sanitization (prevent path traversal)
- [ ] Virus scanning (Phase 2+)
- [ ] MIME type verification (not just extension)

**File Validation:**
```typescript
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function validateFile(file: File): boolean {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large');
  }
  
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type');
  }
  
  return true;
}
```

---

## Data Sanitization

### XSS Prevention
⚠️ **Vanilla JS does NOT auto-escape.** Unlike React, there is no framework
escaping output. The prototype builds book cards with `innerHTML` and unescaped
user input (title/author) — a real XSS hole once user data flows in. Fix before
listings are user-generated.
- [ ] Never interpolate user input into `innerHTML` — use `textContent`, or escape first
- [ ] User-generated content (title, author, description) escaped before display
- [ ] No eval() or Function() constructor with user input
- [ ] Content Security Policy headers configured (via host / `<meta>` tag)

**Escape helper (vanilla JS):**
```javascript
// Use instead of dropping raw strings into innerHTML.
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
// e.g. card.innerHTML = `<h3>${escapeHTML(book.title)}</h3>`;
```

**CSP:** there is no `next.config.js`. Set headers at the static host (Netlify
`_headers`, Cloudflare Pages, Nginx) or, as a baseline, a meta tag in index.html:
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://*.supabase.co;">
```
(Also set `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` at the host.)

### SQL Injection Prevention
- [ ] All database queries use parameterized queries
- [ ] No raw SQL with string concatenation
- [ ] Supabase client handles sanitization automatically
- [ ] Never pass user input directly to database

---

## File Storage Security

### Supabase Storage
- [ ] Public bucket for book covers (read-only)
- [ ] Private bucket for listing photos (RLS controlled)
- [ ] Storage policies match listing access rules
- [ ] No direct file deletion by users (soft delete only)
- [ ] File paths use UUIDs (prevent enumeration)

**Storage Policies:**
```sql
-- Allow public read for active listing photos
CREATE POLICY "Public read access to listing photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'listing-photos' AND
  EXISTS (
    SELECT 1 FROM listings
    WHERE listings.id::text = (storage.foldername(name))[1]
    AND listings.status = 'active'
  )
);

-- Allow users to upload to their own listings
CREATE POLICY "Users can upload to their listings"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'listing-photos' AND
  EXISTS (
    SELECT 1 FROM listings
    WHERE listings.id::text = (storage.foldername(name))[1]
    AND listings.user_id = auth.uid()
  )
);
```

---

## HTTPS & Transport Security

### Production Requirements
- [ ] HTTPS enforced (most static hosts — Netlify/Cloudflare Pages/GitHub Pages — do this automatically; Supabase is HTTPS-only)
- [ ] No mixed content warnings
- [ ] Secure cookies (httpOnly, secure flags)
- [ ] HSTS header enabled
- [ ] Certificate valid and up-to-date

---

## Error Handling & Logging

### Secure Error Messages
- [ ] Never expose stack traces to users
- [ ] Generic error messages in production
- [ ] Detailed errors only in logs
- [ ] No sensitive data in error messages
- [ ] No database structure revealed in errors

**Safe Error Display:**
```typescript
// Bad
catch (error) {
  return { error: error.message }; // May expose internal details
}

// Good
catch (error) {
  console.error('Internal error:', error);
  return { error: 'Something went wrong. Please try again.' };
}
```

### Logging
- [ ] No passwords in logs
- [ ] No API keys in logs
- [ ] No credit card data in logs
- [ ] User identifiers hashed in logs (Phase 2+)
- [ ] Logs stored securely (Supabase Edge Function logs / Sentry)

---

## Rate Limiting

### Prevent Abuse
- [ ] Login attempts limited (5 per 15 minutes)
- [ ] Signup limited (3 per hour per IP)
- [ ] Listing creation limited (10 per hour per user)
- [ ] Photo uploads limited (20 per hour per user)
- [ ] Search queries limited (100 per hour per IP)

**Implementation:** Supabase Auth already rate-limits signup/login server-side.
For listing/photo/search abuse, enforce limits inside the relevant Edge Function
(e.g. count recent rows per `auth.uid()` before allowing the write), since there
is no Express/Next middleware layer. ISBNdb's 1 req/sec limit is handled by the
ISBN caching strategy (check the `books` table first; call ISBNdb only on a miss).

---

## User Privacy

### Data Collection
- [ ] Only collect necessary data (email, username)
- [ ] No tracking cookies without consent (Phase 2+)
- [ ] User can delete their account (Phase 2+)
- [ ] User can export their data (Phase 2+)
- [ ] Privacy policy visible and clear

### Data Retention
- [ ] Deleted listings soft-deleted (marked as removed)
- [ ] User data retained for 30 days after deletion request
- [ ] Photos deleted permanently after listing removal (Phase 2)
- [ ] Email addresses hashed in analytics (Phase 2+)

---

## Dependency Security

### NPM Packages
- [ ] Regular `npm audit` checks
- [ ] Update dependencies monthly
- [ ] No packages with critical vulnerabilities
- [ ] Use lock file (package-lock.json or yarn.lock)
- [ ] Review dependencies before adding

**Commands:**
```bash
npm audit
npm audit fix
npm outdated
```

---

## Pre-Production Checklist

### Before Launch
- [ ] All secrets set as Supabase Edge Function secrets (not in client JS)
- [ ] Supabase RLS policies tested thoroughly
- [ ] No console.log with sensitive data
- [ ] Error boundaries implemented
- [ ] 404 and 500 error pages created
- [ ] Rate limiting configured
- [ ] HTTPS redirect enabled
- [ ] Security headers configured
- [ ] No .env files in repository
- [ ] Authentication flow tested (signup, login, logout, reset)

### Security Testing
- [ ] Try to access other users' listings (should fail)
- [ ] Try to modify other users' listings (should fail)
- [ ] Test with invalid inputs (should be rejected)
- [ ] Test file upload vulnerabilities
- [ ] Test auth bypass attempts
- [ ] Review all API endpoints for auth requirements
- [ ] Test CORS policies

---

## Ongoing Security

### Monitoring
- [ ] Set up Sentry error tracking (Phase 2)
- [ ] Monitor failed login attempts
- [ ] Alert on repeated auth failures
- [ ] Track API usage for anomalies
- [ ] Regular security audits

### Updates
- [ ] Update Supabase dashboard weekly
- [ ] Update the Supabase JS library (CDN version pin) and Edge Function deps monthly
- [ ] Update all dependencies monthly
- [ ] Review Supabase security advisories
- [ ] Subscribe to security mailing lists

---

## Common Vulnerabilities to Avoid

### OWASP Top 10
- [ ] **Broken Access Control**: RLS policies prevent unauthorized access
- [ ] **Cryptographic Failures**: HTTPS everywhere, secure password storage (Supabase)
- [ ] **Injection**: Parameterized queries (Supabase client), input validation
- [ ] **Insecure Design**: Authentication required for sensitive operations
- [ ] **Security Misconfiguration**: Review all settings, disable debug in production
- [ ] **Vulnerable Components**: Regular dependency updates
- [ ] **Authentication Failures**: Strong passwords, session management (Supabase)
- [ ] **Software/Data Integrity**: Lock files, verify uploads
- [ ] **Logging Failures**: Sentry integration (Phase 2)
- [ ] **Server-Side Request Forgery**: Validate all URLs, no user-controlled redirects

---

## Phase 1 Security MVP

**Minimum requirements before launch:**
1. âœ… RLS policies on all tables
2. âœ… Protected routes and API endpoints
3. âœ… Input validation on all forms
4. âœ… File upload validation
5. âœ… HTTPS enforced
6. âœ… Environment variables secured
7. âœ… No sensitive data in logs/errors
8. âœ… Rate limiting on critical endpoints

**Phase 2+ enhancements:**
- Content Security Policy
- Advanced rate limiting
- Account deletion workflow
- Data export functionality
- Enhanced logging/monitoring
- Penetration testing
