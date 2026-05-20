/**
 * Gerador de Apresentacao SafeEPI (.pptx) — Versao Cinematografica
 *
 * Como rodar (no terminal, dentro da pasta SafeEPI):
 *   1) npm install --save-dev pptxgenjs
 *   2) node gerar_apresentacao_pptx.js
 *
 * Saida: ./apresentacao_safeepi.pptx (abre no PowerPoint / Keynote / Google Slides)
 *
 * Edite as constantes abaixo (COMPANY, PRICING, CONTACT) para ajustar
 * antes de mandar para o cliente.
 */

const PptxGenJS = require("pptxgenjs");

// ===== CONFIGURACAO =====
const OUTPUT_FILE = "apresentacao_safeepi.pptx";

const CONTACT = {
  name: "Vinix Dev",
  email: "vinicius@safeepi.com.br",
  phone: "(00) 0 0000-0000",
};

const PRICING = {
  basic:   { name: "SafeEPI Essencial",  value: 150 },
  premium: { name: "SafeEPI Pro + Treinamentos", value: 300 },
};

// ===== PALETA =====
const C = {
  bg:        "070B14",
  bg2:       "0B1220",
  panel:     "0F1729",
  border:    "1E293B",
  text:      "F8FAFC",
  text2:     "94A3B8",
  text3:     "64748B",
  brand:     "2563EB",
  brand2:    "3B82F6",
  green:     "10B981",
  amber:     "F59E0B",
  red:       "EF4444",
  gold:      "FBBF24",
  panelHi:   "152034",
};

// ===== HELPERS =====
const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5 (cinematografico)
pres.title  = "SafeEPI — Proposta Comercial";
pres.author = CONTACT.name;

const W = 13.3;
const H = 7.5;

function addBackground(slide, color = C.bg) {
  slide.background = { color };
}

function addCornerLogo(slide) {
  // logo mark
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 0.4, w: 0.42, h: 0.42,
    fill: { color: C.brand }, line: { color: C.brand2, width: 1 },
    rectRadius: 0.08,
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.4 },
  });
  slide.addText("S", {
    x: 0.5, y: 0.4, w: 0.42, h: 0.42,
    align: "center", valign: "middle", margin: 0,
    fontFace: "Inter", fontSize: 18, bold: true, color: "FFFFFF",
  });
  slide.addText([
    { text: "Safe", options: { color: C.text } },
    { text: "EPI",  options: { color: C.brand2 } },
  ], {
    x: 1.0, y: 0.4, w: 1.3, h: 0.42,
    fontFace: "Inter", fontSize: 14, bold: true, valign: "middle", margin: 0,
  });
}

function addCornerInfo(slide, text) {
  slide.addText(text, {
    x: W - 4.0, y: 0.4, w: 3.5, h: 0.42,
    align: "right", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, color: C.text3,
    charSpacing: 3,
  });
}

function addPageNumber(slide, n, total) {
  slide.addText(`${String(n).padStart(2,"0")} / ${String(total).padStart(2,"0")}`, {
    x: W - 1.4, y: H - 0.5, w: 1.2, h: 0.3,
    align: "right", fontFace: "Consolas", fontSize: 8, color: C.text3, charSpacing: 3,
  });
}

function addKicker(slide, x, y, text, variant = "brand") {
  const colorMap = {
    brand: { fg: C.brand2, bg: "0E2350" },
    green: { fg: C.green,  bg: "07332B" },
    amber: { fg: C.amber,  bg: "3A2710" },
    red:   { fg: C.red,    bg: "3A1212" },
  };
  const v = colorMap[variant] || colorMap.brand;
  // dot
  slide.addShape(pres.shapes.OVAL, {
    x, y: y + 0.10, w: 0.10, h: 0.10,
    fill: { color: v.fg }, line: { color: v.fg, width: 0 },
  });
  // text
  slide.addText(text, {
    x: x + 0.18, y, w: 4, h: 0.30,
    fontFace: "Consolas", fontSize: 9, bold: true, color: v.fg,
    charSpacing: 4, valign: "middle", margin: 0,
  });
}

function addCard(slide, opts) {
  // opts: { x, y, w, h, accent? }
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    fill: { color: C.panel }, line: { color: C.border, width: 1 },
    rectRadius: 0.10,
  });
  if (opts.accent) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: opts.x, y: opts.y, w: 0.05, h: opts.h,
      fill: { color: opts.accent }, line: { color: opts.accent, width: 0 },
    });
  }
}

function addCheck(slide, x, y, size = 0.2, color = C.green) {
  slide.addShape(pres.shapes.OVAL, {
    x, y, w: size, h: size,
    fill: { color }, line: { color, width: 0 },
  });
  slide.addText("✓", {
    x, y, w: size, h: size, align: "center", valign: "middle", margin: 0,
    fontFace: "Arial Black", fontSize: 11, bold: true, color: "FFFFFF",
  });
}

function addX(slide, x, y, size = 0.2, color = C.red) {
  slide.addShape(pres.shapes.OVAL, {
    x, y, w: size, h: size,
    fill: { color }, line: { color, width: 0 },
  });
  slide.addText("✕", {
    x, y, w: size, h: size, align: "center", valign: "middle", margin: 0,
    fontFace: "Arial Black", fontSize: 11, bold: true, color: "FFFFFF",
  });
}

// ===== SLIDE 01 — COVER =====
function s01() {
  const s = pres.addSlide();
  addBackground(s);

  // glow center
  s.addShape(pres.shapes.OVAL, {
    x: W/2 - 5, y: H/2 - 5, w: 10, h: 10,
    fill: { color: C.brand, transparency: 88 }, line: { color: C.brand, width: 0 },
  });

  // logo (centered)
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: W/2 - 0.4, y: 1.6, w: 0.8, h: 0.8,
    fill: { color: C.brand }, line: { color: C.brand2, width: 1 },
    rectRadius: 0.15,
    shadow: { type: "outer", color: "000000", blur: 18, offset: 6, angle: 135, opacity: 0.5 },
  });
  s.addText("S", {
    x: W/2 - 0.4, y: 1.6, w: 0.8, h: 0.8,
    align: "center", valign: "middle", margin: 0,
    fontFace: "Inter", fontSize: 38, bold: true, color: "FFFFFF",
  });

  // kicker
  s.addText("● SISTEMA SESMT DIGITAL", {
    x: W/2 - 2, y: 2.6, w: 4, h: 0.35, align: "center",
    fontFace: "Consolas", fontSize: 10, bold: true, color: C.brand2, charSpacing: 6,
  });

  // mega title
  s.addText("Conformidade NR-06 e NR-31", {
    x: 0.5, y: 3.1, w: W - 1, h: 0.95, align: "center",
    fontFace: "Inter", fontSize: 56, bold: true, color: C.text,
    charSpacing: -2,
  });
  s.addText("automatizada, do canteiro ao jurídico.", {
    x: 0.5, y: 4.0, w: W - 1, h: 0.95, align: "center",
    fontFace: "Inter", fontSize: 56, bold: true, color: C.brand2,
    italic: true, charSpacing: -2,
  });

  // subtitle
  s.addText(
    "Gestão de entrega, devolução, treinamento e auditoria de EPI com biometria facial, " +
    "assinatura digital remota e hash SHA-256 com valor pericial.",
    {
      x: 1.5, y: 5.2, w: W - 3, h: 1.0, align: "center",
      fontFace: "Inter", fontSize: 14, color: C.text2,
    }
  );

  // pills
  const pills = ["NR-06", "NR-31", "TRABALHO RURAL", "MULTI-EMPRESA", "MULTI-CANTEIRO"];
  const pillW = 1.6;
  const totalW = pills.length * pillW + (pills.length - 1) * 0.15;
  let pillX = (W - totalW) / 2;
  pills.forEach(p => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: pillX, y: 6.5, w: pillW, h: 0.35,
      fill: { color: "0E2350" }, line: { color: C.brand, width: 1 },
      rectRadius: 0.17,
    });
    s.addText(p, {
      x: pillX, y: 6.5, w: pillW, h: 0.35, align: "center", valign: "middle", margin: 0,
      fontFace: "Consolas", fontSize: 8, bold: true, color: C.brand2, charSpacing: 4,
    });
    pillX += pillW + 0.15;
  });

  // logo top-left
  addCornerLogo(s);
  addCornerInfo(s, "PROPOSTA COMERCIAL\nCONFIDENCIAL · 2026");
}

