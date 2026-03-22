#!/bin/bash

# Start Whisper STT Application
echo "Starting Whisper STT Application..."

# Kill any existing servers on ports 3002 and 5173
echo "Cleaning up existing processes..."
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# Start backend server
echo "Starting backend server on port 3002..."
cd ~/whisper-ui
node server.js > server.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to start
sleep 2

# Check if backend started successfully
if curl -s http://localhost:3002/api/health > /dev/null; then
    echo "✅ Backend server is running on http://localhost:3002"
else
    echo "❌ Failed to start backend server"
    exit 1
fi

# Start frontend server
echo "Starting frontend server..."
cd ~/whisper-ui/frontend
npm run dev -- --host 0.0.0.0 > frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# Wait for frontend to start
sleep 5

# Check if frontend started successfully
if curl -s http://localhost:5173 > /dev/null; then
    echo "✅ Frontend server is running on http://localhost:5173"
    echo ""
    echo "🎉 Whisper STT Application is ready!"
    echo "   Open http://localhost:5173 in your browser"
    echo ""
    echo "To stop the servers:"
    echo "   kill $BACKEND_PID $FRONTEND_PID"
else
    echo "❌ Failed to start frontend server"
    exit 1
fi