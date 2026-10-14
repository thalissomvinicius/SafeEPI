import {
  ArrowRightLeft, BriefcaseBusiness, Building2, CheckCircle2, HardDrive,
  HelpCircle, History, Home, Package, PenTool, Settings, Shield,
  TrendingDown, UserRoundCog, Users, Handshake,
} from "lucide-react"

export const navigationItems = [
  { href: "/", label: "Visão geral", shortLabel: "Início", icon: Home, group: "Operação", roles: ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"] },
  { href: "/delivery", label: "Nova entrega", shortLabel: "Entrega", icon: PenTool, group: "Operação", roles: ["MASTER", "ADMIN"] },
  { href: "/inventory", label: "Estoque", shortLabel: "Estoque", icon: Package, group: "Operação", roles: ["MASTER", "ADMIN", "ALMOXARIFE"] },
  { href: "/movements", label: "Movimentações", shortLabel: "Movimentações", icon: ArrowRightLeft, group: "Operação", roles: ["MASTER", "ADMIN", "DIRETORIA"] },
  { href: "/employees", label: "Colaboradores", shortLabel: "Equipe", icon: Users, group: "Cadastros", roles: ["MASTER", "ADMIN", "DIRETORIA"] },
  { href: "/ppes", label: "EPIs e CAs", shortLabel: "EPIs e CAs", icon: Shield, group: "Cadastros", roles: ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"] },
  { href: "/workplaces", label: "Obras e canteiros", shortLabel: "Obras", icon: HardDrive, group: "Cadastros", roles: ["MASTER", "ADMIN", "DIRETORIA"] },
  { href: "/third-parties", label: "Terceiros", shortLabel: "Terceiros", icon: Handshake, group: "Cadastros", roles: ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"] },
  { href: "/job-sectors", label: "Cargos e setores", shortLabel: "Cargos", icon: BriefcaseBusiness, group: "Cadastros", roles: ["MASTER", "ADMIN", "DIRETORIA"] },
  { href: "/history", label: "Histórico de entregas", shortLabel: "Histórico", icon: History, group: "Controle", roles: ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"] },
  { href: "/reports", label: "Relatórios", shortLabel: "Relatórios", icon: TrendingDown, group: "Controle", roles: ["MASTER", "ADMIN", "DIRETORIA"] },
  { href: "/training", label: "Treinamentos", shortLabel: "Treinamentos", icon: CheckCircle2, group: "Controle", roles: ["MASTER", "ADMIN", "DIRETORIA"] },
  { href: "/companies", label: "Empresas", shortLabel: "Empresas", icon: Building2, group: "Administração", roles: ["MASTER"] },
  { href: "/users", label: "Usuários e acesso", shortLabel: "Usuários", icon: Settings, group: "Administração", roles: ["MASTER", "ADMIN"] },
  { href: "/account", label: "Minha conta", shortLabel: "Conta", icon: UserRoundCog, group: "Administração", roles: ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"] },
  { href: "/support", label: "Ajuda e suporte", shortLabel: "Suporte", icon: HelpCircle, group: "Administração", roles: ["ADMIN", "ALMOXARIFE", "DIRETORIA"] },
] as const

export const navigationGroups = ["Operação", "Cadastros", "Controle", "Administração"] as const

export function visibleNavigation(role?: string, trainingEnabled?: boolean) {
  return navigationItems.filter((item) =>
    (item.roles as readonly string[]).includes(role || "ADMIN") &&
    (item.href !== "/training" || role === "MASTER" || trainingEnabled !== false),
  )
}

export function isNavigationActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
}
