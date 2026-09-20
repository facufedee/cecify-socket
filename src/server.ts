import express, { Request, Response } from 'express'
import { createServer } from 'http'
import { timingSafeEqual } from 'crypto'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import * as dotenv from 'dotenv'

dotenv.config()

// Mismo JWT_SECRET que la app Next (Vercel). SOCKET_SECRET autentica las llamadas
// server-a-server de la app a /internal/emit.
const JWT_SECRET = process.env.JWT_SECRET
const SOCKET_SECRET = process.env.SOCKET_SECRET
if (!JWT_SECRET || !SOCKET_SECRET) {
  console.error('Faltan variables de entorno: JWT_SECRET y SOCKET_SECRET son obligatorias')
  process.exit(1)
}

const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Eventos que la app puede emitir a un usuario
const ALLOWED_EVENTS = new Set(['message:new', 'match:created'])

const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
})

app.use(cors({ origin: CORS_ORIGINS }))
app.use(express.json({ limit: '20kb' }))

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const secretMatches = (given: unknown) => {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(SOCKET_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

// La app Next emite eventos a un usuario despues de guardar algo en la base
app.post('/internal/emit', (req: Request, res: Response) => {
  if (!secretMatches(req.headers['x-socket-secret'])) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const { userId, event, payload } = (req.body ?? {}) as {
    userId?: unknown
    event?: unknown
    payload?: unknown
  }
  if (typeof userId !== 'string' || !UUID_RE.test(userId) || typeof event !== 'string' || !ALLOWED_EVENTS.has(event)) {
    res.status(400).json({ error: 'bad request' })
    return
  }

  io.to(`user:${userId}`).emit(event, payload)
  res.json({ ok: true })
})

// Cada conexion tiene que traer un JWT valido: la identidad sale del token, no del cliente
io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (typeof token !== 'string') return next(new Error('unauthorized'))

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId?: string }
    if (!payload.userId || !UUID_RE.test(payload.userId)) return next(new Error('unauthorized'))
    socket.data.userId = payload.userId
    next()
  } catch {
    next(new Error('unauthorized'))
  }
})

io.on('connection', (socket) => {
  const userId = socket.data.userId as string
  socket.join(`user:${userId}`)
  // La app solo confia en el socket (y deja de hacer polling rapido) cuando recibe esto
  socket.emit('ready')
  console.log(`✅ ${userId} conectado (${socket.id})`)

  // "escribiendo...": se reenvia a la otra persona. Throttle simple contra spam.
  let windowStart = Date.now()
  let count = 0
  socket.on('typing', (data: unknown) => {
    const now = Date.now()
    if (now - windowStart > 1000) {
      windowStart = now
      count = 0
    }
    if (++count > 5) return

    const { toUserId, conversationId, typing } = (data ?? {}) as {
      toUserId?: unknown
      conversationId?: unknown
      typing?: unknown
    }
    if (
      typeof toUserId !== 'string' || !UUID_RE.test(toUserId) ||
      typeof conversationId !== 'string' || !UUID_RE.test(conversationId) ||
      typeof typing !== 'boolean'
    ) {
      return
    }
    io.to(`user:${toUserId}`).emit('user:typing', { fromUserId: userId, conversationId, typing })
  })

  socket.on('disconnect', () => {
    console.log(`❌ ${userId} desconectado (${socket.id})`)
  })
})

const PORT = process.env.PORT || 3001

httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.io server listening on port ${PORT}`)
})
