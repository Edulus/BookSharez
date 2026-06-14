# Error Handling Patterns

**Version:** 1.1  
**Date:** January 23, 2026 (architecture revision June 14, 2026)  
**Updated:** June 14, 2026 — Reflects vanilla JS + Supabase Edge Functions stack (pivoted from Next.js).  
**Purpose:** Standardized error handling for BookSharez Phase 1

> **Architecture note (June 12, 2026):** Vanilla JS + Supabase Edge Functions,
> not Next.js. The code blocks below are plain JavaScript (Edge Functions run on
> the Deno runtime). Two contexts to keep straight:
> - **Edge Function (Deno) handlers** touch third-party keys (ISBNdb, Google
>   Books, AI) via `Deno.env.get('X')`. The browser never calls those APIs.
> - **Browser handlers** (photo upload, DB insert, auth) use the `supabaseClient`
>   from js/supabase-config.js directly, and call Edge Functions with
>   `supabaseClient.functions.invoke('<name>', …)`.

---

## Core Principles

1. **Never expose API keys or internal errors to users**
2. **Always provide fallback options**
3. **Log errors for debugging**
4. **Show user-friendly messages**
5. **Graceful degradation**

---

## ISBN Lookup Errors

### ISBNdb API Failures

**Common Errors:**
- `404 Not Found` - Book not in database
- `429 Too Many Requests` - Rate limit exceeded (1 req/sec free tier)
- `403 Forbidden` - Invalid/expired API key
- Network timeout

**Handling Pattern (runs inside the `isbn-lookup` Edge Function):**
```javascript
async function lookupISBN(isbn) {
  try {
    const response = await fetch(`https://api2.isbndb.com/book/${isbn}`, {
      headers: {
        'Authorization': Deno.env.get('ISBNDB_API_KEY'),
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (response.status === 404) {
      // Book not found - try Google Books fallback
      return await lookupGoogleBooks(isbn);
    }

    if (response.status === 429) {
      // Rate limit - wait and retry OR go to fallback
      console.warn('ISBNdb rate limit hit, using fallback');
      return await lookupGoogleBooks(isbn);
    }

    if (!response.ok) {
      throw new Error(`ISBNdb API error: ${response.status}`);
    }

    const data = await response.json();
    return normalizeISBNdbData(data);

  } catch (error) {
    console.error('ISBNdb lookup failed:', error);
    // Always fallback to Google Books
    return await lookupGoogleBooks(isbn);
  }
}
```

**User-Facing Messages:**
- ISBNdb 404: "Searching alternate database..." (automatic, no error shown)
- Rate limit: "Looking up book details..." (seamless fallback)
- Complete failure: "Could not find book. Please enter details manually."

---

## Google Books API Failures

**Common Errors:**
- `404 Not Found` - Book not found
- `403 Forbidden` - API key issue or quota exceeded
- Network timeout

**Handling Pattern (runs inside the `isbn-lookup` Edge Function):**
```javascript
async function lookupGoogleBooks(isbn) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${Deno.env.get('GOOGLE_BOOKS_API_KEY')}`;
    
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Google Books API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.totalItems === 0) {
      // No results found
      return null;
    }

    return normalizeGoogleBooksData(data.items[0]);

  } catch (error) {
    console.error('Google Books lookup failed:', error);
    return null;
  }
}
```

**User-Facing Messages:**
- Not found: "Book not found. You can enter details manually."
- API failure: "Unable to auto-fill book details. Please enter manually."

---

## AI Pricing Errors

**Common Errors:**
- OpenAI/Claude API timeout
- Rate limit exceeded
- Invalid response format
- API key invalid

**Handling Pattern:**
```javascript
// Runs in the browser; calls the `pricing` Edge Function (which holds the AI key).
async function estimatePrice(bookData, condition) {
  try {
    const { data, error } = await supabaseClient.functions.invoke('pricing', {
      body: { bookData, condition }
      // invoke attaches the user's JWT automatically and has its own timeout;
      // the function itself uses AbortSignal.timeout(10000) on the AI call.
    });

    if (error) {
      throw new Error(`Pricing function error: ${error.message}`);
    }

    const { price, confidence } = data;
    
    // Validate price is reasonable
    if (price < 0.5 || price > 1000) {
      throw new Error('Invalid price estimate');
    }

    return { price, confidence };

  } catch (error) {
    console.error('AI pricing failed:', error);
    
    // Fallback to simple algorithm
    return fallbackPricing(bookData, condition);
  }
}

function fallbackPricing(bookData, condition) {
  // Simple condition-based pricing if AI fails
  const basePrice = bookData.listPrice || 20; // Default to $20
  
  const multipliers = {
    'like_new': 0.75,
    'very_good': 0.55,
    'good': 0.35,
    'acceptable': 0.20
  };
  
  const estimated = basePrice * multipliers[condition];
  return {
    price: Math.max(2, Math.round(estimated * 2) / 2), // Min $2, round to $0.50
    confidence: 'low'
  };
}
```

**User-Facing Messages:**
- AI success: "Suggested price: $X.XX (based on condition and market data)"
- Fallback: "Estimated price: $X.XX (you can adjust this)"
- Complete failure: "Please set your price (typical range: $X - $Y)"

---

## Photo Upload Errors

**Common Errors:**
- File too large (>5MB)
- Invalid file type
- Network upload failure
- Storage quota exceeded

