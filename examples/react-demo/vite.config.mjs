import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveLlmConfig,
  generateLessonFromLlm,
  readJsonBody,
  sendJson,
} from './server/generateLessonApi.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const monorepoRoot = path.resolve(__dirname, '../..')

function lessonGenerateApiPlugin() {
  return {
    name: 'lesson-generate-api',
    configureServer(server) {
      // Load repo-root .env — empty prefix includes non-VITE_ vars
      const env = {
        ...loadEnv(server.config.mode, monorepoRoot, ''),
        ...loadEnv(server.config.mode, __dirname, ''),
        ...process.env,
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/api/generate-lesson') return next()
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }

        try {
          if (!resolveLlmConfig(env)) {
            sendJson(res, 503, {
              error:
                'Missing GEMINI_API_KEY (or GROKE_API_KEY) in repo-root .env. Set GEMINI_MODEL too (e.g. gemini-2.0-flash).',
            })
            return
          }

          const body = await readJsonBody(req)
          const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
          if (!prompt) {
            sendJson(res, 400, { error: 'prompt is required' })
            return
          }

          const lesson = await generateLessonFromLlm(env, prompt)
          if (!lesson || !Array.isArray(lesson.actions)) {
            sendJson(res, 502, { error: 'Model returned JSON without an actions array' })
            return
          }
          sendJson(res, 200, { lesson })
        } catch (e) {
          sendJson(res, 502, { error: e.message || String(e) })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lessonGenerateApiPlugin()],
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  envDir: monorepoRoot,
})
