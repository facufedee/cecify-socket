import express, { Request, Response } from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import * as dotenv from 'dotenv'

dotenv.config()

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000'

const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
})

app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json())

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Socket.io namespaces
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`)

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 3001

httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.io server listening on port ${PORT}`)
})
