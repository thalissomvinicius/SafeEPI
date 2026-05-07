"use client"

import { useState, useEffect, useCallback } from "react"
import { CheckCircle2, Award, Calendar, Search, Plus, X, Loader2, FileDown, Camera, PenTool, ShieldAlert, Users, Link2, ArrowLeft, Trash2 } from "lucide-react"
import { api } from "@/services/api"
import { Employee, TrainingWithRelations } from "@/types/database"
import { format } from "date-fns"
import { toast } from "sonner"
import { useRef } from "react"
import SignatureCanvas from "react-signature-canvas"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateTrainingCertificate } from "@/utils/pdfGenerator"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"
import { generateAuditCode } from "@/utils/auditCode"
import { copyTextToClipboard } from "@/utils/clipboard"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { calculateTrainingValidity, getTrainingStatusFromValidity, getTrainingWorkloadRule } from "@/utils/trainingValidity"

type RemoteSignatureEvidence = {
  signatureBase64: string
  photoBase64?: string | null
  authMethod?: 'manual' | 'facial' | 'manual_facial'
}

type RemoteLinkStatus = "idle" | "pending" | "completed" | "expired"

type PendingTrainingDraft = {
  key: string
  employeeId: string
  employeeName: string
  instructorId: string
  instructorName: string
  trainingName: string
  completionDate: string
  expiryDate: string
  participantToken?: string | null
  participantStatus?: RemoteLinkStatus
  participantExpiresAt?: string | null
  instructorToken?: string | null
  instructorStatus?: RemoteLinkStatus
  instructorExpiresAt?: string | null
}

const TRAINING_OPTIONS = [
  "Uso e Guarda de EPI (NR-06)",
  "Integração de Segurança (NR-01)",
  "Trabalho em Altura (NR-35)",
  "Segurança Elétrica (NR-10)",
  "Espaço Confinado (NR-33)",
  "Inflamáveis e Combustíveis (NR-20)",
  "CIPA (NR-05)",
  "Operador de Empilhadeira / Ponte Rolante (NR-11)",
  "Máquinas e Equipamentos (NR-12)",
  "Construção Civil (NR-18)",
  "Rural / Agro (NR-31)",
  "Indústria Naval / Trabalho a Quente (NR-34)",
]

