import { LoadingState } from "@/components/ui/LoadingState"

export default function DeliveryLoading() {
  return (
    <LoadingState
      variant="page"
      label="Abrindo nova entrega"
      detail="Preparando o formulário enquanto os dados essenciais são sincronizados."
      className="min-h-[70dvh]"
    />
  )
}
