/** In-memory, scoped batching for private employee thumbnails. Never stores bearer URLs on disk. */
export type PhotoResult = { url: string | null; expiresIn?: number }
type RequestEntry = {
  key: string; path: string; scope: string; generation: number
  resolve: (value: string | null) => void
  reject: (error: unknown) => void
}

export function createEmployeePhotoLoader(
  fetchBatch: (paths: string[]) => Promise<PhotoResult[]>,
) {
  const cache = new Map<string, { url: string; until: number }>()
  const inflight = new Map<string, Promise<string | null>>()
  let queue: RequestEntry[] = []
  let generation = 0
  let active = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    while (active < 2 && queue.length) {
      const first = queue[0]
      const batch = queue.filter(entry => entry.scope === first.scope && entry.generation === first.generation).slice(0, 50)
      const chosen = new Set(batch)
      queue = queue.filter(entry => !chosen.has(entry))
      active++
      void fetchBatch(batch.map(entry => entry.path)).then(results => {
        batch.forEach((entry, index) => {
          if (entry.generation !== generation) { entry.resolve(null); return }
          const result = results[index]
          if (result?.url && (result.expiresIn || 0) > 30) {
            if (cache.size >= 1000) cache.delete(cache.keys().next().value!)
            cache.set(entry.key, { url: result.url, until: Date.now() + (result.expiresIn! - 30) * 1000 })
          }
          entry.resolve(result?.url || null)
        })
      }).catch(error => batch.forEach(entry => {
        if (entry.generation !== generation) entry.resolve(null)
        else entry.reject(error)
      })).finally(() => {
        batch.forEach(entry => { if (entry.generation === generation) inflight.delete(entry.key) })
        active--
        flush()
      })
    }
  }

  return {
    load(scope: string, path: string): Promise<string | null> {
      const key = JSON.stringify([scope, path])
      const cached = cache.get(key)
      if (cached && cached.until > Date.now()) return Promise.resolve(cached.url)
      cache.delete(key)
      const pending = inflight.get(key)
      if (pending) return pending
      const promise = new Promise<string | null>((resolve, reject) => {
        queue.push({ key, path, scope, generation, resolve, reject })
      })
      inflight.set(key, promise)
      if (timer === undefined) timer = setTimeout(flush, 0)
      return promise
    },
    clear() {
      generation++
      cache.clear()
      inflight.clear()
      queue.forEach(entry => entry.resolve(null))
      queue = []
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
