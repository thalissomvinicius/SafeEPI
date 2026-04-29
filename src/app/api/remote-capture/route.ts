import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cria cliente Supabase com Service Role Key para contornar RLS
// Já que o trabalhador vai acessar sem estar autenticado no sistema.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID do colaborador não informado.' }, { status: 400 })
    }

    const { data: employee, error } = await supabaseAdmin
      .from('employees')
      .select('id, full_name, cpf, photo_url')
      .eq('id', id)
      .single()

    if (error || !employee) {
      return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 })
    }

    return NextResponse.json(employee)
  } catch (error: unknown) {
    console.error("Erro GET /api/remote-capture:", error)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id, photo_url, face_descriptor, token } = body

    if (!id || !photo_url || !face_descriptor) {
      return NextResponse.json({ error: 'Dados incompletos para registro da biometria.' }, { status: 400 })
    }

    // Se um token foi fornecido, validamos e marcamos como concluído
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

      // Verifica expiração
      if (new Date(link.expires_at) < new Date()) {
        await supabaseAdmin.from('remote_links').update({ status: 'expired' }).eq('id', link.id)
        return NextResponse.json({ error: 'Este link expirou.' }, { status: 403 })
      }

      // Marca como concluído
      await supabaseAdmin
        .from('remote_links')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', link.id)
    }

    const { data, error } = await supabaseAdmin
      .from('employees')
      .update({
        photo_url,
        face_descriptor
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error("Erro no update do colaborador:", error)
      return NextResponse.json({ error: 'Falha ao atualizar dados no banco.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, employee: data })
  } catch (error: unknown) {
    console.error("Erro POST /api/remote-capture:", error)
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 })
  }
}
