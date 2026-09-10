import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages 部署在子路径；开发模式保持根路径
  base: command === 'build' ? '/NFS-k3/' : '/',
  build: {
    chunkSizeWarningLimit: 1500,
  },
}));
