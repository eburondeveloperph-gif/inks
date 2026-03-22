"""
Eburon AI ASR - FastAPI Backend
Speech-to-Text API powered by eburon.ai
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
    description="Speech-to-Text API powered by eburon.ai",
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


def preprocess_audio(input_path: str, output_path: str) -> bool:
    """
    Preprocess audio with noise reduction and normalization for better transcription.
    Applies high-pass filter, low-pass filter, normalization, and noise reduction.
    """
    try:
        cmd = [
            FFMPEG,
            "-i",
            input_path,
            # High-pass filter: remove below 80Hz (rumble, handling noise)
            "-af",
            "highpass=f=80,"
            # Low-pass filter: remove above 8000Hz (not needed for speech)
            "lowpass=f=8000,"
            # Normalize audio levels
            "loudnorm=I=-16:TP=-1.5:LRA=11,"
            # Noise reduction using afftdn (FFT-based denoiser)
            "afftdn=nf=-25,"
            # Compressor to even out volume
            "compand=attacks=0.3:decays=0.8:points=-80/-80|-45/-45|-27/-25|-20/-20|0/-3:gain=3",
            # Output settings
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            "-y",
            output_path,
        ]
        subprocess.run(cmd, capture_output=True, check=True, timeout=60)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Audio preprocessing error: {e}")
        # Fallback to simple conversion
        return convert_to_wav(input_path, output_path)
    except subprocess.TimeoutExpired:
        print("Audio preprocessing timeout")
        return convert_to_wav(input_path, output_path)
    except Exception as e:
        print(f"Unexpected preprocessing error: {e}")
        return convert_to_wav(input_path, output_path)


def trim_audio_silence(
    input_path: str, output_path: str, threshold: str = "-30dB"
) -> bool:
    """
    Trim silence from beginning and end of audio using VAD-like detection.
    """
    try:
        cmd = [
            FFMPEG,
            "-i",
            input_path,
            # Use silencedetect to find silence
            "-af",
            f"silenceremove=start_periods=1:start_duration=0.1:start_threshold={threshold}:detection=peak,"
            # Also trim at the end
            "areverse,silenceremove=start_periods=1:start_duration=0.3:start_threshold={threshold}:detection=peak,areverse",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            "-y",
            output_path,
        ]
        subprocess.run(cmd, capture_output=True, check=True, timeout=30)
        return True
    except Exception as e:
        print(f"Silence trimming error: {e}")
        # Just copy the original if trimming fails
        try:
            import shutil

            shutil.copy(input_path, output_path)
        except:
            pass
        return True


def run_whisper(
    audio_path: str,
    model_path: str,
    language: str = "en",
    translate: bool = False,
    max_retries: int = 2,
):
    """Run whisper-cli and return results with retry logic"""
    last_data = None

    for attempt in range(max_retries + 1):
        output_base = os.path.join(UPLOAD_DIR, f"output_{generate_id()}")

        cmd = [
            WHISPER_CLI,
            "-m",
            model_path,
            "-f",
            audio_path,
            "-l",
            language if language != "auto" else "en",
            "-oj",  # JSON output
            "-of",
            output_base,
            "-t",
            "4",  # Use 4 threads
        ]

        # Add different options for retry attempts
        if attempt > 0:
            cmd.extend(["--no-timestamps"])  # Retry without timestamps if first fails

        # Remove empty strings
        cmd = [c for c in cmd if c]

        if translate:
            cmd.append("--translate")

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, check=True, timeout=120
            )

            # Read JSON output
            json_path = output_base + ".json"
            if os.path.exists(json_path):
                with open(json_path, "r") as f:
                    data = json.load(f)
                os.remove(json_path)
                last_data = data

                # Check if we got valid results
                transcription = data.get("transcription", data.get("segments", []))
                if transcription and len(transcription) > 0:
                    return data

            # If no valid results and we have retries left, continue
            if attempt < max_retries:
                print(f"Attempt {attempt + 1} produced no results, retrying...")
                continue

        except subprocess.TimeoutExpired:
            print(f"Whisper timeout on attempt {attempt + 1}")
            if attempt < max_retries:
                continue
            return None
        except subprocess.CalledProcessError as e:
            print(f"Whisper error (attempt {attempt + 1}): {e.stderr}")
            if attempt < max_retries:
                continue
            return None
        except Exception as e:
            print(f"Unexpected error: {e}")
            if attempt < max_retries:
                continue
            return None

    return last_data


# Hallucination filter
import re

HALLUCINATION_PATTERNS = [
    # Common whisper hallucinations
    r"^thanks for watching",
    r"^thank you for watching",
    r"^please subscribe",
    r"^like and subscribe",
    r"^hit the like button",
    r"^don't forget to",
    r"^so today",
    r"^welcome to",
    r"^hello everyone",
    r"^hey guys",
    r"^what's up",
    r"^good morning",
    r"^good evening",
    r"^thank you so much",
    r"^i hope you enjoyed",
    r"^see you next time",
    r"^in this video",
    r"^in today's video",
    r"^if you enjoyed",
    r"^leave a comment",
    r"^smash that",
    r"^ring the bell",
    # Music/sound artifacts
    r"^♪",
    r"^♫",
    r"^♩",
    r"^♬",
    r"^singing",
    r"^music playing",
    r"^applause",
    r"^cheering",
    r"^laughter",
    # Bracketed content and labels
    r"^\[music\]",
    r"^\[applause\]",
    r"^\[laughter\]",
    r"^\[noise\]",
    r"^\[silence\]",
    r"^\[",
    r"^\(.*\)$",
    # Timestamps
    r"^\d{2}:\d{2}:\d{2}",
    # Only special characters
    r"^[^a-zA-Z0-9\s]+$",
    # Repeated characters
    r"^([a-zA-Z])\1{5,}",
]


def filter_hallucinations(text: str) -> bool:
    """Check if text is likely a hallucination"""
    if not text:
        return True

    text = text.strip()

    # Too short
    if len(text) < 3:
        return True

    # Check if mostly special characters
    alpha_count = sum(1 for c in text if c.isalpha())
    if alpha_count < 2:
        return True

    text_lower = text.lower()

    for pattern in HALLUCINATION_PATTERNS:
        if re.match(pattern, text_lower):
            return True

    # Filter music notation (only music symbols)
    if re.match(r"^[♪♫♩♬𝄞\s]+$", text_lower):
        return True

    # Filter [Music] and similar bracketed artifacts
    if re.match(r"^(\[music\]|\[music\]\s*)+$", text_lower):
        return True
    if re.match(r"^\[.*\](\s*\[.*\])*$", text_lower):
        return True

    # Filter content that's entirely in brackets
    if re.match(r"^\[.*\]$", text_lower) or re.match(r"^\(.*\)$", text_lower):
        return True

    # Filter if text is mostly punctuation or numbers
    if len(text) > 0:
        alpha_ratio = alpha_count / len(text)
        if alpha_ratio < 0.3:
            return True

    return False


def clean_text(text: str) -> str:
    """Clean individual text segment"""
    if not text:
        return ""

    # Remove common whisper artifacts
    text = re.sub(r"\[_BEG_\]", "", text)
    text = re.sub(r"\[_TT_\d+\]", "", text)
    text = re.sub(r"\[BLANK_AUDIO\]", "", text)
    text = re.sub(r"\[START_OF_SPEECH\]", "", text)
    text = re.sub(r"\[END_OF_SPEECH\]", "", text)
    text = re.sub(r"\[MUSIC\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\[Applause\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\[Laughter\]", "", text, flags=re.IGNORECASE)

    # Remove timestamps patterns
    text = re.sub(
        r"\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]", "", text
    )

    # Remove music notation
    text = re.sub(r"[♪♫♩♬𝄞]+", "", text)

    # Clean up extra whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text


def clean_transcription(data: dict | None) -> dict:
    """Clean transcription data and remove hallucinations"""
    if not data:
        return {"text": "", "segments": []}

    # Get transcription array - handle different possible formats
    transcription = data.get("transcription", data.get("segments", []))

    if not isinstance(transcription, list):
        return {"text": "", "segments": []}

    cleaned_segments = []
    cleaned_text_parts = []

    for seg in transcription:
        if not isinstance(seg, dict):
            continue

        text = seg.get("text", "").strip()
        text = clean_text(text)

        if text and not filter_hallucinations(text):
            # Handle different timestamp formats
            start = 0
            end = 0

            if isinstance(seg.get("offsets"), dict):
                start = seg.get("offsets", {}).get("from", 0) / 1000
                end = seg.get("offsets", {}).get("to", 0) / 1000
            elif "t0" in seg and "t1" in seg:
                start = seg.get("t0", 0) / 1000
                end = seg.get("t1", 0) / 1000
            elif "start" in seg and "end" in seg:
                start = seg.get("start", 0)
                end = seg.get("end", 0)

            cleaned_segments.append(
                {
                    "start": round(start, 3),
                    "end": round(end, 3),
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
    noise_reduction: bool = Query(default=True),
    trim_silence: bool = Query(default=True),
):
    """Transcribe an audio file with optional noise reduction and VAD"""
    # Validate model
    model_path = os.path.join(MODEL_DIR, model)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=400, detail=f"Model {model} not found")

    # Validate file size (max 100MB)
    content = await audio.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 100MB)")

    if len(content) < 100:
        raise HTTPException(status_code=400, detail="Audio file too short or empty")

    # Save uploaded file
    file_ext = Path(audio.filename).suffix if audio.filename else ".webm"
    input_path = os.path.join(UPLOAD_DIR, f"{generate_id()}{file_ext}")

    with open(input_path, "wb") as f:
        f.write(content)

    # Generate intermediate paths
    file_id = Path(input_path).stem
    wav_path = os.path.join(UPLOAD_DIR, f"{file_id}.wav")
    processed_path = os.path.join(UPLOAD_DIR, f"{file_id}_processed.wav")
    trimmed_path = os.path.join(UPLOAD_DIR, f"{file_id}_trimmed.wav")

    try:
        # Convert to WAV
        if file_ext.lower() in [".webm", ".mp3", ".ogg", ".m4a", ".opus", ".flac"]:
            if not convert_to_wav(input_path, wav_path):
                raise HTTPException(
                    status_code=500, detail="Failed to convert audio format"
                )
            audio_path = wav_path
        else:
            audio_path = input_path
            wav_path = None

        # Apply noise reduction if requested
        if noise_reduction:
            print(f"Applying noise reduction to {audio_path}")
            if preprocess_audio(audio_path, processed_path):
                audio_path = processed_path
            else:
                print("Noise reduction failed, using original")

        # Trim silence (VAD) if requested
        if trim_silence:
            print(f"Trimming silence from {audio_path}")
            if trim_audio_silence(audio_path, trimmed_path):
                audio_path = trimmed_path

        # Get audio duration
        duration = 0
        try:
            result = subprocess.run(
                [FFMPEG, "-i", audio_path, "-f", "null", "-"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            duration_match = re.search(
                r"Duration: (\d+):(\d+):(\d+\.\d+)", result.stderr
            )
            if duration_match:
                hours, minutes, seconds = duration_match.groups()
                duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        except Exception as e:
            print(f"Duration detection error: {e}")
            duration = 0

        # Check if audio is too short after processing
        if duration < 0.1:
            raise HTTPException(
                status_code=400, detail="Audio is too short or contains no speech"
            )

        # Run whisper with retry
        print(f"Running whisper on {audio_path}, duration: {duration:.2f}s")
        raw_result = run_whisper(audio_path, model_path, language, translate)

        if not raw_result:
            raise HTTPException(
                status_code=500, detail="Transcription failed - no results returned"
            )

        # Clean and process results
        cleaned = clean_transcription(raw_result)

        # Check if we got any valid transcription
        if not cleaned.get("text") and not cleaned.get("segments"):
            # Try once more without preprocessing
            print("No results after cleaning, trying with raw audio...")
            raw_result = run_whisper(input_path, model_path, language, translate)
            if raw_result:
                cleaned = clean_transcription(raw_result)

    finally:
        # Clean up all temporary files
        for path in [input_path, wav_path, processed_path, trimmed_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except:
                    pass

    if not cleaned.get("text") and not cleaned.get("segments"):
        raise HTTPException(status_code=500, detail="No speech detected in audio")

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
