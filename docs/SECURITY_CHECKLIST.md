# Security Checklist

**Version:** 1.0  
**Date:** January 23, 2026  
**Purpose:** Security requirements for BookSharez Phase 1 MVP

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
- [ ] All listing creation routes require authentication
- [ ] Middleware checks auth on server-side routes
- [ ] Client-side auth checks for UI only (not security)
- [ ] API routes validate JWT tokens
- [ ] Unauthenticated users redirected to login

**Implementation:**
```typescript
// middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Protect routes that require auth
  if (!session && req.nextUrl.pathname.startsWith('/shelf')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}
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

### Environment Variables
- [ ] All API keys in .env.local (never committed)
- [ ] .env.local in .gitignore
- [ ] Different keys for dev/staging/production
- [ ] API keys stored in Vercel environment variables
- [ ] No API keys in client-side code

### API Route Protection
- [ ] Server-side API routes only (no client direct calls to external APIs)
- [ ] Rate limiting per user/IP
- [ ] Input validation on all endpoints
- [ ] CORS properly configured
- [ ] API routes check authentication

**Example Protected Route:**
```typescript
// app/api/listings/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  
  // Verify authentication
  const {
    data: { session },
  } = await supabase.auth.getSession();
  
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Process authenticated request
  // ...
}
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
- [ ] React automatically escapes output (verify no dangerouslySetInnerHTML)
- [ ] User-generated content sanitized before display
- [ ] No eval() or Function() constructor with user input
- [ ] Content Security Policy headers configured

**CSP Headers (next.config.js):**
```javascript
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  }
];
```

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
- [ ] HTTPS enforced (Vercel handles automatically)
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
- [ ] Logs stored securely (Vercel/Sentry)

---

## Rate Limiting

### Prevent Abuse
- [ ] Login attempts limited (5 per 15 minutes)
- [ ] Signup limited (3 per hour per IP)
- [ ] Listing creation limited (10 per hour per user)
- [ ] Photo uploads limited (20 per hour per user)
- [ ] Search queries limited (100 per hour per IP)

**Implementation (next.config.js or middleware):**
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
```

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
- [ ] All environment variables set in Vercel
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
- [ ] Update Next.js monthly
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
