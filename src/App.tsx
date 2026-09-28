import { useState } from 'react';

type Tab = 'dashboard' | 'fields' | 'machines' | 'warehouse' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Panel' },
  { id: 'fields', label: 'Pola' },
  { id: 'machines', label: 'Maszyny' },
  { id: 'warehouse', label: 'Magazyn' },
  { id: 'settings', label: 'Ustawienia' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [resetMsg, setResetMsg] = useState('');
  const [clearMsg, setClearMsg] = useState('');

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">
            F
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">FMS Precision 3.0</h1>
            <p className="text-xs text-muted-foreground">Zarządzanie gospodarstwem</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:block">
          dane lokalnie w przeglądarce
        </span>
      </header>

      <nav className="border-b border-border px-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ' +
              (tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {tab === 'dashboard' && <DashboardPanel onNavigate={setTab} />}
        {tab === 'fields' && (
          <SimplePanel
            title="Pola"
            desc="Lista pól, powierzchnie, uprawy i historia zabiegów."
            icon="🌾"
            color="bg-green-500/10 text-green-400"
            border="border-green-500/20"
            onNavigate={setTab}
            target="machines"
            cta="Zobacz maszyny"
            ctaColor="bg-green-600 hover:bg-green-500"
            extra="12 pól demonstracyjnych"
            extraColor="text-green-400"
            extraBg="bg-green-500/10"
            extraBorder="border-green-500/20"
            extraDesc="Dane zapisane w localStorage przeglądarki."
            extraDesc2="W Ustawieniach możesz je zresetować."
          />
        )}
        {tab === 'machines' && (
          <SimplePanel
            title="Maszyny"
            desc="Flota, koszty sesji i historia pracy."
            icon="🚜"
            color="bg-blue-500/10 text-blue-400"
            border="border-blue-500/20"
            onNavigate={setTab}
            target="warehouse"
            cta="Zobacz magazyn"
            ctaColor="bg-blue-600 hover:bg-blue-500"
            extra="Koszty sesji maszyn"
            extraColor="text-blue-400"
            extraBg="bg-blue-500/10"
            extraBorder="border-blue-500/20"
            extraDesc="Śledzenie paliwa, serwisu i godzin pracy."
            extraDesc2="Dane zapisane w localStorage przeglądarki."
          />
        )}
        {tab === 'warehouse' && (
          <SimplePanel
            title="Magazyn"
            desc="Nawozy, środki ochrony, części i stany magazynowe."
            icon="📦"
            color="bg-amber-500/10 text-amber-400"
            border="border-amber-500/20"
            onNavigate={setTab}
            target="settings"
            cta="Otwórz ustawienia"
            ctaColor="bg-amber-600 hover:bg-amber-500"
            extra="Stany i alerty"
            extraColor="text-amber-400"
            extraBg="bg-amber-500/10"
            extraBorder="border-amber-500/20"
            extraDesc="Powiadomienia o niskich stanach."
            extraDesc2="Dane zapisane w localStorage przeglądarki."
          />
        )}
        {tab === 'settings' && (
          <SettingsPanel
            resetMsg={resetMsg}
            clearMsg={clearMsg}
            onResetMsg={setResetMsg}
            onClearMsg={setClearMsg}
            onNavigate={setTab}
          />
        )}
      </main>

      <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>FMS Precision 3.0</span>
        <span>Pogoda: Open-Meteo</span>
        <span>Mapy: OpenStreetMap</span>
        <span>PWA</span>
      </footer>
    </div>
  );
}

