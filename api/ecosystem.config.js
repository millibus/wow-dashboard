module.exports = {
  apps: [{
    name: 'wow-dashboard-api',
    script: 'server.js',
    cwd: '/root/clawd/projects/wow-dashboard/api',
    env: {
      NODE_ENV: 'production',
      PORT: 3002
    },
    restart_delay: 5000,
    max_restarts: 10
  }]
};
