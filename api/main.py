"""
Eburon AI ASR - FastAPI Backend
Speech-to-Text API powered by whisper.cpp
"""

import os
import subprocess
import tempfile
import uuid
import json
import asyncio
from pathlib import Path
from typing import Optional, List
from datetime import datetime

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

# Configuration
MODEL_DIR = os.getenv("MODEL_DIR", "./models")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "ggml-base.en.bin")
WHISPER_CLI = os.getenv("WHISPER_CLI", "whisper-cli")
WHISPER_STREAM = os.getenv("WHISPER_STREAM", "whisper-stream")
FFMPEG = os.getenv("FFMPEG", "ffmpeg")

# Ensure directories exist
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory storage (use database in production)
transcriptions_db = {}

app = FastAPI(
    title="Eburon AI ASR",
    description="Speech-to-Text API powered by whisper.cpp",
    version="1.0.0",
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Models
class TranscriptionRequest(BaseModel):
    language: str = "en"
    model: str = DEFAULT_MODEL
    translate: bool = False


class TranscriptionResponse(BaseModel):
    id: str
    text: str
    segments: List[dict]
    language: str
    model: str
    duration: float
    created_at: str


class HealthResponse(BaseModel):
    status: str
    models: List[str]
    timestamp: str


# Helper functions
def generate_id():
    return str(uuid.uuid4())


def get_models():
    """Get list of available models"""
    models = []
    if os.path.exists(MODEL_DIR):
        for f in os.listdir(MODEL_DIR):
            if f.endswith(".bin"):
                models.append(f)
    return sorted(models)


def convert_to_wav(input_path: str, output_path: str) -> bool:
    """Convert audio to WAV format using ffmpeg"""
    try:
        cmd = [
            FFMPEG,
            "-i",
            input_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            output_path,
            "-y",
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg error: {e}")
        return False


def run_whisper(
    audio_path: str, model_path: str, language: str = "en", translate: bool = False
):
    """Run whisper-cli and return results"""
    output_base = os.path.join(UPLOAD_DIR, f"output_{generate_id()}")

    cmd = [
        WHISPER_CLI,
        "-m",
        model_path,
        "-f",
        audio_path,
        "-l",
        language,
        "-oj",  # JSON output
        "-of",
        output_base,
    ]

    if translate:
        cmd.append("--translate")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        # Read JSON output
        json_path = output_base + ".json"
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                data = json.load(f)
            os.remove(json_path)
            return data
        return None
    except subprocess.CalledProcessError as e:
        print(f"Whisper error: {e.stderr}")
        return None


# Hallucination filter
HALLUCINATION_PATTERNS = [
    r"^thanks for watching",
    r"^thank you for watching",
    r"^please subscribe",
    r"^so today",
    r"^welcome to",
    r"^hello everyone",
    r"^\[",
    r"^♪",
    r"^singing",
    r"^music playing",
]

import re


def filter_hallucinations(text: str) -> bool:
    """Check if text is likely a hallucination"""
    if not text or len(text.strip()) < 4:
        return True

    text_lower = text.lower().strip()

    for pattern in HALLUCINATION_PATTERNS:
        if re.match(pattern, text_lower):
            return True

    # Filter music notation
    if re.match(r"^[♪♫♩♬\s]+$", text_lower):
        return True

    # Filter bracketed content
    if re.match(r"^\[.*\]$", text_lower):
        return True

    return False


def clean_transcription(data: dict) -> dict:
    """Clean transcription data and remove hallucinations"""
    if not data:
        return {"text": "", "segments": []}

    # Get transcription array
    transcription = data.get("transcription", [])

    cleaned_segments = []
    cleaned_text_parts = []

    for seg in transcription:
        text = seg.get("text", "").strip()

        if not filter_hallucinations(text):
            cleaned_segments.append(
                {
                    "start": seg.get("offsets", {}).get("from", 0) / 1000
                    if isinstance(seg.get("offsets"), dict)
                    else seg.get("t0", 0) / 1000,
                    "end": seg.get("offsets", {}).get("to", 0) / 1000
                    if isinstance(seg.get("offsets"), dict)
                    else seg.get("t1", 0) / 1000,
                    "text": text,
                }
            )
            cleaned_text_parts.append(text)

    return {"text": " ".join(cleaned_text_parts), "segments": cleaned_segments}


# API Endpoints
@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok", models=get_models(), timestamp=datetime.now().isoformat()
    )


@app.get("/api/models")
async def list_models():
    return get_models()


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Query(default="en"),
    model: str = Query(default=DEFAULT_MODEL),
    translate: bool = Query(default=False),
):
    """Transcribe an audio file"""
    # Validate model
    model_path = os.path.join(MODEL_DIR, model)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=400, detail=f"Model {model} not found")

    # Save uploaded file
    file_ext = Path(audio.filename).suffix if audio.filename else ".webm"
    input_path = os.path.join(UPLOAD_DIR, f"{generate_id()}{file_ext}")

    with open(input_path, "wb") as f:
        content = await audio.read()
        f.write(content)

    # Convert to WAV if needed
    wav_path = input_path.replace(file_ext, ".wav")
    if file_ext.lower() in [".webm", ".mp3", ".ogg", ".m4a"]:
        if not convert_to_wav(input_path, wav_path):
            os.remove(input_path)
            raise HTTPException(status_code=500, detail="Failed to convert audio")
        audio_path = wav_path
    else:
        audio_path = input_path

    # Get audio duration
    try:
        result = subprocess.run(
            [FFMPEG, "-i", audio_path, "-f", "null", "-"],
            capture_output=True,
            text=True,
        )
        duration_match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", result.stderr)
        if duration_match:
            hours, minutes, seconds = duration_match.groups()
            duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        else:
            duration = 0
    except:
        duration = 0

    # Run whisper
    raw_result = run_whisper(audio_path, model_path, language, translate)

    # Clean up
    for path in [input_path, wav_path]:
        if os.path.exists(path):
            os.remove(path)

    if not raw_result:
        raise HTTPException(status_code=500, detail="Transcription failed")

    # Clean and process results
    cleaned = clean_transcription(raw_result)

    # Create response
    transcription_id = generate_id()
    response = TranscriptionResponse(
        id=transcription_id,
        text=cleaned["text"],
        segments=cleaned["segments"],
        language=language,
        model=model,
        duration=duration,
        created_at=datetime.now().isoformat(),
    )

    # Store in memory
    transcriptions_db[transcription_id] = response.dict()

    return response


@app.get("/api/transcriptions")
async def list_transcriptions(limit: int = 50, offset: int = 0):
    """List all transcriptions"""
    items = list(transcriptions_db.values())
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[offset : offset + limit]


@app.get("/api/transcriptions/{transcription_id}")
async def get_transcription(transcription_id: str):
    """Get a specific transcription"""
    if transcription_id not in transcriptions_db:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return transcriptions_db[transcription_id]


@app.delete("/api/transcriptions/{transcription_id}")
async def delete_transcription(transcription_id: str):
    """Delete a transcription"""
    if transcription_id not in transcriptions_db:
        raise HTTPException(status_code=404, detail="Transcription not found")
    del transcriptions_db[transcription_id]
    return {"success": True}


@app.get("/api/search")
async def search_transcriptions(q: str = Query(...)):
    """Search transcriptions"""
    results = []
    query_lower = q.lower()
    for item in transcriptions_db.values():
        if query_lower in item.get("text", "").lower():
            results.append(item)
    return results[:20]


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3002)
