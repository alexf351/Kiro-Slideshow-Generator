import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // Allow importing the engine HTML from the repo root (one level up from /app)
      allow: ['..'],
    },
  },
});
