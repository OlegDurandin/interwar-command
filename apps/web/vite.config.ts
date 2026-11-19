import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name:'production-csp',
    apply:'build',
    transformIndexHtml: {
      order:'post',
      handler:() => [{
        tag:'meta', injectTo:'head-prepend',
        attrs:{
          'http-equiv':'Content-Security-Policy',
          content:[
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval' https://telegram.org/js/telegram-web-app.js",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
        },
      }],
    },
  }],
  build: {
    target:'es2022', assetsInlineLimit:0,
    rollupOptions:{output:{manualChunks:{'pixi-csp':['pixi.js/unsafe-eval']}}},
  },
});
