import fs from "node:fs"
import { createClient } from "@supabase/supabase-js"

function loadEnv() {
  const raw = fs.readFileSync(".env.local", "utf8")
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue
    const index = line.indexOf("=")
    if (index === -1) continue
    env[line.slice(0, index)] = line.slice(index + 1)
  }
  return env
}

const env = loadEnv()
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY em .env.local.")
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function client(accessToken) {
  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const password = `SafeEPI-${runId}!`
const created = {
  users: [],
  companyIds: [],
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function createCompany(label) {
  const { data, error } = await admin
    .from("companies")
    .insert([{
      name: `RLS TEST ${label} ${runId}`,
      trade_name: `RLS TEST ${label}`,
      cnpj: `${Math.floor(Math.random() * 90000000000000 + 10000000000000)}`,
      primary_color: "#a3111b",
      active: true,
      subscription_status: "ACTIVE",
    }])
    .select("id")
    .single()

  if (error) throw error
  created.companyIds.push(data.id)
  return data.id
}

async function createUser(label, companyId) {
  const email = `rls-${label}-${runId}@safeepi.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "ADMIN", company_id: companyId },
  })
  if (error) throw error

  const userId = data.user.id
  created.users.push(userId)

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    email,
    full_name: `RLS ${label}`,
    role: "ADMIN",
    company_id: companyId,
  })
  if (profileError) throw profileError

  const { error: membershipError } = await admin.from("company_users").insert({
    company_id: companyId,
    user_id: userId,
    role: "ADMIN",
    active: true,
  })
  if (membershipError) throw membershipError

  const auth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: sessionData, error: signInError } = await auth.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return client(sessionData.session.access_token)
}

async function seedTenant(companyId, label) {
  const { data: ppe, error: ppeError } = await admin
    .from("ppes")
    .insert([{
      company_id: companyId,
      name: `RLS EPI ${label}`,
      manufacturer: "SafeEPI Test",
      ca_number: `RLS-${label}`,
      ca_expiry_date: "2030-01-01",
      lifespan_days: 180,
      cost: 10,
      active: true,
      current_stock: 5,
    }])
    .select("id")
    .single()
  if (ppeError) throw ppeError

  const { data: thirdParty, error: thirdPartyError } = await admin
    .from("third_parties")
    .insert([{ company_id: companyId, name: `RLS TERCEIRO ${label}`, active: true }])
    .select("id")
    .single()
  if (thirdPartyError) throw thirdPartyError

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .insert([{
      company_id: companyId,
      full_name: `RLS COLAB ${label}`,
      cpf: `${Math.floor(Math.random() * 90000000000 + 10000000000)}`,
      job_title: "TESTE",
      department: "TESTE",
      active: true,
    }])
    .select("id")
    .single()
  if (employeeError) throw employeeError

  const { data: delivery, error: deliveryError } = await admin
    .from("deliveries")
    .insert([{
      company_id: companyId,
      employee_id: employee.id,
      ppe_id: ppe.id,
      reason: "Primeira Entrega",
      quantity: 1,
      delivery_date: new Date().toISOString(),
    }])
    .select("id")
    .single()
  if (deliveryError) throw deliveryError

  return { ppe, thirdParty, employee, delivery }
}

async function expectNoRows(result, label) {
  if (result.error) return
  const rows = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : [])
  assert(rows.length === 0, `${label}: esperado erro ou zero linhas; retornou ${rows.length}.`)
}

async function cleanup() {
  for (const companyId of created.companyIds) {
    await admin.from("stock_movements").delete().eq("company_id", companyId)
    await admin.from("signed_documents").delete().eq("company_id", companyId)
    await admin.from("remote_links").delete().eq("company_id", companyId)
    await admin.from("deliveries").delete().eq("company_id", companyId)
    await admin.from("trainings").delete().eq("company_id", companyId)
    await admin.from("employees").delete().eq("company_id", companyId)
    await admin.from("third_parties").delete().eq("company_id", companyId)
    await admin.from("workplaces").delete().eq("company_id", companyId)
    await admin.from("ppes").delete().eq("company_id", companyId)
    await admin.from("job_titles").delete().eq("company_id", companyId)
    await admin.from("departments").delete().eq("company_id", companyId)
    await admin.from("company_users").delete().eq("company_id", companyId)
    await admin.from("companies").delete().eq("id", companyId)
  }
  for (const userId of created.users) {
    await admin.from("profiles").delete().eq("id", userId)
    await admin.auth.admin.deleteUser(userId)
  }
}

async function main() {
  const companyA = await createCompany("A")
  const companyB = await createCompany("B")
  const userA = await createUser("a", companyA)
  const rowsA = await seedTenant(companyA, "A")
  const rowsB = await seedTenant(companyB, "B")

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const anonTables = [
    "companies",
    "company_users",
    "profiles",
    "employees",
    "ppes",
    "deliveries",
    "workplaces",
    "stock_movements",
    "trainings",
    "job_titles",
    "departments",
    "signed_documents",
    "remote_links",
    "third_parties",
    "stock_movements_backup_20260513_141525",
  ]

  for (const table of anonTables) {
    await expectNoRows(
      await anon.from(table).select("*").limit(1),
      `anon select ${table}`,
    )
  }

  const ownPpe = await userA.from("ppes").select("id").eq("id", rowsA.ppe.id)
  assert(!ownPpe.error && ownPpe.data.length === 1, "usuario A deveria ler EPI da propria empresa.")

  await expectNoRows(
    await userA.from("ppes").select("id").eq("id", rowsB.ppe.id),
    "usuario A lendo EPI da empresa B",
  )

  await expectNoRows(
    await userA.from("ppes").update({ manufacturer: "IDOR" }).eq("id", rowsB.ppe.id).select("id"),
    "usuario A atualizando EPI da empresa B",
  )

  await expectNoRows(
    await userA.from("third_parties").update({ notes: "IDOR" }).eq("id", rowsB.thirdParty.id).select("id"),
    "usuario A atualizando terceiro da empresa B",
  )

  await expectNoRows(
    await userA.from("deliveries").update({ returned_at: new Date().toISOString() }).eq("id", rowsB.delivery.id).select("id"),
    "usuario A devolvendo entrega da empresa B",
  )

  await expectNoRows(
    await userA.from("profiles").update({ role: "MASTER" }).eq("id", created.users[0]).select("id"),
    "usuario A tentando elevar role no proprio profile",
  )

  console.log("RLS policy tests: PASS")
}

main()
  .catch((error) => {
    console.error("RLS policy tests: FAIL")
    console.error(error.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
  })
