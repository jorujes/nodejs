const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Supabase config
const supabase = createClient(
  'https://ktyuufojqhndijacwuvc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0eXV1Zm9qcWhuZGlqYWN3dXZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjU1MTMxMCwiZXhwIjoyMDYyMTI3MzEwfQ.Ope4HaI4VipC2GZET5lfEoFrlCRJvgABlEYVcMa48-4'
);

// Estado de sessões ativas
const sessoes = {};

const app = express();
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => res.send('pong ✅'));

// Rota para criar nova sessão
app.post('/session/:nome', async (req, res) => {
  const nome = req.params.nome;

  if (sessoes[nome]) {
    return res.status(400).json({ error: 'Sessão já está ativa.' });
  }

  const pastaSession = `./.wwebjs_auth/session-${nome}`;
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: pastaSession }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  sessoes[nome] = { client, qrCode: null };

  client.on('qr', async qr => {
    const qrImage = await qrcode.toDataURL(qr);
    sessoes[nome].qrCode = qrImage;
  });

  client.on('ready', async () => {
    console.log(`🤖 Sessão ${nome} conectada!`);
    
    // Cria tabela no Supabase, se não existir
    try {
      const { error } = await supabase.rpc('criar_tabela_mensagens', { tabela_nome: `sessao_${nome}` });
      if (error) throw error;
      console.log(`Tabela sessao_${nome} criada/verificada.`);
    } catch (err) {
      console.error('Erro ao criar/verificar tabela:', err.message);
    }
  });

  // Handler de mensagens recebidas
  client.on('message', async msg => {
    if (msg.fromMe || msg.type !== 'chat') return;

    const numero = msg.from.split('@')[0];
    const timestamp = new Date(msg.timestamp * 1000).toISOString();

    try {
      const { error } = await supabase
        .from(`sessao_${nome}`)
        .insert({
          numero,
          primeira_data: timestamp.split('T')[0],
          primeira_hora: timestamp.split('T')[1].split('.')[0],
          ultima_data: timestamp.split('T')[0],
          ultima_hora: timestamp.split('T')[1].split('.')[0],
          total_mensagens: 1,
          conteudo: msg.body
        });

      if (error) throw error;

      console.log(`📦 Mensagem de ${numero} salva na tabela sessao_${nome}`);
    } catch (err) {
      console.error('Erro ao salvar mensagem:', err.message);
    }
  });

  client.initialize();
  res.json({ status: 'iniciando sessão', nome });
});

// Rota para obter QR Code da sessão
app.get('/session/:nome/qr', (req, res) => {
  const sessao = sessoes[req.params.nome];
  if (!sessao) return res.status(404).json({ error: 'Sessão não encontrada.' });
  if (!sessao.qrCode) return res.status(202).json({ status: 'QR ainda não gerado.' });

  res.json({ qr: sessao.qrCode });
});

// Rota para listar sessões ativas
app.get('/sessions', (req, res) => {
  const nomes = Object.keys(sessoes);
  res.json({ sessoes: nomes });
});

// Rota para desconectar uma sessão
app.delete('/session/:nome', async (req, res) => {
  const sessao = sessoes[req.params.nome];
  if (!sessao) return res.status(404).json({ error: 'Sessão não encontrada.' });

  await sessao.client.destroy();
  delete sessoes[req.params.nome];
  res.json({ status: 'Sessão encerrada com sucesso.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
