import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

function App() {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002'
  
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMode, setStreamingMode] = useState(false)
  const [musicMode, setMusicMode] = useState(false) // Music/lyrics mode
  const [audioFile, setAudioFile] = useState(null)
  const [recordedAudioUrl, setRecordedAudioUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [transcription, setTranscription] = useState('')
  const [segments, setSegments] = useState([])
  const [streamChunks, setStreamChunks] = useState([])
  const [models, setModels] = useState([{ name: 'ink-zero', path: 'ink-zero' }])
  const [selectedModel, setSelectedModel] = useState('ink-zero')
  const [language, setLanguage] = useState('auto')
  const [error, setError] = useState('')
  const [recordingTime, setRecordingTime] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [streamStatus, setStreamStatus] = useState('')
  const [audioLevels, setAudioLevels] = useState(new Array(32).fill(0))
  const [transcriptionHistory, setTranscriptionHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [currentTranscriptionId, setCurrentTranscriptionId] = useState(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 })
  
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animationRef = useRef(null)
  const streamRef = useRef(null)
  const streamingContentRef = useRef(null)
  const autoScrollRef = useRef(true)
  
  useEffect(() => {
    fetchModels()
    fetchHistory()
  }, [])
  
  // Auto-scroll streaming content when new chunks are added
  useEffect(() => {
    if (autoScrollRef.current && streamingContentRef.current) {
      streamingContentRef.current.scrollTop = streamingContentRef.current.scrollHeight
    }
  }, [streamChunks])
  
  const fetchHistory = async () => {
    try {
      const response = await fetch(`${API_URL}/api/transcriptions?limit=20`)
      const data = await response.json()
      setTranscriptionHistory(data)
    } catch (err) {
      console.error('Failed to fetch history:', err)
    }
  }
  
  const loadTranscription = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/transcriptions/${id}`)
      const data = await response.json()
      setCurrentTranscriptionId(id)
      setTranscription(data.full_text || '')
      setSegments(data.segments || [])
      setShowHistory(false)
    } catch (err) {
      console.error('Failed to load transcription:', err)
    }
  }
  
  const deleteTranscription = async (id) => {
    try {
      await fetch(`${API_URL}/api/transcriptions/${id}`, { method: 'DELETE' })
      if (currentTranscriptionId === id) {
        setCurrentTranscriptionId(null)
        setTranscription('')
        setSegments([])
      }
      fetchHistory()
    } catch (err) {
      console.error('Failed to delete transcription:', err)
    }
  }
  
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    }
  }
  
  const copyFullTranscription = () => {
    if (segments.length > 0) {
      const fullText = segments.map(s => s.text).join(' ')
      copyToClipboard(fullText)
    } else {
      copyToClipboard(transcription)
    }
  }
  
  const fetchModels = async () => {
    try {
      const response = await fetch(`${API_URL}/api/models`)
      const data = await response.json()
      setModels(data)
      if (data.length > 0) {
        setSelectedModel(data[0].name)
      }
    } catch (err) {
      console.error('Error fetching models:', err)
    }
  }
  
  const startAudioVisualization = useCallback((stream) => {
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
    analyserRef.current = audioContextRef.current.createAnalyser()
    
    const source = audioContextRef.current.createMediaStreamSource(stream)
    source.connect(analyserRef.current)
    
    analyserRef.current.fftSize = 128
    analyserRef.current.smoothingTimeConstant = 0.7
    const bufferLength = analyserRef.current.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    
    let isActive = true
    
    const updateVisualization = () => {
      if (!isActive) return
      
      analyserRef.current.getByteFrequencyData(dataArray)
      
      // Convert to normalized levels (0-1) with better scaling
      const levels = []
      const step = Math.floor(bufferLength / 32)
      for (let i = 0; i < 32; i++) {
        const index = i * step
        // Average a few bins for smoother visualization
        let sum = 0
        const count = Math.min(3, bufferLength - index)
        for (let j = 0; j < count; j++) {
          sum += dataArray[index + j] || 0
        }
        const avg = sum / count
        // Apply curve for better visual response
        const normalized = avg / 255
        const curved = Math.pow(normalized, 0.8) * 1.2
        levels.push(Math.min(1, curved))
      }
      
      setAudioLevels(levels)
      animationRef.current = requestAnimationFrame(updateVisualization)
    }
    
    updateVisualization()
    
    // Store cleanup function
    audioContextRef.current._cleanup = () => {
      isActive = false
    }
  }, [])
  
  const stopAudioVisualization = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    
    if (audioContextRef.current) {
      // Call cleanup if available
      if (audioContextRef.current._cleanup) {
        audioContextRef.current._cleanup()
      }
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    analyserRef.current = null
    setAudioLevels(new Array(32).fill(0))
  }, [])
  
  const startRecording = async () => {
    try {
      setError('')
      setTranscription('')
      setSegments([])
      setAudioFile(null)
      setAudioUrl('')
      
      // Request high-quality audio with aggressive echo cancellation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { exact: true },
          noiseSuppression: { exact: true },
          autoGainControl: { exact: true },
          sampleRate: 16000,
          channelCount: 1,
          latency: 0,
          // Additional constraints to prevent speaker audio pickup
          googEchoCancellation: { exact: true },
          googAutoGainControl: { exact: true },
          googNoiseSuppression: { exact: true },
          googHighpassFilter: { exact: true },
          googTypingNoiseDetection: { exact: true },
          googAudioMirroring: false
        }
      })
      streamRef.current = stream
      
      // Start audio visualization
      startAudioVisualization(stream)
      
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 16000
      })
      
      audioChunksRef.current = []
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }
      
      mediaRecorderRef.current.start(100)
      setIsRecording(true)
      setRecordingTime(0)
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
      
    } catch (err) {
      setError('Microphone access denied or not available')
      console.error('Error accessing microphone:', err)
    }
  }
  
  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause()
      setIsPaused(true)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      // Stop recording
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsPaused(false)
      
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      
      // Stop stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      stopAudioVisualization()
      
      // Wait a moment for the last audio data, then transcribe
      setTimeout(() => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          
          if (audioBlob && audioBlob.size > 0) {
            const audioUrl = URL.createObjectURL(audioBlob)
            setRecordedAudioUrl(audioUrl) // Save for playback
            setAudioFile(audioBlob)
            setAudioUrl(audioUrl)
            // Auto transcribe
            transcribeAudioFile(audioBlob)
          }
        }
      }, 300)
    }
  }
  
  const saveToDatabase = async (fullText, segmentsData, audioBlob) => {
    try {
      const response = await fetch(`${API_URL}/api/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Transcription ${new Date().toLocaleString()}`,
          audioFileName: 'recording.webm',
          audioFileSize: audioBlob?.size || 0,
          audioDuration: recordingTime,
          fullText,
          language,
          model: selectedModel,
          segments: segmentsData.map((seg, i) => ({
            start: seg.start || i * 5,
            end: seg.end || (i + 1) * 5,
            text: seg.text
          }))
        })
      })
      
      if (response.ok) {
        const saved = await response.json()
        console.log('Saved to database:', saved.id)
        setCurrentTranscriptionId(saved.id)
        fetchHistory()
      }
    } catch (err) {
      console.error('Failed to save to database:', err)
    }
  }
  
  const transcribeAudioFile = async (audioBlob) => {
    console.log('transcribeAudioFile called with blob size:', audioBlob?.size)
    setIsProcessing(true)
    setError('')
    setTranscription('')
    setSegments([])
    
    try {
      // Validate audio blob
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('No audio recorded')
      }
      
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      formData.append('model', selectedModel)
      formData.append('language', language)
      formData.append('noise_reduction', 'true')
      formData.append('trim_silence', 'true')
      
      console.log('Sending to server, model:', selectedModel, 'language:', language, 'size:', audioBlob.size)
      
      const response = await fetch(`${API_URL}/api/transcribe`, {
        method: 'POST',
        body: formData
      })
      
      console.log('Response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Response error:', errorText)
        throw new Error(`Transcription failed (${response.status}): ${errorText}`)
      }
      
      const result = await response.json()
      console.log('Result:', result)
      
      // Clean the transcription text - remove timestamps and metadata
      let cleanText = (result.text || '')
        .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]/g, '')
        .replace(/\[_BEG_\]/g, '')
        .replace(/\[_TT_\d+\]/g, '')
        .replace(/\[BLANK_AUDIO\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      
      setTranscription(cleanText)
      
      // Only include segments if they have meaningful text
      const cleanSegments = (result.segments || []).filter(seg => {
        const text = seg.text?.trim()
        return text && text.length > 2 && /[a-zA-Z]/.test(text)
      })
      setSegments(cleanSegments)
      
      // Store audio for playback
      setRecordedAudioUrl(audioUrl || URL.createObjectURL(audioBlob))
      setAudioFile(audioBlob)
      
      // Save to database
      saveToDatabase(cleanText, cleanSegments, audioBlob)
      
    } catch (err) {
      console.error('Transcription error:', err)
      setError(err.message || 'Transcription failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }
  
  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (file) {
      setAudioFile(file)
      setAudioUrl(URL.createObjectURL(file))
      setError('')
      // Auto-transcribe uploaded file
      transcribeAudioFile(file)
    }
  }
  
  const transcribeAudio = async () => {
    if (!audioFile) {
      setError('Please record or upload an audio file first')
      return
    }
    transcribeAudioFile(audioFile)
  }
  
  const startStreaming = () => {
    setError('')
    setStreamChunks([])
    setStreamStatus('Connecting...')
    setIsStreaming(true)
    
    const eventSource = new EventSource(
      `${API_URL}/api/stream?model=${selectedModel}&language=${language}`
    )
    
    eventSource.onopen = () => {
      // Connection established, wait for status message from server
      console.log('SSE connection opened')
    }
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        switch (data.type) {
          case 'transcription':
            // Only add if there's new text (non-empty after deduplication)
            if (data.text && data.text.trim()) {
              setStreamChunks(prev => [...prev, {
                text: data.text.trim(),
                timestamp: new Date(data.timestamp).toLocaleTimeString(),
                fullText: data.fullText || '',
                language: data.language,
                languageName: data.languageName
              }])
            }
            break
          case 'status':
            setStreamStatus(data.message)
            // Update streaming state based on status
            if (data.message.includes('Listening') || data.message.includes('ready')) {
              setIsStreaming(true)
            }
            break
          case 'error':
            setError(`Streaming error: ${data.message}`)
            setStreamStatus('Error')
            break
          case 'end':
            setStreamStatus('Streaming ended')
            setIsStreaming(false)
            eventSource.close()
            break
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err)
      }
    }
    
    eventSource.onerror = (err) => {
      console.error('EventSource error:', err)
      setError('Lost connection to streaming server')
      setIsStreaming(false)
      setStreamStatus('Disconnected')
      eventSource.close()
    }
    
    window.currentEventSource = eventSource
  }
  
  const stopStreaming = () => {
    if (window.currentEventSource) {
      window.currentEventSource.close()
      window.currentEventSource = null
    }
    
    fetch(`${API_URL}/api/stream/stop`, { method: 'POST' })
      .then(() => {
        setIsStreaming(false)
        setStreamStatus('Stopped')
      })
      .catch(err => {
        console.error('Error stopping stream:', err)
      })
  }
  
  const clearStreaming = () => {
    setStreamChunks([])
    setStreamStatus('')
  }
  
  const clearAll = () => {
    setAudioFile(null)
    setAudioUrl('')
    setTranscription('')
    setSegments([])
    setError('')
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
  }
  
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  
  const languages = [
    { code: 'auto', name: 'Auto Detect' },
    { code: 'en', name: 'English' },
    { code: 'zh', name: 'Chinese' },
    { code: 'de', name: 'German' },
    { code: 'es', name: 'Spanish' },
    { code: 'ru', name: 'Russian' },
    { code: 'ko', name: 'Korean' },
    { code: 'fr', name: 'French' },
    { code: 'ja', name: 'Japanese' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'tr', name: 'Turkish' },
    { code: 'pl', name: 'Polish' },
    { code: 'nl', name: 'Dutch' },
    { code: 'ar', name: 'Arabic' },
    { code: 'cs', name: 'Czech' },
    { code: 'hi', name: 'Hindi' },
    { code: 'ro', name: 'Romanian' },
    { code: 'sv', name: 'Swedish' },
    { code: 'th', name: 'Thai' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'id', name: 'Indonesian' },
    { code: 'el', name: 'Greek' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'fi', name: 'Finnish' },
    { code: 'he', name: 'Hebrew' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'ms', name: 'Malay' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'ca', name: 'Catalan' },
    { code: 'da', name: 'Danish' },
    { code: 'et', name: 'Estonian' },
    { code: 'fa', name: 'Persian' },
    { code: 'hr', name: 'Croatian' },
    { code: 'ka', name: 'Georgian' },
    { code: 'kk', name: 'Kazakh' },
    { code: 'lt', name: 'Lithuanian' },
    { code: 'lv', name: 'Latvian' },
    { code: 'mk', name: 'Macedonian' },
    { code: 'mn', name: 'Mongolian' },
    { code: 'no', name: 'Norwegian' },
    { code: 'sk', name: 'Slovak' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'sq', name: 'Albanian' },
    { code: 'sr', name: 'Serbian' },
    { code: 'uz', name: 'Uzbek' },
    { code: 'az', name: 'Azerbaijani' },
    { code: 'bn', name: 'Bengali' },
    { code: 'gu', name: 'Gujarati' },
    { code: 'kn', name: 'Kannada' },
    { code: 'ml', name: 'Malayalam' },
    { code: 'mr', name: 'Marathi' },
    { code: 'ne', name: 'Nepali' },
    { code: 'pa', name: 'Punjabi' },
    { code: 'si', name: 'Sinhala' },
    { code: 'ta', name: 'Tamil' },
    { code: 'te', name: 'Telugu' },
    { code: 'ur', name: 'Urdu' },
  ]
  
  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo-section">
          <h1 className="logo">Eburon AI</h1>
          <p className="logo-subtitle">Automatic Speech Recognition</p>
        </div>
        
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">Settings</h3>
          
          <div className="control-card">
            <label className="control-label">Model</label>
              <select 
              className="control-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {/* Always show ink-vfast (tiny model) first */}
              <option value="ggml-tiny.en.bin">ink-vfast</option>
              {models.map((model) => {
                // Rename base.en to ink-v1 for display
                let displayName = model.name.replace('ggml-', '').replace('.bin', '')
                if (displayName === 'base.en') {
                  displayName = 'ink-v1'
                } else if (displayName === 'tiny.en') {
                  displayName = 'ink-vfast'
                }
                return (
                  <option key={model.name} value={model.name}>
                    {displayName}
                  </option>
                )
              })}
              {models.length === 0 && (
                <option value="ggml-base.en.bin">ink-v1</option>
              )}
            </select>
          </div>
          
          <div className="control-card">
            <label className="control-label">Language</label>
            <select 
              className="control-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="control-card">
            <label className="control-label">Mode</label>
            <div className="mode-switch">
              <button 
                className={`mode-option ${!streamingMode ? 'active' : ''}`}
                onClick={() => setStreamingMode(false)}
              >
                Record
              </button>
              <button 
                className={`mode-option ${streamingMode ? 'active' : ''}`}
                onClick={() => setStreamingMode(true)}
              >
                Stream
              </button>
            </div>
          </div>
        </div>
        
        {streamingMode && (
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Streaming</h3>
            <div className="streaming-controls">
              {!isStreaming ? (
                <button className="stream-btn start" onClick={startStreaming}>
                  Start Streaming
                </button>
              ) : (
                <button className="stream-btn stop" onClick={stopStreaming}>
                  Stop Streaming
                </button>
              )}
              <button className="stream-btn" onClick={clearStreaming} style={{ background: 'rgba(255,255,255,0.1)' }}>
                Clear
              </button>
            </div>
            <p style={{ 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)', 
              marginTop: '8px',
              textAlign: 'center'
            }}>
              Use headphones to prevent echo
            </p>
            {streamStatus && (
              <div className="streaming-status" style={{ marginTop: '12px' }}>
                <span className={`status-dot ${isStreaming ? 'active' : ''}`}></span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{streamStatus}</span>
              </div>
            )}
            {isStreaming && (
              <div className="streaming-visualizer" style={{ marginTop: '16px' }}>
                <div className="waveform-visualizer">
                  {audioLevels.slice(0, 24).map((level, i) => (
                    <div 
                      key={i} 
                      className="waveform-bar"
                      style={{ 
                        height: `${Math.max(4, level * 50)}px`,
                        opacity: 0.5 + level * 0.5,
                        background: `linear-gradient(180deg, 
                          hsl(${260 + i * 3}, 85%, 60%) 0%, 
                          hsl(${280 + i * 3}, 75%, 50%) 100%)`
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* History Section */}
        <div className="sidebar-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="sidebar-section-title" style={{ margin: 0 }}>History</h3>
            <button 
              onClick={() => { setShowHistory(!showHistory); fetchHistory(); }}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: 'var(--accent-purple)',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              {showHistory ? 'Hide' : 'View All'}
            </button>
          </div>
          
          {showHistory && (
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '8px' }}>
              {transcriptionHistory.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '16px' }}>
                  No transcriptions yet
                </p>
              ) : (
                transcriptionHistory.map((item) => (
                  <div 
                    key={item.id}
                    className="control-card"
                    style={{ 
                      cursor: 'pointer',
                      marginBottom: '8px',
                      padding: '10px',
                      borderLeft: currentTranscriptionId === item.id ? '3px solid var(--accent-purple)' : '1px solid var(--border-glass)'
                    }}
                    onClick={() => loadTranscription(item.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ 
                          fontSize: '0.8rem', 
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: 0
                        }}>
                          {item.title || 'Untitled'}
                        </p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                          {item.full_text?.substring(0, 40)}...
                        </p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                          {new Date(item.created_at * 1000).toLocaleString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(item.full_text || ''); }}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-glass)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.7rem'
                          }}
                          title="Copy"
                        >
                          📋
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteTranscription(item.id); }}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-glass)',
                            color: 'var(--accent-pink)',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.7rem'
                          }}
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="main-content">
        <header className="main-header">
          <div>
            <h2 className="page-title">
              {streamingMode ? 'Real-time Transcription' : 'Speech to Text'}
            </h2>
            <p className="page-subtitle">
              {streamingMode 
                ? 'Live audio transcription using AI' 
                : 'Record or upload audio to transcribe'}
            </p>
          </div>
        </header>
        
        {error && (
          <div className="error-alert">
            {error}
          </div>
        )}
        
        {!streamingMode ? (
          <>
            {/* Recording Card */}
            <div 
              className="recording-card"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setMousePos({
                  x: (e.clientX - rect.left) / rect.width,
                  y: (e.clientY - rect.top) / rect.height
                })
              }}
            >
              <div className="recording-area">
                {isRecording ? (
                  <div className="recording-active">
                    <div className="recording-timer" style={{ opacity: isPaused ? 0.5 : 1 }}>
                      {formatTime(recordingTime)} {isPaused && '(Paused)'}
                    </div>
                    <div className="audio-visualizer-container">
                      <div className="audio-visualizer">
                        {audioLevels.map((level, i) => {
                          const hue = 260 + (i * 2)
                          // Calculate distance from mouse position for interactive effect
                          const barX = i / audioLevels.length
                          const distFromMouse = Math.abs(barX - mousePos.x)
                          const mouseInfluence = Math.max(0, 1 - distFromMouse * 3)
                          const adjustedLevel = Math.min(1, level + mouseInfluence * 0.3)
                          const height = Math.max(3, adjustedLevel * 100)
                          return (
                            <div 
                              key={i} 
                              className="visualizer-bar"
                              style={{ 
                                height: `${height}%`,
                                background: `linear-gradient(180deg, 
                                  hsl(${hue + mouseInfluence * 30}, 90%, 65%) 0%, 
                                  hsl(${hue + 20 + mouseInfluence * 30}, 80%, 55%) 100%)`,
                                boxShadow: adjustedLevel > 0.3 ? `0 0 ${8 + adjustedLevel * 15}px hsla(${hue}, 90%, 65%, ${adjustedLevel * 0.6})` : 'none',
                                opacity: 0.6 + mouseInfluence * 0.4,
                                animation: isPaused ? 'none' : undefined
                              }}
                            />
                          )
                        })}
                      </div>
                      <div className="visualizer-glow" style={{ 
                        opacity: audioLevels.reduce((a, b) => a + b, 0) / audioLevels.length,
                        left: `${mousePos.x * 100}%`
                      }}></div>
                    </div>
                    <div className="recording-controls">
                      {isPaused ? (
                        <button className="recording-btn resume" onClick={resumeRecording}>
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                          Resume
                        </button>
                      ) : (
                        <button className="recording-btn pause" onClick={pauseRecording}>
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                          </svg>
                          Pause
                        </button>
                      )}
                      <button className="recording-btn stop" onClick={stopRecording}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                          <rect x="6" y="6" width="12" height="12" rx="2"/>
                        </svg>
                        Stop & Transcribe
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="recording-idle" onClick={startRecording} style={{ cursor: 'pointer' }}>
                    <div className="mic-ripple-container">
                      <div className="mic-ripple"></div>
                      <div className="mic-ripple delay-1"></div>
                      <div className="mic-ripple delay-2"></div>
                      <button className="mic-button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                          <line x1="12" y1="19" x2="12" y2="23"/>
                          <line x1="8" y1="23" x2="16" y2="23"/>
                        </svg>
                      </button>
                    </div>
                    <div className="recording-idle-text">
                      <p className="idle-title">Click to start recording</p>
                      <p className="idle-subtitle">or upload an audio file below</p>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="upload-zone">
                <label className="upload-button">
                  <input 
                    type="file" 
                    accept="audio/*"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Upload Audio File
                </label>
              </div>
            </div>
            
            {/* Audio Player */}
            {recordedAudioUrl && (
              <div className="audio-player-card">
                <div className="audio-player-header">
                  <span className="audio-player-label">Recorded Audio</span>
                  <span className="audio-player-duration">{formatTime(recordingTime)}</span>
                </div>
                <audio 
                  controls 
                  src={recordedAudioUrl} 
                  style={{ width: '100%', height: '40px' }}
                />
                <div className="audio-player-actions">
                  <button 
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = recordedAudioUrl
                      a.download = `recording-${Date.now()}.webm`
                      a.click()
                    }}
                    style={{ 
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'var(--bg-secondary)', 
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download
                  </button>
                  <button 
                    onClick={clearAll}
                    style={{ 
                      background: 'transparent', 
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            
            {/* Processing indicator or manual transcribe */}
            {isProcessing ? (
              <div className="action-section">
                <div className="processing-indicator">
                  <div className="processing-spinner"></div>
                  <span>Transcribing...</span>
                </div>
              </div>
            ) : audioFile && !transcription ? (
              <div className="action-section">
                <button 
                  className="transcribe-button"
                  onClick={transcribeAudio}
                >
                  Transcribe Again
                </button>
              </div>
            ) : null}
            
            {/* Results */}
            {(transcription || segments.length > 0) && (
              <div className="results-card">
                <div className="results-header">
                  <h3 className="results-title">Transcription</h3>
                  <div className="results-actions">
                    <button 
                      className="action-btn-small"
                      onClick={copyFullTranscription}
                      title="Copy to clipboard"
                    >
                      {copySuccess ? '✓ Copied!' : 'Copy'}
                    </button>
                    {currentTranscriptionId && (
                      <button 
                        className="action-btn-small"
                        onClick={() => deleteTranscription(currentTranscriptionId)}
                        title="Delete transcription"
                        style={{ color: 'var(--accent-pink)' }}
                      >
                        Delete
                      </button>
                    )}
                    <button 
                      className="action-btn-small"
                      onClick={() => {
                        const blob = new Blob([transcription], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = 'transcription.txt'
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      TXT
                    </button>
                    <button 
                      className="action-btn-small"
                      onClick={() => {
                        const srtContent = segments.map((seg, i) => {
                          const start = new Date(seg.start * 1000).toISOString().substr(11, 12).replace('.', ',')
                          const end = new Date(seg.end * 1000).toISOString().substr(11, 12).replace('.', ',')
                          return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`
                        }).join('\n')
                        
                        const blob = new Blob([srtContent], { type: 'text/srt' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = 'transcription.srt'
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      SRT
                    </button>
                  </div>
                </div>
                
                <div className="results-content">
                  <p className="transcription-text">{transcription}</p>
                  
                  {segments.length > 0 && (
                    <div className="segments-list">
                      {segments.map((segment, index) => {
                        const prevSeg = index > 0 ? segments[index - 1] : null
                        const showLang = segment.language && (!prevSeg || prevSeg.language !== segment.language)
                        return (
                          <div key={index} className="segment-item">
                            <div className="segment-header">
                              <span className="segment-time">
                                {segment.start?.toFixed(2) || '0.00'} - {segment.end?.toFixed(2) || '0.00'}
                              </span>
                              {showLang && segment.languageName && (
                                <span className="segment-lang">{segment.languageName}</span>
                              )}
                            </div>
                            <span className="segment-text">{segment.text}</span>
                            <button 
                              onClick={() => copyToClipboard(segment.text)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                padding: '4px 8px',
                                fontSize: '0.75rem'
                              }}
                              title="Copy segment"
                            >
                              📋
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Streaming Mode */
          <div className="streaming-card">
            <div className="streaming-header">
              <h3 className="results-title">Live Transcription</h3>
              <div className="streaming-status">
                <span className={`status-dot ${isStreaming ? 'active' : ''}`}></span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {isStreaming ? 'Listening...' : 'Stopped'}
                </span>
              </div>
            </div>
            
            {isStreaming && (
              <div className="streaming-visualizer-main" style={{ 
                padding: '20px', 
                borderBottom: '1px solid var(--border-glass)',
                display: 'flex',
                justifyContent: 'center'
              }}>
                <div className="circular-visualizer">
                  {(() => {
                    const avgLevel = audioLevels.reduce((a, b) => a + b, 0) / audioLevels.length
                    return (
                      <>
                        <div className="circular-visualizer-ring" style={{
                          transform: `scale(${1 + avgLevel * 0.15})`,
                          borderColor: `rgba(139, 92, 246, ${0.3 + avgLevel * 0.6})`,
                          borderWidth: `${2 + avgLevel * 2}px`
                        }}></div>
                        <div className="circular-visualizer-ring" style={{
                          transform: `scale(${1 + avgLevel * 0.25})`,
                          borderColor: `rgba(59, 130, 246, ${0.3 + avgLevel * 0.6})`,
                          borderWidth: `${2 + avgLevel * 1.5}px`
                        }}></div>
                        <div className="circular-visualizer-ring" style={{
                          transform: `scale(${1 + avgLevel * 0.35})`,
                          borderColor: `rgba(6, 182, 212, ${0.3 + avgLevel * 0.6})`,
                          borderWidth: `${2 + avgLevel}px`
                        }}></div>
                        <div style={{
                          position: 'absolute',
                          width: `${40 + avgLevel * 10}px`,
                          height: `${40 + avgLevel * 10}px`,
                          borderRadius: '50%',
                          background: 'var(--gradient-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: `0 0 ${20 + avgLevel * 40}px rgba(139, 92, 246, ${0.4 + avgLevel * 0.5})`,
                          transition: 'all 0.1s ease'
                        }}>
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                          </svg>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
)}

            {/* Subtitle Display - Real-time animated text */}
            <div className="subtitle-display" style={{
              padding: '40px 30px',
              minHeight: '150px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              borderBottom: '1px solid var(--border-color)',
              background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.03) 0%, transparent 100%)'
            }}>
              {isStreaming ? (
                <div style={{ width: '100%', textAlign: 'left' }}>
                  {streamChunks.length > 0 ? (
                    <div className="subtitle-text" style={{
                      fontSize: '1.6rem',
                      lineHeight: '1.8',
                      color: 'var(--text-primary)',
                      textAlign: 'left'
                    }}>
                      {/* Show words appearing from left to right */}
                      {streamChunks.slice(-3).map((chunk, chunkIndex) => {
                        const words = chunk.text.split(' ')
                        return words.map((word, wordIndex) => (
                          <span 
                            key={`${chunkIndex}-${wordIndex}`}
                            className="subtitle-word"
                            style={{
                              display: 'inline-block',
                              animation: `wordFadeIn 0.2s ease-out forwards`,
                              animationDelay: `${wordIndex * 0.05}s`,
                              opacity: 0
                            }}
                          >
                            {word}{' '}
                          </span>
                        ))
                      })}
                      <span className="subtitle-cursor" style={{
                        display: 'inline-block',
                        width: '3px',
                        height: '1.4em',
                        backgroundColor: 'var(--eburon-primary)',
                        marginLeft: '4px',
                        animation: 'cursorBlink 0.8s ease-in-out infinite',
                        verticalAlign: 'text-bottom',
                        borderRadius: '2px'
                      }}></span>
                    </div>
                  ) : (
                    <div>
                      <p style={{ 
                        color: 'var(--text-muted)', 
                        fontSize: '1.1rem'
                      }}>
                        Speak now...
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ 
                  color: 'var(--text-muted)', 
                  textAlign: 'center',
                  fontSize: '1.1rem'
                }}>
                  Click "Start Streaming" to begin
                </p>
              )}
            </div>
            
            <div 
              className="streaming-content"
              ref={streamingContentRef}
              onScroll={() => {
                if (streamingContentRef.current) {
                  const { scrollTop, scrollHeight, clientHeight } = streamingContentRef.current
                  autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50
                }
              }}
            >
              {streamChunks.length === 0 ? (
                <div className="stream-empty">
                  <p>{isStreaming ? 'Waiting for transcription...' : 'Start streaming to see results here'}</p>
                </div>
              ) : (
                streamChunks.map((chunk, index) => {
                  // Show language badge only when it changes from previous chunk
                  const prevChunk = index > 0 ? streamChunks[index - 1] : null
                  const showLangBadge = chunk.language && (!prevChunk || prevChunk.language !== chunk.language)
                  
                  return (
                    <div key={index} className="stream-chunk" style={{
                      animation: 'slideIn 0.3s ease-out'
                    }}>
                      <div className="chunk-header">
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span className="chunk-time">{chunk.timestamp}</span>
                          {showLangBadge && chunk.languageName && (
                            <span style={{
                              fontSize: '0.65rem',
                              padding: '2px 6px',
                              background: 'var(--eburon-primary)',
                              color: 'white',
                              borderRadius: '4px',
                              fontWeight: 600
                            }}>
                              {chunk.languageName}
                            </span>
                          )}
                        </div>
                        <button 
                          onClick={() => copyToClipboard(chunk.text)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            fontSize: '0.75rem'
                          }}
                        >
                          📋
                        </button>
                      </div>
                      <p className="chunk-text">{chunk.text}</p>
                    </div>
                  )
                })
              )}
            </div>
            
            {streamChunks.length > 0 && (
              <div style={{ padding: '16px', borderTop: '1px solid var(--border-glass)' }}>
                <button 
                  className="action-btn-small"
                  onClick={() => {
                    // Use fullText from last chunk if available, otherwise join chunks
                    const lastChunk = streamChunks[streamChunks.length - 1]
                    const fullText = lastChunk?.fullText || streamChunks.map(chunk => chunk.text).join(' ')
                    const blob = new Blob([fullText], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'streaming-transcription.txt'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Export Transcription
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default App