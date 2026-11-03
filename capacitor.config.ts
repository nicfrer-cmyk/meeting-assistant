import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'il.co.yarin.meetings',
  appName: 'פגישות',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f1115',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f1115',
      overlaysWebView: false,
    },
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
