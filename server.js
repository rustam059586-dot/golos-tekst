require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_BYTES = 25 * 1024 * 1024;
const allowed = new Set(['.mp3','.mp4','.mpeg','.mpga','.m4a','.wav','.webm']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => allowed.has(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Формат не поддерживается. Используйте MP3, M4A, WAV или WEBM.'))
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/status', (_req, res) => res.json({configured: Boolean(process.env.OPENAI_API_KEY)}));
app.post('/api/transcribe', (req, res, next) => {
  upload.single('audio')(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({error: err.message || 'Не удалось загрузить файл.'});
    next();
  });
}, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({error: 'Сайт ещё не подключён к сервису распознавания. Добавьте OPENAI_API_KEY в файл .env на сервере.'});
  if (!req.file) return res.status(400).json({error: 'Сначала выберите аудиофайл.'});
  try {
    const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
    const tmpDir = path.join(__dirname, 'tmp');
    fs.mkdirSync(tmpDir, {recursive: true});
    const ext = path.extname(req.file.originalname).toLowerCase() || '.m4a';
    const tmpPath = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmpPath, req.file.buffer);
    try {
      const result = await client.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'gpt-4o-mini-transcribe',
        language: ['ru','en'].includes(req.body.language) ? req.body.language : undefined,
        response_format: 'text',
        prompt: 'Точно распознавай русскую речь, сохраняй смысл, имена и профессиональные термины. Не добавляй факты, которых нет в аудио.'
      });
      res.json({text: typeof result === 'string' ? result : String(result)});
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } catch (e) {
    console.error('Transcription error:', e.message);
    res.status(500).json({error: 'Не удалось распознать аудио. Проверьте API-ключ, доступ к API и попробуйте ещё раз.'});
  }
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({error: 'Внутренняя ошибка сервера.'});
});
app.listen(PORT, () => console.log(`Audio Transcriber running at http://localhost:${PORT}`));