export default function TrainingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const canDeleteCertificate = user?.role === "MASTER"
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [trainings, setTrainings] = useState<TrainingWithRelations[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeletingCertificate, setIsDeletingCertificate] = useState(false)
  const [certificateToDelete, setCertificateToDelete] = useState<TrainingWithRelations | null>(null)
  const [pendingDrafts, setPendingDrafts] = useState<PendingTrainingDraft[]>([])

  // Form State
  const [formData, setFormData] = useState({
    employee_id: "",
    training_name: "Uso e Guarda de EPI (NR-06)",
    completion_date: format(new Date(), "yyyy-MM-dd"),
  })
  const [customTrainingName, setCustomTrainingName] = useState("")

  // TST / Instructor Modal State
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1) // 1=Course, 2=Instructor, 3=Participant, 4=Instructor Signature
  const [tstSelectedEmployee, setTstSelectedEmployee] = useState<Employee | null>(null)
  const [tstSearchTerm, setTstSearchTerm] = useState("")
  const [tstRole, setTstRole] = useState("Técnico de Segurança do Trabalho")
  const [tstAuthMethod, setTstAuthMethod] = useState<'manual' | 'facial' | 'manual_facial'>('manual')
  const [tstSignatureBase64, setTstSignatureBase64] = useState<string | null>(null)
  const [tstPhotoBase64, setTstPhotoBase64] = useState<string | null>(null)
  const [instructorSignatureBase64, setInstructorSignatureBase64] = useState<string | null>(null)
  const [instructorPhotoBase64, setInstructorPhotoBase64] = useState<string | null>(null)
  const [participantRemoteToken, setParticipantRemoteToken] = useState<string | null>(null)
  const [instructorRemoteToken, setInstructorRemoteToken] = useState<string | null>(null)
  const [participantRemoteStatus, setParticipantRemoteStatus] = useState<RemoteLinkStatus>("idle")
  const [instructorRemoteStatus, setInstructorRemoteStatus] = useState<RemoteLinkStatus>("idle")
  const [participantRemoteExpiresAt, setParticipantRemoteExpiresAt] = useState<string | null>(null)
  const [instructorRemoteExpiresAt, setInstructorRemoteExpiresAt] = useState<string | null>(null)
  const [remoteWaitHours, setRemoteWaitHours] = useState(24)
  const [isCheckingRemoteSignatures, setIsCheckingRemoteSignatures] = useState(false)
  const [isFaceCameraTstOpen, setIsFaceCameraTstOpen] = useState(false)
  const tstSigCanvas = useRef<SignatureCanvas | null>(null)
  const instructorSigCanvas = useRef<SignatureCanvas | null>(null)

  const getTrainedEmployee = () => employees.find(item => item.id === formData.employee_id) || null

  const getFinalTrainingName = useCallback(() => (
    formData.training_name === "Outro" ? customTrainingName.trim() : formData.training_name
  ), [customTrainingName, formData.training_name])

  const getCurrentTrainingValidity = () => calculateTrainingValidity(
    getFinalTrainingName() || formData.training_name,
    formData.completion_date
  )

  const getCurrentTrainingWorkload = () => getTrainingWorkloadRule(getFinalTrainingName() || formData.training_name)

  const getTrainedEmployeeDescriptor = () => {
    const descriptor = getTrainedEmployee()?.face_descriptor
    return descriptor && descriptor.length > 0 ? new Float32Array(descriptor) : undefined
  }

  const formatRemoteExpiry = (value: string | null) => {
    if (!value) return ""
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const renderRemoteStatusText = (status: RemoteLinkStatus, expiresAt: string | null, label: string) => {
    if (status === "completed") return `Assinatura remota do ${label} concluida.`
    if (status === "expired") return `Link do ${label} expirado. Gere um novo link.`
    if (status === "pending") return `Aguardando assinatura do ${label} ate ${formatRemoteExpiry(expiresAt)}.`
    return ""
  }

  const getDraftVisualStatus = (draft: PendingTrainingDraft): RemoteLinkStatus => {
    if (draft.participantStatus === "expired" || draft.instructorStatus === "expired") return "expired"
    if (draft.participantStatus === "completed" && draft.instructorStatus === "completed") return "completed"
    return "pending"
  }

  const loadPendingDrafts = useCallback(() => {
    if (typeof window === "undefined") return

    const drafts: PendingTrainingDraft[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith("training-signature:")) continue

      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || "{}") as Partial<PendingTrainingDraft>
        if (!parsed.participantToken && !parsed.instructorToken) continue

        const [, employeeId = "", instructorId = "", trainingName = "", completionDate = ""] = key.split(":")
        const employee = employees.find(item => item.id === (parsed.employeeId || employeeId))
        const instructor = employees.find(item => item.id === (parsed.instructorId || instructorId))
        const draftCompletionDate = parsed.completionDate || completionDate || format(new Date(), "yyyy-MM-dd")

        drafts.push({
          key,
          employeeId: parsed.employeeId || employeeId,
          employeeName: parsed.employeeName || employee?.full_name || "Colaborador",
          instructorId: parsed.instructorId || instructorId,
          instructorName: parsed.instructorName || instructor?.full_name || "Instrutor",
          trainingName: parsed.trainingName || trainingName || "Treinamento",
          completionDate: draftCompletionDate,
          expiryDate: parsed.expiryDate || calculateTrainingValidity(parsed.trainingName || trainingName || "Treinamento", draftCompletionDate).expiryDate,
          participantToken: parsed.participantToken || null,
          participantStatus: parsed.participantStatus || "idle",
          participantExpiresAt: parsed.participantExpiresAt || null,
          instructorToken: parsed.instructorToken || null,
          instructorStatus: parsed.instructorStatus || "idle",
          instructorExpiresAt: parsed.instructorExpiresAt || null,
        })
      } catch {
        // Ignore malformed drafts.
      }
    }

    setPendingDrafts(drafts.sort((a, b) => b.completionDate.localeCompare(a.completionDate)))
  }, [employees])

  const getRemoteDraftKey = useCallback((instructorId = tstSelectedEmployee?.id || "") => {
    const training = formData.training_name === "Outro" ? customTrainingName.trim() : formData.training_name
    return `training-signature:${formData.employee_id}:${instructorId}:${training}:${formData.completion_date}`
  }, [customTrainingName, formData.completion_date, formData.employee_id, formData.training_name, tstSelectedEmployee?.id])

  const persistRemoteDraft = useCallback((draft: {
    participantToken?: string | null
    participantStatus?: RemoteLinkStatus
    participantExpiresAt?: string | null
    instructorToken?: string | null
    instructorStatus?: RemoteLinkStatus
    instructorExpiresAt?: string | null
  }) => {
    if (typeof window === "undefined") return
    const key = getRemoteDraftKey()
    const current = window.localStorage.getItem(key)
    const parsed = current ? JSON.parse(current) as Record<string, unknown> : {}
    const trainedEmployee = employees.find(item => item.id === formData.employee_id)
    const trainingName = getFinalTrainingName()
    const completionDate = formData.completion_date
    const expiryDate = calculateTrainingValidity(trainingName || formData.training_name, completionDate).expiryDate
    window.localStorage.setItem(key, JSON.stringify({
      ...parsed,
      employeeId: formData.employee_id,
      employeeName: trainedEmployee?.full_name || "",
      instructorId: tstSelectedEmployee?.id || "",
      instructorName: tstSelectedEmployee?.full_name || "",
      trainingName,
      completionDate,
      expiryDate,
      ...draft,
    }))
    loadPendingDrafts()
  }, [employees, formData.completion_date, formData.employee_id, formData.training_name, getFinalTrainingName, getRemoteDraftKey, loadPendingDrafts, tstSelectedEmployee?.full_name, tstSelectedEmployee?.id])

  const restoreRemoteDraft = useCallback((instructorId: string) => {
    if (typeof window === "undefined") return
    const raw = window.localStorage.getItem(getRemoteDraftKey(instructorId))
    if (!raw) return

    try {
      const draft = JSON.parse(raw) as {
        participantToken?: string | null
        participantStatus?: RemoteLinkStatus
        participantExpiresAt?: string | null
        instructorToken?: string | null
        instructorStatus?: RemoteLinkStatus
        instructorExpiresAt?: string | null
      }
      setParticipantRemoteToken(draft.participantToken || null)
      setParticipantRemoteStatus(draft.participantStatus || "idle")
      setParticipantRemoteExpiresAt(draft.participantExpiresAt || null)
      setInstructorRemoteToken(draft.instructorToken || null)
      setInstructorRemoteStatus(draft.instructorStatus || "idle")
      setInstructorRemoteExpiresAt(draft.instructorExpiresAt || null)
    } catch {
      window.localStorage.removeItem(getRemoteDraftKey(instructorId))
    }
  }, [getRemoteDraftKey])

  const loadData = async () => {
    try {
      setLoading(true)
      const [trainingsResult, employeesResult] = await Promise.allSettled([
        api.getTrainings(),
        api.getEmployees()
      ])

      if (trainingsResult.status === "fulfilled") {
        setTrainings(trainingsResult.value)
      } else {
        console.error("Erro ao carregar treinamentos:", trainingsResult.reason)
        setTrainings([])
        toast.warning("Nao foi possivel carregar o historico de treinamentos agora. O cadastro continua disponivel.")
      }

      if (employeesResult.status === "fulfilled") {
        const eData = employeesResult.value
        const availableEmployees = eData.filter(e => e.active !== false)
        const employeesForTraining = availableEmployees.length > 0 ? availableEmployees : eData

        setEmployees(employeesForTraining)
        setFormData(prev => ({
          ...prev,
          employee_id: employeesForTraining.find(emp => emp.id === prev.employee_id)?.id || employeesForTraining[0]?.id || ""
        }))
      } else {
        console.error("Erro ao carregar colaboradores:", employeesResult.reason)
        setEmployees([])
        toast.error("Falha ao carregar os colaboradores no Supabase.")
      }
    } catch (error) {
      console.error("Erro inesperado ao carregar dados de treinamentos:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.company?.training_enabled === false) {
      toast.error("Modulo de treinamentos nao liberado para esta empresa.")
      router.replace("/")
      return
    }

    const fetchInitialData = async () => {
        await loadData()
    }
    fetchInitialData()
  }, [router, user])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadPendingDrafts()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadPendingDrafts])

  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.employee_id) return
    if (!tstSignatureBase64 || !tstSelectedEmployee || (tstAuthMethod === 'manual_facial' && !tstPhotoBase64)) {
      toast.error("É necessário colher a evidência do colaborador treinado.")
      return
    }

    if (!instructorSignatureBase64) {
      toast.error("A assinatura do instrutor tambem e obrigatoria.")
      return
    }

    let finalTrainingName = formData.training_name
    if (formData.training_name === "Outro" && !customTrainingName.trim()) {
        toast.error("Por favor, especifique o nome do treinamento.")
        return
    }
    if (formData.training_name === "Outro") {
        finalTrainingName = customTrainingName
    }

    try {
      setIsSaving(true)
      const completionDate = new Date(formData.completion_date)
      const validity = calculateTrainingValidity(finalTrainingName, formData.completion_date)

      const result = await api.addTraining({
        employee_id: formData.employee_id,
        training_name: finalTrainingName,
        completion_date: formData.completion_date,
        expiry_date: validity.expiryDate,
        status: getTrainingStatusFromValidity(finalTrainingName, validity.expiryDate),
        instructor_id: tstSelectedEmployee.id,
        instructor_name: tstSelectedEmployee.full_name,
        instructor_role: tstRole,
        signature_url: tstSignatureBase64,
        auth_method: tstAuthMethod === 'manual_facial' ? 'manual' : tstAuthMethod
      })

      const trainedEmployee = employees.find(emp => emp.id === formData.employee_id)
      const validationCode = generateAuditCode(`CERT-${format(completionDate, "yyyy")}`, 10)
      const pdfBlob = await generateTrainingCertificate({
        employeeName: trainedEmployee?.full_name || "N/A",
        employeeCpf: trainedEmployee?.cpf || "N/A",
        trainingName: finalTrainingName,
        completionDate: formData.completion_date,
        expiryDate: validity.expiryDate,
        instructorName: tstSelectedEmployee.full_name,
        instructorRole: tstRole,
        instructorPhotoBase64: instructorPhotoBase64 || undefined,
        instructorSignatureBase64,
        participantSignatureBase64: tstAuthMethod === 'manual' || tstAuthMethod === 'manual_facial' ? tstSignatureBase64 : undefined,
        participantPhotoBase64: tstAuthMethod === 'manual_facial' ? tstPhotoBase64 || undefined : tstAuthMethod === 'facial' ? tstSignatureBase64 : undefined,
        participantAuthMethod: tstAuthMethod,
        validationCode,
      })

      const safeEmployee = (trainedEmployee?.full_name || "Certificado")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
      const safeTraining = finalTrainingName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")

      const fileName = `Certificado_${safeEmployee}_${safeTraining}.pdf`

      try {
        await api.archiveSignedDocument({
          documentType: "training_certificate",
          employeeId: formData.employee_id,
          trainingId: result.training.id,
          fileName,
          pdfBlob,
          authMethod: tstAuthMethod,
          metadata: {
            validationCode,
            trainingName: finalTrainingName,
            completionDate: formData.completion_date,
            expiryDate: validity.expiryDate,
            instructorId: tstSelectedEmployee.id,
            instructorName: tstSelectedEmployee.full_name,
            instructorRole: tstRole,
          },
        })
      } catch (archiveError) {
        const message = archiveError instanceof Error ? archiveError.message : "Nao foi possivel arquivar o PDF assinado."
        toast.warning(message)
      }

      openPdfDialog(pdfBlob, fileName, {
        title: "Certificado pronto",
        description: "Escolha se deseja visualizar o certificado em uma nova aba ou baixar o PDF agora.",
      })

      await loadData()
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(getRemoteDraftKey())
        loadPendingDrafts()
      }
      setIsModalOpen(false)
      resetForm()
      if (result.warning) {
        toast.warning(result.warning)
      } else {
        toast.success("Treinamento registrado com sucesso!")
      }
    } catch (error: unknown) {
      console.error("Erro ao salvar treinamento:", error)
      const message = error instanceof Error ? error.message : "Erro ao salvar treinamento no banco de dados."
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setStep(1)
    setTstSelectedEmployee(null)
    setTstSearchTerm("")
    setTstSignatureBase64(null)
    setTstPhotoBase64(null)
    setInstructorSignatureBase64(null)
    setInstructorPhotoBase64(null)
    setParticipantRemoteToken(null)
    setInstructorRemoteToken(null)
    setParticipantRemoteStatus("idle")
    setInstructorRemoteStatus("idle")
    setParticipantRemoteExpiresAt(null)
    setInstructorRemoteExpiresAt(null)
    setTstAuthMethod('manual')
    setCustomTrainingName("")
    setFormData(prev => ({ ...prev, training_name: "Uso e Guarda de EPI (NR-06)" }))
  }

  const handleSelectTst = async (emp: Employee) => {
    setTstSelectedEmployee(emp)
    setTstSignatureBase64(null)
    setTstPhotoBase64(null)
    setInstructorSignatureBase64(null)
    setInstructorPhotoBase64(null)
    setParticipantRemoteToken(null)
    setInstructorRemoteToken(null)
    setParticipantRemoteStatus("idle")
    setInstructorRemoteStatus("idle")
    setParticipantRemoteExpiresAt(null)
    setInstructorRemoteExpiresAt(null)
    setTstRole(emp.job_title || "Técnico de Segurança do Trabalho")
    
    if (emp.photo_url) {
      try {
        const res = await fetch(emp.photo_url)
        const blob = await res.blob()
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        setInstructorPhotoBase64(b64)
      } catch {
        setInstructorPhotoBase64(null)
      }
    }

    setTstAuthMethod('manual')
    setStep(3)
    restoreRemoteDraft(emp.id)
  }

  const openPendingDraft = async (draft: PendingTrainingDraft) => {
    const instructor = employees.find(item => item.id === draft.instructorId) || null
    const isKnownTraining = TRAINING_OPTIONS.includes(draft.trainingName)

    setFormData({
      employee_id: draft.employeeId,
      training_name: isKnownTraining ? draft.trainingName : "Outro",
      completion_date: draft.completionDate,
    })
    setCustomTrainingName(isKnownTraining ? "" : draft.trainingName)
    setTstSelectedEmployee(instructor)
    setTstSearchTerm("")
    setTstSignatureBase64(null)
    setTstPhotoBase64(null)
    setInstructorSignatureBase64(null)
    setParticipantRemoteToken(draft.participantToken || null)
    setParticipantRemoteStatus(draft.participantStatus || "idle")
    setParticipantRemoteExpiresAt(draft.participantExpiresAt || null)
    setInstructorRemoteToken(draft.instructorToken || null)
    setInstructorRemoteStatus(draft.instructorStatus || "idle")
    setInstructorRemoteExpiresAt(draft.instructorExpiresAt || null)
    setTstRole(instructor?.job_title || "Técnico de Segurança do Trabalho")
    setTstAuthMethod("manual")
    setIsFaceCameraTstOpen(false)
    setStep(instructor ? 3 : 2)
    setIsModalOpen(true)

    if (instructor?.photo_url) {
      try {
        const res = await fetch(instructor.photo_url)
        const blob = await res.blob()
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        setInstructorPhotoBase64(b64)
      } catch {
        setInstructorPhotoBase64(null)
      }
    } else {
      setInstructorPhotoBase64(null)
    }
  }

  const generateTrainingRemoteSignatureLink = async () => {
    const trainedEmployee = getTrainedEmployee()
    if (!trainedEmployee) {
      toast.error("Selecione o colaborador treinado antes de gerar o link.")
      return
    }

    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
      const finalTrainingName = formData.training_name === "Outro" ? customTrainingName.trim() : formData.training_name
      const validity = calculateTrainingValidity(finalTrainingName || formData.training_name, formData.completion_date)

      const data = await api.createRemoteLink({
        employee_id: trainedEmployee.id,
        type: "training_signature",
        expires_hours: remoteWaitHours,
        data: {
          trainingName: finalTrainingName || formData.training_name,
          completionDate: formData.completion_date,
          expiryDate: validity.expiryDate,
        },
      })

      const url = `${baseUrl}/training/remote?t=${data.link.token}`
      setParticipantRemoteToken(data.link.token)
      setParticipantRemoteStatus("pending")
      setParticipantRemoteExpiresAt(data.link.expires_at)
      persistRemoteDraft({
        participantToken: data.link.token,
        participantStatus: "pending",
        participantExpiresAt: data.link.expires_at,
      })
      const copied = await copyTextToClipboard(url)
      if (copied) {
        toast.success(`Link de assinatura do treinamento copiado. Valido por ${remoteWaitHours}h e uso unico.`)
      } else {
        toast.warning("Link de assinatura gerado. Copie pela aba de pendencias se o navegador bloquear a area de transferencia.")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao gerar link."
      toast.error(message)
    }
  }

  const generateInstructorRemoteSignatureLink = async () => {
    if (!tstSelectedEmployee) {
      toast.error("Selecione o instrutor antes de gerar o link.")
      return
    }

    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
      const finalTrainingName = formData.training_name === "Outro" ? customTrainingName.trim() : formData.training_name
      const data = await api.createRemoteLink({
        employee_id: tstSelectedEmployee.id,
        type: "training_signature",
        expires_hours: remoteWaitHours,
        data: {
          trainingName: `Instrutor - ${finalTrainingName || formData.training_name}`,
          completionDate: formData.completion_date,
          signerRole: "instructor",
        },
      })

      const url = `${baseUrl}/training/remote?t=${data.link.token}`
      setInstructorRemoteToken(data.link.token)
      setInstructorRemoteStatus("pending")
      setInstructorRemoteExpiresAt(data.link.expires_at)
      persistRemoteDraft({
        instructorToken: data.link.token,
        instructorStatus: "pending",
        instructorExpiresAt: data.link.expires_at,
      })
      const copied = await copyTextToClipboard(url)
      if (copied) {
        toast.success(`Link de assinatura do instrutor copiado. Valido por ${remoteWaitHours}h e uso unico.`)
      } else {
        toast.warning("Link do instrutor gerado. Copie pela aba de pendencias se o navegador bloquear a area de transferencia.")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao gerar link."
      toast.error(message)
    }
  }

  const applyRemoteSignature = useCallback((target: "participant" | "instructor", evidence: RemoteSignatureEvidence) => {
    if (target === "participant") {
      const method = evidence.authMethod || "manual"
      setTstAuthMethod(method)
      setTstSignatureBase64(evidence.signatureBase64)
      setTstPhotoBase64(evidence.photoBase64 || null)
      setIsFaceCameraTstOpen(false)
      return
    }

    setInstructorSignatureBase64(evidence.signatureBase64)
  }, [])

  const checkRemoteSignature = useCallback(async (token: string, target: "participant" | "instructor") => {
    const res = await fetch(`/api/remote-links?token=${token}&include_completed=1`)
    const payload = await res.json()
    if (!res.ok) {
      if (payload.status === "expired") {
        if (target === "participant") setParticipantRemoteStatus("expired")
        if (target === "instructor") setInstructorRemoteStatus("expired")
        persistRemoteDraft(target === "participant"
          ? { participantStatus: "expired" }
          : { instructorStatus: "expired" }
        )
      }
      return false
    }

    if (payload.link?.expires_at) {
      if (target === "participant") setParticipantRemoteExpiresAt(payload.link.expires_at)
      if (target === "instructor") setInstructorRemoteExpiresAt(payload.link.expires_at)
    }

    if (payload.link?.status !== "completed") {
      if (target === "participant") setParticipantRemoteStatus("pending")
      if (target === "instructor") setInstructorRemoteStatus("pending")
      return false
    }

    const evidence = payload.link.data as RemoteSignatureEvidence | null
    if (!evidence?.signatureBase64) return false

    applyRemoteSignature(target, evidence)
    if (target === "participant") setParticipantRemoteStatus("completed")
    if (target === "instructor") setInstructorRemoteStatus("completed")
    persistRemoteDraft(target === "participant"
      ? { participantStatus: "completed" }
      : { instructorStatus: "completed" }
    )
    return true
  }, [applyRemoteSignature, persistRemoteDraft])

  const syncRemoteSignatures = useCallback(async () => {
    if (!participantRemoteToken && !instructorRemoteToken) return

    try {
      setIsCheckingRemoteSignatures(true)
      await Promise.all([
        participantRemoteToken && !tstSignatureBase64
          ? checkRemoteSignature(participantRemoteToken, "participant")
          : Promise.resolve(false),
        instructorRemoteToken && !instructorSignatureBase64
          ? checkRemoteSignature(instructorRemoteToken, "instructor")
          : Promise.resolve(false),
      ])
    } catch (err) {
      console.error("Erro ao consultar assinaturas remotas:", err)
    } finally {
      setIsCheckingRemoteSignatures(false)
    }
  }, [checkRemoteSignature, instructorRemoteToken, instructorSignatureBase64, participantRemoteToken, tstSignatureBase64])

  useEffect(() => {
    if (!isModalOpen || (!participantRemoteToken && !instructorRemoteToken)) return
    if (
      (!participantRemoteToken || tstSignatureBase64) &&
      (!instructorRemoteToken || instructorSignatureBase64)
    ) return

    const timer = window.setInterval(() => {
      void syncRemoteSignatures()
    }, 5000)

    const immediate = window.setTimeout(() => {
      void syncRemoteSignatures()
    }, 0)

    return () => {
      window.clearInterval(timer)
      window.clearTimeout(immediate)
    }
  }, [isModalOpen, participantRemoteToken, instructorRemoteToken, tstSignatureBase64, instructorSignatureBase64, syncRemoteSignatures])

  const downloadCertificate = async (rec: TrainingWithRelations) => {
    try {
      const signedDocument = await api.getTrainingCertificateDocument(rec.id)
      if (signedDocument?.document_url) {
        const response = await fetch(signedDocument.document_url)
        if (!response.ok) throw new Error("PDF arquivado indisponivel.")
        const archivedPdfBlob = await response.blob()
        openPdfDialog(archivedPdfBlob, signedDocument.file_name || "Certificado.pdf", {
          title: "Certificado arquivado",
          description: "Este é o PDF original arquivado no momento da emissão, com as evidências de assinatura disponíveis.",
        })
        return
      }
    } catch (error) {
      console.warn("Nao foi possivel carregar o certificado arquivado:", error)
      toast.warning("PDF arquivado nao encontrado. Gerando uma copia reconstruida pelo cadastro.")
    }

    const pdfBlob = await generateTrainingCertificate({
      employeeName: rec.employee?.full_name || "N/A",
      employeeCpf: rec.employee?.cpf || "N/A",
      trainingName: rec.training_name,
      completionDate: rec.completion_date,
      expiryDate: rec.expiry_date,
      instructorName: rec.instructor_name || "N/A",
      instructorRole: rec.instructor_role || "Técnico de Segurança",
      participantSignatureBase64: rec.auth_method === 'manual' || rec.auth_method === 'manual_facial' ? rec.signature_url || undefined : undefined,
      participantPhotoBase64: rec.auth_method === 'facial' ? rec.signature_url || undefined : undefined,
      participantAuthMethod: rec.auth_method || 'manual',
    })

    const safeEmployee = (rec.employee?.full_name || "Certificado")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    const safeTraining = rec.training_name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")

    openPdfDialog(pdfBlob, `Certificado_${safeEmployee}_${safeTraining}.pdf`, {
      title: "Certificado pronto",
      description: "Escolha se deseja visualizar o certificado em uma nova aba ou baixar o PDF agora.",
    })
  }

  const getTrainingStatusLabel = (trainingName: string, expiryDate: string, status?: string | null) => {
    const validity = calculateTrainingValidity(trainingName, new Date())
    if (!validity.hasFixedExpiry) return "Válido"

    const calculatedStatus = getTrainingStatusFromValidity(trainingName, expiryDate)
    if (calculatedStatus !== "Válido") return calculatedStatus

    const normalized = (status || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()

    if (normalized.includes("vencido")) return "Vencido"
    if (normalized.includes("vencendo")) return "Vencendo"
    return calculatedStatus
  }

  const isTrainingValid = (trainingName: string, expiryDate: string, status?: string | null) => (
    getTrainingStatusLabel(trainingName, expiryDate, status) === "Válido"
  )

  const getTrainingExpiryDisplay = (trainingName: string, expiryDate: string) => {
    const validity = calculateTrainingValidity(trainingName, new Date())
    return validity.hasFixedExpiry ? new Date(expiryDate).toLocaleDateString() : "Sem validade fixa"
  }

  const requestDeleteCertificate = (rec: TrainingWithRelations) => {
    if (!canDeleteCertificate) return
    setCertificateToDelete(rec)
  }

  const deleteCertificate = async () => {
    if (!canDeleteCertificate || !certificateToDelete) return
    try {
      setIsDeletingCertificate(true)
      await api.deleteTraining(certificateToDelete.id)
      setTrainings((current) => current.filter((item) => item.id !== certificateToDelete.id))
      setCertificateToDelete(null)
      toast.success("Certificado excluido com sucesso.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel excluir o certificado."
      toast.error(message)
    } finally {
      setIsDeletingCertificate(false)
    }
  }

  const filteredTrainings = trainings.filter(t => 
    t.training_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.employee?.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredPendingDrafts = pendingDrafts.filter(draft =>
    draft.trainingName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    draft.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    draft.instructorName.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
              <Award className="w-6 h-6 mr-2 text-[#2563EB]" />
              Treinamentos SafeEPI
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestão de competências e normas regulamentadoras (NRs).</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-lg shadow-blue-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" />
          Registrar Treinamento
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-200 bg-slate-50/30">
          <div className="relative max-w-md">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar treinamento ou colaborador..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              title="Buscar treinamento"
              aria-label="Buscar treinamento"
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] transition-all"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[300px]">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#2563EB]" />
                <p className="text-sm font-medium italic">Acessando registros do Supabase...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                  <th className="px-6 py-5">Colaborador</th>
                  <th className="px-6 py-4">Treinamento / Norma</th>
                  <th className="px-6 py-4">Realizado em</th>
                   <th className="px-6 py-4">Válido até</th>
                   <th className="px-6 py-4 text-center">Status</th>
                   <th className="px-6 py-4 text-right">Ações</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 font-medium">
                {filteredPendingDrafts.map((draft) => {
                  const status = getDraftVisualStatus(draft)
                  return (
                    <tr
                      key={draft.key}
                      onClick={() => void openPendingDraft(draft)}
                      className="hover:bg-amber-50/70 transition-colors group cursor-pointer bg-amber-50/20"
                    >
                      <td className="px-6 py-5 font-bold text-slate-800">
                        <div>{draft.employeeName}</div>
                        <div className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">Instrutor: {draft.instructorName}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 italic">{draft.trainingName}</td>
                      <td className="px-6 py-4 text-slate-400">
                        <div className="flex items-center">
                          <Calendar className="w-3 h-3 mr-2" /> {new Date(draft.completionDate).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">{getTrainingExpiryDisplay(draft.trainingName, draft.expiryDate)}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                          status === "completed"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : status === "expired"
                              ? "bg-red-50 text-red-700 border-blue-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}>
                          {status === "completed" ? "Assinaturas concluídas" : status === "expired" ? "Link expirado" : "Aguardando assinatura"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(event) => { event.stopPropagation(); void openPendingDraft(draft); }}
                          title="Abrir pendência"
                          className="p-2 bg-amber-50 hover:bg-[#2563EB] hover:text-white text-amber-700 rounded-lg transition-all"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filteredTrainings.map((rec, i) => {
                  const statusLabel = getTrainingStatusLabel(rec.training_name, rec.expiry_date, rec.status)
                  return (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-5 font-bold text-slate-800">{rec.employee?.full_name}</td>
                    <td className="px-6 py-4 text-slate-600 italic">{rec.training_name}</td>
                    <td className="px-6 py-4 text-slate-400">
                      <div className="flex items-center">
                        <Calendar className="w-3 h-3 mr-2" /> {new Date(rec.completion_date).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{getTrainingExpiryDisplay(rec.training_name, rec.expiry_date)}</td>
                     <td className="px-6 py-4 text-center">
                        <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                          isTrainingValid(rec.training_name, rec.expiry_date, rec.status)
                            ? 'bg-green-50 text-green-700 border-green-200' 
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                         <button
                           onClick={() => downloadCertificate(rec)}
                           title="Baixar Certificado"
                           className="p-2 bg-blue-50 hover:bg-[#2563EB] hover:text-white text-[#2563EB] rounded-lg transition-all border border-blue-100"
                         >
                           <FileDown className="w-4 h-4" />
                         </button>
                         {canDeleteCertificate && (
                           <button
                             onClick={() => requestDeleteCertificate(rec)}
                             title="Excluir certificado"
                             className="p-2 bg-red-50 hover:bg-red-600 hover:text-white text-red-600 rounded-lg transition-all border border-red-100"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                         )}
                        </div>
                      </td>
                  </tr>
                  )
                })}
                {filteredTrainings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-400 italic font-medium">
                        Nenhum treinamento registrado no banco de dados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-12 h-12 text-[#2563EB]/20 mb-4" />
        <h3 className="font-bold text-slate-800 uppercase tracking-tighter">Certificação NR-01</h3>
        <p className="text-sm text-slate-400 max-w-md mt-2">
          Treinamentos periódicos garantem a segurança e reduzem o risco de acidentes de trabalho.
        </p>
      </div>

      {/* Modal Adicionar Treinamento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 shrink-0">
              <div>
                  <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Novo Certificado</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                    Etapa {step} de 4 - {step === 1 ? "Dados do Curso" : step === 2 ? "Selecionar Instrutor" : step === 3 ? "Assinatura do Colaborador" : "Assinatura do Instrutor"}
                  </p>
              </div>
              <button 
                onClick={() => { setIsModalOpen(false); resetForm(); }} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {step === 1 && (
                  <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className="p-8 space-y-5">
                    <div className="space-y-2">
                      <label id="label-colaborador" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador Treinado</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] transition-all font-bold"
                        value={formData.employee_id}
                        title="Selecionar Colaborador"
                        aria-labelledby="label-colaborador"
                        disabled={employees.length === 0}
                        onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                        required
                      >
                        <option value="">
                          {employees.length === 0 ? "Nenhum colaborador disponível" : "Selecione um colaborador..."}
                        </option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label id="label-treinamento" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de Treinamento</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] transition-all font-bold"
                        value={formData.training_name}
                        title="Tipo de Treinamento"
                        aria-labelledby="label-treinamento"
                        onChange={(e) => setFormData({...formData, training_name: e.target.value})}
                      >
                        {TRAINING_OPTIONS.map(option => (
                          <option key={option}>{option}</option>
                        ))}
                        <option value="Outro">Outro (Especificar...)</option>
                      </select>
                      
                      {formData.training_name === "Outro" && (
                          <input 
                            type="text"
                            placeholder="Digite o nome da Norma ou Treinamento"
                            value={customTrainingName}
                            onChange={(e) => setCustomTrainingName(e.target.value)}
                            className="w-full mt-2 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] transition-all font-bold"
                            autoFocus
                          />
                      )}
                    </div>

                    <div className="space-y-2">
                      <label id="label-data" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Realização</label>
                      <input 
                        type="date" 
                        value={formData.completion_date}
                        title="Data de Realização"
                        aria-labelledby="label-data"
                        onChange={(e) => setFormData({...formData, completion_date: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] transition-all font-bold" 
                      />
                    </div>

                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                      <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                        Carga horária padrão: {getCurrentTrainingWorkload().label}
                      </p>
                      <p className="mt-1 text-[10px] font-bold text-blue-500 leading-relaxed">
                        {getCurrentTrainingWorkload().note}
                      </p>
                      <p className="mt-3 text-[10px] font-black text-blue-700 uppercase tracking-widest">
                        Vencimento aplicado: {getCurrentTrainingValidity().displayText}
                      </p>
                      <p className="mt-1 text-[10px] font-bold text-blue-500 leading-relaxed">
                        {getCurrentTrainingValidity().rule.note}
                      </p>
                    </div>

                    <div className="pt-6">
                      <button 
                        type="submit"
                        className="w-full px-4 py-4 text-xs font-black text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-xl uppercase tracking-widest transition-all flex items-center justify-center shadow-lg shadow-blue-900/10"
                      >
                        Próxima Etapa: Instrutor
                      </button>
                    </div>
                  </form>
                )}

                {step === 2 && (
                  <div className="p-8 space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3">
                      <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                      <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest">
                        Selecione o Responsável Técnico que ministrou este treinamento.
                      </p>
                    </div>

                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={tstSearchTerm}
                        onChange={e => setTstSearchTerm(e.target.value)}
                        placeholder="Buscar instrutor..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm font-bold focus:border-[#2563EB] outline-none"
                      />
                    </div>

                    <div className="max-h-[300px] overflow-y-auto space-y-2 custom-scrollbar pr-1">
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
                              <div className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={emp.photo_url} alt={emp.full_name} className="w-10 h-10 rounded-full object-cover border-2 border-green-500" />
                                <div className="absolute -bottom-1 -right-1 bg-green-500 text-white rounded-full p-0.5">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                </div>
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border-2 border-slate-200">
                                <Users className="w-5 h-5" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-slate-800 text-sm truncate">{emp.full_name}</p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{emp.job_title} • CPF: {emp.cpf}</p>
                            </div>
                            {emp.photo_url && (
                              <span className="text-[8px] font-black text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100 uppercase tracking-widest flex-shrink-0">✓ Foto</span>
                            )}
                          </button>
                        ))
                      }
                    </div>

                    <button
                      onClick={() => setStep(1)}
                      className="w-full py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                    >
                      ← Voltar para Dados do Curso
                    </button>
                  </div>
                )}

                {step === 3 && tstSelectedEmployee && (
                  <div className="p-8 space-y-5">
                    {/* Notice for Missing Facial Descriptor */}
                    {!getTrainedEmployee()?.face_descriptor && !tstSignatureBase64 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3 items-start">
                        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest leading-relaxed">
                          O colaborador selecionado não possui foto pré-cadastrada. Capture uma biometria agora ou utilize a assinatura manual.
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => { setTstAuthMethod('manual'); setTstSignatureBase64(null); setTstPhotoBase64(null); setIsFaceCameraTstOpen(false); }}
                        className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${tstAuthMethod === 'manual' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                      >
                        <PenTool className="w-3.5 h-3.5 inline mr-1" /> Assinatura Manual
                      </button>
                      <button
                        onClick={() => { setTstAuthMethod('manual_facial'); setTstSignatureBase64(null); setTstPhotoBase64(null); setIsFaceCameraTstOpen(true); }}
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

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tempo de espera do link</p>
                        <p className="text-[10px] text-slate-400 font-bold">Depois disso, o link expira se nao for assinado.</p>
                      </div>
                      <select
                        value={remoteWaitHours}
                        onChange={(event) => setRemoteWaitHours(Number(event.target.value))}
                        className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-black text-slate-700"
                        title="Tempo de espera do link"
                      >
                        <option value={1}>1h</option>
                        <option value={4}>4h</option>
                        <option value={8}>8h</option>
                        <option value={12}>12h</option>
                        <option value={24}>24h</option>
                        <option value={48}>48h</option>
                      </select>
                    </div>

                    {tstAuthMethod === 'manual_facial' && isFaceCameraTstOpen && (
                      <div className="space-y-3">
                        <FaceCamera
                          targetDescriptor={getTrainedEmployeeDescriptor()}
                          onCapture={(_, img) => { setTstPhotoBase64(img); setIsFaceCameraTstOpen(false); }}
                          onCancel={() => { setIsFaceCameraTstOpen(false); setTstAuthMethod('manual'); setTstPhotoBase64(null); }}
                        />
                      </div>
                    )}

                    {(tstAuthMethod === 'manual' || tstAuthMethod === 'manual_facial') && !isFaceCameraTstOpen && (
                      <div className="space-y-3">
                        {tstAuthMethod === 'manual_facial' && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                            {tstPhotoBase64 ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={tstPhotoBase64} alt="Foto do colaborador" className="w-12 h-12 rounded-xl object-cover border border-emerald-200" />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                                <Camera className="w-5 h-5" />
                              </div>
                            )}
                            <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest leading-relaxed">
                              Foto capturada agora para evidenciar a assinatura. A foto cadastrada fica apenas como base de comparacao biometrica.
                            </p>
                            <button
                              onClick={() => { setTstPhotoBase64(null); setIsFaceCameraTstOpen(true); }}
                              title="Refazer foto"
                              className="ml-auto p-2 text-emerald-800 hover:bg-emerald-100 rounded-lg transition-all"
                            >
                              <Camera className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{getTrainedEmployee()?.full_name || "Colaborador"} - Assine abaixo:</p>
                        {tstSignatureBase64 ? (
                          <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={tstSignatureBase64} alt="Assinatura" className="w-full h-32 object-contain bg-slate-50" />
                            <button
                              onClick={() => setTstSignatureBase64(null)}
                              title="Remover assinatura"
                              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50">
                            <SignatureCanvas
                              ref={tstSigCanvas}
                              canvasProps={{ className: "w-full h-32 touch-none" }}
                              penColor="#1e293b"
                            />
                          </div>
                        )}
                        {!tstSignatureBase64 && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => tstSigCanvas.current?.clear()}
                              className="flex-1 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => {
                                if (tstSigCanvas.current?.isEmpty()) {
                                  toast.error("Assine antes de confirmar.")
                                  return
                                }
                                setTstSignatureBase64(tstSigCanvas.current?.toDataURL('image/png') || null)
                              }}
                              className="flex-1 py-3 text-[10px] font-black text-white bg-[#2563EB] uppercase tracking-widest rounded-xl hover:bg-[#1D4ED8] transition-all"
                            >
                              Confirmar Assinatura
                            </button>
                          </div>
                        )}
                        <button
                          onClick={generateTrainingRemoteSignatureLink}
                          className="w-full py-3 text-[10px] font-black text-slate-600 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                        >
                          <Link2 className="w-4 h-4 text-blue-500" />
                          Gerar link para assinatura do colaborador
                        </button>
                        {participantRemoteToken && (
                          <div className={`rounded-xl border p-3 text-[10px] font-black uppercase tracking-widest ${
                            participantRemoteStatus === "completed" || tstSignatureBase64
                              ? "bg-green-50 border-green-200 text-green-700"
                              : participantRemoteStatus === "expired"
                                ? "bg-red-50 border-blue-200 text-red-700"
                                : "bg-blue-50 border-blue-200 text-blue-700"
                          }`}>
                            {renderRemoteStatusText(tstSignatureBase64 ? "completed" : participantRemoteStatus, participantRemoteExpiresAt, "colaborador")}
                          </div>
                        )}
                        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                          <div>
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pendencias do certificado</p>
                            <p className="text-[10px] text-slate-400 font-bold">Gere os links do colaborador e do instrutor antes de sair desta tela.</p>
                          </div>
                          <button
                            onClick={generateInstructorRemoteSignatureLink}
                            className="w-full py-3 text-[10px] font-black text-slate-600 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                          >
                            <Link2 className="w-4 h-4 text-blue-500" />
                            Gerar link para assinatura do instrutor
                          </button>
                          {instructorRemoteToken && (
                            <div className={`rounded-xl border p-3 text-[10px] font-black uppercase tracking-widest ${
                              instructorRemoteStatus === "completed" || instructorSignatureBase64
                                ? "bg-green-50 border-green-200 text-green-700"
                                : instructorRemoteStatus === "expired"
                                  ? "bg-red-50 border-blue-200 text-red-700"
                                  : "bg-blue-50 border-blue-200 text-blue-700"
                            }`}>
                              {renderRemoteStatusText(instructorSignatureBase64 ? "completed" : instructorRemoteStatus, instructorRemoteExpiresAt, "instrutor")}
                            </div>
                          )}
                          {(participantRemoteToken || instructorRemoteToken) && (
                            <button
                              onClick={() => void syncRemoteSignatures()}
                              disabled={isCheckingRemoteSignatures}
                              className="w-full py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
                            >
                              {isCheckingRemoteSignatures ? "Consultando assinaturas..." : "Atualizar assinaturas remotas"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {tstAuthMethod === 'facial' && (
                      <div className="space-y-3">
                        {tstSignatureBase64 ? (
                          <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={tstSignatureBase64} alt="Foto" className="w-full h-48 object-cover bg-slate-900" />
                            <button
                              onClick={() => { setTstSignatureBase64(null); setIsFaceCameraTstOpen(true); }}
                              title="Refazer foto"
                              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <div className="absolute bottom-2 left-2 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-900/80 px-2 py-1 rounded">✓ Biometria Capturada</div>
                          </div>
                        ) : (
                          <FaceCamera
                            targetDescriptor={getTrainedEmployeeDescriptor()}
                            onCapture={(_, img) => { setTstSignatureBase64(img); setIsFaceCameraTstOpen(false); }}
                            onCancel={() => { setIsFaceCameraTstOpen(false); setTstAuthMethod('manual'); }}
                          />
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-[118px_minmax(0,1fr)] gap-3 pt-4">
                      <button
                        onClick={() => setStep(2)}
                        className="h-16 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Voltar</span>
                      </button>
                      <button
                        onClick={() => setStep(4)}
                        disabled={isSaving}
                        className="min-w-0 h-16 px-4 text-[10px] font-black text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50 flex items-center justify-center gap-2 text-center leading-tight"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="max-w-[190px]">Proxima: assinatura do instrutor</span>
                      </button>
                    </div>
                  </div>
                )}

                {step === 4 && tstSelectedEmployee && (
                  <div className="p-8 space-y-5">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Instrutor responsavel</p>
                      <p className="font-black text-slate-800 text-sm uppercase mt-1">{tstSelectedEmployee.full_name}</p>
                      <p className="text-xs font-bold text-slate-500 mt-0.5">{tstRole}</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tempo de espera do link</p>
                        <p className="text-[10px] text-slate-400 font-bold">Depois disso, o link expira se nao for assinado.</p>
                      </div>
                      <select
                        value={remoteWaitHours}
                        onChange={(event) => setRemoteWaitHours(Number(event.target.value))}
                        className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-black text-slate-700"
                        title="Tempo de espera do link"
                      >
                        <option value={1}>1h</option>
                        <option value={4}>4h</option>
                        <option value={8}>8h</option>
                        <option value={12}>12h</option>
                        <option value={24}>24h</option>
                        <option value={48}>48h</option>
                      </select>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Instrutor - assine abaixo:</p>
                      {instructorSignatureBase64 ? (
                        <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={instructorSignatureBase64} alt="Assinatura do instrutor" className="w-full h-32 object-contain bg-slate-50" />
                          <button
                            onClick={() => setInstructorSignatureBase64(null)}
                            title="Remover assinatura"
                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50">
                          <SignatureCanvas
                            ref={instructorSigCanvas}
                            canvasProps={{ className: "w-full h-32 touch-none" }}
                            penColor="#1e293b"
                          />
                        </div>
                      )}

                      {!instructorSignatureBase64 && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => instructorSigCanvas.current?.clear()}
                            className="flex-1 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                          >
                            Limpar
                          </button>
                          <button
                            onClick={() => {
                              if (instructorSigCanvas.current?.isEmpty()) {
                                toast.error("O instrutor precisa assinar antes de finalizar.")
                                return
                              }
                              setInstructorSignatureBase64(instructorSigCanvas.current?.toDataURL('image/png') || null)
                            }}
                            className="flex-1 py-3 text-[10px] font-black text-white bg-[#2563EB] uppercase tracking-widest rounded-xl hover:bg-[#1D4ED8] transition-all"
                          >
                            Confirmar Assinatura
                          </button>
                        </div>
                      )}
                      <button
                        onClick={generateInstructorRemoteSignatureLink}
                        className="w-full py-3 text-[10px] font-black text-slate-600 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                      >
                        <Link2 className="w-4 h-4 text-blue-500" />
                        Gerar link para assinatura do instrutor
                      </button>
                      {instructorRemoteToken && (
                        <div className={`rounded-xl border p-3 text-[10px] font-black uppercase tracking-widest ${
                          instructorRemoteStatus === "completed" || instructorSignatureBase64
                            ? "bg-green-50 border-green-200 text-green-700"
                            : instructorRemoteStatus === "expired"
                              ? "bg-red-50 border-blue-200 text-red-700"
                              : "bg-blue-50 border-blue-200 text-blue-700"
                        }`}>
                          {renderRemoteStatusText(instructorSignatureBase64 ? "completed" : instructorRemoteStatus, instructorRemoteExpiresAt, "instrutor")}
                        </div>
                      )}
                      {(participantRemoteToken || instructorRemoteToken) && (
                        <button
                          onClick={() => void syncRemoteSignatures()}
                          disabled={isCheckingRemoteSignatures}
                          className="w-full py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
                        >
                          {isCheckingRemoteSignatures ? "Consultando assinaturas..." : "Atualizar assinaturas remotas"}
                        </button>
                      )}
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => setStep(3)}
                        className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={handleAddTraining}
                        disabled={!instructorSignatureBase64 || isSaving}
                        className="flex-1 py-4 text-[10px] font-black text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Finalizar e Gerar Certificado
                      </button>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
      {certificateToDelete && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-red-100">
            <div className="bg-red-50 p-6 border-b border-red-100 flex items-start gap-4">
              <div className="p-3 bg-red-100 rounded-2xl shrink-0">
                <ShieldAlert className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Excluir Certificado</h2>
                <p className="text-xs text-red-600 font-bold uppercase tracking-widest mt-1">Confirmação exigida - MASTER</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Você está prestes a excluir o certificado de <strong className="text-slate-900">{certificateToDelete.employee?.full_name || "este colaborador"}</strong>.
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Treinamento</p>
                <p className="mt-1 text-sm font-black text-slate-800">{certificateToDelete.training_name}</p>
                <p className="mt-2 text-xs font-bold text-slate-400">
                  Realizado em {new Date(certificateToDelete.completion_date).toLocaleDateString()}
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-xs font-black text-amber-700 uppercase tracking-widest">Ação permanente</p>
                <p className="mt-1 text-sm text-amber-700 leading-relaxed">
                  Esta ação remove o registro do certificado e não pode ser desfeita.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setCertificateToDelete(null)}
                  disabled={isDeletingCertificate}
                  className="flex-1 px-4 py-3 text-[10px] font-black text-slate-500 hover:text-slate-700 uppercase tracking-widest border border-slate-200 rounded-2xl transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void deleteCertificate()}
                  disabled={isDeletingCertificate}
                  className="flex-[2] px-4 py-3 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-2xl uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                >
                  {isDeletingCertificate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Excluir Certificado
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {pdfActionDialog}
    </div>
  )
}
