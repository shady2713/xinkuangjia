import type { Options as PwaPluginOptions } from 'vite-plugin-pwa';

const isDevelopment = process.env.NODE_ENV === 'development';

const getDefaultPwaOptions = (name: string): Partial<PwaPluginOptions> => ({
  manifest: {
    description: 'A modern admin console built with Vue 3.',
    icons: [
      {
        sizes: '192x192',
        src: '/brand-logo.png',
        type: 'image/png',
      },
      {
        sizes: '512x512',
        src: '/brand-logo.png',
        type: 'image/png',
      },
    ],
    name: `${name}${isDevelopment ? ' dev' : ''}`,
    short_name: `${name}${isDevelopment ? ' dev' : ''}`,
  },
});

export { getDefaultPwaOptions };
