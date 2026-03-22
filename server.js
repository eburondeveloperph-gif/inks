const express = require('express');
const multer = require('multer');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

// Import database
const { sqlite, initializeDatabase, getDatabaseStats, generateId } = require('./db/index.js');

const app = express();
const port = 3002;

// Swagger/OpenAPI configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Eburon AI ASR API',
            version: '1.0.0',
            description: 'Speech-to-Text API powered by eburon.ai',
        },
        servers: [
            { url: 'http://localhost:3002', description: 'Local server' },
        ],
    },
    apis: [], // No YAML files, we'll define specs inline
};

// Swagger docs
const swaggerDocs = {
    openapi: '3.0.0',
    info: {
        title: 'Eburon AI ASR API',
        version: '1.0.0',
        description: 'Speech-to-Text API powered by eburon.ai\n\n## Endpoints\n\n### Health & Models\n- `GET /api/health` - Health check\n- `GET /api/models` - List available models\n\n### Transcription\n- `POST /api/transcribe` - Transcribe audio file\n- `GET /api/transcriptions` - List transcriptions\n- `GET /api/transcriptions/:id` - Get transcription\n\n### Streaming\n- `GET /api/stream` - Real-time streaming (SSE)\n- `POST /api/stream/stop` - Stop streaming',
    },
    servers: [
        { url: 'http://localhost:3002', description: 'Local server' },
    ],
};

// Speaker diarization utilities
class SpeakerDiarizer {
    constructor() {
        this.speakers = []; // Speaker voice fingerprints
        this.speakerColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        this.maxSpeakers = 6;
    }

    // Extract voice features from audio segment using ffmpeg
    async extractVoiceFeatures(audioData, sampleRate = 16000) {
        return new Promise((resolve) => {
            // Write temp audio file
            const tempFile = path.join(__dirname, 'uploads', `temp_${Date.now()}.raw`);
            fs.writeFileSync(tempFile, Buffer.from(audioData));
            
            // Extract pitch and energy using ffmpeg
            const cmd = `ffmpeg -f s16le -ar ${sampleRate} -ac 1 -i "${tempFile}" -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>&1 | grep RMS_level | tail -5`;
            
            exec(cmd, (error, stdout) => {
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {}
                
                // Parse RMS levels to estimate voice energy
                const levels = stdout.match(/-?\d+\.?\d*/g);
                const avgLevel = levels ? levels.reduce((a, b) => a + parseFloat(b), 0) / levels.length : -50;
                
                resolve({
                    energy: avgLevel,
                    timestamp: Date.now()
                });
            });
        });
    }

    // Compare two voice fingerprints
    compareFingerprints(fp1, fp2) {
        const energyDiff = Math.abs(fp1.energy - fp2.energy);
        // Lower difference = more similar
        return energyDiff < 10; // 10dB threshold
    }

    // Find or create speaker based on voice features
    identifySpeaker(features) {
        // If no speakers yet, create first one
        if (this.speakers.length === 0) {
            this.speakers.push({
                id: 0,
                fingerprints: [features],
                color: this.speakerColors[0]
            });
            return 0;
        }

        // Compare with existing speakers
        for (let i = 0; i < this.speakers.length; i++) {
            const speaker = this.speakers[i];
            // Check against recent fingerprints
            const recentFps = speaker.fingerprints.slice(-3);
            for (const fp of recentFps) {
                if (this.compareFingerprints(fp, features)) {
                    // Update fingerprint history
                    speaker.fingerprints.push(features);
                    if (speaker.fingerprints.length > 10) {
                        speaker.fingerprints.shift();
                    }
                    return speaker.id;
                }
            }
        }

        // No match found, create new speaker if under limit
        if (this.speakers.length < this.maxSpeakers) {
            const newId = this.speakers.length;
            this.speakers.push({
                id: newId,
                fingerprints: [features],
                color: this.speakerColors[newId]
            });
            return newId;
        }

        // Return most similar speaker
        let minDiff = Infinity;
        let closestId = 0;
        for (const speaker of this.speakers) {
            const recentFp = speaker.fingerprints[speaker.fingerprints.length - 1];
            const diff = Math.abs(recentFp.energy - features.energy);
            if (diff < minDiff) {
                minDiff = diff;
                closestId = speaker.id;
            }
        }
        
        this.speakers[closestId].fingerprints.push(features);
        return closestId;
    }

