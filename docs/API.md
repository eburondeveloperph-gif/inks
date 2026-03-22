# API Reference

Complete API documentation for Eburon AI ASR.

## Base URL

```
http://localhost:3002
```

## Interactive Docs

- **Swagger UI**: http://localhost:3002/docs
- **ReDoc**: http://localhost:3002/redoc

---

## Authentication

Currently no authentication required (add for production).

---

## Endpoints

### Health Check

#### `GET /api/health`

Check if the API is running and healthy.

**Response:**
```json
{
  "status": "ok",
  "models": ["ggml-base.en.bin", "ggml-tiny.en.bin"],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Status Codes:**
- `200 OK` - Service is healthy
- `503 Service Unavailable` - Service is down

---

### Models

#### `GET /api/models`

List all available whisper models in the models directory.

**Response:**
```json
["ggml-base.en.bin", "ggml-tiny.en.bin", "ggml-small.en.bin"]
```

**Example:**
```bash
curl http://localhost:3002/api/models
```

---

### Transcription

#### `POST /api/transcribe`

Transcribe an audio file to text.

**Request Body:** `multipart/form-data`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `audio` | file | Yes | - | Audio file (mp3, wav, webm, ogg, flac) |
| `language` | string | No | `"en"` | Language code (ISO 639-1) |
| `model` | string | No | `"ggml-base.en.bin"` | Model filename |
| `translate` | boolean | No | `false` | Translate to English |

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello, this is a test transcription.",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Hello, this is a test."
    },
    {
      "start": 2.5,
      "end": 4.2,
      "text": " This is a transcription."
    }
  ],
  "language": "en",
  "model": "ggml-base.en.bin",
  "duration": 4.2,
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

**Example:**
```bash
# Basic transcription
curl -X POST \
  -F "audio=@audio.mp3" \
  http://localhost:3002/api/transcribe

# With options
curl -X POST \
  -F "audio=@audio.mp3" \
  -F "language=es" \
  -F "model=ggml-small.en.bin" \
  http://localhost:3002/api/transcribe
```

**Status Codes:**
- `200 OK` - Transcription successful
- `400 Bad Request` - Invalid request (missing audio, invalid model)
- `500 Internal Server Error` - Transcription failed

---

### Streaming (Real-time)

#### `GET /api/stream`

Real-time transcription using Server-Sent Events (SSE).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | `"ggml-base.en.bin"` | Model to use |
| `language` | string | `"en"` | Language code |

**Response:** Server-Sent Events stream

```javascript
// Event types:
// - transcription: New transcribed text
// - status: Status updates
// - error: Error messages
// - end: Stream ended

// Example event:
data: {"type":"transcription","text":"Hello world","timestamp":"2024-01-15T10:30:00.000Z"}
```

**Example (JavaScript):**
```javascript
const eventSource = new EventSource(
  'http://localhost:3002/api/stream?model=ggml-base.en.bin&language=en'
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.text);
};

eventSource.onerror = (error) => {
  console.error('Stream error:', error);
};
```

**Example (curl):**
```bash
curl -N http://localhost:3002/api/stream
```

#### `POST /api/stream/stop`

Stop an active streaming session.

**Response:**
```json
{"status": "stopped"}
```

---

### Transcriptions (History)

#### `GET /api/transcriptions`

Get all saved transcriptions with pagination.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `50` | Number of results |
| `offset` | integer | `0` | Pagination offset |

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Meeting notes",
    "full_text": "Complete transcription text...",
    "language": "en",
    "model": "ggml-base.en.bin",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
]
```

**Example:**
```bash
# Get first 10
curl "http://localhost:3002/api/transcriptions?limit=10"

# Paginate
curl "http://localhost:3002/api/transcriptions?limit=20&offset=20"
```

---

#### `GET /api/transcriptions/:id`

Get a specific transcription with all segments.

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Meeting notes",
  "full_text": "Complete transcription text...",
  "language": "en",
  "model": "ggml-base.en.bin",
  "segments": [
    {
      "id": "seg-001",
      "segment_index": 0,
      "start_time": 0.0,
      "end_time": 2.5,
      "text": "First segment text"
    }
  ],
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

