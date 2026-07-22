"use client"

import { useState } from "react"
import { Fingerprint, Trash2 } from "lucide-react"

import { FingerprintCommandPanel } from "@/components/biometrics/FingerprintCommandPanel"
import { toast } from "@/lib/toast"

export function FingerprintEnrollmentManager({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [operation, setOperation] = useState<"enroll" | "delete">("enroll")

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
        <button type="button" onClick={() => setOperation("enroll")} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-black uppercase tracking-widest ${operation === "enroll" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>
          <Fingerprint className="h-4 w-4" /> Cadastrar
        </button>
        <button type="button" onClick={() => setOperation("delete")} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-black uppercase tracking-widest ${operation === "delete" ? "bg-white text-red-700 shadow-sm" : "text-slate-500"}`}>
          <Trash2 className="h-4 w-4" /> Remover
        </button>
      </div>
      <FingerprintCommandPanel
        key={operation}
        employeeId={employeeId}
        employeeName={employeeName}
        operation={operation}
        onCompleted={(evidence) => toast.success(operation === "enroll"
          ? `Digital cadastrada. Evidência ${evidence.code}.`
          : `Cadastro digital removido. Evidência ${evidence.code}.`)}
      />
    </div>
  )
}
