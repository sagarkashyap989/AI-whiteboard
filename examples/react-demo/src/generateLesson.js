/** Browser helper — talks only to the Vite proxy, never to api.x.ai. */
export async function generateLesson(prompt) {
  const res = await fetch('/api/generate-lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Generate failed (${res.status})`)
  }
  if (!data.lesson) throw new Error('No lesson in response')
  return data.lesson
}
