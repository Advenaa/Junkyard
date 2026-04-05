// pm2 ecosystem config — used by CI/CD deploy and manual restarts
module.exports = {
  apps: [{
    name: 'podders',
    script: 'dist/index.js',
    args: 'run',
    cwd: '/root/podders',
    env_file: '.env',
    max_memory_restart: '512M',
    restart_delay: 5000,
    kill_timeout: 60000,
    max_restarts: 10,
    min_uptime: 10000,
  }],
};