// ===== SLIDE 02 — AGENDA =====
function s02() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "AGENDA");
  addKicker(s, 0.5, 1.3, "● AGENDA", "brand");

  s.addText([
    { text: "O que você vai ver nesta apresentação", options: { color: C.text } },
    { text: ".", options: { color: C.brand2 } },
  ], {
    x: 0.5, y: 1.7, w: W - 1, h: 1.0,
    fontFace: "Inter", fontSize: 38, bold: true, charSpacing: -1,
  });

  const items = [
    { n: "01", t: "O cenário que está aí, e ninguém viu chegar.", d: "A nova fiscalização da NR-31, responsabilidade solidária e o custo real de uma autuação." },
    { n: "02", t: "SafeEPI: o sistema, em 5 minutos.",            d: "Os três pilares — assinatura remota, biometria e auditoria live com SHA-256." },
    { n: "03", t: "Comparativo direto com o mercado.",            d: "Frente a frente com BeeSafe, Mind4 EPI, SOC EPI e Senior. Sem maquiagem." },
    { n: "04", t: "Investimento, ROI e próximo passo.",            d: "Dois planos transparentes e a conta que mostra o sistema pagando ele mesmo." },
  ];

  const cardW = (W - 1 - 0.4) / 2;
  const cardH = 1.7;
  items.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * (cardW + 0.4);
    const y = 3.1 + row * (cardH + 0.3);
    addCard(s, { x, y, w: cardW, h: cardH });

    s.addText(it.n, {
      x: x + 0.3, y: y + 0.25, w: 1.2, h: 1.0,
      fontFace: "Inter", fontSize: 54, bold: true, color: C.brand2, charSpacing: -2, valign: "top", margin: 0,
    });
    s.addText(it.t, {
      x: x + 1.6, y: y + 0.3, w: cardW - 1.8, h: 0.5,
      fontFace: "Inter", fontSize: 16, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(it.d, {
      x: x + 1.6, y: y + 0.85, w: cardW - 1.8, h: 0.7,
      fontFace: "Inter", fontSize: 11, color: C.text2, valign: "top", margin: 0,
    });
  });

  addPageNumber(s, 2, 16);
}

// ===== SLIDE 03 — O CENARIO =====
function s03() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "CAPÍTULO 01 · O CENÁRIO");
  addKicker(s, 0.5, 1.3, "● CAPÍTULO 01 · O CENÁRIO", "red");

  s.addText("A NR-31 mudou.", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 40, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("A fiscalização do dendê, também.", {
    x: 0.5, y: 2.35, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 40, bold: true, color: C.red, italic: true, charSpacing: -1,
  });

  s.addText(
    "Plantações de dendê estão sob monitoramento ativo do MTE há mais de uma década por adoecimento, queda de cacho e exposição química. " +
    "Em 2024, a fiscalização de turmas terceirizadas em campo foi reforçada. A prova de entrega e treinamento de EPI deixou de ser papel em pasta — virou exibição obrigatória.",
    {
      x: 0.5, y: 3.2, w: W - 1, h: 1.2,
      fontFace: "Inter", fontSize: 14, color: C.text2,
    }
  );

  const stats = [
    { tag: "MULTA NR-06 · M2/I3",    big: "R$ 6.708", note: "por trabalhador exposto, recorrente.\n100 colaboradores = R$ 670.800 em uma visita." },
    { tag: "NR-31 · TRABALHO RURAL", big: "Item 31.20", note: "EPI rural gratuito, treinamento documentado e ficha individual rastreável." },
    { tag: "AÇÃO TRABALHISTA",       big: "R$ 87 mil", note: "Indenização média por acidente sem prova de EPI (PA/BA, setor agro)." },
  ];
  const colW = (W - 1 - 0.4) / 3;
  stats.forEach((st, i) => {
    const x = 0.5 + i * (colW + 0.2);
    const y = 4.7;
    addCard(s, { x, y, w: colW, h: 2.4, accent: C.red });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.25, y: y + 0.25, w: 2.4, h: 0.3,
      fill: { color: "3A1212" }, line: { color: C.red, width: 1 }, rectRadius: 0.15,
    });
    s.addText(st.tag, {
      x: x + 0.25, y: y + 0.25, w: 2.4, h: 0.3, align: "center", valign: "middle", margin: 0,
      fontFace: "Consolas", fontSize: 8, bold: true, color: C.red, charSpacing: 3,
    });
    s.addText(st.big, {
      x: x + 0.25, y: y + 0.65, w: colW - 0.5, h: 0.9,
      fontFace: "Inter", fontSize: 36, bold: true, color: C.red, charSpacing: -2, valign: "top", margin: 0,
    });
    s.addText(st.note, {
      x: x + 0.25, y: y + 1.55, w: colW - 0.5, h: 0.8,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
  });

  addPageNumber(s, 3, 16);
}

