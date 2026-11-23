import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, defineConfig, type Plugin } from 'vite'

function roomApi(): Plugin {
  return {
    name: 'room-api',
    configureServer(server) {
      server.middlewares.use('/api/room', (req, res) => {
        void handle(req, res)
      })
    },
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const { handleRoom } = await import('./api/room.ts')
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(','))
  }
  const request = new Request('http://127.0.0.1/api/room', {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
  })
  const response = await handleRoom(request)
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.DATABASE_URL ??= env.DATABASE_URL
  process.env.ROOM_SECRET ??= env.ROOM_SECRET
  return {
    plugins: [react(), tailwindcss(), roomApi()],
    worker: { format: 'es' },
  }
})
