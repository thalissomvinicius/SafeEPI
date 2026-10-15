"use client"

import { useState, useRef, useEffect } from "react"
import { Camera, Users, Search, CheckCircle2, ExternalLink, FileDown, Loader2, ArrowRightLeft, PenLine } from "lucide-react"
import SignatureCanvas from "react-signature-canvas"
import { format } from "date-fns"
import { api } from "@/services/api"
import type { Employee, PPE, DeliveryWithRelations, Workplace } from "@/types/database"
import { SignatureCapture } from "@/components/ui/SignatureCapture"
import { BottomSheet } from "@/components/ui/BottomSheet"
import { formatCpf } from "@/utils/cpf"
import { generateAuditCode } from "@/utils/auditCode"
import { formatDeliveryDate } from "@/lib/dateOnly"
import { toast } from "@/lib/toast"
import { getSignatureDataUrl } from "@/utils/signatureCanvas"
import { imageDataUrlToFile, fetchImageDataUrl } from "@/utils/imageDataUrl"
import { canRestockReturn, confirmWholeReturn, outstandingReturnQuantity, replacementReason, type ReturnOperationProgress } from "@/lib/returnWorkflow"
import { LoadingState } from "@/components/ui/LoadingState"
import { DataLoadError } from "@/components/ui/DataLoadError"
import { Button } from "@/components/ui/button"

type ReturnWorkflow = {
  employee: Employee
  delivery: DeliveryWithRelations
  newPpe?: PPE
  quantity: number
  motive: string
  restock: boolean
  authMethod: "manual" | "manual_facial"
  signature: string
  signatureFile: File
  photo?: string
  workplaceName: string
  timestamp: string
  replacementKey: string
  validationHash: string
  progress: ReturnOperationProgress
  replacement?: DeliveryWithRelations
  pdf?: Blob
  fileName: string
  archived: boolean
}

const motives = [
  { value: "Desgaste/Validade", label: "Desgaste ou vencimento" },
  { value: "Dano", label: "Dano ou quebra" },
  { value: "Perda", label: "Perda ou extravio" },
  { value: "Demissão", label: "Desligamento" },
  { value: "Erro de Entrega", label: "Erro de entrega" },
]

