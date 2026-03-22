# Deployment Guide

Deploy Eburon AI ASR to production.

## Deployment Options

| Platform | Type | Difficulty | Cost |
|----------|------|------------|------|
| **Docker VPS** | Self-hosted | Easy | $5-20/mo |
| **Railway** | PaaS | Easy | $5+/mo |
| **Fly.io** | Containers | Medium | Free tier |
| **Render** | PaaS | Easy | Free tier |
| **Vercel + Railway** | Split | Easy | Free tier |

---

## Option 1: Docker VPS (Recommended)

### Requirements
- VPS with 2GB+ RAM (4GB+ recommended)
- Ubuntu 20.04+ or similar

### Steps

```bash
# 1. Connect to your VPS
ssh user@your-server.com

# 2. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 3. Clone repository
git clone https://github.com/eburondeveloperph-gif/inks.git
cd inks

# 4. Deploy
./deploy.sh
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renew
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

---

## Option 2: Railway

### Backend

1. Create Railway account: https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select repository
4. Set build command: `pip install -r api/requirements.txt`
5. Set start command: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables:
   - `MODEL_DIR=/app/models`
   - `DEFAULT_MODEL=ggml-base.en.bin`

### Frontend

1. Deploy frontend separately to Vercel or Railway
2. Set `VITE_API_URL` to your Railway backend URL

---

## Option 3: Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch
fly launch

# Deploy
fly deploy
```

Create `fly.toml`:
```toml
app = "eburon-ai-asr"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile.backend"

[http_service]
  internal_port = 3002
  force_https = true

[[mounts]]
  source = "models"
  destination = "/app/models"
```

---

## Option 4: Render

1. Create Render account: https://render.com
2. Click "New" → "Web Service"
3. Connect GitHub repo
4. Configure:
   - **Build Command**: `pip install -r api/requirements.txt`
   - **Start Command**: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
   - **Environment**: Python 3.11

---

## Option 5: Vercel (Frontend) + Railway (Backend)

### Frontend to Vercel

1. Import repo to Vercel
2. Settings:
   - **Framework**: Vite
   - **Build Command**: `cd frontend && npm run build`
   - **Output Directory**: `frontend/dist`
3. Add environment variable:
   - `VITE_API_URL=https://your-backend.railway.app`

### Backend to Railway

Follow Railway steps above.

---

## Production Checklist

- [ ] Set proper CORS origins (not `*`)
- [ ] Enable authentication
- [ ] Set up SSL/TLS
- [ ] Configure reverse proxy
- [ ] Set up monitoring
- [ ] Configure backups
- [ ] Set rate limits
- [ ] Use PostgreSQL instead of SQLite

---

## Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # Frontend
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
    
    # Backend API
    location /api/ {
        proxy_pass http://localhost:3002/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
    
    # SSE streaming
    location /api/stream {
        proxy_pass http://localhost:3002/api/stream;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}