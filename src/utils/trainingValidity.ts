import { addYears, format } from "date-fns"

export type TrainingValidityRule = {
  nr: string
  years: number | null
  label: string
  note: string
}

export type TrainingWorkloadRule = {
  nr: string
  hours: number | null
  label: string
  note: string
}

const NO_FIXED_EXPIRY_DATE = "2099-12-31"

const DEFAULT_RULE: TrainingValidityRule = {
  nr: "custom",
  years: 1,
  label: "1 ano",
  note: "Validade padrao para treinamentos sem regra NR mapeada.",
}

const DEFAULT_WORKLOAD: TrainingWorkloadRule = {
  nr: "custom",
  hours: 4,
  label: "4h",
  note: "Carga horaria padrao para treinamentos internos sem NR mapeada.",
}

function normalizeTrainingName(trainingName: string) {
  return trainingName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function isPeriodicTraining(name: string) {
  return /(reciclagem|periodic|periodico|atualizacao|renovacao)/.test(name)
}

export function getTrainingValidityRule(trainingName: string): TrainingValidityRule {
  const name = normalizeTrainingName(trainingName)

  if (/(nr[-\s]?10|eletric)/.test(name)) {
    return {
      nr: "NR-10",
      years: 2,
      label: "2 anos",
      note: "Reciclar tambem em troca de funcao/empresa, retorno apos afastamento superior a 3 meses ou mudanca significativa na instalacao/processo.",
    }
  }

  if (/(nr[-\s]?35|altura)/.test(name)) {
    return {
      nr: "NR-35",
      years: 2,
      label: "2 anos",
      note: "Reciclagem minima de 8h.",
    }
  }

  if (/(nr[-\s]?33|espaco confinado)/.test(name)) {
    return {
      nr: "NR-33",
      years: 1,
      label: "1 ano",
      note: "Reciclagem anual, geralmente 8h, para supervisor, vigia e trabalhador autorizado.",
    }
  }

  if (/(nr[-\s]?20|inflamaveis|combustiveis)/.test(name)) {
    return {
      nr: "NR-20",
      years: 2,
      label: "2 anos",
      note: "Depende da classe/atividade; alguns casos usam periodico a cada 2 anos.",
    }
  }

  if (/(nr[-\s]?05|nr[-\s]?5|cipa)/.test(name)) {
    return {
      nr: "NR-05",
      years: 1,
      label: "a cada mandato da CIPA",
      note: "Normalmente antes da posse; no primeiro mandato pode haver prazo de ate 30 dias apos a posse.",
    }
  }

  if (/(nr[-\s]?06|nr[-\s]?6|epi)/.test(name)) {
    return {
      nr: "NR-06",
      years: null,
      label: "sem validade fixa geral",
      note: "Treinar quando o EPI exigir, conforme atividade e exigencias legais.",
    }
  }

  if (/(nr[-\s]?11|empilhadeira|ponte rolante|movimentacao)/.test(name)) {
    return {
      nr: "NR-11",
      years: null,
      label: "sem prazo geral fixo",
      note: "A NR exige treinamento especifico; muitas empresas adotam reciclagem anual por procedimento interno ou contrato.",
    }
  }

  if (/(nr[-\s]?12|maquinas|maquinas e equipamentos)/.test(name)) {
    return {
      nr: "NR-12",
      years: null,
      label: "sem prazo fixo geral",
      note: "Reciclar quando houver mudanca significativa na maquina, instalacao, operacao, metodo, processo ou organizacao do trabalho que gere novos riscos.",
    }
  }

  if (/(nr[-\s]?18|construcao civil)/.test(name)) {
    return {
      nr: "NR-18",
      years: null,
      label: "conforme Anexo I",
      note: "Periodicidade conforme funcao, atividade e Anexo I da NR-18.",
    }
  }

  if (/(nr[-\s]?31|rural|agro)/.test(name)) {
    return {
      nr: "NR-31",
      years: null,
      label: "conforme atividade rural",
      note: "Reciclagem conforme atividade rural, riscos e necessidade de atualizacao.",
    }
  }

  if (/(nr[-\s]?34|industria naval|trabalho a quente)/.test(name)) {
    return {
      nr: "NR-34",
      years: 1,
      label: "ate 1 ano",
      note: "Pode exigir periodico por atividade especifica, como treinamento periodico de 4h ou anual.",
    }
  }

  return DEFAULT_RULE
}

export function calculateTrainingValidity(trainingName: string, completionDate: string | Date) {
  const rule = getTrainingValidityRule(trainingName)
  const date = completionDate instanceof Date ? completionDate : new Date(completionDate)
  const expiryDate = rule.years === null ? NO_FIXED_EXPIRY_DATE : format(addYears(date, rule.years), "yyyy-MM-dd")

  return {
    rule,
    expiryDate,
    hasFixedExpiry: rule.years !== null,
    displayText: rule.years === null ? rule.label : format(new Date(expiryDate), "dd/MM/yyyy"),
  }
}

export function getTrainingWorkloadRule(trainingName: string): TrainingWorkloadRule {
  const name = normalizeTrainingName(trainingName)
  const periodic = isPeriodicTraining(name)

  if (/(nr[-\s]?01|nr[-\s]?1|integracao|ordem de servico|pgr)/.test(name)) {
    return {
      nr: "NR-01",
      hours: null,
      label: "conforme riscos da funcao",
      note: "A NR-01 nao define carga unica fixa; a empresa ajusta conforme riscos, funcao e processo.",
    }
  }

  if (/(nr[-\s]?05|nr[-\s]?5|cipa)/.test(name)) {
    return {
      nr: "NR-05",
      hours: null,
      label: "8h a 20h",
      note: "Varia conforme grau de risco e porte da empresa; em geral 8h, 12h, 16h ou 20h.",
    }
  }

  if (/(nr[-\s]?06|nr[-\s]?6|epi)/.test(name)) {
    return {
      nr: "NR-06",
      hours: null,
      label: "1h a 4h",
      note: "Nao ha carga fixa; muitas empresas usam 1h a 4h conforme EPI, atividade e risco.",
    }
  }

  if (/(nr[-\s]?10|eletric)/.test(name)) {
    if (periodic) {
      return {
        nr: "NR-10",
        hours: null,
        label: "8h a 16h",
        note: "Reciclagem normalmente de 8h a 16h a cada 2 anos ou em situacoes especificas.",
      }
    }

    return {
      nr: "NR-10",
      hours: 40,
      label: name.includes("sep") ? "40h adicionais" : "40h",
      note: name.includes("sep") ? "SEP complementar com 40h adicionais." : "Basico de seguranca em eletricidade.",
    }
  }

  if (/(nr[-\s]?11|empilhadeira|ponte rolante|movimentacao)/.test(name)) {
    return {
      nr: "NR-11",
      hours: 16,
      label: "16h",
      note: "Referencia de mercado para operador de empilhadeira/movimentacao; procedimentos internos podem exigir periodicidade anual ou bienal.",
    }
  }

  if (/(nr[-\s]?12|maquinas|maquinas e equipamentos)/.test(name)) {
    return {
      nr: "NR-12",
      hours: name.includes("injetora") ? 8 : null,
      label: name.includes("injetora") ? "8h" : "conforme maquina",
      note: "Depende da maquina; para maquinas injetoras, a NR cita minimo de 8h por tipo de maquina.",
    }
  }

  if (/(nr[-\s]?18|construcao civil)/.test(name)) {
    return {
      nr: "NR-18",
      hours: null,
      label: "conforme Anexo I",
      note: "Carga, periodicidade e conteudo conforme funcao e atividade previstas no Anexo I da NR-18.",
    }
  }

  if (/(nr[-\s]?20|inflamaveis|combustiveis)/.test(name)) {
    if (periodic) {
      return {
        nr: "NR-20",
        hours: 4,
        label: "4h",
        note: "Atualizacao geralmente de 4h, com periodicidade trienal, bienal ou anual conforme o curso.",
      }
    }

    if (name.includes("iniciacao")) return { nr: "NR-20", hours: 3, label: "3h", note: "Curso de iniciacao." }
    if (name.includes("basico")) return { nr: "NR-20", hours: null, label: "4h a 8h", note: "Basico: 4h, 6h ou 8h conforme classe/atividade." }
    if (name.includes("intermediario")) return { nr: "NR-20", hours: null, label: "12h a 16h", note: "Intermediario: 12h, 14h ou 16h." }
    if (name.includes("avancado ii") || name.includes("avancado 2")) return { nr: "NR-20", hours: 32, label: "32h", note: "Avancado II." }
    if (name.includes("avancado")) return { nr: "NR-20", hours: 20, label: "20h", note: "Avancado I." }
    if (name.includes("especifico")) return { nr: "NR-20", hours: null, label: "14h a 16h", note: "Especifico: 14h ou 16h." }

    return {
      nr: "NR-20",
      hours: null,
      label: "3h a 32h",
      note: "Carga depende do nivel: iniciacao, basico, intermediario, avancado ou especifico.",
    }
  }

  if (/(nr[-\s]?31|rural|agro)/.test(name)) {
    return {
      nr: "NR-31",
      hours: 20,
      label: "20h",
      note: "Para alguns treinamentos, minimo de 20h distribuidas em ate 8h por dia.",
    }
  }

  if (/(nr[-\s]?33|espaco confinado)/.test(name)) {
    if (periodic) return { nr: "NR-33", hours: 8, label: "8h", note: "Reciclagem anual." }
    if (/(supervisor|entrada)/.test(name)) return { nr: "NR-33", hours: 40, label: "40h", note: "Supervisor de entrada." }
    if (/(emergencia|salvamento|resgate)/.test(name)) {
      return {
        nr: "NR-33",
        hours: null,
        label: "conforme plano de resgate",
        note: "Equipe de emergencia e salvamento conforme funcao/plano, com parte pratica minima de 50% da carga prevista.",
      }
    }

    return {
      nr: "NR-33",
      hours: 16,
      label: "16h",
      note: "Trabalhador autorizado e vigia.",
    }
  }

  if (/(nr[-\s]?34|industria naval|trabalho a quente)/.test(name)) {
    return {
      nr: "NR-34",
      hours: periodic ? 4 : 6,
      label: periodic ? "4h" : "6h",
      note: periodic ? "Periodico minimo de 4h anual." : "Admissional minimo de 6h.",
    }
  }

  if (/(nr[-\s]?35|altura)/.test(name)) {
    return {
      nr: "NR-35",
      hours: 8,
      label: "8h",
      note: periodic ? "Reciclagem de 8h a cada 2 anos." : "Carga inicial padrao de 8h.",
    }
  }

  return DEFAULT_WORKLOAD
}

export function getTrainingStatusFromValidity(trainingName: string, expiryDate: string) {
  const rule = getTrainingValidityRule(trainingName)
  if (rule.years === null) return "Válido" as const

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryDate)
  expiry.setHours(0, 0, 0, 0)
  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return "Vencido" as const
  if (diffDays <= 30) return "Vencendo" as const
  return "Válido" as const
}
