"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { DeliveryWithRelations } from "@/types/database"

type HistoryState = {
  employeeId: string | null
  history: DeliveryWithRelations[]
  loading: boolean
  error: string | null
}

const emptyState: HistoryState = { employeeId: null, history: [], loading: false, error: null }

/** Keep each profile's deliveries bound to the latest selected employee. */
export function useEmployeeHistory(fetchHistory: (employeeId: string) => Promise<DeliveryWithRelations[]>) {
  const [state, setState] = useState<HistoryState>(emptyState)
  const current = useRef({ employeeId: null as string | null, generation: 0 })

  const load = useCallback(async (employeeId: string) => {
    const generation = ++current.current.generation
    current.current.employeeId = employeeId
    setState({ employeeId, history: [], loading: true, error: null })
    try {
      const history = await fetchHistory(employeeId)
      if (current.current.generation !== generation) return
      if (history.some(delivery => delivery.employee_id !== employeeId)) {
        throw new Error("O prontuário recebido não corresponde ao colaborador selecionado. Tente novamente.")
      }
      setState({ employeeId, history, loading: false, error: null })
    } catch (error) {
      if (current.current.generation !== generation) return
      setState({ employeeId, history: [], loading: false, error: error instanceof Error ? error.message : "Falha ao carregar o prontuário." })
    }
  }, [fetchHistory])

  const refresh = useCallback(async (employeeId: string) => {
    // A mutation that finished for a closed profile must not reopen it or
    // overwrite another employee's deliveries.
    if (current.current.employeeId === employeeId) await load(employeeId)
  }, [load])

  const clear = useCallback(() => {
    ++current.current.generation
    current.current.employeeId = null
    setState(emptyState)
  }, [])

  const isCurrent = useCallback((employeeId: string) => current.current.employeeId === employeeId, [])

  useEffect(() => {
    const active = current.current
    return () => { ++active.generation; active.employeeId = null }
  }, [])

  return { ...state, load, refresh, clear, isCurrent }
}
