export const MOCK_EMPLOYEES = [
  { id: "1", name: "João da Silva", role: "Pedreiro", department: "Sede - Antares", cpf: "123.456.789-00", status: "Ativo" },
  { id: "2", name: "Maria Santos", role: "Eletricista", department: "Manutenção", cpf: "987.654.321-00", status: "Ativo" },
  { id: "3", name: "Carlos Ferreira", role: "Ajudante Geral", department: "Canteiro Norte", cpf: "456.789.123-00", status: "Férias" },
  { id: "4", name: "Ana Oliveira", role: "Técnica SESMT", department: "Segurança", cpf: "321.654.987-00", status: "Ativo" },
];

export const MOCK_PPES = [
  { id: "1", name: "Botina de Segurança (Couro)", ca: "12345", valCa: "10/12/2026", cost: "85.00", status: "Regular" },
  { id: "2", name: "Óculos de Proteção Incolor", ca: "9876", valCa: "15/05/2026", cost: "12.50", status: "Alerta" },
  { id: "3", name: "Protetor Auricular (Concha)", ca: "54231", valCa: "01/01/2028", cost: "35.00", status: "Regular" },
  { id: "4", name: "Capacete Classe B (Branco)", ca: "11223", valCa: "20/09/2024", cost: "45.00", status: "Vencido" },
];

export const MOCK_DELIVERIES = [
  { id: "1029", employeeId: "1", ppeId: "1", date: "17/04/2026", hash: "a8f3...91c2" },
  { id: "1028", employeeId: "2", ppeId: "3", date: "16/04/2026", hash: "b5x1...00p4" },
];
