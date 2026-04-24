import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST — Criar novo link remoto
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employee_id, type, data, expires_hours = 24 } = body

    if (!employee_id || !type) {
      return NextResponse.json({ error: 'employee_id e type são obrigatórios' }, { status: 400 })
    }

    // Invalida links anteriores pendentes do mesmo tipo para o mesmo colaborador
    await supabaseAdmin
      .from('remote_links')
      .update({ status: 'expired' })
      .eq('employee_id', employee_id)
      .eq('type', type)
      .eq('status', 'pending')

    // Gera token único
    const token = crypto.randomBytes(32).toString('hex')
    const expires_at = new Date(Date.now() + expires_hours * 60 * 60 * 1000).toISOString()

    const { data: link, error } = await supabaseAdmin
      .from('remote_links')
      .insert({
        employee_id,
        type,
        token,
        status: 'pending',
        data: data || null,
        expires_at
      })
      .select()
      .single()

    if (error) {
      console.error('[remote-links] Create error:', error)
      return NextResponse.json({ error: error.message, details: error }, { status: 500 })
    }

    return NextResponse.json({ link })
  } catch (err: any) {
    console.error('[remote-links] Unexpected error:', err)
    return NextResponse.json({ error: 'Erro interno', message: err.message }, { status: 500 })
  }
}

// GET — Validar link (verificar token, status e expiração)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token não informado' }, { status: 400 })
    }

    const { data: link, error } = await supabaseAdmin
      .from('remote_links')
      .select('*, employee:employees(id, full_name, cpf, photo_url)')
      .eq('token', token)
      .single()

    if (error || !link) {
      return NextResponse.json({ error: 'Link não encontrado ou inválido.', status: 'invalid' }, { status: 404 })
    }

    // Verifica expiração
    if (new Date(link.expires_at) < new Date()) {
      // Marca como expirado
      await supabaseAdmin
        .from('remote_links')
        .update({ status: 'expired' })
        .eq('id', link.id)
      
      return NextResponse.json({ error: 'Este link expirou. Solicite um novo link ao responsável.', status: 'expired' }, { status: 410 })
    }

    // Verifica se já foi usado
    if (link.status === 'completed') {
      return NextResponse.json({ error: 'Este link já foi utilizado.', status: 'completed' }, { status: 410 })
    }

    if (link.status === 'expired') {
      return NextResponse.json({ error: 'Este link expirou. Solicite um novo link ao responsável.', status: 'expired' }, { status: 410 })
    }

    return NextResponse.json({ link })
  } catch (err) {
    console.error('[remote-links] GET error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PUT — Completar link (marcar como usado)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json({ error: 'Token não informado' }, { status: 400 })
    }

    const { data: link, error } = await supabaseAdmin
      .from('remote_links')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('token', token)
      .eq('status', 'pending')
      .select()
      .single()

    if (error || !link) {
      return NextResponse.json({ error: 'Não foi possível completar o link.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[remote-links] PUT error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
