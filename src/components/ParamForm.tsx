'use client';
import React from 'react';
import type { ParamDef } from '@/lib/catalog';
import { CLASSIFICATIONS, PROVENANCE } from '@/lib/catalog';
import type { Values, Val } from '@/lib/clinical';
import { isFilled } from '@/lib/clinical';
import { Input, Select, Textarea, cx, inputCls } from './ui';
import { useApp } from './AppProvider';

/** Renders optional clinical parameters. Blank stays blank (null) — nothing is defaulted to zero. */
export function ParamForm({ defs, values, onChange, disabled }: { defs: ParamDef[]; values: Values; onChange: (v: Values) => void; disabled?: boolean }) {
  const { catalog, profile } = useApp();
  const groups: [string, ParamDef[]][] = [];
  for (const d of defs) {
    const g = d.group ?? '';
    const ex = groups.find((x) => x[0] === g);
    ex ? ex[1].push(d) : groups.push([g, [d]]);
  }
  const set = (key: string, patch: Partial<Val>) => {
    const cur = values[key] ?? { v: null };
    const next: Val = { ...cur, ...patch, by: profile?.id ?? null, at: new Date().toISOString() };
    onChange({ ...values, [key]: next });
  };
  return (
    <div className="space-y-6">
      {groups.map(([g, list]) => (
        <div key={g || 'main'}>
          {g && <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-teal-700">{g}</h4>}
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((d) => (
              <ParamField key={d.key} def={d} val={values[d.key]} values={values} set={(p) => set(d.key, p)} disabled={disabled}
                donor={catalog?.donorRegions ?? []} recipient={catalog?.recipientRegions ?? []} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ParamField({ def, val, values, set, disabled, donor, recipient }: { def: ParamDef; val?: Val; values: Values; set: (p: Partial<Val>) => void; disabled?: boolean; donor: string[]; recipient: string[] }) {
  const v = val?.v ?? null;
  const wide = def.type === 'textarea' || def.type.endsWith('regions') || def.type === 'multiselect';
  let control: React.ReactNode;
  switch (def.type) {
    case 'number':
      control = (
        <div className="relative">
          <Input type="number" inputMode="decimal" step="any" disabled={disabled} value={v ?? ''} placeholder="Not recorded"
            onChange={(e) => set({ v: e.target.value === '' ? null : Number(e.target.value), unit: def.unit && def.unit !== 'count' ? def.unit : null })}
            className={def.unit && def.unit !== 'count' ? 'pr-20' : ''} />
          {def.unit && def.unit !== 'count' && <span className="pointer-events-none absolute right-3 top-3 text-sm text-navy-400">{def.unit}</span>}
        </div>
      );
      break;
    case 'textarea':
      control = <Textarea disabled={disabled} value={v ?? ''} placeholder="Not recorded" onChange={(e) => set({ v: e.target.value || null })} />;
      break;
    case 'select': {
      let opts = def.options ?? [];
      control = <Select disabled={disabled} options={opts} value={v ?? ''} placeholder="Not recorded" onChange={(x) => set({ v: x || null })} />;
      break;
    }
    case 'multiselect':
    case 'donor_regions':
    case 'recipient_regions': {
      const opts = def.type === 'donor_regions' ? donor : def.type === 'recipient_regions' ? recipient : def.options ?? [];
      const arr: string[] = Array.isArray(v) ? v : [];
      control = (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const on = arr.includes(o);
            return (
              <button type="button" key={o} disabled={disabled} onClick={() => { const n = on ? arr.filter((x) => x !== o) : [...arr, o]; set({ v: n.length ? n : null }); }}
                className={cx('rounded-full border px-3 py-1.5 text-sm', on ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-navy-200 text-navy-600')}>{o}</button>
            );
          })}
        </div>
      );
      break;
    }
    case 'donor_region':
    case 'recipient_region':
      control = <Select disabled={disabled} options={def.type === 'donor_region' ? donor : recipient} value={v ?? ''} placeholder="Not recorded" onChange={(x) => set({ v: x || null })} />;
      break;
    case 'datetime':
      control = <Input type="datetime-local" disabled={disabled} value={v ?? ''} onChange={(e) => set({ v: e.target.value || null })} />;
      break;
    case 'date':
      control = <Input type="date" disabled={disabled} value={v ?? ''} onChange={(e) => set({ v: e.target.value || null })} />;
      break;
    case 'time':
      control = <Input type="time" disabled={disabled} value={v ?? ''} onChange={(e) => set({ v: e.target.value || null })} />;
      break;
    case 'boolean':
      control = <Select disabled={disabled} options={['Yes', 'No']} value={v === true ? 'Yes' : v === false ? 'No' : ''} placeholder="Not recorded" onChange={(x) => set({ v: x === '' ? null : x === 'Yes' })} />;
      break;
    default:
      if (def.key === 'grade' && values.classification?.v && CLASSIFICATIONS[values.classification.v]?.length) {
        control = <Select disabled={disabled} options={CLASSIFICATIONS[values.classification.v]} value={v ?? ''} placeholder="Not recorded" onChange={(x) => set({ v: x || null })} />;
      } else {
        control = <Input disabled={disabled} value={v ?? ''} placeholder="Not recorded" onChange={(e) => set({ v: e.target.value || null })} />;
      }
  }
  return (
    <div className={cx(wide && 'sm:col-span-2 xl:col-span-3')}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={cx('text-[13px] font-medium', isFilled(val) ? 'text-navy-800' : 'text-navy-500')}>{def.label}</span>
        {def.provenance && (
          <select disabled={disabled} value={val?.src ?? ''} onChange={(e) => set({ src: e.target.value || null })}
            className="max-w-[150px] rounded-lg border border-navy-100 bg-navy-50 px-1.5 py-0.5 text-[11px] text-navy-500" aria-label={`${def.label} source`}>
            <option value="">Source…</option>
            {PROVENANCE.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        )}
      </div>
      {control}
      {def.help && <p className="mt-1 text-xs text-navy-400">{def.help}</p>}
    </div>
  );
}

export function filledCount(values: Values, defs: ParamDef[]) {
  return defs.filter((d) => isFilled(values[d.key])).length;
}
export { inputCls };
