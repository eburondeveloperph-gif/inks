# Eburon AI ASR

<div align="center">

![Eburon AI ASR](https://img.shields.io/badge/Eburon%20AI-ASR-8b5cf6?style=for-the-badge&logo=voice&logoColor=white)
![eburon.ai](https://img.shields.io/badge/eburon.ai-powered-10b981?style=for-the-badge)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109.0-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)

**AI-powered Speech-to-Text application with real-time transcription**

[Documentation](./docs/README.md) • [API Reference](./docs/API.md) • [Deployment Guide](./docs/DEPLOYMENT.md)

</div>

---

## Features

| Feature | Description |
|---------|-------------|
| **Real-time Streaming** | Live transcription with subtitle-style animation |
| **Multi-language** | Supports 100+ languages via whisper models |
| **Voice Activity Detection** | Filters silence and background noise |
| **Echo Cancellation** | Prevents speaker audio feedback |
| **Local Processing** | All processing on your server (privacy-first) |
| **Export Options** | Download as TXT, SRT, or JSON |
| **History** | Save and manage transcription history |
| **Docker Ready** | One-command deployment |

## Quick Start

```bash
# Clone and deploy
git clone https://github.com/eburondeveloperph-gif/inks.git
cd inks
./deploy.sh
```

**That's it!** The app will be running at:
- Frontend: http://localhost:8080
- API Docs: http://localhost:3002/docs

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./docs/GETTING-STARTED.md) | Installation and setup guide |
| [API Reference](./docs/API.md) | Complete API documentation |
| [Deployment Guide](./docs/DEPLOYMENT.md) | Deploy to Vercel, Railway, Docker |
| [Configuration](./docs/CONFIGURATION.md) | All configuration options |
| [Models Guide](./docs/MODELS.md) | Downloading and using models |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common issues and solutions |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Browser   │  │   Mobile    │  │   Desktop App       │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │              │
└─────────┼────────────────┼────────────────────┼──────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│                    NGINX (Port 8080)                         │
│                    Reverse Proxy + Static                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────────┐
│      FRONTEND       │         │        BACKEND          │
│   React + Vite      │         │       FastAPI           │
│                     │         │       Port 3002         │
│   • Recording UI    │         │                         │
│   • Streaming       │────────▶│   • /api/transcribe     │
│   • History         │   API   │   • /api/stream         │
│   • Export          │         │   • /api/transcriptions │
└─────────────────────┘         └────────────┬────────────┘
                                             │
                                             ▼
                                   ┌─────────────────────┐
                                   │     eburon.ai       │
                                   │                     │
                                   │  • whisper-cli      │
                                   │  • whisper-stream   │
                                   │                     │
                                   │  Models:            │
                                   │  • ink-v1           │
                                   │  • ink-vfast        │
                                   │  • + 100 languages  │
                                   └─────────────────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │      SQLite         │
                                  │                     │
                                  │  • transcriptions   │
                                  │  • segments         │
                                  │  • projects         │
                                  └─────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend** | React | 18.x |
| **Build Tool** | Vite | 5.x |
| **Backend** | FastAPI | 0.109.x |
| **Runtime** | Python | 3.11+ |
| **STT Engine** | eburon.ai | latest |
| **Database** | SQLite | 3.x |
| **Web Server** | Nginx | Alpine |
| **Containers** | Docker | 24.x |

---

## API Overview

```bash
# Health check
curl http://localhost:3002/api/health

# List models
curl http://localhost:3002/api/models

# Transcribe audio
curl -X POST -F "audio=@audio.mp3" http://localhost:3002/api/transcribe

# List transcriptions
curl http://localhost:3002/api/transcriptions

# Search transcriptions
curl http://localhost:3002/api/search?q=hello
```

Full API docs: http://localhost:3002/docs (Swagger UI)

---

## Models

| Model | Size | Best For |
|-------|------|----------|
| `tiny.en` | 75 MB | Real-time, low resources |
| `base.en` | 142 MB | Balanced (default) |
| `small.en` | 466 MB | Better accuracy |
| `medium.en` | 1.5 GB | High accuracy |
| `large-v3` | 3.1 GB | Maximum accuracy |

---

## Deployment Options

| Platform | Complexity | Cost | Best For |
|----------|------------|------|----------|
| **Docker** | Easy | Free | Self-hosted |
| **Railway** | Easy | $5+/mo | Quick deploy |
| **Fly.io** | Medium | Free tier | Global |
| **VPS** | Medium | $5+/mo | Full control |
| **Vercel** | Easy | Free | Frontend only |

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

## License

MIT License - see [LICENSE](./LICENSE)

## Support

- **Docs**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/eburondeveloperph-gif/inks/issues)
- **API Docs**: http://localhost:3002/docs

---

<div align="center">
Made with ❤️ by <a href="https://github.com/eburondeveloperph-gif">Eburon Developer</a>
</div>