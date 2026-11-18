module.exports = {
  apps: [
    {
      name: 'healthystudy-intranet-service',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      kill_timeout: 5000,
      listen_timeout: 10000,
      max_restarts: 10,
      min_uptime: '10s',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        TZ: 'Asia/Tashkent',
      },
    },
  ],
};
