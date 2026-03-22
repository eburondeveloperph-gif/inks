# Eburon AI ASR

Speech-to-Text application powered by whisper.cpp

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend       │
│   (React/Vite)  │     │   (FastAPI)     │
│   Port 8080     │     │   Port 3002     │
└─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  whisper.cpp    │
                        │  (C++ binaries) │
                        └─────────────────┘
```

## Quick Start with Docker

```bash
# Clone the repository
git clone https://github.com/eburondeveloperph-gif/inks.git
cd inks

# Start all services
docker-compose up -d

# Access the app
# Frontend: http://localhost:8080
# Backend API: http://localhost:3002
```

## Deployment Options

### Option 1: Docker (Recommended)
Deploy both frontend and backend together.

```bash
docker-compose up -d
```

### Option 2: Vercel (Frontend only) + Railway (Backend)

**Frontend to Vercel:**
1. Connect GitHub repo to Vercel
2. Set build command: `cd frontend && npm run build`
3. Set output directory: `frontend/dist`
4. Update `frontend/vercel.json` with your backend URL

**Backend to Railway/Render/Fly.io:**
1. Use the `Dockerfile.backend`
2. Set environment variables:
   - `MODEL_DIR=/app/models`
   - `UPLOAD_DIR=/app/uploads`
3. Download models on first deploy

### Option 3: Self-hosted VPS

```bash
# Install Docker and docker-compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone and start
git clone https://github.com/eburondeveloperph-gif/inks.git
cd inks
docker-compose up -d

# Setup nginx reverse proxy (optional)
sudo apt install nginx
sudo cp nginx.conf /etc/nginx/sites-available/eburon
sudo ln -s /etc/nginx/sites-available/eburon /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_DIR` | `./models` | Directory for whisper models |
| `UPLOAD_DIR` | `./uploads` | Directory for temp uploads |
| `DEFAULT_MODEL` | `ggml-base.en.bin` | Default model to use |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/models` | List available models |
| POST | `/api/transcribe` | Transcribe audio file |
| GET | `/api/transcriptions` | List all transcriptions |
| GET | `/api/transcriptions/:id` | Get specific transcription |
| DELETE | `/api/transcriptions/:id` | Delete transcription |
| GET | `/api/search?q=` | Search transcriptions |

## Adding Models

Place model files in the `models/` directory:

```bash
# Tiny (fastest)
wget -O models/ggml-tiny.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin

# Base (default)
wget -O models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# Small (better)
wget -O models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin

# Medium (best)
wget -O models/ggml-medium.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin
```

## Tech Stack

- **Frontend:** React, Vite, CSS
- **Backend:** FastAPI (Python)
- **STT Engine:** whisper.cpp
- **Database:** SQLite (local) / PostgreSQL (production)
- **Containerization:** Docker