const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');

// Supabase config
const supabase = createClient(
  'https://ktyuufojqhndijacwuvc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0eXV1Zm9qcWhuZGlqYWN3dXZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjU1MTMxMCwiZXhwIjoyMDYyMTI3MzEwfQ.Ope4HaI4VipC2GZET5lfEoFrlCRJvgABlEYVcMa48-4'
);

// Estado de sessões
const sessoes = {};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/ping', (req, res) => res.send('pong ✅'));

app.post('/session/:nome', async (req, res) => {
  const nome = req.params.nome;
  if (sessoes[nome]) {
    return res.status(400).json({ error: 'Sessão já está ativa.' });
  }

  const pastaSession = `./.wwebjs_auth/session-${nome}`;
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: pastaSession }),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] }
  });

  sessoes[nome] = {
    client,
    qrCode: null,
    isReady: false,
    registros: {}
  };

  try {
    const { error } = await supabase.rpc('criar_tabela_mensagens', {
      tabela_nome: `sessao_${nome}`
    });
    if (error) throw error;
    console.log(`✅ Tabela sessao_${nome} criada/verificada.`);
  } catch (err) {
    console.error('❌ Erro ao criar/verificar tabela:', err.message);
  }

  client.on('qr', qr => {
    qrcode.toDataURL(qr)
      .then(img => sessoes[nome].qrCode = img)
      .catch(e => console.error('❌ Falha ao gerar QR DataURL:', e.message));
  });

  client.on('ready', () => {
    console.log(`🤖 Sessão ${nome} conectada!`);
    sessoes[nome].isReady = true;
  });

  client.on('message', async msg => {
    if (msg.type !== 'chat') return;

    const numero = msg.fromMe ? 'me' : msg.from.split('@')[0];
    const dateObj = new Date(msg.timestamp * 1000);

    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    const data = `${dd}/${mm}/${yyyy}`;

    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mi = String(dateObj.getMinutes()).padStart(2, '0');
    const ss = String(dateObj.getSeconds()).padStart(2, '0');
    const hora = `${hh}:${mi}:${ss}`;

    const cache = sessoes[nome].registros;
    if (!cache[numero]) {
      cache[numero] = {
        numero,
        primeira_data: data,
        primeira_hora: hora,
        ultima_data: data,
        ultima_hora: hora,
        total_mensagens: 1,
        conteudo: `[${data} ${hora}] ${msg.fromMe ? 'Eu: ' : ''}${msg.body}`
      };
    } else {
      const r = cache[numero];
      r.ultima_data = data;
      r.ultima_hora = hora;
      r.total_mensagens += 1;
      r.conteudo += `
[${data} ${hora}] ${msg.fromMe ? 'Eu: ' : ''}${msg.body}`;
    }

    try {
      const { error } = await supabase
        .from(`sessao_${nome}`)
        .upsert(cache[numero], { onConflict: ['numero'] });
      if (error) throw error;
      console.log(`📦 Mensagem de ${numero} upsert em sessao_${nome}`);
    } catch (err) {
      console.error('❌ Supabase upsert:', err.message);
    }
  });

  client.initialize();
  res.json({ status: 'iniciando sessão', nome });
});

app.get('/session/:nome/qr', (req, res) => {
  const s = sessoes[req.params.nome];
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
  if (!s.qrCode) return res.status(202).json({ status: 'QR ainda não gerado.' });
  res.json({ qr: s.qrCode });
});

app.get('/sessions', (req, res) => {
  const prontas = Object.entries(sessoes)
    .filter(([, sess]) => sess.isReady)
    .map(([nome]) => nome);
  res.json({ sessoes: prontas });
});

app.delete('/session/:nome', async (req, res) => {
  const s = sessoes[req.params.nome];
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });

  await s.client.destroy();
  delete sessoes[req.params.nome];
  res.json({ status: 'Sessão encerrada com sucesso.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
