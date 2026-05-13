import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

type SupabaseLikeError = {
  code?: string
  details?: string | null
  hint?: string | null
  message?: string
  status?: number
}

function resolveCompanyId(
  authUser: { role: string; company_id: string | null },
  requestedCompanyId: unknown,
) {
  if (authUser.role === "MASTER") {
    return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  }
  return authUser.company_id
}

function isMissingSignedDocumentsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()
  return (
    maybeError.code === "42P01" ||
    maybeError.code === "PGRST205" ||
    maybeError.status === 404 ||
    text.includes("signed_documents")
  ) && (
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find")
  )
}

function isMissingDeliveryIdsColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()
  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("delivery_ids")
}

function isMissingStockMovementDeliveryIdColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()
  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("delivery_id")
}

// Janela usada apenas para reclamar (UPDATE) stock_movements legacy que ainda
// tem delivery_id NULL — depois disso o ON DELETE CASCADE remove tudo junto.
const LEGACY_TIME_WINDOW_MS = 15 * 60 * 1000 // 15 minutos

function isOutMovementRelatedToDelivery(motive: string | null): boolean {
  if (!motive) return false
  const text = motive.toLowerCase()
  return text.includes("entrega de epi") || text.includes("baixa automatica")
}

function isInMovementRelatedToDelivery(motive: string | null): boolean {
  if (!motive) return false
  const text = motive.toLowerCase()
  return (
    text.includes("devolucao de epi") ||
    text.includes("devolução de epi") ||
    text.includes("baixa parcial por substituicao") ||
    text.includes("baixa parcial por substituição")
  )
}

