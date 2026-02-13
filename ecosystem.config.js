module.exports = {
  apps: [
    {
      name: 'ai-sdr-dashboard',
      script: './web/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: 4010
      },
      log_file: '/var/log/ai-sdr-dashboard.log',
      out_file: '/var/log/ai-sdr-dashboard-out.log',
      error_file: '/var/log/ai-sdr-dashboard-error.log'
    },
    {
      name: 'ai-sdr-pipeline',
      script: './pipeline/full_pipeline.js',
      instances: 1,
      autorestart: false,
      watch: false,
      cron_restart: '0 9 * * *', // Run daily at 9 AM
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      log_file: '/var/log/ai-sdr-pipeline.log'
    }
  ]
};
