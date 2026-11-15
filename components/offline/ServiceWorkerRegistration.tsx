'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('JEEVASETU PWA ServiceWorker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('JEEVASETU ServiceWorker registration failed:', err);
        });
    }
  }, []);

  return null;
}
