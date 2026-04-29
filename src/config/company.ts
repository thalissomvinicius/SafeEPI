/**
 * CONFIGURAÇÃƒO DA EMPRESA
 * 
 * Para usar este sistema em outra empresa, basta alterar estas variáveis.
 * Idealmente, mova esses valores para o arquivo .env.local para configuração
 * sem necessidade de recompilação:
 * 
 * NEXT_PUBLIC_COMPANY_NAME="Nome da Empresa"
 * NEXT_PUBLIC_COMPANY_CNPJ="00.000.000/0001-00"
 * etc.
 */

export const COMPANY_CONFIG = {
  name: process.env.NEXT_PUBLIC_COMPANY_NAME || "SafeEPI",
  shortName: process.env.NEXT_PUBLIC_COMPANY_SHORT_NAME || "SafeEPI",
  cnpj: process.env.NEXT_PUBLIC_COMPANY_CNPJ || "00.000.000/0001-00",
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || "Endereço da Empresa",
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || "(00) 0000-0000",
  email: process.env.NEXT_PUBLIC_COMPANY_EMAIL || "sesmt@empresa.com.br",
  logoUrl: process.env.NEXT_PUBLIC_COMPANY_LOGO_URL || "",
  
  // Cores da marca (hex) - usadas nos PDFs
  primaryColor: "#8B1A1A",   // Vermelho SafeEPI
  primaryColorRgb: [139, 26, 26] as [number, number, number],
  
  // Rodapé dos documentos
  systemName: "Sistema SESMT Digital",
  compliance: "NR-06 / Ministério do Trabalho e Emprego",
}