    getSpeakerColor(speakerId) {
        return this.speakerColors[speakerId % this.speakerColors.length];
    }

    reset() {
        this.speakers = [];
    }
}

// Initialize database on startup
initializeDatabase();

app.use(cors());
app.use(express.json());

// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.get('/api/docs-json', (req, res) => res.json(swaggerDocs));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/x-wav', 'audio/webm', 'audio/webm;codecs=opus'];
        const allowedExtensions = /\.(mp3|wav|flac|ogg|webm|opus)$/i;
        
        if (allowedTypes.includes(file.mimetype) || file.originalname.match(allowedExtensions)) {
            cb(null, true);
        } else {
            console.log('Rejected file type:', file.mimetype, 'name:', file.originalname);
            cb(new Error(`Invalid file type: ${file.mimetype}. Only audio files are allowed.`));
        }
    }
});

// Get available models
app.get('/api/models', (req, res) => {
    const modelsDir = path.join(process.env.HOME, 'whisper-models');
    const models = [
        { name: 'ink-zero', path: 'ink-zero', description: 'OpenAI Whisper - Best accuracy' }
    ];
    
    if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        files.forEach(file => {
            if (file.endsWith('.bin')) {
                models.push({
                    name: file,
                    path: path.join(modelsDir, file),
                    description: 'Whisper.cpp - Fast local inference'
                });
            }
        });
    }
    
    res.json(models);
});

// Supported languages for crosslingual transcription (whisper.cpp codes)
const LANGUAGES = {
    'auto': 'Auto-detect',
    'en': 'English',
    'zh': 'Chinese',
    'de': 'German',
    'es': 'Spanish',
    'ru': 'Russian',
    'ko': 'Korean',
    'fr': 'French',
    'ja': 'Japanese',
    'pt': 'Portuguese',
    'tr': 'Turkish',
    'pl': 'Polish',
    'nl': 'Dutch',
    'ar': 'Arabic',
    'cs': 'Czech',
    'hi': 'Hindi',
    'ro': 'Romanian',
    'sv': 'Swedish',
    'th': 'Thai',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'el': 'Greek',
    'hu': 'Hungarian',
    'fi': 'Finnish',
    'he': 'Hebrew',
    'uk': 'Ukrainian',
    'ms': 'Malay',
    'bg': 'Bulgarian',
    'ca': 'Catalan',
    'da': 'Danish',
    'et': 'Estonian',
    'fa': 'Persian',
    'hr': 'Croatian',
    'ka': 'Georgian',
    'kk': 'Kazakh',
    'lt': 'Lithuanian',
    'lv': 'Latvian',
    'mk': 'Macedonian',
    'mn': 'Mongolian',
    'no': 'Norwegian',
    'sk': 'Slovak',
    'sl': 'Slovenian',
    'sq': 'Albanian',
    'sr': 'Serbian',
    'uz': 'Uzbek',
    'az': 'Azerbaijani',
    'bn': 'Bengali',
    'gu': 'Gujarati',
    'kn': 'Kannada',
    'ml': 'Malayalam',
    'mr': 'Marathi',
    'ne': 'Nepali',
    'pa': 'Punjabi',
    'si': 'Sinhala',
    'ta': 'Tamil',
    'te': 'Telugu',
    'ur': 'Urdu',
};

