import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const required = [
  'MICROSOFT_APP_ID',
  'MICROSOFT_APP_PASSWORD',
  'PUBLIC_APP_DOMAIN'
];

const optional = [
  'MICROSOFT_APP_TYPE',
  'AZURE_TENANT_ID',
  'TEAMS_GRAPH_USER_LOOKUP',
  'TEAMS_DEV_TEST_TOKEN',
  'TEAMS_ALLOWED_CONVERSATION_IDS',
  'TEAMS_USER_OVERRIDES'
];

let hasError = false;

console.log('Teams pilot preflight');
console.log('=====================');

for (const name of required) {
  const ok = Boolean(process.env[name]);
  if (!ok) hasError = true;
  console.log(`${ok ? 'OK ' : 'ERR'} ${name}`);
}

for (const name of optional) {
  console.log(`${process.env[name] ? 'OK ' : 'WARN'} ${name}`);
}

if (process.env.TEAMS_GRAPH_USER_LOOKUP === 'true' && !process.env.AZURE_TENANT_ID) {
  console.log('ERR AZURE_TENANT_ID es requerido cuando TEAMS_GRAPH_USER_LOOKUP=true');
  hasError = true;
}

if (process.env.MICROSOFT_APP_TYPE === 'SingleTenant' && !process.env.AZURE_TENANT_ID) {
  console.log('ERR AZURE_TENANT_ID es requerido cuando MICROSOFT_APP_TYPE=SingleTenant');
  hasError = true;
}

if (process.env.TEAMS_USER_OVERRIDES) {
  try {
    JSON.parse(process.env.TEAMS_USER_OVERRIDES);
    console.log('OK  TEAMS_USER_OVERRIDES JSON valido');
  } catch (error) {
    console.log(`ERR TEAMS_USER_OVERRIDES JSON invalido: ${error.message}`);
    hasError = true;
  }
}

console.log('');
console.log('Endpoint esperado:');
console.log(`https://${process.env.PUBLIC_APP_DOMAIN || '<PUBLIC_APP_DOMAIN>'}/api/teams/messages`);

process.exit(hasError ? 1 : 0);
