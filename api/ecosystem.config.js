// PM2 process definition. cwd resolves relative to this file, so the checkout
// can live anywhere on the host: clone it, run `npm ci` in api/, then
// `pm2 start api/ecosystem.config.js`.
module.exports = {
  apps: [{
    name: 'wow-dashboard-api',
    script: 'server.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 3002,
    },
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