/**
 * DELETE /api/deliveries?id=<delivery_id>&company_id=<optional, MASTER only>
 *
 * Exclusao restrita ao papel MASTER. A relacao stock_movements -> deliveries
 * usa FK com ON DELETE CASCADE (ver add_delivery_id_to_stock_movements.sql),
 * entao basta apagar a entrega para que as movimentacoes vinculadas sumam.
 *
 * Para movimentacoes legacy que ainda nao tem delivery_id preenchido,
 * antes do DELETE rodamos um UPDATE heuristico para "reivindica-las" — assim
 * o cascade tambem cuida delas.
 *
 * O current_stock e ajustado direto, adicionando (quantidade - devolvida).
 * Nenhuma nova movimentacao e criada.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))

    if (!id) {
      return NextResponse.json({ error: "ID da entrega e obrigatorio." }, { status: 400 })
    }

    // Buscar a entrega para validar empresa e calcular o ajuste de estoque.
    const deliveryFetchBuilder = () => {
      let query = supabaseAdmin
        .from("deliveries")
        .select(
          "id, company_id, ppe_id, quantity, returned_quantity, returned_at, reason, delivery_date, created_at",
        )
        .eq("id", id)
      if (companyId) query = query.eq("company_id", companyId)
      return query.maybeSingle()
    }

    const { data: delivery, error: fetchError } = await deliveryFetchBuilder()

    if (fetchError) {
      console.error("[API deliveries] Fetch error:", fetchError)
      return NextResponse.json(
        { error: fetchError.message, code: fetchError.code, details: fetchError.details },
        { status: 500 },
      )
    }

    if (!delivery) {
      return NextResponse.json({ error: "Entrega nao encontrada." }, { status: 404 })
    }

    const targetCompanyId = (delivery.company_id as string | null) || companyId || null
    const totalQuantity = Number(delivery.quantity || 0)
    const alreadyReturned = Number(delivery.returned_quantity || 0)
    const ppeId = delivery.ppe_id as string | null

    // --- 1. signed_documents (delivery_id direto) ---
    try {
      let directDocsQuery = supabaseAdmin.from("signed_documents").delete().eq("delivery_id", id)
      if (targetCompanyId) {
        directDocsQuery = supabaseAdmin
          .from("signed_documents")
          .delete()
          .eq("delivery_id", id)
          .eq("company_id", targetCompanyId)
      }
      const { error: directDocsError } = await directDocsQuery
      if (directDocsError && !isMissingSignedDocumentsTable(directDocsError)) {
        console.warn("[API deliveries] Falha ao remover signed_documents (delivery_id):", directDocsError)
      }
    } catch (docErr) {
      console.warn("[API deliveries] Excecao ao remover signed_documents (delivery_id):", docErr)
    }

    // --- 2. signed_documents agregados (delivery_ids contem este id) ---
    try {
      let arrayDocsQuery = supabaseAdmin
        .from("signed_documents")
        .delete()
        .contains("delivery_ids", [id])
      if (targetCompanyId) {
        arrayDocsQuery = supabaseAdmin
          .from("signed_documents")
          .delete()
          .contains("delivery_ids", [id])
          .eq("company_id", targetCompanyId)
      }
      const { error: arrayDocsError } = await arrayDocsQuery
      if (
        arrayDocsError &&
        !isMissingSignedDocumentsTable(arrayDocsError) &&
        !isMissingDeliveryIdsColumn(arrayDocsError)
      ) {
        console.warn("[API deliveries] Falha ao remover signed_documents (delivery_ids):", arrayDocsError)
      }
    } catch (docErr) {
      console.warn("[API deliveries] Excecao ao remover signed_documents (delivery_ids):", docErr)
    }

    // --- 3. Claim heuristico de movimentacoes legacy (delivery_id IS NULL) ---
    // Movimentacoes ja vinculadas (delivery_id = id) serao removidas pelo
    // CASCADE do FK no passo 4. Aqui so cobrimos as antigas que nao foram
    // backfilled pela migracao.
    let cascadeFkAvailable = true
    if (ppeId) {
      const reference = delivery.created_at || delivery.delivery_date
      const referenceTime = reference ? new Date(reference as string).getTime() : Date.now()
      const windowStart = new Date(referenceTime - LEGACY_TIME_WINDOW_MS).toISOString()
      const windowEnd = new Date(referenceTime + LEGACY_TIME_WINDOW_MS).toISOString()

      // 3a. SAIDA compensatoria legacy
      try {
        let outQuery = supabaseAdmin
          .from("stock_movements")
          .select("id, quantity, motive, created_at")
          .is("delivery_id", null)
          .eq("ppe_id", ppeId)
          .eq("type", "SAIDA")
          .gte("created_at", windowStart)
          .lte("created_at", windowEnd)
        if (targetCompanyId) outQuery = outQuery.eq("company_id", targetCompanyId)

        const { data: outCandidates, error: outFetchError } = await outQuery

        if (outFetchError && isMissingStockMovementDeliveryIdColumn(outFetchError)) {
          // Migracao nao foi rodada — sem cascade. Cai no caminho legacy.
          cascadeFkAvailable = false
        } else if (!outFetchError && outCandidates?.length) {
          const matches = outCandidates
            .filter((m) => isOutMovementRelatedToDelivery(m.motive))
            .sort(
              (a, b) =>
                Math.abs(new Date(a.created_at as string).getTime() - referenceTime) -
                Math.abs(new Date(b.created_at as string).getTime() - referenceTime),
            )
          const exact = matches.find((m) => Number(m.quantity) === totalQuantity)
          const chosen = exact || matches[0]
          if (chosen) {
            await supabaseAdmin
              .from("stock_movements")
              .update({ delivery_id: id })
              .eq("id", chosen.id)
          }
        }
      } catch (err) {
        console.warn("[API deliveries] Falha no claim de SAIDA legacy:", err)
      }

      // 3b. ENTRADAs legacy ligadas a devolucao desta entrega
      if (cascadeFkAvailable && (alreadyReturned > 0 || delivery.returned_at)) {
        try {
          let inQuery = supabaseAdmin
            .from("stock_movements")
            .select("id, quantity, motive, created_at")
            .is("delivery_id", null)
            .eq("ppe_id", ppeId)
            .eq("type", "ENTRADA")
            .gte("created_at", (reference as string) || windowStart)
          if (targetCompanyId) inQuery = inQuery.eq("company_id", targetCompanyId)

          const { data: inCandidates, error: inFetchError } = await inQuery
          if (!inFetchError && inCandidates?.length) {
            const matches = inCandidates
              .filter((m) => isInMovementRelatedToDelivery(m.motive))
              .sort((a, b) =>
                (a.created_at as string).localeCompare(b.created_at as string),
              )
            let remaining = alreadyReturned > 0 ? alreadyReturned : totalQuantity
            for (const movement of matches) {
              if (remaining <= 0) break
              await supabaseAdmin
                .from("stock_movements")
                .update({ delivery_id: id })
                .eq("id", movement.id)
              remaining -= Number(movement.quantity || 0)
            }
          }
        } catch (err) {
          console.warn("[API deliveries] Falha no claim de ENTRADA legacy:", err)
        }
      }
    }

    // --- 4. Apagar a entrega ---
    // Se cascadeFkAvailable, o FK ON DELETE CASCADE remove tudo que tem
    // delivery_id = id. Caso contrario, apagamos por heuristica manual.
    if (!cascadeFkAvailable && ppeId) {
      const reference = delivery.created_at || delivery.delivery_date
      const referenceTime = reference ? new Date(reference as string).getTime() : Date.now()
      const windowStart = new Date(referenceTime - LEGACY_TIME_WINDOW_MS).toISOString()
      const windowEnd = new Date(referenceTime + LEGACY_TIME_WINDOW_MS).toISOString()

      // Apaga SAIDA legacy heuristicamente
      try {
        let outQuery = supabaseAdmin
          .from("stock_movements")
          .select("id, quantity, motive, created_at")
          .eq("ppe_id", ppeId)
          .eq("type", "SAIDA")
          .gte("created_at", windowStart)
          .lte("created_at", windowEnd)
        if (targetCompanyId) outQuery = outQuery.eq("company_id", targetCompanyId)
        const { data: outMovements } = await outQuery
        if (outMovements?.length) {
          const matches = outMovements
            .filter((m) => isOutMovementRelatedToDelivery(m.motive))
            .sort(
              (a, b) =>
                Math.abs(new Date(a.created_at as string).getTime() - referenceTime) -
                Math.abs(new Date(b.created_at as string).getTime() - referenceTime),
            )
          const exact = matches.find((m) => Number(m.quantity) === totalQuantity)
          const chosen = exact || matches[0]
          if (chosen) {
            await supabaseAdmin.from("stock_movements").delete().eq("id", chosen.id)
          }
        }
      } catch (err) {
        console.warn("[API deliveries] Legacy delete SAIDA falhou:", err)
      }

      // Apaga ENTRADA legacy ligada a devolucao
      if (alreadyReturned > 0 || delivery.returned_at) {
        try {
          let inQuery = supabaseAdmin
            .from("stock_movements")
            .select("id, quantity, motive, created_at")
            .eq("ppe_id", ppeId)
            .eq("type", "ENTRADA")
            .gte("created_at", (reference as string) || windowStart)
          if (targetCompanyId) inQuery = inQuery.eq("company_id", targetCompanyId)
          const { data: inMovements } = await inQuery
          if (inMovements?.length) {
            const matches = inMovements
              .filter((m) => isInMovementRelatedToDelivery(m.motive))
              .sort((a, b) =>
                (a.created_at as string).localeCompare(b.created_at as string),
              )
            let remaining = alreadyReturned > 0 ? alreadyReturned : totalQuantity
            for (const movement of matches) {
              if (remaining <= 0) break
              await supabaseAdmin.from("stock_movements").delete().eq("id", movement.id)
              remaining -= Number(movement.quantity || 0)
            }
          }
        } catch (err) {
          console.warn("[API deliveries] Legacy delete ENTRADA falhou:", err)
        }
      }
    }

    let deleteQuery = supabaseAdmin.from("deliveries").delete().eq("id", id)
    if (targetCompanyId) {
      deleteQuery = supabaseAdmin
        .from("deliveries")
        .delete()
        .eq("id", id)
        .eq("company_id", targetCompanyId)
    }
    const { error: deleteError } = await deleteQuery

    if (deleteError) {
      console.error("[API deliveries] Delete error:", deleteError)
      return NextResponse.json(
        { error: deleteError.message, code: deleteError.code, details: deleteError.details },
        { status: 500 },
      )
    }

    // --- 5. Ajustar current_stock direto (sem criar movement) ---
    const netConsumed = Math.max(0, totalQuantity - alreadyReturned)
    let restoredQuantity = 0

    if (ppeId && netConsumed > 0) {
      try {
        const { data: ppeRow, error: ppeFetchErr } = await supabaseAdmin
          .from("ppes")
          .select("current_stock")
          .eq("id", ppeId)
          .maybeSingle()
        if (!ppeFetchErr && ppeRow) {
          const currentStock = Number(ppeRow.current_stock || 0)
          const { error: updateErr } = await supabaseAdmin
            .from("ppes")
            .update({ current_stock: currentStock + netConsumed })
            .eq("id", ppeId)
          if (updateErr) {
            console.warn("[API deliveries] Falha ao atualizar current_stock:", updateErr)
          } else {
            restoredQuantity = netConsumed
          }
        }
      } catch (stockErr) {
        console.warn("[API deliveries] Excecao ao ajustar current_stock:", stockErr)
      }
    }

    return NextResponse.json({
      ok: true,
      restored_quantity: restoredQuantity,
      cascade_fk_available: cascadeFkAvailable,
    })
  } catch (err) {
    console.error("[API deliveries] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