function DashboardPanel({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const cards = [
    { label: 'Pola', value: '12', sub: 'łącznie ha', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', tab: 'fields' as Tab },
    { label: 'Maszyny', value: '8', sub: 'w flocie', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', tab: 'machines' as Tab },
    { label: 'Magazyn', value: '24', sub: 'pozycje', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', tab: 'warehouse' as Tab },
    { label: 'Sesje', value: '156', sub: 'historia pracy', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20', tab: 'machines' as Tab },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Panel główny</h2>
        <p className="text-sm text-muted-foreground mt-1">Przegląd gospodarstwa w jednym miejscu.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => onNavigate(c.tab)}
            className={'rounded-xl border p-5 text-left transition-colors hover:bg-white/5 ' + c.bg + ' ' + c.border}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{c.label}</p>
            <p className={'text-3xl font-bold mt-1 ' + c.color}>{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-medium mb-2">Szybki start</h3>
        <p className="text-sm text-muted-foreground">
          To jest wersja startowa aplikacji. Moduły GIS, Dziennik, Field Pilot i Magazyn
          działają w pełnej wersji w repozytorium GitHub — tutaj masz szkielet gotowy do rozbudowy.
        </p>
      </div>
    </div>
  );
}

function SimplePanel({ title, desc, icon, color, border, onNavigate, target, cta, ctaColor, extra, extraColor, extraBg, extraBorder, extraDesc, extraDesc2,}: {
  title: string; desc: string; icon: string; color: string; border: string;
  onNavigate: (t: Tab) => void; target: Tab; cta: string; ctaColor: string;
  extra: string; extraColor: string; extraBg: string; extraBorder: string; extraDesc: string; extraDesc2: string;
}) {
  return (
    <div className="space-y-6">
      <div className={'rounded-xl border p-6 ' + color + ' ' + border}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{icon}</span>
          <h2 className="text-2xl font-semibold">{title}</h2>
        </div>
        <p className="text-sm opacity-80">{desc}</p>
      </div>
      <div className={'rounded-xl border p-5 ' + extraBg + ' ' + extraBorder}>
        <h3 className={'font-medium ' + extraColor}>{extra}</h3>
        <p className="text-sm text-muted-foreground mt-1">{extraDesc}</p>
        <p className="text-sm text-muted-foreground">{extraDesc2}</p>
      </div>
      <button
        onClick={() => onNavigate(target)}
        className={'px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-colors ' + ctaColor}
      >
        {cta}
      </button>
    </div>
  );
}

function SettingsPanel({ resetMsg, clearMsg, onResetMsg, onClearMsg, onNavigate,}: {
  resetMsg: string; clearMsg: string; onResetMsg: (v: string) => void; onClearMsg: (v: string) => void;
  onNavigate: (t: Tab) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Ustawienia</h2>
        <p className="text-sm text-muted-foreground mt-1">Zarządzanie danymi demonstracyjnymi.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-500/20 bg-slate-500/10 p-5">
          <h3 className="font-medium text-slate-300">Reset danych</h3>
          <p className="text-sm text-muted-foreground mt-1">Przywraca dane demonstracyjne.</p>
          <p className="text-sm text-muted-foreground">Dane zapisane w localStorage przeglądarki.</p>
          <button
            onClick={() => {
              try { localStorage.removeItem('fms-data'); } catch {} 
              onResetMsg('Dane zresetowane.');
              onClearMsg('');
            }}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors"
          >
            Resetuj dane demo
          </button>
          {resetMsg && <p className="text-xs text-green-400 mt-2">{resetMsg}</p>}
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5">
          <h3 className="font-medium text-red-400">Wyczyść wszystko</h3>
          <p className="text-sm text-muted-foreground mt-1">Usuwa wszystkie dane z localStorage.</p>
          <p className="text-sm text-muted-foreground">Nieodwracalne.</p>
          <button
            onClick={() => {
              try {
                Object.keys(localStorage)
                  .filter((k) => k.startsWith('fms-'))
                  .forEach((k) => localStorage.removeItem(k));
              } catch {} 
              onClearMsg('Wyczyszczono.');
              onResetMsg('');
            }}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors"
          >
            Wyczyść dane
          </button>
          {clearMsg && <p className="text-xs text-red-400 mt-2">{clearMsg}</p>}
        </div>
      </div>
      <button
        onClick={() => onNavigate('dashboard')}
        className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 transition-colors"
      >
        Wróć do panelu
      </button>
    </div>
  );
}
