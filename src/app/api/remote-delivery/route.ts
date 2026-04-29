import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type SupabaseLikeError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
};

function normalizeDeliveryReason(reason: string) {
  const normalized = reason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (normalized.includes("primeira") || normalized.includes("prim")) return "Primeira Entrega";
  if (normalized.includes("substitu")) return "Substituição (Desgaste/Validade)";
  if (normalized.includes("perda")) return "Perda";
  if (normalized.includes("dano")) return "Dano";
  return "Primeira Entrega";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeError = error as SupabaseLikeError;
    return maybeError.message || maybeError.details || maybeError.hint || JSON.stringify(error);
  }
  return "Erro interno do servidor";
}

function isDeliverySchemaCompatibilityIssue(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError;
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find the") ||
    (text.includes("column") && (text.includes("auth_method") || text.includes("workplace_id")))
  );
}

function isMissingReturnMotiveIssue(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseLikeError;
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase();

  return (
    (maybeError.code === "PGRST204" || maybeError.code === "42703") &&
    text.includes("return_motive")
  );
}

function shouldAutoReturnReason(reason: string) {
  return reason !== "Primeira Entrega";
}

function getAutoReturnMotive(reason: string) {
  const normalized = reason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("perda")) return "Baixa automatica por perda/extravio";
  if (normalized.includes("dano")) return "Baixa automatica por dano/quebra";
  return "Baixa automatica por substituicao";
}

