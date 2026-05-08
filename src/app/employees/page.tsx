"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { Users, Plus, Search, X, Loader2, HardDrive, FileDown, ShieldAlert, History, UserMinus, ShieldCheck, Lock, Camera, Link2, PenTool, BriefcaseBusiness, Fingerprint, Clipboard, RefreshCw, Hourglass, XCircle, Trash2, ExternalLink, FileUp, Download } from "lucide-react"
import SignatureCanvas from "react-signature-canvas"
import * as XLSX from "xlsx"
import { api } from "@/services/api"
import { Employee, Workplace, DeliveryWithRelations, CatalogItem } from "@/types/database"
import { format, addDays, isPast } from "date-fns"
import { useAuth } from "@/contexts/AuthContext"
import { Skeleton } from "@/components/ui/Skeleton"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { COMPANY_CONFIG } from "@/config/company"
import { generateEmployeesReportPDF, generateNR06PDF } from "@/utils/pdfGenerator"
import { formatCpf, isValidCpf } from "@/utils/cpf"
import { copyTextToClipboard } from "@/utils/clipboard"
import { toast } from "sonner"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR")
const formatTypingName = (value: string) => value.toLocaleUpperCase("pt-BR")

type RemoteLinkStatus = "pending" | "completed" | "expired"

type PendingCaptureDraft = {
  key: string
  token: string
  linkUrl: string
  status: RemoteLinkStatus
  expiresAt: string | null
  employeeId: string
  employeeName: string
  employeeCpf: string
}

const getBiometryStatus = (employee: Employee) => {
  const hasPhoto = Boolean(employee.photo_url)
  const hasDescriptor = Boolean(employee.face_descriptor?.length)

  if (hasPhoto && hasDescriptor) {
    return {
      label: "Cadastrada",
      detail: "Foto e face",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconClassName: "text-emerald-600",
    }
  }

  if (hasPhoto || hasDescriptor) {
    return {
      label: "Incompleta",
      detail: hasPhoto ? "Falta face" : "Falta foto",
      className: "bg-amber-50 text-amber-700 border-amber-200",
      iconClassName: "text-amber-600",
    }
  }

  return {
    label: "Nao cadastrada",
    detail: "Sem foto/face",
    className: "bg-slate-50 text-slate-500 border-slate-200",
    iconClassName: "text-slate-400",
  }
}