// ===== SLIDE 04 — RESPONSABILIDADE SOLIDARIA =====
function s04() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "RESPONSABILIDADE SOLIDÁRIA");
  addKicker(s, 0.5, 1.3, "● O DETALHE QUE NINGUÉM TE AVISA", "amber");

  s.addText("A contratante é", {
    x: 0.5, y: 1.7, w: 6.5, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("responsável solidária.", {
    x: 0.5, y: 2.3, w: 6.5, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.amber, italic: true, charSpacing: -1,
  });
  s.addText(
    "A empresa de dendê que terceiriza serviço de colheita responde junto com a terceirizada por irregularidade de EPI. " +
    "CLT art. 455, Lei 6.019/2017 e Súmula 331 do TST.",
    {
      x: 0.5, y: 3.2, w: 6.5, h: 1.2,
      fontFace: "Inter", fontSize: 13, color: C.text2,
    }
  );
  s.addText(
    "Tradução prática: sem prova digital, auditável, exibível em segundos, você perde o contrato. " +
    "E na renovação anual, a contratante hoje pede SOC ou equivalente.",
    {
      x: 0.5, y: 4.4, w: 6.5, h: 1.4,
      fontFace: "Inter", fontSize: 13, color: C.text2,
    }
  );

  // 2 cards right
  const cardX = 7.4;
  const cardW = W - cardX - 0.5;

  addCard(s, { x: cardX, y: 1.8, w: cardW, h: 2.4, accent: C.red });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX + 0.25, y: 1.95, w: 2.0, h: 0.28,
    fill: { color: "3A1212" }, line: { color: C.red, width: 1 }, rectRadius: 0.14,
  });
  s.addText("CENÁRIO A · MTE", {
    x: cardX + 0.25, y: 1.95, w: 2.0, h: 0.28, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.red, charSpacing: 3,
  });
  s.addText("O auditor pede prova de entrega de bota CA 5264 para 47 colaboradores do talhão 12.", {
    x: cardX + 0.25, y: 2.3, w: cardW - 0.5, h: 0.7,
    fontFace: "Inter", fontSize: 13, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("24 horas para apresentar. Em papel, é impossível. Em SafeEPI, são 3 cliques.", {
    x: cardX + 0.25, y: 3.05, w: cardW - 0.5, h: 1.2,
    fontFace: "Inter", fontSize: 11, color: C.text2, valign: "top", margin: 0,
  });

  addCard(s, { x: cardX, y: 4.4, w: cardW, h: 2.4, accent: C.amber });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX + 0.25, y: 4.55, w: 2.6, h: 0.28,
    fill: { color: "3A2710" }, line: { color: C.amber, width: 1 }, rectRadius: 0.14,
  });
  s.addText("CENÁRIO B · CONTRATANTE", {
    x: cardX + 0.25, y: 4.55, w: 2.6, h: 0.28, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.amber, charSpacing: 3,
  });
  s.addText("A contratante audita semestralmente seus terceirizados. Pede acesso ao histórico de EPI.", {
    x: cardX + 0.25, y: 4.90, w: cardW - 0.5, h: 0.7,
    fontFace: "Inter", fontSize: 13, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("Com SafeEPI, você libera um login somente-leitura para o gestor de SST dela. Diferencial competitivo direto.", {
    x: cardX + 0.25, y: 5.65, w: cardW - 0.5, h: 1.2,
    fontFace: "Inter", fontSize: 11, color: C.text2, valign: "top", margin: 0,
  });

  addPageNumber(s, 4, 16);
}

// ===== SLIDE 05 — COMO E HOJE =====
function s05() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "O STATUS QUO");
  addKicker(s, 0.5, 1.3, "● O STATUS QUO", "amber");

  s.addText("Como funciona hoje", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 38, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("em 90% dos terceirizados rurais.", {
    x: 0.5, y: 2.35, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 38, bold: true, color: C.text3, italic: true, charSpacing: -1,
  });

  const probs = [
    { ic: "📄", t: "Ficha de papel",          d: "Capataz leva prancheta pro campo. Coleta assinatura com caneta. Volta pro escritório (às vezes). Arquiva (às vezes).", tag: "RISCO: EXTRAVIO TOTAL" },
    { ic: "📊", t: "Planilha Excel",          d: "Alguém digita depois o que foi entregue. Sem CA real, sem foto, sem assinatura digital. Vale zero em perícia.", tag: "RISCO: SEM VALOR JURÍDICO" },
    { ic: "⏳", t: "\"A gente confia\"",      d: "Entrega verbal. Colaborador some dois meses depois e processa por insalubridade. Não há prova.", tag: "RISCO: PASSIVO TRABALHISTA" },
  ];
  const colW = (W - 1 - 0.4) / 3;
  probs.forEach((p, i) => {
    const x = 0.5 + i * (colW + 0.2);
    const y = 3.4;
    addCard(s, { x, y, w: colW, h: 2.4, accent: C.red });
    s.addText(p.ic, {
      x: x + 0.3, y: y + 0.2, w: 0.6, h: 0.6,
      fontFace: "Segoe UI Emoji", fontSize: 28, valign: "middle", margin: 0,
    });
    s.addText(p.t, {
      x: x + 0.3, y: y + 0.85, w: colW - 0.5, h: 0.4,
      fontFace: "Inter", fontSize: 16, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(p.d, {
      x: x + 0.3, y: y + 1.25, w: colW - 0.5, h: 0.9,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.3, y: y + 1.95, w: colW - 0.6, h: 0.3,
      fill: { color: "3A1212" }, line: { color: C.red, width: 1 }, rectRadius: 0.15,
    });
    s.addText(p.tag, {
      x: x + 0.3, y: y + 1.95, w: colW - 0.6, h: 0.3, align: "center", valign: "middle", margin: 0,
      fontFace: "Consolas", fontSize: 8, bold: true, color: C.red, charSpacing: 3,
    });
  });

  // bottom warning
  addCard(s, { x: 0.5, y: 6.0, w: W - 1, h: 1.0, accent: C.amber });
  s.addText("⚠", {
    x: 0.7, y: 6.1, w: 0.6, h: 0.8,
    fontFace: "Segoe UI Emoji", fontSize: 32, valign: "middle", margin: 0,
  });
  s.addText("O resultado: você corre risco que não precisa correr.", {
    x: 1.4, y: 6.1, w: W - 2, h: 0.35,
    fontFace: "Inter", fontSize: 16, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("O problema não é fazer. É provar que fez. Em fiscalização, fazer sem provar = não fazer.", {
    x: 1.4, y: 6.45, w: W - 2, h: 0.5,
    fontFace: "Inter", fontSize: 11, color: C.text2, valign: "top", margin: 0,
  });

  addPageNumber(s, 5, 16);
}

// ===== SLIDE 06 — REVEAL =====
function s06() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "CAPÍTULO 02 · O PRODUTO");

  // big glow
  s.addShape(pres.shapes.OVAL, {
    x: W/2 - 4, y: H/2 - 4, w: 8, h: 8,
    fill: { color: C.brand, transparency: 88 }, line: { color: C.brand, width: 0 },
  });

  addKicker(s, W/2 - 1.6, 1.3, "● APRESENTAMOS", "brand");

  // logo big centered
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: W/2 - 1.5, y: 1.8, w: 0.6, h: 0.6,
    fill: { color: C.brand }, line: { color: C.brand2, width: 1 }, rectRadius: 0.12,
    shadow: { type: "outer", color: "000000", blur: 14, offset: 4, angle: 135, opacity: 0.5 },
  });
  s.addText("S", {
    x: W/2 - 1.5, y: 1.8, w: 0.6, h: 0.6,
    align: "center", valign: "middle", margin: 0,
    fontFace: "Inter", fontSize: 28, bold: true, color: "FFFFFF",
  });
  s.addText([
    { text: "Safe", options: { color: C.text } },
    { text: "EPI",  options: { color: C.brand2 } },
  ], {
    x: W/2 - 0.8, y: 1.85, w: 2.5, h: 0.55,
    fontFace: "Inter", fontSize: 36, bold: true, valign: "middle", margin: 0,
  });

  s.addText("O sistema SESMT digital que", {
    x: 0.5, y: 2.9, w: W - 1, h: 0.8, align: "center",
    fontFace: "Inter", fontSize: 44, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("cabe na palma da mão do capataz", {
    x: 0.5, y: 3.7, w: W - 1, h: 0.8, align: "center",
    fontFace: "Inter", fontSize: 44, bold: true, color: C.brand2, italic: true, charSpacing: -1,
  });
  s.addText("e sustenta uma perícia em tribunal.", {
    x: 0.5, y: 4.5, w: W - 1, h: 0.8, align: "center",
    fontFace: "Inter", fontSize: 44, bold: true, color: C.text, charSpacing: -1,
  });

  s.addText(
    "Web, mobile, multi-empresa, multi-canteiro. Sem app pra instalar. Sem tablet caro. Sem consultoria de implantação de 90 dias.",
    {
      x: 1.5, y: 5.8, w: W - 3, h: 1.0, align: "center",
      fontFace: "Inter", fontSize: 14, color: C.text2,
    }
  );

  addPageNumber(s, 6, 16);
}

// ===== SLIDE 07 — TOUR =====
function s07() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "TOUR PELO SISTEMA");
  addKicker(s, 0.5, 1.3, "● TOUR PELO SISTEMA", "brand");

  s.addText("8 módulos. Tudo conectado.", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 38, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("Estoque debita quando a entrega é registrada. A entrega só existe quando há assinatura. A auditoria mostra tudo em tempo real.", {
    x: 0.5, y: 2.45, w: W - 1, h: 0.6,
    fontFace: "Inter", fontSize: 13, color: C.text2,
  });

  const mods = [
    { t: "Nova Entrega",        d: "Multi-EPI, validação de CA, baixa automática.",        c: C.brand2 },
    { t: "Estoque",             d: "Entrada, saída, ajuste com histórico completo.",        c: C.green },
    { t: "Obras / Canteiros",   d: "Multi-talhão. Cada colaborador no seu canteiro.",       c: C.brand2 },
    { t: "Colaboradores",       d: "Foto biométrica, admissão, cargo, setor. CPF único.",   c: C.brand2 },
    { t: "EPIs e CAs",          d: "Cadastro com CA, validade, vida útil, alertas.",        c: C.amber },
    { t: "Histórico / Auditoria", d: "Live database. Hash SHA-256 de cada PDF.",           c: C.brand2 },
    { t: "Movimentações",       d: "Log de SAIDA/ENTRADA/AJUSTE vinculado à entrega.",      c: C.brand2 },
    { t: "Treinamentos",        d: "Cadastro, validade, certificado assinado. Opcional.",   c: C.green },
  ];
  const cardW = (W - 1 - 0.6) / 4;
  const cardH = 1.7;
  mods.forEach((m, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 0.5 + col * (cardW + 0.2);
    const y = 3.4 + row * (cardH + 0.25);
    addCard(s, { x, y, w: cardW, h: cardH });
    // icon circle
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5,
      fill: { color: C.bg2 }, line: { color: m.c, width: 1.5 }, rectRadius: 0.1,
    });
    s.addText("●", {
      x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, align: "center", valign: "middle", margin: 0,
      fontFace: "Inter", fontSize: 18, color: m.c,
    });
    s.addText(m.t, {
      x: x + 0.25, y: y + 0.85, w: cardW - 0.5, h: 0.35,
      fontFace: "Inter", fontSize: 13, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(m.d, {
      x: x + 0.25, y: y + 1.20, w: cardW - 0.5, h: 0.5,
      fontFace: "Inter", fontSize: 9.5, color: C.text2, valign: "top", margin: 0,
    });
  });

  addPageNumber(s, 7, 16);
}

// ===== SLIDE 08 — PILAR 1: ASSINATURA REMOTA =====
function s08() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "PILAR 01 · ASSINATURA REMOTA");
  addKicker(s, 0.5, 1.3, "● PILAR 01 · ASSINATURA REMOTA", "brand");

  s.addText("O colaborador assina", {
    x: 0.5, y: 1.7, w: 7.5, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("no celular dele. Sem app.", {
    x: 0.5, y: 2.35, w: 7.5, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.brand2, italic: true, charSpacing: -1,
  });

  s.addText(
    "Você gera um link. Manda por WhatsApp para o capataz da turma. " +
    "Ele passa para o colaborador, que assina com o dedo, na tela, no campo. " +
    "O sistema registra IP, geolocalização, hora exata e foto biométrica opcional.",
    {
      x: 0.5, y: 3.2, w: 7.5, h: 1.3,
      fontFace: "Inter", fontSize: 12, color: C.text2,
    }
  );

  const benefits = [
    { t: "Funciona em qualquer smartphone",  d: "Android, iPhone, tablet, navegador. Não precisa instalar nada." },
    { t: "Link com validade configurável",    d: "1h, 4h, 24h ou 48h — você escolhe a janela." },
    { t: "Status em tempo real",              d: "Tela de Pendências atualiza a cada 15s. Você vê cada assinatura ser colhida." },
  ];
  benefits.forEach((b, i) => {
    const y = 4.6 + i * 0.85;
    addCheck(s, 0.5, y + 0.05, 0.3, C.green);
    s.addText(b.t, {
      x: 0.95, y, w: 6.5, h: 0.35,
      fontFace: "Inter", fontSize: 13, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(b.d, {
      x: 0.95, y: y + 0.32, w: 6.5, h: 0.5,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
  });

  // phone mockup
  const phX = 9.0;
  const phY = 1.7;
  const phW = 3.4;
  const phH = 5.6;
  // phone body
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: phX, y: phY, w: phW, h: phH,
    fill: { color: "1A2030" }, line: { color: "2A3447", width: 2 }, rectRadius: 0.3,
    shadow: { type: "outer", color: "000000", blur: 22, offset: 8, angle: 135, opacity: 0.6 },
  });
  // screen
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: phX + 0.2, y: phY + 0.2, w: phW - 0.4, h: phH - 0.4,
    fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, rectRadius: 0.2,
  });
  // notch
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: phX + phW/2 - 0.5, y: phY + 0.2, w: 1.0, h: 0.18,
    fill: { color: "000000" }, line: { color: "000000", width: 0 }, rectRadius: 0.05,
  });
  // header
  s.addText("SAFEEPI · ASSINATURA", {
    x: phX + 0.4, y: phY + 0.6, w: phW - 0.8, h: 0.25,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.text3, charSpacing: 3, valign: "top", margin: 0,
  });
  s.addText("João da Silva", {
    x: phX + 0.4, y: phY + 0.95, w: phW - 0.8, h: 0.4,
    fontFace: "Inter", fontSize: 16, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("CPF 000.000.000-00", {
    x: phX + 0.4, y: phY + 1.35, w: phW - 0.8, h: 0.25,
    fontFace: "Inter", fontSize: 10, color: C.text3, valign: "top", margin: 0,
  });
  // card
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: phX + 0.4, y: phY + 1.75, w: phW - 0.8, h: 0.9,
    fill: { color: "152034" }, line: { color: C.border, width: 1 }, rectRadius: 0.1,
  });
  s.addText("EPI", {
    x: phX + 0.55, y: phY + 1.85, w: 2.5, h: 0.2,
    fontFace: "Consolas", fontSize: 7, bold: true, color: C.text3, charSpacing: 2, valign: "top", margin: 0,
  });
  s.addText("BOTA DE SEGURANÇA", {
    x: phX + 0.55, y: phY + 2.05, w: phW - 1.1, h: 0.3,
    fontFace: "Inter", fontSize: 12, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("CA 5264 · Qtd 1 · Primeira Entrega", {
    x: phX + 0.55, y: phY + 2.35, w: phW - 1.1, h: 0.2,
    fontFace: "Inter", fontSize: 9, color: C.text2, valign: "top", margin: 0,
  });
  // assine
  s.addText("ASSINE ABAIXO", {
    x: phX + 0.4, y: phY + 2.80, w: phW - 0.8, h: 0.2,
    fontFace: "Consolas", fontSize: 7, bold: true, color: C.text3, charSpacing: 2, valign: "top", margin: 0,
  });
  // sig pad
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: phX + 0.4, y: phY + 3.05, w: phW - 0.8, h: 1.5,
    fill: { color: "0F1729" }, line: { color: C.border, width: 1, dashType: "dash" }, rectRadius: 0.1,
  });
  // squiggle signature
  s.addShape(pres.shapes.LINE, {
    x: phX + 0.6, y: phY + 3.7, w: 0.4, h: -0.3,
    line: { color: C.brand2, width: 2 },
  });
  s.addShape(pres.shapes.LINE, {
    x: phX + 1.0, y: phY + 3.4, w: 0.4, h: 0.3,
    line: { color: C.brand2, width: 2 },
  });
  s.addShape(pres.shapes.LINE, {
    x: phX + 1.4, y: phY + 3.7, w: 0.5, h: -0.2,
    line: { color: C.brand2, width: 2 },
  });
  s.addShape(pres.shapes.LINE, {
    x: phX + 1.9, y: phY + 3.5, w: 0.5, h: 0.3,
    line: { color: C.brand2, width: 2 },
  });
  // button
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: phX + 0.4, y: phY + 4.7, w: phW - 0.8, h: 0.6,
    fill: { color: C.brand }, line: { color: C.brand2, width: 1 }, rectRadius: 0.1,
    shadow: { type: "outer", color: C.brand, blur: 14, offset: 0, angle: 135, opacity: 0.4 },
  });
  s.addText("CONFIRMAR RECEBIMENTO", {
    x: phX + 0.4, y: phY + 4.7, w: phW - 0.8, h: 0.6,
    align: "center", valign: "middle", margin: 0,
    fontFace: "Inter", fontSize: 11, bold: true, color: "FFFFFF", charSpacing: 2,
  });

  addPageNumber(s, 8, 16);
}