**Handling Pattern (browser):**
```javascript
async function uploadPhoto(file, listingId) {
  // Validate before upload
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  
  if (file.size > MAX_SIZE) {
    throw new Error('Photo must be under 5MB');
  }
  
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, and WEBP images allowed');
  }

  try {
    const { data, error } = await supabaseClient.storage
      .from('listing-photos')
      .upload(`${listingId}/${Date.now()}.jpg`, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;
    
    return data.path;

  } catch (error) {
    console.error('Photo upload failed:', error);
    throw new Error('Failed to upload photo. Please try again.');
  }
}
```

**User-Facing Messages:**
- File too large: "Photo must be under 5MB. Please compress or choose another."
- Invalid type: "Please upload JPG, PNG, or WEBP images only."
- Upload failed: "Upload failed. Check your connection and try again."

---

## Database Errors

**Common Errors:**
- Duplicate listing
- Foreign key constraint
- RLS policy denial
- Connection timeout

**Handling Pattern (browser):**
```javascript
async function createListing(listingData) {
  try {
    const { data, error } = await supabaseClient
      .from('listings')
      .insert([listingData])
      .select()
      .single();

    if (error) {
      // Check for specific error codes
      if (error.code === '23505') {
        throw new Error('You already have a listing for this book');
      }
      
      if (error.code === '42501') {
        throw new Error('Authentication required. Please log in.');
      }
      
      throw error;
    }

    return data;

  } catch (error) {
    console.error('Database error:', error);
    
    if (error instanceof Error) {
      throw error; // Re-throw known errors
    }
    
    throw new Error('Failed to create listing. Please try again.');
  }
}
```

**User-Facing Messages:**
- Duplicate: "You already have this book listed. Edit your existing listing instead."
- Auth error: "Please log in to create a listing."
- Generic error: "Something went wrong. Please try again."

---

## Authentication Errors

**Common Errors:**
- Invalid credentials
- Email already registered
- Session expired
- Email not verified

**Handling Pattern (browser):**
```javascript
async function signUp(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password
    });

    if (error) {
      // Supabase provides user-friendly error messages
      throw new Error(error.message);
    }

    return data;

  } catch (error) {
    console.error('Sign up error:', error);
    
    if (error instanceof Error) {
      // Common errors to handle specifically
      if (error.message.includes('already registered')) {
        throw new Error('Email already registered. Try logging in instead.');
      }
      
      if (error.message.includes('weak password')) {
        throw new Error('Password must be at least 8 characters.');
      }
      
      throw error;
    }
    
    throw new Error('Sign up failed. Please try again.');
  }
}
```

**User-Facing Messages:**
- Invalid credentials: "Incorrect email or password."
- Email exists: "Email already registered. Try logging in instead."
- Session expired: "Session expired. Please log in again."

---

## Network Errors

**Handling Pattern:**
```javascript
// Add timeout to all fetch calls
const fetchWithTimeout = async (url, options = {}) => {
  const timeout = 10000; // 10 seconds
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection.');
    }
    
    throw new Error('Network error. Please check your connection.');
  }
};
```

---

## Error Logging

**Pattern for Production:**
```javascript
function logError(error, context) {
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', error);
    console.error('Context:', context);
  }
  
  // Send to Sentry in production (Phase 2). Browser uses the public SENTRY_DSN;
  // Edge Functions read it via Deno.env.get('SENTRY_DSN').
  if (SENTRY_DSN) {
    Sentry.captureException(error, {
      extra: context
    });
  }
}
```

---

## UI Error Display

**Toast Notifications (Recommended):**
`toast` here is a small vanilla-JS notification helper (no react-hot-toast) —
e.g. a function that appends a styled, auto-dismissing `<div>` to the DOM.
```javascript
// Success
toast.success('Book listed successfully!');

// Warning
toast.warning('Using estimated pricing due to API timeout');

// Error
toast.error('Failed to upload photo. Please try again.');

// Info
toast.info('Searching alternate database...');
```

**Form Validation Errors:**
- Show inline below field
- Red text/border
- Clear, specific message
- Show on blur or submit

**Critical Errors:**
- Full-page error fallback UI
- Option to reload
- Contact support link

---

## Rate Limiting

⚠️ **The client-side throttle below is NOT sufficient on its own.** It only
paces one browser tab. With Edge Functions, many users can hit ISBNdb
concurrently and breach the 1 req/sec Basic-plan limit. The real defense is the
**ISBN caching strategy**: the lookup Edge Function checks the `books` table
first and calls ISBNdb only on a cache miss (also speeds lookups and cuts API
cost). Keep the throttle as a courtesy on the client; do server-side
caching/queueing in the function.

**Client-Side Throttling (courtesy only):**
```javascript
// Prevent rapid API calls
const throttle = (func, delay) => {
  let timeoutId;
  let lastRun = 0;

  return (...args) => {
    if (Date.now() - lastRun >= delay) {
      func(...args);
      lastRun = Date.now();
    } else {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func(...args);
        lastRun = Date.now();
      }, delay);
    }
  };
};

// Usage: Throttle ISBN lookups to respect API limits
const throttledLookup = throttle(lookupISBN, 1100); // 1.1 seconds for 1 req/sec limit
```

---

## Summary

**Every API call should:**
1. Have timeout (5-10 seconds)
2. Have try/catch wrapper
3. Provide fallback option when possible
4. Show user-friendly error message
5. Log error details for debugging
6. Never expose internal error details to user

**Testing Error Scenarios:**
- Disconnect network mid-upload
- Use invalid API keys
- Exceed rate limits
- Upload oversized files
- Submit invalid form data
- Test on slow connections (throttle in DevTools)
