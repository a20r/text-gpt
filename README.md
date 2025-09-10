# text-gpt

SMS-only relay to ChatGPT. Accepts inbound SMS via Twilio, maintains per-user chat context in Redis, and replies with OpenAI Chat Completions.

## Features
- Strict Twilio signature verification and MessageSid idempotency
- STOP/START opt-out commands
- `/new` resets conversation context
- Per-user chat history persisted in Redis (in-memory fallback for dev)
- Long replies split into GSM-7/UCS-2 SMS segments with link fallback
- Rate limiting and basic health check endpoint
- Structured JSON logging with pino

## Requirements
- Node.js 20+
- npm
- Redis server (production)
- Twilio account with SMS-capable number
- OpenAI API key

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Port for HTTP server |
| `PUBLIC_BASE_URL` | _none_ | Base URL used for Twilio signature verification and long reply links |
| `OPENAI_API_KEY` | _required_ | OpenAI API key |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Model sent to Chat Completions |
| `OPENAI_TEMPERATURE` | `0.3` | Sampling temperature |
| `OPENAI_MAX_TOKENS` | `1024` | Max tokens for assistant reply |
| `CONTEXT_MAX_TURNS` | `24` | Number of recent user/assistant turns kept in context |
| `REPLY_MAX_SEGMENTS` | `6` | Max SMS segments before truncation/link fallback |
| `REDIS_URL` | _none_ | Redis connection string; if omitted an in-memory store is used (not for prod) |
| `TWILIO_AUTH_TOKEN` | _required_ | Token for validating Twilio signatures |
| `TWILIO_ACCOUNT_SID` | _optional_ | Twilio account SID for REST calls (if needed) |
| `RATE_LIMIT_RPS_PER_USER` | `0.5` | Per-user rate limit in requests/second |
| `REQUEST_TIMEOUT_MS` | `30000` | Timeout for OpenAI requests |

## Run Locally

Install dependencies and start in dev mode:

```bash
npm install
PUBLIC_BASE_URL=https://your.ngrok.io \
OPENAI_API_KEY=sk-... \
TWILIO_AUTH_TOKEN=... \
npm run dev
```

If `REDIS_URL` is unset the server logs a warning and uses an in-memory store.
Expose `/twilio/inbound-sms` publicly (e.g. via ngrok) and configure your Twilio number's
Messaging webhook to POST to that URL. `PUBLIC_BASE_URL` must exactly match the webhook URL.

### Run with Docker

```bash
docker build -t text-gpt .
PUBLIC_BASE_URL=https://your.ngrok.io \
OPENAI_API_KEY=sk-... \
TWILIO_AUTH_TOKEN=... \
docker run -p 8080:8080 \
  -e PUBLIC_BASE_URL -e OPENAI_API_KEY -e TWILIO_AUTH_TOKEN \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  text-gpt
```

Or use the included compose file (starts a Redis container automatically):

```bash
PUBLIC_BASE_URL=https://your.ngrok.io \
OPENAI_API_KEY=sk-... \
TWILIO_AUTH_TOKEN=... \
docker compose up --build
```

## Testing & Building

```bash
npm test      # run Vitest suite
npm run build # compile TypeScript
npm start     # run compiled server
```

## Project Structure

```
src/
  adapters/   # Twilio, OpenAI, Redis adapters
  core/       # chat and command logic
  routes/     # Fastify route handlers
  util/       # logging, ULID helpers
test/         # vitest tests
```

## Production Notes
- Service is stateless; Redis holds all chat and idempotency data
- Long replies exceeding segment limit are hosted temporarily and returned as short links
- Only SMS text is supported; MMS/media messages are rejected
