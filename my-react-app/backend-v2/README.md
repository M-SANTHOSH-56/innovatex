# Innovate X isolated backend v2

The React app's Vite development proxy now sends `/api` requests to this backend.

- URL: http://localhost:4001
- Health check: http://localhost:4001/api/health
- Data files: `backend-v2/data/users.json` and `backend-v2/data/cases.json`
- Start the connected app and backend from the project root: `npm run dev`
- To run only this backend: `node backend-v2/server.mjs`
- Demo admin: `admin@innovatex.demo` / `admin123`
- Demo worker: `team@innovatex.demo` / `team123`
- Demo requester: `requester@innovatex.demo` / `request123`

This backend uses its own files under `backend-v2/data/`. The original backend on port 4000 and its data remain untouched.

## Automatic issue category

The requester form does not ask for a category. On submission, the Node.js backend classifies the request title into Hardware, Software, Electrical, Network issue, Cleaning, Water, Account access, or Other. Department continues to come from the requester's saved account department. One worker in that same department is assigned each request using the lowest active workload, even when the worker's saved specialty differs from the AI-assigned category. Only that assignee can see and act on it; workers in other departments and unassigned workers cannot. If no worker exists in the requester's department, submission is blocked with an administrator-facing message.

The AI model is `MoritzLaurer/deberta-v3-base-zeroshot-v1.1-all-33` through Hugging Face's zero-shot classification API. To enable it, create `backend-v2/.env` from `.env.example`, add a Hugging Face token with Inference Providers permission, and restart the backend. Keep this token on the server; do not put it in React/Vite code. If the token is missing or the AI endpoint is unavailable, a local keyword fallback classifies the request and the activity log says that fallback was used. The model card describes this model as English-only, so Tamil request descriptions may be misclassified; use English issue details for this prototype or a multilingual model for Tamil-first production use.

Set `HF_ZERO_SHOT_URL` in `.env` to a dedicated Hugging Face Inference Endpoint URL if the serverless router does not currently serve this model. The backend health response reports which classification mode is configured.

