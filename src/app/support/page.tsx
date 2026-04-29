"use client"

import { HelpCircle, MessageCircle, Phone, PlayCircle, BookOpen } from "lucide-react"

export default function SupportPage() {
  const whatsappNumber = "5591991697664"
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=Olá%20Vinicius,%20preciso%20de%20ajuda%20com%20o%20sistema%20SafeEPI%20EPI.`

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-slate-800 flex items-center">
            <HelpCircle className="w-8 h-8 mr-3 text-[#8B1A1A]" />
            Ajuda e Suporte
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Tire dúvidas, aprenda a usar o sistema ou fale diretamente com o suporte técnico.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Support Contact Card */}
        <div className="md:col-span-1 bg-[#8B1A1A] rounded-3xl p-6 text-white shadow-xl shadow-red-900/20 relative overflow-hidden flex flex-col">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <MessageCircle className="w-32 h-32" />
          </div>
          
          <h3 className="font-black text-xl uppercase tracking-tighter mb-2 relative z-10">Fale com o Desenvolvedor</h3>
          <p className="text-red-100 text-sm mb-8 relative z-10">Está com problemas ou tem alguma dúvida que não encontrou aqui? Entre em contato agora mesmo.</p>
          
          <div className="mt-auto space-y-3 relative z-10">
            <a 
              href={whatsappLink} 
              target="_blank" 
              rel="noopener noreferrer"
              className="w-full bg-white text-[#8B1A1A] hover:bg-slate-100 px-4 py-3 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center transition-all shadow-md"
            >
              <Phone className="w-5 h-5 mr-2" />
              Chamar no WhatsApp
            </a>
            
            <div className="text-center pt-4 border-t border-white/20">
              <p className="text-xs font-medium text-red-200">Suporte Técnico:</p>
              <p className="text-sm font-black tracking-widest mt-0.5">(91) 99169-7664</p>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Vinicius Dev</p>
            </div>
          </div>
        </div>

        {/* FAQ and Guides */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm">
            <h2 className="font-black text-slate-800 text-xl flex items-center mb-6">
              <BookOpen className="w-6 h-6 mr-2 text-[#8B1A1A]" />
              Dúvidas Frequentes (FAQ)
            </h2>

            <div className="space-y-6">
              <div className="space-y-2 border-b border-slate-100 pb-4">
                <h4 className="font-bold text-slate-800 flex items-center">
                  <span className="w-6 h-6 rounded-full bg-red-50 text-[#8B1A1A] flex items-center justify-center text-xs font-black mr-3">1</span>
                  Como fazer uma Nova Entrega de EPI?
                </h4>
                <p className="text-sm text-slate-500 pl-9">
                  Acesse o menu &quot;Nova Entrega&quot;, selecione o colaborador e a sua lotação. Escolha os EPIs do catálogo clicando em &quot;Adicionar&quot; e prossiga para a assinatura. A assinatura pode ser feita via biometria facial, assinatura digital desenhada ou enviando o link remoto para o celular do funcionário.
                </p>
              </div>

              <div className="space-y-2 border-b border-slate-100 pb-4">
                <h4 className="font-bold text-slate-800 flex items-center">
                  <span className="w-6 h-6 rounded-full bg-red-50 text-[#8B1A1A] flex items-center justify-center text-xs font-black mr-3">2</span>
                  O estoque não está baixando, e agora?
                </h4>
                <p className="text-sm text-slate-500 pl-9">
                  O sistema gerencia o estoque automaticamente. Para que o estoque de um EPI diminua ao fazer uma entrega, você deve primeiro adicionar saldo desse EPI em <span className="font-bold">Estoque &rarr; Nova Entrada</span>. Entregas só abatem do estoque existente.
                </p>
              </div>

              <div className="space-y-2 border-b border-slate-100 pb-4">
                <h4 className="font-bold text-slate-800 flex items-center">
                  <span className="w-6 h-6 rounded-full bg-red-50 text-[#8B1A1A] flex items-center justify-center text-xs font-black mr-3">3</span>
                  Como gerar a Ficha NR-06 (Prontuário)?
                </h4>
                <p className="text-sm text-slate-500 pl-9">
                  Vá na aba &quot;Colaboradores&quot;, pesquise o funcionário e clique em &quot;Prontuário&quot;. Lá você verá todo o histórico dele e o botão &quot;Ficha NR-06&quot;. O sistema vai pedir que o Técnico de Segurança do Trabalho (TST) assine o documento antes de gerar o PDF.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 flex items-center">
                  <span className="w-6 h-6 rounded-full bg-red-50 text-[#8B1A1A] flex items-center justify-center text-xs font-black mr-3">4</span>
                  Como dar baixa / devolução em um EPI?
                </h4>
                <p className="text-sm text-slate-500 pl-9">
                  Pode ser feito no menu &quot;Baixas / Substituições&quot; ou diretamente no &quot;Prontuário&quot; do colaborador. Informe o motivo (Ex: desgaste, quebra) e confirme. Se o EPI quebrado retornar ao estoque como sucata, o sistema registrará isso no histórico para auditoria.
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-[#8B1A1A]/5 rounded-3xl p-6 border border-[#8B1A1A]/10 flex flex-col sm:flex-row items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-[#8B1A1A]/10 flex items-center justify-center shrink-0">
              <PlayCircle className="w-8 h-8 text-[#8B1A1A]" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg uppercase tracking-tighter">Precisa de um Treinamento?</h3>
              <p className="text-sm text-slate-600 mt-1">Podemos agendar um treinamento em vídeo chamada para mostrar o passo a passo completo do sistema SESMT Digital para toda a equipe.</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