// ===== SLIDE 09 — BIOMETRIA + SHA-256 =====
function s09() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "PILAR 02 · PERÍCIA DIGITAL");
  addKicker(s, 0.5, 1.3, "● PILAR 02 · PERÍCIA DIGITAL", "green");

  s.addText("Cada entrega vira um", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("PDF com hash criptográfico.", {
    x: 0.5, y: 2.35, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.green, italic: true, charSpacing: -1,
  });

  s.addText(
    "Ao final de cada entrega, o SafeEPI gera um PDF padronizado contendo a assinatura, a foto biométrica do colaborador, " +
    "o IP de origem, geolocalização, hora UTC e os dados completos do EPI e do CA. Em cima desse PDF, o sistema calcula um hash SHA-256 — " +
    "uma impressão digital matemática única do documento.",
    {
      x: 0.5, y: 3.2, w: W - 1, h: 1.0,
      fontFace: "Inter", fontSize: 12, color: C.text2,
    }
  );

  const cards = [
    {
      t: "Identidade verificada",
      d: "Biometria facial nativa no navegador, sem hardware especial. Compara contra a foto cadastrada.",
      code: null,
    },
    {
      t: "Hash SHA-256 imutável",
      d: "Qualquer alteração — uma vírgula, um pixel — quebra o hash. Equivalente a lacre judicial.",
      code: "2C0DA9 5534CB 8E1F4A...",
    },
    {
      t: "Carimbo de tempo confiável",
      d: "Hora UTC do servidor, não do dispositivo. Impossível antedatar uma entrega.",
      code: null,
    },
  ];
  const colW = (W - 1 - 0.4) / 3;
  cards.forEach((c, i) => {
    const x = 0.5 + i * (colW + 0.2);
    const y = 4.4;
    addCard(s, { x, y, w: colW, h: 2.3, accent: C.green });
    // icon
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.3, y: y + 0.3, w: 0.5, h: 0.5,
      fill: { color: "07332B" }, line: { color: C.green, width: 1.5 }, rectRadius: 0.1,
    });
    s.addText("★", {
      x: x + 0.3, y: y + 0.3, w: 0.5, h: 0.5, align: "center", valign: "middle", margin: 0,
      fontFace: "Inter", fontSize: 16, color: C.green,
    });
    s.addText(c.t, {
      x: x + 0.3, y: y + 0.95, w: colW - 0.6, h: 0.4,
      fontFace: "Inter", fontSize: 14, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(c.d, {
      x: x + 0.3, y: y + 1.35, w: colW - 0.6, h: 0.8,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
    if (c.code) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: x + 0.3, y: y + 1.85, w: colW - 0.6, h: 0.35,
        fill: { color: "000000" }, line: { color: C.border, width: 1 }, rectRadius: 0.06,
      });
      s.addText(c.code, {
        x: x + 0.3, y: y + 1.85, w: colW - 0.6, h: 0.35, align: "center", valign: "middle", margin: 0,
        fontFace: "Consolas", fontSize: 10, bold: true, color: C.green,
      });
    }
  });

  // quote
  addCard(s, { x: 0.5, y: 6.9, w: W - 1, h: 0.5, accent: C.green });
  s.addText(
    "\"Em ação trabalhista, esse documento serve como meio de prova com valor pericial. Defesa técnica monta contra-laudo em uma tarde com isso na mão.\"",
    {
      x: 0.75, y: 6.9, w: W - 1.25, h: 0.5,
      fontFace: "Inter", fontSize: 11, italic: true, color: C.text2, valign: "middle", margin: 0,
    }
  );

  addPageNumber(s, 9, 16);
}

