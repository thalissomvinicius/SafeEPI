import { addYears, format } from "date-fns"

export type TrainingValidityRule = {
  nr: string
  years: number | null
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

function normalizeTrainingName(trainingName: string) {
  return trainingName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
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