export default function ReturnsPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [activeDeliveries, setActiveDeliveries] = useState<DeliveryWithRelations[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const historyGeneration = useRef(0)
  const selectedEmployeeId = useRef<string | null>(null)
  const [showEmployeePicker, setShowEmployeePicker] = useState(true)
  const [deliveryToReturn, setDeliveryToReturn] = useState<DeliveryWithRelations | null>(null)
  const [returnMotive, setReturnMotive] = useState("Desgaste/Validade")
  const [restock, setRestock] = useState(false)
  const [replacementPpeId, setReplacementPpeId] = useState("")
  const [replacementSearchTerm, setReplacementSearchTerm] = useState("")
  const [authMethod, setAuthMethod] = useState<"manual" | "manual_facial">("manual")
  const [signatureOpen, setSignatureOpen] = useState(false)
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  const saving = useRef(false)
  const workflow = useRef<ReturnWorkflow | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [phaseLabel, setPhaseLabel] = useState("")
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [lastPdfFileName, setLastPdfFileName] = useState("recibo_baixa.pdf")
  const [operationLocked, setOperationLocked] = useState(false)

  useEffect(() => {
    let current = true
    async function loadData() {
      try {
        setLoadError(null)
        const [empData, ppeData, wpData] = await Promise.all([
          api.getEmployees({ signPhotos: false }), api.getPpes(), api.getWorkplaces(),
        ])
        if (!current) return
        setEmployees(empData.filter(employee => employee.active))
        setPpes(ppeData.filter(ppe => ppe.active))
        setWorkplaces(wpData)
      } catch (error) {
        if (current) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os cadastros.")
      } finally {
        if (current) setLoading(false)
      }
    }
    void loadData()
    return () => { current = false; historyGeneration.current += 1 }
  }, [reloadVersion])

  useEffect(() => () => { if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl) }, [lastPdfUrl])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (workflow.current?.progress.attempted && !workflow.current.archived) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  const selectEmployee = async (employee: Employee) => {
    if (saving.current || (workflow.current?.progress.attempted && !workflow.current.archived)) return
    const generation = ++historyGeneration.current
    selectedEmployeeId.current = employee.id
    setSelectedEmployee(employee)
    setShowEmployeePicker(false)
    setActiveDeliveries([])
    setHistoryError(null)
    setLoadingDeliveries(true)
    setDeliveryToReturn(null)
    setSignatureOpen(false)
    setIsSaved(false)
    setSaveError(null)
    workflow.current = null
    setOperationLocked(false)
    setLastPdfUrl(null)
    try {
      const history = await api.getEmployeeHistory(employee.id, { signAssets: false })
      if (generation !== historyGeneration.current || selectedEmployeeId.current !== employee.id) return
      setActiveDeliveries(history.filter(delivery => delivery.employee_id === employee.id && outstandingReturnQuantity(delivery) > 0))
    } catch (error) {
      if (generation === historyGeneration.current) setHistoryError(error instanceof Error ? error.message : "Falha ao consultar os EPIs em posse.")
    } finally {
      if (generation === historyGeneration.current) setLoadingDeliveries(false)
    }
  }

  const startReturn = (delivery: DeliveryWithRelations) => {
    if (loadingDeliveries || delivery.employee_id !== selectedEmployeeId.current || outstandingReturnQuantity(delivery) <= 0) return
    workflow.current = null
    setOperationLocked(false)
    setDeliveryToReturn(delivery)
    setReturnMotive("Desgaste/Validade")
    setRestock(false)
    setReplacementPpeId("")
    setReplacementSearchTerm("")
    setAuthMethod("manual")
    setSaveError(null)
  }

  const needsReplacement = returnMotive !== "Demissão" && returnMotive !== "Erro de Entrega"
  const quantity = deliveryToReturn ? outstandingReturnQuantity(deliveryToReturn) : 0
  const selectedPpe = ppes.find(ppe => ppe.id === replacementPpeId)
  const filteredPpes = ppes.filter(ppe => `${ppe.name} ${ppe.ca_number || ""}`.toLowerCase().includes(replacementSearchTerm.toLowerCase()))
  const filteredEmployees = employees.filter(employee => `${employee.full_name} ${employee.cpf}`.toLowerCase().includes(searchTerm.toLowerCase()))

  const executeWorkflow = async (operation: ReturnWorkflow) => {
    if (saving.current) return
    saving.current = true
    setIsSaving(true)
    setSaveError(null)
    try {
      if (selectedEmployeeId.current !== operation.employee.id || operation.delivery.employee_id !== operation.employee.id) {
        throw new Error("Selecione novamente o colaborador antes de confirmar.")
      }
      if (operation.authMethod === "manual_facial" && !operation.photo) {
        setPhaseLabel("Carregando a foto de apoio")
        const photoSource = operation.employee.photo_storage_path || operation.employee.photo_url
        if (!photoSource) throw new Error("O colaborador não possui foto. Escolha assinatura manual.")
        const photoUrl = await api.getPrivateAssetUrl(photoSource, "download", undefined, "biometric_photos")
        operation.photo = await fetchImageDataUrl(photoUrl, { required: true, label: "foto cadastral" }) || undefined
        if (!operation.photo) throw new Error("Não foi possível carregar a foto. A baixa ainda não foi realizada.")
      }

      setPhaseLabel(operation.progress.attempted ? "Conferindo o resultado da baixa" : "Registrando a baixa")
      setOperationLocked(true)
      await confirmWholeReturn(operation.delivery, operation.employee.id, operation.motive, operation.progress,
        async () => (await api.getEmployeeHistory(operation.employee.id, { signAssets: false })).find(delivery => delivery.id === operation.delivery.id),
        () => api.returnDelivery(operation.delivery.id, operation.motive, {
          quantity: operation.quantity, restock: operation.restock, employeeId: operation.employee.id,
          expectedReturnedQuantity: Number(operation.delivery.returned_quantity || 0),
        }),
      )
      if (operation.newPpe && !operation.replacement) {
        setPhaseLabel("Baixa confirmada · registrando a reposição")
        operation.replacement = await api.saveDelivery({
          employee_id: operation.employee.id, ppe_id: operation.newPpe.id,
          third_party_id: operation.employee.third_party_id || null,
          workplace_id: operation.employee.workplace_id, reason: replacementReason(operation.motive),
          quantity: operation.quantity, ip_address: "Terminal de Baixas", auth_method: operation.authMethod,
          signature_url: null, delivery_date: operation.timestamp,
        }, operation.signatureFile, undefined, { idempotencyKey: operation.replacementKey }) as DeliveryWithRelations
      }
      if (!operation.pdf) {
        setPhaseLabel("Movimentação confirmada · preparando o recibo")
        const { generateReturnPDF } = await import("@/utils/pdfGenerator")
        operation.pdf = await generateReturnPDF({
          employeeName: operation.employee.full_name, employeeCpf: operation.employee.cpf,
          workplaceName: operation.workplaceName, returnedItemName: operation.delivery.ppe?.name || "EPI",
          returnMotive: operation.motive, returnedQuantity: operation.quantity,
          newItemName: operation.newPpe?.name, newItemCa: operation.newPpe?.ca_number,
          newItemQuantity: operation.newPpe ? operation.quantity : undefined,
          stockDestination: operation.motive === "Perda" ? "Sem retorno físico (perda/extravio)" : operation.restock ? "Disponível após conferência de reutilização" : "Fora do estoque disponível",
          authMethod: operation.authMethod, signatureBase64: operation.signature,
          photoBase64: operation.photo, validationHash: operation.validationHash,
        })
        setLastPdfUrl(URL.createObjectURL(operation.pdf))
        setLastPdfFileName(operation.fileName)
      }
      if (!operation.archived) {
        setPhaseLabel("Movimentação confirmada · arquivando o recibo")
        await api.archiveSignedDocument({
          documentType: "return", employeeId: operation.employee.id, deliveryId: operation.delivery.id,
          deliveryIds: [operation.delivery.id, ...(operation.replacement ? [operation.replacement.id] : [])],
          fileName: operation.fileName, pdfBlob: operation.pdf, authMethod: operation.authMethod,
          signatureUrl: operation.replacement?.signature_url || undefined,
          metadata: {
            validationHash: operation.validationHash, returnMotive: operation.motive,
            returnedPpeId: operation.delivery.ppe_id, returnedPpeName: operation.delivery.ppe?.name || "EPI",
            returnedQuantity: operation.quantity, restock: operation.restock,
            replacementPpeId: operation.newPpe?.id, replacementPpeName: operation.newPpe?.name,
            replacementQuantity: operation.newPpe ? operation.quantity : 0, workplaceName: operation.workplaceName,
          },
        })
        operation.archived = true
      }
      setIsSaved(true)
      setSignatureOpen(false)
      setPhaseLabel("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível concluir a operação."
      const progress = operation.progress.confirmed
        ? "A baixa já está confirmada. Retome abaixo para concluir a reposição ou o recibo, sem repetir a baixa."
        : operation.progress.attempted ? "A confirmação da baixa ficou pendente. Ao retomar, o sistema consultará o resultado antes de continuar." : "Nenhuma baixa foi confirmada."
      setSaveError(`${message} ${progress}`)
      setSignatureOpen(false)
      setPhaseLabel("")
    } finally {
      saving.current = false
      setIsSaving(false)
      setOperationLocked(operation.progress.attempted)
    }
  }

  const saveReturn = () => {
    if (saving.current || !selectedEmployee || !deliveryToReturn) return
    if (workflow.current) { void executeWorkflow(workflow.current); return }
    try {
      if (deliveryToReturn.employee_id !== selectedEmployee.id || selectedEmployeeId.current !== selectedEmployee.id) throw new Error("O item não pertence ao colaborador selecionado.")
      if (needsReplacement && !selectedPpe) throw new Error("Selecione o EPI de reposição.")
      if (needsReplacement && selectedPpe && Number(selectedPpe.current_stock || 0) < quantity) throw new Error("Estoque insuficiente para repor a quantidade baixada.")
      const signature = getSignatureDataUrl(sigCanvas.current)
      if (!signature) throw new Error("A assinatura é obrigatória.")
      // Validate the image locally before any mutation. fetch(data:) violates CSP.
      const signatureFile = imageDataUrlToFile(signature, "signature")
      const safeName = selectedEmployee.full_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_")
      const operation: ReturnWorkflow = {
        employee: selectedEmployee, delivery: deliveryToReturn, newPpe: needsReplacement ? selectedPpe : undefined,
        quantity, motive: returnMotive, restock: canRestockReturn(returnMotive) && restock,
        authMethod, signature, signatureFile, workplaceName: workplaces.find(place => place.id === selectedEmployee.workplace_id)?.name || "Sede",
        timestamp: new Date().toISOString(), replacementKey: crypto.randomUUID(), validationHash: generateAuditCode(),
        progress: { attempted: false, confirmed: false }, fileName: `Recibo_Baixa_${safeName}_${format(new Date(), "ddMMyyyy")}.pdf`, archived: false,
      }
      workflow.current = operation
      void executeWorkflow(operation)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Confira os dados da baixa.") }
  }

  if (loading) return <LoadingState variant="page" label="Carregando devoluções" detail="Buscando colaboradores e equipamentos." />
  if (loadError) return <DataLoadError title="Devoluções temporariamente indisponíveis" message={loadError} onRetry={() => { setLoading(true); setReloadVersion(version => version + 1) }} />

  if (isSaved) return (
    <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-5 px-4 py-8 text-center">
      <CheckCircle2 className="h-14 w-14 text-emerald-600" aria-hidden="true" />
      <div><h1 className="text-2xl font-semibold text-slate-900">Baixa concluída</h1><p className="mt-2 text-sm text-slate-600">Movimentação confirmada e recibo assinado arquivado.</p></div>
      {lastPdfUrl && <div className="grid w-full gap-3 sm:grid-cols-2">
        <a href={lastPdfUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><ExternalLink className="h-4 w-4" />Visualizar recibo</a>
        <a href={lastPdfUrl} download={lastPdfFileName} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 text-sm font-semibold text-white"><FileDown className="h-4 w-4" />Baixar PDF</a>
      </div>}
      <button className="min-h-12 rounded-xl px-5 text-sm font-semibold text-[#2563EB]" onClick={() => { if (selectedEmployee) void selectEmployee(selectedEmployee) }}>Registrar outra baixa</button>
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-24 md:p-6 md:pb-8">
      <header><div className="flex items-center gap-2"><ArrowRightLeft className="h-6 w-6 shrink-0 text-[#2563EB]" /><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Baixas e substituições</h1></div><p className="mt-2 text-sm text-slate-600">Confira o equipamento, o destino e a reposição antes de colher a assinatura.</p></header>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <section aria-label="Selecionar colaborador" className={`${showEmployeePicker ? "flex" : "hidden lg:flex"} min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white lg:max-h-[70dvh]`}>
          <div className="border-b border-slate-100 p-4"><label htmlFor="return-employee-search" className="mb-2 block text-sm font-medium text-slate-700">Colaborador</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input id="return-employee-search" type="search" placeholder="Nome ou CPF" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-base" /></div></div>
          <div className="max-h-[42dvh] overflow-y-auto overscroll-contain p-2 lg:max-h-none">
            {!filteredEmployees.length && <p className="p-4 text-sm text-slate-500">Nenhum colaborador encontrado.</p>}
            {filteredEmployees.map(employee => <button key={employee.id} disabled={isSaving || operationLocked} onClick={() => void selectEmployee(employee)} aria-pressed={selectedEmployee?.id === employee.id} className={`mb-1 flex min-h-16 w-full min-w-0 flex-col justify-center rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${selectedEmployee?.id === employee.id ? "border-[#2563EB]/30 bg-[#2563EB]/10" : "border-transparent hover:bg-slate-50"}`}><span className="w-full break-words text-sm font-semibold text-slate-800">{employee.full_name}</span><span className="mt-1 text-xs text-slate-500">{formatCpf(employee.cpf)}</span></button>)}
          </div>
        </section>
        <section aria-label="Equipamentos e baixa" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          {!selectedEmployee ? <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center text-slate-500"><Users className="h-10 w-10 text-slate-300" /><p className="max-w-xs text-sm">Selecione um colaborador para consultar os equipamentos em posse.</p></div> : <>
            <div className="mb-5 flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 pb-4"><div className="min-w-0"><p className="text-xs font-medium text-slate-500">Colaborador selecionado</p><h2 className="mt-1 break-words text-base font-semibold text-slate-900">{selectedEmployee.full_name}</h2></div><button disabled={isSaving || operationLocked} onClick={() => setShowEmployeePicker(true)} className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-medium disabled:opacity-50 lg:hidden">Trocar</button></div>
            {loadingDeliveries ? <div role="status" className="flex items-center gap-3 py-6 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />Consultando equipamentos…</div> : historyError ? <DataLoadError title="Histórico indisponível" message={historyError} onRetry={() => void selectEmployee(selectedEmployee)} /> : !deliveryToReturn ? <div className="space-y-3">
              {!activeDeliveries.length && <p className="py-5 text-sm text-slate-500">Nenhum EPI pendente de devolução.</p>}
              {activeDeliveries.map(delivery => <article key={delivery.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold text-slate-800">{delivery.ppe?.name || "EPI"}</h3><p className="mt-1 text-xs text-slate-500">Entregue em {formatDeliveryDate(delivery.delivery_date)} · CA {delivery.ppe?.ca_number || "—"}</p><p className="mt-2 text-sm font-medium text-slate-700">Em posse: {outstandingReturnQuantity(delivery)} unidade(s)</p></div><button onClick={() => startReturn(delivery)} className="min-h-12 shrink-0 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white">Registrar baixa</button></article>)}
            </div> : <div className="space-y-5">
              <div className="rounded-xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><h3 className="break-words text-base font-semibold text-slate-900">{deliveryToReturn.ppe?.name || "EPI"}</h3><button disabled={isSaving || operationLocked} onClick={() => { workflow.current = null; setDeliveryToReturn(null); setSaveError(null) }} className="min-h-11 shrink-0 px-2 text-sm font-medium text-slate-600 disabled:opacity-50">Cancelar</button></div><p className="mt-2 text-sm text-slate-700">Baixar as <strong>{quantity} unidade(s)</strong> ainda em posse nesta entrega.</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Esta operação encerra o saldo deste registro. Se houver reposição, a nova entrega terá a mesma quantidade.</p></div>
              <fieldset disabled={isSaving || operationLocked} className="space-y-3 disabled:opacity-60"><legend className="mb-2 text-sm font-semibold text-slate-800">Motivo da baixa</legend><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{motives.map(motive => <button type="button" key={motive.value} aria-pressed={returnMotive === motive.value} onClick={() => { workflow.current = null; setReturnMotive(motive.value); setRestock(false); setSaveError(null) }} className={`min-h-12 rounded-xl border px-3 py-3 text-left text-sm font-medium ${returnMotive === motive.value ? "border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB]" : "border-slate-200 text-slate-700"}`}>{motive.label}</button>)}</div></fieldset>
              <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-800">Destino do equipamento</p>{canRestockReturn(returnMotive) ? <label className="mt-3 flex min-h-12 cursor-pointer items-start gap-3 text-sm leading-relaxed text-slate-700"><input type="checkbox" disabled={isSaving || operationLocked} checked={restock} onChange={event => setRestock(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" /><span>Conferi o material recebido e confirmo que está apto para reutilização. Adicionar ao estoque disponível.</span></label> : <p className="mt-2 text-sm leading-relaxed text-slate-600">{returnMotive === "Perda" ? "Perda ou extravio: não há retorno físico nem reposição no estoque." : "Material desgastado, vencido ou danificado fica fora do estoque disponível."}</p>}{canRestockReturn(returnMotive) && !restock && <p className="mt-2 text-xs text-slate-500">Sem essa confirmação, a baixa não aumenta o estoque disponível.</p>}</div>
              {needsReplacement && <fieldset disabled={isSaving || operationLocked} className="space-y-3 disabled:opacity-60"><legend className="mb-2 text-sm font-semibold text-slate-800">EPI de reposição · {quantity} unidade(s)</legend><label className="sr-only" htmlFor="return-ppe-search">Buscar EPI de reposição</label><input id="return-ppe-search" type="search" placeholder="Nome ou CA do equipamento" value={replacementSearchTerm} onChange={event => setReplacementSearchTerm(event.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 px-3 text-base" /><div className="max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-200">{!filteredPpes.length && <p className="p-4 text-sm text-slate-500">Nenhum EPI encontrado.</p>}{filteredPpes.map(ppe => <button type="button" key={ppe.id} aria-pressed={replacementPpeId === ppe.id} onClick={() => { workflow.current = null; setReplacementPpeId(ppe.id) }} className={`flex min-h-16 w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 ${replacementPpeId === ppe.id ? "bg-[#2563EB]/10" : "hover:bg-slate-50"}`}><span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-800">{ppe.name}</span><span className="mt-1 block text-xs text-slate-500">CA {ppe.ca_number || "—"} · Estoque {ppe.current_stock || 0}</span></span>{replacementPpeId === ppe.id && <CheckCircle2 className="h-5 w-5 shrink-0 text-[#2563EB]" />}</button>)}</div></fieldset>}
              {saveError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm leading-relaxed text-amber-900">{saveError}</p>{lastPdfUrl && <a href={lastPdfUrl} download={lastPdfFileName} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-amber-900 underline">Baixar o recibo já gerado</a>}</div>}
              {isSaving && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />{phaseLabel}</p>}
              <Button type="button" loading={isSaving} loadingText="Concluindo…" disabled={isSaving || (!operationLocked && needsReplacement && !selectedPpe)} onClick={() => { if (workflow.current?.progress.attempted) void executeWorkflow(workflow.current); else { workflow.current = null; setSignatureOpen(true) } }} className="h-auto min-h-13 w-full rounded-xl bg-[#2563EB] px-4 py-3 text-base font-semibold text-white disabled:bg-slate-300">{operationLocked ? "Retomar a conclusão" : "Conferir e assinar"}</Button>
            </div>}
          </>}
        </section>
      </div>
      <BottomSheet open={signatureOpen} title="Confirmar baixa" description={`${selectedEmployee?.full_name || ""} · ${quantity} unidade(s)`} onClose={() => { if (!saving.current) setSignatureOpen(false) }} className="h-dvh max-h-dvh rounded-none pt-[env(safe-area-inset-top)] md:h-auto md:max-w-3xl md:pt-0" contentClassName="space-y-4 [&_input]:text-base">
        <p className="text-sm leading-relaxed text-slate-600">{deliveryToReturn?.ppe?.name} · {returnMotive}{needsReplacement ? ` · Reposição: ${selectedPpe?.name || ""}` : ""}</p>
        <div className="grid grid-cols-2 gap-2"><button disabled={isSaving} onClick={() => setAuthMethod("manual")} aria-pressed={authMethod === "manual"} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 text-sm font-medium ${authMethod === "manual" ? "border-[#2563EB] bg-[#2563EB]/10" : "border-slate-200"}`}><PenLine className="h-4 w-4 shrink-0" />Assinatura</button><button disabled={isSaving} onClick={() => setAuthMethod("manual_facial")} aria-pressed={authMethod === "manual_facial"} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 text-sm font-medium ${authMethod === "manual_facial" ? "border-[#2563EB] bg-[#2563EB]/10" : "border-slate-200"}`}><Camera className="h-4 w-4 shrink-0" />Foto + assinatura</button></div>
        {authMethod === "manual_facial" && <p className="rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">A foto cadastral será anexada ao recibo como apoio. Esta opção não realiza reconhecimento facial.</p>}
        <SignatureCapture signatureRef={sigCanvas} isSaving={isSaving} confirmLabel={needsReplacement ? "Confirmar baixa e reposição" : "Confirmar baixa"} onConfirm={saveReturn} />
        {isSaving && <p role="status" className="text-center text-sm text-slate-600">{phaseLabel}</p>}
      </BottomSheet>
    </div>
  )
}