// ===== SLIDE 10 — PILAR 3 =====
function s10() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "PILAR 03 · CONTROLE DE ACESSO");
  addKicker(s, 0.5, 1.3, "● PILAR 03 · CONTROLE DE ACESSO", "brand");

  s.addText([
    { text: "Auditoria ",  options: { color: C.text } },
    { text: "live", options: { color: C.brand2, italic: true } },
    { text: ". Exclusão controlada por ", options: { color: C.text } },
    { text: "MASTER", options: { color: C.brand2, italic: true } },
    { text: ".", options: { color: C.text } },
  ], {
    x: 0.5, y: 1.7, w: W - 1, h: 1.0,
    fontFace: "Inter", fontSize: 32, bold: true, charSpacing: -1,
  });

  // left column — roles
  const lx = 0.5;
  s.addText("4 NÍVEIS DE PERMISSÃO", {
    x: lx, y: 3.0, w: 5.8, h: 0.35,
    fontFace: "Consolas", fontSize: 10, bold: true, color: C.brand2, charSpacing: 4,
  });
  const roles = [
    { t: "MASTER",     d: "Único papel com poder de excluir registros. Auditoria total.", brand: true },
    { t: "ADMIN",      d: "Gerencia colaboradores, EPIs, canteiros. Não exclui entrega.", brand: false },
    { t: "ALMOXARIFE", d: "Opera entrega e estoque. Não acessa configurações sensíveis.", brand: false },
    { t: "DIRETORIA",  d: "Acesso somente-leitura. Para auditor da contratante.", brand: false },
  ];
  roles.forEach((r, i) => {
    const y = 3.5 + i * 0.85;
    addCard(s, { x: lx, y, w: 6.0, h: 0.7 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: lx + 0.2, y: y + 0.2, w: 1.3, h: 0.3,
      fill: { color: r.brand ? "0E2350" : "1E293B" }, line: { color: r.brand ? C.brand : C.border, width: 1 },
      rectRadius: 0.15,
    });
    s.addText(r.t, {
      x: lx + 0.2, y: y + 0.2, w: 1.3, h: 0.3, align: "center", valign: "middle", margin: 0,
      fontFace: "Consolas", fontSize: 9, bold: true, color: r.brand ? C.brand2 : C.text2, charSpacing: 2,
    });
    s.addText(r.d, {
      x: lx + 1.65, y: y + 0.1, w: 4.2, h: 0.55,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "middle", margin: 0,
    });
  });

  // right column — delete behavior
  const rx = 7.0;
  const rw = W - rx - 0.5;
  s.addText("EXCLUSÃO DE ENTREGA ERRADA", {
    x: rx, y: 3.0, w: rw, h: 0.35,
    fontFace: "Consolas", fontSize: 10, bold: true, color: C.brand2, charSpacing: 4,
  });
  s.addText(
    "Registrou colaborador trocado, EPI errado ou quantidade errada? Somente o MASTER pode apagar. Quando apaga:",
    {
      x: rx, y: 3.4, w: rw, h: 0.6,
      fontFace: "Inter", fontSize: 11, color: C.text2,
    }
  );
  const acts = [
    "O EPI volta automaticamente ao estoque",
    "A SAIDA original some do log de movimentações",
    "Qualquer ENTRADA de devolução também é removida",
    "O PDF jurídico associado é apagado junto",
  ];
  acts.forEach((a, i) => {
    const y = 4.2 + i * 0.55;
    addCard(s, { x: rx, y, w: rw, h: 0.5 });
    addCheck(s, rx + 0.2, y + 0.13, 0.24, C.green);
    s.addText(a, {
      x: rx + 0.6, y, w: rw - 0.8, h: 0.5,
      fontFace: "Inter", fontSize: 11, bold: true, color: C.text, valign: "middle", margin: 0,
    });
  });
  s.addText("Resultado: estoque volta ao estado real, log fica limpo. Sem rastro contábil falso.", {
    x: rx, y: 6.5, w: rw, h: 0.6,
    fontFace: "Inter", fontSize: 10, italic: true, color: C.text3,
  });

  addPageNumber(s, 10, 16);
}

// ===== SLIDE 11 — NR-06 + NR-31 =====
function s11() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "CONFORMIDADE NORMATIVA");
  addKicker(s, 0.5, 1.3, "● CONFORMIDADE NORMATIVA", "green");

  s.addText("SafeEPI cobre, ponto a ponto.", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 34, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("Os artigos da NR-06 e NR-31 que mais caem em fiscalização e suas funções equivalentes no sistema.", {
    x: 0.5, y: 2.45, w: W - 1, h: 0.5,
    fontFace: "Inter", fontSize: 12, color: C.text2,
  });

  const nr06 = [
    ["6.6.1(h)", "Registro de fornecimento — assinatura digital com hash"],
    ["6.6.1(d)", "Treinamento sobre uso correto — módulo opcional"],
    ["6.9.1",    "CA válido — alerta automático antes do vencimento"],
    ["6.6.1(b)", "Substituição quando danificado — motivo rastreado"],
    ["6.5",      "Aquisição registrada — entradas com nota fiscal"],
  ];
  const nr31 = [
    ["31.20",    "EPI rural gratuito e rastreado por colaborador"],
    ["31.5.1",   "Documentação à disposição do auditor — live"],
    ["31.7",     "Treinamento documentado — certificado assinado"],
    ["31.20.2",  "Reposição imediata — fluxo automatizado"],
    ["31.10",    "Permissão de trabalho rural — vínculo canteiro"],
  ];

  const cardW = (W - 1 - 0.3) / 2;
  const cardH = 4.0;

  // NR-06 card
  let cx = 0.5;
  let cy = 3.1;
  addCard(s, { x: cx, y: cy, w: cardW, h: cardH, accent: C.green });
  s.addText("NR-06", {
    x: cx + 0.3, y: cy + 0.25, w: 2, h: 0.5,
    fontFace: "Inter", fontSize: 22, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cx + cardW - 1.4, y: cy + 0.32, w: 1.1, h: 0.32,
    fill: { color: "07332B" }, line: { color: C.green, width: 1 }, rectRadius: 0.16,
  });
  s.addText("EPI · GERAL", {
    x: cx + cardW - 1.4, y: cy + 0.32, w: 1.1, h: 0.32, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.green, charSpacing: 2,
  });
  nr06.forEach((it, i) => {
    const y = cy + 1.1 + i * 0.55;
    addCheck(s, cx + 0.3, y + 0.08, 0.22, C.green);
    s.addText(it[0], {
      x: cx + 0.65, y, w: 0.9, h: 0.35,
      fontFace: "Consolas", fontSize: 10, bold: true, color: C.green, valign: "middle", margin: 0,
    });
    s.addText(it[1], {
      x: cx + 1.55, y, w: cardW - 1.85, h: 0.4,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "middle", margin: 0,
    });
  });

  // NR-31 card
  cx = 0.8 + cardW;
  addCard(s, { x: cx, y: cy, w: cardW, h: cardH, accent: C.green });
  s.addText("NR-31", {
    x: cx + 0.3, y: cy + 0.25, w: 2, h: 0.5,
    fontFace: "Inter", fontSize: 22, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cx + cardW - 1.7, y: cy + 0.32, w: 1.4, h: 0.32,
    fill: { color: "07332B" }, line: { color: C.green, width: 1 }, rectRadius: 0.16,
  });
  s.addText("TRABALHO RURAL", {
    x: cx + cardW - 1.7, y: cy + 0.32, w: 1.4, h: 0.32, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.green, charSpacing: 2,
  });
  nr31.forEach((it, i) => {
    const y = cy + 1.1 + i * 0.55;
    addCheck(s, cx + 0.3, y + 0.08, 0.22, C.green);
    s.addText(it[0], {
      x: cx + 0.65, y, w: 0.9, h: 0.35,
      fontFace: "Consolas", fontSize: 10, bold: true, color: C.green, valign: "middle", margin: 0,
    });
    s.addText(it[1], {
      x: cx + 1.55, y, w: cardW - 1.85, h: 0.4,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "middle", margin: 0,
    });
  });

  addPageNumber(s, 11, 16);
}

