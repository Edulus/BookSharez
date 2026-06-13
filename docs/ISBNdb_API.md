# ISBNdb API Reference

## Overview
ISBNdb REST API allows you to retrieve information about millions of books (93M+ entries).

## Authentication
Every request requires an HTTP Authorization header:
```
Authorization: YOUR_REST_KEY
```

**Important:** Pass your key via header only, NOT via GET parameters.

## Base URLs

### Standard (Basic Plan)
- **URL:** `https://api2.isbndb.com`
- **Rate Limit:** 1 request/second

### Premium Plan
- **URL:** `https://api.premium.isbndb.com`
- **Rate Limit:** 3 requests/second

### Pro Plan
- **URL:** `https://api.pro.isbndb.com`
- **Rate Limit:** 5 requests/second

### Enterprise Plan
- **URL:** `https://api.enterprise.isbndb.com`
- **Rate Limit:** 10 requests/second

**Note:** Using a URL for a plan you're not subscribed to will result in access denied.

## Main Endpoints

### Get Book by ISBN
```
GET /book/{isbn}
```
Returns detailed information for a specific book.

**Example:**
```
GET https://api2.isbndb.com/book/9780134093413
Headers:
  Authorization: YOUR_REST_KEY
```

### Search Books
```
GET /books/{query}
```
Search endpoints available:
- Title search
- Author search  
- Keyword search

### Bulk Data (Premium+ Plans)
Retrieve up to 1000 results with a single call (Premium, Pro, Enterprise plans only).

## Response Codes

### Success
- **200 OK:** Request successful

### Error Responses
- **404 Not Found:** 
  - Book not in database
  - Invalid endpoint
  - Response: `{"errorMessage": "Not Found"}`

- **429 Too Many Requests:**
  - Rate limit exceeded
  - Response: `{"message": "Limit Exceeded"}`

- **403 Forbidden:**
  - Invalid API key
  - Unauthorized access

## Subscription Plans

### Basic Plan
- **Cost:** $10/month
- **Rate Limit:** 1 request/second
- **Features:** 7-day free trial for new subscribers

### Premium Plan
- **Cost:** ~$50/month
- **Rate Limit:** 3 requests/second
- **Features:** Bulk data access, no trial

### Pro Plan
- **Cost:** ~$100/month
- **Rate Limit:** 5 requests/second
- **Features:** Price information, bulk data access, no trial

### Enterprise Plan
- **Cost:** ~$300/month
- **Rate Limit:** 10 requests/second
- **Features:** Full database capacity, no trial

## Data Points Available
ISBNdb provides up to 19 data points including:
- Title
- Author(s)
- Publisher
- Publish date
- Binding/format
- Number of pages
- Language
- Dimensions
- Edition
- Price information (Pro+ plans)
- Cover images

## Testing Your API Key

1. Visit: https://isbndb.com/apidocs/v2
2. Click "Authorize" button
3. Enter your API key
4. Select a GET endpoint and click "Try it out"
5. Verify response

## Important Notes

- API keys are accessible in your user dashboard and welcome email
- Keys remain the same when switching plans
- If you exceed daily call limits, key stops working for remainder of 24-hour period
- Must maintain current subscription for key authorization
- Cancellation requires canceling both ISBNdb account AND PayPal recurring billing

## Documentation Links
- Official API Docs: https://isbndb.com/apidocs/v2
- Getting Started: https://isbndb.com/faq
- Pricing: https://isbndb.com/isbn-database
