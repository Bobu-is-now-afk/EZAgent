# Judge demo Gemini adapter

The static judge site stays in `demo/`. The API accepts only allowlisted fixture IDs; each prompt and synthetic sentence lives on the server. The browser sends only those IDs and disables free-form input. Chat and Agent are text/suggestion only. The document endpoint uses the exact synthetic batch visible on the page: orders W-01 and W-02 plus receipt R-01. Only W-01 enters the quotation; W-02 and R-01 are context, not processed into the total. The grounded suggestion is buyer `null` (not provided), description `workshop days`, quantity `2`; it does not determine price, amount, tax, payment status, or approval. Values outside W-01's stated facts are normalized to `null`.

## Routes

| Route | Request | Successful response |
| --- | --- | --- |
| `POST /api/chat` | `{ "fixtureId": "study_schedule" | "cache_comparison" | "launch_checklist" }` | `{ "status": "live", "source": "gemini", "model": "gemini-2.5-flash", "answer": "..." }` |
| `POST /api/agent-suggest` | `{ "fixtureId": "synthetic_document_task", "template"?: "documents" | "review" | "other" }` | `{ "status": "live", "source": "gemini", "model": "gemini-2.5-flash", "roles": [...], "proposedSteps": [...], "missing": [...] }` |
| `POST /api/document-suggest` | `{ "fixtureId": "workshop_quote" }` | `{ "status": "live", "source": "gemini", "model": "gemini-2.5-flash", "suggestion": { "buyer": null, "description": "workshop days", "quantity": 2, "missing": ["buyer"] } }` |
| `GET /api/status` | none | `{ "configured": true, "connectivity": "not_checked", "source": "gemini", "model": "gemini-2.5-flash" }` when a key is configured; otherwise `configured: false` |

Requests reject unknown keys, free-form text, unsupported fixtures, invalid JSON/UTF-8, and bodies over 4 KiB. Fixture prompts are at most 1,200 characters. Gemini output is limited to 512 tokens, one request per invocation, and a 30-second timeout. Failures return a non-2xx response with `{ "status": "error", "error": "..." }`; there is no automatic sample fallback. The browser must leave the result in an error state on failure.

## Environment

The only runtime environment variable is `GEMINI_API_KEY`. Read it only in the server function process. The model is fixed to the allowlisted `gemini-2.5-flash`; the browser cannot select a model, endpoint, or API key. The status route reports key configuration only, not provider connectivity. Do not add a public prefix or put key values in files, logs, responses, browser storage, or source control.

This branch does not create environment files, configure Vercel, or set a live key. For local unit tests, inject a fake `fetch` response; tests make no network calls and need no key.

## Vercel deployment boundary

Keep the Vercel Root Directory at `demo/`. The `.mjs` files in `demo/api/` map to the routes above in this no-framework project. The repository-root Next.js routes do not serve this static site. Vercel supports Node.js functions in the project `api/` directory; see [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js). The Gemini REST request uses the server-side API key header and `generateContent`; see [Gemini text generation](https://ai.google.dev/gemini-api/docs/text-generation).

The routes are anonymous. The in-memory 8-per-minute / 50-per-day limiter is only a per-warm-instance abuse brake; serverless instances do not share it, so it is not a reliable spend cap. Keep `GEMINI_API_KEY` unset on the public deployment until site-level access or shared rate limiting and provider-side quota controls are approved and configured. The page's setup sequence remains a simulation.

## Tests

Run with Node.js:

```sh
node --test tests/demo/gemini.test.mjs
```

The tests cover fixture allowlists, output bounds, provider failures, and server-owned synthetic data with injected fake fetch responses.
