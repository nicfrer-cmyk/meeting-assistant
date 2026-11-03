import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative, uid } from './lib/platform';
import { processMeeting } from './lib/pipeline';
import { getActiveRecorder } from './lib/recorder';
import { recoverOnLaunch } from './lib/recovery';
import { deleteMeeting, getSettings, saveMeeting } from './lib/store';
import { Home } from './screens/Home';
import { MeetingView } from './screens/MeetingView';
import { Record } from './screens/Record';
import { SettingsScreen } from './screens/SettingsScreen';
import { DEFAULT_SETTINGS, type Meeting, type Settings } from './types';
import { Toast } from './ui/primitives';

type Route = { name: 'home' } | { name: 'record'; id: string } | { name: 'meeting'; id: string } | { name: 'settings' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toastTimer = useRef<number | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings(s);
      await recoverOnLaunch().catch(() => undefined);
      setLoaded(true);
    })();
    if (isNative) {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      StatusBar.setBackgroundColor({ color: dark ? '#101216' : '#f5f4f0' }).catch(() => undefined);
    }
  }, []);

  // Android hardware back button
  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener('backButton', () => {
      const r = routeRef.current;
      if (r.name === 'record') return; // must use the on-screen buttons while recording
      if (r.name === 'home') CapApp.exitApp();
      else setRoute({ name: 'home' });
    });
    return () => {
      sub.then((h) => h.remove());
    };
  }, []);

  const startMeeting = async (draft: { title: string; client: string; participants: string }) => {
    const id = uid();
    const now = Date.now();
    const m: Meeting = {
      id,
      title: draft.title.trim() || `פגישה ${new Date(now).toLocaleDateString('he-IL')}`,
      client: draft.client.trim() || undefined,
      participants: draft.participants.trim() || undefined,
      createdAt: now,
      durationMs: 0,
      status: 'recording',
      updatedAt: now,
    };
    await saveMeeting(m);
    setRoute({ name: 'record', id });
  };

  const onStopped = (m: Meeting) => {
    setRefreshKey((k) => k + 1);
    setRoute({ name: 'meeting', id: m.id });
    if (settings.elevenLabsKey && settings.anthropicKey) {
      processMeeting(m.id)
        .then(() => toast('סיכום הפגישה מוכן'))
        .catch(() => undefined)
        .finally(() => setRefreshKey((k) => k + 1));
    } else {
      toast('ההקלטה נשמרה. הוסף מפתחות API בהגדרות כדי לעבד אותה.');
    }
  };

  const onCancelled = async (id: string) => {
    if (getActiveRecorder()) {
      try {
        await getActiveRecorder()!.stop();
      } catch {
        /* ignore */
      }
    }
    await deleteMeeting(id);
    setRefreshKey((k) => k + 1);
    setRoute({ name: 'home' });
  };

  if (!loaded) return <div className="app" />;

  return (
    <div className="app">
      {route.name === 'home' && (
        <Home settings={settings} refreshKey={refreshKey} onOpen={(id) => setRoute({ name: 'meeting', id })} onSettings={() => setRoute({ name: 'settings' })} onStart={startMeeting} />
      )}
      {route.name === 'record' && <Record meetingId={route.id} onStopped={onStopped} onCancelled={() => onCancelled(route.id)} />}
      {route.name === 'meeting' && (
        <MeetingView
          meetingId={route.id}
          toast={toast}
          onBack={() => {
            setRefreshKey((k) => k + 1);
            setRoute({ name: 'home' });
          }}
        />
      )}
      {route.name === 'settings' && <SettingsScreen settings={settings} onChange={setSettings} onBack={() => setRoute({ name: 'home' })} toast={toast} />}
      <Toast message={toastMsg} />
    </div>
  );
}
