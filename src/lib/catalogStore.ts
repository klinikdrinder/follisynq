/** Runtime clinical catalogue: organisation definitions synced from Supabase, bundled defaults as offline fallback. */
import { STAGES, PATIENT_SECTIONS, RECORDING_CONTEXT, DONOR_REGIONS, RECIPIENT_REGIONS, StageDef, ParamDef } from './catalog';
import { all } from './db';
import { sb } from './supabase';

export interface RuntimeCatalog {
  stages: StageDef[];
  patient: typeof PATIENT_SECTIONS;
  recording: ParamDef[];
  donorRegions: string[];
  recipientRegions: string[];
  source: 'organisation' | 'bundled';
}

const toParam = (d: any): ParamDef & { active: boolean } => ({
  key: d.key, label: d.label, type: d.data_type, group: d.group_name ?? undefined, unit: d.unit ?? undefined,
  options: Array.isArray(d.options) ? d.options : undefined, provenance: d.provenance, searchable: d.searchable, help: d.help ?? undefined,
  active: d.active,
});

export async function loadCatalog(): Promise<RuntimeCatalog> {
  const [stages, subs, params, regions] = await Promise.all([
    all('procedure_stages'), all('procedure_subcategories'), all('parameter_definitions'), all('anatomical_regions'),
  ]);
  if (!stages.length) {
    return { stages: STAGES, patient: PATIENT_SECTIONS, recording: RECORDING_CONTEXT, donorRegions: DONOR_REGIONS, recipientRegions: RECIPIENT_REGIONS, source: 'bundled' };
  }
  const bundled = new Map(STAGES.map((s) => [s.code, s]));
  const sorted = (a: any, b: any) => a.sort_order - b.sort_order;
  const outStages: StageDef[] = stages.filter((s: any) => s.active).sort(sorted).map((s: any) => ({
    code: s.code, number: s.number, slug: s.slug, title: s.title, description: s.description ?? '', folder: s.folder_name,
    priority: s.priority, views: s.standard_views?.length ? s.standard_views : bundled.get(s.code)?.views,
    subcategories: subs.filter((x: any) => x.stage_id === s.id && x.active).sort(sorted).map((x: any) => ({ code: x.code, label: x.label, folder: x.folder_name })),
    params: params.filter((p: any) => p.stage_id === s.id && p.scope === 'stage' && p.active).sort(sorted).map(toParam),
  }));
  const scoped = (scope: string) => params.filter((p: any) => p.scope === scope && p.active).sort(sorted).map(toParam);
  const patient = PATIENT_SECTIONS.map((sec) => {
    const p = scoped(`patient_${sec.key}`);
    return { ...sec, params: p.length ? p : sec.params };
  });
  const rec = scoped('recording_context');
  const dr = regions.filter((r: any) => r.kind === 'donor' && r.active).sort(sorted).map((r: any) => r.label);
  const rr = regions.filter((r: any) => r.kind === 'recipient' && r.active).sort(sorted).map((r: any) => r.label);
  return {
    stages: outStages, patient, recording: rec.length ? rec : RECORDING_CONTEXT,
    donorRegions: dr.length ? dr : DONOR_REGIONS, recipientRegions: rr.length ? rr : RECIPIENT_REGIONS, source: 'organisation',
  };
}

/** Administrator action: install the default clinical catalogue into Supabase (idempotent — existing entries are kept). */
export async function installDefaultCatalog(orgId: string, onProgress?: (m: string) => void) {
  const c = sb();
  const { data: existing } = await c.from('procedure_stages').select('id, code').eq('org_id', orgId);
  const byCode = new Map((existing ?? []).map((s: any) => [s.code, s.id]));
  for (const s of STAGES) {
    onProgress?.(`Stage ${s.code} — ${s.title}`);
    let id = byCode.get(s.code);
    if (!id) {
      const { data, error } = await c.from('procedure_stages').insert({
        org_id: orgId, code: s.code, number: s.number, slug: s.slug, title: s.title, description: s.description,
        folder_name: s.folder, priority: s.priority, standard_views: s.views ?? [], sort_order: s.number,
      }).select('id').single();
      if (error) throw new Error(error.message);
      id = data.id;
    }
    const { data: es } = await c.from('procedure_subcategories').select('code').eq('stage_id', id);
    const have = new Set((es ?? []).map((x: any) => x.code));
    const newSubs = s.subcategories.map((x, i) => ({ org_id: orgId, stage_id: id, code: x.code, label: x.label, folder_name: x.folder, sort_order: i + 1 })).filter((x) => !have.has(x.code));
    if (newSubs.length) { const { error } = await c.from('procedure_subcategories').insert(newSubs); if (error) throw new Error(error.message); }
    const { data: ep } = await c.from('parameter_definitions').select('key').eq('stage_id', id);
    const haveP = new Set((ep ?? []).map((x: any) => x.key));
    const newP = s.params.map((p, i) => paramRow(orgId, 'stage', id!, p, i)).filter((x) => !haveP.has(x.key));
    if (newP.length) { const { error } = await c.from('parameter_definitions').insert(newP); if (error) throw new Error(error.message); }
  }
  onProgress?.('Patient and recording-context fields');
  const { data: ep } = await c.from('parameter_definitions').select('scope, key').is('stage_id', null);
  const haveP = new Set((ep ?? []).map((x: any) => `${x.scope}:${x.key}`));
  const other = [
    ...PATIENT_SECTIONS.flatMap((sec) => sec.params.map((p, i) => paramRow(orgId, `patient_${sec.key}`, null, p, i))),
    ...RECORDING_CONTEXT.map((p, i) => paramRow(orgId, 'recording_context', null, p, i)),
  ].filter((x) => !haveP.has(`${x.scope}:${x.key}`));
  if (other.length) { const { error } = await c.from('parameter_definitions').insert(other); if (error) throw new Error(error.message); }
  onProgress?.('Anatomical regions');
  const { data: er } = await c.from('anatomical_regions').select('kind, code');
  const haveR = new Set((er ?? []).map((x: any) => `${x.kind}:${x.code}`));
  const code = (l: string) => l.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const regs = [
    ...DONOR_REGIONS.map((l, i) => ({ org_id: orgId, kind: 'donor', code: code(l), label: l, sort_order: i + 1 })),
    ...RECIPIENT_REGIONS.map((l, i) => ({ org_id: orgId, kind: 'recipient', code: code(l), label: l, sort_order: i + 1 })),
  ].filter((r) => !haveR.has(`${r.kind}:${r.code}`));
  if (regs.length) { const { error } = await c.from('anatomical_regions').insert(regs); if (error) throw new Error(error.message); }
}

function paramRow(orgId: string, scope: string, stageId: string | null, p: ParamDef, i: number) {
  return {
    org_id: orgId, scope, stage_id: stageId, key: p.key, label: p.label, data_type: p.type, group_name: p.group ?? null,
    unit: p.unit ?? null, options: p.options ?? null, provenance: !!p.provenance, searchable: !!p.searchable, help: p.help ?? null, sort_order: i + 1,
  };
}
