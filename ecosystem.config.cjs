module.exports = {
  apps: [
    {
      name: "bazaarboost-backend-prod",
      script: "./bazaar-backend/src/server.js",
      instances: "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: 4000,
        NODE_ENV: "production",
        MONGO_URI: "mongodb://127.0.0.1:27017/bazaarboost",
        REDIS_URL: "redis://127.0.0.1:6379",
        JWT_SECRET: "bazaarboost_secret_key_2026_local"
      }
    },
    {
      name: "bazaarboost-socket-nodes",
      script: "./bazaar-backend/src/server.js",
      instances: 2,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: 3001,
        NODE_ENV: "production",
        MONGO_URI: "mongodb://127.0.0.1:27017/bazaarboost",
        REDIS_URL: "redis://127.0.0.1:6379",
        JWT_SECRET: "bazaarboost_secret_key_2026_local"
      }
    },
    {
      name: "bazaarboost-frontend-prod",
      script: "npm",
      args: "run start",
      cwd: "./bazaar-frontend",
      instances: "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1.5G",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
        NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:4000"
      }
    }
  ]
};