// Language detection patterns (simple heuristic)
const LANGUAGE_PATTERNS = {
    'en': /^[a-zA-Z\s\.,!?'"-]+$/,
    'es': /[áéíóúñ¿¡]/i,
    'fr': /[àâçéèêëîïôûùüÿœæ]/i,
    'de': /[äöüß]/i,
    'zh': /[\u4e00-\u9fff]/,
    'ja': /[\u3040-\u309f\u30a0-\u30ff]/,
    'ko': /[\uac00-\ud7af]/,
    'ar': /[\u0600-\u06ff]/,
    'hi': /[\u0900-\u097f]/,
};

function detectLanguage(text) {
    if (!text || text.length < 3) return 'en';
    
    // Check for specific character sets
    for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
        if (pattern.test(text)) {
            return lang;
        }
    }
    
    return 'en'; // Default to English
}

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            console.error('No file in request');
            return res.status(400).json({ error: 'No audio file provided' });
        }

        console.log('Received file:', req.file.originalname, 'size:', req.file.size, 'model:', req.body.model, 'language:', req.body.language);

        if (req.file.size < 1000) {
            console.error('File too small:', req.file.size);
            return res.status(400).json({ error: 'Audio file too small' });
        }

        const model = req.body.model || 'ink-zero';
        const language = req.body.language || 'auto';
        const musicMode = req.body.music === 'true';
        
        let audioPath = req.file.path;
        const originalExt = path.extname(req.file.originalname).toLowerCase();
        console.log('Processing audio:', audioPath, 'ext:', originalExt);
        
        // Convert webm/opus to wav if needed
        if (originalExt === '.webm' || req.file.mimetype.includes('webm')) {
            const wavPath = audioPath.replace(/\.\w+$/, '.wav');
            
            let convertCommand;
            if (musicMode) {
                convertCommand = `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le -af "highpass=f=60,lowpass=f=8000" "${wavPath}" -y`;
            } else {
                convertCommand = `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}" -y`;
            }
            
            console.log(`Converting webm to wav (${musicMode ? 'MUSIC' : 'SPEECH'} mode): ${convertCommand}`);
            
            try {
                await new Promise((resolve, reject) => {
                    exec(convertCommand, (error, stdout, stderr) => {
                        if (error) {
                            console.error('FFmpeg conversion error:', error);
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                });
                
                // Use the converted wav file
                audioPath = wavPath;
                console.log(`Converted to: ${audioPath}`);
            } catch (convertError) {
                console.error('Failed to convert audio:', convertError);
                return res.status(500).json({ error: 'Failed to convert audio format' });
            }
        }
        
        // Build transcription command based on model
        const outputPath = path.join(__dirname, 'uploads', `output-${Date.now()}`);
        const whisperLang = language === 'auto' ? 'en' : language;
        let command;
        
        if (model === 'ink-zero') {
            // Use OpenAI Whisper
            command = `whisper "${audioPath}" --model base --language ${whisperLang} --output_format json --output_dir "${outputPath}"`;
        } else {
            // Use whisper.cpp
            const modelPath = path.join(process.env.HOME, 'whisper-models', model);
            if (!fs.existsSync(modelPath)) {
                return res.status(400).json({ error: `Model ${model} not found` });
            }
            command = `whisper-cli -m "${modelPath}" -f "${audioPath}" -l ${whisperLang} -oj -of "${outputPath}"`;
        }
        
        console.log(`Executing (${model}): ${command}`);

        exec(command, (error, stdout, stderr) => {
            console.log('whisper-cli stdout:', stdout?.substring(0, 500));
            console.log('whisper-cli stderr:', stderr?.substring(0, 500));
            
            // Clean up uploaded files
            try {
                fs.unlinkSync(audioPath);
                // Also try to delete the original webm if different
                if (req.file.path !== audioPath) {
                    fs.unlinkSync(req.file.path);
                }
            } catch (e) {
                console.error('Error cleaning up uploaded file:', e);
            }

            if (error) {
                console.error(`Exec error: ${error}`);
                console.error(`Stderr: ${stderr}`);
                return res.status(500).json({ 
                    error: 'Transcription failed',
                    details: stderr || error.message 
                });
            }

            // Check for output files (OpenAI Whisper outputs to {output_dir}/{filename}.json)
            const audioFileName = path.basename(audioPath, path.extname(audioPath));
            const jsonPath = path.join(outputPath, audioFileName + '.json');
            const txtPath = path.join(outputPath, audioFileName + '.txt');
            const srtPath = path.join(outputPath, audioFileName + '.srt');

            let result = {
                success: true,
                text: '',
                segments: [],
                json: null,
                srt: null,
                txt: null
            };

            // Read JSON output
            if (fs.existsSync(jsonPath)) {
                try {
                    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    console.log('JSON data keys:', Object.keys(jsonData));
                    
                    // Handle different JSON structures from whisper-cli
                    let transcriptionText = '';
                    let segmentsArray = [];
                    
                    if (jsonData.transcription) {
                        // whisper-cli format: transcription array with segments
                        transcriptionText = jsonData.transcription
                            .map(t => t.text || '')
                            .join(' ')
                            .trim();
                        
                        // Extract segments with language detection
                        segmentsArray = jsonData.transcription.map((seg, idx) => {
                            const text = (seg.text || '').trim();
                            return {
                                start: seg.offsets?.from ? seg.offsets.from / 1000 : (seg.t0 ? seg.t0 / 1000 : idx * 5),
                                end: seg.offsets?.to ? seg.offsets.to / 1000 : (seg.t1 ? seg.t1 / 1000 : (idx + 1) * 5),
                                text: text,
                                language: detectLanguage(text),
                                languageName: LANGUAGES[detectLanguage(text)] || 'Unknown',
                                confidence: seg.confidence || null
                            };
                        });
                    } else if (jsonData.text) {
                        transcriptionText = jsonData.text;
                        segmentsArray = (jsonData.segments || []).map((seg, idx) => {
                            const text = (seg.text || '').trim();
                            return {
                                start: seg.start || seg.t0 ? (seg.start || seg.t0 / 1000) : idx * 5,
                                end: seg.end || seg.t1 ? (seg.end || seg.t1 / 1000) : (idx + 1) * 5,
                                text: text,
                                language: detectLanguage(text),
                                languageName: LANGUAGES[detectLanguage(text)] || 'Unknown',
                                confidence: seg.confidence || null
                            };
                        });
                    } else if (jsonData.result) {
                        transcriptionText = jsonData.result || '';
                    }
                    
                    // Count detected languages
                    const languageCounts = {};
                    segmentsArray.forEach(seg => {
                        const lang = seg.language;
                        languageCounts[lang] = (languageCounts[lang] || 0) + 1;
                    });
                    
                    console.log('Transcription text:', transcriptionText?.substring(0, 100));
                    console.log('Detected languages:', languageCounts);
                    
                    result.json = jsonData;
                    result.text = transcriptionText;
                    result.segments = segmentsArray;
                    result.detectedLanguages = languageCounts;
                    result.primaryLanguage = Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'en';
                    result.success = true;
                    
                    // Clean up JSON file
                    fs.unlinkSync(jsonPath);
                } catch (e) {
                    console.error('Error parsing JSON:', e);
                }
            } else {
                console.log('JSON file not found at:', jsonPath);
                // Try to find output files
                const dir = path.dirname(outputPath);
                const files = fs.readdirSync(dir).filter(f => f.includes(path.basename(outputPath)));
                console.log('Files with output prefix:', files);
            }

            // Read text output
            if (fs.existsSync(txtPath)) {
                try {
                    result.txt = fs.readFileSync(txtPath, 'utf8');
                    if (!result.text) {
                        result.text = result.txt;
                    }
                    // Clean up text file
                    fs.unlinkSync(txtPath);
                } catch (e) {
                    console.error('Error reading text:', e);
                }
            }

            // Read SRT output
            if (fs.existsSync(srtPath)) {
                try {
                    result.srt = fs.readFileSync(srtPath, 'utf8');
                    // Clean up SRT file
                    fs.unlinkSync(srtPath);
                } catch (e) {
                    console.error('Error reading SRT:', e);
                }
            }

            res.json(result);
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ 
            error: 'Server error',
            details: error.message 
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Streaming endpoint using Server-Sent Events (SSE)
app.get('/api/stream', (req, res) => {
    let model = req.query.model || 'ink-zero'; // Use ink-zero model by default
    const language = req.query.language || 'en'; // Use English by default
    const musicMode = req.query.music === 'true';
    
    // ink-zero uses OpenAI Whisper, others use whisper.cpp
    if (model === 'ink-zero') {
        // For streaming with ink-zero, we'll still use whisper-stream (whisper.cpp)
        // since OpenAI Whisper doesn't support streaming
        const defaultModel = path.join(process.env.HOME, 'whisper-models', 'ggml-base.en.bin');
        if (!fs.existsSync(defaultModel)) {
            return res.status(400).json({ error: 'Default whisper.cpp model not found' });
        }
        model = 'ggml-base.en.bin';
    }
    
    const modelPath = path.join(process.env.HOME, 'whisper-models', model);
    if (!fs.existsSync(modelPath)) {
        return res.status(400).json({ error: `Model ${model} not found at ${modelPath}` });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Build whisper-stream command with mode-specific settings
    const command = 'whisper-stream';
    
    // Base args
    const args = [
        '-m', modelPath,
        '--keep-context'
    ];
    
    // Use auto language detection if specified
    if (language !== 'auto') {
        args.push('-l', language);
    }
    
    if (musicMode) {
        // Music/lyrics mode
        args.push('--step', '3000');
        args.push('--length', '8000');
        args.push('--keep', '200');
        args.push('--vad-thold', '0.2');
        args.push('--freq-thold', '100');
    } else {
        // Speech mode
        args.push('--step', '2000');
        args.push('--length', '4000');
        args.push('--keep', '100');
        args.push('--vad-thold', '0.7');
        args.push('--freq-thold', '300');
    }
    
    console.log(`Starting streaming (${musicMode ? 'MUSIC' : 'SPEECH'} mode): ${command} ${args.join(' ')}`);

    console.log(`Starting streaming with: ${command} ${args.join(' ')}`);
    
    // Send initial status message
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting whisper-stream...' })}\n\n`);
    
    const streamProcess = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let buffer = '';
    let fullTranscript = '';
    let lastRawLine = '';
    
    // Helper to find the longest common suffix/prefix overlap
    const findOverlap = (existing, newText) => {
        const existingWords = existing.split(/\s+/).filter(w => w);
        const newWords = newText.split(/\s+/).filter(w => w);
        
        // Try different overlap lengths, starting from the largest possible
        const maxOverlap = Math.min(existingWords.length, newWords.length, 10);
        
        for (let overlap = maxOverlap; overlap > 0; overlap--) {
            const existingSuffix = existingWords.slice(-overlap).join(' ').toLowerCase();
            const newPrefix = newWords.slice(0, overlap).join(' ').toLowerCase();
            
            if (existingSuffix === newPrefix) {
                return overlap;
            }
        }
        return 0;
    };
    
    // Common whisper hallucination patterns to filter out
    const speechHallucinationPatterns = [
        /^thanks for watching/i,
        /^thank you for watching/i,
        /^please subscribe/i,
        /^like and subscribe/i,
        /^so today/i,
        /^welcome to/i,
        /^thanks for listening/i,
        /^thank you for listening/i,
        /^if you liked/i,
        /^don't forget to/i,
        /^make sure to/i,
        /^see you next time/i,
        /^that's all for/i,
        /^in this video/i,
        /^in this tutorial/i,
        /^hello everyone/i,
        /^hi everyone/i,
        /^welcome back/i,
        /^so let's/i,
        /^and they will/i,
        /^i would like/i,
        /^i would love/i,
        /^i'd like to/i,
        // Music and meta tags
        /^\[start speaking\]/i,
        /^\[silence\]/i,
        /^\[noise\]/i,
        /^♪/i,
        /^singing/i,
        /^music playing/i,
        // Common whisper hallucinations
        /^that chill personal/i,
        /^post-summer/i,
        /^thatchillpersonal/i,
        /^\.\.\.and /i,
        /^\.\.\.\.\.\./i,
        /^metadata/i,
        // Foreign language markers from whisper
        /^\(speaking in foreign language\)/i,
        /^\[speaking in foreign language\]/i,
        /^speaking in foreign language/i,
    ];
    
    // Minimal filtering for music mode
    const musicHallucinationPatterns = [
        /^thanks for watching/i,
        /^thank you for watching/i,
        /^please subscribe/i,
        /^like and subscribe/i,
        /^don't forget to/i,
        /^make sure to/i,
        /^see you next time/i,
        /^\[start speaking\]/i,
        /^\[silence\]/i,
        /^\[noise\]/i,
        /^that chill personal/i,
        /^post-summer search/i,
        /^and experience/i,
        /^\.\.\.and /i,
        /^\(speaking in foreign language\)/i,
        /^\[speaking in foreign language\]/i,
    ];
    
    const hallucinationPatterns = musicMode ? musicHallucinationPatterns : speechHallucinationPatterns;
    
    // Initialize speaker diarizer
    const diarizer = new SpeakerDiarizer();
    let lastTranscriptTime = 0;
    
    const isLikelyHallucination = (text) => {
        const lowerText = text.toLowerCase().trim();
        
        // Filter empty or very short
        if (!lowerText || lowerText.length < 4) {
            return true;
        }
        
        // Check if text matches known hallucination patterns
        for (const pattern of hallucinationPatterns) {
            if (pattern.test(lowerText)) {
                return true;
            }
        }
        
        // Filter text that's mostly non-alphabetic
        const alphaCount = (lowerText.match(/[a-z]/g) || []).length;
        if (alphaCount < lowerText.length * 0.5) {
            return true;
        }
        
        // Filter single word repetitions (common hallucination)
        const words = lowerText.split(/\s+/).filter(w => w);
        if (words.length <= 2 && words[0] === words[1]) {
            return true;
        }
        
        // Filter concatenated words without spaces (likely hallucination)
        if (lowerText.length > 20 && !lowerText.includes(' ') && lowerText.includes('personal')) {
            return true;
        }
        
        // Filter text with too many consecutive consonants (gibberish)
        const consonantPattern = /[bcdfghjklmnpqrstvwxyz]{6,}/;
        if (consonantPattern.test(lowerText.replace(/\s/g, ''))) {
            return true;
        }
        
        // Filter text without vowels (likely gibberish)
        if (!/[aeiou]/.test(lowerText)) {
            return true;
        }
        
        // Filter text that contains only special characters or brackets
        if (/^[\[\](){}*_~♪♫.]+$/i.test(lowerText)) {
            return true;
        }
        
        // Filter text that starts with dots or brackets
        if (/^[\.\[\]]+/.test(lowerText)) {
            return true;
        }
        
        // Filter music notation
        if (/^[♪♫♩♬]+$/.test(lowerText)) {
            return true;
        }
        
        return false;
    };
    
    streamProcess.stdout.on('data', (data) => {
        const output = data.toString();
        buffer += output;
        
        // Check for complete lines (transcription results)
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        lines.forEach(line => {
            if (line.trim()) {
                // Clean up whisper special tokens and artifacts
                let cleanText = line.trim()
                    .replace(/\[_BEG_\]/g, '')
                    .replace(/\[_TT_\d+\]/g, '')
                    .replace(/\[BLANK_AUDIO\]/g, '')
                    .replace(/\[_NOP_\]/g, '')
                    .replace(/\[START_OF_SPEECH\]/g, '')
                    .replace(/\[END_OF_SPEECH\]/g, '')
                    .replace(/\[MUSIC\]/gi, '')
                    .replace(/\[APPLAUSE\]/gi, '')
                    .replace(/\[LAUGHTER\]/gi, '')
                    // Remove leading/trailing brackets and dots
                    .replace(/^[\[\]\.\.\.\s]+/, '')
                    .replace(/[\[\]]+$/, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                // Skip empty or very short text
                if (!cleanText || cleanText.length < 3) return;
                
                // Skip if same as last raw line (exact duplicate from whisper)
                if (cleanText === lastRawLine) return;
                lastRawLine = cleanText;
                
                // Skip likely hallucinations
                if (isLikelyHallucination(cleanText)) {
                    console.log('Filtered hallucination:', cleanText);
                    return;
                }
                
                let newText = cleanText;
                
                // If we have existing transcript, find overlap and extract new text
                if (fullTranscript) {
                    const overlap = findOverlap(fullTranscript, cleanText);
                    
                    if (overlap > 0) {
                        // Extract only the new words after the overlap
                        const newWords = cleanText.split(/\s+/).filter(w => w);
                        newText = newWords.slice(overlap).join(' ');
                        
                        // If nothing new, skip
                        if (!newText || newText.trim() === '') {
                            return;
                        }
                    }
                    // If no overlap found, treat as completely new text
                }
                
                // Update full transcript
                fullTranscript = fullTranscript 
                    ? fullTranscript + ' ' + newText 
                    : newText;
                
                // Detect language for this chunk
                const detectedLang = detectLanguage(newText.trim());
                
                // Send transcription chunk with language info
                const timestamp = new Date().toISOString();
                res.write(`data: ${JSON.stringify({ 
                    type: 'transcription',
                    text: newText.trim(),
                    timestamp,
                    fullText: fullTranscript,
                    language: detectedLang,
                    languageName: LANGUAGES[detectedLang] || 'Unknown'
                })}\n\n`);
            }
        });
    });
    
    streamProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.log('whisper-stream stderr:', error);
        
        // Send status updates
        if (error.includes('Listening') || error.includes('Processing')) {
            res.write(`data: ${JSON.stringify({ 
                type: 'status',
                message: error.trim(),
                timestamp: new Date().toISOString()
            })}\n\n`);
        }
    });
    
    streamProcess.on('close', (code) => {
        console.log(`whisper-stream process exited with code ${code}`);
        res.write(`data: ${JSON.stringify({ 
            type: 'end',
            code,
            timestamp: new Date().toISOString()
        })}\n\n`);
        res.end();
    });
    
    streamProcess.on('error', (err) => {
        console.error('Failed to start whisper-stream:', err);
        res.write(`data: ${JSON.stringify({ 
            type: 'error',
            message: err.message,
            timestamp: new Date().toISOString()
        })}\n\n`);
        res.end();
    });
    
    // Handle client disconnect
    req.on('close', () => {
        console.log('Client disconnected, killing whisper-stream');
        if (streamProcess && !streamProcess.killed) {
            streamProcess.kill();
        }
    });
});

// Stop streaming endpoint
app.post('/api/stream/stop', (req, res) => {
    // This is a simple endpoint - actual stopping is handled by client disconnect
    res.json({ status: 'stopped' });
});

// =====================================
// DATABASE API ENDPOINTS
// =====================================

// Get database stats
app.get('/api/db/stats', (req, res) => {
    try {
        const stats = getDatabaseStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all transcriptions (with pagination)
app.get('/api/transcriptions', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const result = sqlite.prepare(`
            SELECT * FROM transcriptions 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(limit, offset);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single transcription with segments
app.get('/api/transcriptions/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const transcription = sqlite.prepare(`
            SELECT * FROM transcriptions WHERE id = ?
        `).get(id);
        
        if (!transcription) {
            return res.status(404).json({ error: 'Transcription not found' });
        }
        
        const transcriptionSegments = sqlite.prepare(`
            SELECT * FROM segments 
            WHERE transcription_id = ? 
            ORDER BY segment_index
        `).all(id);
        
        res.json({
            ...transcription,
            segments: transcriptionSegments
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save transcription to database
app.post('/api/transcriptions', (req, res) => {
    try {
        const {
            title,
            audioFileName,
            audioFileSize,
            audioDuration,
            fullText,
            language,
            model,
            segments: segmentsData
        } = req.body;
        
        const id = generateId();
        const now = Math.floor(Date.now() / 1000);
        
        // Create transcription record
        sqlite.prepare(`
            INSERT INTO transcriptions (id, title, audio_file_name, audio_file_size, audio_duration, full_text, language, model, status, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            title || audioFileName || 'Untitled',
            audioFileName,
            audioFileSize,
            audioDuration,
            fullText,
            language || 'en',
            model || 'ggml-base.en',
            'completed',
            now,
            now,
            now
        );
        
        // Insert segments if provided
        if (segmentsData && segmentsData.length > 0) {
            const insertSegment = sqlite.prepare(`
                INSERT INTO segments (id, transcription_id, segment_index, start_time, end_time, text, confidence, words, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            for (let i = 0; i < segmentsData.length; i++) {
                const seg = segmentsData[i];
                insertSegment.run(
                    generateId(),
                    id,
                    i,
                    seg.start || 0,
                    seg.end || 0,
                    seg.text,
                    seg.confidence || null,
                    seg.words ? JSON.stringify(seg.words) : null,
                    now
                );
            }
        }
        
        // Return the created transcription
        const newTranscription = sqlite.prepare('SELECT * FROM transcriptions WHERE id = ?').get(id);
        res.json(newTranscription);
    } catch (error) {
        console.error('Error saving transcription:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete transcription
app.delete('/api/transcriptions/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        // Delete segments first
        sqlite.prepare('DELETE FROM segments WHERE transcription_id = ?').run(id);
        
        // Delete transcription
        sqlite.prepare('DELETE FROM transcriptions WHERE id = ?').run(id);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update transcription
app.patch('/api/transcriptions/:id', (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const now = Math.floor(Date.now() / 1000);
        
        // Build dynamic update query
        const fields = [];
        const values = [];
        
        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.fullText !== undefined) { fields.push('full_text = ?'); values.push(updates.fullText); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        
        fields.push('updated_at = ?');
        values.push(now);
        values.push(id);
        
        sqlite.prepare(`
            UPDATE transcriptions 
            SET ${fields.join(', ')} 
            WHERE id = ?
        `).run(...values);
        
        const updated = sqlite.prepare('SELECT * FROM transcriptions WHERE id = ?').get(id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all projects
app.get('/api/projects', (req, res) => {
    try {
        const result = sqlite.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project
app.post('/api/projects', (req, res) => {
    try {
        const { name, description } = req.body;
        const id = generateId();
        const now = Math.floor(Date.now() / 1000);
        
        sqlite.prepare(`
            INSERT INTO projects (id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, name, description, now, now);
        
        const newProject = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(id);
        res.json(newProject);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Search transcriptions
app.get('/api/transcriptions/search/:query', (req, res) => {
    try {
        const { query } = req.params;
        
        const result = sqlite.prepare(`
            SELECT * FROM transcriptions 
            WHERE full_text LIKE ? OR title LIKE ?
            ORDER BY created_at DESC 
            LIMIT 20
        `).all(`%${query}%`, `%${query}%`);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
    });
});

app.listen(port, () => {
    console.log(`Whisper STT server running at http://localhost:${port}`);
    console.log('Available endpoints:');
    console.log('  GET  /api/health     - Health check');
    console.log('  GET  /api/models     - List available models');
    console.log('  POST /api/transcribe - Transcribe audio file');
    console.log('  GET  /api/stream     - Real-time streaming (SSE)');
    console.log('  POST /api/stream/stop - Stop streaming');
});