module.exports = {
  apps: [
    {
      name: 'sophia',
      script: 'server.js',
      cwd: __dirname,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