// ===== SLIDE 12 — COMPARATIVO =====
function s12() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "CAPÍTULO 03 · COMPARATIVO");
  addKicker(s, 0.5, 1.0, "● CAPÍTULO 03 · COMPARATIVO DE MERCADO", "brand");

  s.addText("Frente a frente.", {
    x: 0.5, y: 1.3, w: W - 1, h: 0.5,
    fontFace: "Inter", fontSize: 28, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("Mesma feature, mesmo critério. Sem maquiagem.", {
    x: 0.5, y: 1.85, w: W - 1, h: 0.4,
    fontFace: "Inter", fontSize: 12, color: C.text2,
  });

  // table
  const headers = ["RECURSO", "SAFEEPI", "BEESAFE", "MIND4 EPI", "SOC EPI", "SENIOR"];
  const rows = [
    ["Assinatura digital remota por link (sem app)",  "✓", "✕", "parcial", "✕", "✕"],
    ["Biometria facial nativa no navegador",          "✓", "✕", "parcial", "✕", "✕"],
    ["Hash SHA-256 com valor pericial",                "✓", "✕", "✕", "parcial", "✕"],
    ["Cobertura NR-31 (trabalho rural)",               "✓", "limitada", "✕", "✓", "✓"],
    ["Multi-empresa em uma instância",                  "✓", "✕", "✕", "✓", "✓"],
    ["Estorno automático de estoque na exclusão",       "✓", "✕", "✕", "✕", "✕"],
    ["Auto-refresh em tela de pendências",              "✓", "✕", "✕", "✕", "✕"],
    ["Setup / implantação",                              "24h", "3-5d", "2-4sem", "30-90d", "60-120d"],
    ["Suporte direto com o desenvolvedor",              "✓", "helpdesk", "helpdesk", "helpdesk", "helpdesk"],
    ["Faixa de preço (50 colab)",                        "R$ 150-300", "R$ 350-600", "R$ 500-900", "R$ 800-1.5k", "R$ 1.2-2.5k"],
  ];

  const colWs = [4.0, 1.55, 1.55, 1.55, 1.55, 1.55];
  const totalW = colWs.reduce((a,b)=>a+b,0);
  const startX = (W - totalW) / 2;
  const startY = 2.4;
  const rowH = 0.4;
  const headerH = 0.5;

  // header row
  let cx = startX;
  headers.forEach((h, i) => {
    const isUs = i === 1;
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: startY, w: colWs[i], h: headerH,
      fill: { color: isUs ? "0E2350" : C.panel }, line: { color: C.border, width: 0.75 },
    });
    s.addText(h, {
      x: cx, y: startY, w: colWs[i], h: headerH, align: i === 0 ? "left" : "center", valign: "middle", margin: 0.1,
      fontFace: "Consolas", fontSize: 8, bold: true,
      color: isUs ? C.brand2 : C.text3, charSpacing: 2,
    });
    cx += colWs[i];
  });

  // data rows
  rows.forEach((r, rowIdx) => {
    const y = startY + headerH + rowIdx * rowH;
    cx = startX;
    r.forEach((cell, i) => {
      const isUs = i === 1;
      s.addShape(pres.shapes.RECTANGLE, {
        x: cx, y, w: colWs[i], h: rowH,
        fill: { color: isUs ? "0A1A38" : (rowIdx % 2 === 0 ? C.panel : C.bg2) },
        line: { color: C.border, width: 0.5 },
      });

      let textColor = C.text2;
      let bold = false;
      let fontFace = "Inter";
      let fontSize = 9;
      if (i === 0) {
        textColor = C.text;
        bold = true;
        fontSize = 10;
      } else if (cell === "✓") {
        textColor = C.green;
        bold = true;
        fontSize = 14;
      } else if (cell === "✕") {
        textColor = C.red;
        bold = true;
        fontSize = 14;
      } else if (isUs) {
        textColor = C.brand2;
        bold = true;
        fontSize = 10;
      }
      s.addText(cell, {
        x: cx, y, w: colWs[i], h: rowH, align: i === 0 ? "left" : "center", valign: "middle", margin: 0.1,
        fontFace, fontSize, bold, color: textColor,
      });
      cx += colWs[i];
    });
  });

  s.addText("Valores estimados de mercado com base em propostas comerciais públicas e cotações 2024-2025. SafeEPI cobra valor fixo, não por colaborador.", {
    x: 0.5, y: startY + headerH + rows.length * rowH + 0.15, w: W - 1, h: 0.3,
    fontFace: "Inter", fontSize: 8, italic: true, color: C.text3,
  });

  addPageNumber(s, 12, 16);
}

