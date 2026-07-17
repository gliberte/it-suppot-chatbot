import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const COMMANDS = [
  {
    title: 'Produccion',
    commands: [
      {
        name: 'prod:help',
        description: 'Muestra esta guia rapida de comandos operativos.'
      },
      {
        name: 'prod:version',
        description: 'Muestra version desplegada, rama, commit, estado PM2/nginx y cambios locales.'
      },
      {
        name: 'prod:check',
        description: 'Ejecuta healthcheck de produccion: PM2/systemd, nginx, backend, Teams, logs y runtime state.'
      },
      {
        name: 'prod:backup',
        description: 'Crea respaldo operativo antes de cambios o despliegues.'
      },
      {
        name: 'prod:deploy-check',
        description: 'Validacion previa/posterior a despliegue: version, sintaxis, build y healthcheck.'
      },
      {
        name: 'prod:monitor',
        description: 'Resume salud reciente de Sophia: actividad Teams, auditoria, errores SDP y nginx.'
      },
      {
        name: 'prod:monitor:write',
        description: 'Genera/actualiza reportes de monitoreo en reports/ para uso manual o cron.'
      },
      {
        name: 'prod:daily-report',
        description: 'Genera reporte diario operativo de Sophia.'
      }
    ]
  },
  {
    title: 'PM2',
    commands: [
      {
        name: 'pm2:start',
        description: 'Inicia Sophia con PM2 usando ecosystem.config.cjs.'
      },
      {
        name: 'pm2:restart',
        description: 'Reinicia Sophia en PM2 recargando variables de entorno.'
      },
      {
        name: 'pm2:status',
        description: 'Muestra el estado del proceso Sophia en PM2.'
      },
      {
        name: 'pm2:logs',
        description: 'Muestra los ultimos logs de Sophia en PM2.'
      }
    ]
  },
  {
    title: 'RAG y conocimiento',
    commands: [
      {
        name: 'rag:ingest',
        description: 'Regenera data/rag-index.json desde knowledge/. Usa Gemini embeddings.'
      },
      {
        name: 'rag:test',
        description: 'Prueba recuperacion RAG con consultas esperadas.'
      },
      {
        name: 'knowledge:candidates',
        description: 'Detecta candidatos de conocimiento desde auditoria y logs.'
      },
      {
        name: 'knowledge:candidates:report',
        description: 'Genera reporte legible de candidatos de conocimiento.'
      },
      {
        name: 'knowledge:export',
        description: 'Exporta candidatos aprobados a un borrador Markdown revisable.'
      },
      {
        name: 'knowledge:polish',
        description: 'Convierte candidatos aprobados en bloques de conocimiento mas limpios.'
      },
      {
        name: 'knowledge:review',
        description: 'Lista, revisa, aprueba o descarta candidatos de conocimiento.'
      },
      {
        name: 'knowledge:status',
        description: 'Resume estado del ciclo RAG y sugiere la proxima accion.'
      }
    ]
  },
  {
    title: 'Auditoria y QA',
    commands: [
      {
        name: 'audit:created-tickets',
        description: 'Reporta tickets creados por Sophia; acepta filtros como --confirmed, --errors, --since.'
      },
      {
        name: 'routing:check',
        description: 'Valida rutas de clasificacion SDP y ejemplos protegidos.'
      },
      {
        name: 'qa:routing',
        description: 'Alias de routing:check.'
      },
      {
        name: 'lint',
        description: 'Ejecuta ESLint sobre el proyecto.'
      },
      {
        name: 'build',
        description: 'Compila TypeScript y genera build frontend con Vite.'
      }
    ]
  },
  {
    title: 'Teams',
    commands: [
      {
        name: 'teams:check',
        description: 'Valida variables necesarias para Teams.'
      },
      {
        name: 'teams:package',
        description: 'Genera ZIP de la app Teams en teams/generated/.'
      }
    ]
  },
  {
    title: 'Desarrollo local',
    commands: [
      {
        name: 'dev:server',
        description: 'Levanta backend Express local en puerto 3001.'
      },
      {
        name: 'dev',
        description: 'Levanta frontend Vite local.'
      },
      {
        name: 'server',
        description: 'Ejecuta server.js directamente.'
      },
      {
        name: 'preview',
        description: 'Sirve el build frontend localmente para previsualizacion.'
      }
    ]
  }
];

const DIRECT_COMMANDS = [
  {
    command: 'git status --short',
    description: 'Ver cambios locales antes de actualizar o desplegar.'
  },
  {
    command: 'git pull origin main',
    description: 'Traer cambios publicados en GitHub hacia produccion.'
  },
  {
    command: 'npm install',
    description: 'Sincronizar dependencias despues de pull.'
  },
  {
    command: 'pm2 logs sophia --lines 120',
    description: 'Ver logs recientes directamente desde PM2.'
  },
  {
    command: 'curl -k https://localhost/api/teams/health',
    description: 'Probar healthcheck HTTPS local via nginx.'
  }
];

renderHelp();

function renderHelp() {
  console.log(`Sophia operational help`);
  console.log(`Version: ${packageJson.version}`);
  console.log(`Directorio sugerido en produccion: /opt/sophia/it-support-chatbot`);
  console.log('');
  console.log('Uso: npm run <script>');

  for (const section of COMMANDS) {
    console.log('');
    console.log(section.title);
    console.log('-'.repeat(section.title.length));
    for (const command of section.commands) {
      printCommand(command.name, getScript(command.name), command.description);
    }
  }

  console.log('');
  console.log('Comandos directos utiles');
  console.log('------------------------');
  for (const item of DIRECT_COMMANDS) {
    printDirectCommand(item.command, item.description);
  }

  console.log('');
  console.log('Flujo recomendado de despliegue');
  console.log('-------------------------------');
  [
    'cd /opt/sophia/it-support-chatbot',
    'npm run prod:version',
    'npm run prod:backup',
    'git status --short',
    'git pull origin main',
    'npm install',
    'npm run rag:ingest   # solo si hubo cambios en knowledge/',
    'npm run build',
    'npm run pm2:restart',
    'npm run prod:check',
    'npm run prod:version'
  ].forEach((line) => console.log(`  ${line}`));
}

function getScript(name) {
  return packageJson.scripts?.[name] || '';
}

function printCommand(name, script, description) {
  const command = `npm run ${name}`;
  const scriptText = script ? ` -> ${script}` : '';
  console.log(`  ${command.padEnd(32)} ${description}${scriptText}`);
}

function printDirectCommand(command, description) {
  console.log(`  ${command.padEnd(40)} ${description}`);
}
