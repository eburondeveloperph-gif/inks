const express = require('express');
const multer = require('multer');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Import database
const { sqlite, initializeDatabase, getDatabaseStats, generateId } = require('./db/index.js');

const app = express();
const port = 3002;

// Initialize database on startup
initializeDatabase();

app.use(cors());
app.use(express.json());

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
    const models = [];
    
    if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        files.forEach(file => {
            if (file.endsWith('.bin')) {
                models.push({
                    name: file,
                    path: path.join(modelsDir, file)
                });
            }
        });
    }
    
    res.json(models);
});

// Transcribe audio file
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const model = req.body.model || 'ggml-base.en.bin';
        const language = req.body.language || 'en';
        const modelPath = path.join(process.env.HOME, 'whisper-models', model);
        
        if (!fs.existsSync(modelPath)) {
            return res.status(400).json({ error: `Model ${model} not found` });
        }

        let audioPath = req.file.path;
        const originalExt = path.extname(req.file.originalname).toLowerCase();
        
        // Convert webm/opus to wav if needed (whisper doesn't support webm)
        if (originalExt === '.webm' || req.file.mimetype.includes('webm')) {
            const wavPath = audioPath.replace(/\.\w+$/, '.wav');
            const convertCommand = `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}" -y`;
            
            console.log(`Converting webm to wav: ${convertCommand}`);
            
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
        
        // Build whisper-cli command with clean output
        let command = `whisper-cli -m "${modelPath}" -f "${audioPath}" -l ${language}`;
        
        // Add output format options (JSON for parsing)
        command += ' -oj';
        
        // Add output file path
        const outputPath = path.join(__dirname, 'uploads', `output-${Date.now()}`);
        command += ` -of "${outputPath}"`;

        console.log(`Executing: ${command}`);

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

            // Check for output files
            const jsonPath = outputPath + '.json';
            const txtPath = outputPath + '.txt';
            const srtPath = outputPath + '.srt';

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
                        
                        // Extract segments with proper timestamps
                        segmentsArray = jsonData.transcription.map((seg, idx) => ({
                            start: seg.offsets?.from ? seg.offsets.from / 1000 : (seg.t0 ? seg.t0 / 1000 : idx * 5),
                            end: seg.offsets?.to ? seg.offsets.to / 1000 : (seg.t1 ? seg.t1 / 1000 : (idx + 1) * 5),
                            text: (seg.text || '').trim(),
                            confidence: seg.confidence || null
                        }));
                    } else if (jsonData.text) {
                        transcriptionText = jsonData.text;
                        segmentsArray = (jsonData.segments || []).map((seg, idx) => ({
                            start: seg.start || seg.t0 ? (seg.start || seg.t0 / 1000) : idx * 5,
                            end: seg.end || seg.t1 ? (seg.end || seg.t1 / 1000) : (idx + 1) * 5,
                            text: (seg.text || '').trim(),
                            confidence: seg.confidence || null
                        }));
                    } else if (jsonData.result) {
                        transcriptionText = jsonData.result || '';
                    }
                    
                    console.log('Transcription text:', transcriptionText?.substring(0, 100));
                    console.log('Segments with timestamps:', segmentsArray.slice(0, 3));
                    
                    result.json = jsonData;
                    result.text = transcriptionText;
                    result.segments = segmentsArray;
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
    const model = req.query.model || 'ggml-base.en.bin';
    const language = req.query.language || 'en';
    const modelPath = path.join(process.env.HOME, 'whisper-models', model);
    
    if (!fs.existsSync(modelPath)) {
        return res.status(400).json({ error: `Model ${model} not found` });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Build whisper-stream command with VAD and clean output
    const command = 'whisper-stream';
    const args = [
        '-m', modelPath,
        '-l', language,
        '--step', '2000',     // 2 second steps (faster updates)
        '--length', '4000',   // 4 second window
        '--keep', '100',      // keep only 100ms from previous
        '--vad-thold', '0.7', // Very high VAD threshold (only clear direct speech)
        '--freq-thold', '300', // Higher frequency cutoff (filter speaker output)
        '--keep-context'      // keep context between chunks
    ];

    console.log(`Starting streaming with: ${command} ${args.join(' ')}`);
    
    const streamProcess = spawn(command, args);
    
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
    const hallucinationPatterns = [
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
        /^\[music\]/i,
        /^\[applause\]/i,
        /^\[silence\]/i,
        /^\[noise\]/i,
        /^♪/i,
        /^\[.*\]$/i,  // Any bracketed text
        /^singing/i,
        /^music playing/i,
    ];
    
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
        
        // Filter text without vowels (likely gibberish)
        if (!/[aeiou]/.test(lowerText)) {
            return true;
        }
        
        // Filter text that contains only special characters or brackets
        if (/^[\[\](){}*_~♪♫]+$/.test(lowerText)) {
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
                // Clean up whisper special tokens
                let cleanText = line.trim()
                    .replace(/\[_BEG_\]/g, '')
                    .replace(/\[_TT_\d+\]/g, '')
                    .replace(/\[BLANK_AUDIO\]/g, '')
                    .replace(/\[_NOP_\]/g, '')
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
                
                // Send only the new text chunk
                const timestamp = new Date().toISOString();
                res.write(`data: ${JSON.stringify({ 
                    type: 'transcription',
                    text: newText.trim(),
                    timestamp,
                    fullText: fullTranscript
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