// .cjs extension is required here even though the rest of the project is
// ESM ("type": "module" in package.json) — PM2's ecosystem config loader
// expects CommonJS, and Node always treats .cjs files as CommonJS
// regardless of the package's module type.
module.exports = {
  apps: [
    {
      name: 'research-server',
      script: './dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
