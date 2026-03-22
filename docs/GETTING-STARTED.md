# Getting Started

Quick start guide for Eburon AI ASR.

## Prerequisites

| Requirement | Version | Install |
|-------------|---------|---------|
| Docker | 20.x+ | [Get Docker](https://docs.docker.com/get-docker/) |
| Docker Compose | 2.x+ | Included with Docker Desktop |
| Git | 2.x+ | [Get Git](https://git-scm.com/) |

For local development:
- Node.js 18+ 
- Python 3.11+
- ffmpeg

---

## Installation

### Option 1: Docker (Recommended)

```bash
# Clone repository
git clone https://github.com/eburondeveloperph-gif/inks.git
cd inks

# Run deploy script (downloads models, builds, starts)
./deploy.sh
```

The deploy script will:
1. ✅ Check Docker installation
2. ✅ Download whisper models (~200MB)
3. ✅ Build Docker images
4. ✅ Start all services
5. ✅ Open browser when ready

### Option 2: Docker Compose

```bash
git clone https://github.com/eburondeveloperph-gif/inks.git
cd inks
docker-compose up -d
```

### Option 3: Manual Installation

<details>
<summary>Click for manual setup steps</summary>

#### 1. Install whisper.cpp

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release -j$(nproc)
sudo cp build/bin/whisper-cli /usr/local/bin/
sudo cp build/bin/whisper-stream /usr/local/bin/
```

#### 2. Download Models

```bash
mkdir -p models
curl -L -o models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

#### 3. Setup Backend

```bash
cd api
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 3002
```

#### 4. Setup Frontend

```bash
cd frontend
npm install
npm run dev
```

</details>

---

## Quick Test

After installation, verify everything works:

```bash
# Check backend health
curl http://localhost:3002/api/health

# Expected response:
# {"status":"ok","models":["ggml-base.en.bin"],"timestamp":"..."}
```

Open your browser:
- **App**: http://localhost:8080
- **API Docs**: http://localhost:3002/docs

---

## First Transcription

### Via Web UI

1. Open http://localhost:8080
2. Click the microphone button
3. Speak or upload an audio file
4. Click "Transcribe"
5. View and export results

### Via API

```bash
# Record audio (or use existing file)
# Then:

curl -X POST \
  -F "audio=@my-audio.mp3" \
  -F "language=en" \
  http://localhost:3002/api/transcribe | jq '.text'
```

### Via Streaming

```javascript
// Connect to streaming endpoint
const eventSource = new EventSource(
  'http://localhost:3002/api/stream?language=en'
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'transcription') {
    console.log(data.text);
  }
};
```

---

## Configuration

### Environment Variables

Create `.env` file:

```bash
# Backend
MODEL_DIR=./models
UPLOAD_DIR=./uploads
DEFAULT_MODEL=ggml-base.en.bin

# Frontend (frontend/.env)
VITE_API_URL=http://localhost:3002
```

### Docker Compose Override

Create `docker-compose.override.yml`:

```yaml
version: '3.8'
services:
  backend:
    environment:
      - DEFAULT_MODEL=ggml-small.en.bin
    volumes:
      - ./custom-models:/app/models
```

---

## Adding Models

Download additional models:

```bash
# Navigate to models directory
cd models

# Tiny (fastest, 75MB)
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin

# Small (better, 466MB)
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin

# Medium (best, 1.5GB)
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin

# Multilingual models
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

---

## Common Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild after changes
docker-compose up -d --build

# Check status
docker-compose ps

# Restart backend only
docker-compose restart backend
```

---

## Project Structure

```
inks/
├── api/                    # FastAPI backend
│   ├── main.py            # API server
│   └── requirements.txt   # Dependencies
├── frontend/              # React frontend
│   ├── src/
│   │   ├── App.jsx       # Main component
│   │   └── App.css       # Styles
│   └── package.json
├── db/                     # Database
├── models/                 # Whisper models
├── uploads/               # Temp files
├── data/                  # SQLite database
├── docs/                  # Documentation
├── docker-compose.yml
├── deploy.sh
└── README.md
```

---

## Next Steps

- [API Reference](./API.md) - Complete API docs
- [Deployment Guide](./DEPLOYMENT.md) - Deploy to production
- [Models Guide](./MODELS.md) - Download and manage models
- [Configuration](./CONFIGURATION.md) - All options

---

## Getting Help

1. Check [Troubleshooting](./TROUBLESHOOTING.md)
2. Search [GitHub Issues](https://github.com/eburondeveloperph-gif/inks/issues)
3. Check API docs at http://localhost:3002/docs