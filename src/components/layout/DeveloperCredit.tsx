import { DEVELOPER_NAME, DEVELOPER_URL } from "@/config/developer"

export function DeveloperCredit({ className = "" }: { className?: string }) {
  return <p className={`text-[10px] font-normal leading-4 text-slate-400 ${className}`}>
    Desenvolvido por <a href={DEVELOPER_URL} target="_blank" rel="noopener noreferrer" className="font-medium transition-colors hover:text-slate-600">{DEVELOPER_NAME}</a>
  </p>
}