export async function POST(req: Request) {
  try {
    // Inicializa o cliente DENTRO da função para evitar erros de build na Vercel 
    // se a variável de ambiente não estiver disponível durante a compilação estática.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Variáveis de ambiente do Supabase ausentes no servidor.");
      return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const formData = await req.formData();
    
    const employee_id = formData.get('employee_id') as string;
    const ppe_id = formData.get('ppe_id') as string;
    const workplace_id = formData.get('workplace_id') as string | null;
    const reason = normalizeDeliveryReason(formData.get('reason') as string || 'Primeira Entrega');
    const quantity = parseInt(formData.get('quantity') as string || '1');
    const ip_address = formData.get('ip_address') as string;
    const auth_method = formData.get('auth_method') as string || 'manual';
    const signatureFile = formData.get('signatureFile') as File | null;
    const token = formData.get('token') as string | null;

    if (!employee_id || !ppe_id) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    // Validação de Token se fornecido
    if (token) {
      const { data: link, error: linkError } = await supabaseAdmin
        .from('remote_links')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .single()

      if (linkError || !link) {
        return NextResponse.json({ error: 'Este link já foi utilizado ou é inválido.' }, { status: 403 })
      }

      if (new Date(link.expires_at) < new Date()) {
        await supabaseAdmin.from('remote_links').update({ status: 'expired' }).eq('id', link.id)
        return NextResponse.json({ error: 'Este link expirou.' }, { status: 403 })
      }
    }

    let signatureUrl = null;

    // 1. Upload da assinatura usando a chave de Admin
    if (signatureFile && signatureFile.size > 0) {
      // Prefix filename with auth method to distinguish in history
      const prefix = auth_method === 'facial' ? 'bio_' : 'sig_';
      const fileName = `${prefix}${Date.now()}_${employee_id}.png`;
      const { error: storageError } = await supabaseAdmin.storage
        .from('ppe_signatures')
        .upload(fileName, signatureFile);
      
      if (storageError) {
        console.error("Storage upload error:", storageError);
        throw new Error("Erro ao fazer upload da assinatura no Storage");
      }

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      signatureUrl = publicUrl;
    }

    const { data: beforeStockData, error: beforeStockError } = await supabaseAdmin
      .from('ppes')
      .select('current_stock')
      .eq('id', ppe_id)
      .maybeSingle();
    if (beforeStockError) throw beforeStockError;
    const stockBeforeRaw = (beforeStockData as { current_stock?: number | string } | null)?.current_stock;
    const stockBefore =
      typeof stockBeforeRaw === 'number'
        ? stockBeforeRaw
        : typeof stockBeforeRaw === 'string' && Number.isFinite(Number(stockBeforeRaw))
          ? Number(stockBeforeRaw)
          : null;

    // 2. Insere a entrega no banco usando a chave de Admin
    const insertPayload = {
      employee_id,
      ppe_id,
      workplace_id: workplace_id === 'null' || !workplace_id ? null : workplace_id,
      reason,
      quantity,
      ip_address,
      signature_url: signatureUrl,
      auth_method,
      delivery_date: new Date().toISOString()
    };

    let { data, error } = await supabaseAdmin
      .from('deliveries')
      .insert([insertPayload])
      .select();

    if (error && isDeliverySchemaCompatibilityIssue(error)) {
      const fallbackPayload = {
        employee_id: insertPayload.employee_id,
        ppe_id: insertPayload.ppe_id,
        reason: insertPayload.reason,
        quantity: insertPayload.quantity,
        ip_address: insertPayload.ip_address,
        signature_url: insertPayload.signature_url,
        delivery_date: insertPayload.delivery_date,
      };

      const fallbackResult = await supabaseAdmin
        .from('deliveries')
        .insert([fallbackPayload])
        .select();

      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    
    if (error) {
      console.error("Database insert error:", error);
      throw new Error(getErrorMessage(error));
    }

    const savedDelivery = data?.[0];
    if (!savedDelivery) {
      throw new Error("Entrega remota nao retornou registro salvo.");
    }

    let autoReturnedDeliveryIds: string[] = [];
    if (shouldAutoReturnReason(reason)) {
      const { data: activeSamePpe, error: activeSamePpeError } = await supabaseAdmin
        .from('deliveries')
        .select('id')
        .eq('employee_id', employee_id)
        .eq('ppe_id', ppe_id)
        .is('returned_at', null)
        .neq('id', savedDelivery.id);

      if (activeSamePpeError) throw activeSamePpeError;

      const previousDeliveryIds = (activeSamePpe || [])
        .map((item: { id?: string }) => item.id)
        .filter((id): id is string => Boolean(id));

      if (previousDeliveryIds.length > 0) {
        const returnedAt = new Date().toISOString();
        const { error: returnError } = await supabaseAdmin
          .from('deliveries')
          .update({ returned_at: returnedAt, return_motive: getAutoReturnMotive(reason) })
          .in('id', previousDeliveryIds);

        if (returnError && isMissingReturnMotiveIssue(returnError)) {
          const { error: fallbackReturnError } = await supabaseAdmin
            .from('deliveries')
            .update({ returned_at: returnedAt })
            .in('id', previousDeliveryIds);

          if (fallbackReturnError) throw fallbackReturnError;
        } else if (returnError) {
          throw returnError;
        }

        autoReturnedDeliveryIds = previousDeliveryIds;
      }
    }

    const { data: afterStockData, error: afterStockError } = await supabaseAdmin
      .from('ppes')
      .select('current_stock')
      .eq('id', ppe_id)
      .maybeSingle();
    if (afterStockError) throw afterStockError;
    const stockAfterRaw = (afterStockData as { current_stock?: number | string } | null)?.current_stock;
    const stockAfterInsert =
      typeof stockAfterRaw === 'number'
        ? stockAfterRaw
        : typeof stockAfterRaw === 'string' && Number.isFinite(Number(stockAfterRaw))
          ? Number(stockAfterRaw)
          : null;

    const desiredStock = stockBefore === null ? null : Math.max(0, stockBefore - quantity);
    if (desiredStock !== null && stockAfterInsert !== null && stockAfterInsert > desiredStock) {
      const missingOut = stockAfterInsert - desiredStock;
      const movementPayload = {
        ppe_id,
        quantity: missingOut,
        type: 'SAIDA',
        motive: `Entrega remota (${reason})`,
        created_by_name: 'Sistema (Entrega Remota)',
      };
      const { error: movementError } = await supabaseAdmin
        .from('stock_movements')
        .insert([movementPayload]);

      if (movementError) {
        const text = `${movementError.message || ''} ${movementError.details || ''}`.toLowerCase();
        const missingCreatedByColumns =
          movementError.code === 'PGRST204' ||
          movementError.code === '42703' ||
          text.includes('created_by_name') ||
          text.includes('created_by_id');

        if (!missingCreatedByColumns) throw movementError;

        const { error: fallbackError } = await supabaseAdmin
          .from('stock_movements')
          .insert([{
            ppe_id,
            quantity: missingOut,
            type: 'SAIDA',
            motive: `Entrega remota (${reason})`,
          }]);

        if (fallbackError) throw fallbackError;
      }
    }

    // 3. Marca link como concluído se existir
    if (token) {
      await supabaseAdmin
        .from('remote_links')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('token', token)
    }
    
    return NextResponse.json({ success: true, data: savedDelivery, autoReturnedDeliveryIds });

  } catch (error: unknown) {
    console.error('Remote delivery save error:', error);
    const message = getErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