**Example:**
```bash
curl http://localhost:3002/api/transcriptions/550e8400-e29b-41d4-a716-446655440000
```

**Status Codes:**
- `200 OK` - Found
- `404 Not Found` - Transcription not found

---

#### `DELETE /api/transcriptions/:id`

Delete a transcription and its segments.

**Response:**
```json
{"success": true}
```

**Example:**
```bash
curl -X DELETE http://localhost:3002/api/transcriptions/550e8400-e29b-41d4-a716-446655440000
```

**Status Codes:**
- `200 OK` - Deleted
- `404 Not Found` - Transcription not found

---

#### `PATCH /api/transcriptions/:id`

Update a transcription.

**Request Body:**
```json
{
  "title": "Updated title",
  "fullText": "Updated text"
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Updated title",
  "fullText": "Updated text",
  "updated_at": "2024-01-15T10:35:00.000Z"
}
```

---

### Search

#### `GET /api/search`

Search transcriptions by text content.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Meeting about project",
    "full_text": "We discussed the project timeline...",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
]
```

**Example:**
```bash
curl "http://localhost:3002/api/search?q=project"
```

---

### Projects

#### `GET /api/projects`

Get all projects.

**Response:**
```json
[
  {
    "id": "proj-001",
    "name": "Meeting Notes",
    "description": "All meeting transcriptions",
    "created_at": "2024-01-15T10:00:00.000Z"
  }
]
```

---

#### `POST /api/projects`

Create a new project.

**Request Body:**
```json
{
  "name": "Project Name",
  "description": "Optional description"
}
```

**Response:**
```json
{
  "id": "proj-002",
  "name": "Project Name",
  "description": "Optional description",
  "created_at": "2024-01-15T11:00:00.000Z"
}
```

---

### Database Stats

#### `GET /api/db/stats`

Get database statistics.

**Response:**
```json
{
  "users": 0,
  "projects": 2,
  "transcriptions": 15,
  "segments": 248
}
```

---

## Error Responses

All errors return JSON:

```json
{
  "error": "Error message",
  "details": "Detailed error description"
}
```

Common HTTP status codes:
- `400` - Bad request
- `404` - Not found
- `500` - Server error

---

## Audio File Formats

| Format | Supported | Notes |
|--------|-----------|-------|
| MP3 | ✅ | Recommended |
| WAV | ✅ | Lossless |
| WebM | ✅ | Browser recording |
| OGG | ✅ | Vorbis codec |
| FLAC | ✅ | Lossless compressed |
| M4A | ✅ | AAC codec |

Max file size: 100MB (configurable)

---

## Rate Limiting

Currently no rate limiting. Add for production:

```python
# In FastAPI
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)
```

---

## WebSocket Events (Future)

Coming soon for real-time bidirectional communication:

```javascript
const ws = new WebSocket('ws://localhost:3002/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};

ws.send(JSON.stringify({
  type: 'start',
  language: 'en',
  model: 'ggml-base.en.bin'
}));
```

---

## SDKs & Client Libraries

### JavaScript/TypeScript
```javascript
// Using fetch
const transcribe = async (audioFile) => {
  const formData = new FormData();
  formData.append('audio', audioFile);
  
  const response = await fetch('http://localhost:3002/api/transcribe', {
    method: 'POST',
    body: formData
  });
  
  return response.json();
};
```

### Python
```python
import requests

def transcribe(audio_path, language='en'):
    with open(audio_path, 'rb') as f:
        files = {'audio': f}
        data = {'language': language}
        response = requests.post(
            'http://localhost:3002/api/transcribe',
            files=files,
            data=data
        )
    return response.json()
```

### cURL
```bash
#!/bin/bash
# transcribe.sh

audio_file=$1
language=${2:-en}

curl -X POST \
  -F "audio=@$audio_file" \
  -F "language=$language" \
  http://localhost:3002/api/transcribe | jq
```

---

## Changelog

### v1.0.0 (2024-01-15)
- Initial release
- Basic transcription
- Real-time streaming
- History management
- Docker deployment