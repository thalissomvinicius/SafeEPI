import fs from 'fs';
import https from 'https';
import path from 'path';

const MODELS_DIR = path.join(process.cwd(), 'public', 'models');
const BASE_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';

const models = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
];

if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

console.log('Downloading face-api models...');

let downloaded = 0;

models.forEach(model => {
  const destPath = path.join(MODELS_DIR, model);
  if (fs.existsSync(destPath)) {
    console.log(`Already exists: ${model}`);
    downloaded++;
    return;
  }

  const file = fs.createWriteStream(destPath);
  https.get(`${BASE_URL}${model}`, response => {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log(`Downloaded: ${model}`);
      downloaded++;
      if (downloaded === models.length) {
        console.log('All models downloaded successfully!');
      }
    });
  }).on('error', err => {
    fs.unlinkSync(destPath);
    console.error(`Error downloading ${model}:`, err.message);
  });
});