// ===== SLIDE 13 — PREÇO =====
function s13() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "CAPÍTULO 04 · INVESTIMENTO");
  addKicker(s, 0.5, 1.3, "● CAPÍTULO 04 · INVESTIMENTO", "brand");

  s.addText("Dois planos. Valor fechado.", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("Sem cobrança por colaborador. Sem taxa de setup. Sem surpresa na renovação.", {
    x: 0.5, y: 2.45, w: W - 1, h: 0.4,
    fontFace: "Inter", fontSize: 13, color: C.text2,
  });

  const cardY = 3.2;
  const cardH = 3.8;
  const cardW = (W - 1 - 0.4) / 2;

  // plano 1
  const x1 = 0.5;
  addCard(s, { x: x1, y: cardY, w: cardW, h: cardH });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x1 + 0.3, y: cardY + 0.3, w: 1.6, h: 0.32,
    fill: { color: "1E293B" }, line: { color: C.border, width: 1 }, rectRadius: 0.16,
  });
  s.addText("PLANO OPERAÇÃO", {
    x: x1 + 0.3, y: cardY + 0.3, w: 1.6, h: 0.32, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.text2, charSpacing: 2,
  });
  s.addText(PRICING.basic.name, {
    x: x1 + 0.3, y: cardY + 0.7, w: cardW - 0.6, h: 0.5,
    fontFace: "Inter", fontSize: 22, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("R$", {
    x: x1 + 0.3, y: cardY + 1.4, w: 0.6, h: 0.4,
    fontFace: "Inter", fontSize: 18, bold: true, color: C.text2, valign: "middle", margin: 0,
  });
  s.addText(String(PRICING.basic.value), {
    x: x1 + 0.7, y: cardY + 1.3, w: 2.5, h: 0.95,
    fontFace: "Inter", fontSize: 64, bold: true, color: C.text, charSpacing: -3, valign: "top", margin: 0,
  });
  s.addText(",00 / mês", {
    x: x1 + 2.6, y: cardY + 1.8, w: 1.8, h: 0.3,
    fontFace: "Inter", fontSize: 11, bold: true, color: C.text3, charSpacing: 1, valign: "middle", margin: 0,
  });
  // divider
  s.addShape(pres.shapes.LINE, {
    x: x1 + 0.3, y: cardY + 2.4, w: cardW - 0.6, h: 0,
    line: { color: C.border, width: 0.75 },
  });
  const feats1 = [
    "Colaboradores, EPIs, CAs e canteiros — ilimitado",
    "Entrega, devolução, baixa parcial, substituição",
    "Assinatura digital remota + biometria facial",
    "Auditoria live com hash SHA-256",
    "Controle de estoque + movimentações",
    "Suporte direto com o desenvolvedor",
  ];
  feats1.forEach((f, i) => {
    const y = cardY + 2.55 + i * 0.20;
    s.addText("✓", {
      x: x1 + 0.3, y, w: 0.25, h: 0.22, align: "center", valign: "middle", margin: 0,
      fontFace: "Arial Black", fontSize: 11, bold: true, color: C.green,
    });
    s.addText(f, {
      x: x1 + 0.55, y, w: cardW - 0.85, h: 0.22,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "middle", margin: 0,
    });
  });

  // plano 2 — featured
  const x2 = 0.9 + cardW;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x2, y: cardY, w: cardW, h: cardH,
    fill: { color: "0A1A38" }, line: { color: C.brand, width: 2 },
    rectRadius: 0.16,
    shadow: { type: "outer", color: C.brand, blur: 24, offset: 0, angle: 135, opacity: 0.35 },
  });
  // recommended pill
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x2 + cardW - 1.85, y: cardY + 0.3, w: 1.55, h: 0.32,
    fill: { color: C.brand }, line: { color: C.brand2, width: 1 }, rectRadius: 0.16,
  });
  s.addText("⚡ RECOMENDADO", {
    x: x2 + cardW - 1.85, y: cardY + 0.3, w: 1.55, h: 0.32, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: "FFFFFF", charSpacing: 2,
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x2 + 0.3, y: cardY + 0.3, w: 1.6, h: 0.32,
    fill: { color: "0E2350" }, line: { color: C.brand, width: 1 }, rectRadius: 0.16,
  });
  s.addText("PLANO COMPLETO", {
    x: x2 + 0.3, y: cardY + 0.3, w: 1.6, h: 0.32, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.brand2, charSpacing: 2,
  });
  s.addText(PRICING.premium.name, {
    x: x2 + 0.3, y: cardY + 0.7, w: cardW - 0.6, h: 0.5,
    fontFace: "Inter", fontSize: 22, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText("R$", {
    x: x2 + 0.3, y: cardY + 1.4, w: 0.6, h: 0.4,
    fontFace: "Inter", fontSize: 18, bold: true, color: C.text2, valign: "middle", margin: 0,
  });
  s.addText(String(PRICING.premium.value), {
    x: x2 + 0.7, y: cardY + 1.3, w: 2.5, h: 0.95,
    fontFace: "Inter", fontSize: 64, bold: true, color: C.brand2, charSpacing: -3, valign: "top", margin: 0,
  });
  s.addText(",00 / mês", {
    x: x2 + 2.6, y: cardY + 1.8, w: 1.8, h: 0.3,
    fontFace: "Inter", fontSize: 11, bold: true, color: C.text3, charSpacing: 1, valign: "middle", margin: 0,
  });
  s.addShape(pres.shapes.LINE, {
    x: x2 + 0.3, y: cardY + 2.4, w: cardW - 0.6, h: 0,
    line: { color: C.border, width: 0.75 },
  });
  const feats2 = [
    "Tudo do plano Essencial",
    "Módulo de Treinamentos NR-06 / NR-31",
    "Emissão de certificados em PDF com hash",
    "Validade e alerta automático de reciclagem",
    "Assinatura remota do colaborador no certificado",
    "Onboarding individual de cada novo colaborador",
  ];
  feats2.forEach((f, i) => {
    const y = cardY + 2.55 + i * 0.20;
    s.addText("✓", {
      x: x2 + 0.3, y, w: 0.25, h: 0.22, align: "center", valign: "middle", margin: 0,
      fontFace: "Arial Black", fontSize: 11, bold: true, color: C.brand2,
    });
    s.addText(f, {
      x: x2 + 0.55, y, w: cardW - 0.85, h: 0.22,
      fontFace: "Inter", fontSize: 10, bold: i < 3, color: i < 3 ? C.text : C.text2, valign: "middle", margin: 0,
    });
  });

  s.addText("Pagamento mensal. Anual com 2 meses bonificados. Sem fidelidade. Cancele quando quiser.", {
    x: 0.5, y: cardY + cardH + 0.15, w: W - 1, h: 0.3, align: "center",
    fontFace: "Inter", fontSize: 10, italic: true, color: C.text3,
  });

  addPageNumber(s, 13, 16);
}

// ===== SLIDE 14 — ROI =====
function s14() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "ROI · A CONTA NO GUARDANAPO");
  addKicker(s, 0.5, 1.3, "● O CÁLCULO QUE IMPORTA", "amber");

  s.addText("A conta no guardanapo.", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("Faça você mesmo. Pegue uma multa NR-06 média e compare com 12 meses do SafeEPI.", {
    x: 0.5, y: 2.45, w: W - 1, h: 0.4,
    fontFace: "Inter", fontSize: 13, color: C.text2,
  });

  const stats = [
    {
      sub: "12 MESES · PLANO COMPLETO",
      big: "R$ 3.600",
      note: "Investimento total no ano com tudo incluso",
      bg: C.panel, border: C.border, color: C.brand2,
    },
    {
      sub: "1 AUTUAÇÃO NR-06 · 50 COLAB",
      big: "R$ 335k",
      note: "Multa única no menor patamar da tabela",
      bg: "3A2710", border: C.amber, color: C.amber,
    },
    {
      sub: "1 AÇÃO TRABALHISTA",
      big: "R$ 87k",
      note: "Indenização média + honorário sucumbencial",
      bg: "3A1212", border: C.red, color: C.red,
    },
  ];
  const colW = (W - 1 - 0.4) / 3;
  const colH = 2.6;
  stats.forEach((st, i) => {
    const x = 0.5 + i * (colW + 0.2);
    const y = 3.2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: colW, h: colH,
      fill: { color: st.bg }, line: { color: st.border, width: 1 }, rectRadius: 0.1,
    });
    s.addText(st.sub, {
      x: x + 0.25, y: y + 0.3, w: colW - 0.5, h: 0.3,
      align: "center", fontFace: "Consolas", fontSize: 9, bold: true, color: st.color, charSpacing: 3, valign: "top", margin: 0,
    });
    s.addText(st.big, {
      x: x + 0.25, y: y + 0.85, w: colW - 0.5, h: 1.2,
      align: "center", fontFace: "Inter", fontSize: 56, bold: true, color: st.color, charSpacing: -3, valign: "top", margin: 0,
    });
    s.addText(st.note, {
      x: x + 0.25, y: y + 2.05, w: colW - 0.5, h: 0.5,
      align: "center", fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
  });

  // killer line
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 6.1, w: W - 1, h: 1.0,
    fill: { color: "07332B" }, line: { color: C.green, width: 1.5 }, rectRadius: 0.12,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 6.1, w: 0.06, h: 1.0,
    fill: { color: C.green }, line: { color: C.green, width: 0 },
  });
  s.addText("1 multa evitada paga 93 anos de SafeEPI.", {
    x: 0.8, y: 6.15, w: W - 1.6, h: 0.45,
    fontFace: "Inter", fontSize: 20, bold: true, color: C.green, italic: true, charSpacing: -1, valign: "top", margin: 0,
  });
  s.addText("Você não está comprando software. Está comprando a tranquilidade de saber que, quando o auditor bater na porta, o sistema responde por você em 3 cliques.", {
    x: 0.8, y: 6.6, w: W - 1.6, h: 0.5,
    fontFace: "Inter", fontSize: 11, color: C.text2, valign: "top", margin: 0,
  });

  addPageNumber(s, 14, 16);
}

