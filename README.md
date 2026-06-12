# IPTV Watch Party

IPTV Watch Party is a real-time synchronized streaming and social theater platform. It is a full-stack Node.js, Express, Socket.IO, and React application designed to allow users to watch live IPTV/HLS streams companion-style, chat with automated translation, create watch lobbies, and manage channels on-the-fly inside an intuitive dashboard.

---

## Key Features

- 📺 **IPTV & Live HLS Swapper**: Browse and watch live catalog feeds (`.m3u8`, `.mp4`) directly inside an advanced HLS player featuring adaptive quality control.
- 👥 **Synchronized Party Rooms**: Create group watch theaters where the host enjoys synchronous playback controls (Play, Pause, Progress, and Channel changes) and viewers remain perfectly in-time with one another.
- 💬 **Live Chat with Expiring TTL Logs**: Real-time communication powered by **Socket.IO** utilizing a lightweight, ephemeral state sweeper that recycles server RAM safely.
- 🎨 **Responsive Device Neutral Layout**: Implements high-contrast, beautiful mobile-first layouts designed to scale elegantly from small touchscreens (smartphones, tablets) to ultra-wide desktop monitors.
- 🎛️ **Directory & Catalog Management**: Administrators can upload bulk channels through M3U playlist uploads, manage classification categories, rename streams, or clear catalog maps instantly.
- 🚫 **Ad-Free UI Discipline**: Employs completely clean workspace metrics — free from tracking pixels, promotional clutter, or telemetry widgets.

---

## Tech Stack Overview

- **Frontend Core**: [React (TypeScript)](https://react.dev/), [Vite](https://vite.dev/) (Build pipeline)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **State & Communication**: [Socket.IO Client](https://socket.io/docs/v4/client-api/), [React Router](https://reactrouter.com/)
- **Backend Application**: [Node.js](https://nodejs.org/), [Express.js](https://expressjs.com/), [Socket.IO Server](https://socket.io/)
- **Bundler Compiler**: [esbuild](https://esbuild.github.io/) (for building highly fast, single-destination backend bundles)

---

## Directory Architecture

```
├── .env.example             # Configuration variables blueprint
├── package.json             # Build pipeline scripts and package definitions
├── server.ts                # Entry point full-stack server
├── src/                     # Client application code
│   ├── main.tsx             # React SPA mounting bootstrap
│   ├── App.tsx              # Routing and primary component registry
│   ├── components/          # Reusable React UI layouts (StreamPlayer, Chat)
│   ├── pages/               # Functional routes (StreamsPage, RoomPage, AdminPage)
│   └── index.css            # Tailwind global imports
└── tsconfig.json            # TypeScript configuration
```

---

## Prerequisites

Ensure you have the following installed on your machine before commencing configuration:
- **Node.js**: `v18.x` or superior (LTS recommended)
- **npm**: `v9.x` or superior

---

## Local Setup & Configuration

**1. Clone or Extract the Codebase**
Navigate to your target workspace folder and extract the zip file, or clone the project files.

```bash
cd iptv-watch-party
```

**2. Install Core Dependencies**
Execute standard installation to populate all client-side and server-side package scripts:

```bash
npm install
```

**3. Set Up Environment Variables**
Copy the boilerplate configure template to an active environment instance:

```bash
cp .env.example .env
```

Open `.env` in your text editor and supply the required values:

```env
# GEMINI_API_KEY: Required for Smart AI translation options
GEMINI_API_KEY="your_actual_gemini_api_key"

# APP_URL: The public address where this instance is run (local fallback default: http://localhost:3000)
APP_URL="http://localhost:3000"
```

---

## Development Execution

To start the local developer server utilizing hot module reloading for the frontend code, run:

```bash
npm run dev
```

The server binds immediately to:
- **Local Link**: `http://localhost:3000`

---

## Building and Compiling for Production

To assemble the production application, compilation operates in two steps bundled within a single command:
1. Compiles the front-end SPA assets into optimized static build outputs situated inside `/dist`.
2. Packages the backend `server.ts` into a compressed, fast CommonJS runtime file (`dist/server.cjs`) using `esbuild`.

To do this, execute:

```bash
npm run build
```

This ensures clean ES module absolute path resolution and avoids unnecessary cold-starts during server setups.

---

## Production Execution

Once compiling completes, you can launch the live production service:

```bash
npm run start
```

Your server is now active, serving client static files and handling active WebSockets from:
- `http://0.0.0.0:3000`

---

## Hosting and Deployment Guide

### Option 1: Docker / Container Deployment (Recommended)

Because the app combines static file delivery with persistent active WebSocket connections, standard lightweight container services like **Google Cloud Run**, **Railway**, **Render**, or **CapRover** provide optimal performance metrics.

Create a `Dockerfile` at the root directory of this project:

```dockerfile
# Use a slim Node.js LTS base image
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install development packages
RUN npm ci

# Copy remainder code
COPY . .

# Compile optimized build targets
RUN npm run build

# Use single stage slim production image to save resources
FROM node:20-slim

WORKDIR /app

# Set target variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy necessary files from compilation phase
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Install production dependencies only to reduce container size
RUN npm ci --only=production

EXPOSE 3000

# Start server node
CMD ["npm", "run", "start"]
```

Build and run your container locally:

```bash
docker build -t iptv-watch-party .
docker run -p 3000:3000 --env-file .env iptv-watch-party
```

### Option 2: Deploying to Google Cloud Run

Google Cloud Run is an exceptionally clean option for full-stack Node container setups. Ensure you enable session affinity for optimal Socket.IO connection polling:

1. **Build container via Google Artifact Registry**:
   ```bash
   gcloud builds submit --tag gcr.io/[PROJECT_ID]/iptv-watch-party
   ```

2. **Deploy Container into Cloud Run**:
   ```bash
   gcloud run deploy iptv-watch-party \
     --image gcr.io/[PROJECT_ID]/iptv-watch-party \
     --platform managed \
     --port 3000 \
     --allow-unauthenticated \
     --session-affinity
   ```

*(Note: enabling the `--session-affinity` flag is key to ensuring client machines stick to the same container instance for stable Socket.IO fallback handshakes.)*

### Option 3: Deploying on Render or Railway

For zero-overhead cloud hosting on Render or Railway:
1. **GitHub Sync**: Connect your repository to your Dashboard.
2. **Build Settings**:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
   - **Environment Variables**: Add `GEMINI_API_KEY` and your site's target `APP_URL`.
3. **Internal Port**: Set port mapping to `3000`.

---

## Data & Persistence Architecture

- **Channel Streams Database State**: Streams are managed on the Node backend inside persistent map structures starting with a default cache of stable test feeds. Channel changes and bulk M3U installations exist in server application memory.
- **Lobby Sessions & Sweeper Cycles**: Room databases exist strictly in-memory. Group watch lobbies evaluate active spectator metrics. Empty, idle group rooms are cleanly recycled after 15 seconds of inactivity to protect memory bounds.
- **Message Room Logs Storage**: Group chat statements are maintained on-the-fly and automatically flushed via background cron sweeper routines once their Time-To-Live (TTL) logs expire.
