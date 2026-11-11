import { randomBytes, scryptSync } from 'node:crypto';

const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');

console.log('Usuário inicial: admin');
console.log('Senha inicial:', password);
console.log('ADMIN_PASSWORD_HASH=' + salt + ':' + hash);
