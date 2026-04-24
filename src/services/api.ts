import { supabase } from "@/lib/supabase";
import { Employee, PPE, Delivery, Training, DeliveryWithRelations, TrainingWithRelations, Workplace, StockMovement, Profile } from "@/types/database";

export const api = {
  // --- Autenticação ---
  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  // --- Canteiros (Workplaces) ---
  async getWorkplaces() {
    const { data, error } = await supabase
      .from('workplaces')
      .select('*')
      .order('name', { ascending: true });
    
    if (error) throw error;
    return data as Workplace[];
  },

  async addWorkplace(workplace: Omit<Workplace, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('workplaces')
      .insert([workplace])
      .select();
    
    if (error) throw error;
    return data[0] as Workplace;
  },

  async updateWorkplace(id: string, updates: Partial<Workplace>) {
    const { data, error } = await supabase
      .from('workplaces')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    return data[0] as Workplace;
  },

  // --- Colaboradores ---
  async getEmployees() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('full_name', { ascending: true });
    
    if (error) throw error;
    return data as Employee[];
  },

  async addEmployee(employee: Omit<Employee, 'id' | 'created_at'>, photoFile?: File) {
    let photoUrl = employee.photo_url;

    if (photoFile) {
      const fileName = `emp_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
      const { error: storageError } = await supabase.storage
        .from('ppe_signatures') // Reusing same bucket or could use another
        .upload(fileName, photoFile);
      
      if (storageError) throw storageError;

      const { data: { publicUrl } } = supabase.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      photoUrl = publicUrl;
    }

    const { data, error } = await supabase
      .from('employees')
      .insert([{ ...employee, photo_url: photoUrl }])
      .select();
    
    if (error) throw error;
    return data[0] as Employee;
  },

  async updateEmployee(id: string, updates: Partial<Employee>, photoFile?: File) {
    const finalUpdates = { ...updates };

    // Upload da foto se houver arquivo novo
    if (photoFile) {
      const fileName = `emp_${Date.now()}_${id}.png`;
      const { error: storageError } = await supabase.storage
        .from('ppe_signatures')
        .upload(fileName, photoFile);
      
      if (storageError) throw storageError;

      const { data: { publicUrl } } = supabase.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      finalUpdates.photo_url = publicUrl;
    }

    // Usa rota server-side para contornar RLS
    const response = await fetch('/api/employees/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, updates: finalUpdates })
    });

    const result = await response.json();
    console.log('[updateEmployee] Server response:', result);

    if (!response.ok) throw new Error(result.error || 'Erro ao atualizar colaborador');
    return result.employee as Employee;
  },

  async removeEmployeePhoto(id: string) {
    console.log('[removeEmployeePhoto] Chamando API server-side para remover foto');
    const response = await fetch('/api/employees/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, removePhoto: true })
    });

    const result = await response.json();
    console.log('[removeEmployeePhoto] Server response:', result);

    if (!response.ok) throw new Error(result.error || 'Erro ao remover foto');
    return result.employee as Employee;
  },

  async terminateEmployee(employeeId: string) {
    const { error } = await supabase
      .from('employees')
      .update({ active: false }) // termination_date removed as it's missing from DB
      .eq('id', employeeId);
    
    if (error) throw error;
  },

  // --- EPIs ---
  async getPpes() {
    const { data, error } = await supabase
      .from('ppes')
      .select('*')
      .order('name', { ascending: true });
    
    if (error) throw error;
    return data as PPE[];
  },

  async addPpe(ppe: Omit<PPE, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('ppes')
      .insert([ppe])
      .select();
    
    if (error) throw error;
    return data[0] as PPE;
  },

  async updatePpe(id: string, updates: Partial<PPE>) {
    const { data, error } = await supabase
      .from('ppes')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    return data[0] as PPE;
  },

  // --- Estoque (Stock Movements) ---
  async getStockMovements() {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        ppe:ppes(name)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data as StockMovement[];
  },

  async addStockMovement(movement: Omit<StockMovement, 'id' | 'created_at' | 'ppe'>) {
    const { data, error } = await supabase
      .from('stock_movements')
      .insert([movement])
      .select();
    
    if (error) throw error;
    return data[0] as StockMovement;
  },

  // --- Entregas ---
  async getDeliveries() {
    const { data, error } = await supabase
      .from('deliveries')
      .select(`
        *,
        employee:employees(full_name, cpf, job_title),
        ppe:ppes(name, ca_number, cost, lifespan_days),
        workplace:workplaces(name)
      `)
      .order('delivery_date', { ascending: false });
    
    if (error) throw error;
    return data as DeliveryWithRelations[];
  },

  async getEmployeeHistory(employeeId: string) {
    const { data, error } = await supabase
      .from('deliveries')
      .select(`
        *,
        employee:employees(full_name, cpf, job_title, active, admission_date),
        ppe:ppes(name, ca_number, cost, lifespan_days),
        workplace:workplaces(name)
      `)
      .eq('employee_id', employeeId)
      .order('delivery_date', { ascending: false });
    
    if (error) throw error;
    return data as DeliveryWithRelations[];
  },

  async saveDelivery(delivery: Omit<Delivery, 'id' | 'created_at'>, signatureFile?: File) {
    let signatureUrl = null;

    // 1. Se houver imagem da assinatura, faz o upload para o Storage
    if (signatureFile) {
      const prefix = delivery.auth_method === 'facial' ? 'bio_' : 'sig_';
      const fileName = `${prefix}${Date.now()}_${delivery.employee_id}.png`;
      const { error: storageError } = await supabase.storage
        .from('ppe_signatures')
        .upload(fileName, signatureFile);
      
      if (storageError) throw storageError;

      // 2. Pega a URL pública do arquivo
      const { data: { publicUrl } } = supabase.storage
        .from('ppe_signatures')
        .getPublicUrl(fileName);
      
      signatureUrl = publicUrl;
    }

    // 3. Salva o registro na tabela de entregas
    const { data, error } = await supabase
      .from('deliveries')
      .insert([{
        ...delivery,
        signature_url: signatureUrl,
        delivery_date: delivery.delivery_date || new Date().toISOString()
      }])
      .select();
    
    if (error) throw error;
    return data[0];
  },

  async returnDelivery(deliveryId: string, motive: string) {
    const { error } = await supabase
      .from('deliveries')
      .update({ returned_at: new Date().toISOString(), return_motive: motive })
      .eq('id', deliveryId);
    
    if (error) throw error;
  },

  async returnMultipleDeliveries(deliveryIds: string[], motive: string) {
    const { error } = await supabase
      .from('deliveries')
      .update({ returned_at: new Date().toISOString(), return_motive: motive })
      .in('id', deliveryIds);
    
    if (error) throw error;
  },

  // --- Treinamentos ---
  async getTrainings() {
    const { data, error } = await supabase
      .from('trainings')
      .select(`
        *,
        employee:employees(full_name, cpf)
      `)
      .order('completion_date', { ascending: false });
    
    if (error) throw error;
    return data as TrainingWithRelations[];
  },

  async addTraining(training: Omit<Training, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('trainings')
      .insert([training])
      .select();
    
    if (error) throw error;
    return data[0] as Training;
  },

  // --- Perfis de Usuário (RBAC) ---
  async getProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true });
    
    if (error) throw error;
    return data as Profile[];
  },

  async updateProfileRole(userId: string, role: Profile['role']) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId)
      .select()
      .maybeSingle();
    
    if (error) throw error;
    return data as Profile | null;
  }
};
