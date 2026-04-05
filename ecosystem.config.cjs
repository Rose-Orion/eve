/**
 * PM2 ecosystem config for EVE Orchestrator.
 * Start with: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'eve-orchestrator',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      merge_logs: true,
      time: true,
    },
  ],
};
