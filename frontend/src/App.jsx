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
  const [audioUrl, setAudioUrl] = useState('')
  const [transcription, setTranscription] = useState('')
  const [segments, setSegments] = useState([])
  const [streamChunks, setStreamChunks] = useState([])
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('ggml-base.en.bin')
  const [language, setLanguage] = useState('en')
  const [error, setError] = useState('')
  const [recordingTime, setRecordingTime] = useState(0)
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
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording && mediaRecorderRef.current.state === 'recording') {
      // Stop recording
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      
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
            setAudioFile(audioBlob)
            const url = URL.createObjectURL(audioBlob)
            setAudioUrl(url)
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
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      formData.append('model', selectedModel)
      formData.append('language', language)
      formData.append('noise_reduction', 'true')
      formData.append('trim_silence', 'true')
      
      console.log('Sending to server, model:', selectedModel, 'language:', language)
      
      const response = await fetch(`${API_URL}/api/transcribe`, {
        method: 'POST',
        body: formData
      })
      
      console.log('Response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || errorData.error || `Transcription failed (${response.status})`)
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
              setStreamChunks(prev => {
                const newChunks = [...prev, {
                  text: data.text.trim(),
                  timestamp: new Date(data.timestamp).toLocaleTimeString(),
                  fullText: data.fullText || '',
                  speaker: data.speakerChanged ? data.speaker : undefined,
                  speakerChanged: data.speakerChanged || false
                }]
                return newChunks
              })
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
    { code: 'nl', name: 'Dutch' },
    { code: 'af', name: 'Afrikaans' },
    { code: 'sq', name: 'Albanian' },
    { code: 'am', name: 'Amharic' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hy', name: 'Armenian' },
    { code: 'az', name: 'Azerbaijani' },
    { code: 'eu', name: 'Basque' },
    { code: 'be', name: 'Belarusian' },
    { code: 'bn', name: 'Bengali' },
    { code: 'bs', name: 'Bosnian' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'my', name: 'Burmese' },
    { code: 'ca', name: 'Catalan' },
    { code: 'ceb', name: 'Cebuano' },
    { code: 'ny', name: 'Chichewa' },
    { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'zh-tw', name: 'Chinese (Traditional)' },
    { code: 'co', name: 'Corsican' },
    { code: 'hr', name: 'Croatian' },
    { code: 'cs', name: 'Czech' },
    { code: 'da', name: 'Danish' },
    { code: 'dv', name: 'Dhivehi' },
    { code: 'dz', name: 'Dzongkha' },
    { code: 'eo', name: 'Esperanto' },
    { code: 'et', name: 'Estonian' },
    { code: 'tl', name: 'Filipino' },
    { code: 'fi', name: 'Finnish' },
    { code: 'fr', name: 'French' },
    { code: 'fr-ca', name: 'French (Canada)' },
    { code: 'fy', name: 'Frisian' },
    { code: 'gl', name: 'Galician' },
    { code: 'ka', name: 'Georgian' },
    { code: 'de', name: 'German' },
    { code: 'el', name: 'Greek' },
    { code: 'gu', name: 'Gujarati' },
    { code: 'ht', name: 'Haitian Creole' },
    { code: 'ha', name: 'Hausa' },
    { code: 'haw', name: 'Hawaiian' },
    { code: 'he', name: 'Hebrew' },
    { code: 'hi', name: 'Hindi' },
    { code: 'hmn', name: 'Hmong' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'is', name: 'Icelandic' },
    { code: 'ig', name: 'Igbo' },
    { code: 'id', name: 'Indonesian' },
    { code: 'ga', name: 'Irish' },
    { code: 'it', name: 'Italian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'jw', name: 'Javanese' },
    { code: 'kn', name: 'Kannada' },
    { code: 'kk', name: 'Kazakh' },
    { code: 'km', name: 'Khmer' },
    { code: 'rw', name: 'Kinyarwanda' },
    { code: 'ko', name: 'Korean' },
    { code: 'ku', name: 'Kurdish' },
    { code: 'ky', name: 'Kyrgyz' },
    { code: 'lo', name: 'Lao' },
    { code: 'la', name: 'Latin' },
    { code: 'lv', name: 'Latvian' },
    { code: 'lt', name: 'Lithuanian' },
    { code: 'lb', name: 'Luxembourgish' },
    { code: 'mk', name: 'Macedonian' },
    { code: 'mg', name: 'Malagasy' },
    { code: 'ms', name: 'Malay' },
    { code: 'ml', name: 'Malayalam' },
    { code: 'mt', name: 'Maltese' },
    { code: 'mi', name: 'Maori' },
    { code: 'mr', name: 'Marathi' },
    { code: 'mn', name: 'Mongolian' },
    { code: 'ne', name: 'Nepali' },
    { code: 'no', name: 'Norwegian' },
    { code: 'or', name: 'Odia' },
    { code: 'ps', name: 'Pashto' },
    { code: 'fa', name: 'Persian' },
    { code: 'pl', name: 'Polish' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'pt-br', name: 'Portuguese (Brazil)' },
    { code: 'pa', name: 'Punjabi' },
    { code: 'ro', name: 'Romanian' },
    { code: 'ru', name: 'Russian' },
    { code: 'sm', name: 'Samoan' },
    { code: 'gd', name: 'Scots Gaelic' },
    { code: 'sr', name: 'Serbian' },
    { code: 'sn', name: 'Shona' },
    { code: 'sd', name: 'Sindhi' },
    { code: 'si', name: 'Sinhala' },
    { code: 'sk', name: 'Slovak' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'so', name: 'Somali' },
    { code: 'es', name: 'Spanish' },
    { code: 'su', name: 'Sundanese' },
    { code: 'sw', name: 'Swahili' },
    { code: 'sv', name: 'Swedish' },
    { code: 'tg', name: 'Tajik' },
    { code: 'ta', name: 'Tamil' },
    { code: 'tt', name: 'Tatar' },
    { code: 'te', name: 'Telugu' },
    { code: 'th', name: 'Thai' },
    { code: 'bo', name: 'Tibetan' },
    { code: 'tr', name: 'Turkish' },
    { code: 'tk', name: 'Turkmen' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'ur', name: 'Urdu' },
    { code: 'ug', name: 'Uyghur' },
    { code: 'uz', name: 'Uzbek' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'cy', name: 'Welsh' },
    { code: 'xh', name: 'Xhosa' },
    { code: 'yi', name: 'Yiddish' },
    { code: 'yo', name: 'Yoruba' },
    { code: 'zu', name: 'Zulu' },
    { code: 'ace', name: 'Acehnese' },
    { code: 'ach', name: 'Acholi' },
    { code: 'aa', name: 'Afar' },
    { code: 'ak', name: 'Akan' },
    { code: 'an', name: 'Aragonese' },
    { code: 'av', name: 'Avar' },
    { code: 'ay', name: 'Aymara' },
    { code: 'bm', name: 'Bambara' },
    { code: 'ba', name: 'Bashkir' },
    { code: 'bem', name: 'Bemba' },
    { code: 'bho', name: 'Bhojpuri' },
    { code: 'bi', name: 'Bislama' },
    { code: 'br', name: 'Breton' },
    { code: 'bxr', name: 'Buryat' },
    { code: 'yue', name: 'Cantonese' },
    { code: 'cv', name: 'Chuvash' },
    { code: 'crh', name: 'Crimean Tatar' },
    { code: 'din', name: 'Dinka' },
    { code: 'doi', name: 'Dogri' },
    { code: 'dyu', name: 'Dyula' },
    { code: 'fo', name: 'Faroese' },
    { code: 'fj', name: 'Fijian' },
    { code: 'fon', name: 'Fon' },
    { code: 'fur', name: 'Friulian' },
    { code: 'ff', name: 'Fulah' },
    { code: 'gaa', name: 'Ga' },
    { code: 'gn', name: 'Guarani' },
    { code: 'hil', name: 'Hiligaynon' },
    { code: 'iba', name: 'Iban' },
    { code: 'ilo', name: 'Ilocano' },
    { code: 'kab', name: 'Kabyle' },
    { code: 'kal', name: 'Kalaallisut' },
    { code: 'kam', name: 'Kamba' },
    { code: 'kha', name: 'Khasi' },
    { code: 'ki', name: 'Kikuyu' },
    { code: 'kmb', name: 'Kimbundu' },
    { code: 'kok', name: 'Konkani' },
    { code: 'kri', name: 'Krio' },
    { code: 'lad', name: 'Ladino' },
    { code: 'lag', name: 'Langi' },
    { code: 'ln', name: 'Lingala' },
    { code: 'loz', name: 'Lozi' },
    { code: 'lua', name: 'Luba-Lulua' },
    { code: 'lun', name: 'Lunda' },
    { code: 'luo', name: 'Luo' },
    { code: 'lus', name: 'Mizo' },
    { code: 'mad', name: 'Madurese' },
    { code: 'mag', name: 'Magahi' },
    { code: 'mai', name: 'Maithili' },
    { code: 'mak', name: 'Makassar' },
    { code: 'mas', name: 'Masai' },
    { code: 'mfe', name: 'Morisyen' },
    { code: 'mer', name: 'Meru' },
    { code: 'mgh', name: 'Makhuwa-Meetto' },
    { code: 'moh', name: 'Mohawk' },
    { code: 'mos', name: 'Mossi' },
    { code: 'naq', name: 'Nama' },
    { code: 'nap', name: 'Neapolitan' },
    { code: 'nde', name: 'Ndebele (North)' },
    { code: 'nds', name: 'Low German' },
    { code: 'new', name: 'Nepal Bhasa' },
    { code: 'nia', name: 'Nias' },
    { code: 'niu', name: 'Niuean' },
    { code: 'nog', name: 'Nogai' },
    { code: 'nso', name: 'Northern Sotho' },
    { code: 'nus', name: 'Nuer' },
    { code: 'oc', name: 'Occitan' },
    { code: 'osa', name: 'Osage' },
    { code: 'pag', name: 'Pangasinan' },
    { code: 'pap', name: 'Papiamento' },
    { code: 'qu', name: 'Quechua' },
    { code: 'raj', name: 'Rajasthani' },
    { code: 'rap', name: 'Rapanui' },
    { code: 'rm', name: 'Romansh' },
    { code: 'rn', name: 'Rundi' },
    { code: 'rup', name: 'Aromanian' },
    { code: 'sah', name: 'Yakut' },
    { code: 'saq', name: 'Samburu' },
    { code: 'sat', name: 'Santali' },
    { code: 'scn', name: 'Sicilian' },
    { code: 'sco', name: 'Scots' },
    { code: 'sel', name: 'Selkup' },
    { code: 'sg', name: 'Sango' },
    { code: 'shn', name: 'Shan' },
    { code: 'sid', name: 'Sidamo' },
    { code: 'sma', name: 'Sami (Southern)' },
    { code: 'smn', name: 'Sami (Inari)' },
    { code: 'sms', name: 'Sami (Skolt)' },
    { code: 'snk', name: 'Soninke' },
    { code: 'srn', name: 'Sranan Tongo' },
    { code: 'ss', name: 'Swati' },
    { code: 'st', name: 'Sesotho' },
    { code: 'suk', name: 'Sukuma' },
    { code: 'sus', name: 'Susu' },
    { code: 'syl', name: 'Sylheti' },
    { code: 'syr', name: 'Syriac' },
    { code: 'ty', name: 'Tahitian' },
    { code: 'tem', name: 'Temne' },
    { code: 'tet', name: 'Tetum' },
    { code: 'tig', name: 'Tigre' },
    { code: 'tiv', name: 'Tiv' },
    { code: 'tkl', name: 'Tokelau' },
    { code: 'tli', name: 'Tlingit' },
    { code: 'tmh', name: 'Tamashek' },
    { code: 'tog', name: 'Tonga (Nyasa)' },
    { code: 'tpi', name: 'Tok Pisin' },
    { code: 'ts', name: 'Tsonga' },
    { code: 'tum', name: 'Tumbuka' },
    { code: 'tvl', name: 'Tuvalu' },
    { code: 'tw', name: 'Twi' },
    { code: 'tyv', name: 'Tuvinian' },
    { code: 'udm', name: 'Udmurt' },
    { code: 've', name: 'Venda' },
    { code: 'vec', name: 'Venetian' },
    { code: 'war', name: 'Waray' },
    { code: 'wo', name: 'Wolof' },
    { code: 'xal', name: 'Kalmyk' },
    { code: 'yap', name: 'Yapese' },
    { code: 'zap', name: 'Zapotec' },
    { code: 'zen', name: 'Zenaga' },
    { code: 'zha', name: 'Zhuang' },
    { code: 'zun', name: 'Zuni' },
    { code: 'zza', name: 'Zazaki' }
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
                  <div className="recording-active" onClick={stopRecording} style={{ cursor: 'pointer' }}>
                    <div className="recording-timer">{formatTime(recordingTime)}</div>
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
                                opacity: 0.6 + mouseInfluence * 0.4
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
                    <div className="recording-stop-hint">
                      <span>Click anywhere to stop</span>
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
            {audioUrl && (
              <div className="audio-player-card">
                <audio controls src={audioUrl} />
                <button 
                  onClick={clearAll}
                  style={{ 
                    marginTop: '12px', 
                    background: 'transparent', 
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-muted)',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  Clear
                </button>
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
                      {segments.map((segment, index) => (
                        <div key={index} className="segment-item">
                          <span className="segment-time">
                            {segment.start?.toFixed(2) || '0.00'} - {segment.end?.toFixed(2) || '0.00'}
                          </span>
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
                      ))}
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
                streamChunks.map((chunk, index) => (
                  <div key={index} className="stream-chunk" style={{
                    animation: 'slideIn 0.3s ease-out'
                  }}>
                    <div className="chunk-header">
                      <span className="chunk-time">{chunk.timestamp}</span>
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
                ))
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