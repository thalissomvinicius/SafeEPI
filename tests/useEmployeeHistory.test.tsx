import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useEmployeeHistory } from "@/hooks/useEmployeeHistory"
import type { DeliveryWithRelations } from "@/types/database"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const delivery = (employeeId: string) => ({ id: `delivery-${employeeId}`, employee_id: employeeId }) as DeliveryWithRelations

describe("employee-bound profile history", () => {
  it("ignores a slow employee A response after employee B has opened", async () => {
    const first = deferred<DeliveryWithRelations[]>()
    const second = deferred<DeliveryWithRelations[]>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useEmployeeHistory(fetch))
    act(() => { void result.current.load("A"); void result.current.load("B") })
    await act(async () => { second.resolve([delivery("B")]); await second.promise })
    await act(async () => { first.resolve([delivery("A")]); await first.promise })
    expect(result.current.employeeId).toBe("B")
    expect(result.current.history).toEqual([delivery("B")])
    expect(result.current.loading).toBe(false)
  })

  it("clears A's history immediately and shows a B error without retaining A's records", async () => {
    const second = deferred<DeliveryWithRelations[]>()
    const fetch = vi.fn().mockResolvedValueOnce([delivery("A")]).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useEmployeeHistory(fetch))
    await act(async () => { await result.current.load("A") })
    act(() => { void result.current.load("B") })
    expect(result.current.history).toEqual([])
    expect(result.current.loading).toBe(true)
    await act(async () => { second.reject(new Error("Sem conexão")); await second.promise.catch(() => {}) })
    expect(result.current.history).toEqual([])
    expect(result.current.error).toBe("Sem conexão")
    expect(result.current.employeeId).toBe("B")
  })

  it("does not refresh a closed or replaced profile when an old mutation completes", async () => {
    const fetch = vi.fn(async (id: string) => [delivery(id)])
    const { result } = renderHook(() => useEmployeeHistory(fetch))
    await act(async () => { await result.current.load("A"); await result.current.load("B") })
    await act(async () => { await result.current.refresh("A") })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.history).toEqual([delivery("B")])
    act(() => result.current.clear())
    await act(async () => { await result.current.refresh("B") })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.employeeId).toBeNull()
  })

  it("ignores an in-flight request after the profile is closed", async () => {
    const pending = deferred<DeliveryWithRelations[]>()
    const { result } = renderHook(() => useEmployeeHistory(() => pending.promise))
    act(() => { void result.current.load("A"); result.current.clear() })
    await act(async () => { pending.resolve([delivery("A")]); await pending.promise })
    expect(result.current.history).toEqual([])
    expect(result.current.employeeId).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it("rejects deliveries belonging to another employee", async () => {
    const { result } = renderHook(() => useEmployeeHistory(async () => [delivery("A")]))
    await act(async () => { await result.current.load("B") })
    expect(result.current.history).toEqual([])
    expect(result.current.error).toContain("não corresponde")
  })

  it("allows the latest refresh for the same employee to win", async () => {
    const first = deferred<DeliveryWithRelations[]>()
    const second = deferred<DeliveryWithRelations[]>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useEmployeeHistory(fetch))
    act(() => { void result.current.load("A"); void result.current.refresh("A") })
    await act(async () => { second.resolve([]); await second.promise })
    await act(async () => { first.resolve([delivery("A")]); await first.promise })
    expect(result.current.history).toEqual([])
    expect(result.current.error).toBeNull()
  })
})
