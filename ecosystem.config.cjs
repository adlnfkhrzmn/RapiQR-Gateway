module.exports = {
  apps: [
    {
      name: "rapiqr-gateway",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 3000,
        DATABASE_PATH: "./data/rapiqr.sqlite",
      },
    },
  ],
};
