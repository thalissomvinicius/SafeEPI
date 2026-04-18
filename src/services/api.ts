import { supabase } from "@/lib/supabase";
import { Employee, PPE, Delivery } from "@/types/database";

export const api = {
  // --- Colaboradores ---
  async getEmployees() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('full_name', { ascending: true });
    
    if (error) throw error;
    return data as Employee[];
  },

  async addEmployee(employee: Omit<Employee, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('employees')
      .insert([employee])
      .select();
    
    if (error) throw error;
    return data[0] as Employee;
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

  // --- Entregas ---
  async getDeliveries() {
    const { data, error } = await supabase
      .from('deliveries')
      .select(`
        *,
        employee:employees(full_name, cpf),
        ppe:ppes(name, ca_number)
      `)
      .order('delivery_date', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async saveDelivery(delivery: Omit<Delivery, 'id' | 'created_at' | 'delivery_date'>, signatureFile?: File) {
    let signatureUrl = null;

    // 1. Se houver imagem da assinatura, faz o upload para o Storage
    if (signatureFile) {
      const fileName = `${Date.now()}_${delivery.employee_id}.png`;
      const { data: storageData, error: storageError } = await supabase.storage
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
        delivery_date: new Date().toISOString()
      }])
      .select();
    
    if (error) throw error;
    return data[0];
  }
};
