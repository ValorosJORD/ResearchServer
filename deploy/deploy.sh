#!/usr/bin/env bash
set -e

echo "==> Pulling latest changes"
git pull

echo "==> Installing server dependencies"
npm ci

echo "==> Installing client dependencies"
npm ci --prefix client

echo "==> Building server"
npm run build:server

echo "==> Building client"
npm run build:client

echo "==> Restarting app"
pm2 restart research-server

echo "==> Done"