// ===== SLIDE 15 — POR QUE AGORA =====
function s15() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "POR QUE SAFEEPI · POR QUE AGORA");
  addKicker(s, 0.5, 1.3, "● POR QUE SAFEEPI · POR QUE AGORA", "green");

  s.addText("Não é mais um SaaS de prateleira.", {
    x: 0.5, y: 1.7, w: W - 1, h: 0.7,
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });

  const items = [
    { t: "Construído sob medida",    d: "SafeEPI é produto vivo. Você sugere uma melhoria de manhã, ela vira release na semana.", c: C.brand2 },
    { t: "Suporte 1:1",              d: "Você fala direto com o desenvolvedor. Sem ticket número 47.832 esperando próximo nível.", c: C.green },
    { t: "Implantação em 24h",       d: "Você importa colaboradores e EPIs por planilha, configura usuários, começa a operar amanhã.", c: C.amber },
    { t: "Hospedagem segura",        d: "Backend em Supabase (PostgreSQL gerenciado) com RLS, criptografia em trânsito e em repouso.", c: C.brand2 },
    { t: "LGPD",                     d: "Dados biométricos tratados como categoria sensível. Política e DPA disponíveis.", c: C.green },
    { t: "Garantia de auditoria",    d: "Se a fiscalização chegar e o sistema não responder, devolvemos 100% do investimento do mês.", c: C.amber },
  ];
  const cardW = (W - 1 - 0.4) / 3;
  const cardH = 2.0;
  items.forEach((it, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * (cardW + 0.2);
    const y = 2.8 + row * (cardH + 0.25);
    addCard(s, { x, y, w: cardW, h: cardH });
    // icon
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.3, y: y + 0.3, w: 0.5, h: 0.5,
      fill: { color: C.bg2 }, line: { color: it.c, width: 1.5 }, rectRadius: 0.1,
    });
    s.addText("●", {
      x: x + 0.3, y: y + 0.3, w: 0.5, h: 0.5, align: "center", valign: "middle", margin: 0,
      fontFace: "Inter", fontSize: 16, color: it.c,
    });
    s.addText(it.t, {
      x: x + 0.3, y: y + 0.95, w: cardW - 0.6, h: 0.4,
      fontFace: "Inter", fontSize: 14, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(it.d, {
      x: x + 0.3, y: y + 1.4, w: cardW - 0.6, h: 0.55,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
  });

  addPageNumber(s, 15, 16);
}

// ===== SLIDE 16 — CTA =====
function s16() {
  const s = pres.addSlide();
  addBackground(s);
  addCornerLogo(s);
  addCornerInfo(s, "PRÓXIMO PASSO");

  // glow
  s.addShape(pres.shapes.OVAL, {
    x: W/2 - 5, y: H/2 - 5, w: 10, h: 10,
    fill: { color: C.brand, transparency: 90 }, line: { color: C.brand, width: 0 },
  });

  addKicker(s, W/2 - 1.5, 0.95, "● PRÓXIMO PASSO", "brand");

  s.addText("Vamos rodar o seu", {
    x: 0.5, y: 1.4, w: W - 1, h: 0.7, align: "center",
    fontFace: "Inter", fontSize: 36, bold: true, color: C.text, charSpacing: -1,
  });
  s.addText("primeiro talhão piloto na próxima semana.", {
    x: 0.5, y: 2.05, w: W - 1, h: 0.8, align: "center",
    fontFace: "Inter", fontSize: 36, bold: true, color: C.brand2, italic: true, charSpacing: -1,
  });

  s.addText("14 dias de uso completo, com importação dos seus colaboradores, sem cobrança. Você decide depois.", {
    x: 1.5, y: 2.95, w: W - 3, h: 0.6, align: "center",
    fontFace: "Inter", fontSize: 13, color: C.text2,
  });

  // 3 steps
  const steps = [
    { n: "Passo 1", t: "Reunião de 30 min",      d: "Demo ao vivo, mapeamento do seu fluxo atual e quais módulos são prioridade." },
    { n: "Passo 2", t: "Ambiente piloto",         d: "Importação dos seus colaboradores, EPIs e canteiros. Configuração de usuários." },
    { n: "Passo 3", t: "Treinamento da turma",    d: "1h com almoxarifado e RH. Capataz aprende fluxo de assinatura em 5 min." },
  ];
  const colW = (W - 1 - 0.4) / 3;
  steps.forEach((st, i) => {
    const x = 0.5 + i * (colW + 0.2);
    const y = 3.9;
    addCard(s, { x, y, w: colW, h: 1.6 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.25, y: y + 0.2, w: 1.1, h: 0.3,
      fill: { color: "0E2350" }, line: { color: C.brand, width: 1 }, rectRadius: 0.15,
    });
    s.addText(st.n.toUpperCase(), {
      x: x + 0.25, y: y + 0.2, w: 1.1, h: 0.3, align: "center", valign: "middle", margin: 0,
      fontFace: "Consolas", fontSize: 8, bold: true, color: C.brand2, charSpacing: 2,
    });
    s.addText(st.t, {
      x: x + 0.25, y: y + 0.6, w: colW - 0.5, h: 0.35,
      fontFace: "Inter", fontSize: 13, bold: true, color: C.text, valign: "top", margin: 0,
    });
    s.addText(st.d, {
      x: x + 0.25, y: y + 0.95, w: colW - 0.5, h: 0.6,
      fontFace: "Inter", fontSize: 10, color: C.text2, valign: "top", margin: 0,
    });
  });

  // contact card
  const ccY = 5.8;
  addCard(s, { x: 1.5, y: ccY, w: W - 3, h: 1.2 });
  // logo
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.9, y: ccY + 0.3, w: 0.6, h: 0.6,
    fill: { color: C.brand }, line: { color: C.brand2, width: 1 }, rectRadius: 0.12,
  });
  s.addText("S", {
    x: 1.9, y: ccY + 0.3, w: 0.6, h: 0.6, align: "center", valign: "middle", margin: 0,
    fontFace: "Inter", fontSize: 26, bold: true, color: "FFFFFF",
  });
  s.addText([
    { text: "Safe", options: { color: C.text } },
    { text: "EPI",  options: { color: C.brand2 } },
  ], {
    x: 2.6, y: ccY + 0.3, w: 1.6, h: 0.6,
    fontFace: "Inter", fontSize: 22, bold: true, valign: "middle", margin: 0,
  });
  // separator
  s.addShape(pres.shapes.LINE, {
    x: 4.4, y: ccY + 0.35, w: 0, h: 0.5,
    line: { color: C.border, width: 1 },
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 4.7, y: ccY + 0.25, w: 2.4, h: 0.28,
    fill: { color: C.panelHi }, line: { color: C.border, width: 1 }, rectRadius: 0.14,
  });
  s.addText("DESENVOLVEDOR & CONTATO", {
    x: 4.7, y: ccY + 0.25, w: 2.4, h: 0.28, align: "center", valign: "middle", margin: 0,
    fontFace: "Consolas", fontSize: 8, bold: true, color: C.text2, charSpacing: 2,
  });
  s.addText(CONTACT.name, {
    x: 4.7, y: ccY + 0.55, w: W - 6, h: 0.4,
    fontFace: "Inter", fontSize: 18, bold: true, color: C.text, valign: "top", margin: 0,
  });
  s.addText(`${CONTACT.email} · ${CONTACT.phone}`, {
    x: 4.7, y: ccY + 0.95, w: W - 6, h: 0.25,
    fontFace: "Inter", fontSize: 11, color: C.text2, valign: "top", margin: 0,
  });

  addPageNumber(s, 16, 16);
}

// ===== BUILD =====
[s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16].forEach(fn => fn());

pres.writeFile({ fileName: OUTPUT_FILE })
  .then(name => console.log(`\n✓ Apresentacao gerada: ${name}\n`))
  .catch(err => {
    console.error("Erro ao gerar PPTX:", err);
    process.exit(1);
  });