export default function EmployeesPage() {
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [jobTitles, setJobTitles] = useState<CatalogItem[]>([])
  const [departments, setDepartments] = useState<CatalogItem[]>([])
  const [catalogWarning, setCatalogWarning] = useState("")
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [departmentFilter, setDepartmentFilter] = useState("all")
  const [workplaceFilter, setWorkplaceFilter] = useState("all")
  const [biometryFilter, setBiometryFilter] = useState<"all" | "registered" | "pending">("all")
  const [admissionStartFilter, setAdmissionStartFilter] = useState("")
  const [admissionEndFilter, setAdmissionEndFilter] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isFaceCameraOpen, setIsFaceCameraOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"employees" | "pending">("employees")
  const [pendingCaptureDrafts, setPendingCaptureDrafts] = useState<PendingCaptureDraft[]>([])
  const [captureWaitHours, setCaptureWaitHours] = useState(24)
  const [checkingPendingToken, setCheckingPendingToken] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  
  // Prontuario State
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [employeeHistory, setEmployeeHistory] = useState<DeliveryWithRelations[]>([])
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Form State
  const [formData, setFormData] = useState<{
    id?: string;
    name: string;
    role: string;
    department: string;
    cpf: string;
    workplace_id: string;
    admission_date: string;
    termination_date: string;
    photo_url?: string | null;
    face_descriptor?: number[] | null;
  }>({ 
    name: "", 
    role: "", 
    department: "", 
    cpf: "",
    workplace_id: "",
    admission_date: "",
    termination_date: "",
    photo_url: null,
    face_descriptor: null
  })
  // TST Signer State
  const [isTstModalOpen, setIsTstModalOpen] = useState(false)
  const [tstStep, setTstStep] = useState<1|2>(1) // 1=identify, 2=sign
  const [tstSelectedEmployee, setTstSelectedEmployee] = useState<Employee | null>(null)
  const [tstSearchTerm, setTstSearchTerm] = useState("")
  const [tstRole, setTstRole] = useState("Técnico de Segurança do Trabalho")
  const [tstAuthMethod, setTstAuthMethod] = useState<'manual'|'facial'|'manual_facial'>('manual')
  const [tstSignatureBase64, setTstSignatureBase64] = useState<string | null>(null)
  const [tstPhotoBase64, setTstPhotoBase64] = useState<string | null>(null)
  const [isFaceCameraTstOpen, setIsFaceCameraTstOpen] = useState(false)
  const tstSigCanvas = useRef<SignatureCanvas | null>(null)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const { user } = useAuth()
  const canEdit = user?.role === 'MASTER' || user?.role === 'ADMIN'

  const formatRemoteExpiry = (value: string | null) => {
    if (!value) return "sem prazo"
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const loadPendingCaptureDrafts = useCallback(() => {
    if (typeof window === "undefined") return

    const drafts: PendingCaptureDraft[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith("capture-biometry:")) continue

      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || "{}") as PendingCaptureDraft
        if (!parsed.token || !parsed.employeeId) continue
        drafts.push({ ...parsed, key, status: parsed.status || "pending" })
      } catch {
        window.localStorage.removeItem(key)
      }
    }

    setPendingCaptureDrafts(drafts.sort((a, b) => (b.expiresAt || "").localeCompare(a.expiresAt || "")))
  }, [])

  const persistPendingCaptureDraft = useCallback((draft: Omit<PendingCaptureDraft, "key">) => {
    if (typeof window === "undefined") return
    const key = `capture-biometry:${draft.token}`
    window.localStorage.setItem(key, JSON.stringify({ ...draft, key }))
    loadPendingCaptureDrafts()
  }, [loadPendingCaptureDrafts])

  const updatePendingCaptureDraft = useCallback((token: string, updates: Partial<PendingCaptureDraft>) => {
    if (typeof window === "undefined") return
    const key = `capture-biometry:${token}`
    const current = window.localStorage.getItem(key)
    if (!current) return

    try {
      const parsed = JSON.parse(current) as PendingCaptureDraft
      window.localStorage.setItem(key, JSON.stringify({ ...parsed, ...updates, key }))
      loadPendingCaptureDrafts()
    } catch {
      window.localStorage.removeItem(key)
      loadPendingCaptureDrafts()
    }
  }, [loadPendingCaptureDrafts])

  const removePendingCaptureDraft = useCallback((token: string) => {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(`capture-biometry:${token}`)
    loadPendingCaptureDrafts()
  }, [loadPendingCaptureDrafts])

  // Fetch real data from Supabase
  const loadData = async () => {
    try {
      // Removed synchronous setLoading(true) to avoid cascading renders in useEffect.
      // Loading is initialized to true.
      const [empData, wpData, jobData, deptData] = await Promise.all([
        api.getEmployees(),
        api.getWorkplaces(),
        api.getJobTitles(),
        api.getDepartments()
      ])
      setEmployees(empData)
      setWorkplaces(wpData)
      setJobTitles(jobData)
      setDepartments(deptData)
      setCatalogWarning("")
    } catch (error) {
      console.error("Erro ao carregar dados:", error)
      toast.error("Falha ao carregar dados do banco de dados.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Initial load - wrapped in setTimeout to ensure it's asynchronous and avoid cascading render warnings
    const timer = setTimeout(() => {
      loadData()
      loadPendingCaptureDrafts()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadPendingCaptureDrafts])

  const resetFormData = () => setFormData({
    id: undefined,
    name: "",
    role: "",
    department: "",
    cpf: "",
    workplace_id: "",
    admission_date: "",
    termination_date: "",
    photo_url: null,
    face_descriptor: null
  })

  const filteredEmployees = employees.filter(emp => {
    const search = searchTerm.toLowerCase()
    const matchesSearch = emp.full_name.toLowerCase().includes(search) || emp.cpf.includes(searchTerm)
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? emp.active : !emp.active)
    const matchesDepartment = departmentFilter === "all" || emp.department === departmentFilter
    const matchesWorkplace = workplaceFilter === "all" || (workplaceFilter === "none" ? !emp.workplace_id : emp.workplace_id === workplaceFilter)
    const hasBiometry = Boolean(emp.photo_url && emp.face_descriptor?.length)
    const matchesBiometry = biometryFilter === "all" || (biometryFilter === "registered" ? hasBiometry : !hasBiometry)
    const admission = emp.admission_date ? new Date(`${emp.admission_date}T12:00:00`) : null
    const matchesAdmissionStart = !admissionStartFilter || (admission && admission >= new Date(`${admissionStartFilter}T00:00:00`))
    const matchesAdmissionEnd = !admissionEndFilter || (admission && admission <= new Date(`${admissionEndFilter}T23:59:59`))

    return matchesSearch && matchesStatus && matchesDepartment && matchesWorkplace && matchesBiometry && matchesAdmissionStart && matchesAdmissionEnd
  })

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return
    if (formData.cpf && !isValidCpf(formData.cpf)) {
      alert("O CPF informado é inválido. Por favor, verifique.")
      return
    }

    if (jobTitles.length === 0 || departments.length === 0) {
      setCatalogWarning("Cadastre pelo menos um cargo e um setor antes de salvar colaboradores.")
      toast.error("Cadastre cargos e setores antes de salvar colaboradores.")
      return
    }
    if (!formData.role || !formData.department) {
      setCatalogWarning("Selecione um cargo e um setor cadastrados para continuar.")
      toast.error("Selecione cargo e setor.")
      return
    }

    const normalizedName = normalizeName(formData.name)
    const normalizedRole = normalizeName(formData.role)
    const normalizedDepartment = normalizeName(formData.department)
    try {
      setIsSaving(true)
      
      let photoFile: File | undefined;
      if (formData.photo_url && formData.photo_url.startsWith('data:')) {
        const response = await fetch(formData.photo_url);
        const blob = await response.blob();
        photoFile = new File([blob], "profile.png", { type: "image/png" });
      }

      if (formData.id) {
        // Atualiza campos textuais
        const updates: Record<string, unknown> = {
          full_name: normalizedName,
          job_title: normalizedRole,
          department: normalizedDepartment,
          cpf: formData.cpf || "000.000.000-00",
          workplace_id: formData.workplace_id || null,
          admission_date: formData.admission_date || null,
          termination_date: formData.termination_date || null,
          active: !formData.termination_date,
          face_descriptor: formData.face_descriptor ? Array.from(formData.face_descriptor) : null
        }

        // Se tem foto HTTP existente, mantém
        if (formData.photo_url && formData.photo_url.startsWith('http')) {
          updates.photo_url = formData.photo_url
        }

        // Atualiza campos gerais (e foto se for nova captura via photoFile)
        await api.updateEmployee(formData.id, updates as Partial<Employee>, photoFile)

        // Se a foto foi REMOVIDA (null), faz chamada dedicada separada
        if (formData.photo_url === null) {
          console.log('[handleSave] Foto removida - chamando removeEmployeePhoto')
          await api.removeEmployeePhoto(formData.id)
        }
        
        // Recarrega a lista para garantir dados consistentes
        await loadData()

        toast.success("Cadastro atualizado com sucesso!")
        resetFormData()
        setIsModalOpen(false)
      } else {
        await api.addEmployee({
          full_name: normalizedName,
          job_title: normalizedRole,
          department: normalizedDepartment,
          cpf: formData.cpf || "000.000.000-00",
          admission_date: formData.admission_date || null,
          termination_date: formData.termination_date || null,
          active: !formData.termination_date,
          workplace_id: formData.workplace_id || null,
          photo_url: null,
          face_descriptor: formData.face_descriptor ? Array.from(formData.face_descriptor) : null
        }, photoFile)
        toast.success("Colaborador cadastrado com sucesso!")
        
        // Novo cadastro: recarrega a lista completa para incluir o novo
        setLoading(true)
        await loadData()
        resetFormData()
        setIsModalOpen(false)
      }
    } catch (error: unknown) {
      console.error("Erro ao salvar colaborador:", error)
      const message = error instanceof Error ? error.message : "Erro ao salvar no banco de dados. Verifique a conexão."
      toast.error(message)
    } finally {
      setIsSaving(false)
      setLoading(false)
    }
  }

  const openEditEmployee = (emp: Employee) => {
    setFormData({
      id: emp.id,
      name: emp.full_name,
      role: getJobTitleName(emp.job_title),
      department: getDepartmentName(emp.department),
      cpf: emp.cpf,
      workplace_id: emp.workplace_id || "",
      admission_date: emp.admission_date ? String(emp.admission_date).slice(0, 10) : "",
      termination_date: emp.termination_date ? String(emp.termination_date).slice(0, 10) : "",
      photo_url: emp.photo_url || null,
      face_descriptor: emp.face_descriptor ? Array.from(emp.face_descriptor) : null
    })
    setIsModalOpen(true)
  }

  const closeEditModal = () => {
    resetFormData()
    setIsModalOpen(false)
  }

  const openProfile = async (empId: string) => {
    setSelectedEmployeeId(empId)
    setIsProfileOpen(true)
    setLoadingHistory(true)
    try {
      const history = await api.getEmployeeHistory(empId)
      setEmployeeHistory(history)
    } catch (err) {
      console.error("Erro ao carregar histórico:", err)
      toast.error("Falha ao carregar prontuário.")
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleReturnItem = async (deliveryId: string) => {
    const motive = prompt("Qual o motivo da devolução? (Ex: Desgaste, Erro, Fim de Contrato)")
    if (!motive) return

    try {
      await api.returnDelivery(deliveryId, motive)
      if (selectedEmployeeId) {
        const history = await api.getEmployeeHistory(selectedEmployeeId)
        setEmployeeHistory(history)
        toast.success("EPI devolvido com sucesso.")
      }
    } catch (err) {
      console.error("Erro ao dar baixa:", err)
      toast.error("Erro ao registrar devolução.")
    }
  }

  const downloadImportTemplate = () => {
    const rows = [
      {
        nome: "JOAO DA SILVA",
        cpf: "000.000.000-00",
        cargo: jobTitles[0]?.name || "AUXILIAR",
        setor: departments[0]?.name || "OPERACIONAL",
        obra: workplaces[0]?.name || "",
        admissao: "2026-01-01",
        demissao: "",
        status: "ATIVO",
      },
    ]
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Colaboradores")
    XLSX.writeFile(workbook, "modelo_importacao_colaboradores_safeepi.xlsx")
  }

  const handleImportEmployees = async (file: File) => {
    try {
      setIsSaving(true)
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

      let imported = 0
      for (const row of rows) {
        const name = normalizeName(String(row.nome || row.Nome || row.NOME || ""))
        const cpf = formatCpf(String(row.cpf || row.CPF || ""))
        const role = normalizeName(String(row.cargo || row.Cargo || row.CARGO || ""))
        const department = normalizeName(String(row.setor || row.Setor || row.SETOR || ""))
        const workplaceName = normalizeName(String(row.obra || row.Obra || row.OBRA || ""))
        const admission = String(row.admissao || row.Admissao || row.ADMISSAO || "")
        const termination = String(row.demissao || row.Demissao || row.DEMISSAO || "")
        const status = String(row.status || row.Status || "ATIVO").toUpperCase()

        if (!name || !cpf || !isValidCpf(cpf) || !role || !department) continue
        if (employees.some(emp => emp.cpf === cpf)) continue

        const workplace = workplaces.find(w => normalizeName(w.name) === workplaceName)
        await api.addEmployee({
          full_name: name,
          cpf,
          job_title: role,
          department,
          admission_date: admission || null,
          termination_date: termination || null,
          active: status !== "INATIVO" && !termination,
          workplace_id: workplace?.id || null,
          photo_url: null,
          face_descriptor: null,
        })
        imported += 1
      }

      await loadData()
      toast.success(`${imported} colaborador(es) importado(s).`)
    } catch (error) {
      console.error("Erro ao importar colaboradores:", error)
      toast.error("Falha ao importar planilha. Confira o modelo e tente novamente.")
    } finally {
      setIsSaving(false)
      if (importInputRef.current) importInputRef.current.value = ""
    }
  }

  const exportEmployeesReport = () => {
    const blob = generateEmployeesReportPDF({
      employees: filteredEmployees,
      workplaces,
      periodLabel: `${filteredEmployees.length} colaborador(es) filtrado(s)`,
    })
    openPdfDialog(blob, `Relatorio_Colaboradores_${new Date().toISOString().slice(0, 10)}.pdf`, {
      title: "Relatório de Colaboradores",
      description: "PDF organizado com filtros, status, datas e biometria dos colaboradores.",
    })
  }

  const handleTerminateEmployee = async () => {
    if (!selectedEmployeeId) return
    const emp = employees.find(e => e.id === selectedEmployeeId)
    
    if (!confirm(`Deseja realmente DESLIGAR o colaborador ${emp?.full_name} e dar baixa em todos os seus EPIs ativos?`)) return
    
    try {
      setLoadingHistory(true)
      
      // 1. Desligar colaborador
      await api.terminateEmployee(selectedEmployeeId)
      
      // 2. Dar baixa em todos EPIs ativos
      const activeDeliveries = employeeHistory.filter(d => !d.returned_at)
      if (activeDeliveries.length > 0) {
        await api.returnMultipleDeliveries(activeDeliveries.map(d => d.id), "Desligamento")
      }
      
      await loadData()
      const history = await api.getEmployeeHistory(selectedEmployeeId)
      setEmployeeHistory(history)
      toast.success("Colaborador desligado e EPIs baixados com sucesso.")
    } catch (err) {
      console.error("Erro ao desligar:", err)
      toast.error("Erro ao processar desligamento.")
    } finally {
      setLoadingHistory(false)
    }
  }

  const openTstModal = () => {
    if (employeeHistory.length === 0) return
    setTstSelectedEmployee(null)
    setTstSearchTerm("")
    setTstRole("Técnico de Segurança do Trabalho")
    setTstAuthMethod('manual')
    setTstSignatureBase64(null)
    setTstPhotoBase64(null)
    setTstStep(1)
    setIsTstModalOpen(true)
  }

  const handleSelectTst = async (emp: Employee) => {
    setTstSelectedEmployee(emp)
    setTstSignatureBase64(null)
    setTstPhotoBase64(null)
    setTstRole(getJobTitleName(emp.job_title || "Técnico de Segurança do Trabalho"))
    // If employee has a photo, use it as the signature automatically
    if (emp.photo_url) {
      try {
        const res = await fetch(emp.photo_url)
        const blob = await res.blob()
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        setTstPhotoBase64(b64)
        setTstAuthMethod('manual_facial')
      } catch {
        // If photo fetch fails, go to manual
        setTstPhotoBase64(null)
      }
    } else {
      setTstAuthMethod('manual')
    }
    setTstStep(2)
  }

  const tstName = tstSelectedEmployee?.full_name || ""

  const exportNR06PDF = async () => {
    const emp = employees.find(e => e.id === selectedEmployeeId)
    if (!emp) return
    if (!tstSignatureBase64) return
    if (tstAuthMethod === 'manual_facial' && !tstPhotoBase64) {
      toast.error("Cadastre uma foto do responsavel tecnico antes de usar Foto + Assinatura.")
      return
    }

    try {
      setIsGeneratingPdf(true)
      const signedDocuments = await api.getSignedDocuments()
      const getSignedDocumentForDelivery = (deliveryId: string) =>
        signedDocuments.find((document) =>
          document.delivery_id === deliveryId ||
          document.delivery_ids?.includes(deliveryId)
        )

      const pdfBlob = await generateNR06PDF({
        employeeName: emp.full_name,
        employeeCpf: emp.cpf,
        employeeRole: getJobTitleName(emp.job_title),
        employeeDepartment: getDepartmentName(emp.department),
        workplaceName: getWorkplaceName(emp.workplace_id),
        admissionDate: emp.admission_date ? format(new Date(`${emp.admission_date}T12:00:00`), "dd/MM/yyyy") : "Nao informado",
        items: employeeHistory.map(d => {
          const signedDocument = getSignedDocumentForDelivery(d.id)
          const authMethod = (signedDocument?.auth_method || d.auth_method || null) as 'manual' | 'facial' | 'manual_facial' | null

          return {
            deliveryDate: format(new Date(d.delivery_date), "dd/MM/yyyy"),
            ppeName: d.ppe?.name || "N/A",
            caNr: d.ppe?.ca_number || "N/A",
            quantity: d.quantity,
            reason: d.reason,
            returnedAt: d.returned_at,
            isExpired: d.ppe ? isPast(addDays(new Date(d.delivery_date), d.ppe.lifespan_days || 180)) : false,
            authMethod,
            signatureUrl: d.signature_url || signedDocument?.signature_url || null,
            photoEvidenceUrl: signedDocument?.photo_evidence_url || null,
          }
        }),
        tstSigner: {
          name: tstName,
          role: tstRole,
          signatureBase64: tstSignatureBase64,
          authMethod: tstAuthMethod,
          photoBase64: tstPhotoBase64 || undefined,
        }
      })

      const safeEmployee = emp.full_name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")

      const fileName = `Ficha_NR06_${safeEmployee}.pdf`

      try {
        await api.archiveSignedDocument({
          documentType: "nr06",
          employeeId: emp.id,
          deliveryIds: employeeHistory.map((delivery) => delivery.id).filter(Boolean),
          fileName,
          pdfBlob,
          authMethod: tstAuthMethod,
          metadata: {
            tstSignerName: tstName,
            tstSignerRole: tstRole,
            deliveryCount: employeeHistory.length,
            workplaceName: getWorkplaceName(emp.workplace_id),
          },
        })
      } catch (archiveError) {
        const message = archiveError instanceof Error ? archiveError.message : "Nao foi possivel arquivar o PDF assinado."
        toast.warning(message)
      }

      openPdfDialog(pdfBlob, fileName, {
        title: "Prontuario NR-06 pronto",
        description: "Escolha se deseja visualizar a ficha em uma nova aba ou baixar o PDF agora.",
      })

      setIsTstModalOpen(false)
    } catch (err) {
      console.error("Erro ao gerar PDF:", err)
      toast.error("Erro ao gerar o Prontuário NR-06.")
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  const getWorkplaceName = (id: string | null) => {
    return normalizeName(workplaces.find(w => w.id === id)?.name || "Administrativo")
  }

  const getDepartmentName = (department?: string | null) => {
    return normalizeName(department || "Administrativo")
  }

  const getJobTitleName = (jobTitle?: string | null) => {
    return normalizeName(jobTitle || "Geral")
  }

  const generateCaptureRemoteLink = async (emp: Employee) => {
    try {
      const data = await api.createRemoteLink({
        employee_id: emp.id,
        type: 'capture',
        expires_hours: captureWaitHours,
      })
      const link = `${window.location.origin}/capture/${emp.id}?t=${data.link.token}`
      persistPendingCaptureDraft({
        token: data.link.token,
        linkUrl: link,
        status: "pending",
        expiresAt: data.link.expires_at,
        employeeId: emp.id,
        employeeName: emp.full_name,
        employeeCpf: emp.cpf,
      })
      const copied = await copyTextToClipboard(link)
      setViewMode("pending")
      if (copied) {
        toast.success(`Link de registro facial copiado. Valido por ${captureWaitHours}h e uso unico.`)
      } else {
        toast.warning("Link gerado e salvo em Pendencias. Use o botao Copiar ou copie manualmente.")
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido"
      toast.error(`Erro ao gerar link: ${errorMsg}`)
    }
  }

  const checkPendingCaptureDraft = useCallback(async (draft: PendingCaptureDraft) => {
    try {
      setCheckingPendingToken(draft.token)
      const res = await fetch(`/api/remote-links?token=${draft.token}&include_completed=1`)
      const payload = await res.json()

      if (!res.ok) {
        if (payload.status === "expired") {
          updatePendingCaptureDraft(draft.token, { status: "expired" })
          toast.warning("Link expirado. Gere um novo link de registro facial.")
        } else {
          toast.error(payload.error || "Nao foi possivel consultar esta pendencia.")
        }
        return
      }

      const status = payload.link?.status as RemoteLinkStatus | undefined
      if (status === "completed") {
        updatePendingCaptureDraft(draft.token, { status: "completed" })
        toast.success("Registro facial concluido no banco para comparacao biometrica.")
        await loadData()
        return
      }

      if (payload.link?.expires_at && new Date(payload.link.expires_at) < new Date()) {
        updatePendingCaptureDraft(draft.token, { status: "expired", expiresAt: payload.link.expires_at })
        toast.warning("Link expirado. Gere um novo link de registro facial.")
        return
      }

      updatePendingCaptureDraft(draft.token, {
        status: "pending",
        expiresAt: payload.link?.expires_at || draft.expiresAt,
      })
      toast.info("Ainda aguardando registro facial do colaborador.")
    } catch (err) {
      console.error("Erro ao consultar pendencia de registro facial:", err)
      toast.error("Erro ao consultar a pendencia.")
    } finally {
      setCheckingPendingToken(null)
    }
  }, [updatePendingCaptureDraft])

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center">
            <Users className="w-6 h-6 mr-2 text-[#2563EB]" />
            Equipe {COMPANY_CONFIG.shortName}
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestão de prontuários de EPI sincronizada com o {COMPANY_CONFIG.systemName}.</p>
        </div>
        {canEdit ? (
          <div className="w-full sm:w-auto grid grid-cols-2 sm:flex gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleImportEmployees(file)
              }}
            />
            <button
              onClick={downloadImportTemplate}
              className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center"
            >
              <Download className="w-4 h-4 mr-2" />
              Modelo
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={isSaving}
              className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center disabled:opacity-60"
            >
              <FileUp className="w-4 h-4 mr-2" />
              Importar
            </button>
            <button
              onClick={exportEmployeesReport}
              className="bg-white border border-blue-100 text-[#2563EB] hover:bg-blue-50 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center"
            >
              <FileDown className="w-4 h-4 mr-2" />
              PDF
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-lg shadow-blue-900/20 px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center whitespace-nowrap"
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo
            </button>
          </div>
        ) : (
          <div className="bg-slate-100 text-slate-400 px-6 py-3 rounded-xl text-sm font-bold flex items-center italic cursor-not-allowed select-none whitespace-nowrap">
             <Lock className="w-4 h-4 mr-2 opacity-50" />
             Acesso Restrito
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="grid grid-cols-2 bg-slate-100 border border-slate-200 p-1 rounded-2xl w-full lg:w-auto">
          <button
            onClick={() => setViewMode("employees")}
            className={`px-4 sm:px-6 py-3 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${viewMode === "employees" ? "bg-white text-[#2563EB] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Users className="w-4 h-4" /> Colaboradores
          </button>
          <button
            onClick={() => setViewMode("pending")}
            className={`px-4 sm:px-6 py-3 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${viewMode === "pending" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Hourglass className="w-4 h-4" /> Pendencias
            {pendingCaptureDrafts.length > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] flex items-center justify-center">
                {pendingCaptureDrafts.length}
              </span>
            )}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-4 shadow-sm">
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Espera do registro</p>
            <p className="text-[10px] text-slate-400 font-bold">Validade do link facial.</p>
          </div>
          <select
            value={captureWaitHours}
            onChange={(event) => setCaptureWaitHours(Number(event.target.value))}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-[#2563EB]"
            title="Tempo de espera do registro facial"
          >
            <option value={1}>1h</option>
            <option value={4}>4h</option>
            <option value={8}>8h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
          </select>
        </div>
      </div>

      {viewMode === "pending" ? (
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/40 animate-in fade-in">
          <div className="p-5 sm:p-6 border-b border-slate-100 bg-amber-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                <Hourglass className="w-5 h-5 text-amber-600" />
                Pendencias de Registro Facial
              </h2>
              <p className="text-xs text-amber-700 font-bold mt-1">Links aguardando foto para comparacao biometrica no banco.</p>
            </div>
            <button
              onClick={() => pendingCaptureDrafts.forEach((draft) => { if (draft.status === "pending") void checkPendingCaptureDraft(draft) })}
              disabled={pendingCaptureDrafts.length === 0 || checkingPendingToken !== null}
              className="bg-white border border-amber-200 text-amber-700 px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-amber-50 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${checkingPendingToken ? "animate-spin" : ""}`} /> Atualizar Status
            </button>
          </div>

          <div className="p-4 sm:p-6">
            {pendingCaptureDrafts.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50">
                <ShieldCheck className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Nenhuma pendencia facial</p>
                <p className="text-xs text-slate-400 mt-2 font-medium">Quando gerar um link de registro de imagem, ele aparece aqui.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pendingCaptureDrafts.map((draft) => {
                  const isChecking = checkingPendingToken === draft.token
                  const statusStyle = draft.status === "completed"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : draft.status === "expired"
                      ? "bg-red-50 text-red-700 border-blue-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  const StatusIcon = draft.status === "completed" ? ShieldCheck : draft.status === "expired" ? XCircle : Hourglass

                  return (
                    <div key={draft.token} className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-white shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-800 uppercase tracking-tight truncate">{draft.employeeName}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-1">{formatCpf(draft.employeeCpf)}</p>
                        </div>
                        <span className={`px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap ${statusStyle}`}>
                          <StatusIcon className="w-3 h-3" />
                          {draft.status === "completed" ? "Registrada" : draft.status === "expired" ? "Expirada" : "Aguardando"}
                        </span>
                      </div>

                      <div className="mt-4 bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                          <Fingerprint className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-black text-xs text-slate-800 uppercase tracking-tight">Registro de foto facial</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Uso exclusivo para comparacao biometrica.</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                        <Hourglass className="w-3.5 h-3.5" />
                        {draft.status === "pending" ? `Aguardando registro ate ${formatRemoteExpiry(draft.expiresAt)}` : `Ultimo prazo: ${formatRemoteExpiry(draft.expiresAt)}`}
                      </div>

                      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <button
                          onClick={() => void copyTextToClipboard(draft.linkUrl).then((copied) => {
                            if (copied) {
                              toast.success("Link copiado novamente.")
                            } else {
                              toast.warning("Nao foi possivel copiar automaticamente. Abra o link e copie pela barra do navegador.")
                            }
                          })}
                          className="py-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <Clipboard className="w-3.5 h-3.5" /> Copiar
                        </button>
                        <a
                          href={draft.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Abrir
                        </a>
                        <button
                          onClick={() => void checkPendingCaptureDraft(draft)}
                          disabled={isChecking}
                          className="py-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} /> Checar
                        </button>
                        <button
                          onClick={() => {
                            const emp = employees.find(item => item.id === draft.employeeId)
                            if (emp) openEditEmployee(emp)
                          }}
                          className="py-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <Camera className="w-3.5 h-3.5" /> Abrir
                        </button>
                        <button
                          onClick={() => removePendingCaptureDraft(draft.token)}
                          className="py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Limpar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (

      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/30 space-y-4">
          <div className="relative max-w-md w-full">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou CPF..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              title="Buscar colaborador"
              aria-label="Buscar colaborador por nome ou CPF"
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] transition-all"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]">
              <option value="all">Todos status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]">
              <option value="all">Todos setores</option>
              {departments.map(dept => <option key={dept.id} value={dept.name}>{dept.name}</option>)}
            </select>
            <select value={workplaceFilter} onChange={(e) => setWorkplaceFilter(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]">
              <option value="all">Todas obras</option>
              <option value="none">Sem obra</option>
              {workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={biometryFilter} onChange={(e) => setBiometryFilter(e.target.value as typeof biometryFilter)} className="bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]">
              <option value="all">Biometria geral</option>
              <option value="registered">Cadastrada</option>
              <option value="pending">Pendente</option>
            </select>
            <input type="date" value={admissionStartFilter} onChange={(e) => setAdmissionStartFilter(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]" title="Admissão inicial" />
            <input type="date" value={admissionEndFilter} onChange={(e) => setAdmissionEndFilter(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]" title="Admissão final" />
          </div>
        </div>

        <div className="overflow-x-auto min-h-[200px] flex flex-col">
         {loading ? (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-end border-b border-slate-100 pb-8">
           <div className="space-y-2">
             <Skeleton className="h-4 w-32" />
             <Skeleton className="h-8 w-64" />
           </div>
           <Skeleton className="h-12 w-40" />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
           <div className="p-5 border-b border-slate-100">
             <Skeleton className="h-10 w-64" />
           </div>
           {[...Array(5)].map((_, i) => (
             <div key={i} className="flex items-center gap-4 p-6 border-b border-slate-50 last:border-0">
                <Skeleton className="h-12 w-12" variant="circle" />
                <div className="flex-1 space-y-2">
                   <Skeleton className="h-4 w-1/4" />
                   <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-24" />
             </div>
           ))}
        </div>
      </div>
  ) : (
            <>
              {/* Desktop View (Table) */}
              <table className="w-full text-sm text-left hidden md:table">
                  <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                  <tr>
                      <th className="px-6 py-5">Nome do Colaborador</th>
                      <th className="px-6 py-5">Cargo / Setor</th>
                      <th className="px-6 py-5">Obra / Canteiro</th>
                      <th className="px-6 py-5">Biometria</th>
                      <th className="px-6 py-5">Status</th>
                      <th className="px-6 py-5 text-right">Ações</th>
                  </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                  {filteredEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-5">
                          <p className="font-bold text-slate-800 uppercase">{emp.full_name}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{formatCpf(emp.cpf)}</p>
                      </td>
                      <td className="px-6 py-5 text-slate-500 font-medium italic">
                          {getJobTitleName(emp.job_title)} <span className="mx-1 text-slate-200">•</span> {getDepartmentName(emp.department)}
                      </td>
                      <td className="px-6 py-5">
                          <div className="flex items-center gap-1.5 text-slate-600 font-bold text-[11px] uppercase tracking-tighter">
                              <HardDrive className="w-3 h-3 text-[#2563EB]" />
                              {getWorkplaceName(emp.workplace_id)}
                          </div>
                      </td>
                      <td className="px-6 py-5">
                          {(() => {
                            const biometry = getBiometryStatus(emp)
                            return (
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${biometry.className}`}>
                                <Fingerprint className={`w-3 h-3 ${biometry.iconClassName}`} />
                                {biometry.label}
                              </span>
                            )
                          })()}
                      </td>
                      <td className="px-6 py-5">
                          <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                          emp.active 
                              ? 'bg-green-50 text-green-700 border-green-200' 
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                          {emp.active ? 'Ativo' : 'Inativo'}
                          </span>
                      </td>
                      <td className="px-6 py-5 text-right space-x-2 whitespace-nowrap">
                          {canEdit && (
                            <button 
                              onClick={() => openEditEmployee(emp)}
                              className="text-slate-500 hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest border border-slate-200 bg-white px-3 py-2 rounded-lg shadow-sm transition-all"
                            >
                            Editar
                            </button>
                          )}
                          <button 
                            onClick={() => openProfile(emp.id)}
                            className="text-[#2563EB] hover:bg-blue-50 font-black text-[10px] uppercase tracking-widest border border-blue-100 bg-white px-3 py-2 rounded-lg shadow-sm transition-all"
                          >
                          Prontuário
                          </button>
                      </td>
                      </tr>
                  ))}
                  {filteredEmployees.length === 0 && (
                      <tr>
                          <td colSpan={6} className="px-6 py-10 text-center text-slate-400 italic font-medium">
                              Nenhum colaborador encontrado.
                          </td>
                      </tr>
                  )}
                  </tbody>
              </table>

              {/* Mobile View (Cards) */}
              <div className="grid grid-cols-1 gap-4 p-4 md:hidden bg-slate-50/50">
                {filteredEmployees.map((emp) => (
                  <div key={emp.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4 relative overflow-hidden">
                    {/* Status Badge absolute */}
                    <div className="absolute top-4 right-4">
                        <span className={`px-3 py-1 text-[9px] font-black uppercase rounded-full border ${
                          emp.active 
                              ? 'bg-green-50 text-green-700 border-green-200' 
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                          {emp.active ? 'Ativo' : 'Inativo'}
                        </span>
                    </div>

                    <div>
                      <p className="font-black text-slate-800 text-base uppercase pr-16">{emp.full_name}</p>
                      <p className="text-xs text-slate-400 font-mono mt-1">{formatCpf(emp.cpf)}</p>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-sm text-slate-500 font-medium italic">
                        {getJobTitleName(emp.job_title)}
                      </p>
                      <p className="text-xs text-slate-400 font-medium flex items-center">
                         <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mr-2"></span>
                         {getDepartmentName(emp.department)}
                      </p>
                      <div className="flex items-center gap-1.5 text-slate-600 font-bold text-[11px] uppercase tracking-tighter pt-1">
                          <HardDrive className="w-3.5 h-3.5 text-[#2563EB]" />
                          {getWorkplaceName(emp.workplace_id)}
                      </div>
                      {(() => {
                        const biometry = getBiometryStatus(emp)
                        return (
                          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest mt-2 ${biometry.className}`}>
                            <Fingerprint className={`w-3 h-3 ${biometry.iconClassName}`} />
                            {biometry.label}
                          </div>
                        )
                      })()}
                    </div>

                    <div className="pt-3 flex gap-2 border-t border-slate-100 mt-1">
                        {canEdit && (
                          <button 
                            onClick={() => openEditEmployee(emp)}
                            className="flex-1 text-slate-600 hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest border border-slate-200 bg-white py-3 rounded-xl shadow-sm transition-all text-center"
                          >
                            Editar
                          </button>
                        )}
                        <button 
                          onClick={() => openProfile(emp.id)}
                          className="flex-[2] text-white hover:bg-[#1D4ED8] bg-[#2563EB] font-black text-[10px] uppercase tracking-widest border border-blue-600 py-3 rounded-xl shadow-sm shadow-blue-900/20 transition-all text-center"
                        >
                          Prontuário
                        </button>
                    </div>
                  </div>
                ))}
                {filteredEmployees.length === 0 && (
                  <div className="px-6 py-10 text-center text-slate-400 italic font-medium bg-white rounded-2xl border border-slate-200">
                      Nenhum colaborador encontrado.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* Modal Adicionar Colaborador */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-3 sm:p-4 animate-in fade-in duration-300">
          <div className="my-3 sm:my-4 bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 flex flex-col">
            <div className="shrink-0 flex justify-between items-center p-5 sm:p-6 border-b border-slate-100">
              <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">{formData.id ? 'Editar Colaborador' : `Novo Cadastro ${COMPANY_CONFIG.shortName}`}</h2>
              <button 
                onClick={closeEditModal} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {isFaceCameraOpen ? (
              <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
                <FaceCamera 
                  onCapture={(desc, img) => {
                    setFormData({ ...formData, face_descriptor: Array.from(desc), photo_url: img });
                    setIsFaceCameraOpen(false);
                  }}
                  onCancel={() => setIsFaceCameraOpen(false)}
                  cancelLabel="Cancelar Biometria"
                />
              </div>
            ) : (
            <form onSubmit={handleSaveEmployee} className="min-h-0 flex flex-col">
              <div className="min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="flex flex-col items-center mb-4">
                {formData.photo_url ? (
                  <div className="relative">
                    <Image 
                      src={formData.photo_url} 
                      alt="Biometria capturada" 
                      width={96} 
                      height={96} 
                      className="w-24 h-24 rounded-full object-cover border-4 border-green-500" 
                      unoptimized
                    />
                    <button 
                      type="button" 
                      onClick={() => setFormData({...formData, photo_url: null, face_descriptor: null})} 
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"
                      title="Remover biometria"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <span className="block text-center text-[10px] text-green-600 font-bold uppercase mt-2">Biometria Cadastrada</span>
                  </div>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setIsFaceCameraOpen(true)}
                    className="flex flex-col items-center justify-center w-24 h-24 rounded-full border-2 border-dashed border-slate-300 text-slate-400 hover:text-[#2563EB] hover:border-[#2563EB] transition-all bg-slate-50"
                  >
                    <Camera className="w-8 h-8 mb-1" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-center px-2">Biometria<br/>Facial</span>
                  </button>
                )}
                
                {formData.id ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const emp = employees.find(item => item.id === formData.id)
                      if (emp) await generateCaptureRemoteLink(emp)
                    }}
                    className="mt-3 text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-700 flex items-center gap-1 transition-colors"
                  >
                    <Link2 className="w-3 h-3" />
                    Gerar Link de Captura Remota
                  </button>
                ) : (
                  <p className="mt-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 italic text-center">
                    Salve o cadastro para gerar<br/>o link de captura remota
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome Completo</label>
                <input 
                  required
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: formatTypingName(e.target.value)})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:outline-none transition-all font-bold uppercase" 
                  placeholder="Nome do colaborador"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between items-center">
                    CPF
                    {formData.cpf && !isValidCpf(formData.cpf) && (
                      <span className="text-red-500 text-[8px] font-bold">CPF Inválido</span>
                    )}
                    {formData.cpf && isValidCpf(formData.cpf) && (
                      <span className="text-green-500 text-[8px] font-bold">✓ Válido</span>
                    )}
                  </label>
                  <input 
                    type="text" 
                    value={formData.cpf}
                    onChange={(e) => setFormData({...formData, cpf: formatCpf(e.target.value)})}
                    className={`w-full bg-slate-50 border ${formData.cpf && !isValidCpf(formData.cpf) ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-[#2563EB]'} rounded-xl px-4 py-3 text-sm focus:outline-none transition-all font-bold`} 
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Setor</label>
                  <select
                    required
                    value={formData.department}
                    onChange={(e) => setFormData({...formData, department: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:outline-none transition-all font-bold uppercase"
                  >
                    <option value="">{departments.length === 0 ? "Cadastre setores" : "Selecione"}</option>
                    {formData.department && !departments.some(dept => dept.name === formData.department) && (
                      <option value={formData.department}>{formData.department}</option>
                    )}
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.name}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Função / Cargo</label>
                <select
                  required
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:outline-none transition-all font-bold uppercase"
                >
                  <option value="">{jobTitles.length === 0 ? "Cadastre cargos" : "Selecione"}</option>
                  {formData.role && !jobTitles.some(job => job.name === formData.role) && (
                    <option value={formData.role}>{formData.role}</option>
                  )}
                  {jobTitles.map(job => (
                    <option key={job.id} value={job.name}>{job.name}</option>
                  ))}
                </select>
              </div>

              {(catalogWarning || jobTitles.length === 0 || departments.length === 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <BriefcaseBusiness className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest leading-relaxed">
                      {catalogWarning || "Cadastre cargos e setores antes de salvar um colaborador."}
                    </p>
                  </div>
                  <Link
                    href="/job-sectors"
                    className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-center whitespace-nowrap"
                  >
                    Cadastrar agora
                  </Link>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="workplace_select" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Obra / Canteiro</label>
                <select 
                  id="workplace_select"
                  title="Selecionar canteiro de obra"
                  value={formData.workplace_id}
                  onChange={(e) => setFormData({...formData, workplace_id: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:outline-none transition-all font-bold"
                >
                  <option value="">Administrativo / Sem Canteiro</option>
                  {workplaces.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Admissão</label>
                  <input
                    type="date"
                    value={formData.admission_date}
                    onChange={(e) => setFormData({ ...formData, admission_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:outline-none transition-all font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Demissão</label>
                  <input
                    type="date"
                    value={formData.termination_date}
                    onChange={(e) => setFormData({ ...formData, termination_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:outline-none transition-all font-bold"
                  />
                </div>
              </div>

              </div>

              <div className="shrink-0 flex gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
                <button 
                  type="button" 
                  disabled={isSaving}
                  onClick={closeEditModal}
                  className="flex-1 px-4 py-4 text-xs font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex-1 px-4 py-4 text-xs font-black text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-xl shadow-lg shadow-blue-900/10 uppercase tracking-widest transition-all flex items-center justify-center"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar Cadastro"}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Modal Prontuario */}
      {isProfileOpen && selectedEmployeeId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            {(() => {
              const emp = employees.find(e => e.id === selectedEmployeeId)
              return (
                <>
                  <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="font-black text-slate-800 text-2xl tracking-tighter">{emp?.full_name}</h2>
                        {!emp?.active && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-black uppercase">Desligado</span>}
                      </div>
                      <p className="text-slate-500 text-sm font-medium mt-1">
                        {getJobTitleName(emp?.job_title)} • CPF: {emp?.cpf} • Setor: {getDepartmentName(emp?.department)} • Canteiro: {getWorkplaceName(emp?.workplace_id || null)}
                      </p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button 
                        onClick={openTstModal}
                        disabled={loadingHistory || employeeHistory.length === 0}
                        className="flex-1 sm:flex-none bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md flex items-center justify-center disabled:opacity-50"
                      >
                        <FileDown className="w-4 h-4 mr-2" /> Ficha NR-06
                      </button>
                      <button 
                        onClick={() => setIsProfileOpen(false)} 
                        title="Fechar prontuário"
                        className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 px-4 py-2.5 rounded-xl transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 sm:p-6 bg-slate-50/30">
                    {loadingHistory ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#2563EB]" />
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-slate-700 uppercase tracking-widest text-sm flex items-center">
                            <History className="w-4 h-4 mr-2 text-[#2563EB]" />
                            Histórico de Movimentações
                          </h3>
                        </div>
                        
                        <div className="space-y-3">
                          {employeeHistory.map((delivery) => (
                            <div key={delivery.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4 group">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-black text-slate-800">{delivery.ppe?.name}</span>
                                  <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">CA {delivery.ppe?.ca_number}</span>
                                  <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded font-bold">Qtd: {delivery.quantity}</span>
                                </div>
                                <div className="text-xs text-slate-500 font-medium flex flex-wrap gap-x-4 gap-y-1">
                                  <span>Entregue: {format(new Date(delivery.delivery_date), "dd/MM/yyyy HH:mm")}</span>
                                  {delivery.ppe?.lifespan_days && !delivery.returned_at && (
                                    <span className={isPast(addDays(new Date(delivery.delivery_date), delivery.ppe.lifespan_days)) ? "text-red-600 font-black animate-pulse" : ""}>
                                      Troca em: {format(addDays(new Date(delivery.delivery_date), delivery.ppe.lifespan_days), "dd/MM/yyyy")}
                                      {isPast(addDays(new Date(delivery.delivery_date), delivery.ppe.lifespan_days)) && " • TROCA PENDENTE!"}
                                    </span>
                                  )}
                                  <span>Motivo: {delivery.reason}</span>
                                  {delivery.returned_at && (
                                    <span className="text-[#2563EB] font-bold">
                                      Baixado em: {format(new Date(delivery.returned_at), "dd/MM/yyyy")} ({delivery.return_motive})
                                    </span>
                                  )}
                                </div>
                              </div>
                              
                              {!delivery.returned_at && emp?.active && (
                                <button 
                                  onClick={() => handleReturnItem(delivery.id)}
                                  className="text-[#2563EB] hover:bg-blue-50 text-[10px] font-black uppercase tracking-widest border border-blue-100 px-4 py-2 rounded-xl transition-all self-start sm:self-auto"
                                >
                                  Dar Baixa
                                </button>
                              )}
                              {delivery.returned_at && (
                                <span className="flex items-center text-green-600 text-[10px] font-black uppercase tracking-widest self-start sm:self-auto bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
                                  <ShieldCheck className="w-3 h-3 mr-1" /> Devolvido
                                </span>
                              )}
                            </div>
                          ))}
                          {employeeHistory.length === 0 && (
                            <div className="text-center py-10 bg-white border border-slate-200 border-dashed rounded-2xl">
                              <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                              <p className="text-slate-500 font-medium">Nenhum EPI registrado no prontuário.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {emp?.active && (
                    <div className="p-4 border-t border-slate-200 bg-blue-50/50 flex justify-end">
                      <button 
                        onClick={handleTerminateEmployee}
                        className="text-red-700 hover:bg-red-700 hover:text-white border border-blue-200 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center justify-center"
                      >
                        <UserMinus className="w-4 h-4 mr-2" />
                        Desligar Colaborador (Dar baixa em tudo)
                      </button>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}
      {isTstModalOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Assinar Prontuário</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  {tstStep === 1 ? "Etapa 1 - Identificação do TST" : "Etapa 2 - Assinatura do Responsável"}
                </p>
              </div>
              <button onClick={() => setIsTstModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors" title="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1 - Select TST from employee list */}
            {tstStep === 1 && (
              <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest">
                    Selecione o Técnico de Segurança do Trabalho cadastrado no sistema.
                  </p>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={tstSearchTerm}
                    onChange={e => setTstSearchTerm(e.target.value)}
                    placeholder="Buscar por nome ou CPF..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm font-bold focus:border-[#2563EB] outline-none"
                  />
                </div>

                <div className="max-h-[280px] overflow-y-auto space-y-2 custom-scrollbar">
                  {employees
                    .filter(e => e.active && (
                      e.full_name.toLowerCase().includes(tstSearchTerm.toLowerCase()) ||
                      e.cpf.includes(tstSearchTerm)
                    ))
                    .map(emp => (
                      <button
                        key={emp.id}
                        onClick={() => handleSelectTst(emp)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-[#2563EB]/30 hover:bg-blue-50/50 transition-all text-left group"
                      >
                        {emp.photo_url ? (
                          <Image src={emp.photo_url} alt={emp.full_name} width={40} height={40} className="w-10 h-10 rounded-full object-cover border-2 border-green-500" unoptimized />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border-2 border-slate-200">
                            <Users className="w-5 h-5" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-slate-800 text-sm truncate">{emp.full_name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{getJobTitleName(emp.job_title)} • CPF: {emp.cpf}</p>
                        </div>
                        {emp.photo_url && (
                          <span className="text-[8px] font-black text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100 uppercase tracking-widest flex-shrink-0">✓ Foto</span>
                        )}
                      </button>
                    ))
                  }
                  {employees.filter(e => e.active && (
                    e.full_name.toLowerCase().includes(tstSearchTerm.toLowerCase()) || e.cpf.includes(tstSearchTerm)
                  )).length === 0 && (
                    <div className="text-center py-8 text-slate-400">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-bold">Nenhum colaborador encontrado.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2 - Capture Signature */}
            {tstStep === 2 && (
              <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                {/* Notice for Missing Photo */}
                {!tstSelectedEmployee?.photo_url && !tstSignatureBase64 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3 items-start">
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest leading-relaxed">
                      Este colaborador não possui foto pré-cadastrada. Você pode capturar uma foto agora (Foto Biométrica) ou fazer a assinatura na tela (Assinatura Manual).
                    </p>
                  </div>
                )}

                {/* Auth Method Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => { setTstAuthMethod('manual'); setTstSignatureBase64(null); setIsFaceCameraTstOpen(false); }}
                    className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${tstAuthMethod === 'manual' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                  >
                    <PenTool className="w-3.5 h-3.5 inline mr-1" /> Assinatura Manual
                  </button>
                  <button
                    onClick={() => { setTstAuthMethod('manual_facial'); setTstSignatureBase64(null); setIsFaceCameraTstOpen(false); }}
                    className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${tstAuthMethod === 'manual_facial' ? 'bg-white shadow text-emerald-700' : 'text-slate-400'}`}
                  >
                    <Camera className="w-3.5 h-3.5 inline mr-1" /> Foto + Assinatura
                  </button>
                  <button
                    onClick={() => { setTstAuthMethod('facial'); setTstSignatureBase64(null); setIsFaceCameraTstOpen(true); }}
                    className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${tstAuthMethod === 'facial' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                  >
                    <Camera className="w-3.5 h-3.5 inline mr-1" /> Foto Biométrica
                  </button>
                </div>

                {/* Manual Signature Pad */}
                {(tstAuthMethod === 'manual' || tstAuthMethod === 'manual_facial') && !isFaceCameraTstOpen && (
                  <div className="space-y-2">
                    {tstAuthMethod === 'manual_facial' && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                        {tstPhotoBase64 ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={tstPhotoBase64} alt="Foto do responsavel tecnico" className="w-12 h-12 rounded-xl object-cover border border-emerald-200" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                            <Camera className="w-5 h-5" />
                          </div>
                        )}
                        <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest leading-relaxed">
                          O prontuario vai sair com foto e assinatura manual do responsavel tecnico.
                        </p>
                      </div>
                    )}
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tstName} - Assine abaixo:</p>
                    {tstSignatureBase64 ? (
                      <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={tstSignatureBase64} alt="Assinatura TST" className="w-full h-28 object-contain bg-slate-50" />
                        <button
                          onClick={() => setTstSignatureBase64(null)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1"
                          title="Refazer assinatura"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-2 left-2 text-[8px] font-black text-green-600 uppercase tracking-widest bg-green-50 px-2 py-0.5 rounded">✓ Assinatura Capturada</div>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50">
                        <SignatureCanvas
                          ref={tstSigCanvas}
                          canvasProps={{ className: "w-full h-28 touch-none", style: { width: '100%', height: '112px' } }}
                          penColor="#1e293b"
                        />
                      </div>
                    )}
                    {!tstSignatureBase64 && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { if (tstSigCanvas.current) tstSigCanvas.current.clear() }}
                          className="flex-1 py-2 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50"
                        >
                          Limpar
                        </button>
                        <button
                          onClick={() => {
                            if (!tstSigCanvas.current || tstSigCanvas.current.isEmpty()) {
                              toast.error("Por favor, assine antes de confirmar.")
                              return
                            }
                            setTstSignatureBase64(tstSigCanvas.current.toDataURL('image/png'))
                          }}
                          className="flex-1 py-2 text-[10px] font-black text-white bg-[#2563EB] uppercase tracking-widest rounded-xl hover:bg-[#1D4ED8]"
                        >
                          Confirmar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Facial Capture */}
                {tstAuthMethod === 'facial' && (
                  <div>
                    {tstSignatureBase64 ? (
                      <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={tstSignatureBase64} alt="Foto TST" className="w-full h-36 object-contain bg-slate-900" />
                        <button
                          onClick={() => { setTstSignatureBase64(null); setIsFaceCameraTstOpen(true); }}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1"
                          title="Refazer foto"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-2 left-2 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-900/80 px-2 py-0.5 rounded">✓ Foto Capturada</div>
                      </div>
                    ) : (
                      <FaceCamera
                        onCapture={(_, img) => { setTstSignatureBase64(img); setIsFaceCameraTstOpen(false); }}
                        onCancel={() => { setTstAuthMethod('manual'); setIsFaceCameraTstOpen(false); }}
                        cancelLabel="Usar assinatura manual"
                      />
                    )}
                  </div>
                )}

                {/* Generate PDF button */}
                <div className="flex gap-2 pt-2 pb-2 shrink-0">
                  <button
                    onClick={() => setTstStep(1)}
                    className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50"
                  >
                    ← Voltar
                  </button>
                  <button
                    onClick={exportNR06PDF}
                    disabled={!tstSignatureBase64 || (tstAuthMethod === 'manual_facial' && !tstPhotoBase64) || isGeneratingPdf}
                    className="flex-1 py-3 text-[10px] font-black text-white bg-[#2563EB] hover:bg-[#1D4ED8] uppercase tracking-widest rounded-xl shadow-lg shadow-blue-900/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  >
                    {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                    {isGeneratingPdf ? "Gerando PDF..." : "Gerar Prontuário NR-06"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {pdfActionDialog}
    </div>
  )
}

