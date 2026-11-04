import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmployeePhotoLoader } from "@/lib/employeePhotoLoader"

afterEach(() => vi.useRealTimers())
describe("private photo batching", () => {
  it("groups a visible page into one request and reuses unexpired URLs", async () => {
    vi.useFakeTimers()
    const transport = vi.fn(async (paths: string[]) => paths.map(path => ({ url: `https://private.test/${path}`, expiresIn: 3600 })))
    const loader = createEmployeePhotoLoader(transport)
    const page = Array.from({ length: 50 }, (_, i) => loader.load("user:company", `photo-${i}`))
    await vi.runAllTimersAsync()
    expect(await Promise.all(page)).toHaveLength(50)
    expect(transport).toHaveBeenCalledTimes(1)
    await expect(loader.load("user:company", "photo-0")).resolves.toContain("photo-0")
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it("bounds batch size and simultaneous requests with 600 photos", async () => {
    vi.useFakeTimers()
    let concurrent = 0
    let peak = 0
    const transport = vi.fn(async (paths: string[]) => {
      concurrent++
      peak = Math.max(peak, concurrent)
      await new Promise(resolve => setTimeout(resolve, 10))
      concurrent--
      return paths.map(() => ({ url: null }))
    })
    const loader = createEmployeePhotoLoader(transport)
    const photos = Array.from({ length: 600 }, (_, i) => loader.load("scope", `${i}`))
    await vi.runAllTimersAsync()
    await Promise.all(photos)
    expect(transport).toHaveBeenCalledTimes(12)
    expect(peak).toBeLessThanOrEqual(2)
    expect(transport.mock.calls.every(([paths]) => paths.length <= 50)).toBe(true)
  })

  it("does not reuse another account/company cache and refreshes before expiration", async () => {
    vi.useFakeTimers()
    const transport = vi.fn(async () => [{ url: "signed", expiresIn: 60 }])
    const loader = createEmployeePhotoLoader(transport)
    const a = loader.load("a", "same-path")
    await vi.runAllTimersAsync(); await a
    const b = loader.load("b", "same-path")
    await vi.runAllTimersAsync(); await b
    expect(transport).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(31000)
    const expired = loader.load("a", "same-path")
    await vi.runAllTimersAsync(); await expired
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it("discards an in-flight result after logout or context reset", async () => {
    vi.useFakeTimers()
    let finish!: (value: Array<{ url: string; expiresIn: number }>) => void
    const transport = vi.fn(() => new Promise<Array<{ url: string; expiresIn: number }>>(resolve => { finish = resolve }))
    const loader = createEmployeePhotoLoader(transport)
    const old = loader.load("a", "photo")
    await vi.runAllTimersAsync()
    loader.clear()
    finish([{ url: "old-account-url", expiresIn: 3600 }])
    await expect(old).resolves.toBeNull()
  })
})
